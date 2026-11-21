/**
 * UDG-SPIKE-001 slice 4 — the seat-side prediction POLICY, unit-tested against a deterministic
 * fake transport and clock.
 *
 * What this suite owns is the policy layer: the delivery guard (one verified pair, or nothing),
 * journal pruning by `inputResolvedThrough` ONLY, the refusal to let the SDK reconcile anything
 * the guard has not matched, the missing-advertised-rate refusal, and the ADR-0003 §3.2 recovery
 * path (stop sending → discard → hold → bounded rejoin → snapshot recovery, inside the rolling
 * allowance and episode deadline). The pinned SDK module is mocked at the same package-entry path
 * `seat-join-cleanup.test.ts` mocks, and the `Reconciler` replacement here is a RECORDER: it
 * counts the ticks it is given and never computes motion. That is deliberate — whether the real
 * SDK's reconcile reproduces the authority to <1e-6 m is proven in the browser slice against the
 * real module and the retained probe's ledgers, not re-derived here. The step RELATION's parity
 * with the authority's own `FlatReferenceStepper` is pinned below against the real server module.
 */

import { describe, expect, it, vi } from 'vitest';

const recorder = vi.hoisted((): { reconcilerBuilt: number; reconcilerTicks: number; replay: 'none' | 'single' | 'double' } => ({
  reconcilerBuilt: 0,
  reconcilerTicks: 0,
  // 'single' replays each pending frame once (the compliant SDK posture); 'double' replays each
  // twice — an induced fault the replay-identity ledger must catch. 'none' only adopts.
  replay: 'none' as 'none' | 'single' | 'double',
}));

// Same interception point as `seat-join-cleanup.test.ts`: the client package's pinned SDK entry.
vi.mock('../../../apps/client/node_modules/@colyseus/sdk/build/index.mjs', () => {
  class FakeReconciler {
    readonly state: { x: number; z: number };
    reconcileSeq = 0;
    private readonly instanceRef: { x: number; z: number };
    private readonly stepFn:
      ((ctx: { dt: number }, state: { x: number; z: number }, command: { moveX: number; moveZ: number }) => void) | null;
    private readonly input_: { lastProcessed: number; _staged?: Map<number, { moveX: number; moveZ: number }>; _dt?: number };
    private lastAck = 0;

    constructor(
      instance: { x: number; z: number },
      opts: {
        input: { lastProcessed: number; stepSeconds?: number };
        step?: (ctx: { dt: number }, state: { x: number; z: number }, command: { moveX: number; moveZ: number }) => void;
      },
    ) {
      recorder.reconcilerBuilt += 1;
      this.instanceRef = instance;
      // The raw prediction is a SEPARATE object, as in the pinned SDK: `local` starts as a copy of
      // the instance and the instance stays the authoritative-truth carrier the reconciler adopts
      // FROM at reconcile (`adoptTruth`), never at delivery time.
      this.state = { x: instance.x, z: instance.z };
      this.input_ = opts.input as { lastProcessed: number; _staged?: Map<number, { moveX: number; moveZ: number }>; _dt?: number };
      this.stepFn = opts.step ?? null;
      if (opts.input.stepSeconds === undefined) throw new Error('fake reconciler requires an advertised dt');
      // Eager predict-on-send, exactly as the pinned SDK observes the handle: every new send
      // steps the raw state ONCE through the adapter's own step closure — no second formula.
      const handle = opts.input as unknown as {
        onSend?: (listener: (seq: number) => void) => () => void;
        at?: (seq: number) => { moveX: number; moveZ: number } | undefined;
      };
      handle.onSend?.((seq) => {
        const command = handle.at?.(seq);
        if (command !== undefined && this.stepFn !== null) {
          this.stepFn({ dt: this.dt() }, this.state, command);
        }
      });
    }

    private dt(): number {
      return this.input_._dt ?? 0.05;
    }

    tick(): void {
      recorder.reconcilerTicks += 1;
      if (this.input_.lastProcessed !== this.lastAck) {
        this.lastAck = this.input_.lastProcessed;
        this.reconcileSeq += 1;
        // adoptTruth: copy the instance's mirrored fields — the delivery truth — at ADOPTION time
        // (the pinned SDK posture; deliveries never move the raw state directly), then replay the
        // PENDING frames — once, or twice when the fault is induced — through the same closure.
        this.state.x = this.instanceRef.x;
        this.state.z = this.instanceRef.z;
        const staged = this.input_._staged;
        if (staged !== undefined && recorder.replay !== 'none') {
          const times = recorder.replay === 'double' ? 2 : 1;
          for (const [seq, frame] of [...staged.entries()].sort((a, b) => a[0] - b[0])) {
            if (seq <= this.lastAck) continue;
            for (let step = 0; step < times; step += 1) {
              if (this.stepFn !== null) this.stepFn({ dt: this.dt() }, this.state, frame);
            }
          }
        }
      }
    }

    value(field: 'x' | 'z'): number {
      return this.state[field];
    }
  }
  return { Client: class {}, Reconciler: FakeReconciler };
});

const { evaluateDeliveryGuard, flatDirectStep, DirectMotionPredictor } = await import(
  '../../../apps/client/src/network/ColyseusPredictionAdapter.js'
);
const { flatDirectStep: flatStepFromKernelModule } = await import(
  '../../../apps/client/src/network/flatStep.js'
);

// The predictor parameter types are satisfied STRUCTURALLY by the fakes below; the casts live
// here, in the test, never in first-party code.
type TransportArg = ConstructorParameters<typeof DirectMotionPredictor>[0];
type ClockArg = NonNullable<ConstructorParameters<typeof DirectMotionPredictor>[1]['clock']>;
const toTransport = (fake: unknown): TransportArg => fake as TransportArg;
const toClock = (clock: unknown): ClockArg => clock as ClockArg;

// ───────────────────────────────────────────────────────────── deterministic fakes

interface FakeClock {
  now: number;
  armed: { at: number; run: () => void }[];
  nowMs(): number;
  setTimer(run: () => void, ms: number): { cancel(): void };
  advance(ms: number): void;
}

const createFakeClock = (): FakeClock => {
  const clock: FakeClock = {
    now: 1000,
    armed: [],
    nowMs: () => clock.now,
    setTimer: (run, ms) => {
      const entry = { at: clock.now + ms, run };
      clock.armed.push(entry);
      return {
        cancel: () => {
          const at = clock.armed.indexOf(entry);
          if (at >= 0) clock.armed.splice(at, 1);
        },
      };
    },
    advance: (ms) => {
      const target = clock.now + ms;
      for (;;) {
        const due = clock.armed.filter((entry) => entry.at <= target).sort((a, b) => a.at - b.at)[0];
        if (due === undefined) break;
        clock.armed.splice(clock.armed.indexOf(due), 1);
        clock.now = due.at;
        due.run();
      }
      clock.now = target;
    },
  };
  return clock;
};

/** Let queued microtasks (the rejoin route's promise chain) run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function createFakeTransport(epoch: number) {
  const listeners = new Set<() => void>();
  const sendListeners: ((seq: number) => void)[] = [];
  const buffer = new Map<number, { generation: number; directIntent: boolean; moveX: number; moveZ: number }>();
  let sentCount = 0;
  // The row is INVISIBLE until the first patch: a joined seat has no delivery before the first
  // state change, and the guard must say so rather than read the zeros as a snapshot.
  let visible = false;
  const row = {
    epoch,
    lastAuthorityTick: 0,
    x: 0,
    y: 0,
    z: 0,
    inputResolvedThrough: 0,
    inputGapStart: 0,
    inputGapEnd: 0,
    inputRetiredUnrepresented: 0,
  };
  const instance = { x: 0, z: 0 };
  const hdl = {
    data: { sessionEpoch: epoch, generation: 0, directIntent: false, moveX: 0, moveZ: 0, seq: 0 },
    send: (): number => {
      sentCount += 1;
      buffer.set(sentCount, {
        generation: hdl.data.generation,
        directIntent: hdl.data.directIntent,
        moveX: hdl.data.moveX,
        moveZ: hdl.data.moveZ,
      });
      for (const listener of [...sendListeners]) listener(sentCount);
      return sentCount;
    },
    onSend: (listener: (seq: number) => void): (() => void) => {
      sendListeners.push(listener);
      return () => {
        const at = sendListeners.indexOf(listener);
        if (at >= 0) sendListeners.splice(at, 1);
      };
    },
    at: (seq: number) => buffer.get(seq),
    get sentCount(): number {
      return sentCount;
    },
    lastProcessed: 0,
    // Pending-frame view for the recorder-mode FakeReconciler: exactly what a real SDK handle
    // keeps staged for replay, exposed so the fake can replay it faithfully.
    _staged: buffer,
    _dt: 0.05,
    tickRate: 20 as number | undefined,
    stepMs: 50 as number | undefined,
    patchRate: 100 as number | undefined,
    stepSeconds: 0.05 as number | undefined,
  };
  let closed = false;
  return {
    row,
    instance,
    hdl,
    handle: () => hdl,
    issuedEpoch: () => epoch,
    readRow: () => (visible ? { ...row } : null),
    rowInstance: () => instance as object,
    readState: () => null,
    subscribe: (onPatch: () => void) => {
      listeners.add(onPatch);
      return () => {
        listeners.delete(onPatch);
      };
    },
    advertised: () => ({ tickRate: hdl.tickRate, stepMs: hdl.stepMs, patchRate: hdl.patchRate, stepSeconds: hdl.stepSeconds }),
    rearm: () => undefined,
    close: async () => {
      closed = true;
    },
    closed: () => closed,
    /** Deliver one state change; `ackTo` moves the SDK watermark exactly as a state message does. */
    patch: (changes: Partial<typeof row> & { ackTo?: number } = {}) => {
      Object.assign(row, changes);
      if (changes.ackTo !== undefined) hdl.lastProcessed = changes.ackTo;
      Object.assign(instance, { x: row.x, z: row.z });
      visible = true;
      for (const listener of [...listeners]) listener();
    },
  };
}

