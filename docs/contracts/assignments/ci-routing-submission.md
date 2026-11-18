# CI routing — implementation submission (In Review)

**Status: In Review.** Routine CI, acceptance CI, the routing table, the amended policy suites and the hosted
demonstrations are all in place on `main`; nothing in this record claims acceptance of anything. The owner's
approval of the plan is [clarification **C-07**](../adoption.md) with [amendment **A-P3-8**](UDG-003-phase-3.md);
the plan itself is [ci-routing-proposal.md](ci-routing-proposal.md).

| | |
| --- | --- |
| Baseline the owner named | records commit `b2efee21caca6a4a7fe4be15d6b40e2ae6edd66a`, CI [`44332154300`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44332154300) — 35 min 38 s |
| Implementation commits | `f0b943e` proposal · `437d81e` router + tests · `08e6744` the split (C-07, A-P3-8) · `5e96cf7` lane build prerequisites · `7c8e68a` full history + lane budgets · `692e34d` dispatch-command correction (records-only) · **`45b787b8d39b8ebd22b79b3ce989b9e4d6d1e1f0`** the candidate |
| Routine CI on the candidate | [`44380381929`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44380381929) — green, 11 min 13 s wall, all nine groups |
| Acceptance CI on the candidate | [`44380502646`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44380502646) — green, 29 min 56 s, five bundles, all verified PASS |
| Measurements | [evidence/ci-routing-timings.tsv](evidence/ci-routing-timings.tsv) |

## 1. What shipped

| Path | What it is |
| --- | --- |
| `.github/workflows/ci.yml` | **`ci (routine)`** — one `route` job, nine lane jobs, one `routine outcome` job. No capture, no verification, no summary, no uploader |
| `.github/workflows/acceptance.yml` | **`ci (acceptance — full evidence capture)`** — the previous job, moved with its steps, comments and ordering intact, plus the candidate guard and the bundle-binding assertion. `workflow_dispatch` and nothing else |
| `tools/ci/route-checks.mjs`, `tools/ci/route-checks.d.mts` | the whole routing decision: one table of path rules keyed to the suite that reads each path, four escalation rules, and a resolver over `git diff --name-status -M` |
| `tests/unit/ci-routing/route-checks.test.ts` | 26 tests over the table, the union across a push, renames, deletions, escalation and the "capture is not routable" rule |
| `tests/unit/ci-routing/workflow-policy.test.ts` | 13 tests that hold the two files to one policy — see §5 |
| `tests/contracts/UDG-001.test.ts`, `tests/contracts/UDG-003.test.ts`, `tests/unit/udg-003/capture-loop.test.ts` | amended to read the file that now owns each assertion, plus the *absence* assertions that keep the routine lane capture-free |
| `tools/checks/src/evidence.ts` | one behaviour change, in `parseCiActions`: one register entry per **distinct** CI pin instead of one per `uses:` occurrence (§6) |
| `docs/integration/dependencies.json` | re-derived consequence of the split: the routine workflow no longer references `actions/upload-artifact`, so the register stopped listing it |
| `docs/contracts/assignments/UDG-003-phase-3.md` | §9.3 records **A-P3-8** with the §5.4 clause quoted unedited and a pointer beside it |
| `README.md`, `docs/contracts/adoption.md`, `docs/contracts/checksums.json` | the two lanes and the dispatch command; clarification C-07; regenerated manifest |

## 2. The two lanes, and what each green means

| | `ci (routine)` | `ci (acceptance — full evidence capture)` |
| --- | --- | --- |
| Trigger | `push` to `main`, `pull_request`, `workflow_dispatch` (lane measurement only) | `workflow_dispatch` only — no `push`, no `pull_request`, no schedule |
| Routes by changed paths | yes, one route per push or PR | no: all five plans, unconditionally |
| Captures evidence | never | always: five bundles, artefact assertion, verification, summaries, publication (`if-no-files-found: error`, 30-day retention) |
| Concurrency | per ref, `cancel-in-progress: true` | per candidate sha, `cancel-in-progress: false` |
| Green means | the checks the change can redden passed, on this commit | this exact commit carries five verified bundles |
| Can support a Verified claim | **no** | yes, subject to the contract that asks for it |

