/**
 * Room-free schema round trip against the pinned codec (UDG-002).
 *
 * interfaces/protocol.md 4.4 requires "a minimal room-free round trip using pinned schema declarations",
 * and the pinned package has to be probed rather than assumed: these tests double as the evidence record
 * that docs/contracts/protocol-v1.md cites, because the codec's failure modes decide where validation has
 * to live.
 *
 * The finding that shapes the design is that this codec is silent about almost everything. It preserves
 * `NaN` and infinities, coerces out-of-range integers without complaint, returns a half-decoded object
 * from a truncated buffer instead of throwing, and continues past a definition mismatch with a warning.
 * A round trip that only checked "the numbers came back" would therefore prove nothing about safety, so
 * each coercion is asserted here and refused in mapping.
 */

import { describe, expect, it } from 'vitest';

// The codec surface comes from the pinned re-export rather than from `@colyseus/schema` directly: see
// packages/protocol/src/schema/index.ts for why the package name appears in exactly one place.
import {
  Decoder,
  DIRECT_INPUT_FIELDS,
  Encoder,
  MapSchema,
  PLAYER_FIELDS,
  REGION_FIELDS,
  DirectInputSchema,
  PlayerSchema,
  RegionSchema,
  schema,
  t,
} from '../../../packages/protocol/dist/schema/index.js';
import { fromReplica, toReplica, toRegionReplica } from '../../../packages/protocol/dist/mapping/index.js';
import { validateJoin } from '../../../packages/protocol/dist/index.js';
import { computeConfigHash, DEFAULT_SERVER_CONFIG } from '../../../packages/config/dist/index.js';

/**
 * Encode a full snapshot and decode it into a fresh instance.
 *
 * `encodeAll()` is the full-state channel of this package version and `new Decoder(target)` decodes into
 * a caller-owned instance, which is what makes a room-free round trip possible at all: no transport, no
 * room, no SDK.
 */
const roundTrip = <T>(source: T, Target: new () => T): T => {
  // Encoder and Decoder are typed against the library's own schema base type; the casts say only that
  // a declared schema class is one of those, which is what the constructors above produce.
  const bytes = new Encoder(source as never).encodeAll();
  const target = new Target();
  new Decoder(target as never).decode(bytes);
  return target;
};

const newPlayer = (): PlayerSchema => new PlayerSchema();

const motionPlayer = (): PlayerSchema => {
  const player = newPlayer();
  player.entityId = 'entity-001';
  player.x = 0.1 + 0.2;
  player.y = -Math.PI;
  player.z = -5e-324;
  player.yaw = 1 / 3;
  player.vx = 1.7976931348623157e308;
  player.vy = -0.4905;
  player.vz = 0;
  player.grounded = true;
  player.verticalVelocity = -1.2345678901234567;
  player.movementMode = 2;
  player.routeRevision = 5;
  player.nextWaypointIndex = 7;
  player.intentGeneration = 42;
  player.sessionEpoch = 4_294_967_295;
  player.connected = true;
  player.lastAuthorityTick = 1234;
  return player;
};

