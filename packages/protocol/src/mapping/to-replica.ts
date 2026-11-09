/**
 * Canonical state to replica projection (interfaces/protocol.md 4.4).
 *
 * This is a validation boundary, not an assignment shortcut. Probe evidence in
 * docs/contracts/protocol-v1.md shows that the pinned codec coerces silently — a `uint32` field given
 * `4294967296` decodes as `0`, `-1` as `4294967295`, `1.5` as `1`, and a `uint8` given `256` decodes
 * as `0` — so refusing an out-of-domain value here is the only thing that makes a width "fail safely
 * at bounds" as the contract requires. Yaw must already be normalised, because the protocol states the
 * wire never carries an unnormalised angle.
 *
 * There is no client-side write path and no setter that could accept an authoritative transform from a
 * peer: this module is a projection from canonical state outward, used by authority only.
 */

import type { EntityId, MovementMode } from '../domain/primitives.js';
import type { KinematicState, PlayerSimulationState, RegionReplicaState } from '../domain/state.js';
import {
  GENERATION_MAX,
  HASH_PATTERN,
  MAX_IDENTIFIER_LENGTH,
  MAX_VERSION_LENGTH,
  ROUTE_ABSENT_INDEX,
  ROUTE_ABSENT_REVISION,
  UINT32_MAX,
} from '../version.js';
import { PlayerSchema } from '../schema/PlayerSchema.js';
import { RegionSchema } from '../schema/RegionSchema.js';
import { ASCII_IDENTIFIER, isFiniteNumber, isIntegerInRange, normaliseYaw } from '../validation/common.js';

export interface MappingIssue {
  readonly field: string;
  readonly reason: string;
}

export type MappingResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly MappingIssue[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Declaration order of `movementMode`, which is exactly the adopted uint8 encoding. */
const MOVEMENT_MODE_ORDER: readonly string[] = ['idle', 'direct', 'path'];

const modeCodeOf = (mode: MovementMode | string): number | undefined => {
  const index = MOVEMENT_MODE_ORDER.indexOf(mode);
  return index < 0 ? undefined : index;
};

const collect = (issues: MappingIssue[], field: string, reason: string): void => {
  issues.push({ field, reason });
};

const checkFinite = (issues: MappingIssue[], field: string, value: unknown): void => {
  if (!isFiniteNumber(value)) collect(issues, field, 'must be a finite float64');
};

/**
 * Also pins signed zero, because the wire cannot carry `-0` and a signed zero would perturb a hash.
 *
 * The comparison is `Object.is`, not `=== -0`: `0 === -0` is true in JavaScript, so an equality test
 * here would refuse every legitimate zero and make an ordinary resting state unprojectable.
 */
const checkFiniteNormalised = (issues: MappingIssue[], field: string, value: unknown): void => {
  checkFinite(issues, field, value);
  if (Object.is(value, -0)) collect(issues, field, 'signed zero must be normalised to +0 before mapping');
};

const checkUint = (issues: MappingIssue[], field: string, value: unknown, max: number, min = 0): void => {
  if (!isIntegerInRange(value, min, max)) {
    collect(issues, field, `must be an integer in [${String(min)}, ${String(max)}]; the codec would wrap or truncate it`);
  }
};

const checkIdentifier = (issues: MappingIssue[], field: string, value: unknown): void => {
  if (typeof value !== 'string' || value.length === 0) {
    collect(issues, field, 'must be a non-empty string');
    return;
  }
  if (value.length > MAX_IDENTIFIER_LENGTH) {
    collect(issues, field, `must be at most ${String(MAX_IDENTIFIER_LENGTH)} characters`);
    return;
  }
  if (!ASCII_IDENTIFIER.test(value)) collect(issues, field, 'must be printable ASCII with no whitespace');
};

const checkBoundedString = (issues: MappingIssue[], field: string, value: unknown, max: number): void => {
  if (typeof value !== 'string' || value.length === 0) collect(issues, field, 'must be a non-empty string');
  else if (value.length > max) collect(issues, field, `must be at most ${String(max)} characters`);
};

const checkHash = (issues: MappingIssue[], field: string, value: unknown): void => {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) collect(issues, field, 'must be 64 lowercase hex characters');
};

const checkBoolean = (issues: MappingIssue[], field: string, value: unknown): void => {
  if (typeof value !== 'boolean') collect(issues, field, 'must be a boolean');
};

