/**
 * The minimal real rooms the Phase 0 probes drive.
 *
 * They are deliberately not UDG behaviour: no authority, no admission, no movement. They exist so the
 * probes can observe what the pinned server does with a fixed step, an input declaration, an
 * acknowledgement and a reconnection, using the region state the protocol package already declares.
 * Keeping them in one module also keeps each probe file about its own measurement.
 */

import { Room, type Client as ServerClient, type StepContext } from '@colyseus/core';
import {
  DIRECT_INPUT_FIELDS,
  DirectInputSchema,
  RegionSchema,
  schema,
  t,
  type RegionSchema as RegionState,
} from '@udg/protocol/schema';

import type { DirectInputFrame } from './support.js';

/** Options a probe passes through `defineRoom(room, options)`. */
export interface ProbeRoomOptions {
  tickRate?: number;
  bufferMaxSize?: number;
  declareIdle?: boolean;
}

/** One step the room represented, either from a client frame or from the authoritative neutral input. */
export interface AppliedRecord {
  readonly kind: 'frame' | 'neutral';
  /** The frame's generation when a client frame was applied; the neutral step records what it replaced. */
  readonly generation: number;
  /** The client sequence number the library was about to acknowledge, when one was known. */
  readonly seq: number;
}

/** One consumed frame as the room saw it. */
export interface ConsumedRecord {
  readonly index: number;
  readonly values: DirectInputFrame;
  readonly wasIdle: boolean;
  readonly consumedCountAfter: number;
  readonly refused: boolean;
}

/** Fixed-step evidence: how often the callback ran, and with what numbers. */
export class TickRoom extends Room<{ state: RegionState }> {
  readonly stamps: number[] = [];
  readonly contexts: { dt: number; dtMs: number; tick: number; subSteps: number; subDt: number }[] = [];

  override onCreate(options: ProbeRoomOptions = {}): void {
    this.setState(new RegionSchema());
    this.setFixedTimestep((context: StepContext): void => {
      this.stamps.push(Date.now());
      if (this.contexts.length < 400) {
        this.contexts.push({
          dt: context.dt,
          dtMs: context.dtMs,
          tick: context.tick,
          subSteps: context.subSteps,
          subDt: context.subDt,
        });
      }
    }, options.tickRate ?? 20);
    tickRooms.push(this);
  }
}

/**
 * Input-declaration and acknowledgement evidence. The probe reads this instance directly from the same
 * process; the client only drives it, so no measurement depends on an application-level reply channel.
 */
export class InputRoom extends Room<{ state: RegionState; input: DirectInputFrame }> {
  readonly consumed: ConsumedRecord[] = [];
  readonly accessorSize: number[] = [];
  readonly consumedCounts: number[] = [];
  readonly sessionIds: string[] = [];
  peeked = 0;
  nextResult = 'not-called';
  bufferMaxSize = 32;
  private index = 0;

  override onCreate(options: ProbeRoomOptions = {}): void {
    this.setState(new RegionSchema());
    this.bufferMaxSize = options.bufferMaxSize ?? 32;

    // Declared in onCreate rather than as a field initializer, because the buffer bound and the idle
    // policy are what each scenario is measuring. Note what is deliberately absent: no `sanitize`,
    // because a sanitizer rewrites wire values in place and UDG must see the value it intends to refuse.
    this.inputs = options.declareIdle === true
      ? this.defineInput(DirectInputSchema, {
          bufferMaxSize: this.bufferMaxSize,
          idle: { directIntent: false, moveX: 0, moveZ: 0 },
        })
      : this.defineInput(DirectInputSchema, { bufferMaxSize: this.bufferMaxSize });

    inputRooms.push(this);
  }

  override onJoin(client: ServerClient): void {
    this.sessionIds.push(client.sessionId);
  }

  /**
   * What the room represented in state, in order.
   *
   * This is a model of the application's side of the acknowledgement, written by the probe and not by
   * Colyseus: a frame the application *refuses* is still replaced by an authoritative neutral step,
   * while a frame the buffer *dropped* never reaches state at all. PR-8 needs the two to be separable,
   * because the library ack treats both as "consumed".
   */
  readonly applied: AppliedRecord[] = [];

