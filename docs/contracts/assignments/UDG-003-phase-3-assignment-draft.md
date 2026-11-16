# UDG-003 Phase 3 assignment **draft** — abuse, evidence, CI, the `W-7`/`P-2b` suite defect, and the task-level submission — **assigns nothing**

Task ID: `UDG-003` — phase `3` of `3`
Status: **Published draft. The owner approved the Phase 3 scope in principle and directed publication of this
draft pinned to `eb0fdf84da9494dd515b6e42969c86b773008c81` (§0). That authorises planning and publication only:
Phase 3 remains unassigned and implementation unstarted. This file grants no path, moves no status field, adopts
no refinement, passes no gate and creates no source file.** On a further explicit owner instruction it becomes
the pinned assignment record `UDG-003-phase-3.md`, re-pinned to the `main` head of that moment — which today is
this same commit; `origin/main` was confirmed at `eb0fdf8…` before publication, so no re-pin difference exists
to report — exactly as the [Phase 2 record](UDG-003-phase-2.md) superseded
[its own draft](UDG-003-phase-2-assignment-draft.md).

## 0. Owner directions recorded at publication (dated by the commit carrying this record)

The owner's instruction approving the scope in principle and directing publication. The message carries no
independently verifiable timestamp, so the direction is dated by the commit carrying this section; that commit
cannot name its own sha, so `git log -- docs/contracts/assignments/UDG-003-phase-3-assignment-draft.md` stays
authoritative for it, per the procedure the Phase 1, M-1, D-7, D-8 and Phase 2 records used.

| Direction | Where it binds in this draft |
| --- | --- |
| **W-7/P-2b diagnosis and repair stay inside Phase 3 as W-A.** The accepted-harness grant is scoped to *instrumenting and fixing a demonstrated cause*. The exact failing assertions are identified from the retained attempts, and **W-7 and P-2b are treated as potentially separate defects** — one record, two diagnoses, two fixes if the evidence says two. Recovery deadlines, retry limits, close codes and every existing guarantee are preserved; failures stay visible | §5.1, §5.3, §6.2 (step 0 and the two-defect framing), §6.3–§6.5 |
| **The repeatability check is defined**: ten consecutive passes of the affected cases under a **declared load and test order**, plus a **first-attempt green hosted run on the exact submitted commit**. Each defect fixed requires a **targeted reproducer or failing control**. If an original failure cannot be reproduced, W-A **reports what the retained evidence establishes** before proposing any change | §6.5 (replaces the proposed N, formerly D-P3-5 — now answered) |
| **Phase 3 takes the next turn on the shared tooling after UDG-004.** Both task suites and the camera suite are re-run on the integrated head. The whole-task capture commands and artefacts are specified, and any change to an **existing** capture plan is identified separately from the new plan | §4 (D-P3-2, now answered), §7.1, §7.2 |
| **Formal Gate A, production tuning and compatibility claims stay outside this assignment. D4 stays open. Deduplication-triggered closure stays disabled** | §3, §4 non-goals, §9 — restated, unchanged |

The directions answer decision items D-P3-2, D-P3-3, D-P3-5 and D-P3-6 as they previously stood, and narrow
D-P3-4; what remains open is listed in §4 and nothing there is self-answered by this draft.

