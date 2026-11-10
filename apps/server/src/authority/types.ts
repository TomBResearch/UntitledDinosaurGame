/**
 * UDG-003 Phase 1 — shared records for the transport-independent authority core.
 *
 * Every rule encoded by these types comes from the adopted P03 clauses in
 * `docs/contracts/assignments/UDG-003-readiness-proposal.md` §1, cited by id in the modules that
 * implement them. Nothing here imports a transport, a room or a browser API; the only first-party
 * imports are `@udg/protocol` domain types and `@udg/config` hashing, which the boundary rules allow
 * for `@udg/server`.
 *
 * P03-a: no wall clock, no randomness and no scheduling inside this directory. Those arrive as the
 * ports in `determinism.ts`.
 */

import type {
  DirectInput,
  EntityId,
  Generation,
  LocomotionState,
  PlayerSimulationState,
  RejectionCode,
  ServerTick,
  SessionEpoch,
} from '@udg/protocol';

// --- Declared capacities (P03-f, P03-g) ----------------------------------------------------------

/**
 * Continuous observations queued per client: 32, drop-newest on overflow.
 *
 * These bounds are UDG-003 application policy and deliberately live outside `ServerConfig`, so they
 * take no part in `configHash` (readiness proposal D-4): a client must not be able to detect server
 * deployment policy through the shared simulation hash.
 */
export const CONTINUOUS_QUEUE_CAPACITY = 32;

/** Discrete operations queued per entity: 8 (contract §Behaviour, proposal §3.5 queue group). */
export const DISCRETE_QUEUE_CAPACITY_PER_ENTITY = 8;

/** Discrete operations queued per room: 64. */
export const DISCRETE_QUEUE_CAPACITY_PER_ROOM = 64;

/** The ordinal bound above which admissions are refused and drained rather than wrapped (P03-a). */
export const MAX_ARRIVAL_ORDINAL = Number.MAX_SAFE_INTEGER;

// --- Stages, cutoffs and order -------------------------------------------------------------------

/** Monotonic, server-private ingest counter. Never replicated (P03-a). */
export type ArrivalOrdinal = number;

/** The frozen tick boundary: `ordinal` is the cutoff captured before any tick work (P03-b). */
export interface Cutoff {
  readonly tick: ServerTick;
  readonly ordinal: ArrivalOrdinal;
}

/** P03-c stage order. `M` and `P` need a replica and a client, so Phase 1 implements up to `X`. */
export const STAGE_ORDER = ['F', 'L', 'Q', 'S', 'A', 'C', 'R', 'X'] as const;
export type Stage = (typeof STAGE_ORDER)[number];

/** The message classes the ingest path can distinguish before validation. */
export type MessageKind = 'direct' | 'moveTo' | 'cancelPath' | 'unknownMessage';

/** P03-c stage L lifecycle events, carried as internal control arrivals (P03-b: they queue too). */
export type ControlKind = 'join' | 'leave' | 'expiry' | 'epochChange';

/** The journal's observation vocabulary (P03-g `observation.kind`). */
export type ObservationKind = 'direct' | 'keepalive' | 'cancel' | 'moveTo' | 'unknownMessage' | 'control';

/** Intention kinds ranked by arbitration. `path` is unreachable in UDG-003 (P03-h, AC-8). */
export type IntentionKind = 'direct' | 'cancel' | 'path';

/** `latchedKind` — `none` before the first committed intention (P03-c state). */
export type LatchedKind = 'none' | IntentionKind;

/** Kind precedence, lower wins; kind precedence **overrides** arrival order (P03-c A, O02). */
export const KIND_PRECEDENCE: Readonly<Record<IntentionKind, number>> = {
  direct: 0,
  cancel: 1,
  path: 2,
};

/** This tick's horizontal drive, deliberately separate from intention metadata (P03-c state). */
export type HorizontalDrive = 'NONE' | { readonly moveX: number; readonly moveZ: number };

export const NEUTRAL_DRIVE: HorizontalDrive = 'NONE';

/** Entity lifecycle as the core sees it. Only `active` entities are connected, and only connected
 *  entities are stepped (AC-3a). */
export type LifecycleStatus = 'active' | 'idle' | 'departed';

// --- Dispositions -------------------------------------------------------------------------------

/**
 * Every disposal is attributable and counted by reason (P03-d, AC-3e).
 *
 * `purged` and `dropped:lifecycle` are dispositions too: a purged or dropped observation is
 * **refused, not consumed** — it produced no step and no drive, and the reconciliation in AC-17
 * counts it once.
 */
