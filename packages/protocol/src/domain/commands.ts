/**
 * Intent, result and rejection declarations (interfaces/domain.md A5, interfaces/protocol.md 4.3).
 *
 * The rejection vocabulary is closed: an unlisted code cannot exist, and a transport failure has a
 * separate connection error rather than a fabricated command result.
 */

import type { RejectionCode, ServerTick, Vec3 } from './primitives.js';
import type { MovementIntentStamp } from './wire.js';

/**
 * Re-exported from `primitives.ts` so that the vocabulary is reachable from the command declarations
 * that use it. The type lives there because the wire envelopes in `wire.ts` reject frames with the same
 * codes, and a shared union imported in both directions would otherwise form a module cycle.
 */
export type { RejectionCode } from './primitives.js';

/** One-shot path request. The stamp is flattened onto the wire (protocol.md 4.2). */
export interface MoveToRequest {
  readonly requestId: string;
  readonly stamp: MovementIntentStamp;
  readonly destination: Vec3;
}

export interface CancelPathRequest {
  readonly requestId: string;
  readonly stamp: MovementIntentStamp;
}

/**
 * Closed rejection vocabulary (protocol.md 4.3). v0.2's optional free-text reason is constrained to
 * these codes.
 *
 * Provenance of each code matters for review: a code that UDG-002 cannot produce on its own is still
 * declared here, because the union is closed and later tasks must not widen it casually.
 *
 * This union is declared in `primitives.ts` rather than here because both the command results below and
 * the wire envelopes in `wire.ts` reject with it, and the dependency graph must stay acyclic.
 */

/**
 * Terminal result of a movement command.
 *
 * `accepted: true` means the mode change committed at `appliedTick`, not that it was queued.
 * `appliedTick` is `null` on rejection and `routeRevision` is `null` for cancel and rejection
 * (protocol.md 4.3). The result-side `routeRevision` is nullable even though the *replica* uses the
 * `0` sentinel: the two directions are deliberately different encodings of absence.
 */
export interface MovementCommandResult {
  readonly requestId: string;
  readonly accepted: boolean;
  readonly appliedTick: ServerTick | null;
  readonly routeRevision: number | null;
  readonly reason?: RejectionCode;
}

/**
 * Runtime route status values (protocol.md 4.3).
 *
 * Declared as a value and derived as a type for the same reason as `REJECTION_CODES`: the validator has
 * to compare an incoming string against the vocabulary at runtime, and a second list would be free to
 * disagree with the type.
 */
export const ROUTE_STATUS_VALUES = ['ARRIVED', 'BLOCKED', 'CANCELLED', 'SUPERSEDED'] as const;
export type RouteStatusValue = (typeof ROUTE_STATUS_VALUES)[number];

export interface RouteStatus {
  readonly entityId: string;
  readonly sessionEpoch: number;
  readonly generation: number;
  readonly routeRevision: number;
  readonly status: RouteStatusValue;
  readonly serverTick: ServerTick;
}

/**
 * Authority seam. Declared, not implemented: submit, ordering, watermark and cutoff behaviour belong
 * to UDG-003 (P03 pending) and UDG-005 (P05 pending), and owner clarification U2-6 forbids an
 * admission or ordering implementation in UDG-002.
 */
export interface MovementAuthority {
  submitMoveTo(request: MoveToRequest): void;
  submitCancel(request: CancelPathRequest): void;
  applyDirectInput(input: { readonly moveX: number; readonly moveZ: number }, stamp: MovementIntentStamp, tick: ServerTick): void;
  advance(tick: ServerTick): void;
}
