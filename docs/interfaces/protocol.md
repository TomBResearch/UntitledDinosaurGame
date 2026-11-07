# Protocol and replicated schemas

> Source: UDG-CONTRACTS-M0-001 v1.0, sections 4.2 to 4.4. Repository edition 1. Shared requirements are authoritative here; task files link to them.

### 4.2 UDG owned transport envelopes

All declarations in this subsection are proposed UDG contracts, not vendor APIs. Store them in packages/protocol/src/domain/wire.ts and validators in src/validation/. Colyseus schema encoding is a separate projection.

```typescript
interface DirectFrame {
  sessionEpoch: number;
  generation: number;
  directIntent: boolean;
  moveX: number;
  moveZ: number;
}
interface MoveToWire {
  requestId: string; sessionEpoch: number; generation: number;
  x: number; y: number; z: number;
}
interface CancelPathWire {
  requestId: string; sessionEpoch: number; generation: number;
}
type Validation<T> =
  | { ok: true; value: T }
  | { ok: false; code: RejectionCode };
```

DirectFrame is flat: proposed encoding is uint32 epoch/generation, boolean directIntent and float64 axes. All fields are declared in the fixed-input schema. directIntent distinguishes an actual direct-control sample, including release, from a neutral keepalive while path mode owns movement. No client position, speed, elapsed time, route, authoritative tick or client sequence counter is accepted. SDK sequence acknowledgements remain SDK-owned. UDG generations and application sessionEpoch values are distinct from the SDK input epoch and sequence.

Message names are UDG_MOVE_TO, UDG_CANCEL_PATH, UDG_MOVEMENT_RESULT and UDG_ROUTE_STATUS. Join metadata contains protocolVersion, configHash and manifestHash. World/region are selected by server room configuration and checked against requested join values. Room session identity is resolved by the server transport; entityId is never trusted from a movement payload. Ordinary reliable messages carry one-shot requests; continuous movement uses only the validated fixed-input channel.

requestId is 1 to 64 ASCII characters matching [A-Za-z0-9_-]+. Epoch is a server-issued uint32 from 1 through 4,294,967,295. Generation is an integer from 0 through 4,294,967,294, initially zero; only a neutral initial frame may use zero. New intentions increment by one locally. The server admits a forward gap of at most 64 to tolerate coalesced local decisions; larger gaps cause RESYNC_REQUIRED without raising its watermark. No wraparound is allowed; exhaustion requires a controlled epoch renewal, subject to the validated SDK lifecycle.

Axes must be finite in [-1,1], then normalised if their horizontal length exceeds one. Decode/sanitizer behaviour is validated, including encoding coercion; a non-finite or out-of-range raw sample must produce zero movement for that sample or a defined offender disconnect. It must never become a nonzero minimum-axis clamp. A directIntent false frame with nonzero axes is invalid and neutralised. Rejected samples do not advance generation. Unknown application message fields are rejected; unsupported message names cannot mutate state. Schema framing errors must be contained to the offender.

### 4.3 Result and status contracts

MovementCommandResult retains v0.2 fields. accepted true means a mode change was committed at appliedTick, not merely queued. appliedTick is null on rejection; routeRevision is null for cancel and rejection. A pending marker is a local UI state until the final result. If processing lasts beyond one patch interval, an optional UDG_ROUTE_STATUS message reports pending without claiming acceptance. The terminal result is emitted once per request and retained for deduplication.

RejectionCode is the closed union INVALID_PAYLOAD, INVALID_DESTINATION, OUT_OF_BOUNDS, UNREACHABLE, RATE_LIMITED, SUPERSEDED, NAVIGATION_BUSY, EPOCH_MISMATCH, INVALID_GENERATION, RESYNC_REQUIRED, REQUEST_ID_CONFLICT, PROTOCOL_MISMATCH, CONFIG_MISMATCH and ASSET_MISMATCH. Transport failure has a separate connection error and must not fabricate a successful command result. v0.2's optional reason string is constrained to these codes. Runtime route status values are ARRIVED, BLOCKED, CANCELLED and SUPERSEDED, with entity, epoch, generation, route revision and server tick.

Keep the most recent 128 terminal request records per entity/epoch for 30 seconds; keep all pending records up to the admission limit. Same ID plus identical payload returns the existing pending state or cached result without recomputation or a second transition. Same ID plus different payload yields REQUEST_ID_CONFLICT. IDs evicted from the cache cannot replay movement because stale generation admission still fails. A duplicate stale request whose terminal record remains cached returns that same result. On reconnect, old-epoch records may remain as inert diagnostics only.

### 4.4 Replica mapping and precision

packages/protocol/src/schema/{DirectInputSchema,PlayerSchema,RegionSchema}.ts is the only schema declaration location. packages/protocol/src/mapping/{to-replica,from-replica}.ts owns mapping and validates all required fields. Concrete schema builders and SDK bookkeeping fields are frozen at Gate A after encode/decode tests; no invented decorator or framework field is prescribed here.

| Replica field | Canonical source or meaning | Proposed encoding |
| --- | --- | --- |
| entityId | Server-assigned identity | string |
| x y z | locomotion.kinematic.position | float64 each |
| yaw | Radians about Y, normalised to [-pi,pi) | float64 |
| vx vy vz | Actual resolved displacement / dt | float64 each |
| grounded | Contact after completed step | boolean |
| verticalVelocity | Integrator vertical scalar, not omitted | float64 |
| movementMode | idle 0, direct 1, path 2 | uint8 |
| routeRevision | Active revision; 0 means no route | uint32 |
| nextWaypointIndex | Active index; 0 when no route | uint32 |
| intentGeneration | Highest admitted intention | uint32 |
| sessionEpoch | Current application input epoch | uint32 |
| connected | Authoritative presence | boolean |
| lastAuthorityTick | Tick that produced player state | uint32 |

RegionSchema contains worldId, regionId, serverTick, protocolVersion, configVersion, configHash, manifestHash and a player map keyed by entityId. A server-private map relates transport session to entity; it is not replicated. All identifiers have bounded lengths: 64 ASCII characters for world, region and entity IDs; versions are bounded strings of at most 32 characters; SHA-256 hashes are 64 lowercase hexadecimal characters. Schema field widths must fail safely at bounds. Stop and renew the development room before tick or revision overflow; never wrap silently.

Float64 avoids additional network rounding of JavaScript numbers but does not prove Rapier replay stability. Invariants use finite values and the shared units policy. verticalVelocity is the scalar carried into gravity integration; vy is the resulting actual displacement per second, including snap/step effects. Both are restored. Scalar adoption must also restore grounded, mode, route metadata, generation and authority tick where relevant. Server-only route points are not reconstructed from a replica in path mode. Changes to precision require an ADR and rerunning correction fixtures; smoothing cannot mask drift.
