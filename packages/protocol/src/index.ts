/**
 * `@udg/protocol` entry point — identity, wire envelopes and validation.
 *
 * This module deliberately imports neither a schema runtime nor the mapping layer: a consumer that
 * wants replica classes must name `@udg/protocol/schema`, and a consumer that wants projection must
 * name `@udg/protocol/mapping`. That keeps the schema runtime out of simulation, configuration and
 * any other engine-free consumer, which is what the boundary rules enforce instead of what a comment
 * hopes for.
 *
 * UDG-002 provides types and validation only. Admission, ordering and movement behaviour are later
 * tasks (owner clarification U2-6), so nothing here decides whether an intention is admitted.
 */

export * from './version.js';
export * from './domain/index.js';
export {
  DIRECT_FRAME_FIELDS,
  DIRECT_WIRE_FRAME_FIELDS,
  NEUTRAL_DIRECT_INPUT,
  coreFrameOfWireFrame,
  directInputOf,
  neutralDirectFrame,
  validateDirectFrame,
  validateDirectWireFrame,
  type DirectFrameContext,
} from './validation/direct.js';
export {
  CANCEL_PATH_FIELDS,
  MOVE_TO_FIELDS,
  ROUTE_STATUS_FIELDS,
  admitGeneration,
  compareRequestIdentity,
  moveToWire,
  validateCancelPath,
  validateMoveTo,
  validateRouteStatus,
  type CachedRequestIdentity,
  type CommandContext,
  type GenerationAdmissionContext,
  type RouteStatusContext,
} from './validation/commands.js';
export { JOIN_FIELDS, validateJoin, type JoinContext } from './validation/join.js';
export {
  asRecord,
  fail,
  isFiniteNumber,
  isInsideBounds,
  isIntegerInRange,
  matchesExactKeys,
  normaliseAxes,
  normaliseSignedZero,
  normaliseYaw,
  ok,
  readAxis,
  readBoolean,
  readFinite,
  readHash,
  readIdentifier,
  readRequestId,
  readUint,
  readVersion,
} from './validation/common.js';
