/**
 * `RegionRoom` — the real region room (UDG-003 Phase 2, W-4/W-5/W-6).
 *
 * The room owns exactly four things, each of them an ownership claim the protocol and the ADR make
 * of a transport, not a convenience:
 *
 * 1. **The hash gate.** A seat exists only after `screenJoin` accepts the exact
 *    `{ protocolVersion, configHash, manifestHash }` triple against *this* room's live configuration.
 * 2. **The UDG epoch.** Issued here, one per connection domain, never reused, never read from
 *    `InputHandle.epoch` (PR-12; join-validation.ts).
 * 3. **The consumption posture.** At most one FIFO-selected observation per entity per tick, taken
 *    from the accessor by `SessionInputState.observe`, projected to the five-field core frame, and
 *    ingested into the accepted Phase 1 core. Every movement decision runs in the core; nothing in
 *    this file can produce one. A wire frame that fails validation is ingested **as projected** —
 *    the core's refusal is its disposition and the neutral step represents it (ADR-0003 §3.1, GA-4).
 * 4. **The consequences (§3.3).** Pressure throttles and is recorded; a confirmed retirement opens
 *    the bounded closure window with one forced final publication; the rate ceiling closes directly;
 *    the strand signature is recorded and **cannot close** — this class contains no code path that
 *    terminates a seat for it, and the configuration flag stays false until PE-1…PE-5 pass
 *    (GA-12, D-P2-6).
 *
 * Receipt order survives revision 5 unchanged: input frames are ingested in accessor order and
 * message-channel arrivals are ingested in the handler call itself, so no arrival overtakes one
 * already waiting to be admitted, and the core's own intake/cutoff rule does the rest.
 */

import { randomUUID } from 'node:crypto';

import { Room, defineRoom, type Client, type RegisteredHandler } from '@colyseus/core';
import {
  coreFrameOfWireFrame,
  validateDirectWireFrame,
  validateMoveTo,
  validateCancelPath,
  RESERVED_CLOSE_CODES,
  type DirectWireFrame,
  type EntityId,
  type ServerTick,
} from '@udg/protocol';
import { RegionSchema, DirectInputSchema } from '@udg/protocol/schema';
import {
  DEFAULT_SERVER_CONFIG,
  computeConfigHash,
  regionHash,
  withConfigOverrides,
  validateServerConfig,
} from '@udg/config';
import type { ServerConfig } from '@udg/config';

import { SessionInputState, type CloseObservation, type InputSignal } from '../network/ColyseusInputAdapter.js';
import { EpochIssuer, screenJoin, spawnFor } from '../network/join-validation.js';
import { buildMovementAuthority, authorityEntityId, type MovementAuthority } from '../movement/MovementAuthorityAdapter.js';
import { publishPlayer, publishRegion, unpublishPlayer } from '../state/map-player.js';
import { DevelopmentSessions } from '../lifecycle/DevelopmentSessions.js';
import { TickMetrics } from '../telemetry/tick-metrics.js';
import type { TickChainRecord } from '../authority/journal.js';
import type { JournalRow, PrologueRow } from '../authority/types.js';

/**
 * The operator channel, authenticated.
 *
 * `onCreate(options)` receives *matchmaker options merged with whatever the joining client sent* —
 * that is how Colyseus passes create options, and a room that read them raw would let a client
 * choose its own region bounds and then "pass" the hash gate with the configuration it had just
 * picked. So the deployment travels with a per-process nonce the client cannot observe or guess:
 * options without it are untrusted and are ignored entirely, which leaves a client-authored create
 * with the defaults (no bounds, a room that refuses to exist) — the only safe answer to "who said
 * this room should have these numbers?" when the answer is "a client did".
 */
const OPERATOR_NONCE = randomUUID();

/** Build the registered handler the operator (or an in-process test) uses. */
export const defineOperatorRegionRoom = (deployment: RegionRoomOptions = {}): RegisteredHandler =>
  defineRoom(RegionRoom, { deploymentNonce: OPERATOR_NONCE, deployment });