/** Yaw must arrive normalised; normalisation belongs to validation and locomotion, not to mapping. */
const checkNormalisedYaw = (issues: MappingIssue[], field: string, value: unknown): void => {
  checkFinite(issues, field, value);
  if (isFiniteNumber(value) && !Object.is(value, normaliseYaw(value))) {
    collect(issues, field, 'must already be normalised to [-PI, PI) before mapping');
  }
};

const checkKinematic = (issues: MappingIssue[], kinematic: KinematicState | undefined): void => {
  if (!isRecord(kinematic) || !isRecord(kinematic.position) || !isRecord(kinematic.velocity)) {
    collect(issues, 'kinematic', 'must carry position and velocity vectors');
    return;
  }
  checkFiniteNormalised(issues, 'x', kinematic.position.x);
  checkFiniteNormalised(issues, 'y', kinematic.position.y);
  checkFiniteNormalised(issues, 'z', kinematic.position.z);
  checkNormalisedYaw(issues, 'yaw', kinematic.yaw);
  checkFiniteNormalised(issues, 'vx', kinematic.velocity.x);
  checkFiniteNormalised(issues, 'vy', kinematic.velocity.y);
  checkFiniteNormalised(issues, 'vz', kinematic.velocity.z);
  checkBoolean(issues, 'grounded', kinematic.grounded);
  // Distinct from vy by contract. Both are replicated, and omitting this one is the known failure mode.
  checkFiniteNormalised(issues, 'verticalVelocity', kinematic.verticalVelocity);
};

/**
 * The lowest revision a **canonical** route may carry.
 *
 * `0` is reserved for absence, and absence is spelled `null` in the domain, so a `RouteProgress` whose
 * revision is `0` has no meaning that `null` does not already carry. It is refused rather than
 * projected, because the projection would send the `0 / 0` sentinel and the round trip would come back
 * as `null`: not the value that went in. Kept package-private; the public numeric vocabulary in
 * `../version.ts` is unchanged.
 */
const ROUTE_MIN_REVISION = ROUTE_ABSENT_REVISION + 1;
/**
 * Validate the canonical state that a player replica would be produced from.
 *
 * The route pair rule (owner decision D1) is **not optional**: there is no caller-visible way to turn
 * it off, because a projection that skipped it would produce a replica that decodes to a different
 * canonical state than the one it was built from.
 */
export const checkPlayerState = (state: PlayerSimulationState | undefined): readonly MappingIssue[] => {
  const issues: MappingIssue[] = [];
  if (!isRecord(state)) {
    collect(issues, 'state', 'must be a PlayerSimulationState object');
    return issues;
  }
  checkIdentifier(issues, 'entityId', state.entityId);
  checkUint(issues, 'sessionEpoch', state.sessionEpoch, UINT32_MAX, 1);
  checkBoolean(issues, 'connected', state.connected);

  if (!isRecord(state.locomotion)) {
    collect(issues, 'locomotion', 'must be a LocomotionState object');
    return issues;
  }
  checkKinematic(issues, state.locomotion.kinematic);

  if (modeCodeOf(state.locomotion.mode) === undefined) {
    collect(issues, 'movementMode', `"${String(state.locomotion.mode)}" is not idle, direct or path`);
  }

  const route = state.locomotion.route;
  if (route === null) {
    // Absence is legal and encodes as the null-to-zero sentinel.
  } else if (!isRecord(route)) {
    collect(issues, 'route', 'must be null or a RouteProgress object');
  } else {
    // Width first, from `0` rather than from `ROUTE_MIN_REVISION`: revision `0` is representable on the
    // wire, so it gets the one semantic issue below instead of a width complaint as well. Everything the
    // width cannot carry — negative, fractional, oversized, non-finite — is reported here.
    checkUint(issues, 'routeRevision', route.revision, UINT32_MAX, ROUTE_ABSENT_REVISION);
    checkUint(issues, 'nextWaypointIndex', route.nextWaypointIndex, UINT32_MAX, ROUTE_ABSENT_INDEX);
    if (route.revision === ROUTE_ABSENT_REVISION) {
      // Each half of the pair is reported under its own name and once each: `routeRevision` carries the
      // canonical-absence reason, `nextWaypointIndex` the pair rule the wire table states.
      collect(issues, 'routeRevision', `a non-null route must carry a revision of at least ${String(ROUTE_MIN_REVISION)}; canonical absence is null`);
      if (typeof route.nextWaypointIndex === 'number' && route.nextWaypointIndex !== ROUTE_ABSENT_INDEX) {
        collect(issues, 'nextWaypointIndex', 'revision 0 means no route and requires index 0');
      }
    }
  }

  // `GENERATION_MAX`, not `UINT32_MAX`: the same bound the outbound validators apply, so a state that
  // validated cannot be projected onto a generation the receiver will refuse.
  checkUint(issues, 'intentGeneration', state.locomotion.intentGeneration, GENERATION_MAX);
  checkUint(issues, 'lastAuthorityTick', state.locomotion.lastAuthorityTick, UINT32_MAX);
  return issues;
};

