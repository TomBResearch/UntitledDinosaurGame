/**
 * Per entity/epoch authority state (P03-d).
 *
 * The canonical state is the adopted `PlayerSimulationState`/`LocomotionState` pair from
 * `@udg/protocol` — no second state shape is invented. The mapping P03-g's `state` row uses is:
 *
 * | P03 name | canonical field |
 * | --- | --- |
 * | `H` (highest admitted generation) | `locomotion.intentGeneration` |
 * | `movementMode` | `locomotion.mode` |
 * | route fields | `locomotion.route` — always `null` in UDG-003, because no route can exist (AC-8) |
 * | `lastAuthorityTick` | `locomotion.lastAuthorityTick` |
 * | `sessionEpoch`, `connected` | the same-named fields on `PlayerSimulationState` |
 *
 * `H`, `latchedKind` and `G_d` are intention *admission* metadata and deliberately not part of the
 * replicated state; `horizontalDrive` is per tick and lives only in the tick decision.
 *
 * Only `step.ts` mutates an entity (P03-b). Everything else receives {@link EntityView}, a read-only
 * projection built from snapshots.
 */

import type {
  EntityId,
  Generation,
  LocomotionState,
  PlayerSimulationState,
  ServerTick,
  SessionEpoch,
  Vec3,
} from '@udg/protocol';

import { IdentityCache } from './bounded.js';
import type { IdentityEntry } from './bounded.js';
import type { TimeSource } from './determinism.js';
import type { ArrivalRecord, LifecycleStatus, LatchedKind } from './types.js';
import {
  CONTINUOUS_QUEUE_CAPACITY,
  DISCRETE_QUEUE_CAPACITY_PER_ENTITY,
} from './types.js';
import { BoundedFifo } from './bounded.js';

/** The read-only surface screening and arbitration are allowed to see. */
export interface IdentityReader {
  readonly size: number;
  lookup(entityId: string, sessionEpoch: number, requestId: string): IdentityEntry | undefined;
}

export interface EntityView {
  readonly entityId: EntityId;
  readonly epoch: SessionEpoch;
  readonly lifecycle: LifecycleStatus;
  readonly connected: boolean;
  readonly watermark: Generation;
  readonly latchedKind: LatchedKind;
  readonly heldDirectGeneration: Generation | null;
  readonly continuous: readonly ArrivalRecord[];
  readonly discrete: readonly ArrivalRecord[];
  readonly state: Readonly<PlayerSimulationState>;
  readonly identities: IdentityReader;
  readonly continuousDepth: number;
  readonly discreteDepth: number;
}

export const initialLocomotionState = (position: Vec3, yawRadians = 0): LocomotionState =>
  Object.freeze({
    kinematic: Object.freeze({
      position: Object.freeze({ ...position }),
      yaw: yawRadians,
      velocity: Object.freeze({ x: 0, y: 0, z: 0 }),
      grounded: true,
      verticalVelocity: 0,
    }),
    mode: 'idle' as const,
    route: null,
    intentGeneration: 0,
    lastAuthorityTick: 0,
  });

export const initialState = (
  entityId: EntityId,
  sessionEpoch: SessionEpoch,
  position: Vec3,
  connected = true,
): PlayerSimulationState =>
  Object.freeze({
    entityId,
    sessionEpoch,
    connected,
    locomotion: initialLocomotionState(position),
  });

export interface EntityAuthorityOptions {
  readonly entityId: EntityId;
  readonly sessionEpoch: SessionEpoch;
  readonly position: Vec3;
  readonly tickOrigin: ServerTick;
  readonly time: TimeSource;
  readonly cacheCapacity: number;
  readonly cacheTtlMs: number;
}

/** The mutable entity. Construction is the only public writer; afterwards `step.ts` drives it. */
export class EntityAuthority {
  readonly entityId: EntityId;
  readonly continuousQueue: BoundedFifo<ArrivalRecord>;
  readonly discreteQueue: BoundedFifo<ArrivalRecord>;
  readonly identities: IdentityCache;

  #epoch: SessionEpoch;
  #lifecycle: LifecycleStatus = 'active';
  #watermark: Generation = 0;
  #latchedKind: LatchedKind = 'none';
  #heldDirectGeneration: Generation | null = null;
  #state: PlayerSimulationState;

  constructor(options: EntityAuthorityOptions) {
    this.entityId = options.entityId;
    this.#epoch = options.sessionEpoch;
    this.#state = initialState(options.entityId, options.sessionEpoch, options.position);
    this.continuousQueue = new BoundedFifo<ArrivalRecord>(CONTINUOUS_QUEUE_CAPACITY);
    this.discreteQueue = new BoundedFifo<ArrivalRecord>(DISCRETE_QUEUE_CAPACITY_PER_ENTITY);
    this.identities = new IdentityCache(options.cacheCapacity, options.cacheTtlMs, options.time);
  }

  /** The projection every pure stage receives. Snapshots, so a stage cannot write through it. */
  view(): EntityView {
    return {
      entityId: this.entityId,
      epoch: this.#epoch,
      lifecycle: this.#lifecycle,
      connected: this.#lifecycle === 'active',
      watermark: this.#watermark,
      latchedKind: this.#latchedKind,
      heldDirectGeneration: this.#heldDirectGeneration,
      continuous: this.continuousQueue.snapshot(),
      discrete: this.discreteQueue.snapshot(),
      state: this.#state,
      identities: this.identities,
      continuousDepth: this.continuousQueue.size,
      discreteDepth: this.discreteQueue.size,
    };
  }

  /** The state as it will be written by a commit, without writing it. */
  peekState(): Readonly<PlayerSimulationState> {
    return this.#state;
  }

  // --- Writers, called only from `step.ts` -------------------------------------------------------

  writeState(state: PlayerSimulationState, tick: ServerTick): void {
    this.#state = Object.freeze({
      ...state,
      sessionEpoch: this.#epoch,
      connected: this.#lifecycle === 'active',
      locomotion: Object.freeze({ ...state.locomotion, lastAuthorityTick: tick }),
    });
  }

  writeWatermark(value: Generation): void {
    if (value < this.#watermark) {
      // P03-d: the watermark never moves backwards, in any branch.
      throw new Error(
        `watermark regression for ${this.entityId}: ${String(this.#watermark)} -> ${String(value)}`,
      );
    }
    this.#watermark = value;
  }

  writeIntentionMetadata(kind: LatchedKind, heldDirectGeneration: Generation | null): void {
    this.#latchedKind = kind;
    this.#heldDirectGeneration = heldDirectGeneration;
  }

  writeEpoch(sessionEpoch: SessionEpoch): void {
    this.#epoch = sessionEpoch;
  }

  writeLifecycle(status: LifecycleStatus): void {
    this.#lifecycle = status;
  }

  /** A new epoch starts a new generation sequence, so the watermark and latch reset (protocol.md 4.2). */
  resetForNewEpoch(): void {
    this.#watermark = 0;
    this.#latchedKind = 'none';
    this.#heldDirectGeneration = null;
  }
}