  /** Read the buffer without consuming: size, ack counter and a peek of the pending frames. */
  observeBuffer(sessionId: string): void {
    const accessor = this.inputs?.get(sessionId);
    if (accessor === undefined) return;
    this.peeked = accessor.peek().length;
    this.accessorSize.push(accessor.size);
    this.consumedCounts.push(accessor.consumedCount);
  }

  /**
   * Identity snapshot of what is pending right now, oldest first.
   *
   * Note what is *not* here: the value the library acknowledges with (`ackSeq`) lives on the internal
   * `InputBuffer` and is not part of the public `InputAccessor` type, so a room cannot read the ack it is
   * causing. `consumedCount` is public and, for reliable inputs, the declarations state the two coincide;
   * the client's `lastProcessed` is the other observable. PR-8 measures both and reports the gap.
   */
  pendingIdentities(sessionId: string): { generations: number[]; size: number; consumedCount: number } {
    const accessor = this.inputs?.get(sessionId);
    if (accessor === undefined) return { generations: [], size: 0, consumedCount: -1 };
    return {
      generations: accessor.peek().map((frame) => frame.generation),
      size: accessor.size,
      consumedCount: accessor.consumedCount,
    };
  }

  /** Consume exactly one frame — the shared-world primitive `next()`. */
  consumeOne(sessionId: string, refuse = false): void {
    const accessor = this.inputs?.get(sessionId);
    if (accessor === undefined) return;
    const ackBefore = accessor.consumedCount;
    const frame = accessor.next();
    this.nextResult = frame === undefined ? 'undefined' : 'frame';
    this.consumed.push({
      index: this.index,
      values: frame === undefined
        ? { sessionEpoch: -1, generation: -1, directIntent: false, moveX: 0, moveZ: 0 }
        : { sessionEpoch: frame.sessionEpoch, generation: frame.generation, directIntent: frame.directIntent, moveX: frame.moveX, moveZ: frame.moveZ },
      wasIdle: accessor.wasIdle,
      consumedCountAfter: accessor.consumedCount,
      refused: refuse,
    });
    // What the application represented for this step: a refused frame is replaced by the authoritative
    // neutral input, so state *is* advanced; the difference from an applied frame is which intent the
    // step carried, not whether a step happened.
    this.applied.push({
      kind: refuse || frame === undefined ? 'neutral' : 'frame',
      generation: frame?.generation ?? -1,
      seq: ackBefore + 1,
    });
    this.index += 1;
    this.accessorSize.push(accessor.size);
    this.consumedCounts.push(accessor.consumedCount);
  }

  /** Consume everything buffered — the `drain()` primitive whose ack behaviour is part of PR-8. */
  consumeAll(sessionId: string): void {
    const accessor = this.inputs?.get(sessionId);
    if (accessor === undefined) return;
    for (const frame of accessor.drain()) {
      this.consumed.push({
        index: this.index,
        values: {
          sessionEpoch: frame.sessionEpoch,
          generation: frame.generation,
          directIntent: frame.directIntent,
          moveX: frame.moveX,
          moveZ: frame.moveZ,
        },
        wasIdle: accessor.wasIdle,
        consumedCountAfter: accessor.consumedCount,
        refused: false,
      });
      this.index += 1;
    }
    this.accessorSize.push(accessor.size);
    this.consumedCounts.push(accessor.consumedCount);
  }

  declaredFields(): readonly string[] {
    return DIRECT_INPUT_FIELDS;
  }
}

/** The overflow posture one scenario exercises. */
export type OverflowPolicy = 'none' | 'clear' | 'leave' | 'throttle' | 'seqfield' | 'take' | 'drain' | 'sanitize';

