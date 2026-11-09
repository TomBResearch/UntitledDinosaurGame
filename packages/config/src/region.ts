/**
 * Region identity and bounds.
 *
 * Owner decision D5 is the shape of this file: region bounds are **supplied and validated**, and this
 * package ships no production default. That is not an omission to fill in later — an invented world
 * extent is a gameplay decision wearing a default value, and once it is in a hash every environment
 * that inherits it silently agrees with a number nobody chose. Absence is therefore a configuration
 * error reported by name, and the only bounds that exist here are the ones a caller passes in.
 *
 * The real bounds belong to `assets/regions/region-greybox-001/region.json`, which **UDG-007** produces
 * and **UDG-003** loads and re-validates at startup, binding them to `configHash` and the asset
 * `manifestHash`. UDG-002 must not depend on that asset existing, which is why every validator here
 * takes bounds as an argument instead of reaching for them.
 *
 * The `RegionBounds` *type* is `@udg/protocol`'s, not a copy: `isInsideBounds` in the wire validator
 * consumes the same declaration, so a configuration that validates is a volume the validator can use
 * without a translation layer that could disagree with either side.
 */

import type { AxisRange, RegionBounds } from '@udg/protocol';
import { canonicalHash } from './hash.js';
import {
  checkFinite,
  configError,
  configOk,
  configFail,
  deepFreeze,
  isRecord,
  readNumericFields,
  checkIdentifier,
  checkKnownKeys,
  type ConfigIssue,
  type ConfigResult,
} from './validation.js';

export type { AxisRange, RegionBounds } from '@udg/protocol';

/** The three axis keys of a bounds block. */
export const REGION_AXES = ['x', 'y', 'z'] as const;
export const AXIS_RANGE_KEYS = ['min', 'max'] as const;

/** v0.2 fixed identifiers for M0. Identifiers are configuration; extents are not. */
export const WORLD_ID = 'world-001';
export const REGION_ID = 'region-greybox-001';

/**
 * Validate one axis.
 *
 * Ordering is part of validity: `min >= max` is not an empty region, it is a volume that no containment
 * test can answer, and every `isInsideBounds` result downstream would be a lie.
 */
const validateAxisRange = (
  raw: unknown,
  path: string,
): { readonly ok: true; readonly value: Readonly<AxisRange> } | { readonly ok: false; readonly issues: readonly ConfigIssue[] } => {
  if (!isRecord(raw)) {
    return { ok: false, issues: [configFail(path, 'WRONG_TYPE', 'must be an object with finite min and max')] };
  }
  const issues: ConfigIssue[] = [...checkKnownKeys(path, raw, AXIS_RANGE_KEYS)];
  const numeric = readNumericFields(raw, path, [
    { key: 'min', check: (value) => checkFinite(`${path}.min`, value) },
    { key: 'max', check: (value) => checkFinite(`${path}.max`, value) },
  ]);
  issues.push(...numeric.issues);

  const min = numeric.values['min'];
  const max = numeric.values['max'];
  if (min !== undefined && max !== undefined && min >= max) {
    issues.push(configFail(`${path}.max`, 'INCONSISTENT', 'max must be greater than min'));
  }
  if (issues.length > 0) return { ok: false, issues };
  if (min === undefined || max === undefined) {
    return { ok: false, issues: [configFail(path, 'MISSING', 'min and max are both required')] };
  }
  return { ok: true, value: deepFreeze({ min, max }) };
};

/**
 * Validate a bounds block: three axes, each an ordered finite range.
 *
 * `path` is a parameter because the same block is validated inside a region document, inside a fixture
 * envelope and inside a startup load in UDG-003, and an issue whose path is relative to one of those is
 * unactionable in the others.
 */
export const validateRegionBounds = (raw: unknown, path = 'region.bounds'): ConfigResult<Readonly<RegionBounds>> => {
  if (!isRecord(raw)) {
    return configError([configFail(path, 'WRONG_TYPE', 'must be an object with x, y and z ranges')]);
  }
  const issues: ConfigIssue[] = [...checkKnownKeys(path, raw, REGION_AXES)];

  const axes: Partial<Record<(typeof REGION_AXES)[number], Readonly<AxisRange>>> = {};
  for (const axis of REGION_AXES) {
    const read = validateAxisRange(raw[axis], `${path}.${axis}`);
    if (read.ok) axes[axis] = read.value;
    else issues.push(...read.issues);
  }

  if (issues.length > 0) return configError(issues);
  const x = axes['x'];
  const y = axes['y'];
  const z = axes['z'];
  if (x === undefined || y === undefined || z === undefined) {
    return configError([configFail(path, 'MISSING', 'x, y and z ranges are all required')]);
  }
  return configOk(deepFreeze({ x, y, z }));
};