describe('the pinned codec preserves the scalar set', () => {
  it('carries every prediction-relevant field exactly', () => {
    const decoded = roundTrip(motionPlayer(), PlayerSchema);
    expect(decoded.entityId).toBe('entity-001');
    expect(decoded.x).toBe(0.1 + 0.2);
    expect(decoded.y).toBe(-Math.PI);
    expect(decoded.z).toBe(-5e-324);
    expect(decoded.yaw).toBe(1 / 3);
    expect(decoded.vx).toBe(1.7976931348623157e308);
    expect(decoded.vy).toBe(-0.4905);
    expect(decoded.vz).toBe(0);
    expect(decoded.grounded).toBe(true);
    expect(decoded.verticalVelocity).toBe(-1.2345678901234567);
    expect(decoded.movementMode).toBe(2);
    expect(decoded.routeRevision).toBe(5);
    expect(decoded.nextWaypointIndex).toBe(7);
    expect(decoded.intentGeneration).toBe(42);
    expect(decoded.sessionEpoch).toBe(4_294_967_295);
    expect(decoded.connected).toBe(true);
    expect(decoded.lastAuthorityTick).toBe(1234);
  });

  it('keeps verticalVelocity distinct from vy across the wire', () => {
    const player = motionPlayer();
    player.vy = -0.4905;
    player.verticalVelocity = -9.80665;
    const decoded = roundTrip(player, PlayerSchema);
    expect(decoded.vy).toBe(-0.4905);
    expect(decoded.verticalVelocity).toBe(-9.80665);
    expect(decoded.vy).not.toBe(decoded.verticalVelocity);
  });

  it('carries the null-to-zero route sentinel as two zeros', () => {
    const player = motionPlayer();
    player.routeRevision = 0;
    player.nextWaypointIndex = 0;
    const decoded = roundTrip(player, PlayerSchema);
    expect(decoded.routeRevision).toBe(0);
    expect(decoded.nextWaypointIndex).toBe(0);
  });

  it('round trips the flat input declaration with declared defaults', () => {
    const input = new DirectInputSchema();
    input.sessionEpoch = 7;
    input.generation = 12;
    input.directIntent = true;
    input.moveX = 0.7071067811865475;
    input.moveZ = -1;
    const decoded = roundTrip(input, DirectInputSchema);
    expect(decoded.sessionEpoch).toBe(7);
    expect(decoded.generation).toBe(12);
    expect(decoded.directIntent).toBe(true);
    expect(decoded.moveX).toBe(0.7071067811865475);
    expect(decoded.moveZ).toBe(-1);

    const empty = roundTrip(new DirectInputSchema(), DirectInputSchema);
    expect([empty.sessionEpoch, empty.generation, empty.directIntent, empty.moveX, empty.moveZ]).toEqual([0, 0, false, 0, 0]);
  });

  it('carries a player map keyed by entity id, with the region identity and hash fields', () => {
    const region = new RegionSchema();
    region.worldId = 'world-001';
    region.regionId = 'region-greybox-001';
    region.serverTick = 42;
    region.protocolVersion = 'udg-m0-1.0.0';
    region.configVersion = 'm0-config-1';
    region.configHash = 'a'.repeat(64);
    region.manifestHash = 'b'.repeat(64);
    const first = motionPlayer();
    const second = motionPlayer();
    second.entityId = 'entity-002';
    second.x = 7;
    region.players.set('entity-001', first);
    region.players.set('entity-002', second);

    const decoded = roundTrip(region, RegionSchema);
    expect(decoded.players instanceof MapSchema).toBe(true);
    expect(decoded.players.size).toBe(2);
    expect([...decoded.players.keys()]).toEqual(['entity-001', 'entity-002']);
    expect(decoded.players.get('entity-002')?.x).toBe(7);
    expect(decoded.players.get('entity-001')?.verticalVelocity).toBe(-1.2345678901234567);
    expect(decoded.configHash).toBe('a'.repeat(64));
    expect(decoded.manifestHash).toBe('b'.repeat(64));
    expect(REGION_FIELDS.length).toBe(8);
    // Phase 2 (W-2, ADR-0003 §4): DirectInputSchema carries the per-frame send sequence `seq`,
    // and PlayerSchema carries the disposition record and effect ledger (6 new fields). The old
    // pins (5 and 17) held until that approved wire change; the movement and region sets are
    // unchanged, which is the half that matters for movementHash (§6.6 of the Phase 2 assignment).
    expect(DIRECT_INPUT_FIELDS.length).toBe(6);
    expect(PLAYER_FIELDS.length).toBe(23);
  });

  it('produces an empty full-sync only when the state has no recorded changes', () => {
    // A second full sync of the same instance encodes nothing, because encoding drains the change tree.
    // Anything that snapshots a state for a fixture must therefore encode a fresh instance, or it records
    // zero bytes and calls that a round trip.
    const player = motionPlayer();
    const first = new Encoder(player).encodeAll();
    expect(first.byteLength).toBeGreaterThan(0);
    const second = new Encoder(player).encodeAll();
    expect(second.byteLength).toBe(0);
  });
});

