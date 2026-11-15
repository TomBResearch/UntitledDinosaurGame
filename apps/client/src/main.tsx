/**
 * Browser entry point for the UDG-004 client.
 *
 * ## What this file owns
 *
 * The mount/unmount pair. Everything else is a module with a job: `game/ClientRuntime.ts` owns the scene and
 * the loop, `rendering/OrbitCamera.ts` owns gestures, `network/ClientConnection.ts` owns status, `ui/*` renders.
 * This file decides *when a scene exists on screen*, which is the one behaviour the acceptance list counts in
 * cycles, so it is deliberately the only place that pairs `runtime.start(canvas)` with `runtime.dispose()`.
 * The overlay's mount button, the development harness's ten cycles and the browser's own first load all go
 * through these two functions.
 *
 * Two React roots, not one. `#udg-app` is created and destroyed with each scene; `#udg-shell` is persistent and
 * carries the "scene unmounted — Mount scene" prompt. Without that split, unmounting the scene would also
 * unmount the only control able to mount it again, and the reviewer could not repeat the cycle by hand.
 *
 * ## The local test poses
 *
 * UDG-003's server state does not exist for this task, and the contract says a local test pose may be used
 * until it does. Two are presented, both through `setPresentedPose` — the only pose inlet the runtime has:
 *
 * - `pose-local-0` walks a 0.6 m circle, which is what makes "two independent presented entities" observable
 *   rather than asserted;
 * - `pose-static-1` sits at `(2.5, 0, −1.5)` with yaw `π/2` and is never written again.
 *
 * The mover is advanced from a `requestAnimationFrame` loop that **only writes when the render loop's tick
 * count has changed**. That single condition is what makes the acceptance measurement possible: when the page
 * loses focus the runtime stops the render loop, the tick count freezes, and the pose source freezes with it —
 * so `tests/e2e/camera.spec.ts` can blur the window, exercise orbit/zoom/pinch, and attribute every pose write
 * in that window to the camera operations it performed. `pose.mutationsByCameraOperations === 0` is then a
 * measurement, not a tautology.
 *
 * The pose source is development-only (`import.meta.env.DEV`), non-authoritative, and stops the moment the
 * scene unmounts. It writes into presentation and reads nothing back.
 *
 * ## The development seam
 *
 * `dev/lifecycleHarness.ts` is imported dynamically inside a `DEV` branch, so a production build — where
 * `import.meta.env.DEV` is the literal `false` — drops the branch and never emits the chunk.
 * `tests/contracts/UDG-004.test.ts` byte-scans the built output for both `__udgClientHarness` and
 * `lifecycleHarness`; the browser suite loads the production bundle and checks the global is undefined.
 */

// `flushSync` lives in `react-dom`, not `react-dom/client` (measured against react-dom 19.3.1's
// declarations): the client entry exports createRoot/hydrateRoot only.
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

import { App } from './App.js';
import { createClientRuntime, type ClientRuntime } from './game/ClientRuntime.js';
import { createClientConnection, type ClientConnection } from './network/ClientConnection.js';

const SCENE_CANVAS_SELECTOR = 'canvas[data-udg-scene]';
const APP_ROOT_ID = 'udg-app';
const SHELL_ROOT_ID = 'udg-shell';

/** The development server port the repository contract pins for UDG-003's Colyseus server. */
const DEFAULT_SERVER_URL = 'ws://127.0.0.1:2567';

const TEST_POSE_MOVER_ID = 'pose-local-0';
const TEST_POSE_STATIC_ID = 'pose-static-1';
/** Circle radius of the mover, in metres: small enough to stay inside the plane, large enough to see. */
const TEST_POSE_CIRCLE_METRES = 0.6;

const serverUrl = (): string => {
  // Member access, and the reason `VITE_UDG_SERVER_URL` is declared in `src/vite-env.d.ts` instead of being
  // read through Vite's index signature: the bracket form keeps `import.meta.env` alive as a runtime object,
  // and then `import.meta.env.DEV` below is a runtime property test that no bundler can fold away — which put
  // the development-only mount/unmount seam into the production bundle until it was measured.
  const configured = import.meta.env.VITE_UDG_SERVER_URL;
  return typeof configured === 'string' && configured.length > 0 ? configured : DEFAULT_SERVER_URL;
};

const notice = (message: string): void => {
  const paragraph = document.createElement('p');
  paragraph.setAttribute('data-udg-fatal', 'true');
  paragraph.textContent = message;
  document.body.append(paragraph);
};

/**
 * Present the two local test poses and keep the mover moving while the render loop is running.
 *
 * Returns the stop function. The mover is written **first** so it becomes the entity the camera follows, which
 * is the target-follow behaviour the contract asks to be bounded.
 */
