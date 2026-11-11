# UDG-003 Phase 2 assignment — **DRAFT, not assigned**

Status: **Draft for owner review. This record assigns nothing, authorises nothing and starts no work.** Every
field below is a *proposal* awaiting the owner's decision. Nothing in this file may be read as permission to
touch a single source file: Phase 2 remains **unassigned**, Phase 3 remains **unassigned**, Gates A, B and C
remain **Not Run**, and `stackCompatibility` remains **not-established**.

Governing decision: [ADR-0003 — input acknowledgement, overflow and resynchronisation
policy](../../adr/0003-input-acknowledgement-overflow-and-resynchronisation-policy.md), with its evidence paper
[ADR-P-0003](../../adr/proposals/UDG-003-d7-input-acknowledgement-policy.md) and the
[adoption entry](../adoption.md#udg-003-d-7-decision-recorded-2026-11-11-adr-0003).

Owner instruction behind this draft (2026-11-11): *"Publish the decision record and a reviewable Phase 2
assignment pinned to the resulting commit. This authorises the documentation and assignment draft only. Keep
Phase 2 unassigned and report Gate A as Not Run."*

Pinning:

```text
Decision commit (ADR-0003, the basis this draft is pinned to): 376469b171832adba8363642eaf2723d6528cdbc
Accepted Phase 1 implementation commit:                        5d77c6125e1c3a8035ae5c0cb5d115e91f008c9c
Accepted Phase 1 CI:                                           https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43010353106
UDG-001 acceptance commit:                                     524658e1fb4c53a450cdf933886c7ad4b17c72e9
UDG-002 acceptance commit:                                     d364d2dafbc88f469ef60e5e61c5e5c5c6cfd7e4
```

If the owner accepts this draft, the assignment must be **re-pinned to the then-current `main`** and the base
commit recorded at that moment; a draft pin is not an implementation base.

## 1. Assignment record (template B1, proposed values)

| field | proposed value | status |
| --- | --- | --- |
| Task ID and objective | `UDG-003` — phase `2` of `3`: **transport and room** — Colyseus adapter, join validation, session association, tick metrics, disposal, and a real server run through the client harness, carrying the ADR-0003 obligations | proposed |
| Contracts version and SHA-256 | `UDG-CONTRACTS-M0-001` v1.0, repository edition 1; index hash taken at the acceptance commit | to be taken at acceptance |
| Baseline specification ID and SHA-256 | UDG-SPEC-M0-002 v0.2, `b51e7afdd6810c377d2d2702d7673119521a59cd0d6b91686700bf9149b73fcf` | unchanged |
| Assigned implementer and reviewer | **unassigned** — draft only | **not assigned** |
| Integration owner | `TomBResearch` | unchanged |
| Authorised checkout and branch | `main` of `TomBResearch/UntitledDinosaurGame`, no force-push | proposed |
| Prerequisite task IDs and commit SHAs | UDG-001 Verified `524658e1…`; UDG-002 Verified `d364d2da…`; UDG-003 Phase 1 accepted `5d77c612…`; **ADR-0003 decided** `376469b1…` | listed above |
| Verified gate evidence locations | Phase 1 bundles under `/workspace/udg-evidence/ci-run-43010353106`; ADR-0003 evidence in `ci-run-43033573543`, `ci-run-43035450600`, `ci-run-43043889689` and the run retained for `376469b1…` | existing store only; **D4 backup destination still undesignated** |
| Approved P01–P10 refinements and ADRs | P01, P02, P03, P06 approved; ADR-0001, ADR-0002 accepted; **ADR-0003 accepted (this is the governing decision for Phase 2)**; P04, P05, P07–P10 pending | unchanged |
| Allowed file paths | §5 — proposed, and controlled paths need the owner's named reviewer | **not granted** |
| Public interfaces implemented and consumed | §3 work items; `movement-authority.md`, `protocol.md` consumed as amended by ADR-0003 **once applied** | conditional on §6 |
| Required commands, fixtures, profiles and seeds | §6 | proposed |
| Acceptance metrics and evidence destination | §7 — ADR-0003 GA-1…GA-13 plus AC-1…AC-20; existing evidence store only | proposed |
| Known blockers and escalation owner | §8 open items and §9 risks; escalation to the integration owner through an ADR | listed |
| State and assignment date | **Draft, 2026-11-11.** Not Ready, not assigned | — |

## 2. What is already decided, so the draft does not re-open it

ADR-0003 settles the posture: consumption stays at **one** FIFO-selected continuous observation and **one**
authority step per connected entity per tick; the admitted **rate** is what gets bounded. The SDK acknowledgement
is a send-order watermark and is no longer the representation claim; the authoritative per-entity record is.
Queue pressure throttles, a confirmed unrepresented retirement closes the seat inside a bounded window, a rate
ceiling closes directly, and a suspected unsatisfiable acknowledgement is **diagnostic only** until positively
validated. The client runs a **client-local snapshot deadline** and recovers by stop-sending → discard pending
prediction → bounded rejoin → snapshot recovery.

Provisional test values carried forward: `B = 8`, `closureWindowMs = 250 ms`, `closureMaxMs = 1000 ms`,
`clientSnapshotDeadlineMs = 500 ms`, rejoin budget 3 × (250/500/1000 ms) inside 4000 ms, ≤ 2 rejoins per 60 s.

## 3. Proposed scope — work items

| id | work | deliverable | gate link |
| --- | --- | --- | --- |
| **W-1** | Apply the ADR-0003 §4 clause text to `docs/interfaces/movement-authority.md` §5.1 exactly as adopted, with the buffer bound and every other clause untouched | amended interface document + record that the wording matches ADR-0003 §4 byte for byte | precondition for all |
| **W-2** | Protocol surface: per-frame `uint32` send sequence on `DirectInputSchema` (declared as the room `seqField`), the per-entity record fields `inputResolvedThrough` / `inputGapStart` / `inputGapEnd` / `inputRetiredUnrepresented`, per-entity effect ledger (`effectCount`, `lastAppliedRequestId`), reserved close codes | schema + validator + `to-replica`/`from-replica` mapping + fixtures + `protocol-v1.md` update | GA-1…GA-5 |
| **W-3** | Declare the envelope and recovery values in `packages/config` so they are hashed: `λ`, `B`, `J`, closure bounds, `G`, `clientSnapshotDeadlineMs`, retry budget | config entries + **new `configHash` recorded everywhere it is pinned** (the accepted `948f8c10…` changes — see §8 D-P2-4) | GA-11 |
| **W-4** | `ColyseusInputAdapter` + `RegionRoom`: attach the sequenced input, reserve arrival order, drain exactly one observation per entity per tick through the accepted Phase 1 core, publish the record in the consuming tick, wire join validation and session association with the UDG session epoch (never `InputHandle.epoch`, which PR-15 measured unmoved across a rejoin) | room + adapter + unit/contract suites | GA-1, GA-4, GA-9 |
| **W-5** | Retirement accounting exactly as ADR-0003 §3.1: per-domain base snapshot, `wasIdle === false` guard, refused-count inside dequeued, `clear()` charged, three separate close observations | implementation + vectors proving each clause | GA-1…GA-4 |
| **W-6** | Consequences: `INPUT_QUEUE_PRESSURE` throttle, `INPUT_RETIRED_UNREPRESENTED` bounded closure with the forced final publication, `INPUT_RATE_CEILING` close; `INPUT_STRAND_SUSPECTED` recorded as a **diagnostic** with no termination path | implementation + evidence that pressure alone never closes | GA-2, GA-3, GA-12 |
| **W-7** | Test-only client harness implementing the ADR-0003 §3.2 rules: same-delivery comparison, `INPUT_ACK_STALLED`, the client-local deadline, stop-sending, discard-prediction, bounded rejoin, snapshot recovery, budget exhaustion → surfaced error | harness + scenario evidence. **Production client code is UDG-008 territory — see §8 D-P2-1** | GA-6, GA-7 |
| **W-8** | PR-14 Gate A real-state probe on the §12.1 harness of ADR-P-0003: flat reference step + real replicated `RegionSchema`/`PlayerSchema`, no dependency on locomotion, physics or navigation | `PR-14` probe + registry + contract assertions | GA-1…GA-13 substrate |
| **W-9** | **Measure the close-path accounting**, which ADR-0003 §3.1 explicitly leaves unmeasured: whether frames still buffered when a seat closes are dropped without advancing the accessor's consumed count, and therefore whether `serverQueuedAtClose` must enter the retirement total | measurement record + the resulting rule, or an explicit statement that the question is unanswerable on these pins | GA-3, GA-7 |
| **W-10** | Adversarial populations: RTT, jitter, loss, mid-tick arrival, reconnect, offender and compliant control runs; the compliant control population that GA-12 needs to validate or reject the strand signal | `abuse-results.json`, `buffer-depth.csv`, `room-lifecycle.json`, per-criterion vectors | GA-2, GA-9, GA-12 |
| **W-11** | Tick metrics, disposal, and the real server smoke run through the harness; CI steps and the phase evidence gate extended to Phase 2 vectors | metrics + CI + gate | GA-13 |

## 4. Explicitly out of scope

Locomotion (UDG-005), physics (UDG-006), navigation and assets (UDG-007), production client input adapters
(UDG-008), predicted client navigation of any kind, multiple-input consumption (`take(n)`, `drain()`-to-latest,
`InputAccessor.clear()` as a remedy), and any relaxation of P03 stage Q. **Part B of ADR-P-0002 remains
unadopted**; ADR-0003 bounds the admitted *rate* and deliberately does not touch consumption. Phase 3 (abuse
suite hardening, capture plan, CI submission for the task as a whole) is a separate authorisation.

## 5. Proposed file ownership — **not granted by this draft**

Contract-owned UDG-003 paths (already listed in the readiness proposal §3.3): `apps/server/src/{main,server-config}.ts`,
`apps/server/src/rooms/RegionRoom.ts`, `apps/server/src/network/{ColyseusInputAdapter,join-validation}.ts`,
`apps/server/src/movement/MovementAuthorityAdapter.ts`, `apps/server/src/state/map-player.ts`,
`apps/server/src/lifecycle/DevelopmentSessions.ts`, `apps/server/src/telemetry/tick-metrics.ts`,
`tests/reference/flat-direct-step.ts`, `tests/probes/colyseus-server.probe.ts`,
`tests/contracts/UDG-003.test.ts`, `docs/integration/colyseus-0.18-api-map.md`.

Additional paths Phase 2 cannot avoid, each needing an explicit grant:

| path | why | control |
| --- | --- | --- |
| `docs/interfaces/movement-authority.md` | W-1 applies the adopted clause | **protocol/interface owner — the amendment is approved in substance; application still needs the instruction** |
| `docs/contracts/protocol-v1.md`, `packages/protocol/src/**` | W-2 schema, validator, mapping | **protocol owner** |
| `tests/fixtures/protocol/*.json` | new mandatory wire field changes every fixture | protocol owner; UDG-002 suite must stay green **in intent** |
| `packages/config/src/**` | W-3 declares the envelope | config owner; changes `configHash` |
| `tests/reference/gate-a/**` | W-8 harness, dependency-fenced | new path, boundary-suite entry required |
| `tests/support/client-harness/**` | W-7 test-only client | new path; **must not** become the production client |
| `tools/checks/src/evidence.ts`, `.github/workflows/ci.yml` | phase evidence gate for Phase 2 vectors | controlled; narrowly scoped grant, as with A9–A12 in Phase 1 |
| `apps/server/src/authority/**` | only if a defect forces it | **any change re-opens accepted Phase 1 and needs the owner's explicit instruction** |

## 6. Required commands and evidence

`pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm build`,
`pnpm --filter @udg/server build:probes`, `pnpm dependencies:verify`, `pnpm test:boundaries`,
`pnpm test:fixtures`, `pnpm run declarations:strict`, `pnpm test`, `pnpm contracts:checksums`, and the Phase 2
evidence gate mirroring the Phase 1 vector gate. Evidence goes to the **existing** store
(`/workspace/udg-evidence/ci-run-<id>/…`) with the sanitisation and machine-path rules unchanged; no new release,
tag, archive or storage location — **D4 remains undesignated and no backup provisioning is authorised.**

## 7. Acceptance

Phase 2 is complete when **GA-1…GA-13 of ADR-0003 §5** all pass on the W-8 harness over a real round trip,
together with AC-1…AC-20 and the numeric Gate A measures, and when every scenario replays from its recorded
journal to the same dispositions, canonical state and chain tip. A criterion with a missing, unverifiable or
non-replayable artefact is **FAIL**, not "not run". Submission is **In Review** with source, tests, exact SHAs,
CI links and verified bundles; acceptance is recorded by the owner alone, and a phase-level acceptance would not
make UDG-003 `Verified`.

**Gate A is Not Run.** Nothing in this draft, in ADR-0003, or in any retained probe passes it. PR-8, PR-13 and
PR-15 show mechanisms and limits; they are not Gate A evidence and `stackCompatibility` stays
**not-established** until the numeric gates pass on real transport.

## 8. Open items the owner must settle **before** Phase 2 can be assigned

| id | question | why it cannot be assumed away |
| --- | --- | --- |
| **D-P2-1** | Who implements the client-side recovery rules of ADR-0003 §3.2 for real — UDG-008 (input adapters, Gate C, requires UDG-004/UDG-005) or a Phase 2 slice? | Gate A needs the behaviour now, but the production owner is a later task. Proposal: Phase 2 ships a **test-only harness** (W-7) and freezes the rules as the contract UDG-008 must implement; Gate A evidence then proves the rules, not the production client |
| **D-P2-2** | Authorise W-1: applying ADR-0003 §4 to `movement-authority.md` §5.1 | approved in substance; the file is contract-owned text and the instruction was documentation-and-draft only |
| **D-P2-3** | Authorise W-2 protocol edits and reserve the close codes | frozen `DirectInputSchema` gains a mandatory field: a breaking wire change for every existing fixture and consumer |
| **D-P2-4** | Approve the `configHash` change W-3 causes | the accepted default digest `948f8c10fc404e2ebdb015abc8e30b8e66caf357347db3a2636ace96687a208a` is pinned in records and fixtures; adding envelope values changes it, and every pin must move together and be disclosed rather than silently updated |
| **D-P2-5** | Confirm Gate A scheduling: Gate A gates UDG-005, so does the full GA run happen at Phase 2, or does Phase 2 produce the harness plus a partial set and Gate A is formally run later? | GA-11 demands measured populations; a partial run must not be reported as a Gate A pass |
| **D-P2-6** | Does the GA-12 validation succeed or fail? If the strand signal cannot be positively validated, closure stays unavailable for dedupe and only §3.2 recovery remains | Phase 2 must report the outcome either way; a convenient "validation succeeded" is exactly what PE-2 exists to prevent |
| **D-P2-7** | D4 evidence backup destination | still undesignated; no independent copy of any Phase 2 evidence exists |

## 9. Known risks, recorded before assignment

| id | risk | evidence / handling |
| --- | --- | --- |
| **R-1** | `seqField` dedupes **before** the buffer, so a replayed stamp is discarded invisibly and can strand the acknowledgement below the client's send count (`13 < 14` measured) | already normative: strictly increasing stamps from `sentCount + 1`; pruning keyed on `inputResolvedThrough`; GA-5a/5b and GA-12 |
| **R-2** | **Loopback probe timing sensitivity.** One full-suite run of the day failed four probe-dependent UDG-003 tests (`PR-0` index, PR-15 gap visibility, PR-15 mechanism verdict, probe-evidence ownership) while three subsequent full runs and an under-load contract run were green (521 tests). The PR-15 gap scenario sends 12 frames at 5 ms against a 50 ms step, so a run in which every frame lands before the first step retires everything ahead of the first consumption and leaves **no nameable gap** — the assertion shape that failed. Hardening means constructing the gap deterministically (consume one frame, then a synchronous burst larger than the bound), which is a code change to accepted-session tooling and is **not** authorised by the documentation-only instruction behind this record | report honestly, do not "rerun until green"; harden under a separate instruction, and require Gate A scenario determinism explicitly (GA-13) |
| **R-3** | Possible test-isolation interaction: the UDG-001 suite's frozen-installation test runs a real `pnpm install` in parallel with the UDG-003 suite building and running probes, which is a candidate mechanism for R-2 that the load experiment did not reproduce | unconfirmed; if Phase 2 hits it, sequence the suites and record the change rather than adding retries |
| **R-4** | Adding a mandatory wire field invalidates protocol fixtures and every pinned `configHash`/digest | D-P2-3, D-P2-4; move all pins in one disclosed change |
| **R-5** | ADR-0003's provisional values are loopback-shaped (`J = 0`) | GA-11 re-derives them; no production value is asserted anywhere in the adopted wording |
| **R-6** | Client-harness drift becoming the de facto client | D-P2-1; boundary rules keep the harness out of `apps/client` |

## 10. Owner review checklist

1. accept, amend or reject the scope of W-1…W-11 and the §5 path grants;
2. decide D-P2-1…D-P2-7, at least D-P2-1, D-P2-2 and D-P2-3 before any assignment;
3. re-pin this record to the acceptance commit and mark it **Ready**, or leave it a draft;
4. confirm that Gate A remains **Not Run** in every record until GA-1…GA-13 plus AC-1…AC-20 pass on real transport.

Until then this file is a proposal on `main`: **Phase 2 unassigned, Phase 3 unassigned, Gates A/B/C Not Run,
`stackCompatibility` not-established, Part B unadopted, D4 undesignated, and no code authorised.**
