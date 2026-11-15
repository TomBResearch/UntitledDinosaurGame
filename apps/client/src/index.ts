/**
 * `@udg/client` — the browser workspace, implemented by UDG-004.
 *
 * This module still exports nothing, and that is a deliberate limit rather than an omission.
 *
 * UDG-004 implements Babylon presentation and the orbit camera. Its public surface is
 * `game/ClientRuntime.ts`, which exposes `start(canvas)`, `setPresentedPose(entityId, pose)`,
 * `removePresentedEntity(entityId)` and `dispose()` with `Pose = readonly { position: Vec3; yaw: number }`
 * (docs/contracts/UDG-004.md), and `main.tsx` is its only caller today: an application entry point, not a
 * library. A package subpath is a published commitment — `tests/contracts/UDG-001.test.ts` refuses an
 * implemented workspace an entry the contract's entry map does not carry, and the entry map lives in
 * `docs/contracts/protocol-v1.md`, which the UDG-004 assignment lists as do-not-touch — so the first consumer
 * that actually imports this workspace across a package boundary earns that row, in its own assignment. Until
 * then `dist/index.js` stays an honest empty module and every surface this task added is reached through
 * `src/`, which the boundary rules and `apps/client/tsconfig.json` still police.
 *
 * Where the implementation lives, in the order a reviewer probably wants it:
 *
 * - `src/main.tsx` — the mount/unmount pair, and the local test poses (development only).
 * - `src/game/ClientRuntime.ts` — the four-method surface, the single render loop, focus loss, disposal.
 * - `src/rendering/create-scene.ts` — right-handed, Y-up, metres, the asymmetrical axis marker.
 * - `src/rendering/OrbitCamera.ts` — orbit, wheel and pinch, with UI-region exclusion.
 * - `src/rendering/camera-math.ts` — the 2–20 m / 10–80° clamps, free of Babylon and the DOM.
 * - `src/rendering/PlayerView.ts` — presented entities; the only reader of shared configuration.
 * - `src/network/ClientConnection.ts` — connection status over `WebSocket`, no SDK and no session.
 * - `src/ui/*` — status banner and development overlay.
 * - `src/dev/` — the test-only mount/unmount seam; absent from every built artefact (see the note in
 *   `src/main.tsx`).
 *
 * Compiler policy: strict ESM, target ES2024, lib ["ES2024", "DOM", "DOM.Iterable"], types []. This is the one
 * workspace allowed to compile against the DOM library.
 */
export {};
