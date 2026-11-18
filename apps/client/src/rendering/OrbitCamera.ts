/**
 * The orbit/zoom camera controller: pointer drag rotates, wheel and pinch zoom, and the gesture is ignored
 * when it starts inside an active UI region.
 *
 * ## Why this file exists instead of `camera.attachControl()`
 *
 * Babylon's own `ArcRotateCamera` pointer input is a good implementation, and it is deliberately not attached
 * here (see `createGreyboxScene`, which sets the clamp limits and stops). Two reasons, both acceptance items:
 *
 * 1. **UI exclusion needs a target.** "Camera consumes pointer gestures only outside active UI regions" is a
 *    statement about where a gesture *started*. The camera's built-in input is attached to an element and
 *    cannot see the UI panel that the compositor placed over it; this controller listens on the window in the
 *    capture phase and asks `event.target` directly, so the rule is explicit, it is counted
 *    (`ignoredOnUi`), and `tests/e2e/camera.spec.ts` can prove it by dispatching a gesture on the overlay and
 *    on the canvas and comparing the two.
 * 2. **One gesture owner.** Attaching Babylon's input *and* a controller would process every wheel notch and
 *    every pinch twice, which shows up as zoom that moves twice as fast as the hand moved.
 *
 * ## Which gesture moves the camera, and which one must not
 *
 * Ruled by the reviewer on 2026-11-16, and the horizontal direction has now been ruled twice (see
 * `orbitStepRadians` in `camera-math.ts`, which records both rounds):
 *
 * | Input | Camera? | Notes |
 * | --- | --- | --- |
 * | Middle-mouse drag | orbit + pitch | The mouse gesture. Horizontal direction ruled three times; it is currently the **opposite** sign to a touch drag (`ORBIT_AZIMUTH_DIRECTION`). |
 * | Left mouse press or drag | **never** | Reserved for UDG-008's click-to-move. Counted in `leftPressesIgnored` so a test can prove the camera sat still rather than that nothing was recorded. |
 * | Right mouse | never | The page's business; `contextmenu` is suppressed on the scene so an orbit view gives no menu. |
 * | Wheel over the canvas | zoom | Unchanged by either ruling. |
 * | One-finger touch drag | orbit | Keeps the scene under the finger. |
 * | Two-finger pinch | zoom | Never reads the azimuth term, so no direction ruling touches it. |
 * | Arrow keys, **canvas focused only** | orbit + pitch | See below. |
 *
 * ## Keyboard orbit needs a focus owner, a scope it cannot leak out of, and a clock it does not own
 *
 * The canvas is `tabindex="0"` (see `index.html`, which also paints the focus ring) and the key listeners are
 * attached **to the canvas**, not to the window: an arrow key pressed while focus is on a button, the overlay or
 * the page body is the browser's to use, and this controller never sees it. `preventDefault()` is called only for
 * the four arrow keys this handler consumes — never for other keys, and never on the document — so arrow-key
 * scrolling is suppressed in exactly one place.
 *
 * A key press is a **state, not a step**. `keydown` adds to `heldKeys`, `keyup` removes, and nothing here touches
 * the camera; the render loop calls `stepHeldKeys(deltaSeconds)` once a frame and `camera-math.ts` integrates
 * whatever is held against the elapsed time. That is what makes the motion smooth: the first frame after the
 * keydown already moves (no initial pause), the rate is the same every frame (no repeated jumps), and it does not
 * depend on how often the platform chooses to repeat a key — autorepeat is ignored outright (`event.repeat`).
 *
 * Motion therefore stops the moment the state empties: on `keyup`, on canvas `blur`, and on the window blur or
 * tab-hide path, where `ClientRuntime` calls `cancelActiveGestures()` and the loop is stopped anyway. A key still
 * physically down when focus leaves cannot resume driving the camera, because nothing re-adds it without a fresh
 * keydown on the focused canvas.
 *
 * ## Clamping is in two places on purpose
 *
 * The camera carries `lowerRadiusLimit`/`upperRadiusLimit` and `lowerBetaLimit`/`upperBetaLimit`, and every
 * write here also goes through `camera-math.ts`. The camera limits are what keeps a programmatic or animated
 * move inside the contract's range; the handler clamps are what stop a gesture from *asking* for a value
 * outside it, and they are unit-testable without a browser.
 *
 * ## Gestures that cannot be honoured are incidents, not exceptions
 *
 * A pointer can disappear between `pointerdown` and `pointermove`, and `setPointerCapture` then throws
 * `NotFoundError`. "Blocked pointer events … must not crash the UI" (docs/contracts/UDG-004.md) means that
 * case is caught, counted and reported through `onIncident` — never allowed to reach the browser's uncaught
 * error path, which is what `console-errors.json` counts. *
 * CI routing probe (C-07, measurement only — close without merging): `apps/client/**` is a camera-owned path,   * so the static, unit and camera lanes have a real pull request to route.

 */

