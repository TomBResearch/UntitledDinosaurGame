/**
 * `@udg/config` — the single place server and client read the same numbers from.
 *
 * A validated configuration is one frozen object, and `configHash` is a digest of that object. The
 * hash is the mechanism by which a client and server prove they agree: it travels in `RegionSchema`
 * alongside `manifestHash`, and a mismatch is a deployment error rather than something to negotiate per
 * field. That only works if the digest covers every value that changes behaviour, which is why the
 * protocol limits are part of the input and why the region bounds are hashed as `null` rather than
 * dropped when they are absent.
 *
 * Nothing here reads a file, an environment variable or a URL. Loading and re-validating the region
 * asset at startup is UDG-003's job against UDG-007's asset; this module only says what a valid
 * configuration is and what it hashes to.
 */

import { PROTOCOL_VERSION, type MovementConfig } from '@udg/protocol';
import { canonicalHash, canonicalJson } from './hash.js';
import {
  CONTROLLER_DEFAULTS,
  MOVEMENT_BLOCK,
  MOVEMENT_DEFAULTS,
  movementConfigHash,
  PROVISIONAL_P07_FIELDS,
  validateControllerConfig,
  validateMovementConfig,
  type MovementControllerConfig,
} from './movement.js';
import { DEFAULT_NETWORK_CONFIG, NETWORK_DEFAULTS, validateNetworkConfig, type NetworkConfig } from './network.js';
import {
  DEFAULT_INPUT_ENVELOPE_CONFIG,
  INPUT_ENVELOPE_DEFAULTS,
  validateInputEnvelopeConfig,
  type InputEnvelopeConfig,
} from './input.js';
import { CONFIG_BOUNDS, PROTOCOL_LIMITS, PROTOCOL_PATTERNS } from './limits.js';
import {
  REGION_ID,
  WORLD_ID,
  regionConfigHash,
  requireRegionBounds,
  validateRegionConfig,
  type RegionBounds,
  type RegionConfig,
} from './region.js';
import {
  checkHash,
  configError,
  configFail,
  configOk,
  deepFreeze,
  isRecord,
  checkKnownKeys,
  readStringField,
  type ConfigIssue,
  type ConfigResult,
} from './validation.js';

export * from './hash.js';
export * from './validation.js';
export * from './movement.js';
export * from './network.js';
export * from './limits.js';
export * from './input.js';
export * from './region.js';

/**
 * The whole server configuration.
 *
 * `protocolVersion` is part of configuration rather than a separate negotiation: two processes that
 * disagree about the protocol produce different hashes and refuse each other before a frame is parsed.
 * `region.bounds` is nullable by owner decision D5 — a build may start with identity but no extents,
 * and anything that needs containment must ask, and fail, explicitly.
 */
export interface ServerConfig {
  readonly protocolVersion: string;
  readonly region: Readonly<RegionConfig>;
  readonly movement: Readonly<MovementConfig>;
  readonly controller: Readonly<MovementControllerConfig>;
  readonly network: Readonly<NetworkConfig>;
  readonly input: Readonly<InputEnvelopeConfig>;
  readonly limits: typeof PROTOCOL_LIMITS;
}

// `limits` is a permitted key only in the exact form the protocol build produces; see
// validateServerConfig, which refuses an override instead of ignoring one.
export const SERVER_CONFIG_KEYS = ['protocolVersion', 'region', 'movement', 'controller', 'network', 'input', 'limits'] as const;

/**
 * The default M0 configuration: v0.2 defaults throughout, P07-proposed controller values marked as
 * provisional in `movement.ts`, and no region bounds.
 *
 * There is deliberately no `DEFAULT_REGION_BOUNDS`. Owner decision D5 keeps production defaults out of
 * the repository, so this object validates and hashes without extents.
 */
export const DEFAULT_SERVER_CONFIG: Readonly<ServerConfig> = deepFreeze({
  protocolVersion: PROTOCOL_VERSION,
  region: deepFreeze({ worldId: WORLD_ID, regionId: REGION_ID, bounds: null }),
  movement: MOVEMENT_DEFAULTS,
  controller: CONTROLLER_DEFAULTS,
  network: DEFAULT_NETWORK_CONFIG,
  input: DEFAULT_INPUT_ENVELOPE_CONFIG,
  limits: PROTOCOL_LIMITS,
});

