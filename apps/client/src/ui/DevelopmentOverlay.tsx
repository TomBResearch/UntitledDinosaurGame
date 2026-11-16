/**
 * The development overlay: the debug controls UDG-004 must show, and the region the camera must not treat as a
 * gesture surface.
 *
 * ## Why it polls instead of subscribing
 *
 * The camera readout and the counters change every frame. Re-rendering React at frame rate to paint three
 * numbers would put the *overlay* in the frame budget the renderer is being measured against, so the overlay
 * samples twice a second from one interval that its effect cleanup clears. The interval is not a listener, so
 * it does not appear in the listener ledger the acceptance suite audits; the cleanup is what keeps it from
 * writing into a disposed runtime. Every value below comes from the single `runtime.counters()` readout.
 *
 * ## Everything here is inside `data-udg-ui`
 *
 * The whole panel declares itself a UI region, which is the mechanism `OrbitCamera` uses for the contract's
 * "camera consumes pointer gestures only outside active UI regions". A drag that starts on this panel moves no
 * camera and is counted in `ignoredOnUi`; `tests/e2e/camera.spec.ts` proves both halves by dispatching the
 * same gesture here and on the canvas.
 *
 * ## The mount/unmount control is real, not decorative
 *
 * It calls the same mount/unmount pair that the development seam in `src/dev/` drives for the ten-cycle
 * acceptance measurement, so what the reviewer can click and what the suite counts are the same code path. The counts in
 * the panel come from the runtime, which is why they can be read off the screen when a test disagreement needs
 * a human eye.
 */

import { useCallback, useEffect, useState } from 'react';

import { CAMERA_LIMITS } from '../rendering/camera-math.js';
import type { ClientRuntime } from '../game/ClientRuntime.js';
import type { ClientConnection } from '../network/ClientConnection.js';

export interface DevelopmentOverlayProps {
  readonly runtime: ClientRuntime;
  readonly connection: ClientConnection;
  readonly mounted: boolean;
  readonly onToggleMount: () => void;
}

/** How often the overlay samples. Deliberately far below frame rate. */
const SAMPLE_INTERVAL_MS = 500;

const round = (value: number): string => value.toFixed(2);

export const DevelopmentOverlay = ({
  runtime,
  connection,
  mounted,
  onToggleMount,
}: DevelopmentOverlayProps) => {
  const [, setSample] = useState(0);
  const resample = useCallback(() => setSample((sample) => sample + 1), []);

  useEffect(() => {
    const handle = window.setInterval(resample, SAMPLE_INTERVAL_MS);
    return () => {
      window.clearInterval(handle);
    };
  }, [resample]);

  const counters = runtime.counters();
  const camera = counters.camera;
  const entities = Object.keys(counters.poseWritesByEntity);
  const incidents = counters.recentIncidents;
  const lastIncident = incidents.length > 0 ? incidents[incidents.length - 1] : undefined;
  const poseWrites = Object.entries(counters.poseWritesByEntity)
    .map(([entityId, writes]) => `${entityId}=${String(writes)}`)
    .join(' ') || 'none';

  return (
    <aside className="udg-overlay" data-udg-ui="overlay" aria-label="Development overlay">
      <h1 className="udg-overlay-title">UDG-004 development overlay</h1>
      <p className="udg-overlay-sub">
        Presentation only: no authority, no prediction, no session. Camera radius{' '}
        {String(CAMERA_LIMITS.radiusMinMeters)}–{String(CAMERA_LIMITS.radiusMaxMeters)} m, elevation{' '}
        {String(CAMERA_LIMITS.elevationMinDegrees)}–{String(CAMERA_LIMITS.elevationMaxDegrees)}°.
      </p>

      <div className="udg-overlay-controls">
        <button
          type="button"
          data-udg-control="toggle-mount"
          data-udg-mounted={String(mounted)}
          onClick={onToggleMount}
        >
          {mounted ? 'Unmount scene' : 'Mount scene'}
        </button>
        <button type="button" data-udg-control="retry-connection" onClick={() => connection.connect()}>
          Retry connection
        </button>
        <button type="button" data-udg-control="resample" onClick={resample}>
          Resample now
        </button>
      </div>

      <dl className="udg-overlay-readouts">
        <dt>Scene</dt>
        <dd data-udg-readout="scene">
          mounted={String(counters.mounted)} canvases={String(counters.canvases)} loops=
          {String(counters.loops)} ticks={String(counters.renderTicks)}
        </dd>

        <dt>Camera</dt>
        <dd data-udg-readout="camera">
          {camera === undefined
            ? 'unmounted'
            : `radius ${round(camera.radiusMeters)} m · elevation ${round(camera.elevationDegrees)}° · azimuth ${round(camera.azimuthDegrees)}°`}
        </dd>

        <dt>Presented entities</dt>
        <dd data-udg-readout="entities">{entities.length === 0 ? 'none' : entities.join(', ')}</dd>

        <dt>Pose writes</dt>
        <dd data-udg-readout="pose-writes">{poseWrites}</dd>

        <dt>Resources</dt>
        <dd data-udg-readout="resources">
          meshes={String(counters.meshes)} observers={String(counters.observers)} listeners=
          {String(counters.listeners)}
        </dd>

        <dt>Refusals</dt>
        <dd data-udg-readout="refusals">
          duplicateStarts={String(counters.duplicateStartAttempts)} afterDispose=
          {String(counters.refusedAfterDispose)} invalidPoses={String(counters.refusedInvalidPoses)} focusLosses=
          {String(counters.focusLosses)}
        </dd>

        <dt>Gestures</dt>
        <dd data-udg-readout="gestures">
          drags={String(counters.cameraDrags)} wheel={String(counters.cameraWheelNotches)} keys=
          {String(counters.cameraKeySteps)} keyFrames={String(counters.cameraKeyFrames)} pinches=
          {String(counters.cameraPinches)} leftIgnored={String(counters.cameraLeftPressesIgnored)} uiIgnored=
          {String(counters.cameraIgnoredOnUi)}
        </dd>

        <dt>Gesture incidents</dt>
        <dd data-udg-readout="incidents">
          {String(counters.gestureIncidents)}
          {lastIncident === undefined ? '' : ` · last ${lastIncident.kind}`}
        </dd>
      </dl>

      <p className="udg-overlay-hint" data-udg-readout="controls">
        Middle-drag the scene to orbit and pitch · wheel to zoom · click the scene then arrow keys to orbit and
        pitch (Tab reaches the canvas; the camera stops when it loses focus) · one finger drags the scene, pinch
        zooms · left button does nothing yet, it is reserved for click-to-move. Gestures that start on this panel
        are ignored by the camera.
      </p>
    </aside>
  );
};
