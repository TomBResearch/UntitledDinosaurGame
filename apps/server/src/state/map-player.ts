/**
 * Publishing entity state and the disposition record into the replicated schema
 * (UDG-003 Phase 2, W-2/W-4; protocol-v1 §6 and §6.5).
 *
 * Two disciplines, both load-bearing:
 *
 * 1. The **canonical projection stays the only route to movement fields.** This module never
 *    computes a position, a mode or a watermark — it runs the protocol's `toReplica` /
 *    `toRegionReplica` and copies the produced values into the live schema instances. What moves
 *    is *where* the values are written, not how they are derived.
 * 2. The disposition record is **not** part of `PlayerSimulationState` and never travels through
 *    the canonical projection (protocol-v1 §6.5). It is applied by `applyDisposition` beside it,
 *    from the transport's own record, in the tick that consumed — so canonical state neither
 *    carries nor can forge a disposition, and a replay without a transport produces the same
 *    canonical state it always did.
 */

import {
  applyDisposition,
  PLAYER_FIELDS,
  PlayerSchema,
  toRegionReplica,
  toReplica,
} from '@udg/protocol/schema';
import type { EntityId, PlayerSimulationState, RegionReplicaState } from '@udg/protocol';
import type { RegionSchema } from '@udg/protocol/schema';

import type { DispositionRecordState } from '../network/ColyseusInputAdapter.js';

/** The publish result: the replica row, or the mapping issues that refused it. */
export type PublishResult = { readonly ok: true } | { readonly ok: false; readonly issues: readonly string[] };

/**
 * Publish one entity's canonical state and disposition record.
 *
 * The live `PlayerSchema` instance per entity is retained and updated field-by-field from the
 * freshly projected replica — replacement-per-tick would defeat schema diffing and inflate every
 * patch. The field copy is mechanical: the names come from `PLAYER_FIELDS`, the values from the
 * canonical projection itself, so no semantics can hide in the loop.
 */
export const publishPlayer = (
  region: RegionSchema,
  entityId: EntityId,
  state: PlayerSimulationState,
  disposition: DispositionRecordState,
): PublishResult => {
  const projected = toReplica(state);
  if (projected.ok === false) return { ok: false, issues: projected.issues.map((issue) => `${issue.field}: ${issue.reason}`) };
  // The explicit copy above must stay in step with the protocol's own field list. A divergence here
  // is a defect, so it is a failure, not a comment: the canonical rows are 17 fields; the remaining
  // six are the disposition record and effect ledger, which `applyDisposition` owns.
  if (PLAYER_FIELDS.length !== 23) {
    return { ok: false, issues: [`PLAYER_FIELDS grew to ${String(PLAYER_FIELDS.length)}; the explicit copy in publishPlayer must move with it`] };
  }
  const key = entityId;
  let row = region.players.get(key);
  if (row === undefined) {
    row = new PlayerSchema();
    region.players.set(key, row);
  }
  // Explicit field-by-field copy — the field names are `PLAYER_FIELDS`, the protocol's own closed
  // list, and the statements below are exactly that list in order. No cast trick is used to move
  // values between schema instances: the escape-hatch prohibition is a rule for all repository code,
  // and a 23-line copy is auditable in a way an indexed-union cast never is.
  row.entityId = projected.value.entityId;
  row.x = projected.value.x;
  row.y = projected.value.y;
  row.z = projected.value.z;
  row.yaw = projected.value.yaw;
  row.vx = projected.value.vx;
  row.vy = projected.value.vy;
  row.vz = projected.value.vz;
  row.grounded = projected.value.grounded;
  row.verticalVelocity = projected.value.verticalVelocity;
  row.movementMode = projected.value.movementMode;
  row.routeRevision = projected.value.routeRevision;
  row.nextWaypointIndex = projected.value.nextWaypointIndex;
  row.intentGeneration = projected.value.intentGeneration;
  row.sessionEpoch = projected.value.sessionEpoch;
  row.connected = projected.value.connected;
  row.lastAuthorityTick = projected.value.lastAuthorityTick;
  // The disposition and ledger fields are deliberately NOT copied here: they never travel through
  // the canonical projection (§6.5) and `applyDisposition` below is their only writer.
  const applied = applyDisposition(row, {
    inputResolvedThrough: disposition.inputResolvedThrough,
    gap: disposition.gap,
    inputRetiredUnrepresented: disposition.inputRetiredUnrepresented,
    effectCount: disposition.effectCount,
    lastAppliedRequestId: disposition.lastAppliedRequestId,
  });
  if (applied.ok === false) return { ok: false, issues: applied.issues.map((issue) => `${issue.field}: ${issue.reason}`) };
  return { ok: true };
};

/** Publish the region header. Identity fields change only at startup; `serverTick` moves every tick. */
export const publishRegion = (region: RegionSchema, header: RegionReplicaState): PublishResult => {
  const projected = toRegionReplica(header);
  if (projected.ok === false) return { ok: false, issues: projected.issues.map((issue) => `${issue.field}: ${issue.reason}`) };
  region.worldId = projected.value.worldId;
  region.regionId = projected.value.regionId;
  region.serverTick = projected.value.serverTick;
  region.protocolVersion = projected.value.protocolVersion;
  region.configVersion = projected.value.configVersion;
  region.configHash = projected.value.configHash;
  region.manifestHash = projected.value.manifestHash;
  return { ok: true };
};

/** Drop an entity's row when its seat is released without reconnection. */
export const unpublishPlayer = (region: RegionSchema, entityId: EntityId): void => {
  region.players.delete(entityId);
};
