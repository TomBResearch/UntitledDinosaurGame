/**
 * `@udg/config` unit suite (UDG-002).
 *
 * Three things are proved here and each one earns its place by being the kind of failure that a
 * configuration layer survives silently: a digest that does not change when an input changes, a
 * validator that accepts an inconsistent block, and an extent that nobody chose appearing as a default.
 *
 * The suites import the built workspace output rather than source, because that output is exactly what
 * an application imports. `pnpm build` runs before `pnpm test` locally and in CI, so a red build cannot
 * hide behind a green unit run.
 */

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CONFIG_BOUNDS,
  CONTROLLER_DEFAULTS,
  DEFAULT_NETWORK_CONFIG,
  DEFAULT_INPUT_ENVELOPE_CONFIG,
  DEFAULT_REGION_CONFIG,
  DEFAULT_SERVER_CONFIG,
  MOVEMENT_DEFAULTS,
  PROVISIONAL_P07_FIELDS,
  PROTOCOL_LIMITS,
  REGION_ID,
  WORLD_ID,
  canonicalHash,
  canonicalJson,
  computeConfigHash,
  configBounds,
  deepFreeze,
  isConfigHash,
  movementConfigHash,
  movementHash,
  regionConfigHash,
  regionHash,
  requireRegionBounds,
  sha256Bytes,
  textHash,
  validateControllerConfig,
  validateMovementBlock,
  validateMovementConfig,
  validateNetworkConfig,
  validateRegionBounds,
  validateRegionConfig,
  validateServerConfig,
  withConfigOverrides,
} from '../../../packages/config/dist/index.js';
import { REJECTION_CODES } from '../../../packages/protocol/dist/index.js';

/**
 * The digest is hand-rolled, so it is cross-checked against `node:crypto` rather than against itself.
 *
 * The vectors include the full configuration document: a canonicaliser that mishandled a nested object
 * or a long number would still pass a test over two-key objects.
 */
const VECTORS: readonly unknown[] = [
  '',
  'abc',
  'a longer string with punctuation and a newline\n\tand a tab',
  'unicode: é中文字😀',
  0,
  -0,
  1.5,
  -9.81,
  1 / 3,
  5e-324,
  -1.7976931348623157e308,
  true,
  null,
  [],
  [1, 2, 3],
  { b: 1, a: [1, 2, { d: null, c: true }] },
  { z: { y: { x: [] } } },
  DEFAULT_SERVER_CONFIG,
  MOVEMENT_DEFAULTS,
  CONTROLLER_DEFAULTS,
  DEFAULT_NETWORK_CONFIG,
  PROTOCOL_LIMITS,
  REJECTION_CODES,
];

const nodeSha256 = (text: string): string => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

