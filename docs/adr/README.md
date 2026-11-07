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

No architecture decisions have been accepted by this repository-population step. In particular, future `0001-physics-prediction.md` and `0002-hybrid-prediction-handoff.md` are task outputs, not documents that already prove an integration choice.
