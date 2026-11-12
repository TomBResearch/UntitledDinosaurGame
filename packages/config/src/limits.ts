/**
 * Limits: the protocol bounds that configuration must not exceed, and the guard rails that a
 * configuration file is allowed to express.
 *
 * Two different kinds of number live here and the distinction is the point.
 *
 * {@link PROTOCOL_LIMITS} re-exports the protocol's own bounds from `@udg/protocol`. It is a
 * re-export rather than a copy so that a configuration can never carry a wire bound that disagrees
 * with the codec, and it is part of the `configHash` input so a peer with a different protocol build
 * produces a different hash instead of a silent mismatch.
 *
 * {@link CONFIG_BOUNDS} are guard rails on this repository's own configuration values. They are not
 * protocol limits and they are not tuned gameplay parameters: a value outside them describes a build
 * that cannot satisfy the M0 fixed-step contract at all, so it is refused at startup rather than
 * measured at runtime. Each entry names why its range is what it is, because an unexplained bound
 * becomes an undeclared policy the moment someone widens one number.
 */

import {
  EPOCH_MAX,
  EPOCH_MIN,
  GENERATION_MAX,
  GENERATION_MIN,
  HASH_LENGTH,
  HASH_PATTERN,
  MAX_GENERATION_FORWARD_GAP,
  MAX_IDENTIFIER_LENGTH,
  MAX_REQUEST_ID_LENGTH,
  MAX_VERSION_LENGTH,
  MIN_REQUEST_ID_LENGTH,
  MOVEMENT_MODE_ENCODING,
  REQUEST_ID_PATTERN,
  ROUTE_ABSENT_INDEX,
  ROUTE_ABSENT_REVISION,
  TERMINAL_REQUEST_CACHE_SIZE,
  TERMINAL_REQUEST_TTL_SECONDS,
  UINT32_MAX,
  UINT32_MIN,
  YAW_RANGE,
} from '@udg/protocol';
import { deepFreeze } from './validation.js';

/** Protocol-owned bounds, single-sourced from `@udg/protocol`. */
export const PROTOCOL_LIMITS = deepFreeze({
  uint32Min: UINT32_MIN,
  uint32Max: UINT32_MAX,
  epochMin: EPOCH_MIN,
  epochMax: EPOCH_MAX,
  generationMin: GENERATION_MIN,
  generationMax: GENERATION_MAX,
  minRequestIdLength: MIN_REQUEST_ID_LENGTH,
  maxRequestIdLength: MAX_REQUEST_ID_LENGTH,
  maxIdentifierLength: MAX_IDENTIFIER_LENGTH,
  maxVersionLength: MAX_VERSION_LENGTH,
  hashLength: HASH_LENGTH,
  maxGenerationForwardGap: MAX_GENERATION_FORWARD_GAP,
  terminalRequestCacheSize: TERMINAL_REQUEST_CACHE_SIZE,
  terminalRequestTtlSeconds: TERMINAL_REQUEST_TTL_SECONDS,
  routeAbsentRevision: ROUTE_ABSENT_REVISION,
  routeAbsentIndex: ROUTE_ABSENT_INDEX,
  yawMin: YAW_RANGE.min,
  yawMax: YAW_RANGE.max,
  movementMode: MOVEMENT_MODE_ENCODING,
});

/** Patterns travel alongside the numeric bounds so a validator can use one source. */
export const PROTOCOL_PATTERNS = deepFreeze({
  requestId: REQUEST_ID_PATTERN,
  hash: HASH_PATTERN,
});

export interface NumericBound {
  readonly min: number;
  readonly max: number;
  readonly reason: string;
}

/** Guard rails for the configuration layer. See the module comment for what these are not. */
export const CONFIG_BOUNDS = deepFreeze({
  tickRate: {
    min: 1,
    max: 100,
    reason: 'an M0 tick must be a whole hertz value that a 20 Hz fixed step and a 100 ms patch interval can both be expressed in',
  } satisfies NumericBound,
  physicsSubsteps: {
    min: 1,
    max: 1,
    reason: 'v0.2 fixes one substep; UDG-SPIKE-002 may measure two-substep sensitivity but may not change the baseline',
  } satisfies NumericBound,
  reconnectWindowSeconds: {
    min: 0,
    max: 3600,
    reason: '0 disables retention and one hour is the longest session-lifetime window M0 will reason about',
  } satisfies NumericBound,
  generationGapLimit: {
    min: 0,
    max: MAX_GENERATION_FORWARD_GAP,
    reason: 'protocol.md 4.2 admits a forward gap of at most 64; a smaller window is stricter, a larger one is not the protocol',
  } satisfies NumericBound,
  // --- Input envelope (ADR-0003; Phase 2 W-3). Ranges that make an incoherent policy impossible;
  //     the relational checks that make it coherent live with the block in `input.ts`. ---
  inputRatePerTick: {
    min: 1,
    max: 1,
    reason: 'the one-input rule (P03 stage Q, re-adopted by ADR-0003 §2) is exactly one continuous frame per entity per authority tick; a wider range would make a non-conforming posture hashable',
  } satisfies NumericBound,
  bufferPressureMargin: {
    min: 1,
    max: 31,
    reason: 'the pressure margin must leave at least one frame of headroom below the buffer bound or the signal would fire at the overflow itself',
  } satisfies NumericBound,
  jitterAllowanceFrames: {
    min: 0,
    max: 30,
    reason: 'the jitter term participates in B + J·lambda + stall <= bufferMaxSize; the relational check refuses an envelope that cannot fit, this bound only refuses nonsense',
  } satisfies NumericBound,
  bufferMaxSize: {
    min: 1,
    max: 32,
    reason: 'the buffering clause is bounded at 32 frames per client; a deployment may declare a smaller buffer, never a larger one',
  } satisfies NumericBound,
  stallDetectionDeliveries: {
    min: 1,
    max: 20,
    reason: 'G consecutive non-advancing state deliveries; below 1 there is no window, above 20 the signal is decoration next to a 500 ms deadline',
  } satisfies NumericBound,
  rejoinWindowSeconds: {
    min: 1,
    max: 600,
    reason: 'the rolling window of the amended §3.2 allowance; one hour is ten times the accepted window and beyond that a "rolling" allowance has stopped meaning anything',
  } satisfies NumericBound,
  rejoinWindowAllowance: {
    min: 1,
    max: 5,
    reason: 'the amendment resolved the budget contradiction at two actual rejoins per window; the bound refuses a rejoin loop dressed as configuration',
  } satisfies NumericBound,
});

/** The block that configuration hashing covers for limits, so a protocol change moves the hash. */
export const limitsHashInput = (): unknown => ({
  kind: 'udg-limits',
  limits: PROTOCOL_LIMITS,
  bounds: CONFIG_BOUNDS,
});
