/**
 * UDG-SPIKE-001 (Gate A, slice 5 review item 1): THE flat step relation — one pure exported
 * function, imported by every consumer on this side of the spike.
 *
 * Why this module exists: the review found the client-side step was a second implementation beside
 * the room's `FlatReferenceStepper` and the reference-trace producer. After this extraction there is
 * exactly ONE function per runtime on the prediction side — the SDK reconciler's client-side step
 * closure, the matched-ack checkpoint instrumenter, the replay-identity ledger, the browser test
 * pages (`/network/flatStep.js`) and the AC-1 reference trace (which imports the compiled
 * `apps/client/dist/network/flatStep.js`) all resolve to this export. "The same relation as the
 * reconciler's client-side step" is an identity, not a parity claim between copies; no separately
 * written speed formula feeds any spike expectation.
 *
 * The production authority keeps `FlatReferenceStepper` exactly as it is: this branch edits no
 * production authority default. Behavioural agreement between this relation and the live room is
 * evidenced in-browser — the refused-frame deltas at the exact authority ticks 40/120 and the zero
 * mixed-input windows are compared against vectors computed from THIS function — and the recorded
 * amendment proposal for making the server consume this same function (with the default preserved)
 * lives in `docs/integration/colyseus-0.18-api-map.md` §13.2.
 *
 * The body is byte-identical to the relation the adapter has carried since slice 4. Pure and
 * total: finite inputs are the caller's domain rule; nothing here reads a clock, the network or a
 * schema. It has no imports, which is what lets a plain Node reference tool consume the dist file.
 */

/** A horizontal pose on the flat plane — the shape the step relation maps over. */
export interface FlatPose {
  readonly x: number;
  readonly z: number;
}

/** The spike's shared flat step: `pose + drive · speed · dt`. */
export const flatDirectStep = (
  pose: Readonly<FlatPose>,
  drive: Readonly<{ moveX: number; moveZ: number }>,
  dtSeconds: number,
  speed: number,
): FlatPose => ({
  x: pose.x + drive.moveX * speed * dtSeconds,
  z: pose.z + drive.moveZ * speed * dtSeconds,
});
