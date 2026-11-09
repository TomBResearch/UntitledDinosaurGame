/**
 * Protocol validation unit suite (UDG-002).
 *
 * The fixture files carry the case list that docs/validation/fixtures.md 7.2 requires; this suite covers
 * the behaviour around those cases — ordering of checks, normalisation before encoding, and the two pure
 * seams (generation admission and request identity) that UDG-003 will build on. Where a fixture states an
 * expected rejection, this suite states *why that code and not another*, which is the part a case table
 * cannot show.
 */

import { describe, expect, it } from 'vitest';

import {
  DIRECT_FRAME_FIELDS,
  GENERATION_MAX,
  JOIN_FIELDS,
  MAX_GENERATION_FORWARD_GAP,
  MOVE_TO_FIELDS,
  MOVEMENT_MODE_ENCODING,
  PROTOCOL_VERSION,
  REJECTION_CODES,
  REQUEST_ID_PATTERN,
  ROUTE_ABSENT_INDEX,
  ROUTE_ABSENT_REVISION,
  ROUTE_STATUS_FIELDS,
  ROUTE_STATUS_VALUES,
  SUPPORTED_PROTOCOL_VERSIONS,
  UINT32_MAX,
  YAW_RANGE,
  admitGeneration,
  compareRequestIdentity,
  directInputOf,
  isProtocolVersionSupported,
  neutralDirectFrame,
  normaliseAxes,
  normaliseSignedZero,
  normaliseYaw,
  validateCancelPath,
  validateDirectFrame,
  validateJoin,
  validateMoveTo,
  validateRouteStatus,
} from '../../../packages/protocol/dist/index.js';
import {
  DEFAULT_NETWORK_CONFIG,
  DEFAULT_SERVER_CONFIG,
  computeConfigHash,
} from '../../../packages/config/dist/index.js';

const CONTEXT = { sessionEpoch: 7 } as const;
const BOUNDS = {
  x: { min: -100, max: 100 },
  y: { min: -10, max: 50 },
  z: { min: -100, max: 100 },
} as const;
const COMMAND_CONTEXT = { sessionEpoch: 7, bounds: BOUNDS } as const;
const JOIN_CONTEXT = {
  protocolVersion: PROTOCOL_VERSION,
  configHash: computeConfigHash(DEFAULT_SERVER_CONFIG),
  manifestHash: '1'.repeat(64),
} as const;

const frame = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  sessionEpoch: 7,
  generation: 11,
  directIntent: true,
  moveX: 0.5,
  moveZ: 0,
  ...overrides,
});

const code = (result: { ok: boolean } & { code?: string; value?: unknown }): string =>
  result.ok ? 'OK' : (result.code ?? '<none>');

describe('the rejection vocabulary', () => {
  it('is exactly the fourteen codes the interface declares', () => {
    expect([...REJECTION_CODES].sort()).toEqual([
      'ASSET_MISMATCH',
      'CONFIG_MISMATCH',
      'EPOCH_MISMATCH',
      'INVALID_DESTINATION',
      'INVALID_GENERATION',
      'INVALID_PAYLOAD',
      'NAVIGATION_BUSY',
      'OUT_OF_BOUNDS',
      'PROTOCOL_MISMATCH',
      'RATE_LIMITED',
      'REQUEST_ID_CONFLICT',
      'RESYNC_REQUIRED',
      'SUPERSEDED',
      'UNREACHABLE',
    ]);
    expect(new Set(REJECTION_CODES).size).toBe(REJECTION_CODES.length);
  });

  it('declares the route status values as a value as well as a type', () => {
    expect([...ROUTE_STATUS_VALUES].sort()).toEqual(['ARRIVED', 'BLOCKED', 'CANCELLED', 'SUPERSEDED']);
  });

  it('names the closed field sets the validators enforce', () => {
    expect(DIRECT_FRAME_FIELDS).toEqual(['sessionEpoch', 'generation', 'directIntent', 'moveX', 'moveZ']);
    expect(MOVE_TO_FIELDS).toEqual(['requestId', 'sessionEpoch', 'generation', 'x', 'y', 'z']);
    expect(JOIN_FIELDS).toEqual(['protocolVersion', 'configHash', 'manifestHash']);
    expect(ROUTE_STATUS_FIELDS).toEqual(['entityId', 'sessionEpoch', 'generation', 'routeRevision', 'status', 'serverTick']);
  });
});

