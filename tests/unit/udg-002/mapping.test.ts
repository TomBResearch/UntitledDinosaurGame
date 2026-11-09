/**
 * Mapping suite (UDG-002).
 *
 * Mapping is a validation boundary, not an assignment shortcut. The codec behind it coerces silently —
 * proven in schema-roundtrip.test.ts — so the only thing that makes a declared width "fail safely at
 * bounds" is this layer refusing a value it cannot represent. Every refusal below corresponds to a
 * corruption that the pinned codec would otherwise perform quietly.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
  type MappingIssue,
} from '../../../packages/protocol/dist/mapping/index.js';
import {
  GENERATION_MAX,
  GENERATION_MIN,
  MOVEMENT_MODE_ENCODING,
  ROUTE_ABSENT_INDEX,
  ROUTE_ABSENT_REVISION,
  UINT32_MAX,
  validateDirectFrame,
} from '../../../packages/protocol/dist/index.js';
import type { PlayerSimulationState } from '../../../packages/protocol/dist/domain/index.js';

const ROOT = process.cwd();

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

const withRoute = (
  route: { readonly revision: number; readonly nextWaypointIndex: number } | null,
): PlayerSimulationState => {
  const state = baseState();
  return { ...state, locomotion: { ...state.locomotion, route } };
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

  it('refuses the route pair rule violation and names both fields', () => {
    const mismatched = withRoute({ revision: 0, nextWaypointIndex: 3 });
    const reported = checkPlayerState(mismatched);
    expect(reported.length).toBeGreaterThan(0);
    const reportedFields = reported.map((issue) => issue.field);
    // `nextWaypointIndex` carries the pair rule; `routeRevision` carries the canonical-absence reason,
    // and each of them says so exactly once.
    expect(reportedFields).toEqual(['routeRevision', 'nextWaypointIndex']);
  });

  it('refuses a canonical route at the wire sentinel instead of silently making it null', () => {
    // `route: { revision: 0, nextWaypointIndex: 0 }` would project onto the `0 / 0` sentinel and decode
    // back as `route: null`, so the caller would get a different canonical value than the one it passed.
    // Canonical absence is `null`; a `RouteProgress` is a route, and a route has a positive revision.
    const zeroPair = withRoute({ revision: 0, nextWaypointIndex: 0 });
    // One issue per field, named: a report that says the same thing twice is noise a caller learns to
    // ignore, and a caller that ignores this one would ship the state anyway.
    expect(checkPlayerState(zeroPair).map((issue) => issue.field)).toEqual(['routeRevision']);
    expect(toReplica(zeroPair).ok).toBe(false);
    // `null` is the canonical spelling of absence and stays acceptable.
    expect(checkPlayerState(withRoute(null))).toEqual([]);
  });

  it('accepts a positive revision with index zero as an active route at its first waypoint', () => {
    // Owner decision D1, unchanged by the sentinel tightening above: index 0 stays legal while a route lives.
    expect(checkPlayerState(withRoute({ revision: 1, nextWaypointIndex: 0 }))).toEqual([]);
    expect(checkPlayerState(withRoute({ revision: UINT32_MAX, nextWaypointIndex: 0 }))).toEqual([]);
  });

  it('applies the generation limit that the outbound validators apply', () => {
    const reported = (generation: number): readonly string[] =>
      checkPlayerState({
        ...withRoute(null),
        locomotion: { ...withRoute(null).locomotion, intentGeneration: generation },
      }).map((issue) => issue.field);
    expect(reported(GENERATION_MAX)).not.toContain('intentGeneration');
    expect(reported(UINT32_MAX)).toContain('intentGeneration');
  });

  it('refuses booleans that are not booleans', () => {
    expect(fields(withKinematic({ grounded: 'true' as never }))).toContain('grounded');
    expect(fields({ ...baseState(), connected: 1 as never })).toContain('connected');
  });
});

/**
 * UDG-002 review correction 3: the route pair rule has no caller-visible bypass.
 *
 * The projection used to accept `PlayerMappingOptions { enforceRoutePairRule?: boolean }`, and a test
 * approved switching it off. A caller that did so could project `revision 0` with a live waypoint index —
 * a replica that decodes to a *different* canonical state than the one that produced it. The option is
 * removed; these tests are the regression that keeps it removed.
 */
