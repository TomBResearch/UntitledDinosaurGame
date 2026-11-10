/**
 * The tick body (P03-c): **F → L → Q → S → A → C → R → X**.
 *
 * This is the only module in the authority core that moves a watermark, latches a kind or changes
 * queue membership (P03-b: "admission state is mutated only in stage C, and queue membership only in
 * stages L, Q and C — all of it in one module"). `admit.ts`, `screen.ts` and `commit.ts` return
 * decisions; applying them is only possible here.
 *
 * Stages **M** (map canonical state to the replica) and **P** (publish results, metrics, flush) need a
 * room and a client, so they are Phase 2 work. Phase 1 records what those stages will need — canonical
 * state per entity, terminal results in publication order, the patch cadence — and hands the results
 * back without publishing anything.
 *
 * There is no transport. Lifecycle arrives as internal control arrivals so stage L applies
 * disconnects, expiry and epoch changes **inside the frozen set**, exactly like a message (P03-b).
 */

import { configBounds } from '@udg/config';
import {
  MAX_GENERATION_FORWARD_GAP,
  ROUTE_ABSENT_REVISION,
  TERMINAL_REQUEST_CACHE_SIZE,
  TERMINAL_REQUEST_TTL_SECONDS,
} from '@udg/protocol';
import type {
  DirectInput,
  EntityId,
  Generation,
  MovementMode,
  PlayerSimulationState,
  RejectionCode,
  RegionBounds,
  ServerTick,
  SessionEpoch,
  Vec3,
} from '@udg/protocol';
import type { ServerConfig } from '@udg/config';

import type { FixedStepClock } from './clock.js';
import { ArrivalOrder, buildArrival, buildControlArrival, payloadFromRendered } from './arrival.js';
import { admit, type AdmissionDecision, type OverflowCause } from './admit.js';
import { BatchRegistry } from './bounded.js';
import { planCommit, type CommitPlan } from './commit.js';
import { EntityAuthority, initialState } from './entity.js';
import type { EntityView } from './entity.js';
import { Journal } from './journal.js';
import type { TickChainRecord } from './journal.js';
import {
  arbitrate,
  screenContinuous,
  screenDiscrete,
  type ContinuousScreening,
  type DiscreteScreening,
  type ScreeningContext,
} from './screen.js';
import type { TimeSource } from './determinism.js';
import {
  CONTINUOUS_QUEUE_CAPACITY,
  DISCRETE_QUEUE_CAPACITY_PER_ENTITY,
  DISCRETE_QUEUE_CAPACITY_PER_ROOM,
  dispositionClass,
  dispositionForCode,
} from './types.js';
import type {
  ArbitrationDecision,
  ArbitrationLoser,
  ArrivalOrdinal,
  ArrivalRecord,
  BatchEntry,
  ControlKind,
  Cutoff,
  Disposition,
  DispositionClass,
  EntityStepper,
  HorizontalDrive,
  InputSource,
  IntentionCandidate,
  JournalRow,
  LifecycleStatus,
  PurgedObservation,
  Stage,
  TerminalResult,
} from './types.js';

/**
 * Stage R's input: eligible asynchronous route completions.
 *
 * UDG-003 has no navigation, so the default source yields none and the stage is vacuous — which is a
 * result to measure, not a stage to delete. The seam exists so the stage order is real and so O03's
 * *cutoff* mechanic can be exercised through a journal-level completion stub rather than a fabricated
 * route (readiness proposal §3.5).
 */
export interface RouteCompletion {
  readonly entityId: EntityId;
  readonly generation: Generation;
  readonly ordinal: ArrivalOrdinal;
}

export type RouteCompletionSource = (cutoff: Cutoff) => readonly RouteCompletion[];

export interface EntityRefusal {
  readonly arrival: ArrivalRecord;
  readonly code: RejectionCode;
  readonly disposition: Disposition;
  /** `false` for an arbitration loser: screened refusals are never recorded as losses (P03-g). */
  readonly screened: boolean;
}

export interface EntityAnswer {
  readonly arrival: ArrivalRecord;
  readonly requestId: string;
  readonly dedupe: 'cache' | 'batch';
  readonly code: RejectionCode | null;
}

export interface EntityTickOutcome {
  readonly entityId: EntityId;
  readonly lifecycle: LifecycleStatus;
  readonly stepped: boolean;
  readonly consumed: ArrivalOrdinal | null;
  readonly inputSource: InputSource | null;
  readonly drive: HorizontalDrive;
  readonly watermark: Generation;
  readonly latchedKind: LatchedKindName;
  readonly held: Generation | null;
  readonly modeBefore: MovementMode;
  readonly mode: MovementMode;
  readonly displacement: number;
  readonly desiredDisplacement: number;
  readonly dtSeconds: number;
  readonly candidates: readonly IntentionCandidate[];
  readonly losers: readonly ArbitrationLoser[];
  readonly refused: readonly EntityRefusal[];
  readonly answered: readonly EntityAnswer[];
  readonly purged: readonly PurgedObservation[];
  readonly dropped: readonly ArrivalRecord[];
  readonly events: readonly ControlKind[];
  readonly continuousDepth: number;
  readonly discreteDepth: number;
  readonly keptContinuous: readonly ArrivalOrdinal[];
  readonly keptDiscrete: readonly ArrivalOrdinal[];
}

export type LatchedKindName = CommitPlan['latchedKindAfter'];

export interface TickOutcome {
  readonly tick: ServerTick;
  readonly cutoff: Cutoff;
  readonly stages: readonly Stage[];
  readonly stopped: boolean;
  readonly patched: boolean;
  readonly entities: readonly EntityTickOutcome[];
  readonly results: readonly TerminalResult[];
  readonly routeCompletionsCommitted: number;
  readonly routeCompletionsDiscarded: number;
  readonly journalRows: readonly JournalRow[];
  readonly tickHash: string;
}

export interface AdmissionOutcome {
  readonly arrival: ArrivalRecord;
  readonly decision: AdmissionDecision;
  readonly overflowCause: OverflowCause | null;
}

export interface Reconciliation {
  readonly entityId: EntityId;
  readonly observed: number;
  readonly classes: Readonly<Record<DispositionClass, number>>;
  readonly perDisposition: Readonly<Partial<Record<Disposition, number>>>;
  readonly stillQueued: number;
  /** AC-17, counting what is still queued as `queued`: every observed arrival is accounted once. */
  readonly balanced: boolean;
}

