/**
 * Shared validation primitives (interfaces/protocol.md 4.2).
 *
 * Rules that every validator applies, stated once:
 *
 *  - non-finite and out-of-range values are rejected or neutralised, never clamped;
 *  - the accepted key set is closed, so an unknown field is a rejection rather than an ignored field;
 *  - signed zero is normalised to `+0`, because the wire cannot carry `-0` (probe-verified) and a
 *    signed zero would otherwise create a state difference and an unreproducible hash;
 *  - yaw is wrapped into the half-open interval `[-PI, PI)` at validation time, so the wire never
 *    carries an unnormalised angle and the exact-copy mapping assertions compare like with like.
 */

import type { RegionBounds } from '../domain/primitives.js';
import type { RejectionCode } from '../domain/commands.js';
import type { Validation } from '../domain/wire.js';
import {
  HASH_PATTERN,
  MAX_IDENTIFIER_LENGTH,
  MAX_VERSION_LENGTH,
  REQUEST_ID_PATTERN,
  UINT32_MAX,
} from '../version.js';

/**
 * Freeze a value and everything reachable from it.
 *
 * `Readonly<T>` in the declarations is erased at runtime, so without this the contract line "a source
 * fixture mutation must not mutate a validated readonly result" would only be a convention that the
 * next consumer could break silently. A validated payload is about to be handed to movement authority,
 * physics and navigation, none of which may rewrite what the boundary accepted.
 */
export const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
};

/** Every accepted value is frozen on the way out; a refusal carries no value at all. */
export const ok = <T>(value: T): Validation<T> => ({ ok: true, value: deepFreeze(value) });

export const fail = (code: RejectionCode): Validation<never> => ({ ok: false, code });

/** JSON round-trips lose `-0`; the wire does too, so normalise before anything is encoded. */
export const normaliseSignedZero = (value: number): number => (value === 0 ? 0 : value);

/**
 * Wrap an angle into `[-PI, PI)`: left-closed, right-open, so `+PI` maps to `-PI`.
 *
 * Idempotent by construction, which the fixture suite asserts, because a second application must not
 * move an already-normalised value.
 */
export const normaliseYaw = (radians: number): number => {
  const tau = Math.PI * 2;
  let wrapped = radians % tau;
  if (wrapped >= Math.PI) wrapped -= tau;
  else if (wrapped < -Math.PI) wrapped += tau;
  return wrapped === 0 ? 0 : wrapped;
};

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Integer within `[min, max]`. `Number.MAX_SAFE_INTEGER` is never used as a substitute for a width. */
export const isIntegerInRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/** Printable ASCII only, no whitespace: a unicode identifier is a rejection, not a normalisation. */
export const ASCII_IDENTIFIER = /^[\x21-\x7e]+$/;

/** Parse an object payload. Arrays and scalars are rejected: a frame is always a record. */
export const asRecord = (raw: unknown): Readonly<Record<string, unknown>> | undefined => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  return raw as Record<string, unknown>;
};

/**
 * Closed field set. Every required key must be present and no other key may appear, so an unknown
 * application field cannot be silently accepted and a missing field cannot become a default.
 */
export const matchesExactKeys = (
  record: Readonly<Record<string, unknown>>,
  required: readonly string[],
): boolean => {
  const keys = Object.keys(record);
  if (keys.length !== required.length) return false;
  return required.every((key) => Object.prototype.hasOwnProperty.call(record, key));
};

export const readFinite = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): { readonly value: number } | { readonly error: RejectionCode } => {
  const value = record[key];
  if (!isFiniteNumber(value)) return { error: 'INVALID_PAYLOAD' };
  return { value: normaliseSignedZero(value) };
};

/** Axis component: finite and inside `[-1, 1]`. Out-of-range is a rejection, never a clamp. */
export const readAxis = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): { readonly value: number } | { readonly error: RejectionCode } => {
  const read = readFinite(record, key);
  if ('error' in read) return read;
  if (read.value < -1 || read.value > 1) return { error: 'INVALID_PAYLOAD' };
  return { value: read.value };
};

export const readBoolean = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): { readonly value: boolean } | { readonly error: RejectionCode } => {
  const value = record[key];
  if (typeof value !== 'boolean') return { error: 'INVALID_PAYLOAD' };
  return { value };
};

/**
 * Unsigned integer within a declared width.
 *
 * `code` is a parameter because the same structural failure means different things on different
 * fields: an unusable generation is `INVALID_GENERATION`, an unusable epoch is `INVALID_PAYLOAD`.
 */
export const readUint = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  options: { readonly min?: number; readonly max?: number; readonly code: RejectionCode },
): { readonly value: number } | { readonly error: RejectionCode } => {
  const min = options.min ?? 0;
  const max = options.max ?? UINT32_MAX;
  const value = record[key];
  if (!isIntegerInRange(value, min, max)) return { error: options.code };
  return { value };
};

/** Bounded printable-ASCII identifier (world, region and entity ids). */
export const readIdentifier = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  maxLength: number = MAX_IDENTIFIER_LENGTH,
): { readonly value: string } | { readonly error: RejectionCode } => {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) return { error: 'INVALID_PAYLOAD' };
  if (value.length > maxLength) return { error: 'INVALID_PAYLOAD' };
  if (!ASCII_IDENTIFIER.test(value)) return { error: 'INVALID_PAYLOAD' };
  return { value };
};

/** `requestId` is 1 to 64 characters of `[A-Za-z0-9_-]`. */
export const readRequestId = (
  record: Readonly<Record<string, unknown>>,
  key: string = 'requestId',
): { readonly value: string } | { readonly error: RejectionCode } => {
  const value = record[key];
  if (typeof value !== 'string') return { error: 'INVALID_PAYLOAD' };
  if (!REQUEST_ID_PATTERN.test(value)) return { error: 'INVALID_PAYLOAD' };
  return { value };
};

export const readVersion = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): { readonly value: string } | { readonly error: RejectionCode } => {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) return { error: 'INVALID_PAYLOAD' };
  if (value.length > MAX_VERSION_LENGTH) return { error: 'INVALID_PAYLOAD' };
  if (!ASCII_IDENTIFIER.test(value)) return { error: 'INVALID_PAYLOAD' };
  return { value };
};

export const readHash = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): { readonly value: string } | { readonly error: RejectionCode } => {
  const value = record[key];
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) return { error: 'INVALID_PAYLOAD' };
  return { value };
};

/**
 * Normalise a horizontal axis pair, normalising only when its length exceeds one.
 *
 * A zero-length pair is returned as exact zeros, which keeps `+0` on both axes.
 */
export const normaliseAxes = (
  moveX: number,
  moveZ: number,
): { readonly moveX: number; readonly moveZ: number } => {
  const length = Math.hypot(moveX, moveZ);
  if (length <= 1 || length === 0) return { moveX: normaliseSignedZero(moveX), moveZ: normaliseSignedZero(moveZ) };
  return { moveX: moveX / length, moveZ: moveZ / length };
};

/** Inclusive containment test against explicitly supplied bounds. The bounds are assumed validated. */
export const isInsideBounds = (
  x: number,
  y: number,
  z: number,
  bounds: RegionBounds,
): boolean =>
  x >= bounds.x.min &&
  x <= bounds.x.max &&
  y >= bounds.y.min &&
  y <= bounds.y.max &&
  z >= bounds.z.min &&
  z <= bounds.z.max;