/** Options the overflow scenarios pass through `defineRoom(room, options)`. */
export interface OverflowRoomOptions extends ProbeRoomOptions {
  policy?: OverflowPolicy;
  /** Backlog size at which the posture acts. */
  threshold?: number;
  /** Library-enforced message-rate ceiling (`Room.maxMessagesPerSecond`). */
  maxMessagesPerSecond?: number;
  /** Frames the `take` posture consumes per step (`InputAccessor.take(n)`). */
  consumeBudget?: number;
}

/**
 * Overflow-policy evidence for PR-13: what a room can do *before* the buffer retires a frame it never
 * represented.
 *
 * The tick body is the smallest thing that could behave like a shared world: look at the backlog, apply
 * the scenario's posture, then take exactly one frame for the step. Every record is an identity rather
 * than a total, because the question is *which* frames a posture retires, not how many were touched.
 *
 * Only public surface is used, and each use is commented with its declaration: `InputAccessor.clear()`,
 * `Client.leave()` (`Transport.d.ts`: "Disconnect this client from the room"; `Room.kickClient` is
 * marked operator-only, so it is not used), `Room.send()` and `Room.maxMessagesPerSecond`.
 */
export class OverflowRoom extends Room<{ state: RegionState; input: DirectInputFrame }> {
  /** The posture under test. */
  policy: OverflowPolicy = 'none';
  /** Backlog size at which the posture acts. */
  threshold = 2;
  /** The bound the library enforces for this accessor. */
  bufferMaxSize = 4;
  /** Per-step records in order: what the room represented, and with which intent. */
  readonly applied: AppliedRecord[] = [];
  /**
   * Generations whose values actually entered a solver step.
   *
   * This — not "consumed" — is the identity set the prohibition is about. A frame retired by
   * `drain()` is consumed and acknowledged, but only the newest drained frame is simulated, so the rest
   * are recorded separately below (`drainedWithoutStep`) and do not count as represented.
   */
  readonly simulated: number[] = [];
  /** Generations a `drain()` retired while only another frame's values were stepped. */
  readonly drainedWithoutStep: number[] = [];
  /** Every generation the room ever saw buffered, whether or not it was consumed. */
  readonly seenBuffered = new Set<number>();
  /** Generations consumed with `next()`, in order. */
  readonly consumedGenerations: number[] = [];
  /** `accessor.size` sampled once per tick — the bounded-buffering measurement. */
  readonly sizeSamples: number[] = [];
  /** Disconnects the room caused or observed, with the close code it arrived with, per callback. */
  readonly disconnects: { kind: 'leave' | 'drop'; sessionId: string; code: number | undefined }[] = [];
  ticks = 0;
  clearCalls = 0;
  consumedCountBeforeClear = -1;
  consumedCountAfterClear = -1;
  throttleSignals = 0;
  /** When the room first sent the backlog signal, for measuring the sender's in-flight window. */
  firstSignalAt = 0;
  sanitizeCalls = 0;
  readonly sanitizedGenerations: number[] = [];
  sanitizedAndStepped = 0;
  consumeBudget = 1;
  private session: string | undefined;

  override onCreate(options: OverflowRoomOptions = {}): void {
    this.autoDispose = false;
    this.setState(new RegionSchema());
    this.policy = options.policy ?? 'none';
    this.threshold = options.threshold ?? 2;
    this.bufferMaxSize = options.bufferMaxSize ?? 4;
    this.consumeBudget = options.consumeBudget ?? 1;
    if (options.maxMessagesPerSecond !== undefined) this.maxMessagesPerSecond = options.maxMessagesPerSecond;

    // `seqField` is the one declaration option that could change what an acknowledgement means, so the
    // scenario that tests it names the application's own monotonic field instead of the implicit order.
    // `sanitize` is tested for the opposite reason: it is the only hook that runs at admission, before a
    // frame can join the backlog, and the scenario measures what that hook is allowed to do.
    const sanitizer = this.policy === 'sanitize'
      ? ((input: DirectInputFrame): void => {
        // `SanitizeInput<I>` is `(input: I) => void`: it mutates in place and returns nothing, so there
        // is no "reject" to return. The probe neutralises the intent to make that visible in the record.
        this.sanitizeCalls += 1;
        this.sanitizedGenerations.push(input.generation);
        input.directIntent = false;
        input.moveX = 0;
        input.moveZ = 0;
      })
      : undefined;

    this.inputs = this.defineInput(DirectInputSchema, {
      bufferMaxSize: this.bufferMaxSize,
      ...(this.policy === 'seqfield' ? { seqField: 'generation' } : {}),
      ...(sanitizer === undefined ? {} : { sanitize: sanitizer }),
    });

    this.setFixedTimestep((): void => {
      this.step();
    }, options.tickRate ?? 20);

    overflowRooms.push(this);
  }

