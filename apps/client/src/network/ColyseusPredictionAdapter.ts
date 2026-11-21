/**
 * The browser seat: the only place in `@udg/client` that names the pinned `@colyseus/sdk`.
 *
 * ## What this file is
 *
 * Three layers, each usable on its own:
 *
 * 1. **`createSdkSeatTransport`** — the pinned public SDK join: `new Client`, `create<State>` /
 *    `joinById<State>`, the issued-epoch wait against this seat's own replica row, the input
 *    handle, and a state-event subscription. Every public SDK name used here is recorded in
 *    `docs/integration/colyseus-0.18-api-map.md` §12.
 * 2. **`DirectMotionPredictor`** — the seat-side prediction and reconciliation policy this spike
 *    owns: a delivery guard that collects the disposition record (`inputResolvedThrough`, gap,
 *    retirement), the session epoch, the authoritative fields and the SDK acknowledgement from ONE
 *    verified state delivery and freezes them (`evaluateDeliveryGuard`, a pure function); an app
 *    journal of pending inputs that is pruned by `inputResolvedThrough` ONLY — the SDK
 *    acknowledgement is recorded as telemetry and is never a pruning or representation authority
 *    (ADR-0003 §4); and the ADR-0003 §3.2 recovery path (stop sending, discard pending
 *    prediction, hold the last authoritative snapshot, bounded rejoin inside the rolling
 *    allowance and episode deadline, snapshot recovery before any further input, no reissue of
 *    pending identities).
 * 3. **`joinPredictionSeat`** — the production composition of the two, with the checked replica
 *    read surface the paired-seat smoke uses.
 *
 * ## The delivery rule this file enforces
 *
 * `Reconciler.tick` — the pinned SDK's own rewind-and-replay primitive — is called only when the
 * LAST VERIFIED delivery proves both boundaries coincide (`ack === inputResolvedThrough`), on the
 * seat's issued epoch, with a valid revision, no named gap and no retirement. An unequal pair, a
 * missing row or any recovery trigger freezes the predictor instead: the SDK is never asked to
 * reconcile a pair the guard has not matched, and before the first verified delivery there is no
 * reconciler at all to reconcile. While a pair is unequal the seat holds its last valid state and
 * waits only inside the ADR's client-local snapshot deadline; expiry runs the recovery path, not
 * a reconcile. The SDK's internal retirement window is therefore consulted for normal reconcile
 * ONLY after the guard has proved the boundaries coincide on this epoch — and on a compliant
 * stream the spike proves they do, per delivery, in one delivery (this slice's matched-boundary
 * evidence and the retained roundtrip probe's `control_and_adverse_ledgers`).
 *
 * ## Why a declaration-checking exception is mentioned here at all
 *
 * `apps/client/tsconfig.json` carries `skipLibCheck: true` under **ADR-0004**, not ADR-0002 —
 * ADR-0002 is server-only and says so. The measured inventory is pinned in
 * `docs/integration/colyseus-client-declaration-inventory.json` and re-produced by the retained
 * strict check; see `tests/contracts/UDG-SPIKE-001.test.ts`. First-party code keeps full strict
 * checking.
 *
 * ## The rules this file obeys
 *
 * - **Public, documented API only.** No private field, no cast past a declaration, no invented
 *   member. The predictor talks to the SDK through `PredictionTransport`, which the production
 *   composition fills from the joined room; the reconciler primitive itself is the SDK's public
 *   `Reconciler` (api map §13), not a re-implementation — this file contains no predictor of
 *   its own.
 * - **Nothing on the received schema is mutated.** `room.state` is read only; `room.input().data`
 *   is the SDK's own staging object and the only thing written, behind `validateDirectFrame`
 *   (the accepted trust boundary) — an out-of-domain axis, an out-of-range generation or a stale
 *   epoch is refused here, not by the server.
 * - **No credentials.** `room.reconnectionToken` is never read, stored, logged or returned.
 */

import { Client, Reconciler, type InputHandle } from '@colyseus/sdk';
import { validateDirectFrame, type DirectFrame, type MovementMode, type SessionEpoch } from '@udg/protocol';
import { flatDirectStep } from './flatStep.js';
import { stalledAckFloorDecision, resolveStallAckFloorOption, EPISODE_CLOCK_ORIGIN, EPISODE_BASIS_FROM_FIRE, type MeasuredWaitReceipt, type StallAckFloorConfig, type StallAckFloorResolved, type ReceiptValidation } from './stallAckFloor.js';

/** The join presentation the room's hash gate demands (protocol-v1 §6.3; `screenJoin` on the server). */
export interface RegionJoinPresentation {
  readonly protocolVersion: string;
  readonly configHash: string;
  readonly manifestHash: string;
}

/** How the seat reaches a room: create one, or join the one a peer already created. */
export type RegionJoinTarget =
  | { readonly mode: 'create'; readonly roomName: string }
  | { readonly mode: 'byId'; readonly roomId: string };

/** A player row as the pinned server replicates it (`PlayerSchema`), narrowed to what the seat reads. */
export interface RegionReplicaRow {
  readonly entityId: string;
  readonly sessionEpoch: number;
  readonly lastAuthorityTick: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly movementMode: number;
  readonly connected: boolean;
  readonly inputResolvedThrough: number;
  readonly inputGapStart: number;
  readonly inputGapEnd: number;
  readonly inputRetiredUnrepresented: number;
}

/** The region header plus the player map, as replicated (`RegionSchema`). */
export interface RegionReplicaState {
  readonly worldId: string;
  readonly regionId: string;
  readonly serverTick: number;
  readonly protocolVersion: string;
  readonly configHash: string;
  readonly manifestHash: string;
  readonly players: {
    readonly size: number;
    forEach(callback: (row: RegionReplicaRow, key: string) => void): void;
    get(key: string): RegionReplicaRow | undefined;
  };
}

/** One seat's authoritative row, checked. The mode name comes from the uint8 declaration order. */
export interface SeatObservation {
  readonly key: string;
  readonly entityId: string;
  readonly sessionEpoch: SessionEpoch;
  readonly lastAuthorityTick: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly movementMode: number;
  readonly movementModeName: MovementMode;
  readonly connected: boolean;
  readonly inputResolvedThrough: number;
  readonly inputGapStart: number;
  readonly inputGapEnd: number;
  readonly inputRetiredUnrepresented: number;
}

/** Everything one state delivery told the seat. The peer list is the authority's, not the seat's guess. */
export interface RegionSnapshot {
  readonly serverTick: number;
  readonly deliveries: number;
  readonly self: SeatObservation | null;
  readonly peers: readonly SeatObservation[];
  /** Shape problems found while reading: a row that cannot be checked is named here, never dropped. */
  readonly issues: readonly string[];
}

/** The fixed-step facts the server advertised through the join handshake. */
export interface AdvertisedStep {
  readonly tickRate: number | undefined;
  readonly stepMs: number | undefined;
  readonly patchRate: number | undefined;
}

/** A direct movement request from the seat's own input source, before authority stamps are attached. */
export interface DirectMovementRequest {
  readonly generation: number;
  readonly moveX: number;
  readonly moveZ: number;
}

/** A frame the seat put on the wire, as the seat recorded it. */
export interface SentFrame {
  readonly seq: number;
  readonly generation: number;
  readonly frame: DirectFrame;
}

/** The writable staging shape of the room's advertised input schema (`DirectInputSchema`). */
export interface StagedDirectInput {
  sessionEpoch: number;
  generation: number;
  directIntent: boolean;
  moveX: number;
  moveZ: number;
  seq: number;
}

/** The uint8 replica encoding of `MovementMode`, in declaration order (as `to-replica.ts` writes). */
const MOVEMENT_MODE_BY_CODE: Readonly<Record<number, MovementMode>> = { 0: 'idle', 1: 'direct', 2: 'path' };

const ROW_INTEGER_FIELDS = new Set<string>(['sessionEpoch', 'lastAuthorityTick']);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isInteger = (value: unknown): value is number => isFiniteNumber(value) && Number.isInteger(value);

type RowRead = { readonly ok: true; readonly value: SeatObservation } | { readonly ok: false; readonly issue: string };

/** Read one replicated row into a checked observation; a row this module cannot check is reported. */
const readRow = (key: string, row: RegionReplicaRow): RowRead => {
  if (typeof key !== 'string' || key.length === 0) return { ok: false, issue: 'row key is not a non-empty string' };
  if (typeof row !== 'object' || row === null) return { ok: false, issue: `row ${key} is not an object` };
  if (typeof row.entityId !== 'string' || row.entityId.length === 0) return { ok: false, issue: `row ${key} carries no entityId string` };
  for (const field of ['sessionEpoch', 'lastAuthorityTick', 'x', 'y', 'z', 'movementMode'] as const) {
    const value: unknown = row[field];
    const inDomain = ROW_INTEGER_FIELDS.has(field) ? isInteger(value) : isFiniteNumber(value);
    if (!inDomain) return { ok: false, issue: `row ${key} field ${field} is not in domain: ${String(value)}` };
  }
  for (const field of ['inputResolvedThrough', 'inputGapStart', 'inputGapEnd', 'inputRetiredUnrepresented'] as const) {
    const value: unknown = row[field];
    // Disposition records are uint32 bookkeeping: integers, and never negative.
    if (!isInteger(value)) return { ok: false, issue: `row ${key} disposition field ${field} is not a non-negative integer: ${String(value)}` };
    if (value < 0) return { ok: false, issue: `row ${key} disposition field ${field} is not a non-negative integer: ${String(value)}` };
  }
  if (typeof row.connected !== 'boolean') return { ok: false, issue: `row ${key} connected is not a boolean` };
  const modeName = MOVEMENT_MODE_BY_CODE[row.movementMode];
  if (modeName === undefined) {
    return { ok: false, issue: `row ${key} movementMode ${String(row.movementMode)} is outside the declared enum` };
  }
  if (row.sessionEpoch < 1) return { ok: false, issue: `row ${key} sessionEpoch ${String(row.sessionEpoch)} was never issued` };
  return {
    ok: true,
    value: {
      key,
      entityId: row.entityId,
      sessionEpoch: row.sessionEpoch,
      lastAuthorityTick: row.lastAuthorityTick,
      x: row.x,
      y: row.y,
      z: row.z,
      movementMode: row.movementMode,
      movementModeName: modeName,
      connected: row.connected,
      inputResolvedThrough: row.inputResolvedThrough,
      inputGapStart: row.inputGapStart,
      inputGapEnd: row.inputGapEnd,
      inputRetiredUnrepresented: row.inputRetiredUnrepresented,
    },
  };
};

// ─────────────────────────────────────────────────────────────── the shared flat step relation

/** A horizontal pose on the flat plane the spike runs on. */
export interface FlatPose {
  x: number;
  z: number;
}

/**
 * The step relation every consumer on this side shares. The implementation moved to
 * `./flatStep.js` so the client bundle, the browser test pages, the reconciler's step closure, the
 * checkpoint instrumenter, the identity ledger and the AC-1 reference trace all resolve to ONE
 * function (slice 5 review item 1); it is re-exported here under the established name, so the
 * adapter's public surface is unchanged. The live room's `FlatReferenceStepper` remains the
 * production default, untouched; the recorded amendment proposing a single function server-side
 * is `docs/integration/colyseus-0.18-api-map.md` §13.2.
 */
export { flatDirectStep };

// ─────────────────────────────────────────────────────────────── the delivery guard

/** The scalars read from ONE state delivery, before checking. Untrusted by construction. */
export interface RawDeliveryRow {
  readonly epoch: number;
  readonly lastAuthorityTick: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly inputResolvedThrough: number;
  readonly inputGapStart: number;
  readonly inputGapEnd: number;
  readonly inputRetiredUnrepresented: number;
}

/** An accepted delivery: frozen, immutable, and the only thing the predictor trusts about a patch. */
export interface VerifiedDelivery {
  readonly revision: number;
  readonly atMs: number;
  readonly epoch: SessionEpoch;
  readonly authorityTick: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly ack: number;
  readonly resolvedThrough: number;
  readonly gapStart: number;
  readonly gapEnd: number;
  readonly retiredUnrepresented: number;
  readonly sentCount: number;
}

export type GuardReason =
  | 'accepted'
  | 'no-row'
  | 'row-field'
  | 'epoch-mismatch'
  | 'stale-revision'
  | 'retirement-nonzero'
  | 'gap-named'
  | 'ack-ahead-of-resolution'
  | 'ack-behind-resolution';

export interface GuardOutcome {
  readonly ok: boolean;
  readonly reason: GuardReason;
  readonly delivery: VerifiedDelivery | null;
}