/** Options the operator (or a test) hands `defineRoom`. Nothing here is client-controlled. */
export interface RegionRoomOptions {
  /** Partial configuration overrides; region bounds are required (D5: no invented default). */
  readonly config?: Parameters<typeof withConfigOverrides>[1];
  readonly runId?: string;
  readonly regionProvenance?: string;
  /** Cap on journalled rows kept in the room for evidence export; 0 keeps none. */
  readonly journalRetention?: number;
}

/** One seat: the association this room owns, plus the transport state for its current domain. */
interface Seat {
  readonly sessionId: string;
  readonly entityId: EntityId;
  epoch: number;
  readonly input: SessionInputState;
  throttled: boolean;
  /** Open closure window, §3.3; `null` while the seat is not closing. */
  closing: null | {
    readonly openedAtMs: number;
    readonly deadlineMs: number;
    readonly reason: number;
    finalPublished: boolean;
  };
  /** Counted effects already charged to the ledger, keyed by (epoch, requestId). */
  readonly countedEffects: Set<string>;
}

/** Mutable draft used inside `tick()`; readers see the frozen `RoomTickRecord` shape. */
interface RoomTickDraft {
  tick: number;
  consumed: { entityId: string; seq: number }[];
  refused: { entityId: string; count: number }[];
  signals: { entityId: string; signal: InputSignal }[];
  closures: { entityId: string; code: number }[];
  maxDepth: number;
}

/** Per-tick room record for the Phase 2 vectors. */
export interface RoomTickRecord {
  readonly tick: number;
  readonly consumed: readonly { readonly entityId: string; readonly seq: number }[];
  readonly refused: readonly { readonly entityId: string; readonly count: number }[];
  readonly signals: readonly { readonly entityId: string; readonly signal: InputSignal }[];
  readonly closures: readonly { readonly entityId: string; readonly code: number }[];
  readonly maxDepth: number;
}

/** A journalling sink with a retention cap: evidence without a second unbounded growth path. */
class BoundedJournalSink {
  readonly rows: JournalRow[] = [];
  readonly chain: TickChainRecord[] = [];
  #dropped = 0;
  #limit: number;

  constructor(limit: number) {
    this.#limit = limit;
  }

  #push<T>(list: T[], item: T): void {
    if (this.#limit === 0) return;
    if (list.length >= this.#limit) {
      this.#dropped += 1;
      return;
    }
    list.push(item);
  }

  recordRow(row: JournalRow): void {
    this.#push(this.rows, row);
  }

  recordTickChain(record: TickChainRecord): void {
    this.#push(this.chain, record);
  }

  get dropped(): number {
    return this.#dropped;
  }
}

export class RegionRoom extends Room<{ state: RegionSchema; input: DirectWireFrame }> {
  #configValue: Readonly<ServerConfig> = DEFAULT_SERVER_CONFIG;
  #authority!: MovementAuthority;
  #sink = new BoundedJournalSink(0);
  #seats = new Map<string, Seat>();
  #epochIssuer = new EpochIssuer();
  #sessions!: DevelopmentSessions;
  readonly metrics = new TickMetrics();
  readonly tickRecords: RoomTickRecord[] = [];
  /** Close-path observations, one per departed seat, §3.1: never summed with each other. */
  readonly closeObservations: (CloseObservation & { entityId: EntityId })[] = [];
  /** Refusals recorded for evidence; a rejected join never becomes a seat. */
  readonly joinRefusals: { reason: string; detail: string; atMs: number }[] = [];
  #startedAtMs = 0;
  #lastTickRecord: RoomTickRecord | null = null;

  get config(): Readonly<ServerConfig> {
    return this.#configValue;
  }

