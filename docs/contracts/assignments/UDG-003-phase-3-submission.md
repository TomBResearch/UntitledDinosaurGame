# UDG-003 Phase 3 — implementation submitted for review

**State: submitted — In Review.** Implementer: **Pi**. Reviewer and integration owner: **TomBResearch**.
Acceptance is the reviewer's act; nothing in this record accepts, closes or gates anything. Gate A is
**Not Run**, deduplication-triggered closure stays **disabled**, decision **D4 stays open**, and no archive,
tag, release or second evidence destination was created.

| | |
| --- | --- |
| Assignment | [`UDG-003-phase-3.md`](UDG-003-phase-3.md), assigned at `e58f32ce…`, records closed at `66963eb2…` |
| Pinned implementation baseline | `eafe306578b64be37e6fd93a8b9f301ab3e43cf6` (CI `43965274365`, success) |
| `main` at the start of the work | `66963eb2b08d3f9cd501342db7f7784864e61f1a` — the records commit itself, so there was no diff to report before starting |
| Tree the ten W-A iterations ran on | `142b08097a4210378e68a8420409a5aaedf468ac` |
| Submitted head | `f3d30626525688e8971c8c393552c91c9624d032` — the commit that carries the W-A evidence and this record |
| First-attempt hosted CI on that head | [run `44183269571`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44183269571) — **completed / success, first attempt**, 30 steps, zero failures, zero skips: `https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44183269571` |
| Records follow-up | `6061145b419f` — records only — and its own run, [`44191978254`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44191978254), **went red**: §8 |
| Head after the fix | the commit carrying this file adds a test-only fix for the amplification defect that run exposed (§8.2), plus a pinned 96 KB fixture; it changes no assertion, no plan, no tool behaviour |

**Difference between the streak tree and the submitted head.** `git diff --name-only 142b08097a f3d3062652`
lists exactly seven files, all of them records: the retained W-A streak bytes, the W-A diagnosis with its §8
append, this record, the three status surfaces §7 names, and `checksums.json` regenerated for them. **No source, test, tool, plan or workflow file differs between the tree the ten
iterations ran on and the head the hosted attempt ran on.** The implementation itself is `142b08097a`, and
`31db05b`/`c26b83d`/`8e0c343` are its earlier commits.

---

## 1. W-A — `W-7` and `P-2b`, diagnosed separately, **no harness change applied**

Full record: [`evidence/UDG-003-phase-3-wa-diagnosis.md`](evidence/UDG-003-phase-3-wa-diagnosis.md).

* **No probe, harness, fixture or accepted assertion was changed.** Not one deadline (500 ms snapshot,
  4 000 ms episode), not the rolling rejoin allowance, not one close code (4100/4101/4102), not one accepted
  assertion. The grant allows a fix only to a **demonstrated** cause; neither cause was demonstrated.
* **What was established, per defect.** `W-7`: the counter UDG-004's record attributed the recorded
  `expected 1 to be 0` to has **no reachable path to `1`** in the code as written (the baseline sample and the
  silencing are synchronous, and a swallowed publication never increments `inboundDelivered`), so that
  attribution is refused; the counters in the same case that *can* move are the post-close ones, and the case
  observes them through a polling window that cannot tell a pre-close event from a post-close one. `P-2b`: the
  two refusal texts are **two different server-side gates of the same rejoin** (`MatchMaker.mjs:151` and
  `Transport.mjs:130`, re-checked at connect by `Room.mjs:449`), so pinning one wording pins which gate
  answered first. Both findings are mechanism analysis; neither is an observed reproduction, and neither is
  written up as a cause.
* **What the retained evidence says about the five unclassified hosted reds.** Nothing. No `ci-run-*`
  directory in the store holds a junit or an impairment artefact from any of those attempts, and the runner
  logs are not readable without the owner's credentials. They stay **unclassified**; §1 of the diagnosis
  record is where that is stated rather than smoothed over.
* **Instrument delivered instead.** `tests/system/udg-003-phase-3/wa-assertion-audit.ts` re-evaluates the
  **84 assertions** of the two accepted cases one at a time, and
  `tests/system/udg-003-phase-3/wa-audit-falsification.test.ts` (in the suite, so it runs in CI) proves the
  audit can fail, once per defect. The accepted artefact audits `84/84`.
* **Declared before the run.** `docs/contracts/assignments/evidence/UDG-003-phase-3-wa-declaration.json`:
  test order `pnpm test` with the two cases in place, load four busy-spinner processes, ten consecutive passes
  scored per case id. The declaration was **amended before the first evidential iteration** — the case ids
  named the wrong `describe` block and the retained-file name was wrong — and the amendment, the two mechanics
  pilots it invalidated, and one aborted streak attempt that was started on a dirty tree and killed at
  iteration 1 are all recorded in §7 of the diagnosis record. None of those runs is counted.
