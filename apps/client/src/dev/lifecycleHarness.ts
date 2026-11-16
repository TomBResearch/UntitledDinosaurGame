/**
 * The test-only mount/unmount seam (assignment record §8).
 *
 * ## What this is, and what it is not
 *
 * The contract's public surface is four methods — `start`, `setPresentedPose`, `removePresentedEntity`,
 * `dispose` — and the acceptance list demands ten mount/unmount cycles with counts to prove them. Adding a
 * fifth lifecycle method to `ClientRuntime` to make that measurable would put a test affordance into the
 * shipped interface, which is the wrong direction. So the counting lives here instead: this module installs a
 * *caller* of the four real methods, reachable only from a development build, and the browser suite drives it.
 *
 * `mount()` calls `runtime.start(canvas)` plus a React render; `unmount()` calls `root.unmount()` plus
 * `runtime.dispose()`. Those are the same two functions the overlay's mount button calls, so a click and ten
 * automated cycles exercise identical code.
 *
 * ## Why the snapshot reads Babylon rather than the runtime
 *
 * `snapshot()` merges three sources, and the split is deliberate:
 *
 * - `runtime.counters()` — what the app asked for: poses written, gestures refused, listeners it added. Only
 *   this runtime can answer those, and they are counts of its own requests.
 * - `dev/sceneReadout.ts` — what the browser and engine are left holding: engines in Babylon's registry, scenes,
 *   meshes, materials, observers, the live camera's transform, the axis marker's world positions, the presented
 *   capsules' world positions. This is where "disposal leaves no live game loop or listener registered by the
 *   app" is measured, because an object cannot credibly report its own disposal.
 * - the frame spy below — what the page schedules.
 *
 * Where the two sides describe the same fact (`presentedEntities` vs `presented` capsule count, `observers` vs
 * the scene's observer lists), `tests/e2e/camera.spec.ts` asserts they agree, so neither number is taken on
 * trust.
 *
 * ## The frame spy
 *
 * Babylon's active render-loop list is `protected`, and the repository rule against reaching for private fields
 * is exactly the rule a `// eslint-disable-next-line` would quietly break. So the loop is measured from the
 * outside instead: this module wraps `window.requestAnimationFrame`, counts the requests, and the suite asserts
 * the count stops rising after `dispose()`. That is the acceptance criterion — "no live game loop" — expressed
 * as the observable behaviour it actually is, and it also catches a loop this client did not know it left
 * running.
 *
 * ## Why it cannot reach a browser in production
 *
 * Three separate facts, each checked:
 *
 * 1. `main.tsx` imports it through `import('./dev/lifecycleHarness.js')` inside `if (import.meta.env.DEV)`. In a
 *    production build that condition is the literal `false`, so Rollup drops the branch and the dynamic chunk is
 *    never emitted.
 * 2. `apps/client/tsconfig.json` excludes `src/dev`, so the module is not in the `dist/` library emit either.
 * 3. `tests/contracts/UDG-004.test.ts` byte-scans both built trees for `__udgClientHarness`, `lifecycleHarness`
 *    and `sceneReadout`, and `tests/e2e/camera.spec.ts` loads the production bundle over a loopback server and
 *    asserts `window.__udgClientHarness === undefined`.
 *
 * A comment claiming the seam is absent is not a check; those three are.
 */

import type { CameraReadout } from '../rendering/camera-math.js';
import type { GestureIncident } from '../rendering/OrbitCamera.js';
import type { RuntimeCounters } from '../game/ClientRuntime.js';
import { pickUdgMesh, probeUdgAxes, readSceneFacts, sweepUdgPicks, type AxisProbe, type MeshPoint, type SceneFacts, type ScenePick } from './sceneReadout.js';

/** The global the browser suite drives. Absent from every non-development build. */
export const HARNESS_GLOBAL = '__udgClientHarness';

/** A bound on `cycle()`, so a mistyped argument cannot spin the page into an unresponsive loop. */
export const MAX_CYCLES = 25;

/** The counters plus the read-only observations a test needs, in one JSON-serialisable object. */
export interface HarnessSnapshot {
  /** Mount/unmount pairs this harness has driven. Survives unmount, because it counts cycles, not state. */
  readonly cycles: number;
  readonly app: RuntimeCounters;
  readonly scene: SceneFacts;
  /** `requestAnimationFrame` calls observed since the page loaded, including Babylon's own loop. */
  readonly frameRequests: number;
  readonly camera: CameraReadout | undefined;
  /** Axis-marker and capsule positions, read out of the scene graph. */
  readonly axisMeshes: Readonly<Record<string, MeshPoint>>;
  readonly presented: Readonly<Record<string, MeshPoint>>;
  readonly presentedYaw: Readonly<Record<string, number>>;
  readonly convention: SceneFacts['convention'];
  readonly engines: number;
  readonly scenes: number;
  readonly meshes: number;
  readonly observers: number;
  readonly listeners: number;
  readonly mounted: boolean;
  readonly renderTicks: number;
  readonly engineDisposed: boolean | undefined;
  readonly sceneDisposed: boolean | undefined;
}

/**
 * What `main.tsx` hands this module: the same pair its own mount button uses, plus two reads.
 *
 * The seam deliberately carries no runtime reference. `counters()` and `canvas()` are resolved at the moment of
 * each read, so a disposed runtime cannot be kept alive by a cached handle and quietly turn "the object still
 * answers" into "the object was never released".
 */
