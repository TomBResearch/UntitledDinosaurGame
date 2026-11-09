/**
 * Join metadata validation (interfaces/protocol.md 4.2 and 4.3).
 *
 * The three join values are compared against the server's own identity: protocol version,
 * configuration hash and asset manifest hash. World and region are selected by server room
 * configuration, so they are not accepted from a client at all.
 *
 * The version rule is exact match. Probe evidence in docs/contracts/protocol-v1.md shows that a
 * schema definition mismatch is reported only as a console warning and then decodes garbage, so the
 * protocol layer cannot delegate drift detection to the codec and must refuse on identity instead.
 */

import type { JoinWire, Validation } from '../domain/wire.js';
import { asRecord, fail, matchesExactKeys, ok, readHash, readVersion } from './common.js';
import { isProtocolVersionSupported } from '../version.js';

export const JOIN_FIELDS = ['protocolVersion', 'configHash', 'manifestHash'] as const;

/** The server's own identity, supplied by the room configuration (UDG-003 wires it). */
export interface JoinContext {
  readonly protocolVersion: string;
  readonly configHash: string;
  readonly manifestHash: string;
}

/** Order is deliberate: an incompatible protocol is checked before hashes, because the hashes are only comparable inside one protocol. */
export const validateJoin = (raw: unknown, context: JoinContext): Validation<JoinWire> => {
  const record = asRecord(raw);
  if (record === undefined) return fail('INVALID_PAYLOAD');
  if (!matchesExactKeys(record, JOIN_FIELDS)) return fail('INVALID_PAYLOAD');

  const protocolVersion = readVersion(record, 'protocolVersion');
  if ('error' in protocolVersion) return fail(protocolVersion.error);
  if (!isProtocolVersionSupported(protocolVersion.value)) return fail('PROTOCOL_MISMATCH');

  const configHash = readHash(record, 'configHash');
  if ('error' in configHash) return fail(configHash.error);

  const manifestHash = readHash(record, 'manifestHash');
  if ('error' in manifestHash) return fail(manifestHash.error);

  if (protocolVersion.value !== context.protocolVersion) return fail('PROTOCOL_MISMATCH');
  if (configHash.value !== context.configHash) return fail('CONFIG_MISMATCH');
  if (manifestHash.value !== context.manifestHash) return fail('ASSET_MISMATCH');

  return ok({ protocolVersion: protocolVersion.value, configHash: configHash.value, manifestHash: manifestHash.value });
};