/**
 * Check one delivery against the seat's context and freeze it if it passes.
 *
 * The ack and the disposition record MUST arrive from the same delivery — the caller evaluates
 * this synchronously inside the state-change event, so `row` and `ack` are by construction one
 * patch's pair (PR-15 measured that on this room the acknowledgement never moves without a state
 * delivery). The function is pure and total: every failure names itself, and a failure that holds
 * the last valid state (an unequal boundary) is distinguished from a failure that triggers ADR
 * recovery (retirement, named gap, wrong epoch) by the reason code, not by a thrown exception.
 */
export const evaluateDeliveryGuard = (
  raw: Readonly<{ row: RawDeliveryRow | null; ack: number; sentCount: number; revision: number; atMs: number }>,
  context: Readonly<{ issuedEpoch: SessionEpoch; lastRevision: number }>,
): GuardOutcome => {
  if (raw.revision <= context.lastRevision) {
    return { ok: false, reason: 'stale-revision', delivery: null };
  }
  const row = raw.row;
  if (row === null) return { ok: false, reason: 'no-row', delivery: null };
  const integerish = (value: number): boolean => isInteger(value) && value >= 0;
  if (
    !isFiniteNumber(row.x) || !isFiniteNumber(row.y) || !isFiniteNumber(row.z)
    || !integerish(row.epoch) || !integerish(row.lastAuthorityTick)
    || !integerish(row.inputResolvedThrough) || !integerish(row.inputGapStart)
    || !integerish(row.inputGapEnd) || !integerish(row.inputRetiredUnrepresented)
    || !integerish(raw.ack) || !integerish(raw.sentCount)
  ) {
    return { ok: false, reason: 'row-field', delivery: null };
  }
  if (row.epoch !== context.issuedEpoch) {
    return { ok: false, reason: 'epoch-mismatch', delivery: null };
  }
  const delivery: VerifiedDelivery = Object.freeze({
    revision: raw.revision,
    atMs: raw.atMs,
    epoch: row.epoch,
    authorityTick: row.lastAuthorityTick,
    x: row.x,
    y: row.y,
    z: row.z,
    ack: raw.ack,
    resolvedThrough: row.inputResolvedThrough,
    gapStart: row.inputGapStart,
    gapEnd: row.inputGapEnd,
    retiredUnrepresented: row.inputRetiredUnrepresented,
    sentCount: raw.sentCount,
  });
  // Recovery triggers first: these are dispositions, not timing.
  if (row.inputRetiredUnrepresented > 0) return { ok: false, reason: 'retirement-nonzero', delivery };
  if (row.inputGapStart !== 0 || row.inputGapEnd !== 0) return { ok: false, reason: 'gap-named', delivery };
  // Boundary comparison: unequal pairs never reconcile; they hold and wait under the deadline.
  if (raw.ack > row.inputResolvedThrough) return { ok: false, reason: 'ack-ahead-of-resolution', delivery };
  if (raw.ack < row.inputResolvedThrough) return { ok: false, reason: 'ack-behind-resolution', delivery };
  return { ok: true, reason: 'accepted', delivery };
};

// ─────────────────────────────────────────────────────────────── the predictor transport

/** The mirrored state shape the SDK reconciler owns for this seat: the flat plane's two axes. */
export type PredictedMirror = FlatPose;

/** The reconciler surface the predictor uses, as the pinned SDK declares it. */
interface ReconcilerLike {
  tick(now: number): void;
  readonly state: PredictedMirror;
  readonly reconcileSeq: number;
  value(field: 'x' | 'z'): number;
}

/**
 * What the predictor needs from a seat connection. The production implementation is the joined
 * SDK room; unit tests inject a deterministic fake. `rejoin` is present only where the host can
 * actually rejoin (the ADR's bounded-rejoin limb needs it; a host without it suspends instead).
 */
export interface PredictionTransport {
  /** The current domain's server-issued epoch (never a client guess). */
  issuedEpoch(): SessionEpoch;
  /** The seat's own row scalars as the last patch decoded them (untrusted, may be mid-patch). */
  readRow(): RawDeliveryRow | null;
  /** The seat's own decoded row INSTANCE object, which the SDK reconciler mirrors truth from. */
  rowInstance(): object | null;
  /** The replicated region header + player map, as decoded by the last patch (read-only use). */
  readState(): RegionReplicaState | null;
  /** The live input handle (public SDK surface). */
  handle(): InputHandle<StagedDirectInput>;
  /**
   * UDG-SPIKE-001 slice 6c — a pass-through to the pinned SDK's public `room.ping(callback)`
   * (protocol-level `Protocol.PING` frame on THE joined socket; `@colyseus/core@0.18.27` echoes
   * it synchronously via `client.raw(...)`, independent of ticks, patches and room code). The
   * callback fires EXACTLY ONCE when the echo arrives, carrying the SDK's own monotonic-clock
   * latency. Presence contract: OPTIONAL — fake transports may omit it, and nothing in the
   * prediction path calls it; it exists so an RTT probe observes the SAME socket the seat plays
   * on, instead of a parallel echo connection. Diagnostic use only.
   */
  pingLatency?(callback: (ms: number) => void): void;
  /** Subscribe to state deliveries; the callback runs per patch, synchronously with its decode. */
  subscribe(onPatch: () => void): () => void;
  advertised(): AdvertisedStep & { readonly stepSeconds: number | undefined };
  /** Swap in a fresh domain after a host-performed rejoin (new room, new handle, new row). */
  rearm?(next: PredictionTransport): void;
  close(): Promise<void>;
}

/** An armed timer, opaque so hosts can inject deterministic clocks without timer-handle types. */
export interface TimerToken {
  cancel(): void;
}

/** Timers are injected so the ADR deadline/rejoin arithmetic is unit-testable deterministically. */
export interface PredictorClock {
  nowMs(): number;
  setTimer(callback: () => void, ms: number): TimerToken;
}

const wallClock: PredictorClock = {
  nowMs: () => performance.now(),
  setTimer: (callback, ms) => {
    const timer = setTimeout(callback, ms);
    return { cancel: () => clearTimeout(timer) };
  },
};

// ─────────────────────────────────────────────────────────────── the predictor

/** One pending input in the app journal, keyed by the client send sequence it was stamped with. */
export interface PendingInput {
  readonly seq: number;
  readonly epoch: SessionEpoch;
  readonly frame: DirectFrame;
  readonly sentAtMs: number;
}

/** What one `tick()` did, recorded — including the refusals, which ARE the evidence. */
export interface PredictorTickRecord {
  readonly atMs: number;
  readonly action: 'reconciled' | 'skipped' | 'dormant';
  readonly reason: GuardReason | 'no-verified-delivery' | 'missing-advertised-rate';
  readonly revision: number;
  readonly reconcileSeq: number;
  readonly predictedBeforeZ: number;
  readonly predictedAfterZ: number;
  readonly verifiedRowZ: number;
  /** End-pose delta at the last reconcile (diagnostic; see EndPoseDeltaRecord). */
  readonly endPoseDeltaZ: number | null;
  readonly pendingSeqs: readonly number[];
}

/** One accepted delivery paired with the reconcile that adopted it (zero corrections included). */
/**
 * END-POSE DIAGNOSTIC (renamed on review; the name `rawCorrection` overstated it): the difference
 * between the end-of-tick pre-smoothing pose and the adopted row at the last reconcile boundary.
 * It includes the un-acked pending window by construction and is an end-pose-drift diagnostic, NOT
 * a per-ack correction. The per-matched-ack correction is `MatchedAckCorrectionRecord`.
 */
export interface EndPoseDeltaRecord {
  readonly revision: number;
  readonly authorityTick: number;
  readonly epoch: SessionEpoch;
  readonly ack: number;
  readonly resolvedThrough: number;
  readonly atMs: number;
  readonly predictedBeforeX: number;
  readonly predictedBeforeZ: number;
  readonly predictedAfterX: number;
  readonly predictedAfterZ: number;
  readonly authoritativeX: number;
  readonly authoritativeZ: number;
  /** End-pose delta (predicted-before − adopted); includes the pending window. Diagnostic. */
  readonly endPoseDeltaX: number;
  readonly endPoseDeltaZ: number;
  readonly pendingCount: number;
  readonly zero: boolean;
}

/**
 * One matched-ack boundary from the checkpoint instrumenter.
 *
 * For every guard-verified matched delivery whose ack advanced beyond the previous checkpoint, the
 * instrumenter reconstructs the predicted-at-ack pose by replaying the journal frames inside
 * (previousAck, ack] through the SHARED reference step function — the very same `flatDirectStep`
 * module export the SDK reconciler is constructed with, not a duplicate formula — starting from the
 * previously adopted authoritative anchor, then measures `predictedAtAck − authoritative` per axis.
 * This is the real correction for that matched ack: zero exactly when authority consumed every
 * frame the client stepped, and one refused frame's step vector when it did not — exact for turns,
 * diagonals and neutral inputs, which the rejected `pendingCount × step` approximation cannot
 * express. Each matched ack is measured exactly once (the anchor cursor is monotonic); unavailable
 * checkpoints are held/invalidated and never counted as zero.
 */
export interface MatchedAckCorrectionRecord {
  readonly atMs: number;
  readonly authorityTick: number;
  readonly epoch: SessionEpoch;
  readonly ackFrom: number;
  readonly ackTo: number;
  /** Journal sequence numbers inside the covered range (sorted). */
  readonly seqs: readonly number[];
  readonly status: 'anchored' | 'measured' | 'invalidated-missing-frames';
  readonly predictedAtAckX: number;
  readonly predictedAtAckZ: number;
  readonly authoritativeX: number;
  readonly authoritativeZ: number;
  /** Correction (predicted − authoritative); meaningful only when `status === 'measured'`. */
  readonly correctionX: number;
  readonly correctionZ: number;
  readonly magnitude: number;
  /** The rejected approximation, kept ONLY so the negative control can show it disagreeing. */
  readonly legacyPendingApproximationMetres: number;
}

/**
 * Replay-identity ledger. After every reconcile with an adopted delivery: does the raw pose equal
 * `adopted ⊕ Σ step(pending journal frames)` under the shared reference step? A pending frame
 * replayed twice leaves one step of residual; one skipped leaves the negative of a step — so a
 * residual inside 1e-6 m is the identity ledger for “each valid remaining seq replayed exactly
 * once in this window”.
 */
export interface ReplayIdentityRecord {
  readonly reconcileSeq: number;
  readonly atMs: number;
  readonly ack: number;
  readonly pendingSeqs: readonly number[];
  readonly residualX: number;
  readonly residualZ: number;
  readonly maxAbsResidualMetres: number;
}

/**
 * Adoption corroboration record (slice 5 review item 3). One per reconcile that adopted a
 * delivery. The checkpoint ledger alone could not distinguish “the SDK actually adopted this
 * boundary” from “this boundary was reconstructed inside a larger adoption” — under render
 * batching several matched deliveries land between two ticks, and only the LAST adopted state is
 * what `reconcile()` applies. This row is based on real controller behaviour only, read at the
 * public surfaces: the raw pose before the reconcile, the guard-verified pair the SDK adopts, the
 * journal's unresolved tail, and the checkpoint rows inside the adoption span. The conservation
 * equation
 *   (rawBefore − adopted) − Σ step(unresolved seqs > adoptedAck) − Σ attributed corrections == 0
 * says the ACTUAL distance the controller moved at this adoption equals the corrections the
 * checkpoint ledger attributes to the boundaries it covered — a hypothesis rebased on an
 * unapplied delivery could not satisfy it. Instrumentation reads state; it never writes it.
 */
export interface AdoptionRecord {
  readonly reconcileSeq: number;
  readonly atMs: number;
  readonly epoch: SessionEpoch;
  readonly authorityTick: number;
  readonly adoptedAck: number;
  readonly prevAdoptedAck: number;
  /** Boundary rows the adoption span covers, in ack order, each flagged direct vs reconstructed. */
  readonly boundaries: readonly AdoptionBoundaryRecord[];
  /** Every ack from prevAdoptedAck to adoptedAck is chained by MEASURED boundaries — false fails the metric. */
  readonly coverageComplete: boolean;
  readonly attributedX: number;
  readonly attributedZ: number;
  readonly unresolvedSteppedX: number;
  readonly unresolvedSteppedZ: number;
  /** rawBefore − adopted: the actual pose change this adoption applied. */
  readonly actualAdoptionDeltaX: number;
  readonly actualAdoptionDeltaZ: number;
  readonly residualX: number;
  readonly residualZ: number;
  readonly maxAbsResidualMetres: number;
}

