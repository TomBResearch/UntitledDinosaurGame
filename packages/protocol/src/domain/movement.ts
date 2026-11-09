/**
 * Locomotion declarations (interfaces/domain.md A2).
 *
 * UDG-002 declares these shapes only. Locomotion behaviour is UDG-005 and the physics adapter is
 * UDG-006, so nothing here may grow a method body: owner clarification U2-6 keeps movement
 * execution out of this task.
 */

import type { LocomotionState } from './state.js';
import type { CharacterPhysics } from './physics.js';
import type { RouteStore } from './navigation.js';

/** Validated direct-move intent, already normalised by the wire validator when its length exceeded one. */
export interface DirectInput {
  readonly moveX: number;
  readonly moveZ: number;
}

/**
 * Readonly movement values. @udg/config owns the values, their provenance and the hash inputs
 * (packages/config/src/movement.ts); this is the shape that locomotion consumes.
 */
export interface MovementConfig {
  readonly speed: number;
  readonly capsuleRadius: number;
  readonly capsuleHeight: number;
  readonly arrivalTolerance: number;
  readonly gravity: number;
  readonly maxSlopeRadians: number;
  readonly maxStepHeight: number;
}

/** Per-entity scoped environment supplied to one step. */
export interface StepEnvironment {
  readonly collision: CharacterPhysics;
  readonly routes: RouteStore;
}

export interface StepResult {
  readonly state: LocomotionState;
  readonly reachedDestination: boolean;
  readonly blocked: boolean;
}

/**
 * Entity-bound simulator signature. `createLocomotionSimulator(entityId)` binds exactly one entity
 * (interfaces/domain.md 4.1); sharing one mutable simulator between entities is prohibited, which is
 * why `step` takes no entity argument.
 */
export interface LocomotionSimulator {
  step(
    state: LocomotionState,
    input: DirectInput,
    dtSeconds: number,
    config: Readonly<MovementConfig>,
    environment: StepEnvironment,
  ): StepResult;
}
