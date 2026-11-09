/**
 * The minimal real rooms the Phase 0 probes drive.
 *
 * They are deliberately not UDG behaviour: no authority, no admission, no movement. They exist so the
 * probes can observe what the pinned server does with a fixed step, an input declaration, an
 * acknowledgement and a reconnection, using the region state the protocol package already declares.
 * Keeping them in one module also keeps each probe file about its own measurement.
 */

import { Room, type StepContext } from '@colyseus/core';
import { DIRECT_INPUT_FIELDS, DirectInputSchema, RegionSchema, type RegionSchema as RegionState } from '@udg/protocol/schema';

import type { DirectInputFrame } from './support.js';

/** Options a probe passes through `defineRoom(room, options)`. */
export interface ProbeRoomOptions {
  tickRate?: number;
  bufferMaxSize?: number;
  declareIdle?: boolean;
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

  override onJoin(client: { sessionId: string }): void {
    this.sessionIds.push(client.sessionId);
  }

  /** Read the buffer without consuming: size, ack counter and a peek of the pending frames. */
  observeBuffer(sessionId: string): void {
    const accessor = this.inputs?.get(sessionId);
    if (accessor === undefined) return;
    this.peeked = accessor.peek().length;
    this.accessorSize.push(accessor.size);
    this.consumedCounts.push(accessor.consumedCount);
  }

  /** Consume exactly one frame — the shared-world primitive `next()`. */
  consumeOne(sessionId: string, refuse = false): void {
    const accessor = this.inputs?.get(sessionId);
    if (accessor === undefined) return;
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
  override onLeave(client: { sessionId: string }, code?: number): void {
    this.leaves.push({ sessionId: client.sessionId, code });
    const seat = this.allowReconnection(client as never, 10);
    void seat
      .then((rejoined: { sessionId: string }) => {
        this.reconnections.push(rejoined.sessionId);
      })
      .catch(() => {
        this.reconnectionWindowsClosed += 1;
      });
  }

  override onDrop(client: { sessionId: string }): void {
    this.drops.push(client.sessionId);
  }
}

/** Rooms are created by the matchmaker, so a probe finds its instance through these registries. */
export const tickRooms: TickRoom[] = [];
export const inputRooms: InputRoom[] = [];
export const sessionRooms: SessionRoom[] = [];

export function lastOf<T>(entries: readonly T[]): T | undefined {
  return entries[entries.length - 1];
}