export type Disposition =
  | 'consumed'
  | 'answered'
  | 'queued'
  | 'purged'
  | 'dropped:lifecycle'
  | 'refused:overflow'
  | 'refused:superseded'
  | 'refused:epoch'
  | 'refused:structural'
  | 'refused:generation'
  | 'refused:navigation';

/** The AC-17 reconciliation classes: `consumed + refused + answered + queued == observed`. */
export type DispositionClass = 'consumed' | 'answered' | 'queued' | 'refused' | 'purged' | 'dropped';

export const dispositionClass = (disposition: Disposition): DispositionClass => {
  switch (disposition) {
    case 'consumed':
      return 'consumed';
    case 'answered':
      return 'answered';
    case 'queued':
      return 'queued';
    case 'purged':
      return 'purged';
    case 'dropped:lifecycle':
      return 'dropped';
    default:
      return 'refused';
  }
};

/**
 * Map a protocol rejection code onto the honest disposition.
 *
 * `REQUEST_ID_CONFLICT` is an *answer* rather than a refusal, because identity authorised it: the
 * cache is what decided the reply, and no state transition happened (P03-e T-8).
 */
export const dispositionForCode = (code: RejectionCode): Disposition => {
  switch (code) {
    case 'SUPERSEDED':
      return 'refused:superseded';
    case 'EPOCH_MISMATCH':
      return 'refused:epoch';
    case 'INVALID_GENERATION':
    case 'RESYNC_REQUIRED':
      return 'refused:generation';
    case 'RATE_LIMITED':
      return 'refused:overflow';
    case 'NAVIGATION_BUSY':
    case 'OUT_OF_BOUNDS':
    case 'INVALID_DESTINATION':
    case 'UNREACHABLE':
      return 'refused:navigation';
    case 'REQUEST_ID_CONFLICT':
      return 'answered';
    default:
      return 'refused:structural';
  }
};

export const REASON_CODES = [
  'INVALID_PAYLOAD',
  'INVALID_GENERATION',
  'RESYNC_REQUIRED',
  'SUPERSEDED',
  'EPOCH_MISMATCH',
  'RATE_LIMITED',
  'NAVIGATION_BUSY',
  'OUT_OF_BOUNDS',
  'REQUEST_ID_CONFLICT',
] as const satisfies readonly RejectionCode[];

// --- Raw payload rendering (P03-g copy-on-record, AC-20) -----------------------------------------

/**
 * A canonical rendering of one decoded field.
 *
 * Screening must be re-runnable from the journal alone (AC-20), so a well-formed scalar is recorded
 * exactly as decoded. Values JSON cannot carry (`NaN`, `Infinity`, objects, functions) are rendered
 * with their type and replayed as `INVALID_PAYLOAD`-shaped placeholders, which reproduces the
 * refusal without silently dropping the field.
 */
export type RenderedValue =
  | { readonly kind: 'value'; readonly value: string | number | boolean | null }
  | { readonly kind: 'invalid'; readonly type: string; readonly render: string };

export const RENDERED_INVALID_PREFIX = '<invalid:';

// --- Arrivals ------------------------------------------------------------------------------------

/** One ingested message, copied and frozen at intake so later mutation of the source changes nothing. */
export interface ArrivalRecord {
  readonly ordinal: ArrivalOrdinal;
  readonly entityId: EntityId;
  readonly kind: MessageKind;
  readonly control: ControlKind | null;
  /** The epoch the arrival declares, or the epoch the control event carries. `null` when unparsable. */
  readonly declaredEpoch: SessionEpoch | null;
  /** The generation the arrival declares. `null` when the payload carried none that parsed. */
  readonly declaredGeneration: Generation | null;
  /** The epoch and generation the journal records, from the rendered payload. */
  readonly observationKind: ObservationKind;
  /** Frozen, JSON-safe copy of the payload as decoded (P03-g copy-on-record). */
  readonly raw: Readonly<Record<string, RenderedValue>>;
  /** `canonicalHash` over the rendered payload, for provenance. */
  readonly rawHash: string;
  readonly receivedAtMs: number;
  /** Fields whose decoded value was not JSON-representable. */
  readonly malformed: readonly string[];
}

// --- Screening, arbitration, commit ---------------------------------------------------------------

/** One intention candidate entering stage A. `path` is never constructed in UDG-003 (AC-8). */
export interface IntentionCandidate {
  readonly kind: IntentionKind;
  readonly generation: Generation;
  readonly ordinal: ArrivalOrdinal;
  /** The continuous axes, for a `direct` candidate only. */
  readonly axes: DirectInput | null;
  readonly requestId: string | null;
  readonly payloadHash: string | null;
}

