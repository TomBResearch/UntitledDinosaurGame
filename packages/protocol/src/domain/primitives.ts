/**
 * Canonical primitive declarations (interfaces/domain.md A1).
 *
 * Types and value-only helpers. No schema runtime, no Node builtin, no browser global: this
 * directory is the engine-free surface of @udg/protocol and is enforced by the
 * BOUNDARY-DOMAIN-NO-SCHEMA rule in tools/checks/src/boundaries.ts.
 *
 * Identifier lengths, epoch and generation ranges come from the adopted P02 ruling in
 * docs/interfaces/protocol.md 4.2 and 4.4; the numeric bounds themselves live in
 * ../version.ts so that configuration can reference the same constants (@udg/config may import
 * @udg/protocol but never the other way round).
 */

/** Bounded identifier types are plain strings at the wire level; the bounds are validators. */
export type WorldId = string;
export type RegionId = string;
export type EntityId = string;
export type ProtocolVersion = string;
export type ConfigVersion = string;
/** SHA-256 lowercase hex, 64 characters (protocol.md 4.4). */
export type Sha256Hex = string;

/** Server-issued application input epoch. Not the SDK input epoch (protocol.md 4.2). */
export type SessionEpoch = number;
/** Server-authoritative tick. Not a client clock reading. */
export type ServerTick = number;
/** Per-session ordering hint owned by the application, not an authority claim (baseline §4). */
export type Generation = number;

/** Domain movement mode. The wire carries the uint8 encoding declared in ../version.ts. */
export type MovementMode = 'idle' | 'direct' | 'path';

/**
 * Horizontal movement-input pair. `y` denotes the horizontal Z axis and never the vertical axis
 * (interfaces/domain.md A1: do not silently exchange the conventions).
 */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** World position and displacement. Right-handed, metres, `y` is vertical (fixtures.md 7.1). */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** One axis of an inclusive region volume. `min` must be strictly less than `max`. */
export interface AxisRange {
  readonly min: number;
  readonly max: number;
}

/**
 * Inclusive region volume in world metres.
 *
 * The type lives here because the wire validator needs it and `@udg/protocol` may not depend on
 * `@udg/config`; the *validator* for it is `validateRegionBounds` in
 * packages/config/src/region.ts, and the values themselves are supplied explicitly by the server.
 * UDG-002 ships no production extents (owner decision D5), and UDG-007's `region.json` becomes the
 * eventual source through UDG-003 work.
 */
export interface RegionBounds {
  readonly x: AxisRange;
  readonly y: AxisRange;
  readonly z: AxisRange;
}

/**
 * Closed rejection vocabulary (protocol.md 4.3). v0.2's optional free-text reason is constrained to
 * these codes.
 *
 * Provenance of each code matters for review: a code that UDG-002 cannot produce on its own is still
 * declared, because the union is closed and later tasks must not widen it casually.
 *
 * It is declared in this module rather than in `commands.ts` because both command results and the wire
 * envelopes reject with it, and the first-party module graph must stay acyclic — the boundary checker
 * reports a type-only cycle as a violation, which is the correct reading of "no cycles".
 */
export const REJECTION_CODES = [
  /** Structural wire failure: shape, finite range, unknown field, bad identifier. */
  'INVALID_PAYLOAD',
  /** Destination is not a usable navigation target. Decided by UDG-007 navigation. */
  'INVALID_DESTINATION',
  /** Destination lies outside the explicitly supplied region bounds. Produced by UDG-002. */
  'OUT_OF_BOUNDS',
  /** Route exists but cannot be reached. Decided by UDG-007 navigation. */
  'UNREACHABLE',
  /** Admission refused for volume. Decided by UDG-003 admission policy. */
  'RATE_LIMITED',
  /** A newer generation superseded this request. Decided by UDG-003 ordering. */
  'SUPERSEDED',
  /** Worker busy. Decided by UDG-007 navigation. */
  'NAVIGATION_BUSY',
  /** Epoch does not match the current server-issued epoch. Produced by UDG-002 validation. */
  'EPOCH_MISMATCH',
  /** Generation is not an integer inside the declared range. Produced by UDG-002 validation. */
  'INVALID_GENERATION',
  /** Forward gap exceeds the admitted window. Decided by UDG-003 admission policy. */
  'RESYNC_REQUIRED',
  /** Reused identifier with a different payload. Decided by the UDG-003 request cache. */
  'REQUEST_ID_CONFLICT',
  /** Join protocol version is not the supported version. Produced by UDG-002 validation. */
  'PROTOCOL_MISMATCH',
  /** Join configuration hash does not match the server's. Produced by UDG-002 validation. */
  'CONFIG_MISMATCH',
  /** Join asset manifest hash does not match the server's. Produced by UDG-002 validation. */
  'ASSET_MISMATCH',
] as const;

/**
 * The union is derived from {@link REJECTION_CODES} rather than written twice.
 *
 * The fixture checker has to know the vocabulary to reject a fixture that expects a code which cannot
 * exist, and a second hand-written list would be free to drift from the type that the validators return.
 */
export type RejectionCode = (typeof REJECTION_CODES)[number];