  override onJoin(client: ServerClient): void {
    this.session = client.sessionId;
  }

  override onLeave(client: ServerClient, code?: number): void {
    this.disconnects.push({ kind: 'leave', sessionId: client.sessionId, code });
  }

  override onDrop(client: ServerClient, code?: number): void {
    this.disconnects.push({ kind: 'drop', sessionId: client.sessionId, code });
  }

  /** One authoritative step. */
  private step(): void {
    this.ticks += 1;
    const sessionId = this.session;
    if (sessionId === undefined) return;
    const accessor = this.inputs?.get(sessionId);
    if (accessor === undefined) return;

    this.sizeSamples.push(accessor.size);
    for (const frame of accessor.peek()) this.seenBuffered.add(frame.generation);

    const client = this.clients.find((candidate: ServerClient): boolean => candidate.sessionId === sessionId);

    if (accessor.size >= this.threshold && client !== undefined) {
      if (this.policy === 'clear') {
        this.consumedCountBeforeClear = accessor.consumedCount;
        accessor.clear();
        this.clearCalls += 1;
        this.consumedCountAfterClear = accessor.consumedCount;
        this.applied.push({ kind: 'neutral', generation: -1, seq: this.consumedCountAfterClear });
        return;
      }
      if (this.policy === 'leave') {
        client.leave(4008);
        return;
      }
      if (this.policy === 'throttle') {
        if (this.firstSignalAt === 0) this.firstSignalAt = Date.now();
        this.send(client, 'udg-backlog', { on: true });
        this.throttleSignals += 1;
      }
    }

    if (this.policy === 'drain' || this.policy === 'take') {
      this.stepConsume(accessor);
      return;
    }

    const frame = accessor.next();
    if (frame === undefined) {
      this.applied.push({ kind: 'neutral', generation: -1, seq: accessor.consumedCount });
      return;
    }
    this.consumedGenerations.push(frame.generation);
    this.simulated.push(frame.generation);
    if (this.policy === 'sanitize' && this.sanitizedGenerations.includes(frame.generation)) this.sanitizedAndStepped += 1;
    this.applied.push({ kind: 'frame', generation: frame.generation, seq: accessor.consumedCount });
  }

  /**
   * The two consume primitives the tick can use instead of `next()`.
   *
   * `take(n)` is the bounded form the pinned declarations recommend for a shared world ("`take` a bounded
   * few and sub-step the solver per input. The ack then === inputs actually simulated"). `drain()` is the
   * form the same comment warns against for a shared world ("`drain()`-then-apply-latest would silently
   * jump the ack past inputs the server never simulated") — measured here so the warning is evidence and
   * not a quotation.
   */
  private stepConsume(accessor: { drain(): DirectInputFrame[]; take(n: number): DirectInputFrame[] }): void {
    if (this.policy === 'drain') {
      const frames = accessor.drain();
      const newest = frames.at(-1);
      if (newest === undefined) {
        this.applied.push({ kind: 'neutral', generation: -1, seq: this.counters().consumedCount });
        return;
      }
      this.simulated.push(newest.generation);
      for (const frame of frames) if (frame.generation !== newest.generation) this.drainedWithoutStep.push(frame.generation);
      this.applied.push({ kind: 'frame', generation: newest.generation, seq: this.counters().consumedCount });
      return;
    }

    const frames = accessor.take(this.consumeBudget);
    if (frames.length === 0) {
      this.applied.push({ kind: 'neutral', generation: -1, seq: this.counters().consumedCount });
      return;
    }
    for (const frame of frames) {
      this.simulated.push(frame.generation);
      this.applied.push({ kind: 'frame', generation: frame.generation, seq: this.counters().consumedCount });
    }
  }