/** One checkpoint boundary inside an adoption: directly adopted iff its ackTo is the adopted ack. */
export interface AdoptionBoundaryRecord {
  readonly ackFrom: number;
  readonly ackTo: number;
  readonly status: MatchedAckCorrectionRecord['status'];
  readonly correctionX: number;
  readonly correctionZ: number;
  /** True when THIS boundary is the state the SDK adopted this reconcile; false = reconstructed. */
  readonly directlyAdopted: boolean;
}

/** The recovery ledger: every trigger, stop, discard, rejoin attempt and suspension, in order. */
export interface RecoveryRecord {
  readonly atMs: number;
  readonly event: 'trigger' | 'stop-sending' | 'discard-pending' | 'rejoin-scheduled' | 'rejoin-attempt'
    | 'rejoin-complete' | 'snapshot-recovered' | 'suspended' | 'episode-expired' | 'send-refused'
    | 'stall-floor-held';
  readonly detail: string;
}

export type PredictorState = 'dormant' | 'tracking' | 'waiting-boundary' | 'recovering' | 'suspended' | 'closed';

/** The resolved settings the predictor runs with (defaults applied). */
interface PredictorSettings {
  readonly speed: number;
  readonly snapshotDeadlineMs: number;
  readonly recoveryDeadlineMs: number;
  readonly rejoinWindowMs: number;
  readonly maxRejoinsPerWindow: number;
  readonly rejoinBackoffMs: readonly number[];
  readonly stallDetectionDeliveries: number;
  /** Resolved stalled-ack opportunity-wait opt-in (null = provisional count-only default); see
   * PredictorOptions.stallAckFloor. */
  readonly stallFloor: StallAckFloorResolved | null;
  readonly measuredWaitRoomId: string | null;
  readonly clock: PredictorClock;
  readonly ledgerLimit: number;
  readonly rejoin?: (() => Promise<PredictionTransport>) | undefined;
}

/** Slice 29: what one APPLIED measured-receipt episode actually measured, versus what the receipt
 * DECLARED — reported only, proving nothing, enabling nothing. When the origins/bases do not match
 * the entry says REPORTING-ONLY and carries no within/over wording (an unnormalized cross-basis
 * comparison must never be presentable as an applied validation). */
export interface StallFloorEpisodeReconciliation {
  readonly actualEpisodeMs: number;
  readonly measurementClockOrigin: string;
  readonly measurementBasis: string;
  readonly declaredBudgetMs: number;
  readonly declaredBudgetClockOrigin: string;
  readonly declaredBudgetBasis: string;
  readonly validation: 'compared-on-matching-origins' | 'reporting-only-basis-mismatch';
  readonly verdict: 'within-declared-budget' | 'exceeded-declared-budget' | 'not-compared-basis-mismatch';
  readonly note: string;
}

export interface PredictorOptions {
  /** The room's movement speed — the same `speed` the authority steps with. */
  readonly speed: number;
  /** ADR-0003 §3.2 test settings as adopted; defaults are the accepted provisional values. */
  readonly snapshotDeadlineMs?: number;
  readonly recoveryDeadlineMs?: number;
  readonly rejoinWindowMs?: number;
  readonly maxRejoinsPerWindow?: number;
  readonly rejoinBackoffMs?: readonly number[];
  /**
   * `G` of the §3.2 stalled-acknowledgement rule — the SAME named field the spec config owns
   * (`input.stallDetectionDeliveries`, packages/config/src/input.ts; default 3 there). An
   * outstanding input whose ack AND inputResolvedThrough advance NEITHER across G consecutive
   * state deliveries, epoch unchanged, fires `input-ack-stalled` — the only client-side recourse
   * for a loss the server cannot name (ADR-0003 §3.2, GA-5b's recovery half).
   */
  readonly stallDetectionDeliveries?: number;
  /**
   * SLICE-28 (plan §21 / ADR-0005: the §D wait-first rule is adopted AS DESIGN; the SHIPPED
   * DEFAULT stays the provisional count-only rule until an implementation adoption changes it).
   * The configurable acknowledgement-opportunity WAIT opt-in: undefined/null (the default
   * EVERYWHERE) keeps the count-only rule byte-identical — the client NEVER silently selects a
   * wait value. Supplying a number keeps the legacy harness path (labelled in every ledger event);
   * supplying a config object requires a provenanced measured wait and optionally a matched
   * recovery budget that must at least cover the wait (fuller detection+recovery coverage needs
   * real-environment measurement — declared budgets are always labelled
   * `declared-matched-not-independently-verified`). INVALID OPT-INS FAIL CLOSED HERE, at
   * construction: the seat never exists; nothing degrades silently. The wait gates ONLY the
   * stalled-ack trigger; snapshot/episode/cap timers keep their own origins and still own truly
   * missing deliveries; NO timed server activity is required or assumed. See
   * apps/client/src/network/stallAckFloor.ts.
   */
  readonly stallAckFloor?: number | StallAckFloorConfig | MeasuredWaitReceipt | null;
  /** Measured-receipt scope binding (slice 29): the ACTUAL room identity, supplied by the join
   * route (or bindMeasuredWaitScope for hosts that construct predictors directly). A receipt with
   * no bound room stays explicitly ineligible — never applied against a guessed ID. */
  readonly measuredWaitRoomId?: string | null;
  /** @deprecated Legacy numeric form of `stallAckFloor` (harness diagnostics). Mutually exclusive
   * with it; supplying both fails closed. */
  readonly stallAckFloorMs?: number | null;
  readonly clock?: PredictorClock;
  /** A host-performed rejoin: leave + fresh join + issued-epoch wait, returning a rearmed transport. */
  readonly rejoin?: () => Promise<PredictionTransport>;
  /** Delivery/reconcile ledgers are bounded; the limit is recorded when trimming. */
  readonly ledgerLimit?: number;
}

/**
 * Seat-side prediction and reconciliation over the SDK's public `Reconciler`, gated by the
 * delivery guard. No prediction math lives here: the predictor OWNS policy (what may reconcile,
 * what may prune, when to stop, when to rejoin) and delegates every step to the SDK primitive and
 * the shared `flatDirectStep` relation.
 */
export class DirectMotionPredictor {
  private readonly options: PredictorSettings;
  private transport: PredictionTransport;
  private reconciler: ReconcilerLike | null = null;
  private missingRateReported = false;

  private unsubscribe: (() => void) | null = null;
  private revision = 0;
  private lastAccepted: VerifiedDelivery | null = null;
  private lastOutcome: GuardOutcome | null = null;

  private readonly pending = new Map<number, PendingInput>();
  private readonly deliveriesLog: { readonly delivery: VerifiedDelivery; readonly accepted: boolean; readonly reason: GuardReason }[] = [];
  private readonly ticks: PredictorTickRecord[] = [];
  private readonly corrections: EndPoseDeltaRecord[] = [];
  private readonly matchedRecords: MatchedAckCorrectionRecord[] = [];
  private readonly replayIdentity: ReplayIdentityRecord[] = [];
  private readonly recovery: RecoveryRecord[] = [];
  private readonly sentFrames: { readonly seq: number; readonly epoch: SessionEpoch; readonly atMs: number }[] = [];

  private state: PredictorState = 'dormant';
  private sendingStopped = false;
  private snapshotReady = false;
  /**
   * Domain quarantine (review P1): the epoch of the transport currently attached, the epoch whose
   * room was quarantined at recovery entry, and the quarantine flag itself. While recovering, the
   * old transport is UNSUBSCRIBED and CLOSED at the trigger, and the accepting branch additionally
   * refuses to complete recovery from any delivery carrying the quarantined epoch: recovery ends
   * only through an explicit successful transport replacement whose fresh snapshot arrives.
   */
  private domainEpoch: SessionEpoch | null = null;
  private recoveryEpoch: SessionEpoch | null = null;
  private quarantined = false;
  /** Checkpoint instrumenter anchor: last adopted truth at a measured ack boundary. */
  private anchor: { readonly epoch: SessionEpoch; readonly ack: number; readonly x: number; readonly z: number } | null = null;
  private matchedInstrumentCounters = { measured: 0, zero: 0, anchored: 0, invalidated: 0, nonAdvancingDeliveries: 0, adoptions: 0, adoptionCoverageIncomplete: 0 };
  private readonly adoptionRecords: AdoptionRecord[] = [];
  private lastAdoptedAck = 0;
  private lastAdoptedEpoch: SessionEpoch | null = null;
  private reconcileSeqCounter = 0;
  /** Advertised fixed step in seconds, captured when the reconciler was armed (instrumenter dt). */
  private advertisedStepSeconds: number | null = null;
  private deadlineHandle: TimerToken | null = null;
  /** §3.2 stalled-ack observation: the last delivery's (ack, resolvedThrough, epoch) boundary
   * and how many CONSECUTIVE deliveries have left it unmoved while inputs are outstanding. */
  private stallStreak = 0;
  private stallBoundary: { readonly ack: number; readonly resolvedThrough: number; readonly epoch: number } | null = null;
  /** Slice 29 (measured-config path): the applied receipt episode and its reconciliation entry.
   * The bound room identity lives in options.measuredWaitRoomId / boundRoomId — set only by the
   * join route or bindMeasuredWaitScope, never guessed. */
  private stallEpisode: { readonly firedAtMs: number; readonly settledAtMs: number | null } | null = null;
  private receiptReconciliation: StallFloorEpisodeReconciliation | null = null;
  private recoveryStartedAt: number | null = null;
  private episodeExpired = false;
  /**
   * INDEPENDENT per-episode hard deadline (ADR-0003 §3.2; director finding S1b): armed at
   * episode start and NOT gated by `await rejoin()` settling or any future state event. A
   * route that never returns — a join whose handshake is withheld — can no longer starve
   * the deadline: the 500 ms snapshot timer's re-checks ride a timer that a hung attempt
   * leaves unarmed, which is exactly how S1b stayed 'recovering' for 40 s.
   */
  private episodeTimer: TimerToken | null = null;
  private connectionErrorInfo: { readonly code: string; readonly message: string; readonly atMs: number } | null = null;
  private suspensionReasonInfo: 'episode-deadline' | 'rolling-window' | null = null;
  private readonly rejoinAts: number[] = [];
  private rejoinInFlight = false;
  private trimReports = 0;

  private readonly pruneAuthority = {
    byResolvedThrough: 0,
    // Proven to stay 0 by the suite's negative control: pruning by the SDK watermark is not a
    // path this class has — the counter exists so the invariant is observable, not assumed.
    byAckWatermark: 0,
  };

  private onSendUnsub: (() => void) | null = null;

  constructor(transport: PredictionTransport, options: PredictorOptions) {
    this.transport = transport;
    // FAIL CLOSED at the config-validation stage: an opt-in that is malformed, unprovenanced or
    // internally incoherent throws BEFORE the seat exists; absent options keep the provisional
    // count-only default and NO wait value is ever selected silently.
    const suppliedFloor = options.stallAckFloor ?? null;
    const legacyFloor = options.stallAckFloorMs ?? null;
    if (suppliedFloor !== null && legacyFloor !== null) {
      throw new Error('stallAckFloor and the deprecated stallAckFloorMs are mutually exclusive (fail closed): supply exactly one config surface');
    }
    const floorSource = suppliedFloor !== null ? suppliedFloor : legacyFloor;
    let stallFloor: StallAckFloorResolved | null = null;
    if (floorSource !== null) {
      const resolved = resolveStallAckFloorOption(floorSource);
      if (!resolved.ok) throw new Error(`stallAckFloor opt-in refused at config validation (fail closed): ${resolved.reasons.join('; ')}`);
      stallFloor = resolved;
    }
    this.options = {
      speed: options.speed,
      snapshotDeadlineMs: options.snapshotDeadlineMs ?? 500,
      recoveryDeadlineMs: options.recoveryDeadlineMs ?? 4000,
      rejoinWindowMs: options.rejoinWindowMs ?? 60_000,
      maxRejoinsPerWindow: options.maxRejoinsPerWindow ?? 2,
      rejoinBackoffMs: options.rejoinBackoffMs ?? [250, 500, 1000],
      // Mirrors INPUT_ENVELOPE_DEFAULTS.stallDetectionDeliveries (packages/config) — the scenario
      // wiring passes the config value explicitly; this default keeps standalone users coherent.
      stallDetectionDeliveries: options.stallDetectionDeliveries ?? 3,
      // Provisional default OFF: null keeps the shipped count-only §3.2 behaviour exactly — no
      // local wait is substituted. An opt-in arrives via stallAckFloor(-Ms) and is resolved
      // (validated, fail closed) above.
      stallFloor,
      measuredWaitRoomId: options.measuredWaitRoomId ?? null,
      clock: options.clock ?? wallClock,
      ledgerLimit: options.ledgerLimit ?? 512,
      ...(options.rejoin === undefined ? {} : { rejoin: options.rejoin }),
    };
  }

