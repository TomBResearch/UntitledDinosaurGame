# CI routing proposal — routed checks on every push, full evidence capture on acceptance runs

> **Status: APPROVED, and implemented under this record.** The integration owner (`TomBResearch`) approved
> implementing CI streamlining and amendment **A-P3-8** on 2026-11-18, from records commit
> `b2efee21caca6a4a7fe4be15d6b40e2ae6edd66a` with its CI run **`44332154300`** pinned as the final
> records-only baseline: workflow `ci`, success, job `15:08:36Z → 15:44:09Z` = **35.5 min**, and
> **35.6 min** from push to final step. The decision is recorded in [adoption](../adoption.md) as
> clarification **C-07**, and it authorises controlled-file (CI) work; it accepts no gate and changes no
> task status.
>
> Sections 3 and 4 describe what was built. Two things differ between the first proposal and the
> implementation, and both are the owner's direction rather than drift: **full acceptance is reached by
> explicit `workflow_dispatch` only** in this version (the commit-message trailer route is not implemented),
> and the routed set gained a **`runtime`** group, so a server or test change is shown to *execute* the
> runtime and system suites instead of merely compiling them.
>
> Original request text, retained: this was a controlled-file change proposal and an owner decision request
> (**C-07**, following C-01 … C-06 in [adoption](../adoption.md)). It changes no contract and passes no gate.
>
> This file lives under `docs/contracts/assignments/`, which [`checksums.json`](../checksums.json) excludes, so
> publishing it needs no manifest refresh. The two files it later asks us to edit — `README.md` and
> `docs/contracts/adoption.md` — *are* edition-controlled, so landing the change must refresh the manifest in
> the same commit (`pnpm contracts:checksums -- --write`).

## 1. The finding, in the repo's own numbers

Every push runs `.github/workflows/ci.yml`, one job, which captures and verifies **all five bundles**
(`UDG-001`, `UDG-002`, `UDG-003`, `UDG-003-TASK`, `UDG-004`) whatever changed.

Hosted job wall time, taken from the records already in the repository:

| Run | Head | What changed | Job minutes | Capture step |
| --- | --- | --- | --- | --- |
| `43965274365` | `eafe3065…` | four plans (pre-Phase 3) | 24.6 | 16.6 |
| `44183269571` | `f3d30626…` | Phase 3 submission | 34.6 | 25.1 |
| `44201132927` | — | WA-5 fix | 30.8 | 19.7 |
| `44273118486` | `350ff275…` | W-A-3 + capture loop | 33.5 | 20.2 |
| `44282688256` | — | records | 29.8 | 21.7 |
| `44287836166` | `41934a1…` | records | 27.2 | not recorded |
| `44299429735` | `74aa8dab…` | accepted W-7 repair | 31.6 | 20.8 |
| `44325176142` | `4f567ae4…` | **records only** | **34.0** | — |
| (owner-reported) | `b2efee21…` | **records only** | **35.5** | — |

`b2efee21`'s run id is not yet in any record — the acceptance block convention is that the *following* records
commit names the previous head's run, and `b2efee21` is the head. Whoever lands the next records commit should
pin its run id beside the 35.5 min the owner reported; this document does not invent an id it cannot read.

**Median across the eight recorded runs: 31.6 min. The two most recent pushes — one of which changed four
Markdown files — cost 34.0 and 35.5 min.**

### 1.1 Where the minutes actually go

Run `44299429735` names its job window (`11:57:57Z` → `12:29:31Z`) and every bundle directory, so the split is
arithmetic rather than guesswork:

| Phase | Minutes |
| --- | --- |
| checkout → `pnpm test` → builds → contract suites → phase-vector steps | **10.4** |
| capture `UDG-001` (12:08:19 → 12:11:18) | 3.0 |
| capture `UDG-002` (→ 12:14:37) | 3.3 |
| capture `UDG-003` (→ 12:19:21) | 4.7 |
| capture `UDG-003-TASK` (→ 12:24:10) | 4.8 |
| capture `UDG-004` (→ 12:29:31, incl. verify + upload) | 5.3 |
| **capture total** | **21.1** (recorded as 20.8) |

Two thirds of the job is capture, and **none of it is about the change under review** for a records-only push.

### 1.2 The duplicated work inside capture, measured but not touched here

Every one of the five plans re-runs the same five commands — `install-frozen`, `typecheck`, `lint`, `test`,
`build` (verified in `CAPTURE_PLANS`: all five plans carry all five labels). Using the durations that
`UDG-004`'s own capture recorded for exactly those labels (`docs/contracts/assignments/UDG-004-evidence.json`:
0.1 + 18.8 + 4.9 + 128.8 + 7.4):