* **The ten iterations, and the truth about their suite exits.** `W-7` **10/10** consecutive passes and
  `P-2b` **10/10** consecutive passes, scored per case id out of each iteration's own junit, with the 84-assertion audit
  clean in all ten, on `142b08097a42`, between `2026-11-17T21:19:45.242Z` and `2026-11-17T21:38:38.217Z`.
  Retained: `artifacts/udg-003-phase-3/wa-streak/` (per-iteration junit, per-iteration audit) and
  [`evidence/UDG-003-phase-3-wa-streak.json`](evidence/UDG-003-phase-3-wa-streak.json).
  Every iteration exited non-zero. Seven cases were red: five because this container is not the pinned toolchain and
  has no committed browser result, and two — `runs the adversarial population … (W-10, W-9)` and the Phase 2 vectors
  assertion that follows its verdict, in **9 of 10** — because the declared load itself breaks the population
  probe's pressure premise (defect WA-4). The full table, and why an exit-code streak would have recorded zero
  passes for both defects while both passed every time, is §8 of the diagnosis record.

## 2. W-B — the task-level abuse, offender and buffer-depth reading

Implemented in `tests/unit/udg-003/task-vectors.test.ts` against artefacts the **same run** produced, and
published as `vectors-phase-3/task-abuse-summary.json`:

* `task.bufferHighWater` / `task.bufferBound` — the client transport buffer from `buffer-depth.csv` against
  the declared cap of 32, with the authority queue named as a different queue the two numbers must not be
  compared with;
* `task.offendersClosedAttributed` / `task.compliantSeatClosures` / `task.observerIsolation` — read from the
  room's own closure list in `room-lifecycle.json`: every closure is 4100 or 4101, attributed to an offender
  entity, and a compliant seat that had been closed would appear as a closure outside that pair;
* `task.abusePopulationVerdict` — the accepted population verdict, carried so a red says which probe it
  arrived in rather than surfacing only as a bundle failure.

**Outstanding, and not closable here:** the discrete 1 MiB / 60-second half of the buffer bound needs the
server-side encoder that does not exist at this task; it stays with **UDG-007** (§8.2.2), and
`task-abuse-summary.json` names it in `outstandingWithUdg007` rather than counting it.
`defect WA-4`, recorded in the diagnosis record §6, is a premise defect in the accepted pressure scenario
found while doing this work; it is disclosed, not fixed, because the scenario is accepted Phase 2 evidence.

## 3. W-C — the whole-task capture, and what it cost

* `CAPTURE_PLANS` gained a **second selector key `UDG-003-TASK`**, appended at the end. The accepted `UDG-003`
  phase plan is untouched — its label, thresholds, prose, manifests and command list are byte-identical, and
  `tests/contracts/UDG-003.test.ts` (105 tests, including the digest and phase-pairing assertions) passes
  unedited.
* The collector resolves the measurements file by selector key with a **fallback to `plan.taskId`**, and
  `commands.json` declares `plan.taskId` with the selector recorded beside it as `captureSelector`. For every
  accepted plan the two strings are equal, so accepted bytes are unchanged.
* Verification selects a bundle's plan **from what the bundle declares** (`planForBundle`): `phase: "task"`
  resolves to the whole-task plan, everything else — including unlabelled historical bundles — resolves
  exactly as before. A renamed or copied directory cannot choose a friendlier plan because resolution never
  reads a path.
* The vectors gate now **refuses an unknown `--expect-phase`** instead of defaulting to the Phase 1 list. The
  accepted assertion that pins the two-phase selection text still passes; an unknown phase exits `2`.
* CI needed no capture-loop edit: the loop iterates `evidence.js plans`, which now lists
  `UDG-001 UDG-002 UDG-003 UDG-003-TASK UDG-004`. A dedicated step
  (“Record and gate the UDG-003 Phase 3 task vectors”) was added beside the Phase 1 and Phase 2 steps, so a
  broken Phase 3 set is a named red rather than a capture-time surprise. From this commit onward a run in
  which the whole-task bundle is absent is red by design.
* **Refusals proven** (`tests/unit/udg-003/task-capture-refusals.test.ts`, 11 tests): a task-labelled bundle
  resolves only to the task plan; every other label resolves to the phase plan; removing the task plan leaves
  the phase plan whose label then mismatches; the plan requires all three vector manifests and the task
  measurement block; and the gate refuses a short set (`VECTORS-FILE-MISSING`), tampered bytes
  (`VECTORS-FILE-HASH`), an unknown phase and an absent manifest.
