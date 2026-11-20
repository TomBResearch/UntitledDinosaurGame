/**
 * UDG-SPIKE-001 — the accepted-RTT probe's slot-reservation state machine (slice 6d).
 *
 * WHY THIS FILE EXISTS (review of 4db1a0f). `Room.ping` stores ONE callback slot and the PING
 * frame carries no request id (`@colyseus/sdk@0.18.9` src/Room.ts:90, 307-317, 788-791). A ping
 * that RETIRES at its reply deadline therefore leaves its still-coming echo live: if the probe
 * simply waited a fixed grace and sent the next ping, a late echo arriving after that grace
 * would fire the FOLLOWING ping's callback — a sample attributed to the wrong send. The old
 * 1500 ms grace had exactly this hole. The rule now:
 *
 *   a retirement keeps the slot RESERVED until the original echo is POSITIVELY observed (a
 *   discard — it is counted, never sampled);
 *   if no confirmation arrives within `confirmCapMs`, the socket/cell STOPS measuring — the
 *   slot is poisoned, every remaining opportunity is marked invalid/not-sent, and NO further
 *   ping is ever sent on this connection from this probe;
 *   the slot is NEVER overwritten on an elapsed grace.
 *
 * Measurement may continue only on a verified basis: either the retired callback positively
 * returned (probe continues on the same connection), or a NEW connection/domain is joined and
 * labelled as a separate diagnostic window (that decision lives with the caller, not here —
 * this machine simply stops and says so).
 *
 * The machine is pure: the caller injects `sendPing` (which must THROW on a closed socket — the
 * SDK's silent no-op on closed connections must never pose as a slow reply), `onLateEcho`-style
 * accounting flows through the returned counters, `epochNow` optionally guards against a socket
 * epoch replacement mid-window (a rejoin means a new domain: the slot's continuity is unknown,
 * so the window STOPS with `epoch-changed`), and time/sleep are injected so unit tests drive
 * late echoes LATER than any grace, missing echoes, recovery after confirmation, and epoch
 * swaps deterministically. The browser page and the unit tests run THIS file — one state
 * machine, two hosts.
 */

export interface ProbeOptions {
  readonly pings: number;
  /** Gap between a confirmed echo and the next send. */
  readonly cadenceMs: number;
  /** Reply deadline: a ping not echoed by then RETIRES (an invalid-sample opportunity). */
  readonly deadlineMs: number;
  /** After a retirement, how long to wait for the original echo to positively arrive. */
  readonly confirmCapMs: number;
}

export interface ProbeDeps {
  nowMs(): number;
  sleep(ms: number): Promise<void>;
  /** Schedule `cb` after `ms` of THIS host's time (real timers in the page; VIRTUAL in unit
   * tests, so late echoes later than any deadline are tested deterministically). */
  after(ms: number, cb: () => void): () => void;
  /**
   * Send one protocol ping; `onEcho` fires exactly once per send when the echo arrives (the
   * SDK guarantees this per slot). MUST throw if the underlying socket is closed.
   */
  sendPing(onEcho: (sdkMs: number) => void): void;
  /** Optional mid-window epoch guard: a changed value stops the window (`epoch-changed`). */
  epochNow?(): number;
}

export interface ProbeSample {
  readonly sentAtMs: number;
  readonly receivedAtMs: number;
  readonly rttMs: number;
  readonly sdkMs: number;
}

export type ProbeAbort = null | 'slot-poisoned' | 'socket-closed' | 'epoch-changed';

export interface ProbeOutcome {
  readonly samples: readonly ProbeSample[];
  /** Retirements whose original echo was later POSITIVELY observed (discards). */
  readonly lateDiscarded: number;
  /** Retirements still unconfirmed when the window ended — counted, never sampled. */
  readonly retiredUnconfirmed: number;
  readonly slotPoisoned: boolean;
  readonly socketClosed: boolean;
  readonly epochChanged: boolean;
  readonly abortedReason: ProbeAbort;
  /** Opportunities never sent because the window stopped (poison/close/epoch). */
  readonly notSent: number;
  readonly clockElapsedMs: number;
  readonly wallElapsedMs: number;
}