> **160 s of shared prefix × 5 plans = 800 s ≈ 13.3 min of the ~21 min capture step is the same work done five times.**

That is the next big saving, and **it is deliberately out of scope** (§9). It changes what each bundle's
`commands.json` records, and `docs/validation/evidence-requirements.md` §19.1 makes that record the evidence.

## 2. What is proposed, in one paragraph

Split today's single workflow into two workflows with different names and different jobs: a **routine** lane
that every push runs, which routes the changed files to the checks that can actually fail because of them and
captures **no evidence at all**; and an **acceptance** lane that runs the job we have today verbatim — all five
bundles, the artefact assertion, verification, summaries and publication — triggered explicitly on the exact
candidate commit. The routing decision is a table in one small script that a unit test drives, because a
routing rule nobody can execute is a routing rule nobody can review.

## 3. Triggers, names and the reviewer's reading of a green tick

| | Routine | Acceptance |
| --- | --- | --- |
| File | `.github/workflows/ci.yml` (kept) | `.github/workflows/acceptance.yml` (new) |
| `name:` | `ci (routine)` | `ci (acceptance — full evidence capture)` |
| Jobs | `route`, `records`, `static`, `protocol`, `unit`, `camera`, `server`, `runtime`, `tooling`, `full-suite`, `routine outcome` | `acceptance: full capture UDG-001 UDG-002 UDG-003 UDG-003-TASK UDG-004` |
| Triggers | `push` to `main`, `pull_request`, `workflow_dispatch` | **`workflow_dispatch` only**, with a `candidate_sha` input |
| Evidence capture | **none** | all five plans, as today |
| Artefact publication | none (diagnostics live in the run log) | `udg-evidence`, `if-no-files-found: error`, `retention-days: 30`, as today |
| Concurrency | `ci-routine-${{ github.ref }}`, `cancel-in-progress: true` | `acceptance-${{ github.sha }}`, **`cancel-in-progress: false`** — a cancelled full capture wastes half an hour and retains nothing |
| Branch protection | the single required check `ci (routine) / routine outcome` | not required on ordinary pushes; **required by record** for any Verified claim |

Two names, visibly different in the Checks list, is the point: `ci (routine) / camera …` tells a reviewer
nothing about evidence, and `ci (acceptance — full evidence capture) / full capture …` tells them everything.
Today both facts are hidden in one check called `ci`.

### 3.1 Running acceptance on the exact candidate commit

The exact command, from a checkout whose dispatch ref contains `acceptance.yml` (a workflow can only be
dispatched on a ref that carries it):

```bash
# candidate = the tip of the branch under review
gh workflow run acceptance.yml --repo TomBResearch/UntitledDinosaurGame \
  --ref main -f candidate_sha="$(git rev-parse HEAD)"
# candidate = a pull request head
gh workflow run acceptance.yml --repo TomBResearch/UntitledDinosaurGame \
  --ref "$BRANCH" -f candidate_sha="$HEAD_SHA"
gh run watch --repo TomBResearch/UntitledDinosaurGame --workflow "ci (acceptance — full evidence capture)"
```

**Correction made while implementing (2026-11-18).** This section proposed `--ref <sha>`. GitHub's dispatch API
resolves `ref` as a *ref name* and refuses a bare commit with `HTTP 422: No ref found for: <sha>` — the first
dispatch attempt in this change got exactly that. The split of responsibility the proposal wanted is unchanged
and is what shipped: the ref says where GitHub may take a runner from, `candidate_sha` is the assertion the
workflow checks the checkout against, and a run whose `github.sha` is not the candidate cannot pass. The
practical consequence is that the candidate must be reachable as a branch or tag tip when acceptance is
dispatched — which is also the case where "accept this exact commit" means anything.

1. First step of the acceptance job, new: **`Assert the exact candidate commit`** — prints `github.sha`, the
   short sha and the ref it came from, and exits non-zero when `inputs.candidate_sha` was supplied and
   differs from `github.sha`. A capture of the wrong tree is a red run inside the first minute, not a
   mis-cited record after thirty.
2. **Every bundle is bound to that sha.** `report.json.implementationSha` is already `git rev-parse HEAD`, so
   capture binds each bundle to the checkout it ran in; the additional step
   **`Assert every bundle names the candidate`** reads each captured `report.json` after the loop and fails if
   any bundle's `implementationSha` is not the commit the run was asked to verify. A bundle from a different
   tree then stops the run instead of being noticed at review.
3. The summaries the acceptance job writes name their lane:
   `--ci-status "success (acceptance capture, GitHub-hosted ${RUNNER_OS}, ${RUNNER_ARCH})"`. A committed
   `*-evidence.json` then says which workflow produced it. (`tests/contracts/UDG-001.test.ts:1624` only requires
   `^success\b`, so no test moves.)
