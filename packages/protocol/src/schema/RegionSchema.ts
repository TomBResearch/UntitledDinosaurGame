/**
 * Region replica declaration (interfaces/protocol.md 4.4).
 *
 * `players` is keyed by `entityId`. The server-private transport-session-to-entity map is not
 * declared here and is never replicated.
 */

import { schema, t } from '@colyseus/schema';
import { PlayerSchema } from './PlayerSchema.js';

export const RegionSchema = schema(
  {
    worldId: t.string().default(''),
    regionId: t.string().default(''),
    serverTick: t.uint32().default(0),
    protocolVersion: t.string().default(''),
    configVersion: t.string().default(''),
    configHash: t.string().default(''),
    manifestHash: t.string().default(''),
    players: t.map(PlayerSchema),
  },
  'RegionSchema',
);

export type RegionSchema = InstanceType<typeof RegionSchema>;

export const REGION_FIELDS = [
  'worldId',
  'regionId',
  'serverTick',
  'protocolVersion',
  'configVersion',
  'configHash',
  'manifestHash',
  'players',
] as const;