describe('the route pair rule cannot be bypassed', () => {
  /** Canonical routes no supported entry point may accept. */
  const MALFORMED_CANONICAL: readonly { readonly label: string; readonly route: { revision: number; nextWaypointIndex: number } }[] = [
    { label: 'absence spelled as a pair', route: { revision: 0, nextWaypointIndex: 0 } },
    { label: 'absence with a live waypoint pointer', route: { revision: 0, nextWaypointIndex: 4 } },
    { label: 'fractional revision', route: { revision: 1.5, nextWaypointIndex: 0 } },
    { label: 'negative revision', route: { revision: -1, nextWaypointIndex: 0 } },
    { label: 'revision above uint32', route: { revision: UINT32_MAX + 1, nextWaypointIndex: 0 } },
    { label: 'non-finite revision', route: { revision: Number.NaN, nextWaypointIndex: 0 } },
    { label: 'negative index', route: { revision: 3, nextWaypointIndex: -1 } },
    { label: 'fractional index', route: { revision: 3, nextWaypointIndex: 2.5 } },
  ];

  it('refuses every malformed canonical route at both supported outbound entry points', () => {
    for (const { label, route } of MALFORMED_CANONICAL) {
      const state = withRoute(route);
      expect(checkPlayerState(state).length, label).toBeGreaterThan(0);
      expect(toReplica(state).ok, label).toBe(false);
    }
  });

  it('takes no option: neither entry point accepts a second parameter', () => {
    expect(checkPlayerState.length).toBe(1);
    expect(toReplica.length).toBe(1);
    // The removed call shape, replayed through a wider signature. Extra arguments are inert, so the
    // exact statement that used to silence the rule now still refuses the same state.
    const loose = checkPlayerState as unknown as (...args: unknown[]) => readonly MappingIssue[];
    const smuggled = loose(withRoute({ revision: 0, nextWaypointIndex: 4 }), { enforceRoutePairRule: false });
    expect(smuggled.map((issue) => issue.field)).toContain('nextWaypointIndex');
  });

  it('publishes no bypass in the built package surface or the source', () => {
    const checked = [
      'packages/protocol/src/mapping/to-replica.ts',
      'packages/protocol/src/mapping/index.ts',
      'packages/protocol/dist/mapping/index.d.ts',
      'packages/protocol/dist/mapping/to-replica.d.ts',
    ];
    for (const relative of checked) {
      const text = readFileSync(join(ROOT, relative), 'utf8');
      expect(text.includes('PlayerMappingOptions'), relative).toBe(false);
      expect(text.includes('enforceRoutePairRule'), relative).toBe(false);
    }
  });
});

/**
 * UDG-002 review correction 1: `intentGeneration` is bounded by `GENERATION_MAX` on both sides.
 *
 * Outbound validation already refused `4294967295`; mapping used `UINT32_MAX` in both directions, so a
 * state that no validator would accept could be projected and a replica the receiver must refuse could
 * be read back as if it were sound. One constant, both directions.
 */
