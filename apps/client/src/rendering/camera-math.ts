/**
 * The orbit camera's arithmetic, kept free of Babylon and of the DOM so it can be unit-tested without a
 * browser (tests/unit/udg-004/camera-math.test.ts) and reasoned about without a render loop.
 *
 * The limits themselves are the ones the task contract proposes: radius 2 m to 20 m and elevation 10° to 80°
 * (docs/contracts/UDG-004.md). They are stated here once and consumed twice — by these functions and by the
 * camera's own `lower/upperRadiusLimit` / `lower/upperBetaLimit` — because a clamp that exists only in the
 * input handler still lets an animated or programmatic move put the camera outside the range, and one that
 * exists only on the camera still lets a gesture ask for a value outside it.
 *
 * Elevation is measured in degrees above the horizontal plane through the target, which is what a person
 * means by "how high is the camera". Babylon's `beta` is the polar angle down from +Y, so the two are
 * related by `elevation = 90° − beta`. Every conversion goes through the two functions below rather than
 * being inlined, because getting that subtraction backwards is silent: the camera would still clamp, just
 * to the mirror-image range, and the screenshots would look plausible.
 */

/** The contract's proposed camera bounds, in metres and degrees. */
export const CAMERA_LIMITS = {
  radiusMinMeters: 2,
  radiusMaxMeters: 20,
  elevationMinDegrees: 10,
  elevationMaxDegrees: 80,
} as const;

/** One Babylon unit is one metre (UDG-SPEC-M0-002 v0.2 §5 world scale). */
export const METRES_PER_UNIT = 1;

/** Radians per degree. */
export const DEG_TO_RAD = Math.PI / 180;

/** Degrees per radian. */
export const RAD_TO_DEG = 180 / Math.PI;

/** Pointer millimetres of horizontal travel that rotate the camera by a full radius' worth of arc. */
export const ORBIT_RADIANS_PER_PIXEL = 0.006;

/** One wheel notch changes the radius by this fraction of itself, so zoom feels the same at any distance. */
export const ZOOM_FRACTION_PER_WHEEL_NOTCH = 0.08;

