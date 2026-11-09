/**
 * Physics adapter declarations (interfaces/domain.md A4).
 *
 * Every call is entity-scoped because one collider set belongs to one entity. Implementation is
 * UDG-006 (P07 pending); collision ownership and adoption behaviour are baseline rules that this
 * declaration preserves rather than restates.
 */

import type { EntityId, Vec3 } from './primitives.js';
import type { KinematicState } from './state.js';

export interface CharacterPhysicsConfig {
  readonly radius: number;
  readonly totalHeight: number;
  readonly collisionGroup: number;
}

export interface PhysicsResolution {
  readonly kinematic: KinematicState;
  readonly actualDisplacement: Vec3;
  readonly blocked: boolean;
}

/** One physics adapter owns collider creation, movement, restoration and removal. */
export interface CharacterPhysics {
  createCharacter(entityId: EntityId, initial: KinematicState, config: CharacterPhysicsConfig): void;
  resolveMovement(
    entityId: EntityId,
    canonical: KinematicState,
    desiredDisplacement: Vec3,
    dtSeconds: number,
  ): PhysicsResolution;
  adoptAuthoritativeState(entityId: EntityId, state: KinematicState): void;
  removeCharacter(entityId: EntityId): void;
  dispose(): void;
}