* **Historical preservation, measured rather than promised.** All **142** bundles visible in
  `/workspace/udg-evidence` were verified with HEAD's verifier and with this branch's verifier:
  **identical outcomes** — 112 PASS, 30 FAIL. The 30 failures are the pre-existing ones (the Phase 1-era
  bundles whose requirement moved when W-11/W-12 amended the phase plan); the newest bundle of each task —
  UDG-001, UDG-002, UDG-003 `phase-2`, UDG-004 — verifies **PASS 0 issues**. The two listings are retained at
  [`evidence/UDG-003-phase-3-verify-baseline-head.txt`](evidence/UDG-003-phase-3-verify-baseline-head.txt)
  and
  [`evidence/UDG-003-phase-3-verify-baseline-phase3.txt`](evidence/UDG-003-phase-3-verify-baseline-phase3.txt).
* **Runtime, measured against the estimate that travelled with the assignment — and the estimate was low.**
  Baseline (run `43965274365`): job **24.6 min**, capture step **16.6 min** over four plans. Estimated here:
  +4–5 min, job ≈29–30 min. Measured on the submitted head, run `44183269571`:

  | | baseline | measured | delta |
  | --- | --- | --- | --- |
  | job | 24.6 min | **34.6 min** | **+10.0 min** |
  | `Capture the evidence bundles` (five plans now) | 16.6 min | **25.1 min** | **+8.5 min** |
  | `Record and gate the UDG-003 Phase 3 task vectors` | — | 0.1 min | +0.1 min |
  | `Verify the captured evidence bundles` | 0.5 min | 0.5 min | unchanged |

  The added plan costs about **8.5 hosted minutes**, roughly **twice** the estimate, and the reason is
  structural rather than accidental: the whole-task bundle re-runs what the phase bundle already ran — the full
  `pnpm test`, all seven Phase 2 room producers, the Phase 1 vectors and the Phase 2 vectors — because those
  bytes have to exist inside *this* bundle to be hash-covered by *this* manifest, and then it adds the Phase 3
  set and three gates. On this container the same capture takes 3 m 32 s; the hosted runner is a fourth of the
  cores. Cheaper variants exist (carry the accepted phase vectors by digest from the phase bundle instead of
  re-producing them, or drop the duplicated producers) and none is taken here, because each one changes what
  the bundle is a claim about — that is a reviewer's decision, not a speed-up to slip in.
  Locally, the whole-task capture ran twice end to end in **3 m 34 s** each (`pnpm evidence:capture -- --task
  UDG-003-TASK`), against a phase capture measured earlier at about the same order; the local figures are not
  the hosted ones and are labelled as local.

## 4. W-D — what the task now claims, and what it still does not

`vectors-phase-3/task-attribution.json` and `task-non-claims.json` carry this as gated bytes:

* the config-hash era: `948f8c10142239a2f3118795e8afa71a749ed09b316961b671d9b915d024cb01` (the pre-Phase-2
  baseline UDG-002 bytes still hash to) → `2743a9a0…` (what everything in this bundle was produced under),
  computed at run time by `computeConfigHash(DEFAULT_SERVER_CONFIG)` rather than pasted;
* the accepted phases, each attributed by its own manifest digest and phase label;
* the carried obligations, unchanged from Phase 2: **GA-10a, GA-10b** and the navigation-result half of
  **AC-6** plus the discrete queue limits → **UDG-007**; the production client, both recovery paths and the
  prediction buffer → **UDG-008**; **GA-11**, formal GA-6/GA-7 execution, **GA-12**, **PE-1…PE-5** and formal
  **Gate A** → **UDG-SPIKE-001**;
* the non-claims: Gate A/B/C Not Run, GA-11 not evaluated here, `stackCompatibility` not-established,
  dedupe-triggered closure disabled, D4 open, and the task In Progress until the reviewer accepts it.

**No acceptance criterion moved status in Phase 3.** Phase 3 added an instrument, a task-level reading and a
capture; it fixed no defect and passed no gate. The ledgers in
[`UDG-003-phase-2-completion.md`](UDG-003-phase-2-completion.md) §“What is still owed, and by whom” and in the
[evidence matrix](UDG-003-phase-2-evidence-matrix.md) stand as written — including `AC-1` and `AC-3c` at FAIL,
`AC-6` PARTIAL, and `GA-12`/`PE-1…PE-5` not passed. Re-stateing them as closed would be the exact overclaim
the assignment forbids.

## 5. Commands run on the integrated head (D-P3-2, the shared-tooling turn)

Run on the integrated head, after the streak and after the records commit:

| Command | Result |
| --- | --- |
| `pnpm test:contract -- --task UDG-003` | **105 passed, 0 failed** — including the accepted plan-digest, phase-pairing and vector-requirement assertions, unedited |
| `pnpm test:contract -- --task UDG-004` | **24 passed, 0 failed** at the submitted head, with a browser result produced at that same head (the earlier local red was a stale browser artefact from a previous commit, not a defect) |
| `pnpm test:e2e -- --suite camera` | **8 passed** (orbit bounds, zoom clamps, UI gesture exclusion, pose immutability, mount/unmount resource leak, keyboard) on the integrated head, and green in the hosted job too (2.6 min) |
| `pnpm test` | the five container reds named in §6.4 and nothing else; `W-7`, `P-2b`, the W-A falsification controls and the W-C refusal suite all pass |
| `pnpm evidence:capture -- --task UDG-003-TASK` | runs end to end in 3 m 32 s locally and produces the whole-task bundle; locally verification reports two issues — the container's own reds, and three skipped Phase 3 vector tests, which are skipped only because a plain local capture has no earlier Phase 1/Phase 2 vector steps to read. **In the hosted job the same bundle verifies: the `Verify the captured evidence bundles` step is green with all five bundles present** |
| `node tools/checks/dist/evidence.js plans` | `UDG-001 UDG-002 UDG-003 UDG-003-TASK UDG-004` — the CI capture loop picks the new selector up without a workflow edit |

Shared-tooling turn (D-P3-2): the Phase 3 change is the next landing on shared tooling after UDG-004, so
`UDG-004`'s task suite and the camera suite were re-run on the integrated head rather than assumed.

## 6. Unmet criteria and residual risk, unsmoothed

1. **`W-7` and `P-2b` are not fixed.** No cause was demonstrated by observation, so nothing was changed; the
   hosted run can still go red in `tests/system/udg-003-phase-2/runtime.test.ts` for reasons this round could
   not name. What changed is that a future red can be identified from retained bytes instead of argued about.
2. **The mechanism findings are analysis, not reproduction.** If the reviewer wants the two boundary defects
   repaired, the smallest honest version is: name the post-close window `W-7` measures by the close event's own
   timestamp instead of by an event-count delta, and make `P-2b` assert that the rejoin was refused **and**
   record which of the two SDK gates answered. Both edits change accepted assertions, so they are proposed
   here rather than applied in the dark.
3. **Three Phase 3 vector tests are skipped inside a plain local capture**, because on a machine that has not
   just run the Phase 1 and Phase 2 vector steps there is nothing to attribute yet — the suite refuses to
   write a whole-task manifest over a half-run instead of passing quietly. The hosted job runs those steps
   before capture, so nothing is skipped there and the verification step does not report `EVIDENCE-SKIP-PRESENT`
   for them. The behaviour is disclosed rather than papered over, because "skipped" is exactly the word a
   reader should be able to hold this record to.
4. **This container is not the pinned toolchain** (Node `v24.22.3` against a pin of `24.22.2`, and no browser
   results exist here), so five local reds exist that do not exist hosted: the two toolchain-pin assertions,
   UDG-002's measured-threshold and UDG-001-regression assertions that read them, and UDG-004's browser-result
   gate. The authoritative first-attempt result is the hosted one in the header.
5. **Thirty historical bundles do not verify**, identically on HEAD and on this branch; they are outside this
   task's grant (repairing them would mean rewriting accepted history, which D4 and the preservation rules
   forbid).

## 7. Surfaces reconciled at submission (W-E)

`README.md` (two status lines), `docs/contracts/UDG-003.md` (the assignment line, the Phase 1 and Phase 2
status lines that pointed at “Phase 3 unstarted”), `docs/contracts/adoption.md` (the implementation-assignment
paragraph, which still said Phase 3 was not authorised), and `docs/contracts/checksums.json` regenerated for
the covered files. `docs/contracts/assignments/**` is excluded from the manifest, so the retained evidence and
this record need no digest entries.

## 8. What happened after the submission, because a records-only push went red eleven minutes later

### 8.1 The run, unedited

The records follow-up `6061145b419f` — seven document files, no source, no test, no tool — ran as
[`44191978254`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44191978254) and **failed**,
in `Capture the evidence bundles`, and consequently in `Verify the captured evidence bundles`
(`EVIDENCE-GATE-NOT-PASS` on `UDG-004-2026-11-17T23-06-08-302Z-6061145b`).

This time the red was classifiable, because the run's own evidence artifact was downloaded and read rather
than argued about. Three of 644 cases failed, in `UDG-004`'s bundle only; the other four bundles — including
this phase's `UDG-003-TASK` — were clean:

