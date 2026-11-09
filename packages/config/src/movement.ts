/**
 * Movement configuration: the v0.2 defaults, the P07-proposed controller values, and their validation
 * and hash inputs (docs/interfaces/configuration.md 4.5).
 *
 * Provenance is recorded per value rather than per file, because two of the numbers below come from
 * different authorities. `MOVEMENT_DEFAULTS` preserves the adopted v0.2 defaults. The controller block
 * and `gravity` are the **P07-proposed test settings, which are still pending adoption**: they exist so
 * that UDG-005 has something to run against and so that `configHash` already covers them, and
 * `PROVISIONAL_P07_FIELDS` names every value that P07 may still change. Nothing here claims P07 is
 * adopted, and the field-map test asserts that the pending list and the values stay in step.
 */

import type { MovementConfig } from '@udg/protocol/domain';
import { canonicalHash } from './hash.js';
import {
  buildBlock,
  checkFinite,
  checkPositive,
  checkRange,
  configError,
  configOk,
  deepFreeze,
  emptyBooleans,
  isRecord,
  checkKnownKeys,
  configFail,
  readBooleanFields,
  readNumericFields,
  type ConfigIssue,
  type ConfigResult,
} from './validation.js';

/** v0.2 defaults for the canonical `MovementConfig`. */
export const MOVEMENT_DEFAULTS: Readonly<MovementConfig> = deepFreeze({
  /** v0.2 §5: 4 m/s. */
  speed: 4,
  /** v0.2: capsule radius 0.35 m. */
  capsuleRadius: 0.35,
  /** v0.2: capsule total height 1.8 m. */
  capsuleHeight: 1.8,
  /** v0.2: arrival tolerance 0.2 m. */
  arrivalTolerance: 0.2,
  /**
   * P07-proposed gravity, pending adoption. v0.2 declares the field but sets no default, so this value
   * is the proposed test setting recorded in configuration.md 4.5 and is listed in
   * {@link PROVISIONAL_P07_FIELDS}.
   */
  gravity: -9.81,
  /** v0.2: maximum slope pi/4 radians. */
  maxSlopeRadians: Math.PI / 4,
  /** v0.2: step height 0.3 m. */
  maxStepHeight: 0.3,
});

/**
 * Controller settings proposed by P07.
 *
 * P07 is **pending**, so these values are provisional in exactly the same sense as `gravity`, and they
 * participate in `movementConfigHash` because configuration.md 4.5 requires all movement and controller
 * values to be hashed.
 */
export interface MovementControllerConfig {
  /** Probe offset used to distinguish contact from penetration. */
  readonly controllerOffset: number;
  /** Distance the controller may pull the capsule down onto descending ground. */
  readonly groundSnapDistance: number;
  /** Narrowest step top that autostep may accept. */
  readonly minStepTopWidth: number;
  /** Autostep reads static colliders only. */
  readonly staticOnlyAutostep: boolean;
  /** No impulse may be injected by the controller. */
  readonly allowDynamicImpulses: boolean;
  /** Slide angle; proposed to start equal to the climb limit. */
  readonly slopeSlideRadians: number;
  /** Capsule centre height on level ground: half height plus the controller separation. */
  readonly restCentreY: number;
}

export const CONTROLLER_DEFAULTS: Readonly<MovementControllerConfig> = deepFreeze({
  controllerOffset: 0.01,
  groundSnapDistance: 0.1,
  minStepTopWidth: 0.35,
  staticOnlyAutostep: true,
  allowDynamicImpulses: false,
  slopeSlideRadians: Math.PI / 4,
  /** 0.9 m capsule centre plus the 0.01 m controller separation (configuration.md 4.5). */
  restCentreY: 0.9 + 0.01,
});

/** Every value whose authority is the still-pending P07. */
export const PROVISIONAL_P07_FIELDS: readonly string[] = [
  'movement.gravity',
  'controller.controllerOffset',
  'controller.groundSnapDistance',
  'controller.minStepTopWidth',
  'controller.staticOnlyAutostep',
  'controller.allowDynamicImpulses',
  'controller.slopeSlideRadians',
  'controller.restCentreY',
];

export const MOVEMENT_KEYS = ['speed', 'capsuleRadius', 'capsuleHeight', 'arrivalTolerance', 'gravity', 'maxSlopeRadians', 'maxStepHeight'] as const;
export const CONTROLLER_KEYS = [
  'controllerOffset',
  'groundSnapDistance',
  'minStepTopWidth',
  'staticOnlyAutostep',
  'allowDynamicImpulses',
  'slopeSlideRadians',
  'restCentreY',
] as const;

/**
 * Validate a movement block.
 *
 * Internal consistency is checked, not just each value in isolation: a capsule whose height does not
 * exceed its diameter, or an arrival tolerance wider than the step, describes no physical character,
 * and configuration.md 4.5 requires an inconsistent configuration to fail startup.
 */
