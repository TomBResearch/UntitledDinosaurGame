/**
 * The greybox scene: engine, scene, orbit camera, ground plane and the asymmetrical axis marker.
 *
 * ## Order matters, and it is the order the contract states
 *
 * "Configure the scene right-handed, Y-up and metres before adding geometry" (docs/contracts/UDG-004.md) is
 * not stylistic. Babylon reads `useRightHandedSystem` when it builds projection and when geometry is
 * registered, so a scene whose handedness is set after the first mesh has been created can hold buffers
 * prepared under the other convention. `createGreyboxScene` therefore sets handedness first, on the line
 * before any `MeshBuilder` call, and nothing after the geometry block touches it.
 *
 * ## Why the axis marker is asymmetrical
 *
 * A symmetric cross cannot tell a right-handed scene from a mirrored one: both look like an axis cross, and
 * the handedness bug is exactly the kind that survives a glance. Each positive arm here is long, bright and
 * capped, and each negative arm is short, dim and uncapped, so `tests/e2e/camera.spec.ts` can ask a
 * directional question of the real projection matrices — with the camera looking down −Z from +Z, the red +X
 * cap must land to the **right** of the marker origin on screen — and the question flips if the scene is
 * mirrored. The screenshot at `axis-marker.png` is the same fact for the reviewer's eyes.
 *
 * ## Colours, not brightness
 *
 * Measured while proving the pin set: a mesh with no light and no emissive term renders black, and a
 * screenshot assertion on "is there something grey in the middle" passes for a black plane as easily as for a
 * lit one. So every marker part carries an emissive colour, the assertions compare which *colour* is where,
 * and a single hemispheric fill light gives the ground and the capsules some shading to sit on.
 */

import {
  ArcRotateCamera,
  Color3,
  Color4,
  Engine,
  HemisphericLight,
  Matrix,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import type { Mesh } from '@babylonjs/core';

import { betaLimitsRadians, CAMERA_LIMITS, DEG_TO_RAD } from './camera-math.js';

/** Mesh names are part of the test surface: the browser suite looks these up rather than counting meshes. */
export const SCENE_NAMES = {
  root: 'udg-greybox-root',
  ground: 'udg-ground',
  axisXPositive: 'udg-axis-x-positive',
  axisXCap: 'udg-axis-x-cap',
  axisXNegative: 'udg-axis-x-negative',
  axisZPositive: 'udg-axis-z-positive',
  axisZCap: 'udg-axis-z-cap',
  axisZNegative: 'udg-axis-z-negative',
  axisYPositive: 'udg-axis-y-positive',
  axisYCap: 'udg-axis-y-cap',
  light: 'udg-fill-light',
  camera: 'udg-orbit-camera',
  playerRoot: 'udg-player-root',
} as const;

/** Marker geometry, in metres. The positive arms are twice the negative stubs, and only they are capped. */
export const AXIS_GEOMETRY = {
  planeSizeMeters: 12,
  positiveArmMeters: 3,
  negativeArmMeters: 1.2,
  armThicknessMeters: 0.12,
  capRadiusMeters: 0.22,
} as const;

/** Marker colours. Distinct in the red/green/blue channels so a pixel test cannot confuse them. */
export const AXIS_COLOURS = {
  xPositive: new Color3(0.95, 0.16, 0.14),
  xNegative: new Color3(0.32, 0.08, 0.07),
  zPositive: new Color3(0.16, 0.42, 0.98),
  zNegative: new Color3(0.06, 0.14, 0.34),
  yPositive: new Color3(0.2, 0.9, 0.35),
  ground: new Color3(0.2, 0.22, 0.26),
} as const;

/** Where the orbit camera starts: a three-quarter view that shows both capped arms. */
export const INITIAL_CAMERA = {
  alphaRadians: 0.75 * Math.PI,
  elevationDegrees: 32,
  radiusMeters: 9,
  targetYMetres: 0.9,
} as const;

/**
 * Everything the renderer created, in one record, so disposal is a list rather than a scavenger hunt.
 *
 * `materials` exists because `mesh.dispose(false, true)` frees the material it owns, and a material shared
 * between two marker arms must therefore be freed exactly once — by the owner of this record, not by the
 * first mesh that happens to go away.
 */
export interface Greybox {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  readonly materials: readonly StandardMaterial[];
  readonly light: HemisphericLight;
}

/** The WebGL engine bound to one canvas. Exactly one engine per canvas, and one canvas per document. */
export const createRenderEngine = (canvas: HTMLCanvasElement): Engine =>
  // `antialias` is Babylon's own flag; `stencil` and the depth-only clear keep the frame cheap, and
  // `adaptToDeviceRatio` is what stops a 2× panel rendering a soft-looking scene.
  new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false, alpha: false, doNotHandleContextLost: false }, true);

