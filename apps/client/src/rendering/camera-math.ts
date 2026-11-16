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
 * Which physical device is dragging. Only two horizontal conventions exist in this client, and which one
 * applies is decided by `PointerEvent.pointerType`: `mouse`, or everything else (touch, pen, or a pointer that
 * declines to say), which all keep the touch convention.
 */
export type OrbitInputSource = 'mouse' | 'touch';

/**
 * The sign applied to a horizontal drag delta, per input device.
 *
 * **`touch: -1`** is the grab-the-world convention the acceptance list was written against: the scene moves with
 * the finger, because the point under the finger is treated as gripped. It is unchanged.
 *
 * **`mouse: +1`** is the owner's ruling from the Mac review of 2026-11-16: a horizontal mouse drag felt
 * inverted, so the mouse turns the camera the other way from the touch drag. Vertical drag, wheel zoom and
 * pinch zoom are untouched by this — only the azimuth sign differs by device, and the two conventions are
 * allowed to disagree because the hand holding a mouse and the finger on glass are asking for different things.
 */
export const ORBIT_AZIMUTH_DIRECTION: Readonly<Record<OrbitInputSource, number>> = {
  mouse: 1,
  touch: -1,
};

/**
 * A drag delta in pixels becomes an azimuth/polar delta in radians.
 *
 * `source` selects the horizontal convention (see {@link ORBIT_AZIMUTH_DIRECTION}); the vertical term is shared,
 * because a downward drag takes the camera over the top for both devices.
 */
export const orbitStepRadians = (
  deltaX: number,
  deltaY: number,
  source: OrbitInputSource,
): Readonly<{ alphaDelta: number; betaDelta: number }> => {
  const dx = isFiniteNumber(deltaX) ? deltaX : 0;
  const dy = isFiniteNumber(deltaY) ? deltaY : 0;
  return {
    alphaDelta: ORBIT_AZIMUTH_DIRECTION[source] * dx * ORBIT_RADIANS_PER_PIXEL,
    betaDelta: -dy * ORBIT_RADIANS_PER_PIXEL,
  };
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
