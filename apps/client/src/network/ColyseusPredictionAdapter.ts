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
 * The spike's shared flat step: `pose + drive · speed · dt` — the same relation the authority's
 * `FlatReferenceStepper` produces and `tests/reference/flat-direct-step.ts` evidences as the AC-1
 * trace (the assignment names that file the sole movement function on both sides; the reference
 * producer itself runs the authority core and executes on import, so the first-party typed step
 * lives here and its equivalence to the authority stepper is pinned by
 * `tests/unit/udg-spike-001/flat-step-parity.test.ts`, and the reference trace's own equality
 * (200 ticks → 40 m within 1e-6 m) is re-checked from `tests/reference/flat-direct-step.ts`
 * output by the spike's Node-side checks, never re-derived here).
 *
 * Pure and total: finite inputs are required by the caller's domain rules; nothing in this
 * function reads the clock, the network or any schema.
 */
export const flatDirectStep = (
  pose: Readonly<FlatPose>,
  drive: Readonly<{ moveX: number; moveZ: number }>,
  dtSeconds: number,
  speed: number,
): FlatPose => ({
  x: pose.x + drive.moveX * speed * dtSeconds,
  z: pose.z + drive.moveZ * speed * dtSeconds,
});

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
  readonly correctionZ: number | null;
  readonly pendingSeqs: readonly number[];
}

/** One accepted delivery paired with the reconcile that adopted it (zero corrections included). */
export interface RawCorrectionRecord {
  readonly revision: number;
  readonly authorityTick: number;
  readonly epoch: SessionEpoch;
  readonly ack: number;
  readonly resolvedThrough: number;
  readonly atMs: number;
  readonly predictedBeforeZ: number;
  readonly predictedAfterZ: number;
  readonly authoritativeZ: number;
  readonly rawCorrectionZ: number;
  readonly pendingCount: number;
  readonly zero: boolean;
}

/** The recovery ledger: every trigger, stop, discard, rejoin attempt and suspension, in order. */
export interface RecoveryRecord {
  readonly atMs: number;
  readonly event: 'trigger' | 'stop-sending' | 'discard-pending' | 'rejoin-scheduled' | 'rejoin-attempt'
    | 'rejoin-complete' | 'snapshot-recovered' | 'suspended' | 'episode-expired' | 'send-refused';
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
  readonly clock: PredictorClock;
  readonly ledgerLimit: number;
  readonly rejoin?: (() => Promise<PredictionTransport>) | undefined;
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
  private readonly corrections: RawCorrectionRecord[] = [];
  private readonly recovery: RecoveryRecord[] = [];
  private readonly sentFrames: { readonly seq: number; readonly epoch: SessionEpoch; readonly atMs: number }[] = [];