/** Validate a complete configuration document. */
export const validateServerConfig = (raw: unknown): ConfigResult<Readonly<ServerConfig>> => {
  const issues: ConfigIssue[] = [];
  if (!isRecord(raw)) {
    return configError([configFail('config', 'WRONG_TYPE', 'must be an object')]);
  }
  issues.push(...checkKnownKeys('config', raw, SERVER_CONFIG_KEYS));

  const version = readStringField(raw, 'config.protocolVersion', (value) =>
    typeof value === 'string' && value.length > 0 && value.length <= 32
      ? undefined
      : configFail('config.protocolVersion', 'TOO_LONG', 'must be 1 to 32 characters'),
  );
  if (!version.ok) issues.push(version.issue);

  const region = validateRegionConfig(raw['region']);
  if (!region.ok) issues.push(...region.issues);

  const movement = validateMovementConfig(raw['movement']);
  if (!movement.ok) issues.push(...movement.issues);

  const controller = validateControllerConfig(raw['controller']);
  if (!controller.ok) issues.push(...controller.issues);

  const network = validateNetworkConfig(raw['network']);
  if (!network.ok) issues.push(...network.issues);

  const input = validateInputEnvelopeConfig(raw['input']);
  if (!input.ok) issues.push(...input.issues);

  // `limits` is derived, not configurable. A document that carries it is only accepted when it says
  // exactly what this protocol build says; anything else is a claim of authority over wire bounds that
  // configuration does not own. Accepting the matching form keeps a round-tripped configuration
  // document valid, which a blanket rejection would not.
  if (raw['limits'] !== undefined) {
    const declared = canonicalJson(raw['limits']);
    if (declared !== canonicalJson(PROTOCOL_LIMITS)) {
      issues.push(
        configFail('config.limits', 'INCONSISTENT', 'limits are single-sourced from the protocol build and may not be overridden'),
      );
    }
  }

  if (issues.length > 0) return configError(issues);
  if (!version.ok || !region.ok || !movement.ok || !controller.ok || !network.ok || !input.ok) {
    return configError([configFail('config', 'MISSING', 'protocolVersion, region, movement, controller, network and input are required')]);
  }

  return configOk(
    deepFreeze({
      protocolVersion: version.value,
      region: region.value,
      movement: movement.value,
      controller: controller.value,
      network: network.value,
      input: input.value,
      limits: PROTOCOL_LIMITS,
    }),
  );
};

/**
 * `configHash` — SHA-256 over the canonical form of the whole configuration.
 *
 * Key order, whitespace and engine differences cannot change the digest, and a single altered number
 * always does change it. That second property is what the acceptance criteria test, because a hash that
 * missed one block would let a stale client look current.
 */
export const computeConfigHash = (config: Readonly<ServerConfig> = DEFAULT_SERVER_CONFIG): string =>
  canonicalHash({ kind: 'udg-config', ...config });

/** The movement/controller hash travels separately: it is what a movement-only comparison uses. */
export const movementHash = (config: Readonly<ServerConfig> = DEFAULT_SERVER_CONFIG): string =>
  movementConfigHash({ movement: config.movement, controller: config.controller });

export const regionHash = (config: Readonly<ServerConfig> = DEFAULT_SERVER_CONFIG): string =>
  regionConfigHash(config.region);

/**
 * Apply a partial override and return a new frozen configuration.
 *
 * This exists so "one parameter changed, hash changed" is testable without mutating the shared default
 * — a mutated module-level default would leak into every later assertion in the same process and make
 * the proof depend on test order.
 */
export const withConfigOverrides = (
  config: Readonly<ServerConfig>,
  overrides: {
    readonly protocolVersion?: string;
    readonly region?: Partial<RegionConfig>;
    readonly movement?: Partial<MovementConfig>;
    readonly controller?: Partial<MovementControllerConfig>;
    readonly network?: Partial<NetworkConfig>;
    readonly input?: Partial<InputEnvelopeConfig>;
  },
): Readonly<ServerConfig> =>
  deepFreeze({
    protocolVersion: overrides.protocolVersion ?? config.protocolVersion,
    region: deepFreeze({ ...config.region, ...overrides.region }),
    movement: deepFreeze({ ...config.movement, ...overrides.movement }),
    controller: deepFreeze({ ...config.controller, ...overrides.controller }),
    network: deepFreeze({ ...config.network, ...overrides.network }),
    input: deepFreeze({ ...config.input, ...overrides.input }),
    limits: PROTOCOL_LIMITS,
  });

/** A configuration is usable for containment only when its bounds exist. */
export const configBounds = (config: Readonly<ServerConfig>): ConfigResult<Readonly<RegionBounds>> =>
  requireRegionBounds(config.region);

/** Sanity helper used by the client and the server at startup to prove a hash is well-formed. */
export const isConfigHash = (value: unknown): boolean => checkHash('configHash', value) === undefined;

export const CONFIG_PROVENANCE = deepFreeze({
  provisionalFields: PROVISIONAL_P07_FIELDS,
  v02Defaults: { movement: MOVEMENT_BLOCK, network: NETWORK_DEFAULTS, inputEnvelope: INPUT_ENVELOPE_DEFAULTS },
  patterns: PROTOCOL_PATTERNS,
  bounds: CONFIG_BOUNDS,
});