  /** Identities still buffered at read time. */
  bufferedGenerations(): number[] {
    const accessor = this.session === undefined ? undefined : this.inputs?.get(this.session);
    return accessor === undefined ? [] : accessor.peek().map((frame: DirectInputFrame): number => frame.generation);
  }

  /** The public counters at read time. */
  counters(): { size: number; consumedCount: number } {
    const accessor = this.session === undefined ? undefined : this.inputs?.get(this.session);
    return accessor === undefined ? { size: -1, consumedCount: -1 } : { size: accessor.size, consumedCount: accessor.consumedCount };
  }
}

/** Session-identity evidence for PR-12: which identities the server and the client each expose. */
export class SessionRoom extends Room<{ state: RegionState }> {
  readonly joins: string[] = [];
  readonly leaves: { sessionId: string; code: number | undefined }[] = [];
  readonly drops: string[] = [];
  readonly reconnections: string[] = [];
  reconnectionWindowsClosed = 0;

  override onCreate(): void {
    this.setState(new RegionSchema());
    // The probe disconnects and then asks for reconnection; a room that disposes with its last client
    // would answer "room has been disposed" instead of the question being asked.
    this.autoDispose = false;
    sessionRooms.push(this);
  }

  override onJoin(client: { sessionId: string }): void {
    this.joins.push(client.sessionId);
  }

  /**
   * The public reconnection pattern (Room.d.ts: "You may allow the client to reconnect by calling
   * `allowReconnection` within this method"). Without it the token the client holds is simply
   * refused, which is a fact the probe must not mistake for a transport failure.
   */
  override onLeave(client: ServerClient, code?: number): void {
    this.leaves.push({ sessionId: client.sessionId, code });
    const seat = this.allowReconnection(client, 10);
    void seat
      .then((rejoined: ServerClient) => {
        this.reconnections.push(rejoined.sessionId);
      })
      .catch(() => {
        this.reconnectionWindowsClosed += 1;
      });
  }

  override onDrop(client: ServerClient): void {
    this.drops.push(client.sessionId);
  }
}

/**
 * The protocol's five input fields plus one monotonic sequence field, for PR-15 only.
 *
 * `packages/protocol/src/schema/DirectInputSchema.ts` is frozen at protocol 1.0.0 and carries no
 * per-frame monotonic field: `generation` is UDG's *intention* generation, which advances only on a
 * deliberate control intention, and `sessionEpoch` is the session epoch. Neither identifies a frame.
 * This declaration exists so the probe can measure what `defineInput({ seqField })` does with an
 * application-stamped per-frame sequence, and it deliberately does not touch the protocol package.
 * Whether the shipped input schema gains such a field is the owner decision in
 * [ADR-P-0003 §9.1](../../docs/adr/proposals/UDG-003-d7-input-acknowledgement-policy.md).
 *
 * `schema` and `t` come from `@udg/protocol/schema`, which is the only place the schema runtime may be
 * imported, so the probe stays inside the package boundary while declaring a probe-local shape.
 */
export const SequencedInputSchema = schema(
  {
    sessionEpoch: t.uint32().default(0),
    generation: t.uint32().default(0),
    directIntent: t.boolean().default(false),
    moveX: t.float64().default(0),
    moveZ: t.float64().default(0),
    seq: t.uint32().default(0),
  },
  'SequencedInputSchema',
);

export interface SequencedInputFrame {
  sessionEpoch: number;
  generation: number;
  directIntent: boolean;
  moveX: number;
  moveZ: number;
  seq: number;
}

