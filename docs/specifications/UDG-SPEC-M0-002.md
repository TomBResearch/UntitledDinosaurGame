# Untitled Dinosaur Game — M0 Technical Specification v0.2

Architecture review incorporated

Specification date: 7 November 2026

Document ID: `UDG-SPEC-M0-002`\
Supersedes: M0 Technical Specification v0.1\
Status: Proposed implementation baseline — technical spikes pending\
Scope: Multiplayer foundations only; no implementation authorised by this document alone.

## 1. Executive decision

The architecture review identified five critical blockers, seven significant risks and five recommended improvements. Version 0.2 addresses all seventeen findings through explicit technical contracts, revised ownership rules, test requirements and changes to implementation order.

The foundational stack is retained:

TypeScript + Babylon.js + React + Colyseus 0.18 + Rapier + Recast/Detour, with a server-authoritative simulation.

The most significant correction is how we handle movement:

- Direct movement: predicted locally using Colyseus's fixed-step input and reconciliation.
- Click-to-move: initially calculated and simulated by the server, with client-side presentation smoothing.
- Movement switching: represented through ordered server-authoritative mode transitions, never through independently competing movement controllers.
- Collision: resolved by a single physics adapter with explicit restoration and lifecycle operations.
- Navigation: performed outside the fixed-step locomotion function, using validated and versioned region navigation data.

This deliberately avoids introducing full predicted navigation-path replay before we have demonstrated reliable basic networking and collision.

### Architectural disposition

| Area                   | v0.2 decision                                              |
| ---------------------- | ---------------------------------------------------------- |
| Technology stack       | Retained                                                   |
| Player movement model  | Confirmed                                                  |
| Prediction strategy    | Direct movement first; path following server-authoritative |
| Input ordering         | Must be defined and acceptance-tested                      |
| Physics representation | Provisional until Spike 002                                |
| Navigation integration | Provisional until Spike 003                                |
| Simulation contracts   | Revised                                                    |
| Agent task order       | Revised with three mandatory validation gates              |

The current Colyseus 0.18 documentation confirms the fixed-step input, prediction, interpolation and reconnection facilities needed for this approach. The precise integration must still be demonstrated using pinned package versions.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.colyseus.io\&sz=32)

Colyseus+2



## 2. Normative rules and M0 boundaries

In this specification, MUST indicates a requirement, SHOULD indicates the default unless a documented exception is approved, and MAY indicates optional behaviour.

### 2.1 M0 deliverable

A successful M0 prototype MUST provide:

- One browser-accessible 3D greybox region.
- Multiple players occupying and observing the same authoritative simulation.
- A freely orbitable, zoomable third-person camera.
- Click-to-move, WASD, tap-to-move and mobile virtual-joystick controls.
- Server-validated navigation around static obstacles.
- Collision-constrained walking over flat terrain, slopes and steps.
- Immediate predicted direct movement and interpolated remote movement.
- Reliable transitions between direct movement and automatic path-following.
- Recovery from temporary disconnections without duplicating entities.
- Automated multiplayer, protocol, movement and performance tests.

The target remains 20 concurrent players in the same region. This is a prototype acceptance workload, not the expected final capacity of one MMO region.

### 2.2 Excluded systems

M0 MUST NOT introduce production authentication, character progression, inventory, trading, chat, dinosaurs, combat damage, abilities, persistence or multi-region transfers.

The higher-level design decisions remain valid. For example, dodge will eventually interrupt melee attack commitments, but neither action system needs to exist in M0.

### 2.3 Configuration defaults

| Setting              | Value                | Status         |
| -------------------- | -------------------- | -------------- |
| World                | `world-001`          | Fixed for M0   |
| Region               | `region-greybox-001` | Fixed for M0   |
| Tick rate            | 20 Hz                | Provisional    |
| Simulation step      | 0.05 seconds         | Derived        |
| Physics substeps     | 1                    | Provisional    |
| State patch interval | 100 ms               | Provisional    |
| Movement speed       | 4 m/s                | Test value     |
| Capsule radius       | 0.35 m               | Test value     |
| Capsule total height | 1.8 m                | Test value     |
| Walkable slope       | 45°                  | Test value     |
| Step height          | 0.3 m                | Test value     |
| Arrival tolerance    | 0.2 m                | Test value     |
| Reconnection window  | 30 seconds           | Initial policy |
| Coordinate system    | Right-handed, Y-up   | Required       |
| World units          | Metres               | Required       |

All parameters MUST be defined centrally with explicit units. Neither the client nor server may independently hardcode a different movement speed or collision configuration.

## 3. Canonical architecture and ownership

M0 runtime architecture

Logical components. No additional distributed services are required for M0.

### 3.1 Single ownership rule

The authoritative server owns every player's gameplay transform.

The browser may hold a predicted transform for its local character, but this is a temporary rendering and responsiveness representation—not authoritative game state.

The simulation's canonical position is synchronised with the collision adapter. Rapier does not independently own a competing gameplay position.

### 3.2 Package boundaries

