/**
 * Stages S and A, as pure functions (P03-c S, P03-c A, P03-d, P03-e).
 *
 * Two properties are structural here rather than a discipline: screening receives an
 * {@link EntityView} built from snapshots, so it *cannot* move `H`, latch a kind or edit a queue; and
 * it returns proposals (candidates, refusals, cache writes, answers) that `step.ts` applies in stage
 * C. That is how "screening never advances `H`, never latches a kind, and never rejects an intention
 * that could win arbitration" is enforced instead of asserted.
 */

import {
  compareRequestIdentity,
  validateCancelPath,
  validateDirectFrame,
  validateMoveTo,
} from '@udg/protocol';
import type {
  DirectFrame,
  DirectInput,
  Generation,
  MovementIntentStamp,
  RejectionCode,
  RegionBounds,
  ServerTick,
  Validation,
  Vec3,
} from '@udg/protocol';
import { canonicalHash } from '@udg/config';

import { payloadFromRendered } from './arrival.js';
import type { BatchRegistry, IdentityEntry } from './bounded.js';
import type { EntityView } from './entity.js';
import type {
  ArrivalOrdinal,
  ArrivalRecord,
  ArbitrationDecision,
  BatchEntry,
  CachedIdentity,
  IntentionCandidate,
  TerminalResult,
} from './types.js';
import { KIND_PRECEDENCE } from './types.js';

export interface ScreeningContext {
  /** Explicitly supplied, already-validated bounds. There is no default (owner decision D5). */
  readonly bounds: Readonly<RegionBounds>;
  /** Always `MAX_GENERATION_FORWARD_GAP`; a literal would let the window drift from the protocol. */
  readonly gapWindow: number;
  readonly nowMs: number;
  readonly tick: ServerTick;
}

export interface ContinuousScreening {
  readonly arrival: ArrivalRecord;
  /** Stage Q selected it, so this observation is consumed this tick whatever else happens (P03-f). */
  readonly consumed: true;
  readonly candidate: IntentionCandidate | null;
  readonly keepalive: boolean;
  readonly refusal: RejectionCode | null;
  readonly generation: Generation | null;
  readonly directIntent: boolean | null;
  readonly axes: DirectInput | null;
  /** The journal records the generation the frame *declared*, even when it is refused. */
  readonly declaredGeneration: Generation | null;
}

export interface DiscreteRefusalProposal {
  readonly arrival: ArrivalRecord;
  readonly code: RejectionCode;
  readonly requestId: string | null;
  readonly payloadHash: string | null;
  /** `false` when the identity did not parse: inventing a key would let a malformed payload poison the cache. */
  readonly cacheable: boolean;
  readonly stage: 'S';
}

export interface IdentityAnswerProposal {
  readonly arrival: ArrivalRecord;
  readonly requestId: string;
  readonly payloadHash: string;
  readonly dedupe: 'cache' | 'batch';
  readonly code: RejectionCode | null;
  readonly terminal: TerminalResult | null;
  /** For a batch answer, the ordinal whose disposition this arrival shares (resolved at commit). */
  readonly sharesOrdinal: ArrivalOrdinal | null;
}

export interface DiscreteScreening {
  readonly candidates: readonly IntentionCandidate[];
  readonly refusals: readonly DiscreteRefusalProposal[];
  readonly answers: readonly IdentityAnswerProposal[];
  /** Proposed cache writes; applied by stage C, never here. */
  readonly cacheWrites: readonly CachedIdentity[];
}

/** One validated request, normalised so the hashing rule has one shape for both kinds. */
export interface ValidatedRequest {
  readonly requestId: string;
  readonly stamp: MovementIntentStamp;
  readonly destination: Vec3 | null;
}

/**
 * The `payloadHash` of a validated request.
 *
 * P03-d requires the *fields*, not the raw text. The stamp is included deliberately: re-sending the
 * same `requestId` at a different generation is a conflict rather than a silent replay, and the
 * identity that authorises a dedupe is never overwritten by it (P03-e T-4, T-8).
 */
export const payloadHashOf = (kind: 'moveTo' | 'cancelPath', request: ValidatedRequest): string =>
  canonicalHash(
    kind === 'moveTo'
      ? {
          kind: 'udg-request-identity',
          requestId: request.requestId,
          sessionEpoch: request.stamp.sessionEpoch,
          generation: request.stamp.generation,
          destination: request.destination,
        }
      : {
          kind: 'udg-request-identity',
          requestId: request.requestId,
          sessionEpoch: request.stamp.sessionEpoch,
          generation: request.stamp.generation,
        },
  );

