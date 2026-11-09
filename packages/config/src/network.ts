/**
 * Timing and session configuration: the v0.2 defaults and their validation.
 *
 * Every value carries its own provenance because they do not share a status. `tickRate`,
 * `physicsSubsteps`, `statePatchIntervalMs` and `reconnectWindowSeconds` are the v0.2 defaults
 * (UDG-SPEC-M0-002 2.3), `simulationStepSeconds` is *derived* from the tick rate rather than chosen,
 * and `generationGapLimit` is the adopted 64-generation forward window from
 * [protocol.md 4.2](../../../docs/interfaces/protocol.md).
 *
 * Two things are deliberately absent. There is no client input rate: direct input is sampled by the SDK
 * fixed-step layer, which owns its own sequence accounting, and inventing a second rate here would
 * create a knob nobody reads. There is no RTT, jitter or prediction-window setting: the 100 ms RTT and
 * 20 ms jitter figures are conditions imposed by the acceptance gate, not server configuration, and
 * turning a test condition into a runtime setting invites a build that passes the gate by editing the
 * gate's own inputs.
 */

import { MAX_GENERATION_FORWARD_GAP, UINT32_MAX } from '@udg/protocol';
import { canonicalHash } from './hash.js';
import {
  buildBlock,
  checkPositive,
  checkRange,
  configError,
  configFail,
  deepFreeze,
  emptyBooleans,
  isRecord,
  checkKnownKeys,
  readNumericFields,
  type ConfigIssue,
  type ConfigResult,
} from './validation.js';
import { CONFIG_BOUNDS } from './limits.js';

/** Server-owned timing and session values. A client may read these and cannot override them. */
export interface NetworkConfig {
  /** v0.2 provisional: 20 Hz authoritative tick. */
  readonly tickRate: number;
  /** Derived simulation step; must equal `1 / tickRate` exactly. */
  readonly simulationStepSeconds: number;
  /** v0.2 provisional: one physics substep. UDG-SPIKE-002 may measure sensitivity but may not change this. */
  readonly physicsSubsteps: number;
  /** v0.2 provisional: state patch interval in milliseconds. */
  readonly statePatchIntervalMs: number;
  /** v0.2 initial policy: reconnection window in seconds. */
  readonly reconnectWindowSeconds: number;
  /** Adopted forward-generation window (protocol.md 4.2). The admission policy is UDG-003's. */
  readonly generationGapLimit: number;
}

export const NETWORK_DEFAULTS = {
  tickRate: 20,
  simulationStepSeconds: 1 / 20,
  physicsSubsteps: 1,
  statePatchIntervalMs: 100,
  reconnectWindowSeconds: 30,
  generationGapLimit: MAX_GENERATION_FORWARD_GAP,
} as const satisfies NetworkConfig;

export const NETWORK_KEYS = [
  'tickRate',
  'simulationStepSeconds',
  'physicsSubsteps',
  'statePatchIntervalMs',
  'reconnectWindowSeconds',
  'generationGapLimit',
] as const;

/**
 * Validate the timing block, including the derivation that makes it coherent.
 *
 * `simulationStepSeconds` is derived, so a block whose step disagrees with `1 / tickRate` is rejected
 * rather than resolved by preferring one of them: two authoritative timesteps in one configuration is
 * exactly the inconsistency the fixed-step contract cannot survive.
 */
export const validateNetworkConfig = (raw: unknown): ConfigResult<Readonly<NetworkConfig>> => {
  const issues: ConfigIssue[] = [];
  if (!isRecord(raw)) {
    return configError([configFail('network', 'WRONG_TYPE', 'must be an object')]);
  }
  issues.push(...checkKnownKeys('network', raw, NETWORK_KEYS));

  const numeric = readNumericFields(raw, 'network', [
    { key: 'tickRate', check: (value) => checkRange('network.tickRate', value, CONFIG_BOUNDS.tickRate.min, CONFIG_BOUNDS.tickRate.max) },
    {
      key: 'simulationStepSeconds',
      check: (value) => checkPositive('network.simulationStepSeconds', value),
    },
    {
      key: 'physicsSubsteps',
      check: (value) => checkRange('network.physicsSubsteps', value, CONFIG_BOUNDS.physicsSubsteps.min, CONFIG_BOUNDS.physicsSubsteps.max),
    },
    {
      key: 'statePatchIntervalMs',
      check: (value) => checkPositive('network.statePatchIntervalMs', value),
    },
    {
      key: 'reconnectWindowSeconds',
      check: (value) => checkRange('network.reconnectWindowSeconds', value, CONFIG_BOUNDS.reconnectWindowSeconds.min, CONFIG_BOUNDS.reconnectWindowSeconds.max),
    },
    {
      key: 'generationGapLimit',
      check: (value) =>
        checkRange('network.generationGapLimit', value, CONFIG_BOUNDS.generationGapLimit.min, CONFIG_BOUNDS.generationGapLimit.max),
    },
  ]);
  issues.push(...numeric.issues);

  // Integral counts must be integral: 1.5 substeps or a 20.5 Hz tick is not a rounding, it is a
  // different simulation that would still hash as if it were valid.
  for (const key of ['tickRate', 'physicsSubsteps', 'generationGapLimit'] as const) {
    const value = numeric.values[key];
    if (value !== undefined && !Number.isInteger(value)) {
      issues.push(configFail(`network.${key}`, 'OUT_OF_RANGE', 'must be a whole number'));
    }
    if (value !== undefined && value > UINT32_MAX) {
      issues.push(configFail(`network.${key}`, 'OUT_OF_RANGE', `must not exceed ${String(UINT32_MAX)}`));
    }
  }

  const tickRate = numeric.values['tickRate'];
  const step = numeric.values['simulationStepSeconds'];
  if (tickRate !== undefined && step !== undefined && step !== 1 / tickRate) {
    issues.push(
      configFail(
        'network.simulationStepSeconds',
        'INCONSISTENT',
        `must equal 1 / tickRate exactly; expected ${String(1 / tickRate)}`,
      ),
    );
  }
  const patchInterval = numeric.values['statePatchIntervalMs'];
  if (patchInterval !== undefined && !Number.isInteger(patchInterval)) {
    issues.push(configFail('network.statePatchIntervalMs', 'OUT_OF_RANGE', 'must be a whole number of milliseconds'));
  }

  return buildBlock('network', numeric, emptyBooleans, issues, (number) =>
    deepFreeze({
      tickRate: number('tickRate'),
      simulationStepSeconds: number('simulationStepSeconds'),
      physicsSubsteps: number('physicsSubsteps'),
      statePatchIntervalMs: number('statePatchIntervalMs'),
      reconnectWindowSeconds: number('reconnectWindowSeconds'),
      generationGapLimit: number('generationGapLimit'),
    }),
  );
};

export const DEFAULT_NETWORK_CONFIG: Readonly<NetworkConfig> = deepFreeze(NETWORK_DEFAULTS);

/** Hash input for the timing block alone. */
export const networkConfigHash = (config: Readonly<NetworkConfig> = DEFAULT_NETWORK_CONFIG): string =>
  canonicalHash({ kind: 'udg-network-config', network: config });
