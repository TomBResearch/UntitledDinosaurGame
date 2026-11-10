/**
 * Message builders for the Phase 1 authority suites.
 *
 * The payloads are written as the *wire* shape, because that is what the core receives: the ingest path
 * classifies on declared fields and the protocol validators decide validity. A builder that produced an
 * already-validated domain object would hide the exact behaviour these suites are about.
 */

import type { Generation, SessionEpoch, Vec3 } from '../../../packages/protocol/dist/index.js';

export interface FramePayload {
  readonly sessionEpoch: SessionEpoch;
  readonly generation: Generation;
  readonly directIntent: boolean;
  readonly moveX: number;
  readonly moveZ: number;
}

/** A `directIntent: true` frame. Axes are not normalised here: the protocol validator does that. */
export const frame = (
  sessionEpoch: SessionEpoch,
  generation: Generation,
  moveX: number,
  moveZ = 0,
): FramePayload => ({ sessionEpoch, generation, directIntent: true, moveX, moveZ });

/** A `directIntent: false` keepalive: an observation, never an intention (P03-f). */
export const keepalive = (sessionEpoch: SessionEpoch, generation: Generation): FramePayload => ({
  sessionEpoch,
  generation,
  directIntent: false,
  moveX: 0,
  moveZ: 0,
});

export interface MoveToPayload {
  readonly requestId: string;
  readonly sessionEpoch: SessionEpoch;
  readonly generation: Generation;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const moveTo = (
  requestId: string,
  sessionEpoch: SessionEpoch,
  generation: Generation,
  destination: Vec3,
): MoveToPayload => ({
  requestId,
  sessionEpoch,
  generation,
  x: destination.x,
  y: destination.y,
  z: destination.z,
});

export interface CancelPayload {
  readonly requestId: string;
  readonly sessionEpoch: SessionEpoch;
  readonly generation: Generation;
}

export const cancel = (requestId: string, sessionEpoch: SessionEpoch, generation: Generation): CancelPayload => ({
  requestId,
  sessionEpoch,
  generation,
});

/** A frame with an extra field: `matchesExactKeys` refuses it as `INVALID_PAYLOAD`. */
export const frameWithExtraField = (
  sessionEpoch: SessionEpoch,
  generation: Generation,
  extra: string,
): Record<string, unknown> => ({
  ...frame(sessionEpoch, generation, 1, 0),
  [extra]: 'not-declared',
});

/** A frame whose axis is not finite. Recorded with the malformed rendering (P03-g, AC-20). */
export const frameWithNonFiniteAxis = (
  sessionEpoch: SessionEpoch,
  generation: Generation,
  value: number = Number.NaN,
): Record<string, unknown> => ({
  sessionEpoch,
  generation,
  directIntent: true,
  moveX: value,
  moveZ: 0,
});

/** A frame whose generation is a string: the codec coerces nothing here, the validator refuses it. */
export const frameWithTypedGeneration = (
  sessionEpoch: SessionEpoch,
  generation: unknown,
): Record<string, unknown> => ({
  sessionEpoch,
  generation,
  directIntent: true,
  moveX: 1,
  moveZ: 0,
});

/** A payload that declares none of the three accepted message shapes. */
export const unknownMessage = (name = 'UDG_NOT_A_MESSAGE'): Record<string, unknown> => ({
  name,
  payload: 1,
});
