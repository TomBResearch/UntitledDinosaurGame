/**
 * Protocol identity, numeric widths and version compatibility.
 *
 * Two things live here because both follow from the protocol identity rather than from tunable
 * configuration:
 *
 *  - the numeric domain adopted with P02 (uint32 epoch, generation range, identifier and hash
 *    lengths, the admitted forward-gap constant whose *policy* belongs to UDG-003), and
 *  - the encoding table that protocol.md 4.4 requires to be documented: enum encodings, the
 *    null-to-zero route sentinel and the widths that mapping must refuse before a value reaches the
 *    schema codec.
 *
 * @udg/config imports these constants so that configuration hashing covers the wire limits too; the
 * dependency never runs the other way.
 */

/**
 * Protocol identity. The string travels in the join metadata and is bounded by
 * {@link MAX_VERSION_LENGTH}.
 */
export const PROTOCOL_VERSION = 'udg-m0-1.0.0' as const;

/**
 * Compatibility rule. No forward or backward compatibility rule has been agreed, so acceptance is
 * exact-match only: an unrecognised version is refused with `PROTOCOL_MISMATCH` instead of being
 * optimistically parsed. Adding an optional wire field requires an agreed compatibility rule first,
 * because the closed-field validators reject unknown keys by construction.
 */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [PROTOCOL_VERSION];

/** Exact-match check; see {@link SUPPORTED_PROTOCOL_VERSIONS} for why there is no range logic. */
export const isProtocolVersionSupported = (requested: string): boolean =>
  SUPPORTED_PROTOCOL_VERSIONS.includes(requested);

// --- Numeric widths (protocol.md 4.2 and 4.4) ---------------------------------------------------

export const UINT32_MIN = 0;
export const UINT32_MAX = 4_294_967_295;
/** Epoch `0` is reserved for "no epoch"; a real epoch is server-issued from 1. */
export const EPOCH_MIN = 1;
export const EPOCH_MAX = UINT32_MAX;
/** Generation tops out one below uint32 max so the overflow boundary stays detectable. */
export const GENERATION_MIN = 0;
export const GENERATION_MAX = 4_294_967_294;

/** `requestId`: 1 to 64 characters matching `[A-Za-z0-9_-]+` (protocol.md 4.2). */
export const MIN_REQUEST_ID_LENGTH = 1;
export const MAX_REQUEST_ID_LENGTH = 64;
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Identifiers: 64 ASCII characters (protocol.md 4.4). */
export const MAX_IDENTIFIER_LENGTH = 64;
/** Versions: bounded strings of at most 32 characters. */
export const MAX_VERSION_LENGTH = 32;
/** SHA-256 in lowercase hexadecimal. */
export const HASH_LENGTH = 64;
export const HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Admitted forward gap in generations, adopted with P02 as a protocol constant.
 *
 * The constant is protocol-level; the **admission policy** around it (watermarks, the
 * `RESYNC_REQUIRED` behaviour, not raising a watermark on refusal) belongs to UDG-003 under P03 and
 * is not implemented here. UDG-002 must confirm that P03 keeps this value unchanged.
 */
export const MAX_GENERATION_FORWARD_GAP = 64;

/**
 * Terminal request cache: 128 records per entity and epoch for 30 seconds (protocol.md 4.3). The
 * cache itself is UDG-003 authority behaviour; the bound is declared here so configuration and
 * documentation cannot drift apart.
 */
export const TERMINAL_REQUEST_CACHE_SIZE = 128;
export const TERMINAL_REQUEST_TTL_SECONDS = 30;

// --- Encoding table (protocol.md 4.4) -----------------------------------------------------------

/** `movementMode` uint8 encoding. An unlisted value is a rejection, never a fallback. */
export const MOVEMENT_MODE_ENCODING = { idle: 0, direct: 1, path: 2 } as const;
export const MOVEMENT_MODE_BY_VALUE: Readonly<Record<number, 'idle' | 'direct' | 'path'>> = {
  0: 'idle',
  1: 'direct',
  2: 'path',
};

/**
 * Null-to-zero route sentinel. `routeRevision === 0` means no route and requires
 * `nextWaypointIndex === 0`; a positive revision with index `0` is an active route at its first
 * waypoint (owner decision D1). `null` never crosses the wire.
 */
