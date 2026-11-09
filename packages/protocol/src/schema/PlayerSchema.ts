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
] as const;
