/**
 * PR-13 — can a public, supported mechanism stop the buffer from retiring a frame it never represented?
 *
 * PR-8 established the finding this probe works from: with the pinned `@colyseus/core@0.18.27` /
 * `@colyseus/sdk@0.18.9`, overflow eviction counts as consumption, so a frame the server dropped because
 * the buffer was full is acknowledged exactly like a frame that was applied
 * ([api map §4](../../../docs/integration/colyseus-0.18-api-map.md)). [UDG-003.md](../../../docs/contracts/UDG-003.md)
 * and [movement-authority.md 5.1](../../../docs/interfaces/movement-authority.md) forbid acknowledging a
 * frame that was never represented in state, so the question is no longer *whether* that happens but
 * **whether UDG can keep it from happening using supported API only**.
 *
 * What is authorised here, and what is not. This probe may use public declarations, and it may
 * disconnect an offender. It may **not** use an unbounded queue, private SDK state, a fabricated
 * acknowledgement, or a custom prediction/input transport — those are workarounds, and a workaround has to
 * be escalated as an architectural decision rather than coded quietly into a room.
 *
 * The postures under test are every public lever that could plausibly act before or at admission:
 *
 * | scenario | posture | declaration |
 * | --- | --- | --- |
 * | N1 | nothing — the failure, reproduced for comparison | `bufferMaxSize` eviction |
 * | N2 | `InputAccessor.clear()` at a backlog threshold | `input/types.d.ts` |
 * | N3 | `Client.leave(code)` at a backlog threshold | `Transport.d.ts` |
 * | N4 | `Room.maxMessagesPerSecond`, the library's own sender ceiling | `Room.d.ts` |
 * | N5 | `defineInput(…, { seqField: 'generation' })` | `input/types.d.ts` |
 * | N6 | `Room.send(client, 'udg-backlog', …)` plus a sender that obeys it | `Room.d.ts` |
 * | N7 | `drain()` then step the newest frame — the form the declarations warn against | `input/types.d.ts` |
 * | N8 | `take(n)` with `n` below / at the arrival-to-step ratio | `input/types.d.ts` |
 * | N9 | `defineInput(…, { sanitize })`, the only admission-time hook | `input/types.d.ts` |
 *
 * Measurements are frame **identities** (generations), computed identically in every scenario:
 *
 * - `ackedUnrepresented` — generations the client's `lastProcessed` retires whose values never entered a
 *   solver step. Non-empty means the prohibition is violated. (`drain()`-retired frames count here: the
 *   pinned declarations say `drain()`-then-apply-latest "would silently jump the ack past inputs the
 *   server never simulated".)
 * - `unackedUnrepresented` — generations that vanished without acknowledgement. Beside a disconnect these
 *   are the honest residue: the sender must learn from the connection, not from an acknowledgement.
 */

import { defineRoom, type RegisteredHandler } from '@colyseus/core';
import { Client, type InputHandle } from '@colyseus/sdk';
import { RegionSchema, type RegionSchema as RegionState } from '@udg/protocol/schema';

import { OverflowRoom, lastOf, overflowRooms, type OverflowPolicy } from './rooms.js';
import {
  httpEndpoint,
  outputPath,
  runProbe,
  sleep,
  startProbeServer,
  until,
  type DirectInputFrame,
  type ProbeServer,
} from './support.js';

const EPOCH = 11;

interface RunOptions {
  readonly label: string;
  readonly policy: OverflowPolicy;
  readonly bufferMaxSize: number;
  readonly threshold: number;
  readonly tickRate: number;
  readonly sendCount: number;
  readonly gapMs: number;
  readonly settleMs: number;
  readonly maxMessagesPerSecond?: number;
  readonly consumeBudget?: number;
  readonly stopOnSignal?: boolean;
}

/** One sent frame, as both sides can name it: the client seq the ack compares against, and the generation. */
interface SentFrame {
  readonly seq: number;
  readonly generation: number;
  readonly sentAt: number;
}

