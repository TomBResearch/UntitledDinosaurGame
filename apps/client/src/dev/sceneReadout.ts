/**
 * Read-only facts about the live Babylon scene, for the development harness (assignment record §8).
 *
 * ## Why the numbers are collected here instead of asked of the runtime
 *
 * `ClientRuntime` deliberately exposes the four methods UDG-004 §2 names and one readout of its own bookkeeping.
 * The acceptance list it has to satisfy — no live render loop, no listeners registered by the app, meshes and
 * observers released, WebGL resources gone — is about what the *browser and the engine* are left holding after
 * `dispose()`, which a runtime cannot testify to: an object that has been disposed is in no position to describe
 * itself, and a counter that a component updates about itself is only as honest as that component. So this module
 * asks Babylon, through its public engine registry, and reports what it finds. Where a fact is available from
 * both sides, `tests/e2e/camera.spec.ts` compares the two and fails on a disagreement.
 *
 * ## Why the reads are defensive
 *
 * Babylon's typed surface is broad and its minor versions move members between classes, so anything reached
 * through a cast (`engine.scenes`, `engine.isDisposed`) is read through a narrowing helper that reports
 * `undefined` instead of throwing. An unavailable fact then shows up as a failed assertion in the browser suite
 * rather than as a page that crashes on a `TypeError` and gets blamed on the client.
 *
 * ## Development-only, like the harness that imports it
 *
 * Nothing here is reachable from a production build: `main.tsx` imports `lifecycleHarness.ts` — the only importer
 * of this file — inside `if (import.meta.env.DEV)`, and `tests/contracts/UDG-004.test.ts` byte-scans both built
 * trees for these module names.
 */

import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js';
import { EngineStore } from '@babylonjs/core/Engines/engineStore.js';
import type { Scene } from '@babylonjs/core/scene.js';

import { SCENE_NAMES } from '../rendering/create-scene.js';
import { cameraReadout, type CameraReadout } from '../rendering/camera-math.js';

/** Prefix `PlayerView` gives the root transform of each presented entity. */
export const ENTITY_ROOT_PREFIX = 'udg-entity-';

/** Suffix `PlayerView` gives the capsule of each presented entity — the mesh whose centre is the pose. */
export const ENTITY_BODY_SUFFIX = '-body';

/** Entity id from a body mesh name, or `undefined` for anything else in the scene. */
const entityIdOfBody = (name: string): string | undefined => {
  if (!name.startsWith(ENTITY_ROOT_PREFIX) || !name.endsWith(ENTITY_BODY_SUFFIX)) return undefined;
  const entityId = name.slice(ENTITY_ROOT_PREFIX.length, name.length - ENTITY_BODY_SUFFIX.length);
  return entityId.length > 0 ? entityId : undefined;
};

/** The world-space point of one mesh, as three plain numbers. */
export interface MeshPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** What one pointer pick found. */
export interface ScenePick {
  readonly name: string;
  readonly distance: number;
  readonly point: MeshPoint;
  /** The sampled canvas pixel, so a sweep can say where on screen the frame showed this mesh. */
  readonly x: number;
  readonly y: number;
}

/** The coordinate convention the scene was configured with, read back out of its own metadata. */
export interface SceneConvention {
  readonly handedness: string;
  readonly upAxis: string;
  readonly unit: string;
}

/**
 * Everything the harness reports about the scene, in one JSON-serialisable object.
 *
 * The `...Available` flags exist because a `0` and an `undefined` mean different things to an assertion: zero
 * meshes after `dispose()` is the result the test wants, an unreadable mesh list is a broken probe, and a suite
 * that cannot tell them apart is worse than no suite.
 */
export interface SceneFacts {
  /** Engines Babylon's own registry is holding right now. One while mounted, zero after disposal. */
  readonly engines: number;
  /** Scenes across those engines. */
  readonly scenes: number;
  readonly scenesAvailable: boolean;
  readonly meshes: number;
  readonly materials: number;
  readonly textures: number;
  /** Observers on the observables this client subscribes to, counted on the scene itself. */
  readonly renderObservers: number;
  readonly pointerObservers: number;
  /** Resize observers live on the engine, not the scene, in this Babylon build. */
  readonly resizeObservers: number;
  readonly disposeObservers: number;
  readonly engineDisposed: boolean | undefined;
  readonly sceneDisposed: boolean | undefined;
  readonly convention: SceneConvention | undefined;
  readonly camera: CameraReadout | undefined;
  readonly cameraName: string | undefined;
  readonly cameraPosition: MeshPoint | undefined;
  /** Axis-marker mesh positions by contract name, so handedness can be checked against the render. */
  readonly axisMeshes: Readonly<Record<string, MeshPoint>>;
  /** Presented entity roots by entity id, read from the scene rather than from the runtime. */
  readonly presented: Readonly<Record<string, MeshPoint>>;
  readonly presentedYaw: Readonly<Record<string, number>>;
  /**
   * World-space height of the first presented capsule, measured from its bounding box rather than from the
   * number that built it. This is the "metres" half of the convention: the adopted default capsule is
   * `MOVEMENT_DEFAULTS.capsuleHeight` = 1.8 m tall, and if a Babylon unit were not a metre here the bounding
   * box would say so.
   */
  readonly presentedHeightUnits: number | undefined;
}

