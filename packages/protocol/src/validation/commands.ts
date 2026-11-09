/**
 * One-shot command validation (interfaces/protocol.md 4.2 and 4.3).
 *
 * Region bounds arrive in the context. UDG-002 neither reads an asset nor owns a default extent:
 * decision D5 makes an absent bounds set a caller error rather than a permissive pass, so the context
 * type requires bounds and TypeScript enforces it at every call site.
 */

import type { MoveToWire, Validation } from '../domain/wire.js';
import type { Generation, RegionBounds, SessionEpoch } from '../domain/primitives.js';
import { ROUTE_STATUS_VALUES, type MoveToRequest, type CancelPathRequest, type RouteStatus } from '../domain/commands.js';
import { EPOCH_MAX, EPOCH_MIN, GENERATION_MAX, GENERATION_MIN } from '../version.js';
import {
  asRecord,
  fail,
  isInsideBounds,
  matchesExactKeys,
  normaliseSignedZero,
  ok,
  readFinite,
  readHash,
  readIdentifier,
  readRequestId,
  readUint,
} from './common.js';

export const MOVE_TO_FIELDS = ['requestId', 'sessionEpoch', 'generation', 'x', 'y', 'z'] as const;
export const CANCEL_PATH_FIELDS = ['requestId', 'sessionEpoch', 'generation'] as const;

export interface CommandContext {
  /** Current server-issued epoch. */
  readonly sessionEpoch: SessionEpoch;
  /** Explicitly supplied, already-validated region bounds (decision D5: no default exists). */
  readonly bounds: RegionBounds;
}

const readStamp = (
  record: Readonly<Record<string, unknown>>,
  context: CommandContext,
): { readonly sessionEpoch: SessionEpoch; readonly generation: Generation } | { readonly error: Validation<never> } => {
  const epoch = readUint(record, 'sessionEpoch', { min: EPOCH_MIN, max: EPOCH_MAX, code: 'INVALID_PAYLOAD' });
  if ('error' in epoch) return { error: fail(epoch.error) };

  const generation = readUint(record, 'generation', {
    min: GENERATION_MIN,
    max: GENERATION_MAX,
    code: 'INVALID_GENERATION',
  });
  if ('error' in generation) return { error: fail(generation.error) };

  // Generation zero belongs to the neutral initial frame alone, and a one-shot request is never
  // neutral: protocol.md 4.2 makes zero unusable for an intention, which is checked before staleness
  // because a structurally unusable stamp cannot also be meaningfully stale.
  if (generation.value === GENERATION_MIN) return { error: fail('INVALID_GENERATION') };

  if (epoch.value !== context.sessionEpoch) return { error: fail('EPOCH_MISMATCH') };
  return { sessionEpoch: epoch.value, generation: generation.value };
};

/**
 * Validate a path request against the supplied bounds.
 *
 * `INVALID_DESTINATION` is reserved for the navigation layer: without a navmesh, "not a usable
 * target" cannot be decided here. Everything UDG-002 can decide — finite coordinates inside an
 * inclusive volume — is decided here.
 */
export const validateMoveTo = (raw: unknown, context: CommandContext): Validation<MoveToRequest> => {
  const record = asRecord(raw);
  if (record === undefined) return fail('INVALID_PAYLOAD');
  if (!matchesExactKeys(record, MOVE_TO_FIELDS)) return fail('INVALID_PAYLOAD');

  const requestId = readRequestId(record);
  if ('error' in requestId) return fail(requestId.error);

  const stamp = readStamp(record, context);
  if ('error' in stamp) return stamp.error;

  const x = readFinite(record, 'x');
  if ('error' in x) return fail(x.error);
  const y = readFinite(record, 'y');
  if ('error' in y) return fail(y.error);
  const z = readFinite(record, 'z');
  if ('error' in z) return fail(z.error);

  const destination = {
    x: normaliseSignedZero(x.value),
    y: normaliseSignedZero(y.value),
    z: normaliseSignedZero(z.value),
  };
  if (!isInsideBounds(destination.x, destination.y, destination.z, context.bounds)) {
    return fail('OUT_OF_BOUNDS');
  }

  return ok({ requestId: requestId.value, stamp: { sessionEpoch: stamp.sessionEpoch, generation: stamp.generation }, destination });
};

/** Validate a cancel request. Bounds are irrelevant to cancellation but stay required by the context. */
export const validateCancelPath = (raw: unknown, context: CommandContext): Validation<CancelPathRequest> => {
  const record = asRecord(raw);
  if (record === undefined) return fail('INVALID_PAYLOAD');
  if (!matchesExactKeys(record, CANCEL_PATH_FIELDS)) return fail('INVALID_PAYLOAD');

  const requestId = readRequestId(record);
  if ('error' in requestId) return fail(requestId.error);

  const stamp = readStamp(record, context);
  if ('error' in stamp) return stamp.error;

  return ok({ requestId: requestId.value, stamp: { sessionEpoch: stamp.sessionEpoch, generation: stamp.generation } });
};

/** Wire projection of a validated request, so the flattening rule has one caller-visible home. */
export const moveToWire = (request: MoveToRequest): MoveToWire => ({
  requestId: request.requestId,
  sessionEpoch: request.stamp.sessionEpoch,
  generation: request.stamp.generation,
  x: request.destination.x,
  y: request.destination.y,
  z: request.destination.z,
});

