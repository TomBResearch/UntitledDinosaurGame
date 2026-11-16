/**
 * `ClientRuntime` — the presentation runtime UDG-004 owns.
 *
 * ## The surface, and what it is allowed to do
 *
 * ```text
 * start(canvas: HTMLCanvasElement): void
 * setPresentedPose(entityId: string, pose: Pose): void
 * removePresentedEntity(entityId: string): void
 * dispose(): void
 * ```
 *
 * `Pose` is `readonly { position: Vec3; yaw: number }`, with `Vec3` from `@udg/protocol`. **No method here
 * writes authoritative state**: there is no intention, no velocity, no tick, no epoch and no request in this
 * file, and nothing in it imports a server module (the boundary rules refuse that import anyway). Everything
 * it touches is a Babylon transform node in its own scene. `setPresentedPose` is the only pose inlet — the
 * local test-pose driver in `main.tsx` and the acceptance suite both arrive through it, so "presented state
 * came from somewhere else" is not a thing that can happen quietly.
 *
 * ## Exactly one render loop
 *
 * `start()` creates the engine and calls `engine.runRenderLoop` once. A second `start()` — React `StrictMode`
 * double-invocation, a hot reload, a caller in a hurry — is refused and counted in
 * `duplicateStartAttempts`; it never opens a second loop, because two loops on one canvas double the frame
 * rate and halve the frame budget while looking completely healthy. `dispose()` stops the loop and never
 * restarts it.
 *
 * The loop's own bookkeeping is a counter, not a peek into Babylon: `AbstractEngine._activeRenderLoops` is
 * `protected`, and the repository rule against depending on private fields is exactly the rule that a
 * `// eslint-disable-next-line` would quietly violate. Instead `counters().loops` reports what this runtime
 * started and stopped, `renderTicks` proves it is running, and `tests/e2e/camera.spec.ts` proves the
 * independent fact — after `dispose()` the page schedules no further `requestAnimationFrame` at all.
 *
 * ## Focus loss
 *
 * Losing focus or being backgrounded stops the loop, and regaining it starts the loop again — one loop, never
 * two, and never a tab burning a GPU while nobody looks at it. In-flight gestures are dropped at the same
 * moment, because a pointer that was down when the window lost focus is not a gesture anyone wants resumed — and
 * so are held keyboard states, which matters more now that the keyboard drives the camera through this loop: a key
 * still down when the tab goes away stops the instant the loop does, and `stepHeldKeys` is never called again
 * until the loop restarts with fresh frames and a focused canvas.
 * The browser suite uses this behaviour to freeze the test poses while it exercises the camera, which is what
 * makes "camera operations never mutate either pose" measurable rather than merely asserted.
 *
 * ## Disposal
 *
 * `dispose()` releases, in order: the camera controller's listeners, this runtime's own listeners, the render
 * loop, the presented entities, the scene, the engine. It is idempotent, and calls that arrive afterwards are
 * counted (`refusedAfterDispose`) instead of throwing at a React effect that has not unmounted yet. The
 * acceptance list — no live game loop, no listeners registered by the app, meshes and observers released — is
 * measured from outside the runtime in `tests/e2e/camera.spec.ts`, because a runtime that reports its own
 * cleanliness proves nothing.
 */

import type { Engine } from '@babylonjs/core';
import type { Vec3 } from '@udg/protocol';

import type { CameraReadout } from '../rendering/camera-math.js';
import { createGreyboxScene, createRenderEngine, type Greybox } from '../rendering/create-scene.js';
import { OrbitCamera, type GestureIncident } from '../rendering/OrbitCamera.js';
import { PlayerView } from '../rendering/PlayerView.js';

/** The pose the contract defines: a position in metres and a yaw in radians. Read-only on purpose. */
export interface Pose {
  readonly position: Vec3;
  readonly yaw: number;
}

