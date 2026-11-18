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
