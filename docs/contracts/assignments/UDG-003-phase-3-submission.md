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
| Submitted head | the records commit that carries this file; the follow-up records commit that reports the hosted attempt names it, and it differs from this one by records only |
| First-attempt hosted CI on the submitted head | **in flight at the time of writing** — reported by the follow-up records commit, unedited, whatever it says |

**Difference between the streak tree and the submitted head.** `git diff --name-only 142b08097a42 <submitted head>`
lists only files under `docs/contracts/`: the retained W-A streak bytes, this record, the W-A §8 append and
the status surfaces §7 names. No source, test, tool, plan or workflow file differs, so the ten iterations and
the hosted attempt describe the same implementation.

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
* **Runtime, measured against the estimate that travelled with the assignment** (job 24.6 min, capture step
  16.6 min over four plans, estimate ≈4–5 min added, expected job ≈29–30 min):
  hosted delta: **reported by the follow-up records commit**, because the honest number comes from the run,
  not from this file's optimism.

  Measured locally instead, and labelled as local: the whole-task capture ran end to end twice at **3 m 34 s**
  (`pnpm evidence:capture -- --task UDG-003-TASK`), the same order as the phase capture's command set, which
  is inside the ≈4–5 min the assignment estimated. The Phase 3 vectors CI step adds a further vitest run plus
  a gate over six artefacts.
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
| `pnpm test:contract -- --task UDG-004` | reported in the follow-up records commit, run at the submitted head with a fresh browser result |
| `pnpm test:e2e -- --suite camera` | **8 passed** (orbit bounds, zoom clamps, UI gesture exclusion, pose immutability, mount/unmount resource leak, keyboard) on the integrated head |
| `pnpm test` | the five container reds named in §6.4 and nothing else; `W-7`, `P-2b`, the W-A falsification controls and the W-C refusal suite all pass |
| `pnpm evidence:capture -- --task UDG-003-TASK` | runs end to end in 3 m 34 s and produces the whole-task bundle; verification reports only the container's own reds and the dirty-tree refusals that a clean CI checkout does not have |
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
3. **The camera suite was not run locally** (this container has no Chromium); it runs in the hosted job, and
   the D-P3-2 requirement to re-run it on the integrated head is satisfied there, not here.
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