/** An arbitration loser, with the code its relation to the winner gives it (P03-c A). */
export interface ArbitrationLoser {
  readonly candidate: IntentionCandidate;
  readonly code: RejectionCode;
}

export interface ArbitrationDecision {
  /** `null` when the candidate set is empty; the neutral branch then applies (P03-c C, AC-18). */
  readonly winner: IntentionCandidate | null;
  readonly losers: readonly ArbitrationLoser[];
}

/** A screened refusal. Screened refusals are recorded separately from arbitration losers (P03-g). */
export interface ScreenedRefusal {
  readonly arrival: ArrivalRecord;
  readonly code: RejectionCode;
  readonly stage: 'S';
  /** Whether a terminal cache record was written (identity must have parsed). */
  readonly cached: boolean;
}

/** A dedupe answer from the persistent cache or this tick's batch registry (P03-e T-4, T-8). */
export interface IdentityAnswer {
  readonly arrival: ArrivalRecord;
  readonly requestId: string;
  readonly payloadHash: string;
  readonly dedupe: 'cache' | 'batch';
  readonly code: RejectionCode | null;
  readonly terminal: TerminalResult | null;
}

/** The terminal result protocol.md 4.3 caches for dedup — acceptances **and** refusals. */
export interface TerminalResult {
  readonly requestId: string;
  readonly payloadHash: string;
  readonly accepted: boolean;
  readonly appliedTick: ServerTick | null;
  /** Always `null` in UDG-003: no route can exist, so no revision can be reported. */
  readonly routeRevision: null;
  readonly reason: RejectionCode | null;
  readonly recordedTick: ServerTick;
}

/** What the persistent identity cache remembers, keyed by `(entityId, epoch, requestId)`. */
export interface CachedIdentity {
  readonly entityId: EntityId;
  readonly sessionEpoch: SessionEpoch;
  readonly requestId: string;
  readonly payloadHash: string;
  readonly terminal: TerminalResult;
  readonly storedAtMs: number;
}

/** The per-tick batch registry (`batchIds` in P03-d). */
export interface BatchEntry {
  readonly requestId: string;
  readonly payloadHash: string;
  readonly ordinal: ArrivalOrdinal;
}

/** A purge candidate computed by stage C: refused, never consumed (P03-f). */
export interface PurgedObservation {
  readonly arrival: ArrivalRecord;
  readonly code: RejectionCode;
}

export type InputSource = 'direct' | 'keepalive' | 'neutral' | 'rejected';

/** The stage C decision, before any mutation (P03-c C). */
export interface CommitDecision {
  readonly winner: IntentionCandidate | null;
  readonly losers: readonly ArbitrationLoser[];
  readonly watermarkBefore: Generation;
  readonly watermarkAfter: Generation;
  readonly latchedKindBefore: LatchedKind;
  readonly latchedKindAfter: LatchedKind;
  readonly heldBefore: Generation | null;
  readonly heldAfter: Generation | null;
  readonly drive: HorizontalDrive;
  readonly inputSource: InputSource;
  readonly modeBefore: LocomotionState['mode'];
  readonly modeAfter: LocomotionState['mode'];
  readonly intentionCommitted: boolean;
  readonly purge: readonly PurgedObservation[];
  readonly terminal: TerminalResult | null;
  /** The observation consumed by stage Q, if any. */
  readonly consumed: ArrivalRecord | null;
  readonly keptContinuous: readonly ArrivalOrdinal[];
  readonly keptDiscrete: readonly ArrivalOrdinal[];
}

// --- Stepping ------------------------------------------------------------------------------------

/**
 * The movement seam.
 *
 * UDG-003 implements no locomotion: UDG-005's `LocomotionSimulator` will sit behind this port,
 * adapted in Phase 2's `MovementAuthorityAdapter`. Phase 1 needs only "step this entity once with
 * this input for this `dt`", plus the resolved horizontal displacement so AC-2 is measured.
 */
export interface StepRequest {
  readonly entityId: EntityId;
  readonly tick: ServerTick;
  readonly state: Readonly<LocomotionState>;
  readonly input: DirectInput;
  readonly drive: HorizontalDrive;
  readonly dtSeconds: number;
  readonly connected: boolean;
}

export interface StepOutcome {
  readonly state: LocomotionState;
  readonly horizontalDisplacement: number;
}

export interface EntityStepper {
  step(request: StepRequest): StepOutcome;
}

// --- Journal (P03-g) ----------------------------------------------------------------------------

