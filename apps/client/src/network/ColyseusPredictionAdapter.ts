/**
 * The browser seat: the only place in `@udg/client` that names the pinned `@colyseus/sdk`.
 *
 * ## What this file is, and what it is not
 *
 * It is the **seat-side public-API wrapper** UDG-SPIKE-001 §5 asked for: create/join a region room with the
 * published SDK, read the seat's own replica row, and put validated direct frames on the fixed-step input
 * channel. It is **not** a predictor. Gate A's local-prediction and forced-correction limbs belong to this
 * spike's later slices, and a predictor written before PR-15's ack/state pairing is re-measured on the real
 * room would be a guess, so nothing here invents one: the seat publishes what the authority replicated and
 * nothing else. Every public SDK name this file uses is recorded in
 * `docs/integration/colyseus-0.18-api-map.md` §12.
 *
 * ## Why a declaration-checking exception is mentioned here at all
 *
 * `apps/client/tsconfig.json` carries `skipLibCheck: true` under **ADR-0004**, not ADR-0002 — ADR-0002 is
 * server-only and says so. The reason is measured, not assumed: with declaration checking on, importing this
 * module's public SDK surface produces three diagnostics and **all three are inside vendor `.d.ts` files**
 * (`@colyseus/core`'s router default-importing `node:http`, and two `UnionToIntersection` constraint defects
 * inside `@colyseus/sdk`'s own HTTP types). That inventory is pinned in
 * `docs/integration/colyseus-client-declaration-inventory.json` and a retained strict check
 * (`pnpm --filter @udg/client typecheck:declarations`) re-produces it on every run, so a new vendor
 * diagnostic becomes a review event instead of a silent improvement in compiler output. First-party code keeps
 * full strict checking, and the misuse controls in `tests/contracts/UDG-SPIKE-001.test.ts` prove an unsupported
 * SDK call or an invalid frame still fails to compile while the exception is in force.
 *
 * ## The rules this file obeys
 *
 * - **Public, documented API only.** No private field, no cast past a declaration, no invented member. The
 *   replica shape is declared structurally (`RegionReplicaRow`) and **every value read off it is checked**
 *   before it leaves this module: a row this module cannot check is reported in `snapshot().issues`, never
 *   coerced and never dropped in silence.
 * - **Nothing on the received schema is mutated.** `room.state` is read only. `room.input().data` is the SDK's
 *   own staging object and the only thing this file writes, and a frame goes through `validateDirectFrame`
 *   (`@udg/protocol`, the accepted trust boundary) *before* it is staged — an out-of-domain axis or a stale
 *   epoch is refused here, not by the server.
 * - **No credentials.** `room.reconnectionToken` is never read, stored, logged or returned: the seat's
 *   observable surface is the room id, the session id and the server-issued epoch, so there is nothing here
 *   for evidence sanitisation to hunt for (docs/validation/evidence-requirements.md §19.1).
 */

import { Client } from '@colyseus/sdk';
import { validateDirectFrame, type DirectFrame, type MovementMode, type SessionEpoch } from '@udg/protocol';

/** The join presentation the room's hash gate demands (protocol-v1 §6.3; `screenJoin` on the server). */
export interface RegionJoinPresentation {
  readonly protocolVersion: string;
  readonly configHash: string;
  readonly manifestHash: string;
}

/** How the seat reaches a room: create one, or join the one a peer already created. */
export type RegionJoinTarget =
  | { readonly mode: 'create'; readonly roomName: string }
  | { readonly mode: 'byId'; readonly roomId: string };

/**
 * A player row as the pinned server replicates it (`packages/protocol/src/schema/PlayerSchema.ts`), narrowed
 * to the fields the spike reads. Structural and `readonly` on purpose: this is the client's *view* of the
 * authority's row, and decoder output is untrusted input, so `readRow` checks every field before this shape
 * reaches a caller.
 */
export interface RegionReplicaRow {
  readonly entityId: string;
  readonly sessionEpoch: number;
  readonly lastAuthorityTick: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly movementMode: number;
  readonly connected: boolean;
}