const terminalFor = (
  requestId: string,
  payloadHash: string,
  accepted: boolean,
  appliedTick: ServerTick | null,
  reason: RejectionCode | null,
  tick: ServerTick,
): TerminalResult => ({
  requestId,
  payloadHash,
  accepted,
  appliedTick,
  routeRevision: null,
  reason,
  recordedTick: tick,
});

const cachedIdentity = (
  view: EntityView,
  requestId: string,
  payloadHash: string,
  terminal: TerminalResult,
  nowMs: number,
): CachedIdentity => ({
  entityId: view.entityId,
  sessionEpoch: view.epoch,
  requestId,
  payloadHash,
  terminal,
  storedAtMs: nowMs,
});

/**
 * Stage S for the one continuous observation stage Q selected.
 *
 * Order is the adopted one: protocol validation (whose own order is fixed), then `SUPERSEDED`, then
 * the gap, then **the keepalive branch before any kind test** — so a keepalive can never be refused
 * `INVALID_GENERATION`, can never become a candidate, and cannot touch `H`, `latchedKind` or `G_d`
 * (P03-e T-5).
 */
export const screenContinuous = (
  view: EntityView,
  arrival: ArrivalRecord,
  context: ScreeningContext,
): ContinuousScreening => {
  const payload = payloadFromRendered(arrival.raw);
  const validated: Validation<DirectFrame> = validateDirectFrame(payload, {
    sessionEpoch: view.epoch,
  });

  const base: ContinuousScreening = {
    arrival,
    consumed: true,
    candidate: null,
    keepalive: false,
    refusal: null,
    generation: null,
    directIntent: null,
    axes: null,
    declaredGeneration: arrival.declaredGeneration,
  };

  if (!validated.ok) {
    return { ...base, refusal: validated.code };
  }

  const frame = validated.value;
  const withFrame: ContinuousScreening = {
    ...base,
    generation: frame.generation,
    directIntent: frame.directIntent,
  };

  if (frame.generation < view.watermark) {
    return { ...withFrame, refusal: 'SUPERSEDED' };
  }

  if (
    frame.generation > view.watermark &&
    frame.generation - view.watermark > context.gapWindow
  ) {
    return { ...withFrame, refusal: 'RESYNC_REQUIRED' };
  }

  if (frame.directIntent === false) {
    return { ...withFrame, keepalive: true };
  }

  if (frame.generation === view.watermark && view.latchedKind !== 'direct') {
    return { ...withFrame, refusal: 'INVALID_GENERATION' };
  }

  return {
    ...withFrame,
    axes: { moveX: frame.moveX, moveZ: frame.moveZ },
    candidate: {
      kind: 'direct',
      generation: frame.generation,
      ordinal: arrival.ordinal,
      axes: { moveX: frame.moveX, moveZ: frame.moveZ },
      requestId: null,
      payloadHash: null,
    },
  };
};

/**
 * Stage S for every discrete request in the frozen batch, in arrival order.
 *
 * Identity is answered **first** — persistent cache, then this tick's batch registry — because a
 * dedupe must not depend on a watermark that a later stage might move. Only after identity does the
 * generation window apply, and `UDG_MOVE_TO` is terminal-refused before it can ever become a
 * candidate: no `H` change, no `path` latch, no route mutation (P03-h, AC-8).
 */
