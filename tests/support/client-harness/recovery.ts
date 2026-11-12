/**
 * The client recovery rules of ADR-0003 §3.2 as amended, as a pure deterministic module
 * (UDG-003 Phase 2 W-7).
 *
 * This is the **frozen rule statement** the assignment requires to be handed to UDG-008, written so
 * that it can be executed rather than quoted: every rule is a function of the hashed envelope and
 * the observed deliveries, with no wall clock, no transport and no Colyseus import. UDG-008 replaces
 * this test-only module with the production client; the vectors in
 * `artifacts/udg-003-phase-2/input-reconciliation.json` are the conformance cases either
 * implementation must pass.
 *
 * The rules, in the order §3.2 states them:
 *
 * 1. **Same-delivery comparison (R-A).** The acknowledgement (`lastProcessed`) and the disposition
 *    record (`inputResolvedThrough`) are compared only when they arrived in the **same** state
 *    delivery. PR-15 measured that they are delivered atomically; PR-14 re-measured it on the real
 *    room. A comparison across deliveries is not evidence of anything, so this module refuses to
 *    make one — `observe` takes both values from one `Delivery`.
 * 2. **`INPUT_ACK_STALLED` (R-B).** Two triggers, whichever comes first:
 *    - `stallDetectionDeliveries` (G) consecutive accepted deliveries in which neither the ack nor
 *      the record advanced and the epoch did not change; or
 *    - the client-local `clientSnapshotDeadlineMs` (500 ms) from the last accepted delivery, which
 *      expires **whether or not any delivery arrives** — the case PR-15 exists for.
 *    On stall the client stops sending, discards local prediction and opens a recovery episode.
 * 3. **Snapshot recovery (R-C).** A delivery whose record advances past the client's known ack
 *    rebases the client: known ack := record.resolvedThrough, next send := resolvedThrough + 1,
 *    predictions discarded, episode closed. A rebase on a **changed epoch** is the same rule —
 *    the server restarted the stamp domain, and the client follows the new domain through the
 *    record, never by guessing.
 * 4. **Episode deadline (R-D).** `clientRecoveryDeadlineMs` (4000 ms) runs from episode start. At
 *    expiry the client closes **itself** under `INPUT_RECOVERY` (4102). The deadline bounds the
 *    episode; it does not budget attempts (D-P2-8).
 * 5. **Rolling rejoin allowance (R-E).** At most `rejoinWindowAllowance` (2) actual rejoins inside
 *    any trailing `rejoinWindowSeconds` (60 s) window, counted **per entity across episodes**. The
 *    backoff ladder is a schedule, not an entitlement: an attempt is due at the next rung only if
 *    the allowance has room and the episode deadline has not expired. When the allowance is the
 *    binding constraint the client does not attempt; it stays out and the episode ends closed
 *    under 4102. A refused attempt never consumes allowance.
 *
 * The module is deliberately silent about anything it is not given: no timers, no I/O, no
 * "currently connected". A clock is whatever the scenario says it is.
 */

import type { InputEnvelopeConfig } from '../../../packages/config/dist/index.js';

/** One state delivery: the only unit of observation §3.2 recognises (R-A). */
export interface Delivery {
  readonly atMs: number;
  /** `InputHandle.lastProcessed` as the client read it **in this delivery**. */
  readonly ack: number;
  /** The disposition record beside it; absent means the row was not readable in this delivery. */
  readonly record: {
    readonly resolvedThrough: number;
    readonly gapStart: number;
    readonly gapEnd: number;
    readonly retiredUnrepresented: number;
  } | null;
  /** The epoch the delivery carries (server-issued; UDG-003 §W-4). */
  readonly epoch: number;
}

export type RecoveryEvent =
  | { readonly atMs: number; readonly type: 'INPUT_ACK_STALLED'; readonly trigger: 'deliveries' | 'deadline' }
  | { readonly atMs: number; readonly type: 'stop-sending' }
  | { readonly atMs: number; readonly type: 'discard-prediction' }
  | { readonly atMs: number; readonly type: 'rejoin-attempt'; readonly rungMs: number; readonly allowanceUsed: number }
  | { readonly atMs: number; readonly type: 'allowance-refused'; readonly reason: 'rolling-window' }
  | { readonly atMs: number; readonly type: 'recovered'; readonly rebasedTo: number; readonly viaEpochChange: boolean }
  | { readonly atMs: number; readonly type: 'client-close'; readonly code: number; readonly reason: 'episode-deadline' | 'allowance-exhausted' };

