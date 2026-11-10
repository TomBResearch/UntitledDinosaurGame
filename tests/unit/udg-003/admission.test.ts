/**
 * Generation admission and the closed rejection vocabulary (PA1-3; P03-d, AC-5).
 *
 * The window is read from `MAX_GENERATION_FORWARD_GAP` rather than written as a number, because a
 * literal here would keep passing after the protocol constant moved — which is exactly the drift P03-h
 * records as a real conflict.
 */

import { describe, expect, it } from 'vitest';

import { GENERATION_MAX, MAX_GENERATION_FORWARD_GAP, UINT32_MAX } from '../../../packages/protocol/dist/index.js';
import { SPAWN, createHarness } from '../../support/authority/harness.js';
import {
  frame,
  frameWithExtraField,
  frameWithNonFiniteAxis,
  frameWithTypedGeneration,
  keepalive,
  moveTo,
  unknownMessage,
} from '../../support/authority/payloads.js';
import { advanceWatermark, stepOne } from '../../support/authority/scenarios.js';

const build = (runId: string) => {
  const built = createHarness({ runId });
  if ('failure' in built) throw new Error(`harness refused to build: ${built.failure}`);
  return built;
};

const joined = (runId: string, entityId = 'e1', epoch = 1) => {
  const harness = build(runId);
  harness.core.join(entityId, epoch, SPAWN);
  harness.step();
  return harness;
};