/**
 * Where an arrival came from, as decided by the server that recorded it.
 *
 * This is **trusted provenance**, and it exists because a payload field is not evidence of one. A client
 * message that carries a `control` field is still a client message: it is refused by the admission gate and
 * it stays a client message in the journal. Lifecycle replay is driven by `origin`, never by reading a
 * payload field back - otherwise a refused message could become a `leave()` on the second run (reviewer
 * correction 1, Phase 1).
 */
export type ArrivalOrigin = 'server-lifecycle' | 'client-payload';

/**
 * The time basis a journal was recorded on (reviewer correction 2, Phase 1).
 *
 * The terminal-request cache TTL is 30 s of the injected `TimeSource`, so a replay that invents its own time
 * cannot reproduce a decision that sat near the boundary. `recorded-clock-readings` means each arrival row
 * and each tick chain record carries the `TimeSource` reading that was actually in force when the decision
 * was made, and the replay restores those readings instead of deriving a clock from tick indices.
 */
export type JournalTimeBasis = 'recorded-clock-readings';

/** What a replay must restore before it feeds the arrival it is attached to. */
export const TIME_BASIS: JournalTimeBasis = 'recorded-clock-readings';

export interface PrologueRow {
  readonly type: 'prologue';
  readonly runId: string;
  readonly protocolVersion: string;
  readonly configHash: string;
  readonly movementHash: string;
  readonly regionHash: string;
  readonly regionProvenance: string;
  readonly tickOrigin: ServerTick;
  readonly dtSeconds: number;
  readonly patchIntervalMs: number;
  readonly movementSpeed: number;
  readonly bounds: unknown;
  readonly seeds: null;
  /** How a replay is to reconstruct the clock that produced these decisions. */
  readonly timeBasis: JournalTimeBasis;
  /** The `TimeSource` reading at construction, so a replay can tell restored time from zero. */
  readonly timeOriginMs: number;
  /**
   * The entities present when the prologue was created.
   *
   * In Phase 1 that is always none: every entity enters through a join *input*, and the canonical state a
   * join started from is journalled on that join's event row. Recording it here instead would mean the core
   * had to remember every entity it ever admitted, which is the growth correction 3 removes.
   */
  readonly initialEntities: readonly {
    readonly entityId: EntityId;
    readonly state: PlayerSimulationState;
    readonly stateHash: string;
  }[];
}

export interface EventRow {
  readonly type: 'event';
  readonly arrivalOrdinal: ArrivalOrdinal;
  readonly alias: string;
  readonly entityId: EntityId;
  readonly kind: ControlKind;
  readonly epochBefore: SessionEpoch | null;
  readonly epochAfter: SessionEpoch | null;
  readonly eligibleTick: ServerTick;
  /** Always `server-lifecycle`: an event row is only ever written by stage L from a server call. */
  readonly origin: ArrivalOrigin;
  /** The `TimeSource` reading this event was recorded at, for replay to restore (reviewer correction 2). */
  readonly atMs: number;
  /**
   * The canonical state a join started from, and its digest; `null` on every other event.
   *
   * It lives here rather than in the prologue because an entity that arrives mid-run has no place in a
   * prologue written at construction, and because the core must not retain "every entity this run ever saw"
   * just so the prologue could name them later (reviewer correction 3).
   */
  readonly initialState: PlayerSimulationState | null;
  readonly initialStateHash: string | null;
}

export interface ObservationRow {
  readonly type: 'observation';
  readonly arrivalOrdinal: ArrivalOrdinal;
  readonly eligibleTick: ServerTick | null;
  readonly alias: string;
  readonly entityId: EntityId;
  readonly kind: ObservationKind;
  readonly epoch: SessionEpoch | null;
  readonly generation: Generation | null;
  readonly directIntent: boolean | null;
  readonly raw: Readonly<Record<string, RenderedValue>>;
  readonly rawHash: string;
  readonly malformed: readonly string[];
  readonly requestId: string | null;
  readonly payloadHash: string | null;
  readonly disposition: Disposition;
  readonly reason: RejectionCode | null;
  /** Recorded separately from arbitration losers, so a `NAVIGATION_BUSY` is never a loss (P03-g). */
  readonly screened: boolean;
  /** `null` with the limitation recorded: there is no transport in Phase 1, so there is no SDK frame identity. */
  readonly sdkFrameIdentity: null;
  /**
   * Trusted provenance, assigned by the server that recorded the row. `control` is only ever meaningful
   * when this says `server-lifecycle`, and the row builder takes both from the arrival's server-side
   * classification - never from `raw`.
   */
  readonly origin: ArrivalOrigin;
  /** The server-issued lifecycle operation, or `null` for any client message however it is shaped. */
  readonly control: ControlKind | null;
  /** The `TimeSource` reading in force when this arrival was recorded (reviewer correction 2). */
  readonly atMs: number;
}

