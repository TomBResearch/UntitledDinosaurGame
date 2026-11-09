/**
 * `@udg/protocol/mapping` entry point.
 *
 * Projection between canonical state and the replica classes, in both directions. It reaches the
 * schema runtime through `./schema`, so consumers that must stay engine-free (simulation,
 * configuration) import `@udg/protocol/domain` instead.
 *
 * The barrel is a declared addition because an export subpath resolves to one module.
 */

export {
  checkPlayerState,
  checkRegionState,
  movementModeCode,
  playerMapKey,
  toRegionReplica,
  toReplica,
  type MappingIssue,
  type MappingResult,
} from './to-replica.js';
export {
  fromRegionReplica,
  fromReplica,
  readPlayerMap,
  readPlayerReplica,
  readRegionIssues,
  readRegionReplica,
  readReplicaIssues,
  type PlayerMapEntry,
  type ReplicaReadIssue,
} from './from-replica.js';