/**
 * Validate and project canonical state into a fresh replica instance.
 *
 * The returned instance must be owned by exactly one encoder: the pinned codec delta-encodes and
 * stamps full-sync generations per context, so pushing the same instance through two encoders drops
 * field values. That probe result is recorded with a reproduction in docs/contracts/protocol-v1.md.
 */
export const toReplica = (state: PlayerSimulationState): MappingResult<PlayerSchema> => {
  const issues = checkPlayerState(state);
  if (issues.length > 0) return { ok: false, issues };

  const replica = new PlayerSchema();
  replica.entityId = state.entityId;
  replica.x = state.locomotion.kinematic.position.x;
  replica.y = state.locomotion.kinematic.position.y;
  replica.z = state.locomotion.kinematic.position.z;
  replica.yaw = state.locomotion.kinematic.yaw;
  replica.vx = state.locomotion.kinematic.velocity.x;
  replica.vy = state.locomotion.kinematic.velocity.y;
  replica.vz = state.locomotion.kinematic.velocity.z;
  replica.grounded = state.locomotion.kinematic.grounded;
  replica.verticalVelocity = state.locomotion.kinematic.verticalVelocity;
  replica.movementMode = modeCodeOf(state.locomotion.mode) ?? 0;
  replica.routeRevision = state.locomotion.route === null ? ROUTE_ABSENT_REVISION : state.locomotion.route.revision;
  replica.nextWaypointIndex =
    state.locomotion.route === null ? ROUTE_ABSENT_INDEX : state.locomotion.route.nextWaypointIndex;
  replica.intentGeneration = state.locomotion.intentGeneration;
  replica.sessionEpoch = state.sessionEpoch;
  replica.connected = state.connected;
  replica.lastAuthorityTick = state.locomotion.lastAuthorityTick;
  return { ok: true, value: replica };
};

/** Validate the canonical region values that a region replica would be produced from. */
export const checkRegionState = (region: RegionReplicaState | undefined): readonly MappingIssue[] => {
  const issues: MappingIssue[] = [];
  if (!isRecord(region)) {
    collect(issues, 'region', 'must be a RegionReplicaState object');
    return issues;
  }
  checkIdentifier(issues, 'worldId', region.worldId);
  checkIdentifier(issues, 'regionId', region.regionId);
  checkUint(issues, 'serverTick', region.serverTick, UINT32_MAX);
  checkBoundedString(issues, 'protocolVersion', region.protocolVersion, MAX_VERSION_LENGTH);
  checkBoundedString(issues, 'configVersion', region.configVersion, MAX_VERSION_LENGTH);
  checkHash(issues, 'configHash', region.configHash);
  checkHash(issues, 'manifestHash', region.manifestHash);
  return issues;
};

/** Region-level projection. Hashes and versions are width-checked before they reach the codec. */
export const toRegionReplica = (region: RegionReplicaState): MappingResult<RegionSchema> => {
  const issues = checkRegionState(region);
  if (issues.length > 0) return { ok: false, issues };

  const replica = new RegionSchema();
  replica.worldId = region.worldId;
  replica.regionId = region.regionId;
  replica.serverTick = region.serverTick;
  replica.protocolVersion = region.protocolVersion;
  replica.configVersion = region.configVersion;
  replica.configHash = region.configHash;
  replica.manifestHash = region.manifestHash;
  return { ok: true, value: replica };
};

/** Player-map key. Keys and entity ids must agree or the map is unusable after a decode. */
export const playerMapKey = (entityId: EntityId): string => entityId;

/** Exposed so the field-map test can pin the enum against declaration order. */
export const movementModeCode = (mode: MovementMode): number | undefined => modeCodeOf(mode);