  private state: PredictorState = 'dormant';
  private sendingStopped = false;
  private snapshotReady = false;
  private deadlineHandle: TimerToken | null = null;
  private recoveryStartedAt: number | null = null;
  private episodeExpired = false;
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
    this.options = {
      speed: options.speed,
      snapshotDeadlineMs: options.snapshotDeadlineMs ?? 500,
      recoveryDeadlineMs: options.recoveryDeadlineMs ?? 4000,
      rejoinWindowMs: options.rejoinWindowMs ?? 60_000,
      maxRejoinsPerWindow: options.maxRejoinsPerWindow ?? 2,
      rejoinBackoffMs: options.rejoinBackoffMs ?? [250, 500, 1000],
      clock: options.clock ?? wallClock,
      ledgerLimit: options.ledgerLimit ?? 512,
      ...(options.rejoin === undefined ? {} : { rejoin: options.rejoin }),
    };
  }

  /** Start observing the transport. Idempotent. */
  attach(): void {
    if (this.unsubscribe !== null) return;
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
        correctionZ: null,
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
          correctionZ: null,
          pendingSeqs: [...this.pending.keys()],
        });
        return;
      }
    }
    const reconciler = this.reconciler;
    if (reconciler === null) return;
    const verified = outcome.delivery;
    if (verified === null) return;
    const beforeZ = reconciler.state.z;
    const seqBefore = reconciler.reconcileSeq;
    reconciler.tick(now);
    const delta = reconciler.reconcileSeq - seqBefore;
    if (delta > 0) {
      const afterZ = reconciler.state.z;
      const rawCorrection = beforeZ - verified.z;
      this.push(this.corrections, {
        revision: verified.revision,
        authorityTick: verified.authorityTick,
        epoch: verified.epoch,
        ack: verified.ack,
        resolvedThrough: verified.resolvedThrough,
        atMs: now,
        predictedBeforeZ: beforeZ,
        predictedAfterZ: afterZ,
        authoritativeZ: verified.z,
        rawCorrectionZ: rawCorrection,
        pendingCount: this.pendingCountAt(verified),
        // A 200-step float64 accumulate carries ~1e-14 of drift, so "zero" means "inside float
        // drift", not "bitwise" — an order of magnitude below the 1e-6 m criterion it feeds.
        zero: Math.abs(rawCorrection) < 1e-9,
      });
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
      correctionZ: this.corrections.length > 0 ? (this.corrections[this.corrections.length - 1]?.rawCorrectionZ ?? null) : null,
      pendingSeqs: [...this.pending.keys()],
    });
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
  snapshotReadyForInput(): boolean { return this.snapshotReady; }
  pendingJournal(): readonly PendingInput[] { return [...this.pending.values()]; }
  deliveryLedger(): typeof this.deliveriesLog { return [...this.deliveriesLog]; }
  tickLedger(): readonly PredictorTickRecord[] { return [...this.ticks]; }
  correctionLedger(): readonly RawCorrectionRecord[] { return [...this.corrections]; }
  recoveryLedger(): readonly RecoveryRecord[] { return [...this.recovery]; }
  sentAudit(): readonly { readonly seq: number; readonly epoch: SessionEpoch; readonly atMs: number }[] { return [...this.sentFrames]; }
  pruneAuthorityLedger(): typeof this.pruneAuthority { return { ...this.pruneAuthority }; }
  rejoinTimestamps(): readonly number[] { return [...this.rejoinAts]; }

  async close(): Promise<void> {
    this.state = 'closed';
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
      const firstForDomain = !this.snapshotReady;
      this.lastAccepted = delivery;
      this.pruneByResolution(delivery);
      this.restartDeadline();
      this.snapshotReady = true;
      if (this.state === 'recovering') {
        // Snapshot recovery: the first accepted delivery of the new domain re-arms input. No
        // pending identity survives it: the journal was discarded at trigger time and is not
        // reissued here — this delivery is a fresh snapshot, and only NOW may input resume.
        this.recordRecovery('snapshot-recovered', `revision ${String(delivery.revision)} epoch ${String(delivery.epoch)}`);
        this.rejoinInFlight = false;
        this.recoveryStartedAt = null;
        this.sendingStopped = false;
        this.state = 'tracking';
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
    this.reconciler = null; // discard the predicted continuation; truth stays in lastAccepted (held)
    this.snapshotReady = false;
    this.recordRecovery('trigger', `${trigger} at ${String(detail)}`);
    if (!this.sendingStopped) {
      this.sendingStopped = true;
      this.recordRecovery('stop-sending', 'no send() until a new domain has a verified snapshot');
    }
    const discarded = this.pending.size;
    this.pending.clear(); // pending identities are discarded, never reissued across the change
    this.recordRecovery('discard-pending', `${String(discarded)} journal entries dropped; held pose retained`);
    this.scheduleRejoin();
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
      this.episodeExpired = true;
      this.recordRecovery('episode-expired', 'the 4000 ms episode deadline bounds the whole recovery');
      this.state = 'suspended';
      return;
    }
    if (inWindow.length >= this.options.maxRejoinsPerWindow) {
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
      this.episodeExpired = true;
      this.recordRecovery('episode-expired', 'deadline crossed before the scheduled attempt');
      this.state = 'suspended';
      return;
    }
    this.rejoinInFlight = true;
    this.rejoinAts.push(this.options.clock.nowMs()); // actual rejoins are what the rolling allowance counts
    this.recordRecovery('rejoin-attempt', `counted rejoin ${String(this.rejoinAts.length)} in the window`);
    try {
      const next = await this.options.rejoin();
      const previous = this.transport;
      this.transport = next;
      previous.rearm?.(next);
      void previous.close();
      this.lastOutcome = null;
      this.rejoinInFlight = false;
      // Input stays stopped and no reconciler exists until the first accepted delivery of the
      // NEW domain arrives through evaluatePatch() — snapshot recovery precedes any further input.
      this.detach();
      this.attach();
      this.recordRecovery('rejoin-complete', `new domain epoch ${String(next.issuedEpoch())}; awaiting the fresh snapshot`);
      // The snapshot wait is itself deadline-bound: no verified delivery inside it schedules the
      // next bounded attempt (or the suspension), it never leaves the seat silently frozen.
      this.armDeadlineIfNeeded();
    } catch (error) {
      this.rejoinInFlight = false;
      this.recordRecovery('suspended', `rejoin route failed: ${String(error instanceof Error ? error.message : error)}`);
      this.state = 'suspended';
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
