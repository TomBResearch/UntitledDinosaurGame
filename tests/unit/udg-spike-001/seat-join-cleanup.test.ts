/**
 * UDG-SPIKE-001 review fix (1) — a join the room accepted but the seat cannot finish must not leave a
 * listener, a waiter or a room behind.
 *
 * `joinPredictionSeat` joins with the pinned SDK, then waits for the server-issued epoch to appear in this
 * seat's replica row and finally takes the input handle. If either of those last two steps fails **after**
 * the join, the half-built seat must be unwound — `onStateChange` detached and the room left — before the
 * **original** error propagates, and the ordinary `close()` path must stay idempotent. The SDK is mocked at
 * the module boundary so the failure injection observes exactly what the seat does to the room it joined;
 * no server, browser or port is involved (the paired-seat smoke keeps the real-SDK proof).
 */

import { describe, expect, it, vi } from 'vitest';

/** How the next `joinPredictionSeat` call should behave once the (fake) room has accepted the join. */
type Scenario =
  | { readonly kind: 'epoch-timeout'; readonly leaveThrows: boolean }
  | { readonly kind: 'input-throws' }
  | { readonly kind: 'ok' };

/**
 * Everything the mock records and the tests observe. `vi.hoisted` so the hoisted `vi.mock` factory below
 * can close over it: one room is built per `new Client(...)` call, and each test sets `scenario` first.
 */
const recorder = vi.hoisted((): {
  scenario: Scenario;
  clearCalls: number;
  leaveCalls: number;
  liveCallbacks: number;
} => ({ scenario: { kind: 'ok' }, clearCalls: 0, leaveCalls: 0, liveCallbacks: 0 }));

// The SDK is a dependency of `apps/client`, not of the workspace root, so the mock names the package entry
// by its file path inside the client package: that resolves to the very module the seat's bare
// `@colyseus/sdk` import reaches (the package's pinned `import` export, `build/index.mjs`), which is what
// makes the interception apply to the seat module and not merely to this test file.
vi.mock('../../../apps/client/node_modules/@colyseus/sdk/build/index.mjs', () => {
  // The parts of the published room surface the seat touches, restated structurally for the fake. The
  // mock replaces the module, so no real SDK declaration has to be satisfied here.
  const makeRoom = (): {
    readonly roomId: string;
    readonly sessionId: string;
    readonly state: unknown;
    readonly onStateChange: ((callback: () => void) => void) & { clear: () => void };
    readonly input: () => unknown;
    readonly leave: () => Promise<void>;
  } => {
    const sessionId = 'session-fake-1';
    const callbacks: (() => void)[] = [];
    const row = {
      entityId: sessionId,
      sessionEpoch: 7,
      lastAuthorityTick: 3,
      x: 0.1,
      y: 0,
      z: 0,
      movementMode: 1,
      connected: true,
    };
    const rows = recorder.scenario.kind === 'epoch-timeout' ? [] : [[row, sessionId] as const];
    const state = {
      worldId: 'w',
      regionId: 'r',
      serverTick: 5,
      protocolVersion: '1',
      configVersion: 'v',
      configHash: 'hash',
      manifestHash: 'hash',
      players: {
        size: rows.length,
        forEach: (callback: (value: typeof row, key: string) => void): void => {
          for (const [value, key] of rows) callback(value, key);
        },
      },
    };
    const onStateChange = Object.assign(
      (callback: () => void): void => {
        callbacks.push(callback);
        recorder.liveCallbacks = callbacks.length;
      },
      {
        clear: (): void => {
          recorder.clearCalls += 1;
          callbacks.length = 0;
          recorder.liveCallbacks = 0;
        },
      },
    );
    return {
      roomId: 'room-fake-1',
      sessionId,
      // A row with this session id is present unless the scenario withholds it (the failed-epoch-wait path).
      state,
      onStateChange,
      input: (): unknown => {
        if (recorder.scenario.kind === 'input-throws') throw new Error('input handle unavailable');
        let sentCount = 0;
        return {
          data: {},
          send: (): number => {
            sentCount += 1;
            return sentCount;
          },
          get sentCount(): number {
            return sentCount;
          },
          lastProcessed: 0,
          tickRate: 20,
          stepMs: 50,
          patchRate: 100,
        };
      },
      leave: async (): Promise<void> => {
        recorder.leaveCalls += 1;
        if (recorder.scenario.kind === 'epoch-timeout' && recorder.scenario.leaveThrows) {
          throw new Error('leave refused');
        }
      },
    };
  };

  class FakeClient {
    constructor(public readonly endpoint: string) {}

    async create(_name: string, _options: unknown): Promise<unknown> {
      return makeRoom();
    }

    async joinById(_roomId: string, _options: unknown): Promise<unknown> {
      return makeRoom();
    }
  }

  return { Client: FakeClient };
});