export interface LifecycleSeam {
  readonly mount: () => void;
  readonly unmount: () => void;
  /** The canvas the scene is mounted on, or `null` while unmounted. */
  readonly canvas: () => HTMLCanvasElement | null;
  /** The mounted runtime's counters, or `undefined` while unmounted. */
  readonly counters: () => RuntimeCounters | undefined;
}

export interface UdgClientHarness {
  mount(): HarnessSnapshot;
  unmount(): HarnessSnapshot;
  cycle(cycles: number): HarnessSnapshot;
  snapshot(): HarnessSnapshot;
  /** Pick this client's own meshes at a canvas point — the render-path answer used by the handedness check. */
  pick(x: number, y: number): ScenePick | undefined;
  /** Sweep the canvas on a grid and report each of this client's meshes once, with the pixel it appeared at. */
  sweep(stepPixels?: number): readonly ScenePick[];
  /**
   * Cast a downward ray at each sampled world-space point and report which of this client's meshes it met.
   * The samples come from the caller — the suite holds the answer key, not the client — so a probe cannot be
   * satisfied by a scene that describes itself favourably.
   */
  probe(samples: readonly MeshPoint[], includeGround?: boolean): readonly AxisProbe[];
}

declare global {
  interface Window {
    /** Present only in a development build; its absence is asserted against the production bundle. */
    readonly __udgClientHarness?: UdgClientHarness;
  }
}

/** Counts `requestAnimationFrame` requests without changing what the page does. */
interface FrameSpy {
  readonly requests: number;
}

const installFrameSpy = (): FrameSpy => {
  const state: { requests: number } = { requests: 0 };
  const original = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    state.requests += 1;
    return original(callback);
  };
  return {
    get requests(): number {
      return state.requests;
    },
  };
};

/**
 * Build a snapshot from whatever exists right now.
 *
 * An unmounted scene is a normal state, not an error: the counts fall to the zeros below, which are the same
 * zeros the acceptance list expects after `dispose()`.
 */
export const snapshotOf = (
  counters: RuntimeCounters | undefined,
  canvas: HTMLCanvasElement | null,
  cycles: number,
  frames: FrameSpy,
): HarnessSnapshot => {
  const scene = readSceneFacts(canvas);
  const app: RuntimeCounters = counters ?? {
    mounted: false,
    canvases: 0,
    loops: 0,
    renderTicks: 0,
    presentedEntities: 0,
    meshes: 0,
    observers: 0,
    listeners: 0,
    poseWritesByEntity: {},
    duplicateStartAttempts: 0,
    refusedAfterDispose: 0,
    refusedInvalidPoses: 0,
    focusLosses: 0,
    focusRegains: 0,
    gestureIncidents: 0,
    cameraDrags: 0,
    cameraWheelNotches: 0,
    cameraPinches: 0,
    cameraKeySteps: 0,
    cameraKeyFrames: 0,
    cameraLeftPressesIgnored: 0,
    cameraIgnoredOnUi: 0,
    camera: undefined,
    recentIncidents: [],
    engineDisposed: true,
    sceneDisposed: true,
  };
  return {
    cycles,
    app,
    scene,
    frameRequests: frames.requests,
    camera: scene.camera ?? app.camera,
    axisMeshes: scene.axisMeshes,
    presented: scene.presented,
    presentedYaw: scene.presentedYaw,
    convention: scene.convention,
    engines: scene.engines,
    scenes: scene.scenes,
    meshes: scene.meshes,
    observers: scene.renderObservers + scene.pointerObservers + scene.resizeObservers + scene.disposeObservers,
    listeners: app.listeners,
    mounted: app.mounted,
    renderTicks: app.renderTicks,
    engineDisposed: scene.engineDisposed ?? app.engineDisposed,
    sceneDisposed: scene.sceneDisposed ?? app.sceneDisposed,
  };
};

/**
 * Install the seam on `globalThis` and return it.
 *
 * Calling it twice returns the existing installation rather than nesting a second counter, because the
 * acceptance measurement counts cycles and frame requests, and a re-installed harness would silently restart
 * both. The incidents list is exported for the overlay's benefit only; the suite reads the same field from
 * `snapshot().app.recentIncidents`.
 */
export const installLifecycleHarness = (seam: LifecycleSeam): UdgClientHarness => {
  const existing = window.__udgClientHarness;
  if (existing !== undefined) return existing;

  const frames = installFrameSpy();
  let cycles = 0;
  const snap = (): HarnessSnapshot => snapshotOf(seam.counters(), seam.canvas(), cycles, frames);

  const harness: UdgClientHarness = {
    mount: () => {
      seam.mount();
      cycles += 1;
      return snap();
    },
    unmount: () => {
      seam.unmount();
      return snap();
    },
    cycle: (requested) => {
      const count = Number.isFinite(requested) ? Math.max(0, Math.min(MAX_CYCLES, Math.trunc(requested))) : 0;
      for (let index = 0; index < count; index += 1) {
        seam.mount();
        cycles += 1;
        seam.unmount();
      }
      return snap();
    },
    snapshot: snap,
    pick: (x, y) => pickUdgMesh(seam.canvas(), x, y),
    sweep: (stepPixels) => sweepUdgPicks(seam.canvas(), stepPixels),
    probe: (samples, includeGround) => probeUdgAxes(seam.canvas(), samples, { includeGround: includeGround ?? false }),
  };

  Object.defineProperty(window, HARNESS_GLOBAL, {
    value: harness,
    enumerable: true,
    configurable: false,
    writable: false,
  });
  return harness;
};

/** Re-exported so the suite can name the incident kinds it expects to see, without importing production code. */
export type HarnessIncident = GestureIncident;
