/**
 * Replica to canonical reconstruction (interfaces/protocol.md 4.4).
 *
 * A decoded instance is not a validated value. The pinned codec warns and continues on a definition
 * mismatch, leaves defaults where it could not read a field, and truncates a payload without raising,
 * so reconstruction re-checks every field before a domain object exists. Route points are never
 * reconstructed here: they are server-only, and a path-mode consumer must render the accepted server
 * transforms rather than infer a route from a replica.
 */

import type { PlayerSimulationState, RegionReplicaState } from '../domain/state.js';
import type { InputDispositionRecord } from '../domain/wire.js';
import type { MovementMode } from '../domain/primitives.js';
import type { Validation } from '../domain/wire.js';
import {
  GENERATION_MAX,
  HASH_PATTERN,
  MAX_IDENTIFIER_LENGTH,
  MAX_VERSION_LENGTH,
  MOVEMENT_MODE_BY_VALUE,
  ROUTE_ABSENT_INDEX,
  ROUTE_ABSENT_REVISION,
  UINT32_MAX,
} from '../version.js';
import type { PlayerSchema } from '../schema/PlayerSchema.js';
import type { RegionSchema } from '../schema/RegionSchema.js';
import { deepFreeze, ASCII_IDENTIFIER, isFiniteNumber, isIntegerInRange, normaliseYaw } from '../validation/common.js';

export interface ReplicaReadIssue {
  readonly field: string;
  readonly reason: string;
}

/** A reconstruction failure is a payload-integrity problem; the closed union has exactly one code for it. */
const asValidation = <T>(read: { readonly issues: readonly ReplicaReadIssue[]; readonly value?: T }): Validation<T> =>
  read.issues.length > 0 || read.value === undefined
    ? { ok: false, code: 'INVALID_PAYLOAD' }
    // A reconstructed state is frozen for the same reason a validated payload is: it is what the
    // receiver will predict against, and a rewrite after decode would be invisible to the sender.
    : { ok: true, value: deepFreeze(read.value) };

const issue = (issues: ReplicaReadIssue[], field: string, reason: string): void => {
  issues.push({ field, reason });
};

const requireFinite = (issues: ReplicaReadIssue[], field: string, value: unknown): void => {
  if (!isFiniteNumber(value)) issue(issues, field, 'must be a finite float64 after decode');
};

const requireUint = (issues: ReplicaReadIssue[], field: string, value: unknown, max: number, min = 0): void => {
  if (!isIntegerInRange(value, min, max)) issue(issues, field, `must be an integer in [${String(min)}, ${String(max)}]`);
};

const requireBoolean = (issues: ReplicaReadIssue[], field: string, value: unknown): void => {
  if (typeof value !== 'boolean') issue(issues, field, 'must be a boolean after decode');
};

const requireIdentifier = (issues: ReplicaReadIssue[], field: string, value: unknown): void => {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_IDENTIFIER_LENGTH || !ASCII_IDENTIFIER.test(value)) {
    issue(issues, field, `must be a printable-ASCII identifier of 1 to ${String(MAX_IDENTIFIER_LENGTH)} characters`);
  }
};

/**
 * Field-by-field check of the prediction-relevant scalar set.
 *
 * The completeness test drives this directly, so a dropped `verticalVelocity` becomes a named issue
 * instead of a silent zero that makes a diff look plausible.
 */
export const readReplicaIssues = (replica: PlayerSchema | undefined): readonly ReplicaReadIssue[] => {
  const issues: ReplicaReadIssue[] = [];
  if (typeof replica !== 'object' || replica === null) {
    issue(issues, 'replica', 'must be a decoded PlayerSchema instance');
    return issues;
  }
  requireIdentifier(issues, 'entityId', replica.entityId);
  for (const field of ['x', 'y', 'z', 'yaw', 'vx', 'vy', 'vz', 'verticalVelocity'] as const) {
    requireFinite(issues, field, replica[field]);
  }
  requireBoolean(issues, 'grounded', replica.grounded);
  requireBoolean(issues, 'connected', replica.connected);
  if (isFiniteNumber(replica.yaw) && !Object.is(replica.yaw, normaliseYaw(replica.yaw))) {
    issue(issues, 'yaw', 'decoded yaw is not normalised to [-PI, PI)');
  }
  requireUint(issues, 'movementMode', replica.movementMode, 255);
  requireUint(issues, 'routeRevision', replica.routeRevision, UINT32_MAX);
  requireUint(issues, 'nextWaypointIndex', replica.nextWaypointIndex, UINT32_MAX);
  // `GENERATION_MAX`, the same bound the outbound validators and `toReplica` apply. A replica carrying
  // `UINT32_MAX` is a wire-integrity failure, not a generation this receiver may adopt.
  requireUint(issues, 'intentGeneration', replica.intentGeneration, GENERATION_MAX);
  requireUint(issues, 'sessionEpoch', replica.sessionEpoch, UINT32_MAX, 1);
  requireUint(issues, 'lastAuthorityTick', replica.lastAuthorityTick, UINT32_MAX);
  return issues;
};