export const ROUTE_ABSENT_REVISION = 0;
export const ROUTE_ABSENT_INDEX = 0;

/**
 * Per-frame send-sequence domain (ADR-0003 §4, adopted by D-7; Phase 2 item W-2).
 *
 * Every continuous frame carries a client send sequence — the value `sentCount + 1` read before the
 * send, stamped into the field declared as the room's input `seqField`, strictly increasing within
 * one connection domain. A stamp of `0` is the schema's *unstamped* default, and an unstamped frame
 * carries no identity the authoritative record could resolve, so the legal stamp domain starts at 1.
 * The monotonicity rule itself is per-connection state and belongs to the room, not to a stateless
 * validator.
 */
export const INPUT_SEQ_MIN = 1;
export const INPUT_SEQ_MAX = UINT32_MAX;

/**
 * Reserved application close codes (UDG-003 Phase 2 W-2, policy in ADR-0003 §3.3).
 *
 * The WebSocket application range is 4000–4999. These three values are *reserved by UDG*: no other
 * task may terminate a seat under them, and a new close code needs a record here first. They are
 * declared in `packages/config` as part of the hashed configuration so a deployment cannot close
 * under a code the protocol has not reserved.
 *
 * - `INPUT_RETIRED_UNREPRESENTED` (4100): a confirmed unrepresented retirement (§3.1) closed the
 *   seat through the bounded window of §3.3.
 * - `INPUT_RATE_CEILING` (4101): the arrival rate exceeded the declared ceiling; direct closure.
 * - `INPUT_RECOVERY` (4102): the recovery path of §3.2 ended the episode — the client surfaces the
 *   connection error and stays stopped.
 */
export const CLOSE_CODE_INPUT_RETIRED_UNREPRESENTED = 4100;
export const CLOSE_CODE_INPUT_RATE_CEILING = 4101;
export const CLOSE_CODE_INPUT_RECOVERY = 4102;

/** The reserved set as one record, so validators and configuration read one source. */
export const RESERVED_CLOSE_CODES = {
  INPUT_RETIRED_UNREPRESENTED: CLOSE_CODE_INPUT_RETIRED_UNREPRESENTED,
  INPUT_RATE_CEILING: CLOSE_CODE_INPUT_RATE_CEILING,
  INPUT_RECOVERY: CLOSE_CODE_INPUT_RECOVERY,
} as const;

/** Wire widths per replica field. Provisional until Gate A per ADR 0001. */
export const REPLICA_WIDTHS = {
  entityId: 'string<=64',
  x: 'float64',
  y: 'float64',
  z: 'float64',
  yaw: 'float64',
  vx: 'float64',
  vy: 'float64',
  vz: 'float64',
  grounded: 'boolean',
  verticalVelocity: 'float64',
  movementMode: 'uint8',
  routeRevision: 'uint32',
  nextWaypointIndex: 'uint32',
  intentGeneration: 'uint32',
  sessionEpoch: 'uint32',
  connected: 'boolean',
  lastAuthorityTick: 'uint32',
  // The per-entity input disposition record and effect ledger (ADR-0003 §4; W-2). The zero sentinel
  // means "nothing resolved / no gap named / no retirement / no effect yet"; a stamp of 0 is not a
  // legal sequence, so 0 is unambiguous for every numeric field here.
  inputResolvedThrough: 'uint32',
  inputGapStart: 'uint32',
  inputGapEnd: 'uint32',
  inputRetiredUnrepresented: 'uint32',
  effectCount: 'uint32',
  lastAppliedRequestId: 'string<=64',
} as const;

/**
 * ADR 0001 records the precision policy as adopted and the encoding widths as Gate A candidates, so
 * the provisional marker travels with the declarations instead of living only in prose.
 */
export const ENCODING_PROVISIONAL = {
  provisional: true,
  frozenAt: 'Gate A (UDG-SPIKE-001)',
  policy: 'float64 canonical with a lossless mapping; widths unfreeze with the Gate A schema freeze',
  adr: 'docs/adr/0001-replica-precision-policy.md',
} as const;

/** Yaw is normalised to this half-open interval before encoding (protocol.md 4.4). */
export const YAW_RANGE: Readonly<{ min: number; max: number }> = {
  min: -Math.PI,
  max: Math.PI,
};