  /** Start observing the transport. Idempotent. */
  attach(): void {
    if (this.unsubscribe !== null) return;
    this.domainEpoch = this.transport.issuedEpoch();
    const handlePatch = (): void => this.evaluatePatch();
    this.unsubscribe = this.transport.subscribe(handlePatch);
    this.onSendUnsub = this.transport.handle().onSend((seq) => this.observeSend(seq));
    // The first patch may already have been delivered (the join waited for the issued-epoch row).
    this.evaluatePatch();
  }

  detach(): void {
    this.unsubscribe?.();
    this.onSendUnsub?.();
    this.unsubscribe = null;
    this.onSendUnsub = null;
    this.cancelDeadline();
  }

  /**
   * One render-frame tick. The SDK reconciler is driven ONLY through here, and only when the
   * guard's last outcome was a matched, verified pair on the issued epoch. Every refusal
   * records itself, so "the SDK cannot auto-reconcile an unvalidated delivery" is an observable
   * ledger (`ticks` with action 'skipped'/'dormant'), not a claim.
   */
  tick(now: number): void {
    if (this.state === 'closed') return;
    const outcome = this.lastOutcome;
    if (this.state === 'recovering' || this.state === 'suspended' || outcome === null || !outcome.ok) {
      this.push(this.ticks, {
        atMs: now,
        action: this.reconciler === null ? 'dormant' : 'skipped',
        reason: outcome?.reason ?? 'no-verified-delivery',
        revision: outcome?.delivery?.revision ?? this.lastAccepted?.revision ?? 0,
        reconcileSeq: this.reconciler?.reconcileSeq ?? 0,
        predictedBeforeZ: this.reconciler?.state.z ?? Number.NaN,
        predictedAfterZ: this.reconciler?.state.z ?? Number.NaN,
        verifiedRowZ: this.lastAccepted?.z ?? Number.NaN,
        endPoseDeltaZ: null,
        pendingSeqs: [...this.pending.keys()],
      });
      return;
    }
    if (this.reconciler === null) {
      const armed = this.ensureReconciler();
      if (armed === null) {
        // Advertised rate or row instance missing: the predictor refuses instead of guessing a dt.
        this.push(this.ticks, {
          atMs: now,
          action: 'dormant',
          reason: 'missing-advertised-rate',
          revision: outcome.delivery?.revision ?? 0,
          reconcileSeq: 0,
          predictedBeforeZ: Number.NaN,
          predictedAfterZ: Number.NaN,
          verifiedRowZ: outcome.delivery?.z ?? Number.NaN,
          endPoseDeltaZ: null,
          pendingSeqs: [...this.pending.keys()],
        });
        return;
      }
    }
    const reconciler = this.reconciler;
    if (reconciler === null) return;
    const verified = outcome.delivery;
    if (verified === null) return;
    const beforeX = reconciler.state.x;
    const beforeZ = reconciler.state.z;
    const seqBefore = reconciler.reconcileSeq;
    reconciler.tick(now);
    const delta = reconciler.reconcileSeq - seqBefore;
    if (delta > 0) {
      this.reconcileSeqCounter += 1;
      const afterX = reconciler.state.x;
      const afterZ = reconciler.state.z;
      const deltaX = beforeX - verified.x;
      const deltaZ = beforeZ - verified.z;
      this.push(this.corrections, {
        revision: verified.revision,
        authorityTick: verified.authorityTick,
        epoch: verified.epoch,
        ack: verified.ack,
        resolvedThrough: verified.resolvedThrough,
        atMs: now,
        predictedBeforeX: beforeX,
        predictedBeforeZ: beforeZ,
        predictedAfterX: afterX,
        predictedAfterZ: afterZ,
        authoritativeX: verified.x,
        authoritativeZ: verified.z,
        endPoseDeltaX: deltaX,
        endPoseDeltaZ: deltaZ,
        pendingCount: this.pendingCountAt(verified),
        // A 200-step float64 accumulate carries ~1e-14 of drift, so "zero" means "inside float
        // drift", not "bitwise" — an order of magnitude below the 1e-6 m criterion it feeds.
        zero: Math.abs(deltaX) < 1e-9 && Math.abs(deltaZ) < 1e-9,
      });
      // Replay-identity ledger: raw-after must equal adopted ⊕ Σ step(pending) under the SHARED
      // reference step function. A double replay or a skipped replay leaves a step of residual.
      const dt = this.instrumentDt();
      if (dt !== null) {
        const pendingFrames = this.journalFrames(0, Number.MAX_SAFE_INTEGER);
        let expected = { x: verified.x, z: verified.z };
        for (const frame of pendingFrames) {
          expected = flatDirectStep(expected, { moveX: frame.frame.moveX, moveZ: frame.frame.moveZ }, dt, this.options.speed);
        }
        this.push(this.replayIdentity, {
          reconcileSeq: this.reconcileSeqCounter,
          atMs: now,
          ack: verified.ack,
          pendingSeqs: pendingFrames.map((frame) => frame.seq),
          residualX: afterX - expected.x,
          residualZ: afterZ - expected.z,
          maxAbsResidualMetres: Math.max(Math.abs(afterX - expected.x), Math.abs(afterZ - expected.z)),
        });
      }
      // Adoption corroboration (slice 5 review item 3): tie THIS adoption — the actual state
      // change the SDK just applied — to the checkpoint boundaries it covered, from real
      // controller behaviour read at public surfaces only. The conservation residual is zero
      // exactly when the corrections attributed to covered boundaries explain the ACTUAL
      // movement; a checkpoint rebased on a delivery the SDK never applied could not satisfy it.
      if (this.lastAdoptedEpoch !== verified.epoch) {
        this.lastAdoptedEpoch = verified.epoch;
        this.lastAdoptedAck = 0;
      }
      const coveredRows = this.matchedRecords.filter(
        (row) => row.epoch === verified.epoch && row.ackTo > this.lastAdoptedAck && row.ackTo <= verified.ack,
      );
      const boundaries = coveredRows.map((row) => ({
        ackFrom: row.ackFrom,
        ackTo: row.ackTo,
        status: row.status,
        correctionX: row.status === 'invalidated-missing-frames' ? 0 : row.correctionX,
        correctionZ: row.status === 'invalidated-missing-frames' ? 0 : row.correctionZ,
        directlyAdopted: row.ackTo === verified.ack,
      }));
      let chainCursor = this.lastAdoptedAck;
      let chainComplete = true;
      for (const boundary of boundaries) {
        if (boundary.ackFrom !== chainCursor || boundary.status === 'invalidated-missing-frames') {
          chainComplete = false;
        }
        chainCursor = boundary.ackTo;
      }
      if (chainCursor !== verified.ack) chainComplete = false;
      let attributedX = 0;
      let attributedZ = 0;
      for (const row of coveredRows) {
        if (row.status === 'invalidated-missing-frames') continue; // failed boundary: coverage says so
        attributedX += row.correctionX;
        attributedZ += row.correctionZ;
      }
      let unresolved = { x: 0, z: 0 };
      if (dt !== null) {
        // Seqs past the adopted ack that the raw prediction has already stepped, composed with the
        // SAME shared function the reconciler steps with — no second formula here either.
        for (const frame of this.journalFrames(verified.ack, Number.MAX_SAFE_INTEGER)) {
          unresolved = flatDirectStep(unresolved, { moveX: frame.frame.moveX, moveZ: frame.frame.moveZ }, dt, this.options.speed);
        }
      }
      const actualAdoptionX = beforeX - verified.x;
      const actualAdoptionZ = beforeZ - verified.z;
      const adoptionResidualX = actualAdoptionX - unresolved.x - attributedX;
      const adoptionResidualZ = actualAdoptionZ - unresolved.z - attributedZ;
      this.matchedInstrumentCounters.adoptions += 1;
      if (!chainComplete) this.matchedInstrumentCounters.adoptionCoverageIncomplete += 1;
      this.push(this.adoptionRecords, {
        reconcileSeq: this.reconcileSeqCounter,
        atMs: now,
        epoch: verified.epoch,
        authorityTick: verified.authorityTick,
        adoptedAck: verified.ack,
        prevAdoptedAck: this.lastAdoptedAck,
        boundaries,
        coverageComplete: chainComplete,
        attributedX,
        attributedZ,
        unresolvedSteppedX: unresolved.x,
        unresolvedSteppedZ: unresolved.z,
        actualAdoptionDeltaX: actualAdoptionX,
        actualAdoptionDeltaZ: actualAdoptionZ,
        residualX: adoptionResidualX,
        residualZ: adoptionResidualZ,
        maxAbsResidualMetres: Math.max(Math.abs(adoptionResidualX), Math.abs(adoptionResidualZ)),
      });
      this.lastAdoptedAck = verified.ack;
    }
    this.push(this.ticks, {
      atMs: now,
      action: 'reconciled',
      reason: 'accepted',
      revision: verified.revision,
      reconcileSeq: reconciler.reconcileSeq,
      predictedBeforeZ: beforeZ,
      predictedAfterZ: reconciler.state.z,
      verifiedRowZ: verified.z,
      endPoseDeltaZ: this.corrections.length > 0 ? (this.corrections[this.corrections.length - 1]?.endPoseDeltaZ ?? null) : null,
      pendingSeqs: [...this.pending.keys()],
    });
  }

  /** The advertised fixed step, read eagerly so measurement does not wait on the reconciler. */
  private instrumentDt(): number | null {
    if (this.advertisedStepSeconds !== null) return this.advertisedStepSeconds;
    const advertised = this.transport.advertised();
    const seconds = advertised.stepSeconds ?? (advertised.tickRate === undefined ? undefined : 1 / advertised.tickRate);
    if (seconds === undefined) return null;
    this.advertisedStepSeconds = seconds;
    return seconds;
  }

  /** Journal frames with `fromExclusive < seq <= toInclusive`, oldest first. */
  private journalFrames(fromExclusive: number, toInclusive: number): PendingInput[] {
    const frames: PendingInput[] = [];
    for (const [seq, entry] of this.pending.entries()) {
      if (seq > fromExclusive && seq <= toInclusive) frames.push(entry);
    }
    return frames.sort((a, b) => a.seq - b.seq);
  }

  /**
   * The checkpoint instrumenter (review item 2). Measurement only — it never feeds predictor state.
   * The predicted-at-ack pose is reconstructed with the SHARED reference step function (the same
   * `flatDirectStep` export the SDK reconciler steps with), from the previously adopted
   * authoritative anchor. Unavailable checkpoints are recorded as invalidated and the anchor is
   * HELD — never advanced, never counted as zero.
   */
  private captureAckCheckpoint(delivery: VerifiedDelivery): void {
    const dt = this.instrumentDt();
    if (dt === null) return; // instrumenter unavailable until the room advertises its fixed step
    if (this.anchor !== null && this.anchor.epoch !== delivery.epoch) this.anchor = null;
    const base = {
      atMs: delivery.atMs,
      authorityTick: delivery.authorityTick,
      epoch: delivery.epoch,
      authoritativeX: delivery.x,
      authoritativeZ: delivery.z,
    };
    if (this.anchor === null) {
      this.anchor = { epoch: delivery.epoch, ack: delivery.ack, x: delivery.x, z: delivery.z };
      this.matchedInstrumentCounters.anchored += 1;
      this.push(this.matchedRecords, {
        ...base,
        ackFrom: 0,
        ackTo: delivery.ack,
        seqs: [],
        status: 'anchored',
        predictedAtAckX: delivery.x,
        predictedAtAckZ: delivery.z,
        correctionX: 0,
        correctionZ: 0,
        magnitude: 0,
        legacyPendingApproximationMetres: this.pendingCountAt(delivery) * this.options.speed * dt,
      });
      return;
    }
    if (delivery.ack <= this.anchor.ack) {
      // A matched delivery that advances nothing is the SDK's early-out regime: no eligible ack
      // boundary, so no checkpoint — recorded as a counter, never as a zero correction.
      this.matchedInstrumentCounters.nonAdvancingDeliveries += 1;
      return;
    }
    const frames = this.journalFrames(this.anchor.ack, delivery.ack);
    const covered = delivery.ack - this.anchor.ack;
    if (frames.length !== covered) {
      // A journal frame inside the covered range is not observable (evicted, or the range spans a
      // domain the journal never held): the checkpoint is INVALID, never zero, and the anchor is
      // held so no later boundary is measured against a false base.
      this.matchedInstrumentCounters.invalidated += 1;
      this.push(this.matchedRecords, {
        ...base,
        ackFrom: this.anchor.ack,
        ackTo: delivery.ack,
        seqs: frames.map((frame) => frame.seq),
        status: 'invalidated-missing-frames',
        predictedAtAckX: Number.NaN,
        predictedAtAckZ: Number.NaN,
        correctionX: Number.NaN,
        correctionZ: Number.NaN,
        magnitude: Number.NaN,
        legacyPendingApproximationMetres: this.pendingCountAt(delivery) * this.options.speed * dt,
      });
      return;
    }
    let predictedX = this.anchor.x;
    let predictedZ = this.anchor.z;
    for (const frame of frames) {
      const stepped = flatDirectStep({ x: predictedX, z: predictedZ }, { moveX: frame.frame.moveX, moveZ: frame.frame.moveZ }, dt, this.options.speed);
      predictedX = stepped.x;
      predictedZ = stepped.z;
    }
    const correctionX = predictedX - delivery.x;
    const correctionZ = predictedZ - delivery.z;
    this.matchedInstrumentCounters.measured += 1;
    if (Math.abs(correctionX) < 1e-9 && Math.abs(correctionZ) < 1e-9) this.matchedInstrumentCounters.zero += 1;
    this.push(this.matchedRecords, {
      ...base,
      ackFrom: this.anchor.ack,
      ackTo: delivery.ack,
      seqs: frames.map((frame) => frame.seq),
      status: 'measured',
      predictedAtAckX: predictedX,
      predictedAtAckZ: predictedZ,
      correctionX,
      correctionZ,
      magnitude: Math.hypot(correctionX, correctionZ),
      legacyPendingApproximationMetres: frames.length * this.options.speed * dt,
    });
    this.anchor = { epoch: delivery.epoch, ack: delivery.ack, x: delivery.x, z: delivery.z };
  }

