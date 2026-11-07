# Canonical domain contracts

> Source: UDG-CONTRACTS-M0-001 v1.0, section 4.1 and Appendix A. Repository edition 1. Shared requirements are authoritative here; task files link to them.

### 4.1 Domain declaration ownership

[canonical domain declarations](domain.md) reproduces the v0.2 domain declarations as the baseline. UDG-002 owns packages/protocol/src/domain/{primitives,state,movement,commands,physics,navigation}.ts. Domain declarations may live under protocol for shared identity without importing runtime schema code. UDG-005 implements locomotion and authority behaviour; UDG-006 implements CharacterPhysics; UDG-007 implements NavigationService. Implementers consume these declarations rather than maintaining local copies.

Three omissions in v0.2 are resolved by proposed binding factories, preserving its method signatures. LocomotionSimulator.step has no entityId, so createLocomotionSimulator(entityId: EntityId): LocomotionSimulator binds exactly one entity. Its StepEnvironment supplies that entity's scoped route store. CharacterPhysics calls always use the bound ID; sharing one mutable simulator between entities is prohibited. createNavigationService(scope: NavigationScope): NavigationService binds region, entity, epoch, immutable navmesh and a server-owned allocateRevision function. NavigationScope is defined in packages/navigation/src/contracts.ts and never sent by clients. Route revisions may have gaps after rejected work; they must strictly increase on allocation within an epoch.

NavigationService.findPath remains synchronous at the domain boundary. A worker wrapper schedules the synchronous query away from the room loop and returns an immutable completion ticket. It must not change the public method into an unreviewed Promise. RouteStore.get is read-only to simulation. packages/simulation/src/route-store.ts exports createRouteStore(), with writer methods put(route), delete(revision) and clear() held only by authority. Return defensive copies or deeply frozen values; numeric revisions are scoped by entity, epoch and region.

The following additional signatures are proposed in packages/navigation/src/contracts.ts. The immutable binary/config is installed once per worker; the server reserves a revision before dispatch and supplies a worker-local allocator returning that reserved revision. Functions and native handles are never serialised across the worker boundary.

```typescript
interface NavigationScope {
  entityId: EntityId; regionId: RegionId;
  sessionEpoch: SessionEpoch; navmeshHash: string;
  allocateRevision: () => number;
}
interface RouteWorkTicket {
  entityId: EntityId; sessionEpoch: SessionEpoch;
  generation: number; requestId: string;
  start: Vec3; destination: Vec3; agentRadius: number;
  navmeshHash: string; configHash: string;
  issuedTick: ServerTick; cutoffOrdinal: number;
  reservedRevision: number;
}
interface RouteCompletion {
  ticket: Readonly<RouteWorkTicket>;
  result: NavigationResult;
}
interface RouteWorker {
  submit(ticket: Readonly<RouteWorkTicket>):
    "QUEUED" | "NAVIGATION_BUSY";
  invalidate(entityId: EntityId, sessionEpoch: SessionEpoch): void;
  takeCompleted(): readonly RouteCompletion[];
  dispose(): void;
}
```

The factory also receives its immutable navmesh/config through the created service's constructor dependencies, not through a gameplay query. Completion tickets enter the authoritative journal at observation time. invalidate cancels pending work where supported and always marks results uncommittable; correctness never depends on native cancellation succeeding.

## Canonical domain declarations

These editable declarations reproduce the v0.2 interface shapes. They are UDG-owned interfaces, not snippets of a Colyseus, Rapier or Recast API. Split them into the paths specified in [section 4.1](domain.md). Factory bindings, wire envelopes, result-code constraints and replica mappings in this contracts edition refine their use; no implementation bodies are included.

### A1 Primitives and state