import type { ArcRotateCamera } from '@babylonjs/core';
import type { Vec3 } from '@udg/protocol';

import {
  betaRadiansToElevationDegrees,
  cameraReadout,
  elevationDegreesToBetaRadians,
  heldKeyCameraStep,
  isCameraKey,
  orbitStepRadians,
  pinchRadiusMeters,
  RAD_TO_DEG,
  wrapAzimuthRadians,
  zoomRadiusMeters,
  type CameraKey,
  type CameraReadout,
  type OrbitInputSource,
} from './camera-math.js';

/** Attribute that marks a DOM region as UI. Anything under it is excluded from camera gestures. */
export const UI_REGION_ATTRIBUTE = 'data-udg-ui';

/** How far the camera target sits above a followed entity's contact point, in metres. */
export const FOLLOW_TARGET_HEIGHT_METRES = 0.9;

export type GestureIncidentKind =
  | 'pointer-capture-refused'
  | 'pointer-release-refused'
  | 'gesture-ignored-on-ui'
  | 'non-finite-gesture-value'
  | 'canvas-not-attachable';

export interface GestureIncident {
  readonly kind: GestureIncidentKind;
  readonly detail: string;
}

export interface OrbitCameraOptions {
  readonly canvas: HTMLCanvasElement;
  readonly camera: ArcRotateCamera;
  /** Called for every gesture the controller refused or survived. Reporting belongs to the caller. */
  readonly onIncident?: (incident: GestureIncident) => void;
}

export interface OrbitCameraStats {
  readonly drags: number;
  readonly wheelNotches: number;
  readonly pinches: number;
  readonly keySteps: number;
  /** Frames in which held arrow keys moved the camera. The smooth-motion counter `keySteps` cannot be. */
  readonly keyFrames: number;
  /** Left presses on the canvas, refused because UDG-008's click-to-move owns that button. */
  readonly leftPressesIgnored: number;
  readonly ignoredOnUi: number;
  readonly incidents: number;
  readonly listeners: number;
}

interface TrackedPointer {
  x: number;
  y: number;
  /** Which device owns this pointer, so a drag keeps the horizontal convention it started with. */
  source: OrbitInputSource;
}

/** `mouse` and `touch` differ in horizontal direction only; see `ORBIT_AZIMUTH_DIRECTION`. */
const inputSourceOf = (pointerType: string): OrbitInputSource => (pointerType === 'mouse' ? 'mouse' : 'touch');

const distanceBetween = (a: TrackedPointer, b: TrackedPointer): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

/**
 * One gesture controller bound to one canvas and one camera.
 *
 * `dispose()` removes exactly the listeners `constructor` added — the pair is counted, and
 * `tests/e2e/camera.spec.ts` cross-checks that count against an independent ledger of every
 * `addEventListener` the page performed.
 */