export const validateMovementConfig = (raw: unknown): ConfigResult<Readonly<MovementConfig>> => {
  const issues: ConfigIssue[] = [];
  if (!isRecord(raw)) {
    return configError([configFail('movement', 'WRONG_TYPE', 'must be an object')]);
  }
  issues.push(...checkKnownKeys('movement', raw, MOVEMENT_KEYS));

  const read = readNumericFields(raw, 'movement', [
    { key: 'speed', check: (value) => checkPositive('movement.speed', value) },
    { key: 'capsuleRadius', check: (value) => checkPositive('movement.capsuleRadius', value) },
    { key: 'capsuleHeight', check: (value) => checkPositive('movement.capsuleHeight', value) },
    { key: 'arrivalTolerance', check: (value) => checkPositive('movement.arrivalTolerance', value) },
    { key: 'gravity', check: (value) => checkFinite('movement.gravity', value) },
    { key: 'maxSlopeRadians', check: (value) => checkRange('movement.maxSlopeRadians', value, 0, Math.PI / 2) },
    { key: 'maxStepHeight', check: (value) => checkPositive('movement.maxStepHeight', value) },
  ]);
  issues.push(...read.issues);

  const height = read.values['capsuleHeight'];
  const radius = read.values['capsuleRadius'];
  const tolerance = read.values['arrivalTolerance'];
  if (height !== undefined && radius !== undefined && height <= radius * 2) {
    issues.push(configFail('movement.capsuleHeight', 'INCONSISTENT', 'must exceed the capsule diameter'));
  }
  if (tolerance !== undefined && radius !== undefined && tolerance > radius * 2) {
    issues.push(configFail('movement.arrivalTolerance', 'INCONSISTENT', 'must not exceed the capsule diameter'));
  }

  return buildBlock('movement', read, emptyBooleans, issues, (number) =>
    deepFreeze({
      speed: number('speed'),
      capsuleRadius: number('capsuleRadius'),
      capsuleHeight: number('capsuleHeight'),
      arrivalTolerance: number('arrivalTolerance'),
      gravity: number('gravity'),
      maxSlopeRadians: number('maxSlopeRadians'),
      maxStepHeight: number('maxStepHeight'),
    }),
  );
};

/** Validate the controller block against the same finite-and-consistent rule. */
export const validateControllerConfig = (raw: unknown): ConfigResult<Readonly<MovementControllerConfig>> => {
  const issues: ConfigIssue[] = [];
  if (!isRecord(raw)) {
    return configError([configFail('controller', 'WRONG_TYPE', 'must be an object')]);
  }
  issues.push(...checkKnownKeys('controller', raw, CONTROLLER_KEYS));

  const numeric = readNumericFields(raw, 'controller', [
    { key: 'controllerOffset', check: (value) => checkPositive('controller.controllerOffset', value) },
    { key: 'groundSnapDistance', check: (value) => checkPositive('controller.groundSnapDistance', value) },
    { key: 'minStepTopWidth', check: (value) => checkPositive('controller.minStepTopWidth', value) },
    { key: 'slopeSlideRadians', check: (value) => checkRange('controller.slopeSlideRadians', value, 0, Math.PI / 2) },
    { key: 'restCentreY', check: (value) => checkPositive('controller.restCentreY', value) },
  ]);
  issues.push(...numeric.issues);

  const booleans = readBooleanFields(raw, 'controller', ['staticOnlyAutostep', 'allowDynamicImpulses']);
  issues.push(...booleans.issues);
  if (booleans.values['allowDynamicImpulses'] === true) {
    issues.push(configFail('controller.allowDynamicImpulses', 'INCONSISTENT', 'the controller may not inject dynamic impulses'));
  }

  const offset = numeric.values['controllerOffset'];
  const snap = numeric.values['groundSnapDistance'];
  if (offset !== undefined && snap !== undefined && snap < offset) {
    issues.push(configFail('controller.groundSnapDistance', 'INCONSISTENT', 'ground snap must be at least the controller offset'));
  }

  return buildBlock('controller', numeric, booleans, issues, (number, boolean) =>
    deepFreeze({
      controllerOffset: number('controllerOffset'),
      groundSnapDistance: number('groundSnapDistance'),
      minStepTopWidth: number('minStepTopWidth'),
      staticOnlyAutostep: boolean('staticOnlyAutostep'),
      allowDynamicImpulses: boolean('allowDynamicImpulses'),
      slopeSlideRadians: number('slopeSlideRadians'),
      restCentreY: number('restCentreY'),
    }),
  );
};

/** Movement plus controller values, which is the unit that `movementConfigHash` covers. */
export interface MovementBlock {
  readonly movement: Readonly<MovementConfig>;
  readonly controller: Readonly<MovementControllerConfig>;
}

export const MOVEMENT_BLOCK: Readonly<MovementBlock> = deepFreeze({
  movement: MOVEMENT_DEFAULTS,
  controller: CONTROLLER_DEFAULTS,
});

/** Validate both halves together so a mismatch between them is caught. */
export const validateMovementBlock = (raw: unknown): ConfigResult<Readonly<MovementBlock>> => {
  const issues: ConfigIssue[] = [];
  if (!isRecord(raw)) {
    return configError([configFail('movementBlock', 'WRONG_TYPE', 'must be an object with movement and controller')]);
  }
  const movement = validateMovementConfig(raw['movement']);
  const controller = validateControllerConfig(raw['controller']);
  if (!movement.ok) issues.push(...movement.issues);
  if (!controller.ok) issues.push(...controller.issues);
  if (issues.length > 0) return configError(issues);
  if (!movement.ok || !controller.ok) {
    return configError([configFail('movementBlock', 'MISSING', 'movement and controller are both required')]);
  }
  return configOk(deepFreeze({ movement: movement.value, controller: controller.value }));
};

/** `movementConfigHash` input: all movement and controller values, nothing else. */
export const movementConfigHash = (block: Readonly<MovementBlock> = MOVEMENT_BLOCK): string =>
  canonicalHash({
    kind: 'udg-movement-config',
    movement: block.movement,
    controller: block.controller,
  });
