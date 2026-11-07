# UDG-SPIKE-002 Physics gate

> Source: UDG-CONTRACTS-M0-001 v1.0, section 15. Repository edition 1. Shared requirements are authoritative here; task files link to them.

## Assignment metadata

- Task: `UDG-SPIKE-002`
- Implementation status: **Not Started**
- Gate: B
- Requires Verified: [UDG-006](UDG-006.md)
- Refinement adoption: P10
- Assignment, implementer, reviewer, prerequisite commits and evidence: **unassigned**

## Read before this task

- [Repository instructions](../../AGENTS.md)
- [Adoption status](adoption.md)
- [Definition of done](definition-of-done.md)
- [Evidence requirements](../validation/evidence-requirements.md)
- [Domain](../interfaces/domain.md)
- [Configuration](../interfaces/configuration.md)
- [Colyseus](../integration/colyseus.md)
- [Engines](../integration/engines.md)
- [Measurement](../validation/measurement.md)
- [Acceptance Gates](../validation/acceptance-gates.md)

Read applicable ancestor and local `AGENTS.md` files before editing a path. Owned paths below are the proposed implementation scope, not permission to start the task. Use the linked assignment template and pin commits when it is separately assigned. All common requirements are incorporated by reference.

## Task contract

### Objective and prerequisites

Prove physics-constrained direct prediction can restore authority and replay without sustained divergence. Requires Verified 006, Gate A still valid, agreed physics fixtures and Gate B P10 thresholds. Physics and networking owners jointly recommend standalone collider versus kinematic body and reconciler versus sim. Integration owner decides Gate B.

### Owned files and implementation

Create tests/spikes/spike-002.test.ts; tests/probes/{rapier-node-browser,rapier-adoption}.probe.ts; docs/integration/gate-b.md; docs/adr/0001-physics-prediction.md; and scoped adapter updates in apps/client/src/network/ColyseusPredictionAdapter.ts and packages/physics/src/scalar-adoption.ts. Use the same engine/WASM, config, collision geometry and collider construction order in Node and browser. A separate client world contains static geometry and the predicted local collider; remote players are presentation-only and cannot alter local collision results.

Start with scalar reconciler plus explicit adapter synchronisation if that can be demonstrated safely. Evaluate SDK sim only through documented and compiled public callbacks if opaque engine state requires it. The selection must account for every scalar read on the next movement step, including position, grounded and integrator verticalVelocity. Do not assume restoring a translation rolls back controller contact caches or all world state. Store raw pre/post adoption, replay input suffix and resulting states.

### Required experiments

Run 1000 identical fixed ticks in Node and browser across flat, wall, corner, ramp and step fixtures. Repeat authoritative corrections every 50 ticks, selecting 0, 1, 5 and 20 pending inputs for replay. Compare each result to an independently constructed reference that begins at the same authoritative scalar state. Test zero dt rejection, one-substep consistency, player filters, disconnect stop/retain, final cleanup and region shutdown. A diagnostic two-substep run may measure sensitivity but cannot silently change the 20 Hz/one-substep baseline.

Test lifecycle creation order and query-world freshness after adoption. A candidate that only passes with unrecorded mutable cache state fails. If standalone collider fails, compare a kinematic-body candidate using identical fixture/config boundaries and record complexity, divergence and cleanup results. A fallback deterministic kinematic rule with Rapier collision queries requires an ADR before implementation or downstream integration.

### Commands and acceptance

Run root checks, pnpm test:contract -- --task UDG-SPIKE-002, pnpm test:e2e -- --suite physics and the spike runner with ID UDG-SPIKE-002 for all profiles/seeds. Pass only if [section 7](../validation/README.md) physics thresholds hold on all fixtures, final-200-tick divergence has no positive sustained growth above 0.001 m, direct unobstructed p95 correction stays below 0.15 m under elevated profile, and object counts return to baseline. Report grounded/slope/mode contact corrections separately, including p95/max and explanations; visual smoothing is not acceptance evidence.

Evidence includes common bundle, gate-b.md, accepted representation ADR, Node/browser aligned traces, adoption-before-after.jsonl, drift.csv, penetration.csv, resource-counts.csv and rejected-candidate results if any. Gate B freezes representation, public adapter behaviour and prediction strategy. Unresolved drift, incomplete scalar restoration or query-update uncertainty is FAIL and blocks 007 and Gate C.
