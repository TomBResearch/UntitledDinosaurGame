/**
 * UDG-SPIKE-001 slice 7 — the GA-5b transcript validator on FORGED transcripts (red controls).
 *
 * Every case here is a MISMATCH the validator must CATCH: a published prefix no dequeue chain
 * rebuilds, a delivery from a foreign epoch, a consumed stamp no send staged (shared-input
 * aliasing), a declined stamp that nonetheless appears consumed, an early pending prune, a
 * duplicate consumption, and the naive last-row selection diverging from the epoch-keyed join.
 * The healthy transcript must pass clean. These are the controls the reviewed evidence lacked:
 * agreement is only meaningful when the detector demonstrably fires on disagreement.
 */

import { describe, expect, it } from 'vitest';

import {
  auditGa5Transcript,
  naiveVsJoined,
  rebuildPrefix,
  type Ga5Transcript,
  type TranscriptDequeue,
  type TranscriptDelivery,
} from '../../../tools/load-test/src/ga5-transcript.ts';

const send = (ordinal: number, role: 'twin' | 'eaten' | 'pump', stagedSeq: number) => ({
  ordinal,
  role,
  stagedSeq,
  slotBefore: ordinal - 1,
  slotAfter: ordinal,
  ackReturn: ordinal - 1,
  epoch: 7,
  sessionId: 'S1',
  atMs: 1_000 + ordinal * 10,
  wireChunksWindow: 1,
  moveX: 1,
  moveZ: 0,
});

const dq = (tick: number, seq: number): TranscriptDequeue => ({ tick, seq, atMs: tick * 50 });

const delivery = (over: Partial<TranscriptDelivery>): TranscriptDelivery => ({
  epoch: 7,
  authorityTick: 10,
  revision: 1,
  atMs: 1_500,
  ack: 0,
  resolvedThrough: 0,
  gapStart: 0,
  gapEnd: 0,
  retiredUnrepresented: 0,
  accepted: true,
  reason: '',
  ...over,
});

const healthy = (): Ga5Transcript => ({
  roomId: 'R',
  sessionId: 'S1',
  epoch: 7,
  // the genuine terminal form: stamp 1 accepted once (original), then a REPLAY re-stamping 1 is
  // declined pre-buffer; the consumed count of 1 must stay exactly 1.
  sends: [send(1, 'pump', 1), send(2, 'eaten', 1)],
  dequeues: [dq(10, 1)],
  refusals: 0,
  signals: [],
  closures: [],
  deliveries: [delivery({ ack: 1, resolvedThrough: 1, authorityTick: 10 })],
  pendingSamples: [
    { atMs: 1_400, seqs: [] },
    { atMs: 1_500, seqs: [] },
  ],
  declinedFrames: [{ seq: 1, originalsBefore: 1 }],
});

