# Scope and authority

> Source: UDG-CONTRACTS-M0-001 v1.0, section 1. Repository edition 1. Shared requirements are authoritative here; task files link to them.

### 1.1 Included and excluded work

Included tasks are UDG-001, UDG-002, UDG-003, UDG-004, UDG-SPIKE-001, UDG-005, UDG-006, UDG-SPIKE-002, UDG-007, UDG-008 and UDG-SPIKE-003. Task numbers and their primary deliverables follow [v0.2 section 13](../specifications/UDG-SPEC-M0-002.md). Validation implementations are deliberately small reference implementations retained for later reuse.

UDG-009 through UDG-012 are not specified or assigned here. In particular, a Gate C pass does not claim final prediction integration, a production lifecycle system, a complete 20-player harness, hardware performance certification or M0 release. Early reconnection, abuse and timing fixtures are included only where needed to validate the three spikes. Production authentication, persistence, databases, Redis, multi-region transfers, combat, dinosaurs, progression, inventory, trading and chat remain excluded.

All implementation paths are proposed paths relative to this repository root. Existing Markdown files define the planning structure; source modules and commands will be created by separately assigned implementation tasks. The project mirror and its sources/ directory are read-only references. Implementing agents must use a separately authorised code checkout; they must not initialise or modify a game repository inside synced reference material.

### 1.2 Normative language and precedence

MUST is mandatory; SHOULD requires a recorded reason for deviation; MAY is optional. v0.2 is the adopted design baseline. This document supplies proposed executable refinements where v0.2 leaves details open. Refinements are labelled P01 to P10. They become binding for assigned work after the integration owner approves a contracts adoption record. An agent must not silently reinterpret a contradiction as permission to change the baseline.

The precedence order is the current authorised task and approved ADRs, the adopted contracts revision, then v0.2 for matters not refined here. A genuine conflict must block only the affected task and its descendants until resolved. Vendor declarations and executable behaviour establish what an SDK supports; they do not grant authority to change UDG requirements.

### 1.3 Proposed refinements requiring adoption

| ID | Refinement | Approval deadline |
| --- | --- | --- |
| P01 | File ownership, command names, runtime pin procedure and dependency checks | Before UDG-001 Ready |
| P02 | Flat input envelope, complete replica mapping and integer bounds | Before UDG-002 Ready |
| P03 | Tick cutoff, total ordering, generation window and replay journal | Before UDG-003 Ready |
| P04 | Stop on admitted pending destination and fail closed on route failure | Before Spike 003 Ready |
| P05 | Entity-bound simulator and navigation factories without changing baseline signatures | Before UDG-005 Ready |
| P06 | Float64 replica policy, derived velocities and state tolerances | Gate A freeze, revisit at Gate B only by ADR |
| P07 | Grounding, gravity, controller margins and blocked-route budget | Before UDG-006 Ready |
| P08 | Worker budget, route limits and asset format details | Before UDG-007 Ready |
| P09 | Input dead zone, touch arbitration and mode handoff validation procedure | Before UDG-008 Ready |
| P10 | Numeric spike thresholds, sample sizes and evidence schema | Before each relevant spike Ready |

These are proposals for implementation, not retrospective claims that v0.2 already specified these numbers or policies. Approval is recorded in docs/contracts/adoption.md with contract hash, owner, date and any ADR references. Library-specific schema constructors, reset methods and lifecycle hooks remain provisional until compiled and exercised against pinned versions.