/** Entity ids are bounded, because they become mesh names and `data-*` values. */
export const MAX_ENTITY_ID_LENGTH = 64;

/** The number of incidents the runtime keeps for the overlay and for `console-errors.json`. */
export const MAX_RETAINED_INCIDENTS = 32;

export interface RuntimeCounters {
  readonly mounted: boolean;
  /** Canvas elements this runtime has taken over. Never more than one. */
  readonly canvases: number;
  /** Render loops this runtime has started and not stopped: 0 or 1. */
  readonly loops: number;
  readonly renderTicks: number;
  readonly presentedEntities: number;
  readonly meshes: number;
  readonly observers: number;
  /** Listeners this runtime added and has not removed (its own plus the camera controller's). */
  readonly listeners: number;
  readonly poseWritesByEntity: Readonly<Record<string, number>>;
  readonly duplicateStartAttempts: number;
  readonly refusedAfterDispose: number;
  readonly refusedInvalidPoses: number;
  readonly focusLosses: number;
  readonly focusRegains: number;
  readonly gestureIncidents: number;
  /** What the camera controller counted itself: gestures handled, and gestures it refused because they began on UI. */
  readonly cameraDrags: number;
  readonly cameraWheelNotches: number;
  readonly cameraPinches: number;
  /** Arrow-key presses accepted while the canvas held focus. A press is a state change, not a movement. */
  readonly cameraKeySteps: number;
  /** Frames in which held arrow keys moved the camera — the proof that a single keydown keeps moving it. */
  readonly cameraKeyFrames: number;
  /** Left presses on the canvas: refused, because UDG-008's click-to-move owns that button. */
  readonly cameraLeftPressesIgnored: number;
  readonly cameraIgnoredOnUi: number;
  /** The camera's own state, read from the controller that owns it. `undefined` while unmounted. */
  readonly camera: CameraReadout | undefined;
  /** The most recent refused or survived gestures, oldest first, capped at `MAX_RETAINED_INCIDENTS`. */
  readonly recentIncidents: readonly GestureIncident[];
  /** Disposal flags of the objects this runtime created. `undefined` once they are gone (nothing to ask). */
  readonly engineDisposed: boolean | undefined;
  readonly sceneDisposed: boolean | undefined;
}

/**
 * The runtime, and the one readout the overlay needs.
 *
 * The contract's interface is the four methods below, and that is what the rest of the game may call. The
 * readout is a method rather than a fifth lifecycle lever on purpose: the acceptance list asks for counts
 * (poses written, gestures refused, meshes, observers, listeners), the overlay paints them, and every claim a
 * test makes about *cleanliness* is measured from outside the runtime in `apps/client/src/dev/` and
 * `tests/e2e/camera.spec.ts` instead. Nothing here lets a caller change what the scene does.
 */
export interface ClientRuntime {
  start(canvas: HTMLCanvasElement): void;
  setPresentedPose(entityId: string, pose: Pose): void;
  removePresentedEntity(entityId: string): void;
  dispose(): void;
  counters(): RuntimeCounters;
}

interface OwnedResources {
  readonly engine: Engine;
  readonly greybox: Greybox;
  readonly view: PlayerView;
  readonly camera: OrbitCamera;
}

const isUsablePose = (pose: Pose): boolean =>
  Number.isFinite(pose.position.x)
  && Number.isFinite(pose.position.y)
  && Number.isFinite(pose.position.z)
  && Number.isFinite(pose.yaw);

/**
 * Create the runtime. Nothing is created until `start()` runs: importing this module must not touch WebGL,
 * so a test can construct a runtime in a Node process that has no canvas.
 */
