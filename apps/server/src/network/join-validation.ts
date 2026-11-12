/**
 * Join validation and session-epoch issuance (UDG-003 Phase 2, W-4).
 *
 * Two facts govern this module, and both are ownership claims rather than conveniences:
 *
 * 1. The UDG session epoch is issued by **this server**. `InputHandle.epoch` is a client-side reset
 *    counter (PR-12) and is never read as authority; a frame or a rejoin may *carry* an epoch claim,
 *    and the room answers it against the association this module owns. That is protocol-v1 §6.2's
 *    rule restated for the transport side, and §8.3 invariant 5's rule that lifecycle authority
 *    comes from the server call path only.
 * 2. Join validation is the hash gate. `validateJoin` (protocol 1.0.0) demands the exact
 *    `{ protocolVersion, configHash, manifestHash }` triple, and the comparison here is against the
 *    configuration this room actually runs — a client that disagrees about what "compliant" means
 *    is refused before it owns an entity, before it owns an epoch, and before any frame is consumed.
 */

import { validateJoin } from '@udg/protocol';
import type { RegionBounds } from '@udg/protocol';

/** What a joining client must present. Anything else in the options object is ignored, not trusted. */
export interface JoinPresentation {
  readonly protocolVersion: string;
  readonly configHash: string;
  readonly manifestHash: string;
}
export interface JoinAuthority {
  /** The protocol version this room was built with. */
  readonly protocolVersion: string;
  /** `computeConfigHash` of the whole live `ServerConfig` (§7 canonicalisation). */
  readonly configHash: string;
  /** `regionHash` of the live region block; the manifest identity of what the client expects to see. */
  readonly manifestHash: string;
}

export type JoinDecision =
  | { readonly ok: true; readonly presentation: JoinPresentation }
  | { readonly ok: false; readonly reason: 'malformed' | 'mismatch'; readonly detail: string };

/**
 * Screen a join against the triple, then against this room's live identity.
 *
 * The protocol validator runs first so a malformed presentation is reported as malformed and an
 * out-of-domain value can never reach the comparison; the comparison is field-by-field equality on
 * strings, which is exactly what the version/hash pair is designed for.
 */
export const screenJoin = (options: unknown, authority: JoinAuthority): JoinDecision => {
  const verdict = validateJoin(options, {
    protocolVersion: authority.protocolVersion,
    configHash: authority.configHash,
    manifestHash: authority.manifestHash,
  });
  if (verdict.ok === true) return { ok: true, presentation: verdict.value };
  // `PROTOCOL_MISMATCH` is the version refusal; the hash refusals are the mismatch family; every
  // other code is a payload defect. The names come from the protocol's closed rejection vocabulary,
  // so this module adds no third category.
  const reason = verdict.code === 'PROTOCOL_MISMATCH' || verdict.code === 'CONFIG_MISMATCH' || verdict.code === 'ASSET_MISMATCH'
    ? 'mismatch'
    : 'malformed';
  return { ok: false, reason, detail: verdict.code };
};

/**
 * The server-owned epoch counter.
 *
 * Monotonic for the lifetime of the room, starting at 1 because `0` is the schema default and the
 * protocol's "no epoch" value. Every association change — first join or rejoin — takes a fresh
 * value; epochs are never reused, because the disposition record's stamp domain restarts per
 * connection domain and a reused epoch would make two domains comparable.
 */
export class EpochIssuer {
  #next = 0;

  issue(): number {
    this.#next += 1;
    return this.#next;
  }

  get issued(): number {
    return this.#next;
  }
}

/**
 * Where a joining entity spawns.
 *
 * There is no production region asset (D5, UDG-007), so a room runs only with bounds supplied by
 * its operator (tests pass the labelled test-only-synthetic bounds; a production deployment passes
 * the real region when one exists). The spawn is the region centre unless the operator overrides
 * it, because a client never chooses canonical position (protocol-v1 §6).
 */
export const spawnFor = (bounds: Readonly<RegionBounds>): { readonly x: number; readonly y: number; readonly z: number } => ({
  x: (bounds.x.min + bounds.x.max) / 2,
  y: (bounds.y.min + bounds.y.max) / 2,
  z: (bounds.z.min + bounds.z.max) / 2,
});