interface RunResult {
  readonly label: string;
  readonly policy: OverflowPolicy;
  readonly sent: readonly number[];
  readonly simulated: readonly number[];
  readonly drainedWithoutStep: readonly number[];
  readonly bufferedAtRead: readonly number[];
  readonly everBuffered: readonly number[];
  readonly ackedUnrepresented: readonly number[];
  readonly unackedUnrepresented: readonly number[];
  readonly replayableAfterSettle: readonly number[];
  readonly maxBuffered: number;
  readonly bufferMaxSize: number;
  readonly ticks: number;
  readonly ackedCount: number;
  readonly clientLastProcessed: number;
  readonly clientSent: number;
  readonly clientPending: number;
  readonly serverConsumedCount: number;
  readonly serverSize: number;
  readonly clearCalls: number;
  readonly consumedCountBeforeClear: number;
  readonly consumedCountAfterClear: number;
  readonly throttleSignals: number;
  readonly signalsReceived: number;
  readonly framesSentInsideSignalWindow: number;
  readonly sanitizeCalls: number;
  readonly sanitizedFramesStepped: number;
  readonly disconnects: readonly { kind: 'leave' | 'drop'; sessionId: string; code: number | undefined }[];
  readonly clientLeaveCode: number | null;
  readonly error: string | null;
}

function frame(index: number): DirectInputFrame {
  return { sessionEpoch: EPOCH, generation: index + 1, directIntent: true, moveX: 0.5, moveZ: 0 };
}

/** A bounded, readable form of an identity list — the detail lines must not become unreadable. */
function preview(ids: readonly number[]): string {
  const head = ids.slice(0, 8).join(', ');
  return ids.length <= 8 ? head : `${head}, … (+${String(ids.length - 8)} more)`;
}

function largest(samples: readonly number[]): number {
  return samples.reduce((a: number, b: number): number => (a > b ? a : b), 0);
}

/**
 * Drive one posture end to end.
 *
 * The client sends as fast as the scenario allows, which is the only way to make the backlog real; the
 * room's own per-tick sampling is what proves the bound, because the room is the party that would have to
 * act before eviction.
 */
