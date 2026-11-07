# UDG-SPIKE-003 Hybrid movement gate

> Source: UDG-CONTRACTS-M0-001 v1.0, section 18. Repository edition 1. Shared requirements are authoritative here; task files link to them.

## Assignment metadata

- Task: `UDG-SPIKE-003`
- Implementation status: **Not Started**
- Gate: C
- Requires Verified: [UDG-007](UDG-007.md), [UDG-008](UDG-008.md)
- Refinement adoption: P04, P08, P09, P10
- Assignment, implementer, reviewer, prerequisite commits and evidence: **unassigned**

## Read before this task

- [Repository instructions](../../AGENTS.md)
- [Adoption status](adoption.md)
- [Definition of done](definition-of-done.md)
- [Evidence requirements](../validation/evidence-requirements.md)
- [Protocol](../interfaces/protocol.md)
- [Domain](../interfaces/domain.md)
- [Configuration](../interfaces/configuration.md)
- [Movement Authority](../interfaces/movement-authority.md)
- [Navigation](../interfaces/navigation.md)
- [Colyseus](../integration/colyseus.md)
- [Measurement](../validation/measurement.md)
- [Acceptance Gates](../validation/acceptance-gates.md)

Read applicable ancestor and local `AGENTS.md` files before editing a path. Owned paths below are the proposed implementation scope, not permission to start the task. Use the linked assignment template and pin commits when it is separately assigned. All common requirements are incorporated by reference.

## Task contract

### Objective and prerequisites

Prove server navigation and predicted direct input share one deterministic movement authority under latency, cancellation and reconnection. Requires Verified 007 and 008 and valid Gates A/B. P04, P08, P09 and Gate C P10 must be adopted. Gate C is an integration experiment with real supported APIs; no downstream task is included.

### Owned files and implementation

Create apps/server/src/movement/{route-work,route-completion}.ts; apps/client/src/network/PredictionModeController.ts; tests/probes/colyseus-mode-transition.probe.ts; tests/spikes/spike-003.test.ts; tests/e2e/hybrid.spec.ts; tests/integration/reconnect-hybrid.test.ts; docs/integration/gate-c.md; and docs/adr/0002-hybrid-prediction-handoff.md. Integrate existing authority, region loader, input controller and collision adapter through owner-reviewed changes; do not duplicate them in spike-private code.

PredictionModeController is a UDG wrapper with onLocalDirect(frame), onLocalMoveTo(command), onResult(result), onAuthority(snapshot), onDisconnect(), onAdoptedEpoch(epoch) and dispose(). Its observable state is PREDICT_DIRECT, AUTHORITATIVE_PATH or AUTHORITATIVE_IDLE plus the pending request ID and current application epoch/generation. Its implementation may use only the public SDK lifecycle procedure proven by the mode-transition probe. The wrapper signature does not imply a vendor method of the same name.

Correlate results with replica authority ticks, adopt complete scalar state and preserve SDK sequence bookkeeping through handoff. No path prediction is permitted. Local direct override may predict immediately, but accepted server path state from an older generation cannot reactivate it. Test delayed result before state, state before result and multiple results in one patch interval. No replay may resubmit a one-shot MOVE_TO, navigation job or visual destination marker effect.

### Mandatory test matrix

| Group | Required cases | Invariants |
| --- | --- | --- |
| Routing | Around wall; replace route; arrive; blocked; unreachable; wrong floor | One accepted revision; correct result; no solid crossing |
| Arbitration | O01-O12; same-tick ties; 100 ms and 200 ms profiles | No stale activation or duplicate commit |
| Prediction | Direct to pending/path; path to direct; idle to direct; repeated switches | Single pose owner; complete adoption; no path replay |
| UI settlement | Rejection; stale result; delayed result/state order; timeout | Only matching marker updates; current intent preserved |
| Abuse | Malformed fields; burst requests; duplicate IDs; forged epoch; huge generation | Bounded work; defined rejection; observer healthy |
| Assets | Client mismatch; server corrupt asset; changed config | Refusal before movement; no fallback collision world |
| Reconnection | Loss with direct held, active path and pending job | Stop; same entity once; new epoch; old work rejected |
| Cleanup | Grace expiry; explicit leave; reconnect/expiry race; room shutdown | Exactly one cleanup; no live job or collider leak |

Reconnection is the minimum supported lifecycle slice required by v0.2 Spike 003, not the full UDG-010 implementation. Use supported Colyseus hooks after version-specific probe validation. The server stops input when a disconnect is detected; a network black hole cannot be detected at its physical start, so record detection latency separately. Neutral-on-missing limits continued direct travel before detection. Once disconnect is detected, connected false, route cleared and no further locomotion intent is applied. Retain the seat/entity/collider for up to 30 seconds.

Test reconnect after 5 seconds, after 29 seconds and after expiry beyond 30 seconds, plus controlled tests on the expiry boundary with a fake clock. Successful reconnect keeps the same entity ID, assigns fresh application epoch, clears old input/route state and adopts authoritative scalars before active prediction. Expiry removes resources once. A second concurrent connection cannot take ownership using an arbitrary entity ID. Reconnection tokens are secrets and never included in logs or videos.

### Commands and Gate C acceptance

Run root checks, pnpm assets:verify -- --region region-greybox-001, pnpm test:contract -- --task UDG-SPIKE-003, pnpm test:e2e -- --suite hybrid and the spike runner with ID UDG-SPIKE-003 for every profile/seed. Execute 100 controlled hybrid alternations per seed in each measured profile; repeat zero-latency authority permutations with the deterministic scheduler. Every reachable route must complete, every negative request must match its expected code, and stale activation/duplicate entity/old-epoch acceptance counts must each be zero.

Gate C also requires the SDK handoff probe to compile and run without private APIs or fabricated resets, the collision and direct-prediction gates to remain satisfied, route queue/time budgets to hold and reconnect tests to preserve exactly one entity. Path/idle/mode-contact correction populations must be reported separately, with maximum displacement and settle time. Any unexplained sustained oscillation or repeated authority/prediction ownership change is a failure even if unobstructed p95 passes.

Evidence includes common bundle, accepted handoff ADR, ordered-inputs.jsonl, transitions.jsonl, route-completions.jsonl, replica-result-correlation.jsonl, asset-verification.json, reconnect-lifecycle.json, correction-populations.csv and annotated recordings/screenshots. gate-c.md lists each remaining provisional decision and its resolution. A FAIL blocks downstream integration; a PASS proves this scope only and explicitly leaves UDG-009 through UDG-012 unverified.
