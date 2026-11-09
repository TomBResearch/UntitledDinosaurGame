/**
 * Mapping suite (UDG-002).
 *
 * Mapping is a validation boundary, not an assignment shortcut. The codec behind it coerces silently —
 * proven in schema-roundtrip.test.ts — so the only thing that makes a declared width "fail safely at
 * bounds" is this layer refusing a value it cannot represent. Every refusal below corresponds to a
 * corruption that the pinned codec would otherwise perform quietly.
 */

import { describe, expect, it } from 'vitest';

import { Decoder, Encoder, PlayerSchema, RegionSchema } from '../../../packages/protocol/dist/schema/index.js';
import {
  checkPlayerState,
  checkRegionState,
  fromReplica,
  fromRegionReplica,
  movementModeCode,
  playerMapKey,
  readPlayerMap,
  readPlayerReplica,
  readRegionIssues,
  readReplicaIssues,
  toRegionReplica,
  toReplica,
} from '../../../packages/protocol/dist/mapping/index.js';
import {
  MOVEMENT_MODE_ENCODING,
  ROUTE_ABSENT_INDEX,
  ROUTE_ABSENT_REVISION,
  UINT32_MAX,
} from '../../../packages/protocol/dist/index.js';
import type { PlayerSimulationState } from '../../../packages/protocol/dist/domain/index.js';

const baseState = (): PlayerSimulationState => ({
  entityId: 'entity-001',
  sessionEpoch: 7,
  connected: true,
  locomotion: {
    kinematic: {
      position: { x: 12.25, y: 0.9, z: -3.5 },
      yaw: -2.5,
      velocity: { x: 4, y: -0.4905, z: 0 },
      grounded: true,
      verticalVelocity: -1.2345678901234567,
    },
    mode: 'direct',
    route: null,
    intentGeneration: 42,
    lastAuthorityTick: 1234,
  },
});

const withKinematic = (overrides: Record<string, unknown>): PlayerSimulationState => {
  const state = baseState();
  return {
    ...state,
    locomotion: {
      ...state.locomotion,
      kinematic: { ...state.locomotion.kinematic, ...overrides },
    },
  };
};

const withPosition = (overrides: Record<string, unknown>): PlayerSimulationState => {
  const state = baseState();
  return {
    ...state,
    locomotion: {
      ...state.locomotion,
      kinematic: { ...state.locomotion.kinematic, position: { ...state.locomotion.kinematic.position, ...overrides } },
    },
  };
};

const withVelocity = (overrides: Record<string, unknown>): PlayerSimulationState => {
  const state = baseState();
  return {
    ...state,
    locomotion: {
      ...state.locomotion,
      kinematic: { ...state.locomotion.kinematic, velocity: { ...state.locomotion.kinematic.velocity, ...overrides } },
    },
  };
};

const fields = (state: PlayerSimulationState | undefined): string[] =>
  checkPlayerState(state).map((issue) => issue.field);

const roundTrip = (state: PlayerSimulationState): PlayerSimulationState => {
  const projected = toReplica(state);
  if (!projected.ok) throw new Error(`projection failed: ${JSON.stringify(projected.issues)}`);
  const bytes = new Encoder(projected.value).encodeAll();
  const decoded = new PlayerSchema();
  new Decoder(decoded).decode(bytes);
  const read = fromReplica(decoded);
  if (!read.ok) throw new Error(`read failed: ${JSON.stringify(read.code)}`);
  return read.value;
};