export interface AdmissionStats {
  readonly observed: number;
  readonly counters: Readonly<Partial<Record<Disposition, number>>>;
  readonly continuousHighWater: number;
  readonly discreteHighWater: number;
  readonly cacheDepth: number;
  readonly overflowCauses: Readonly<Partial<Record<OverflowCause, number>>>;
}

/** Control arrivals are server-generated; the same room-wide bound as discrete traffic is enough. */
const CONTROL_QUEUE_CAPACITY = DISCRETE_QUEUE_CAPACITY_PER_ROOM;

export const CAPACITIES = {
  continuousPerClient: CONTINUOUS_QUEUE_CAPACITY,
  discretePerEntity: DISCRETE_QUEUE_CAPACITY_PER_ENTITY,
  discretePerRoom: DISCRETE_QUEUE_CAPACITY_PER_ROOM,
  controlPerRoom: CONTROL_QUEUE_CAPACITY,
  terminalCacheRecords: TERMINAL_REQUEST_CACHE_SIZE,
  terminalCacheTtlMs: TERMINAL_REQUEST_TTL_SECONDS * 1000,
} as const;

export interface AuthorityCoreOptions {
  readonly config: Readonly<ServerConfig>;
  readonly bounds: Readonly<RegionBounds>;
  readonly stepper: EntityStepper;
  readonly time: TimeSource;
  readonly clock: FixedStepClock;
  readonly runId: string;
  readonly regionProvenance: string;
  /** Explicit `| undefined` so a caller may say "no completions" under `exactOptionalPropertyTypes`. */
  readonly routeCompletions?: RouteCompletionSource | undefined;
}

export type AuthorityCoreFailure = {
  readonly reason: 'region-bounds-missing';
  readonly detail: string;
};

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Per-entity work accumulated during a tick, so the tick row can carry the stepped displacement. */
interface PendingEntity {
  readonly outcome: EntityTickOutcome;
  /** `null` for an entity that consumed no source this tick, because no tick row describes it. */
  readonly buildTickRow: ((resolvedDisplacement: number) => JournalRow) | null;
  readonly rows: JournalRow[];
}

/** The transport-independent movement authority. */
export class AuthorityCore {
  readonly runId: string;
  readonly config: Readonly<ServerConfig>;
  readonly bounds: Readonly<RegionBounds>;

  readonly #entities = new Map<EntityId, EntityAuthority>();
  readonly #aliases = new Map<EntityId, string>();
  readonly #initialStates = new Map<EntityId, PlayerSimulationState>();
  readonly #order = new ArrivalOrder();
  readonly #controls: ArrivalRecord[] = [];
  readonly #journal = new Journal();
  readonly #counters = new Map<Disposition, number>();
  readonly #observed = new Map<EntityId, number>();
  readonly #dispositions = new Map<EntityId, Map<Disposition, number>>();
  readonly #overflowCauses = new Map<OverflowCause, number>();
  readonly #recentlyRemoved = new Map<ArrivalOrdinal, ArrivalRecord>();
  #resultRows: JournalRow[] = [];
  readonly #stepper: EntityStepper;
  readonly #clock: FixedStepClock;
  readonly #time: TimeSource;
  readonly #regionProvenance: string;
  readonly #routeCompletions: RouteCompletionSource;
  readonly #gapWindow: number = MAX_GENERATION_FORWARD_GAP;
  #continuousHighWater = 0;
  #discreteHighWater = 0;

  private constructor(options: AuthorityCoreOptions) {
    this.runId = options.runId;
    this.config = options.config;
    this.bounds = options.bounds;
    this.#stepper = options.stepper;
    this.#clock = options.clock;
    this.#time = options.time;
    this.#regionProvenance = options.regionProvenance;
    this.#routeCompletions = options.routeCompletions ?? (() => []);
  }

  /**
   * Build from a validated configuration.
   *
   * Bounds are mandatory: `configBounds` refuses a bounds-null configuration rather than inventing
   * extents, which is the whole content of owner decision D5 and the reason no default exists.
   */
  static build(options: {
    readonly config: Readonly<ServerConfig>;
    readonly stepper: EntityStepper;
    readonly time: TimeSource;
    readonly clock: FixedStepClock;
    readonly runId: string;
    readonly regionProvenance?: string | undefined;
    readonly routeCompletions?: RouteCompletionSource | undefined;
  }): AuthorityCore | AuthorityCoreFailure {
    const bounds = configBounds(options.config);
    if (!bounds.ok) {
      return {
        reason: 'region-bounds-missing',
        detail: bounds.issues[0]?.message ?? 'region bounds are required and no default exists',
      };
    }
    const completions = options.routeCompletions;
    const coreOptions: AuthorityCoreOptions = {
      config: options.config,
      bounds: bounds.value,
      stepper: options.stepper,
      time: options.time,
      clock: options.clock,
      runId: options.runId,
      regionProvenance: options.regionProvenance ?? 'test-only-synthetic',
      ...(completions === undefined ? {} : { routeCompletions: completions }),
    };
    return new AuthorityCore(coreOptions);
  }

  get tick(): ServerTick {
    return this.#clock.tick;
  }

  get journalRows(): readonly JournalRow[] {
    return this.#journal.rows;
  }

  get chainTip(): string {
    return this.#journal.tip;
  }

  /** The per-tick hash chain, one entry per executed tick (P03-g). */
  get chain(): readonly TickChainRecord[] {
    return this.#journal.chain;
  }

  /** Ascending `entityId` by plain `<` on printable-ASCII identifiers; `localeCompare` is not used. */
  get entityIds(): readonly EntityId[] {
    return [...this.#entities.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  aliasFor(entityId: EntityId): string {
    const existing = this.#aliases.get(entityId);
    if (existing !== undefined) return existing;
    const alias = `client-${String(this.#aliases.size + 1).padStart(2, '0')}`;
    this.#aliases.set(entityId, alias);
    return alias;
  }

  view(entityId: EntityId): EntityView | undefined {
    return this.#entities.get(entityId)?.view();
  }

  // --- Ingest -------------------------------------------------------------------------------------

  /** Enqueue one client message. Classify, gate, enqueue: consume nothing, mutate no watermark (P03-b). */
  ingest(entityId: EntityId, raw: unknown, receivedAtMs = this.#time.nowMs()): AdmissionOutcome {
    return this.#enqueue(entityId, raw, null, null, receivedAtMs);
  }

  /** A server-issued join. The spawn position is server-assigned: a client never sets canonical position. */
  join(
    entityId: EntityId,
    sessionEpoch: SessionEpoch,
    spawn: Vec3,
    receivedAtMs = this.#time.nowMs(),
  ): AdmissionOutcome {
    const raw = { control: 'join', sessionEpoch, spawnX: spawn.x, spawnY: spawn.y, spawnZ: spawn.z };
    return this.#enqueue(entityId, raw, 'join', sessionEpoch, receivedAtMs);
  }

  leave(entityId: EntityId, receivedAtMs = this.#time.nowMs()): AdmissionOutcome {
    return this.#enqueue(entityId, { control: 'leave' }, 'leave', null, receivedAtMs);
  }

  expire(entityId: EntityId, receivedAtMs = this.#time.nowMs()): AdmissionOutcome {
    return this.#enqueue(entityId, { control: 'expiry' }, 'expiry', null, receivedAtMs);
  }

  epochChange(
    entityId: EntityId,
    sessionEpoch: SessionEpoch,
    receivedAtMs = this.#time.nowMs(),
  ): AdmissionOutcome {
    return this.#enqueue(
      entityId,
      { control: 'epochChange', sessionEpoch },
      'epochChange',
      sessionEpoch,
      receivedAtMs,
    );
  }