async function run(options: RunOptions): Promise<RunResult> {
  const empty: RunResult = {
    label: options.label,
    policy: options.policy,
    sent: [],
    simulated: [],
    drainedWithoutStep: [],
    bufferedAtRead: [],
    everBuffered: [],
    ackedUnrepresented: [],
    unackedUnrepresented: [],
    replayableAfterSettle: [],
    maxBuffered: 0,
    bufferMaxSize: options.bufferMaxSize,
    ticks: 0,
    ackedCount: 0,
    clientLastProcessed: -1,
    clientSent: 0,
    clientPending: -1,
    serverConsumedCount: -1,
    serverSize: -1,
    clearCalls: 0,
    consumedCountBeforeClear: -1,
    consumedCountAfterClear: -1,
    throttleSignals: 0,
    signalsReceived: 0,
    framesSentInsideSignalWindow: 0,
    sanitizeCalls: 0,
    sanitizedFramesStepped: 0,
    disconnects: [],
    clientLeaveCode: null,
    error: null,
  };

  let server: ProbeServer | undefined;
  let leaveRoom: (() => Promise<number>) | undefined;
  try {
    const rooms: Record<string, RegisteredHandler> = {
      region: defineRoom(OverflowRoom, {
        policy: options.policy,
        threshold: options.threshold,
        bufferMaxSize: options.bufferMaxSize,
        tickRate: options.tickRate,
        ...(options.consumeBudget === undefined ? {} : { consumeBudget: options.consumeBudget }),
        ...(options.maxMessagesPerSecond === undefined ? {} : { maxMessagesPerSecond: options.maxMessagesPerSecond }),
      }),
    };
    server = await startProbeServer(rooms);
    const client = new Client(httpEndpoint(server.endpoint));

    const joined = await client.create<RegionState>('region', {}, RegionSchema);
    leaveRoom = (): Promise<number> => joined.leave(false);
    const handle: InputHandle<DirectInputFrame> = joined.input<DirectInputFrame>();
    const instance: OverflowRoom | undefined = lastOf(overflowRooms);
    if (instance === undefined) throw new Error(`${options.label}: the overflow room instance was never constructed`);

    let signalsReceived = 0;
    let signalReceivedAt = 0;
    let clientLeaveCode: number | null = null;
    joined.onMessage('udg-backlog', (): void => {
      signalsReceived += 1;
      if (signalReceivedAt === 0) signalReceivedAt = Date.now();
    });
    joined.onLeave.once((code: number): void => {
      clientLeaveCode = code;
    });

    const sent: SentFrame[] = [];
    for (let index = 0; index < options.sendCount; index += 1) {
      if (options.stopOnSignal === true && signalsReceived > 0) break;
      if (clientLeaveCode !== null) break;
      Object.assign(handle.data, frame(index));
      sent.push({ seq: handle.send(), generation: index + 1, sentAt: Date.now() });
      await sleep(options.gapMs);
    }

    // Let the room run steps after the last send: a posture that acts on the next tick still acts.
    await sleep(options.settleMs);
    await until((): boolean => instance.ticks > 3, 2_000);

    const simulated = instance.simulated.slice();
    const drainedWithoutStep = instance.drainedWithoutStep.slice();
    const bufferedAtRead = instance.bufferedGenerations();
    const everBuffered = [...instance.seenBuffered].sort((a: number, b: number): number => a - b);

    const lastProcessed = handle.lastProcessed;
    const acked = sent.filter((entry: SentFrame): boolean => entry.seq <= lastProcessed).map((entry: SentFrame): number => entry.generation);
    const stepped = new Set<number>(simulated);
    const stillBuffered = new Set<number>(bufferedAtRead);
    const counters = instance.counters();
    const framesInsideWindow = instance.firstSignalAt === 0
      ? 0
      : sent.filter((entry: SentFrame): boolean => entry.sentAt >= instance.firstSignalAt && (signalReceivedAt === 0 || entry.sentAt < signalReceivedAt)).length;

    // Acknowledged but never stepped is the violation, measured against *every* sent frame: a frame the
    // room never even glimpsed in `peek()` still counts, which is why the set is taken from the send table
    // rather than from what the tick happened to observe.
    const acknowledgedWithoutStep = acked
      .filter((generation: number): boolean => !stepped.has(generation))
      .sort((a: number, b: number): number => a - b);
    const unackedUnrepresented = sent
      .filter((entry: SentFrame): boolean => entry.seq > lastProcessed)
      .map((entry: SentFrame): number => entry.generation)
      .filter((generation: number): boolean => !stepped.has(generation) && !stillBuffered.has(generation))
      .sort((a: number, b: number): number => a - b);

    return {
      label: options.label,
      policy: options.policy,
      sent: sent.map((entry: SentFrame): number => entry.generation),
      simulated,
      drainedWithoutStep,
      bufferedAtRead,
      everBuffered,
      ackedUnrepresented: acknowledgedWithoutStep,
      unackedUnrepresented,
      // The client's own view: which generations it can still replay after the watermark moved.
      replayableAfterSettle: sent
        .filter((entry: SentFrame): boolean => handle.at(entry.seq) !== undefined)
        .map((entry: SentFrame): number => entry.generation),
      maxBuffered: largest(instance.sizeSamples),
      bufferMaxSize: options.bufferMaxSize,
      ticks: instance.ticks,
      ackedCount: acked.length,
      clientLastProcessed: lastProcessed,
      clientSent: handle.sentCount,
      clientPending: handle.pendingCount,
      serverConsumedCount: counters.consumedCount,
      serverSize: counters.size,
      clearCalls: instance.clearCalls,
      consumedCountBeforeClear: instance.consumedCountBeforeClear,
      consumedCountAfterClear: instance.consumedCountAfterClear,
      throttleSignals: instance.throttleSignals,
      signalsReceived,
      framesSentInsideSignalWindow: framesInsideWindow,
      sanitizeCalls: instance.sanitizeCalls,
      sanitizedFramesStepped: instance.sanitizedAndStepped,
      disconnects: instance.disconnects.slice(),
      clientLeaveCode,
      error: null,
    };
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (leaveRoom !== undefined) {
      try {
        await leaveRoom();
      } catch {
        // The 'leave' and rate postures end the connection on purpose.
      }
    }
    if (server !== undefined) await server.close();
  }
}