/** The region header plus the player map, as replicated (`RegionSchema`). */
export interface RegionReplicaState {
  readonly worldId: string;
  readonly regionId: string;
  readonly serverTick: number;
  readonly protocolVersion: string;
  readonly configVersion: string;
  readonly configHash: string;
  readonly manifestHash: string;
  readonly players: {
    readonly size: number;
    forEach(callback: (row: RegionReplicaRow, key: string) => void): void;
  };
}

/** One seat's authoritative row, checked. The mode name comes from the uint8 declaration order. */
export interface SeatObservation {
  readonly key: string;
  readonly entityId: string;
  readonly sessionEpoch: SessionEpoch;
  readonly lastAuthorityTick: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly movementMode: number;
  readonly movementModeName: MovementMode;
  readonly connected: boolean;
}

/** Everything one state delivery told the seat. The peer list is the authority's, not the seat's guess. */
export interface RegionSnapshot {
  readonly serverTick: number;
  readonly deliveries: number;
  readonly self: SeatObservation | null;
  readonly peers: readonly SeatObservation[];
  /** Shape problems found while reading: a row that cannot be checked is named here, never dropped. */
  readonly issues: readonly string[];
}

/** The fixed-step facts the server advertised through the join handshake. */
export interface AdvertisedStep {
  readonly tickRate: number | undefined;
  readonly stepMs: number | undefined;
  readonly patchRate: number | undefined;
}

/** A direct movement request from the seat's own input source, before authority stamps are attached. */
export interface DirectMovementRequest {
  readonly generation: number;
  readonly moveX: number;
  readonly moveZ: number;
}

export interface PredictionAdapterOptions {
  /** Matchmake endpoint, e.g. `http://127.0.0.1:PORT`. The SDK derives the WebSocket URL from it. */
  readonly endpoint: string;
  readonly join: RegionJoinTarget;
  readonly presentation: RegionJoinPresentation;
  /** How long to wait for the replica row carrying this seat's issued epoch. */
  readonly epochTimeoutMs?: number;
}

/** A frame the seat put on the wire, as the seat recorded it. */
export interface SentFrame {
  readonly seq: number;
  readonly generation: number;
  readonly frame: DirectFrame;
}

export interface PredictionSeat {
  readonly roomId: string;
  readonly sessionId: string;
  /** The epoch the room issued for this seat, read off the seat's own replica row — never self-asserted. */
  epoch(): SessionEpoch | null;
  /** The server-advertised fixed step. An `undefined` field means the room advertised no rate. */
  advertised(): AdvertisedStep;
  /** Validate locally, stage on the SDK input handle, transmit exactly one input. */
  sendDirect(request: DirectMovementRequest): SentFrame;
  /** A neutral keepalive frame: `directIntent: false`, zero axes, still one input on the wire. */
  sendNeutral(generation: number): SentFrame;
  /** The last delivery's authoritative snapshot, with this seat's row separated from the peers'. */
  snapshot(): RegionSnapshot;
  /** State deliveries received since the seat joined. */
  deliveries(): number;
  /** The ack the authority last published for this handle (`InputHandle.lastProcessed`). */
  acknowledged(): number;
  /** Inputs this handle has transmitted (`InputHandle.sentCount`). */
  sentCount(): number;
  /** Close the seat with consent and stop publishing. Idempotent. */
  close(): Promise<void>;
}

/**
 * The uint8 replica encoding of `MovementMode`, in declaration order — the same order
 * `packages/protocol/src/mapping/to-replica.ts` writes, restated here because `@udg/protocol/mapping` is not
 * an entry point the browser client may import (boundary table). A code outside this table is an issue.
 */
const MOVEMENT_MODE_BY_CODE: Readonly<Record<number, MovementMode>> = { 0: 'idle', 1: 'direct', 2: 'path' };

/** The fields `readRow` must see as finite numbers, and which of them must also be integers. */
const ROW_INTEGER_FIELDS = new Set<string>(['sessionEpoch', 'lastAuthorityTick']);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const isInteger = (value: unknown): value is number => isFiniteNumber(value) && Number.isInteger(value);