describe('the pinned codec is silent about values the protocol forbids', () => {
  it('preserves NaN and both infinities, so mapping must refuse them on both sides', () => {
    const player = newPlayer();
    player.x = Number.NaN;
    player.vy = Number.POSITIVE_INFINITY;
    player.vz = Number.NEGATIVE_INFINITY;
    const decoded = roundTrip(player, PlayerSchema);
    expect(Number.isNaN(decoded.x)).toBe(true);
    expect(decoded.vy).toBe(Number.POSITIVE_INFINITY);
    expect(decoded.vz).toBe(Number.NEGATIVE_INFINITY);

    // The codec carries them, so the only protection is that projection refuses them before encoding and
    // reconstruction refuses them after decoding.
    const state = {
      entityId: 'entity-001',
      sessionEpoch: 7,
      connected: true,
      locomotion: {
        kinematic: {
          position: { x: Number.NaN, y: 0.9, z: 0 },
          yaw: 0,
          velocity: { x: 0, y: 0, z: 0 },
          grounded: true,
          verticalVelocity: 0,
        },
        mode: 'idle' as const,
        route: null,
        intentGeneration: 0,
        lastAuthorityTick: 1,
      },
    };
    const projection = toReplica(state);
    expect(projection.ok).toBe(false);

    const decodedBad = newPlayer();
    decodedBad.x = Number.NaN;
    const read = fromReplica(decodedBad);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.code).toBe('INVALID_PAYLOAD');
  });

  it('turns negative zero into positive zero, which is why validation normalises first', () => {
    const player = newPlayer();
    player.x = -0;
    player.yaw = -0;
    const decoded = roundTrip(player, PlayerSchema);
    expect(Object.is(decoded.x, -0)).toBe(false);
    expect(Object.is(decoded.x, 0)).toBe(true);
    expect(Object.is(decoded.yaw, 0)).toBe(true);
  });

  it('coerces out-of-range integers silently instead of refusing them', () => {
    const player = newPlayer();
    // Assigned raw values are kept as JavaScript numbers until encode time; the coercion is invisible.
    player.movementMode = 256;
    player.routeRevision = 4_294_967_296;
    player.nextWaypointIndex = -1;
    player.intentGeneration = 1.5;
    player.sessionEpoch = 2.9;
    expect(player.movementMode).toBe(256);

    const decoded = roundTrip(player, PlayerSchema);
    expect(decoded.movementMode).toBe(0);
    expect(decoded.routeRevision).toBe(0);
    expect(decoded.nextWaypointIndex).toBe(4_294_967_295);
    expect(decoded.intentGeneration).toBe(1);
    expect(decoded.sessionEpoch).toBe(2);

    // Every one of those is a value the protocol forbids, and mapping is what forbids it.
    const state = {
      entityId: 'entity-001',
      sessionEpoch: 7,
      connected: true,
      locomotion: {
        kinematic: {
          position: { x: 0, y: 0.9, z: 0 },
          yaw: 0,
          velocity: { x: 0, y: 0, z: 0 },
          grounded: true,
          verticalVelocity: 0,
        },
        mode: 'sidling' as never,
        route: null,
        intentGeneration: 1.5,
        lastAuthorityTick: -1,
      },
    };
    const projection = toReplica(state);
    expect(projection.ok).toBe(false);
    if (!projection.ok) {
      const fields = projection.issues.map((issue: { field: string }) => issue.field);
      expect(fields).toContain('movementMode');
      expect(fields).toContain('intentGeneration');
      expect(fields).toContain('lastAuthorityTick');
    }
  });

  it('decodes a truncated buffer into a partial object instead of throwing', () => {
    const source = motionPlayer();
    const bytes = new Encoder(source).encodeAll();
    const target = newPlayer();
    let threw: unknown;
    try {
      new Decoder(target).decode(bytes.slice(0, 3));
    } catch (error) {
      threw = error;
    }
    // Either outcome is acceptable; what is not acceptable is trusting a decoded object without reading
    // it through the validator, which is what fromReplica does.
    if (threw !== undefined) {
      expect(threw).toBeInstanceOf(Error);
    } else {
      expect(target.x).not.toBe(0.1 + 0.2);
      const read = fromReplica(target);
      const malformedIdentity = typeof target.entityId !== 'string' || target.entityId.length === 0;
      if (!malformedIdentity) {
        // A partially decoded replica still has to be refused or reported, never adopted as state.
        expect(read.ok, JSON.stringify(read)).toBe(false);
      }
    }
  });

  it('walks past a definition mismatch with a warning, so identity checks are load-bearing', () => {
    // A same-named schema with a different field set is the shape a deployment accident takes. The codec
    // warns and keeps going; only the join identity check makes the mismatch visible.
    const warnings: unknown[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]): void => {
      warnings.push(args);
    };
    // Declared without a placeholder value: the assertion below is about what the decode actually
    // carried, and an initial 0 could satisfy it by accident if the body ever stopped assigning.
    let carried: number | undefined;
    try {
      const source = newPlayer();
      source.entityId = 'e';
      source.x = 3.5;
      const bytes = new Encoder(source).encodeAll();

      // The same declaration name with a different field set is what a bad merge or a stale bundle looks
      // like. The context cache is keyed by class, so this declaration cannot disturb the cases above.
      const Diverged = schema(
        { entityId: t.string().default(''), x: t.float64().default(0), extra: t.float64().default(9) },
        'PlayerSchema',
      );
      const target = new Diverged();
      new Decoder(target).decode(bytes);
      carried = target.x;
      expect(target.entityId).toBe('e');
      expect(target.extra).not.toBe(3.5);
    } finally {
      console.warn = original;
    }
    expect(carried).toBe(3.5);
    expect(warnings.length).toBeGreaterThan(0);

    // The protocol-level guard: a peer that cannot name this build's identity is refused before a frame
    // is ever parsed.
    const mismatch = validateJoin(
      { protocolVersion: 'udg-m0-0.0.1', configHash: computeConfigHash(DEFAULT_SERVER_CONFIG), manifestHash: '1'.repeat(64) },
      {
        protocolVersion: DEFAULT_SERVER_CONFIG.protocolVersion,
        configHash: computeConfigHash(DEFAULT_SERVER_CONFIG),
        manifestHash: '1'.repeat(64),
      },
    );
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.code).toBe('PROTOCOL_MISMATCH');
  });

  it('refuses an unnormalised yaw on the way out and reads a normalised yaw back', () => {
    const unnormalised = {
      entityId: 'entity-001',
      sessionEpoch: 7,
      connected: true,
      locomotion: {
        kinematic: {
          position: { x: 0, y: 0.9, z: 0 },
          yaw: Math.PI,
          velocity: { x: 0, y: 0, z: 0 },
          grounded: true,
          verticalVelocity: 0,
        },
        mode: 'idle' as const,
        route: null,
        intentGeneration: 0,
        lastAuthorityTick: 1,
      },
    };
    const projection = toReplica(unnormalised);
    expect(projection.ok).toBe(false);

    const wrapped = {
      ...unnormalised,
      locomotion: {
        ...unnormalised.locomotion,
        kinematic: { ...unnormalised.locomotion.kinematic, yaw: -Math.PI },
      },
    };
    const okProjection = toReplica(wrapped);
    expect(okProjection.ok, JSON.stringify(okProjection)).toBe(true);
    if (okProjection.ok) {
      const decoded = roundTrip(okProjection.value, PlayerSchema);
      expect(decoded.yaw).toBe(-Math.PI);
    }
  });

  it('projects and reads back a region replica without loss', () => {
    const region = {
      worldId: 'world-001',
      regionId: 'region-greybox-001',
      serverTick: 4_294_967_294,
      protocolVersion: DEFAULT_SERVER_CONFIG.protocolVersion,
      configVersion: 'm0-config-1',
      configHash: computeConfigHash(DEFAULT_SERVER_CONFIG),
      manifestHash: 'c'.repeat(64),
    };
    const projected = toRegionReplica(region);
    expect(projected.ok, JSON.stringify(projected)).toBe(true);
    if (projected.ok) {
      const bytes = new Encoder(projected.value).encodeAll();
      const target = new RegionSchema();
      new Decoder(target).decode(bytes);
      expect(target.serverTick).toBe(4_294_967_294);
      expect(target.configHash).toBe(region.configHash);
    }
  });
});