/** Region identity with optional bounds; `null` means "not configured", which is never a default. */
export interface RegionConfig {
  readonly worldId: string;
  readonly regionId: string;
  readonly bounds: Readonly<RegionBounds> | null;
}

export const REGION_CONFIG_KEYS = ['worldId', 'regionId', 'bounds'] as const;

/**
 * Read one region identifier.
 *
 * The v0.2 identifiers are fixed for M0, so an absent value falls back to the fixed identifier while a
 * present-but-invalid value is an error. That asymmetry is deliberate: `world-001` is this build's
 * identity, whereas a malformed identifier means the file disagrees with the build.
 */
const readRegionIdentifier = (
  raw: Readonly<Record<string, unknown>>,
  key: 'worldId' | 'regionId',
  fallback: string,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly issue: ConfigIssue } => {
  const value = raw[key] ?? fallback;
  if (typeof value !== 'string') {
    return { ok: false, issue: configFail(`region.${key}`, 'WRONG_TYPE', 'must be a string') };
  }
  const issue = checkIdentifier(`region.${key}`, value);
  return issue !== undefined ? { ok: false, issue } : { ok: true, value };
};

/**
 * Validate a region block.
 *
 * Validating identity does not imply validating extents: a region can be named before its geometry
 * exists, which is exactly the state UDG-002 is in while UDG-007 is unassigned. Consumers that need
 * containment must call {@link requireRegionBounds}, which reports the missing configuration by name.
 */
export const validateRegionConfig = (raw: unknown): ConfigResult<Readonly<RegionConfig>> => {
  const issues: ConfigIssue[] = [];
  if (!isRecord(raw)) {
    return configError([configFail('region', 'WRONG_TYPE', 'must be an object')]);
  }
  issues.push(...checkKnownKeys('region', raw, REGION_CONFIG_KEYS));

  const worldId = readRegionIdentifier(raw, 'worldId', WORLD_ID);
  const regionId = readRegionIdentifier(raw, 'regionId', REGION_ID);
  if (!worldId.ok) issues.push(worldId.issue);
  if (!regionId.ok) issues.push(regionId.issue);

  let bounds: Readonly<RegionBounds> | null = null;
  const rawBounds = raw['bounds'];
  if (rawBounds !== undefined && rawBounds !== null) {
    const read = validateRegionBounds(rawBounds);
    if (read.ok) bounds = read.value;
    else issues.push(...read.issues);
  }

  if (issues.length > 0) return configError(issues);
  if (!worldId.ok || !regionId.ok) {
    return configError([configFail('region', 'MISSING', 'worldId and regionId are required')]);
  }
  return configOk(deepFreeze({ worldId: worldId.value, regionId: regionId.value, bounds }));
};

/** The M0 identity with no extents, which is the only default this package offers. */
export const DEFAULT_REGION_CONFIG: Readonly<RegionConfig> = deepFreeze({
  worldId: WORLD_ID,
  regionId: REGION_ID,
  bounds: null,
});

/**
 * Bounds that a containment validator needs.
 *
 * A `null` bounds block is a configuration error naming the missing key, never a fallback volume, and
 * the message says where the real value comes from so the fix is not guessed.
 */
export const requireRegionBounds = (config: Readonly<RegionConfig>): ConfigResult<Readonly<RegionBounds>> =>
  config.bounds === null
    ? configError([
        configFail(
          'region.bounds',
          'MISSING',
          'region bounds are not configured; they are supplied by the region asset (UDG-007) and validated at startup (UDG-003), and no default is provided',
        ),
      ])
    : configOk(config.bounds);

/** Region identity plus bounds, with `null` hashing as `null` rather than being dropped. */
export const regionHashInput = (config: Readonly<RegionConfig>): unknown => ({
  kind: 'udg-region-config',
  worldId: config.worldId,
  regionId: config.regionId,
  bounds: config.bounds,
});

export const regionConfigHash = (config: Readonly<RegionConfig>): string => canonicalHash(regionHashInput(config));