const startTestPoses = (client: ClientRuntime): (() => void) => {
  client.setPresentedPose(TEST_POSE_MOVER_ID, { position: { x: 0, y: 0, z: TEST_POSE_CIRCLE_METRES }, yaw: 0 });
  client.setPresentedPose(TEST_POSE_STATIC_ID, {
    position: { x: 2.5, y: 0, z: -1.5 },
    yaw: Math.PI / 2,
  });

  let phase = 0;
  let lastTicks = client.counters().renderTicks;
  let frame = 0;

  const step = (): void => {
    frame = window.requestAnimationFrame(step);
    const ticks = client.counters().renderTicks;
    // The freeze condition. No tick progress means the loop is stopped (focus loss, hidden tab, unmount), and a
    // paused scene must not keep accumulating poses behind the user's back.
    if (ticks === lastTicks) return;
    lastTicks = ticks;
    phase += 1;
    const t = phase * 0.02;
    client.setPresentedPose(TEST_POSE_MOVER_ID, {
      position: {
        x: TEST_POSE_CIRCLE_METRES * Math.sin(t / 2),
        y: 0,
        z: TEST_POSE_CIRCLE_METRES * Math.cos(t / 2),
      },
      yaw: t / 2,
    });
  };

  frame = window.requestAnimationFrame(step);
  return () => {
    window.cancelAnimationFrame(frame);
  };
};

const canvasOf = (): HTMLCanvasElement | undefined => {
  const canvas = document.querySelector(SCENE_CANVAS_SELECTOR);
  return canvas instanceof HTMLCanvasElement ? canvas : undefined;
};

const containerOf = (id: string): HTMLElement | undefined => {
  const element = document.getElementById(id);
  return element instanceof HTMLElement ? element : undefined;
};

const connection: ClientConnection = createClientConnection({ url: serverUrl() });

let runtime: ClientRuntime | undefined;
let appRoot: Root | undefined;
let stopPoseSource: (() => void) | undefined;
let mounted = false;

let shellRoot: Root | undefined;

const renderApp = (): void => {
  if (appRoot === undefined || runtime === undefined) return;
  appRoot.render(
    <App runtime={runtime} connection={connection} mounted={mounted} onToggleMount={toggleMount} />,
  );
};

const renderShell = (): void => {
  const root = shellRoot;
  if (root === undefined) return;
  if (mounted) {
    flushSync(() => root.render(null));
    return;
  }
  flushSync(() =>
    root.render(
      <div className="udg-shell" data-udg-ui="shell">
        <p className="udg-shell-text">Scene unmounted. The canvas is idle: no render loop, no listeners.</p>
        <button type="button" data-udg-control="mount" onClick={toggleMount}>
          Mount scene
        </button>
      </div>,
    ));
};

const mount = (): void => {
  if (runtime !== undefined) return;
  const canvas = canvasOf();
  const appContainer = containerOf(APP_ROOT_ID);
  const shellContainer = containerOf(SHELL_ROOT_ID);
  if (canvas === undefined || appContainer === undefined || shellContainer === undefined) {
    notice('UDG-004 client: the page is missing its scene canvas or its UI containers.');
    return;
  }
  shellRoot ??= createRoot(shellContainer);

  const client = createClientRuntime();
  client.start(canvas);
  runtime = client;
  appRoot = createRoot(appContainer);
  mounted = true;
  renderApp();
  renderShell();
  // The pose source and the harness are development surfaces. In a production build both branches are dead
  // code before Rollup ever runs.
  if (import.meta.env.DEV) {
    stopPoseSource = startTestPoses(client);
    void import('./dev/lifecycleHarness.js').then(({ installLifecycleHarness }) => {
      installLifecycleHarness({
        mount: () => {
          mount();
          renderApp();
        },
        unmount,
        canvas: () => canvasOf() ?? null,
        counters: () => runtime?.counters(),
      });
    });
  }
  // One attempt per `connect()` call, and a failure is a rendered state rather than an exception: the
  // acceptance list wants the failure visible, and there is normally no UDG-003 server to reach.
  connection.connect();
};

const unmount = (): void => {
  stopPoseSource?.();
  stopPoseSource = undefined;
  const root = appRoot;
  if (root !== undefined) {
    // flushSync so the React teardown (and with it the overlay's interval) has finished before the runtime is
    // disposed: a callback that fires into a disposed runtime is a crash waiting to be flaky.
    flushSync(() => root.unmount());
  }
  appRoot = undefined;
  runtime?.dispose();
  runtime = undefined;
  mounted = false;
  renderShell();
};

function toggleMount(): void {
  if (runtime === undefined) mount();
  else unmount();
}

mount();
