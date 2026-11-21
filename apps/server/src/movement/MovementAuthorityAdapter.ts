/**
 * `MovementAuthorityAdapter` — the binding between the room and the accepted Phase 1 core
 * (UDG-003 Phase 2, W-4).
 *
 * The rule this file exists to obey is §5's wording: the adapter *binds the room to the Phase 1
 * core without re-implementing it*. Every decision — admission, arbitration, commit, dispositions,
 * journaling — runs inside `apps/server/src/authority/**`, unchanged. What lives here is exactly
 * the production seam Phase 1 left open (determinism.ts: "Phase 2 writes one"):
 *
 * - `SystemTime` / `SystemScheduler`: the P03-a ports filled with the pinned server's facilities.
 *   `Date.now` lives in this adapter, never in the authority step — that is where P03-a puts it.
 * - `FlatReferenceStepper`: UDG-003 implements no locomotion (UDG-005/006 own it), so the room's
 *   stepper is the flat reference relation `drive × speed × dt` — the same arithmetic the accepted
 *   Phase 1 reference stepper runs, kept here because `apps/server/src` cannot import test support.
 *   The type is named for what it is so nothing mistakes it for movement.
 */

import { FixedStepClock } from '../authority/clock.js';
import { AuthorityCore } from '../authority/step.js';
import type { RouteCompletion, TickOutcome } from '../authority/step.js';
import type { JournalSink } from '../authority/journal.js';
import type { EntityStepper, StepOutcome, StepRequest } from '../authority/types.js';
import type { Scheduler, ScheduledHandle, TimeSource } from '../authority/determinism.js';

import type { ServerConfig } from '@udg/config';
import type { EntityId, LocomotionState, SessionEpoch, Vec3 } from '@udg/protocol';

/** Monotonic wall milliseconds for the transport process. `performance.now` is Node's own monotonic source. */
export class SystemTime implements TimeSource {
  #last = 0;

  nowMs(): number {
    const value = Math.trunc(globalThis.performance.now());
    // Monotonicity is the adapter's obligation (determinism.ts): equal-or-greater, never backwards.
    if (value > this.#last) this.#last = value;
    return this.#last;
  }
}

/** The pinned server's timer facility, behind the core's declared port. */
export class SystemScheduler implements Scheduler {
  #nextId = 0;

  set(callback: () => void, delayMs: number): ScheduledHandle {
    this.#nextId += 1;
    const id = this.#nextId;
    const timer = setTimeout(() => {
      this.#live.delete(id);
      callback();
    }, delayMs);
    this.#live.set(id, timer);
    return { scheduledBy: 'udg-authority-clock', id };
  }

  clear(handle: ScheduledHandle): void {
    const timer = this.#live.get(handle.id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#live.delete(handle.id);
    }
  }

  readonly #live = new Map<number, ReturnType<typeof setTimeout>>();
}

/**
 * The flat reference step (GA-10 substrate posture; PR-14 rule: no locomotion, physics or
 * navigation dependency anywhere in the Phase 2 authority path).
 */
export class FlatReferenceStepper implements EntityStepper {
  readonly #speed: number;
  #calls = 0;

  constructor(speed: number) {
    this.#speed = speed;
  }

  get calls(): number {
    return this.#calls;
  }

  step(request: StepRequest): StepOutcome {
    this.#calls += 1;
    const dx = request.input.moveX * this.#speed * request.dtSeconds;
    const dz = request.input.moveZ * this.#speed * request.dtSeconds;
    const state: LocomotionState = {
      ...request.state,
      kinematic: {
        ...request.state.kinematic,
        position: {
          x: request.state.kinematic.position.x + dx,
          y: request.state.kinematic.position.y,
          z: request.state.kinematic.position.z + dz,
        },
        velocity: {
          x: request.dtSeconds === 0 ? 0 : dx / request.dtSeconds,
          y: 0,
          z: request.dtSeconds === 0 ? 0 : dz / request.dtSeconds,
        },
      },
    };
    return { state, horizontalDisplacement: Math.hypot(dx, dz) };
  }
}