export class OrbitCamera {
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: ArcRotateCamera;
  private readonly onIncident: ((incident: GestureIncident) => void) | undefined;
  private readonly pointers = new Map<number, TrackedPointer>();
  private dragLast: TrackedPointer | undefined;
  private pinchStartDistance = 0;
  private pinchStartRadius = 0;
  private attached = false;
  private isDisposed = false;
  /** Arrow keys held down right now. Emptied on blur, which is what stops keyboard motion. */
  private readonly heldKeys = new Set<CameraKey>();
  private stats: OrbitCameraStats = {
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

  // Bound once, so removeEventListener is handed the identical function object it saw in add.
  private readonly handlePointerDown = (event: PointerEvent): void => this.onPointerDown(event);
  private readonly handlePointerMove = (event: PointerEvent): void => this.onPointerMove(event);
  private readonly handlePointerUp = (event: PointerEvent): void => this.onPointerUp(event);
  private readonly handleWheel = (event: WheelEvent): void => this.onWheel(event);
  private readonly handleContextMenu = (event: MouseEvent): void => this.onContextMenu(event);
  private readonly handleMouseDown = (event: MouseEvent): void => this.onMouseDown(event);
  private readonly handleKeyDown = (event: KeyboardEvent): void => this.onKeyDown(event);
  private readonly handleKeyUp = (event: KeyboardEvent): void => this.onKeyUp(event);
  private readonly handleBlur = (): void => this.onCanvasBlur();

  public constructor(options: OrbitCameraOptions) {
    this.canvas = options.canvas;
    this.camera = options.camera;
    this.onIncident = options.onIncident;
    this.attach();
  }

  public get disposed(): boolean {
    return this.isDisposed;
  }

  /** True while a drag or a pinch owns the camera. */
  public get gesturing(): boolean {
    return this.pointers.size > 0;
  }

  public get statsSnapshot(): OrbitCameraStats {
    return { ...this.stats, listeners: this.attached ? this.stats.listeners : 0 };
  }

  /** The camera state a readout or an assertion reads, in the units the contract states. */
  public readout(): CameraReadout {
    const target = this.camera.getTarget();
    return cameraReadout(this.camera.radius, this.camera.alpha, this.camera.beta, target);
  }

  /**
   * Move the orbit target to a followed entity, or back to the world origin.
   *
   * Reads the pose and writes the camera. The inverse direction does not exist in this file: no method here
   * takes a camera value and returns a pose, which is the structural half of the acceptance rule that camera
   * operations never mutate a pose.
   */
  public follow(contactPoint: Vec3 | undefined): void {
    if (this.isDisposed) return;
    if (contactPoint === undefined) {
      this.camera.setTarget(this.camera.getTarget().set(0, FOLLOW_TARGET_HEIGHT_METRES, 0));
      return;
    }
    if (
      !Number.isFinite(contactPoint.x)
      || !Number.isFinite(contactPoint.y)
      || !Number.isFinite(contactPoint.z)
    ) {
      this.incident('non-finite-gesture-value', 'follow() refused a non-finite target');
      return;
    }
    this.camera.setTarget(
      this.camera.getTarget().set(
        contactPoint.x,
        // A followed entity's target sits at its middle, so orbiting circles the body rather than its feet.
        contactPoint.y + FOLLOW_TARGET_HEIGHT_METRES,
        contactPoint.z,
      ),
    );
  }

  /**
   * Drop any in-flight gesture and any held camera key.
   *
   * Called on focus loss, on unmount and on disposal. Clearing `heldKeys` is the keyboard half of "stop any
   * keyboard camera motion on blur": the motion comes from a held key's autorepeat, and an autorepeat whose key
   * is not in the set is refused by `onKeyDown`.
   */
  public cancelActiveGestures(): void {
    this.pointers.clear();
    this.dragLast = undefined;
    this.pinchStartDistance = 0;
    this.heldKeys.clear();
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.cancelActiveGestures();
    this.detach();
    this.isDisposed = true;
  }

  private attach(): void {
    if (this.attached) return;
    if (!(this.canvas instanceof HTMLCanvasElement)) {
      this.incident('canvas-not-attachable', 'the scene canvas element is missing; gestures stay unattached');
      return;
    }
    // `touch-action: none` is what lets a one-finger drag rotate the camera instead of scrolling the page;
    // without it the browser claims the touch and the gesture never reaches the second pointermove.
    this.canvas.style.touchAction = 'none';
    // Capture phase on the window, so a gesture that begins on a UI panel is seen and refused rather than
    // silently swallowed by the element stack.
    window.addEventListener('pointerdown', this.handlePointerDown, { capture: true });
    window.addEventListener('pointermove', this.handlePointerMove, { capture: true });
    window.addEventListener('pointerup', this.handlePointerUp, { capture: true });
    window.addEventListener('pointercancel', this.handlePointerUp, { capture: true });
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.handleContextMenu);
    // Middle-click is autoscroll on some platforms and primary-paste on X11. Neither belongs in an orbit view,
    // and the only way to stop both is to refuse the mouse default before the browser acts on it.
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    // Keyboard listeners live on the canvas, so focus decides who gets the arrow keys. Nothing here listens on
    // the window for keys, and nothing here prevents a default the canvas did not consume.
    this.canvas.addEventListener('keydown', this.handleKeyDown);
    this.canvas.addEventListener('keyup', this.handleKeyUp);
    this.canvas.addEventListener('blur', this.handleBlur);
    this.attached = true;
    this.stats = { ...this.stats, listeners: 10 };
  }

