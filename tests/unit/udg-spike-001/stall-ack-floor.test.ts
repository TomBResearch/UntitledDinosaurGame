/**
 * UDG-SPIKE-001 slice 24 — SYNTHETIC-CLOCK adversarial cases for the PROPOSED (NOT adopted)
 * stalled-ack acknowledgement-opportunity wait. The wait is a MEASURED CONSERVATIVE envelope,
 * never a mathematical lower bound: these cases pin the DECISION SHAPE only, on injected
 * clocks, with no timers and no network.
 */
import { describe, expect, it } from 'vitest';

import { stalledAckFloorDecision } from '../../../apps/client/src/network/stallAckFloor.ts';

const G = 3;
const WAIT = 400; // the pre-registered test wait (plan §19 components); value irrelevant to shape

describe('stalled-ack floor PROTOTYPE (synthetic clocks; proposed, not adopted)', () => {
  it('fast HEALTHY patches complete G while the actual ack is not yet serviceable: HELD, not fired', () => {
    // Backlog burst: G deliveries arrived 60 ms apart, the oldest outstanding input is only
    // 180 ms old — under a 240 ms RTT envelope. A count-only rule would fire here (the slice-23
    // structural finding); the floor holds.
    const d = stalledAckFloorDecision({ floorMs: WAIT, streak: G, deliveriesRequired: G, oldestOutstandingSameEpochSentAtMs: 1_000, nowMs: 1_180 });
    expect(d).toBe('held');
  });

  it('a BACKLOG that ADVANCES never reaches the fire gate: streak below requirement is no-condition', () => {
    // The adapter resets the streak to 1 whenever the paired ack/disposition moves; the helper
    // therefore never even sees a complete streak on an advancing backlog.
    const d = stalledAckFloorDecision({ floorMs: WAIT, streak: 1, deliveriesRequired: G, oldestOutstandingSameEpochSentAtMs: 1_000, nowMs: 5_000 });
    expect(d).toBe('no-condition');
  });

  it('TRUE loss with healthy deliveries: oldest outstanding older than the wait FIRES', () => {
    const d = stalledAckFloorDecision({ floorMs: WAIT, streak: G, deliveriesRequired: G, oldestOutstandingSameEpochSentAtMs: 1_000, nowMs: 1_000 + WAIT + 1 });
    expect(d).toBe('fire');
  });

  it('an OLD-EPOCH pending entry never holds the recovery condition: null oldest is no-condition', () => {
    // Obsolete identities (another domain's journal entry, retired or pruned) are NOT passed in.
    const d = stalledAckFloorDecision({ floorMs: WAIT, streak: 12, deliveriesRequired: G, oldestOutstandingSameEpochSentAtMs: null, nowMs: 9_999_999 });
    expect(d).toBe('no-condition');
  });

  it('IDLE (nothing pending) is structurally no-condition (null oldest), even with a stale streak', () => {
    const d = stalledAckFloorDecision({ floorMs: WAIT, streak: 99, deliveriesRequired: G, oldestOutstandingSameEpochSentAtMs: null, nowMs: 500 });
    expect(d).toBe('no-condition');
  });

  it('the DEADLINE path is orthogonal: this rule sees no delivery-loss timers; with the floor OFF the decision is exactly today\'s count-only fire', () => {
    // floorMs === null is what EVERY production path uses: the moment the count is complete the
    // fire stands — snapshot/episode timers stay independent and still own truly-missing delivery.
    const d = stalledAckFloorDecision({ floorMs: null, streak: G, deliveriesRequired: G, oldestOutstandingSameEpochSentAtMs: 1_000, nowMs: 1_001 });
    expect(d).toBe('fire');
    const stillNoCondition = stalledAckFloorDecision({ floorMs: null, streak: G - 1, deliveriesRequired: G, oldestOutstandingSameEpochSentAtMs: 1_000, nowMs: 1_001 });
    expect(stillNoCondition).toBe('no-condition');
  });

  it('the wait boundary is strict-older (age === wait has NOT yet exceeded a declared wait)', () => {
    const at = stalledAckFloorDecision({ floorMs: WAIT, streak: G, deliveriesRequired: G, oldestOutstandingSameEpochSentAtMs: 0, nowMs: WAIT });
    expect(at).toBe('held');
  });
});
