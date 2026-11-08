# UDG-001 completion record

Appendix B2 record for the authorised UDG-001 implementation. Like the assignment record this file
sits outside the edition-controlled [checksum manifest](../checksums.json) and pins its own commits.
The reviewer and gate decision fields at the foot of this record belong to the owner; they were
filled in on 2026-11-08 when the owner accepted the work, and they are transcribed from the owner's
instruction rather than judged by the implementer.

```text
Task ID and final implementation SHA:
  UDG-001 Workspace and CI.
  Final implementation commit: 1c735c2d845e399cc8b3cc33adac4ba7a6081387
  Implementation commits, oldest first:
    1a136ab7d5dccdbc48912b1469a68e68e7ea4efb  workspace, pins, workspaces, @udg/checks, contract suite
    99021b5691e9523b5f24b611c81820f414123c9c  .github/workflows/ci.yml
    db6a7da4014e1a290e5c3cbe9045aa5c835925d4  docs/integration/dependencies.json, README, checksums
    c5acde09e96c009aaaad88ff556b9a52b087eace  machine-path aliasing, checksums generator, fixes
    50205c0b8c9a0c8731d5c390029c2d1f8adac6e2  committed evidence summary mode and its test
    0faf872cbd0197bd7cfec51c351690a994ed89ab  ci: full-history checkout (CI finding, see below)
    9472fa50e033b6ae3787f2d698157ae9968caa23  fix(checks): host-independent dependency register (CI finding)
    13089be842b12d2906f2eeb1a355ad71478d9d84  feat(checks): summary records its CI outcome
    50c6cee34d07e946837cb161cc7b27b18394e877  fix(ci): evidence checks must be able to fail the run
    1c735c2d845e399cc8b3cc33adac4ba7a6081387  fix(evidence): a bundle that did not pass is never
                                             verified or summarised
  The commit that contains this record adds only planning documents (this file, the updated
  assignment record, the UDG-001 metadata evidence and CI lines, the regenerated evidence summary,
  the README evidence-policy text and the refreshed checksum manifest). No source file changes after
  1c735c2, which is the accepted implementation. Earlier revisions of this record were themselves
  published and green - cbab29dceea8816fdd8174177767c5a31ee0430e, Actions run 42511404907, 19/19
  steps - and the commit carrying these words adds only record lines.

CI verification (published, executed on GitHub-hosted runners):
  Pushed to github.com/TomBResearch/UntitledDinosaurGame branch main as a fast-forward from the
  reviewed prerequisite commit 555735b6b3b2b72ec23fb99f2db26cbe3cef67a2; no force-push, no history
  rewrite, no git configuration change and no credential-scope change was made by the implementer.
    Run 42479027084  commit 0faf872  conclusion failure
      Only the step "Verify the committed dependency register" failed (exit 1, "is stale"). Root
      cause: docs/integration/dependencies.json records the architecture of the machine that ran
      pnpm dependencies:record, and the staleness comparison hashed runtime.host as well as the
      repository-controlled fields, so an arm64 developer checkout could never match a
      GitHub-hosted linux-x64 runner. Every other step passed, including the task suite.
      Fix 9472fa5: the register now declares which fields are provenance
      (generated.at, generated.commit, runtime.host) and excludes them on both sides of the
      comparison; engine pins, lockfile hash, workspace dependency tables, direct package versions
      and licences, deferred library groups and CI action pins are still compared exactly.
      tests/contracts/UDG-001.test.ts now proves a foreign-host register verifies while a package
      version drift, an action-pin drift, an engine-pin drift and a missing register are refused.
    Run 42479473061  commit 9472fa5  conclusion success  job 128728049492  12:16:43Z to 12:17:55Z
      17 of 17 steps success; artifact udg-001-evidence (id 13616912426, 16,253 bytes).
    Run 42479920170  commit 13089be  conclusion success  job 128729421451  12:22:14Z to 12:23:15Z
      17 of 17 steps success; artifact udg-001-evidence (id 13617226394, 16,202 bytes, retained 30
      days by the workflow's retention-days: 30 setting).
      https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/42479920170
      The workflow ci runs on ubuntu-24.04 with Node 24.22.2 and corepack-pinned pnpm 12.18.0, from
      a frozen lockfile, with every third-party action pinned to a commit sha, and publishes the
      evidence directory even on failure. Runner reported linux/x64; the checkout recorded
      ci true and gitDirty false in the captured bundle.

Scoped reviewer correction (evidence checks must be able to fail the run):
  The reviewer returned the submission with one scoped finding: "Capture the foundation evidence
  bundle" and "Verify the captured evidence bundle" both ran with continue-on-error: true, and the
  upload step used if-no-files-found: warn, so a workflow could finish green while its evidence
  capture or verification failed, or while no evidence was published at all. Fixed in 50c6cee:
    - no step in the job sets continue-on-error; every step's exit status now decides the run, and
      tests/contracts/UDG-001.test.ts asserts that no step may declare the key at all;
    - the evidence steps keep if: !cancelled(), which is what keeps them running after an earlier
      failure so a red run still produces diagnostics rather than a skip;
    - a new step, "Assert the required evidence artefacts exist", fails when the run pointer is
      absent, when any of report.json, environment.json, commands.json, junit.xml,
      boundary-report.json, build.log or checksums.sha256 is missing or empty, or when no command
      log under logs/ has any bytes;
    - the publication step now uploads the pointer plus the run directory and treats a missing
      artefact as an error (if-no-files-found: error), verified to fail on a real runner;
    - the same step now also publishes the per-run sanitised summary, which the verify step writes
      only after verification succeeds.
  Demonstrated on GitHub-hosted runners, not only locally:
    Run 42508948276  commit 50c6cee  conclusion success  19/19 steps  artifact udg-001-evidence
      (id 13627784376, 20,556 bytes) - the corrected workflow is green on its own merits, including
      the new assertion step and the stricter upload policy.
      https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/42508948276
    Run 42509775271  negative probe  conclusion failure (by design). Three jobs on the throwaway
      branch udg-001-ci-negative-probe at 24cc93bd518631bbf3d2fac3c5175b845ab4c9b7, deleted after
      the run; main was never moved by it and its workflow file was the probe file only on that
      branch. PROBE 1 started no capture: the step failed, the assertion reported "evidence capture
      wrote no run pointer", verification reported EVIDENCE-REPORT-MISSING and the upload errored -
      job failure. PROBE 3 published nothing: "No files were found with the provided path:
      artifacts/latest-UDG-001.txt" - job failure. PROBE 2 was intended to corrupt a captured
      bundle and in fact never got the chance; what it exposed instead is set out in the next two
      paragraphs. Its job still failed, and its diagnostic upload still succeeded.
      https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/42509775271
  What PROBE 2 actually did, read from its runner log and the bundle it published. The step "Corrupt
  the captured bundle (simulate missing junit results)" was **skipped**, because the capture step
  before it had already failed and the probe job had no continue-on-error. Capture failed for a
  reason of the probe's own making: replacing .github/workflows/ci.yml with the probe file broke
  seven tests in the suite that reads that file (step count, the published artefact name, the script
  list and the prerequisite-commit lookup that needs fetch-depth: 0), so the captured pnpm test and
  pnpm test:contract both exited 1. Capture still wrote a complete bundle that honestly recorded
  status FAIL with 48 tests and 7 failures, and returned non-zero - and that exit code was the only
  thing that made the job red. The new assertion step passed, because every artefact really was
  present, and the verifier then in use passed the same bundle:
  "PASS evidence verify artifacts/UDG-001-2026-11-08T18-23-42-322Z-24cc93bd (0 issue(s))". A bundle
  recording a failing gate therefore cleared both evidence checks and was published as evidence.
  Verification audited integrity - hashes, artefacts, counts, sanitisation - but never the recorded
  gate outcome.
  That is a runner observation about the pre-fix verifier, recorded as an observation: it belongs to
  commit 50c6cee plus the probe branch and cannot be reproduced on main, because main no longer
  contains the verifier that produced it. The fix it motivated is 1c735c2, and the fix is proved
  separately, in two ways. The regression test in tests/contracts/UDG-001.test.ts builds a bundle
  with the production writer whose every hash matches but whose status is FAIL, and asserts exactly
  one issue code EVIDENCE-GATE-NOT-PASS, a non-zero verify exit and that evidence:summary writes no
  file at all. Independently, re-running the corrected verifier over the retained probe bundle now
  returns exactly that single issue on the original bytes, which is a check the reviewer can repeat:
  pnpm evidence:verify -- --run <durable>/probe-run-42509775271/UDG-001-2026-11-08T18-23-42-322Z-24cc93bd
    Run 42510445695  commit 1c735c2  conclusion success  19/19 steps, no failed step, artifact
      udg-001-evidence; the published bundle UDG-001-2026-11-08T18-32-23-165Z-1c735c2d verifies with
      0 issues after download.
      https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/42510445695
    Run 42511404907  commit cbab29d, the record commit carrying this file  conclusion success
      19/19 steps, no failed step; bundle UDG-001-2026-11-08T18-44-15-487Z-cbab29dc downloaded and
      verified with 0 issues, so the published head of main is itself a green run.
      https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/42511404907

Contract revision and prerequisite SHAs:
  UDG-CONTRACTS-M0-001 v1.0, repository edition 1.
  docs/contracts/README.md            255e7b2cb8fd64c41e2e5beb2a56b03bb62b08e0ca11089299d81a2e540a5943
  docs/contracts/UDG-001.md           d0fd0e24220c80f06cb9e3fc99cfaffb06e233680abf774162e5e0daefc0c171
                                      (the bytes at assignment). Its In Review edition,
                                      8d14ed5eda08b7b151069576dae18decaeb0403e0d4c20b902f2f298ccb15d80,
                                      is what the 13089be foundation runs read. The edition the
                                      authoritative 1c735c2 runs read is
                                      8f2842f4edb4f4c959c525b63fd6b218919052919272dda97309de9a4ade6635;
                                      the commit carrying this record edits only that file's evidence
                                      and CI metadata bullets, giving
                                      7b181f958fa54cfeceaaaa838e3743ea485266e5e075c51f8ee3f605e97efbb8.
                                      No requirement text moved in any of these editions.)
  Baseline UDG-SPEC-M0-002 v0.2       b51e7afdd6810c377d2d2702d7673119521a59cd0d6b91686700bf9149b73fcf
  Prerequisite commit (no prerequisite task): 555735b6b3b2b72ec23fb99f2db26cbe3cef67a2
  Assignment/approval commit: 680773c0e2228769085c06cd62bf5236d63feb45 (P01 approved, C-01 to C-06)
  Reviewed edition manifest digest at assignment: 56 entries,
    1b33cc20128ab75c59591448496164e30039018691e2a7d85ab21d7372926257
  Manifest at submission: 56 entries, regenerated with pnpm contracts:checksums -- --write and
    re-verified byte-for-byte by the contract suite.

Files added or changed and scope deviations:
  Root controlled files created (all named in repository.md 3.1): package.json,
  pnpm-workspace.yaml, pnpm-lock.yaml, tsconfig.base.json, eslint.config.mjs, vitest.config.ts,
  playwright.config.ts, .node-version, .npmrc, .gitignore, .env.example, README.md,
  .github/workflows/ci.yml.
  Workspace skeletons, each package.json + tsconfig.json + src/index.ts exporting nothing:
  packages/{protocol,config,simulation,physics,navigation}, apps/{server,client}.
  Check tooling: tools/checks/package.json, tools/checks/tsconfig.json,
  tools/checks/src/{boundaries,fixtures,evidence,run-contract}.ts.
  Tests: tests/contracts/UDG-001.test.ts and tests/fixtures/boundaries/{allowed,cycle,
  forbidden-client-server,forbidden-engine,forbidden-browser-global,
  forbidden-undeclared-and-config,strict-type-errors}.
  Records: docs/integration/dependencies.json, docs/contracts/adoption.md (P01 decision, written
  before implementation in 680773c), docs/contracts/checksums.json, this record,
  assignments/UDG-001.md and assignments/UDG-001-evidence.json.

  Declared additions beyond the contract file list, submitted for reviewer acceptance:
    A1 tsconfig.json (root project). repository.md 3.1 names tsconfig.base.json only. Tests,
       vitest.config.ts and playwright.config.ts must be typechecked somewhere, and adding them to
       tsconfig.base.json would push test-only ambient types into every game workspace. The root
       project holds them with types: ["node"] and excludes fixtures, e2e and spikes.
    A2 tools/checks/src/support.ts, dispatch.ts, index.ts. One place for workspace discovery,
       import extraction, sanitisation, the guarded-command table and the library surface, so the
       four named modules do not duplicate them. dispatch.ts exists so the five later-task commands
       share one attributed refusal instead of five copies in package.json.
    A3 Three extra boundary fixtures (forbidden-browser-global, forbidden-undeclared-and-config,
       strict-type-errors). UDG-001 acceptance requires demonstrating detection of a runtime
       browser global and rejection of invalid TypeScript, which the four named directories cannot
       express. All three use the same fixture.json shape and are pinned like the named ones.
    A4 Extra root scripts beyond the section 3.2 table: clean, typecheck:root, lint:source,
       lint:boundaries (composition internals), plus dependencies:record, dependencies:verify,
       evidence:capture, evidence:summary, contracts:checksums (regenerators the owner can re-run)
       and a guarded test:unit that currently refuses. Every section 3.2 command exists; the extras
       never replace one.
  Deviations inside an owned file, reported rather than hidden:
    D1 skipLibCheck is true in the root tsconfig.json only; tsconfig.base.json keeps it false for
       all game workspaces. Reason recorded in that file: two vendored declaration bundles cannot
       be checked under a non-DOM lib (playwright-core/types/types.d.ts references SVGElement,
       HTMLElement and HTMLElementTagNameMap; vitest's bundle default-imports node:path). Repository
       source is still fully checked.
    D2 TypeScript is pinned to 5.9.3, not the 7.x line available on the registry, because the
       pinned typescript-eslint 8.72.1 declares peer typescript ">=4.8.4 <6.1.0". Recorded in
       dependencies.json toolchainNotes. Moving the compiler line is a pin decision for the owner.
    D3 repository.md 3.1 asks for "the Colyseus server, SDK, schema and testing versions as a tested
       compatibility set". Owner clarification C-02 defers that selection to the tasks that need it,
       so dependencies.json lists seven game library groups as not-selected with their owning task,
       and this record claims no tested compatibility set. No version was invented to fill the row.

Public interface/schema/config changes:
  No protocol, schema, configuration or domain interface is defined by this task; P02 to P10 remain
  pending. Each game workspace exports exactly one entry point "." pointing at an empty module, and
  @udg/protocol deliberately has no "./schema" entry yet. @udg/checks exposes CLIs (boundaries,
  fixtures, evidence, run-contract, dispatch) and a library surface used only by the test suite; it
  depends on no @udg/* workspace. .env.example documents loopback addresses and ports 2567 and 5173
  and contains no secret. No deploy workflow was added.

Actual package and WASM versions/hashes:
  Runtime: Node v24.22.2 (pinned in .node-version, engines and CI), pnpm 12.18.0 (packageManager
  field, corepack, engines, verified by running pnpm --version inside the suite).
  Direct dependencies, exact, no ranges: @eslint/js 10.0.1 (MIT), @playwright/test 1.65.0
  (Apache-2.0), @types/node 24.19.2 (MIT), eslint 10.14.0 (MIT), typescript 5.9.3 (Apache-2.0),
  typescript-eslint 8.72.1 (MIT), vitest 5.1.0 (MIT). @udg/checks is workspace-internal.
  Lockfile pnpm-lock.yaml sha256 d2cccebdb42f5686c8d7b172a0810d07b95cc73685690459c0ea225291e202c8.
  CI actions pinned by commit sha: actions/checkout 3d3c42e5aac5ba805825da76410c181273ba90b1 (v7.0.1),
  actions/setup-node 949feb2413d6458794dcd2491c4babbbce0c15c1 (v7.1.0), actions/upload-artifact
  cf430e030ddbb5b0abf93d22962f4752f3646cd9 (v7.0.2).
  WASM: none. No Rapier or Recast dependency exists, so no WASM hash is claimed; only
  pnpm-workspace.yaml's empty onlyBuiltDependencies allowlist stands between a future dependency and
  running an install script (verified behaviour: an unlisted script aborts with
  ERR_PNPM_IGNORED_BUILDS, demonstrated during this task).

Commands with exit codes and test counts:
  Authoritative local foundation run UDG-001-2026-11-08T18-31-49-723Z-1c735c2d, captured by
  pnpm evidence:capture on commit 1c735c2 with a clean working tree (linux/arm64, Node v24.22.2,
  pnpm 12.18.0), 18:31:49.775Z to 18:32:06.410Z:
    install-frozen          pnpm install --frozen-lockfile   exit 0     65 ms
    typecheck               pnpm typecheck                   exit 0   3,446 ms
    lint                    pnpm lint                        exit 0   1,858 ms
    test                    pnpm test                        exit 0   3,615 ms
    build                   pnpm build                       exit 0   1,892 ms
    test-boundaries         pnpm test:boundaries             exit 0   1,081 ms
    test-fixtures           pnpm test:fixtures               exit 0   1,078 ms
    test-contract-UDG-001   pnpm test:contract -- --task …   exit 0   3,596 ms
  Same eight commands from the same commit, executed by the workflow on a GitHub-hosted
  ubuntu-24.04 linux-x64 runner (bundle UDG-001-2026-11-08T18-32-23-165Z-1c735c2d, published as
  artifact udg-001-evidence of run 42510445695): all exit 0, total 27,257 ms
  (install 92, typecheck 6,347, lint 2,888, test 4,983, build 4,028, boundaries 1,757,
  fixtures 1,764, contract 5,398 ms).
  The submission run on 13089be (local UDG-001-2026-11-08T12-37-46-915Z-13089be8 and CI bundle
  UDG-001-2026-11-08T12-22-46-897Z-13089be8 of run 42479920170) is retained unchanged as the record of
  what the reviewer reviewed; all sixteen of its commands also exited 0.
  Tests: 49 passed, 0 failed, 0 errors, 0 skipped, 0 quarantined, no duplicate case names in 1 file,
  on both machines (43 at the 13089be submission run, also on both). Boundary check on the real tree:
  14 files, 0 violations. Fixture manifests: 7 valid. pnpm evidence:verify: PASS with 0 issues on the
  local bundle and on the downloaded CI bundle. pnpm contracts:checksums: in sync.
  pnpm dependencies:verify: in sync locally and on CI.
  Refusals exercised, each with its exit code asserted: pnpm test:contract for the other ten task
  ids exits 2; pnpm test:e2e, test:spike, test:unit, assets:build and assets:verify exit 1 with the
  owning task named; an unknown task id and an unknown guarded command exit 2 with usage.
  Capture attempts discarded as superseded after defects they exposed were fixed, not retained as
  evidence: UDG-001-2026-11-08T11-25-15-540Z-db6a7da4, UDG-001-2026-11-08T11-26-34-670Z-c5acde09
  and UDG-001-2026-11-08T11-36-22-801Z-50205c0b. The CI bundle of run 42479473061 (commit 9472fa5)
  is retained because it is the run that proves the dependency-register fix.

Positive, negative, lifecycle and race coverage:
  Positive: allowed dependency fixture passes with zero violations; the real tree passes the same
  checker; seven fixture manifests validate including pinned file hashes and the configuration hash.
  Negative, each asserting the reason and not merely a failure: engine import in simulation
  (BOUNDARY-ENGINE-FORBIDDEN), client importing server code (BOUNDARY-CLIENT-SERVER), runtime
  browser global in a shared package, undeclared dependency plus a DOM lib in a non-client
  workspace, package cycle (BOUNDARY-PACKAGE-CYCLE) and intra-package cycle, cross-package relative
  import, and the live injection test that adds a Rapier import to a copy of the allowed fixture and
  expects exactly BOUNDARY-ENGINE-FORBIDDEN. A stale expectation is also proven to fail: with both
  cycles removed from a copy, fixture mode exits 1 reporting "expected a rejection, got no
  violations; missing expected rule ids: BOUNDARY-CYCLE".
  Compiler: tests/fixtures/boundaries/strict-type-errors must fail with exactly TS2304, TS2366,
  TS2375, TS2532 and TS7006 - implicit any, nullable dereference, missing exact-optional property,
  unknown name and a non-boolean return path.
  Lifecycle: the frozen install is run twice at the repository root and the tracked-file set is
  compared before and after, so a second installation must change nothing; minimal workspace copies
  are installed in disposable directories to prove a version mutation and an unlocked manifest
  addition are both refused.
  Evidence: bundles are built with the production writer and then mutated - a changed file, a
  removed artefact, zero discovered tests, a skipped test, a duplicated case name from a rerun, a
  PASS report whose command exited non-zero, a bundle that is internally consistent but records
  status FAIL, an injected GitHub token and a private home path, a bundle with no measured values, a
  report referencing a path outside the bundle, and a bundle whose own capture recorded sanitisation
  failures. Each must produce its specific EVIDENCE-* code, and the FAIL-status bundle must also stop
  evidence:summary from writing any file at all.
  CI workflow policy: the suite parses .github/workflows/ci.yml itself (a strict structural reader
  that refuses to assert vacuously on a restructured file), demands that no step declares
  continue-on-error, demands if: !cancelled() on the capture, assertion, verification and publication
  steps, demands if-no-files-found: error and the pointer-plus-run-directory upload paths, maps a
  non-zero exit from each of those steps to a failed job conclusion, and then executes the assertion
  script with bash against four real situations: an artifacts/ directory with no pointer, a pointer
  whose bundle lacks junit.xml and has only empty logs, a complete bundle, and a directory where
  capture could not even start (the real evidence CLI is run for UDG-999 there and leaves no pointer,
  after which the assertion fails and the real verify CLI reports EVIDENCE-RUN-MISSING).
  Race coverage: none. There is no concurrency, timer, timestep, input ordering or reconnection code
  in this task; ordering and race proofs belong to UDG-005 and the spike tasks.

Requested versus achieved network profiles:
  Not applicable and not exercised. LAN, moderate, elevated and poor profiles with achieved RTT and
  jitter statistics belong to UDG-SPIKE-001 to UDG-SPIKE-003. report.json records the requested and
  achieved profile lists as empty with that note, and pnpm test:spike refuses with exit 1, so no
  profile claim is possible from this task.

Acceptance thresholds and measured results:
  Every populated workspace typechecks, lints and builds            measured 8 workspaces, all
                                                                     green in the commands above
  Clean second installation leaves tracked files unchanged           PASS (tracked-file diff empty)
  Allowed fixture passes, each forbidden edge/cycle fails for the
  expected reason                                                    PASS, 6 boundary fixtures,
                                                                     5 reject + 1 allow, all matched
  Runtime browser global in a simulation context is detected         PASS (forbidden-browser-global)
  Invalid TypeScript fixture fails strict checking                   PASS, TS2304/TS2366/TS2375/
                                                                     TS2532/TS7006, exact code set
  Missing test suite fails rather than passes                        PASS, exit 2, names the task
                                                                     and its contract path
  Modified lockfile rejected by a frozen install                     PASS for a version mutation and
                                                                     for an added dependency
  CI reproduces the local result                                     PASS. Run 42510445695 on
                                                                     commit 1c735c2, GitHub-hosted
                                                                     ubuntu-24.04 linux-x64, 19/19
                                                                     steps success, all eight
                                                                     commands exit 0, 49 tests, and
                                                                     its published evidence bundle
                                                                     verifies with 0 issues. The
                                                                     evidence policy was also
                                                                     exercised in the negative by
                                                                     probe run 42509775271: a capture
                                                                     failure and an absent artefact
                                                                     each failed a job on their own,
                                                                     while the third job showed that
                                                                     neither the assertion nor the
                                                                     then-current verifier would
                                                                     catch a bundle recording a
                                                                     failing gate - the gap closed
                                                                     by 1c735c2. See the
                                                                     scoped-correction section.
  README startup prerequisites complete                              PASS: OS prerequisites, exact
                                                                     install/check/run/stop commands,
                                                                     ports 2567/5173, loopback
                                                                     binding, ready-signal contract,
                                                                     shutdown, per-command
                                                                     availability and evidence rules
  Toolchain pins (C-01)                                              node v24.22.2, pnpm 12.18.0
                                                                     observed while running
  No game library selected (C-02)                                    7 pending groups, lockfile
                                                                     contains no @colyseus, @dimforge,
                                                                     recast-navigation or @babylonjs
  Suite dispatch (C-04)                                              10 of 11 task ids refuse;
                                                                     5 guarded commands refuse
  Raw evidence verification (C-04)                                   PASS on the real bundle and on
                                                                     every corrupted copy above
  Full measured set is embedded in report.json under "measured" and mirrored in the committed
  summary, including the boundary rule-table hash 8b423148e09f... and fixture configuration hash
  141ad56e3f81....

Raw evidence directory and integrity result:
  Committed pointer: docs/contracts/assignments/UDG-001-evidence.json (sanitised summary with the
  SHA-256 of all 21 artefacts plus the CI run url, per owner clarification C-03; raw bundles are
  not committed). Its ci.note field is generator text written when the bundle was captured, i.e.
  before acceptance, so it states the C-05 rule as it stood then ("stays In Review until the
  reviewer accepts"). It is not a current status claim: the status, verification, implementationSha,
  testCounts and ci.url fields are the facts, and the acceptance itself is recorded in this file, in
  the assignment record's state history and in docs/contracts/adoption.md.
  Raw bundles, owner-reachable durable storage under /workspace/udg-evidence:
    UDG-001-2026-11-08T18-31-49-723Z-1c735c2d                   local linux/arm64 authoritative run
      report.json sha256 e07293e74db3a43edcd19c2bc48a47d075a707a9e2e29b3cf1308d08e7e7e2c8
    ci-run-42510445695/UDG-001-2026-11-08T18-32-23-165Z-1c735c2d  CI bundle, downloaded from the
      artifact udg-001-evidence of the green run, plus the CI-written sanitised summary
      report.json sha256 5c435eebdba91b46c0da691bc344979faa781af0eb6b17c214c6aca3444b8c4f
      full runner log sha256 473220e1dcde18210ba34e0d3ecc9238fd081803e1eee63e037102201c7c3589
    UDG-001-2026-11-08T12-37-46-915Z-13089be8                   local run of the reviewed submission
      report.json sha256 d3d5b098b579bdd6a6545d2ccfcc5c055b0785cd225945bb0bbfef39a461f142
    ci-run-42508948276/                                          bundle, CI summary and runner log of
      the first green run of the corrected workflow on 50c6cee
    ci-run-42479920170/UDG-001-2026-11-08T12-22-46-897Z-13089be8   submission CI bundle, downloaded
      from artifact udg-001-evidence of that green run
      report.json sha256 cae97b8fdc932a6e5cb960b54eb745e2ee8e5db64e479ece0a3e0b581594e1e2
      full runner log sha256 be7ea60367d24d12ca9455312e9f2921b89a15e523059f3c40d646873504684a
    ci-run-42479473061/                                   bundle and runner log of the green run
      that validated the dependency-register fix on commit 9472fa5
      full runner log sha256 f5d1d90651d53989166c160ef89a7a81ce77a0bed764eecc709f6ccbe15e0603
    probe-run-42509775271/                                 the negative-probe publication: the bundle
      that the pre-fix verifier wrongly accepted (status FAIL, 7 failing tests), the run pointer the
      probe uploaded, the raw runner log (sha256
      073c5424a8b0f401e1a084c023519fecdceb00b8a569329bcb211e7ab04783a4) and a README explaining that
      this directory is a deliberate counterexample, not a passing run
    ci-run-42511404907/                                  bundle, CI summary and runner log of the
      green run on revision cbab29d of these record files
      report.json sha256 2cfddf38a23ab9324555a41ef4cc10a1249cd8b98262804b6caf372a8231c4c7
      full runner log sha256 1c4da07bc704399fb643901b53160e7d043eee9aac5a61f55e9541d07e6040f5
    inventory.json                                        sha256
      aa0293d2fa613271d7f7e067b690747322f0af32dede325d825d7a7da205edc6, 210 files, every retained
      byte covered by name, size and hash; the inventory note states that it covers the retained set
      through run 42511404907, so artifacts of later docs-only runs are appended by the owner
  Contents per bundle: report.json, environment.json, commands.json, junit.xml,
  boundary-report.json, build.log, logs/*.log, checksums.sha256 and a .keep marker.
  Integrity: pnpm evidence:verify -- --run <bundle> => PASS with 0 issues for the local bundle and
  for the downloaded CI bundle. The two bundles agree on commit, test counts and every config hash,
  which is the cross-machine reproduction the contract asks for. The same command run over the
  retained probe bundle returns FAIL with exactly EVIDENCE-GATE-NOT-PASS, which is the counterexample
  the correction needs. Hashes in report.json and checksums.sha256 are cross-checked against the
  bytes on disk by the verifier.
  Sanitisation: working directory recorded as REPO_ROOT, host as a per-run runner alias, home as
  <HOME>, temp as <TMP>, pnpm store as PNPM_STORE, bundle directory as BUNDLE_ROOT. Capture
  self-checks every artefact it writes and refuses PASS on a leftover machine path; the verifier
  rejects a PASS bundle whose own capture record reports sanitisation failures. No credential,
  token, cookie, environment dump, user name or private path appears in a bundle or in any
  committed file. The raw runner logs are retained only in durable storage; they contain the
  runner's own filesystem paths and are never committed.
  The owner must mirror /workspace/udg-evidence to whichever store they designate as durable; that
  path is this checkout's shared evidence directory, not a Git-tracked copy.
  Hash drift to expect when re-verifying: report.json configHashes.taskContract is
  8f2842f4edb4f4c959c525b63fd6b218919052919272dda97309de9a4ade6635, the bytes of
  docs/contracts/UDG-001.md at run time; the record commit edits only that file's evidence and CI
  bullets, giving 7b181f958fa54cfeceaaaa838e3743ea485266e5e075c51f8ee3f605e97efbb8. Everything else
  the bundles pin still matches the committed bytes exactly, including the corrected CI workflow
  (55c38813e8e2659325c4fb02d24fdedd2ca26deb498c4ed2a498d9db1c3d99bc), tsconfig.base, the boundary rule
  table, the fixture configuration, .env.example, .npmrc and the lockfile - unlike the submission run,
  whose workflow hash had already moved because the workflow was fixed after capture.

ADRs accepted, rejected or still proposed:
  None proposed, none accepted, none rejected. No genuine contract conflict was found inside the
  approved scope. The repository.md 3.1 tested-compatibility-set sentence versus clarification C-02
  is recorded above as deviation D3 rather than resolved locally, because the owner's clarification
  already governs it. P02 to P10 remain Pending and were not treated as approved anywhere.

Limitations and remaining downstream work:
  1. CI reproduction is executed and green, and the reviewer has recorded acceptance (2026-11-08),
     so UDG-001 has no open acceptance condition. Four defects were found only by running on
     GitHub-hosted runners and each is fixed with a covering test: the shallow checkout could not see
     the prerequisite commit (0faf872), the dependency register was not host-independent (9472fa5),
     evidence capture and verification could fail without failing the run and a missing artefact was
     only a warning (50c6cee), and verification accepted a bundle whose own record said the gate
     failed (1c735c2). The last two were demonstrated on a runner by a purpose-built failing workflow
     rather than inferred, because nothing in this container can execute a GitHub Actions job. That
     dependency on a real runner is now recorded rather than assumed away.
  2. Local execution happened on Linux aarch64 and CI execution on GitHub-hosted Linux x64.
     README states Linux/macOS support, but macOS has never been exercised, and no client or browser
     path exists yet to exercise either. The CI-to-local agreement therefore proves linux arm64 and
     linux x64 only.
  3. pnpm was made available through corepack in this environment; a fresh machine needs
     "corepack enable" first, which README documents. No global toolchain was modified.
  4. No unit suite exists yet, so pnpm test currently discovers exactly one real suite (this task's
     contract suite) and pnpm test:unit refuses by design. UDG-002 must point test:unit at
     tests/unit/ when its first unit suite lands.
  5. The dependency boundary checker is a static import/ambient/browsers-global analysis with a
     declared-dependency cross-check. It proves the source-level rules named by ownership.md 2.3 for
     the current skeleton; it is not a full type-level or runtime module-graph proof, and it will
     need extension when UDG-002 introduces the schema entry points and when engine SDKs arrive.
  6. Evidence verification covers the schema, artefact presence, hash and count integrity, skip and
     flake detection, exit-code consistency and secret/path scanning. Trace, metrics, browser and
     decisions directories are recorded as not applicable with per-directory reasons; the spike
     tasks must extend the plan rather than reinterpret this bundle.
  7. tools/load-test was not created, as the contract directs until Gate A needs it.
  8. Nothing in this task proves any gameplay, network, physics, navigation or asset behaviour, and
     it does not pass any gate. Gates A, B and C remain Not Run, and UDG-002 to UDG-SPIKE-003 remain
     Not Started.

Implementer recommendation: In Review or Blocked
  In Review at submission. Every acceptance condition in UDG-001.md has measured evidence, including
  CI reproduction on GitHub-hosted runners and a runner-executed demonstration that the evidence
  checks cannot fail silently. Superseded on 2026-11-08: the reviewer accepted the work and the task
  is Verified - see the decision fields below. Not Blocked: no contract conflict or failing check
  remains, and no requirement was relaxed to obtain that state.
  Recommended reviewer actions, kept as the reproduction path for the record and repeated by the
  owner before acceptance: read the declared additions A1 to A4, deviations D1 to D3 and the
  scoped-correction section above, then run
  pnpm install --frozen-lockfile && pnpm test && pnpm test:contract -- --task UDG-001, re-run
  pnpm evidence:verify against the retained local and CI bundles (and against
  probe-run-42509775271/UDG-001-2026-11-08T18-23-42-322Z-24cc93bd, which must come back
  EVIDENCE-GATE-NOT-PASS), and open the Actions run url recorded in
  docs/contracts/assignments/UDG-001-evidence.json together with probe run 42509775271.

Reviewer decision and date:
  **Accepted, 2026-11-08**, by the project owner, GitHub account TomBResearch, recorded here on the
  owner's instruction.
    Accepted implementation 1c735c2d845e399cc8b3cc33adac4ba7a6081387
    Reviewed submission    0e586b619796597266f7ec4942d24231dfb5ce62
    Passing submission CI  https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/42511785889
  The acceptance covers the implementation and both scoped corrections, the declared additions A1 to
  A4 and the deviations D1 to D3. Task state In Review -> Verified, recorded in
  docs/contracts/UDG-001.md, docs/contracts/adoption.md and the assignment record's state history.
  This decision is written down only because the owner gave it; an agent submission is never accepted
  on its own authority.

Integration owner gate decision and date:
  Recorded 2026-11-08 by the same owner instruction. UDG-001 is accepted as above, and its foundation
  evidence is its own bundle, which verifies with zero issues on both the local linux/arm64 run and
  the GitHub-hosted linux-x64 run. **No gate pass is claimed here**: Gates A, B and C remain Not Run,
  no spike gate depends on UDG-001, and refinements P02 to P10 remain Pending. Assigning the next
  task needs a separate owner decision on the relevant proposal group plus an explicit assignment.
  Integration owner: project owner, GitHub account TomBResearch.
```