/** Reconstruction with the field-level reasons retained, for fixtures and evidence. */
export const readPlayerReplica = (
  replica: PlayerSchema | undefined,
): { readonly issues: readonly ReplicaReadIssue[]; readonly value?: PlayerSimulationState } => {
  const issues = [...readReplicaIssues(replica)];
  if (issues.length === 0 && replica !== undefined) {
    const mode: MovementMode | undefined = MOVEMENT_MODE_BY_VALUE[replica.movementMode];
    if (mode === undefined) {
      issue(issues, 'movementMode', `${String(replica.movementMode)} is not a declared enum value`);
      return { issues };
    }
    if (
      replica.routeRevision === ROUTE_ABSENT_REVISION &&
      replica.nextWaypointIndex !== ROUTE_ABSENT_INDEX
    ) {
      issue(issues, 'nextWaypointIndex', 'revision 0 means no route and requires index 0');
    }
    if (issues.length > 0) return { issues };

    const route =
      replica.routeRevision === ROUTE_ABSENT_REVISION
        ? null
        : { revision: replica.routeRevision, nextWaypointIndex: replica.nextWaypointIndex };

    // The reconstruction is a value `toReplica` would project identically: `0 / 0` is the only wire
    // encoding of absence, and any surviving route carries a positive revision.
    return {
      issues,
      value: {
        entityId: replica.entityId,
        sessionEpoch: replica.sessionEpoch,
        connected: replica.connected,
        locomotion: {
          kinematic: {
            position: { x: replica.x, y: replica.y, z: replica.z },
            yaw: replica.yaw,
            velocity: { x: replica.vx, y: replica.vy, z: replica.vz },
            grounded: replica.grounded,
            verticalVelocity: replica.verticalVelocity,
          },
          mode,
          route,
          intentGeneration: replica.intentGeneration,
          lastAuthorityTick: replica.lastAuthorityTick,
        },
      },
    };
  }
  return { issues };
};

/** Reconstruct canonical player state from a decoded replica. */
export const fromReplica = (replica: PlayerSchema | undefined): Validation<PlayerSimulationState> =>
  asValidation(readPlayerReplica(replica));

/** Field-by-field check of the region-level replica. */
export const readRegionIssues = (replica: RegionSchema | undefined): readonly ReplicaReadIssue[] => {
  const issues: ReplicaReadIssue[] = [];
  if (typeof replica !== 'object' || replica === null) {
    issue(issues, 'region', 'must be a decoded RegionSchema instance');
    return issues;
  }
  requireIdentifier(issues, 'worldId', replica.worldId);
  requireIdentifier(issues, 'regionId', replica.regionId);
  requireUint(issues, 'serverTick', replica.serverTick, UINT32_MAX);
  if (typeof replica.protocolVersion !== 'string' || replica.protocolVersion.length === 0 || replica.protocolVersion.length > MAX_VERSION_LENGTH) {
    issue(issues, 'protocolVersion', `must be 1 to ${String(MAX_VERSION_LENGTH)} characters`);
  }
  if (typeof replica.configVersion !== 'string' || replica.configVersion.length === 0 || replica.configVersion.length > MAX_VERSION_LENGTH) {
    issue(issues, 'configVersion', `must be 1 to ${String(MAX_VERSION_LENGTH)} characters`);
  }
  if (typeof replica.configHash !== 'string' || !HASH_PATTERN.test(replica.configHash)) {
    issue(issues, 'configHash', 'must be 64 lowercase hex characters');
  }
  if (typeof replica.manifestHash !== 'string' || !HASH_PATTERN.test(replica.manifestHash)) {
    issue(issues, 'manifestHash', 'must be 64 lowercase hex characters');
  }
  return issues;
};

/** Region-level reconstruction. The player map is read separately so the caller chooses how to key it. */
export const readRegionReplica = (
  replica: RegionSchema | undefined,
): { readonly issues: readonly ReplicaReadIssue[]; readonly value?: RegionReplicaState } => {
  const issues = [...readRegionIssues(replica)];
  if (issues.length > 0 || replica === undefined) return { issues };
  return {
    issues,
    value: {
      worldId: replica.worldId,
      regionId: replica.regionId,
      serverTick: replica.serverTick,
      protocolVersion: replica.protocolVersion,
      configVersion: replica.configVersion,
      configHash: replica.configHash,
      manifestHash: replica.manifestHash,
    },
  };
};