| Package                | Responsibility                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `packages/protocol`    | Input types, replicated schemas, command results, identifiers, protocol version       |
| `packages/simulation`  | State transitions, movement intent, locomotion calculations                           |
| `packages/physics`     | Collision-world construction, collider lifecycle, movement resolution, state adoption |
| `packages/navigation`  | Navmesh import, route planning, destination validation                                |
| `packages/config`      | Versioned movement and region configuration                                           |
| `apps/server`          | Colyseus room lifecycle, validation, authoritative ticking, state replication         |
| `apps/client`          | Babylon.js rendering, React UI, input adapters, prediction presentation               |
| `tools/asset-pipeline` | Repeatable greybox asset generation                                                   |
| `tools/load-test`      | Deterministic multiplayer scenarios and telemetry                                     |

The simulation package MUST NOT import Babylon.js, React, browser APIs, Colyseus room classes or concrete Rapier/Recast implementations.

The client MUST NOT import database or server implementation modules.

### 3.3 State categories

We will use three distinct representations:

| State                        | Owner    | Purpose                              |
| ---------------------------- | -------- | ------------------------------------ |
| Canonical simulation state   | Server   | Actual gameplay authority            |
| Replicated state             | Colyseus | Network-visible authoritative fields |
| Predicted/presentation state | Client   | Responsiveness and smooth rendering  |

A defined mapping MUST exist between canonical simulation state and replicated state. No agent may silently treat one as interchangeable with another.

## 4. Canonical domain interfaces

The following are UDG-owned TypeScript contracts. They are not intended to be copied directly into a Colyseus schema without adapting to its encoding requirements.

### 4.1 Shared primitives and state

```

type WorldId = string;
type RegionId = string;
type EntityId = string;
type SessionEpoch = number;
type ServerTick = number;
type MovementMode = "idle" | "direct" | "path";

interface Vec2 {
  x: number;
  y: number; // Horizontal component Z in movement input
}

interface Vec3 {
  x: number;
  y: number; // Vertical / world up
  z: number;
}

interface KinematicState {
  position: Vec3;
  yaw: number;          // Radians about Y
  velocity: Vec3;
  grounded: boolean;
  verticalVelocity: number;
}

interface RouteProgress {
  revision: number;
  nextWaypointIndex: number;
}

interface LocomotionState {
  kinematic: KinematicState;
  mode: MovementMode;
  route: RouteProgress | null;
  intentGeneration: number;
  lastAuthorityTick: ServerTick;
}

interface PlayerSimulationState {
  entityId: EntityId;
  sessionEpoch: SessionEpoch;
  connected: boolean;
  locomotion: LocomotionState;
}

```

`verticalVelocity` is explicit because M0 includes slope transitions, grounding and potentially small steps. There will be no jumping in M0.

If a later movement implementation proves that velocity can be derived without ambiguity, the redundancy may be removed through an ADR. Until then, its meaning and update order MUST be consistent.

### 4.2 Movement intents and simulation step

```

interface DirectInput {
  moveX: number;
  moveZ: number;
}

interface MovementConfig {
  speed: number;
  capsuleRadius: number;
  capsuleHeight: number;
  arrivalTolerance: number;
  gravity: number;
  maxSlopeRadians: number;
  maxStepHeight: number;
}

interface StepEnvironment {
  collision: CharacterPhysics;
  routes: RouteStore;
}

interface StepResult {
  state: LocomotionState;
  reachedDestination: boolean;
  blocked: boolean;
}

interface LocomotionSimulator {
  step(
    state: LocomotionState,
    input: DirectInput,
    dtSeconds: number,
    config: Readonly<MovementConfig>,
    environment: StepEnvironment
  ): StepResult;
}

```

Required invariants:

- The simulation MUST consume a fixed timestep supplied by the networking loop.
- Movement speed MUST derive from server-owned configuration.
- Diagonal directional input MUST be normalised.
- A step MUST NOT perform pathfinding or network calls.
- The resulting state MUST be determined by its initial state, input, immutable route data, collision environment and timestep.
- A direct movement input MUST NOT silently reinstate a cancelled route.

### 4.3 Navigation and route storage

```

interface NavigationQuery {
  start: Vec3;
  destination: Vec3;
  agentRadius: number;
}

interface NavigationRoute {
  revision: number;
  navmeshHash: string;
  waypoints: readonly Vec3[];
  destination: Vec3;
}

type NavigationResult =
  | {
      ok: true;
      route: NavigationRoute;
    }
  | {
      ok: false;
      reason:
        | "INVALID_DESTINATION"
        | "OUT_OF_BOUNDS"
        | "UNREACHABLE"
        | "RATE_LIMITED"
        | "SUPERSEDED"
        | "NAVIGATION_BUSY";
    };

interface NavigationService {
  findPath(query: NavigationQuery): NavigationResult;
}

interface RouteStore {
  get(revision: number): NavigationRoute | null;
}

```

The server MUST assign each route revision monotonically within the player's current session epoch. The route store is scoped to the player/region; a numeric revision alone is not a globally unique route identifier.

Route waypoints are immutable after acceptance. Replanning produces a new revision.

The client does not require full route replication during M0 because path following is not predicted. The server may transmit route metadata and destination feedback, but the authoritative transforms drive visual movement.