4. A submission therefore has two commits, as it always did: the candidate commit, dispatched explicitly, and
   the records commit that cites `run <id>` plus the candidate sha. The second is records-only and costs
   minutes rather than half an hour.

### 3.2 An acceptance-record edit can cite the verified candidate run

The existing convention already survives the split: a block cannot carry its own commit's hash, so the
candidate commit is dispatched explicitly and the next records commit cites `run <id>` + the candidate sha.
That follow-up commit is a **records-only** change, so it costs ~2.5 min instead of ~35 min, and it still runs
`pnpm contracts:checksums` and `pnpm test:contract -- --task UDG-001`, which is the suite that reads
`adoption.md`, the checksum manifest and both workflow files. The cited run cannot be re-checked inside its own
commit and is not claimed to be; the `git cat-file` prerequisite check in that suite does resolve cited
40-character shas, so the lane keeps `fetch-depth: 0` (the repository is 371 tracked files and a 24 MB store —
full history costs seconds).

## 4. The routing table (changed files → checks)

`tools/ci/route-checks.mjs` (new, no dependencies, next to the `capture-plans.sh` precedent) resolves the
changed file list, applies the table below, and prints one line per path: the path, the rule that matched, the
flags it set. Flags: `records static protocol unit camera server tooling fullSuite`.