1. **`W-7`, live.** `runtime.test.ts > … > W-7: the 4000 ms episode deadline expires …`, message
   `expected 1 to be +0`. The first hosted sighting of the defect with retained bytes.
2. and 3. **Two Phase 3 controls of this author's own**, both failing because they required the live
   impairment artefact to audit clean — the artefact the accepted `W-7` case had just written red.

Full extraction: [`UDG-003-phase-3-hosted-sighting-run-44191978254.json`](evidence/UDG-003-phase-3-hosted-sighting-run-44191978254.json);
analysis: §§9-11 of the diagnosis record, including the answer to the owner's recurring question — **the whole
suite runs five times per job, once inside each capture plan**, so `W-7` runs five times and lands red in
whichever invocation the timing goes wrong in, here the fifth, inside `UDG-004`'s bundle. A bundle name is not
an owning task.

### 8.2 Defect WA-5, mine, and what was changed

Requiring a *live* artefact to audit clean turns one `W-7` into three reds in three files, two of which read
like capture bugs — an amplification of the defect this phase was sent to diagnose, which the assignment
forbids. Fixed in this head:

* controls moved onto a pinned known-clean artefact (`tests/support/udg-003/wa-audit-clean-artefact.json`,
  from the green run's own bundle, digest asserted in both files);
* the live artefact is still audited, and reported, as a measurement (`liveArtefactAudit` in
  `wa-audit-falsification.json`);
* `tests/system/udg-003-phase-3/wa-no-amplification.test.ts` is the failing control for WA-5: a synthetic
  artefact carrying the exact `W-7` condition must make the **audit** refuse it and must **not** make the
  falsification suite fail — asserted in a child vitest run, both directions;
* three *outcome* assertions were removed from `task-vectors.test.ts` (they re-asserted the accepted
  population verdict over live bytes; the numbers are still written, the derivation is what is asserted);
* the Phase 3 producing tests assert the half-run negative instead of registering skipped tests, so
  `EVIDENCE-SKIP-PRESENT` no longer appears in a local whole-task capture.

Verified locally, in both states of the live artefact — forced to the `W-7` red shape: `156 passed`, nothing
skipped; restored: `165 passed` across the Phase 3 and Phase 2-adjacent files, and `3 passed` in the new
guard. `pnpm test:contract -- --task UDG-003` remains `105 passed`.

One misstep of the same kind, found locally before it left the machine and recorded rather than dropped: the
pinned artefact was first placed under `tests/fixtures/udg-003/`, and `pnpm test:contract -- --task UDG-001`
went red, because every json under `tests/fixtures/` is the UDG-001 fixture registry and its validator
demands a protocol fixture envelope. The artefact now lives at `tests/support/udg-003/`, which is where a
test's support bytes belong, and `UDG-001` is back to the two reds this container always produces.

### 8.3 The state of the submission now

* **Submission evidence stands as §2 records it**: the first attempt on the exact submitted head
  `f3d30626525688e8971c8c393552c91c9624d032` was green, run `44183269571`, 30 steps, zero failures, zero skips.
* The head carrying the WA-5 fix, `b23176c5b7c6` and later, was then run and its **first attempt was green**:
  [`44201132927`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44201132927),
  job **30.8 min**, capture step **19.7 min**, every step success, all five bundles verifying. `W-7` did not
  fire in that job. It is reported here rather than by a further commit, because the records for that head are
  this file and there is no third head to write them into.
* Two hosted data points now exist for the added whole-task plan, against the 24.6 min / 16.6 min baseline:
  **34.6 min / 25.1 min** and **30.8 min / 19.7 min**, i.e. **+6 to +10 minutes on the job** for the fifth
  capture plan, against the ≈4–5 minute estimate the assignment carried. The estimate was low; the spread is
  hosted-runner variance, and the capture step is where all of it lands.
* **Nothing about `W-7` or `P-2b` was fixed**, no accepted assertion, deadline, allowance, close code or
  harness behaviour was changed, Gate A/B/C stay Not Run, GA-11 stays unevaluated, deduplication-triggered
  closure stays disabled, D4 stays open, and the task stays **In Review** awaiting the reviewer.
* One more gap is now named rather than left implicit (§10.2 of the diagnosis): a bundle retains an artefact
  the capture *produced*, not the one the failing case *read*, so the next hosted `W-7` would still arrive
  without its bytes. **W-A-3** is the one-line remedy — point the whole-task plan's `test` command at
  `UDG_VECTORS_OUT: 'BUNDLE/vectors-phase-2-case'`, which the accepted case and its producer already honour —
  and it is proposed for the reviewer to decide, not taken here, because it changes what the accepted case
  does inside a capture.

### 8.4 And then a records-only push went red a second time, for a third reason

`c9c4ed7` — documents only, on top of a green head — ran as
[`44206639883`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44206639883) and failed in
the capture step with `failing commands: phase-2-stage-sequence (exit 2)`: a command of the **accepted**
`UDG-003` phase plan, in the third of five plans, so the whole-task plan was never reached. All 647 cases in
each of the three bundles the run produced passed, including `W-7` and `P-2b`.

The producer's own retained log names what moved: `mappingMatchesTheAuthoritysOwnRecord=false`, with the
authority at 11 patches and the client at 6 when the mid-window sample was taken, alongside
`Room connection was closed unexpectedly (1008)` — a sample-versus-close straddle in an accepted producer, the
same family as `W-7` but a different assertion in a different file. Retained bytes:
[`UDG-003-phase-3-stage-sequence-red-run-44206639883.json`](evidence/UDG-003-phase-3-stage-sequence-red-run-44206639883.json);
analysis: §12 of the diagnosis. Nothing was changed for it, because no cause was demonstrated.

The consequence for the reviewer is the useful part: **the docs-only red family is at least three distinct
defects**, not one flaky suite — `W-7` (§9), this stage-sequence straddle (§12), and the container-local
`P-2b` two-branch wording (§4) — and all three are now nameable from a bundle's own `logs/` and `junit.xml`
in minutes rather than being argued about from a step name.

### 8.5 A third documents-only red, naming post-close containment

Run [`44211208860`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44211208860) — documents
only, on a head whose own run was green — failed the capture step the same way: an accepted producer refusing
its verdict, `phase-2-impairment-population`, because
`noInputReachedTheRoomAfterTheEpisodeClosed=false`. All 647 test cases in each of its three bundles passed.
Retained bytes:
[`UDG-003-phase-3-impairment-gate-red-run-44211208860.json`](evidence/UDG-003-phase-3-impairment-gate-red-run-44211208860.json);
analysis §13 of the diagnosis, which is where the mechanism this names is set against §3.

Nothing in this phase was changed for it. What it adds to the submission is one operational fact a reviewer
should not have to discover: **the whole-task plan is fourth of five in one capture step**, so whenever an
accepted producer in an earlier plan refuses its verdict, the `UDG-003-TASK` bundle is simply absent from that
run — which is a CI ordering question, not a defect in the plan, and is left for the reviewer to decide.

### 8.6 The fourth documents-only red was not a fourth defect: the capture loop threw the evidence away

Run [`44215794779`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44215794779) — documents
only, on the head that recorded §8.5 — failed `Capture the evidence bundles` and `Verify the captured evidence
bundles`. Its retained artifact contains **two** bundles, `UDG-001-…-498d6a9e` and `UDG-002-…-498d6a9e`, and
nothing else: no `UDG-003`, no `UDG-003-TASK`, no `UDG-004`.

The `UDG-002` bundle is the one that failed, and it failed for a reason worth having in bytes: one case out of
644, the accepted `W-7`, `expected 1 to be +0`, at `runtime.test.ts:704:66` —

```ts
expect(ep.snapshotAbsence.stateApplicationsDuringTheEpisode).toBe(0);
```

So the two hosted sightings of `W-7` are now two *different* assertions of the same case in the same silent
window: `702` counted a delivery reaching the seat (`44191978254`), `704` counted a state application
(`44215794779`). That is the shape §3 of the diagnosis predicted and it is the strongest hint yet at the
mechanism — the window stayed shut while something still reached the seat — but it is still a shape, not a
cause, and neither run retained the artefact the case read, so the 83 values around the moved counter remain
unknown. Retained:
[`UDG-003-phase-3-capture-aborted-runs.json`](evidence/UDG-003-phase-3-capture-aborted-runs.json).

Why the other three bundles were missing is not a fourth defect and not a verification complaint. The capture
step runs under `set -euo pipefail` and may not be given `continue-on-error` (`UDG-001` asserts both), so the
inline `for task in …` loop **aborted** the moment `UDG-002`'s bundle recorded a failure, and the plans after
it — `UDG-003`, `UDG-003-TASK`, `UDG-004` — never ran. §8.5 called the whole-task plan's absence "a CI ordering
question, not a defect in the plan". That was wrong in a way that matters: it is a defect in the capture loop,
it is the reason `W-7` stays a guess, and it is the second amplification this phase has had to own (the first
was `WA-5`, §8.2). Recorded as **WA-6**.

### 8.7 The two changes the reviewer directed, implemented

**W-A-3 — the bytes a case read are now retained, bound, and unreplaceable.** The `UDG-003-TASK` plan gained
`test-case-artefacts` immediately after `test`: it copies the four artefacts the accepted case reads into
`BUNDLE/vectors-phase-2-case/` with their own manifest, *before* the plan reproduces Phase 2 and in a directory
the reproduction cannot reach. The manifest declares `readByCommand: test`, `reproduction: false`,
`distinctFrom: vectors-phase-2`, the plan selector and the commit; `test-case-audit` then runs the accepted
audit over the retained bytes with `--report-only`, so a red bundle names the assertion that moved instead of
merely naming the case. Re-running the step over divergent bytes is refused with `CASE-ARTEFACTS-DRIFT`; the
verifier refuses a replaced file (`EVIDENCE-CASE-ARTEFACT-HASH`), a manifest rebound to another commit
(`EVIDENCE-CASE-ARTEFACT-SHA`), an out-of-order recording command (`EVIDENCE-CASE-ARTEFACT-ORDER`) and a
capture that ran the step and retained nothing (`EVIDENCE-CASE-ARTEFACT-MISSING`).

**The capture loop — every plan is attempted, everything is retained, the job still fails.**
`tools/ci/capture-plans.sh` iterates `evidence.js plans` without `set -e` around the captures, names each
bundle it retained, prints each failed plan's failing commands into the step log, and exits 1 if any plan
failed (including the empty-plan case). The workflow step still names `evidence.js plans` and still names the
production invocation, `pnpm evidence:capture -- --task TASK --out artifacts --keep-going`, passed as
`--capture-cmd`.

Demonstration, all local, all retained in
[`UDG-003-phase-3-wa3-local-capture.md`](evidence/UDG-003-phase-3-wa3-local-capture.md):

- a real whole-task capture on `44557349` retained all four case artefacts, and **all four differ from the
  same capture's own Phase 2 reproduction** (`transport-impairment.json` `2eac681513f6` retained vs
  `f062d502cdae` reproduced) — the retained bytes are the invocation's, not a re-production's;
