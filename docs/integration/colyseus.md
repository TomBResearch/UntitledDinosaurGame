# Colyseus validation contract

> Source: UDG-CONTRACTS-M0-001 v1.0, sections 6.1 and 6.2. Repository edition 1. Shared requirements are authoritative here; task files link to them.

### 6.1 Colyseus evidence contract

Official documentation inspected on 7 November 2026 exposes server defineInput and setFixedTimestep, single-frame next consumption, configurable sanitization/idle behaviour, and client room.input, Predict.get, reconciler, sim and attachAll. These names are documentation observations, not proof that any unpinned installation supports the desired combination. See references V1 and V2. All concrete calls must be isolated in the server/client adapters and compiled against the installed declarations.

UDG-003 and Spike 001 must create docs/integration/colyseus-0.18-api-map.md. For every used API, record exact package and version, import path, declaration file and symbol, official source URL or immutable source commit, minimal compiled probe path, runtime test ID, result and limitations. Required probes cover flat input declaration; legal and malformed decode; bounded queue and overflow; neutral idle; one frame per tick; advertised dt and patch rate; input staging and send; SDK acknowledgement; correction replay; local/remote rendering ownership; disposal; and reconnection lifecycle. Record the tested semantics of rejected old-generation inputs rather than guessing how SDK acknowledgements interact with application filtering.

The pinned compatibility set must include @colyseus/core, @colyseus/sdk, @colyseus/schema, the selected WebSocket transport and @colyseus/testing if used. Package choice is a UDG-001/003 deliverable; this document does not claim a specific patch release has passed. An API absent from installed declarations is a failed probe. Do not silence type errors with any, copy outdated 0.16 tutorials, use private SDK fields, or substitute a custom prediction framework. Escalate with a minimal reproduction and an ADR proposal.

### 6.2 Prediction lifecycle and mode boundary

Networking adapters own SDK prediction history and rendering reads; simulation owns the pure movement rule. One SDK input handle stages all fixed-step direct samples. One controller per local entity owns predicted pose. A second render loop or input adapter must not send duplicate samples. Camera and mesh interpolation never write into canonical or SDK decoded authoritative state.

PREDICT_DIRECT uses shared direct locomotion with authoritative correction and replay. AUTHORITATIVE_PATH renders accepted server transforms with smoothing and no local route computation. AUTHORITATIVE_IDLE does not predict horizontal travel. On a local higher-generation direct intention, immediate local prediction may begin before the server acknowledges, then reconcile normally. On pending click under P04, stage neutral non-direct input and stop predicted horizontal travel; do not predict an unaccepted path.

Maintain a UDG overlay containing application epoch, generation, authoritative mode and the valid direct replay range. A late result for an older generation can clear its own marker but cannot change the current overlay. A result message alone must not seed a pose from an unrelated tick: correlate it with replicated epoch, generation and lastAuthorityTick. Gate C must prove the exact handoff using supported public SDK lifecycle operations, including state adoption before direct replay, filtering invalid application inputs, avoiding double ownership of local rendering and retaining valid SDK acknowledgement continuity.

Do not assume an SDK method named pausePrediction, resetEpoch, clearHistory or switchMode exists. The agent must discover and document the supported procedure in tests/probes/colyseus-mode-transition.probe.ts. SDK sequence state must not be reset merely because a path is selected. If a safe procedure cannot be demonstrated, Gate C fails and an ADR is required before changing the protocol or predictor architecture.