  /** The one staging/send path: refuses locally, and refuses whenever the ADR says stop sending. */
  send(request: DirectMovementRequest, directIntent: boolean): SentFrame {
    if (this.state === 'closed') throw new Error('the seat is closed and sends nothing');
    if (this.sendingStopped || this.state === 'recovering' || this.state === 'suspended') {
      this.recordRecovery('send-refused', 'stop-sending is in effect (ADR-0003 §3.2)');
      throw new Error('sending is stopped: ADR-0003 recovery is in effect');
    }
    if (!this.snapshotReady) throw new Error('no verified snapshot yet: input waits for the authoritative snapshot');
    const epoch = this.transport.issuedEpoch();
    const verdict = validateDirectFrame(
      {
        sessionEpoch: epoch,
        generation: request.generation,
        directIntent,
        moveX: request.moveX,
        moveZ: request.moveZ,
      },
      { sessionEpoch: epoch },
    );
    if (verdict.ok === false) throw new Error(`frame refused locally: ${verdict.code}`);
    const handle = this.transport.handle();
    const expectedSeq = handle.sentCount + 1;
    handle.data.sessionEpoch = epoch;
    handle.data.generation = verdict.value.generation;
    handle.data.directIntent = verdict.value.directIntent;
    handle.data.moveX = verdict.value.moveX;
    handle.data.moveZ = verdict.value.moveZ;
    handle.data.seq = expectedSeq;
    const seq = handle.send();
    return { seq, generation: verdict.value.generation, frame: verdict.value };
  }

  // --- Readers (every ledger is a defensive copy; nothing here grants write access) --------------

  /** Canonical is the server's; a seat never holds it. The distinctness is structural, not naming. */
  canonical(): null { return null; }
  /** The last verified delivery's authoritative row values, frozen with their revision. */
  replicated(): VerifiedDelivery | null { return this.lastAccepted; }
  /** The raw predicted pose (the SDK reconciler's own step state), copied. */
  rawPredicted(): FlatPose | null {
    return this.reconciler === null ? null : { x: this.reconciler.state.x, z: this.reconciler.state.z };
  }
  /** The render read: the SDK's interpolated/corrected presentation. Display smoothing lives here. */
  presentation(): FlatPose | null {
    return this.reconciler === null
      ? null
      : { x: this.reconciler.value('x'), z: this.reconciler.value('z') };
  }
  /** While recovering: the last VERIFIED pose, frozen — the §3.2 "hold the last authoritative snapshot". */
  heldSnapshot(): FlatPose | null {
    return this.lastAccepted === null ? null : { x: this.lastAccepted.x, z: this.lastAccepted.z };
  }

  stateName(): PredictorState { return this.state; }
  recoveryEpisodeExpiredFlag(): boolean { return this.episodeExpired; }
  /**
   * The §3.2 surfaced connection error — non-null exactly when the recovery EPISODE expired
   * (rolling-window suspensions never set it: the two limits have distinct semantics and the
   * ADR says whichever is reached first wins). Read-only surface; nothing resets it.
   */
  connectionError(): { readonly code: string; readonly message: string; readonly atMs: number } | null {
    return this.connectionErrorInfo;
  }
  /** Which §3.2 limit suspended the seat — 'episode-deadline' or 'rolling-window'; distinct, never conflated. */
  suspensionReason(): 'episode-deadline' | 'rolling-window' | null { return this.suspensionReasonInfo; }
  snapshotReadyForInput(): boolean { return this.snapshotReady; }
  pendingJournal(): readonly PendingInput[] { return [...this.pending.values()]; }
  deliveryLedger(): typeof this.deliveriesLog { return [...this.deliveriesLog]; }
  tickLedger(): readonly PredictorTickRecord[] { return [...this.ticks]; }
  /** End-pose diagnostic (renamed from `correctionLedger` on review — it is NOT a per-ack metric). */
  endPoseDiagnostics(): readonly EndPoseDeltaRecord[] { return [...this.corrections]; }
  /** The per-matched-ack correction ledger from the checkpoint instrumenter. */
  matchedCorrections(): readonly MatchedAckCorrectionRecord[] { return [...this.matchedRecords]; }
  /** Replay-identity ledger: adopted ⊕ Σ step(pending) − raw, per reconcile. */
  replayIdentityLedger(): readonly ReplayIdentityRecord[] { return [...this.replayIdentity]; }
  matchedInstrumentStats(): typeof this.matchedInstrumentCounters { return { ...this.matchedInstrumentCounters }; }
  /** Adoption corroboration ledger (slice 5 review item 3), defensive copy. */
  adoptionLedger(): readonly AdoptionRecord[] { return [...this.adoptionRecords]; }
  recoveryLedger(): readonly RecoveryRecord[] { return [...this.recovery]; }
  sentAudit(): readonly { readonly seq: number; readonly epoch: SessionEpoch; readonly atMs: number }[] { return [...this.sentFrames]; }
  pruneAuthorityLedger(): typeof this.pruneAuthority { return { ...this.pruneAuthority }; }
  rejoinTimestamps(): readonly number[] { return [...this.rejoinAts]; }

  /** HONEST status of the §D-design opt-in (plan §21): the shipped DEFAULT is the provisional
   * count-only rule and this surface never claims production enablement. A configured seat
   * reports its wait, provenance, budget status, DECLARED clock origin and a stale-epoch flag
   * instead of silent assumptions; a default seat says explicitly that no value was selected.
   * A measured-receipt seat additionally reports its scope state (bound room, live scope issue,
   * machine validation of the recorded durations) and the last episode reconciliation. */
  stallAckFloorStatus():
    | { readonly state: 'default-provisional-count-only'; readonly note: string }
    | { readonly state: 'configured'; readonly source: 'config-object' | 'legacy-numeric' | 'measured-receipt'; readonly waitMs: number; readonly provenance: string; readonly matchedBudgetMs: number | null; readonly budgetStatus: 'declared-matched-not-independently-verified' | 'not-declared' | 'machine-validated-recorded-durations-not-production-enabled'; readonly appliedEpoch: number | null; readonly clockOrigin: string; readonly staleForCurrentEpoch: boolean; readonly roomScope: string | null; readonly boundRoomId: string | null; readonly scopeIssue: string | null; readonly receiptValidation: ReceiptValidation | null; readonly episodeReconciliation: StallFloorEpisodeReconciliation | null } {
    const floor = this.options.stallFloor;
    if (floor === null) {
      return { state: 'default-provisional-count-only', note: 'no wait supplied; the product default remains the provisional adopted count-only rule — no local value is silently selected' };
    }
    const currentEpoch = this.stallBoundary?.epoch ?? null;
    return {
      state: 'configured', source: floor.source, waitMs: floor.waitMs, provenance: floor.provenance,
      matchedBudgetMs: floor.matchedBudgetMs, budgetStatus: floor.budgetStatus,
      appliedEpoch: floor.appliedEpoch, clockOrigin: floor.clockOrigin,
      staleForCurrentEpoch: floor.appliedEpoch !== null && currentEpoch !== null && floor.appliedEpoch !== currentEpoch,
      roomScope: floor.roomScope, boundRoomId: this.effectiveMeasuredRoomId(),
      scopeIssue: floor.source === 'measured-receipt' ? this.measuredReceiptScopeIssue(currentEpoch) : null,
      receiptValidation: floor.receiptValidation,
      episodeReconciliation: this.receiptReconciliation,
    };
  }

  /** The only supported room-identity binding for a measured receipt (slice 29): hosts that build
   * a predictor directly (no join route to supply the real id) bind the ACTUAL joined room id
   * here. First bind wins; rebinding to a different id throws — a measured profile is never
   * silently re-scoped. There is no wildcard, no default and no guessing. */
  bindMeasuredWaitScope(roomId: string): void {
    const floor = this.options.stallFloor;
    if (floor?.source !== 'measured-receipt') {
      throw new Error('bindMeasuredWaitScope: no measured-wait receipt is configured — there is nothing to scope-bind (fail closed, nothing is activated by binding)');
    }
    if (roomId.trim() === '') {
      throw new Error('bindMeasuredWaitScope requires the ACTUAL room identity — an empty or placeholder id is refused; no guessed IDs');
    }
    const current = this.effectiveMeasuredRoomId();
    if (current !== null && current !== roomId.trim()) {
      throw new Error(`bindMeasuredWaitScope: the room scope is already bound to a different identity — rebinding a measured profile is refused (it would silently move it outside its measurement scope)`);
    }
    this.boundRoomId = roomId.trim();
  }

  private boundRoomId: string | null = null;

  private effectiveMeasuredRoomId(): string | null {
    if (this.boundRoomId !== null) return this.boundRoomId;
    const fromJoin = this.options.measuredWaitRoomId;
    return typeof fromJoin === 'string' && fromJoin.trim() !== '' ? fromJoin.trim() : null;
  }

  /** Why a configured measured receipt must NOT be applied to THIS seat/epoch right now (null =
   * in scope). Out-of-scope never silently activates the measured profile: the shipped count-only
   * default continues and the trigger detail names the refusal. */
  private measuredReceiptScopeIssue(currentEpoch: number | null): string | null {
    const floor = this.options.stallFloor;
    if (floor?.source !== 'measured-receipt' || floor.roomScope === null) return null;
    const bound = this.effectiveMeasuredRoomId();
    if (bound === null) {
      return 'no room identity bound at the public entry point — the measured profile stays explicitly INELIGIBLE until bound with the actual supported identity (join-supplied roomId or bindMeasuredWaitScope); no guessed IDs';
    }
    if (bound !== floor.roomScope) {
      return `room-scope mismatch — the receipt is scoped to a different room identity than this seat's bound id; measured profiles are never applied outside their scope`;
    }
    if (floor.roomScope !== null && floor.appliedEpoch !== null && currentEpoch !== null && currentEpoch !== floor.appliedEpoch) {
      return `epoch-scope mismatch — the receipt was measured at epoch ${String(floor.appliedEpoch)} and this seat is at epoch ${String(currentEpoch)}; the profile is not applied outside its declared epoch scope`;
    }
    return null;
  }

  async close(): Promise<void> {
    this.state = 'closed';
    this.cancelEpisodeTimer();
    this.detach();
    await this.transport.close();
  }

  // --- Internals ---------------------------------------------------------------------------------