### 4.4 Physics lifecycle and rollback contract

```

interface CharacterPhysicsConfig {
  radius: number;
  totalHeight: number;
  collisionGroup: number;
}

interface PhysicsResolution {
  kinematic: KinematicState;
  actualDisplacement: Vec3;
  blocked: boolean;
}

interface CharacterPhysics {
  createCharacter(
    entityId: EntityId,
    initial: KinematicState,
    config: CharacterPhysicsConfig
  ): void;

  resolveMovement(
    entityId: EntityId,
    canonical: KinematicState,
    desiredDisplacement: Vec3,
    dtSeconds: number
  ): PhysicsResolution;

  adoptAuthoritativeState(
    entityId: EntityId,
    state: KinematicState
  ): void;

  removeCharacter(entityId: EntityId): void;

  dispose(): void;
}

```

This is the primary resolution of C-02, C-03 and C-05.

The physics adapter MUST own creation and removal of Rapier colliders, and MUST synchronise the collider's position with the supplied canonical state before resolving movement.

`adoptAuthoritativeState()` MUST restore every scalar required for the next movement step. For M0, Rapier contact caches and other opaque engine state are not considered authoritative; the validation spike must show that reseeding the relevant scalars is sufficient.

The server SHOULD use a standalone capsule collider initially. The final representation remains gated by Spike 002.

Rapier's documented controller calculates permissible translation but requires the application to apply the result, and does not itself handle character rotation. Our adapter explicitly owns these responsibilities.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://rapier.rs\&sz=32)

Rapier+1



### 4.5 Input timeline and mode-transition contracts

```

interface MovementIntentStamp {
  sessionEpoch: SessionEpoch;
  generation: number;
}

interface MoveToRequest {
  requestId: string;
  stamp: MovementIntentStamp;
  destination: Vec3;
}

interface CancelPathRequest {
  requestId: string;
  stamp: MovementIntentStamp;
}

interface MovementCommandResult {
  requestId: string;
  accepted: boolean;
  appliedTick: ServerTick | null;
  routeRevision: number | null;
  reason?: string;
}

interface MovementAuthority {
  submitMoveTo(request: MoveToRequest): void;
  submitCancel(request: CancelPathRequest): void;
  applyDirectInput(
    input: DirectInput,
    stamp: MovementIntentStamp,
    tick: ServerTick
  ): void;
  advance(tick: ServerTick): void;
}

```

This is an application-level contract. The exact Colyseus wire schema will use flat primitive fields, as required by its fixed-step input mechanism.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.colyseus.io\&sz=32)

Colyseus



One refinement is necessary: input `generation` is a per-session ordering hint, not a trusted authority claim. The server MUST enforce bounds, monotonicity and validity; generation values cannot alter movement speed, position or simulation time.

## 5. Authoritative input ordering

This section resolves C-01 and C-04.

The original specification allowed one-shot destination requests and continuous movement inputs to affect the same character without a common ordering rule.

Version 0.2 introduces a server-owned input timeline.

### 5.1 Two input mechanisms, one authority

For M0, we will retain two transport-level mechanisms:

- Continuous inputs: Colyseus 0.18's fixed-step input API.
- Discrete requests: Reliable Colyseus application messages for `MOVE_TO` and `CANCEL_PATH`.

Both MUST be interpreted by one `MovementAuthority` for each player.

Using two message mechanisms does not mean that they can independently modify locomotion state.

### 5.2 Intent generation

The client maintains a monotonically increasing movement-intent generation within its connection epoch.

The generation changes when the player makes a meaningful movement-mode decision, such as selecting a new destination or beginning direct movement that overrides a path.

A held directional input does not increment the generation every frame.

The server maintains the highest valid movement-intent generation it has processed.

For any received movement operation:

1. Validate the session epoch.
2. Validate the generation and payload.
3. Reject stale operations.
4. Assign the accepted operation to a server simulation tick.
5. Apply any mode transition through the movement authority.
6. Advance locomotion with the resulting mode and input.

A higher generation represents a newer client movement intention, but the server decides whether that intention is valid.

Generations MUST NOT be used to calculate elapsed time or movement distance. Large jumps and invalid wraparound behaviour must be rejected or cause an explicit resynchronisation.

### 5.3 Deterministic ordering rules

| Situation                                                  | Required result                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| New valid `MOVE_TO`                                        | Accept a new route and enter `path` mode                   |
| New valid direct input                                     | Cancel automatic path following and enter `direct` mode    |
| Direct input returns to zero                               | Enter `idle` without restoring old path                    |
| A newer `MOVE_TO` arrives                                  | Replace the previous path after validation                 |
| Stale `MOVE_TO` arrives                                    | Reject as superseded                                       |
| A route calculation finishes after a newer movement intent | Discard its result                                         |
| `CANCEL_PATH` applies                                      | Enter `idle`, unless superseded by a newer valid intent    |
| Invalid destination                                        | Reject without granting movement or resurrecting old paths |
| Client disconnects                                         | Clear active direct inputs and stop movement               |
| Client reconnects                                          | Establish a fresh input epoch and resynchronise movement   |