```typescript
type WorldId = string;
type RegionId = string;
type EntityId = string;
type SessionEpoch = number;
type ServerTick = number;
type MovementMode = "idle" | "direct" | "path";
interface Vec2 { x: number; y: number; }
interface Vec3 { x: number; y: number; z: number; }
interface KinematicState {
  position: Vec3; yaw: number; velocity: Vec3;
  grounded: boolean; verticalVelocity: number;
}
interface RouteProgress {
  revision: number; nextWaypointIndex: number;
}
interface LocomotionState {
  kinematic: KinematicState;
  mode: MovementMode;
  route: RouteProgress | null;
  intentGeneration: number;
  lastAuthorityTick: ServerTick;
}
interface PlayerSimulationState {
  entityId: EntityId; sessionEpoch: SessionEpoch;
  connected: boolean; locomotion: LocomotionState;
}
```

Vec2.y denotes horizontal Z only when used as a movement-input pair. World Vec3.y is vertical. Do not silently exchange these conventions in an input or navigation adapter.

### A2 Locomotion

```typescript
interface DirectInput { moveX: number; moveZ: number; }
interface MovementConfig {
  speed: number; capsuleRadius: number;
  capsuleHeight: number; arrivalTolerance: number;
  gravity: number; maxSlopeRadians: number;
  maxStepHeight: number;
}
interface StepEnvironment {
  collision: CharacterPhysics; routes: RouteStore;
}
interface StepResult {
  state: LocomotionState;
  reachedDestination: boolean; blocked: boolean;
}
interface LocomotionSimulator {
  step(
    state: LocomotionState, input: DirectInput,
    dtSeconds: number, config: Readonly<MovementConfig>,
    environment: StepEnvironment
  ): StepResult;
}
```

### A3 Navigation

```typescript
interface NavigationQuery {
  start: Vec3; destination: Vec3; agentRadius: number;
}
interface NavigationRoute {
  revision: number; navmeshHash: string;
  waypoints: readonly Vec3[]; destination: Vec3;
}
type NavigationResult =
  | { ok: true; route: NavigationRoute }
  | { ok: false; reason:
      "INVALID_DESTINATION" | "OUT_OF_BOUNDS" |
      "UNREACHABLE" | "RATE_LIMITED" |
      "SUPERSEDED" | "NAVIGATION_BUSY" };
interface NavigationService {
  findPath(query: NavigationQuery): NavigationResult;
}
interface RouteStore {
  get(revision: number): NavigationRoute | null;
}
```

### A4 Physics

```typescript
interface CharacterPhysicsConfig {
  radius: number; totalHeight: number;
  collisionGroup: number;
}
interface PhysicsResolution {
  kinematic: KinematicState;
  actualDisplacement: Vec3; blocked: boolean;
}
interface CharacterPhysics {
  createCharacter(
    entityId: EntityId, initial: KinematicState,
    config: CharacterPhysicsConfig
  ): void;
  resolveMovement(
    entityId: EntityId, canonical: KinematicState,
    desiredDisplacement: Vec3, dtSeconds: number
  ): PhysicsResolution;
  adoptAuthoritativeState(
    entityId: EntityId, state: KinematicState
  ): void;
  removeCharacter(entityId: EntityId): void;
  dispose(): void;
}
```

### A5 Intent and authority

```typescript
interface MovementIntentStamp {
  sessionEpoch: SessionEpoch; generation: number;
}
interface MoveToRequest {
  requestId: string; stamp: MovementIntentStamp;
  destination: Vec3;
}
interface CancelPathRequest {
  requestId: string; stamp: MovementIntentStamp;
}
interface MovementCommandResult {
  requestId: string; accepted: boolean;
  appliedTick: ServerTick | null;
  routeRevision: number | null; reason?: string;
}
interface MovementAuthority {
  submitMoveTo(request: MoveToRequest): void;
  submitCancel(request: CancelPathRequest): void;
  applyDirectInput(
    input: DirectInput, stamp: MovementIntentStamp,
    tick: ServerTick
  ): void;
  advance(tick: ServerTick): void;
}
```

The adapter checks DirectFrame.directIntent before calling applyDirectInput. A non-direct keepalive must not be translated into an explicit zero direct intention that cancels a server route. MovementAuthority is entity-bound and consumes the application epoch/generation; SDK sequence state is handled only by its network adapter.
