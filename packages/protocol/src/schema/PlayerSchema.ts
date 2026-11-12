/**
 * Player replica declaration (interfaces/protocol.md 4.4).
 *
 * The field set is the prediction-relevant scalar set and nothing else: no route points, no
 * transport-session map, no client-owned authoritative transform setter. Mapping is the only writer,
 * and only on the server; a client never has a supported write path.
 *
 * Field order is significant — the codec assigns indices by declaration order, and the field-map
 * test pins both the names and the widths against docs/contracts/protocol-v1.md.
 */

import { schema, t } from '@colyseus/schema';

export const PlayerSchema = schema(
  {
    entityId: t.string().default(''),
    x: t.float64().default(0),
    y: t.float64().default(0),
    z: t.float64().default(0),
    yaw: t.float64().default(0),
    vx: t.float64().default(0),
    vy: t.float64().default(0),
    vz: t.float64().default(0),
    grounded: t.boolean().default(false),
    verticalVelocity: t.float64().default(0),
    movementMode: t.uint8().default(0),
    routeRevision: t.uint32().default(0),
    nextWaypointIndex: t.uint32().default(0),
    intentGeneration: t.uint32().default(0),
    sessionEpoch: t.uint32().default(0),
    connected: t.boolean().default(false),
    lastAuthorityTick: t.uint32().default(0),
    // --- Per-entity input disposition record (ADR-0003 §4; UDG-003 Phase 2 W-2). ---
    /**
     * Highest client send sequence for which **every** sequence at or below it has an explicit
     * disposition, within the epoch this replica carries. `0` means "nothing resolved yet".
     * Pruning uses this field, never the SDK acknowledgement's `lastProcessed`.
     */
    inputResolvedThrough: t.uint32().default(0),
    /**
     * The named gap the server observed, as an inclusive range; `0 / 0` means "no gap named".
     * A stamp of `0` is not a legal sequence, so the sentinel cannot collide with a real range.
     */
    inputGapStart: t.uint32().default(0),
    inputGapEnd: t.uint32().default(0),
    /** §3.1 retirement count for this entity and domain: increase in consumed minus real dequeues. */
    inputRetiredUnrepresented: t.uint32().default(0),
    // --- Effect ledger (GA-10): committed effects for this entity and epoch. ---
    effectCount: t.uint32().default(0),
    /** The request identity whose commitment last incremented the ledger; `''` means none yet. */
    lastAppliedRequestId: t.string().default(''),
  },
  'PlayerSchema',
);

export type PlayerSchema = InstanceType<typeof PlayerSchema>;

/** Declaration order, used by the completeness and index tests. */
export const PLAYER_FIELDS = [
  'entityId',
  'x',
  'y',
  'z',
  'yaw',
  'vx',
  'vy',
  'vz',
  'grounded',
  'verticalVelocity',
  'movementMode',
  'routeRevision',
  'nextWaypointIndex',
  'intentGeneration',
  'sessionEpoch',
  'connected',
  'lastAuthorityTick',
  'inputResolvedThrough',
  'inputGapStart',
  'inputGapEnd',
  'inputRetiredUnrepresented',
  'effectCount',
  'lastAppliedRequestId',
] as const;