export const createClientRuntime = (): ClientRuntime => {
  let owned: OwnedResources | undefined;
  let disposed = false;
  let loopRunning = false;
  let backgrounded = false;
  let renderTicks = 0;
  let duplicateStartAttempts = 0;
  let refusedAfterDispose = 0;
  let refusedInvalidPoses = 0;
  let focusLosses = 0;
  let focusRegains = 0;
  const poseWrites = new Map<string, number>();
  const retained: GestureIncident[] = [];
  /** Every listener this runtime added, with the removal call that undoes it. */
  const listeners: { readonly remove: () => void }[] = [];

  const recordIncident = (incident: GestureIncident): void => {
    retained.push(incident);
    if (retained.length > MAX_RETAINED_INCIDENTS) retained.shift();
  };

  const listen = (
    target: EventTarget,
    type: string,
    handler: EventListener,
    options?: AddEventListenerOptions,
  ): void => {
    target.addEventListener(type, handler, options);
    listeners.push({
      remove: () => {
        target.removeEventListener(type, handler, options);
      },
    });
  };

  const stopLoop = (): void => {
    const resources = owned;
    if (resources === undefined || !loopRunning) return;
    resources.engine.stopRenderLoop();
    loopRunning = false;
  };

  const startLoop = (): void => {
    const resources = owned;
    if (resources === undefined || loopRunning || backgrounded) return;
    loopRunning = true;
    // The keyboard's clock. `lastFrameAt` is captured per loop start, so the frame after a restart measures the
    // restart, not the whole gap the loop was stopped for; `heldKeyCameraStep` clamps it again in case a stall
    // happens inside a running loop. Without both, a key held across a backgrounded tab would resume as a jump.
    let lastFrameAt = performance.now();
    resources.engine.runRenderLoop(() => {
      const now = performance.now();
      const deltaSeconds = (now - lastFrameAt) / 1000;
      lastFrameAt = now;
      // Before the render, so the frame that is presented already carries the movement the reviewer feels.
      resources.camera.stepHeldKeys(deltaSeconds);
      renderTicks += 1;
      resources.greybox.scene.render();
    });
  };

  /** The entity the camera follows: the first one presented, which is the mover in the local test poses. */
  const followedEntity = (): string | undefined => owned?.view.ids()[0];

  const counters = (): RuntimeCounters => {
    const resources = owned;
    const byEntity: Record<string, number> = {};
    for (const [entityId, writes] of poseWrites.entries()) byEntity[entityId] = writes;
    const cameraStats = resources?.camera.statsSnapshot ?? {
      drags: 0,
      wheelNotches: 0,
      pinches: 0,
      keySteps: 0,
      keyFrames: 0,
      leftPressesIgnored: 0,
      ignoredOnUi: 0,
      incidents: 0,
      listeners: 0,
    };
    return {
      mounted: resources !== undefined && !disposed,
      canvases: resources === undefined ? 0 : 1,
      loops: loopRunning ? 1 : 0,
      renderTicks,
      presentedEntities: resources?.view.count ?? 0,
      meshes: resources?.greybox.scene.meshes.length ?? 0,
      observers: resources === undefined || resources.greybox.scene.isDisposed ? 0 : observerCount(resources),
      listeners: listeners.length + cameraStats.listeners,
      poseWritesByEntity: byEntity,
      duplicateStartAttempts,
      refusedAfterDispose,
      refusedInvalidPoses,
      focusLosses,
      focusRegains,
      gestureIncidents: retained.length,
      cameraDrags: cameraStats.drags,
      cameraWheelNotches: cameraStats.wheelNotches,
      cameraPinches: cameraStats.pinches,
      cameraKeySteps: cameraStats.keySteps,
      cameraKeyFrames: cameraStats.keyFrames,
      cameraLeftPressesIgnored: cameraStats.leftPressesIgnored,
      cameraIgnoredOnUi: cameraStats.ignoredOnUi,
      camera: resources === undefined ? undefined : resources.camera.readout(),
      recentIncidents: [...retained],
      engineDisposed: resources === undefined ? (disposed ? true : undefined) : resources.engine.isDisposed,
      sceneDisposed: resources === undefined ? (disposed ? true : undefined) : resources.greybox.scene.isDisposed,
    };
  };

  const observerCount = (resources: OwnedResources): number =>
    resources.greybox.scene.onBeforeRenderObservable.observers.length
    + resources.greybox.scene.onDisposeObservable.observers.length;

  return {
    start: (canvas) => {
      if (disposed) {
        refusedAfterDispose += 1;
        return;
      }
      if (owned !== undefined) {
        // The refusal is the behaviour: a second start must not create a second engine, a second scene or a
        // second loop, and the count is what the acceptance suite reads to see that.
        duplicateStartAttempts += 1;
        return;
      }
      if (!(canvas instanceof HTMLCanvasElement)) {
        recordIncident({ kind: 'canvas-not-attachable', detail: 'start() received something that is not a canvas' });
        return;
      }

      const engine = createRenderEngine(canvas);
      const greybox = createGreyboxScene(engine);
      const view = new PlayerView(greybox);
      const camera = new OrbitCamera({
        canvas,
        camera: greybox.camera,
        onIncident: recordIncident,
      });
      owned = { engine, greybox, view, camera };

      listen(window, 'resize', () => {
        engine.resize();
      });
      listen(window, 'blur', () => {
        focusLosses += 1;
        backgrounded = true;
        camera.cancelActiveGestures();
        stopLoop();
      });
      listen(window, 'focus', () => {
        if (!backgrounded) return;
        focusRegains += 1;
        backgrounded = false;
        startLoop();
      });
      listen(document, 'visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          focusLosses += 1;
          backgrounded = true;
          camera.cancelActiveGestures();
          stopLoop();
          return;
        }
        if (!backgrounded) return;
        focusRegains += 1;
        backgrounded = false;
        startLoop();
      });
      listen(window, 'pagehide', () => {
        stopLoop();
      });

      startLoop();
    },

    setPresentedPose: (entityId, pose) => {
      const resources = owned;
      if (disposed || resources === undefined) {
        refusedAfterDispose += 1;
        return;
      }
      if (typeof entityId !== 'string' || entityId.length === 0 || entityId.length > MAX_ENTITY_ID_LENGTH) {
        refusedInvalidPoses += 1;
        recordIncident({ kind: 'non-finite-gesture-value', detail: `entity id rejected: length ${String(entityId.length)}` });
        return;
      }
      if (!isUsablePose(pose)) {
        refusedInvalidPoses += 1;
        recordIncident({ kind: 'non-finite-gesture-value', detail: `pose for ${entityId} carried a non-finite number` });
        return;
      }
      resources.view.upsert(entityId, pose);
      poseWrites.set(entityId, (poseWrites.get(entityId) ?? 0) + 1);
      // Target follow, and the only direction this data flows: a pose moves the camera target, and no camera
      // value ever produces a pose.
      if (followedEntity() === entityId) resources.camera.follow(pose.position);
    },

    removePresentedEntity: (entityId) => {
      const resources = owned;
      if (disposed || resources === undefined) {
        refusedAfterDispose += 1;
        return;
      }
      const removed = resources.view.remove(entityId);
      if (removed) poseWrites.delete(entityId);
      if (followedEntity() === undefined) resources.camera.follow(undefined);
    },

    dispose: () => {
      const resources = owned;
      disposed = true;
      for (const entry of listeners.splice(0, listeners.length)) entry.remove();
      if (resources === undefined) return;
      resources.camera.dispose();
      stopLoop();
      resources.view.dispose();
      for (const mesh of resources.greybox.meshes) mesh.dispose(false, false);
      for (const material of resources.greybox.materials) material.dispose();
      resources.greybox.light.dispose();
      resources.greybox.camera.dispose();
      resources.greybox.root.dispose();
      resources.greybox.scene.dispose();
      resources.engine.dispose();
      owned = undefined;
    },

    counters,
  };
};
