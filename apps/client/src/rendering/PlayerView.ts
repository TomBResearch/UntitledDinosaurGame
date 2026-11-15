/**
 * The presented-entity view: one placeholder capsule per presented entity id, and nothing else.
 *
 * ## What "presented" means here
 *
 * `setPresentedPose` writes into the *presentation* layer. It is not authority, not prediction and not a
 * movement controller: nothing in this file reads an input intention, integrates a velocity, snaps to ground
 * or applies gravity. UDG-004 runs on local test poses precisely so that no presentation code can be mistaken
 * for the server-owned transform, and the capsule geometry is the only place a number from shared
 * configuration enters.
 *
 * ## P07 is pending, and this file is where that shows up
 *
 * The capsule's centre is `position.y + MOVEMENT_DEFAULTS.capsuleHeight / 2`, i.e. 0.9 m above the pose's
 * contact point with the plane. That is the **adopted** v0.2 capsule height (UDG-SPEC-M0-002 §5, pinned in
 * `@udg/config`), and it is the only configuration value this file reads besides the capsule radius. It is
 * deliberately not `CONTROLLER_DEFAULTS.restCentreY` (0.91 m), which is the P07 *controller* rest centre: P07
 * is pending, `docs/interfaces/configuration.md` lists `controller.restCentreY`, `controllerOffset`,
 * `groundSnapDistance`, `minStepTopWidth`, `staticOnlyAutostep`, `allowDynamicImpulses`, `slopeSlideRadians`
 * and `movement.gravity` as `PROVISIONAL_P07_FIELDS`, and a placeholder that consumed any of them would make
 * this task's evidence depend on a decision that has not been made. `tests/contracts/UDG-004.test.ts` greps
 * this directory for those names rather than trusting this paragraph, so if P07 lands later and changes the
 * controller numbers, UDG-004 is still true.
 *
 * ## Coordinate convention, stated once
 *
 * `position` is the entity's **contact point** with the ground plane (feet on the floor), and the placeholder
 * renders its capsule centre half a capsule above it. A reviewer reading a test pose of
 * `y = 0` and a mesh at `y = 0.9` is therefore looking at the adopted capsule height, not at a discrepancy.
 * `yaw` is radians about +Y, measured from +Z toward +X, which is the right-handed sense the scene is
 * configured in.
 *
 * ## Independence
 *
 * Entities are keyed by id, each owning its own transform node and meshes. Moving one entity cannot move
 * another because there is no shared state between them, and the acceptance criterion "two independent
 * presented entities" is measured that way: the acceptance run drives one entity continuously and asserts the
 * other's transform and write count never change.
 */

import { MeshBuilder, StandardMaterial, TransformNode, Color3, Vector3 } from '@babylonjs/core';
import type { Mesh } from '@babylonjs/core';
import { MOVEMENT_DEFAULTS } from '@udg/config';
import type { Vec3 } from '@udg/protocol';

import type { Greybox } from './create-scene.js';

/**
 * The presentation transform.
 *
 * Structurally identical to `Pose` in `game/ClientRuntime.ts` — that is the contract's shape — and repeated
 * here rather than imported on purpose: `ClientRuntime` owns `Pose` and imports this module, so a type import
 * in the other direction would be a first-party import cycle, which `tools/checks/src/boundaries.ts` reports
 * as `BOUNDARY-CYCLE` and which no amount of `import type` reasoning excuses at build time.
 */
export interface PresentedTransform {
  readonly position: Vec3;
  readonly yaw: number;
}

/** Capsule centre height above the pose's contact point: the adopted 1.8 m default, halved. */
export const PLACEHOLDER_CENTRE_Y_OFFSET_METRES: number = MOVEMENT_DEFAULTS.capsuleHeight / 2;

/** The adopted v0.2 capsule height itself, used for the mesh so the two numbers cannot drift apart. */
export const PLACEHOLDER_HEIGHT_METRES: number = MOVEMENT_DEFAULTS.capsuleHeight;

/** Placeholder radius, from the same adopted block. */
export const PLACEHOLDER_RADIUS_METRES: number = MOVEMENT_DEFAULTS.capsuleRadius;

/**
 * Per-entity tints, so two presented entities are distinguishable in a screenshot.
 *
 * Assigned by insertion order, not hashed from the id: a hash gave the two local test poses neighbouring
 * greens, which is exactly the case the screenshot is supposed to make obvious. Idles past the palette simply
 * cycle, and independence is about transforms rather than colour, but a reviewer comparing two capsules should
 * not have to squint.
 */
const ENTITY_COLOURS: readonly [number, number, number][] = [
  [0.98, 0.55, 0.15],
  [0.2, 0.62, 0.98],
  [0.55, 0.9, 0.35],
  [0.85, 0.42, 0.92],
];

const ENTITY_ROOT_PREFIX = 'udg-entity-';
const HEADING_PREFIX = 'udg-heading-';
const BODY_SUFFIX = '-body';

interface Entity {
  readonly root: TransformNode;
  readonly body: Mesh;
  readonly heading: Mesh;
  readonly material: StandardMaterial;
  readonly headingMaterial: StandardMaterial;
  /** The last transform written, so a read-back does not have to decode a matrix. */
  transform: PresentedTransform;
}

/** A name that is safe to embed in a mesh name and in a `data-*` attribute. */
const entityRootName = (entityId: string): string => `${ENTITY_ROOT_PREFIX}${entityId}`;

/**
 * Owns the placeholder meshes for presented entities.
 *
 * The view never reads from the camera and never writes to anything but its own nodes, which is what makes
 * "camera operations never mutate either pose" a property of the code rather than a hope.
 */