  /** Runs synchronously inside one patch event: the only place a delivery's pair may be read. */
  private evaluatePatch(): void {
    if (this.state === 'closed') return;
    this.revision += 1;
    const handle = this.transport.handle();
    const rawRow = this.transport.readRow();
    const outcome = evaluateDeliveryGuard(
      {
        row: rawRow,
        ack: handle.lastProcessed,
        sentCount: handle.sentCount,
        revision: this.revision,
        atMs: this.options.clock.nowMs(),
      },
      { issuedEpoch: this.transport.issuedEpoch(), lastRevision: this.lastOutcome?.delivery?.revision ?? 0 },
    );
    this.lastOutcome = outcome;
    const delivery = outcome.delivery;
    if (delivery !== null) {
      this.push(this.deliveriesLog, { delivery, accepted: outcome.ok, reason: outcome.reason });
    }

    if (outcome.ok && delivery !== null) {
      if (this.state === 'recovering' && this.recoveryEpoch !== null && delivery.epoch === this.recoveryEpoch) {
        // Defence in depth behind the quarantine: even if an old-domain patch were observed while
        // recovering, it may NOT complete recovery. The held pose stays held; the anchor, journal,
        // deadline and rejoin ladder are untouched. Only the replacement domain ends recovery.
        this.recordRecovery('trigger', `held stale-domain delivery revision ${String(delivery.revision)} epoch ${String(delivery.epoch)}`);
        return;
      }
      const firstForDomain = !this.snapshotReady;
      this.lastAccepted = delivery;
      // The checkpoint instrumenter runs on every accepted delivery, in every live state: it is
      // measurement only and never feeds predictor state back.
      this.captureAckCheckpoint(delivery);
      this.pruneByResolution(delivery);
      this.restartDeadline();
      // INPUT_ACK_STALLED (ADR-0003 §3.2): defined solely from client-observable quantities —
      // an outstanding input, NEITHER the ack watermark NOR inputResolvedThrough advancing,
      // epoch unchanged, across G consecutive state deliveries (the named spec config field
      // stallDetectionDeliveries). The deadline alone cannot own this case: it RESTARTS on every
      // accepted delivery, so a live state stream keeps refreshing it exactly when the loss is
      // real. No server queue depth is consulted — no supported client API exposes it (§3.2).
      if (this.observeStalledAck(delivery)) return; // the episode began on THIS delivery; the
      // snapshot-completion branch below belongs to the NEW domain, never to this one.
      this.snapshotReady = true;
      if (this.state === 'recovering') {
        // Snapshot recovery of the NEW domain: the first accepted delivery on the replacement
        // transport's freshly issued epoch re-arms input. No pending identity survives it: the
        // journal was discarded at trigger time and is not reissued — this delivery is a fresh
        // snapshot, and only NOW may input resume.
        this.recordRecovery('snapshot-recovered', `revision ${String(delivery.revision)} epoch ${String(delivery.epoch)}`);
        this.cancelEpisodeTimer();
        this.suspensionReasonInfo = null;
        this.rejoinInFlight = false;
        this.recoveryStartedAt = null;
        this.recoveryEpoch = null;
        this.sendingStopped = false;
        this.state = 'tracking';
        this.anchor = null;
        this.captureAckCheckpoint(delivery);
        this.reconcileStallEpisode();
      }
      if (firstForDomain && this.state === 'dormant') this.state = 'tracking';
      if (this.state === 'waiting-boundary') this.state = 'tracking';
      return;
    }

    // A row whose record proves loss is an ADR trigger, whatever the timing says.
    if (outcome.reason === 'retirement-nonzero' || outcome.reason === 'gap-named' || outcome.reason === 'epoch-mismatch') {
      this.enterRecovery(outcome.reason, delivery?.revision ?? 0);
      return;
    }
    // Unequal or unreadable boundaries: hold the last valid state, keep waiting under the armed
    // deadline, and NEVER let a reconcile run against this pair (tick() skips while !ok).
    if (this.state === 'tracking') this.state = 'waiting-boundary';
    this.armDeadlineIfNeeded();
  }

  /** Returns true when the stalled-ack trigger fired on this delivery (the caller must not
   * continue processing it: an episode now owns the domain). */
  private observeStalledAck(delivery: VerifiedDelivery): boolean {
    if ((this.state !== 'tracking' && this.state !== 'waiting-boundary') || this.pending.size === 0) {
      // Compliant idle (nothing outstanding) or an episode already running: no expectation.
      this.stallStreak = 0;
      this.stallBoundary = null;
      return false;
    }
    const prev = this.stallBoundary;
    if (prev !== null && prev.epoch === delivery.epoch && prev.ack === delivery.ack && prev.resolvedThrough === delivery.resolvedThrough) {
      this.stallStreak += 1;
    } else {
      // A moved (or first-observed) boundary starts a fresh window AT this delivery: the first
      // unmoved neighbour reaches the count only when the NEXT delivery also fails to move it.
      this.stallStreak = 1;
    }
    this.stallBoundary = { ack: delivery.ack, resolvedThrough: delivery.resolvedThrough, epoch: delivery.epoch };
    if (this.stallStreak >= this.options.stallDetectionDeliveries) {
      const floor = this.options.stallFloor;
      if (floor === null) {
        this.enterRecovery('input-ack-stalled', this.pending.size);
        return true;
      }
      // MEASURED-CONFIG PATH scope gate (slice 29): a receipt outside its room/epoch scope — or
      // with no room identity bound at all — is NEVER silently activated. The shipped count-only
      // default continues, the trigger detail names the refusal, and the status surface reports it.
      if (floor.source === 'measured-receipt') {
        const issue = this.measuredReceiptScopeIssue(delivery.epoch);
        if (issue !== null) {
          this.enterRecovery('input-ack-stalled', `${String(this.pending.size)} — count-only shipped default fired; MEASURED RECEIPT NOT APPLIED (${issue}; see stallAckFloorStatus())`);
          return true;
        }
      }
      // The paired count/disposition condition holds; per the ADOPTED §D DESIGN (plan §21 /
      // ADR-0005) the fire additionally waits until the OLDEST ACTUAL same-epoch outstanding input
      // has aged past the CONFIGURED wait — a measured conservative envelope from the supplied
      // provenance, NEVER a bound and never a claim that the input is lost. An appliedEpoch-scoped
      // measurement that no longer matches the current epoch is used anyway in the SAFE DIRECTION
      // (it can only hold the fire LONGER, never fire early) and says so. Snapshot/episode timers
      // are untouched and still own an actually missing delivery. The age is measured on the
      // seat's DECLARED clock (trigger origin); the episode budget keeps its own timer origin.
      const oldest = this.oldestOutstandingSameEpochMs(delivery.epoch);
      const nowMs = this.options.clock.nowMs();
      const decision = stalledAckFloorDecision({
        floorMs: floor.waitMs,
        streak: this.stallStreak,
        deliveriesRequired: this.options.stallDetectionDeliveries,
        oldestOutstandingSameEpochSentAtMs: oldest,
        nowMs,
      });
      const staleEpoch = floor.appliedEpoch !== null && floor.appliedEpoch !== delivery.epoch;
      if (decision === 'fire') {
        const ageMs = oldest === null ? 'unknown' : String(Math.round(nowMs - oldest));
        const v = floor.receiptValidation;
        const detail = floor.source === 'legacy-numeric'
          ? `PROTOTYPE stalled-ack floor: TEST WAIT ${String(floor.waitMs)} ms elapsed (age ${ageMs} ms, pending ${String(this.pending.size)})`
          : floor.source === 'measured-receipt'
            ? `stalled-ack floor: MEASURED-RECEIPT wait ${String(floor.waitMs)} ms elapsed (age ${ageMs} ms, pending ${String(this.pending.size)}; provenance ${floor.provenance}; machine-validated ${v?.comparison ?? 'unknown'}: recorded detection+recovery ${String(v?.comparedMs ?? NaN)} ms${v?.normalized ? ' including the DECLARED send→fire offset (declared, not re-measured here)' : ''} vs declared available budget ${String(v?.availableBudgetMs ?? NaN)} ms on ${v?.budgetClockOrigin ?? '?'}/${v?.budgetBasis ?? '?'}; in-scope for this room${floor.appliedEpoch !== null ? ` and epoch ${String(floor.appliedEpoch)}` : ' (declared epoch-agnostic)'}; declared-scope validation only — NOT a proof, NOT production-enabled)`
            : `stalled-ack floor: CONFIGURED wait ${String(floor.waitMs)} ms elapsed (age ${ageMs} ms, pending ${String(this.pending.size)}; provenance ${floor.provenance}${staleEpoch ? `; STALE for current epoch ${String(delivery.epoch)} — held on the older measurement, the safe direction, never fired early` : ''}${floor.matchedBudgetMs !== null ? `; matched budget ${String(floor.matchedBudgetMs)} ms declared-matched, not independently verified` : ''})`;
        if (floor.source === 'measured-receipt') {
          // The applied receipt episode: measured on the seat's declared clock from fire, settled
          // on the first accepted snapshot delivery — reconciled against the declared budget ONLY
          // when the receipt's budget declares the same origin and basis (else reporting-only).
          this.stallEpisode = { firedAtMs: nowMs, settledAtMs: null };
        }
        this.enterRecovery('input-ack-stalled', detail);
        return true;
      }
      if (decision === 'held') {
        this.recordRecovery('stall-floor-held', floor.source === 'legacy-numeric'
          ? `streak ${String(this.stallStreak)} >= ${String(this.options.stallDetectionDeliveries)} but the oldest outstanding input is younger than the ${String(floor.waitMs)} ms TEST WAIT (measured conservative envelope, not a bound)`
          : `streak ${String(this.stallStreak)} >= ${String(this.options.stallDetectionDeliveries)} but the oldest outstanding input is younger than the configured ${String(floor.waitMs)} ms wait (provenance ${floor.provenance}; measured conservative envelope on the ${floor.clockOrigin} — not a bound, not a loss claim)`);
        return false;
      }
      // no-condition with the prototype on: nothing genuinely outstanding in this epoch holds it.
      this.stallStreak = 0;
      this.stallBoundary = null;
      return false;
    }
    return false;
  }

  /** Sent instant of the OLDEST genuinely outstanding input of THIS epoch (obsolete never count). */
  private oldestOutstandingSameEpochMs(epoch: number): number | null {
    let oldest: number | null = null;
    for (const entry of this.pending.values()) {
      if (entry.epoch !== epoch) continue;
      if (oldest === null || entry.sentAtMs < oldest) oldest = entry.sentAtMs;
    }
    return oldest;
  }

  /** Pruning authority: the server's disposition prefix ONLY. The ack watermark prunes nothing. */
  private pruneByResolution(delivery: VerifiedDelivery): void {
    for (const [seq, entry] of [...this.pending.entries()]) {
      if (entry.epoch !== delivery.epoch) {
        // Another domain's journal entry cannot be resolved by this one's record: it is dropped
        // as part of recovery's discard, never reissued and never replayed here.
        this.pending.delete(seq);
        continue;
      }
      if (seq <= delivery.resolvedThrough) {
        this.pending.delete(seq);
        this.pruneAuthority.byResolvedThrough += 1;
      }
    }
  }

  private pendingCountAt(delivery: VerifiedDelivery): number {
    let count = 0;
    for (const entry of this.pending.values()) {
      if (entry.epoch === delivery.epoch && entry.seq > delivery.resolvedThrough) count += 1;
    }
    return count;
  }

  /**
   * Journal through the handle's `onSend`, so a frame staged and sent through the public handle
   * directly (the smoke fixture does exactly that to induce a refusal) enters the journal exactly
   * as a `send()` frame does. The frame is read back with `at(seq)` — public, valid inside the
   * listener, the same buffer the SDK's own replay reads.
   */
  private observeSend(seq: number): void {
    if (seq < 1) return;
    const handle = this.transport.handle();
    const decoded = handle.at(seq);
    if (decoded === undefined) return;
    const epoch = this.transport.issuedEpoch();
    const entry: PendingInput = {
      seq,
      epoch,
      frame: {
        sessionEpoch: epoch,
        generation: decoded.generation,
        directIntent: decoded.directIntent,
        moveX: decoded.moveX,
        moveZ: decoded.moveZ,
      },
      sentAtMs: this.options.clock.nowMs(),
    };
    this.pending.set(entry.seq, entry);
    this.push(this.sentFrames, { seq: entry.seq, epoch: entry.epoch, atMs: entry.sentAtMs });
    this.armDeadlineIfNeeded();
  }

  /** Cancel whatever episode timer a previous episode left; arm the hard deadline for THIS one. */
  private armEpisodeDeadline(): void {
    this.cancelEpisodeTimer();
    this.episodeTimer = this.options.clock.setTimer(() => {
      this.episodeTimer = null;
      // Whichever limit is reached first WINS: a rolling-window suspension already landed
      // (state suspended), or the seat closed — this timer must not relabel either.
      if (this.readState() !== 'recovering') return;
      this.expireEpisode('independent per-episode hard deadline (clientRecoveryDeadlineMs measured from episode START) crossed while the recovery had NOT completed — the rejoin route never settled and cannot gate §3.2; the seat stays stopped, prediction stays discarded, the connection error is surfaced, and any late join result will be quarantined');
    }, this.options.recoveryDeadlineMs);
  }