/**
 * The smallest authoritative surface that can carry a resolution watermark, for PR-15 only.
 *
 * The point of these four fields is the pairing question, not their shape: the client must be able to
 * read "the server resolved input sequence N" from the *same delivery* as the acknowledgement it
 * prunes against, or it is comparing two messages that were never sent together.
 */
export const InputTraceStateSchema = schema(
  {
    /** Highest client sequence the room resolved into state, contiguous prefix only. */
    resolvedThrough: t.uint32().default(0),
    /** Tick at which that resolution happened. */
    resolvedTick: t.uint32().default(0),
    /** A stand-in for authoritative motion: one unit per resolved frame. */
    position: t.float64().default(0),
    /** Count of gaps the room detected in the stamped sequence, so the client can see them at all. */
    gapCount: t.uint32().default(0),
    /**
     * `1` while the room is withholding steps at the probe's request.
     *
     * The field exists so the suspend handshake is *observable* rather than assumed: the probe waits for
     * the patch that confirms the room stopped stepping before it sends a burst that must land inside one
     * step window. `Room.setFixedTimestep` returns `void`, so there is no timer to clear; the gate is the
     * room's own decision inside its own step callback, and it is what turns the interior-gap case from a
     * race into arithmetic.
     */
    suspended: t.uint32().default(0),
  },
  'InputTraceStateSchema',
);

export type InputTraceState = InstanceType<typeof InputTraceStateSchema>;

/** State-patch cadence in ms, or null for the library default. */
export interface IdentityRoomOptions extends ProbeRoomOptions {
  /** Decouple the patch cadence from the step (`Room.patchRate`) to measure the skew between them. */
  patchIntervalMs?: number;
  /** Declare `seqField: 'seq'`. Off is the control: it measures what the room can identify without it. */
  useSeqField?: boolean;
}

/**
 * Identity, gap and pairing evidence for PR-15.
 *
 * Consumption is exactly the adopted posture — at most one observation per tick, oldest first — so what
 * is measured is the *identity* of what was consumed, not a different policy. Every record is written by
 * the room from public surface: `InputAccessor.next()`, `.peek()`, `.at(value)`, `.size`,
 * `.consumedCount`, `.latest`, and state assignment the client receives as a patch.
 */
export class IdentityRoom extends Room<{ state: InputTraceState; input: SequencedInputFrame }> {
  /** `seqField` values in consumption order — the identity stream the probe reasons about. */
  readonly consumedSeqs: number[] = [];
  /** `accessor.consumedCount` sampled after each consumption, so ack arithmetic can be checked. */
  readonly consumedCountAfter: number[] = [];
  /** `accessor.size` sampled once per tick. */
  readonly sizeSamples: number[] = [];
  /** Steps in which a consumption happened, with the tick and the ack counter at that moment. */
  readonly resolutions: { seq: number; tick: number; consumedCount: number }[] = [];
  /** Consecutive consumed seqs that are not adjacent: the only server-side evidence of a retirement. */
  readonly gaps: { from: number; to: number; skipped: number; tick: number }[] = [];
  /** Lookups by stamped seq, recording whether the accessor could still find the frame. */
  readonly lookups: { seq: number; found: boolean }[] = [];
  readonly sessions: string[] = [];
  /** Steps withheld at the probe's request, counted so the artefact says how many were skipped. */
  suspendedSkips = 0;
  ticks = 0;
  private session: string | undefined;
  private useSeqField = true;