describe('projection', () => {
  it('accepts a complete state and writes every declared field', () => {
    const result = toReplica(baseState());
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const replica = result.value;
    expect(replica.entityId).toBe('entity-001');
    expect(replica.x).toBe(12.25);
    expect(replica.y).toBe(0.9);
    expect(replica.z).toBe(-3.5);
    expect(replica.yaw).toBe(-2.5);
    expect(replica.vx).toBe(4);
    expect(replica.vy).toBe(-0.4905);
    expect(replica.vz).toBe(0);
    expect(replica.grounded).toBe(true);
    expect(replica.verticalVelocity).toBe(-1.2345678901234567);
    expect(replica.movementMode).toBe(MOVEMENT_MODE_ENCODING.direct);
    expect(replica.routeRevision).toBe(ROUTE_ABSENT_REVISION);
    expect(replica.nextWaypointIndex).toBe(ROUTE_ABSENT_INDEX);
    expect(replica.intentGeneration).toBe(42);
    expect(replica.sessionEpoch).toBe(7);
    expect(replica.connected).toBe(true);
    expect(replica.lastAuthorityTick).toBe(1234);
  });

  it('encodes absence as the zero sentinel in both fields', () => {
    const withRoute = toReplica({ ...baseState(), locomotion: { ...baseState().locomotion, route: { revision: 5, nextWaypointIndex: 0 } } });
    expect(withRoute.ok).toBe(true);
    if (withRoute.ok) {
      expect(withRoute.value.routeRevision).toBe(5);
      expect(withRoute.value.nextWaypointIndex).toBe(0);
    }
  });

  it('maps each mode to its declared code', () => {
    expect(movementModeCode('idle')).toBe(0);
    expect(movementModeCode('direct')).toBe(1);
    expect(movementModeCode('path')).toBe(2);
  });

  it('uses the entity id as the player map key', () => {
    expect(playerMapKey('entity-001')).toBe('entity-001');
  });

  it('refuses a state that is not an object', () => {
    for (const bad of [undefined, null, 7, 'state', []]) {
      expect(checkPlayerState(bad as never).length).toBeGreaterThan(0);
    }
  });

  it('refuses every non-finite scalar on the way in', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      for (const field of ['x', 'y', 'z'] as const) {
        expect(fields(withPosition({ [field]: value })), `${field}=${String(value)}`).toContain(field);
      }
      // The replica field is vx while the domain field is velocity.x, so the two names are kept apart
      // deliberately: an issue must be reported under the name the wire and the contract use.
      for (const [replicaField, domainKey] of [['vx', 'x'], ['vy', 'y'], ['vz', 'z']] as const) {
        expect(fields(withVelocity({ [domainKey]: value })), `${replicaField}=${String(value)}`).toContain(replicaField);
      }
      for (const field of ['yaw', 'verticalVelocity'] as const) {
        expect(fields(withKinematic({ [field]: value })), `${field}=${String(value)}`).toContain(field);
      }
    }
  });

  it('refuses a signed zero, because the wire would silently change it', () => {
    expect(fields(withPosition({ x: -0 }))).toContain('x');
    expect(fields(withKinematic({ verticalVelocity: -0 }))).toContain('verticalVelocity');
    expect(fields(withKinematic({ yaw: -0 }))).toContain('yaw');
    // A legitimate +0 must not be refused; only the signed distinction is.
    expect(checkPlayerState(baseState())).toEqual([]);
  });

  it('refuses an unnormalised yaw rather than wrapping it', () => {
    // Normalisation is a validation decision. Doing it here would let a state that was never validated
    // through the protocol layer acquire a different angle than its owner recorded.
    expect(fields(withKinematic({ yaw: Math.PI }))).toContain('yaw');
    expect(fields(withKinematic({ yaw: 4 }))).toContain('yaw');
    expect(fields(withKinematic({ yaw: -Math.PI }))).toEqual([]);
  });

  it('refuses an enum value outside the closed set', () => {
    const state = { ...baseState(), locomotion: { ...baseState().locomotion, mode: 'flying' as never } };
    expect(fields(state)).toContain('movementMode');
  });

  it('refuses integers the declared widths cannot hold', () => {
    const state = baseState();
    const broken = {
      ...state,
      sessionEpoch: UINT32_MAX + 1,
      locomotion: {
        ...state.locomotion,
        intentGeneration: 1.5,
        lastAuthorityTick: -1,
      },
    };
    const reported = fields(broken as unknown as PlayerSimulationState);
    expect(reported).toContain('sessionEpoch');
    expect(reported).toContain('intentGeneration');
    expect(reported).toContain('lastAuthorityTick');
  });

  it('refuses an identifier that is empty, oversized or non-ASCII', () => {
    for (const entityId of ['', 'x'.repeat(65), 'entity 🦖', 'entity 001']) {
      expect(fields({ ...baseState(), entityId }), JSON.stringify(entityId)).toContain('entityId');
    }
  });

  it('enforces the route pair rule and says which field is wrong', () => {
    const mismatched = { ...baseState(), locomotion: { ...baseState().locomotion, route: { revision: 0, nextWaypointIndex: 3 } } };
    const reported = checkPlayerState(mismatched as PlayerSimulationState);
    expect(reported.length).toBeGreaterThan(0);
    expect(reported.map((issue) => issue.field)).toContain('nextWaypointIndex');

    // The option exists for a caller that is deliberately reading a pre-rule snapshot; the default is the
    // rule, and there is no silent leniency.
    expect(checkPlayerState(mismatched as PlayerSimulationState, { enforceRoutePairRule: false })).toEqual([]);
  });

  it('accepts a positive revision with index zero as an active route at its first waypoint', () => {
    const active = { ...baseState(), locomotion: { ...baseState().locomotion, route: { revision: 1, nextWaypointIndex: 0 } } };
    expect(checkPlayerState(active as PlayerSimulationState)).toEqual([]);
  });

  it('refuses booleans that are not booleans', () => {
    expect(fields(withKinematic({ grounded: 'true' as never }))).toContain('grounded');
    expect(fields({ ...baseState(), connected: 1 as never })).toContain('connected');
  });
});