export const fromRegionReplica = (replica: RegionSchema | undefined): Validation<RegionReplicaState> =>
  asValidation(readRegionReplica(replica));

export interface PlayerMapEntry {
  readonly key: string;
  readonly state: PlayerSimulationState | null;
  readonly issues: readonly ReplicaReadIssue[];
}

/**
 * Player-map entries with the map key cross-checked against the embedded entity id.
 *
 * A mismatch is reported rather than repaired: the key and the identity have one source of truth, and
 * silently re-keying an entry would let a stale entry shadow a live one.
 */
export const readPlayerMap = (replica: RegionSchema | undefined): readonly PlayerMapEntry[] => {
  if (typeof replica !== 'object' || replica === null) return [];
  const entries: PlayerMapEntry[] = [];
  replica.players.forEach((player, key) => {
    const read = readPlayerReplica(player);
    const issues = [...read.issues];
    if (read.value !== undefined && read.value.entityId !== key) {
      issue(issues, 'entityId', `map key "${key}" does not match the replica entity id "${read.value.entityId}"`);
    }
    entries.push({ key, state: read.value ?? null, issues });
  });
  return entries;
};

// --- Disposition record and effect ledger (ADR-0003 §4; UDG-003 Phase 2 W-2) --------------------

/** Field-by-field check of the disposition fields on a decoded replica. */
export const readDispositionIssues = (replica: PlayerSchema | undefined): readonly ReplicaReadIssue[] => {
  const issues: ReplicaReadIssue[] = [];
  if (typeof replica !== 'object' || replica === null) {
    issue(issues, 'disposition', 'must be a decoded PlayerSchema instance');
    return issues;
  }
  requireUint(issues, 'inputResolvedThrough', replica.inputResolvedThrough, UINT32_MAX);
  requireUint(issues, 'inputGapStart', replica.inputGapStart, UINT32_MAX);
  requireUint(issues, 'inputGapEnd', replica.inputGapEnd, UINT32_MAX);
  if (replica.inputGapStart !== 0 || replica.inputGapEnd !== 0) {
    // A named range must be a pair of legal stamps in order; the `0 / 0` pair is the no-gap sentinel.
    if (replica.inputGapStart === 0 || replica.inputGapEnd === 0) {
      issue(issues, 'inputGapStart', 'a named gap must carry two legal stamps; only the 0/0 pair means "no gap"');
    } else if (replica.inputGapStart <= replica.inputGapEnd) {
      // Valid pair: `0` is never a legal stamp, and `start <= end` is the pair rule.
    } else {
      issue(issues, 'inputGapEnd', 'a named gap must satisfy start <= end');
    }
  }
  requireUint(issues, 'inputRetiredUnrepresented', replica.inputRetiredUnrepresented, UINT32_MAX);
  requireUint(issues, 'effectCount', replica.effectCount, UINT32_MAX);
  const requestId = replica.lastAppliedRequestId;
  if (typeof requestId !== 'string') {
    issue(issues, 'lastAppliedRequestId', 'must be a string; the empty string means "none yet"');
  } else if (requestId !== '' && (requestId.length > MAX_IDENTIFIER_LENGTH || !ASCII_IDENTIFIER.test(requestId))) {
    issue(issues, 'lastAppliedRequestId', 'must be empty or a printable-ASCII identifier of at most 64 characters');
  }
  return issues;
};

/**
 * Reconstruct the disposition record from a decoded replica.
 *
 * Same discipline as `fromReplica`: a decoded instance is not a validated value. The `0 / 0` gap
 * pair reconstructs to `null` (no gap named) and the empty request id to `null` (no effect yet).
 */
export const readDisposition = (
  replica: PlayerSchema | undefined,
): { readonly issues: readonly ReplicaReadIssue[]; readonly value?: InputDispositionRecord } => {
  const issues = [...readDispositionIssues(replica)];
  if (issues.length > 0 || replica === undefined) return { issues };
  return {
    issues,
    value: {
      inputResolvedThrough: replica.inputResolvedThrough,
      gap: replica.inputGapStart === 0 && replica.inputGapEnd === 0
        ? null
        : { start: replica.inputGapStart, end: replica.inputGapEnd },
      inputRetiredUnrepresented: replica.inputRetiredUnrepresented,
      effectCount: replica.effectCount,
      lastAppliedRequestId: replica.lastAppliedRequestId === '' ? null : replica.lastAppliedRequestId,
    },
  };
};