  private cancelEpisodeTimer(): void {
    this.episodeTimer?.cancel();
    this.episodeTimer = null;
  }

  /** Slice 29: an APPLIED in-scope measured-receipt episode just settled — record what ACTUALLY
   * happened (seat-declared clock, fire → first accepted snapshot delivery) against what the
   * receipt DECLARED. Compared only on matching origin AND basis; anything else is stored as an
   * unambiguously reporting-only entry with no within/over wording. */
  private reconcileStallEpisode(): void {
    if (this.stallEpisode === null || this.stallEpisode.settledAtMs !== null) return;
    const nowMs = this.options.clock.nowMs();
    const actualEpisodeMs = nowMs - this.stallEpisode.firedAtMs;
    this.stallEpisode = { firedAtMs: this.stallEpisode.firedAtMs, settledAtMs: nowMs };
    const floor = this.options.stallFloor;
    const v = floor?.receiptValidation ?? null;
    if (floor?.source !== 'measured-receipt' || v === null) return;
    const comparable = v.budgetClockOrigin === EPISODE_CLOCK_ORIGIN && v.budgetBasis === EPISODE_BASIS_FROM_FIRE;
    this.receiptReconciliation = comparable
      ? {
          actualEpisodeMs, measurementClockOrigin: EPISODE_CLOCK_ORIGIN, measurementBasis: EPISODE_BASIS_FROM_FIRE,
          declaredBudgetMs: v.availableBudgetMs, declaredBudgetClockOrigin: v.budgetClockOrigin, declaredBudgetBasis: v.budgetBasis,
          validation: 'compared-on-matching-origins',
          verdict: actualEpisodeMs <= v.availableBudgetMs ? 'within-declared-budget' : 'exceeded-declared-budget',
          note: 'the ACTUAL episode (fire → first accepted snapshot delivery) on the seat-declared clock versus the declared budget of the receipt on the SAME origin and basis; a reporting surface — it proves nothing and enables nothing',
        }
      : {
          actualEpisodeMs, measurementClockOrigin: EPISODE_CLOCK_ORIGIN, measurementBasis: EPISODE_BASIS_FROM_FIRE,
          declaredBudgetMs: v.availableBudgetMs, declaredBudgetClockOrigin: v.budgetClockOrigin, declaredBudgetBasis: v.budgetBasis,
          validation: 'reporting-only-basis-mismatch', verdict: 'not-compared-basis-mismatch',
          note: `the actual episode rode ${EPISODE_CLOCK_ORIGIN}/${EPISODE_BASIS_FROM_FIRE} but the budget of the receipt is declared on ${v.budgetClockOrigin}/${v.budgetBasis} — no within/over wording is produced across mismatched origins; this entry is REPORTING-ONLY and must never be presented as an applied validation`,
        };
  }

  /**
   * §3.2 episode expiry through a single funnel: stop HOLDS, prediction stays discarded, the
   * prescribed connection error is surfaced, no further rejoin runs in this episode. Recorded
   * once; later sites no-op.
   */
  private expireEpisode(why: string): void {
    this.cancelEpisodeTimer();
    if (this.episodeExpired) return;
    this.episodeExpired = true;
    this.suspensionReasonInfo = 'episode-deadline';
    this.connectionErrorInfo = { code: 'recovery-episode-expired', message: why, atMs: this.options.clock.nowMs() };
    this.recordRecovery('episode-expired', why);
    this.state = 'suspended';
  }

  private armDeadlineIfNeeded(): void {
    if (this.deadlineHandle === null && (this.pending.size > 0 || this.state === 'recovering')) this.restartDeadline();
  }

  private restartDeadline(): void {
    this.cancelDeadline();
    if (this.state === 'closed' || this.state === 'suspended') return;
    // The client-local deadline is armed whenever inputs are outstanding; it restarts on every
    // accepted delivery and can expire with NO delivery at all (ADR-0003 §3.2).
    if (this.pending.size === 0 && this.state !== 'recovering') return;
    this.deadlineHandle = this.options.clock.setTimer(() => {
      this.deadlineHandle = null;
      if (this.state === 'recovering') {
        // The episode deadline outranks an in-flight attempt: if the whole episode has elapsed,
        // the recovery suspends even while a join promise is still settling — the settling
        // result is then refused at install time and its transport discarded.
        if (this.recoveryStartedAt !== null && this.options.clock.nowMs() - this.recoveryStartedAt >= this.options.recoveryDeadlineMs) {
          this.expireEpisode('deadline crossed while a rejoin attempt was in flight; its result will be refused');
          return;
        }
        // Waiting for a snapshot that has not arrived inside the deadline: the next bounded
        // rejoin attempt (or the suspension) is scheduled, never an early reconcile.
        this.scheduleRejoin();
        return;
      }
      if (this.pending.size > 0) this.enterRecovery('snapshot-deadline-expired', this.pending.size);
    }, this.options.snapshotDeadlineMs);
  }

  private cancelDeadline(): void {
    this.deadlineHandle?.cancel();
    this.deadlineHandle = null;
  }

  /** §3.2, in order: stop sending, discard pending prediction, hold last valid state, bounded rejoin. */
  private enterRecovery(trigger: string, detail: number | string): void {
    if (this.state === 'recovering' || this.state === 'suspended') {
      this.recordRecovery('trigger', `${trigger} (already recovering): ${String(detail)}`);
      return;
    }
    this.state = 'recovering';
    this.recoveryStartedAt = this.options.clock.nowMs();
    this.armEpisodeDeadline();
    this.reconciler = null; // discard the predicted continuation; truth stays in lastAccepted (held)
    this.snapshotReady = false;
    this.anchor = null; // the checkpoint anchor does not survive a domain change
    this.recoveryEpoch = this.domainEpoch;
    this.recordRecovery('trigger', `${trigger} at ${String(detail)}`);
    if (!this.sendingStopped) {
      this.sendingStopped = true;
      this.recordRecovery('stop-sending', 'no send() until a new domain has a verified snapshot');
    }
    const discarded = this.pending.size;
    this.pending.clear(); // pending identities are discarded, never reissued across the change
    this.recordRecovery('discard-pending', `${String(discarded)} journal entries dropped; held pose retained`);
    // DOMAIN QUARANTINE (review P1): stop observing the old room AT THE TRIGGER, before any async
    // rejoin settles, and close/isolate its handle. No late delivery from the quarantined domain
    // can clear the stop latch or cancel the ladder; the SDK reconciler has no supported disposer
    // (recorded in the API map), so isolation is the leave plus dropping every subscription we
    // hold. The quarantined epoch is remembered so the accepting branch can also refuse it.
    this.quarantined = true;
    this.detach();
    this.recordRecovery('trigger', `domain ${String(this.recoveryEpoch ?? 'unknown')} quarantined: subscriptions dropped, handle closing`);
    void this.closeQuarantined();
    this.scheduleRejoin();
  }

  /** Close the quarantined transport; a failure to leave is recorded, never retried blindly. */
  private async closeQuarantined(): Promise<void> {
    try {
      await this.transport.close();
    } catch (error) {
      this.recordRecovery('trigger', `quarantined transport close failed (isolated anyway): ${String(error instanceof Error ? error.message : error)}`);
    }
  }

  /** A rejoin result that arrived after recovery ended: the transport it joined is NOT installed. */
  private async discardAbandoned(next: PredictionTransport, why: string): Promise<void> {
    this.recordRecovery('trigger', `abandoned rejoin result (${why}); its transport is closed`);
    try {
      await next.close();
    } catch (error) {
      this.recordRecovery('trigger', `abandoned transport close failed: ${String(error instanceof Error ? error.message : error)}`);
    }
  }

  private scheduleRejoin(): void {
    if (this.options.rejoin === undefined || this.transport.rearm === undefined) {
      this.recordRecovery('suspended', 'host provides no rejoin route: staying stopped on the held snapshot');
      this.state = 'suspended';
      return;
    }
    const now = this.options.clock.nowMs();
    const inWindow = this.rejoinAts.filter((at) => now - at < this.options.rejoinWindowMs);
    this.rejoinAts.length = 0;
    this.rejoinAts.push(...inWindow);
    if (this.recoveryStartedAt !== null && now - this.recoveryStartedAt >= this.options.recoveryDeadlineMs) {
      this.expireEpisode('the 4000 ms episode deadline bounds the whole recovery');
      return;
    }
    if (inWindow.length >= this.options.maxRejoinsPerWindow) {
      // Whichever limit is reached first wins: THIS suspension is the rolling allowance, NOT an
      // episode expiry — no error surface, no expiry flag; the distinctness is observable.
      this.suspensionReasonInfo = 'rolling-window';
      this.cancelEpisodeTimer();
      this.recordRecovery('suspended', 'rolling-window: recoverySuspended until the oldest counted rejoin leaves the window');
      this.state = 'suspended';
      return;
    }
    const attemptInEpisode = inWindow.length; // the ladder is a schedule, not an entitlement
    const delayMs = this.options.rejoinBackoffMs[Math.min(attemptInEpisode, this.options.rejoinBackoffMs.length - 1)] ?? 0;
    this.recordRecovery('rejoin-scheduled', `backoff step ${String(delayMs)} ms (attempt ${String(attemptInEpisode + 1)} of the rolling allowance)`);
    this.options.clock.setTimer(() => {
      void this.performRejoin();
    }, delayMs);
  }

  private async performRejoin(): Promise<void> {
    if (this.rejoinInFlight || this.state !== 'recovering' || this.options.rejoin === undefined) return;
    const now = this.options.clock.nowMs();
    if (this.recoveryStartedAt !== null && now - this.recoveryStartedAt >= this.options.recoveryDeadlineMs) {
      this.expireEpisode('deadline crossed before the scheduled attempt');
      return;
    }
    this.rejoinInFlight = true;
    this.rejoinAts.push(this.options.clock.nowMs()); // actual rejoins are what the rolling allowance counts
    this.recordRecovery('rejoin-attempt', `counted rejoin ${String(this.rejoinAts.length)} in the window`);
    try {
      const next = await this.options.rejoin();
      // Install the result only if recovery is STILL the live policy at this instant. The seat may
      // have been disposed, the episode deadline may have crossed, or a prior suspension may have
      // landed while this join was settling — an accepted attempt never overrides any of those.
      const episodeCrossed = this.recoveryStartedAt !== null
        && this.options.clock.nowMs() - this.recoveryStartedAt >= this.options.recoveryDeadlineMs;
      // Re-read the state at install time: the compiler's earlier narrowing does not survive an
      // await, and neither should this code's assumptions.
      const stateAtInstall: PredictorState = this.readState();
      if (stateAtInstall === 'closed') {
        await this.discardAbandoned(next, 'seat closed while the rejoin was settling');
        return;
      }
      if (stateAtInstall !== 'recovering') {
        await this.discardAbandoned(next, `state is ${stateAtInstall}, not recovering`);
        this.rejoinInFlight = false;
        return;
      }
      if (episodeCrossed) {
        await this.discardAbandoned(next, 'episode deadline crossed while the rejoin was settling');
        this.rejoinInFlight = false;
        this.expireEpisode('rejoin succeeded but the episode had elapsed: result refused, transport discarded');
        return;
      }
      const previous = this.transport;
      this.transport = next;
      if (!this.quarantined) {
        previous.rearm?.(next);
        void previous.close();
      }
      // else: the quarantined domain was already unsubscribed and closed at the trigger.
      this.quarantined = false;
      this.recoveryEpoch = null;
      this.lastOutcome = null;
      this.rejoinInFlight = false;
      // Input stays stopped and no reconciler exists until the first accepted delivery of the
      // NEW domain arrives through evaluatePatch() — snapshot recovery precedes any further input.
      // Recorded BEFORE attaching: attaching may synchronously deliver the new domain's first
      // patch, and the ledger must read rejoin-complete, then snapshot-recovered.
      this.recordRecovery('rejoin-complete', `new domain epoch ${String(next.issuedEpoch())}; awaiting the fresh snapshot`);
      this.detach();
      this.attach();
      // The snapshot wait is itself deadline-bound: no verified delivery inside it schedules the
      // next bounded attempt (or the suspension), it never leaves the seat silently frozen.
      this.armDeadlineIfNeeded();
    } catch (error) {
      this.rejoinInFlight = false;
      const reason = String(error instanceof Error ? error.message : error);
      const stateAfterFailure: PredictorState = this.readState();
      if (stateAfterFailure !== 'recovering') {
        this.recordRecovery('trigger', `rejoin route failed after recovery ended (${reason})`);
        return;
      }
      // ADR §3.2 retry/suspension semantics for an ordinary rejoin error: the attempt was counted,
      // so the ladder decides — next bounded attempt while the window and episode allow it,
      // suspension when either is exhausted. One failure alone never suspends.
      this.recordRecovery('trigger', `rejoin route failed: ${reason}`);
      this.scheduleRejoin();
    }
  }

