/**
 * UDG-SPIKE-001 (Gate A, review amendment, owner-approved 2026-11-19): a *test-composition*
 * `EntityStepper` wrapper around THE shared step kernel, `flatDirectStep` from
 * `apps/client/dist/network/flatStep.js`.
 *
 * Purpose: make the two test compositions that exercise movement — the netcode harness room and
 * the AC-1 reference trace — step the authority with the ONE exported kernel function the client
 * side already uses (SDK reconciler step closure, checkpoint instrumenter, browser pages), so
 * "both sides used the same function" is an identity across the spike's evidence, not a parity
 * claim between separately written formulas.
 *
 * Dependency direction is honoured: nothing in `apps/server` production code imports this file,
 * the client tree, or the test tree. The wrapper is a function object handed to the room through
 * the trusted `RegionRoomOptions.stepperFactory` seam (a nonce-gated deployment envelope), exactly
 * like the config overrides the harness already passes. A client cannot select a factory: create/
 * join options without the per-process operator nonce are discarded wholesale, and a function
 * object is not wire-serialisable in any case.
 *
 * The step arithmetic is `flatDirectStep` for the position, with velocity and horizontal
 * displacement derived from the kernel's own outputs; the production default
 * (`FlatReferenceStepper`) is untouched and remains what any room without this option runs.
 */
import { flatDirectStep } from '../../../apps/client/dist/network/flatStep.js';

/** THE kernel function this wrapper steps with — for import-identity assertions by consumers. */
export { flatDirectStep as kernelStep };

/** Total steps performed through this wrapper in-process — the sentinel diagnostic. */
export const kernelStepperSentinel = { calls: 0 };

/**
 * `EntityStepper` over the shared kernel. Mirrors `FlatReferenceStepper.step` (the shape the
 * authority consumes: `state`, `horizontalDisplacement`) with every position number produced by
 * `flatDirectStep` itself.
 */
export const createKernelStepper = (speed) => {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    step(request) {
      calls += 1;
      kernelStepperSentinel.calls += 1;
      const pose = request.state.kinematic.position;
      const next = flatDirectStep(pose, request.input, request.dtSeconds, speed);
      // Derived from the kernel's outputs, never from a re-spelled formula: these are the deltas
      // the kernel actually produced for this pose.
      const dx = next.x - pose.x;
      const dz = next.z - pose.z;
      const state = {
        ...request.state,
        kinematic: {
          ...request.state.kinematic,
          position: { x: next.x, y: pose.y, z: next.z },
          velocity: {
            x: request.dtSeconds === 0 ? 0 : dx / request.dtSeconds,
            y: 0,
            z: request.dtSeconds === 0 ? 0 : dz / request.dtSeconds,
          },
        },
      };
      return { state, horizontalDisplacement: Math.hypot(dx, dz) };
    },
  };
};

/** Factory shape consumed by `RegionRoomOptions.stepperFactory` / `buildMovementAuthority`. */
export const kernelStepperFactory = (speed) => createKernelStepper(speed);