// Imported after the mock registration so the seat module resolves the fake `Client`.
const { joinPredictionSeat } = await import('../../../apps/client/src/network/ColyseusPredictionAdapter.js');

const join = (mode: 'create' | 'byId') =>
  joinPredictionSeat({
    endpoint: 'http://127.0.0.1:0',
    join: mode === 'create' ? { mode: 'create', roomName: 'region' } : { mode: 'byId', roomId: 'room-fake-1' },
    presentation: { protocolVersion: '1', configHash: 'hash', manifestHash: 'hash' },
    epochTimeoutMs: 25,
  });

describe('UDG-SPIKE-001 — a failed post-join step unwinds the half-built seat', () => {
  it('epoch-wait rejection detaches the state callback and leaves the joined room, preserving the original error', async () => {
    recorder.scenario = { kind: 'epoch-timeout', leaveThrows: false };
    recorder.clearCalls = 0;
    recorder.leaveCalls = 0;
    await expect(join('create')).rejects.toThrow(/no replica row carrying a server-issued epoch within 25 ms/);
    expect(recorder.clearCalls, 'the state callback was detached').toBe(1);
    expect(recorder.leaveCalls, 'the newly joined room was left').toBe(1);
    expect(recorder.liveCallbacks, 'no state callback stays attached after the rejection').toBe(0);
  });

  it('a leave that itself fails still surfaces the original epoch-wait error', async () => {
    recorder.scenario = { kind: 'epoch-timeout', leaveThrows: true };
    recorder.clearCalls = 0;
    recorder.leaveCalls = 0;
    await expect(join('byId')).rejects.toThrow(/no replica row carrying a server-issued epoch within 25 ms/);
    expect(recorder.clearCalls, 'cleanup ran to its own failure point').toBe(1);
    expect(recorder.leaveCalls, 'the leave was still attempted once').toBe(1);
  });

  it('an input handle that throws detaches the callback and leaves the room, preserving that error', async () => {
    recorder.scenario = { kind: 'input-throws' };
    recorder.clearCalls = 0;
    recorder.leaveCalls = 0;
    await expect(join('byId')).rejects.toThrow('input handle unavailable');
    expect(recorder.clearCalls, 'the state callback was detached').toBe(1);
    expect(recorder.leaveCalls, 'the newly joined room was left').toBe(1);
    expect(recorder.liveCallbacks, 'no state callback stays attached after the rejection').toBe(0);
  });

  it('an ordinary close stays idempotent and detaches exactly once', async () => {
    recorder.scenario = { kind: 'ok' };
    recorder.clearCalls = 0;
    recorder.leaveCalls = 0;
    const seat = await join('create');
    expect(seat.epoch(), 'the seat joined and saw its issued epoch').toBe(7);
    await seat.close();
    await seat.close();
    expect(recorder.clearCalls, 'close detaches once').toBe(1);
    expect(recorder.leaveCalls, 'close leaves once — the second close is a no-op').toBe(1);
    expect(() => seat.sendDirect({ generation: 1, moveX: 0, moveZ: 1 }), 'a closed seat sends nothing').toThrow(/closed/);
  });
});