export type RecoveryState = 'ok' | 'stalled' | 'recovering' | 'closed';

export interface RecoverySnapshot {
  readonly state: RecoveryState;
  readonly knownAck: number;
  readonly nextSend: number;
  readonly sendingAllowed: boolean;
  readonly predictionDiscarded: boolean;
  readonly episodeStartedAtMs: number | null;
  readonly epoch: number;
  /** Timestamp at which the next rejoin attempt is due under the ladder, if one is pending. */
  readonly nextAttemptAtMs: number | null;
}

/**
 * A clock is an input, so a scenario can show the 500 ms deadline expiring with **zero** deliveries
 * and the 4000 ms episode deadline expiring between two ladder rungs.
 */
export class RecoveryPolicy {
  state: RecoveryState = 'ok';
  knownAck = 0;
  epoch = 1;
  private sending = true;
  private episodeStartedAt: number | null = null;
  private attemptsInEpisode = 0;
  /** Timestamps of **actual** rejoins, rolling window, per entity across episodes (R-E). */
  private readonly rejoins: number[] = [];
  private stagnantDeliveries = 0;
  private lastAck = 0;
  private lastResolved = 0;
  private lastDeliveryAt: number | null = null;
  private readonly events: RecoveryEvent[] = [];

  constructor(private readonly env: InputEnvelopeConfig, private readonly now: () => number) {}

  /** Events in occurrence order; the vectors compare this list, not prose. */
  history(): readonly RecoveryEvent[] {
    return this.events;
  }

  snapshot(): RecoverySnapshot {
    return {
      state: this.state,
      knownAck: this.knownAck,
      nextSend: this.knownAck + 1,
      sendingAllowed: this.sending,
      predictionDiscarded: !this.sending,
      episodeStartedAtMs: this.episodeStartedAt,
      epoch: this.epoch,
      nextAttemptAtMs: this.pendingAttemptAt(),
    };
  }

  /** The ladder rung due for this episode's next attempt, or null when none is pending. */
  private pendingAttemptAt(): number | null {
    if (this.episodeStartedAt === null) return null;
    const due = this.episodeStartedAt + this.rungAt(this.attemptsInEpisode);
    return due > this.now() ? due : this.now();
  }

  /** The ladder is a three-rung schedule by construction (config validates it); index defensively. */
  private rungAt(attemptIndex: number): number {
    const rung = this.env.rejoinBackoffMs[Math.min(attemptIndex, this.env.rejoinBackoffMs.length - 1)];
    if (typeof rung !== 'number') throw new Error('rejoinBackoffMs must be a three-step schedule');
    return rung;
  }

  /**
   * Feed one accepted state delivery (R-A: ack and record from this delivery and no other).
   * Returns the events this delivery produced.
   */
  observe(delivery: Delivery): readonly RecoveryEvent[] {
    if (this.state === 'closed') return [];
    const before = this.events.length;
    this.lastDeliveryAt = delivery.atMs;

    // R-E/R-D bookkeeping comes first only in the sense that a delivery can close an episode: if a
    // record advances past the known ack, the client is recovered whatever the episode looked like.
    // A **changed epoch** rebases through the record on its own terms (R-C): the server restarted
    // the stamp domain, so the new domain's small numbers are not “behind” the old domain's large
    // ones — comparing magnitudes across domains would be the bug, and following the record is the
    // rule. Measured live by the recovery scenarios, whose rejoined seats carry epoch 2.
    const resolved = delivery.record?.resolvedThrough ?? 0;
    const epochChanged = delivery.epoch !== this.epoch;
    const advanced = epochChanged || resolved > this.knownAck || delivery.ack > this.knownAck;

    if (delivery.record !== null && advanced) {
      this.knownAck = Math.max(delivery.ack, resolved);
      this.stagnantDeliveries = 0;
      const viaEpoch = epochChanged && !this.sending;
      this.epoch = delivery.epoch;
      if (!this.sending) {
        this.events.push({ atMs: delivery.atMs, type: 'recovered', rebasedTo: this.knownAck, viaEpochChange: viaEpoch });
        this.sending = true;
        this.episodeStartedAt = null;
        this.attemptsInEpisode = 0;
      }
      this.lastAck = delivery.ack;
      this.lastResolved = resolved;
      this.state = 'ok';
      return this.events.slice(before);
    }

    // R-A stall counting: same epoch, neither counter moved.
    if (!epochChanged && delivery.ack <= this.lastAck && resolved <= this.lastResolved) {
      this.stagnantDeliveries += 1;
    } else {
      this.stagnantDeliveries = 0;
    }
    this.lastAck = Math.max(this.lastAck, delivery.ack);
    this.lastResolved = Math.max(this.lastResolved, resolved);
    if (epochChanged) this.epoch = delivery.epoch;

    if (this.state === 'ok' && this.stagnantDeliveries >= this.env.stallDetectionDeliveries) {
      this.enterEpisode(delivery.atMs, 'deliveries');
    }
    return this.events.slice(before);
  }