async function main(): Promise<void> {
  const out = outputPath(process.argv.slice(2));
  await runProbe('PR-13', 'overflow postures: can a supported API prevent unrepresented retirement?', out, async (checks) => {
    const shared = { bufferMaxSize: 4, threshold: 3, tickRate: 20, settleMs: 400 };

    // N1 — the finding reproduced: with no posture, a backlog over the bound retires frames silently.
    const fast = { sendCount: 14, gapMs: 5 };
    const baseline = await run({ ...shared, ...fast, label: 'N1-none', policy: 'none' });
    checks.observe('N1_baseline', baseline);
    checks.check(
      'N1-no-posture-acknowledges-frames-the-room-never-stepped',
      baseline.error === null && baseline.ackedUnrepresented.length > 0,
      baseline.error === null
        ? `generations ${preview(baseline.ackedUnrepresented)} of ${String(baseline.ackedCount)} acknowledged frame(s) never entered a step; largest backlog ${String(baseline.maxBuffered)} of ${String(baseline.bufferMaxSize)}`
        : `scenario failed: ${baseline.error}`,
    );
    checks.check(
      'N1-the-library-bound-is-real',
      baseline.maxBuffered <= baseline.bufferMaxSize,
      `largest backlog observed ${String(baseline.maxBuffered)}, declared bound ${String(baseline.bufferMaxSize)} — buffering is bounded; the cost of enforcing it is silent retirement`,
    );

    // N2 — clear(): public, and the opposite of a remedy.
    const cleared = await run({ ...shared, ...fast, label: 'N2-clear', policy: 'clear' });
    checks.observe('N2_clear', cleared);
    checks.check(
      'N2-clear-runs-and-retires-every-buffered-frame',
      cleared.error === null && cleared.clearCalls > 0 && cleared.consumedCountAfterClear > cleared.consumedCountBeforeClear,
      cleared.error === null
        ? `clear() called ${String(cleared.clearCalls)} time(s); consumedCount ${String(cleared.consumedCountBeforeClear)} → ${String(cleared.consumedCountAfterClear)}; generations acked without a step: ${preview(cleared.ackedUnrepresented)}`
        : `scenario failed: ${cleared.error}`,
    );
    checks.check(
      'N2-clear-is-not-a-prevention-mechanism',
      cleared.ackedUnrepresented.length > 0,
      `clear() moves the same watermark an eviction moves, so it acknowledged ${String(cleared.ackedUnrepresented.length)} frame(s) no step ever represented`,
    );

    // N3 — disconnect the offender at a backlog threshold.
    const kicked = await run({ ...shared, ...fast, label: 'N3-leave', policy: 'leave' });
    checks.observe('N3_leave', kicked);
    checks.check(
      'N3-leave-ends-the-seat-and-freezes-the-watermark',
      kicked.error === null && kicked.disconnects.length > 0 && kicked.clientLastProcessed < kicked.clientSent,
      kicked.error === null
        ? `disconnects ${JSON.stringify(kicked.disconnects)}; the watermark stopped at ${String(kicked.clientLastProcessed)} of ${String(kicked.clientSent)} sent frames, so the acknowledgement never passed the end of the seat`
        : `scenario failed: ${kicked.error}`,
    );
    checks.check(
      'N3-the-sender-learns-by-losing-the-connection',
      kicked.clientLeaveCode !== null,
      `client onLeave code ${String(kicked.clientLeaveCode)} — the consequence is a close code, not an acknowledgement that would have lied`,
    );
    checks.check(
      'N3-frames-buffered-at-disconnect-are-neither-acked-nor-represented',
      kicked.unackedUnrepresented.length > 0 && kicked.clientPending > 0,
      `${String(kicked.unackedUnrepresented.length)} generation(s) ${preview(kicked.unackedUnrepresented)} were buffered when the seat ended; the client still holds ${String(kicked.clientPending)} pending frame(s) at watermark ${String(kicked.clientLastProcessed)} — the truthful residue a reconnection must resolve`,
    );
    checks.check(
      'N3-a-per-tick-threshold-acts-too-late-for-a-fast-sender',
      kicked.maxBuffered === kicked.bufferMaxSize && kicked.ackedUnrepresented.length > 0,
      `the backlog still reached ${String(kicked.maxBuffered)} of ${String(kicked.bufferMaxSize)} and ${String(kicked.ackedUnrepresented.length)} frame(s) were acknowledged without a step before the 20 Hz tick could act on a sender arriving every ${String(fast.gapMs)} ms: disconnecting on a threshold stops the watermark from lying *after* the disconnect, and does not keep the frames. Prevention has to be at admission or at the sender.`,
    );

    // N4 — the library's own sender ceiling.
    const rateLimited = await run({
      ...shared,
      label: 'N4-rate',
      policy: 'none',
      maxMessagesPerSecond: 40,
      sendCount: 60,
      gapMs: 5,
    });
    checks.observe('N4_rate', rateLimited);
    checks.check(
      'N4-room-maxMessagesPerSecond-disconnects-an-offending-sender',
      rateLimited.error === null && rateLimited.disconnects.length > 0,
      rateLimited.error === null
        ? `disconnects ${JSON.stringify(rateLimited.disconnects)} at a 40/s ceiling against a ~200/s sender; largest backlog ${String(rateLimited.maxBuffered)}`
        : `scenario failed: ${rateLimited.error}`,
    );
    checks.check(
      'N4-a-ceiling-above-the-consume-rate-still-lets-the-backlog-grow',
      rateLimited.ackedUnrepresented.length > 0,
      `${String(rateLimited.ackedUnrepresented.length)} generation(s) were still acknowledged without a step: a 40/s ceiling over a 1-frame-per-20 Hz-step room (20/s consumption) permits growth, so the ceiling must be set against the consume rate, not only against abuse`,
    );

    // N5 — declaring a sequence field: does it change what retirement means?
    const seqField = await run({ ...shared, ...fast, label: 'N5-seqfield', policy: 'seqfield' });
    checks.observe('N5_seqField', seqField);
    checks.check(
      'N5-seqField-does-not-prevent-unrepresented-retirement',
      seqField.error === null && seqField.ackedUnrepresented.length > 0 && seqField.clientLastProcessed <= seqField.clientSent,
      seqField.error === null
        ? `watermark ${String(seqField.clientLastProcessed)} against ${String(seqField.clientSent)} sent frames; still acknowledged without a step: ${preview(seqField.ackedUnrepresented)}`
        : `scenario failed: ${seqField.error}`,
    );

    // N6 — a cooperative sender: a bounded backlog without ending the connection.
    const signalled = await run({
      ...shared,
      label: 'N6-signal',
      policy: 'throttle',
      threshold: 2,
      sendCount: 40,
      gapMs: 25,
      stopOnSignal: true,
    });
    checks.observe('N6_signal', signalled);
    checks.check(
      'N6-server-signal-reaches-the-sender-through-public-messaging',
      signalled.error === null && signalled.throttleSignals > 0 && signalled.signalsReceived > 0,
      signalled.error === null
        ? `the room sent ${String(signalled.throttleSignals)} signal(s) via Room.send(); the sender received ${String(signalled.signalsReceived)}`
        : `scenario failed: ${signalled.error}`,
    );
    checks.check(
      'N6-no-frame-was-acknowledged-without-a-step-when-the-sender-obeyed',
      signalled.ackedUnrepresented.length === 0 && signalled.disconnects.length === 0,
      `largest backlog ${String(signalled.maxBuffered)} of bound ${String(signalled.bufferMaxSize)}, disconnects ${String(signalled.disconnects.length)}, acknowledged without a step ${String(signalled.ackedUnrepresented.length)}`,
    );
    checks.observe('N6_signalWindow', {
      framesSentInsideSignalWindow: signalled.framesSentInsideSignalWindow,
      headroom: signalled.bufferMaxSize - shared.threshold,
      note: 'frames already in flight when the room decided still arrive; the headroom between the threshold and the bound is what absorbs them',
    });
    checks.check(
      'N6-the-cooperative-posture-needs-a-sender-obligation-udg-does-not-have-yet',
      signalled.framesSentInsideSignalWindow <= signalled.bufferMaxSize - shared.threshold,
      `${String(signalled.framesSentInsideSignalWindow)} frame(s) were sent between the room's decision and the sender receiving it, absorbed by ${String(signalled.bufferMaxSize - shared.threshold)} slot(s) of headroom; a real client must be *required* to stop or coalesce on that signal, which is a protocol obligation and not library behaviour`,
    );

    // N7 — drain()-then-step-newest: the form the pinned declarations warn against, measured.
    const drained = await run({ ...shared, ...fast, label: 'N7-drain', policy: 'drain' });
    checks.observe('N7_drain', drained);
    checks.check(
      'N7-drain-retires-frames-the-server-never-simulated',
      drained.error === null && drained.drainedWithoutStep.length > 0 && drained.ackedUnrepresented.length > 0,
      drained.error === null
        ? `${String(drained.drainedWithoutStep.length)} generation(s) ${preview(drained.drainedWithoutStep)} were drained while only another frame's values were stepped, and ${String(drained.ackedUnrepresented.length)} acknowledged frame(s) in total never entered a step — the ack jumped past inputs the server never simulated, exactly as the declaration warns`
        : `scenario failed: ${drained.error}`,
    );
    checks.check(
      'N7-drain-then-apply-latest-is-rejected-as-a-remedy',
      drained.ackedUnrepresented.length > 0,
      'it removes the eviction and keeps the buffer bounded, but it buys that by acknowledging unrepresented frames, which is the prohibition itself — so it cannot be the answer',
    );

    // N8 — take(n): the bounded consume primitive, below and at the arrival-to-step ratio.
    const steady = { sendCount: 24, gapMs: 25 };
    const takeShort = await run({ ...shared, ...steady, label: 'N8-take1', policy: 'take', consumeBudget: 1 });
    const takeEnough = await run({ ...shared, ...steady, label: 'N8-take3', policy: 'take', consumeBudget: 3 });
    checks.observe('N8_takeBudgetOne', takeShort);
    checks.observe('N8_takeBudgetAboveRatio', takeEnough);
    checks.observe('N8_takeBudget', {
      arrivalFramesPerSecond: Math.round(1000 / steady.gapMs),
      stepRatePerSecond: shared.tickRate,
      budgetOne: { ackedUnrepresented: takeShort.ackedUnrepresented, maxBuffered: takeShort.maxBuffered, disconnects: takeShort.disconnects.length },
      budgetAboveRatio: { budget: 3, ackedUnrepresented: takeEnough.ackedUnrepresented, maxBuffered: takeEnough.maxBuffered, disconnects: takeEnough.disconnects.length },
      minimumBudget: Math.ceil(1000 / steady.gapMs / shared.tickRate),
      rule: 'consume at least ceil(arrivalRate / stepRate) frames per step; a smaller budget makes growth, and therefore eviction, unavoidable. The passing scenario uses a budget of 3 against a minimum of 2, so a late tick on a busy runner cannot turn the check green-to-red by jitter.',
    });
    checks.check(
      'N8-a-budget-below-the-arrival-to-step-ratio-still-overflows',
      takeShort.error === null && takeShort.ackedUnrepresented.length > 0,
      takeShort.error === null
        ? `budget 1 at 20 Hz against a 40/s sender: largest backlog ${String(takeShort.maxBuffered)} of ${String(takeShort.bufferMaxSize)}, acknowledged without a step ${preview(takeShort.ackedUnrepresented)}`
        : `scenario failed: ${takeShort.error}`,
    );
    checks.check(
      'N8-a-budget-at-or-above-the-arrival-to-step-ratio-retires-nothing',
      takeEnough.ackedUnrepresented.length === 0 && takeEnough.unackedUnrepresented.length === 0 && takeEnough.disconnects.length === 0,
      `budget 3 at 20 Hz (capacity 60/s) against the same 40/s sender: largest backlog ${String(takeEnough.maxBuffered)} of ${String(takeEnough.bufferMaxSize)}, simulated ${preview(takeEnough.simulated)} — every acknowledged frame entered a step, with no disconnect`,
    );

    // N9 — sanitize(): the only admission-time hook, and what it is allowed to do.
    const sanitised = await run({ ...shared, ...fast, label: 'N9-sanitize', policy: 'sanitize' });
    checks.observe('N9_sanitize', sanitised);
    checks.check(
      'N9-sanitize-runs-at-admission-and-can-only-rewrite',
      sanitised.error === null && sanitised.sanitizeCalls > 0 && sanitised.sanitizedFramesStepped > 0,
      sanitised.error === null
        ? `sanitize ran ${String(sanitised.sanitizeCalls)} time(s) and every frame was still buffered and stepped (neutralised values): ${String(sanitised.sanitizedFramesStepped)} frame(s) entered a step after rewriting. SanitizeInput is (input) => void: it can rewrite a frame in place, and has no way to refuse one.`
        : `scenario failed: ${sanitised.error}`,
    );
    checks.check(
      'N9-sanitize-does-not-reach-the-overflow-path',
      sanitised.ackedUnrepresented.length > 0,
      `${String(sanitised.ackedUnrepresented.length)} generation(s) were still acknowledged without a step: rewriting at admission does not stop a full buffer from dropping frames, so it is not the rejection lever either`,
    );

    // What the scenarios add up to.
    const prevented = takeEnough.ackedUnrepresented.length === 0
      && takeEnough.unackedUnrepresented.length === 0
      && takeEnough.disconnects.length === 0;
    checks.observe('mechanismVerdict', {
      question: 'is there a public, supported mechanism that keeps the buffer from retiring a frame the room never represented?',
      answer: prevented
        ? 'yes for a sender inside the admitted rate, by matching consumption to it with take(n); for a sender above the admitted rate, no — every lever measured only cuts the sender off, and frames are still acknowledged without a step before the cut'
        : 'not established by these scenarios',
      measuredSizingRule: {
        rule: 'consume take(n) frames per step with n >= ceil(admittedArrivalRate / stepRate); set bufferMaxSize above n plus jitter and signal round-trip headroom; set maxMessagesPerSecond <= n * stepRate so an offender is cut off rather than accommodated',
        evidencedBy: {
          budgetBelowRatioAckedWithoutStep: takeShort.ackedUnrepresented.length,
          budgetAtRatioAckedWithoutStep: takeEnough.ackedUnrepresented.length,
          ceilingAboveConsumeRateAckedWithoutStep: rateLimited.ackedUnrepresented.length,
          thresholdActsTooLateAckedWithoutStep: kicked.ackedUnrepresented.length,
          thresholdStillReachedTheBound: kicked.maxBuffered === kicked.bufferMaxSize,
        },
      },
      whatPreventsTheViolation: [
        'take(n) sized to the admitted arrival rate (N8): nothing is retired, every acknowledgement matches a step, no disconnect is needed, and the backlog peaked well inside the bound',
        'a server backlog signal plus a sender that is required to stop (N6): same outcome without a disconnect, but it holds only while the sender obeys, so it needs a protocol obligation and the headroom to absorb the round trip',
      ],
      whatOnlyCutsAnOffenderOff: [
        'Room.maxMessagesPerSecond (N4): the library disconnects a flooding sender by itself, yet frames were still acknowledged without a step before the cut, and a ceiling above the consume rate permits the growth in the first place',
        'a backlog threshold plus Client.leave(code) (N3): the watermark stops lying once the seat ends and the residue is explicitly unacknowledged, but a 20 Hz threshold cannot act before a 5 ms sender fills the buffer',
      ],
      whatDoesNotWork: [
        'InputAccessor.clear() (N2): it moves the same acknowledgement watermark an eviction moves',
        'defineInput(…, { seqField }) (N5): the acknowledgement stays a send-order watermark',
        'drain()-then-apply-latest (N7): it removes the eviction only by acknowledging frames the server never simulated — the declarations warn against it and N7 measures the warning',
        'sanitize() (N9): the only admission-time hook, it can rewrite a frame in place but cannot refuse one, and the overflow path still dropped frames',
        'any in-buffer mechanism: no InputAccessor or InputHandle member withholds, retracts or qualifies an acknowledgement (PR-8)',
      ],
      boundsProved: {
        declaredBound: baseline.bufferMaxSize,
        largestBacklogObserved: {
          none: baseline.maxBuffered,
          clear: cleared.maxBuffered,
          leave: kicked.maxBuffered,
          rate: rateLimited.maxBuffered,
          seqfield: seqField.maxBuffered,
          signal: signalled.maxBuffered,
          drain: drained.maxBuffered,
          'take-budget-1': takeShort.maxBuffered,
          'take-budget-3': takeEnough.maxBuffered,
          sanitize: sanitised.maxBuffered,
        },
        note: 'buffering stayed at or below the declared bound in every scenario; the question was never whether the buffer grows, but what becomes of what it drops',
      },
      accountingPerScenario: {
        none: { simulated: baseline.simulated, ackedUnrepresented: baseline.ackedUnrepresented, unackedUnrepresented: baseline.unackedUnrepresented },
        clear: { simulated: cleared.simulated, ackedUnrepresented: cleared.ackedUnrepresented, unackedUnrepresented: cleared.unackedUnrepresented },
        leave: { simulated: kicked.simulated, ackedUnrepresented: kicked.ackedUnrepresented, unackedUnrepresented: kicked.unackedUnrepresented },
        rate: { simulated: rateLimited.simulated, ackedUnrepresented: rateLimited.ackedUnrepresented, unackedUnrepresented: rateLimited.unackedUnrepresented },
        seqfield: { simulated: seqField.simulated, ackedUnrepresented: seqField.ackedUnrepresented, unackedUnrepresented: seqField.unackedUnrepresented },
        signal: { simulated: signalled.simulated, ackedUnrepresented: signalled.ackedUnrepresented, unackedUnrepresented: signalled.unackedUnrepresented },
        drain: { simulated: drained.simulated, drainedWithoutStep: drained.drainedWithoutStep, ackedUnrepresented: drained.ackedUnrepresented },
        takeBudgetOne: { simulated: takeShort.simulated, ackedUnrepresented: takeShort.ackedUnrepresented },
        takeBudgetAboveRatio: { simulated: takeEnough.simulated, ackedUnrepresented: takeEnough.ackedUnrepresented },
        sanitize: { simulated: sanitised.simulated, ackedUnrepresented: sanitised.ackedUnrepresented },
      },
      smallestArchitecturalDecision: [
        'one admitted input rate per session, and a per-step consume budget derived from it (take(n), n ≥ ceil(rate / stepRate)) — this is the change that actually prevents the violation',
        'bufferMaxSize derived from that budget plus jitter headroom, so a compliant sender cannot reach eviction and an overflowing buffer therefore means an offender',
        'one deterministic consequence for an offender — Room.maxMessagesPerSecond plus a reserved close code, or an explicit throttle signal the client is required to obey; either way the consequence must be recorded as "frames were sent that the server will never represent", because a cut-off still arrives after some frames have been acknowledged without a step (N3, N4). Choosing between them is the owner’s call.',
        'an explicit client state for that consequence: resynchronise from authoritative state, never replay the unacknowledged frames as though they had been represented',
      ],
      sdkProofVersusSpikeProof: {
        sdkProves: [
          'that a consume budget matched to the admitted rate leaves no frame both acknowledged and unrepresented, with buffering bounded, using public API only (N8)',
          'that clear(), seqField, sanitize() and drain()-then-apply-latest do not satisfy the prohibition (N2, N5, N9, N7)',
          'that a rate ceiling or a threshold disconnect stops the watermark from lying after the cut and leaves an explicitly unacknowledged residue — not that it prevents the earlier frames from being acknowledged without a step (N3, N4)',
        ],
        spikeMustStillProve: [
          'that a client which had been predicting from a cut-off session converges to authoritative state after reconnect — no part of this probe observes client reconciliation',
          'client behaviour under loss and reconnection, where pending frames outlive the seat (the unackedUnrepresented identities above) and must not be replayed as though acknowledged',
          'that the admitted rate and consume budget hold with real latency, jitter and multiple sessions, and that a modified client cannot exceed the admitted rate without the ceiling or the threshold reacting',
          'that the signal posture still holds when the round trip is large enough to eat the headroom (N6 measured a loopback window of 0 frames; a real window is nonzero)',
        ],
      },
    });

    checks.limit('PR-13 runs one room, one sender and loopback latency at a 20 Hz step; the thresholds and rates make eviction reachable inside a second rather than model a UDG region load profile.');
    checks.limit('The room records what it stepped, as in PR-8. That is the application-side model, not a Colyseus facility, and it proves what the server simulated — not what the client rendered.');
    checks.limit('The cooperative posture uses a probe sender that stops on the first signal, on loopback where the measured in-flight window is 0 frames; a real round trip consumes headroom.');
    checks.limit('take(n) is measured with n = 1 and n = 3 at 20 Hz against a 40/s sender. The sizing rule is extrapolated from those two points and the observed backlog, not measured across a rate sweep.');
    checks.limit('N3 and N4 each end the connection, so they measure the residue a cut-off leaves rather than a steady state; the disconnect is recorded twice per event because onLeave and onDrop both report it.');
    checks.limit('No dependency was changed, no unbounded queue was introduced, no private field was read and no acknowledgement was fabricated: each posture names its public declaration in the header.');
  });
}

await main();
