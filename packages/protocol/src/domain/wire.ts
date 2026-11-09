/**
 * UDG-owned transport envelopes and the wire projection (interfaces/protocol.md 4.2).
 *
 * These are proposed UDG contracts, not vendor API shapes. The schema projection of the same fields
 * is declared in ../schema/, and only that directory may import a schema runtime.
 */

import type { Generation, ProtocolVersion, RejectionCode, ServerTick, SessionEpoch, Vec3 } from './primitives.js';

/**
 * Flat fixed-step input sample. Every field is declared, so an absent field is a rejection rather
 * than a default: `directIntent` distinguishes a real direct-control sample, including a release,
 * from a neutral keepalive while path mode owns movement.
 *
 * There is deliberately no position, speed, elapsed time, route, authoritative tick or client
 * sequence counter: the server owns those (baseline §4, protocol.md 4.2).
 */
export interface DirectFrame {
  readonly sessionEpoch: SessionEpoch;
  readonly generation: Generation;
  readonly directIntent: boolean;
  readonly moveX: number;
  readonly moveZ: number;
}

/** Reliable one-shot request. Coordinates are validated against explicitly supplied region bounds. */
export interface MoveToWire {
  readonly requestId: string;
  readonly sessionEpoch: SessionEpoch;
  readonly generation: Generation;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CancelPathWire {
  readonly requestId: string;
  readonly sessionEpoch: SessionEpoch;
  readonly generation: Generation;
}

/** Join metadata. World and region are selected by server room configuration, never by the client. */
export interface JoinWire {
  readonly protocolVersion: ProtocolVersion;
  readonly configHash: string;
  readonly manifestHash: string;
}

/** Domain-side stamp. It is flattened onto the wire and lifted back out of it. */
export interface MovementIntentStamp {
  readonly sessionEpoch: SessionEpoch;
  readonly generation: Generation;
}

/** `ok: false` carries exactly one closed rejection code. */
export type Validation<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: RejectionCode };

/** Message names on the reliable channel (protocol.md 4.2). Continuous movement uses none of them. */
export const WIRE_MESSAGES = {
  moveTo: 'UDG_MOVE_TO',
  cancelPath: 'UDG_CANCEL_PATH',
  movementResult: 'UDG_MOVEMENT_RESULT',
  routeStatus: 'UDG_ROUTE_STATUS',
} as const;

export type WireMessageName = (typeof WIRE_MESSAGES)[keyof typeof WIRE_MESSAGES];

/** The only message name that may carry a movement command result. */
export const MOVEMENT_RESULT_MESSAGE = WIRE_MESSAGES.movementResult;

/**
 * Wire projection: flatten the domain stamp into the two flat wire fields.
 *
 * The projection is pure and total; it validates nothing. Reconstructing a stamp never invents a
 * generation, so `liftStamp` returns exactly what the frame carried.
 */
export const projectStamp = (stamp: MovementIntentStamp): { readonly sessionEpoch: SessionEpoch; readonly generation: Generation } => ({
  sessionEpoch: stamp.sessionEpoch,
  generation: stamp.generation,
});

/** Inverse of {@link projectStamp}. */
export const liftStamp = (frame: {
  readonly sessionEpoch: SessionEpoch;
  readonly generation: Generation;
}): MovementIntentStamp => ({ sessionEpoch: frame.sessionEpoch, generation: frame.generation });

/**
 * Flatten a validated domain request into the wire shape. Kept here so the projection rule
 * ("wire projection flattens MovementIntentStamp into sessionEpoch and generation") has one home.
 */
export const projectMoveTo = (request: {
  readonly requestId: string;
  readonly stamp: MovementIntentStamp;
  readonly destination: Vec3;
}): MoveToWire => ({
  requestId: request.requestId,
  sessionEpoch: request.stamp.sessionEpoch,
  generation: request.stamp.generation,
  x: request.destination.x,
  y: request.destination.y,
  z: request.destination.z,
});

/** Result-side projection of a rejection. `appliedTick` and `routeRevision` are null on rejection. */
export const projectRejection = (
  requestId: string,
  code: RejectionCode,
): {
  readonly requestId: string;
  readonly accepted: false;
  readonly appliedTick: null;
  readonly routeRevision: null;
  readonly reason: RejectionCode;
} => ({ requestId, accepted: false, appliedTick: null, routeRevision: null, reason: code });

/** Server tick carried for correlation only; it is never an input. */
export type WireServerTick = ServerTick;