- overwriting the *source* with a clean production cannot replace or mask anything: the step refuses with
  `CASE-ARTEFACTS-DRIFT`, the manifest bytes are unchanged, and the retained artefact still audits red
  (`tests/unit/udg-003/task-case-artefacts.test.ts`);
- the three verifier refusals above were produced against the real captured bundle, not a fixture;
- **preservation**: HEAD's verifier and this branch's verifier were run side by side over all **222** bundle
  directories currently visible in `/workspace/udg-evidence` — **0 differences**, 187 PASS / 35 FAIL, the 35
  being the pre-existing failures. Listing:
  [`UDG-003-phase-3-verify-preservation-head-vs-wa3.txt`](evidence/UDG-003-phase-3-verify-preservation-head-vs-wa3.txt).
  The case directory is deliberately *not* added to any plan's `requiredFiles`, because requirement lists are
  read by the verifier of today and would retro-invalidate bundles captured before W-A-3; the obligation
  follows the command instead.

One accepted assertion had to move, and it is called out rather than buried: `UDG-001` line
`expect(capture?.run).toContain('for task in')` pinned the *iteration* to the workflow step text, which is
exactly the mechanism WA-6 shows cannot work under the accepted `set -euo pipefail`. It now asserts that the
step calls `tools/ci/capture-plans.sh` and that the script — the file CI actually executes — contains the
plan-list iteration, the production capture invocation, `--keep-going`, no `set -euo`, and an `exit 1`. Same
substance, same failure mode, read one file later. Status: **amended by direction, pending review**.