/** True only for a usable number: finite, so NaN and ±Infinity cannot reach a transform matrix. */
export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Clamp into [min, max]. A non-finite input falls back to `fallback`, never to NaN. */
export const clamp = (value: number, min: number, max: number, fallback: number): number => {
  if (!isFiniteNumber(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

/** Camera distance to its target, clamped to the contract's 2 m to 20 m. */
export const clampRadiusMeters = (radius: number): number =>
  clamp(radius, CAMERA_LIMITS.radiusMinMeters, CAMERA_LIMITS.radiusMaxMeters, (CAMERA_LIMITS.radiusMinMeters + CAMERA_LIMITS.radiusMaxMeters) / 2);

/** Elevation above the target's horizontal plane, clamped to the contract's 10° to 80°. */
export const clampElevationDegrees = (elevation: number): number =>
  clamp(elevation, CAMERA_LIMITS.elevationMinDegrees, CAMERA_LIMITS.elevationMaxDegrees, (CAMERA_LIMITS.elevationMinDegrees + CAMERA_LIMITS.elevationMaxDegrees) / 2);

/** Elevation in degrees to Babylon's polar `beta` in radians. */
export const elevationDegreesToBetaRadians = (elevation: number): number =>
  (90 - clampElevationDegrees(elevation)) * DEG_TO_RAD;

/** Babylon's polar `beta` in radians to elevation in degrees. */
export const betaRadiansToElevationDegrees = (beta: number): number =>
  clampElevationDegrees(90 - beta * RAD_TO_DEG);

/** `beta` limits for the camera object, derived from the elevation bounds (lower beta is higher up). */
export const betaLimitsRadians = (): Readonly<{ lower: number; upper: number }> => ({
  lower: elevationDegreesToBetaRadians(CAMERA_LIMITS.elevationMaxDegrees),
  upper: elevationDegreesToBetaRadians(CAMERA_LIMITS.elevationMinDegrees),
});

/**
 * A drag delta in pixels becomes an azimuth/polar delta in radians.
 *
 * One convention for every pointer device, and the horizontal sign has been ruled twice:
 *
 * * round 1 (Mac review, 2026-11-16) reversed the **mouse** horizontally and left touch alone, which put the two
 *   devices on opposite signs;
 * * round 2 (same day) moved the mouse gesture to the **middle button**, reserved the left button for UDG-008's
 *   click-to-move, and reversed the mouse horizontally **again** — back to the sign a touch drag has always used.
 *
 * So `−dx` is both the grab-the-world convention the acceptance list was written against and the direction the
 * reviewer asked for on a mouse, and no device branch is needed. Vertical drag (`−dy`: a drag down takes the
 * camera over the top) and both zoom paths are unchanged by either ruling.
 */
export const orbitStepRadians = (
  deltaX: number,
  deltaY: number,
): Readonly<{ alphaDelta: number; betaDelta: number }> => {
  const dx = isFiniteNumber(deltaX) ? deltaX : 0;
  const dy = isFiniteNumber(deltaY) ? deltaY : 0;
  return { alphaDelta: -dx * ORBIT_RADIANS_PER_PIXEL, betaDelta: -dy * ORBIT_RADIANS_PER_PIXEL };
};

/**
 * The four keys the focused scene canvas consumes. Anything else — Tab, Space, a browser shortcut — reaches the
 * page untouched, which is what "prevent browser scrolling only for arrow keys handled by the focused canvas"
 * asks for: the suppression is scoped to these keys and to the canvas, never to the page root.
 */
export const CAMERA_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const;

export type CameraKey = (typeof CAMERA_KEYS)[number];

export const isCameraKey = (key: string): key is CameraKey =>
  (CAMERA_KEYS as readonly string[]).includes(key);

/** Azimuth turn per key press, in radians (≈2.9°). Deliberately slower than a fast drag. */
export const KEY_ORBIT_RADIANS_PER_PRESS = 0.05;

/** Pitch change per key press, in degrees, applied through the same elevation clamp a drag uses. */
export const KEY_PITCH_DEGREES_PER_PRESS = 2;

/**
 * What a key press does to the camera, in the same directions as a drag.
 *
 * `ArrowRight` decreases the azimuth exactly as a rightward middle-drag does, and `ArrowUp` raises the
 * elevation. Pitch is returned in degrees rather than Babylon's polar radians so the caller can hand it to
 * `elevationDegreesToBetaRadians`, the one place the 10°–80° bound is written down.
 */
export const keyOrbitStep = (
  key: CameraKey,
): Readonly<{ alphaDeltaRadians: number; elevationDeltaDegrees: number }> => {
  switch (key) {
    case 'ArrowLeft':
      return { alphaDeltaRadians: KEY_ORBIT_RADIANS_PER_PRESS, elevationDeltaDegrees: 0 };
    case 'ArrowRight':
      return { alphaDeltaRadians: -KEY_ORBIT_RADIANS_PER_PRESS, elevationDeltaDegrees: 0 };
    case 'ArrowUp':
      return { alphaDeltaRadians: 0, elevationDeltaDegrees: KEY_PITCH_DEGREES_PER_PRESS };
    case 'ArrowDown':
      return { alphaDeltaRadians: 0, elevationDeltaDegrees: -KEY_PITCH_DEGREES_PER_PRESS };
  }
};

/**
 * A wheel notch, in the sign convention DOM `WheelEvent.deltaY` uses (positive scrolls away from the user).
 *
 * Zoom is multiplicative rather than additive: one notch at the near limit and one notch at the far limit
 * should feel the same to the hand, and an additive step either crawls at 20 m or jumps past the whole range
 * at 2 m.
 */
export const zoomRadiusMeters = (radius: number, wheelDeltaY: number): number => {
  const notch = isFiniteNumber(wheelDeltaY) ? wheelDeltaY : 0;
  const scale = 1 + notch * ZOOM_FRACTION_PER_WHEEL_NOTCH;
  const current = clampRadiusMeters(radius);
  return clampRadiusMeters(current * scale);
};

/**
 * A two-finger pinch. `scale` is `distanceNow / distanceStart`, so 2 means "spread to twice the gap".
 *
 * Spreading the fingers moves the camera *in*: the content is being pulled closer, which is what every
 * touch map does and what the acceptance list means by pinch zoom.
 */
export const pinchRadiusMeters = (radius: number, scale: number): number => {
  const current = clampRadiusMeters(radius);
  if (!isFiniteNumber(scale) || scale <= 0) return current;
  return clampRadiusMeters(current / scale);
};

/** Wrap an azimuth into [0, 2π) so a readout never grows without bound. */
export const wrapAzimuthRadians = (alpha: number): number => {
  if (!isFiniteNumber(alpha)) return 0;
  const tau = Math.PI * 2;
  const wrapped = alpha % tau;
  return wrapped < 0 ? wrapped + tau : wrapped;
};

/** A snapshot of the camera state a readout or an assertion can compare. */
export interface CameraReadout {
  readonly radiusMeters: number;
  readonly azimuthDegrees: number;
  readonly elevationDegrees: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly targetZ: number;
}

/** The readout form of a camera's three scalars plus its target. */
export const cameraReadout = (
  radiusMeters: number,
  alphaRadians: number,
  betaRadians: number,
  target: Readonly<{ x: number; y: number; z: number }>,
): CameraReadout => ({
  radiusMeters: clampRadiusMeters(radiusMeters),
  azimuthDegrees: wrapAzimuthRadians(alphaRadians) * RAD_TO_DEG,
  elevationDegrees: betaRadiansToElevationDegrees(betaRadians),
  targetX: target.x,
  targetY: target.y,
  targetZ: target.z,
});
