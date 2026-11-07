# Architecture review traceability

> Source: UDG-CONTRACTS-M0-001 v1.0, section 21.1. Repository edition 1. Shared requirements are authoritative here; task files link to them.

### 21.1 Baseline traceability

| v0.2 requirement or finding | Contract resolution | Required proof |
| --- | --- | --- |
| C-01 path and prediction mismatch | [Movement ordering](../interfaces/movement-authority.md) and [integration validation](../integration/README.md); server-only paths and mode overlay | Gate C handoff/race matrix |
| C-02 incomplete movement state | [Section 4](../interfaces/README.md); [canonical domain declarations](../interfaces/domain.md); full scalar replica mapping | 002 round trip; Gates A/B/C |
| C-03 collider ownership | CharacterPhysics only, bound entity calls | 006 lifecycle; Gate B |
| C-04 ambiguous ordering | Cutoff journal, generations and priority | O01-O12; Gate C |
| C-05 competing position ownership | Canonical state and one physics adapter | 005 ownership and Gate B adoption |
| R-01 physics rollback | Exact scalar restore and candidate ADR | Gate B replay traces |
| R-02 geometry mismatch | Shared source and complete manifest hashes | 007 build/import/traversal; Gate C |
| R-03 timestep limits | One 20 Hz owner and measured sensitivity | Gates A/B timing and drift |
| R-04 reconnect and stale input | Early lifecycle fixtures and epoch separation | Gate C slice; final system remains 010 |
| R-05 mobile jitter | Achieved network profiles and input parity | Gates A/C; full verification remains 011 |
| R-06 agent conflicts | File ownership, adoption and gate review | Every task completion record |
| R-07 inaccurate performance gates | Raw samples and scope-qualified metrics | Spike reports; hardware remains 012 |
| I-01 through I-05 | State separation, manifest, telemetry, versioning and CI | [repository rules](repository.md), [interfaces](../interfaces/README.md), [validation](../validation/README.md), [evidence](../validation/evidence-requirements.md) |