describe('normalisation happens at validation time', () => {
  it('wraps yaw into the half-open interval and sends +PI to -PI', () => {
    expect(YAW_RANGE).toEqual({ min: -Math.PI, max: Math.PI });
    expect(normaliseYaw(Math.PI)).toBe(-Math.PI);
    expect(normaliseYaw(-Math.PI)).toBe(-Math.PI);
    expect(normaliseYaw(0)).toBe(0);
    expect(normaliseYaw(Math.PI / 2)).toBe(Math.PI / 2);
    expect(normaliseYaw(3 * Math.PI)).toBe(-Math.PI);
    expect(normaliseYaw(-3 * Math.PI)).toBe(-Math.PI);
    expect(normaliseYaw(0.25 * Math.PI)).toBeCloseTo(0.25 * Math.PI, 15);
  });

  it('is idempotent, which a mapping that refuses unnormalised yaw depends on', () => {
    for (const value of [-7.5, -Math.PI, -1, -0.001, 0, 0.001, 1, Math.PI - 1e-12, 2 * Math.PI, 11.3]) {
      const once = normaliseYaw(value);
      expect(normaliseYaw(once), String(value)).toBe(once);
      expect(once).toBeGreaterThanOrEqual(-Math.PI);
      expect(once).toBeLessThan(Math.PI);
    }
  });

  it('turns negative zero into positive zero', () => {
    expect(Object.is(normaliseSignedZero(-0), 0)).toBe(true);
    expect(Object.is(normaliseSignedZero(0), 0)).toBe(true);
    expect(normaliseSignedZero(-1e-9)).toBe(-1e-9);
  });

  it('normalises a diagonal instead of clamping each axis', () => {
    const diagonal = normaliseAxes(1, 1);
    expect(diagonal.moveX).toBe(1 / Math.SQRT2);
    expect(diagonal.moveZ).toBe(1 / Math.SQRT2);
    expect(Math.hypot(diagonal.moveX, diagonal.moveZ)).toBe(1);

    const inside = normaliseAxes(0.5, 0.5);
    expect(inside).toEqual({ moveX: 0.5, moveZ: 0.5 });

    const zero = normaliseAxes(-0, -0);
    expect(Object.is(zero.moveX, 0)).toBe(true);
    expect(Object.is(zero.moveZ, 0)).toBe(true);
  });

  it('reports a validated frame already normalised, so mapping can require it', () => {
    const result = validateDirectFrame(frame({ moveX: 1, moveZ: 1 }), CONTEXT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Math.hypot(result.value.moveX, result.value.moveZ)).toBe(1);
    }
  });
});