/** Narrow `unknown` (reached through a cast) to a number, so a missing member is `undefined` and not a crash. */
const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asBoolean = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);

const asVector = (value: unknown): MeshPoint | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const x = asNumber(record['x']);
  const y = asNumber(record['y']);
  const z = asNumber(record['z']);
  return x === undefined || y === undefined || z === undefined ? undefined : { x, y, z };
};

const asLength = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'object' && value !== null) {
    const length = (value as Record<string, unknown>)['length'];
    if (typeof length === 'number' && Number.isFinite(length)) return length;
  }
  return undefined;
};

/** The engines Babylon's registry holds. Public, and the reason disposal can be measured from outside. */
export const registeredEngines = (): readonly AbstractEngine[] => {
  const instances = (EngineStore as unknown as { Instances?: unknown }).Instances;
  if (!Array.isArray(instances)) return [];
  return instances.filter((entry): entry is AbstractEngine => typeof entry === 'object' && entry !== null);
};

/** The scenes one engine holds, or `undefined` when this Babylon build does not expose the list. */
const engineScenes = (engine: AbstractEngine): readonly Scene[] | undefined => {
  const scenes = (engine as unknown as { scenes?: unknown }).scenes;
  if (!Array.isArray(scenes)) return undefined;
  return scenes.filter((entry): entry is Scene => typeof entry === 'object' && entry !== null);
};

/** The scene this client's canvas is drawing into, found through the registry rather than handed to us. */
export const sceneForCanvas = (canvas: HTMLCanvasElement | null): Scene | undefined => {
  if (canvas === null) return undefined;
  for (const engine of registeredEngines()) {
    const attached = engine.getRenderingCanvas();
    if (attached !== canvas) continue;
    const scenes = engineScenes(engine);
    if (scenes === undefined || scenes.length === 0) continue;
    return scenes[0];
  }
  return undefined;
};

const conventionOf = (scene: Scene): SceneConvention | undefined => {
  const metadata = (scene as unknown as { metadata?: unknown }).metadata;
  if (typeof metadata !== 'object' || metadata === null) return undefined;
  const record = metadata as Record<string, unknown>;
  const handedness = record['handedness'];
  const upAxis = record['upAxis'];
  const unit = record['unit'];
  if (typeof handedness !== 'string' || typeof upAxis !== 'string' || typeof unit !== 'string') return undefined;
  return { handedness, upAxis, unit };
};

const meshPoint = (scene: Scene, name: string): MeshPoint | undefined => {
  const node = scene.getMeshByName(name) ?? scene.getTransformNodeByName(name);
  if (typeof node !== 'object' || node === null) return undefined;
  // Absolute, not local: the marker hangs off a root node and the capsules hang off per-entity roots, so a
  // local read answers "where is it in its parent" while the acceptance question is "where is it in the world".
  const absolute = (node as unknown as { getAbsolutePosition?: () => unknown }).getAbsolutePosition;
  if (typeof absolute === 'function') return asVector(absolute.call(node));
  return asVector((node as unknown as Record<string, unknown>)['position']);
};

/**
 * Every fact the harness needs, read from the live engine and scene.
 *
 * `canvas` is the element the client was mounted on: the registry is searched for the engine drawing into it, so
 * the probe follows the app through mount and unmount instead of guessing which engine is theirs.
 */
