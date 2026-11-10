/**
 * The reference stepper: the movement seam with the smallest honest implementation.
 *
 * UDG-003 implements no locomotion — UDG-005 owns it, and UDG-006 owns collision. What Phase 1 must
 * still prove is *counting*: exactly one step per connected entity per tick, with the configured `dt`,
 * and a per-tick horizontal displacement inside the contract's bound. So this stepper applies the flat
 * reference relation `drive x speed x dt`, records every call, and nothing more: no gravity, no
 * collision, no yaw steering, no route following.
 */

import type { LocomotionState } from '../../../packages/protocol/dist/index.js';

import type { EntityStepper, StepOutcome, StepRequest } from '../../../apps/server/src/authority/types.js';

export interface StepperCall {
  readonly entityId: string;
  readonly tick: number;
  readonly dtSeconds: number;
  readonly driveX: number;
  readonly driveZ: number;
  readonly connected: boolean;
}

export class ReferenceStepper implements EntityStepper {
  readonly calls: StepperCall[] = [];
  readonly speed: number;

  constructor(speed: number) {
    this.speed = speed;
  }

  step(request: StepRequest): StepOutcome {
    const drive = request.drive === 'NONE' ? { moveX: 0, moveZ: 0 } : request.drive;
    this.calls.push({
      entityId: request.entityId,
      tick: request.tick,
      dtSeconds: request.dtSeconds,
      driveX: drive.moveX,
      driveZ: drive.moveZ,
      connected: request.connected,
    });
    const dx = request.input.moveX * this.speed * request.dtSeconds;
    const dz = request.input.moveZ * this.speed * request.dtSeconds;
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

  /** Every call for one entity, in order. */
  forEntity(entityId: string): readonly StepperCall[] {
    return this.calls.filter((call) => call.entityId === entityId);
  }

  /** How many times one entity was stepped in one tick — the AC-3a measurement. */
  steps(entityId: string, tick: number): number {
    return this.calls.filter((call) => call.entityId === entityId && call.tick === tick).length;
  }

  callsInTick(tick: number): readonly StepperCall[] {
    return this.calls.filter((call) => call.tick === tick);
  }

  reset(): void {
    this.calls.length = 0;
  }
}
