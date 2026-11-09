/**
 * The minimal real rooms the Phase 0 probes drive.
 *
 * They are deliberately not UDG behaviour: no authority, no admission, no movement. They exist so the
 * probes can observe what the pinned server does with a fixed step, an input declaration, an
 * acknowledgement and a reconnection, using the region state the protocol package already declares.
 * Keeping them in one module also keeps each probe file about its own measurement.
 */

import { Room, type Client as ServerClient, type StepContext } from '@colyseus/core';
import { DIRECT_INPUT_FIELDS, DirectInputSchema, RegionSchema, type RegionSchema as RegionState } from '@udg/protocol/schema';

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

/** Rooms are created by the matchmaker, so a probe finds its instance through these registries. */
export const tickRooms: TickRoom[] = [];
export const inputRooms: InputRoom[] = [];
export const sessionRooms: SessionRoom[] = [];
export const overflowRooms: OverflowRoom[] = [];

export function lastOf<T>(entries: readonly T[]): T | undefined {
  return entries[entries.length - 1];
}
