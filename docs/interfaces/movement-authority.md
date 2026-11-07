# Movement authority and input ordering

> Source: UDG-CONTRACTS-M0-001 v1.0, section 5. Repository edition 1. Shared requirements are authoritative here; task files link to them.

### 5.1 Authority journal and tick boundary

apps/server/src/movement/MovementAuthorityAdapter.ts owns admission and a server-local monotonically increasing arrivalOrdinal. Handlers validate basic shape and capture operations; they do not move players. At the start of tick T, freeze a cutoff ordinal. Only input observations, lifecycle events, discrete requests and worker completions observed before that cutoff are eligible for T. Later observations wait for T+1. Record the cutoff and the selected SDK frame identity in the journal. Do not infer order from client timestamps or Promise scheduling.

P03 processing order is: apply disconnect/expiry/epoch changes first; process admitted operations in arrival order per entity; choose the final winning intention with the equal-generation precedence below; commit eligible route completions only after all competing input decisions; step each connected entity once in stable entityId lexical order; map completed canonical state; publish results and metrics. Connection lifecycle always prevents old-epoch movement. An entity whose asynchronous completion misses the cutoff cannot activate until a later tick.

Each connected entity consumes at most one SDK input frame and receives exactly one locomotion step per server tick, whether direct, path or idle. Missing input supplies an explicit neutral direct vector without inventing a new intent or SDK acknowledgement. Physics vertical settling can still occur in idle; a missing direct sample stops horizontal direct motion for that tick and enters idle. It must not cancel a valid path. A later nonzero frame of the same current direct generation may resume direct movement.

Input buffering is initially bounded at 32 frames per client. Do not drain a burst then simulate only its last frame, acknowledge frames that were never represented in state, or move a character repeatedly to empty a queue. Queue overflow and stale backlog handling must use demonstrated supported SDK behaviour, with a bounded offender disconnect if safe continuity cannot be proven. Record frames consumed but rejected by UDG rules; their effective input is neutral and their SDK acknowledgement remains truthful. Gate A must prove the client reconciles that rejection correctly.

### 5.2 Generations and deterministic ties

Track highest admitted generation H and an intention kind per generation. A structurally invalid, old-epoch, rate-limited or excessive-gap request does not change H. Valid operations with generation below H are SUPERSEDED. A new valid generation within the allowed forward window advances H. Held direct samples retain their generation. Only a new deliberate control intention, such as a click, direct start or explicit cancel, increments it. A release remains a direct sample with zero axes in the current direct generation.

For equal generation within the same tick, the priority is directIntent true, then explicit cancel, then path activation. This preserves v0.2's required direct-over-path priority and adds deterministic cancel handling. Among equal-kind discrete conflicts, first admitted wins; an identical retry is deduplicated. Only the single consumed continuous frame can contribute to that tick. A generation's kind is latched; across ticks an incompatible equal-generation operation is rejected as INVALID_GENERATION, so a late same-generation click cannot revive a route cancelled by direct input. Legitimate mode changes use a higher generation.

### 5.3 Pending routes and commit checks

P04 chooses a conservative pending policy to make v0.2 executable: an admitted new destination stops horizontal direct/path movement, clears the old route and enters authoritative idle while the query is pending. It advances H without falsely acknowledging a successful path. Requests rejected before admission leave the existing valid mode unchanged. A query that later fails leaves idle and sends a rejection; it never restores an old route. This is a proposed refinement of the optional pending prediction behaviour in [v0.2 section 5.5](../specifications/UDG-SPEC-M0-002.md) and must be adopted before Gate C.

Navigation runs outside the fixed movement step and room critical loop. A work ticket contains entityId, epoch, generation, requestId, start position, navmeshHash, configHash and the issued cutoff/tick. On completion, recheck live connection, epoch, generation, kind, asset/config hashes, request status and route reachability. Commit only if all still match. A superseded result is discarded and receives a terminal SUPERSEDED result if not already terminal. Route replacement allocates a strictly newer revision and installs immutable waypoints. As pending movement is stopped, the query start stays stable apart from vertical settling; if horizontal start drift exceeds 0.02 m, discard and reject NAVIGATION_BUSY rather than silently using a disconnected route.

Pending work cannot outlive entity removal, room disposal, epoch renewal or asset mismatch. On a newly admitted higher generation, invalidate older pending work immediately. No unlimited replanning is allowed. Bounded route recovery is ten consecutive ticks with less than 0.005 m horizontal progress despite a nonzero desired displacement; then stop, clear route and emit BLOCKED. Use zero automatic replans in this scope. Reset the blocked counter on measurable progress, new route or mode exit.

### 5.4 Movement semantics

Idle has zero desired horizontal displacement. Direct normalises the finite input vector and uses speed times fixed dt, at most 0.2 m horizontal desired travel per tick under default settings. Path consumes immutable waypoints in order; cap travel at both speed times dt and the remaining segment length. Deduct residual distance when crossing waypoints so short segments neither accelerate movement nor lose arbitrary time. Require horizontal arrival within 0.2 m and vertical separation within 0.2 m of the validated destination. A wrong-floor point must never count as arrival.

The shared step produces desired displacement, delegates collision exactly once, accepts its resolved kinematic state and preserves the authority-supplied lastAuthorityTick in its input state. It does no path query, network call, wall-clock read, random sampling, DOM access or presentation effect. Heading changes only for nonzero horizontal movement. Desired heading may use a documented atan2 convention; yaw affects presentation only because the capsule is upright. Physics-driving directions and fixture geometry must not depend on cross-platform trigonometric reconstruction. No jumping or dynamic body pushing exists in scope.

### 5.5 Required ordering examples

| Case | Admission and cutoff | Expected state and result |
| --- | --- | --- |
| O01 | MoveTo g12 at T; direct g13 at T+1; g12 completes at T+2 | Direct g13; g12 SUPERSEDED; no route |
| O02 | Direct g20 and MoveTo g20 eligible at T, either arrival order | Direct wins; MoveTo rejected; H20 |
| O03 | MoveTo g21 completes after cutoff T while direct g22 is eligible at T+1 | Completion cannot activate; direct g22 |
| O04 | Cancel g31, then delayed path completion g30 | Idle g31; no resurrection |
| O05 | Path g40; directIntent false neutral keepalive g40 | Path continues once; no mode change |
| O06 | Direct g50 nonzero; next tick no frame | Idle, no horizontal hold; next g50 sample may resume |
| O07 | Structurally invalid MoveTo g61 during path g60 | Reject; H60 and valid path remain |
| O08 | Admitted MoveTo g62 later UNREACHABLE | Idle H62; old route stays cleared |
| O09 | Reconnect epoch 8; pending or buffered epoch 7 operations | Reject old epoch; one retained entity, idle |
| O10 | Same request ID twice with identical payload | One query, one transition, same terminal result |
| O11 | Same request ID with altered destination | REQUEST_ID_CONFLICT; no second query |
| O12 | Path completion and direct override both eligible at T | Decide intent first, then reject obsolete completion |

Run O01 through O12 with permuted arrival cutoffs and record all permutations that change eligibility. Replaying a recorded journal must reproduce canonical output exactly in the same runtime. Different real arrival order can legitimately produce different intermediate ticks; never claim global determinism independent of network arrival.
