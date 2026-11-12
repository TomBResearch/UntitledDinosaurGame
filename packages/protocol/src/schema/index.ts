/**
 * `@udg/protocol/schema` entry point — the only module tree that imports a schema runtime.
 *
 * Domain, validation and version modules must not import anything from here (enforced by
 * BOUNDARY-DOMAIN-NO-SCHEMA), and only @udg/protocol, @udg/server, @udg/client and @udg/load-test may
 * import this entry point at all (BOUNDARY-SCHEMA-INTO-DOMAIN). The barrel is a declared addition
 * because an export subpath resolves to one module.
 */

import { Decoder, Encoder, MapSchema, schema, t } from '@colyseus/schema';

/**
 * The pinned codec surface, re-exported so that nothing outside this module tree reaches into a
 * third-party package by name.
 *
 * docs/integration/colyseus.md 6.1 requires every concrete call to be compiled against the installed
 * declarations and kept out of ad-hoc call sites. `encodeAll()` plus `new Decoder(target)` is the
 * room-free full-state round trip that UDG-002's fixtures and later tasks depend on, and the field-map
 * and schema-round-trip suites are the probes that prove those two names exist as declared. Naming them
 * here means a rename or a version bump breaks one module instead of scattering through tests.
 */
export { Decoder, Encoder, MapSchema, schema, t };

/**
 * The projection layer is re-exported here from Phase 2 (UDG-003 W-2) so that a consumer holding the
 * replica classes can populate them without naming a second subpath. `@udg/protocol/mapping` remains
 * the canonical name for the projection; the two barrels resolve to the same modules, so there is one
 * implementation and two spellings of it. Consumers that must stay engine-free (simulation, config)
 * still name `@udg/protocol/domain` and can reach neither barrel.
 */
export * from '../mapping/index.js';

export { DirectInputSchema, DIRECT_INPUT_FIELDS } from './DirectInputSchema.js';
export { PlayerSchema, PLAYER_FIELDS } from './PlayerSchema.js';
export { RegionSchema, REGION_FIELDS } from './RegionSchema.js';
