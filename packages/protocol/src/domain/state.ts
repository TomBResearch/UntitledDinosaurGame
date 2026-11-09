/**
 * Canonical state declarations (interfaces/domain.md A1) plus the domain-side projection of the
 * replicated region (interfaces/protocol.md 4.4).
 *
 * These are the shapes that authority produces and that mapping consumes. Nothing here knows about
 * a schema class, a Room or an encoder.
 */

import type { EntityId, MovementMode, ServerTick, SessionEpoch, Vec3 } from './primitives.js';

/** Authoritative kinematic pose after a completed step. */
export interface KinematicState {
  readonly position: Vec3;
  readonly yaw: number;
  /** Result velocity: resolved displacement per second, including snap and step effects. */
  readonly velocity: Vec3;
  readonly grounded: boolean;
  /**
   * The scalar carried into gravity integration. Distinct from `velocity.y`, which also contains
   * snap and step effects; both are replicated and both are restored (protocol.md 4.4, ADR 0001).
   */
  readonly verticalVelocity: number;
}

/**
 * Route progress. A `revision` of `0` means no route, and then `nextWaypointIndex` must be `0`
 * (owner decision D1 route pair rule). A positive revision with index `0` is an active route at its
 * first waypoint.
 */
export interface RouteProgress {
  readonly revision: number;
  readonly nextWaypointIndex: number;
}

export interface LocomotionState {
  readonly kinematic: KinematicState;
  readonly mode: MovementMode;
  /** `null` in the domain; the wire encodes absence as revision `0` and index `0`. */
  readonly route: RouteProgress | null;
  readonly intentGeneration: number;
  readonly lastAuthorityTick: ServerTick;
}

export interface PlayerSimulationState {
  readonly entityId: EntityId;
  readonly sessionEpoch: SessionEpoch;
  readonly connected: boolean;
  readonly locomotion: LocomotionState;
}

/**
 * Domain view of RegionSchema. The server-private transport-session-to-entity map is deliberately
 * absent: it is never replicated (protocol.md 4.4).
 */
export interface RegionReplicaState {
  readonly worldId: string;
  readonly regionId: string;
  readonly serverTick: ServerTick;
  readonly protocolVersion: string;
  readonly configVersion: string;
  readonly configHash: string;
  readonly manifestHash: string;
}