describe('configuration canonicalisation', () => {
  it('agrees with node:crypto over every vector', () => {
    for (const value of VECTORS) {
      const json = canonicalJson(value);
      expect(canonicalHash(value), `hash of ${json.slice(0, 40)}`).toBe(nodeSha256(json));
    }
  });

  it('hashes raw bytes and text the same way node:crypto does', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    expect(Buffer.from(sha256Bytes(bytes)).toString('hex')).toBe(createHash('sha256').update(Buffer.from(bytes)).digest('hex'));
    expect(textHash('text to digest')).toBe(nodeSha256('text to digest'));
  });

  it('ignores object key order', () => {
    expect(canonicalHash({ x: 1, y: { p: 1, q: 2 } })).toBe(canonicalHash({ y: { q: 2, p: 1 }, x: 1 }));
  });

  it('preserves array order', () => {
    expect(canonicalHash([1, 2])).not.toBe(canonicalHash([2, 1]));
  });

  it('serialises negative zero as zero', () => {
    expect(canonicalJson({ v: -0 })).toBe('{"v":0}');
    expect(canonicalHash({ v: -0 })).toBe(canonicalHash({ v: 0 }));
  });

  it('refuses anything without a faithful JSON form instead of dropping it', () => {
    expect(() => canonicalHash({ v: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalHash({ v: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(() => canonicalHash({ v: Number.NEGATIVE_INFINITY })).toThrow(TypeError);
    expect(() => canonicalHash({ v: 10n })).toThrow(TypeError);
    expect(() => canonicalHash({ v: () => 1 })).toThrow(TypeError);
    expect(() => canonicalHash({ v: Symbol('s') })).toThrow(TypeError);
  });

  it('treats an omitted key and an explicit undefined as the same document', () => {
    // Both forms arrive through different JSON paths, and a hash that distinguished them would make two
    // peers with the same configuration disagree.
    expect(canonicalHash({ a: 1, b: undefined })).toBe(canonicalHash({ a: 1 }));
  });
});

describe('configHash', () => {
  it('is a well-formed SHA-256 digest', () => {
    const hash = computeConfigHash();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(isConfigHash(hash)).toBe(true);
    expect(isConfigHash('ABC')).toBe(false);
  });

  it('is stable across calls', () => {
    expect(computeConfigHash()).toBe(computeConfigHash());
    expect(movementHash()).toBe(movementHash());
    expect(regionHash()).toBe(regionHash());
  });

  it('changes when any single parameter changes', () => {
    const base = computeConfigHash();
    type Config = ReturnType<typeof withConfigOverrides>;
    const changes: readonly { readonly label: string; readonly config: Config }[] = [
      { label: 'movement.speed', config: withConfigOverrides(DEFAULT_SERVER_CONFIG, { movement: { speed: 4.0001 } }) },
      { label: 'movement.gravity', config: withConfigOverrides(DEFAULT_SERVER_CONFIG, { movement: { gravity: -9.8 } }) },
      {
        label: 'movement.capsuleRadius',
        config: withConfigOverrides(DEFAULT_SERVER_CONFIG, { movement: { capsuleRadius: 0.351 } }),
      },
      {
        label: 'controller.restCentreY',
        config: withConfigOverrides(DEFAULT_SERVER_CONFIG, { controller: { restCentreY: 0.911 } }),
      },
      {
        label: 'controller.groundSnapDistance',
        config: withConfigOverrides(DEFAULT_SERVER_CONFIG, { controller: { groundSnapDistance: 0.11 } }),
      },
      { label: 'network.tickRate', config: withConfigOverrides(DEFAULT_SERVER_CONFIG, { network: { tickRate: 30, simulationStepSeconds: 1 / 30 } }) },
      {
        label: 'network.statePatchIntervalMs',
        config: withConfigOverrides(DEFAULT_SERVER_CONFIG, { network: { statePatchIntervalMs: 50 } }),
      },
      {
        label: 'network.reconnectWindowSeconds',
        config: withConfigOverrides(DEFAULT_SERVER_CONFIG, { network: { reconnectWindowSeconds: 45 } }),
      },
      {
        label: 'network.generationGapLimit',
        config: withConfigOverrides(DEFAULT_SERVER_CONFIG, { network: { generationGapLimit: 32 } }),
      },
      { label: 'protocolVersion', config: withConfigOverrides(DEFAULT_SERVER_CONFIG, { protocolVersion: 'udg-m0-1.0.1' }) },
      { label: 'region.worldId', config: withConfigOverrides(DEFAULT_SERVER_CONFIG, { region: { worldId: 'world-002' } }) },
      { label: 'region.regionId', config: withConfigOverrides(DEFAULT_SERVER_CONFIG, { region: { regionId: 'region-002' } }) },
      {
        label: 'region.bounds',
        config: withConfigOverrides(DEFAULT_SERVER_CONFIG, {
          region: {
            bounds: { x: { min: -100, max: 100 }, y: { min: -10, max: 50 }, z: { min: -100, max: 100 } },
          },
        }),
      },
    ];

    for (const change of changes) {
      const hash = computeConfigHash(change.config);
      expect(hash, `${change.label} must move the hash`).not.toBe(base);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('does not change when only key order or object identity changes', () => {
    const reordered = deepFreeze({
      limits: PROTOCOL_LIMITS,
      network: DEFAULT_NETWORK_CONFIG,
      // Phase 2 (W-3): the ADR-0003 input envelope block is part of the hashed configuration; a
      // reordered document must carry it or it is a different document, not the same one reordered.
      input: DEFAULT_INPUT_ENVELOPE_CONFIG,
      controller: CONTROLLER_DEFAULTS,
      movement: MOVEMENT_DEFAULTS,
      region: DEFAULT_REGION_CONFIG,
      protocolVersion: DEFAULT_SERVER_CONFIG.protocolVersion,
    });
    expect(computeConfigHash(reordered)).toBe(computeConfigHash());
  });

  it('separates the movement-only digest from the whole-configuration digest', () => {
    expect(movementHash()).not.toBe(computeConfigHash());
    expect(movementHash()).toBe(movementConfigHash({ movement: MOVEMENT_DEFAULTS, controller: CONTROLLER_DEFAULTS }));
    expect(movementHash(withConfigOverrides(DEFAULT_SERVER_CONFIG, { region: { regionId: 'other' } }))).toBe(movementHash());
  });

  it('hashes absent bounds as null rather than dropping the field', () => {
    // Dropping the key would make "no extents" and "extents that happen to serialise to nothing" collide,
    // and a client would not be able to tell an unconfigured region from a corrupted document.
    expect(canonicalJson({ bounds: null })).toContain('"bounds":null');
    expect(regionHash()).toBe(regionConfigHash(DEFAULT_REGION_CONFIG));
  });
});

describe('movement configuration', () => {
  it('preserves the v0.2 defaults', () => {
    expect(MOVEMENT_DEFAULTS).toMatchObject({
      speed: 4,
      capsuleRadius: 0.35,
      capsuleHeight: 1.8,
      arrivalTolerance: 0.2,
      maxSlopeRadians: Math.PI / 4,
      maxStepHeight: 0.3,
    });
  });

  it('names every provisional value that P07 may still change', () => {
    // The list is a promise about the document, so it is pinned: a value adopted silently would leave
    // this list stale, and the next reader would trust a provenance marker that no longer describes code.
    expect(PROVISIONAL_P07_FIELDS).toEqual([
      'movement.gravity',
      'controller.controllerOffset',
      'controller.groundSnapDistance',
      'controller.minStepTopWidth',
      'controller.staticOnlyAutostep',
      'controller.allowDynamicImpulses',
      'controller.slopeSlideRadians',
      'controller.restCentreY',
    ]);
    expect(CONTROLLER_DEFAULTS.restCentreY).toBeCloseTo(0.91, 10);
    expect(CONTROLLER_DEFAULTS.restCentreY).toBe(0.9 + CONTROLLER_DEFAULTS.controllerOffset);
  });

  it('accepts the default block and round-trips it', () => {
    const result = validateMovementConfig(MOVEMENT_DEFAULTS);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(result.value).toEqual(MOVEMENT_DEFAULTS);
  });

  it('rejects non-finite, non-positive and out-of-range values with a path and a code', () => {
    const cases: readonly { readonly patch: Record<string, unknown>; readonly code: string }[] = [
      { patch: { speed: Number.NaN }, code: 'NOT_FINITE' },
      { patch: { speed: '4' }, code: 'WRONG_TYPE' },
      { patch: { speed: 0 }, code: 'NOT_POSITIVE' },
      { patch: { capsuleRadius: -1 }, code: 'NOT_POSITIVE' },
      { patch: { maxSlopeRadians: Math.PI }, code: 'OUT_OF_RANGE' },
      { patch: { gravity: Number.POSITIVE_INFINITY }, code: 'NOT_FINITE' },
    ];
    for (const entry of cases) {
      const result = validateMovementConfig({ ...MOVEMENT_DEFAULTS, ...entry.patch });
      expect(result.ok, JSON.stringify(entry.patch)).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((issue) => issue.code), JSON.stringify(entry.patch)).toContain(entry.code);
        for (const issue of result.issues) expect(issue.path).toMatch(/^movement\./);
      }
    }
  });

  it('rejects an internally inconsistent capsule', () => {
    const flat = validateMovementConfig({ ...MOVEMENT_DEFAULTS, capsuleHeight: 0.7 });
    expect(flat.ok).toBe(false);
    if (!flat.ok) expect(flat.issues.some((issue) => issue.code === 'INCONSISTENT')).toBe(true);

    const wide = validateMovementConfig({ ...MOVEMENT_DEFAULTS, arrivalTolerance: 5 });
    expect(wide.ok).toBe(false);
    if (!wide.ok) expect(wide.issues.some((issue) => issue.code === 'INCONSISTENT')).toBe(true);
  });

  it('refuses a controller that would inject impulses or snap less than its offset', () => {
    const impulses = validateControllerConfig({ ...CONTROLLER_DEFAULTS, allowDynamicImpulses: true });
    expect(impulses.ok).toBe(false);
    if (!impulses.ok) expect(impulses.issues.some((issue) => issue.message.includes('impulses'))).toBe(true);

    const snap = validateControllerConfig({ ...CONTROLLER_DEFAULTS, groundSnapDistance: 0.001 });
    expect(snap.ok).toBe(false);
    if (!snap.ok) expect(snap.issues.some((issue) => issue.code === 'INCONSISTENT')).toBe(true);
  });

  it('reports an unknown key rather than ignoring it', () => {
    const result = validateMovementConfig({ ...MOVEMENT_DEFAULTS, runSpeed: 9 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe('UNKNOWN_KEY');
  });

  it('validates both halves together', () => {
    const ok = validateMovementBlock({ movement: MOVEMENT_DEFAULTS, controller: CONTROLLER_DEFAULTS });
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
    const bad = validateMovementBlock({ movement: { ...MOVEMENT_DEFAULTS, speed: -1 }, controller: CONTROLLER_DEFAULTS });
    expect(bad.ok).toBe(false);
  });
});

describe('network configuration', () => {
  it('preserves the v0.2 timing defaults', () => {
    expect(DEFAULT_NETWORK_CONFIG).toMatchObject({
      tickRate: 20,
      physicsSubsteps: 1,
      statePatchIntervalMs: 100,
      reconnectWindowSeconds: 30,
      generationGapLimit: 64,
    });
    expect(DEFAULT_NETWORK_CONFIG.simulationStepSeconds).toBe(1 / 20);
  });

  it('refuses a step that does not equal the derived 1 / tickRate', () => {
    // 0.05 and 1 / 20 are the same double, so the default pair is exactly derivable. A different tick
    // rate with the old step is the bug this check exists to catch.
    expect(0.05).toBe(1 / 20);
    expect(validateNetworkConfig({ ...DEFAULT_NETWORK_CONFIG, simulationStepSeconds: 0.05 }).ok).toBe(true);

    const mismatch = validateNetworkConfig({ ...DEFAULT_NETWORK_CONFIG, tickRate: 30 });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.issues.some((issue) => issue.code === 'INCONSISTENT' && issue.path === 'network.simulationStepSeconds')).toBe(true);
    }
  });

  it('refuses fractional counts and a substep baseline that is not one', () => {
    const halfTick = validateNetworkConfig({ ...DEFAULT_NETWORK_CONFIG, tickRate: 20.5, simulationStepSeconds: 1 / 20.5 });
    expect(halfTick.ok).toBe(false);
    if (!halfTick.ok) expect(halfTick.issues.some((issue) => issue.message.includes('whole number'))).toBe(true);

    const twoSubsteps = validateNetworkConfig({ ...DEFAULT_NETWORK_CONFIG, physicsSubsteps: 2 });
    expect(twoSubsteps.ok).toBe(false);
    if (!twoSubsteps.ok) expect(twoSubsteps.issues.some((issue) => issue.code === 'OUT_OF_RANGE')).toBe(true);
  });

  it('refuses a generation window wider than the protocol admits', () => {
    expect(validateNetworkConfig({ ...DEFAULT_NETWORK_CONFIG, generationGapLimit: 65 }).ok).toBe(false);
    expect(validateNetworkConfig({ ...DEFAULT_NETWORK_CONFIG, generationGapLimit: 64 }).ok).toBe(true);
    expect(CONFIG_BOUNDS.generationGapLimit.max).toBe(PROTOCOL_LIMITS.maxGenerationForwardGap);
  });

  it('rejects an unknown key', () => {
    const result = validateNetworkConfig({ ...DEFAULT_NETWORK_CONFIG, inputRate: 30 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe('UNKNOWN_KEY');
  });
});

describe('region bounds', () => {
  const bounds = { x: { min: -100, max: 100 }, y: { min: -10, max: 50 }, z: { min: -100, max: 100 } };

  it('accepts a supplied volume and freezes it', () => {
    const result = validateRegionBounds(bounds);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(bounds);
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.x)).toBe(true);
    }
  });

  it('refuses an inverted or degenerate axis', () => {
    for (const axis of ['x', 'y', 'z'] as const) {
      const inverted = validateRegionBounds({ ...bounds, [axis]: { min: 10, max: -10 } });
      expect(inverted.ok, axis).toBe(false);
      const equal = validateRegionBounds({ ...bounds, [axis]: { min: 5, max: 5 } });
      expect(equal.ok, axis).toBe(false);
    }
  });

  it('refuses non-finite extents, unknown axes and a non-object', () => {
    expect(validateRegionBounds({ ...bounds, x: { min: Number.NaN, max: 1 } }).ok).toBe(false);
    expect(validateRegionBounds({ ...bounds, w: { min: 0, max: 1 } }).ok).toBe(false);
    expect(validateRegionBounds('bounds').ok).toBe(false);
    expect(validateRegionBounds({ ...bounds, x: { min: 0, max: 1, extra: 2 } }).ok).toBe(false);
  });

  it('reports the full path of the offending axis', () => {
    const result = validateRegionBounds({ ...bounds, z: { min: 1, max: 0 } }, 'fixture.bounds');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toBe('fixture.bounds.z.max');
  });

  it('ships no production extents anywhere, and says so by name', () => {
    // Owner decision D5. The assertion is about the package surface, not about one function: a default
    // volume added later under another name has to fail here rather than reach a hash.
    expect(DEFAULT_SERVER_CONFIG.region.bounds).toBeNull();
    expect(DEFAULT_REGION_CONFIG.bounds).toBeNull();

    const missing = requireRegionBounds(DEFAULT_REGION_CONFIG);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.issues[0]?.path).toBe('region.bounds');
      expect(missing.issues[0]?.code).toBe('MISSING');
      expect(missing.issues[0]?.message).toContain('UDG-007');
    }
    expect(configBounds(DEFAULT_SERVER_CONFIG).ok).toBe(false);
  });

  it('keeps identity valid without extents, because UDG-007 has not produced an asset yet', () => {
    const result = validateRegionConfig({ worldId: WORLD_ID, regionId: REGION_ID });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(result.value.bounds).toBeNull();

    const withBounds = validateRegionConfig({ worldId: WORLD_ID, regionId: REGION_ID, bounds });
    expect(withBounds.ok, JSON.stringify(withBounds)).toBe(true);
    if (withBounds.ok && withBounds.value.bounds !== null) {
      expect(withBounds.value.bounds).toEqual(bounds);
      expect(requireRegionBounds(withBounds.value).ok).toBe(true);
    }
  });

  it('falls back to the fixed M0 identifiers but refuses a malformed identifier', () => {
    const result = validateRegionConfig({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.worldId).toBe('world-001');
      expect(result.value.regionId).toBe('region-greybox-001');
    }
    expect(validateRegionConfig({ worldId: 'unicode 🦖' }).ok).toBe(false);
    expect(validateRegionConfig({ worldId: '' }).ok).toBe(false);
    expect(validateRegionConfig({ worldId: 'x'.repeat(65) }).ok).toBe(false);
  });
});

describe('the whole configuration document', () => {
  it('validates the default configuration as a document', () => {
    const result = validateServerConfig(JSON.parse(JSON.stringify(DEFAULT_SERVER_CONFIG)));
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) {
      expect(computeConfigHash(result.value)).toBe(computeConfigHash());
      expect(Object.isFrozen(result.value)).toBe(true);
    }
  });

  it('refuses missing sections', () => {
    const result = validateServerConfig({ protocolVersion: DEFAULT_SERVER_CONFIG.protocolVersion });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.issues.map((issue) => issue.path);
      expect(paths).toContain('region');
      expect(paths).toContain('movement');
      expect(paths).toContain('controller');
      expect(paths).toContain('network');
    }
  });

  it('refuses a document that tries to override the protocol limits', () => {
    const tampered = {
      ...JSON.parse(JSON.stringify(DEFAULT_SERVER_CONFIG)),
      limits: { ...PROTOCOL_LIMITS, maxGenerationForwardGap: 4096 },
    } as Record<string, unknown>;
    const result = validateServerConfig(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.path === 'config.limits')).toBe(true);
  });

  it('refuses an unknown top-level key', () => {
    const result = validateServerConfig({ ...JSON.parse(JSON.stringify(DEFAULT_SERVER_CONFIG)), movement2: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === 'UNKNOWN_KEY')).toBe(true);
  });

  it('refuses a protocol version that is empty or over-long', () => {
    expect(validateServerConfig({ ...DEFAULT_SERVER_CONFIG, protocolVersion: '' }).ok).toBe(false);
    expect(validateServerConfig({ ...DEFAULT_SERVER_CONFIG, protocolVersion: 'v'.repeat(33) }).ok).toBe(false);
  });

  it('hands out frozen values that a fixture mutation cannot edit', () => {
    const result = validateServerConfig(JSON.parse(JSON.stringify(DEFAULT_SERVER_CONFIG)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const config = result.value;
    expect(() => {
      // Deliberate mutation of a validated result: it must throw, and the hash must not move.
      Object.assign(config.movement, { speed: 99 });
    }).toThrow(TypeError);
    expect(config.movement.speed).toBe(4);
    expect(computeConfigHash(config)).toBe(computeConfigHash());
  });

  it('never mutates the shared default when an override is applied', () => {
    const before = computeConfigHash();
    const overridden = withConfigOverrides(DEFAULT_SERVER_CONFIG, { movement: { speed: 12 } });
    expect(overridden.movement.speed).toBe(12);
    expect(DEFAULT_SERVER_CONFIG.movement.speed).toBe(4);
    expect(computeConfigHash()).toBe(before);
    expect(Object.isFrozen(overridden.movement)).toBe(true);
  });
});