describe('generation window (P03-d)', () => {
  it('admits a gap of exactly MAX_GENERATION_FORWARD_GAP and refuses one more', () => {
    const admitted = joined('udg-003-gap-admissible');
    admitted.core.ingest('e1', frame(1, MAX_GENERATION_FORWARD_GAP, 1, 0));
    const outcome = stepOne(admitted, 'e1');
    expect(outcome.watermark).toBe(MAX_GENERATION_FORWARD_GAP);
    expect(outcome.refused).toHaveLength(0);

    const refused = joined('udg-003-gap-refused');
    refused.core.ingest('e1', frame(1, MAX_GENERATION_FORWARD_GAP + 1, 1, 0));
    const second = stepOne(refused, 'e1');
    expect(second.refused.map((entry) => entry.code)).toEqual(['RESYNC_REQUIRED']);
    expect(second.watermark).toBe(0);
    expect(second.drive).toBe('NONE');
    // The watermark never moves for an excessive-gap refusal.
    expect(second.consumed).not.toBeNull();
  });

  it('refuses a frame below the watermark as SUPERSEDED without moving it', () => {
    const harness = joined('udg-003-superseded');
    advanceWatermark(harness, 'e1', 1, 5);
    const before = harness.core.view('e1')?.watermark ?? -1;
    harness.core.ingest('e1', frame(1, 4, 1, 0));
    const outcome = stepOne(harness, 'e1');
    expect(outcome.refused.map((entry) => entry.code)).toEqual(['SUPERSEDED']);
    expect(outcome.watermark).toBe(before);
  });

  it('refuses an equal-generation intention once the latch is no longer direct', () => {
    const harness = joined('udg-003-equal-generation-direct');
    advanceWatermark(harness, 'e1', 1, 6);
    // A cancel commits generation 7 and clears the direct latch.
    harness.core.ingest('e1', { requestId: 'c1', sessionEpoch: 1, generation: 7 });
    stepOne(harness, 'e1');
    expect(harness.core.view('e1')?.latchedKind).toBe('cancel');
    expect(harness.core.view('e1')?.heldDirectGeneration).toBeNull();

    // A late direct frame at the now-held generation 7 cannot revive a direct intention.
    harness.core.ingest('e1', frame(1, 7, 1, 0));
    const outcome = stepOne(harness, 'e1');
    expect(outcome.refused.map((entry) => entry.code)).toEqual(['INVALID_GENERATION']);
    expect(outcome.watermark).toBe(7);
    expect(outcome.drive).toBe('NONE');
  });

  it('refuses a fresh request identity at generation == H whatever the latched kind (T-8)', () => {
    const directLatched = joined('udg-003-discrete-equality-direct');
    advanceWatermark(directLatched, 'e1', 1, 4);
    expect(directLatched.core.view('e1')?.latchedKind).toBe('direct');
    directLatched.core.ingest('e1', { requestId: 'fresh-1', sessionEpoch: 1, generation: 4 });
    const first = stepOne(directLatched, 'e1');
    expect(first.refused.map((entry) => entry.code)).toEqual(['INVALID_GENERATION']);
    expect(first.watermark).toBe(4);

    const cancelLatched = joined('udg-003-discrete-equality-cancel');
    advanceWatermark(cancelLatched, 'e1', 1, 4);
    cancelLatched.core.ingest('e1', { requestId: 'c1', sessionEpoch: 1, generation: 5 });
    stepOne(cancelLatched, 'e1');
    expect(cancelLatched.core.view('e1')?.latchedKind).toBe('cancel');
    cancelLatched.core.ingest('e1', { requestId: 'fresh-2', sessionEpoch: 1, generation: 5 });
    const second = stepOne(cancelLatched, 'e1');
    expect(second.refused.map((entry) => entry.code)).toEqual(['INVALID_GENERATION']);
    expect(second.watermark).toBe(5);
  });

  it('keeps the generation-zero rules: neutral is an observation, an intention at zero is refused', () => {
    const neutral = joined('udg-003-generation-zero');
    neutral.core.ingest('e1', keepalive(1, 0));
    const outcome = stepOne(neutral, 'e1');
    expect(outcome.watermark).toBe(0);
    expect(outcome.latchedKind).toBe('none');
    expect(outcome.inputSource).toBe('keepalive');

    neutral.core.ingest('e1', frame(1, 0, 1, 0));
    const second = stepOne(neutral, 'e1');
    expect(second.refused.map((entry) => entry.code)).toEqual(['INVALID_GENERATION']);
    expect(second.watermark).toBe(0);
  });

  it('refuses a wire generation above the domain instead of wrapping it', () => {
    const harness = joined('udg-003-generation-domain');
    harness.core.ingest('e1', frame(1, GENERATION_MAX + 1, 1, 0));
    const outcome = stepOne(harness, 'e1');
    expect(outcome.refused.map((entry) => entry.code)).toEqual(['INVALID_GENERATION']);
    expect(outcome.watermark).toBe(0);
    expect(GENERATION_MAX + 1).toBe(UINT32_MAX);
  });

  it('refuses GENERATION_MAX from a low watermark on the window, not on the domain', () => {
    // P03-d: GENERATION_MAX is a legal *value*. Nothing in the rules makes the top of the domain an
    // error, and this asserts that the refusal a low watermark produces for it is the ordinary gap
    // refusal rather than a special case.
    const harness = joined('udg-003-generation-max-value');
    harness.core.ingest('e1', frame(1, GENERATION_MAX, 1, 0));
    const outcome = stepOne(harness, 'e1');
    expect(outcome.refused.map((entry) => entry.code)).toEqual(['RESYNC_REQUIRED']);
    expect(outcome.watermark).toBe(0);
  });

  it('walks the window legitimately: 64 generations at a time, to the same bound the rules allow', () => {
    const harness = joined('udg-003-window-walk');
    let expected = 0;
    for (let step = 1; step <= 6; step += 1) {
      expected = step * MAX_GENERATION_FORWARD_GAP;
      harness.core.ingest('e1', frame(1, expected, 1, 0));
      const outcome = stepOne(harness, 'e1');
      expect(outcome.watermark).toBe(expected);
      expect(outcome.refused).toHaveLength(0);
    }
    // One beyond the window from the current watermark is refused, and the watermark holds.
    harness.core.ingest('e1', frame(1, expected + MAX_GENERATION_FORWARD_GAP + 1, 1, 0));
    expect(stepOne(harness, 'e1').watermark).toBe(expected);
  });

  it('never moves the watermark backwards, whatever arrives afterwards', () => {
    const harness = joined('udg-003-watermark-monotonic');
    advanceWatermark(harness, 'e1', 1, 30);
    const trajectory = harness
      .rows()
      .filter((row) => row.type === 'intention')
      .map((row) => (row.type === 'intention' ? row.watermarkAfter : -1));
    for (let index = 1; index < trajectory.length; index += 1) {
      expect((trajectory[index] ?? 0) >= (trajectory[index - 1] ?? 0)).toBe(true);
    }
    harness.core.ingest('e1', frame(1, 1, 1, 0));
    harness.core.ingest('e1', keepalive(1, 2));
    stepOne(harness, 'e1');
    expect(harness.core.view('e1')?.watermark).toBe(30);
  });
});