**Publication CI (named by the commit after this record's own, per the standing convention).** This draft
landed as `70f6d17ac4c8c5d4e064fd744d48c7b474634d01` on `main` (the commit carrying the §0 directions; the
commit that added this paragraph cannot name it and does not try — `git log` names it); its hosted run is
[43947298628](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43947298628), workflow `ci`,
run number 133, **completed / success on the first attempt** on exactly that head. The publication itself is a
docs-only change: no implementation path moved, no capture plan moved, no status field moved.

**The records commit went red, and it is recorded rather than re-run away.** The commit adding the paragraph
above — `9aef88f437ac115b3b27aa4f420376a2926c277e`, differing from `70f6d17` **only** in this one
checksum-excluded draft file (implementation tree byte-identical) — ran
[43956003339](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43956003339): **completed /
failure** at step "Run the unit and Node integration suites", with the standing knock-on at "Verify probe
invocation attribution" (the UDG-003 probe step never runs once the test step aborts) — the same failure shape
as recorded `W-7` reds such as run `43871936471` attempt 1. What the retained evidence establishes, stated as
§6.5 requires: (a) the failing step is `pnpm test`; (b) the tree was byte-identical to a head that had gone
green on its **first attempt** roughly half an hour earlier, so identical code produced red and green — the
recorded nondeterminism signature; (c) no assertion identity is claimed here, because the run logs are not
retrievable without owner credentials — **the owner's view of the run page is the byte that names the failing
assertion**, and until it is read this red stands as *shape-consistent with* `W-7`, not as a confirmed
instance. No capture bundle exists for this run: the capture step never started. The red is kept; `9aef88f`
is not re-run into greenness, and its status is carried forward by its successor commits the way UDG-004's
records carried a head that never had a green run of its own. If the owner's reading confirms `W-7`, the tally
becomes ten reds across eight runs on the day Phase 3's draft was published — recorded in §6.1 only by this
kind of dated addendum, never by rewriting it.

What is unchanged by this draft, and unchanged by reviewing it:

- **UDG-003 as a whole stays In Progress.** Phase 0 is accepted as ADR-0002; Phase 1 and Phase 2 are accepted
  **at phase level only** ([completion §16](UDG-003-phase-1-completion.md),
  [completion §21](UDG-003-phase-2-completion.md)); neither authorises anything beyond its own scope.
- **Gate A, B and C remain Not Run.** Gate A's formal execution is [UDG-SPIKE-001](../UDG-SPIKE-001.md)'s.
- **D4 remains open and undesignated.** Evidence goes to the existing store (`/workspace/udg-evidence/`) only;
  no new storage location, release, tag or archive is authorised here.
- `stackCompatibility` remains **not-established**; Part B of ADR-P-0002 remains **unadopted**;
  deduplication-triggered closure remains **disabled** (D-P2-6, GA-12 and PE-1…PE-5 not passed);
  AC-15 stays PASS under H1 with H2 deferred.
- The `W-7` suite defect stays tracked where the contract says it is tracked — under UDG-003 — and this draft
  proposes a fix vehicle without applying one.

## 1. Pin and prerequisite chain

```text
Draft pinned to (main, clean tree)               eb0fdf84da9494dd515b6e42969c86b773008c81
                                                 "docs(UDG-004): name the acceptance commit 76db480 …"
Contracts edition                                UDG-CONTRACTS-M0-001 v1.0, repository edition 1
Baseline specification                           UDG-SPEC-M0-002 v0.2, SHA-256
                                                 b51e7afdd6810c377d2d2702d7673119521a59cd0d6b91686700bf9149b73fcf

Prerequisite commit (UDG-001 acceptance): 524658e1fb4c53a450cdf933886c7ad4b17c72e9
Prerequisite commit (UDG-002 acceptance): d364d2dafbc88f469ef60e5e61c5e5c5c6cfd7e4
Prerequisite commit (UDG-003 Phase 0, accepted as ADR-0002): 8987139f18653b05e57e64d0b14cdd1c753b6612
Prerequisite commit (UDG-003 Phase 1, accepted at phase level): 5d77c6125e1c3a8035ae5c0cb5d115e91f008c9c
Prerequisite commit (UDG-003 Phase 2, accepted at phase level): 6e0e5cc839f3d501a26998172438ded51914335d
Prerequisite commit (Phase 2 records, reviewed): f0c8ccde4b086e8e243412acdfedcd04b6558043
Prerequisite commit (ADR-0003, the governing decision): 376469b171832adba8363642eaf2723d6528cdbc
Prerequisite commit (UDG-004 accepted implementation): d318444fe8668f4485d85398ecc6eb88ff5e3b36
Prerequisite commit (UDG-004 acceptance record): 76db480892fa4aa21bd79c1bf7e939b5ddb6315e
```

A draft pin is not an implementation base: assignment re-pins to the then-current `main` head, names its CI run,
and — because UDG-004 landed after Phase 2 — re-runs the Phase 2 suites on the merged head before any Phase 3
code is written (M-6 second-lander obligation, §4 D-P3-2 — answered at §0). Suite at the draft pin: 616 tests / 0 failures (UDG-004's
acceptance run `43931959796`, first attempt), UDG-001/UDG-002/UDG-003/UDG-004 capture plans all PASS.

## 2. What Phase 3 must deliver for UDG-003 to become Verified

Phase 3's standing scope is the one the records keep pointing at and no phase has executed:
*"abuse, evidence, CI: offender suite, buffer depth, capture plan, CI steps, submission"*
([readiness proposal §3.2](UDG-003-readiness-proposal.md)), plus the Phase 2 assignment's explicit
["**not Phase 3**" item 6](UDG-003-phase-2.md) — abuse-suite hardening, the whole-task capture plan and the
task-level submission — plus the one defect the task has been carrying since Phase 2's acceptance: `W-7`/`P-2b`.

Verified follows [definition-of-done.md](../definition-of-done.md) exactly: explicit assignment against this
revision with immutable prerequisite commits; all expected files in authorised paths; the four root commands and
every applicable task command passing **on the final commit** with nonzero counts and no skips or quarantines;
fixtures and thresholds on required seeds/profiles; a validating evidence bundle that reproduces the run;
a completion report stating remaining limitations; and **owner acceptance**. Flaky tests block verification
([evidence requirements §19.2](../../validation/evidence-requirements.md)) — which is why the `W-7` fix is a
Phase 3 deliverable, not a footnote: UDG-003 cannot be Verified while its own suite reddens other tasks'
captures.

### Work items

| id | work | deliverable |
| --- | --- | --- |
| **W-A** | **Diagnose and fix `W-7` and `P-2b`** — the wall-clock- and ordering-sensitive live-transport probes in `tests/system/udg-003-phase-2/runtime.test.ts` — as potentially **separate defects**, per §6. Gating property: the §6.5 repeatability check per defect — ten consecutive passes of the affected cases under the declared load and test order, a targeted reproducer or failing control, and a first-attempt green hosted run on the exact submitted commit | diagnosis record with the per-attempt assertion table + reproducer/control + fix commit(s) + the declared-load streak evidence (§6.5) |
| **W-B** | Abuse/offender suite hardening to task-contract wording: sustained-abuse buffer cap, offender survival and observer isolation re-proved as a **task-level** suite, not only as per-phase runs; `buffer-depth.csv` re-emitted under the task plan | hardening suites + task-level `abuse-results.json`, `buffer-depth.csv`, `room-lifecycle.json` |
| **W-C** | **The whole-task capture plan and CI steps.** Per [Phase 2 §8.2.1](UDG-003-phase-2.md): the plan label moves deliberately and discloses what the bundle is; the Phase 1 vector set (15 artefacts) and the Phase 2 set (27 artefacts) keep being captured and gated — neither is removed; the probe step and probe ledger stay hashed inside the bundle; each artefact names the baseline it belongs to. CI follows the single-writer rules **M-2/M-3**: `CAPTURE_PLANS` append-only, existing entries byte-identical; `ci.yml` steps appended only, no renumbering, no `continue-on-error`, `retries: 0` stays (**M-7**) | amended `tools/checks/src/evidence.ts` + `ci.yml` + refusals proven (a missing/empty/unattributable artefact reddens the gate) |
| **W-D** | **Task-level completion record** `UDG-003-completion.md` + `UDG-003-evidence.json`: the AC-1…AC-20 and GA ledgers closed out against accepted Phase 1 + Phase 2 evidence plus this phase's, with the baseline-to-digest attribution table (`948f8c10…` → `2743a9a0…`), the carried obligations named exactly (§4), and the eleven retained red `W-7` attempts kept visible | completion record + verified bundle, submitted **In Review** |
| **W-E** | Stale-surface reconciliation, applied only with the assignment/acceptance commits and the owner's pen where the rules require it: [UDG-003.md](../UDG-003.md) status and W-7 lines, `README.md` status sentences, `adoption.md` entries, `checksums.json` regenerated by command (**M-4**) | reconciled surfaces; historical narrative left dated-as-written |

Nothing above re-opens accepted work: `apps/server/src/authority/**` (Phase 1) stays untouched; a change there
needs its own owner instruction.

## 3. What Phase 3 does **not** deliver — where the rest remains

### 3.1 Formal Gate A (UDG-SPIKE-001; Gate A stays **Not Run** until it runs)

- The **formal execution** of Gate A and its P10 thresholds (owner decision **D-P2-5**; "not Gate A" item 1).
- **GA-11**: evaluation of `B + J·λ + stall ≤ bufferMaxSize` and `clientSnapshotDeadlineMs ≥ 4 × patch interval
  + 2 × measured p99 RTT` on measured populations, production envelope values named beside the provisional ones,
  the eviction consequence at production values, and the `tc`/`netem`-availability record — the loss population
  keeps travelling with `dropModel: "application-layer delivery loss"`, `tcpLossModelled: false`.
- **GA-6/GA-7 at the formal envelope** (Phase 2's controls are at provisional test values in the test harness).
- **GA-12** and **PE-1…PE-5**; until they positively pass, dedupe-triggered closure stays disabled and
  `INPUT_STRAND_SUSPECTED` stays diagnostic.
- Any `stackCompatibility` claim.

### 3.2 Other owners (named so Phase 3 cannot silently absorb them)

- **UDG-007**: GA-10a, GA-10b, the discrete queue limits (AC-3b discrete half), AC-6's `P` results half,
  the bounds-file surface of AC-13, and the failed-asset-load row carried from UDG-004's acceptance.
- **UDG-008**: the production client — both recovery paths, the prediction buffer, GA-6/GA-7 for real;
  the frozen §3.2 rule statement handed over in Phase 2 stays its contract.
- Not Phase 3 either way: Part B (unadopted), H2, D4 provisioning.

UDG-003 can reach **Verified** with Gate A Not Run — Verified is a task state; Gate A is a decision UDG-SPIKE-001
executes once both its prerequisites (UDG-003, UDG-004) are Verified. UDG-004's acceptance of 2026-11-16 supplied
its half; Phase 3 is UDG-003's.

## 4. Prerequisites and owner decisions still open at this pin

| item | state | why it is the owner's |
| --- | --- | --- |
| **D-P3-1** | **Assign Phase 3 — to whom, against which re-pinned baseline?** Re-pin must name the `main` head and its CI run, and must confirm the Phase 2 suites green on that head (the tree has moved by UDG-004's work since `6e0e5cc8`) | only an owner instruction makes it Ready |
| ~~D-P3-2~~ **Answered at publication (§0)** | **Phase 3 takes the next turn on the six shared files** (`evidence.ts`, `ci.yml`, `checksums.json`, `dependencies.json`/lockfile, `README.md`, `support.ts` + UDG-001 suite) after UDG-004's accepted first use. As second lander it rebases onto settled tooling and **re-runs both task suites and the camera suite on the integrated head** (M-6): `pnpm test:contract -- --task UDG-003`, `pnpm test:contract -- --task UDG-004`, `pnpm test:e2e -- --suite camera`, on the merge with `main` (M-5), before and with the submission | — |
| ~~D-P3-3~~ **Answered at publication (§0)** | **`W-7` remedy class: option (i), executed as W-A inside Phase 3** — the fix lives in UDG-003's own suite. Not (ii) keep-rerunning: the red has migrated from UDG-004's capture into UDG-002's and then UDG-001's, and the failure rate rises with job weight; not (iii) reordering sibling captures, which moves other tasks' acceptance and was never proposed | — |
| **D-P3-4** *(narrowed by §0, still open)* | **Whole-task capture plan shape.** The owner's direction requires the capture commands and artefacts to be specified (they are: §7.1) and any change to an **existing** capture plan to be identified separately from the new plan (it is: §7.2). The remaining choice: (a) add one `udg-003` task-level plan key while the Phase 1 and Phase 2 plan entries stay byte-identical and keep being captured — the draft's proposal; or (b) re-label the existing `udg-003` plan, which **is** a change to an accepted plan and must be named as such besides the new key. Either way the Phase 2 §8.2.1 mislabelling rules bind and accepted bundles keep verifying (U2-1) | it edits accepted evidence machinery |
| ~~D-P3-5~~ **Answered at publication (§0)** | **The repeatability check for W-A is now defined, not proposed**: ten consecutive passes of the affected cases under a declared load and test order, plus a first-attempt green hosted run on the exact submitted commit; a targeted reproducer or failing control per defect fixed; and where an original failure cannot be reproduced, a report of what the retained evidence establishes before any change is proposed. Full statement: §6.5. §19.2's rule stands beside it: fix the cause, never rerun away a failure | — |
| ~~D-P3-6~~ **Answered at publication, with scope (§0)** | **Harness grant G-P3-2 is granted but bounded** to **instrumenting, and fixing, a demonstrated cause** in the accepted test-only harness (`impairment.mjs`, `impairment.d.mts`, `recovery.ts`, `transport.mjs`). The demonstration (§6.2 steps 0–3 and the §6.5 reproducer) precedes the edit; exploratory changes to accepted harness material are outside the grant | — |
| ~~D-P3-7~~ **Reconfirmed at publication (§0)** | **D4 stays open**: existing store only; no archive, tag, release or second destination | — |
| ~~D-P3-8~~ **Reconfirmed at publication (§0)** | **Non-goals stand**: Gate A **Not Run**, GA-11 not evaluated, production tuning and any compatibility claim outside this assignment, dedupe-triggered closure **disabled**, no dependency pin moves, no protocol/config-value changes (the provisional envelope values stay provisional) | — |
| **D-P3-9** *(new, opened by §0)* | **Approve the declared load and test order** for the ten-run repeatability check as §6.5 states them — the declaration is written before the streak runs, not chosen by it | it fixes the conditions the W-A evidence will be judged under |

**Still open after the §0 directions: D-P3-1 (assignment and re-pin), D-P3-4 (capture plan shape), D-P3-9
(declared load and order).** Nothing else in this draft awaits an owner ruling, and the draft answers none of
the three.

Closed prerequisites (verified, not re-asked): UDG-001 **Verified**, UDG-002 **Verified**, UDG-003 Phases 0–2
accepted as scoped, ADR-0003 accepted (and §3.2 amended), P03 adopted, UDG-004 **accepted** — which was the
D-004-10 sequencing condition for Phase 3's shared-file work and also raised the `W-7` stakes.

## 5. Proposed file grants (the shape of the assignment record's §4)

### 5.1 Owned paths (new or extended by Phase 3)

| Path | Disposition |
| --- | --- |
| `tests/system/udg-003-phase-2/runtime.test.ts`, `tests/runtime/udg-003-phase-2/impairment-population.ts`, `tests/runtime/udg-003-phase-2/recovery-scenarios.ts` | W-A only — the diagnosis-selected fix and its regression assertions; every other assertion in these files stays byte-identical |
| `tests/support/client-harness/impairment.mjs`, `impairment.d.mts`, `recovery.ts`, `transport.mjs` | W-A only, under grant **G-P3-2**, bounded by the §0 direction to **instrumenting and fixing a demonstrated cause** — the demonstration (§6.2, §6.5) precedes the edit; no deadline, ladder, allowance or close-code value moves |
| `tests/system/udg-003-phase-3/**`, `tests/unit/udg-003/**`, `tests/integration/udg-003/**` | W-B task-level abuse/offender/buffer-depth suites and producers |
| `artifacts/udg-003-phase-3/**` (gitignored) | Phase 3 vectors; only SHA-256 digests are committed in records |
| `docs/contracts/assignments/UDG-003-phase-3.md`, `UDG-003-phase-3-completion.md`, `UDG-003-completion.md`, `UDG-003-evidence.json`, `UDG-003-phase-3-evidence-matrix.md` | the assignment record (at assignment), this phase's and the task-level completion records with their matrices |

### 5.2 Controlled paths, with the grant

| Grant | Path | Limited to |
| --- | --- | --- |
| G-P3-1 | `tools/checks/src/evidence.ts` | W-C capture plan only, **append-only** (M-2); accepted plans byte-identical; accepted bundles keep verifying |
| G-P3-3 | `.github/workflows/ci.yml` | W-C steps appended (M-3); no renumbering, no `continue-on-error`, `retries: 0` untouched (M-7) |
| G-P3-4 | `docs/contracts/checksums.json`, `docs/integration/dependencies.json`, `pnpm-lock.yaml` | regenerated by command in the landing commit (**M-4**); **no pin move is in scope** — a needed pin change stops and escalates |
| G-P3-5 | `tests/contracts/UDG-003.test.ts`, `tests/probes/colyseus-server.probe.ts` | task-level assertions over the new artefacts; Phase 1/2 assertions keep passing in intent |
| G-P3-6 | `docs/contracts/UDG-003.md`, `README.md`, `docs/contracts/adoption.md`, `docs/integration/colyseus-0.18-api-map.md`, `docs/integration/README.md`, `docs/integration/dependencies.json` | status truth and records (W-E) — adoption entries and acceptance lines are written on the owner's instruction, not by the implementer |

### 5.3 Not granted

`apps/server/src/authority/**` (accepted Phase 1); `apps/client/**` (UDG-008); `packages/protocol/**`,
`packages/config/**`, `docs/contracts/protocol-v1.md` (no wire or config change belongs to Phase 3 — one is a
finding to escalate, not to accommodate); `apps/server/src/**` beyond nothing (no production server change is
planned; if W-A's diagnosis lands on a production path it stops and escalates under the ADR procedure);
`docs/specifications/**`; any accepted completion record, retained bundle or historical inventory version;
any storage location, release, tag or archive (D4). Phase 1/2 escape-hatch prohibitions continue verbatim:
no `any`/`@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`/`eslint-disable`, no non-null assertions, no
`as unknown`/`as never`, no private SDK access, `skipLibCheck` confined to the two ADR-0002 projects.
**Specifically added for W-A:** no retry, no `.skip`/`.only`, no quarantine, no widened deadline, no exact
assertion softened into an existence check — [Phase 2 §7](UDG-003-phase-2.md) discipline binds in full.

## 6. The `W-7` / `P-2b` defects: smallest reproducible diagnosis and fix

Per the owner's §0 direction these are **two symptoms, treated as potentially separate defects**: one W-A
record, two diagnoses, two fixes if the evidence says two. Nothing may be inferred from the shared file name.

### 6.1 The recorded evidence (what the failed runs actually say)

Nine reds across seven hosted runs — `43770588357`, `43775706274`, `43852121401` ×2, `43871936471`,
`43893238010`, `43908313142` ×2, `43918220690` — every green arriving on a **later attempt of the same run**,
and several identical-code pairs (red run `43775706274` vs the green head it byte-matched) that separate
nondeterminism from regression. The observed shape per
[UDG-004-completion](UDG-004-completion.md):

- the message is `expected 1 to be +0`, in `tests/system/udg-003-phase-2/runtime.test.ts > W-7: the 4000 ms
  episode deadline expires with no fresh snapshot, and the three limits stay distinct`;
- the red step **moves**: the job's own `pnpm test`, then UDG-004's capture `test` step, then UDG-003's own
  capture, then UDG-002's capture, then UDG-001's — the first capture of the sequence, aborting every bundle
  after it. What moves with it is only the **load around the probe**, never the code;
- the test body takes 6 ms because it only reads `transport-impairment.json`; the sensitivity lives in the
  live-transport probe that produced it (`tests/runtime/udg-003-phase-2/impairment-population.ts`), whose
  episode case (`ep`, the case added at the eighth sitting) measures counters across a real-WebSocket,
  wall-clock-deadline silence produced by `silenceInbound()`;
- the sibling symptom `P-2b` in the same file (`expected 'seat reservation expired.' to match /token/i`) failed
  once in a Linux container and went green on the immediately following run with **no file changed** — an
  ordering race between reconnect and server-side seat retirement.

### 6.2 The smallest reproducible diagnosis (step 0, then three steps, in order)

0. **Separate the defects before touching anything.** W-7 (nine hosted reds, `expected 1 to be +0`) and P-2b
   (one container-local red, `expected 'seat reservation expired.' to match /token/i`) are recorded separately,
   diagnosed separately, and each gets its own §6.5 repeatability run. A fix for one may not claim the other.
1. **Identify the exact failing assertions from retained bytes, not inference** — the owner's direction, and
   the first deliverable of W-A. The retained bundles and run logs of the nine reds
   (`logs/test.stderr.log` in `/workspace/udg-evidence/ci-run-<id>/`, plus the hosted attempt logs) carry the
   failing `expect` line. The W-7 test contains several `toBe(0)` assertions on probe-measured counters —
   `deliveriesReachingTheSeatDuringTheEpisode`, `stateApplicationsDuringTheEpisode`, `recoveryEvents`,
   `ladderAttemptsAfterClose`, `allowanceRefusedEventsBeforeClose`, `transportSendsObservedAfterClose` — all
   of which print `expected 1 to be 0`. W-A's first record is a table naming **which counter moved on which
   retained attempt**, per defect. **If the retained bytes cannot identify the assertion on some attempt, that
   is reported as what the evidence does and does not establish — before any change is proposed** (§6.5).
   No fix is proposed before that table exists; assuming it is the delivery counter is exactly the inference
   the Phase 2 §7 discipline forbids.
2. **Deterministic extraction, then load.** Extract the `ep` episode case (and P-2b's reconnect seat) behind a
   standalone entry point on the probe, and run it in a loop (30–50 iterations) in three environments:
   (a) alone; (b) with the full `pnpm test` file order — because the probe's counters are read while the rest
   of the suite contends for the same event loop; (c) with a background CPU-load process approximating the
   CI job's chromium install + browser suite, which the UDG-004 record measured as the rising contributor.
   Instrument only observations, never behaviour: timestamps of each `onmessage` arrival against
   `silenceInbound()`, wrapper counter snapshots sampled immediately at silence entry and at close, and — for
   P-2b — the server-side seat-retirement order against the reconnect request.
3. **Name the mechanism.** The candidate set the code exposes, cheapest first:
   - a wrapper counter **sampled outside the same synchronous block as `silenceInbound()`** — the wrapper
     gates delivery at fire-time, but a baseline sampled earlier counts a pre-silence arrival as an
     episode-window arrival;
   - an inbound message already inside the wrapper's jitter queue when silence began, crossing the boundary
     between check and fire;
   - a **post-close** ladder/policy event surfacing into a poll (`until`/`sleep(400)`/`sleep(1200)` windows)
     after the close-time snapshot was taken, moving an after-close counter to 1 under runner delay;
   - P-2b: reconnect racing server-side session retirement, so the seat is refused for retirement rather than
     for the token — an ordering fact that must be pinned on one side, not raced.

### 6.3 The fix, chosen by the diagnosis, minimal by construction

Per defect, one of — and only after the cause is **demonstrated** (§6.2, §6.5); the harness grant G-P3-2
reaches no further than instrumenting and fixing that demonstrated cause:

- **make the silence boundary atomic**: have `silenceInbound()` return (or the harness capture) the counter
  snapshot **in the same synchronous block** that sets the flag, and compute the episode delta from that
  snapshot — measurement placement only, one block moved;
- **gate the queue at enqueue, not fire**: if a jitter-queued message can cross the boundary, count it at
  enqueue time; the wrapper's documented meaning ("what the seat was actually told") is unchanged;
- **freeze after-close counters at the close event**: assert on the event-time snapshot rather than on a
  later poll that a contended runner can fill with a late, already-scheduled ladder tick;
- **P-2b**: take the refusal from the side that owns the ordering — assert the SDK refusal string and the
  server retirement record as two ordered observations with the order pinned, as the eighth sitting did for
  GA-7's closure race by giving that seat its own room (`regionGa7`) — the same precedent applies if the
  diagnosis shows sibling publishers delaying the ep seat.

**Why this preserves the deadline and recovery guarantees.** Every candidate moves *where a counter is read*,
never *what the policy does*. The values under test — the 500 ms snapshot deadline, the 4000 ms episode
deadline, two rejoins per rolling 60 s, `closureWindowMs = 250`, `closureMaxMs = 1000`, close codes 4100/4101/4102 —
are untouched, still the provisional test settings ADR-0003 adopts, still Gate A's to measure for production.
The three-limit discrimination map (`episode-deadline` / `allowance-exhausted` / `deadline`), every
`ep.controls` entry, the GA-6a/6b/6c/GA-7 controls (13/13 in `transport-impairment.json`) and the pinned
close-reason `toEqual` in the runtime test all stay and must stay green after the fix — the fix's regression
assertion is precisely that nothing in the recovery machine changed while its instrumentation became
deterministic. Historical bundles are not re-measured: the accepted Phase 2 artefact keeps its bytes; the
corrected probe produces new ones.

### 6.4 When it lands — inside Phase 3, as W-A, and gated on it

**Not before Phase 3.** A pre-phase micro-batch would edit accepted Phase 2 harness material outside any phase
grant G-P3-2 as bounded at §0), produce evidence outside the whole-task capture plan (W-C), and repeat the pattern the repo has
avoided every time — repair batches have so far landed **inside** an owning, assigned phase. **Inside Phase 3:**
the defect sits in the exact files Phase 3 must touch anyway (abuse suites, capture plan, CI), it is blocking
UDG-003's own path to Verified (§19.2: flaky tests block verification), and its interim option (ii) — keep
rerunning — is measurably degrading: three of the seven runs took the red into a sibling task's capture.
Consequences: the Phase 3 submission gate is the defined repeatability check of §6.5 — **no
"green-after-a-rerun" ever counts** — every earlier red retained and named the way UDG-004's record retained
these; and until the fix lands, the rerun-and-record discipline stays exactly as UDG-004's acceptance round
practised it: **failures stay visible** (§0).

### 6.5 The repeatability check (owner-defined at §0; replaces the draft's proposed N)

For **each** defect (W-7 and P-2b separately):

1. **A targeted reproducer or a failing control.** Either a deterministic reproduction of the recorded failure
   (a scripted run that lands the recorded red), or a control that fails on the unfixed tree and passes on the
   fixed one under the declared load. "Passes more often now" is not a fix and does not open the gate.
2. **Ten consecutive passes of the affected cases under the declared load and test order.** The declaration —
   proposed here for approval as **D-P3-9**, written before the streak runs and not chosen by it — names:
   the affected cases (`W-7` and `P-2b` in `tests/system/udg-003-phase-2/runtime.test.ts` with their probe
   producers); the file order (the full `pnpm test` order as resolved by the pinned vitest config, since the
   contention *is* the environment under test); and the load (the §6.2 step-2 background CPU-load process
   approximating the CI job's chromium install + browser suite, with its command and machine class recorded in
   `environment.json`).
3. **A first-attempt green hosted run on the exact submitted commit.** The submitted head must go green on
   hosted CI on attempt one, with the same full command set as §7. Any earlier red of that commit is retained
   and named in the completion record.
4. **When the original failure cannot be reproduced:** W-A first publishes what the retained evidence
   establishes — the §6.2 step-1 table, the attempt logs, the identical-code red/green pairs, the load
   correlation — and what it leaves open, **before** proposing any change. A change proposed against an
   unreproduced failure must name which retained fact it is justified by, and a proposed change that only
   suppresses the symptom is out of grant: the grant reaches instrumenting and fixing a **demonstrated**
   cause, nothing else.

## 7. Required commands, capture commands and artefacts at submission

### 7.1 Commands

`pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm build`,
`pnpm --filter @udg/server build:probes`, `pnpm --filter @udg/server typecheck:probes`,
`pnpm run declarations:strict`, `pnpm dependencies:verify`, `pnpm test:boundaries`, `pnpm test:fixtures`,
`pnpm test:contract -- --task UDG-001`, `pnpm test:contract -- --task UDG-002`,
`pnpm test:contract -- --task UDG-003`, `pnpm test:contract -- --task UDG-004`, `pnpm test:e2e -- --suite camera`,
`pnpm test`, `pnpm contracts:checksums`, `pnpm evidence:probes`,
`pnpm evidence:capture -- --task UDG-003`, `pnpm evidence:verify` — the last four over the whole-task plan; plus
the M-6 second-lander set on the integrated head (**D-P3-2, answered at §0**: `--task UDG-003`, `--task UDG-004`
and `test:e2e -- --suite camera` re-run on the merged head before submission, per M-5).

**Whole-task verification — required capture commands and artefacts (owner direction at §0).**
`pnpm evidence:probes` then `pnpm evidence:capture -- --task UDG-003` (the whole-task plan), and
`pnpm evidence:verify` over **all four** bundles taken on the run — UDG-001, UDG-002, UDG-003 and UDG-004 —
each PASS with 0 issues (the E-6-style cross-verification UDG-004's acceptance used). The UDG-003 bundle must
contain: `report.json`, `environment.json`, `commands.json`, `junit.xml`, `checksums.sha256`, `logs/`, the
**Phase 1 vector set (15 artefacts + manifest)**, the **Phase 2 set (27 artefacts + manifest)** and the Phase 3
set with its manifest; `probes/probe-run-index.json` and the probe invocation ledger; the task contract's named
artefacts — `ticks.jsonl`, `inputs.jsonl`, `buffer-depth.csv`, `abuse-results.json`, `api-map.md`,
`room-lifecycle.json`; the W-A diagnosis record's streak evidence (§6.5) with its declared load; and the
baseline attribution the Phase 2 §6/§8.2.1 discipline requires (each artefact labelled with the baseline and
phase it belongs to).

### 7.2 Changes to existing capture plans, identified separately (owner direction at §0)

| Plan | Disposition under W-C |
| --- | --- |
| `udg-001`, `udg-002`, `udg-004` plans | **No change.** Entries byte-identical (M-2); their bundles keep verifying on the Phase 3 run |
| `udg-003` phase-1 and phase-2 plan entries | **No change proposed** — the draft's option (a): the required-phase artefacts keep being captured and gated inside the whole-task bundle while the existing entries stay byte-identical, including their pinned `thresholds`/`reportProse` strings (M-2, U2-1) |
| **new** whole-task `udg-003` plan key | The only intended addition: one key appended at the end of `CAPTURE_PLANS`, gated by the tool so a missing, empty, altered or unattributable artefact fails the capture |
| If the owner instead chooses option (b) — re-labelling the existing `udg-003` plan | That **is** a change to an accepted plan and must be recorded as such, separately from the new key, with the moved strings quoted old-and-new in the completion record (**D-P3-4** stays open until one of (a)/(b) is ruled) |

A command that cannot run is reported unable with its error; a zero-test run, a skipped suite or an empty
vector directory is not evidence.

## 8. Evidence requirements

Bundles to the **existing store only** (D4 open); sanitisation and machine-path rules unchanged; Phase 3 vectors
gated by the tool, digests committed; the bundle names its baseline and its phase label per W-C; the Phase 1
(15) and Phase 2 (27) sets keep being captured and gated beside Phase 3's; the task contract's named artefacts —
`ticks.jsonl`, `inputs.jsonl`, `buffer-depth.csv`, `abuse-results.json`, `api-map.md`, `room-lifecycle.json` —
present, parseable and attributed; UDG-001, UDG-002 and UDG-004 bundles verify PASS 0 issues on the same run
(E-6-style cross-verification); W-A's diagnosis record ships with per-attempt tables and retained red-run
links; no bearer/reconnect tokens, no private machine paths, no credentials. A criterion with a missing,
unverifiable or non-replayable artefact is FAIL, not "not run".

## 9. Submission and non-claims at publication

Submission is **In Review**; acceptance is the owner's alone and, if given at task level, is the record that
makes UDG-003 **Verified** — Gate A still **Not Run**, still UDG-SPIKE-001's to run after its own prerequisites.
Explicit non-claims right now: nothing is started; Phase 3 is **unassigned**; this draft assigns nothing, grants
nothing, moves no digest, closes no decision, and changes no status line — D4 **open**, dedupe-triggered closure
**disabled**, Part B **unadopted**, `stackCompatibility` **not-established**, and the `W-7` defect still red on
a bad day and still owned here.