If two conflicting operations have the same generation, the server MUST resolve them using a documented deterministic priority. For v0.2, the priority is:

Direct movement cancellation takes precedence over path activation for the same generation and tick.

Requests are admitted in their actual server processing order. A route calculation may complete asynchronously, but MUST pass a final generation and session-epoch check before committing.

### 5.4 Example: movement override

Player clicks a destination, then presses W

1. Client sends `MOVE_TO`, generation 12.
2. Server validates the destination and begins path calculation.
3. Player presses W. Client switches to direct movement, generation 13, and predicts movement immediately.
4. Server receives and validates generation 13; any active route is cancelled.
5. The old path calculation for generation 12 completes.
6. Server rejects its completion as superseded. Generation 12 never becomes active.

Invariant: an old click-to-move request can never reactivate after a newer direct movement intention.

### 5.5 Precise treatment of client prediction

The client-side direct-input predictor MUST use only the Colyseus fixed-step input history and the state required by the shared movement step.

It MUST NOT infer authoritative path acceptance from a mouse click or from an unacknowledged local destination.

When the client changes from direct movement to a pending click-to-move request, it may continue predicting the previous valid movement mode until an authoritative mode-change acknowledgement arrives. It must not locally begin an unconfirmed path.

If the server has already accepted a path and a newer direct input is generated, the client may immediately predict direct movement, subject to the usual reconciliation process.

The exact behaviour when these mode changes overlap with pending acknowledgements is a mandatory Spike 003 test.

Colyseus's documented prediction contract requires the same shared step, matching fixed timesteps, replayable input state and explicit handling of one-shot effects. We must preserve those properties within the direct-movement prediction boundary.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.colyseus.io\&sz=32)

Colyseus



## 6. Movement state machine

### 6.1 Authoritative modes

Simplified state model. Path completion, cancellation, failed requests and reconnection return to idle or another explicitly selected mode.

The modes have the following semantics:

| Mode     | Movement authority              | Exit condition                                        |
| -------- | ------------------------------- | ----------------------------------------------------- |
| `idle`   | No active horizontal locomotion | Valid movement intent                                 |
| `direct` | Latest valid directional input  | Input released, replaced or disconnected              |
| `path`   | Accepted server route           | Destination reached, cancelled, blocked or superseded |

### 6.2 Arrival and interruption

Path following MUST use the accepted route's waypoint order and a configured arrival tolerance.

When the final destination is reached, the server changes the mode to `idle` and clears route progress.

When blocked, the player MUST not continue moving through obstacles. M0 should stop and report a blocked route after a bounded recovery attempt. Automatic unlimited replanning is prohibited.

A failed route request MUST produce a result message that the UI can use to remove or update its provisional destination marker.

### 6.3 Heading and camera

Camera orbit and zoom are client-side presentation features.

For direct movement, the input adapter converts camera-relative movement into world-space direction. Camera orientation itself is not part of the authoritative world state.

The server determines the player's movement heading. The visual character model may smoothly interpolate toward that heading without changing the server's actual transform.

Mobile joystick direction and desktop keyboard direction MUST map to the same normalised movement semantics.

## 7. Colyseus 0.18 integration contract

### 7.1 Server fixed-step loop

The server MUST use Colyseus's `defineInput()` and `setFixedTimestep()` facilities.

Conceptually, each server tick performs the following:

1. Read the next buffered input frame for each connected player.
2. Use an explicit neutral input when no valid frame is available.
3. Validate queued discrete movement operations.
4. Apply movement-mode transitions in authoritative order.
5. Advance direct or path-following locomotion once using the fixed timestep.
6. Resolve collision and update canonical state.
7. Map canonical state to replicated fields.
8. Record tick metrics and publish patches on the configured network schedule.

An important anti-cheat constraint: the server must not advance a character multiple times in one tick merely because the client has sent multiple input frames.

Buffering, frame consumption and idle-input behaviour must follow Colyseus's documented semantics. Its input API supports configurable bounded buffers and idle-frame policies.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.colyseus.io\&sz=32)

Colyseus



### 7.2 Replicated state contract

The M0 replicated player schema MUST expose at least:

| Field              | Purpose                                            |
| ------------------ | -------------------------------------------------- |
| `entityId`         | Stable identity during the player's region session |
| `x`, `y`, `z`      | Authoritative position                             |
| `yaw`              | Authoritative heading                              |
| `vx`, `vy`, `vz`   | Authoritative velocity                             |
| `grounded`         | Ground-contact state                               |
| `movementMode`     | Current authoritative mode                         |
| `routeRevision`    | Current accepted route or sentinel                 |
| `intentGeneration` | Latest authoritative movement intention            |
| `sessionEpoch`     | Input-session identity                             |
| `connected`        | Presence and reconnection state                    |

The region schema MUST also expose world ID, region ID, simulation tick and a protocol/configuration version.

Precise Colyseus field types, encoding widths and additional predictor bookkeeping fields MUST be frozen during Spike 001.

The specification requires a documented numerical precision policy. If floating-point network representation introduces measurable replay drift, the shared simulation SHOULD quantise the appropriate replicated fields consistently rather than apply unexplained smoothing to conceal the issue.