| Flags | Selected by | Job runs (existing scripts only — no new root scripts in this change) | Est. hosted min |
| --- | --- | --- | --- |
| `records` | `docs/**`, `README.md`, `**/README.md`, `AGENTS.md`, `**/AGENTS.md` | `pnpm build:libraries`; `pnpm contracts:checksums`; `pnpm test:contract -- --task UDG-001` | ~2.6 |
| `static` | any `*.ts`/`*.mts`/`*.cts`, `packages/**`, `apps/**`, `tools/**`, `tests/**` | `pnpm typecheck`; `pnpm lint` | ~3.1 |
| `protocol` | `packages/protocol/**`, `packages/config/**`, `docs/contracts/protocol-v1.md`, `docs/contracts/README.md`, `docs/contracts/UDG-001.md`, `docs/contracts/UDG-002.md`, `docs/contracts/assignments/UDG-002*`, `tests/fixtures/protocol/**`, `tests/fixtures/catalog.json`, `tests/unit/udg-002/**`, `tests/contracts/UDG-002.test.ts` | `pnpm build:libraries`; `pnpm test:contract -- --task UDG-002`; `pnpm test:fixtures`; `pnpm test:boundaries` | ~3.4 |
| `unit` | `packages/**`, `apps/**`, `tests/unit/**`, `tests/checks/**`, `tools/checks/**`, `tests/fixtures/**` | `pnpm test:unit` (needs the pinned chromium: `tests/unit/udg-004/evidence-gates.test.ts` measures against a real screenshot) | ~3.7 |
| `camera` | `apps/client/**`, `tests/e2e/**`, `playwright.config.ts`, `tests/unit/udg-004/**`, `tests/contracts/UDG-004.test.ts`, `docs/contracts/UDG-004.md`, `docs/integration/client-stack-v1.md` | chromium; `pnpm test:e2e -- --suite camera` with `UDG_BROWSER_OUT`; `pnpm build:libraries`; `pnpm test:contract -- --task UDG-004` | ~4.3 |
| `server` | `apps/server/**`, `packages/simulation/**`, `packages/protocol/**`, `packages/config/**`, `tests/probes/**`, `tests/unit/udg-003*/**`, `tests/contracts/UDG-003.test.ts`, `tools/checks/src/{evidence,run-contract,support}.ts`, `docs/integration/colyseus*`, `docs/contracts/UDG-003.md`, `docs/contracts/assignments/UDG-003*` | `pnpm build:libraries`; `pnpm test:contract -- --task UDG-003` with `UDG_PROBE_OUT`/`UDG_PROBE_INVOCATION: ci-routine`; `pnpm evidence:probes -- --dir artifacts/probes` | ~4.7 |
| `runtime` | `apps/server/**`, `packages/simulation/**`, `packages/protocol/**`, `packages/config/**`, `tests/system/**`, `tests/runtime/**`, `tests/reference/**`, `tests/support/**`, `tests/probes/**` | `pnpm build:libraries`; `node tests/reference/flat-direct-step.ts`; `pnpm exec vitest run tests/system` with a JUnit report whose case counts are printed, so "the runtime ran" is a number in the log and not an inference | ~4.5 |
| `tooling` | `.github/workflows/**`, `tools/ci/**`, `docs/contracts/checksums.json`, `docs/integration/dependencies.json`, `pnpm-lock.yaml`, `/package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, `eslint.config.mjs`, `.node-version`, `.npmrc`, `.env.example` | `pnpm build:libraries`; `pnpm test:contract -- --task UDG-001`; `pnpm test:contract -- --task UDG-002`; `pnpm contracts:checksums`; `pnpm dependencies:verify`; `pnpm test:unit` scoped to `tests/unit/udg-003/capture-loop.test.ts`; `pnpm test:boundaries` | ~4.5 |
| `fullSuite` | set by the shared-surface rules (`packages/{protocol,config,simulation}/**`, `tools/checks/**`, `tests/fixtures/**`, `playwright.config.ts`) and by the uncertainty rules below | chromium; camera; `pnpm test` (the command that gates the browser artefacts and the acceptance bundle's `junit.xml`) | ~6.6 |

Every entry above is justified by a reader in the suite, not by intuition: `UDG-001.test.ts` reads
`adoption.md`, `README.md`, `checksums.json`, `dependencies.json`, `.github/workflows/ci.yml` and
`tools/ci/capture-plans.sh`; `UDG-002.test.ts` reads `protocol-v1.md`, the contracts index and the protocol
fixtures; `UDG-003.test.ts` reads `colyseus-0.18-api-map.md`, `colyseus-declaration-inventory.json`,
`UDG-003-phase-1.md`, `tools/checks/src/evidence.ts`, `tsconfig.base.json` and the workflow; `UDG-004.test.ts`
reads `apps/client/**`, `playwright.config.ts` and `tests/e2e/camera.spec.ts`, and gates `UDG_BROWSER_OUT`.

### 4.1 The diff the router reads, and the uncertainty rules

**One push, or one pull request, is one route.** A push of several commits is diffed `before..after`, so the
run gets the union of every commit in it; a pull request is diffed `base...head`, which is what the PR would
change, measured from the merge base. `git diff --name-status -M` supplies the list and both sides of a rename
are routed — a move out of the camera lane cannot escape it — while a deletion routes the path that was
removed, because the suite that read it is the suite that goes red.

The router sets **every flag** when:

1. the changed-file list is empty or the base cannot be resolved (`push.before` all zeros, a force-push, a
   shallow fetch, a merge commit with no recorded base);
2. any path matches no rule in the table (including any new top-level directory);
3. any path is one of the "everything depends on this" set: `pnpm-lock.yaml`, root `package.json`,
   `pnpm-workspace.yaml`, any `tsconfig*.json`, `eslint.config.mjs`, `vitest.config.ts`, `.node-version`,
   `.npmrc`, `.env.example`, or anything under `.github/workflows/` or `tools/ci/`;
4. `workflow_dispatch` on the routine lane is used without a forced group (a human asked for the broad
   answer). `--force <group>` runs one lane on demand, which is how a lane is timed without manufacturing a
   change to a game path;
5. more than 40 paths changed.

It also prints `route: <flags> (reason: <rule>)` as the first line of the run, so a surprising route is visible
without reading the script — the same reasoning that made the capture step print its plan list.

`route` is the only unconditional job. `routine outcome` runs `if: always()`, fails if any needed job failed,
**and** fails if the router emitted no flag at all — a run where nothing was checked cannot be green.

## 5. Affected files

New:

| Path | What |
| --- | --- |
| `.github/workflows/acceptance.yml` | today's job, moved, plus the exact-candidate assertion and the lane-named `--ci-status` |
| `tools/ci/route-checks.mjs` | the routing table and the resolver; `--explain`, `--paths-file`, `--force`, `--output-file` |
| `tools/ci/route-checks.d.mts` | its type surface, so the suite that tests it is type-checked (§19.1 discipline: no untyped seam) |
| `tests/unit/ci-routing/route-checks.test.ts` | the router's tests (§7) — landed before any workflow used the table |
| `tests/unit/ci-routing/workflow-policy.test.ts` | the both-files policy assertions and the table↔job agreement test (§7 8–13) |
| `docs/contracts/assignments/evidence/ci-routing-timings.tsv` | the measurement record (§6) |

Changed:

| Path | Change | Checksummed? |
| --- | --- | --- |
| `.github/workflows/ci.yml` | `name: ci (routine)`; job split into the routed jobs; capture / artefact-assert / verify / summary / upload steps **removed** (they move verbatim) | no |
| `tests/contracts/UDG-001.test.ts` | amendments B, C (§8) | no |
| `tests/contracts/UDG-003.test.ts` | amendment E | no |
| `tests/unit/udg-003/capture-loop.test.ts` | amendment D | no |
| `docs/contracts/assignments/UDG-003-phase-3.md` | amendment A (§5.4, D-P3-4 row, new §9.1 row **A-P3-8**) | excluded (`assignments/`) |
| `README.md` | §"Continuous integration" rewritten for two lanes | **yes** |
| `docs/contracts/adoption.md` | the C-07 clarification row + the dated record entry | **yes** |
| `docs/contracts/checksums.json` | regenerated in the same commit (`-- --write`) | the manifest itself |

Deliberately **not** touched, and the reason:

- `tools/checks/src/evidence.ts` — `CAPTURE_PLANS`, the verifier, `report.json`. Historical bundles keep their
  bytes and their outcomes (§19.1, A-P3-7). Note `report.json.configHashes.ciWorkflow` will keep hashing
  `ci.yml`, i.e. the *routine* file: recorded, never recomputed at verify time (`configHashes` is presence-only
  in `REQUIRED_REPORT_FIELDS`), so no historical bundle moves. The fidelity gap is recorded as follow-up F-2.
- `docs/contracts/README.md`, `docs/specifications/UDG-SPEC-M0-002.md` — hashed into every bundle's
  `contractHash` / `baselineSpecHash`, and `UDG-002.test.ts:1102` asserts the committed summary's `contractHash`
  equals the live index digest. Editing either would turn a green suite red for reasons unrelated to CI.
- `docs/contracts/repository.md` (§3.2), `docs/validation/evidence-requirements.md`, `definition-of-done.md` —
  shared, checksummed requirements. They do **not** require capture on every push (§8 A′), and this proposal
  does not weaken them.
- `docs/integration/dependencies.json` — `parseCiActions` reads only `ci.yml`, so the register stays valid;
  acceptance's pins are instead asserted to be a subset of the recorded `ciActions` (§7 test 13).
- The evidence store, D4, Gates A/B/C, `stackCompatibility`, CF-1 … CF-4, every pin and every threshold.

## 6. Measurement: how we will know it worked

Baseline: the eight hosted runs in §1 (median **31.6 min**, range 24.6–35.5) and the per-phase split in §1.1.
Two numbers are reported per class, because they answer different questions and only one of them is what a
developer waits for:

* **feedback** — push (or dispatch) timestamp to the *final* `routine outcome` job, from the run's own
  timestamps. This is what the ≤3 min and ≤5 min targets are written against;
* **runner minutes** — the sum of the job wall times, and each job's own wall time. Parallel jobs buy latency
  with minutes, and the repository should say so rather than let a green tick hide the bill.

Each class gets its first hosted observation recorded in `ci-routing-timings.tsv` — run id, event, class, head,
jobs that ran, feedback seconds, runner minutes, verdict — in the W-C.4 style, where the estimate travels with
the record and the measured delta is reported rather than discovered later. If a target is missed, the row
names the slow or duplicated step rather than the class being quietly relabelled.

| Class | How it is produced | Target (wall) | Reported as |
| --- | --- | --- | --- |
| records-only | the next docs commit (e.g. the one landing this decision) | **≤ 3 min** | vs 34.0 / 35.5 today |
| camera | a client/rendering change (real UDG-005+ work, or a deliberate no-op-free edit) | **≤ 5 min** | vs 31.6 |
| server | a `packages/simulation` or `apps/server` change | **≤ 5 min** | vs 31.6 |
| shared | a `packages/protocol` change (the broad case, §7 example 1) | ≤ 7 min | vs 31.6 |
| full acceptance | one `workflow_dispatch` on the candidate sha | **unchanged ±10 %** of 31.6, capture step ±10 % of 20.8 | five bundles PASS, case count, verify 0 issues |

Guards, all of them measured rather than hoped:

- **acceptance must not get slower.** The capture step and job minutes are compared to `44299429735`
  (31.6 / 20.8). A regression here is a defect in the split, not a cost of it.
- **any routine lane over 5 min twice** is a routing-table defect: split that lane. It is never answered by
  moving a check into acceptance, because acceptance is what the routine lane is supposed to predict.
- **hosted minutes per push** are reported too (parallel jobs each pay for an install): a records push should
  use ~2.6 min of minutes against 31.6, a camera push ~11 against 31.6. Wall time is the promise; minutes are
  disclosed with it.
- the acceptance record keeps its existing fields (`jobWallMinutes`, `captureStepMinutes`, per-bundle
  `status`/`cases`/`failures`) so nothing about how runs are cited changes.

## 7. Acceptance tests for this change

In-repo (`tests/unit/ci-routing/route-checks.test.ts`, all driven by path lists — no git, no network):

1. a four-file `docs/**` change sets **only** `records`;
2. `apps/client/src/rendering/OrbitCamera.ts` sets `static, unit, camera` and **not** `server` or `runtime`;
3. `packages/simulation/src/step.ts` sets `static, unit, server, runtime` and **not** `camera`; a change to
   `tests/system/**` sets `runtime` and `static`, so the runtime suites are shown to execute;
4. `pnpm-lock.yaml`, root `package.json`, `.github/workflows/ci.yml`, `tsconfig.base.json` each set **all** flags;
5. `packages/protocol/src/schema/input.ts` sets `static, protocol, unit, camera, server, runtime, fullSuite` (shared
   dependency of both apps → broader, §7 example 1);
6. an unmatched path (`newdir/x.txt`) and an empty list each set all flags;
7. every rule in the table matches at least one fixture path (no vacuous rule), and the output is deterministic
   and sorted;
8. **table↔workflow agreement, both directions**: every flag the router can emit has a conditional job in
   `ci.yml`, and every conditional job in `ci.yml` is a flag the router can emit. This is the assertion that
   stops the two files drifting apart, which is the whole failure mode of a routing scheme;
9. `ci.yml` contains **no** `evidence:capture`, `evidence:verify`, `evidence:summary`, `capture-plans.sh` or
   `upload-artifact` — routine cannot quietly grow a capture back;
10. `acceptance.yml` contains all four `EVIDENCE_STEPS`, the capture loop invocation,
    `if-no-files-found: error`, `retention-days: 30`, no `continue-on-error`, and `cancel-in-progress: false`;
11. every `uses:` in **both** files is a 40-hex sha and appears in `dependencies.json` `ciActions`; both files
    contain `24.22.2` and `12.18.0`; neither references `secrets.`;
12. the two workflows' `name:` fields are the two distinct literals, and neither is `ci` alone — the
    "recognisably different names" property is asserted, not intended;
13. `acceptance.yml` is triggered by `workflow_dispatch` and by nothing else — no `push`, no `pull_request`,
    no schedule — so acceptance is always an explicit act against a named commit;
14. `acceptance.yml`'s summary step names the lane in `--ci-status`;
15. renames and deletions: a rename between two lanes routes both sides, and a deletion routes the path
    that was removed; a push of several commits routes their union, and a force-push routes everything.

The `Acceptance-CI: required` commit-message trailer proposed in the first draft was **not implemented**: the
owner directed explicit dispatch only for the first version, so no commit message can start a full capture.

Hosted demonstrations before C-07 may be recorded satisfied (none of them is a fixture):

- **D1 records** — a records-only push: only `route`, `records`, `routine outcome` ran, green, ≤3 min, and the
  run contains no capture job.
- **D2 camera**, **D3 server**, **D4 shared** — one real push each, minutes recorded in the TSV.
- **D5 acceptance** — a dispatch on an exact sha: five bundles PASS with the current case count, verify 0
  issues, and the run cited in a record in the existing format. A records-only commit then cites it, and that
  commit's own routine green is the ~2.5 min number.
- **D6 preservation** — the store comparison the phase-3 record already used
  (`UDG-003-phase-3-verify-preservation-head-vs-wa3.txt`): HEAD's verifier and the change branch's verifier run
  side by side over all 222 visible bundles, expecting **0 outcome differences**. The change touches no verifier
  code, so 0 is the expectation — and it is measured, because "we did not touch it" is not evidence.
- **D7 a failed routine attempt is kept** — the first red attempt of D1–D4 keeps its run url in the TSV and in
  the record; nothing is re-run until green. Routine runs produce no bundles, so no bundle verdict changes and
  A-P3-7 ("recorded FAIL, stays FAIL") is untouched by construction, not by argument.
- **D8 history still verifies** — `pnpm dependencies:verify` green, and
  `pnpm evidence:verify` over a named retained bundle (`UDG-003-2026-11-14T01-08-23-769Z-28c30153`) still PASS
  on the new tree, because recorded config hashes are never recomputed at verify time.

## 8. The existing requirements that say "full capture on every push", and their exact amendment

**A′. First, what does *not* say it**, so the change is not sold as relaxing something it does not:
`docs/contracts/repository.md` §3.2 — *"Root pnpm typecheck, pnpm lint, pnpm test and pnpm build are required
for every task … CI runs these same scripts with a locked installation and publishes logs and machine-readable
results even on failure."* That is a requirement about **a task's acceptance**, discharged by the acceptance
workflow, which keeps all four commands, the frozen install and the failure-visible publication. Unedited.
Same for `definition-of-done.md` and `evidence-requirements.md` §19.2 ("evidence from the exact submitted
commit" — the acceptance workflow is now the *only* thing that produces it, which strengthens that clause).

### A. The normative one — `docs/contracts/assignments/UDG-003-phase-3.md` §5.4 (W-C.4), lines 240–244

> "From that commit onward **every CI run** captures and verifies the whole-task bundle — no conditionals, no
> `continue-on-error`: from W-C on, a run where the whole-task bundle is absent is red by design."

and the §1 decision row **D-P3-4** (line 96): "CI runs the whole-task capture from the W-C landing commit on,
**every run**, appended to the existing plans loop".

Proposed amendment, recorded as **A-P3-8** in §9.1 beside A-P3-5 … A-P3-7, with the original text kept in place
(the A-P3 practice: the clause stays, the bound is added):

> **A-P3-8** | §5.4 W-C.4 / §1 D-P3-4 — *"every CI run captures and verifies the whole-task bundle"* | The
> quantifier is **every acceptance run** (`ci (acceptance — full evidence capture)`), which captures all five
> plans unconditionally on the exact candidate commit. A routine run (`ci (routine)`) captures nothing **by
> design** and is therefore not red for a missing bundle; it can never support a Verified claim. Inside the
> acceptance job nothing is conditional: the plans loop, the artefact assertion, verification and publication
> stay as W-C wrote them, with no `continue-on-error`. From W-C on, **an acceptance run whose whole-task bundle
> is absent is red by design**, and a milestone record that cites only routine checks is not evidence. |
> It weakens no acceptance obligation, because every obligation it touches is discharged on the candidate
> commit; it bounds *when* capture happens, never *what* capture proves; historical bundles keep their bytes
> and verdicts. |

This is an amendment to an accepted record for a Verified task, so it needs the owner's explicit approval in
the same way A-P3-5 … A-P3-7 did, and UDG-003's Verified status is not re-opened by it: the bundles that
accepted UDG-003 (`44299429735`) stay exactly as they are.

### B. `tests/contracts/UDG-001.test.ts`, `describe('CI workflow failure policy')` line 1298

> `const workflow = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');`

This is the mechanical enforcement of "capture happens on every push": `EVIDENCE_STEPS` (1313–1318),
`it('allows no step to fail without failing the run')`, `it('treats a missing evidence artefact as an error
while still publishing after failure')` (which requires the capture loop, `--keep-going`, `evidence.js plans`
and an upload glob covering every `CAPTURE_PLANS` key), `it('maps every evidence failure to a failed job
conclusion')` and `it('executes the workflow artefact assertion against empty, incomplete and complete
evidence')` (which *runs* the assertion script read out of `ci.yml`) all read that one file.

Proposed amendment: parse **both** files, and split the assertions by what they govern.

```ts
const ROUTINE = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const ACCEPTANCE = readFileSync(join(ROOT, '.github/workflows/acceptance.yml'), 'utf8');
const stepsOf = (text: string) => parseWorkflowSteps(text);
const acceptanceSteps = stepsOf(ACCEPTANCE);   // EVIDENCE_STEPS, the loop, the assertion script, the uploader
const routineSteps = stepsOf(ROUTINE);         // the routed jobs
```

- policy assertions (`no continue-on-error`, `if-no-files-found: error`, `retention-days: 30`, 40-hex `uses:`
  pins, the Node/pnpm pins, no `secrets.`) → run against **every** workflow file, in a loop over both, so a
  second file cannot be a loophole;
- `EVIDENCE_STEPS`, the capture-loop invocation, the per-plan upload globs, the failure mapping and the
  executed artefact assertion → run against `acceptanceSteps`;
- **new**: `expect(ROUTINE).not.toMatch(/evidence:capture|evidence:verify|evidence:summary|capture-plans\.sh/)`
  — the routine lane must be capture-free, asserted rather than absent;
- **new**: both files' `name:` fields differ and neither is the bare `ci`.
- `parseWorkflowSteps` must be given the file's step list it is checking; its existing
  `if (steps.length < 10) throw` guard stays, so neither file can be parsed vacuously.

### C. `tests/contracts/UDG-001.test.ts` line 1691, `it('authorship: the CI workflow runs the same scripts and pins third-party actions')`

> `for (const command of ['pnpm install --frozen-lockfile', …, 'pnpm evidence:capture', 'pnpm evidence:verify', 'pnpm evidence:summary']) expect(workflow, command).toContain(command);`

Amendment: keep the list and check it against the **concatenation** of both workflows ("CI runs the same
scripts"), then add the split it now implies — the three evidence commands must come from the acceptance file
and none of them from the routine file:

```ts
for (const command of EVIDENCE_COMMANDS) {
  expect(acceptance, command).toContain(command);
  expect(routine, `${command} must not run on a routine push`).not.toContain(command);
}
```

### D. `tests/unit/udg-003/capture-loop.test.ts` line 27 and the test at 144

> `const CI = join(ROOT, '.github', 'workflows', 'ci.yml');` … `it('is the loop CI actually runs, and CI names the invocation the accepted contract requires')`

Amendment: point `CI` at `acceptance.yml` and keep every assertion in that test exactly as written — the loop
must still attempt every plan, retain every bundle, name `pnpm evidence:capture -- --task TASK --out artifacts
--keep-going`, carry no `set -euo` and `exit 1`. Add one line: `expect(ROUTINE).not.toContain('capture-plans.sh')`.
The WA-6 lesson is preserved in full; only the file that hosts the loop changes.

### E. `tests/contracts/UDG-003.test.ts` line 1845 and `it('runs the phase gate on CI and publishes the bytes it gated')` (2024)

> `expect(workflow).toContain('UDG_VECTORS_OUT: artifacts/udg-003-phase-1');` … `expect(workflow).toContain('node tools/checks/dist/evidence.js plans');`

Those phase-vector producer steps and the capture plan list move to the acceptance workflow, so the test reads
that file for them. The `continue-on-error` refusal in the same test becomes a loop over both files. No vector,
threshold or producer assertion changes.

## 9. Explicitly deferred (each needs its own turn)

| # | Item | Why it is not in this change |
| --- | --- | --- |
| R-1 | **Reuse of repeated commands inside a full capture** — §1.2 says up to ~10.7 min of the ~21 min capture step is `install-frozen`/`typecheck`/`lint`/`test`/`build` done five times | Each bundle's `commands.json` must record the invocation that produced *that* bundle (§19.1); the plans' command lists are asserted literally in `UDG-003.test.ts`; changing a plan changes what a new bundle claims. Evidence-shaped change, own assignment, and it should start from the per-command durations already retained in acceptance bundles rather than from the local numbers used here |
| R-2 | `parseCiActions` (evidence.ts:3033) reads only `ci.yml`, so a second workflow's pins are outside `pnpm dependencies:verify`. Extend it to `.github/workflows/*.yml`, de-duplicate, re-record `dependencies.json` | Changes a shared tool and a controlled file, and re-records a register the UDG-001 suite asserts field by field. Test 13 closes the gap meanwhile |
| F-2 | `report.json.configHashes` records only `ci.yml`'s hash; an acceptance bundle should also hash the workflow that produced it | Inert for the verifier (presence-only), but it is a schema-adjacent change and a fair reviewer question; keep it separate from a routing change |
| F-3 | Caching (`~/.pnpm-store`, Playwright browsers) | Rejected for now on evidence grounds: it changes the clean-checkout/frozen-install claim C-05 rests on. Only worth arguing after R-1, and only if a routine lane is still over budget |
| F-4 | Retaining routine run logs beyond the platform default (90 days), e.g. a small per-attempt log artefact | Would reintroduce an uploader into the capture-free lane; do it only if routine attempts start carrying findings worth keeping |
| F-5 | Branch-protection changes (required check becomes `ci (routine) / routine outcome`) | An owner setting outside the repository; must land with the change or the first routine push is unguarded |

## 10. Order of work, and how to undo it

1. Owner decision on **C-07** and on amendments A, B, C, D, E (this document).
2. Land `tools/ci/route-checks.mjs` + `tests/unit/ci-routing/route-checks.test.ts` **before** any workflow
   change, so the table is under test while nothing uses it yet. Expected hosted cost: `records` + `tooling`.
3. Land `acceptance.yml` and the amended `ci.yml` together with the four test amendments and the
   README/adoption records + checksum refresh — one commit, because the assertions and the files they read
   cannot land apart (the same "one commit" rule W-C.4 used for the plan and its producers).
4. Run D1 … D8; record the measured minutes against the estimates in §4 and §6 in the adoption entry.
5. Rollback is a single `git revert` of step 3: `ci.yml` returns to the full job, acceptance becomes an unused
   file, and no evidence, bundle or verdict anywhere in the store is affected by either direction.

**Not claimed by this document:** that any check has run since `b2efee21`; that the estimates in §4 are
measurements (they are estimates, and §6 says how each becomes a measurement); that UDG-003's or UDG-004's
Verified status is affected; that any gate moves. Gates A, B and C remain **Not Run**, GA-11 unevaluated,
`stackCompatibility` not-established, deduplication-triggered closure disabled, **D4 open**, CF-1 … CF-4 open
and unclassified, and no task from UDG-005 onward is assigned. Implementation waits for the owner's build
instruction.