/**
 * Route status validation (protocol.md 4.3).
 *
 * A status message reports what a navigation worker concluded. Two things are decided here and nothing
 * else: the payload is well formed, and it still describes the route the entity is on. Emitting,
 * suppressing or deduplicating the message is authority work under UDG-003 and UDG-007, which is why
 * this function returns a decision instead of touching state.
 *
 * Staleness is expressed as a revision comparison rather than a wall-clock or "is connected" test: an
 * old completion arriving after a disconnect is exactly a status for a route revision that is no longer
 * current, and the revision is the only ordering evidence the message itself carries.
 */
export const ROUTE_STATUS_FIELDS = ['entityId', 'sessionEpoch', 'generation', 'routeRevision', 'status', 'serverTick'] as const;

export interface RouteStatusContext {
  readonly sessionEpoch: SessionEpoch;
  readonly entityId: string;
  /** The route revision the entity is on now. `0` means no route. */
  readonly currentRouteRevision: number;
}

export const validateRouteStatus = (raw: unknown, context: RouteStatusContext): Validation<RouteStatus> => {
  const record = asRecord(raw);
  if (record === undefined) return fail('INVALID_PAYLOAD');
  if (!matchesExactKeys(record, ROUTE_STATUS_FIELDS)) return fail('INVALID_PAYLOAD');

  const entityId = readIdentifier(record, 'entityId');
  if ('error' in entityId) return fail(entityId.error);
  if (entityId.value !== context.entityId) return fail('INVALID_PAYLOAD');

  const epoch = readUint(record, 'sessionEpoch', { min: EPOCH_MIN, max: EPOCH_MAX, code: 'INVALID_PAYLOAD' });
  if ('error' in epoch) return fail(epoch.error);

  const generation = readUint(record, 'generation', {
    min: GENERATION_MIN,
    max: GENERATION_MAX,
    code: 'INVALID_GENERATION',
  });
  if ('error' in generation) return fail(generation.error);

  const routeRevision = readUint(record, 'routeRevision', { code: 'INVALID_PAYLOAD' });
  if ('error' in routeRevision) return fail(routeRevision.error);

  const serverTick = readUint(record, 'serverTick', { code: 'INVALID_PAYLOAD' });
  if ('error' in serverTick) return fail(serverTick.error);

  const status = ROUTE_STATUS_VALUES.find((value) => value === record['status']);
  if (status === undefined) return fail('INVALID_PAYLOAD');

  if (epoch.value !== context.sessionEpoch) return fail('EPOCH_MISMATCH');
  if (routeRevision.value > context.currentRouteRevision) return fail('INVALID_PAYLOAD');
  if (routeRevision.value < context.currentRouteRevision) return fail('SUPERSEDED');

  return ok({
    entityId: entityId.value,
    sessionEpoch: epoch.value,
    generation: generation.value,
    routeRevision: routeRevision.value,
    status,
    serverTick: serverTick.value,
  });
};

/**
 * Generation admission as a pure predicate.
 *
 * protocol.md 4.2 states the rule — a forward gap of at most 64 is admitted, a larger gap causes
 * `RESYNC_REQUIRED` without raising the watermark, and stale generations fail admission — and the rule
 * is testable without a room, a queue or a watermark store. Owner clarification U2-6 keeps the *store*
 * (watermarks, cutoff, resync emission) in UDG-003, so this function reads numbers and returns a
 * decision, and cannot raise anything.
 */
export interface GenerationAdmissionContext {
  /** Highest generation admitted so far. */
  readonly watermark: number;
  /** Admitted forward gap, normally `MAX_GENERATION_FORWARD_GAP`. */
  readonly limit: number;
}

export const admitGeneration = (raw: unknown, context: GenerationAdmissionContext): Validation<{ readonly generation: Generation }> => {
  const record = asRecord(raw);
  if (record === undefined) return fail('INVALID_PAYLOAD');
  if (!matchesExactKeys(record, ['generation'])) return fail('INVALID_PAYLOAD');

  const generation = readUint(record, 'generation', {
    min: GENERATION_MIN,
    max: GENERATION_MAX,
    code: 'INVALID_GENERATION',
  });
  if ('error' in generation) return fail(generation.error);

  if (generation.value <= context.watermark) return fail('SUPERSEDED');
  if (generation.value - context.watermark > context.limit) return fail('RESYNC_REQUIRED');
  return ok({ generation: generation.value });
};

/**
 * Request identity comparison for the terminal-request cache.
 *
 * protocol.md 4.3 defines both halves of the rule: the same identifier with an identical payload is a
 * replay that must not recompute, and the same identifier with a different payload is
 * `REQUEST_ID_CONFLICT`. The comparison is here because it is protocol semantics; the 128-record,
 * 30-second cache that feeds it is UDG-003 behaviour.
 */
export interface CachedRequestIdentity {
  readonly requestId: string;
  readonly payloadHash: string;
}

export const compareRequestIdentity = (
  cached: CachedRequestIdentity,
  incoming: CachedRequestIdentity,
): Validation<{ readonly requestId: string; readonly replay: true }> => {
  const record = { requestId: incoming.requestId, payloadHash: incoming.payloadHash };
  const requestId = readRequestId(record);
  if ('error' in requestId) return fail(requestId.error);
  const hash = readHash(record, 'payloadHash');
  if ('error' in hash) return fail(hash.error);
  const cachedHash = readHash({ payloadHash: cached.payloadHash }, 'payloadHash');
  if ('error' in cachedHash) return fail(cachedHash.error);
  if (requestId.value !== cached.requestId) return fail('INVALID_PAYLOAD');
  if (hash.value !== cachedHash.value) return fail('REQUEST_ID_CONFLICT');
  return ok({ requestId: requestId.value, replay: true });
};
