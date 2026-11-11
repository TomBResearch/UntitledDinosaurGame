# Architecture decision records

> Source: UDG-CONTRACTS-M0-001 v1.0, section 20.1. Repository edition 1. Shared requirements are authoritative here; task files link to them.

### 20.1 Failure handling

If a prerequisite is absent, incompatible or unverified, mark the affected task Blocked and attach the precise missing evidence. If an API is absent, produce a minimal compiled/runtime probe and the installed version/declaration record. If deterministic ordering, collision ownership or scalar adoption cannot satisfy fixtures, stop affected integration; do not change a core rule locally. Harmless independent work in an already-authorised task may continue while the owner resolves the blocker.

The escalation record is docs/adr/proposals/TASK_ID-short-topic.md. Include trigger, baseline clause, expected versus actual behaviour, reproduction command/seed, logs/traces, affected tasks, alternatives, recommended change, migration/compatibility impact, security/performance effects and required retests. Status begins Proposed. The integration owner records Accepted or Rejected with rationale. Only Accepted decisions may alter contracts. Copy the accepted immutable reference into the run evidence; do not overwrite prior decisions.

| Failure | Required response | Resume condition |
| --- | --- | --- |
| Colyseus API or ack mismatch | Block Gate A; attach pinned reproduction | Supported adapter proven or ADR accepted and retested |
| Physics drift or stale query pose | Block Gate B; compare representation/fallback | Adoption and replay tests pass on approved representation |
| Recast binary or geometry mismatch | Reject assets; block Gate C | Clean rebuild and import/traversal proof |
| Unsafe hybrid handoff | Block Gate C; no guessed reset method | Supported transition probe and full race matrix pass |
| Protocol/schema/timestep change | Integration-owner ADR and version plan | Consumers updated; affected gates rerun |
| Security invariant failure | Stop affected path; preserve observer and diagnostics | Negative suite plus regression pass |
| Missing evidence or reference hardware | Mark BLOCKED or INVALID as appropriate | Evidence completed on declared environment |

## Record a decision

Copy [the ADR template](0000-template.md) into `docs/adr/proposals/` and link it from the affected assignment. Accepted decisions use a stable numbered filename under `docs/adr/`; retain the proposal and its disposition in history. An agent must not author an approval on the owner's behalf. Preserve prior accepted decisions; supersede them explicitly.

No architecture decision was accepted by the repository-population step itself, and the future `physics-prediction`
and `hybrid-prediction-handoff` records named in the source specification remain task outputs, not existing documents.
Decisions accepted **since**, by the integration owner, are indexed here; each retains its proposal and disposition in
history, and no approval in this repository was authored by the agent that produced the record.

| Record | Status | What it decides |
| --- | --- | --- |
| [ADR 0001 — replica precision policy](0001-replica-precision-policy.md) | **Accepted** | float64 canonical / float32 replica widths, provisional until the Gate A width freeze |
| [ADR 0002 — server declaration-checking exception](0002-server-declaration-checking-exception.md) | **Accepted** | `skipLibCheck: true` confined to `apps/server/tsconfig.json` and `apps/server/tsconfig.probes.json`, with the retained full check, the pinned declaration inventory, a strict check of UDG-owned emitted declarations, and a restated PR-0. `apps/client` and every other project are excluded |
| [ADR-P-0002 — compiler exception and input backlog posture](proposals/UDG-003-compiler-exception-and-input-backlog-posture.md) | Part A **Accepted** as ADR-0002; Part B **Not approved** | the measured candidate that became ADR-0002, and the input-backlog recommendation returned with five corrections (§0 of that document) |
| [ADR-P — UDG-003 input-consumption rule](proposals/UDG-003-input-consumption-rule.md) | **Proposed** | whether the one-input-per-entity-per-tick rule survives the pinned SDK, the clauses a multi-input rule would amend, and the real-state and adversarial evidence required before adoption |
| [ADR-P-0003 — D-7 input acknowledgement, overflow and resynchronisation policy](proposals/UDG-003-d7-input-acknowledgement-policy.md) | **Proposed** — owner decision outstanding (D7-A…D7-E); **D-7 remains open** | the recommended transport posture that keeps one input and one authority step per entity per tick, the acknowledgement-clause amendment it requires and why, when a client must discard pending inputs and resynchronise, and the overflow / player-isolation / reconnect acceptance tests |