type RowRead = { readonly ok: true; readonly value: SeatObservation } | { readonly ok: false; readonly issue: string };

/**
 * Read one replicated row into a checked observation.
 *
 * The answer is a union, not an exception: a malformed row inside a patch burst is a finding the spike's
 * evidence has to name — which row, which field — rather than a delivery that quietly lost a seat.
 */
const readRow = (key: string, row: RegionReplicaRow): RowRead => {
  if (typeof key !== 'string' || key.length === 0) return { ok: false, issue: 'row key is not a non-empty string' };
  if (typeof row !== 'object' || row === null) return { ok: false, issue: `row ${key} is not an object` };
  if (typeof row.entityId !== 'string' || row.entityId.length === 0) return { ok: false, issue: `row ${key} carries no entityId string` };
  for (const field of ['sessionEpoch', 'lastAuthorityTick', 'x', 'y', 'z', 'movementMode'] as const) {
    const value: unknown = row[field];
    // `sessionEpoch` and `lastAuthorityTick` are uint32 on the wire, so an integer is required; the axes stay
    // float64 (ADR-0001 keeps them lossless), where finiteness is the domain rule.
    const inDomain = ROW_INTEGER_FIELDS.has(field) ? isInteger(value) : isFiniteNumber(value);
    if (!inDomain) return { ok: false, issue: `row ${key} field ${field} is not in domain: ${String(value)}` };
  }
  if (typeof row.connected !== 'boolean') return { ok: false, issue: `row ${key} connected is not a boolean` };
  const modeName = MOVEMENT_MODE_BY_CODE[row.movementMode];
  if (modeName === undefined) {
    return { ok: false, issue: `row ${key} movementMode ${String(row.movementMode)} is outside the declared enum` };
  }
  // Epoch 0 is the schema default, which means "never issued": a row claiming 0 is not a seat.
  if (row.sessionEpoch < 1) return { ok: false, issue: `row ${key} sessionEpoch ${String(row.sessionEpoch)} was never issued` };
  return {
    ok: true,
    value: {
      key,
      entityId: row.entityId,
      sessionEpoch: row.sessionEpoch,
      lastAuthorityTick: row.lastAuthorityTick,
      x: row.x,
      y: row.y,
      z: row.z,
      movementMode: row.movementMode,
      movementModeName: modeName,
      connected: row.connected,
    },
  };
};

/** The writable staging shape of the room's advertised input schema (`DirectInputSchema`). */
interface StagedDirectInput {
  sessionEpoch: number;
  generation: number;
  directIntent: boolean;
  moveX: number;
  moveZ: number;
  seq: number;
}

/**
 * Join a region room as a seat, over the published SDK surface.
 *
 * The promise resolves once the room has issued an epoch **and** that epoch has arrived in this seat's own
 * replica row — the UDG-003 harness's issued-epoch wait, because a frame stamped with an epoch the client
 * invented is refused by design, and the epoch a seat may stamp with is the one the server issued.
 */