describe('structural refusals (protocol.md 4.2, AC-5)', () => {
  it('refuses an undeclared field with INVALID_PAYLOAD, and names the field for a bad axis or stamp', () => {
    const harness = joined('udg-003-structural');
    // An extra field means the payload declares none of the three accepted shapes, so the refusal is
    // made at ingest and nothing is queued; the two below are well-shaped and are refused by screening.
    const extra = harness.core.ingest('e1', frameWithExtraField(1, 1, 'extra'));
    expect(extra.decision.ok).toBe(false);
    if (extra.decision.ok === false) expect(extra.decision.code).toBe('INVALID_PAYLOAD');
    expect(harness.core.view('e1')?.continuousDepth).toBe(0);
    const first = stepOne(harness, 'e1');
    expect(first.refused).toHaveLength(0);

    harness.core.ingest('e1', frameWithNonFiniteAxis(1, 2));
    const second = stepOne(harness, 'e1');
    expect(second.refused.map((entry) => entry.code)).toEqual(['INVALID_PAYLOAD']);
    // The malformed value is rendered, not dropped (P03-g).
    const rows = harness.rows().filter((row) => row.type === 'observation' && row.malformed.length > 0);
    expect(rows.length).toBeGreaterThan(0);

    // A generation that is not an integer reports INVALID_GENERATION, not INVALID_PAYLOAD: protocol.md
    // 4.2 names the field that failed, and the order is the validator's, not this suite's.
    harness.core.ingest('e1', frameWithTypedGeneration(1, '7'));
    const third = stepOne(harness, 'e1');
    expect(third.refused.map((entry) => entry.code)).toEqual(['INVALID_GENERATION']);
    expect(harness.core.view('e1')?.watermark).toBe(0);
  });

  it('refuses an unknown message name at ingest, without growing any queue', () => {
    const harness = joined('udg-003-unknown-message');
    const outcome = harness.core.ingest('e1', unknownMessage());
    expect(outcome.decision.ok).toBe(false);
    if (outcome.decision.ok === false) {
      expect(outcome.decision.code).toBe('INVALID_PAYLOAD');
      expect(outcome.decision.disposition).toBe('refused:structural');
    }
    const view = harness.core.view('e1');
    expect(view?.continuousDepth).toBe(0);
    expect(view?.discreteDepth).toBe(0);
    expect(harness.core.stats().counters['refused:structural']).toBe(1);
  });

  it('accepts no old-epoch frame at all (AC-5)', () => {
    const harness = joined('udg-003-old-epoch', 'e1', 7);
    harness.core.ingest('e1', frame(7, 3, 1, 0));
    harness.core.ingest('e1', frame(6, 4, 1, 0));
    harness.core.ingest('e1', moveTo('r-old', 6, 5, { x: 1, y: 1, z: 1 }));
    const outcome = harness.step();
    // The refusals happened in stage L, not as screening refusals, so no screening refusal is reported.
    expect(outcome.entities[0]?.refused ?? []).toHaveLength(0);
    const epochRefusals = harness
      .rows()
      .filter((row) => row.type === 'observation' && row.disposition === 'refused:epoch');
    // The two epoch-6 arrivals; the epoch-7 frame belongs to the issued epoch and is not refused.
    expect(epochRefusals).toHaveLength(2);
    const accepted = harness
      .rows()
      .filter((row) => row.type === 'observation' && row.disposition === 'consumed' && row.epoch !== 7);
    expect(accepted).toHaveLength(0);
    // Only the current epoch's frame was admitted, and it moved the watermark exactly as far as its
    // own generation says it should.
    expect(harness.core.view('e1')?.watermark).toBe(3);
  });
});