  override onCreate(options: IdentityRoomOptions = {}): void {
    this.autoDispose = false;
    this.setState(new InputTraceStateSchema());
    this.useSeqField = options.useSeqField ?? true;
    this.bufferMaxSize = options.bufferMaxSize ?? 32;
    // Public and declared: `Room.patchRate` decouples state delivery from the simulation step, which is
    // exactly the skew a client-side reconciliation trigger has to tolerate.
    if (options.patchIntervalMs !== undefined) this.patchRate = options.patchIntervalMs;

    this.inputs = this.useSeqField
      ? this.defineInput(SequencedInputSchema, { bufferMaxSize: this.bufferMaxSize, seqField: 'seq' })
      : this.defineInput(SequencedInputSchema, { bufferMaxSize: this.bufferMaxSize });

    // Step gate over the message channel: public API in both directions. The client sends a message
    // type, the room gates its own step callback. No private field of the library is touched.
    this.onMessage('suspend', (): void => {
      this.suspendSteps = true;
      this.state.suspended = 1;
    });
    this.onMessage('resume', (): void => {
      this.suspendSteps = false;
      this.state.suspended = 0;
    });

    this.setFixedTimestep((): void => {
      this.step();
    }, options.tickRate ?? 20);

    identityRooms.push(this);
  }

  /** The bound the library enforces for this accessor, recorded for the result file. */
  bufferMaxSize = 32;

  /** Set while the probe needs a window in which no step can consume. */
  private suspendSteps = false;

  override onJoin(client: ServerClient): void {
    this.session = client.sessionId;
    this.sessions.push(client.sessionId);
  }

  /** Session ids the seat saw rejoin, so the probe can tell a reconnect from a fresh join. */
  readonly reconnections: string[] = [];
  reconnectionWindowsClosed = 0;

  /**
   * Open a reconnection window, which is what makes the reconnect scenario measurable at all: without
   * `allowReconnection` the token is refused (Phase 0 measured "reconnection token invalid or expired").
   */
  override onLeave(client: ServerClient): void {
    const seat = this.allowReconnection(client, 10);
    void seat
      .then((rejoined: ServerClient) => {
        this.reconnections.push(rejoined.sessionId);
        this.session = rejoined.sessionId;
      })
      .catch(() => {
        this.reconnectionWindowsClosed += 1;
      });
  }

  /** Ask the accessor whether a stamped seq is still retrievable — the client-blindness question, server side. */
  lookup(sessionId: string, seq: number): boolean {
    const accessor = this.inputs?.get(sessionId);
    if (accessor === undefined) return false;
    const found = accessor.at(seq);
    this.lookups.push({ seq, found: found !== undefined });
    return found !== undefined;
  }

  /** `accessor.size` right now, which is the only pre-eviction signal a room can observe. */
  currentSize(sessionId: string): number {
    return this.inputs?.get(sessionId)?.size ?? -1;
  }

  /** Whether this seat's accessor has drained — the bounded server-side settle condition. */
  drained(sessionId: string): boolean {
    const accessor = this.inputs?.get(sessionId);
    return accessor !== undefined && accessor.size === 0;
  }

  /**
   * One consistent, by-value capture of everything this room has observed.
   *
   * Every collection is copied and every total is derived inside the copy, so a published observation
   * cannot mix two instants. The previous shape handed out a **live array reference** beside a `skipped`
   * number computed at the moment of the call, and the artefact then contradicted itself: the retained
   * bytes from CI run 43053089415 show `gaps: [{from:12,to:14,skipped:1}]` next to `skipped: 0`, because
   * the array grew after the snapshot while the scalar could not. A snapshot is taken once, after the
   * accessor has drained, and every reader downstream sees that one value.
   */
  snapshot(sessionId: string): IdentityRoomSnapshot {
    const accessor = this.inputs?.get(sessionId);
    const consumedSeqs = [...this.consumedSeqs];
    const gaps = this.gaps.map((gap) => ({ ...gap }));
    const sizeSamples = [...this.sizeSamples];
    const resolutions = this.resolutions.map((entry) => ({ ...entry }));
    const lookups = this.lookups.map((entry) => ({ ...entry }));
    const consumedCount = accessor?.consumedCount ?? -1;
    const stepped = consumedSeqs.length;
    const firstConsumed = consumedSeqs[0];
    return {
      /**
       * Every field of this object was read at the same instant, from one call. It is recorded in the
       * artefact so a reader can tell an atomic capture from references assembled after the fact — the
       * distinction CI run 43053089415 could not make, and the reason its bytes contradicted themselves.
       */
      capturedOnce: true,
      ticks: this.ticks,
      suspendedSkips: this.suspendedSkips,
      bufferMaxSize: this.bufferMaxSize,
      consumedSeqs,
      gaps,
      /** Derived here from the copied array — a caller cannot obtain a total from a different instant. */
      skipped: gaps.reduce((total, gap) => total + gap.skipped, 0),
      sizeSamples,
      /** Highest buffer depth the room saw, derived from the copied samples. */
      peakSize: sizeSamples.length === 0 ? 0 : Math.max(...sizeSamples),
      resolutions,
      lookups,
      accessorConsumedCount: consumedCount,
      accessorSize: accessor?.size ?? -1,
      accessorLatestSeq: accessor?.latest?.seq ?? -1,
      /** Sequences the accessor consumed that never entered state: eviction and clearing, never dedupe. */
      retiredUnrepresented: consumedCount < 0 ? -1 : consumedCount - stepped,
      firstConsumedSeq: firstConsumed ?? -1,
      /** Retirements with no earlier consumed frame to name them — counted, never nameable. */
      unnamedLeading: firstConsumed === undefined ? 0 : firstConsumed - 1,
    };
  }