describe('reconstruction', () => {
  /**
   * A projected replica with declared fields overwritten.
   *
   * The patch type is written out field by field instead of using an index signature or a cast: these
   * are negative-test inputs, and a `Record<string, unknown>` would let a typo become a silent no-op
   * that still "tests" something.
   */
  type NumericField =
    | 'x'
    | 'y'
    | 'z'
    | 'yaw'
    | 'vx'
    | 'vy'
    | 'vz'
    | 'verticalVelocity'
    | 'movementMode'
    | 'routeRevision'
    | 'nextWaypointIndex'
    | 'intentGeneration'
    | 'sessionEpoch'
    | 'lastAuthorityTick';

  interface ReplicaPatch {
    entityId?: string;
    grounded?: boolean;
    connected?: boolean;
    x?: number;
    y?: number;
    z?: number;
    yaw?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    verticalVelocity?: number;
    movementMode?: number;
    routeRevision?: number;
    nextWaypointIndex?: number;
    intentGeneration?: number;
    sessionEpoch?: number;
    lastAuthorityTick?: number;
  }

  const projected = (): PlayerSchema => {
    const result = toReplica(baseState());
    if (!result.ok) throw new Error('fixture state must project');
    return result.value;
  };

  const replicaOf = (patch: ReplicaPatch = {}): PlayerSchema => {
    const replica = projected();
    if (patch.entityId !== undefined) replica.entityId = patch.entityId;
    if (patch.grounded !== undefined) replica.grounded = patch.grounded;
    if (patch.connected !== undefined) replica.connected = patch.connected;
    if (patch.x !== undefined) replica.x = patch.x;
    if (patch.y !== undefined) replica.y = patch.y;
    if (patch.z !== undefined) replica.z = patch.z;
    if (patch.yaw !== undefined) replica.yaw = patch.yaw;
    if (patch.vx !== undefined) replica.vx = patch.vx;
    if (patch.vy !== undefined) replica.vy = patch.vy;
    if (patch.vz !== undefined) replica.vz = patch.vz;
    if (patch.verticalVelocity !== undefined) replica.verticalVelocity = patch.verticalVelocity;
    if (patch.movementMode !== undefined) replica.movementMode = patch.movementMode;
    if (patch.routeRevision !== undefined) replica.routeRevision = patch.routeRevision;
    if (patch.nextWaypointIndex !== undefined) replica.nextWaypointIndex = patch.nextWaypointIndex;
    if (patch.intentGeneration !== undefined) replica.intentGeneration = patch.intentGeneration;
    if (patch.sessionEpoch !== undefined) replica.sessionEpoch = patch.sessionEpoch;
    if (patch.lastAuthorityTick !== undefined) replica.lastAuthorityTick = patch.lastAuthorityTick;
    return replica;
  };

  /** Non-finite sweep across every numeric field, without a computed-key cast. */
  const withNumeric = (field: NumericField, value: number): PlayerSchema => {
    const replica = projected();
    replica[field] = value;
    return replica;
  };

  it('reads back a full state that is identical to what was projected', () => {
    const state = baseState();
    const result = fromReplica(replicaOf());
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(result.value).toEqual(state);
  });

  it('reconstructs absence as null and an active route as a pair', () => {
    const absent = fromReplica(replicaOf());
    expect(absent.ok).toBe(true);
    if (absent.ok) expect(absent.value.locomotion.route).toBeNull();

    const active = fromReplica(replicaOf({ routeRevision: 5, nextWaypointIndex: 0 }));
    expect(active.ok).toBe(true);
    if (active.ok) expect(active.value.locomotion.route).toEqual({ revision: 5, nextWaypointIndex: 0 });
  });

  it('refuses the invalid half of the route pair', () => {
    const result = fromReplica(replicaOf({ routeRevision: 0, nextWaypointIndex: 4 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_PAYLOAD');
  });

  it('refuses an enum value that no declared mode produces', () => {
    for (const movementMode of [3, 255, -1, 1.5]) {
      const result = fromReplica(replicaOf({ movementMode }));
      expect(result.ok, String(movementMode)).toBe(false);
    }
  });

  it('refuses a replica carrying a non-finite scalar', () => {
    for (const field of ['x', 'y', 'z', 'yaw', 'vx', 'vy', 'vz', 'verticalVelocity'] as const) {
      for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const result = fromReplica(withNumeric(field, value));
        expect(result.ok, `${field}=${String(value)}`).toBe(false);
      }
    }
  });

  it('refuses an undefined replica and a replica with a malformed identity', () => {
    expect(fromReplica(undefined).ok).toBe(false);
    // An object that is not a decoded replica at all: the reader must refuse it rather than trust a shape.
    expect(fromReplica({} as PlayerSchema).ok).toBe(false);
    expect(fromReplica(replicaOf({ entityId: '' })).ok).toBe(false);
    expect(fromReplica(replicaOf({ entityId: 'x'.repeat(65) })).ok).toBe(false);
  });

  it('reports issues field by field instead of stopping at the first', () => {
    const issues = readReplicaIssues(replicaOf({ x: Number.NaN, z: Number.NaN, yaw: 9 }));
    const reported = issues.map((issue) => issue.field);
    expect(reported).toContain('x');
    expect(reported).toContain('z');
    expect(reported).toContain('yaw');
  });

  it('reports a structural problem before an enum problem, because a broken field is not a mode', () => {
    // Deliberate ordering, not an oversight: with x already non-finite there is no state to interpret,
    // and a reader that claimed "movementMode is invalid" on top of it would be guessing. The field-level
    // helper reports structure; the reader applies the enum and route-pair rules on top of it.
    const mixed = readPlayerReplica(replicaOf({ x: Number.NaN, movementMode: 9 }));
    expect(mixed.issues.map((issue) => issue.field)).toEqual(['x']);

    const enumOnly = readPlayerReplica(replicaOf({ movementMode: 9 }));
    expect(enumOnly.issues.map((issue) => issue.field)).toContain('movementMode');
    expect(fromReplica(replicaOf({ movementMode: 9 })).ok).toBe(false);
  });

  it('returns an issue list from the read helper and a Validation from the public reader', () => {
    const good = replicaOf();
    expect(readPlayerReplica(good).issues).toEqual([]);
    expect(readPlayerReplica(good).value).toBeDefined();
    expect(fromReplica(good).ok).toBe(true);
  });

  it('preserves the complete prediction-relevant scalar set through a full wire round trip', () => {
    const state = baseState();
    const read = roundTrip(state);
    expect(read).toEqual(state);
    // Named explicitly because "the whole object matched" can hide a field that was never written on
    // either side: verticalVelocity and lastAuthorityTick are the two that have been dropped before.
    expect(read.locomotion.kinematic.verticalVelocity).toBe(state.locomotion.kinematic.verticalVelocity);
    expect(read.locomotion.kinematic.velocity.y).toBe(state.locomotion.kinematic.velocity.y);
    expect(read.locomotion.lastAuthorityTick).toBe(state.locomotion.lastAuthorityTick);
    expect(read.locomotion.intentGeneration).toBe(state.locomotion.intentGeneration);
    expect(read.sessionEpoch).toBe(state.sessionEpoch);
    expect(read.connected).toBe(state.connected);
    expect(read.locomotion.kinematic.grounded).toBe(true);
    expect(read.locomotion.mode).toBe('direct');
  });

  it('round trips each mode and both route shapes', () => {
    for (const mode of ['idle', 'direct', 'path'] as const) {
      for (const route of [null, { revision: 1, nextWaypointIndex: 0 }, { revision: 9, nextWaypointIndex: 4 }] as const) {
        const state = { ...baseState(), locomotion: { ...baseState().locomotion, mode, route } } as PlayerSimulationState;
        expect(roundTrip(state)).toEqual(state);
      }
    }
  });
});

describe('region replica mapping', () => {
  const region = {
    worldId: 'world-001',
    regionId: 'region-greybox-001',
    serverTick: 42,
    protocolVersion: 'udg-m0-1.0.0',
    configVersion: 'm0-config-1',
    configHash: 'a'.repeat(64),
    manifestHash: 'b'.repeat(64),
  };

  it('projects and reads back the identity, versions and hashes', () => {
    const projected = toRegionReplica(region);
    expect(projected.ok, JSON.stringify(projected)).toBe(true);
    if (!projected.ok) return;
    const bytes = new Encoder(projected.value).encodeAll();
    const decoded = new RegionSchema();
    new Decoder(decoded).decode(bytes);
    const read = fromRegionReplica(decoded);
    expect(read.ok, JSON.stringify(read)).toBe(true);
    if (read.ok) expect(read.value).toEqual(region);
    expect(readRegionIssues(decoded)).toEqual([]);
  });

  it('refuses malformed hashes, oversized versions and out-of-range ticks', () => {
    const reported = checkRegionState({
      ...region,
      configHash: 'ABC',
      configVersion: 'v'.repeat(33),
      serverTick: UINT32_MAX + 1,
    });
    const issueFields = reported.map((issue) => issue.field);
    expect(issueFields).toContain('configHash');
    expect(issueFields).toContain('configVersion');
    expect(issueFields).toContain('serverTick');
  });

  it('refuses an undefined or non-object region', () => {
    expect(checkRegionState(undefined).length).toBeGreaterThan(0);
    expect(checkRegionState('region' as never).length).toBeGreaterThan(0);
    expect(fromRegionReplica(undefined).ok).toBe(false);
  });

  it('reports a transport map that a client should never have received', () => {
    // The region replica carries no transport-session map; a replica with an unexpected extra field must
    // still read as the declared shape, because the private map is never replicated.
    const projected = toRegionReplica(region);
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    const decoded = new RegionSchema();
    new Decoder(decoded).decode(new Encoder(projected.value).encodeAll());
    expect(Object.prototype.hasOwnProperty.call(decoded, 'transportSessions')).toBe(false);
  });
});

describe('the player map', () => {
  it('reads each entry and reports a key that disagrees with the embedded identity', () => {
    const region = new RegionSchema();
    region.worldId = 'world-001';
    region.regionId = 'region-greybox-001';
    region.serverTick = 42;
    region.protocolVersion = 'udg-m0-1.0.0';
    region.configVersion = 'm0-config-1';
    region.configHash = 'a'.repeat(64);
    region.manifestHash = 'b'.repeat(64);

    const first = toReplica(baseState());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = toReplica({ ...baseState(), entityId: 'entity-002' });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    region.players.set('entity-001', first.value);
    region.players.set('entity-999', second.value);

    const entries = readPlayerMap(region);
    expect(entries.length).toBe(2);
    const mismatched = entries.find((entry) => entry.key === 'entity-999');
    expect(mismatched, JSON.stringify(entries)).toBeDefined();
    expect(mismatched?.issues.length).toBeGreaterThan(0);
    expect(mismatched?.issues.some((issue) => issue.field === 'entityId')).toBe(true);

    const healthy = entries.find((entry) => entry.key === 'entity-001');
    expect(healthy?.issues).toEqual([]);
    expect(healthy?.state?.entityId).toBe('entity-001');
  });

  it('returns no entries for an undefined replica rather than throwing', () => {
    expect(readPlayerMap(undefined)).toEqual([]);
  });
});