  /**
   * Advance the clock. The deadline trigger runs even when no delivery has ever arrived (§3.2:
   * "expires whether or not any delivery arrives"), and the episode deadline and ladder are
   * evaluated on every call.
   */
  tick(nowMs: number): readonly RecoveryEvent[] {
    const before = this.events.length;
    if (this.state === 'closed') return [];

    if (this.state === 'ok') {
      const since = this.lastDeliveryAt === null ? null : nowMs - this.lastDeliveryAt;
      const everDelivered = this.lastDeliveryAt !== null;
      if (everDelivered && since !== null && since > this.env.clientSnapshotDeadlineMs) {
        this.enterEpisode(nowMs, 'deadline');
      }
    }

    if (this.state === 'stalled' || this.state === 'recovering') {
      const episode = this.episodeStartedAt ?? nowMs;
      const age = nowMs - episode;
      // R-D: the episode deadline outranks the ladder. Past 4000 ms the client closes itself; the
      // allowance question becomes moot and no further attempt is made.
      if (age > this.env.clientRecoveryDeadlineMs) {
        this.events.push({ atMs: nowMs, type: 'client-close', code: this.env.closeCodes.INPUT_RECOVERY, reason: 'episode-deadline' });
        this.state = 'closed';
        this.sending = false;
        return this.events.slice(before);
      }
      const rung = this.rungAt(this.attemptsInEpisode);
      if (nowMs >= episode + rung) {
        // R-E counts **actual** rejoins in the trailing window (D-P2-8 resolved the attempt-budget
        // reading precisely against this): a due attempt checks the allowance but spends nothing.
        // The window is charged by `markRejoin`, which the caller invokes when the transport
        // actually got a seat back. Allowance-bound clients do not attempt, they end.
        this.trimWindow(nowMs);
        if (this.rejoins.length >= this.env.rejoinWindowAllowance) {
          this.events.push({ atMs: nowMs, type: 'allowance-refused', reason: 'rolling-window' });
          this.events.push({ atMs: nowMs, type: 'client-close', code: this.env.closeCodes.INPUT_RECOVERY, reason: 'allowance-exhausted' });
          this.state = 'closed';
          this.sending = false;
          return this.events.slice(before);
        }
        this.attemptsInEpisode += 1;
        this.state = 'recovering';
        this.events.push({ atMs: nowMs, type: 'rejoin-attempt', rungMs: rung, allowanceUsed: this.rejoins.length });
      }
    }
    return this.events.slice(before);
  }

  /**
   * The transport reports an **actual** rejoin at `atMs`. R-E counts these, not attempts: failed
   * attempts leave the episode running against its deadline without spending allowance.
   */
  markRejoin(atMs: number): void {
    this.trimWindow(atMs);
    if (this.rejoins.length < this.env.rejoinWindowAllowance) this.rejoins.push(atMs);
  }

  private trimWindow(nowMs: number): void {
    const cutoff = nowMs - this.env.rejoinWindowSeconds * 1000;
    while (this.rejoins.length > 0 && this.rejoins[0] !== undefined && this.rejoins[0] <= cutoff) this.rejoins.shift();
  }

  private enterEpisode(atMs: number, trigger: 'deliveries' | 'deadline'): void {
    this.events.push({ atMs, type: 'INPUT_ACK_STALLED', trigger });
    this.events.push({ atMs, type: 'stop-sending' });
    this.events.push({ atMs, type: 'discard-prediction' });
    this.sending = false;
    this.state = 'stalled';
    this.episodeStartedAt = atMs;
    this.attemptsInEpisode = 0;
    this.stagnantDeliveries = 0;
  }


}