describe('intentGeneration is bounded identically in both directions', () => {
  const GENERATION_CASES: readonly { readonly label: string; readonly generation: unknown; readonly ok: boolean }[] = [
    { label: 'minimum', generation: GENERATION_MIN, ok: true },
    { label: 'ordinary', generation: 42, ok: true },
    { label: 'GENERATION_MAX', generation: GENERATION_MAX, ok: true },
    { label: 'one above GENERATION_MAX', generation: GENERATION_MAX + 1, ok: false },
    { label: 'UINT32_MAX', generation: UINT32_MAX, ok: false },
    { label: 'fractional', generation: 42.5, ok: false },
    { label: 'negative', generation: -1, ok: false },
    { label: 'above uint32', generation: UINT32_MAX + 1, ok: false },
    { label: 'NaN', generation: Number.NaN, ok: false },
    { label: '+Infinity', generation: Number.POSITIVE_INFINITY, ok: false },
    { label: '-Infinity', generation: Number.NEGATIVE_INFINITY, ok: false },
  ];

  it('states the adopted limit rather than the wire width', () => {
    expect(GENERATION_MAX).toBe(4_294_967_294);
    expect(GENERATION_MAX).toBe(UINT32_MAX - 1);
  });

  it('projects and reads back every accepted generation exactly', () => {
    for (const entry of GENERATION_CASES.filter((candidate) => candidate.ok)) {
      const state = {
        ...withRoute(null),
        locomotion: { ...withRoute(null).locomotion, intentGeneration: entry.generation as number },
      };
      expect(checkPlayerState(state), entry.label).toEqual([]);
      expect(toReplica(state).ok, entry.label).toBe(true);
      expect(roundTrip(state).locomotion.intentGeneration, entry.label).toBe(entry.generation);
    }
  });

  it('refuses every rejected generation on the way out', () => {
    for (const entry of GENERATION_CASES.filter((candidate) => !candidate.ok)) {
      const state = {
        ...withRoute(null),
        locomotion: { ...withRoute(null).locomotion, intentGeneration: entry.generation as number },
      };
      expect(checkPlayerState(state).map((issue) => issue.field), entry.label).toContain('intentGeneration');
      const projected = toReplica(state);
      expect(projected.ok, entry.label).toBe(false);
      if (!projected.ok) {
        expect(projected.issues.some((issue) => issue.field === 'intentGeneration'), entry.label).toBe(true);
      }
    }
  });

  it('refuses every rejected generation on the way in, at every inbound entry point', () => {
    for (const entry of GENERATION_CASES.filter((candidate) => !candidate.ok)) {
      const replica = new PlayerSchema();
      const projected = toReplica(withRoute(null));
      if (!projected.ok) throw new Error('the projection fixture must succeed');
      const bytes = new Encoder(projected.value).encodeAll();
      new Decoder(replica).decode(bytes);
      // Assigned after decode so the value reaches the reader untouched, which is what a peer can do.
      replica.intentGeneration = entry.generation as number;
      expect(readReplicaIssues(replica).map((issue) => issue.field), entry.label).toContain('intentGeneration');
      expect(readPlayerReplica(replica).value, entry.label).toBeUndefined();
      const result = fromReplica(replica);
      expect(result.ok, entry.label).toBe(false);
      if (!result.ok) expect(result.code, entry.label).toBe('INVALID_PAYLOAD');
    }
  });

  it('agrees with the outbound validator, so no state validates on one path and fails on another', () => {
    for (const entry of GENERATION_CASES) {
      const generation = entry.generation as number;
      const accepted = toReplica({
        ...withRoute(null),
        locomotion: { ...withRoute(null).locomotion, intentGeneration: generation },
      }).ok;
      const validated = validateDirectFrame(
        { sessionEpoch: 7, generation, directIntent: true, moveX: 0.5, moveZ: 0 },
        { sessionEpoch: 7 },
      ).ok;
      // The validator additionally reserves generation 0 for a neutral frame, which mapping has no
      // intent to interpret, so `validated` is strictly narrower at that one value and nowhere else.
      expect(accepted, entry.label).toBe(entry.ok);
      expect(validated, entry.label).toBe(entry.ok && generation !== GENERATION_MIN);
    }
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

  /**
   * UDG-002 review correction 2: canonical route round trips are exact in both directions.
   *
   * Canonical absence is `null` and a non-null route carries a positive revision, so the wire `0 / 0`
   * sentinel has exactly one canonical meaning. Every accepted canonical route must survive projection,
   * encoding, decoding and reconstruction unchanged, and every accepted wire pair must re-project to the
   * same wire pair.
   */
  const VALID_ROUTES: readonly { readonly revision: number; readonly nextWaypointIndex: number }[] = [
    { revision: 1, nextWaypointIndex: 0 },
    { revision: 5, nextWaypointIndex: 0 },
    { revision: 5, nextWaypointIndex: 12 },
    { revision: UINT32_MAX, nextWaypointIndex: UINT32_MAX },
  ];

  it('round trips every valid canonical route exactly, including absence', () => {
    const cases: readonly ({ revision: number; nextWaypointIndex: number } | null)[] = [null, ...VALID_ROUTES];
    for (const route of cases) {
      const state = withRoute(route);
      const read = roundTrip(state);
      expect(read.locomotion.route, JSON.stringify(route)).toEqual(route);
      // toEqual alone would not distinguish null from undefined or a missing key.
      expect(Object.is(read.locomotion.route, null), JSON.stringify(route)).toBe(route === null);
    }
  });

  it('decodes the wire sentinel to null and re-projects every wire route onto the same pair', () => {
    const wireCases: readonly { readonly revision: number; readonly index: number }[] = [
      { revision: ROUTE_ABSENT_REVISION, index: ROUTE_ABSENT_INDEX },
      ...VALID_ROUTES.map((route) => ({ revision: route.revision, index: route.nextWaypointIndex })),
    ];
    for (const { revision, index } of wireCases) {
      const decoded = new PlayerSchema();
      new Decoder(decoded).decode(new Encoder(replicaOf({ routeRevision: revision, nextWaypointIndex: index })).encodeAll());
      const read = fromReplica(decoded);
      expect(read.ok, JSON.stringify({ revision, index })).toBe(true);
      if (!read.ok) continue;
      expect(read.value.locomotion.route, JSON.stringify({ revision, index })).toEqual(
        revision === ROUTE_ABSENT_REVISION ? null : { revision, nextWaypointIndex: index },
      );
      // Second leg: the reconstructed state projects back onto the pair it was read from.
      const again = toReplica(read.value);
      expect(again.ok, JSON.stringify({ revision, index })).toBe(true);
      if (!again.ok) continue;
      expect(again.value.routeRevision).toBe(revision);
      expect(again.value.nextWaypointIndex).toBe(index);
    }
  });

  it('refuses the invalid half of the route pair at every inbound entry point', () => {
    const malformed: readonly { readonly routeRevision: number; readonly nextWaypointIndex: number }[] = [
      { routeRevision: ROUTE_ABSENT_REVISION, nextWaypointIndex: 4 },
      { routeRevision: 1.5, nextWaypointIndex: 0 },
      { routeRevision: -1, nextWaypointIndex: 0 },
      { routeRevision: UINT32_MAX + 1, nextWaypointIndex: 0 },
      { routeRevision: 3, nextWaypointIndex: -1 },
      { routeRevision: 3, nextWaypointIndex: UINT32_MAX + 1 },
    ];
    for (const patch of malformed) {
      const replica = replicaOf(patch);
      // `readReplicaIssues` is the field-level checker: it reports widths, not the pair rule, so the one
      // in-range pair violation is caught by the reader rather than by it. Both must refuse.
      const pairRuleOnly = patch.routeRevision === ROUTE_ABSENT_REVISION && patch.nextWaypointIndex !== ROUTE_ABSENT_INDEX;
      expect(readReplicaIssues(replica).length > 0, JSON.stringify(patch)).toBe(!pairRuleOnly);
      expect(readPlayerReplica(replica).value, JSON.stringify(patch)).toBeUndefined();
      const result = fromReplica(replica);
      expect(result.ok, JSON.stringify(patch)).toBe(false);
      if (!result.ok) expect(result.code, JSON.stringify(patch)).toBe('INVALID_PAYLOAD');
    }
    // A sentinel pair on the wire is legitimate absence, never a refusal.
    expect(fromReplica(replicaOf({ routeRevision: 0, nextWaypointIndex: 0 })).ok).toBe(true);
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

  it('reports a route pair that no reader may accept instead of yielding a state', () => {
    // The map is a supported inbound entry point too: a malformed pair must surface as issues on the
    // entry, never as a reconstructed state with a route the sender never had.
    const region = new RegionSchema();
    region.worldId = 'world-001';
    region.regionId = 'region-greybox-001';
    region.serverTick = 42;
    region.protocolVersion = 'udg-m0-1.0.0';
    region.configVersion = 'm0-config-1';
    region.configHash = 'a'.repeat(64);
    region.manifestHash = 'b'.repeat(64);

    const projected = toReplica(baseState());
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    projected.value.routeRevision = 0;
    projected.value.nextWaypointIndex = 4;
    region.players.set('entity-001', projected.value);

    const [entry] = readPlayerMap(region);
    expect(entry?.state).toBeNull();
    expect(entry?.issues.length).toBeGreaterThan(0);
  });

  it('returns no entries for an undefined replica rather than throwing', () => {
    expect(readPlayerMap(undefined)).toEqual([]);
  });
});
