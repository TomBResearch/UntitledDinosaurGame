/**
 * Bounded structures (P03-f, P03-g).
 *
 * Nothing in the authority core may grow without a declared capacity, and every overflow is refused
 * and counted rather than absorbed. Continuous overflow is **drop-newest**: it preserves arrival
 * order and cannot resurrect stale input, whereas drop-oldest would need its own justification
 * (readiness proposal §7).
 */

import type { CachedIdentity, ArrivalOrdinal } from './types.js';

/** A first-in-first-out queue with a fixed capacity and counted, deterministic overflow. */
export class BoundedFifo<T> {
  readonly capacity: number;

  readonly #items: T[] = [];
  #overflowCount = 0;
  #highWater = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`a bounded queue needs a positive integer capacity, received ${String(capacity)}`);
    }
    this.capacity = capacity;
  }

  get size(): number {
    return this.#items.length;
  }

  get overflowCount(): number {
    return this.#overflowCount;
  }

  get highWater(): number {
    return this.#highWater;
  }

  get items(): readonly T[] {
    return this.#items;
  }

  /** `false` means the newest item was refused; nothing already queued moved (drop-newest). */
  tryPush(item: T): boolean {
    if (this.#items.length >= this.capacity) {
      this.#overflowCount += 1;
      return false;
    }
    this.#items.push(item);
    this.#highWater = Math.max(this.#highWater, this.#items.length);
    return true;
  }

  /** Remove and return the oldest item — the item stage Q consumes. */
  shiftOldest(): T | undefined {
    return this.#items.shift();
  }

  /** Remove every item the predicate matches, returning them in arrival order. */
  removeWhere(predicate: (item: T) => boolean): T[] {
    const removed: T[] = [];
    const kept: T[] = [];
    for (const item of this.#items) {
      if (predicate(item)) removed.push(item);
      else kept.push(item);
    }
    this.#items.length = 0;
    for (const item of kept) this.#items.push(item);
    return removed;
  }

  clear(): T[] {
    const dropped = [...this.#items];
    this.#items.length = 0;
    return dropped;
  }

  snapshot(): readonly T[] {
    return [...this.#items];
  }
}

/** The identity cache's storage entry. `storedAtMs` comes from the injected time source, never `Date`. */
export interface IdentityEntry {
  readonly identity: CachedIdentity;
  readonly expiresAtMs: number;
}

/**
 * The terminal-request cache: 128 records per entity and epoch for 30 seconds (protocol.md 4.3,
 * `TERMINAL_REQUEST_CACHE_SIZE` / `TERMINAL_REQUEST_TTL_SECONDS`).
 *
 * Two properties matter for AC-19. A stored identity is **never overwritten**: a conflicting payload
 * is answered from the identity that authorises the dedupe, and that identity survives the conflict.
 * And {@link IdentityIndex.lookup} is read-only — expiry is evaluated at read time, so answering a
 * question cannot mutate the state screening is supposed to be free of (P03-b).
 */
export class IdentityCache {
  readonly capacity: number;
  readonly ttlMs: number;

  readonly #entries: IdentityEntry[] = [];
  #evictionCount = 0;
  #expiredReadCount = 0;

  /**
   * The cache holds no clock of its own (reviewer correction PA1-C6). A record's fate is decided against the
   * time the caller was given, so a lookup, the write that follows it and the journal row that records the
   * decision cannot disagree by taking separate readings. The TTL itself is unchanged: 30 s, measured from
   * the `storedAtMs` of the record.
   */
  constructor(capacity: number, ttlMs: number) {
    this.capacity = capacity;
    this.ttlMs = ttlMs;
  }

  get size(): number {
    return this.#entries.length;
  }

  get evictionCount(): number {
    return this.#evictionCount;
  }

  /** Reads that found a stored-but-expired record. Counted rather than silently deleted. */
  get expiredReadCount(): number {
    return this.#expiredReadCount;
  }

  /**
   * Non-mutating lookup: an expired record reads as absent and stays where it is.
   *
   * `nowMs` is the tick's captured reading, not a fresh one: expiry must be answered on the same instant
   * the tick recorded, or a replay could not reproduce which side of the boundary the request fell on.
   */
  lookup(
    entityId: string,
    sessionEpoch: number,
    requestId: string,
    nowMs: number,
  ): IdentityEntry | undefined {
    for (let index = this.#entries.length - 1; index >= 0; index -= 1) {
      const entry = this.#entries[index];
      if (entry === undefined) continue;
      const identity = entry.identity;
      if (
        identity.entityId === entityId &&
        identity.sessionEpoch === sessionEpoch &&
        identity.requestId === requestId
      ) {
        if (entry.expiresAtMs <= nowMs) {
          this.#expiredReadCount += 1;
          return undefined;
        }
        return entry;
      }
    }
    return undefined;
  }

  /**
   * Store a terminal record. An existing `(entityId, epoch, requestId)` identity is never replaced;
   * over-capacity evicts the oldest record first, which is deterministic and bounded.
   */
  store(identity: CachedIdentity): 'stored' | 'kept-existing' {
    for (const entry of this.#entries) {
      const existing = entry.identity;
      if (
        existing.entityId === identity.entityId &&
        existing.sessionEpoch === identity.sessionEpoch &&
        existing.requestId === identity.requestId
      ) {
        return 'kept-existing';
      }
    }
    this.#entries.push({ identity, expiresAtMs: identity.storedAtMs + this.ttlMs });
    while (this.#entries.length > this.capacity) {
      this.#entries.shift();
      this.#evictionCount += 1;
    }
    return 'stored';
  }

  /** Drop records whose TTL has passed at the time given. Called from the tick, never from a read. */
  compact(nowMs: number): number {
    const before = this.#entries.length;
    const kept = this.#entries.filter((entry) => entry.expiresAtMs > nowMs);
    this.#entries.length = 0;
    for (const entry of kept) this.#entries.push(entry);
    return before - this.#entries.length;
  }

  snapshot(): readonly IdentityEntry[] {
    return [...this.#entries];
  }
}

/** The per-tick batch registry: first occurrence wins, later ones share its disposition (P03-d). */
export class BatchRegistry<V> {
  readonly #entries = new Map<string, { readonly ordinal: ArrivalOrdinal; readonly value: V }>();

  get size(): number {
    return this.#entries.size;
  }

  set(requestId: string, ordinal: ArrivalOrdinal, value: V): void {
    this.#entries.set(requestId, { ordinal, value });
  }

  get(requestId: string): { readonly ordinal: ArrivalOrdinal; readonly value: V } | undefined {
    return this.#entries.get(requestId);
  }

  has(requestId: string): boolean {
    return this.#entries.has(requestId);
  }
}