export const readSceneFacts = (canvas: HTMLCanvasElement | null): SceneFacts => {
  const engines = registeredEngines();
  const scene = sceneForCanvas(canvas);
  const engine = scene?.getEngine();

  const axisMeshes: Record<string, MeshPoint> = {};
  const presented: Record<string, MeshPoint> = {};
  const presentedYaw: Record<string, number> = {};
  let presentedHeightUnits: number | undefined;
  if (scene !== undefined) {
    for (const [key, name] of Object.entries(SCENE_NAMES)) {
      if (!key.startsWith('axis')) continue;
      const point = meshPoint(scene, name);
      if (point !== undefined) axisMeshes[key] = point;
    }
    for (const mesh of scene.meshes) {
      const entityId = entityIdOfBody(mesh.name);
      if (entityId === undefined) continue;
      const absolute = (mesh as unknown as { getAbsolutePosition?: () => unknown }).getAbsolutePosition;
      const point = typeof absolute === 'function' ? asVector(absolute.call(mesh)) : undefined;
      if (point === undefined) continue;
      presented[entityId] = point;
      // The capsule is a child of the entity root, so the root carries the yaw while the body carries the
      // centre; the pose's yaw is therefore read from the root node, named by the same prefix PlayerView uses.
      const root = scene.getTransformNodeByName(`${ENTITY_ROOT_PREFIX}${entityId}`);
      const yaw = asNumber(root?.rotation?.y);
      if (yaw !== undefined) presentedYaw[entityId] = yaw;
      if (presentedHeightUnits === undefined) {
        // extendSizeWorld is the half-extent in world units, so twice it is the height a ruler would read.
        const bounding = (mesh as unknown as {
          getBoundingInfo?: () => { boundingBox?: { extendSizeWorld?: unknown } };
        }).getBoundingInfo?.();
        const extent = asVector(bounding?.boundingBox?.extendSizeWorld);
        if (extent !== undefined) presentedHeightUnits = extent.y * 2;
      }
    }
  }

  const camera = scene?.activeCamera as ArcRotateCamera | undefined;
  // A camera's `position` is world-space in Babylon (unlike a mesh's, which is relative to its parent), so this
  // one needs no absolute-position lookup — and `getAbsolutePosition` is not overridden on Camera, so reading
  // `position` is also the shorter path to the same fact.
  const cameraPosition = camera === undefined ? undefined : asVector(camera.position);
  const scenesPerEngine = engines.map((entry) => engineScenes(entry));
  const scenesReadable = scenesPerEngine.every((entry) => entry !== undefined);

  return {
    engines: engines.length,
    scenes: scenesReadable ? scenesPerEngine.reduce<number>((total, entry) => total + (entry?.length ?? 0), 0) : 0,
    scenesAvailable: scenesReadable,
    meshes: asLength(scene?.meshes) ?? 0,
    materials: asLength(scene?.materials) ?? 0,
    textures: asLength(scene?.textures) ?? 0,
    renderObservers: asLength(scene?.onBeforeRenderObservable?.observers) ?? 0,
    pointerObservers: asLength(scene?.onPointerObservable?.observers) ?? 0,
    resizeObservers: asLength(engine?.onResizeObservable?.observers) ?? 0,
    disposeObservers: asLength(scene?.onDisposeObservable?.observers) ?? 0,
    engineDisposed: asBoolean((engine as unknown as Record<string, unknown> | undefined)?.['isDisposed']),
    sceneDisposed: asBoolean((scene as unknown as Record<string, unknown> | undefined)?.['isDisposed']),
    convention: scene === undefined ? undefined : conventionOf(scene),
    camera:
      camera === undefined
        ? undefined
        : cameraReadout(
            asNumber(camera.radius) ?? Number.NaN,
            asNumber(camera.alpha) ?? Number.NaN,
            asNumber(camera.beta) ?? Number.NaN,
            asVector(camera.target) ?? { x: Number.NaN, y: Number.NaN, z: Number.NaN },
          ),
    cameraName: camera?.name,
    cameraPosition,
    axisMeshes,
    presented,
    presentedYaw,
    presentedHeightUnits,
  };
};

/**
 * Pick the client's own meshes at a canvas point.
 *
 * This is what turns "the positive X arm is on the camera's right" from an assertion about numbers into an
 * assertion about what the frame actually contains: the suite sweeps points, and the engine's picking answers
 * which named mesh is at each one. Only meshes this client created are candidates, so nothing external can
 * answer the question by accident.
 *
 * The ground is excluded unless asked for, and that is not a convenience: the arms lie in the ground plane, so
 * an unconstrained pick returns the floor in front of them at almost every pixel and the marker can never be
 * found. `udg-ground` is its own question (`includeGround`), not an obstacle hidden to make a test pass — the
 * plane is still asserted to exist, by name, in the same suite.
 */
export const pickUdgMesh = (
  canvas: HTMLCanvasElement | null,
  x: number,
  y: number,
  options?: { readonly includeGround?: boolean },
): ScenePick | undefined => {
  const scene = sceneForCanvas(canvas);
  if (scene === undefined) return undefined;
  const ours = new Set<string>(Object.values(SCENE_NAMES));
  const includeGround = options?.includeGround ?? false;
  const info = scene.pick(x, y, (mesh) => {
    if (!includeGround && mesh.name === SCENE_NAMES.ground) return false;
    return ours.has(mesh.name) || mesh.name.startsWith(ENTITY_ROOT_PREFIX);
  });
  const mesh = info?.pickedMesh;
  if (mesh === null || mesh === undefined || typeof mesh.name !== 'string') return undefined;
  const distance = asNumber((info as unknown as Record<string, unknown>)['distance']);
  const point = asVector((info as unknown as Record<string, unknown>)['pickedPoint']);
  if (distance === undefined || point === undefined) return undefined;
  return { name: mesh.name, distance, point, x, y };
};

/**
 * Sweep the canvas on a grid and report every client mesh the picker found, with the pixel it was seen at.
 *
 * Runs inside the page on purpose: 200+ round trips per assertion would make the browser suite slower than the
 * scene it is measuring, and a slow suite gets its assertions trimmed.
 */
export const sweepUdgPicks = (
  canvas: HTMLCanvasElement | null,
  stepPixels = 48,
): readonly ScenePick[] => {
  if (canvas === null) return [];
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const found: ScenePick[] = [];
  const seen = new Set<string>();
  for (let y = stepPixels; y < height - stepPixels / 2; y += stepPixels) {
    for (let x = stepPixels; x < width - stepPixels / 2; x += stepPixels) {
      const pick = pickUdgMesh(canvas, x, y);
      if (pick === undefined || seen.has(pick.name)) continue;
      seen.add(pick.name);
      found.push(pick);
    }
  }
  return found;
};