export const joinPredictionSeat = async (options: PredictionAdapterOptions): Promise<PredictionSeat> => {
  const epochTimeoutMs = options.epochTimeoutMs ?? 10_000;
  const client = new Client(options.endpoint);

  // `rootSchema` is deliberately absent: the pinned server's state reflection and `defineInput` reflection
  // rebuild the state serializer and the input schema during the handshake (api map §12), which is what lets a
  // browser carry no schema declaration of its own.
  const room =
    options.join.mode === 'create'
      ? await client.create<RegionReplicaState>(options.join.roomName, options.presentation)
      : await client.joinById<RegionReplicaState>(options.join.roomId, options.presentation);

  const sessionId = room.sessionId;
  const roomId = room.roomId;

  let deliveries = 0;
  let latest: RegionSnapshot = { serverTick: 0, deliveries: 0, self: null, peers: [], issues: [] };
  let closed = false;
  const epochWaiters: (() => void)[] = [];

  const readSnapshot = (): RegionSnapshot => {
    const state = room.state;
    if (state === undefined || state === null || state.players === undefined) {
      return { serverTick: 0, deliveries, self: null, peers: [], issues: ['no replicated state yet'] };
    }
    const issues: string[] = [];
    const rows: SeatObservation[] = [];
    state.players.forEach((row, key) => {
      const read = readRow(key, row);
      if (read.ok === false) {
        issues.push(read.issue);
        return;
      }
      rows.push(read.value);
    });
    // The seat's own row is the one whose key or entityId is this session id; everything else in the room is
    // a peer. The partition happens here, after the loop, so `self` cannot be left narrowed to `null` by a
    // callback the compiler cannot prove ran.
    const own = rows.filter((row) => row.key === sessionId || row.entityId === sessionId);
    const peers = rows.filter((row) => row.key !== sessionId && row.entityId !== sessionId);
    return {
      serverTick: state.serverTick,
      deliveries,
      self: own[0] ?? null,
      peers,
      issues,
    };
  };

  const wakeEpochWaiters = (): void => {
    if (epochWaiters.length === 0) return;
    const waiters = [...epochWaiters];
    epochWaiters.length = 0;
    for (const wake of waiters) wake();
  };

  room.onStateChange(() => {
    deliveries += 1;
    latest = readSnapshot();
    if (latest.self !== null) wakeEpochWaiters();
  });

  const waitForEpoch = async (): Promise<void> => {
    const first = readSnapshot();
    latest = first;
    if (first.self !== null) return;
    await new Promise<void>((resolve, reject) => {
      const wake = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const at = epochWaiters.indexOf(wake);
        if (at >= 0) epochWaiters.splice(at, 1);
        reject(new Error(`no replica row carrying a server-issued epoch within ${String(epochTimeoutMs)} ms`));
      }, epochTimeoutMs);
      epochWaiters.push(wake);
    });
  };

  await waitForEpoch();

  const input = room.input<StagedDirectInput>();

  const stage = (request: DirectMovementRequest, directIntent: boolean): SentFrame => {
    if (closed) throw new Error('the seat is closed and sends nothing');
    const epoch = latest.self?.sessionEpoch;
    if (epoch === undefined) throw new Error('the seat has no server-issued epoch yet');
    // The accepted trust boundary runs before anything is staged: an out-of-domain axis, an out-of-range
    // generation or a frame that does not carry the current epoch never reaches the wire.
    const verdict = validateDirectFrame(
      {
        sessionEpoch: epoch,
        generation: request.generation,
        directIntent,
        moveX: request.moveX,
        moveZ: request.moveZ,
      },
      { sessionEpoch: epoch },
    );
    if (verdict.ok === false) throw new Error(`frame refused locally: ${verdict.code}`);
    const expectedSeq = input.sentCount + 1;
    input.data.sessionEpoch = epoch;
    input.data.generation = verdict.value.generation;
    input.data.directIntent = verdict.value.directIntent;
    input.data.moveX = verdict.value.moveX;
    input.data.moveZ = verdict.value.moveZ;
    input.data.seq = expectedSeq;
    const seq = input.send();
    return { seq, generation: verdict.value.generation, frame: verdict.value };
  };

  return {
    roomId,
    sessionId,
    epoch: () => latest.self?.sessionEpoch ?? null,
    advertised: () => ({ tickRate: input.tickRate, stepMs: input.stepMs, patchRate: input.patchRate }),
    sendDirect: (request) => stage(request, true),
    sendNeutral: (generation) => stage({ generation, moveX: 0, moveZ: 0 }, false),
    snapshot: () => latest,
    deliveries: () => deliveries,
    acknowledged: () => input.lastProcessed,
    sentCount: () => input.sentCount,
    close: async () => {
      if (closed) return;
      closed = true;
      room.onStateChange.clear();
      // A consented leave: it ends the seat and cancels the SDK's automatic reconnection, which is what keeps
      // a finished spike run from holding a room open. The reconnection token itself is never read.
      await room.leave();
    },
  };
};