### 8.8 What this changes about the submission, and what it does not

It removes two things the reviewer was being asked to accept on trust: a whole-task bundle that could vanish
without explanation, and a diagnosis of `W-7` that had to be rebuilt by re-running a producer.

It does not resolve `W-7`, the post-close containment refusals of §8.5, or the stage-sequence straddle of §8.4.
No cause has been demonstrated for any of them, so no probe, deadline, retry allowance, close code, refusal
wording or sample boundary was moved — the `W-7` counter is still required to be zero, and the accepted case
still reads the artefact path it has always read. The first hosted run on the implementation commit is what
shows whether a `UDG-003-TASK` bundle now exists on a run where an earlier plan fails, and whether a real
hosted `W-7` arrives with its bytes attached. Neither has happened yet.

Status remains **In Review**. Gate A/B/C **Not Run**, GA-11 unevaluated, deduplication-triggered closure
disabled, `D4` open, `W-7` and `P-2b` unresolved.

### 8.9 First hosted attempt on the two directives: green, with the retained bytes to prove it

Run [`44273118486`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44273118486) — first
attempt on the submitted head `350ff27503bcac1d7a71b943602bb302767483f9` (implementation commit
`3093074c5c8418662b79a517a414f44870f0a54d`; the head adds records only) — **completed / success**, every step
successful, job wall **33.5 min**, capture step **20.2 min** (baseline 24.6 / 16.6). All five bundles
**PASS**, 657 cases, 0 failures each, and the run's own artifact carries:

```
UDG-003-TASK-2026-11-18T09-32-09-680Z-350ff275/vectors-phase-2-case/
  case-artefacts-manifest.json   readByCommand test · reproduction false
                                 captureSelector UDG-003-TASK
                                 implementationSha 350ff27503bcac1d7a71b943602bb302767483f9
  transport-impairment.json 8fb3976ab008   (vectors-phase-2 of the same bundle: 99cdcdb2fbc1)
  abuse-results.json        858777a63c90   (… 47b22a1c08ba)
  room-lifecycle.json       8e6f7acdb154   (… 19c1006cce7c)
  buffer-depth.csv          ee7e68f744fe   (… 51572a9a660d)
  wa-assertion-audit.json   84/84 checks pass, failing: none
```

That is the reviewer's three requirements, satisfied by a hosted run rather than by a test fixture: the bytes
the `test` invocation read are in the bundle, they are bound to that invocation and to this commit, and they
are **not** the capture's later reproduction — one run produced both directories and all four files differ.
`test-case-artefacts` and `test-case-audit` each cost under a second. Retained:
[`UDG-003-phase-3-hosted-green-run-44273118486.json`](evidence/UDG-003-phase-3-hosted-green-run-44273118486.json).

What it does not show, in one sentence each. A green run does not show a red being *diagnosed* — no accepted
case went red in this job, so the retained bytes here are clean ones. A green run does not exercise the capture
loop's failure shape; `tests/unit/udg-003/capture-loop.test.ts` and the missing-bundle shape of `44215794779`
do that. And a green run is not evidence that `W-7` is fixed, because `W-7` was never fixed — see below.

### 8.10 `W-7` has a demonstrated cause for one of its two signatures, and no change was made for it

The diagnosis stopped waiting for another sighting and looked for one that had already been retained. It found
one: `UDG-003-2026-11-14T11-57-52-546Z-81a341fb` (run `43591597910`) carries
`stateApplicationsDuringTheEpisode: 1` with `deliveriesReachingTheSeatDuringTheEpisode: 0` — the exact `704`
signature — and the W-A audit over those bytes reports **83/84 checks pass, the only failing check being
`w7-state-applications`**. Eleven of twelve retained artefacts in the store carry `0 / 0`. Full scan:
[`UDG-003-phase-3-w7-signature-scan.json`](evidence/UDG-003-phase-3-w7-signature-scan.json), argument: §§17-18
of the diagnosis.

The artefact contradicts itself, and that is what demonstrates the cause:
`freshAuthoritativeSnapshotArrived` is computed from `ep.applied.length` at
`impairment-population.ts:861-863` and says *nothing was applied*, while
`stateApplicationsDuringTheEpisode` is `ep.applied.length` evaluated at `:931` and says *one was*. In between
lie `ep.controller.restore()` (`:868`, which takes the impairment wrapper **off** the socket) and
`await ep.room.leave(true)` (`:869`), and in the pinned SDK a `leave(consented: true)` does not set
`leaveCode` — the dispatch guard at `sdk/build/Room.mjs:488` stays open and `onStateChange` keeps firing
(`:611-612`) until the close lands. So the tally can tick after the window it claims to measure, from a frame
the delivery counter can no longer see, about state that is not this seat's (`resolvedThrough` 1→1,
`epoch` 11→11 in the same artefact).

Nothing was changed for it. Three remedies are written out and left as the reviewer's decision — take the
after-sample at `:858` in the same synchronous sample as the counters; move `restore()` after the `leave()`;
record the tail (both readings of all four tallies plus `silencing`) so the next sighting diagnoses itself.
The first two change what an accepted producer records. The `deliveriesReachingTheSeatDuringTheEpisode`
sighting of `44191978254` is **still unclassified**: `deliver()` re-checks `silencing` at delivery time
(`impairment.mjs:142`), so no path in the accepted code produces a non-zero delivery count, and collapsing the
two sightings into one defect would repeat the error this phase has spent four hosted runs correcting.

Status is unchanged: **In Review**, Gate A/B/C **Not Run**, GA-11 unevaluated, deduplication-triggered closure
**disabled**, `D4` **open**, `W-7` and `P-2b` **unresolved**, and the declared W-A repeatability streak stands
on the tree it was run on (`142b080…`), not on this head — if the reviewer accepts any of the three remedies,
the streak must be re-run on top of it.