describe('validateDirectFrame', () => {
  it('accepts the five declared fields and nothing else', () => {
    expect(validateDirectFrame(frame(), CONTEXT).ok).toBe(true);
    for (const extra of [
      { position: { x: 1, y: 0.9, z: 1 } },
      { speed: 9 },
      { elapsedMs: 16 },
      { routeRevision: 3 },
      { authorityTick: 12 },
      { clientSequence: 4 },
      { entityId: 'entity-002' },
    ]) {
      const result = validateDirectFrame(frame(extra), CONTEXT);
      expect(result.ok, JSON.stringify(extra)).toBe(false);
      expect(code(result)).toBe('INVALID_PAYLOAD');
    }
  });

  it('refuses a missing field rather than defaulting it', () => {
    for (const key of DIRECT_FRAME_FIELDS) {
      const payload = frame();
      delete payload[key];
      expect(validateDirectFrame(payload, CONTEXT).ok, key).toBe(false);
    }
  });

  it('refuses a non-record payload', () => {
    for (const payload of [null, undefined, 7, 'frame', [1, 2, 3], true]) {
      expect(validateDirectFrame(payload, CONTEXT).ok, String(payload)).toBe(false);
    }
  });

  it('refuses a non-finite or out-of-range axis without clamping', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.0000001, -1.0000001, '0.5', null, [0.5], {}]) {
      const result = validateDirectFrame(frame({ moveX: value }), CONTEXT);
      expect(result.ok, String(value)).toBe(false);
      expect(code(result)).toBe('INVALID_PAYLOAD');
    }
    // Exactly at the inclusive limits is valid; the limit is a boundary, not a clamp point.
    expect(validateDirectFrame(frame({ moveX: 1, moveZ: -1 }), CONTEXT).ok).toBe(true);
  });

  it('checks generation with its own code, and never wraps', () => {
    const cases: readonly { readonly generation: unknown; readonly ok: boolean; readonly code: string }[] = [
      { generation: 0, ok: false, code: 'INVALID_GENERATION' },
      { generation: 1, ok: true, code: 'OK' },
      { generation: GENERATION_MAX, ok: true, code: 'OK' },
      { generation: GENERATION_MAX + 1, ok: false, code: 'INVALID_GENERATION' },
      { generation: UINT32_MAX, ok: false, code: 'INVALID_GENERATION' },
      { generation: -1, ok: false, code: 'INVALID_GENERATION' },
      { generation: 1.5, ok: false, code: 'INVALID_GENERATION' },
      { generation: Number.NaN, ok: false, code: 'INVALID_GENERATION' },
      { generation: Number.MAX_SAFE_INTEGER + 2, ok: false, code: 'INVALID_GENERATION' },
      { generation: '11', ok: false, code: 'INVALID_GENERATION' },
    ];
    for (const entry of cases) {
      const result = validateDirectFrame(frame({ generation: entry.generation }), CONTEXT);
      expect(result.ok, JSON.stringify(entry)).toBe(entry.ok);
      expect(code(result), JSON.stringify(entry)).toBe(entry.code);
    }
  });

  it('refuses generation zero only when the frame carries an intention', () => {
    expect(validateDirectFrame(frame({ generation: 0, directIntent: false, moveX: 0, moveZ: 0 }), CONTEXT).ok).toBe(true);
    expect(validateDirectFrame(frame({ generation: 0, directIntent: true }), CONTEXT).ok).toBe(false);
  });

  it('refuses a keepalive that smuggles an intention, and reads it as no movement', () => {
    const result = validateDirectFrame(frame({ directIntent: false, moveX: 1 }), CONTEXT);
    expect(code(result)).toBe('INVALID_PAYLOAD');
    if (!result.ok) {
      // The neutral fallback is a value the caller decides to use, never a silent clamp.
      expect(directInputOf(neutralDirectFrame({ ...CONTEXT, generation: 12 }))).toEqual({ moveX: 0, moveZ: 0 });
    }
  });

  it('reports a structural failure before staleness, because an unusable frame cannot be stale', () => {
    // A frame that is both malformed and carries an old epoch is INVALID_PAYLOAD: the honest answer is
    // that the frame is not a frame.
    expect(code(validateDirectFrame(frame({ sessionEpoch: 6, moveX: 'x' }), CONTEXT))).toBe('INVALID_PAYLOAD');
    expect(code(validateDirectFrame(frame({ sessionEpoch: 6 }), CONTEXT))).toBe('EPOCH_MISMATCH');
    expect(code(validateDirectFrame(frame({ sessionEpoch: 0 }), CONTEXT))).toBe('INVALID_PAYLOAD');
    expect(code(validateDirectFrame(frame({ sessionEpoch: UINT32_MAX }), CONTEXT))).toBe('EPOCH_MISMATCH');
  });

  it('projects a validated frame to locomotion input, and a keepalive to no intent', () => {
    const direct = validateDirectFrame(frame({ moveX: 0.5, moveZ: 0.5 }), CONTEXT);
    expect(direct.ok).toBe(true);
    if (direct.ok) expect(directInputOf(direct.value)).toEqual({ moveX: 0.5, moveZ: 0.5 });

    const keepalive = validateDirectFrame(frame({ directIntent: false, moveX: 0, moveZ: 0 }), CONTEXT);
    expect(keepalive.ok).toBe(true);
    if (keepalive.ok) expect(directInputOf(keepalive.value)).toEqual({ moveX: 0, moveZ: 0 });
  });

  it('builds a neutral frame that is valid by construction', () => {
    const neutral = neutralDirectFrame({ ...CONTEXT, generation: 0 });
    expect(neutral).toEqual({ sessionEpoch: 7, generation: 0, directIntent: false, moveX: 0, moveZ: 0 });
    expect(validateDirectFrame(neutral, CONTEXT).ok).toBe(true);
  });
});

