/**
 * Fixed-step direct-input validation (interfaces/protocol.md 4.2).
 *
 * The frame is flat and its field set is closed. A rejected sample never advances a generation and
 * never becomes a clamped movement; the neutral fallback is exported as a value so that the decision
 * to use it stays with the admission path (UDG-003) rather than being hidden in the validator.
 */

import type { DirectFrame, DirectWireFrame, Validation } from '../domain/wire.js';
import type { DirectInput } from '../domain/movement.js';
import type { SessionEpoch } from '../domain/primitives.js';
import {
  EPOCH_MAX,
  EPOCH_MIN,
  GENERATION_MAX,
  GENERATION_MIN,
  INPUT_SEQ_MAX,
  INPUT_SEQ_MIN,
} from '../version.js';
import { asRecord, fail, matchesExactKeys, normaliseAxes, ok, readAxis, readBoolean, readUint } from './common.js';

/** The five declared authority fields. Anything else in the payload is a rejection. */
export const DIRECT_FRAME_FIELDS = ['sessionEpoch', 'generation', 'directIntent', 'moveX', 'moveZ'] as const;

/**
 * The wire frame's declared field set: the authority five plus the per-frame send sequence
 * (ADR-0003 §4; W-2). The wire set and the authority set are pinned apart on purpose: the accepted
 * core screens the authority five, and the transport owns the stamp.
 */
export const DIRECT_WIRE_FRAME_FIELDS = ['sessionEpoch', 'generation', 'directIntent', 'moveX', 'moveZ', 'seq'] as const;

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

/**
 * Validate one **wire** frame: the closed six-field set, stamp included.
 * `validateDirectWireFrame` — the transport's structural gate (ADR-0003 §4; Phase 2 W-2).
 *
 * The room runs this on the frame as decoded from the wire, before anything reserves a send order or
 * consumes it. The stamp must be an integer in `[INPUT_SEQ_MIN, INPUT_SEQ_MAX]`: `0` is the schema's
 * unstamped default and an unstamped frame has no identity the authoritative record could resolve,
 * so it is refused rather than adopted as "sequence zero". Strictly-increasing order is a property
 * of a connection domain, not of one frame, and belongs to the room's disposition record — a
 * stateless validator cannot and must not pretend to check it.
 *
 * `validateDirectFrame` is deliberately untouched: it remains the authority-shape screen the
 * accepted Phase 1 core re-runs inside its own admission, and the two field sets are separate
 * closed unions.
 */
export const validateDirectWireFrame = (
  raw: unknown,
  context: DirectFrameContext,
): Validation<DirectWireFrame> => {
  const record = asRecord(raw);
  if (record === undefined) return fail('INVALID_PAYLOAD');
  if (!matchesExactKeys(record, DIRECT_WIRE_FRAME_FIELDS)) return fail('INVALID_PAYLOAD');

  const stamp = readUint(record, 'seq', { min: INPUT_SEQ_MIN, max: INPUT_SEQ_MAX, code: 'INVALID_PAYLOAD' });
  if ('error' in stamp) return fail(stamp.error);

  // The authority five are validated by the one validator that owns them, over the projection the
  // authority will actually receive — the wire frame is only valid if its own payload is.
  const frame = validateDirectFrame(
    {
      sessionEpoch: record['sessionEpoch'],
      generation: record['generation'],
      directIntent: record['directIntent'],
      moveX: record['moveX'],
      moveZ: record['moveZ'],
    },
    context,
  );
  if (!frame.ok) return fail(frame.code);

  return ok({ ...frame.value, seq: stamp.value });
};

/**
 * Project a wire frame to the authority shape: the five fields the core screens, journals and
 * steps, without the send stamp. The stamp is reconciliation metadata — it never travels into a
 * movement decision, and the authority's own payload stays the five fields it was built for.
 */
export const coreFrameOfWireFrame = (frame: DirectWireFrame): DirectFrame => ({
  sessionEpoch: frame.sessionEpoch,
  generation: frame.generation,
  directIntent: frame.directIntent,
  moveX: frame.moveX,
  moveZ: frame.moveZ,
});