  private step(): void {
    if (this.suspendSteps) {
      // No tick is counted. A withheld window must not look like a tick that consumed nothing, because
      // the probe reads "consumed nothing" as evidence about the input buffer, not about this gate.
      this.suspendedSkips += 1;
      return;
    }
    this.ticks += 1;
    const accessor = this.session === undefined ? undefined : this.inputs?.get(this.session);
    if (accessor === undefined) return;
    this.sizeSamples.push(accessor.size);

    // One observation per tick, oldest first: `next()` is the declaration's blessed shared-world form.
    const frame = accessor.next();
    if (frame === undefined) return;

    const seq = frame.seq;
    const previous = this.consumedSeqs[this.consumedSeqs.length - 1];
    this.consumedSeqs.push(seq);
    this.consumedCountAfter.push(accessor.consumedCount);
    this.resolutions.push({ seq, tick: this.ticks, consumedCount: accessor.consumedCount });
    if (previous !== undefined && seq > previous + 1) {
      this.gaps.push({ from: previous, to: seq, skipped: seq - previous - 1, tick: this.ticks });
      this.state.gapCount = this.state.gapCount + 1;
    }

    // Resolution into state, published as a patch. This is the pairing half of the measurement.
    this.state.resolvedThrough = seq;
    this.state.resolvedTick = this.ticks;
    this.state.position = this.state.position + 1;
  }
}

/** A by-value observation of one `IdentityRoom` at one instant. See `IdentityRoom.snapshot`. */
export interface IdentityRoomSnapshot {
  /** Always `true`: the object is one atomic read. See `IdentityRoom.snapshot`. */
  readonly capturedOnce: true;
  readonly ticks: number;
  readonly suspendedSkips: number;
  readonly bufferMaxSize: number;
  readonly consumedSeqs: readonly number[];
  readonly gaps: readonly { from: number; to: number; skipped: number; tick: number }[];
  readonly skipped: number;
  readonly sizeSamples: readonly number[];
  readonly peakSize: number;
  readonly resolutions: readonly { seq: number; tick: number; consumedCount: number }[];
  readonly lookups: readonly { seq: number; found: boolean }[];
  readonly accessorConsumedCount: number;
  readonly accessorSize: number;
  readonly accessorLatestSeq: number;
  readonly retiredUnrepresented: number;
  readonly firstConsumedSeq: number;
  readonly unnamedLeading: number;
}

/** Rooms are created by the matchmaker, so a probe finds its instance through these registries. */
export const tickRooms: TickRoom[] = [];
export const inputRooms: InputRoom[] = [];
export const sessionRooms: SessionRoom[] = [];
export const overflowRooms: OverflowRoom[] = [];
export const identityRooms: IdentityRoom[] = [];

export function lastOf<T>(entries: readonly T[]): T | undefined {
  return entries[entries.length - 1];
}