describe('validateMoveTo and validateCancelPath', () => {
  const moveTo = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    requestId: 'move-001',
    sessionEpoch: 7,
    generation: 12,
    x: 0,
    y: 0.9,
    z: 0,
    ...overrides,
  });

  it('accepts a destination inside the supplied bounds and refuses one outside', () => {
    expect(validateMoveTo(moveTo(), COMMAND_CONTEXT).ok).toBe(true);
    for (const outside of [{ x: 1000 }, { x: -1000 }, { y: 900 }, { z: 101 }, { x: -100.0001 }]) {
      const result = validateMoveTo(moveTo(outside), COMMAND_CONTEXT);
      expect(result.ok, JSON.stringify(outside)).toBe(false);
      expect(code(result)).toBe('OUT_OF_BOUNDS');
    }
  });

  it('treats the bounds as inclusive', () => {
    expect(validateMoveTo(moveTo({ x: 100, y: 50, z: -100 }), COMMAND_CONTEXT).ok).toBe(true);
  });

  it('refuses non-finite coordinates before any containment test', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(code(validateMoveTo(moveTo({ y: value }), COMMAND_CONTEXT))).toBe('INVALID_PAYLOAD');
    }
  });

  it('refuses generation zero: a request is never the neutral frame', () => {
    expect(code(validateMoveTo(moveTo({ generation: 0 }), COMMAND_CONTEXT))).toBe('INVALID_GENERATION');
    expect(code(validateCancelPath({ requestId: 'cancel-001', sessionEpoch: 7, generation: 0 }, COMMAND_CONTEXT))).toBe(
      'INVALID_GENERATION',
    );
  });

  it('accepts the identifier pattern and refuses everything else', () => {
    for (const good of ['a', 'A-1_b', 'x'.repeat(64), '0']) {
      expect(validateMoveTo(moveTo({ requestId: good }), COMMAND_CONTEXT).ok, good).toBe(true);
      expect(REQUEST_ID_PATTERN.test(good), good).toBe(true);
    }
    for (const bad of ['', 'x'.repeat(65), 'move 001', 'move/001', 'move:001', 'ünïcode', 'move\t1', 'move\n1']) {
      expect(validateMoveTo(moveTo({ requestId: bad }), COMMAND_CONTEXT).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('refuses a stale epoch on both commands', () => {
    expect(code(validateMoveTo(moveTo({ sessionEpoch: 6 }), COMMAND_CONTEXT))).toBe('EPOCH_MISMATCH');
    expect(code(validateCancelPath({ requestId: 'cancel-001', sessionEpoch: 6, generation: 12 }, COMMAND_CONTEXT))).toBe(
      'EPOCH_MISMATCH',
    );
  });

  it('requires bounds in the context rather than inventing them', () => {
    // The type makes an absent volume a compile error, and the runtime behaviour is a loud failure
    // rather than a permissive answer: a caller with no volume cannot ask a containment question, and
    // guessing one would be owner decision D5 in reverse.
    expect(() => validateMoveTo(moveTo(), { sessionEpoch: 7 } as never)).toThrow();
  });

  it('flattens the stamp onto the wire without losing the request identity', () => {
    const request = validateMoveTo(moveTo({ x: 1.5, y: 0.9, z: -2.25 }), COMMAND_CONTEXT);
    expect(request.ok).toBe(true);
    if (request.ok) {
      expect(request.value.stamp).toEqual({ sessionEpoch: 7, generation: 12 });
      expect(request.value.destination).toEqual({ x: 1.5, y: 0.9, z: -2.25 });
    }
  });
});

describe('validateJoin', () => {
  it('accepts the exact identity of this build', () => {
    const result = validateJoin(
      { protocolVersion: PROTOCOL_VERSION, configHash: JOIN_CONTEXT.configHash, manifestHash: JOIN_CONTEXT.manifestHash },
      JOIN_CONTEXT,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  it('is exact-match only, with no version range logic', () => {
    expect(SUPPORTED_PROTOCOL_VERSIONS).toEqual([PROTOCOL_VERSION]);
    expect(isProtocolVersionSupported(PROTOCOL_VERSION)).toBe(true);
    expect(isProtocolVersionSupported('udg-m0-1.0.1')).toBe(false);
    expect(isProtocolVersionSupported('udg-m0-0.9.0')).toBe(false);
    expect(code(validateJoin({ protocolVersion: 'udg-m0-0.9.0', configHash: JOIN_CONTEXT.configHash, manifestHash: JOIN_CONTEXT.manifestHash }, JOIN_CONTEXT))).toBe(
      'PROTOCOL_MISMATCH',
    );
  });

  it('checks version before hashes, because hashes are only comparable inside one protocol', () => {
    const both = validateJoin({ protocolVersion: 'other', configHash: 'f'.repeat(64), manifestHash: JOIN_CONTEXT.manifestHash }, JOIN_CONTEXT);
    expect(code(both)).toBe('PROTOCOL_MISMATCH');
  });

  it('distinguishes a configuration mismatch from an asset mismatch', () => {
    expect(
      code(validateJoin({ protocolVersion: PROTOCOL_VERSION, configHash: 'f'.repeat(64), manifestHash: JOIN_CONTEXT.manifestHash }, JOIN_CONTEXT)),
    ).toBe('CONFIG_MISMATCH');
    expect(
      code(validateJoin({ protocolVersion: PROTOCOL_VERSION, configHash: JOIN_CONTEXT.configHash, manifestHash: 'e'.repeat(64) }, JOIN_CONTEXT)),
    ).toBe('ASSET_MISMATCH');
  });

  it('refuses malformed hash fields and oversized versions structurally', () => {
    for (const bad of ['ABC', 'F'.repeat(64), 'g'.repeat(64), '', 7, null]) {
      expect(code(validateJoin({ protocolVersion: PROTOCOL_VERSION, configHash: bad, manifestHash: JOIN_CONTEXT.manifestHash }, JOIN_CONTEXT))).toBe(
        'INVALID_PAYLOAD',
      );
    }
    expect(
      code(validateJoin({ protocolVersion: 'v'.repeat(33), configHash: JOIN_CONTEXT.configHash, manifestHash: JOIN_CONTEXT.manifestHash }, JOIN_CONTEXT)),
    ).toBe('INVALID_PAYLOAD');
  });

  it('does not accept world or region from a client', () => {
    const result = validateJoin(
      {
        protocolVersion: PROTOCOL_VERSION,
        configHash: JOIN_CONTEXT.configHash,
        manifestHash: JOIN_CONTEXT.manifestHash,
        worldId: 'world-002',
      },
      JOIN_CONTEXT,
    );
    expect(code(result)).toBe('INVALID_PAYLOAD');
  });
});

describe('generation admission as a pure predicate', () => {
  const context = { watermark: 10, limit: MAX_GENERATION_FORWARD_GAP } as const;

  it('admits a gap up to the window and refuses one beyond it', () => {
    expect(MAX_GENERATION_FORWARD_GAP).toBe(64);
    expect(DEFAULT_NETWORK_CONFIG.generationGapLimit).toBe(MAX_GENERATION_FORWARD_GAP);
    expect(admitGeneration({ generation: 11 }, context).ok).toBe(true);
    expect(admitGeneration({ generation: 74 }, context).ok).toBe(true);
    expect(code(admitGeneration({ generation: 75 }, context))).toBe('RESYNC_REQUIRED');
  });

  it('supersedes a stale or repeated generation', () => {
    expect(code(admitGeneration({ generation: 10 }, context))).toBe('SUPERSEDED');
    expect(code(admitGeneration({ generation: 1 }, context))).toBe('SUPERSEDED');
  });

  it('separates a structural failure from a policy decision', () => {
    expect(code(admitGeneration({ generation: -1 }, context))).toBe('INVALID_GENERATION');
    expect(code(admitGeneration({ generation: 1.5 }, context))).toBe('INVALID_GENERATION');
    expect(code(admitGeneration({ generation: GENERATION_MAX + 1 }, context))).toBe('INVALID_GENERATION');
    expect(code(admitGeneration({}, context))).toBe('INVALID_PAYLOAD');
    expect(code(admitGeneration({ generation: 11, extra: 1 }, context))).toBe('INVALID_PAYLOAD');
  });

  it('cannot raise a watermark, because it has no state to raise', () => {
    const frozen = Object.freeze({ ...context });
    const before = admitGeneration({ generation: 75 }, frozen);
    const after = admitGeneration({ generation: 75 }, frozen);
    expect(before).toEqual(after);
    expect(frozen.watermark).toBe(10);
    // A rejected resync must leave the window exactly as it was: the caller keeps that duty.
    expect(admitGeneration({ generation: 11 }, frozen).ok).toBe(true);
  });
});

describe('request identity comparison', () => {
  const cached = { requestId: 'move-001', payloadHash: '2'.repeat(64) } as const;

  it('treats the same identifier and payload as a replay', () => {
    const result = compareRequestIdentity(cached, { requestId: 'move-001', payloadHash: '2'.repeat(64) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ requestId: 'move-001', replay: true });
  });

  it('conflicts when the payload differs', () => {
    expect(code(compareRequestIdentity(cached, { requestId: 'move-001', payloadHash: '3'.repeat(64) }))).toBe('REQUEST_ID_CONFLICT');
  });

  it('refuses a mismatched identifier, a malformed identifier and a malformed hash', () => {
    expect(code(compareRequestIdentity(cached, { requestId: 'move-002', payloadHash: '2'.repeat(64) }))).toBe('INVALID_PAYLOAD');
    expect(code(compareRequestIdentity(cached, { requestId: '', payloadHash: '2'.repeat(64) }))).toBe('INVALID_PAYLOAD');
    expect(code(compareRequestIdentity(cached, { requestId: 'move-001', payloadHash: 'nope' }))).toBe('INVALID_PAYLOAD');
  });
});

describe('route status validation', () => {
  const context = { sessionEpoch: 7, entityId: 'entity-001', currentRouteRevision: 3 } as const;
  const status = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    entityId: 'entity-001',
    sessionEpoch: 7,
    generation: 20,
    routeRevision: 3,
    status: 'ARRIVED',
    serverTick: 4321,
    ...overrides,
  });

  it('accepts a completion for the current route revision', () => {
    const result = validateRouteStatus(status(), context);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(result.value.status).toBe('ARRIVED');
  });

  it('supersedes an older revision and refuses a future one', () => {
    expect(code(validateRouteStatus(status({ routeRevision: 2 }), context))).toBe('SUPERSEDED');
    expect(code(validateRouteStatus(status({ routeRevision: 0 }), context))).toBe('SUPERSEDED');
    expect(code(validateRouteStatus(status({ routeRevision: 4 }), context))).toBe('INVALID_PAYLOAD');
  });

  it('refuses every value outside the closed status set', () => {
    for (const bad of ['FLYING', 'arrived', '', 0, null, undefined]) {
      expect(code(validateRouteStatus(status({ status: bad }), context)), String(bad)).toBe('INVALID_PAYLOAD');
    }
    for (const good of ROUTE_STATUS_VALUES) {
      expect(validateRouteStatus(status({ status: good }), context).ok, good).toBe(true);
    }
  });

  it('refuses another entity and a stale epoch', () => {
    expect(code(validateRouteStatus(status({ entityId: 'entity-002' }), context))).toBe('INVALID_PAYLOAD');
    expect(code(validateRouteStatus(status({ sessionEpoch: 6 }), context))).toBe('EPOCH_MISMATCH');
  });

  it('allows generation zero on a status, which reports a stamp rather than making one', () => {
    expect(validateRouteStatus(status({ generation: 0 }), context).ok).toBe(true);
  });

  it('refuses unknown fields and uint32 overflow', () => {
    expect(code(validateRouteStatus(status({ extra: 1 }), context))).toBe('INVALID_PAYLOAD');
    expect(code(validateRouteStatus(status({ serverTick: UINT32_MAX + 1 }), context))).toBe('INVALID_PAYLOAD');
    expect(validateRouteStatus(status({ serverTick: UINT32_MAX }), context).ok).toBe(true);
  });
});

describe('the encoding table', () => {
  it('matches the declared replica enum order', () => {
    expect(MOVEMENT_MODE_ENCODING).toEqual({ idle: 0, direct: 1, path: 2 });
    expect(ROUTE_ABSENT_REVISION).toBe(0);
    expect(ROUTE_ABSENT_INDEX).toBe(0);
  });

  it('declares the uint32 boundaries that mapping must refuse', () => {
    expect(UINT32_MAX).toBe(4_294_967_295);
    expect(GENERATION_MAX).toBe(UINT32_MAX - 1);
  });
});