  /** Live identity triple a client must match (also what tests present on join). */
  joinAuthorityIdentity(): { protocolVersion: string; configHash: string; manifestHash: string } {
    return {
      protocolVersion: this.#configValue.protocolVersion,
      configHash: computeConfigHash(this.#configValue),
      manifestHash: regionHash(this.#configValue),
    };
  }

  override onCreate(raw: unknown = {}): void {
    this.autoDispose = false;
    const options: RegionRoomOptions = trustedDeployment(raw) ?? {};
    const configured = withConfigOverrides(this.#configValue, options.config ?? {});
    const validated = validateServerConfig(JSON.parse(JSON.stringify(configured)));
    if (validated.ok === false) {
      // A room that cannot name its configuration refuses to exist; the matchmaker surfaces this as
      // a failed create, which is the honest place for "this deployment has no region" (D5).
      throw new Error(`RegionRoom configuration refused: ${validated.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
    }
    this.#configValue = validated.value;
    this.#startedAtMs = Math.trunc(globalThis.performance.now());
    this.#sessions = new DevelopmentSessions(
      this.#configValue.network.reconnectWindowSeconds * 1_000,
      () => this.nowMs(),
    );

    this.#sink = new BoundedJournalSink(options.journalRetention ?? 20_000);
    const built = buildMovementAuthority({
      config: this.#configValue,
      sink: this.#sink,
      runId: options.runId ?? 'udg-003-phase-2-room',
      ...(options.regionProvenance === undefined ? {} : { regionProvenance: options.regionProvenance }),
    });
    if (built.ok === false) throw new Error(`RegionRoom authority refused: ${built.failure}`);
    this.#authority = built.authority;
    // The registry sees only rooms that *exist*. Joining it before the gates ran left refused rooms
    // as zombies a telemetry reader would trip over — measured, not theorised, by the W-10
    // unbounded-refusal scenario, whose refused room answered `evidence()` with a TypeError.
    RegionRoom.live.add(this);

    this.setState(new RegionSchema());
    const header = publishRegion(this.state, {
      worldId: this.#configValue.region.worldId,
      regionId: this.#configValue.region.regionId,
      serverTick: 0 as ServerTick,
      protocolVersion: this.#configValue.protocolVersion,
      configVersion: this.#configValue.protocolVersion,
      configHash: computeConfigHash(this.#configValue),
      manifestHash: regionHash(this.#configValue),
    });
    if (header.ok === false) throw new Error(`RegionRoom header refused: ${header.issues.join('; ')}`);

    // The sequenced input, declared once (PR-15's substrate, now on the shipped schema): the room
    // reads back exactly the stamp the client stamped, and `at(seq)` resolves pending frames by it.
    // No `sanitize`: it rewrites decoded values in place and would hide from validation exactly the
    // values UDG must refuse (PR-3).
    this.inputs = this.defineInput(DirectInputSchema, {
      bufferMaxSize: this.#configValue.input.bufferMaxSize,
      seqField: 'seq',
    });

    // Patch cadence and step cadence are separate declared knobs (PR-15 S7 measured the skew).
    this.patchRate = this.#configValue.network.statePatchIntervalMs;
    // The library ceiling is declared as defence in depth; the room's own observed-rate path
    // (§3.3 INPUT_RATE_CEILING) is what closes with the reserved code.
    this.maxMessagesPerSecond = this.#configValue.input.rateCeilingMessagesPerSecond;

    this.onMessage('moveTo', (client: Client, payload: unknown): void => {
      this.ingestCommand(client, payload, 'moveTo');
    });
    this.onMessage('cancelPath', (client: Client, payload: unknown): void => {
      this.ingestCommand(client, payload, 'cancelPath');
    });

    // The second argument is the step FREQUENCY, not a millisecond interval — passing
    // `network.simulationStepSeconds * 1000` = 50 asked for 50 Hz while the hashed configuration
    // declares 20: measured 49.5 Hz against 19.5 Hz on this machine in an idle two-second window, so
    // the room stepped two and a half times faster than the §2 envelope's λ = 1 frame per tick assumes.
    // That drains each seat's buffer faster than it can fill, which is why the W-10 population could not
    // reach the pressure line at any send rate. The authority's own clock still decides which ticks move
    // the simulation; this number only decides how often the room gets the chance.
    this.setFixedTimestep((): void => {
      this.tick();
    }, this.#configValue.network.tickRate);
  }

  nowMs(): number {
    return this.#authority.time.nowMs();
  }

  // --- Lifecycle ----------------------------------------------------------------------------------

  override onJoin(client: Client, options: unknown): void {
    const decision = screenJoin(options, this.joinAuthorityIdentity());
    if (decision.ok === false) {
      this.joinRefusals.push({ reason: decision.reason, detail: decision.detail, atMs: this.nowMs() });
      // Standard WebSocket policy violation (1008): the seat is refused at the hash gate. No UDG
      // close code is invented here — protocol-v1 §6.6 reserves exactly three, and a refused join
      // is not one of them.
      client.leave(1008);
      return;
    }
    const entityId = authorityEntityId(client.sessionId);
    const bounds = this.#configValue.region.bounds;
    if (bounds === null) {
      // Unreachable in a constructed room — the core refuses to build without bounds (D5). Kept as
      // a refusal rather than an assertion, because "no invented spawn" is the same rule.
      this.joinRefusals.push({ reason: 'no-region', detail: 'room has no region bounds', atMs: this.nowMs() });
      client.leave(1008);
      return;
    }
    const existing = this.#seats.get(client.sessionId);
    const epoch = this.#epochIssuer.issue();
    if (existing === undefined) {
      const seat: Seat = {
        sessionId: client.sessionId,
        entityId,
        epoch,
        input: new SessionInputState(),
        throttled: false,
        closing: null,
        countedEffects: new Set<string>(),
      };
      this.#seats.set(client.sessionId, seat);
      this.beginDomain(seat, client.sessionId);
      this.#authority.core.join(entityId, epoch, spawnFor(bounds));
    } else {
      // A reconnection rejoins the same session id with a fresh epoch: the stamp domain restarts
      // (PR-15), so the record is rebuilt from zero and the core sees an epoch change, never a join.
      existing.epoch = epoch;
      existing.input.beginDomain(this.#authorityInput(client.sessionId));
      existing.closing = null;
      // See `handleRejoin`: after a drop the entity's bookkeeping was released with the leave, so
      // the legal re-entry is `join` under the fresh epoch, not a renewal of a released entity.
      this.#authority.core.join(existing.entityId, epoch, spawnFor(bounds));
    }
  }

  override onLeave(client: Client): void {
    const seat = this.#seats.get(client.sessionId);
    if (seat === undefined) return;
    // §3.1's separate close observations, sampled before anything resets. Whether a still-buffered
    // frame advances the accessor's consumed count at close is the open W-9 measurement; this is
    // where the answer is sampled, including the `undefined` case, which is itself an answer.
    this.closeObservations.push({
      ...seat.input.closeObservation(this.#authorityInputOrUndefined(client.sessionId), this.nowMs()),
      entityId: seat.entityId,
    });
    this.#authority.core.leave(seat.entityId);
    // The drop itself is a server-observed departure: journal it as `leave` now, so the entity's
    // lifecycle leaves `connected` and a later reconnection is the legal `epochChange` transition
    // rather than an impossible one. If the window closes without a rejoin, `expire` is the second,
    // distinct observation (below); the journal keeps the two apart exactly as the core defines them.
    this.#authority.core.leave(seat.entityId);
    // Bounded reconnection over the declared window; every outcome is logged by DevelopmentSessions.
    // The authority call for a departed seat fires when the window CLOSES, not on the drop: a
    // deliberate leave and a lost connection both arrive as `onLeave`, and the server's honest
    // statement at that moment is "this domain is held, pending expiry" — `expire()` is the
    // server-observed loss of the domain, which is exactly what the journal should carry (the
    // lifecycle authority never comes from a client payload, §8.3 invariant 5). A rejoin answers
    // with a fresh epoch through `onJoin` instead.
    this.#sessions.hold(
      client,
      (target, seconds) => new Promise<unknown>((resolved, rejected) => {
        // `allowReconnection` returns the library's Deferred, which is thenable but not a native
        // promise; the seam is declared as a promise, so the room adapts rather than leaks.
        this.allowReconnection(target, seconds).then(() => {
          // The server's observable moment of a successful rejoin is THIS resolution: no `onJoin`
          // fires for a reconnected session. The epoch is issued here, the transport record's stamp
          // domain restarts here, and the core is told through `epochChange` — all on the server
          // call path, none of it inferred from a payload (§8.3 invariant 5).
          this.handleRejoin(seat);
          resolved(undefined);
        }, (error: unknown) => {
          rejected(error);
        });
      }),
      () => {
        if (!this.#seats.has(seat.sessionId)) return;
        this.#authority.core.expire(seat.entityId);
        unpublishPlayer(this.state, seat.entityId);
        this.#seats.delete(seat.sessionId);
      },
    );
  }

  override onDispose(): void {
    // A room refused during construction is disposed before any authority exists (no operator
    // bounds is the live case). The refusal is the fact this room produced; disposing it must not
    // turn that fact into a TypeError over a clock that was never built.
    if (this.#authority !== undefined) this.#authority.clock.stop();
    RegionRoom.live.delete(this);
  }

  // --- Tick ---------------------------------------------------------------------------------------

  /** One tick: consume (posture), ingest (order), step (core), publish (record), consequences. */
  tick(): void {
    const nowMs = this.nowMs();
    const envelope = this.#configValue.input;
    const record: RoomTickDraft = {
      tick: this.#authority.core.tick,
      consumed: [],
      refused: [],
      signals: [],
      closures: [],
      maxDepth: 0,
    };

    // Deterministic iteration: ascending session id, so a tick's ingestion order is a property of
    // the room, not of Map insertion order (GA-9 isolation depends on this).
    for (const seat of [...this.#seats.values()].sort((a, b) => (a.sessionId < b.sessionId ? -1 : 1))) {
      if (seat.closing !== null) {
        // Inside a closure window: no consumption, no admission from this seat, one forced final
        // publication, and the window's deadline is the ADR's, not a policy choice (§3.3).
        if (!seat.closing.finalPublished) {
          this.publishSeat(seat);
          seat.closing.finalPublished = true;
        }
        const windowOver = nowMs - seat.closing.openedAtMs >= envelope.closureWindowMs;
        const capped = nowMs - seat.closing.openedAtMs >= envelope.closureMaxMs;
        if (windowOver || capped) {
          record.closures.push({ entityId: seat.entityId, code: seat.closing.reason });
          this.closeSeat(seat, seat.closing.reason);
        }
        continue;
      }

      const accessor = this.#authorityInputOrUndefined(seat.sessionId);
      if (accessor === undefined) continue;
      const observation = seat.input.observe(accessor, envelope, record.tick, nowMs, this.#configValue.network.statePatchIntervalMs);
      if (observation.dequeued !== undefined) {
        record.consumed.push({ entityId: seat.entityId, seq: observation.dequeued.seq });
        // The wire frame is validated as the wire shape and projected to the authority five. Only
        // the five reach the core (§8.3 invariant 5: no client-chosen number is a movement input);
        // a refusal of any kind still becomes a journalled disposition and a neutral step (GA-4).
        // The consumed frame is a schema instance whose fields live on the prototype: the wire
        // shape is copied BY NAME (the codec's own instruction for `latest`-like values, PR-3) into
        // a plain record before validation. A closed-field-set validator against the raw instance
        // would refuse every frame for a reason no client chose.
        const wire = plainWireFrame(observation.dequeued.frame);
        const verdict = validateDirectWireFrame(wire, { sessionEpoch: seat.epoch });
        if (verdict.ok === false) record.refused.push({ entityId: seat.entityId, count: 1 });
        this.#authority.core.ingest(seat.entityId, coreFrameOfWireFrame(wire));
      }
      record.maxDepth = Math.max(record.maxDepth, observation.sizeAfter);

      for (const signal of observation.signals) {
        record.signals.push({ entityId: seat.entityId, signal });
        switch (signal) {
          case 'QUEUE_PRESSURE':
            // §3.3: throttle only. What a seat keeps is its inputs and its seat; the room records
            // and slows nothing that a depth heuristic cannot justify.
            seat.throttled = true;
            break;
          case 'RETIRED_UNREPRESENTED':
            // Confirmed arithmetic loss: the bounded closure window opens on the step that
            // confirmed it. This is the only server-side path to 4100.
            seat.closing = {
              openedAtMs: nowMs,
              deadlineMs: nowMs + envelope.closureMaxMs,
              reason: envelope.closeCodes.INPUT_RETIRED_UNREPRESENTED,
              finalPublished: false,
            };
            break;
          case 'RATE_CEILING':
            // §3.3: a per-second average can only terminate — direct closure, reserved code.
            record.closures.push({ entityId: seat.entityId, code: envelope.closeCodes.INPUT_RATE_CEILING });
            this.closeSeat(seat, envelope.closeCodes.INPUT_RATE_CEILING);
            break;
          case 'STRAND_SUSPECTED':
            // Diagnostic. There is deliberately no closure case for this signal reachable from
            // here: closure on a dedupe signature requires PE-1…PE-5 (GA-12, D-P2-6), the
            // configuration flag ships false, and even a true flag changes nothing in this class —
            // the record is the consequence, and client-local recovery (ADR-0003 §3.2) is the remedy.
            break;
        }
      }
    }

    const outcome = this.#authority.stepTick();

    // Publish in the consuming tick (§4 clause, W-4): the record the client reads is the record of
    // the tick that consumed, not of the next patch.
    for (const entity of outcome.entities) {
      const seat = this.#seatByEntity(entity.entityId);
      if (seat === undefined) continue;
      const view = this.#authority.core.view(entity.entityId);
      if (view === undefined) continue;
      // GA-10 ledger from authority outcomes only: first accepted publication of an identity,
      // counted once per (epoch, identity). Cache/batch re-answers re-present an already-counted
      // identity and are charged nothing; a reissue under a new identity is a new key.
      for (const result of outcome.results.filter((item) => item.accepted)) {
        const key = `${String(seat.epoch)}|${result.requestId}`;
        if (!seat.countedEffects.has(key)) {
          seat.countedEffects.add(key);
          seat.input.recordEffect(result.requestId);
        }
      }
      const published = publishPlayer(this.state, entity.entityId, view.state, seat.input.record());
      if (published.ok === false) {
        // A refused projection is a defect, not a condition to tolerate: it must fail visibly.
        throw new Error(`RegionRoom projection refused for ${entity.entityId}: ${published.issues.join('; ')}`);
      }
    }
    this.state.serverTick = outcome.tick;

    this.metrics.record({
      tick: outcome.tick,
      atMs: nowMs,
      stepDurationMs: 0,
      entities: outcome.entities.length,
      depths: [...this.#seats.values()].map((seat) => ({
        entityId: seat.entityId,
        size: this.#authorityInputOrUndefined(seat.sessionId)?.size ?? 0,
      })),
      maxDepth: record.maxDepth,
      consumed: record.consumed.map((entry) => entry.entityId),
      retiredTotal: [...this.#seats.values()].reduce((total, seat) => total + seat.input.retiredUnrepresented, 0),
      signals: record.signals,
      closedSeats: record.closures.map((entry) => entry.entityId),
    });
    this.tickRecords.push(record);
    if (this.tickRecords.length > 4096) this.tickRecords.shift();
    this.#lastTickRecord = record;
  }

  // --- Plumbing -------------------------------------------------------------------------------------

  /** Ingest one message-channel command after protocol validation against this seat's epoch. */
  private ingestCommand(client: Client, payload: unknown, kind: 'moveTo' | 'cancelPath'): void {
    const seat = this.#seats.get(client.sessionId);
    if (seat === undefined || seat.closing !== null) return;
    const bounds = this.#configValue.region.bounds;
    if (bounds === null) return;
    const context = {
      sessionEpoch: seat.epoch,
      bounds,
    };
    const verdict = kind === 'moveTo'
      ? validateMoveTo(payload, context)
      : validateCancelPath(payload, context);
    if (verdict.ok === false) {
      // A malformed command never reaches the core as an authority decision the transport has not
      // already refused; the core's own unknown-message path still exists for frames the transport
      // cannot classify, and nothing here re-implements its rejection vocabulary.
      return;
    }
    // Reserved on receipt, in receipt order, from the handler itself (revision 5 rule).
    this.#authority.core.ingest(seat.entityId, payload);
  }

  /** The single close site for a seat: publish happened (or was attempted), then the socket goes. */
  private closeSeat(seat: Seat, code: number): void {
    const client = this.clients.find((candidate) => candidate.sessionId === seat.sessionId);
    // §3.1's three close observations belong to EVERY consequence-driven closure, not only to the
    // dropped seat: W-9's question — what the buffer does on the way out — is only answerable if
    // the rate and retirement closures sample their queues too. (Measured by the W-10 population,
    // whose rate-closed seat had no observation to read until this line existed.)
    this.closeObservations.push({
      ...seat.input.closeObservation(this.#authorityInputOrUndefined(seat.sessionId), this.nowMs()),
      entityId: seat.entityId,
    });
    this.#seats.delete(seat.sessionId);
    // A closed seat's entity departs: the core journals the leave and releases the bookkeeping.
    // Without this the authority kept a phantom seated entity behind a removed row.
    this.#authority.core.leave(seat.entityId);
    unpublishPlayer(this.state, seat.entityId);
    if (client !== undefined) client.leave(code);
  }

  /**
   * Server-side completion of a reconnection: fresh epoch, restarted stamp domain, journal row.
   *
   * The authority call is `join`, not `epochChange`, and the reason is in Phase 1's own release
   * rule: a `leave` releases the entity's bookkeeping at the end of its tick, so by the time a
   * held reconnection resolves there is no entity to renew — `join` re-creates the association
   * under the fresh epoch, exactly as the core's join branch is written to do. `epochChange`
   * remains the right call for a renewal that happens **while the seat is live** (O09/AC-5), and
   * nothing here disputes that; the disconnect case is a different transition and the room says so.
   */
  private handleRejoin(seat: Seat): void {
    if (!this.#seats.has(seat.sessionId)) return;
    seat.epoch = this.#epochIssuer.issue();
    const accessor = this.#authorityInputOrUndefined(seat.sessionId);
    if (accessor !== undefined) seat.input.beginDomain(accessor);
    const bounds = this.#configValue.region.bounds;
    if (bounds === null) return;
    this.#authority.core.join(seat.entityId, seat.epoch, spawnFor(bounds));
  }

  private publishSeat(seat: Seat): void {
    const view = this.#authority.core.view(seat.entityId);
    if (view === undefined) return;
    publishPlayer(this.state, seat.entityId, view.state, seat.input.record());
  }

  private beginDomain(seat: Seat, sessionId: string): void {
    seat.input.beginDomain(this.#authorityInput(sessionId));
  }

  #authorityInput(sessionId: string) {
    const accessor = this.#authorityInputOrUndefined(sessionId);
    if (accessor === undefined) throw new Error(`RegionRoom has no input accessor for ${sessionId}`);
    return accessor;
  }

  #authorityInputOrUndefined(sessionId: string) {
    return this.inputs?.get(sessionId);
  }

  #seatByEntity(entityId: EntityId): Seat | undefined {
    for (const seat of this.#seats.values()) {
      if (seat.entityId === entityId) return seat;
    }
    return undefined;
  }

  /** Evidence accessors used by the Phase 2 suites and the smoke run. */
  evidence(): Record<string, unknown> {
    if (this.#authority === undefined) {
      // A refused room is a fact worth reporting, not a crash waiting to happen.
      return { refused: true };
    }
    return {
      configHash: computeConfigHash(this.#configValue),
      ticks: this.#authority.core.tick,
      chainTip: this.#authority.core.chainTip,
      stats: this.#authority.core.stats(),
      retention: this.#authority.core.retention(),
      journalRows: this.#sink.rows.length === 0 && this.#sink.dropped === 0 ? 'discarding' : this.#sink.rows.length,
      journalDropped: this.#sink.dropped,
      seats: [...this.#seats.values()].map((seat) => ({
        entityId: seat.entityId,
        epoch: seat.epoch,
        resolvedThrough: seat.input.resolvedThrough,
        gap: seat.input.gap,
        retiredUnrepresented: seat.input.retiredUnrepresented,
        effectCount: seat.input.effectCount,
        throttled: seat.throttled,
        closing: seat.closing !== null,
      })),
      joinRefusals: this.joinRefusals.length,
      // The server's own replica rows, for the suites to compare against what a client observes.
      replicaRows: [...this.state.players.entries()].map(([key, row]) => ({
        key,
        epoch: row.sessionEpoch,
        resolvedThrough: row.inputResolvedThrough,
        gapStart: row.inputGapStart,
        retired: row.inputRetiredUnrepresented,
        effects: row.effectCount,
      })),
      closeObservations: this.closeObservations,
      metrics: this.metrics.summary(),
      lastTick: this.#lastTickRecord,
      reconnections: this.#sessions.outcomes(),
      startedAtMs: this.#startedAtMs,
    };
  }

  /** Rows and chain for replay assertions; the sink is bounded, and `dropped` says so honestly. */
  journal(): { rows: readonly JournalRow[]; chain: readonly TickChainRecord[]; dropped: number } {
    return { rows: this.#sink.rows, chain: this.#sink.chain, dropped: this.#sink.dropped };
  }

  /**
   * The run's prologue: configuration digests plus the initial canonical state of every entity.
   *
   * `journal()` alone cannot be replayed. The accepted replay entry point refuses a journal it cannot bind to
   * a configuration, so an exporter that kept the rows and lost the prologue would hand over bytes that no
   * reviewer can re-check — and `undefined` here means the room refused to build an authority at all, which
   * is a reported fact rather than an empty journal.
   */
  journalPrologue(): PrologueRow | undefined {
    return this.#authority?.core.prologue();
  }

  /** The validated configuration this room actually ran on, for a replay that must bind to the prologue. */
  liveConfig(): Readonly<ServerConfig> | undefined {
    return this.#authority === undefined ? undefined : this.#configValue;
  }

  static reservedCloseCodes = RESERVED_CLOSE_CODES;

  /**
   * Live-room registry, mirroring the Phase 0 probe pattern (`inputRooms`).
   *
   * The matchmaker constructs rooms, so an in-process operator (the Phase 2 suites, the smoke run)
   * reads evidence back from here; entries leave on dispose.
   */
  static readonly live = new Set<RegionRoom>();

  /** The same rooms as an array, in construction order. */
  static liveRooms(): readonly RegionRoom[] {
    return [...RegionRoom.live];
  }
}

/** Accept only the server-authored deployment; everything else is untrusted and dropped. */
const trustedDeployment = (raw: unknown): RegionRoomOptions | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as { deploymentNonce?: unknown; deployment?: unknown };
  if (candidate.deploymentNonce !== OPERATOR_NONCE) return null;
  if (typeof candidate.deployment !== 'object' || candidate.deployment === null) return null;
  return candidate.deployment as RegionRoomOptions;
};

/**
 * Copy the decoded frame's fields by name into a plain record.
 *
 * The pinned codec's own instruction for schema-backed values (`latest`, buffered frames): fields
 * are copied BY NAME, never spread — a spread of a schema instance yields the proxy's own
 * properties, not the declared fields, and a closed-field-set validator would then refuse every
 * frame for a reason no client chose (live-caught 2026-11-12). The copy is six names, exactly the
 * wire schema's declaration; nothing is added and nothing is dropped.
 */
const plainWireFrame = (frame: DirectWireFrame): DirectWireFrame => ({
  sessionEpoch: frame.sessionEpoch,
  generation: frame.generation,
  directIntent: frame.directIntent,
  moveX: frame.moveX,
  moveZ: frame.moveZ,
  seq: frame.seq,
});
