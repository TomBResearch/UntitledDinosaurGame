/**
 * UDG-SPIKE-001 slice 24 — DIAGNOSTIC PROTOTYPE (candidate ONLY, nothing adopted): a minimum
 * acknowledgement-OPPORTUNITY WAIT in front of the ADR-0003 §3.2 INPUT_ACK_STALLED trigger.
 *
 * WHAT THE WAIT IS, EXACTLY: the estimate (same-socket RTT + delivery/authority service
 * allowance, assembled per plan §19 from NAMED retained measurements) is a MEASURED CONSERVATIVE
 * WAIT/ENVELOPE — a wait chosen from observed distributions so a genuine ack has had a credible
 * opportunity to arrive. It is explicitly NOT a mathematical lower bound for every
 * acknowledgement: no claim survives that an ack CANNOT exist before the wait elapses; a fire
 * UNDER the wait could still be a true loss. What the wait buys is the elimination of the
 * STRUCTURAL false-positive class the ack-window diagnostic evidenced: a delivery-count streak
 * (G messages, fast arrivals included) that can COMPLETE before any ack is causally possible at
 * the profile's envelope.
 *
 * The function is PURE and clock-INJECTED so the adversarial cases run on synthetic clocks.
 * It NEVER touches the snapshot deadline, the episode deadline, or the rolling cap: an actually
 * missing delivery still expires through its own independent timers. It knows nothing about
 * server liveness — the wait requires NO timed activity from the server.
 *
 * STATUS: PROPOSED/CANDIDATE. Not adopted by the ADR, not the product default (the predictor
 * keeps the current count-only rule whenever floorMs is null), not wired into any formal lane.
 */

export type StallFloorDecision = 'fire' | 'held' | 'no-condition';

export interface StallFloorInput {
  /** The declared TEST WAIT for the run (null = prototype OFF → exactly today's rule). */
  readonly floorMs: number | null;
  readonly streak: number;
  readonly deliveriesRequired: number;
  /**
   * Sent instant of the OLDEST ACTUAL outstanding input in the CURRENT epoch, or null when
   * nothing genuinely outstanding exists in it. Obsolete entries (another domain's journal,
   * retired or pruned identities) are NOT passed: they never hold the recovery condition.
   */
  readonly oldestOutstandingSameEpochSentAtMs: number | null;
  readonly nowMs: number;
}

export const stalledAckFloorDecision = (input: StallFloorInput): StallFloorDecision => {
  if (input.streak < input.deliveriesRequired) return 'no-condition';
  if (input.floorMs === null) return 'fire'; // product rule unchanged when the prototype is off
  if (input.oldestOutstandingSameEpochSentAtMs === null) return 'no-condition';
  const ageMs = input.nowMs - input.oldestOutstandingSameEpochSentAtMs;
  return ageMs > input.floorMs ? 'fire' : 'held';
};
