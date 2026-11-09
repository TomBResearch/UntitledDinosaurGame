/**
 * Fixed-step direct-input validation (interfaces/protocol.md 4.2).
 *
 * The frame is flat and its field set is closed. A rejected sample never advances a generation and
 * never becomes a clamped movement; the neutral fallback is exported as a value so that the decision
 * to use it stays with the admission path (UDG-003) rather than being hidden in the validator.
 */

import type { DirectFrame, Validation } from '../domain/wire.js';
import type { DirectInput } from '../domain/movement.js';
import type { SessionEpoch } from '../domain/primitives.js';
import {
  EPOCH_MAX,
  EPOCH_MIN,
  GENERATION_MAX,
  GENERATION_MIN,
} from '../version.js';
import { asRecord, fail, matchesExactKeys, normaliseAxes, ok, readAxis, readBoolean, readUint } from './common.js';

/** The five declared wire fields. Anything else in the payload is a rejection. */
export const DIRECT_FRAME_FIELDS = ['sessionEpoch', 'generation', 'directIntent', 'moveX', 'moveZ'] as const;

/** The current server-issued epoch. Epoch equality is a pure check; the renewal lifecycle is not. */
export interface DirectFrameContext {
  readonly sessionEpoch: SessionEpoch;
}

/** A neutral, non-direct sample. UDG-003 decides whether to apply it; UDG-002 only provides it. */
export const NEUTRAL_DIRECT_INPUT: DirectInput = { moveX: 0, moveZ: 0 };

/** Build the neutral frame for a stamp. `directIntent: false` keeps a path-mode route alive. */
export const neutralDirectFrame = (context: DirectFrameContext & { readonly generation: number }): DirectFrame => ({
  sessionEpoch: context.sessionEpoch,
  generation: context.generation,
  directIntent: false,
  moveX: 0,
  moveZ: 0,
});

/**
 * Validate one direct frame.
 *
 * Order matters for the reported code: shape, then epoch range, then generation range, then axes,
 * and only then epoch equality. A frame that is structurally unusable cannot also be meaningfully
 * stale, so the structural failure is the honest answer.
 */
export const validateDirectFrame = (raw: unknown, context: DirectFrameContext): Validation<DirectFrame> => {
  const record = asRecord(raw);
  if (record === undefined) return fail('INVALID_PAYLOAD');
  if (!matchesExactKeys(record, DIRECT_FRAME_FIELDS)) return fail('INVALID_PAYLOAD');

  const directIntent = readBoolean(record, 'directIntent');
  if ('error' in directIntent) return fail(directIntent.error);

  const epoch = readUint(record, 'sessionEpoch', { min: EPOCH_MIN, max: EPOCH_MAX, code: 'INVALID_PAYLOAD' });
  if ('error' in epoch) return fail(epoch.error);

  const generation = readUint(record, 'generation', {
    min: GENERATION_MIN,
    max: GENERATION_MAX,
    code: 'INVALID_GENERATION',
  });
  if ('error' in generation) return fail(generation.error);

  // Only the neutral initial frame may carry generation zero: a real intention always increments.
  if (generation.value === GENERATION_MIN && directIntent.value !== false) return fail('INVALID_GENERATION');

  const moveX = readAxis(record, 'moveX');
  if ('error' in moveX) return fail(moveX.error);
  const moveZ = readAxis(record, 'moveZ');
  if ('error' in moveZ) return fail(moveZ.error);

  // A non-direct keepalive must not smuggle an intention: axes are zero or the frame is invalid.
  if (directIntent.value === false && (moveX.value !== 0 || moveZ.value !== 0)) return fail('INVALID_PAYLOAD');

  const axes = directIntent.value ? normaliseAxes(moveX.value, moveZ.value) : { moveX: 0, moveZ: 0 };

  if (epoch.value !== context.sessionEpoch) return fail('EPOCH_MISMATCH');

  return ok({
    sessionEpoch: epoch.value,
    generation: generation.value,
    directIntent: directIntent.value,
    moveX: axes.moveX,
    moveZ: axes.moveZ,
  });
};

/** Project a validated frame to the locomotion input pair. Non-direct frames read as no intent. */
export const directInputOf = (frame: DirectFrame): DirectInput =>
  frame.directIntent ? { moveX: frame.moveX, moveZ: frame.moveZ } : NEUTRAL_DIRECT_INPUT;