export const screenDiscrete = (
  view: EntityView,
  arrivals: readonly ArrivalRecord[],
  batch: BatchRegistry<BatchEntry>,
  context: ScreeningContext,
): DiscreteScreening => {
  const candidates: IntentionCandidate[] = [];
  const refusals: DiscreteRefusalProposal[] = [];
  const answers: IdentityAnswerProposal[] = [];
  const cacheWrites: CachedIdentity[] = [];
  const commandContext = { sessionEpoch: view.epoch, bounds: context.bounds };

  const refuseAndCache = (
    arrival: ArrivalRecord,
    code: RejectionCode,
    requestId: string,
    payloadHash: string,
  ): void => {
    refusals.push({ arrival, code, requestId, payloadHash, cacheable: true, stage: 'S' });
    // Terminal *refusals* are cached too: protocol.md 4.3 emits a terminal result once and keeps it
    // for dedup, which is why an evicted id must still be refused rather than replayed (T-4).
    const terminal = terminalFor(requestId, payloadHash, false, null, code, context.tick);
    cacheWrites.push(cachedIdentity(view, requestId, payloadHash, terminal, context.nowMs));
  };

  for (const arrival of arrivals) {
    const isMoveTo = arrival.kind === 'moveTo';
    let request: ValidatedRequest;
    if (isMoveTo) {
      const validated = validateMoveTo(payloadFromRendered(arrival.raw), commandContext);
      if (!validated.ok) {
        // Identity is not trusted from an invalid payload, so nothing is cached for it.
        refusals.push({ arrival, code: validated.code, requestId: null, payloadHash: null, cacheable: false, stage: 'S' });
        continue;
      }
      request = {
        requestId: validated.value.requestId,
        stamp: validated.value.stamp,
        destination: validated.value.destination,
      };
    } else {
      const validated = validateCancelPath(payloadFromRendered(arrival.raw), commandContext);
      if (!validated.ok) {
        refusals.push({ arrival, code: validated.code, requestId: null, payloadHash: null, cacheable: false, stage: 'S' });
        continue;
      }
      request = { requestId: validated.value.requestId, stamp: validated.value.stamp, destination: null };
    }
    const payloadHash = payloadHashOf(isMoveTo ? 'moveTo' : 'cancelPath', request);
    const requestId = request.requestId;

    const hit: IdentityEntry | undefined = view.identities.lookup(view.entityId, view.epoch, requestId);
    if (hit !== undefined) {
      const comparison = compareRequestIdentity(
        { requestId: hit.identity.requestId, payloadHash: hit.identity.payloadHash },
        { requestId, payloadHash },
      );
      answers.push(
        comparison.ok
          ? {
              arrival,
              requestId,
              payloadHash,
              dedupe: 'cache',
              code: null,
              terminal: hit.identity.terminal,
              sharesOrdinal: null,
            }
          : {
              // A conflict never overwrites the identity that authorises the dedupe (T-4).
              arrival,
              requestId,
              payloadHash,
              dedupe: 'cache',
              code: comparison.code,
              terminal: null,
              sharesOrdinal: null,
            },
      );
      continue;
    }

    const inBatch = batch.get(requestId);
    if (inBatch !== undefined) {
      const same = inBatch.value.payloadHash === payloadHash;
      answers.push({
        arrival,
        requestId,
        payloadHash,
        dedupe: 'batch',
        code: same ? null : 'REQUEST_ID_CONFLICT',
        terminal: null,
        sharesOrdinal: same ? inBatch.ordinal : null,
      });
      continue;
    }

    batch.set(requestId, arrival.ordinal, { requestId, payloadHash, ordinal: arrival.ordinal });

    const generation = request.stamp.generation;
    if (generation < view.watermark) {
      refuseAndCache(arrival, 'SUPERSEDED', requestId, payloadHash);
      continue;
    }
    // Equality is never a new discrete intention, whatever the latched kind (T-8).
    if (generation === view.watermark) {
      refuseAndCache(arrival, 'INVALID_GENERATION', requestId, payloadHash);
      continue;
    }
    if (generation - view.watermark > context.gapWindow) {
      refuseAndCache(arrival, 'RESYNC_REQUIRED', requestId, payloadHash);
      continue;
    }

    if (isMoveTo) {
      // UDG-003 has no navigation. `validateMoveTo` has already applied containment against the
      // validated volume, so an outside destination reached `OUT_OF_BOUNDS` here already and this is
      // the honest remaining refusal.
      refuseAndCache(arrival, 'NAVIGATION_BUSY', requestId, payloadHash);
      continue;
    }

    candidates.push({
      kind: 'cancel',
      generation,
      ordinal: arrival.ordinal,
      axes: null,
      requestId,
      payloadHash,
    });
  }

  return { candidates, refusals, answers, cacheWrites };
};

/**
 * Stage A: rank the surviving intentions.
 *
 * Newer generation first, then kind precedence, then lowest ordinal — kind precedence **overrides**
 * arrival order, which is what makes O02 order-independent. The result may legitimately have no
 * winner, and callers must not dereference `winner` blindly.
 */
export const arbitrate = (candidates: readonly IntentionCandidate[]): ArbitrationDecision => {
  const ranked = [...candidates].sort((a, b) => {
    if (b.generation !== a.generation) return b.generation - a.generation;
    const precedence = KIND_PRECEDENCE[a.kind] - KIND_PRECEDENCE[b.kind];
    if (precedence !== 0) return precedence;
    return a.ordinal - b.ordinal;
  });
  const winner = ranked[0];
  if (winner === undefined) return { winner: null, losers: [] };
  const losers = ranked.slice(1).map((candidate) => {
    const code: RejectionCode =
      candidate.generation === winner.generation ? 'INVALID_GENERATION' : 'SUPERSEDED';
    return { candidate, code };
  });
  return { winner, losers };
};