`routine outcome` is the one name branch protection should require (§9). It lists every lane's result, fails on
`failure` or `cancelled`, and also fails when the router selected nothing: *"a run that checked nothing cannot be
green"*. Its last line states the limit of what it proved: `no evidence was captured on this route; milestone
acceptance requires a dispatched acceptance run`.

Dispatch, spelled out (also in the README and both workflow headers):

```bash
# candidate = the tip of the branch under review
gh workflow run acceptance.yml --repo TomBResearch/UntitledDinosaurGame \
  --ref main -f candidate_sha="$(git rev-parse HEAD)"
# candidate = a pull request head
gh workflow run acceptance.yml --repo TomBResearch/UntitledDinosaurGame \
  --ref "$BRANCH" -f candidate_sha="$HEAD_SHA"
```

`--ref` is a **ref name**. The proposal assumed `--ref <sha>`; GitHub resolves the ref before the workflow starts
and answered the first dispatch with `HTTP 422: No ref found for: 7c8e68a…`. That is why `candidate_sha` is not
decoration: the exact-candidate guarantee cannot come from the trigger, so it comes from the first step, which
compares the input with `github.sha` and refuses the run. The candidate therefore has to be reachable as a branch
or tag tip when acceptance is dispatched — which is also the only case where "accept this exact commit" means
anything.

## 3. How a change becomes checks

`route` resolves the diff once — `before..sha` for a push (the union of every commit in it), `base...head` from
the merge base for a pull request — and both sides of a rename count, with additions and deletions routing like
edits. Each rule in the table names the reader that justifies it (the suite that opens the path), because "looks
related" is not a routing rule. Four rules set every group before the table is consulted: root manifest or
lockfile, root TypeScript project, root lint/test configuration, and `.github/**` / `tools/ci/**`. Anything that
matches no rule, an empty diff, an unresolvable diff, a non-ancestor base (force-push) or a diff over 40 paths
escalates to every group: a wrong route that runs too much costs minutes, a wrong route that runs too little
costs coverage.

Evidence capture is deliberately **not** routable — no flag can select it and no flag can withhold it, because it
no longer lives in the routine lane at all.

The two examples the proposal promised:

- **a shared change selects broader checks.** `packages/protocol/src/schema/PlayerSchema.ts` — one comment line —
  routes `static, protocol, unit, camera, server, runtime, fullSuite` (PR #3,
  [`44377266837`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44377266837)): both apps
  depend on `@udg/protocol`, so a schema edit is a client change and a server change at once. `records` and
  `tooling` were skipped, and the run was green.
- **routine CI alone cannot satisfy milestone acceptance.** A green `records`-only push — the fastest possible
  routine run, 60 s — has no bundle directory, no `pnpm test` JUnit report, no `evidence:verify` result and no
  published artefact, so there is nothing for `definition-of-done.md` or §19.2 of the evidence requirements to
  point at. It is not a weak evidence bundle; it is not evidence. That is a property of the design, and
  `tests/unit/ci-routing/workflow-policy.test.ts` asserts the routine file cannot accidentally acquire it.

## 4. Measured, before and after

Full table: [evidence/ci-routing-timings.tsv](evidence/ci-routing-timings.tsv). "Wall" is trigger to final
outcome; "runner" is the sum of jobs that ran, reported separately because the lanes are parallel.

| Case | Before (one workflow, every push) | After | Wall | Verdict |
| --- | --- | --- | --- | --- |
| Records-only push, checksum manifest regenerated | 35 min 38 s (`44332154300`) | `records` lane only, 8 lanes skipped | **1 min 00 s** | target 3 min — met, 35.6× faster |
| Server change | 34 min 19 s for any push (`44357192895`) | `static, unit, server, runtime` | **1 min 57 s** | target 5 min — met |
| Camera change | as above | `static, unit, camera` | **8 min 31 s** | target 5 min — **missed**, cause named below |
| Shared change (protocol schema) | as above | seven groups | **12 min 09 s** | no target; the broad case, and still 3× faster than the old workflow |
| CI-tooling change (worst routine case) | as above | all nine groups | **11 min 13 s** | no target; nothing captured |
| Full acceptance capture | every push, whether or not it was wanted | only when dispatched | **29 min 56 s** | one job, five bundles, all verified |

**The camera case missed, and the step is identified.** `pnpm exec playwright install --with-deps chromium` took
**7 min 38 s** in the unit lane of that run and 7 min 12 s in the full-suite lane of `44374411960`, while the same
step took 23 s and 28 s in lanes that ran when fewer runners were fetching at once. The camera work itself is not
slow: the camera lane was 3 min 41 s, of which the suite is 2 min 41 s, and the server run — which needs no
browser — finished in 1 min 57 s. The cost is an uncached, contended browser download paid independently by three
lanes. Proposed, **not done here**, because each needs an owner nod and the current proof is green: cache the
Playwright browser store keyed on `pnpm-lock.yaml` plus browser build (a new action pin, which touches R-2's
"every action is pinned and recorded" story); or install without `--with-deps` on `ubuntu-24.04`, where the
system libraries are already in the image; or move the browser-dependent unit test into the camera lane so two
lanes stop paying for it. Deferring this is also why the numbers in the table are honest: nothing was tuned away
before it was measured.

## 5. Demonstrations

| # | Claim | What was actually shown |
| --- | --- | --- |
| D1 | a realistic records-only change, checksum manifest regenerated, routes to `records` alone | push `692e34d` → [`44377641990`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44377641990): route printed `records`, 8 lanes `skipped`, green in 60 s |
| D2 | a camera change runs the camera suite and its gate | PR #1 → [`44374825713`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44374825713): route `static unit camera`; camera lane ran `pnpm test:e2e -- --suite camera` then `pnpm test:contract -- --task UDG-004` over the artefacts that run wrote |
| D3 | a server change shows the affected runtime/system tests *executing*, with numbers | PR #2 → [`44374833468`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44374833468): `[reference] pass — 200 ticks, 40.000000 m from rows … controls 7/7` and `system suites: 35 cases, 0 failures`; a zero-case JUnit report fails the lane rather than passing it |
| D4 | a shared change widens the set | PR #3, §3 above |
| D5 | acceptance dispatch succeeds against an exact candidate | [`44380502646`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44380502646) on `45b787b…`: guard passes, five plans captured, `all 5 bundle(s) bound to the candidate 45b787b8d39b8ebd22b79b3ce989b9e4d6d1e1f0`, five `PASS evidence verify … (0 issue(s))`, artefacts published for 30 days |
| D6 | a stale or mismatched candidate is refused | two dispatches with `candidate_sha=b2efee21…` while `main` was `7c8e68a…` ([`44374730423`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44374730423), refused in 6 s) and `45b787b8…` ([`44380538455`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44380538455), refused in 13 s). Both stop at `Assert the exact candidate commit` with *"...was asked to verify b2efee21…. A capture of a commit other than the candidate is not evidence for it, so the run stops here."* and write no bundle |
| D7 | all five plans run on acceptance, and a failure stays visible | the green run shows all five; §7 shows a red acceptance run retained with its logs, and the lane policy is asserted — no `continue-on-error` anywhere, `if: !cancelled()` on capture and publication, `if-no-files-found: error`, `cancel-in-progress: false` so a discarded capture is not silently replaced |
| D8 | a routine green is not acceptance | §3's second example, plus the absence assertions in `workflow-policy.test.ts` (no capture, no verify, no summary, no uploader, no capture loop in `ci.yml`) |

Two things D6 does **not** show, stated so nobody has to discover it: a *mid-capture* plan failure (a plan that
dies after another plan succeeded) is asserted by `tests/unit/udg-003/capture-loop.test.ts` and by the step
policy, and historically demonstrated by the retained aborted runs
([`UDG-003-phase-3-capture-aborted-runs.json`](evidence/UDG-003-phase-3-capture-aborted-runs.json)), not
manufactured here; and in a refused run the steps written `if: !cancelled()` still run, so a refusal log contains
`pnpm: command not found` noise after the guard's error — the run is red and captures nothing, and
`steps.candidate.outcome == 'success'` on those steps would make the log as clean as the verdict. That edit is
deliberately not in the candidate: it needs a 30-minute acceptance cycle to prove, and the candidate is green.

## 6. Historical verification comparison

A-P3-8 changes *when* capture happens. This is the evidence that nothing changed about what capture proves.

**Structural.** `git diff --name-only b2efee21..HEAD` is fourteen files: two workflows, one router and its type
declaration, three test suites plus two new ones, the proposal, this change's records, `README.md`, `adoption.md`,
`checksums.json` and `evidence.ts`. Zero changed files under `tools/checks/` other than `parseCiActions`, zero
under `docs/validation/`, zero under `packages/`, and zero in `docs/contracts/repository.md`,
`docs/validation/evidence-requirements.md`, `docs/contracts/definition-of-done.md`, `docs/contracts/README.md` or
`docs/specifications/UDG-SPEC-M0-002.md`. The verifier, the bundle schema, the five capture plans and the
evidence requirements are the ones the baseline ran. `tests/contracts/UDG-004.test.ts`'s accepted-plan digests
(`UDG-001 3b450c28…`, `UDG-002 754df194…`, `UDG-003 3b93cfbb…`) still pass, which is the assertion that outlives
this diff.

**Behavioural.** Same verifier, same five plans, before and after:

| Bundle | Baseline `44332154300` (on `b2efee21`) | Acceptance `44380502646` (on `45b787b8`) |
| --- | --- | --- |
| `UDG-001` | PASS, 22 artefacts | PASS, 22 artefacts |
| `UDG-002` | PASS, 31 artefacts | PASS, 31 artefacts |
| `UDG-003` | PASS, 196 artefacts | PASS, 196 artefacts |
| `UDG-003-TASK` | PASS, 239 artefacts | PASS, 239 artefacts |
| `UDG-004` | PASS, 35 artefacts | PASS, 35 artefacts |

Five outcomes, zero differences. Bundles retained before this change are untouched — no bundle was re-run,
re-judged or deleted, and A-P3-7 still stands: a recorded FAIL stays FAIL. The one behaviour change in the
verifier is `parseCiActions` recording one entry per distinct pin: with a job per lane, the same two pins were
being recorded nineteen times, and the register's own derived sentence ("every `actions/*` reference in `ci.yml`
is pinned to an immutable commit sha, namely …") had become a list no reviewer can read. It is covered by a new
UDG-001 test (no duplicate entry; the register equals the set of pins `ci.yml` uses; occurrences outnumber
distinct pins so the rule stays exercised; every entry sha-pinned) and it changed `docs/integration/dependencies.json`,
which is derived data regenerated from the tool.

## 7. Failed attempts on the way, retained on purpose

| Run | What it taught | Commit that fixed it |
| --- | --- | --- |
| [`44363878340`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44363878340) (red, 30 min 45 s) | a lane cannot start from `pnpm install` alone: unit suites import `tools/checks/dist`, the dev server the camera suite drives cannot resolve the libraries until they are emitted (it waits instead of failing), and the AC-1 trace imports `apps/server/dist` | `5e96cf7` |
| [`44371657860`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44371657860) (red, 10 min 11 s) | four lanes were green and two failed on a shallow checkout: `git show <sha>:docs/interfaces/movement-authority.md` and `git cat-file` on a cited prerequisite. Every lane that checks the repository out now fetches full history, and a policy test asserts it of every checkout step | `7c8e68a` |
| [`44374610247`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44374610247) (red, 26 min 45 s) | five bundles captured, bound to the candidate and verified — then `--ci-status: command not found`, because an explanatory `#` comment sat *inside* a backslash-continued command, where a comment ends the command instead of annotating it. A new policy test walks both files' `run: |` blocks and refuses that shape; checked by mutation, not by inspection | `45b787b8` |
| [`44374730423`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44374730423), [`44380538455`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44380538455) (red, 6 s and 13 s) | intended refusals, kept as demonstrations (D6) | — |

## 8. Deferred, with the reason

- **R-1, reusing commands inside one capture.** The five plans each run `install-frozen`, `typecheck`, `lint`,
  `test` and `build` — about 13 minutes of duplicated work inside the 29 min 56 s acceptance run. It stays out of
  scope: each bundle's `commands.json` is the record of the exact invocations that produced it
  (§19.1 of the evidence requirements), so sharing a build between bundles changes what the evidence says, not
  just how long it takes. The measured acceptance number is now on the table for that decision.
- **R-2, the register reading both workflows.** `dependencies:record` still scans `ci.yml` only, so
  `actions/upload-artifact` — now referenced solely by the acceptance workflow — is invisible to
  `pnpm dependencies:verify`. `tests/unit/ci-routing/workflow-policy.test.ts` pins that action's sha directly
  and asserts the allow-list holds exactly the acceptance-only actions and nothing else, so the gap is closed by
  a test instead of by widening the tool mid-change.
- **The browser download** (§4), the `if: !cancelled()` noise in refused runs (§5), and any change to the
  capture loop's command reuse (R-1) each need their own change with their own proof.

## 9. Closeout revision (2026-11-18, after the first submission)

Four things the review asked to be closed. Implementation: **`6d91c61`** —
`ci: the outcome cannot pass on a lane that never ran, the candidate must be named, and the lanes stop paying for
apt`. This section is the evidence for each; §2 to §8 above describe the same split as it was first submitted and
are left as the record of that round, with the two changes this round made to §2 called out below.

### 9.1 The outcome cannot pass on a lane that never ran

The first version of `routine outcome` refused `failure` and `cancelled` and let everything else through, so a lane
that the router **selected** and that reported `skipped` was a pass. The new rule refuses three things:

| Refusal | Why |
| --- | --- |
| the router did not report `success` | every lane's `if:` is one of its outputs; a router that failed or was cancelled routed nothing, so no lane's result means anything |
| a lane the router selected whose result is not `success` | the shape this repository already has a unit test for — `tests/unit/udg-003/capture-loop.test.ts` was written because a CI step quietly stopped running |
| a lane the router did not select whose result is not `skipped` | a lane running off the table is the other half of the drift the table↔job-list assertions watch for |

The first submission's refusal of "a run that checked nothing" stays. The step was extracted from the YAML and run
locally first, six invocations covering seven assertions, all as expected: selected+`skipped` red,
selected+`cancelled` red, selected+`success` green, unselected+`skipped` green (the same run as the previous case —
a route that selects `records` leaves eight lanes skipped and the outcome green), unselected-but-ran red,
router-`failure` red, and nothing-selected red.

Both controls were then run hosted, as pull requests closed without merging:

| Control | Run | Result |
| --- | --- | --- |
| **passing** — a docs-only change, so the router selects `records` alone and eight lanes skip | [`44401460508`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44401460508) | green in 51 s; the log prints the full nine-row decision table (`records selected=true success`, eight `selected=false skipped`) and `routine checks passed for: records` |
| **failing** — the camera lane's `if:` gains `&& false` while a `.github/**` change escalates the router to all nine groups | [`44401507928`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44401507928) | red in 4 min 10 s: `camera was selected by the route but did not pass (skipped); a selected check that did not run is not a pass`, with the other eight selected lanes green |

A variable that lied went with it: the step printed `${GROUPS}`, and bash initialises `GROUPS` from the process
group ids rather than importing it from the environment, so on a shell where that happens the reviewer's first line
prints a uid list instead of the route. It is `ROUTE_GROUPS` now, and locally it prints `records`.

### 9.2 The candidate has to be named, in full

`candidate_sha` defaulted to blank, meaning *whatever the branch is now* — which is the exact confusion the input
exists to avoid. It is `required: true` with no default, and the guard refuses three cases **before install and
before any capture**, so a refused dispatch writes no bundle:

| Case | Evidence | Result |
| --- | --- | --- |
| blank candidate | dispatch attempt, 2026-11-18 — no run was created, so there is no run id to cite | `HTTP 422: Required input 'candidate_sha' not provided`: GitHub refuses the dispatch before a runner is hired, which is the strongest form this control can take |
| short candidate (`45b787b8`) | [`44403714403`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44403714403) | red in 10 s: `candidate_sha must be a full 40-character sha; 8 character(s) received`; artefacts `[]` |
| full candidate that is not the checkout | [`44403926011`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44403926011) | red in 24 s: `this run checked out 6d91c618790f52faa38a5b725636a728a2bc118e but was asked to verify 45b787b8d39b8ebd22b79b3ce989b9e4d6d1e1f0`; artefacts `[]` |
| correct candidate, bound end to end | [`44404109207`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44404109207) | green in 38 min 49 s on `6d91c618790f52faa38a5b725636a728a2bc118e`: `candidate confirmed` first, then `all 5 bundle(s) bound to the candidate 6d91c618790f…` after capture, five bundles verified PASS and published |

A short sha is refused rather than prefix-matched because a prefix comparison against a checkout is the one
comparison that can silently succeed on two commits.

### 9.3 One pin rule over both workflow files, seen failing

`tests/unit/ci-routing/workflow-policy.test.ts` now holds the rule as one function, `pinViolations(text, rules)`,
applied to **both** `.github/workflows/ci.yml` and `.github/workflows/acceptance.yml`: a third-party reference must
be a 40-hex sha, and that sha must either be recorded by `docs/integration/dependencies.json` or be approved in the
test file as an acceptance-only pin at exactly that sha. (The register still reads only `ci.yml`; R-2 in §8 stands.)

The rule is now known to discriminate, because a test feeds it the workflows it has to refuse
(`refuses an acceptance-only action that nobody approved`): an action neither recorded nor allow-listed
(`actions/cache@…`), a tag instead of a sha (`actions/checkout@v5`), and an allow-listed action pinned to a
different sha (`actions/upload-artifact@000…`). Three refusals, and the same rule then accepts the real acceptance
workflow in the same test — a guard that has never been seen failing is not yet a guard.

### 9.4 Camera timing: remeasured, and the cost was apt, not chromium

`44374825713` (the first camera PR) is 8 min 31 s, and the log says where it went. The unit lane's
`playwright install --with-deps chromium` took **7 min 38 s**, of which the browser download was none: apt fetched
13.2 MB of indexes in 21 s and then fetched **32.1 MB of dependency packages in 6 min 47 s at 78.8 kB/s** —
`fonts-ipafont-gothic`, `fonts-unifont`, `fonts-takao`, `libgl1-mesa-dri`, `xfonts-*` — on top of an image that
already ships the pinned chromium and its libraries. The camera lane's own suite is 2 min 41 s.

The routine lanes (`unit`, `camera`, `full-suite`) now run `playwright install chromium`. Safe here for a specific
reason, not a general one: the browser-dependent unit test, `tests/unit/udg-004/evidence-gates.test.ts`, compares
PNG bytes against ones produced in the *same* run and decodes them in the *same* chromium build, so installed fonts
and mesa packages could not change its verdict; and the golden-pixel suites do not run in a routine lane at all —
they run in `pnpm test`, which is the full-suite lane and the acceptance lane. `acceptance.yml` keeps
`--with-deps`: that invocation is what the retained bundles record, and one 30-minute job can afford the apt
traffic three parallel lanes cannot.

| Measurement | Run | Wall | Lane detail |
| --- | --- | --- | --- |
| camera route, before | [`44374825713`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44374825713) | **8 min 31 s** | unit lane 7 min 59 s (apt 6 min 47 s of it), camera lane 3 min 41 s |
| camera route, after | [`44400801523`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44400801523) | **2 min 50 s** ✅ under the five-minute target | static 42 s, unit 50 s (browser step **8 s**, suites 13 s), camera 2 min 32 s (browser step **8 s**, suite 1 min 51 s) |
| every lane, on `main` | [`44399821028`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44399821028) | **5 min 00 s** | was 11 min 13 s at `44380381929`; full-suite 4 min 30 s is now the critical path |
| all nine lanes, control PR | [`44401507928`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44401507928) | 4 min 10 s | the same shape, one lane deliberately skipped |

Chromium works without the system-package step on `ubuntu-24.04` because the image ships it: `launch()` succeeded
in every browser lane of `44399821028`, `44400801523` and `44401507928`.

**The acceptance lane kept `--with-deps`, and the cost is now visible.** The closeout acceptance run
`44404109207` took 38 min 49 s against `44380502646`'s 29 min 56 s, and the difference is one step:
`playwright install --with-deps chromium` took **10 min 16 s** of it, the same apt path the routine lanes dropped.
That is not a reason to change the acceptance lane in this revision — the command it runs is the command the
retained bundles record as producing them, and the capture loop is where the five bundles come from — but it is now
the most expensive step acceptance has, and the owner can trade roughly 10 minutes of a 39-minute run for a changed
recorded invocation. Named here so the trade is on the table rather than buried in a log.

**A cache action is therefore not adopted, and nothing new is pinned.** `actions/cache@v5` at
`1bd7e1b8f7303f4b84b6b491836e44fb3b77f52e` was checked out and verified to be MIT-licensed and v5.0.0, but its
`restore-keys`/`save-always` semantics would put the browser download on a path that no longer needs to be fast,
and the expected saving after this change is the ~8 s the install step now costs. Had the apt step been kept, the
same pin would have been worth roughly 7 minutes per browser lane under contention — still an owner call, because
it adds a third-party action to a repository whose stated position is that cache contents are a supply-chain
surface and only the sha is trusted.

### 9.5 Historical verification, run over the whole retained store

§6 compared structure. This is the comparison §6 asked for: **both verifiers over the same bundle directories**,
including the ones that failed, written to
[`evidence/ci-routing-verifier-parity.tsv`](evidence/ci-routing-verifier-parity.tsv) — one row per bundle, verdict
on each side, issue count on each side, a `delta` column, and the baseline issue codes.

| | |
| --- | --- |
| Store | `/workspace/udg-evidence` — the retained capture store |
| Population | **228 bundle directories** holding a `report.json` (220 under `ci-run-*` capture folders, 8 at the store root); by task UDG-001 90, UDG-002 76, UDG-003 47, UDG-004 15 |
| Verifier A | `tools/checks` built at the baseline commit `b2efee21caca6a4a7fe4be15d6b40e2ae6edd66a`, in a detached worktree sharing `node_modules` (the lockfile is unchanged between the two commits, so both builds typecheck against the same graph) |
| Verifier B | `tools/checks` built at the candidate `6d91c61` |
| Invocation | `node tools/checks/dist/evidence.js verify --run <absolute bundle directory> --report <file under /tmp>` — the report is written outside the store; the verifier takes the run directory as given and resolves its `artifacts/` prefix from it, so a bundle verifies in place |
| Verdicts | baseline **193 PASS / 35 FAIL**; candidate **193 PASS / 35 FAIL**; **changed verdicts: 0**; changed issue counts: 0 |
| Historical failures included | all 35, with their original codes: `EVIDENCE-FILE-MISSING` 785, `EVIDENCE-COMMAND-MISSING` 235, `EVIDENCE-VECTORS-FILE-UNLISTED` 16, `PROBE-INVOCATION-MISMATCH` 5, `EVIDENCE-VECTORS-MANIFEST-MISSING` 4, `EVIDENCE-VECTORS-REPLAY-EQUIVALENCE` 4, `EVIDENCE-PHASE-MISMATCH` 1, `EVIDENCE-GATE-NOT-PASS` 1, `EVIDENCE-SECRET` 1 — none was re-run, re-judged or repaired |
| Original bytes preserved | measured, not assumed: a manifest of every file in the store (`path\|size\|mtime`, **14 927 files**) hashes to `7851bd3d3b4045bc539c0ce1021dd3cf51be77e8426104b4e07ae8a6498cf32e` before and after a full pass of verifier B, same file count. The `UDG-003-TASK` whole-task bundle is not in this store copy, so its parity is the acceptance comparison in §5 instead |

Together with §6's tree comparison — no changed file under `docs/validation/`, no changed capture plan, no changed
checksummed requirement, `tools/checks` differing only in `parseCiActions` — this is the claim stated narrowly: the
candidate verifier reaches the same verdicts as the baseline verifier over every bundle the store retains, and the
store it read is byte-for-byte what it was.

## 10. Owner-side action

1. **Branch protection does not exist yet.** `GET /branches/main/protection` returns `404 Branch not protected`,
   so there is no old check name to rename — nothing in this change can be broken by protection, and nothing is
   currently required either. To require the routine lane, protect `main` and require the check named
   **`routine outcome`**. Requiring the individual lane checks is possible but wrong: they appear and disappear
   with the route, which is exactly what a required-check list cannot track.
2. **Three pull requests are open and should be closed, not merged**: #1, #2 and #3 are measurement fixtures whose
   entire diff is a comment saying it is a measurement fixture. Their runs stay retained either way, which is why
   the numbers in §4 are clickable. The branches `probe/ci-routing-*` can be deleted once closed.
3. **Decide the deferred items** in §8, in particular whether the browser cache is worth a new pinned action —
   that decision is what moves the camera case from 8 min 31 s to under 5 min.

## 11. What this record does not claim

No task, phase, gate or milestone is accepted, Verified or closed by anything here, and no historical bundle was
re-run, re-judged or removed. The routine lane is green on the candidate, the acceptance lane is green on the
candidate, and the two red-to-green iterations above are part of the record rather than hidden from it. UDG-001's
suite has two failures in this container (`v24.22.3` against the pinned `v24.22.2`, and the register check that
reads that version) and they are the container, not the repository: both pass on the pinned hosted runners in every
run linked above.