### 7.3 Client prediction boundary

The recommended implementation uses:

- The Colyseus input handle for continuous movement frames.
- `Predict.reconciler()` for direct movement when the state fits its scalar reconciliation model.
- `Predict.sim()` only if the Rapier integration requires opaque physics-world adoption and replay.
- `Predict.attachAll()` and interpolation for remote player rendering.

The SDK's `reconciler` and `sim` approaches have different state-adoption requirements. In particular, opaque physics-engine state needs explicit authoritative scalar adoption and cannot assume that all engine-internal state is rolled back automatically.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.colyseus.io\&sz=32)

Colyseus



The final choice between `reconciler()` and `sim()` is a Spike 002 output, not something individual agents may independently choose.

### 7.4 Client prediction mode switching

The prediction controller MUST distinguish:

`PREDICT_DIRECT`, `AUTHORITATIVE_PATH`, and `AUTHORITATIVE_IDLE`.

In `PREDICT_DIRECT`, it uses local replay and reconciliation.

In `AUTHORITATIVE_PATH`, it renders server-authoritative motion with smoothing, without independently recomputing or predicting the route.

In `AUTHORITATIVE_IDLE`, it does not predict active movement.

A mode switch MUST reseed or reset the relevant predicted state, discard stale inputs and prevent a previously active path from reappearing.

The implementation must not indiscriminately reset Colyseus's sequence state whenever movement mode changes; input epoch resets must follow the SDK's contract. The integration spike will establish the safe transition procedure.

### 7.5 Reconnection

An unexpected disconnect MUST immediately stop applying movement input.

The server holds the player's room seat for up to 30 seconds using the supported Colyseus reconnection lifecycle. On successful reconnection, the same entity is restored and a fresh input epoch is established.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.colyseus.io\&sz=32)

Colyseus



The client must adopt the returned authoritative state before accepting new predicted movement.

After reconnection expiry, the player entity and associated physics resources are removed exactly once.

## 8. Rapier physics contract

### 8.1 Selected initial approach

Spike 002 MUST evaluate a standalone capsule collider controlled by Rapier's kinematic character controller.

The initial player shape is:

- Radius: 0.35 m
- Total height: 1.8 m
- Cylindrical half-height: 0.55 m
- Rotation: upright around Y
- Interaction with other player colliders: ignored for locomotion

The character controller MUST enforce solid-world collision, walkable slopes and steps.

The implementation MUST also define ground snapping, gravity application, collision offset and numerical tolerances.

### 8.2 Ownership and lifecycle

Only the physics adapter may create, move, restore or destroy character colliders.

The required lifecycle is:

`create → synchronise → resolve movement → read result → repeat → remove`

For reconciliation:

`adopt authoritative state → synchronise collider → replay movement`

The adapter must remove resources on final entity departure and on region shutdown.

An unexpected network drop must not destroy the collider immediately if the player remains eligible for reconnection.

### 8.3 Required physics invariants

- Collider and canonical positions agree after every completed movement step.
- Players cannot cross solid walls.
- Players may pass through other players.
- No dynamic rigid-body pushing is required.
- Character movement does not depend on the rendering frame rate.
- Identical movement fixtures produce equivalent results within documented numerical tolerances.
- Resource allocation returns to baseline after entity cleanup.

### 8.4 Rollback limitation

M0 assumes a static collision environment with no moving platforms or dynamic rigid-body interactions.

The physics spike MUST demonstrate that restoring the relevant scalar state produces stable subsequent movement.

If repeated correction and replay produces persistent divergence, the approved fallback is a simpler deterministic kinematic locomotion implementation with Rapier retained for collision queries, subject to an ADR.

The project MUST NOT accumulate ad hoc position corrections to conceal a fundamentally inconsistent physics representation.

## 9. Recast navigation and region assets

### 9.1 Region asset pipeline

The greybox region MUST have one versioned source geometry representation used to derive navigation and collision data.

The build pipeline produces:

```
assets/regions/region-greybox-001/
├── region.json
├── visual.glb
├── navmesh.bin
├── collision.json
└── manifest.json
```

The exact serialisation may be refined during Spike 003, but the authoritative asset identity must remain explicit.

The `recast-navigation` package supports offline generation and binary navmesh import/export, making it suitable for this pipeline.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub



### 9.2 Manifest requirements

The manifest MUST include:

| Field                | Purpose                                 |
| -------------------- | --------------------------------------- |
| `schemaVersion`      | Asset format compatibility              |
| `regionId`           | Identifies the region                   |
| `sourceGeometryHash` | Identifies source geometry              |
| `navmeshHash`        | Identifies generated navigation data    |
| `collisionHash`      | Identifies generated collision geometry |
| `movementConfigHash` | Identifies agent/collision settings     |
| `generatorVersion`   | Records asset-building implementation   |

The server must reject malformed or incompatible assets before admitting players.

The client should display a clear connection error when it cannot load compatible region assets.

### 9.3 Navigation constraints