  /**
   * Build the SDK reconciler against the fresh domain. Refuses without an advertised fixed rate —
   * the spike's "missing advertised fixed rate" is an explicit refusal here, named, never a guess.
   */
  private ensureReconciler(): ReconcilerLike | null {
    if (this.reconciler !== null) return this.reconciler;
    const advertised = this.transport.advertised();
    const stepMs = advertised.stepMs;
    const stepSeconds = advertised.stepSeconds ?? (advertised.tickRate === undefined ? undefined : 1 / advertised.tickRate);
    if (stepMs === undefined || stepSeconds === undefined) {
      if (!this.missingRateReported) {
        this.missingRateReported = true;
        this.recordRecovery('trigger', 'missing-advertised-rate: the room advertised no fixed step; prediction refuses to guess a dt');
      }
      return null;
    }
    const instance = this.transport.rowInstance();
    if (instance === null) return null;
    const speed = this.options.speed;
    this.advertisedStepSeconds = stepSeconds;
    const reconciler = new Reconciler<PredictedMirror, StagedDirectInput>(instance, {
      input: this.transport.handle(),
      fields: ['x', 'z'],
      smoothMs: advertised.patchRate ?? 50,
      stepMs,
      stepSeconds,
      step: (ctx, state, command) => {
        const next = flatDirectStep(state, { moveX: command.moveX, moveZ: command.moveZ }, ctx.dt, speed);
        state.x = next.x;
        state.z = next.z;
      },
    });
    this.reconciler = reconciler satisfies ReconcilerLike;
    return this.reconciler;
  }

  /** Read the state without the compiler's stale control-flow narrowing. */
  private readState(): PredictorState {
    return this.state;
  }

  private recordRecovery(event: RecoveryRecord['event'], detail: string): void {
    this.push(this.recovery, { atMs: this.options.clock.nowMs(), event, detail });
  }

  private push<T>(ledger: T[], entry: T): void {
    if (ledger.length >= this.options.ledgerLimit) {
      ledger.shift();
      this.trimReports += 1;
      return;
    }
    ledger.push(entry);
  }
}

// ─────────────────────────────────────────────────────────────── the SDK transport (production)

/**
 * Join a room over the published SDK and wrap it as a `PredictionTransport`.
 *
 * The promise resolves once the room has issued an epoch **and** that epoch has arrived in this
 * seat's own replica row. If the wait rejects or the input handle cannot be taken, the half-built
 * seat is unwound before the original error propagates: the state callback is detached and the
 * room is left with consent; the cleanup's own failure never replaces the caller's error.
 */
export const createSdkSeatTransport = async (options: {
  readonly endpoint: string;
  readonly join: RegionJoinTarget;
  readonly presentation: RegionJoinPresentation;
  readonly epochTimeoutMs?: number;
}): Promise<{ readonly transport: PredictionTransport; readonly roomId: string; readonly sessionId: string; issuedEpoch: () => SessionEpoch }> => {
  const epochTimeoutMs = options.epochTimeoutMs ?? 10_000;
  const client = new Client(options.endpoint);

  // `rootSchema` is deliberately absent: the pinned server's state reflection and `defineInput`
  // reflection rebuild the serializers during the handshake (api map §12).
  const room =
    options.join.mode === 'create'
      ? await client.create<RegionReplicaState>(options.join.roomName, options.presentation)
      : await client.joinById<RegionReplicaState>(options.join.roomId, options.presentation);

  const sessionId = room.sessionId;
  const roomId = room.roomId;
  let issuedEpochValue: SessionEpoch | null = null;
  const waiters: (() => void)[] = [];
  const patchEvents = new Set<() => void>();
  let closed = false;

  const ownRow = (): RegionReplicaRow | undefined => {
    const players = room.state?.players;
    return players?.get?.(sessionId);
  };

  const rowToRaw = (row: RegionReplicaRow | undefined): RawDeliveryRow | null => {
    if (row === undefined) return null;
    return {
      epoch: row.sessionEpoch,
      lastAuthorityTick: row.lastAuthorityTick,
      x: row.x,
      y: row.y,
      z: row.z,
      inputResolvedThrough: row.inputResolvedThrough,
      inputGapStart: row.inputGapStart,
      inputGapEnd: row.inputGapEnd,
      inputRetiredUnrepresented: row.inputRetiredUnrepresented,
    };
  };

  const noteRow = (): void => {
    const row = ownRow();
    if (row !== undefined && issuedEpochValue === null && row.sessionEpoch >= 1) {
      issuedEpochValue = row.sessionEpoch;
      for (const wake of waiters.splice(0)) wake();
    }
  };
  // The state a create/join resolves with may ALREADY carry the issued epoch: look before waiting.
  noteRow();
  room.onStateChange(() => {
    noteRow();
    for (const listener of [...patchEvents]) listener();
  });

  const abandonJoinedRoom = async (): Promise<void> => {
    closed = true;
    patchEvents.clear();
    room.onStateChange.clear();
    try {
      await room.leave();
    } catch {
      // Cleanup must not mask the original failure; the caller still sees its own rejection.
    }
  };

  let handle: InputHandle<StagedDirectInput>;
  try {
    if (issuedEpochValue === null) {
      await new Promise<void>((resolve, reject) => {
        const wake = (): void => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(() => {
          const at = waiters.indexOf(wake);
          if (at >= 0) waiters.splice(at, 1);
          reject(new Error(`no replica row carrying a server-issued epoch within ${String(epochTimeoutMs)} ms`));
        }, epochTimeoutMs);
        waiters.push(wake);
      });
    }
    handle = room.input<StagedDirectInput>();
  } catch (error) {
    await abandonJoinedRoom();
    throw error;
  }

  const transport: PredictionTransport = {
    issuedEpoch: () => {
      if (issuedEpochValue === null) throw new Error('no server-issued epoch yet');
      return issuedEpochValue;
    },
    readRow: () => rowToRaw(ownRow()),
    rowInstance: () => {
      const row = ownRow();
      return row === undefined ? null : row;
    },
    readState: () => room.state ?? null,
    handle: () => handle,
    pingLatency: (callback) => {
      // `Room.ping` SILENTLY NO-OPS when the connection is closed (SDK Room.ts:308-310) — a dead
      // socket would otherwise pose as endless slow replies. Refuse loudly instead.
      if (closed || room.connection?.isOpen !== true) {
        throw new Error('rtt-probe-socket-closed: the seat socket is not open — refusing to pose a dead socket as a slow reply');
      }
      room.ping(callback);
    },
    subscribe: (onPatch) => {
      patchEvents.add(onPatch);
      return () => { patchEvents.delete(onPatch); };
    },
    /**
     * The predictor owns the domain swap: after a successful rejoin it installs the fresh
     * transport, detaches from this one, and closes it. Nothing room-local has to be undone
     * here, but the hook MUST exist — its absence is what the predictor reads as "the host
     * cannot rejoin", and a seat that suspends where it should rejoin is a policy bug. The
     * browser slice caught exactly this (UDG-SPIKE-001 slice 4).
     */
    rearm: () => undefined,
    advertised: () => ({
      tickRate: handle.tickRate,
      stepMs: handle.stepMs,
      patchRate: handle.patchRate,
      stepSeconds: handle.stepSeconds,
    }),
    close: async () => {
      if (closed) return;
      closed = true;
      patchEvents.clear();
      room.onStateChange.clear();
      // A consented leave ends the seat and cancels SDK reconnection. The token is never read.
      await room.leave();
    },
  };
  return { transport, roomId, sessionId, issuedEpoch: () => transport.issuedEpoch() };
};

// ─────────────────────────────────────────────────────────────── the production seat

export interface PredictionAdapterOptions {
  readonly endpoint: string;
  readonly join: RegionJoinTarget;
  readonly presentation: RegionJoinPresentation;
  readonly epochTimeoutMs?: number;
  /** The room's movement speed for the shared flat step (the same value the authority steps with). */
  readonly speed?: number;
  readonly predictor?: Omit<PredictorOptions, 'speed'>;
}

export interface PredictionSeat {
  readonly roomId: string;
  readonly sessionId: string;
  /** The epoch the room issued for this seat, read off the seat's own replica row — never self-asserted. */
  epoch(): SessionEpoch | null;
  /** The server-advertised fixed step. An `undefined` field means the room advertised no rate. */
  advertised(): AdvertisedStep;
  /** Validate locally, stage on the SDK input handle, transmit exactly one input. */
  sendDirect(request: DirectMovementRequest): SentFrame;
  /** A neutral keepalive frame: `directIntent: false`, zero axes, still one input on the wire. */
  sendNeutral(generation: number): SentFrame;
  /** A state delivery received since the seat joined. */
  snapshot(): RegionSnapshot;
  deliveries(): number;
  /** The ack the authority last published for this handle (`InputHandle.lastProcessed`) — telemetry. */
  acknowledged(): number;
  /** Inputs this handle has transmitted (`InputHandle.sentCount`). */
  sentCount(): number;
  /** The seat-side policy layer: guard ledger, journals, recovery state. */
  predictor(): DirectMotionPredictor;
  close(): Promise<void>;
}

/**
 * Join a region room as a seat: the transport above, a `DirectMotionPredictor` attached to it,
 * and the checked replica-read surface the smoke suite asserts against.
 */
export const joinPredictionSeat = async (options: PredictionAdapterOptions): Promise<PredictionSeat> => {
  const joined = await createSdkSeatTransport({
    endpoint: options.endpoint,
    join: options.join,
    presentation: options.presentation,
    ...(options.epochTimeoutMs === undefined ? {} : { epochTimeoutMs: options.epochTimeoutMs }),
  });
  const { transport, roomId, sessionId } = joined;

  const predictor = new DirectMotionPredictor(transport, {
    speed: options.speed ?? 4,
    ...(options.predictor ?? {}),
    // THE supported scope binding for a measured-wait receipt: the ACTUAL joined room id, set
    // after the host spread so it can never be overridden by a guessed or stale value.
    measuredWaitRoomId: roomId,
    ...(options.predictor?.rejoin === undefined
      ? {
          // The production rejoin route: a fresh join of the same room under the same
          // presentation. Hosts that own reconnection semantics (the smoke fixture) pass their own.
          rejoin: async () => {
            const again = await createSdkSeatTransport({
              endpoint: options.endpoint,
              join: { mode: 'byId', roomId },
              presentation: options.presentation,
              ...(options.epochTimeoutMs === undefined ? {} : { epochTimeoutMs: options.epochTimeoutMs }),
            });
            return again.transport;
          },
        }
      : {}),
  });
  predictor.attach();

  // Delivery counting for the snapshot surface rides the same patch events the predictor reads;
  // `subscribe` is additive and the seat never mutates anything it reads.
  let deliveries = 0;
  transport.subscribe(() => { deliveries += 1; });

  const readSnapshot = (): RegionSnapshot => {
    const state = transport.readState();
    if (state === null || state.players === undefined) {
      return { serverTick: 0, deliveries, self: null, peers: [], issues: ['no replicated state yet'] };
    }
    const issues: string[] = [];
    const rows: SeatObservation[] = [];
    state.players.forEach((row, key) => {
      const read = readRow(key, row);
      if (read.ok === false) {
        issues.push(read.issue);
        return;
      }
      rows.push(read.value);
    });
    const own = rows.filter((row) => row.key === sessionId || row.entityId === sessionId);
    const peers = rows.filter((row) => row.key !== sessionId && row.entityId !== sessionId);
    return { serverTick: state.serverTick, deliveries, self: own[0] ?? null, peers, issues };
  };

  return {
    roomId,
    sessionId,
    epoch: () => {
      const raw = transport.readRow();
      return raw === null || raw.epoch < 1 ? null : raw.epoch;
    },
    advertised: () => {
      const a = transport.advertised();
      return { tickRate: a.tickRate, stepMs: a.stepMs, patchRate: a.patchRate };
    },
    sendDirect: (request) => predictor.send(request, true),
    sendNeutral: (generation) => predictor.send({ generation, moveX: 0, moveZ: 0 }, false),
    snapshot: () => readSnapshot(),
    deliveries: () => deliveries,
    acknowledged: () => transport.handle().lastProcessed,
    sentCount: () => transport.handle().sentCount,
    predictor: () => predictor,
    close: () => predictor.close(),
  };
};