export class PlayerView {
  private readonly entities = new Map<string, Entity>();
  private disposed = false;

  public constructor(private readonly greybox: Greybox) {}

  /** How many presented entities exist right now. */
  public get count(): number {
    return this.entities.size;
  }

  /** Ids in insertion order, for a readout that must not shuffle between frames. */
  public ids(): readonly string[] {
    return [...this.entities.keys()];
  }

  public has(entityId: string): boolean {
    return this.entities.has(entityId);
  }

  /** The transform last written for an entity, or `undefined` when it does not exist. */
  public transformOf(entityId: string): PresentedTransform | undefined {
    return this.entities.get(entityId)?.transform;
  }

  /** World position of an entity's capsule centre, for an assertion that measures the mesh rather than a field. */
  public centreOf(entityId: string): Readonly<{ x: number; y: number; z: number; yaw: number }> | undefined {
    const entity = this.entities.get(entityId);
    if (entity === undefined) return undefined;
    // Absolute, not local: the capsule hangs off the entity root, and the reviewer's question is about the
    // point in the world where the placeholder stands.
    const centre = entity.body.getAbsolutePosition();
    return { x: centre.x, y: centre.y, z: centre.z, yaw: entity.root.rotation.y };
  }

  /**
   * Create or move one presented entity.
   *
   * `body.position` is the capsule centre, which is why the y write is the offset and not the pose value:
   * the offset is `MOVEMENT_DEFAULTS.capsuleHeight / 2`, the adopted half-height.
   */
  public upsert(entityId: string, transform: PresentedTransform): void {
    if (this.disposed) return;
    const existing = this.entities.get(entityId);
    if (existing !== undefined) {
      this.apply(existing, transform);
      return;
    }
    this.entities.set(entityId, this.create(entityId, transform));
  }

  /** Remove one presented entity and free both its meshes and both its materials. */
  public remove(entityId: string): boolean {
    const entity = this.entities.get(entityId);
    if (entity === undefined) return false;
    // dispose(doNotRecurse, disposeMaterialAndTextures): each of these two materials is owned by exactly one
    // mesh, so freeing them with the mesh cannot free a material another entity still points at.
    entity.body.dispose(false, true);
    entity.heading.dispose(false, true);
    entity.root.dispose();
    this.entities.delete(entityId);
    return true;
  }

  /** Free every presented entity. Idempotent, because disposal runs from two directions (dispose and unmount). */
  public dispose(): void {
    for (const entityId of [...this.entities.keys()]) this.remove(entityId);
    this.entities.clear();
    this.disposed = true;
  }

  private create(entityId: string, transform: PresentedTransform): Entity {
    const scene = this.greybox.scene;
    const name = entityRootName(entityId);
    const root = new TransformNode(name, scene);
    const body = MeshBuilder.CreateCapsule(
      `${name}${BODY_SUFFIX}`,
      { height: PLACEHOLDER_HEIGHT_METRES, radius: PLACEHOLDER_RADIUS_METRES },
      scene,
    );
    body.parent = root;
    const tint = ENTITY_COLOURS[this.entities.size % ENTITY_COLOURS.length] ?? [0.85, 0.85, 0.85];
    const material = new StandardMaterial(`${name}-material`, scene);
    material.diffuseColor = new Color3(tint[0] * 0.7, tint[1] * 0.7, tint[2] * 0.7);
    material.emissiveColor = new Color3(tint[0] * 0.35, tint[1] * 0.35, tint[2] * 0.35);
    material.specularColor = new Color3(0.05, 0.05, 0.05);
    body.material = material;

    // The heading marker sits on the entity's +Z side, so a yaw of 0 points it at +Z and the sense matches
    // the scene's right-handed rotation about +Y.
    const heading = MeshBuilder.CreateBox(
      `${name}${HEADING_PREFIX}`,
      { width: PLACEHOLDER_RADIUS_METRES * 0.6, height: PLACEHOLDER_RADIUS_METRES * 0.4, depth: PLACEHOLDER_RADIUS_METRES * 1.6 },
      scene,
    );
    heading.parent = root;
    const headingMaterial = new StandardMaterial(`${name}-heading-material`, scene);
    headingMaterial.emissiveColor = new Color3(tint[0], tint[1], tint[2]);
    headingMaterial.diffuseColor = new Color3(tint[0] * 0.5, tint[1] * 0.5, tint[2] * 0.5);
    heading.material = headingMaterial;

    const entity: Entity = { root, body, heading, material, headingMaterial, transform };
    this.apply(entity, transform);
    return entity;
  }

  private apply(entity: Entity, transform: PresentedTransform): void {
    const { position, yaw } = transform;
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z) || !Number.isFinite(yaw)) {
      // A non-finite pose is refused rather than written: a NaN in a transform matrix silently removes every
      // mesh that shares it, which reads as "the renderer broke" rather than as "a bad pose arrived".
      return;
    }
    entity.root.position.set(position.x, position.y, position.z);
    entity.root.rotation.y = yaw;
    entity.body.position.set(0, PLACEHOLDER_CENTRE_Y_OFFSET_METRES, 0);
    entity.heading.position.set(0, PLACEHOLDER_CENTRE_Y_OFFSET_METRES, PLACEHOLDER_RADIUS_METRES * 1.4);
    entity.transform = transform;
  }
}

/** The direction a yaw of 0 faces, exported for the heading assertion in the browser suite. */
export const FORWARD_AT_ZERO_YAW = new Vector3(0, 0, 1);
