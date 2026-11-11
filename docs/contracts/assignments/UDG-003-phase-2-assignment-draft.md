# UDG-003 Phase 2 assignment — **DRAFT revision 2, not assigned**

Status: **Draft for owner review. This record assigns nothing, authorises nothing and starts no work.** Every
field below is a *proposal* awaiting the owner's decision. Nothing in this file may be read as permission to
touch a single source file: Phase 2 remains **unassigned**, Phase 3 remains **unassigned**, Gates A, B and C
remain **Not Run**, and `stackCompatibility` remains **not-established**.

Revision 2 records the owner's decisions on D-P2-1 and D-P2-5, resolves the recovery-budget conflict in
ADR-0003 §3.2 (§2.1), re-pins to the hardened probe and evidence baseline, and closes R-2 and R-7 — the two
CI reliability defects disclosed in revision 1 — as fixed by `98cd592…` and `f2b31ad…`. The incidents
themselves stay in §9 with their retained evidence; a fixed defect is still a disclosed defect.

Governing decision: [ADR-0003 — input acknowledgement, overflow and resynchronisation
policy](../../adr/0003-input-acknowledgement-overflow-and-resynchronisation-policy.md), with its evidence paper
[ADR-P-0003](../../adr/proposals/UDG-003-d7-input-acknowledgement-policy.md) and the
[adoption entry](../adoption.md#udg-003-d-7-decision-recorded-2026-11-11-adr-0003).

Owner instructions behind this record:

1. (revision 1, 2026-11-11) *"Publish the decision record and a reviewable Phase 2 assignment pinned to the
   resulting commit. This authorises the documentation and assignment draft only. Keep Phase 2 unassigned and
   report Gate A as Not Run."*
2. (revision 2, 2026-11-11) A scoped follow-up from `48a274a` fixing **R-2** (PR-15 observation capture) and
   **R-7** (CI evidence retention), authorising **probe, regression-test and evidence-workflow changes only**,
   requiring a controlled fail-then-pass demonstration and a verifier that rejects misattributed evidence; and
   a refresh of this draft: test-only recovery harness in Phase 2, production client left to UDG-008, formal
   Gate A held in UDG-SPIKE-001 after its prerequisites are verified, and the retry-budget conflict resolved
   to at most two actual rejoins in a rolling 60-second window with the 4-second recovery deadline still
   applying. Phase 2 stays **unassigned**, Gate A **Not Run**, D4 **open**.

Pinning:

```text
Probe and evidence baseline (this revision is pinned to it):  a4b018561d5304630b1a4d9afee09ca24a619c9e
Baseline CI run (success):                                     https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43077105336
Hardening commits behind that baseline:                        98cd592… R-2 capture + R-7 attribution · f2b31ad… R-8 sanitiser · a4b0185… invocation labelling
Red run on the first hardening commit:                         https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43070703836 — bundle verification failure disclosed in §9.3, not re-run away
Revision 1 of this draft:                                      0b139ea…, CI 43051206820 (success)
Revision 2 draft commit:                                       7fc03e5…, CI 43076308269 **cancelled** by the workflow's own `cancel-in-progress` rule when the labelling commit landed — not a failure, and its content is covered by 43077105336
Decision commit (ADR-0003, the policy this draft implements):  376469b171832adba8363642eaf2723d6528cdbc
Accepted Phase 1 implementation commit:                        5d77c6125e1c3a8035ae5c0cb5d115e91f008c9c
Accepted Phase 1 CI:                                           https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43010353106
UDG-001 acceptance commit:                                     524658e1fb4c53a450cdf933886c7ad4b17c72e9
UDG-002 acceptance commit:                                     d364d2dafbc88f469ef60e5e61c5e5c5c6cfd7e4
```

If the owner accepts this draft, the assignment must be **re-pinned to the then-current `main`** and the base
commit recorded at that moment; a draft pin is not an implementation base. The red run `43070703836` is part
of this baseline's history and is disclosed in §9.3 rather than re-run away, and the cancelled run
`43076308269` is recorded as cancelled rather than quietly dropped from the list.

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
| State and assignment date | **Draft revision 2, 2026-11-11.** Not Ready, not assigned | — |

## 2. What is already decided, so the draft does not re-open it

ADR-0003 settles the posture: consumption stays at **one** FIFO-selected continuous observation and **one**
authority step per connected entity per tick; the admitted **rate** is what gets bounded. The SDK acknowledgement
is a send-order watermark and is no longer the representation claim; the authoritative per-entity record is.
Queue pressure throttles, a confirmed unrepresented retirement closes the seat inside a bounded window, a rate
ceiling closes directly, and a suspected unsatisfiable acknowledgement is **diagnostic only** until positively
validated. The client runs a **client-local snapshot deadline** and recovers by stop-sending → discard pending
prediction → bounded rejoin → snapshot recovery.

Provisional test values carried forward: `B = 8`, `closureWindowMs = 250 ms`, `closureMaxMs = 1000 ms`,
`clientSnapshotDeadlineMs = 500 ms`.

### 2.1 The recovery budget, resolved (owner decision, revision 2)

Revision 1 inherited two numbers from ADR-0003 §3.2 that could not both hold: an episode was allowed
*"3 attempts at 250/500/1000 ms inside 4000 ms"* while a sustained cap allowed *"≤ 2 rejoins per 60 s"*. An
episode that used its third attempt breached the cap it was supposed to respect, so a client could be
conformant with one sentence and non-conformant with the next.

The owner resolved it on 2026-11-11, and Phase 2 implements this reading:

| limit | value | what happens when it is reached |
| --- | --- | --- |
| client-local snapshot deadline | `clientSnapshotDeadlineMs = 500 ms`, restarted on each accepted state delivery, **able to expire with no delivery at all** | stop sending inputs, discard pending prediction, enter recovery |
| recovery episode deadline | `clientRecoveryDeadlineMs = 4000 ms`, measured from the start of the episode | the episode ends: the client stays stopped, keeps its prediction discarded, surfaces a connection error and starts no further rejoin in that episode |
| rolling rejoin allowance | **at most two actual rejoins in any rolling 60-second window**, counted per entity across episodes | the client does not attempt the next rejoin; it stays stopped, records `recoverySuspended: 'rolling-window'` and retries only once the oldest counted rejoin leaves the window |

The 250/500/1000 ms ladder is a **backoff schedule, not an entitlement**: an attempt is made at the next ladder
step only if the rolling allowance still has room and the episode deadline has not expired. Whichever limit is
reached first governs, and the client's behaviour at each of the three limits is a required observation in the
W-7 harness — reaching a limit must be recorded and visible, never absorbed silently.

ADR-0003 §3.2 still carries the old wording, and it is **not edited here**: an accepted decision record
changes only by the owner's instruction, which is **D-P2-8** below. Until then §2.1 is the operative reading
for Phase 2 and ADR-0003 §3.2's numbers are the text that needs amending.

## 3. Proposed scope — work items

| id | work | deliverable | gate link |
| --- | --- | --- | --- |
| **W-1** | Apply the ADR-0003 §4 clause text to `docs/interfaces/movement-authority.md` §5.1 exactly as adopted, with the buffer bound and every other clause untouched | amended interface document + record that the wording matches ADR-0003 §4 byte for byte | precondition for all |
| **W-2** | Protocol surface: per-frame `uint32` send sequence on `DirectInputSchema` (declared as the room `seqField`), the per-entity record fields `inputResolvedThrough` / `inputGapStart` / `inputGapEnd` / `inputRetiredUnrepresented`, per-entity effect ledger (`effectCount`, `lastAppliedRequestId`), reserved close codes | schema + validator + `to-replica`/`from-replica` mapping + fixtures + `protocol-v1.md` update | GA-1…GA-5 |
| **W-3** | Declare the envelope and recovery values in `packages/config` so they are hashed: `λ`, `B`, `J`, closure bounds, `G`, `clientSnapshotDeadlineMs`, retry budget | config entries + **new `configHash` recorded everywhere it is pinned** (the accepted `948f8c10…` changes — see §8 D-P2-4) | GA-11 |
| **W-4** | `ColyseusInputAdapter` + `RegionRoom`: attach the sequenced input, reserve arrival order, drain exactly one observation per entity per tick through the accepted Phase 1 core, publish the record in the consuming tick, wire join validation and session association with the UDG session epoch (never `InputHandle.epoch`, which PR-15 measured unmoved across a rejoin) | room + adapter + unit/contract suites | GA-1, GA-4, GA-9 |
| **W-5** | Retirement accounting exactly as ADR-0003 §3.1: per-domain base snapshot, `wasIdle === false` guard, refused-count inside dequeued, `clear()` charged, three separate close observations | implementation + vectors proving each clause | GA-1…GA-4 |
| **W-6** | Consequences: `INPUT_QUEUE_PRESSURE` throttle, `INPUT_RETIRED_UNREPRESENTED` bounded closure with the forced final publication, `INPUT_RATE_CEILING` close; `INPUT_STRAND_SUSPECTED` recorded as a **diagnostic** with no termination path | implementation + evidence that pressure alone never closes | GA-2, GA-3, GA-12 |
| **W-7** | **Decided:** a **test-only** client harness implementing the ADR-0003 §3.2 rules and §2.1's resolved budget — same-delivery comparison, `INPUT_ACK_STALLED`, the client-local deadline, stop-sending, discard-prediction, bounded rejoin, snapshot recovery, and the behaviour at each of the three limits | harness under `tests/support/client-harness/**` + scenario evidence, and a frozen rule statement handed to UDG-008 as its contract. **Phase 2 writes no production client code: that is UDG-008's** | GA-6, GA-7 |
| **W-8** | PR-14 Gate A real-state probe on the §12.1 harness of ADR-P-0003: flat reference step + real replicated `RegionSchema`/`PlayerSchema`, no dependency on locomotion, physics or navigation | `PR-14` probe + registry + contract assertions | GA-1…GA-13 substrate |
| **W-9** | **Measure the close-path accounting**, which ADR-0003 §3.1 explicitly leaves unmeasured: whether frames still buffered when a seat closes are dropped without advancing the accessor's consumed count, and therefore whether `serverQueuedAtClose` must enter the retirement total | measurement record + the resulting rule, or an explicit statement that the question is unanswerable on these pins | GA-3, GA-7 |
| **W-10** | Adversarial populations: RTT, jitter, loss, mid-tick arrival, reconnect, offender and compliant control runs; the compliant control population that GA-12 needs to validate or reject the strand signal | `abuse-results.json`, `buffer-depth.csv`, `room-lifecycle.json`, per-criterion vectors | GA-2, GA-9, GA-12 |
| **W-11** | Tick metrics, disposal, and the real server smoke run through the harness; CI steps and the phase evidence gate extended to Phase 2 vectors | metrics + CI + gate | GA-13 |

## 4. Explicitly out of scope

Locomotion (UDG-005), physics (UDG-006), navigation and assets (UDG-007), production client input adapters
and **production client recovery** (UDG-008 — Phase 2 proves the rules with a test-only harness and hands them
over frozen; it does not ship them), predicted client navigation of any kind, multiple-input consumption (`take(n)`, `drain()`-to-latest,
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

**Gate A is Not Run, and its formal run does not belong to Phase 2.** The owner decided on 2026-11-11 that
Gate A is formally executed in **UDG-SPIKE-001**, after that task's prerequisites are verified. Phase 2's
obligation is therefore narrower and clearer: build the W-8 substrate, exercise GA-1…GA-13 against it, measure
what GA-11 demands, and **report each criterion as measured evidence** — without declaring Gate A passed.
A Phase 2 record that reads "Gate A passed" would be wrong even if every criterion happened to hold, because
the gate is a UDG-SPIKE-001 act over verified prerequisites, not a by-product of a phase finishing.

Nothing in this draft, in ADR-0003, or in any retained probe passes Gate A. PR-8, PR-13 and PR-15 show
mechanisms and limits; they are not Gate A evidence and `stackCompatibility` stays **not-established** until
the numeric gates pass on real transport.

## 8. Open items the owner must settle **before** Phase 2 can be assigned

| id | question | status |
| --- | --- | --- |
| **D-P2-1** | Who implements the client-side recovery rules of ADR-0003 §3.2 for real? | **Decided by the owner on 2026-11-11: Phase 2 ships a test-only harness (W-7) and the production client stays with UDG-008.** Phase 2 freezes the rules as the contract UDG-008 must implement; the harness proves the rules, never the shipped client |
| **D-P2-5** | Where is Gate A formally run? | **Decided by the owner on 2026-11-11: in UDG-SPIKE-001, after its prerequisites are verified.** Phase 2 produces the W-8 substrate and measured criterion evidence, and keeps reporting Gate A as **Not Run** |
| **D-P2-2** | Authorise W-1: applying ADR-0003 §4 to `movement-authority.md` §5.1 | approved in substance; the file is contract-owned text and the instruction was documentation-and-draft only |
| **D-P2-3** | Authorise W-2 protocol edits and reserve the close codes | frozen `DirectInputSchema` gains a mandatory field: a breaking wire change for every existing fixture and consumer |
| **D-P2-4** | Approve the `configHash` change W-3 causes | the accepted default digest `948f8c10fc404e2ebdb015abc8e30b8e66caf357347db3a2636ace96687a208a` is pinned in records and fixtures; adding envelope values changes it, and every pin must move together and be disclosed rather than silently updated |
| **D-P2-6** | Does the GA-12 validation succeed or fail? If the strand signal cannot be positively validated, closure stays unavailable for dedupe and only §3.2 recovery remains | Phase 2 must report the outcome either way; a convenient "validation succeeded" is exactly what PE-2 exists to prevent |
| **D-P2-7** | D4 evidence backup destination | still **open**, and now more pointed: the R-7 incident shows a single mutable output directory can destroy the evidence of a failure. Backup remains undesignated and no provisioning is authorised |
| **D-P2-9** | Add a dated forward-pointer to ADR-0003's incident paragraph so a reader of the decision record alone knows R-2 and R-7 are fixed? | still **open**. ADR-0003 says "until that fix lands, PR-15 must not be used as a Gate A substrate", which remains true as written and self-resolves on its own condition — but the fix landed at `98cd592…`/`f2b31ad…`, and only this draft says so. An accepted record is annotated on the owner's instruction, not by whoever noticed first, so this record points instead of editing |
| **D-P2-8** | Amend ADR-0003 §3.2 so its retry-budget wording matches the resolution in §2.1? | still **open**. §2.1 is the operative reading for Phase 2, but the accepted record still says "3 attempts … ≤ 2 per 60 s", and an accepted ADR is amended only by the owner's instruction — not by this draft, and not by an implementation that quietly picks one reading |

## 9. Known risks, recorded before assignment

| id | risk | evidence / handling |
| --- | --- | --- |
| **R-1** | `seqField` dedupes **before** the buffer, so a replayed stamp is discarded invisibly and can strand the acknowledgement below the client's send count (`13 < 14` measured) | already normative: strictly increasing stamps from `sentCount + 1`; pruning keyed on `inputResolvedThrough`; GA-5a/5b and GA-12 |
| **R-2** | ~~PR-15 observation capture is not atomic~~ — **fixed by `98cd592…`, regression-covered** | see §9.1 |
| **R-7** | ~~A failing probe invocation can be overwritten by a later passing one~~ — **fixed by `98cd592…`, regression-covered** | see §9.2 |
| **R-8** | The sanitiser defect that R-7's gate exposed | **fixed by `f2b31ad…`**; see §9.3 |

| **R-3** | Possible test-isolation interaction: the UDG-001 suite's frozen-installation test runs a real `pnpm install` in parallel with the UDG-003 suite building and running probes, which is a candidate mechanism for R-2 that the load experiment did not reproduce | unconfirmed; if Phase 2 hits it, sequence the suites and record the change rather than adding retries |
| **R-4** | Adding a mandatory wire field invalidates protocol fixtures and every pinned `configHash`/digest | D-P2-3, D-P2-4; move all pins in one disclosed change |
| **R-5** | ADR-0003's provisional values are loopback-shaped (`J = 0`) | GA-11 re-derives them; no production value is asserted anywhere in the adopted wording |
| **R-6** | Client-harness drift becoming the de facto client | D-P2-1; boundary rules keep the harness out of `apps/client` |

### 9.1 R-2 — PR-15 observation capture, disclosed and fixed

**What was wrong.** The probe published `gaps` as a **live reference** into a still-running room while
`skipped` was a number read at the moment of the call, and it settled on the client's `pendingCount === 0` —
a condition the SDK's eviction-advances-the-ack behaviour can satisfy while the room is still consuming. The
artefact could therefore contradict itself, which is exactly what the retained bytes from CI run
`43055416863` show: `consumedSeqs [9,10,11,12,14]`, `gaps [{from:12,to:14,skipped:1,tick:5}]`, `skipped 0`.
Two conditions combined: degenerate arrival interleaving (frames 1–8 retired before the room's first
consumption, leaving only a leading hole that no gap record can name) and non-atomic capture. The defect was
always present; only the assertion outcome moved — CI `43053089415` failed four contract tests on it, the very
next head `496f3317…` passed with the same inconsistency sitting harmlessly in its artefact (`gaps` summing to
3 while `skipped` said 2). Hosted outcome before the fix: two failures in four runs.

**What fixes it.** The room now owns the observation: `suspend`/`resume` withhold steps without counting a
withheld window as a tick, `drained()` settles on `accessor.size === 0` on the server's side of the wire, and
`snapshot()` copies every array by value and derives `skipped`, `peakSize`, `retiredUnrepresented`,
`firstConsumedSeq` and `unnamedLeading` inside that one read, recording `capturedOnce: true` in the artefact.

**What is asserted, and only where it can be.** S2a is now a **controlled** interior gap — four frames arrive
while steps are withheld — so the suite demands the exact gap `1 → 4, skipped 2` and the exact consumption
`1,4,5,6,7`. S2b is the **leading-only** case: retirements counted, no interior gap observable, and it passes
on the count, which is the shape the old single scenario turned into a false failure whenever interleaving
produced a leading hole. S2c stays uncontrolled and is asserted only on the identity
`consumed + skipped + unnamed = frames sent`, which held across five consecutive local runs even as the split
between named and unnamed moved (0/8, 4/3, 3/4). A suite test walks every published section and refuses any gap
array that disagrees with its own scalar, so the 43055416863 contradiction cannot be filed again.

### 9.2 R-7 — evidence retention, disclosed and fixed

**What was wrong.** The workflow ran the probe suite inside the test step and again during evidence capture,
into the same directory. CI run `43053089415` retained `PR-15 pass (27 checks)` and an all-`pass` index for a
run whose **test step had failed**; the failing bytes were overwritten and are unrecoverable, and only the
workflow log records the truth. That is the worst kind of evidence failure: a green artefact that is not a lie
by intent, and indistinguishable from an honest one after the fact.

**What fixes it.** Every result file carries an `invocationId`; each invocation writes
`artifacts/probes/invocations/<id>/`; `probe-invocations.json` is an append-only ledger that never drops an
earlier entry; and the latest index lists every invocation that ever failed in `failedInvocations`.
`evidence.js probes` refuses unattributed bytes, a file attributed to the wrong invocation, an index absent
from the ledger, a deleted invocation directory, an index that stopped disclosing an earlier failure, and **any
failed invocation anywhere in the job**. CI runs it even after an earlier failure would have stopped the job,
and bundle verification runs it whenever a bundle carries probe bytes — a UDG-003 bundle now hashes
`probes/probe-run-index.json` and the ledger alongside its vectors.

**How it is demonstrated, without fabricating a failure.** The regression group publishes a genuinely failing
invocation first (PR-14 is reserved and unbuilt, so running it really fails and the runner records that), then a
real passing invocation into the same directory, and asserts the failed invocation's own bytes survive the
overwrite and still name themselves. The misattribution, deletion, non-disclosure, unledgered and
unattributed cases are then driven against the same gate on that tree. On a persistent developer working tree the ledger
accumulates earlier invocations and a bundle carries them too. The same happens inside one CI job: the probe
directory survives between steps, so the UDG-003 bundle of the baseline run holds **six** invocations — the
full-suite step, the probe-suite step, the `pnpm test` of each of the three capture plans and the Phase 2
predecessor's contract re-run — each with its own directory and each named. What the bundle must never do is
present one invocation's bytes as another's, and the ledger is what makes that checkable.

### 9.3 R-8 — the defect the new gate caught on its first run

The attribution gate failed its first hosted run (`43070703836`) with six `PROBE-INVOCATION-MISMATCH`
readings of "PR-n.probe-result.json is not readable JSON". Cause: `sanitiseMachineText` replaced **every**
backslash with a slash to normalise Windows tool output, which inside JSON also rewrites escape sequences —
`\"not used, and why\"` was published as `/"not used, and why/"` and the artefact stopped parsing. The defect
predates this branch; nothing had ever put a probe artefact with an escaped quote into a bundle before. Fixed
in `f2b31ad…` by normalising only Windows-style absolute paths, with two regression tests (every probe JSON
artefact must survive sanitisation parseable and machine-root-free; escaped characters must be preserved
verbatim while a `D:\a\repo\…` path normalises). UNC paths are now left unnormalised — the tools here
produce none, and corrupting an artefact to normalise an unrecognisable string is the worse failure.

**Why this belongs in the risk table rather than a footnote:** the incident sequence is the argument for the
whole change. A red run exposed a latent defect in the evidence pipeline within minutes, because the artefact
could no longer be quietly inconsistent and still parse.

## 10. Owner review checklist

1. accept, amend or reject the scope of W-1…W-11 and the §5 path grants;
2. decide what remains open: **D-P2-2** (apply the adopted clause), **D-P2-3** (protocol edits and close
   codes), **D-P2-4** (the `configHash` change), **D-P2-6** (the GA-12 outcome, reported either way),
   **D-P2-7** (D4 backup destination), **D-P2-8** (amend ADR-0003 §3.2 to match §2.1) and **D-P2-9**
   (a forward-pointer in ADR-0003's incident paragraph now that R-2 and R-7 are fixed);
   D-P2-1 and D-P2-5 are decided and recorded above;
3. re-pin this record to the acceptance commit and mark it **Ready**, or leave it a draft — this revision is
   pinned to the probe and evidence baseline `f2b31ad…`, which is a code baseline, not an acceptance pin;
4. confirm that Gate A remains **Not Run** in every record, that its formal run sits in UDG-SPIKE-001, and
   that no Phase 2 record declares it passed;
5. confirm the recovery reading in §2.1 is what the W-7 harness must implement, and note that until D-P2-8 is
   decided, ADR-0003 §3.2's own numbers remain unreconciled in the accepted text.

Until then this file is a proposal on `main`: **Phase 2 unassigned, Phase 3 unassigned, Gates A/B/C Not Run,
Gate A's formal run belonging to UDG-SPIKE-001, `stackCompatibility` not-established, Part B unadopted,
D4 undesignated, and no code authorised.**