describe('UDG-SPIKE-001 GA-5b transcript validator (red invalid/mismatch controls)', () => {
  it('mirrors the ROOM rule: the prefix advances only over seq === prefix + 1 dispositions', () => {
    expect(rebuildPrefix([dq(1, 1), dq(2, 2), dq(3, 3)])).toBe(3);
    // A dequeue of 4 over a hole at 3 does NOT advance the prefix — consumed ≠ resolved.
    expect(rebuildPrefix([dq(1, 1), dq(2, 2), dq(3, 4)])).toBe(2);
    // A twin-first domain dequeues stamp 2 and the prefix STAYS at 0 (nothing disposed at 1).
    expect(rebuildPrefix([dq(10, 2)])).toBe(0);
    expect(rebuildPrefix([])).toBe(0);
  });

  it('a healthy twin-first transcript audits CLEAN (prefix 0 published honestly)', () => {
    expect(auditGa5Transcript(healthy())).toEqual([]);
  });

  it('RED: a published prefix no dequeue chain rebuilds is caught (the reviewed failure)', () => {
    const forged: Ga5Transcript = {
      ...healthy(),
      dequeues: [], // NO dequeue at all, yet a row publishes resolvedThrough 1 — exactly the
      // pattern the earlier report mistook for coverage.
      deliveries: [delivery({ ack: 1, resolvedThrough: 1 })],
    };
    const issues = auditGa5Transcript(forged);
    expect(issues.some((i) => i.startsWith('published-prefix-not-rebuildable'))).toBe(true);
  });

  it('RED: a delivery from a FOREIGN epoch is caught even when its numbers look right', () => {
    const forged: Ga5Transcript = {
      ...healthy(),
      deliveries: [delivery({ epoch: 6, resolvedThrough: 0 })],
    };
    expect(auditGa5Transcript(forged).some((i) => i.startsWith('foreign-epoch-delivery'))).toBe(true);
  });

  it('RED: a consumed stamp NO send staged is caught (shared-input aliasing / foreign record)', () => {
    const forged: Ga5Transcript = { ...healthy(), dequeues: [dq(10, 40)] }; // consumed 40, staged 1,1
    const issues = auditGa5Transcript(forged);
    expect(issues.some((i) => i.includes('consumed-stamp-never-staged'))).toBe(true);
  });

  it('RED: a decline that WAS applied is caught (consumed count exceeds the accepted originals)', () => {
    const forged: Ga5Transcript = { ...healthy(), dequeues: [dq(10, 1), dq(11, 1)] };
    expect(auditGa5Transcript(forged).some((i) => i.includes('decline-not-silent'))).toBe(true);
  });

  it('RED: an accepted original that never got consumed while a decline is claimed is caught', () => {
    const base = healthy();
    const forged: Ga5Transcript = { ...base, dequeues: [], deliveries: [delivery({ ack: 0, resolvedThrough: 0 })] };
    expect(auditGa5Transcript(forged).some((i) => i.includes('original-not-consumed'))).toBe(true);
  });

  it('RED: duplicate staging without DECLARED decline intent is caught (no silent aliasing)', () => {
    const forged: Ga5Transcript = { ...healthy(), declinedFrames: [] };
    expect(auditGa5Transcript(forged).some((i) => i.includes('ambiguous-stamp-intent'))).toBe(true);
  });

  it('RED: an early pending prune (no covering accepted delivery, no discard) is caught', () => {
    const forged: Ga5Transcript = {
      ...healthy(),
      pendingSamples: [
        { atMs: 1_400, seqs: [9] },
        { atMs: 1_500, seqs: [] }, // vanished with no accepted delivery covering stamp 9
      ],
    };
    expect(auditGa5Transcript(forged).some((i) => i.includes('early-prune'))).toBe(true);
    // …and the same vanish is LEGAL when a labelled discard-pending happened inside the window:
    expect(auditGa5Transcript(forged, [{ atMs: 1_450 }])).toEqual([]);
  });

  it('RED: duplicate consumption of one stamp is caught', () => {
    const forged: Ga5Transcript = { ...healthy(), dequeues: [dq(10, 2), dq(11, 2)] };
    expect(auditGa5Transcript(forged).some((i) => i.includes('duplicate-consumption'))).toBe(true);
  });

  it('RED: an accepted row whose slot-ack ≠ room prefix is caught (the counters are independent; equality is a guard precondition, not coverage)', () => {
    const forged: Ga5Transcript = {
      ...healthy(),
      deliveries: [delivery({ ack: 2, resolvedThrough: 0 })],
    };
    expect(auditGa5Transcript(forged).some((i) => i.includes('ack-disposition-conflation'))).toBe(true);
  });

  it('the naive last-row selection is demonstrably NOT the transcript-keyed selection', () => {
    const staleTail: Ga5Transcript = {
      ...healthy(),
      deliveries: [...healthy().deliveries, delivery({ epoch: 6, revision: 99 })],
    };
    const cmp = naiveVsJoined(staleTail);
    expect(cmp.diverged, 'a foreign-epoch trailing row makes the naive read select the WRONG row').toBe(true);
    expect(cmp.naiveLast?.revision).toBe(99);
    expect(cmp.joinedLast?.revision).toBe(1);
    // On a clean ledger the two agree — the control fires only on genuine divergence.
    expect(naiveVsJoined(healthy()).diverged).toBe(false);
  });
});