  private detach(): void {
    if (!this.attached) return;
    window.removeEventListener('pointerdown', this.handlePointerDown, { capture: true });
    window.removeEventListener('pointermove', this.handlePointerMove, { capture: true });
    window.removeEventListener('pointerup', this.handlePointerUp, { capture: true });
    window.removeEventListener('pointercancel', this.handlePointerUp, { capture: true });
    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('keydown', this.handleKeyDown);
    this.canvas.removeEventListener('keyup', this.handleKeyUp);
    this.canvas.removeEventListener('blur', this.handleBlur);
    this.canvas.style.touchAction = '';
    this.attached = false;
    this.stats = { ...this.stats, listeners: 0 };
  }

  /** True when the gesture began on, or inside, a declared UI region. */
  private startsOnUi(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return target.closest(`[${UI_REGION_ATTRIBUTE}]`) !== null;
  }

  private onPointerDown(event: PointerEvent): void {
    if (this.isDisposed || !this.attached) return;
    if (this.startsOnUi(event.target)) {
      // Counted, and reported: the UI-exclusion acceptance check reads this counter as well as the camera.
      this.stats = { ...this.stats, ignoredOnUi: this.stats.ignoredOnUi + 1, incidents: this.stats.incidents + 1 };
      this.onIncident?.({ kind: 'gesture-ignored-on-ui', detail: `pointerdown on ${describe(event.target)}` });
      return;
    }
    if (event.target !== this.canvas) return; // gestures on the page background do not own the camera either
    if (event.pointerType === 'mouse' && event.button !== 1) {
      // Middle button only, by the reviewer's ruling. The left button is counted rather than silently dropped:
      // "left drag leaves the camera still" has to be distinguishable from "the page recorded nothing".
      if (event.button === 0) {
        this.stats = { ...this.stats, leftPressesIgnored: this.stats.leftPressesIgnored + 1 };
      }
      return;
    }
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      this.incident('non-finite-gesture-value', 'pointerdown carried a non-finite position');
      return;
    }
    const source = inputSourceOf(event.pointerType);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, source });
    if (this.pointers.size === 1) {
      this.dragLast = { x: event.clientX, y: event.clientY, source };
      this.stats = { ...this.stats, drags: this.stats.drags + 1 };
      this.capture(event);
    } else if (this.pointers.size === 2) {
      const [first, second] = [...this.pointers.values()];
      if (first !== undefined && second !== undefined) {
        this.pinchStartDistance = distanceBetween(first, second);
        this.pinchStartRadius = this.camera.radius;
        this.dragLast = undefined;
        this.stats = { ...this.stats, pinches: this.stats.pinches + 1 };
      }
    }
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.isDisposed || !this.attached) return;
    const previous = this.pointers.get(event.pointerId);
    if (previous === undefined) return; // a move for a gesture that did not start on the canvas
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      this.incident('non-finite-gesture-value', 'pointermove carried a non-finite position');
      return;
    }
    this.pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      source: inputSourceOf(event.pointerType),
    });

    if (this.pointers.size >= 2) {
      const [first, second] = [...this.pointers.values()];
      if (first === undefined || second === undefined || this.pinchStartDistance <= 0) return;
      const scale = distanceBetween(first, second) / this.pinchStartDistance;
      this.camera.radius = pinchRadiusMeters(this.pinchStartRadius, scale);
      return;
    }

    if (this.dragLast === undefined) return;
    const step = orbitStepRadians(
      event.clientX - this.dragLast.x,
      event.clientY - this.dragLast.y,
      this.dragLast.source,
    );
    this.dragLast = { x: event.clientX, y: event.clientY, source: this.dragLast.source };
    this.camera.alpha = wrapAzimuthRadians(this.camera.alpha + step.alphaDelta);
    // `betaDelta` is already in radians and already sign-correct for a drag (down drags the camera over the
    // top). The elevation helper clamps to 10°–80° and the conversion back is its own, so the pole and the
    // underside are both unreachable and the two bounds cannot drift apart.
    const dragged = betaRadiansToElevationDegrees(this.camera.beta) - step.betaDelta * RAD_TO_DEG;
    this.camera.beta = elevationDegreesToBetaRadians(dragged);
  }

  private onPointerUp(event: PointerEvent): void {
    if (!this.pointers.delete(event.pointerId)) return;
    if (this.pointers.size < 2) {
      this.pinchStartDistance = 0;
      this.pinchStartRadius = 0;
    }
    this.dragLast = this.pointers.size === 1 ? [...this.pointers.values()][0] : undefined;
    this.release(event);
  }

  private onMouseDown(event: MouseEvent): void {
    if (this.isDisposed || !this.attached) return;
    if (event.button === 1) event.preventDefault(); // no autoscroll, no primary-paste from an orbit drag
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.isDisposed || !this.attached) return;
    if (!isCameraKey(event.key)) return; // every other key is the page's, browser shortcuts included
    if (event.target !== this.canvas) return; // the listener is on the canvas; focus decides, twice over
    if (event.ctrlKey || event.metaKey || event.altKey) return; // a modified arrow is a shortcut, not a camera
    // Scoped to the four keys above and to this element: arrow-key page scrolling is suppressed here and nowhere
    // else, which is the whole of the "only for keys the focused canvas handles" requirement.
    event.preventDefault();
    if (event.repeat) return; // the state is already held; autorepeat cadence is not our clock
    if (this.heldKeys.has(event.key)) return;
    this.heldKeys.add(event.key);
    // Counting the press, not the movement: the acceptance suite reads this to prove an unfocused canvas was
    // refused, while `keyFrames` is what proves a focused one moved smoothly.
    this.stats = { ...this.stats, keySteps: this.stats.keySteps + 1 };
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (isCameraKey(event.key)) this.heldKeys.delete(event.key);
  }

  private onCanvasBlur(): void {
    // Focus left the canvas: no held key may keep driving the camera, and no pointer gesture started inside it
    // should look alive. The loop itself is stopped by ClientRuntime on window blur or tab-hide, which clears the
    // held keys through this same method.
    this.cancelActiveGestures();
  }

  /**
   * Advance the camera for the keys held right now. **Called once per rendered frame** by `ClientRuntime` with
   * the seconds that frame covered; it does nothing when no key is held, so an idle scene pays nothing.
   *
   * The camera writes are the same two lines a drag performs, through the same helpers, so the bounds are the
   * same bounds and a keyboard cannot reach a pole a drag cannot.
   */
  public stepHeldKeys(deltaSeconds: number): void {
    if (this.isDisposed || !this.attached || this.heldKeys.size === 0) return;
    const step = heldKeyCameraStep(this.heldKeys, deltaSeconds);
    if (step.alphaDeltaRadians === 0 && step.elevationDeltaDegrees === 0) return;
    this.camera.alpha = wrapAzimuthRadians(this.camera.alpha + step.alphaDeltaRadians);
    const pitched = betaRadiansToElevationDegrees(this.camera.beta) + step.elevationDeltaDegrees;
    this.camera.beta = elevationDegreesToBetaRadians(pitched);
    this.stats = { ...this.stats, keyFrames: this.stats.keyFrames + 1 };
  }

  private onWheel(event: WheelEvent): void {
    if (this.isDisposed || !this.attached) return;
    if (this.startsOnUi(event.target)) {
      this.stats = { ...this.stats, ignoredOnUi: this.stats.ignoredOnUi + 1, incidents: this.stats.incidents + 1 };
      this.onIncident?.({ kind: 'gesture-ignored-on-ui', detail: `wheel on ${describe(event.target)}` });
      return;
    }
    // Scrolling over the scene zooms the camera; it must not also scroll the page behind it.
    event.preventDefault();
    this.stats = { ...this.stats, wheelNotches: this.stats.wheelNotches + 1 };
    this.camera.radius = zoomRadiusMeters(this.camera.radius, event.deltaY);
  }

  private onContextMenu(event: MouseEvent): void {
    // A right-drag is not a camera gesture (see onPointerDown), so the menu it would open is the only
    // feedback a user would get. Suppressing it on the scene is the conventional choice for an orbit view.
    event.preventDefault();
  }

  private capture(event: PointerEvent): void {
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch (error) {
      // A pointer that vanished between down and capture is a real case, and the UI must survive it.
      this.incident('pointer-capture-refused', `setPointerCapture: ${message(error)}`);
    }
  }

  private release(event: PointerEvent): void {
    try {
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    } catch (error) {
      this.incident('pointer-release-refused', `releasePointerCapture: ${message(error)}`);
    }
  }

  private incident(kind: GestureIncidentKind, detail: string): void {
    this.stats = { ...this.stats, incidents: this.stats.incidents + 1 };
    this.onIncident?.({ kind, detail });
  }
}

/** A wheel notch expressed as a radius delta, so the clamp in `onWheel` sees a metre value. */
const describe = (target: EventTarget | null): string => {
  if (target instanceof Element) return `${target.tagName.toLowerCase()}[${target.getAttribute(UI_REGION_ATTRIBUTE) ?? 'ui-child'}]`;
  return String(target === null ? 'null' : 'non-element');
};

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