Recast uses right-handed geometry conventions, so the greybox asset pipeline MUST preserve the agreed coordinate system and triangle winding.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://recast-navigation-js.isaacmason.com\&sz=32)

recast-navigation-js.isaacmason.com



Path queries must:

- Reject non-finite coordinates.
- Respect configured region boundaries.
- Reject unreachable destinations.
- Respect character radius and navigation clearance.
- Produce ordered waypoints.
- Use a bounded computation budget.
- Support cancellation or safe discarding of superseded results.

The application must never allow an old route computation to overwrite a newer movement intention.

### 9.4 Navigation versus collision

The navmesh establishes where a character may navigate. Rapier establishes where its collider may physically move.

Both must be tested together.

A route is not acceptable merely because Recast returns a path. The test harness must verify that the capsule can traverse the resulting route without violating solid-world collision constraints.

## 10. Security and robustness requirements

M0 remains a development-only environment, but it MUST implement core server-side protections.

| Surface                | Requirement                                   |
| ---------------------- | --------------------------------------------- |
| Connections            | Bind to loopback by default                   |
| Development LAN access | Explicit opt-in                               |
| WebSocket origins      | Allowlist for enabled environments            |
| Identity               | Server-assigned development identity          |
| Input payloads         | Validate shape, ranges and finite numbers     |
| Movement               | Server calculates all final positions         |
| Path requests          | Rate and complexity limits                    |
| Input buffers          | Bounded sizes                                 |
| Sessions               | Epoch validation and exclusive ownership      |
| Reconnection tokens    | Treat as secrets; never log                   |
| Protocol versions      | Reject incompatible clients                   |
| Observability          | Record failures without sensitive credentials |

A provisional limit of four navigation requests per second per player, with a small bounded burst, is acceptable for Spike 003. The final M0 rate must be confirmed through testing.

A single malformed message MUST not crash the room or disconnect unrelated players.

An invalid movement request MUST not grant movement.

### 10.1 Input abuse tests

The load harness MUST test:

- `NaN`, Infinity and malformed vectors.
- Extremely large destinations.
- Negative or excessive movement values.
- Bursts of repeated destination requests.
- Duplicate request IDs.
- Stale generations and expired session epochs.
- Disconnections with buffered movement commands.
- Attempts to set character position directly.

A violation must produce either a defined rejection or a bounded server-side disconnect, without corrupting the region simulation.

## 11. Observability and performance gates

### 11.1 Required telemetry

The prototype MUST record:

| Metric                        | Purpose                         |
| ----------------------------- | ------------------------------- |
| Simulation tick duration      | Server computational load       |
| Tick lateness and overruns    | Simulation scheduling stability |
| Input-buffer depth            | Network and processing backlog  |
| Movement correction magnitude | Prediction quality              |
| RTT and jitter                | Network conditions              |
| Navigation query duration     | Pathfinding cost                |
| Navigation queue depth        | Resource contention             |
| Connected entity count        | Active load                     |
| WebSocket traffic             | Bandwidth per client            |
| Browser frame time            | Rendering performance           |
| Browser memory                | Mobile resource consumption     |
| Reconnection success/failure  | Lifecycle reliability           |

For latency and correction metrics, percentiles MUST be computed over a documented workload, not arbitrary sampled events.

### 11.2 M0 acceptance gates

The final benchmarks use explicit profiles.

| Gate                   | Workload                                  | Pass condition                                                  |
| ---------------------- | ----------------------------------------- | --------------------------------------------------------------- |
| Multiplayer capacity   | 20 connected clients, 10 minutes          | No unexpected disconnections or duplicate entities              |
| Simulation timing      | 20 players moving                         | At least 99.9% of ticks within one scheduled interval           |
| CPU headroom           | 20-client workload                        | p99 tick execution below 25 ms                                  |
| Authoritative movement | Malicious-input suite                     | No unauthorised movement                                        |
| Collision              | Deterministic obstacle fixtures           | No solid-world penetration beyond agreed 2 cm tolerance         |
| Navigation             | Reachable/unreachable route fixtures      | All expected results match                                      |
| Direct prediction      | 100 ms RTT, 20 ms jitter                  | p95 horizontal correction below 0.15 m on unobstructed movement |
| Reconnection           | Disconnects shorter than 30 s             | Same entity restored exactly once                               |
| Desktop rendering      | Reference desktop, sustained test         | p95 frame time ≤ 16.7 ms                                        |
| Mobile rendering       | Reference mid-range phone, sustained test | p95 frame time ≤ 33.3 ms                                        |

The correction threshold applies only to the stated unobstructed direct-movement test. Wall contacts, ground transitions and movement-mode switches must be reported separately because they can produce legitimate corrections.

For unreliable network impairment testing, the harness must distinguish WebSocket/TCP behaviour from actual datagram packet loss; M0's default Colyseus transport remains reliable WebSockets.

### 11.3 Benchmark profiles

The required profiles are:

| Profile          | RTT            | Jitter   | Additional conditions             |
| ---------------- | -------------- | -------- | --------------------------------- |
| LAN              | 0–10 ms        | Minimal  | Establish baseline                |
| Moderate latency | 50 ms          | 10 ms    | Standard movement                 |
| Elevated latency | 100 ms         | 20 ms    | Prediction and mode switching     |
| Poor connection  | 200 ms         | 40 ms    | Recovery and correction behaviour |
| Disconnection    | Temporary loss | Variable | Reconnect and lifecycle           |

Results must record the actual achieved network conditions, rather than assuming the traffic-shaping tool perfectly reproduces the requested profile.

Device benchmarks require actual desktop/mobile hardware. Browser emulation alone is insufficient.

## 12. Three mandatory technical validation spikes

These spikes are architectural acceptance gates. They are not throwaway experiments: successful code and tests should become reference implementations for later tasks.

## SPIKE-001 · Colyseus networking

Gate A

Dependencies: repository, protocol skeleton

Objective: Prove fixed-step server authority, local direct-movement prediction and remote interpolation without physics or navigation.

Required implementation: Two clients, one flat plane, fixed-step input, server-owned movement, predictor and remote-player smoothing.

Mandatory tests:

- Held input, released input and diagonal input.
- Client attempts to exceed movement speed.
- Missing input frames and burst submissions.
- Simulated 100 ms RTT with jitter.
- Prediction replay following an authoritative correction.

Pass evidence: Recorded state traces, correction measurements, test results and a documented Colyseus 0.18 API adapter.

Failure action: Resolve the netcode integration before implementing Rapier or Recast. Do not substitute a custom prediction framework without a documented ADR.

## SPIKE-002 · Physics and reconciliation

Gate B

Dependency: SPIKE-001

Objective: Prove that Rapier can resolve movement and support authoritative correction with stable prediction.

Required implementation: Capsule character, solid wall, corner, walkable ramp, step, grounded movement and collision cleanup.

Mandatory tests:

- Character collides with and slides along obstacles.
- Slopes and steps behave consistently.
- Client and server use identical physics settings.
- Restoring authoritative state synchronises collider pose.
- Reconciliation does not cause sustained drift.
- Player-to-player locomotion collision is disabled.
- Creating and removing players does not leak collision resources.

Pass evidence: Before/after state traces, drift distributions, collision fixtures and a decision on standalone collider versus kinematic rigid body.

Failure action: Evaluate the simpler deterministic locomotion fallback before allowing downstream implementation.

## SPIKE-003 · Navigation and hybrid input

Gate C

Dependency: SPIKE-002

Objective: Prove reliable server-controlled paths and seamless switching between click-to-move and predicted direct movement.

Required implementation: Offline navmesh, accepted route revisions, pending requests, mode transitions and shared collision geometry.

Mandatory tests:

- Click-to-move navigates around a wall.
- New click replaces an existing route.
- WASD cancels a route.
- A stale path completion never reactivates.
- Destination rejection does not corrupt movement state.
- Mode changes under 100–200 ms latency remain correct.
- Invalid or unreachable destinations fail safely.
- Reconnection clears stale commands and route state.

Pass evidence: Ordered input logs, transition traces, asset manifest verification and navigation/collision test results.

Failure action: Revise input arbitration or mode-switching contracts and repeat the relevant test cases.

All three gates require an explicit pass/fail decision from the integration owner, supported by test evidence.

## 13. Revised agent implementation roadmap

The task backlog is now dependency-ordered with a clear distinction between foundation work, validation spikes and production integration.

| Task          | Primary deliverable                               | Dependencies | Gate         |
| ------------- | ------------------------------------------------- | ------------ | ------------ |
| UDG-001       | Workspace, strict TypeScript, CI                  | None         | Foundation   |
| UDG-002       | Protocol schemas and validation                   | 001          | Foundation   |
| UDG-003       | Minimal Colyseus fixed-step room                  | 002          | A            |
| UDG-004       | Babylon.js client and camera                      | 001          | A            |
| UDG-SPIKE-001 | Networking and prediction validation              | 003, 004     | A            |
| UDG-005       | Revised shared locomotion implementation          | Spike 001    | B            |
| UDG-006       | Rapier physics adapter                            | 005          | B            |
| UDG-SPIKE-002 | Physics reconciliation validation                 | 006          | B            |
| UDG-007       | Asset pipeline and Recast navigation              | Spike 002    | C            |
| UDG-008       | Desktop/mobile input adapters                     | 004, 005     | C            |
| UDG-SPIKE-003 | Hybrid movement integration                       | 007, 008     | C            |
| UDG-009       | Final prediction and replication integration      | Spike 003    | Integration  |
| UDG-010       | Entity lifecycle and reconnection                 | 009          | Integration  |
| UDG-011       | Multiplayer load, security and impairment harness | 010          | Verification |
| UDG-012       | Hardware benchmarks, defect fixes, sign-off       | 011          | Release      |

### 13.1 Agent task ownership

Each agent task MUST specify:

- Exact specification revision and prerequisite commits.
- Allowed files and package ownership.
- Public interfaces it implements or consumes.
- Dependencies that must already be verified.
- Unit, integration and negative tests.
- Required commands and measurable acceptance criteria.
- Expected completion report.
- Escalation path for design inconsistencies.