/** An unlit-looking mesh is a black mesh, so every marker material carries its own emissive term. */
const markerMaterial = (scene: Scene, name: string, colour: Color3): StandardMaterial => {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = colour.scale(0.6);
  material.emissiveColor = colour.scale(0.85);
  material.specularColor = new Color3(0.02, 0.02, 0.02);
  material.disableLighting = false;
  return material;
};

const arm = (
  scene: Scene,
  name: string,
  length: number,
  axis: 'x' | 'y' | 'z',
  colour: Color3,
  materialName: string,
): Readonly<{ mesh: Mesh; material: StandardMaterial }> => {
  const magnitude = Math.abs(length);
  const dimensions =
    axis === 'x'
      ? { width: magnitude, height: AXIS_GEOMETRY.armThicknessMeters, depth: AXIS_GEOMETRY.armThicknessMeters }
      : axis === 'y'
        ? { width: AXIS_GEOMETRY.armThicknessMeters, height: magnitude, depth: AXIS_GEOMETRY.armThicknessMeters }
        : { width: AXIS_GEOMETRY.armThicknessMeters, height: AXIS_GEOMETRY.armThicknessMeters, depth: magnitude };
  const mesh = MeshBuilder.CreateBox(name, dimensions, scene);
  // The box is centred on its own origin, so the arm is pushed out by half its length to start at the root.
  // `length` carries the direction — a negative arm is passed a negative length — so the half that offsets it
  // is signed the same way and must not be negated a second time. Measured: with `-half` here the negative X
  // and negative Z arms sat at +0.6 m, pointing the same way as their positive partners, which is precisely the
  // handedness mistake this marker exists to make visible.
  const half = length / 2;
  if (axis === 'x') mesh.position.set(half, 0, 0);
  if (axis === 'y') mesh.position.set(0, half, 0);
  if (axis === 'z') mesh.position.set(0, 0, half);
  const material = markerMaterial(scene, materialName, colour);
  mesh.material = material;
  return { mesh, material };
};

const cap = (
  scene: Scene,
  name: string,
  position: Vector3,
  material: StandardMaterial,
): Mesh => {
  const mesh = MeshBuilder.CreateSphere(name, { diameter: AXIS_GEOMETRY.capRadiusMeters * 2, segments: 12 }, scene);
  mesh.position.copyFrom(position);
  mesh.material = material;
  return mesh;
};

/**
 * Build the greybox. Handedness, up axis and scale are stated before a single mesh exists.
 *
 * `minZ`/`maxZ` are in metres because a Babylon unit *is* a metre here (`METRES_PER_UNIT` in camera-math.ts);
 * the near plane is small enough to keep the 2 m minimum radius usable without clipping the target, and the
 * far plane covers the 20 m maximum radius with the whole plane inside it.
 */