export interface IntentionRow {
  readonly type: 'intention';
  readonly tick: ServerTick;
  readonly ordinal: ArrivalOrdinal;
  readonly alias: string;
  readonly entityId: EntityId;
  readonly consumed: ArrivalOrdinal | null;
  readonly candidates: readonly {
    readonly kind: IntentionKind;
    readonly generation: Generation;
    readonly ordinal: ArrivalOrdinal;
  }[];
  readonly winner: { readonly kind: IntentionKind; readonly generation: Generation; readonly ordinal: ArrivalOrdinal } | null;
  readonly losers: readonly {
    readonly kind: IntentionKind;
    readonly generation: Generation;
    readonly ordinal: ArrivalOrdinal;
    readonly code: RejectionCode;
  }[];
  readonly screenedRefusals: readonly { readonly ordinal: ArrivalOrdinal; readonly code: RejectionCode }[];
  readonly watermarkBefore: Generation;
  readonly watermarkAfter: Generation;
  readonly latchedKindBefore: LatchedKind;
  readonly latchedKindAfter: LatchedKind;
  readonly heldBefore: Generation | null;
  readonly heldAfter: Generation | null;
}

export interface TickRow {
  readonly type: 'tick';
  readonly tick: ServerTick;
  readonly ordinal: ArrivalOrdinal;
  readonly alias: string;
  readonly entityId: EntityId;
  readonly consumed: ArrivalOrdinal | null;
  readonly inputSource: InputSource;
  readonly horizontalDrive: HorizontalDrive;
  readonly intentionCommitted: boolean;
  readonly modeBefore: LocomotionState['mode'];
  readonly modeAfter: LocomotionState['mode'];
  readonly routeRevision: number;
  readonly desiredDisplacement: number;
  readonly resolvedDisplacement: number;
  readonly rejection: RejectionCode | null;
  readonly purgedCount: number;
  readonly purgeReasons: readonly RejectionCode[];
  readonly dtSeconds: number;
}

export interface ResultRow {
  readonly type: 'result';
  readonly tick: ServerTick;
  readonly entityId: EntityId;
  readonly requestId: string;
  readonly payloadHash: string;
  readonly accepted: boolean;
  readonly appliedTick: ServerTick | null;
  readonly routeRevision: null;
  readonly reason: RejectionCode | null;
  readonly dedupe: 'none' | 'cache' | 'batch';
  readonly cacheDepth: number;
}

export interface StateRow {
  readonly type: 'state';
  readonly tick: ServerTick;
  readonly entityId: EntityId;
  readonly state: PlayerSimulationState;
  readonly stateHash: string;
}

export interface MetaRow {
  readonly type: 'meta';
  readonly tick: ServerTick;
  readonly entityId: EntityId;
  readonly continuousDepth: number;
  readonly discreteDepth: number;
  readonly remainingContinuous: readonly ArrivalOrdinal[];
  readonly remainingDiscrete: readonly ArrivalOrdinal[];
  readonly counters: Readonly<Partial<Record<Disposition, number>>>;
  readonly continuousHighWater: number;
  readonly discreteHighWater: number;
  readonly cacheDepth: number;
}

/** Everything the journal can contain. A journal of `state` rows alone fails AC-14. */
export type JournalRow =
  | PrologueRow
  | EventRow
  | ObservationRow
  | IntentionRow
  | TickRow
  | ResultRow
  | StateRow
  | MetaRow;

export type JournalRowType = JournalRow['type'];

export const JOURNAL_ROW_TYPES: readonly JournalRowType[] = [
  'prologue',
  'event',
  'observation',
  'intention',
  'tick',
  'result',
  'state',
  'meta',
];

/**
 * The tick-schedule projection used as a replay input.
 *
 * A replay needs the same ingest interleaving as the original run, so a boundary carries the tick and
 * the ordinal the cutoff froze. Neither is a *decision*: the selection, winner, loser codes,
 * dispositions, watermark trajectory and state digests are all recomputed and then compared
 * (P03-g "Digests and candidate summaries are comparison outputs, never replay inputs", AC-20).
 */
export interface ReplayTickBoundary {
  readonly tick: ServerTick;
  readonly cutoffOrdinal: ArrivalOrdinal;
  /** The `TimeSource` reading the original tick body ran under; restored before the replay steps (correction 2). */
  readonly atMs: number;
}