One designated integration owner MUST approve any change to the input protocol, replicated state schema, simulation timestep or physics ownership contract.

### 13.2 Required repository checks

Every implementation task MUST run the applicable commands:

```
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Integration tasks must additionally run their corresponding multiplayer or browser tests.

CI MUST enforce package dependency boundaries, prevent circular dependencies and reject invalid protocol/asset fixtures.

### 13.3 Task completion states

Use a consistent lifecycle:

`Not Started → Ready → In Progress → In Review → Verified`

A task may move to `Blocked` when a prerequisite or architectural contract fails.

Verified means automated tests and acceptance criteria have passed. It does not merely mean the agent has submitted code.

## 14. Architecture review findings: closure matrix

The table below maps all findings from the previous review to their required resolution and verification evidence.

Critical blockers

| Finding                             | v0.2 resolution                                                          | Validation     |
| ----------------------------------- | ------------------------------------------------------------------------ | -------------- |
| C-01 · Path/prediction mismatch     | Server-authoritative path following, explicit prediction-mode boundaries | Spike 003      |
| C-02 · Incomplete movement state    | Full locomotion, route progress and kinematic state                      | Spikes 001–003 |
| C-03 · Undefined collider ownership | `CharacterPhysics` lifecycle and adoption interface                      | Spike 002      |
| C-04 · Ambiguous input ordering     | Generations, epochs, server tick ordering and supersession               | Spike 003      |
| C-05 · Competing movement ownership | Canonical simulation state and physics adapter responsibilities          | Spike 002      |

Significant risks

| Finding                             | v0.2 resolution                                                | Validation |
| ----------------------------------- | -------------------------------------------------------------- | ---------- |
| R-01 · Physics rollback             | Scalar-state adoption and replay testing; fallback available   | Spike 002  |
| R-02 · Geometry mismatch            | Versioned source geometry and shared manifest                  | Spike 003  |
| R-03 · Tick-rate limitations        | Configurable fixed timestep and substep validation             | Spike 002  |
| R-04 · Reconnection/stale input     | Session epochs, entity ownership and input reset               | UDG-010    |
| R-05 · Mobile network jitter        | Network impairment profiles and interpolation metrics          | UDG-011    |
| R-06 · Agent integration conflicts  | Mandatory spikes and interface ownership                       | All gates  |
| R-07 · Inaccurate performance gates | Frame-time percentiles, tick lateness and controlled workloads | UDG-012    |

Design improvements

| Finding | v0.2 resolution                                     |
| ------- | --------------------------------------------------- |
| I-01    | Canonical, replicated and predicted state separated |
| I-02    | Versioned region asset manifest                     |
| I-03    | Simulation/network observability                    |
| I-04    | Protocol compatibility and input-validation policy  |
| I-05    | Architectural CI and dependency-boundary tests      |

All seventeen findings are now addressed at specification level. None should be considered implementation-verified until the corresponding tests pass.

That distinction is important: documenting a resolution is not the same as proving its technical behaviour.

## 15. Remaining validation decisions

After v0.2, only a few implementation-level decisions should remain open for M0.

| Decision                                           | Owner                                | Deadline  |
| -------------------------------------------------- | ------------------------------------ | --------- |
| Exact Colyseus schema and prediction adapter       | Networking integration owner         | Spike 001 |
| Physics body/collider representation               | Physics integration owner            | Spike 002 |
| `reconciler()` versus `sim()`                      | Networking/physics integration owner | Spike 002 |
| Recast navigation settings and route serialisation | Navigation integration owner         | Spike 003 |
| Safe prediction mode-transition implementation     | Networking integration owner         | Spike 003 |
| Final device-specific performance settings         | Performance owner                    | UDG-012   |

These are deliberately bounded decisions. Agents should not independently reopen the broader engine choice, world architecture, gameplay input model or authority rules.

## 16. Specification approval criteria

The specification can be considered implementation-ready for foundation tasks when:

- The M0 scope and exclusions are accepted.
- The canonical interfaces are adopted as the baseline.
- The input-ordering policy is adopted.
- Package ownership and agent governance are established.
- The three spikes are accepted as mandatory gates.

The full M0 architecture is not frozen until all three integration spikes pass.

At that point, the exact Colyseus and physics adapters, navigation data format and movement-mode transition procedure can be promoted from provisional to verified technical contracts.

## Recommended project state

M0 v0.2 — Formal specification complete

At design level; implementation and integration validation pending

Confirmed gameplay architecture

Revised movement and ownership contracts

Input arbitration specification

Validation-spike requirements

Verified third-party integration

Pending

Implementation commenced

No

### Next planning deliverable

I recommend the next document be UDG M0 Agent Implementation Contracts v1.0, covering UDG-001 through UDG-SPIKE-003 first.

That document should turn each task into a directly assignable work package with exact expected file paths, tests, failure cases, completion evidence and a strict definition of done. The remaining tasks can then be specified against the interfaces proven by those spikes.

This avoids writing extensive downstream implementation instructions around library integration details that have not yet been demonstrated.

No codebase changes or implementation work have been started. The project remains in the technical-planning phase, with a corrected architecture and a defined route to validation.