export const createGreyboxScene = (engine: Engine): Greybox => {
  const scene = new Scene(engine);

  // 1. Convention, before geometry: right-handed, Y up, metres.
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(0.055, 0.065, 0.08, 1);
  scene.ambientColor = new Color3(0.12, 0.13, 0.15);
  scene.metadata = {
    handedness: 'right-handed',
    upAxis: 'Y',
    unit: 'metre',
    radiusLimitsMetres: [CAMERA_LIMITS.radiusMinMeters, CAMERA_LIMITS.radiusMaxMeters],
    elevationLimitsDegrees: [CAMERA_LIMITS.elevationMinDegrees, CAMERA_LIMITS.elevationMaxDegrees],
  };

  // 2. Camera. Created before the geometry so the very first frame has a valid view matrix.
  const beta = betaLimitsRadians();
  const camera = new ArcRotateCamera(
    SCENE_NAMES.camera,
    INITIAL_CAMERA.alphaRadians,
    // `beta` is the polar angle down from +Y; the helper owns that conversion.
    (90 - INITIAL_CAMERA.elevationDegrees) * DEG_TO_RAD,
    INITIAL_CAMERA.radiusMeters,
    new Vector3(0, INITIAL_CAMERA.targetYMetres, 0),
    scene,
  );
  camera.lowerRadiusLimit = CAMERA_LIMITS.radiusMinMeters;
  camera.upperRadiusLimit = CAMERA_LIMITS.radiusMaxMeters;
  camera.lowerBetaLimit = beta.lower;
  camera.upperBetaLimit = beta.upper;
  camera.minZ = 0.05;
  camera.maxZ = 120;
  camera.fov = 0.85;
  camera.panningSensibility = 0; // Panning would move the target out from under the followed entity.
  // Babylon's own pointer/wheel input is deliberately never attached: gestures belong to OrbitCamera.ts,
  // which is the one place that knows where the UI regions are. Attaching both would double every gesture.

  // 3. Geometry, now that the convention is fixed.
  const meshes: Mesh[] = [];
  const materials: StandardMaterial[] = [];
  const root = new TransformNode(SCENE_NAMES.root, scene);

  const ground = MeshBuilder.CreateGround(
    SCENE_NAMES.ground,
    // Measured against 8.56.2: `CreateGround` takes width/height/subdivisions only — there is no `up`
    // option, and none is wanted: the ground is built in the XZ plane, which is the Y-up convention the scene
    // was configured for on the line above.
    { width: AXIS_GEOMETRY.planeSizeMeters, height: AXIS_GEOMETRY.planeSizeMeters, subdivisions: 1 },
    scene,
  );
  const groundMaterial = markerMaterial(scene, 'udg-ground-material', AXIS_COLOURS.ground);
  ground.material = groundMaterial;
  ground.parent = root;
  meshes.push(ground);
  materials.push(groundMaterial);

  const xPositive = arm(scene, SCENE_NAMES.axisXPositive, AXIS_GEOMETRY.positiveArmMeters, 'x', AXIS_COLOURS.xPositive, 'udg-axis-x-material');
  const xNegative = arm(scene, SCENE_NAMES.axisXNegative, -AXIS_GEOMETRY.negativeArmMeters, 'x', AXIS_COLOURS.xNegative, 'udg-axis-x-negative-material');
  const zPositive = arm(scene, SCENE_NAMES.axisZPositive, AXIS_GEOMETRY.positiveArmMeters, 'z', AXIS_COLOURS.zPositive, 'udg-axis-z-material');
  const zNegative = arm(scene, SCENE_NAMES.axisZNegative, -AXIS_GEOMETRY.negativeArmMeters, 'z', AXIS_COLOURS.zNegative, 'udg-axis-z-negative-material');
  const yPositive = arm(scene, SCENE_NAMES.axisYPositive, AXIS_GEOMETRY.positiveArmMeters * 0.6, 'y', AXIS_COLOURS.yPositive, 'udg-axis-y-material');
  // The caps belong to the positive arms only, and only +X and +Z carry one: that asymmetry is the
  // handedness witness, so the two cap positions are what the projection assertion measures.
  const xCap = cap(scene, SCENE_NAMES.axisXCap, new Vector3(AXIS_GEOMETRY.positiveArmMeters, 0, 0), xPositive.material);
  const zCap = cap(scene, SCENE_NAMES.axisZCap, new Vector3(0, 0, AXIS_GEOMETRY.positiveArmMeters), zPositive.material);
  const yCap = cap(scene, SCENE_NAMES.axisYCap, new Vector3(0, AXIS_GEOMETRY.positiveArmMeters * 0.6, 0), yPositive.material);

  for (const part of [xPositive, xNegative, zPositive, zNegative, yPositive]) {
    part.mesh.parent = root;
    meshes.push(part.mesh);
    materials.push(part.material);
  }
  xCap.parent = root;
  zCap.parent = root;
  yCap.parent = root;
  meshes.push(xCap, zCap, yCap);

  // 4. One fill light. The emissive terms already carry the marker colours; this gives the plane and the
  //    capsules a gradient, which is what makes a 20 m zoom-out readable as a 3D scene.
  const light = new HemisphericLight(SCENE_NAMES.light, new Vector3(0.35, 1, 0.25), scene);
  light.intensity = 0.85;
  light.diffuse = new Color3(1, 0.98, 0.95);
  light.groundColor = new Color3(0.18, 0.2, 0.24);

  return { engine, scene, camera, root, meshes, materials, light };
};

/**
 * Screen position of a world point under the camera's real matrices.
 *
 * This is the witness the handedness assertion measures: it goes through the scene's transform matrix and
 * the camera's viewport rather than a hand-written projection, so it says something about the scene the
 * browser actually rendered.
 */
export const screenPositionOf = (
  greybox: Greybox,
  world: Vector3,
): Readonly<{ x: number; y: number }> | undefined => {
  const { scene, camera, engine } = greybox;
  const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
  const projected = Vector3.Project(world, Matrix.IdentityReadOnly, scene.getTransformMatrix(), viewport);
  return projected === null ? undefined : { x: projected.x, y: projected.y };
};
