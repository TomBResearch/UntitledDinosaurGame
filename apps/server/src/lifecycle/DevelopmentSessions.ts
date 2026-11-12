/**
 * Development sessions and bounded reconnection (UDG-003 Phase 2, W-4/W-7 evidence surface).
 *
 * This is the development lifecycle, named as such on purpose: there is no production auth yet
 * (UDG-008 owns the client and its credentials), and what lives here is the smallest seat-keeping
 * facility the Phase 2 suites need — hand out synthetic session identities, hold a seat through
 * `Room.allowReconnection` for the declared window, and *log every outcome* so `room-lifecycle.json`
 * can say how many rejoins happened, how many windows closed, and that none of them was unbounded.
 *
 * The reconnect window is read from configuration (`network.reconnectWindowSeconds`) and capped
 * once more by a hard ceiling here, because PR-12 measured `allowReconnection` holding resources
 * without an application-visible timer — an unbounded window would be an unbounded leak, and
 * "bounded and logged" is the grant's own words.
 */

import type { Client } from '@colyseus/core';

/** Hard ceiling on any held reconnection window, whatever configuration asks for (milliseconds). */
export const MAX_RECONNECT_WINDOW_MS = 60_000;

export interface ReconnectionOutcome {
  readonly sessionId: string;
  readonly outcome: 'rejoined' | 'window-closed' | 'refused';
  readonly atMs: number;
}

/**
 * Hold seats through reconnection, bounded, with every resolution recorded.
 *
 * A room calls `hold()` from `onLeave` and never awaits it: the library's reconnection promise
 * resolves on a successful token rejoin and rejects when the window closes, and both branches are
 * *observations*, not control flow the tick depends on (the disposition record rebuilds from zero
 * for the next domain regardless of which branch won).
 */
export class DevelopmentSessions {
  readonly #outcomes: ReconnectionOutcome[] = [];
  readonly #windowMs: number;
  readonly #nowMs: () => number;
  #held = 0;

  constructor(windowMs: number, nowMs: () => number) {
    this.#windowMs = Math.min(Math.max(0, windowMs), MAX_RECONNECT_WINDOW_MS);
    this.#nowMs = nowMs;
  }

  get windowMs(): number {
    return this.#windowMs;
  }

  /** Seats currently inside an open reconnection window. */
  get held(): number {
    return this.#held;
  }

  /** Every resolution so far, in order, oldest first. */
  outcomes(): readonly ReconnectionOutcome[] {
    return [...this.#outcomes];
  }

  /**
   * Begin a bounded reconnection window for a departed seat.
   *
   * `allowReconnection` is called through the narrow `holdReconnection` port so this module never
   * reaches into `Room` internals; the room passes its own method.
   */
  hold(
    client: Client,
    holdReconnection: (client: Client, seconds: number) => Promise<unknown>,
    onWindowClosed: () => void = () => undefined,
  ): void {
    const sessionId = client.sessionId;
    if (this.#windowMs === 0) {
      this.#outcomes.push({ sessionId, outcome: 'refused', atMs: this.#nowMs() });
      return;
    }
    this.#held += 1;
    void holdReconnection(client, this.#windowMs / 1_000)
      .then(() => {
        this.#outcomes.push({ sessionId, outcome: 'rejoined', atMs: this.#nowMs() });
      })
      .catch(() => {
        this.#outcomes.push({ sessionId, outcome: 'window-closed', atMs: this.#nowMs() });
        onWindowClosed();
      })
      .finally(() => {
        this.#held -= 1;
      });
  }
}