export interface MovementAuthority {
  readonly core: AuthorityCore;
  readonly clock: FixedStepClock;
  readonly time: TimeSource;
  readonly stepTick: () => TickOutcome;
}

export type MovementAuthorityResult =
  | { readonly ok: true; readonly authority: MovementAuthority }
  | { readonly ok: false; readonly failure: string };

/**
 * Build the room's authority from a validated configuration.
 *
 * The core's own build already refuses a configuration without region bounds (D5: no invented
 * default), and that refusal surfaces here verbatim. The clock is built but deliberately **not
 * started**: the room's own fixed-step facility drives `stepTick`, so tick cadence has exactly one
 * owner (the room) and the clock is the counter and patch-cadence rule it was designed to be.
 */
export const buildMovementAuthority = (options: {
  readonly config: Readonly<ServerConfig>;
  readonly sink: JournalSink;
  readonly runId: string;
  readonly time?: TimeSource;
  readonly scheduler?: Scheduler;
  /**
   * Optional process-local stepper factory (UDG-SPIKE-001 review amendment, owner-approved 2026-11-19).
   *
   * The default constructs exactly the `FlatReferenceStepper(speed)` the constructor line has always
   * constructed; omitting this option changes nothing observable. The parameter is a function object
   * passed in-process — it is NOT a configuration key: no server config surface accepts it, no wire
   * frame can carry it, and a client's create/join options are discarded wholesale by the room's
   * trust gate (`RegionRoom`'s `OPERATOR_NONCE`), so a client cannot select a factory. Test
   * compositions (the netcode harness, the AC-1 trace) pass a wrapper around THE shared client step
   * relation (`apps/client/src/network/flatStep.ts`) so one exported function performs the movement
   * on both sides. Nothing in `apps/server` production code imports the client or test trees; the
   * dependency direction stays trusted-caller → adapter.
   */
  readonly stepperFactory?: ((speed: number) => EntityStepper) | undefined;
  readonly routeCompletions?: () => readonly RouteCompletion[];
  readonly regionProvenance?: string;
}): MovementAuthorityResult => {
  const time = options.time ?? new SystemTime();
  const scheduler = options.scheduler ?? new SystemScheduler();
  const clock = FixedStepClock.create({ network: options.config.network, scheduler, time });
  if (!('dtSeconds' in clock)) return { ok: false, failure: `clock: ${clock.error}` };

  const core = AuthorityCore.build({
    config: options.config,
    // The default branch constructs exactly what this line constructed before the amendment; a
    // trusted caller may inject a wrapper around the same relation (see `stepperFactory` above).
    stepper: (options.stepperFactory ?? ((speed: number): EntityStepper => new FlatReferenceStepper(speed)))(
      options.config.movement.speed,
    ),
    time,
    clock,
    runId: options.runId,
    sink: options.sink,
    ...(options.regionProvenance === undefined ? {} : { regionProvenance: options.regionProvenance }),
    ...(options.routeCompletions === undefined ? {} : { routeCompletions: options.routeCompletions }),
  });
  if (!('view' in core)) return { ok: false, failure: `core: ${core.reason}: ${core.detail}` };

  return {
    ok: true,
    authority: {
      core,
      clock,
      time,
      stepTick: () => core.step(),
    },
  };
};

/** Convenience: the entity id a room uses for a seat is its Colyseus session id (server-issued, printable-ASCII). */
export const authorityEntityId = (sessionId: string): EntityId => sessionId.slice(0, 64);

/** The authority call the room makes for a joined seat. */
export const authorityJoin = (
  authority: MovementAuthority,
  entityId: EntityId,
  sessionEpoch: SessionEpoch,
  spawn: Vec3,
): void => {
  authority.core.join(entityId, sessionEpoch, spawn);
};
