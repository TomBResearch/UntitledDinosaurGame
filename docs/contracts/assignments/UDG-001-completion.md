# UDG-001 completion record

Appendix B2 record for the authorised UDG-001 implementation. Like the assignment record this file
sits outside the edition-controlled [checksum manifest](../checksums.json) and pins its own commits.
Reviewer and gate decisions are left pending on purpose; they are the owner's to record.

```text
Task ID and final implementation SHA:
  UDG-001 Workspace and CI.
  Final implementation commit: 50205c0b8c9a0c8731d5c390029c2d1f8adac6e2
  Implementation commits, oldest first:
    1a136ab7d5dccdbc48912b1469a68e68e7ea4efb  workspace, pins, workspaces, @udg/checks, contract suite
    99021b5691e9523b5f24b611c81820f414123c9c  .github/workflows/ci.yml
    db6a7da4014e1a290e5c3cbe9045aa5c835925d4  docs/integration/dependencies.json, README, checksums
    c5acde09e96c009aaaad88ff556b9a52b087eace  machine-path aliasing, checksums generator, fixes
    50205c0b8c9a0c8731d5c390029c2d1f8adac6e2  committed evidence summary mode and its test
  The commit that contains this record adds only planning documents (this file, the updated
  assignment record, the UDG-001 metadata state and the refreshed checksum manifest) plus the
  regenerated evidence summary for the run below. No source file changes after 50205c0.

Contract revision and prerequisite SHAs:
  UDG-CONTRACTS-M0-001 v1.0, repository edition 1.
  docs/contracts/README.md            255e7b2cb8fd64c41e2e5beb2a56b03bb62b08e0ca11089299d81a2e540a5943
  docs/contracts/UDG-001.md           d0fd0e24220c80f06cb9e3fc99cfaffb06e233680abf774162e5e0daefc0c171
                                      (the bytes at assignment and at capture; this record's commit
                                      changes only the status line to In Review, giving
                                      8d14ed5eda08b7b151069576dae18decaeb0403e0d4c20b902f2f298ccb15d80.
                                      report.json and the committed summary pin the former, because
                                      that is what the run read. No requirement text moved.)
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
  Authoritative foundation run UDG-001-2026-11-08T11-36-22-801Z-50205c0b, captured by
  pnpm evidence:capture on commit 50205c0 with a clean working tree:
    install-frozen          pnpm install --frozen-lockfile   exit 0     53 ms
    typecheck               pnpm typecheck                   exit 0   2,687 ms
    lint                    pnpm lint                        exit 0   1,417 ms
    test                    pnpm test                        exit 0   2,332 ms
    build                   pnpm build                       exit 0   1,518 ms
    test-boundaries         pnpm test:boundaries             exit 0     824 ms
    test-fixtures           pnpm test:fixtures               exit 0     845 ms
    test-contract-UDG-001   pnpm test:contract -- --task …   exit 0   2,353 ms
  Tests: 42 passed, 0 failed, 0 errors, 0 skipped, 0 quarantined, no duplicate case names in 1 file.
  Boundary check on the real tree: 14 files, 0 violations. Fixture manifests: 7 valid.
  pnpm evidence:verify on the produced bundle: PASS, 0 issues.
  pnpm contracts:checksums: in sync. pnpm dependencies:verify: in sync.
  Refusals exercised, each with its exit code asserted: pnpm test:contract for the other ten task
  ids exits 2; pnpm test:e2e, test:spike, test:unit, assets:build and assets:verify exit 1 with the
  owning task named; an unknown task id and an unknown guarded command exit 2 with usage.
  Two capture attempts at earlier commits were discarded as superseded after defects in the
  verifier and sanitiser were found and fixed: UDG-001-2026-11-08T11-25-15-540Z-db6a7da4 and
  UDG-001-2026-11-08T11-26-34-670Z-c5acde09. They are not part of the retained evidence.

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
  PASS report whose command exited non-zero, an injected GitHub token and a private home path, a
  bundle with no measured values, a report referencing a path outside the bundle, and a bundle whose
  own capture recorded sanitisation failures. Each must produce its specific EVIDENCE-* code.
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
  CI reproduces the local result                                     NOT YET MEASURED. See the CI
                                                                     line below; clarification C-05.
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
  SHA-256 of all 21 artefacts, per owner clarification C-03; raw bundles are not committed).
  Raw bundle, owner-reachable durable storage:
    /workspace/udg-evidence/UDG-001-2026-11-08T11-36-22-801Z-50205c0b
  Contents: report.json, environment.json, commands.json, junit.xml, boundary-report.json,
  build.log, logs/*.log, checksums.sha256 and a .keep marker; 32,801 bytes total.
  Integrity: pnpm evidence:verify -- --run <bundle> => PASS, 0 issues. Hashes in report.json and
  checksums.sha256 are cross-checked against the bytes on disk by the verifier.
  Sanitisation: working directory recorded as REPO_ROOT, host as a per-run runner alias, home as
  <HOME>, temp as <TMP>, pnpm store as PNPM_STORE, bundle directory as BUNDLE_ROOT. Capture
  self-checks every artefact it writes and refuses PASS on a leftover machine path; the verifier
  rejects a PASS bundle whose own capture record reports sanitisation failures. No credential,
  token, cookie, environment dump, user name or private path appears in the bundle or in any
  committed file.
  The owner must mirror this directory to whichever store they designate as durable; the path above
  is this checkout's shared evidence directory, not a Git-tracked copy.
  Hash drift to expect when re-verifying: report.json configHashes.taskContract is
  d0fd0e24220c80f0... because the run read docs/contracts/UDG-001.md in its Ready state; the status
  line in that file became In Review in the commit that carries this record. tsconfig.base,
  boundary rule table and fixture configuration, .env.example, .npmrc and the CI workflow hashes
  all still match the committed bytes exactly, as does the lockfile hash.

ADRs accepted, rejected or still proposed:
  None proposed, none accepted, none rejected. No genuine contract conflict was found inside the
  approved scope. The repository.md 3.1 tested-compatibility-set sentence versus clarification C-02
  is recorded above as deviation D3 rather than resolved locally, because the owner's clarification
  already governs it. P02 to P10 remain Pending and were not treated as approved anywhere.

Limitations and remaining downstream work:
  1. CI execution is the one open acceptance condition. The workflow is authored, pinned and
     mirrors the local sequence, and every command in it is the same script a developer runs, but
     this environment has no repository credential, no container runtime and no act, so no GitHub
     Actions result exists. Per C-05 the task stays In Review; CI reproduction is reported as
     pending, never as passed. The owner needs to push main and attach or reference the run.
  2. Local execution happened on Linux aarch64. README states Linux/macOS support, but the client
     and browser paths were never executed here because no client exists yet; macOS is unverified
     beyond portable script and path choices.
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
  In Review. All local acceptance conditions pass with captured evidence; the only unmet condition
  is the CI reproduction that C-05 reserves for the owner's push. Not Blocked: no contract conflict
  or failing check remains, and no requirement was relaxed to obtain that state.
  Recommended reviewer actions: read the declared additions A1 to A4 and deviations D1 to D3, run
  pnpm install --frozen-lockfile && pnpm test && pnpm test:contract -- --task UDG-001, re-run
  pnpm evidence:verify against the retained bundle, then push main and confirm the workflow.

Reviewer decision and date:
  Pending. Reviewer: project owner, GitHub account TomBResearch.

Integration owner gate decision and date:
  Pending. Foundation evidence is this task's own bundle; Gates A, B and C are Not Run and no spike
  gate is affected. Integration owner: project owner, GitHub account TomBResearch.
```