// ───────────────────────────────────────────────────────────── guard

describe('UDG-SPIKE-001 — the delivery guard accepts one matched pair and names every refusal', () => {
  const base = {
    row: {
      epoch: 7,
      lastAuthorityTick: 3,
      x: 1,
      y: 0,
      z: 2,
      inputResolvedThrough: 5,
      inputGapStart: 0,
      inputGapEnd: 0,
      inputRetiredUnrepresented: 0,
    },
    ack: 5,
    sentCount: 8,
    revision: 1,
    atMs: 10,
  };
  const ctx = { issuedEpoch: 7, lastRevision: 0 };

  it('accepts a matched, same-delivery pair and freezes it', () => {
    const outcome = evaluateDeliveryGuard(base, ctx);
    expect(outcome.ok).toBe(true);
    expect(outcome.reason).toBe('accepted');
    const delivery = outcome.delivery;
    expect(delivery).not.toBeNull();
    expect(Object.isFrozen(delivery)).toBe(true);
    expect(delivery?.ack).toBe(delivery?.resolvedThrough);
  });

  it('names a missing row instead of inventing one', () => {
    expect(evaluateDeliveryGuard({ ...base, row: null }, ctx).reason).toBe('no-row');
  });

  it('names a field outside its domain', () => {
    const bad = { ...base, row: { ...base.row, x: Number.NaN } };
    expect(evaluateDeliveryGuard(bad, ctx).reason).toBe('row-field');
  });

  it('refuses a row that is not on the seat-issued epoch', () => {
    const other = { ...base, row: { ...base.row, epoch: 9 } };
    expect(evaluateDeliveryGuard(other, ctx).reason).toBe('epoch-mismatch');
  });

  it('refuses a revision that is not newer than the last one seen', () => {
    expect(evaluateDeliveryGuard({ ...base, revision: 4 }, { ...ctx, lastRevision: 4 }).reason).toBe('stale-revision');
  });

  it('treats retirement and a named gap as recovery dispositions, not timing noise', () => {
    expect(evaluateDeliveryGuard({ ...base, row: { ...base.row, inputRetiredUnrepresented: 1 } }, ctx).reason).toBe('retirement-nonzero');
    expect(evaluateDeliveryGuard({ ...base, row: { ...base.row, inputGapStart: 4, inputGapEnd: 6 } }, ctx).reason).toBe('gap-named');
  });

  it('separates the two unequal boundary directions — neither may reconcile', () => {
    expect(evaluateDeliveryGuard({ ...base, ack: 6 }, ctx).reason).toBe('ack-ahead-of-resolution');
    expect(evaluateDeliveryGuard({ ...base, ack: 4 }, ctx).reason).toBe('ack-behind-resolution');
    // Both carry the delivery for the ledger, but neither is ok.
    expect(evaluateDeliveryGuard({ ...base, ack: 6 }, ctx).delivery).not.toBeNull();
    expect(evaluateDeliveryGuard({ ...base, ack: 6 }, ctx).ok).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────── journal + tick gating

describe('UDG-SPIKE-001 — the journal prunes by resolution only, and the SDK reconciles only verified pairs', () => {
  const build = () => {
    const clock = createFakeClock();
    const fake = createFakeTransport(7);
    const predictor = new DirectMotionPredictor(toTransport(fake), { speed: 4, clock: toClock(clock) });
    predictor.attach();
    return { clock, fake, predictor };
  };

  it('nothing predicts and nothing reconciles before the first verified delivery', () => {
    const builtBefore = recorder.reconcilerBuilt;
    const { fake, predictor } = build();
    predictor.tick(1000);
    expect(predictor.tickLedger()[0]?.action).toBe('dormant');
    expect(recorder.reconcilerBuilt, 'no reconciler exists before a verified delivery').toBe(builtBefore);
    expect(() => predictor.send({ generation: 1, moveX: 0, moveZ: 1 }, true)).toThrow(/snapshot/);
    // The SDK's own subscription cannot reconcile what the guard never verified: zero ticks.
    expect(recorder.reconcilerTicks, 'the SDK is never even asked').toBe(0);
    fake.patch({ lastAuthorityTick: 1 });
    expect(predictor.stateName()).toBe('tracking');
  });

  it('an unequal boundary never reaches the reconciler; a matched pair reconciles once per frame tick', () => {
    const { fake, predictor } = build();
    const ticksBefore = recorder.reconcilerTicks;
    const builtBefore = recorder.reconcilerBuilt;
    fake.patch({ lastAuthorityTick: 1 });
    predictor.tick(1000);
    expect(predictor.tickLedger().at(-1)?.action).toBe('reconciled');
    expect(recorder.reconcilerBuilt - builtBefore).toBe(1);

    predictor.send({ generation: 1, moveX: 1, moveZ: 0 }, true);
    predictor.send({ generation: 2, moveX: 1, moveZ: 0 }, true);
    predictor.send({ generation: 3, moveX: 1, moveZ: 0 }, true);
    expect(predictor.pendingJournal().map((entry) => entry.seq)).toEqual([1, 2, 3]);

    fake.patch({ lastAuthorityTick: 2, z: 4, inputResolvedThrough: 2, ackTo: 2 });
    predictor.tick(1100);
    const ticksAt2 = recorder.reconcilerTicks;
    expect(ticksAt2 - ticksBefore, 'matched pair ticked once').toBe(2);

    fake.patch({ lastAuthorityTick: 3, z: 5, inputResolvedThrough: 5, ackTo: 4 }); // ack BEHIND resolution
    predictor.tick(1200);
    expect(recorder.reconcilerTicks, 'the reconciler is not ticked against an unverified pair').toBe(ticksAt2);
    expect(predictor.tickLedger().at(-1)?.action).toBe('skipped');
    expect(predictor.tickLedger().at(-1)?.reason).toBe('ack-behind-resolution');

    // Resolution catches up: verified again, and exactly ONE reconcile covers the whole pending
    // window — never one per intermediate delivery, because the frame tick drives it.
    fake.patch({ lastAuthorityTick: 4, z: 6, inputResolvedThrough: 6, ackTo: 6 });
    predictor.tick(1300);
    expect(recorder.reconcilerTicks - ticksAt2, 'one tick, one reconcile of the matched pair').toBe(1);
    expect(predictor.pendingJournal().length).toBe(0);
  });

  it('several verified patches between two frames still reconcile exactly once', () => {
    const { fake, predictor } = build();
    fake.patch({ lastAuthorityTick: 1 });
    predictor.tick(1000);
    predictor.send({ generation: 1, moveX: 1, moveZ: 0 }, true);
    const ticksBefore = recorder.reconcilerTicks;
    for (let tickNo = 2; tickNo <= 6; tickNo += 1) {
      fake.patch({ lastAuthorityTick: tickNo, inputResolvedThrough: tickNo - 1, ackTo: tickNo - 1, z: tickNo });
    }
    expect(predictor.deliveryLedger().filter((entry) => entry.accepted).length).toBe(6);
    predictor.tick(2000);
    expect(recorder.reconcilerTicks - ticksBefore, 'five patches, one reconcile').toBe(1);
  });

  it('prunes by inputResolvedThrough ONLY; the SDK ack advancing further prunes nothing', () => {
    const { fake, predictor } = build();
    fake.patch({ lastAuthorityTick: 1 });
    predictor.send({ generation: 1, moveX: 0, moveZ: 1 }, true);
    predictor.send({ generation: 2, moveX: 0, moveZ: 1 }, true);
    predictor.send({ generation: 3, moveX: 0, moveZ: 1 }, true);
    // A verified delivery whose resolution covers seq 1..2.
    fake.patch({ lastAuthorityTick: 2, inputResolvedThrough: 2, ackTo: 2 });
    expect(predictor.pendingJournal().map((entry) => entry.seq)).toEqual([3]);
    const ledger = predictor.pruneAuthorityLedger();
    expect(ledger.byResolvedThrough).toBe(2);
    expect(ledger.byAckWatermark, 'the ack watermark is telemetry, never a pruning authority').toBe(0);

    // The watermark races ahead WITHOUT the resolution record: the pair is unequal, nothing
    // prunes, nothing reconciles. This is the ADR-0003 misuse caught as a negative control.
    fake.hdl.lastProcessed = 3;
    fake.patch({ lastAuthorityTick: 3 });
    expect(predictor.pendingJournal().map((entry) => entry.seq)).toEqual([3]);
    expect(predictor.pruneAuthorityLedger().byResolvedThrough).toBe(2);
    expect(predictor.tickLedger().at(-1)).toBeUndefined(); // no tick ran yet against it
    predictor.tick(1400);
    expect(predictor.tickLedger().at(-1)?.action).toBe('dormant');
    expect(predictor.tickLedger().at(-1)?.reason, 'the frame tick refuses the unequal pair by name').toBe('ack-ahead-of-resolution');
  });

  it('refuses to predict when the room advertised no fixed rate', () => {
    const clock = createFakeClock();
    const fake = createFakeTransport(7);
    fake.hdl.tickRate = undefined;
    fake.hdl.stepMs = undefined;
    fake.hdl.stepSeconds = undefined;
    const builtBefore = recorder.reconcilerBuilt;
    const predictor = new DirectMotionPredictor(toTransport(fake), { speed: 4, clock: toClock(clock) });
    predictor.attach();
    fake.patch({ lastAuthorityTick: 1 });
    predictor.tick(1000);
    expect(predictor.tickLedger().at(-1)?.reason).toBe('missing-advertised-rate');
    expect(recorder.reconcilerBuilt, 'no advertised dt, no reconciler is ever constructed').toBe(builtBefore);
  });
});

// ───────────────────────────────────────────────────────────── recovery

describe('UDG-SPIKE-001 — ADR-0003 §3.2 recovery: stop, discard, hold, bounded rejoin, snapshot first', () => {
  const buildRecoverable = (overrides: Record<string, unknown> = {}) => {
    const clock = createFakeClock();
    const fake = createFakeTransport(7);
    const next = createFakeTransport(8);
    const rejoin = vi.fn(async () => toTransport(next));
    const predictor = new DirectMotionPredictor(toTransport(fake), {
      speed: 4,
      clock: toClock(clock),
      rejoin,
      snapshotDeadlineMs: 500,
      recoveryDeadlineMs: 4000,
      rejoinWindowMs: 60_000,
      maxRejoinsPerWindow: 2,
      rejoinBackoffMs: [250, 500, 1000],
      ...overrides,
    });
    predictor.attach();
    fake.patch({ lastAuthorityTick: 1, z: 1.5 });
    return { clock, fake, next, predictor, rejoin };
  };

  it('retirement stops sending, discards the journal, holds the last authoritative pose, and rejoins on the ladder', async () => {
    const { clock, fake, next, predictor } = buildRecoverable();
    predictor.send({ generation: 1, moveX: 0, moveZ: 1 }, true);
    expect(predictor.pendingJournal().length).toBe(1);

    fake.patch({ lastAuthorityTick: 2, inputRetiredUnrepresented: 1 });
    expect(predictor.stateName()).toBe('recovering');
    expect(() => predictor.send({ generation: 2, moveX: 0, moveZ: 1 }, true)).toThrow(/recovery/);
    expect(predictor.pendingJournal().length, 'pending prediction is discarded, not carried').toBe(0);
    expect(predictor.heldSnapshot()).toEqual({ x: 0, z: 1.5 });

    const events = predictor.recoveryLedger().map((entry) => entry.event);
    const wanted = ['trigger', 'stop-sending', 'discard-pending', 'rejoin-scheduled'] as const;
    const firstOf = wanted.map((event) => events.indexOf(event));
    expect(firstOf.every((index) => index >= 0), 'every §3.2 step is recorded').toBe(true);
    expect(firstOf, 'and in order').toEqual([...firstOf].sort((a, b) => a - b));

    // The ladder: the first attempt waits 250 ms of the injected clock, and actual rejoins are
    // what the rolling allowance counts.
    expect(predictor.rejoinTimestamps().length).toBe(0);
    clock.advance(250);
    await flush();
    expect(predictor.rejoinTimestamps().length).toBe(1);

    // The new domain: input stays stopped until a VERIFIED snapshot arrives on the new epoch.
    expect(() => predictor.send({ generation: 2, moveX: 0, moveZ: 1 }, true)).toThrow(/recovery|snapshot/);
    next.patch({ lastAuthorityTick: 1, z: 1.5 });
    expect(predictor.stateName()).toBe('tracking');
    expect(predictor.recoveryLedger().at(-1)?.event).toBe('snapshot-recovered');
    const frame = predictor.send({ generation: 2, moveX: 0, moveZ: 1 }, true);
    expect(frame.seq, 'seq restarts with the new handle; no old identity is reissued').toBe(1);
    expect(frame.generation, 'the protocol generation continues across the epoch change').toBe(2);
    expect(predictor.recoveryLedger().filter((entry) => entry.event === 'discard-pending').length).toBe(1);
    expect(predictor.recoveryLedger().filter((entry) => entry.event === 'rejoin-attempt').length).toBe(1);
  });

  it('a snapshot that never arrives walks the ladder and suspends at the rolling allowance, holding the pose', async () => {
    const { clock, fake, predictor } = buildRecoverable();
    fake.patch({ lastAuthorityTick: 2, inputRetiredUnrepresented: 1 });
    // attempt 1 at +250; no snapshot arrives; deadline (+500 after the attempt) schedules attempt 2.
    clock.advance(250);
    await flush();
    expect(predictor.rejoinTimestamps().length).toBe(1);
    clock.advance(500 + 500);
    await flush();
    expect(predictor.rejoinTimestamps().length, 'the second bounded rejoin happens inside the window').toBe(2);
    // deadline again -> a third would exceed the rolling allowance -> suspension, still holding.
    clock.advance(500 + 1000);
    await flush();
    expect(predictor.stateName()).toBe('suspended');
    const suspension = predictor.recoveryLedger().filter((entry) => entry.event === 'suspended').at(-1);
    expect(suspension?.detail).toMatch(/rolling-window/);
    expect(predictor.rejoinTimestamps().length, 'the allowance is never exceeded').toBe(2);
    expect(() => predictor.send({ generation: 2, moveX: 0, moveZ: 1 }, true)).toThrow(/recovery/);
    expect(predictor.heldSnapshot(), 'suspended means holding the last verified pose, not drifting').toEqual({ x: 0, z: 1.5 });
  });

  it('the recovery episode deadline bounds the whole episode', async () => {
    const { clock, fake, predictor } = buildRecoverable({ maxRejoinsPerWindow: 99, recoveryDeadlineMs: 1000 });
    fake.patch({ lastAuthorityTick: 2, inputRetiredUnrepresented: 1 });
    // Step the clock in bounded increments, flushing the rejoin route's promise chain between
    // them: the ladder is timer-then-promise, and a single giant advance would outrun it.
    clock.advance(250);
    await flush();
    clock.advance(600);
    await flush();
    clock.advance(500);
    await flush();
    const events = predictor.recoveryLedger().map((entry) => entry.event);
    expect(events).toContain('episode-expired');
    expect(predictor.stateName()).toBe('suspended');
    expect(predictor.rejoinTimestamps().length, 'at most one attempt before the episode bound trips').toBeLessThanOrEqual(2);
  });

  it('§3.2 hard deadline: a rejoin route that NEVER settles still expires the episode on its OWN timer, surfaces the error, and refuses the late join', async () => {
    // THE watchdog control (director: S1b is a real §3.2/GA-6c failure). The rejoin route hangs
    // exactly like a join whose handshake is withheld: its promise never settles, no future
    // state event arrives. The per-episode hard deadline is an INDEPENDENT timer — it must not
    // be gated by `await rejoin()` returning or by any later event.
    const { clock, fake, predictor, rejoin } = buildRecoverable();
    const late = createFakeTransport(9);
    const joinGate: { resolve: ((t: TransportArg) => void) | null } = { resolve: null };
    rejoin.mockImplementationOnce(() => new Promise<TransportArg>((resolve) => { joinGate.resolve = resolve; }));

    fake.patch({ lastAuthorityTick: 2, inputRetiredUnrepresented: 1 }); // trigger at t0
    clock.advance(250);
    await flush();
    expect(rejoin.mock.calls.length, 'the first bounded attempt left').toBe(1);
    expect(predictor.stateName()).toBe('recovering');

    // Budget exactness: the episode is 4000 ms from its START — not expired one tick early.
    clock.advance(3_999 - 250);
    await flush();
    expect(predictor.recoveryEpisodeExpiredFlag(), '3999 ms of a 4000 ms episode: not yet').toBe(false);
    expect(predictor.stateName()).toBe('recovering');

    clock.advance(1);
    await flush();
    expect(predictor.recoveryEpisodeExpiredFlag(), 'the independent timer expires the episode at the deadline even though the join never settled').toBe(true);
    expect(predictor.stateName()).toBe('suspended');
    expect(predictor.suspensionReason?.()).toBe('episode-deadline');
    const surfaced = predictor.connectionError?.();
    expect(surfaced?.code, '§3.2: expiry SURFACES a connection error, not silence').toBe('recovery-episode-expired');
    expect(() => predictor.send({ generation: 2, moveX: 0, moveZ: 1 }, true)).toThrow(/recovery/);
    expect(predictor.heldSnapshot(), 'expired means stopped AND holding — no resume race').toEqual({ x: 0, z: 1.5 });
    expect(predictor.rejoinTimestamps().length, 'no further rejoin in the expired episode').toBe(1);

    // The hung join settles LATE (the withheld handshake finally lands): the attempt is
    // quarantined — its room is closed, nothing is adopted, the seat stays stopped.
    (joinGate.resolve as (t: TransportArg) => void)(toTransport(late));
    await flush();
    expect(late.closed(), 'the late-returned room is closed, never adopted').toBe(true);
    expect(predictor.stateName()).toBe('suspended');
    expect(predictor.snapshotReadyForInput()).toBe(false);
    expect(rejoin.mock.calls.length, 'the late settle schedules no new attempt').toBe(1);
    const events = predictor.recoveryLedger().map((entry) => entry.event);
    expect(events.filter((event) => event === 'episode-expired').length, 'expiry is recorded exactly once').toBe(1);
  });

  it('rolling-window suspension stays DISTINCT from episode expiry: no connection error is invented for it', async () => {
    const { clock, fake, predictor } = buildRecoverable();
    fake.patch({ lastAuthorityTick: 2, inputRetiredUnrepresented: 1 });
    clock.advance(250);
    await flush();
    clock.advance(500 + 500);
    await flush();
    clock.advance(500 + 1000);
    await flush();
    expect(predictor.stateName()).toBe('suspended');
    expect(predictor.suspensionReason?.(), 'the rolling allowance spent the attempts first').toBe('rolling-window');
    expect(predictor.recoveryEpisodeExpiredFlag(), 'the rolling suspension is NOT an episode expiry').toBe(false);
    // Cross the episode deadline while already rolling-suspended: semantics stay distinct —
    // no second reason, no connection error, no new attempt.
    clock.advance(2_000);
    await flush();
    expect(predictor.recoveryEpisodeExpiredFlag(), 'the independent timer no-ops once the rolling limit won (whichever limit first)').toBe(false);
    expect(predictor.connectionError?.() ?? null, 'no connection error belongs to the rolling branch').toBeNull();
    expect(predictor.suspensionReason?.()).toBe('rolling-window');
  });

  it('an outstanding input with no delivery at all trips the client-local deadline', () => {
    const { clock, fake, predictor } = buildRecoverable();
    fake.patch({ lastAuthorityTick: 2 });
    predictor.send({ generation: 1, moveX: 1, moveZ: 0 }, true);
    clock.advance(499);
    expect(predictor.stateName()).toBe('tracking');
    clock.advance(2);
    expect(predictor.stateName()).toBe('recovering');
    const trigger = predictor.recoveryLedger().find((entry) => entry.event === 'trigger');
    expect(trigger?.detail).toMatch(/snapshot-deadline-expired/);
  });

  it('a named gap on a delivery triggers the same path without waiting for any deadline', () => {
    const { fake, predictor } = buildRecoverable();
    fake.patch({ lastAuthorityTick: 2, inputGapStart: 4, inputGapEnd: 6 });
    expect(predictor.stateName()).toBe('recovering');
    const trigger = predictor.recoveryLedger().find((entry) => entry.event === 'trigger');
    expect(trigger?.detail).toMatch(/gap-named/);
  });
});

// ────────────────────────────── domain quarantine: late old-room deliveries cannot end recovery

describe('UDG-SPIKE-001 — recovery quarantines the old domain (review P1)', () => {
  const buildRecoverable = () => {
    const clock = createFakeClock();
    const fake = createFakeTransport(7);
    const next = createFakeTransport(8);
    const rejoin = vi.fn(async () => toTransport(next));
    const predictor = new DirectMotionPredictor(toTransport(fake), {
      speed: 4,
      clock: toClock(clock),
      rejoin,
      snapshotDeadlineMs: 500,
      recoveryDeadlineMs: 4000,
      rejoinWindowMs: 60_000,
      maxRejoinsPerWindow: 2,
      rejoinBackoffMs: [250, 500, 1000],
    });
    predictor.attach();
    fake.patch({ lastAuthorityTick: 1, z: 1.5 });
    return { clock, fake, next, predictor, rejoin };
  };

  it('a late VALID delivery from the quarantined domain holds instead of completing recovery', async () => {
    const { clock, fake, next, predictor } = buildRecoverable();
    predictor.send({ generation: 1, moveX: 0, moveZ: 1 }, true);
    fake.patch({ lastAuthorityTick: 2, inputRetiredUnrepresented: 1 });
    expect(predictor.stateName()).toBe('recovering');
    const deliveriesBefore = predictor.deliveryLedger().length;

    // A late, entirely VALID old-domain delivery arrives anyway (clean disposition, matched ack).
    fake.patch({ lastAuthorityTick: 3, z: 1.7, inputResolvedThrough: 1, ackTo: 1, inputRetiredUnrepresented: 0 });

    // THE defect this test pins (red-before): the old code let this delivery complete recovery.
    expect(predictor.stateName(), 'recovery completes only through the replacement domain').toBe('recovering');
    // The old transport is unsubscribed AND closed at the trigger — its handle is isolated.
    expect(fake.closed(), 'the quarantined transport is closed at the trigger').toBe(true);
    expect(() => predictor.send({ generation: 2, moveX: 0, moveZ: 1 }, true)).toThrow(/recovery/);
    expect(predictor.heldSnapshot(), 'the held pose is the pre-trigger truth, not the late row').toEqual({ x: 0, z: 1.5 });
    expect(predictor.deliveryLedger().length, 'the quarantined delivery is never even evaluated').toBe(deliveriesBefore);
    expect(predictor.recoveryLedger().filter((entry) => entry.event === 'snapshot-recovered').length).toBe(0);

    // The ladder was never cancelled: the first bounded attempt still runs, and the NEW epoch
    // — and only it — completes the recovery.
    clock.advance(250);
    await flush();
    expect(predictor.rejoinTimestamps().length).toBe(1);
    next.patch({ lastAuthorityTick: 1, z: 1.5 });
    expect(predictor.stateName()).toBe('tracking');
    expect(predictor.recoveryLedger().at(-1)?.event).toBe('snapshot-recovered');
  });

  it('a rejoin that resolves after the seat closed is refused and its transport discarded', async () => {
    const clock = createFakeClock();
    const fake = createFakeTransport(7);
    const next = createFakeTransport(8);
    let release: (value: TransportArg) => void = () => undefined;
    const predictor = new DirectMotionPredictor(toTransport(fake), {
      speed: 4,
      clock: toClock(clock),
      rejoin: () => new Promise<TransportArg>((resolve) => {
        release = resolve;
      }),
    });
    predictor.attach();
    fake.patch({ lastAuthorityTick: 1, z: 1.5 });
    fake.patch({ lastAuthorityTick: 2, inputRetiredUnrepresented: 1 });
    clock.advance(250);
    await flush();
    expect(predictor.rejoinTimestamps().length, 'the attempt is in flight').toBe(1);

    await predictor.close(); // the seat closes while the join promise is still settling
    release(toTransport(next));
    await flush();
    await flush();

    expect(next.closed(), 'the abandoned rejoin installed nothing; its transport was closed').toBe(true);
    expect(predictor.stateName()).toBe('closed');
    const events = predictor.recoveryLedger();
    expect(events.some((entry) => entry.event === 'rejoin-complete'), 'no install happened').toBe(false);
    expect(events.some((entry) => entry.detail.includes('abandoned rejoin result'))).toBe(true);
  });

  it('an episode deadline crossing while an attempt is in flight suspends and refuses a late success', async () => {
    const clock = createFakeClock();
    const fake = createFakeTransport(7);
    const next = createFakeTransport(8);
    let release: (value: TransportArg) => void = () => undefined;
    const predictor = new DirectMotionPredictor(toTransport(fake), {
      speed: 4,
      clock: toClock(clock),
      recoveryDeadlineMs: 1000,
      rejoin: () => new Promise<TransportArg>((resolve) => {
        release = resolve;
      }),
    });
    predictor.attach();
    fake.patch({ lastAuthorityTick: 1, z: 1.5 });
    fake.patch({ lastAuthorityTick: 2, inputRetiredUnrepresented: 1 });
    clock.advance(250);
    await flush();
    clock.advance(1000); // the episode elapsed while the attempt was in flight
    release(toTransport(next));
    await flush();
    await flush();

    expect(next.closed(), 'a success after the episode is abandoned, transport closed').toBe(true);
    expect(predictor.stateName()).toBe('suspended');
    const events = predictor.recoveryLedger();
    expect(events.some((entry) => entry.event === 'episode-expired')).toBe(true);
    expect(events.some((entry) => entry.event === 'rejoin-complete'), 'the late success was not installed').toBe(false);
  });

  it('an ordinary rejoin error takes the next ladder step; only budget or episode exhaustion suspends', async () => {
    const clock = createFakeClock();
    const fake = createFakeTransport(7);
    const second = createFakeTransport(9);
    let calls = 0;
    const predictor = new DirectMotionPredictor(toTransport(fake), {
      speed: 4,
      clock: toClock(clock),
      rejoin: async () => {
        calls += 1;
        if (calls === 1) throw new Error('join refused: seat is closing');
        return toTransport(second);
      },
    });
    predictor.attach();
    fake.patch({ lastAuthorityTick: 1, z: 1.5 });
    fake.patch({ lastAuthorityTick: 2, inputRetiredUnrepresented: 1 });
    clock.advance(250);
    await flush();
    const afterFailure = predictor.recoveryLedger().map((entry) => entry.event);
    expect(afterFailure, 'one failed route does NOT suspend: ADR retry semantics').not.toContain('suspended');
    expect(predictor.recoveryLedger().some((entry) => entry.detail.includes('rejoin route failed'))).toBe(true);
    expect(predictor.stateName()).toBe('recovering');

    clock.advance(500); // the ladder's next bounded step
    await flush();
    expect(predictor.rejoinTimestamps().length).toBe(2);
    second.patch({ lastAuthorityTick: 1, z: 1.5 });
    expect(predictor.stateName()).toBe('tracking');
  });

  it('the same failure with no rolling-window allowance left suspends instead', async () => {
    const clock = createFakeClock();
    const fake = createFakeTransport(7);
    const predictor = new DirectMotionPredictor(toTransport(fake), {
      speed: 4,
      clock: toClock(clock),
      maxRejoinsPerWindow: 1,
      rejoin: async () => {
        throw new Error('join refused: seat is closing');
      },
    });
    predictor.attach();
    fake.patch({ lastAuthorityTick: 1, z: 1.5 });
    fake.patch({ lastAuthorityTick: 2, inputRetiredUnrepresented: 1 });
    clock.advance(250);
    await flush();
    expect(predictor.stateName(), 'the counted failure exhausted the allowance').toBe('suspended');
    expect(predictor.recoveryLedger().some((entry) => entry.event === 'suspended' && entry.detail.includes('rolling-window'))).toBe(true);
    expect(predictor.heldSnapshot()).toEqual({ x: 0, z: 1.5 });
  });
});

// ─────────────────────────────── checkpoint instrumenter: matched-ack corrections

describe('UDG-SPIKE-001 — the checkpoint instrumenter measures every matched ack exactly once', () => {
  const speed = 4;
  const dt = 0.05;
  const stepMetres = speed * dt;

  const buildMeasured = () => {
    const clock = createFakeClock();
    const fake = createFakeTransport(7);
    const predictor = new DirectMotionPredictor(toTransport(fake), { speed, clock: toClock(clock) });
    predictor.attach();
    fake.patch({ lastAuthorityTick: 1 }); // first snapshot: truth (0,0), ack 0 — no range yet
    return { clock, fake, predictor };
  };

  type PredictorInstance = InstanceType<typeof DirectMotionPredictor>;
  const measured = (predictor: PredictorInstance) => predictor.matchedCorrections().filter((row) => row.status === 'measured');

  it('a straight consumed run measures ZERO correction while the legacy pending×step approximation is nonzero', () => {
    const { fake, predictor } = buildMeasured();
    predictor.send({ generation: 1, moveX: 0, moveZ: 1 }, true);
    fake.patch({ lastAuthorityTick: 2, z: stepMetres, inputResolvedThrough: 1, ackTo: 1 });
    const rows = measured(predictor);
    expect(rows.length).toBe(1);
    const row = rows[0] as (typeof rows)[number];
    expect(Math.abs(row.correctionX)).toBeLessThan(1e-12);
    expect(Math.abs(row.correctionZ)).toBeLessThan(1e-12);
    expect(row.seqs).toEqual([1]);
    expect(row.ackFrom).toBe(0);
    expect(row.ackTo).toBe(1);
    // The rejected approximation, shown disagreeing with the real metric on a fully consumed run.
    expect(row.legacyPendingApproximationMetres).toBeCloseTo(stepMetres, 12);
  });

  it('a refusal is detected as EXACTLY the refused frame step vector', () => {
    const { fake, predictor } = buildMeasured();
    for (let generation = 1; generation <= 3; generation += 1) {
      predictor.send({ generation, moveX: 0, moveZ: 1 }, true);
    }
    // Authority resolved all three but MOVED only twice — seq 3 was refused (consumed, no motion).
    fake.patch({ lastAuthorityTick: 2, z: 2 * stepMetres, inputResolvedThrough: 3, ackTo: 3 });
    const rows = measured(predictor);
    expect(rows.length).toBe(1);
    const row = rows[0] as (typeof rows)[number];
    expect(row.correctionZ, 'correction equals the refused step, not an approximation of it').toBeCloseTo(stepMetres, 12);
    expect(row.correctionX).toBeCloseTo(0, 12);
    expect(predictor.matchedInstrumentStats().zero, 'a real correction is never counted as zero').toBe(0);
  });

  it('turns, diagonals and neutral inputs stay EXACTLY zero — where pending×step would flag them', () => {
    const { fake, predictor } = buildMeasured();
    const drives = [
      { moveX: 1, moveZ: 0 },
      { moveX: 1, moveZ: 0 },
      { moveX: Math.SQRT1_2, moveZ: Math.SQRT1_2 },
      { moveX: 0, moveZ: 0 },
    ];
    let x = 0;
    let z = 0;
    drives.forEach((drive, index) => {
      predictor.send({ generation: index + 1, moveX: drive.moveX, moveZ: drive.moveZ }, drive.moveX !== 0 || drive.moveZ !== 0);
      const next = flatDirectStep({ x, z }, drive, dt, speed);
      x = next.x;
      z = next.z;
    });
    fake.patch({ lastAuthorityTick: 2, x, z, inputResolvedThrough: 4, ackTo: 4 });
    const rows = measured(predictor);
    expect(rows.length).toBe(1);
    const row = rows[0] as (typeof rows)[number];
    expect(Math.abs(row.correctionX), 'mixed non-collinear pending inputs measure exactly zero').toBeLessThan(1e-12);
    expect(Math.abs(row.correctionZ)).toBeLessThan(1e-12);
    expect(row.legacyPendingApproximationMetres, 'the old metric would have reported 4 steps of correction here').toBeCloseTo(4 * stepMetres, 12);
    expect(predictor.matchedInstrumentStats().zero).toBe(1);
  });

  it('non-advancing matched deliveries (the SDK early-out) are counted as nothing, never as zero corrections', () => {
    const { fake, predictor } = buildMeasured();
    predictor.send({ generation: 1, moveX: 0, moveZ: 1 }, true);
    fake.patch({ lastAuthorityTick: 2, z: stepMetres, inputResolvedThrough: 1, ackTo: 1 });
    const before = measured(predictor).length;
    // Further verified deliveries that advance neither ack nor resolution.
    fake.patch({ lastAuthorityTick: 3 });
    fake.patch({ lastAuthorityTick: 4 });
    expect(measured(predictor).length, 'no ack boundary, no checkpoint').toBe(before);
    expect(predictor.matchedInstrumentStats().nonAdvancingDeliveries).toBe(2);
  });

  it('a checkpoint whose frames are not all observable is invalidated — and the anchor is held, never zeroed', () => {
    const { fake, predictor } = buildMeasured();
    predictor.send({ generation: 1, moveX: 0, moveZ: 1 }, true);
    predictor.send({ generation: 2, moveX: 0, moveZ: 1 }, true);
    predictor.send({ generation: 3, moveX: 0, moveZ: 1 }, true);
    // Ack/resolution jump to 5, but the journal only ever held 1..3: the range is unmeasurable.
    fake.patch({ lastAuthorityTick: 2, z: 5 * stepMetres, inputResolvedThrough: 5, ackTo: 5 });
    const rows = predictor.matchedCorrections();
    expect(rows.at(-1)?.status).toBe('invalidated-missing-frames');
    expect(measured(predictor).length, 'an unavailable checkpoint is never recorded as zero').toBe(0);
    expect(predictor.matchedInstrumentStats().invalidated).toBe(1);
    // The anchor is HELD (still at 0) and measurement stays disabled until a domain resync
    // re-anchors it: pruning by the resolved watermark has removed the evidence, and an
    // incomplete range is NEVER reported as a zero correction.
    predictor.send({ generation: 4, moveX: 0, moveZ: 1 }, true);
    predictor.send({ generation: 5, moveX: 0, moveZ: 1 }, true);
    fake.patch({ lastAuthorityTick: 3, z: 5 * stepMetres, inputResolvedThrough: 5, ackTo: 5 });
    expect(measured(predictor).length, 'a range with unobservable frames is never measured as zero').toBe(0);
    expect(predictor.matchedInstrumentStats().invalidated, 'every attempt against the incomplete range is recorded').toBeGreaterThanOrEqual(2);
  });

  it('batched deliveries measure each ack range exactly once: monotone cursor, disjoint seq coverage', () => {
    const { fake, predictor } = buildMeasured();
    for (let generation = 1; generation <= 5; generation += 1) {
      predictor.send({ generation, moveX: 0, moveZ: 1 }, true);
    }
    fake.patch({ lastAuthorityTick: 2, z: 2 * stepMetres, inputResolvedThrough: 2, ackTo: 2 });
    for (let generation = 6; generation <= 7; generation += 1) {
      predictor.send({ generation, moveX: 0, moveZ: 1 }, true);
    }
    fake.patch({ lastAuthorityTick: 3, z: 4 * stepMetres, inputResolvedThrough: 4, ackTo: 4 });
    fake.patch({ lastAuthorityTick: 4, z: 7 * stepMetres, inputResolvedThrough: 7, ackTo: 7 });
    const rows = measured(predictor);
    expect(rows.length, 'three ack boundaries').toBe(3);
    const seen = new Set<number>();
    let cursor = 0;
    for (const row of rows) {
      expect(row.ackFrom, 'the cursor advances with each measured boundary').toBe(cursor);
      cursor = row.ackTo;
      for (const seq of row.seqs) {
        expect(seen.has(seq), `seq ${String(seq)} measured once`).toBe(false);
        seen.add(seq);
      }
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('a stalled render batch: the adoption ledger corroborates the ACTUAL SDK adoption (refused frame then an advancing matched delivery, one tick)', () => {
    const { fake, predictor } = buildMeasured();
    // Raw prediction steps eagerly at each send (the pinned SDK's posture, now modelled by the
    // fake): z = 3 · step after three sends. Deliveries must NOT adopt — the adoption ledger
    // stays empty however many matched deliveries land. The reconciler is armed at the snapshot
    // tick first — as the browser arms it — so sends step the raw state eagerly from then on.
    predictor.tick(1000);
    expect(predictor.adoptionLedger().length, 'the snapshot state itself needs no adoption row').toBe(0);
    predictor.send({ generation: 1, moveX: 0, moveZ: 1 }, true);
    predictor.send({ generation: 2, moveX: 0, moveZ: 1 }, true);
    // D1: the refused frame resolves — ack advances to 2 while authority moved only once.
    fake.patch({ lastAuthorityTick: 2, z: stepMetres, inputResolvedThrough: 2, ackTo: 2 });
    // Another advancing matched delivery in the SAME batch, still no predictor tick.
    predictor.send({ generation: 3, moveX: 0, moveZ: 1 }, true);
    fake.patch({ lastAuthorityTick: 3, z: 2 * stepMetres, inputResolvedThrough: 3, ackTo: 3 });
    expect(predictor.adoptionLedger().length, 'deliveries never adopt; the tick adopts').toBe(0);
    expect(predictor.matchedCorrections().filter((row) => row.status === 'measured').length, 'both boundaries exposed once at delivery').toBe(2);

    predictor.tick(1100); // the render loop returns: ONE reconcile adopts the latest state
    const adoptions = predictor.adoptionLedger();
    expect(adoptions.length).toBe(1);
    const row = adoptions[0] as (typeof adoptions)[number];
    expect(row.adoptedAck).toBe(3);
    expect(row.prevAdoptedAck).toBe(0);
    expect(row.boundaries.length, 'both batched boundaries sit inside this one adoption').toBe(2);
    const first = row.boundaries[0] as (typeof row.boundaries)[number];
    const last = row.boundaries[1] as (typeof row.boundaries)[number];
    expect(first.ackTo).toBe(2);
    expect(first.directlyAdopted, 'the intermediate boundary was reconstructed inside this adoption').toBe(false);
    expect(last.directlyAdopted, 'the boundary equal to the adopted ack is the direct SDK checkpoint').toBe(true);
    expect(first.correctionZ, 'the refused frame is attributed to exactly ONE boundary as its exact step').toBeCloseTo(stepMetres, 12);
    expect(row.boundaries.filter((b) => Math.hypot(b.correctionX, b.correctionZ) > 1e-9).length, 'single attribution').toBe(1);
    expect(row.coverageComplete, 'the ack span 0..3 is fully chained by measured boundaries').toBe(true);
    // The conservation equation on REAL behaviour: raw before adoption sat one refused step
    // ahead of the adopted truth; nothing unresolved; attribution explains it to float noise.
    expect(row.actualAdoptionDeltaZ).toBeCloseTo(stepMetres, 12);
    expect(row.maxAbsResidualMetres, 'no checkpoint rebased on an unapplied delivery could satisfy this').toBeLessThan(1e-9);
  });

  it('an unobservable required boundary inside an adoption fails the metric explicitly', () => {
    const { fake, predictor } = buildMeasured();
    predictor.tick(1000);
    predictor.send({ generation: 1, moveX: 0, moveZ: 1 }, true);
    predictor.send({ generation: 2, moveX: 0, moveZ: 1 }, true);
    // Ack jumps to 5 but the journal only ever held 1..2: the range is unmeasurable — the
    // checkpoint is invalidated (never zero) and the adoption that covers it must report the
    // hole rather than chain over it.
    fake.patch({ lastAuthorityTick: 2, z: 5 * stepMetres, inputResolvedThrough: 5, ackTo: 5 });
    predictor.tick(1100);
    const row = predictor.adoptionLedger().at(-1) as ReturnType<InstanceType<typeof DirectMotionPredictor>['adoptionLedger']>[number];
    expect(row.coverageComplete, 'an invalidated boundary inside the span fails coverage explicitly').toBe(false);
    expect(predictor.matchedInstrumentStats().adoptionCoverageIncomplete).toBe(1);
    expect(predictor.matchedInstrumentStats().invalidated).toBe(1);
  });
});

// ────────────────────────────────────────── replay-identity ledger

describe('UDG-SPIKE-001 — the replay-identity ledger catches double steps and confirms exact-once replay', () => {
  const buildIdentity = () => {
    const clock = createFakeClock();
    const fake = createFakeTransport(7);
    const predictor = new DirectMotionPredictor(toTransport(fake), { speed: 4, clock: toClock(clock) });
    predictor.attach();
    fake.patch({ lastAuthorityTick: 1 });
    return { clock, fake, predictor };
  };

  it('compliant replay leaves NO residual in non-empty windows; an induced double replay leaves exactly the extra steps', () => {
    recorder.replay = 'single';
    try {
      const { fake, predictor } = buildIdentity();
      for (let generation = 1; generation <= 4; generation += 1) {
        predictor.send({ generation, moveX: 0, moveZ: 1 }, true);
      }
      fake.patch({ lastAuthorityTick: 2, z: 2 * 0.2, inputResolvedThrough: 2, ackTo: 2 });
      predictor.tick(1100);
      const clean = predictor.replayIdentityLedger();
      expect(clean.length).toBe(1);
      const row = clean[0] as (typeof clean)[number];
      expect(row.pendingSeqs, 'the window is non-empty — the ledger row is over real pending work').toEqual([3, 4]);
      expect(row.maxAbsResidualMetres, 'adopted ⊕ Σ step(pending) equals the raw pose exactly once each').toBeLessThan(1e-12);

      recorder.replay = 'double';
      predictor.send({ generation: 5, moveX: 0, moveZ: 1 }, true);
      predictor.send({ generation: 6, moveX: 0, moveZ: 1 }, true);
      fake.patch({ lastAuthorityTick: 3, z: 4 * 0.2, inputResolvedThrough: 4, ackTo: 4 });
      predictor.tick(1200);
      const faulted = predictor.replayIdentityLedger().at(-1) as (typeof clean)[number];
      expect(faulted.pendingSeqs).toEqual([5, 6]);
      expect(faulted.maxAbsResidualMetres, 'a double replay leaves exactly two steps of residual').toBeCloseTo(2 * 0.2, 12);
    } finally {
      recorder.replay = 'none';
    }
  });
});

// ───────────────────────────────────────────────────────────── shared flat step kernel

describe('UDG-SPIKE-001 — one shared step function on the prediction side (slice 5 review item 1)', () => {
  it('the adapter re-exports the kernel module\'s ONE function — identity, not two copies', () => {
    // The reconciler's step closure, the checkpoint instrumenter, the identity ledger and the
    // browser pages all reach the relation through these exports; one function object means the
    // spike's expectations are the SAME relation the reconciler steps with, by construction.
    expect(flatStepFromKernelModule).toBe(flatDirectStep);
  });

  it('reproduces FlatReferenceStepper over 200 mixed-drive ticks to 1e-12 m', async () => {
    // Diagnostic about the PRODUCTION stepper only (the amendment proposal in api-map §13.2 would
    // make the server consume this same function). It is not how the spike establishes identity:
    // that is the shared export above plus the browser's behavioural agreement — live consumed
    // dispositions at ticks 40/120 matching vectors computed from this function.
    const { pathToFileURL } = await import('node:url');
    const { resolve } = await import('node:path');
    const modPath = resolve(__dirname, '../../../apps/server/dist/movement/MovementAuthorityAdapter.js');
    const mod = (await import(pathToFileURL(modPath).href)) as Record<string, unknown>;
    const Stepper = mod['FlatReferenceStepper'] as new (speed: number) => {
      step: (request: {
        state: { kinematic: { position: { x: number; y: number; z: number } } };
        input: { moveX: number; moveZ: number };
        dtSeconds: number;
      }) => { state: { kinematic: { position: { x: number; y: number; z: number } } } };
      calls: number;
    };
    const speed = 4;
    const stepper = new Stepper(speed);
    let authority = { x: 0, y: 0, z: 0 };
    let client = { x: 0, z: 0 };
    const dt = 0.05;
    const drives = [
      { moveX: 1, moveZ: 0 },
      { moveX: 0, moveZ: 1 },
      { moveX: Math.SQRT1_2, moveZ: Math.SQRT1_2 },
      { moveX: -0.3, moveZ: 0.9 },
    ];
    for (let step = 0; step < 200; step += 1) {
      const drive = drives[step % drives.length] as { moveX: number; moveZ: number };
      const outcome = stepper.step({
        state: { kinematic: { position: authority } },
        input: drive,
        dtSeconds: dt,
      });
      authority = outcome.state.kinematic.position;
      client = flatDirectStep(client, drive, dt, speed);
    }
    expect(Math.abs(client.x - authority.x)).toBeLessThan(1e-12);
    expect(Math.abs(client.z - authority.z)).toBeLessThan(1e-12);
    expect(stepper.calls).toBe(200);
  });
});

// ───────────────────────── INPUT_ACK_STALLED (ADR-0003 §3.2) — red/fixed pair, slice 8
// The accepted contract defines the stalled-acknowledgement signal solely from client-observable
// quantities: an OUTSTANDING input whose SDK acknowledgement AND inputResolvedThrough advance
// NEITHER across G consecutive state deliveries, epoch unchanged (G =
// INPUT_ENVELOPE_DEFAULTS.stallDetectionDeliveries, the named spec config in packages/config).
// Before this slice the adapter owned only the 500 ms snapshot deadline — which RESTARTS on every
// accepted delivery — so a genuinely lost input riding a still-flowing state stream was the one
// case with NO client-side recourse: every unrelated delivery refreshed the timer. These tests
// were RED against that behavior and drive the fix; the controls (ack advancing, idle with no
// pending, boundary-advancing deliveries) are the no-false-positive half.

describe('UDG-SPIKE-001 §3.2 INPUT_ACK_STALLED — stall detection under a still-flowing state stream', () => {
  const buildStall = (overrides: Record<string, unknown> = {}) => {
    const clock = createFakeClock();
    const fake = createFakeTransport(7);
    const next = createFakeTransport(8);
    const rejoin = vi.fn(async () => toTransport(next));
    const predictor = new DirectMotionPredictor(toTransport(fake), {
      speed: 4,
      clock: toClock(clock),
      rejoin,
      snapshotDeadlineMs: 500,
      recoveryDeadlineMs: 4000,
      rejoinWindowMs: 60_000,
      maxRejoinsPerWindow: 2,
      rejoinBackoffMs: [250, 500, 1000],
      ...overrides,
    });
    predictor.attach();
    fake.patch({ lastAuthorityTick: 1, z: 1.5 });
    return { clock, fake, next, predictor, rejoin };
  };

  it('FIRES on the Gth consecutive delivery whose ack AND resolvedThrough neither moved (epoch unchanged), entering the standard §3.2 episode', () => {
    const { fake, predictor } = buildStall();
    predictor.send({ generation: 1, moveX: 1, moveZ: 0 }, true); // one distinct admitted input, stamp sentCount+1
    const g = 3; // INPUT_ENVELOPE_DEFAULTS.stallDetectionDeliveries
    // deliveries keep flowing (tick advances, position updates) but the ack watermark and the
    // resolved prefix stay stuck — the room never got the input: a test-suppressed delivery.
    for (let i = 1; i <= g - 1; i += 1) {
      fake.patch({ lastAuthorityTick: 1 + i, z: 1.5 + i });
      expect(predictor.stateName(), `must NOT fire before the Gth unmoved delivery (saw ${String(i)})`).toBe('tracking');
    }
    fake.patch({ lastAuthorityTick: 1 + g, z: 1.5 + g });
    expect(predictor.stateName()).toBe('recovering');
    const trigger = predictor.recoveryLedger().find((entry) => entry.event === 'trigger');
    expect(trigger?.detail, 'the named trigger is the stalled-ack rule, not a deadline or a gap').toMatch(/input-ack-stalled/);
    // no premature prune: the discarded pending count in the trigger detail is the outstanding 1
    expect(trigger?.detail).toMatch(/1$/);
  });

  it('does NOT fire when the ack or prefix advances within the window (benign in-flight patch)', () => {
    const { fake, predictor } = buildStall();
    predictor.send({ generation: 1, moveX: 1, moveZ: 0 }, true);
    fake.patch({ lastAuthorityTick: 2, z: 2 });
    fake.patch({ lastAuthorityTick: 3, z: 3 });
    // the input is DISPOSED on the third delivery — ack and prefix move together, as a real
    // dequeue does (ack alone could only arrive as a refusal: ack-ahead-of-resolution).
    fake.patch({ lastAuthorityTick: 4, z: 4, ackTo: 1, inputResolvedThrough: 1 });
    expect(predictor.stateName()).toBe('tracking');
    expect(predictor.recoveryLedger().some((entry) => entry.event === 'trigger')).toBe(false);
  });

  it('does NOT fire while nothing is outstanding (compliant idle with a static record)', () => {
    const { fake, predictor } = buildStall();
    for (let i = 1; i <= 7; i += 1) fake.patch({ lastAuthorityTick: 1 + i });
    expect(predictor.stateName()).toBe('tracking');
    expect(predictor.recoveryLedger().some((entry) => entry.event === 'trigger')).toBe(false);
  });

  it('reads G from the named spec config seam (explicit stallDetectionDeliveries: 2 fires one delivery earlier)', () => {
    const { fake, predictor } = buildStall({ stallDetectionDeliveries: 2 });
    predictor.send({ generation: 1, moveX: 0, moveZ: 1 }, true);
    fake.patch({ lastAuthorityTick: 2, z: 2 });
    expect(predictor.stateName()).toBe('tracking');
    fake.patch({ lastAuthorityTick: 3, z: 3 });
    expect(predictor.stateName()).toBe('recovering');
    expect(predictor.recoveryLedger().find((entry) => entry.event === 'trigger')?.detail).toMatch(/input-ack-stalled/);
  });
});

describe('UDG-SPIKE-001 slice 28 — the §D-design configurable path on the seat (fail closed; honest status; clock origins distinguished)', () => {
  // A buildStall twin that lets the DECLARED clock start at any ORIGIN: the same relative
  // sequences at different origins must take identical paths (the rule may read only the
  // injected trigger clock, never an ambient one).
  const buildStallAt = (origin: number, overrides: Record<string, unknown> = {}) => {
    const clock = createFakeClock();
    clock.now = origin;
    const fake = createFakeTransport(7);
    const next = createFakeTransport(8);
    const rejoin = vi.fn(async () => toTransport(next));
    const predictor = new DirectMotionPredictor(toTransport(fake), {
      speed: 4,
      clock: toClock(clock),
      rejoin,
      snapshotDeadlineMs: 60_000, // raised DECLARED test setting: the hold advances the clock past the
      // provisional 500 ms snapshot deadline ON PURPOSE (that rule stays independent and armed —
      // the e2e gafloor leg exercises the shipped 500 ms value); this cell isolates ONLY the wait.
      recoveryDeadlineMs: 60_000,
      rejoinWindowMs: 60_000,
      maxRejoinsPerWindow: 2,
      rejoinBackoffMs: [250, 500, 1000],
      ...overrides,
    });
    predictor.attach();
    fake.patch({ lastAuthorityTick: 1, z: 1.5 });
    return { clock, fake, next, predictor, rejoin };
  };
  const stageStall = (fake: ReturnType<typeof createFakeTransport>, predictor: InstanceType<typeof DirectMotionPredictor>, patches: number) => {
    predictor.send({ generation: 1, moveX: 1, moveZ: 0 }, true);
    for (let i = 1; i <= patches; i += 1) fake.patch({ lastAuthorityTick: 1 + i, z: 1.5 + i });
  };

  it('INVALID opt-ins fail closed AT CONSTRUCTION — the seat never exists, reasons are named', () => {
    expect(() => buildStallAt(1_000, { stallAckFloor: { waitMs: 0, provenance: 'p' } })).toThrow(/refused at config validation/);
    expect(() => buildStallAt(1_000, { stallAckFloor: { waitMs: 500 } })).toThrow(/provenance is REQUIRED/);
    expect(() => buildStallAt(1_000, { stallAckFloor: { waitMs: 500, provenance: 'p', matchedBudgetMs: 100 } })).toThrow(/at least COVER the wait/);
    expect(() => buildStallAt(1_000, { stallAckFloor: 500, stallAckFloorMs: 400 })).toThrow(/mutually exclusive/);
  });

  it('ABSENT opt-in stays the provisional count-only default and SAYS so — no value silently selected', () => {
    const { fake, predictor } = buildStallAt(1_000);
    const status = predictor.stallAckFloorStatus();
    expect(status.state).toBe('default-provisional-count-only');
    expect(JSON.stringify(status)).not.toMatch(/waitMs|\b400\b/); // no hidden local W anywhere in the status
    stageStall(fake, predictor, 3); // three unmoved deliveries AFTER the baseline row: streak hits G=3
    expect(predictor.stateName()).toBe('recovering');
    expect(predictor.recoveryLedger().find((entry) => entry.event === 'trigger')?.detail).toMatch(/input-ack-stalled at 1$/); // count-only detail carries the OUTSTANDING COUNT, unchanged from the shipped rule
  });

  it('a CONFIGURED measured wait HELDS under the envelope (labelled, provenanced) and FIRES only past it — no PROTOTYPE wording, no loss claim', () => {
    const { clock, fake, predictor, rejoin } = buildStallAt(1_000, { stallAckFloor: { waitMs: 900, provenance: 'unit: same-room epoch-7 p95 + allowance (synthetic stand-in)' } });
    expect(predictor.stallAckFloorStatus().state).toBe('configured');
    stageStall(fake, predictor, 3); // streak G at age ~0: HELD, tracking continues
    expect(predictor.stateName()).toBe('tracking');
    const held = predictor.recoveryLedger().find((entry) => entry.event === 'stall-floor-held');
    expect(held?.detail).toMatch(/configured 900 ms wait/);
    expect(held?.detail).toMatch(/provenance unit: same-room epoch-7/);
    expect(held?.detail).toMatch(/not a bound, not a loss claim/);
    expect(rejoin).not.toHaveBeenCalled(); // the held state armed NO episode: episode timers untouched
    clock.advance(800);
    fake.patch({ lastAuthorityTick: 5, z: 5 }); // age 800 < 900: still held
    expect(predictor.stateName()).toBe('tracking');
    clock.advance(200);
    fake.patch({ lastAuthorityTick: 6, z: 6 }); // age 1000 > 900: fires
    expect(predictor.stateName()).toBe('recovering');
    const trigger = predictor.recoveryLedger().find((entry) => entry.event === 'trigger');
    expect(trigger?.detail).toMatch(/input-ack-stalled at stalled-ack floor: CONFIGURED wait 900 ms/);
    expect(trigger?.detail).toMatch(/age 1000 ms/);
    expect(trigger?.detail).not.toMatch(/PROTOTYPE/);
  });

  it('the rule reads ONLY the DECLARED trigger clock: an 80-million-ms ORIGIN shift changes no decision and no age; the episode rejoin runs on the injected driver AFTER the fire, never during the hold', async () => {
    const runAt = (origin: number) => {
      const built = buildStallAt(origin, { stallAckFloor: { waitMs: 900, provenance: 'p' } });
      stageStall(built.fake, built.predictor, 3); // held at age ~0
      const heldState = built.predictor.stateName();
      const heldWithoutEpisode = built.rejoin.mock.calls.length === 0;
      built.clock.advance(1_000);
      built.fake.patch({ lastAuthorityTick: 5, z: 5 }); // age 1000 > 900: fires
      return { heldState, fired: built.predictor.stateName(), trigger: built.predictor.recoveryLedger().find((e) => e.event === 'trigger')?.detail ?? '', built, heldWithoutEpisode };
    };
    const atNear = runAt(1_000);
    const atFar = runAt(80_001_000);
    expect(atFar.heldState).toBe(atNear.heldState);
    expect(atFar.fired).toBe(atNear.fired);
    expect(atFar.trigger.match(/age (\d+) ms/)?.[1]).toBe(atNear.trigger.match(/age (\d+) ms/)?.[1]);
    expect(atNear.heldWithoutEpisode).toBe(true); // nothing armed while held
    atNear.built.clock.advance(250); // the episode backoff is the injected driver\u2019s OWN timer domain
    await flush();
    expect(atNear.built.rejoin).toHaveBeenCalled();
  });

  it('an epoch-scoped measurement that no longer matches the epoch holds on the older wait (safe direction) and SAYS stale — never fires early, never assumes', () => {
    const { clock, fake, predictor } = buildStallAt(1_000, { stallAckFloor: { waitMs: 300, provenance: 'measured under epoch 3', appliedEpoch: 3 } });
    stageStall(fake, predictor, 3); // deliveries are epoch 7 (fake transport); age ~0: held on the wait
    clock.advance(400);
    fake.patch({ lastAuthorityTick: 5, z: 5 }); // age 400 > 300: fires, labelled STALE
    expect(predictor.stateName()).toBe('recovering');
    const trigger = predictor.recoveryLedger().find((entry) => entry.event === 'trigger');
    expect(trigger?.detail).toMatch(/STALE for current epoch 7/);
    expect(trigger?.detail).toMatch(/never fired early/);
    const st = predictor.stallAckFloorStatus();
    expect(st.state === 'configured' && st.staleForCurrentEpoch).toBe(true);
  });
});

describe('UDG-SPIKE-001 slice 29 — the MEASURED-RECEIPT path on the seat: scope enforced at USE, reconciliation honest, out-of-scope never silently applied', () => {
  // ALL receipts below are explicitly SYNTHETIC test records: they declare stand-in numbers and
  // prove nothing. The seat fake issues epoch 7; the fake transport/clock is the slice-4 harness.
  const SYN = 'unit:synthetic test receipt (declared stand-in, no real values)';
  const seg = (durationMs: number, over: Record<string, unknown> = {}) => ({
    durationMs, clockOrigin: 'seat-declared-clock', basis: 'from-fire', ...over,
  });
  const receipt = (over: Record<string, unknown> = {}) => ({
    kind: 'measured-wait-receipt' as const, waitMs: 900, provenance: SYN, roomScope: 'room-synth-1', epochScope: 7,
    detection: seg(200), recovery: seg(700),
    budget: { availableMs: 1_000, clockOrigin: 'seat-declared-clock', basis: 'from-fire' },
    ...over,
  });
  const buildSeat = (overrides: Record<string, unknown> = {}) => {
    const clock = createFakeClock();
    clock.now = 1_000;
    const fake = createFakeTransport(7);
    const next = createFakeTransport(8);
    const rejoin = vi.fn(async () => toTransport(next));
    const predictor = new DirectMotionPredictor(toTransport(fake), {
      speed: 4,
      clock: toClock(clock),
      rejoin,
      snapshotDeadlineMs: 60_000, // raised DECLARED test setting ON PURPOSE to isolate the wait leg
      recoveryDeadlineMs: 60_000, // (same posture as the slice-28 block; the e2e gafloor leg keeps
      rejoinWindowMs: 60_000,     // exercising the shipped values)
      maxRejoinsPerWindow: 2,
      rejoinBackoffMs: [250, 500, 1000],
      ...overrides,
    });
    predictor.attach();
    fake.patch({ lastAuthorityTick: 1, z: 1.5 });
    const stage = (patches: number) => {
      predictor.send({ generation: 1, moveX: 1, moveZ: 0 }, true);
      for (let i = 1; i <= patches; i += 1) fake.patch({ lastAuthorityTick: 1 + i, z: 1.5 + i });
    };
    const firePastWait = () => {
      stage(3); // streak G at age ~0
      clock.advance(1_000);
      fake.patch({ lastAuthorityTick: 5, z: 5 }); // age 1000 > 900
    };
    const settle = async () => {
      clock.advance(250); // the episode backoff rides the injected driver
      await flush();
      next.patch({ lastAuthorityTick: 1, z: 1.5 }); // first accepted snapshot of the new domain
    };
    return { clock, fake, next, predictor, rejoin, stage, firePastWait, settle };
  };

  it('NO room identity at the public entry point: the receipt stays explicitly INELIGIBLE — the shipped count-only default fires and NAMES the refusal', () => {
    const { predictor, firePastWait } = buildSeat({ stallAckFloor: receipt() });
    firePastWait();
    expect(predictor.stateName()).toBe('recovering');
    const trigger = predictor.recoveryLedger().find((e) => e.event === 'trigger');
    expect(trigger?.detail).toMatch(/MEASURED RECEIPT NOT APPLIED/);
    expect(trigger?.detail).toMatch(/INELIGIBLE/);
    expect(trigger?.detail).toMatch(/no guessed IDs/);
    const st = predictor.stallAckFloorStatus();
    expect(st.state === 'configured' && st.scopeIssue !== null && /INELIGIBLE/.test(st.scopeIssue)).toBe(true);
  });

  it('room-scope mismatch: a receipt measured for another room NEVER activates on this seat — count-only continues, detail and status say why', () => {
    const { predictor, firePastWait } = buildSeat({ stallAckFloor: receipt(), measuredWaitRoomId: 'room-synth-OTHER' });
    firePastWait();
    const trigger = predictor.recoveryLedger().find((e) => e.event === 'trigger');
    expect(trigger?.detail).toMatch(/room-scope mismatch/);
    expect(trigger?.detail).toMatch(/MEASURED RECEIPT NOT APPLIED/);
    expect(trigger?.detail).not.toMatch(/MEASURED-RECEIPT wait/); // the measured profile was not used
  });

  it('epoch-scope mismatch: an epoch-7 receipt does not activate on an epoch-8 seat; an EXPLICIT null epochScope is declared epoch-agnostic and does', () => {
    const mismatch = buildSeat({ stallAckFloor: receipt({ epochScope: 8 }), measuredWaitRoomId: 'room-synth-1' });
    mismatch.firePastWait();
    expect(mismatch.predictor.recoveryLedger().find((e) => e.event === 'trigger')?.detail).toMatch(/epoch-scope mismatch/);
    const agnostic = buildSeat({ stallAckFloor: receipt({ epochScope: null }), measuredWaitRoomId: 'room-synth-1' });
    agnostic.firePastWait();
    const detail = agnostic.predictor.recoveryLedger().find((e) => e.event === 'trigger')?.detail ?? '';
    expect(detail).toMatch(/MEASURED-RECEIPT wait 900 ms/);
    expect(detail).toMatch(/declared epoch-agnostic/);
  });

  it('IN SCOPE (join-bound room): HELD under the wait, FIRES past it with the machine validation carried in the detail — labelled, never a proof, never production-enabled', () => {
    const { predictor, stage, firePastWait } = buildSeat({ stallAckFloor: receipt(), measuredWaitRoomId: 'room-synth-1' });
    stage(3); // streak G at age ~0: held (the wait leg applies)
    expect(predictor.stateName()).toBe('tracking');
    expect(predictor.recoveryLedger().some((e) => e.event === 'trigger')).toBe(false);
    firePastWait(); // re-stages: the second stage(3) continues from the first — the fire lands past the wait
    const detail = predictor.recoveryLedger().find((e) => e.event === 'trigger')?.detail ?? '';
    expect(detail).toMatch(/MEASURED-RECEIPT wait 900 ms/);
    expect(detail).toMatch(/machine-validated within-budget/);
    expect(detail).toMatch(/recorded detection\+recovery 900 ms vs declared available budget 1000 ms/);
    expect(detail).toMatch(/NOT a proof, NOT production-enabled/);
    expect(detail).not.toMatch(/PROTOTYPE/); // the legacy experimental label belongs to the legacy path only
  });

  it('APPLIED episode reconciliation: a receipt whose budget declares the SAME origin+basis as the actual episode compares; the verdict comes from the ACTUAL measured episode', async () => {
    const { predictor, firePastWait, settle } = buildSeat({ stallAckFloor: receipt(), measuredWaitRoomId: 'room-synth-1' });
    firePastWait();
    await settle();
    const st = predictor.stallAckFloorStatus();
    expect(st.state === 'configured' && st.episodeReconciliation !== null).toBe(true);
    if (st.state === 'configured' && st.episodeReconciliation !== null) {
      const rec = st.episodeReconciliation;
      expect(rec.validation).toBe('compared-on-matching-origins');
      expect(rec.actualEpisodeMs).toBe(250); // the injected driver advanced exactly the backoff
      expect(rec.verdict).toBe('within-declared-budget'); // 250 <= 1000 declared
      expect(rec.note).toMatch(/proves nothing and enables nothing/);
    }
    // The exceeded branch, from the ACTUAL episode: a valid tight-budget receipt, slow recovery.
    const slow = buildSeat({ stallAckFloor: receipt({ detection: seg(50), recovery: seg(100), budget: { availableMs: 200, clockOrigin: 'seat-declared-clock', basis: 'from-fire' } }), measuredWaitRoomId: 'room-synth-1' });
    slow.firePastWait();
    await slow.settle(); // actual episode 250 > 200 declared
    const st2 = slow.predictor.stallAckFloorStatus();
    expect(st2.state === 'configured' && st2.episodeReconciliation?.verdict).toBe('exceeded-declared-budget');
  });

  it('a receipt whose budget basis does NOT match the actual episode yields an unambiguously REPORTING-ONLY entry with no within/over wording — never presentable as applied', async () => {
    const { predictor, firePastWait, settle } = buildSeat({
      stallAckFloor: receipt({
        budget: { availableMs: 1_100, clockOrigin: 'seat-declared-clock', basis: 'from-oldest-send' },
        sendToFireOffsetMs: 150, // the receipt itself validates (normalized) at the config stage
      }),
      measuredWaitRoomId: 'room-synth-1',
    });
    firePastWait();
    await settle();
    const st = predictor.stallAckFloorStatus();
    if (st.state !== 'configured' || st.episodeReconciliation === null) throw new Error('expected a reconciliation entry');
    const rec = st.episodeReconciliation;
    expect(rec.validation).toBe('reporting-only-basis-mismatch');
    expect(rec.verdict).toBe('not-compared-basis-mismatch'); // NO within/over wording across mismatched origins
    expect(rec.note).toMatch(/REPORTING-ONLY/);
    expect(rec.note).toMatch(/must never be presented as an applied validation/);
  });

  it('the binding seam fails closed: no receipt — nothing to bind; empty/placeholder ids refused; re-binding to a different room is refused (a profile is never silently re-scoped)', () => {
    const plain = buildSeat();
    expect(() => plain.predictor.bindMeasuredWaitScope('room-synth-1')).toThrow(/no measured-wait receipt is configured/);
    const seat = buildSeat({ stallAckFloor: receipt() });
    expect(() => seat.predictor.bindMeasuredWaitScope('   ')).toThrow(/ACTUAL room identity/);
    seat.predictor.bindMeasuredWaitScope('room-synth-1'); // the supported direct-host binding
    expect(() => seat.predictor.bindMeasuredWaitScope('room-synth-2')).toThrow(/rebinding a measured profile is refused/);
    seat.firePastWait();
    expect(seat.predictor.recoveryLedger().find((e) => e.event === 'trigger')?.detail).toMatch(/MEASURED-RECEIPT wait 900 ms/);
  });

  it('RESET while an in-scope receipt is applied: a boundary that MOVES clears the streak — no episode, no wait fire (health still wins)', () => {
    const { fake, predictor, clock, stage } = buildSeat({ stallAckFloor: receipt(), measuredWaitRoomId: 'room-synth-1' });
    stage(2); // unmoved streak 2, under G
    fake.patch({ lastAuthorityTick: 4, z: 4, ackTo: 1, inputResolvedThrough: 1 }); // disposed: boundary moves
    clock.advance(5_000);
    for (let i = 1; i <= 4; i += 1) fake.patch({ lastAuthorityTick: 5 + i, z: 5 + i });
    expect(predictor.stateName()).toBe('tracking');
    expect(predictor.recoveryLedger().some((e) => e.event === 'trigger')).toBe(false);
  });
});
