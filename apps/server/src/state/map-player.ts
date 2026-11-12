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
  RegionSchema,
  toRegionReplica,
  toReplica,
} from '@udg/protocol/schema';
import type { EntityId, PlayerSimulationState, RegionReplicaState } from '@udg/protocol';

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
  const key = entityId;
  let row = region.players.get(key);
  if (row === undefined) {
    row = new PlayerSchema();
    region.players.set(key, row);
  }
  for (const field of PLAYER_FIELDS) {
    const source = projected.value as unknown as Record<string, unknown>;
    const target = row as unknown as Record<string, unknown>;
    // `fields` is the protocol's own closed list; copying it by name cannot invent or drop a field.
    target[field] = source[field];
  }
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