/**
 * One ping: resolves with a sample, or `null` on retirement AT `deadlineMs`. `late` is a live
 * cell: an echo arriving after the resolve (retirement) increments it — the caller keeps the
 * slot reserved while it polls that cell, and only then may send again.
 */
interface PingAttempt {
  sample: ProbeSample | null;
  lateCount: number;
  settled: boolean;
}

const sendOne = (deps: ProbeDeps, opts: ProbeOptions, attempt: PingAttempt, sentAtMs: number, closedRef: { closed: boolean }): Promise<ProbeSample | null> =>
  new Promise<ProbeSample | null>((resolve) => {
    const cancelTimer = deps.after(opts.deadlineMs, () => {
      if (attempt.settled) return;
      attempt.settled = true;
      resolve(null); // RETIRED — the slot stays reserved; the echo may still come.
    });
    const onEcho = (sdkMs: number): void => {
      const receivedAtMs = deps.nowMs();
      if (attempt.settled) {
        attempt.lateCount += 1; // echo of a retired ping: observed, counted, DISCARDED
        return;
      }
      attempt.settled = true;
      cancelTimer();
      resolve({ sentAtMs, receivedAtMs, rttMs: receivedAtMs - sentAtMs, sdkMs });
    };
    try {
      deps.sendPing(onEcho);
    } catch {
      // Closed socket: the pass-through refused. Report via the ref and settle as retired —
      // the loop turns this into `socket-closed`, never into a retirement-plus-poison cascade.
      closedRef.closed = true;
      if (!attempt.settled) {
        attempt.settled = true;
        cancelTimer();
        resolve(null);
      }
    }
  });

export const runProbeWindow = async (deps: ProbeDeps, opts: ProbeOptions): Promise<ProbeOutcome> => {
  const samples: ProbeSample[] = [];
  const clockStart = deps.nowMs();
  const wallStart = Date.now();
  const epoch0 = deps.epochNow?.();
  let lateDiscarded = 0;
  let retiredUnconfirmed = 0;
  let aborted: ProbeAbort = null;
  let sent = 0;

  for (let i = 0; i < opts.pings; i += 1) {
    if (deps.epochNow !== undefined && deps.epochNow() !== epoch0) {
      aborted = 'epoch-changed';
      break;
    }
    const attempt: PingAttempt = { sample: null, lateCount: 0, settled: false };
    const sentAtMs = deps.nowMs();
    sent += 1;
    const closedRef = { closed: false };
    const result = await sendOne(deps, opts, attempt, sentAtMs, closedRef);
    if (closedRef.closed) {
      aborted = 'socket-closed';
      break;
    }
    if (result !== null) {
      samples.push(result);
      await deps.sleep(opts.cadenceMs);
      continue;
    }

    // RETIRED: the slot is RESERVED until the original echo is POSITIVELY observed. Polling a
    // live counter — never a fixed grace after which a send could cross with a late echo.
    const confirmStart = deps.nowMs();
    let confirmed = false;
    while (deps.nowMs() - confirmStart < opts.confirmCapMs) {
      if (attempt.lateCount > 0) {
        confirmed = true;
        break;
      }
      await deps.sleep(25);
    }
    if (confirmed) {
      lateDiscarded += 1;
      // The slot is free again (the echo fired it and the SDK cleared it): continue safely.
      await deps.sleep(opts.cadenceMs);
      continue;
    }
    // No confirmation within the cap: the slot may still deliver its echo into ANY future
    // callback — it is POISONED. Stop this socket/cell; never send again here.
    retiredUnconfirmed += 1;
    aborted = 'slot-poisoned';
    break;
  }

  return {
    samples,
    lateDiscarded,
    retiredUnconfirmed,
    slotPoisoned: aborted === 'slot-poisoned',
    socketClosed: aborted === 'socket-closed',
    epochChanged: aborted === 'epoch-changed',
    abortedReason: aborted,
    notSent: opts.pings - sent,
    clockElapsedMs: deps.nowMs() - clockStart,
    wallElapsedMs: Date.now() - wallStart,
  };
}