  #enqueue(
    entityId: EntityId,
    raw: unknown,
    control: ControlKind | null,
    sessionEpoch: SessionEpoch | null,
    receivedAtMs: number,
  ): AdmissionOutcome {
    const reserved = this.#order.next();
    if (reserved === 'exhausted') {
      // P03-a: at the ordinal bound admissions are refused and drained. The counter never wraps.
      const arrival = buildArrival({ ordinal: this.#order.current, entityId, raw, receivedAtMs });
      this.#observed.set(entityId, (this.#observed.get(entityId) ?? 0) + 1);
      this.#count('refused:overflow', entityId);
      this.#noteOverflow('ordinal-exhausted');
      this.#journal.push(this.#observationRow(arrival, null, 'refused:overflow', 'RATE_LIMITED', false));
      return {
        arrival,
        decision: {
          ok: false,
          arrival,
          code: 'RATE_LIMITED',
          disposition: 'refused:overflow',
          reason: 'the arrival ordinal reached its bound; admissions are refused and drained',
        },
        overflowCause: 'ordinal-exhausted',
      };
    }

    const arrival =
      control === null
        ? buildArrival({ ordinal: reserved, entityId, raw, receivedAtMs })
        : buildControlArrival({ ordinal: reserved, entityId, control, sessionEpoch, receivedAtMs });

    this.#observed.set(entityId, (this.#observed.get(entityId) ?? 0) + 1);

    const decision = admit(arrival, {
      lifecycleFor: (id) => this.#entities.get(id)?.view().lifecycle ?? null,
      epochFor: (id) => this.#entities.get(id)?.view().epoch ?? null,
    });

    if (!decision.ok) {
      this.#count(decision.disposition, entityId);
      this.#journal.push(this.#observationRow(arrival, null, decision.disposition, decision.code, false));
      return { arrival, decision, overflowCause: null };
    }

    const overflow = this.#enqueueQueued(arrival, decision.queue);
    if (overflow !== null) {
      this.#count('refused:overflow', entityId);
      this.#noteOverflow(overflow);
      this.#journal.push(this.#observationRow(arrival, null, 'refused:overflow', 'RATE_LIMITED', false));
      return {
        arrival,
        decision: {
          ok: false,
          arrival,
          code: 'RATE_LIMITED',
          disposition: 'refused:overflow',
          reason: `the ${decision.queue} queue is at its declared capacity`,
        },
        overflowCause: overflow,
      };
    }

    return { arrival, decision, overflowCause: null };
  }

  #enqueueQueued(
    arrival: ArrivalRecord,
    queue: 'continuous' | 'discrete' | 'control',
  ): OverflowCause | null {
    if (queue === 'control') {
      if (this.#controls.length >= CONTROL_QUEUE_CAPACITY) return 'control-capacity';
      this.#controls.push(arrival);
      return null;
    }
    const entity = this.#entities.get(arrival.entityId);
    if (entity === undefined) return 'control-capacity';
    if (queue === 'continuous') {
      if (!entity.continuousQueue.tryPush(arrival)) return 'continuous-capacity';
      this.#continuousHighWater = Math.max(this.#continuousHighWater, entity.continuousQueue.highWater);
      return null;
    }
    if (this.#totalDiscreteQueued() >= DISCRETE_QUEUE_CAPACITY_PER_ROOM) return 'discrete-capacity-room';
    if (!entity.discreteQueue.tryPush(arrival)) return 'discrete-capacity-entity';
    this.#discreteHighWater = Math.max(this.#discreteHighWater, this.#totalDiscreteQueued());
    return null;
  }

  #totalDiscreteQueued(): number {
    let total = 0;
    for (const entity of this.#entities.values()) total += entity.discreteQueue.size;
    return total;
  }

  // --- The tick -----------------------------------------------------------------------------------

  /**
   * Run exactly one tick, or stop at the `uint32` bound instead of wrapping (protocol.md 4.4).
   *
   * The bound check runs before the cutoff is captured because a refused tick performs no tick work at
   * all; everything else in this method happens strictly after the capture.
   */
  step(): TickOutcome {
    if (this.#clock.atBound) {
      // The counter stops rather than wrapping, so no further tick body runs at all (protocol.md 4.4).
      return {
        tick: this.#clock.tick,
        cutoff: { tick: this.#clock.tick, ordinal: this.#order.current },
        stages: [],
        stopped: true,
        patched: false,
        entities: [],
        results: [],
        routeCompletionsCommitted: 0,
        routeCompletionsDiscarded: 0,
        journalRows: [],
        tickHash: this.#journal.tip,
      };
    }

    // --- F. The first statement of the tick is the cutoff (P03-b).
    const cutoff: Cutoff = { tick: this.#clock.tick, ordinal: this.#order.current };
    const stages: Stage[] = ['F'];
    const rows: JournalRow[] = [];
    const results: TerminalResult[] = [];
    const context: ScreeningContext = this.#contextFor(cutoff.tick);

    // --- L. Lifecycle inside the frozen set: join, leave, expiry, epoch change (P03-c L).
    const due = this.#controls.filter((arrival) => arrival.ordinal <= cutoff.ordinal);
    const deferred = this.#controls.filter((arrival) => arrival.ordinal > cutoff.ordinal);
    this.#controls.length = 0;
    for (const arrival of deferred) this.#controls.push(arrival);
    const eventsByEntity = new Map<EntityId, ControlKind[]>();
    for (const arrival of due) {
      const control = arrival.control;
      if (control === null) continue;
      const kinds = eventsByEntity.get(arrival.entityId) ?? [];
      kinds.push(control);
      eventsByEntity.set(arrival.entityId, kinds);
      this.#applyControl(arrival, control, cutoff, rows);
    }
    stages.push('L');

    // --- Q, S, A, C per entity, ascending entityId (P03-c X ordering applies to the whole pass).
    const pending: PendingEntity[] = [];
    for (const entityId of this.entityIds) {
      const entity = this.#entities.get(entityId);
      if (entity === undefined) continue;
      pending.push(this.#tickEntity(entity, cutoff, context, results, eventsByEntity.get(entityId) ?? []));
    }
    stages.push('Q', 'S', 'A', 'C');

    // --- R. Route completions commit only after the input decision, and only while still current.
    const completions = this.#applyRouteCompletions(cutoff);
    stages.push('R');

    // --- X. Step each connected entity exactly once (P03-c X).
    const entities: EntityTickOutcome[] = [];
    for (const item of pending) {
      for (const row of item.rows) rows.push(row);
      const entity = this.#entities.get(item.outcome.entityId);
      if (entity === undefined) continue;
      const view = entity.view();
      if (!view.connected) {
        rows.push(this.#journal.stateRow(cutoff.tick, view.entityId, view.state));
        rows.push(this.#metaRow(view, cutoff));
        entities.push(item.outcome);
        continue;
      }
      const stepped = this.#stepEntity(entity, item.outcome, cutoff);
      if (item.buildTickRow !== null) rows.push(item.buildTickRow(stepped.displacement));
      rows.push(this.#journal.stateRow(cutoff.tick, stepped.entityId, entity.view().state));
      rows.push(this.#metaRow(entity.view(), cutoff));
      entities.push(stepped);
    }
    stages.push('X');

    const patched = this.#clock.shouldPatchAfter(cutoff.tick);
    // The counter advances after the body, so `cutoff.tick` is both the tick that ran and the tick the
    // journal names.
    this.#clock.advance();
    const chain = this.#journal.chainTick(cutoff.tick, cutoff.ordinal, rows);
    for (const row of rows) this.#journal.push(row);
    // The lookup exists only to name an arrival inside this tick; keeping it across ticks would be an
    // array that grows with the run, which P03-g forbids.
    this.#recentlyRemoved.clear();

    return {
      tick: cutoff.tick,
      cutoff,
      stages,
      stopped: false,
      patched,
      entities,
      results,
      routeCompletionsCommitted: completions.committed,
      routeCompletionsDiscarded: completions.discarded,
      journalRows: rows,
      tickHash: chain.hash,
    };
  }

  run(ticks: number): readonly TickOutcome[] {
    const outcomes: TickOutcome[] = [];
    for (let index = 0; index < ticks; index += 1) {
      const outcome = this.step();
      outcomes.push(outcome);
      if (outcome.stopped) break;
    }
    return outcomes;
  }

  // --- Stage L ------------------------------------------------------------------------------------

  #applyControl(arrival: ArrivalRecord, control: ControlKind, cutoff: Cutoff, rows: JournalRow[]): void {
    const epochAfter = arrival.declaredEpoch;
    const entity = this.#entities.get(arrival.entityId);
    const epochBefore = entity?.view().epoch ?? null;
    const payload = payloadFromRendered(arrival.raw);

    if (control === 'join') {
      if (entity === undefined) {
        const spawn: Vec3 = {
          x: numberOr(payload['spawnX'], 0),
          y: numberOr(payload['spawnY'], 0),
          z: numberOr(payload['spawnZ'], 0),
        };
        const epoch = epochAfter ?? 1;
        this.#entities.set(
          arrival.entityId,
          new EntityAuthority({
            entityId: arrival.entityId,
            sessionEpoch: epoch,
            position: spawn,
            tickOrigin: this.#clock.tickOrigin,
            time: this.#time,
            cacheCapacity: TERMINAL_REQUEST_CACHE_SIZE,
            cacheTtlMs: TERMINAL_REQUEST_TTL_SECONDS * 1000,
          }),
        );
        this.#initialStates.set(arrival.entityId, initialState(arrival.entityId, epoch, spawn));
      } else {
        if (epochAfter !== null && epochAfter !== entity.view().epoch) {
          // A new epoch starts a new generation sequence (protocol.md 4.2).
          entity.writeEpoch(epochAfter);
          entity.resetForNewEpoch();
        }
        entity.writeLifecycle('active');
      }
    } else if (control === 'leave' || control === 'expiry') {
      if (entity !== undefined) {
        const dropped = [...entity.continuousQueue.clear(), ...entity.discreteQueue.clear()];
        for (const item of dropped) {
          this.#count('dropped:lifecycle', entity.entityId);
          rows.push(this.#observationRow(item, cutoff.tick, 'dropped:lifecycle', null, false));
        }
        entity.writeLifecycle(control === 'leave' ? 'idle' : 'departed');
        const state = entity.view().state;
        entity.writeState(
          {
            ...state,
            connected: false,
            locomotion: { ...state.locomotion, mode: 'idle' as const },
          },
          cutoff.tick,
        );
      }
    } else {
      if (entity !== undefined && epochAfter !== null) {
        entity.writeEpoch(epochAfter);
        entity.resetForNewEpoch();
        // Old-epoch queued observations are refused and never stepped (P03-c L).
        this.#refuseEpochMismatched(entity, cutoff, rows);
      }
    }

    rows.push({
      type: 'event',
      arrivalOrdinal: arrival.ordinal,
      alias: this.aliasFor(arrival.entityId),
      entityId: arrival.entityId,
      kind: control,
      epochBefore,
      epochAfter,
      eligibleTick: cutoff.tick,
    });
    this.#count('consumed', arrival.entityId);
    rows.push(this.#observationRow(arrival, cutoff.tick, 'consumed', null, false));
  }

  #refuseEpochMismatched(entity: EntityAuthority, cutoff: Cutoff, rows: JournalRow[]): void {
    const epoch = entity.view().epoch;
    const mismatched = (arrival: ArrivalRecord): boolean =>
      arrival.declaredEpoch !== null && arrival.declaredEpoch !== epoch;
    const removed = [...entity.continuousQueue.removeWhere(mismatched), ...entity.discreteQueue.removeWhere(mismatched)];
    for (const arrival of removed) {
      this.#count('refused:epoch', entity.entityId);
      rows.push(this.#observationRow(arrival, cutoff.tick, 'refused:epoch', 'EPOCH_MISMATCH', false));
    }
  }

  // --- Stages Q, S, A, C for one entity -------------------------------------------------------------

  #tickEntity(
    entity: EntityAuthority,
    cutoff: Cutoff,
    context: ScreeningContext,
    results: TerminalResult[],
    events: readonly ControlKind[],
  ): PendingEntity {
    const rows: JournalRow[] = [];

    // Old-epoch backlog is refused before anything is selected, whatever the lifecycle.
    this.#refuseEpochMismatched(entity, cutoff, rows);
    const view = entity.view();

    if (view.lifecycle !== 'active') {
      // No source is accepted for an idle or departed entity, and it is not stepped (AC-3a).
      return {
        rows,
        buildTickRow: null,
        outcome: {
          entityId: entity.entityId,
          lifecycle: view.lifecycle,
          stepped: false,
          consumed: null,
          inputSource: null,
          drive: 'NONE',
          watermark: view.watermark,
          latchedKind: view.latchedKind,
          held: view.heldDirectGeneration,
          modeBefore: view.state.locomotion.mode,
          mode: view.state.locomotion.mode,
          displacement: 0,
          desiredDisplacement: 0,
          dtSeconds: this.#clock.dtSeconds,
          candidates: [],
          losers: [],
          refused: [],
          answered: [],
          purged: [],
          dropped: [],
          events,
          continuousDepth: view.continuousDepth,
          discreteDepth: view.discreteDepth,
          keptContinuous: view.continuous.map((arrival) => arrival.ordinal),
          keptDiscrete: view.discrete.map((arrival) => arrival.ordinal),
        },
      };
    }

    // --- Q. One continuous observation, the oldest eligible one, kind-blind (P03-c Q). Everything
    //        else eligible stays queued, unrefused.
    const selected = view.continuous.find((arrival) => arrival.ordinal <= cutoff.ordinal) ?? null;
    let screening: ContinuousScreening | null = null;
    if (selected !== null) entity.continuousQueue.shiftOldest();
    const afterQ = entity.view();
    if (selected !== null) screening = screenContinuous(afterQ, selected, context);

    // --- S. Identity first, then the generation window, then navigation (P03-c S).
    const batch = new BatchRegistry<BatchEntry>();
    const eligibleDiscrete = afterQ.discrete.filter((arrival) => arrival.ordinal <= cutoff.ordinal);
    const discrete = screenDiscrete(afterQ, eligibleDiscrete, batch, context);

    // --- A. Rank the surviving intentions (P03-c A).
    const candidates: IntentionCandidate[] = [];
    const continuousCandidate = screening?.candidate;
    if (continuousCandidate !== null && continuousCandidate !== undefined) candidates.push(continuousCandidate);
    for (const candidate of discrete.candidates) candidates.push(candidate);
    const arbitration = arbitrate(candidates);

    // --- C. Commit the winner or take the neutral branch, then purge (P03-c C).
    const plan = planCommit({
      view: afterQ,
      cutoff,
      continuous: screening,
      discrete,
      arbitration,
      tick: cutoff.tick,
      remainingContinuous: afterQ.continuous.filter((arrival) => arrival.ordinal <= cutoff.ordinal),
      discreteQueue: afterQ.discrete,
    });

    const refused: EntityRefusal[] = [];
    const answered: EntityAnswer[] = [];
    this.#applyPlan(entity, plan, discrete, cutoff, results, refused, answered);
    // A frame that stage Q consumed and stage S refused is recorded by its refusal: the consumption is
    // already named by the intention row's `consumed` reference, and counting both would break AC-17.
    if (screening !== null && screening.refusal !== null) {
      refused.unshift({
        arrival: screening.arrival,
        code: screening.refusal,
        disposition: dispositionForCode(screening.refusal),
        screened: true,
      });
    }
    for (const row of this.#resultRows) rows.push(row);
    this.#resultRows = [];

    const after = entity.view();
    rows.push(this.#intentionRow(plan, screening, candidates, cutoff, entity.entityId));
    rows.push(...this.#recordDispositions(plan, screening, cutoff, refused, answered, entity.entityId));

    for (const arrival of after.continuous) {
      rows.push(this.#observationRow(arrival, cutoff.tick, 'queued', null, false));
    }
    for (const arrival of after.discrete) {
      rows.push(this.#observationRow(arrival, cutoff.tick, 'queued', null, false));
    }

    const outcome: EntityTickOutcome = {
      entityId: entity.entityId,
      lifecycle: after.lifecycle,
      stepped: false,
      consumed: plan.consumed?.ordinal ?? null,
      inputSource: plan.inputSource,
      drive: plan.drive,
      watermark: after.watermark,
      latchedKind: plan.latchedKindAfter,
      held: plan.heldAfter,
      modeBefore: plan.modeBefore,
      mode: plan.modeAfter,
      displacement: 0,
      desiredDisplacement: this.#desiredDisplacement(plan.drive),
      dtSeconds: this.#clock.dtSeconds,
      candidates,
      losers: plan.losers,
      refused,
      answered,
      purged: plan.purge,
      dropped: [],
      events,
      continuousDepth: after.continuousDepth,
      discreteDepth: after.discreteDepth,
      keptContinuous: plan.keptContinuous,
      keptDiscrete: plan.keptDiscrete,
    };

    const tickRowBase = {
      tick: cutoff.tick,
      ordinal: cutoff.ordinal,
      alias: this.aliasFor(entity.entityId),
      entityId: entity.entityId,
      consumed: plan.consumed?.ordinal ?? null,
      inputSource: plan.inputSource,
      horizontalDrive: plan.drive,
      intentionCommitted: plan.intentionCommitted,
      modeBefore: plan.modeBefore,
      modeAfter: plan.modeAfter,
      routeRevision: ROUTE_ABSENT_REVISION,
      desiredDisplacement: this.#desiredDisplacement(plan.drive),
      rejection: plan.rejected,
      purgedCount: plan.purge.length,
      purgeReasons: plan.purge.map((item) => item.code),
      dtSeconds: this.#clock.dtSeconds,
    };

    return {
      outcome,
      rows,
      buildTickRow: (resolvedDisplacement: number) =>
        this.#journal.tickRow({ ...tickRowBase, resolvedDisplacement }),
    };
  }

  /**
   * Apply stage C. The watermark, the latch, the caches and the queues move here and nowhere else.
   *
   * Publication order inside a tick is deterministic: screened refusals, then identity answers, then
   * the winner and the arbitration losers. A dedupe answer **replies** with the shared terminal result
   * and writes no new cache record — one record and no second transition for a retried identity
   * (protocol.md 4.3, P03-e T-4 and T-8).
   */
  #applyPlan(
    entity: EntityAuthority,
    plan: CommitPlan,
    discrete: DiscreteScreening,
    cutoff: Cutoff,
    results: TerminalResult[],
    refused: EntityRefusal[],
    answered: EntityAnswer[],
  ): void {
    if (plan.watermarkAfter !== plan.watermarkBefore) entity.writeWatermark(plan.watermarkAfter);
    entity.writeIntentionMetadata(plan.latchedKindAfter, plan.heldAfter);

    // Screened refusals whose identity parsed: cache the terminal refusal, then publish it (T-8).
    for (const write of discrete.cacheWrites) {
      entity.identities.store(write);
      results.push(write.terminal);
      this.#resultRows.push(this.#resultRow(cutoff.tick, entity.entityId, write.terminal, 'none'));
    }

    // Terminal results of the committed intention and of every loser are cached too: protocol.md 4.3
    // retains the terminal result for dedup, not only acceptances.
    for (const publication of plan.intentionPublications) {
      entity.identities.store({
        entityId: entity.entityId,
        sessionEpoch: entity.view().epoch,
        requestId: publication.requestId,
        payloadHash: publication.payloadHash,
        terminal: publication,
        storedAtMs: this.#time.nowMs(),
      });
      results.push(publication);
      this.#resultRows.push(this.#resultRow(cutoff.tick, entity.entityId, publication, 'none'));
    }

    // Answers replay an existing record. They never write one, and never overwrite an identity.
    const terminalByOrdinal = this.#terminalOrdinals(entity.view(), discrete, plan);
    for (const answer of discrete.answers) {
      const shared =
        answer.sharesOrdinal === null ? null : terminalByOrdinal.get(answer.sharesOrdinal) ?? null;
      const terminal = answer.terminal ?? shared;
      if (terminal !== null) {
        results.push(terminal);
        this.#resultRows.push(this.#resultRow(cutoff.tick, entity.entityId, terminal, answer.dedupe));
      } else if (answer.code !== null) {
        // A conflict is itself the answer: it is published as a refusal without a cache write.
        const conflict: TerminalResult = {
          requestId: answer.requestId,
          payloadHash: answer.payloadHash,
          accepted: false,
          appliedTick: null,
          routeRevision: null,
          reason: answer.code,
          recordedTick: cutoff.tick,
        };
        results.push(conflict);
        this.#resultRows.push(this.#resultRow(cutoff.tick, entity.entityId, conflict, answer.dedupe));
      }
    }

    // Dispositions. Exactly one per arrival, so AC-17's arithmetic cannot double-count: a frame that
    // was consumed *and* refused is recorded by its refusal, and its consumption is already named in
    // the intention row's `consumed` reference (P03-g).
    for (const refusal of discrete.refusals) {
      const disposition = dispositionForCode(refusal.code);
      refused.push({ arrival: refusal.arrival, code: refusal.code, disposition, screened: true });
    }
    for (const answer of discrete.answers) {
      answered.push({
        arrival: answer.arrival,
        requestId: answer.requestId,
        dedupe: answer.dedupe,
        code: answer.code,
      });
    }
    for (const loser of plan.losers) {
      const source = this.#arrivalForOrdinal(entity, loser.candidate.ordinal, plan.consumed);
      if (source === null) continue;
      refused.push({
        arrival: source,
        code: loser.code,
        disposition: dispositionForCode(loser.code),
        screened: false,
      });
    }

    const disposeDiscrete = new Set<ArrivalOrdinal>(plan.disposedDiscrete);
    for (const arrival of entity.discreteQueue.removeWhere((item) => disposeDiscrete.has(item.ordinal))) {
      this.#recentlyRemoved.set(arrival.ordinal, arrival);
    }
    if (plan.consumed !== null) this.#recentlyRemoved.set(plan.consumed.ordinal, plan.consumed);
    for (const purged of plan.purge) this.#recentlyRemoved.set(purged.arrival.ordinal, purged.arrival);
    const purgedOrdinals = new Set(plan.purge.map((item) => item.arrival.ordinal));
    if (purgedOrdinals.size > 0) {
      entity.continuousQueue.removeWhere((arrival) => purgedOrdinals.has(arrival.ordinal));
    }
  }

  #terminalOrdinals(
    view: EntityView,
    discrete: DiscreteScreening,
    plan: CommitPlan,
  ): Map<ArrivalOrdinal, TerminalResult> {
    const map = new Map<ArrivalOrdinal, TerminalResult>();
    const byRequest = new Map<string, ArrivalOrdinal>();
    for (const arrival of view.discrete) {
      const requestId = renderedString(arrival, 'requestId');
      if (requestId !== null && !byRequest.has(requestId)) byRequest.set(requestId, arrival.ordinal);
    }
    for (const write of discrete.cacheWrites) {
      const ordinal = byRequest.get(write.requestId);
      if (ordinal !== undefined) map.set(ordinal, write.terminal);
    }
    for (const publication of plan.intentionPublications) {
      const ordinal = byRequest.get(publication.requestId);
      if (ordinal !== undefined && !map.has(ordinal)) map.set(ordinal, publication);
    }
    return map;
  }

  /**
   * Resolve the arrival an intention refers to.
   *
   * A continuous loser is the frame stage Q consumed, which is no longer in any queue, so the consumed
   * reference has to be part of the lookup: without it a frame that lost arbitration would be recorded
   * as a plain consumption and its refusal code would vanish from the journal.
   */
  #arrivalForOrdinal(
    entity: EntityAuthority,
    ordinal: ArrivalOrdinal,
    consumed: ArrivalRecord | null,
  ): ArrivalRecord | null {
    if (consumed !== null && consumed.ordinal === ordinal) return consumed;
    const view = entity.view();
    const discrete = view.discrete.find((arrival) => arrival.ordinal === ordinal);
    if (discrete !== undefined) return discrete;
    const continuous = view.continuous.find((arrival) => arrival.ordinal === ordinal);
    return continuous ?? null;
  }

  /**
   * Record exactly one disposition per arrival and count it once (AC-17, AC-3e).
   *
   * A frame that stage Q consumed and stage S or A refused is recorded by its refusal: the consumption
   * is already named by the intention row's `consumed` reference, and counting it twice would make the
   * reconciliation arithmetic meaningless.
   */
  #recordDispositions(
    plan: CommitPlan,
    screening: ContinuousScreening | null,
    cutoff: Cutoff,
    refused: readonly EntityRefusal[],
    answered: readonly EntityAnswer[],
    entityId: EntityId,
  ): JournalRow[] {
    const decided = new Map<ArrivalOrdinal, { disposition: Disposition; code: RejectionCode | null }>();
    if (plan.consumed !== null) decided.set(plan.consumed.ordinal, { disposition: 'consumed', code: null });
    // A committed discrete intention is consumed by definition — the request became an intention rather
    // than an answer. Stage Q's `consumed` only ever names a continuous observation, so without this the
    // winning request would be observed and never disposed, and AC-17 would not reconcile.
    if (plan.winner !== null && plan.winner.kind !== 'direct') {
      decided.set(plan.winner.ordinal, { disposition: 'consumed', code: null });
    }
    for (const item of refused) {
      decided.set(item.arrival.ordinal, { disposition: item.disposition, code: item.code });
    }
    for (const item of answered) {
      decided.set(item.arrival.ordinal, { disposition: 'answered', code: item.code });
    }
    for (const purged of plan.purge) {
      decided.set(purged.arrival.ordinal, { disposition: 'purged', code: purged.code });
    }

    const rows: JournalRow[] = [];
    for (const [ordinal, entry] of [...decided.entries()].sort((a, b) => a[0] - b[0])) {
      const arrival =
        ordinal === plan.consumed?.ordinal ? plan.consumed : this.#findQueuedOrRefused(entityId, ordinal);
      if (arrival === null) continue;
      this.#count(entry.disposition, entityId);
      const screened =
        screening !== null && screening.arrival.ordinal === ordinal && screening.refusal !== null;
      rows.push(this.#observationRow(arrival, cutoff.tick, entry.disposition, entry.code, screened));
    }
    return rows;
  }

  /** Find the arrival a disposition refers to, whether it is still queued or just removed. */
  #findQueuedOrRefused(entityId: EntityId, ordinal: ArrivalOrdinal): ArrivalRecord | null {
    const found = this.#recentlyRemoved.get(ordinal);
    if (found !== undefined) return found;
    const entity = this.#entities.get(entityId);
    if (entity === undefined) return null;
    const view = entity.view();
    const inQueue =
      view.continuous.find((arrival) => arrival.ordinal === ordinal) ??
      view.discrete.find((arrival) => arrival.ordinal === ordinal);
    return inQueue ?? null;
  }

  #intentionRow(
    plan: CommitPlan,
    screening: ContinuousScreening | null,
    candidates: readonly IntentionCandidate[],
    cutoff: Cutoff,
    entityId: EntityId,
  ): JournalRow {
    const screenedRefusals = [
      ...(screening?.refusal === null || screening?.refusal === undefined
        ? []
        : [{ ordinal: screening.arrival.ordinal, code: screening.refusal }]),
    ];
    return this.#journal.intentionRow({
      tick: cutoff.tick,
      ordinal: cutoff.ordinal,
      alias: this.aliasFor(entityId),
      entityId,
      consumed: plan.consumed?.ordinal ?? null,
      candidates: candidates.map((candidate) => ({
        kind: candidate.kind,
        generation: candidate.generation,
        ordinal: candidate.ordinal,
      })),
      winner:
        plan.winner === null
          ? null
          : { kind: plan.winner.kind, generation: plan.winner.generation, ordinal: plan.winner.ordinal },
      losers: plan.losers.map((loser) => ({
        kind: loser.candidate.kind,
        generation: loser.candidate.generation,
        ordinal: loser.candidate.ordinal,
        code: loser.code,
      })),
      screenedRefusals,
      watermarkBefore: plan.watermarkBefore,
      watermarkAfter: plan.watermarkAfter,
      latchedKindBefore: plan.latchedKindBefore,
      latchedKindAfter: plan.latchedKindAfter,
      heldBefore: plan.heldBefore,
      heldAfter: plan.heldAfter,
    });
  }

  // --- Stage R ------------------------------------------------------------------------------------

  #applyRouteCompletions(cutoff: Cutoff): { committed: number; discarded: number } {
    let committed = 0;
    let discarded = 0;
    for (const completion of this.#routeCompletions(cutoff)) {
      if (completion.ordinal > cutoff.ordinal) continue;
      const entity = this.#entities.get(completion.entityId);
      if (entity === undefined) continue;
      // O12: the input decision is already committed, so a completion that no longer matches the
      // watermark is discarded with a terminal SUPERSEDED rather than committed.
      if (completion.generation !== entity.view().watermark) {
        discarded += 1;
        this.#count('refused:superseded', completion.entityId);
        continue;
      }
      committed += 1;
    }
    return { committed, discarded };
  }

  // --- Stage X ------------------------------------------------------------------------------------

  #stepEntity(entity: EntityAuthority, outcome: EntityTickOutcome, cutoff: Cutoff): EntityTickOutcome {
    const view = entity.view();
    const input: DirectInput =
      outcome.drive === 'NONE'
        ? { moveX: 0, moveZ: 0 }
        : { moveX: outcome.drive.moveX, moveZ: outcome.drive.moveZ };
    const stepped = this.#stepper.step({
      entityId: view.entityId,
      tick: cutoff.tick,
      state: view.state.locomotion,
      input,
      drive: outcome.drive,
      dtSeconds: this.#clock.dtSeconds,
      connected: view.connected,
    });
    // Kinematics belong to the stepper; the replicated authority metadata does not.
    const written: PlayerSimulationState = {
      ...view.state,
      locomotion: {
        ...stepped.state,
        mode: outcome.mode,
        intentGeneration: outcome.watermark,
      },
    };
    entity.writeState(written, cutoff.tick);
    return {
      ...outcome,
      stepped: true,
      displacement: stepped.horizontalDisplacement,
      mode: entity.view().state.locomotion.mode,
    };
  }

  // --- Row and counter helpers ----------------------------------------------------------------------

  #observationRow(
    arrival: ArrivalRecord,
    eligibleTick: ServerTick | null,
    disposition: Disposition,
    reason: RejectionCode | null,
    screened: boolean,
  ): JournalRow {
    return this.#journal.observationRow(arrival, {
      alias: this.aliasFor(arrival.entityId),
      eligibleTick,
      disposition,
      reason,
      screened,
    });
  }

  #resultRow(
    tick: ServerTick,
    entityId: EntityId,
    terminal: TerminalResult,
    dedupe: 'none' | 'cache' | 'batch',
  ): JournalRow {
    return this.#journal.resultRow({
      tick,
      entityId,
      requestId: terminal.requestId,
      payloadHash: terminal.payloadHash,
      accepted: terminal.accepted,
      appliedTick: terminal.appliedTick,
      routeRevision: null,
      reason: terminal.reason,
      dedupe,
      cacheDepth: this.#entities.get(entityId)?.identities.size ?? 0,
    });
  }

  #metaRow(view: EntityView, cutoff: Cutoff): JournalRow {
    const counters: Partial<Record<Disposition, number>> = {};
    const perEntity = this.#dispositions.get(view.entityId);
    if (perEntity !== undefined) {
      for (const [disposition, count] of perEntity) counters[disposition] = count;
    }
    return this.#journal.metaRow({
      tick: cutoff.tick,
      entityId: view.entityId,
      continuousDepth: view.continuousDepth,
      discreteDepth: view.discreteDepth,
      remainingContinuous: view.continuous.map((arrival) => arrival.ordinal),
      remainingDiscrete: view.discrete.map((arrival) => arrival.ordinal),
      counters,
      continuousHighWater: this.#continuousHighWater,
      discreteHighWater: this.#discreteHighWater,
      cacheDepth: view.identities.size,
    });
  }

  #count(disposition: Disposition, entityId: EntityId | null = null): void {
    this.#counters.set(disposition, (this.#counters.get(disposition) ?? 0) + 1);
    if (entityId === null) return;
    const perEntity = this.#dispositions.get(entityId) ?? new Map<Disposition, number>();
    perEntity.set(disposition, (perEntity.get(disposition) ?? 0) + 1);
    this.#dispositions.set(entityId, perEntity);
  }

  #noteOverflow(cause: OverflowCause): void {
    this.#overflowCauses.set(cause, (this.#overflowCauses.get(cause) ?? 0) + 1);
  }

  /**
   * Stages Q, S and A over a snapshot, for the repeat-determinism probe (P03-b).
   *
   * P03-b requires that asking the pure stages the same question twice gives the same answer and produces
   * no transition. In a tick, stage Q also *removes* the frame it selects; that removal is the whole
   * difference, and it is what this seam deliberately does not do. It is not a production path: nothing
   * outside a test calls it, and it returns decisions only.
   */
  askStagesQSA(entityId: EntityId, cutoff: Cutoff): {
    readonly candidates: readonly IntentionCandidate[];
    readonly arbitration: ArbitrationDecision;
  } | null {
    const entity = this.#entities.get(entityId);
    if (entity === undefined) return null;
    const view = entity.view();
    const context = this.#contextFor(cutoff.tick);
    const selected = view.continuous.find((arrival) => arrival.ordinal <= cutoff.ordinal) ?? null;
    const screening = selected === null ? null : screenContinuous(view, selected, context);
    const batch = new BatchRegistry<BatchEntry>();
    const discrete = screenDiscrete(
      view,
      view.discrete.filter((arrival) => arrival.ordinal <= cutoff.ordinal),
      batch,
      context,
    );
    const candidates: IntentionCandidate[] = [];
    const continuousCandidate = screening?.candidate;
    if (continuousCandidate !== null && continuousCandidate !== undefined) candidates.push(continuousCandidate);
    for (const candidate of discrete.candidates) candidates.push(candidate);
    return { candidates, arbitration: arbitrate(candidates) };
  }

  #contextFor(tick: ServerTick): ScreeningContext {
    return {
      bounds: this.bounds,
      gapWindow: this.#gapWindow,
      nowMs: this.#time.nowMs(),
      tick,
    };
  }

  stats(): AdmissionStats {
    const counters: Partial<Record<Disposition, number>> = {};
    for (const [disposition, count] of this.#counters) counters[disposition] = count;
    const causes: Partial<Record<OverflowCause, number>> = {};
    for (const [cause, count] of this.#overflowCauses) causes[cause] = count;
    let cacheDepth = 0;
    for (const entity of this.#entities.values()) cacheDepth += entity.identities.size;
    return {
      observed: [...this.#observed.values()].reduce((total, value) => total + value, 0),
      counters,
      continuousHighWater: this.#continuousHighWater,
      discreteHighWater: this.#discreteHighWater,
      cacheDepth,
      overflowCauses: causes,
    };
  }

  /** AC-17: `consumed + refused + answered + queued == observed`, with each refusal counted once. */
  reconciliation(entityId: EntityId): Reconciliation {
    const observed = this.#observed.get(entityId) ?? 0;
    const perEntity = this.#dispositions.get(entityId) ?? new Map<Disposition, number>();
    const classes: Record<DispositionClass, number> = {
      consumed: 0,
      answered: 0,
      queued: 0,
      refused: 0,
      purged: 0,
      dropped: 0,
    };
    for (const [disposition, count] of perEntity) classes[dispositionClass(disposition)] += count;
    const entity = this.#entities.get(entityId);
    const stillQueued = entity === undefined ? 0 : entity.continuousQueue.size + entity.discreteQueue.size;
    classes.queued += stillQueued;
    const accounted =
      classes.consumed + classes.refused + classes.answered + classes.queued + classes.purged + classes.dropped;
    const perDisposition: Partial<Record<Disposition, number>> = {};
    for (const [disposition, count] of perEntity) perDisposition[disposition] = count;
    return {
      entityId,
      observed,
      classes,
      perDisposition,
      stillQueued,
      balanced: accounted === observed,
    };
  }

  /** The run's prologue: configuration digests and the initial canonical state of every entity. */
  prologue() {
    return this.#journal.prologue({
      runId: this.runId,
      protocolVersion: this.config.protocolVersion,
      configHash: this.#journal.configHash(this.config),
      movementHash: this.#journal.movementHash(this.config),
      regionHash: this.#journal.regionHash(this.config),
      regionProvenance: this.#regionProvenance,
      tickOrigin: this.#clock.tickOrigin,
      dtSeconds: this.#clock.dtSeconds,
      patchIntervalMs: this.#clock.patchIntervalMs,
      movementSpeed: this.config.movement.speed,
      bounds: this.bounds,
      // No random source exists in the authority core, so there is no seed to record (P03-a).
      seeds: null,
      initialEntities: this.entityIds.map((entityId) => {
        const state = this.#initialStates.get(entityId) as PlayerSimulationState;
        return { entityId, state, stateHash: this.#journal.digest(state) };
      }),
    });
  }

  #desiredDisplacement(drive: HorizontalDrive): number {
    if (drive === 'NONE') return 0;
    return Math.hypot(drive.moveX, drive.moveZ) * this.config.movement.speed * this.#clock.dtSeconds;
  }
}

const renderedString = (arrival: ArrivalRecord, field: string): string | null => {
  const rendered = arrival.raw[field];
  if (rendered === undefined || rendered.kind !== 'value') return null;
  return typeof rendered.value === 'string' ? rendered.value : null;
};
