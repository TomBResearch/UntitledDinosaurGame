# Source and vendor references

> Source: UDG-CONTRACTS-M0-001 v1.0, section 21.2. Repository edition 1. Shared requirements are authoritative here; task files link to them.

### 21.2 Source record and vendor references

S1. [Untitled Dinosaur Game M0 Technical Specification v0.2](specifications/UDG-SPEC-M0-002.md), document UDG-SPEC-M0-002, 7 November 2026, originally supplied as README.md. This remains the current architecture baseline; see the [current plan and version guide](specifications/README.md). Sections 2-10 establish the baseline rules; sections 11-13 establish gates and task order; sections 14-16 establish unresolved decisions and governance. The source hash is recorded in [adoption](contracts/adoption.md) and [provenance](contracts/provenance.json). Source statements are design requirements, not evidence that their implementation passed.

V1. Colyseus Server Input and Fixed Timestep. https://docs.colyseus.io/netcode/server-input . Inspected 7 November 2026. Supports the named fixed-step/input facilities and documented frame-consumption choices. Installed declarations and probes remain the task-level authority for exact calls.

V2. Colyseus Client Prediction and Reconciliation. https://docs.colyseus.io/netcode/client-prediction . Inspected 7 November 2026. Documents the named prediction helpers, scalar/opaque adoption distinction and SDK-owned input lifecycle. These observations do not establish UDG's hybrid mode-switch procedure; Gate C must prove it.

V3. Rapier JavaScript Character Controller. https://rapier.rs/docs/user_guides/javascript/character_controller/ . Inspected 7 November 2026. Supports separating computed controller movement from applying translation, with settings for slopes, steps and filtering. UDG wrapper behaviour and numeric thresholds are project requirements.

V4. Rapier JavaScript Determinism. https://rapier.rs/docs/user_guides/javascript/determinism/ . Inspected 7 November 2026. Documents matched-version/setup/order conditions and cautions about non-deterministic initialisation operations. UDG scalar rollback remains an empirical gate.

V5. Recast Navigation JavaScript repository and documentation. https://github.com/isaac-mason/recast-navigation-js . Inspected 7 November 2026. Documents Node/browser use and offline binary workflows. UDG binary compatibility, route completeness and resource budgets require the prescribed probes.

V6. Colyseus Reconnection. https://docs.colyseus.io/room/reconnection . Inspected 7 November 2026. Use as the official lifecycle reference, then verify the exact supported hooks in the pinned version before coding the Gate C reconnection slice.
