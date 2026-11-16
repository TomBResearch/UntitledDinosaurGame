# UDG-004 completion record

Appendix B2 submission record for the browser client and camera. The implementer recorded no acceptance of its
own work (root [AGENTS.md](../../AGENTS.md), "do not self-sign adoption, reviewer acceptance, or gate passes"):
every decision field below is **Pending** until the owner records it. UDG-004 validates no gate — Gates A, B and
C stay **Not Run** and `stackCompatibility` stays **not-established** — so the gate field says so rather than
being left blank by accident.

```text
Task ID and final implementation SHA:
  UDG-004 Browser client and camera.
  Submitted head      d318444fe8668f4485d85398ecc6eb88ff5e3b36 (pushed to main) — the head the acceptance
                      evidence below describes, the head CI run 43893238010 is green on (attempt 2), and the head
                      whose camera artefacts are stamped `implementationSha: d318444f…` with
                      `workingTreeDirty: false`. It carries all three Mac-review control rulings; the heads it
                      supersedes each keep their own green run and their own bundle, all named below.
  First submission    2e9184b3a701e351b53c139ff68b312913de8feb — the head the reviewer's first CI look
                      should include, because it went RED: CI run 43764611170 failed one of seven browser
                      cases. That commit, its run and the diagnosis are retained below under "The red
                      submission"; a correction round adds commits, it never edits an old run.
  Implementation set  2e9184b feat(client) — the client, camera, harness, browser suite, capture plan,
                      dispatcher guard and shared evidence edits, one commit
                      1100233 test(client) — the handedness check moved from pixel sweep to ray probe
                      0ad8d9e fix(client) — the chromium build read from Playwright rather than from an
                      environment variable a GitHub runner does not set, and UDG-004's artefact gates made
                      absent-aware so they cannot turn another task's acceptance bundle red
                      727cb86, c0bb0c9, e889526 docs — the record itself: completion record, committed evidence
                      summary, the Mac-route correction to the published-port mapping, and the W-7 analysis
                      2d2be86 fix(client) — horizontal orbit reversed for mouse drags only; the one-finger touch
                      orbit keeps its direction, and the orbit case asserts signed azimuth deltas
                      805ede6 feat(client) — the second control ruling: middle-button orbit, an inert left button
                      reserved for UDG-008, arrow-key orbit and pitch on the focused canvas, the eighth (keyboard)
                      browser case, and the horizontal direction reversed again
  Record set          this file plus the status pages that move with it (README.md,
                      docs/contracts/UDG-004.md, docs/contracts/adoption.md, checksums.json). A commit
                      cannot quote its own SHA or its own CI run, so those two are named by the handoff
                      report that follows this file.
  Baseline            089ae33d2d0df346d5a1de8e756971c605dc839a (assignment draft revision 2, CI 43740515165
                      success), handed over by 9b034307c3d11a9358c3947509f3f6e49edbf1ea (docs-only,
                      CI 43744461707 — see §"Handoff" in the assignment record). Implementation began from
                      9b03430 and the code tree at 9b03430 is byte-identical to 089ae33.

Contract revision and prerequisite SHAs:
  Contract            docs/contracts/UDG-004.md, UDG-CONTRACTS-M0-001 v1.0 repository edition 1, digest
                      265f0e7b411b14c0cbe0cd54b893ef5c3bb9af6116ce605272d4278ce42018d3 (checksums.json)
  Prerequisites       UDG-001 acceptance 524658e1fb4c53a450cdf933886c7ad4b17c72e9 — the contract's only
                      "Requires Verified", and the reason `pnpm evidence:verify` will not accept a UDG-004
                      bundle that names none: the first capture of this task failed with
                      EVIDENCE-PREREQUISITE-MISSING until the assignment record carried the lines the gate
                      reads
                      UDG-002 acceptance d364d2dafbc88f469ef60e5e61c5e5c5c6cfd7e4 — consumed rather than
                      required: `Vec3`/`Pose` from @udg/protocol, `MOVEMENT_DEFAULTS` from @udg/config
  Assignment record   docs/contracts/assignments/UDG-004.md (grants, Mac route, evidence plan, E-1…E-6)

Files added or changed and scope deviations:
  40 paths changed against the handoff commit 9b03430, +7059 / −61. Owned paths, exactly as the contract lists:
    apps/client/index.html, vite.config.ts, src/main.tsx, src/App.tsx,
    src/rendering/{create-scene,PlayerView,OrbitCamera,camera-math}.ts,
    src/ui/{ConnectionStatus,DevelopmentOverlay}.tsx, src/game/ClientRuntime.ts,
    src/network/ClientConnection.ts, tests/contracts/UDG-004.test.ts, tests/e2e/camera.spec.ts
  Additional paths, each inside a named grant (assignment record §5):
    apps/client/src/{dev/lifecycleHarness.ts,dev/sceneReadout.ts,vite-env.d.ts}, tsconfig.tools.json — G-6
    apps/client/{package.json,tsconfig.json}, root package.json, tsconfig.e2e.json — G-1, G-6
    .env.example, README.md — G-1b
    tools/checks/src/{support.ts,dispatch.ts} — G-2 (per-suite `test:e2e` guard)
    tools/checks/src/evidence.ts — G-9 (UDG-004 capture plan, binary-safe sanitisation)
    tests/contracts/UDG-001.test.ts — G-3 (two narrow amendments, both flagged below)
    .github/workflows/ci.yml — G-8 (chromium install, camera step, UDG-004 suite step, timeout 30→45 min)
    playwright.config.ts — G-4; .gitignore (Playwright scratch directory)
    docs/integration/{client-stack-v1.md,README.md,dependencies.json}, docs/contracts/checksums.json — W-0
  Deviations from the assignment, stated plainly:
    * **UNTESTED, deferred by owner decision:** "a failed asset load must not crash the UI". The greybox loads
      no files — no asset pipeline, no network asset — so the condition has no reachable path in this client. The
      owner ruled in the round after submission: the check is **deferred to UDG-007**, where a real asset-loading
      path exists that can actually fail, and this task's row stays **explicitly untested** — neither passed nor
      waived.
      **Obligation carried to UDG-007, recorded here so it is not lost:** UDG-007's acceptance must exercise a
      failing asset load (missing file, unreadable file, aborted transfer, corrupt payload) and show the UI still
      rendering and the frame loop still ticking, with the failure surfaced rather than swallowed.
      The nearest measured facts here are that two *other* hostile conditions leave the UI rendering and the loop
      ticking: a refused WebSocket (the development socket, refused on purpose) and a cancelled pointer gesture
      (`gesturesAfterCancelStillTicking === true`). Neither stands in for an asset-load failure and neither is
      offered as coverage of this row.
    * Kept, not required: the pixel sweep that the first submission gated on is now reported
      (`camera.sweepFound`, `camera.sweepMissed`) and no longer decisive, for the reason in "The red
      submission".
    * Grants not used: G-5 (withdrawn before implementation — `.tsx` was already linted; the ESLint config is
      byte-identical, digest 5a29e7c2316f1917, pinned by the task suite) and G-7 (`pnpm-workspace.yaml`
      untouched).
    * Accepted assertions changed in another task's suite, both narrow, both needing the reviewer's eye:
      (1) the UDG-001 dispatch loop now proves refusal semantics with `netcode` instead of `camera`, because
      `camera` dispatches — the guard is per suite now, not per command, and the command `test:e2e` is still
      on the guarded list;
      (2) UDG-001's deferred-library absence list no longer spells out `@babylonjs/` and `react`, because the
      dependency register now calls that family `selected` under this task's assignment. Nothing became more
      permissive for a family that is still unselected: `@dimforge/` and `recast-navigation` are still spelled
      out, and every `not-selected` group is still asserted.

Public interface/schema/config changes:
  ClientRuntime public surface — unchanged in kind: `start(canvas)`, `setPresentedPose(entityId, pose)`,
  `removePresentedEntity(entityId)`, `dispose()`, plus one read-only `counters()` added for the development
  overlay and the browser suite. No lifecycle lever is exposed: mount, unmount, remount and restart live in
  the dev-only harness, so the runtime does not grow an API because a test would like one. `counters()` is a
  readout of presentation and gesture bookkeeping, not a control; the task suite asserts the member list and
  rejects `mount`, `unmount`, `remount`, `restart`, `resize`, `scene`, `engine` and `harness`.
  Pose — unchanged, consumed from @udg/protocol as `readonly { position: Vec3; yaw: number }`.
  Configuration — `.env.example` documents `UDG_DEV_HOST` (loopback default, exposure warning) and
  `VITE_UDG_SERVER_URL`. `ImportMetaEnv` declares the latter so `import.meta.env.DEV` keeps folding.
  Shared evidence schema — unchanged. The vector manifest and `report.json` shape are untouched; UDG-004's
  thresholds are ordinary plan declarations. `D-004-15` therefore stands on its approved default: screenshot
  freshness and integrity are checked by UDG-004's own suites.
  Dispatcher — `test:e2e` became per-suite: `--suite camera` dispatches, the four unimplemented suites exit 1
  naming their owner, a bare `test:e2e` exits 1 naming all five, an unknown suite name exits 2. The other
  guarded commands (`test:spike`, `assets:build`, `assets:verify`) still refuse as UDG-001 pinned.

Actual package and WASM versions/hashes:
  @babylonjs/core 8.56.2 (Apache-2.0), react 19.3.1, react-dom 19.3.1 (MIT), @types/react 19.3.0,
  @types/react-dom 19.3.0 (MIT), vite 8.3.6 (MIT, already pinned by UDG-001), @playwright/test 1.65.0 with
  Chromium build chromium-1254 (browser 158.0.8127.18 measured in the artefact).
  No @babylonjs/loaders, no @webgpu/types, no @colyseus/* in the client, no @vitejs/plugin-react. Babylon 9.x
  and plugin-react are deferred decisions with the measurements in docs/integration/client-stack-v1.md §1.
  No WASM is introduced: nothing in this task touches Rapier or Recast, and Gate B and Gate C remain Not Run.
  Lockfile digest at submission 944ae1e435e5cf5c… (dependencyLockHash in report.json); the committed register
  is regenerated by `pnpm dependencies:record` and `pnpm dependencies:verify` passes.

Commands with exit codes and test counts:
  The capture ran the sequence below in one job and every command exited 0
  (9 commands, `capture.failingCommands === []`):
    install-frozen 0 · typecheck 0 · lint 0 · build 0 · camera-e2e 0 · test 0 · test-contract-UDG-004 0 ·
    test-boundaries 0 · test-contract-UDG-001 0
  Test counts: vitest 615 tests, 0 failures, 0 errors, 0 skipped, 0 quarantined, 0 duplicate case names
  (30 files). Baseline was 572 tests in 28 files; the increase is UDG-004's 23 task-suite tests and 20
  evidence-gate tests. Playwright: 7 cases, 7 passed, 0 failed, 0 skipped, one worker, no retries.
  Boundary check: 85 files, 0 violations, rule table 818c63d5b12f. Contract checksum manifest: in sync,
  66 files. Local runtime: Node v24.22.2, pnpm 12.18.0, linux, 18 cores — the pinned pair, provisioned in the
  container without moving any repository pin.

Positive, negative, lifecycle and race coverage:
  Positive — the seven camera cases: greybox plus two independent presented entities with one canvas and one
  loop; right-handed/Y-up/metre convention with the capsule measured at 1.8 units off its world-space
  bounding box; orbit by mouse drag and by touch drag with elevation and azimuth clamps and a survives-
  cancellation gesture; zoom by wheel and by pinch clamped at 2 m and 20 m; gestures that begin in UI ignored;
  presented poses moving the view while camera operations never mutate either pose; ten mount/unmount cycles.
  Negative — the refusal side is the bulk of the evidence: `tests/unit/udg-004/evidence-gates.test.ts` builds
  a valid artefact set and breaks it one way at a time, and the gate must refuse each one (missing results,
  unparseable, `{}`, zero cases, failed case, skipped case, deleted case with self-consistent counters,
  stale capture, foreign run id, different commit, dirty tree, copied companion artefact, nine cycles where
  ten were required, mis-hashed PNG, deleted PNG, unlisted PNG, non-PNG bytes at the declared length,
  meshes surviving disposal, unexpected page errors). The task suite additionally refuses real dispatcher
  commands (`test:e2e -- --suite physics` and friends) rather than trusting a helper's word.
  Lifecycle — ten cycles, each measured from outside the runtime: Babylon's `Engine.Instances`, `EngineStore`
  and `Observable` registries plus a `window.requestAnimationFrame` spy. After the tenth: mounted false,
  engines 0, scenes 0, meshes 0, materials 0, observers 0, listeners 0, renderTicksAdvanced 0,
  frameRequestsAdvanced 0, engineDisposed true, sceneDisposed true. Re-mounting from the same page then
  proves the scene is live again, so "zero" is not the trivial result of a dead page.
  Race and hostile-input coverage — a `pointercancel` arriving mid-drag (the loop must still be ticking
  afterwards), focus loss freezing the render loop while orbit, wheel and pinch are performed (0 pose writes,
  camera still moves), wheel events dispatched at a disposed canvas (refused, not thrown into a React
  effect), a refused WebSocket (rendered as a connection state), and gestures that begin on `data-udg-ui`
  regions (buttons deliberately not used, because the browser also fires the click).
  Not covered — no network profiles: requested [] and achieved [], because the client owns no link
  (see `profiles.note` in the bundle). No frame-time or memory budget sampling.

Requested versus achieved network profiles:
  None requested, none achieved, and that is the contract rather than an omission: UDG-004 presents poses it
  is handed and the development socket is refused on purpose because UDG-003 owns the server. Spike runs record
  LAN, moderate, elevated and poor profiles with achieved RTT and jitter statistics.

Acceptance thresholds and measured results:
  Every threshold below is a dotted path into `measurements/UDG-004.json`, which is what `pnpm evidence:verify`
  resolves; thirteen of them were unmeasured on the first capture of this plan and the verifier said so
  (EVIDENCE-THRESHOLD-UNMEASURED) after every assertion had gone green.

  | Threshold | Claim | Measured |
  | --- | --- | --- |
  | camera.cases | 8 cases, each passed (the eighth is the keyboard, added on the reviewer's instruction) | 8 |
  | camera.pageErrors | 0 unexplained page errors, 0 console errors | 0 / 0 |
  | camera.handednessPicks | ≥ 5 ray probes landing on the expected arm | 9 of 9 |
  | camera.presentedHeightUnits | 1.8 units | 1.8 |
  | camera.positiveArmMetres / negativeArmMetres | 3 units to the cap; ≈1.2 negative | 3 / 1.2 |
  | camera.elevationClampLow / High | 10° and 80°, neither exceeded | 10 / 80 |
  | camera.radiusMinMetres / MaxMetres | 2 m and 20 m, by wheel and pinch | 2 / 20 |
  | camera.uiGesturesIgnored | ≥ 1 UI-origin gesture ignored, camera unchanged | 2 |
  | camera.poseWritesDuringCameraOperations | 0 *additional* pose writes inside the frozen window | 0 (the feed had written 10 before the freeze; that number is recorded beside it) |
  | camera.targetFollowErrorMetres | < 0.05 m | 2.5 × 10⁻⁸ |
  | lifecycle.cycles | ≥ 10 cycles, then all counts 0 | 10 |
  | screenshots.rehashed | 6 PNGs re-hashed, signature checked, none unlisted | 6 (local and CI) |
  | evidence.chromiumBuild | the pinned build, not whatever the machine had | chromium-1254 |
  | evidenceGates.binaryPortabilityProven | clean PNG survives byte-for-byte and decodes; path-carrying PNG refused with bytes unchanged | true |
  | seam.tokensAbsent | no harness token in any production file, source maps included | true |
  | dispatch.perSuiteMatrix | camera dispatches, four suites refuse naming owners, bare command refuses | true |
  | capture.commandsRun | ≥ 7 commands, none failing | 9 / [] |

  One acceptance criterion deliberately carries **no threshold and no measurement** in that table: the failed asset
  load, which is untested and deferred to UDG-007 by the owner's decision recorded under Deviations. Its absence
  from the table must not be read as coverage.

  The six demonstrations the assignment record §6.2 asked for, and where each is proven:

  | Demo | Where | What it shows |
  | --- | --- | --- |
  | E-1 missing results block acceptance | evidence-gates.test.ts, `E-1` | `MISSING`, `UNPARSEABLE`, `ZERO_CASES` refusals |
  | E-2 failed results block acceptance | `E-2` | `FAILED`, `CASE_NOT_PASSED`, `CASE_MISSING`, `CONSOLE_PAGE_ERRORS`, screenshot tampering |
  | E-3 stale results block acceptance | `E-3` | `STALE`, `RUN_MISMATCH`, `IDENTITY`, `TREE_DIRTY`, companion copied from another run |
  | E-4 a clean PNG survives capture and opens | `E-4` | bytes and SHA-256 identical after sanitisation, decodes at 1280×720 in chromium-1254, and the text beside it is still rewritten |
  | E-5 a path-carrying PNG is refused, not repaired | `E-5` | refusal names the file, bytes unchanged, and it still opens |
  | E-6 what this task did not own still works | `E-6` | UDG-001/002/003 capture plans byte-identical, retained bundles free of integrity-code failures, text sanitisation preserved |

  E-6's honest limit, stated rather than hidden: a bundle captured before a plan grew reports
  `EVIDENCE-FILE-MISSING`/`EVIDENCE-COMMAND-MISSING` for the commands and artefacts added afterwards, and all
  four retained UDG-003 bundles on this machine do exactly that. E-6 therefore asserts the absence of the
  *integrity* codes a sanitisation change could plausibly cause (hash, size, empty, secret, unparseable
  report) and records the rest in `E6.bundleOutcomes`. In CI the demonstration lands in full, because the job
  captures and verifies the UDG-001, UDG-002 and UDG-003 bundles before UDG-004's, and E-6 re-verifies them
  inside UDG-004's own capture.

Raw evidence directory and integrity result:
  CI capture at the submitted head (authoritative): `UDG-004-2026-11-16T15-50-46-953Z-d318444f` inside run
  43893238010's `udg-evidence` artefact, retained at
  `/workspace/udg-evidence/ci-run-43893238010/UDG-004-2026-11-16T15-50-46-953Z-d318444f` — re-verified here **PASS, 0 issues** (8 cases,
  8 passed, 616 tests, 0 failures, `chromium-1254`), and the committed summary
  [UDG-004-evidence.json](UDG-004-evidence.json) is generated from **this** bundle. Retained beside it, in the same
  store: round 2's `UDG-004-2026-11-16T13-46-50-902Z-805ede69` (`ci-run-43871936471/`), the record-commit capture
  `UDG-004-2026-11-16T12-30-21-289Z-bc5b8b18` (`/workspace/udg-evidence/ci-run-43863914596/`), the round-1 head's
  `UDG-004-2026-11-16T11-55-52-843Z-2d2be864` (`/workspace/udg-evidence/ci-run-43852121401/`), and earlier record
  captures `UDG-004-2026-11-16T00-29-14-503Z-c0bb0c9a` (`ci-run-43778967831/`) and
  `UDG-004-2026-11-16T08-50-02-811Z-e8895261` (`ci-run-43832089262/`) — all PASS, 0 issues.

  CI capture at the previous head: `UDG-004-2026-11-15T23-21-30-673Z-0ad8d9e9` inside run 43770588357's
  `udg-evidence` artefact, retained at
  `/workspace/udg-evidence/ci-run-43770588357/UDG-004-2026-11-15T23-21-30-673Z-0ad8d9e9` — 35 files hashed,
  `pnpm evidence:verify` → **PASS, 0 issues** after the copy, beside the CI captures of UDG-001, UDG-002 and
  UDG-003 from the same job. The committed summary
  [UDG-004-evidence.json](UDG-004-evidence.json) is generated from **that** bundle, not from a local one.
  Local capture at that earlier head: `UDG-004-2026-11-15T22-37-36-275Z-0ad8d9e9` — status PASS, 34 files hashed,
  `pnpm evidence:verify` → PASS, 0 issues, retained at
  `/workspace/udg-evidence/local-capture-2026-11-15/UDG-004-2026-11-15T22-37-36-275Z-0ad8d9e9` (existing
  store only; **D4 remains open and unprovisioned**, so no new archive, bucket or remote was created).
  Contents include `camera-browser-results.json`, `lifecycle-counts.json`, `console-errors.json`,
  `browser/screenshots.json` and the six PNGs, beside the universal `report.json`, `environment.json`,
  `commands.json`, `junit.xml`, `build.log`, `logs/` and `checksums.sha256`.
  The superseded local captures at `2e9184b` and `1100233` were discarded rather than retained: each belonged
  to a head that is no longer the submitted one, and a retained bundle that no reviewer can re-run from a
  branch is noise. The CI runs for those heads remain, and they are what the two fixes cite.

The red submission, kept because a correction that erases its own history is not a correction:
  CI run 43764611170 on 2e9184b failed one of seven browser cases on `ubuntu-24.04`:

  > `udg-axis-z-negative was never visible in the sweep; the marker is not being drawn`

  about a marker that was being drawn. Six cases passed on the same run, including the ones that read the
  rendered frame; the same commit passes all seven locally, and the runner took 29 s for a case that takes 5 s
  here. The failing check asked the *screen*: sweep pixels, ask Babylon's picker what is at each one, compare
  each marker's side of screen centre with a right-handed basis derived independently in the suite. Frame
  visibility depends on the canvas box the browser laid out, on camera framing, and on what had been rendered
  by the moment of asking — none of which is a handedness signal.

  The fix (1100233) keeps the question and moves it into world space: a downward ray at a point only one mesh
  can occupy, eight arm samples plus the floor, answered by Babylon's real picking path against an answer key
  the suite holds. The pixel sweep is still run and reported as the picture-level half. Both numbers are in
  the artefact (`handednessPicksAgreeing: 9`, `screenMarkersFound: 11`, `screenMarkersMissed: 0` locally; the
  first submission's screenshot and trace are inside that run's artefact on GitHub).

CI result:
  **Current head d318444fe8668f4485d85398ecc6eb88ff5e3b36 — run 43893238010, workflow `ci`, event push. Previous heads keep their own runs; nothing is
  edited away, including the red caused by a UDG-004 test rather than by a UDG-004 client.**

  * **Attempt 2: completed / success.** Camera suite green (8 of 8 cases), `pnpm test` green (616 tests, 0
    failures), all four capture bundles verified. The UDG-004 bundle is
    `UDG-004-2026-11-16T15-50-46-953Z-d318444f`, retained at
    `/workspace/udg-evidence/ci-run-43893238010/` and re-verified here: **PASS, 0 issues**. In it `suites` reads
    `{expected: 8, passed: 8}` on `chromium-1254`, and the control measurements are the ones this record quotes:
    **middle-mouse** right **+68.755°**, middle left **−68.755°**, **touch** right **−68.755°**, touch left
    **+68.755°**, `mouseInvertedAgainstTouch true` (equal and opposite by construction of the third ruling),
    `leftPressesIgnored 2`, `mouseDragDownElevationDelta +20.626°`; keyboard from a single keydown with no repeats —
    `keyboardDeltaRightSweep −25.336°` over `keyboardFramesRightSweep 18` at
    `keyboardDegreesPerDrivingFrame 1.408°`, `keyboardFramesToFirstMove 3` at `keyboardStartLatencyMs 118`,
    `keyboardDeltaLeftSweep +25.041°` over 18 frames, `keyboardSweepFrameRatio 1.000`,
    `keyboardFramesAfterKeyup 0`, pitch clamped at exactly **80** and **10**, focused outline
    `4px solid rgb(89, 201, 138)`, `keyboardFramesTotal 234`.
  * **Attempt 1: failed**, at `Capture the evidence bundles`, on UDG-003's `W-7` (`expected 1 to be +0`) inside
    **UDG-004's own capture `test` step** — the retained `logs/test.stderr.log` in
    `UDG-004-2026-11-16T15-26-23-907Z-d318444f` names `tests/system/udg-003-phase-2/runtime.test.ts`. The camera
    suite and every test step before it were green, and the UDG-001, UDG-002 and UDG-003 bundles in that attempt all
    verified PASS; only UDG-004's bundle recorded a failing gate, which is the gate working as designed.

  **Previous head 805ede694dbc135ebd7e8afc047a905637dedae6 — run 43871936471.** Round 2: middle-button orbit, the
  inert left button, arrow-key orbit and pitch on the focused canvas, and the eighth browser case.

  * **Attempt 2: completed / success.** Camera suite green (7 → 8 cases), `pnpm test` green (616 tests, 0 failures),
    all four capture bundles verified. The UDG-004 bundle is
    `UDG-004-2026-11-16T13-46-50-902Z-805ede69`, retained at `/workspace/udg-evidence/ci-run-43871936471/` and
    re-verified here: **PASS, 0 issues**, with middle right **−68.755°**, middle left **+68.755°**, touch right
    **−68.755°**, touch left **+68.755°**, `mouseAndTouchAzimuthAgree true`, `leftPressesIgnored 2`, ArrowRight ×10
    **−28.648°**, ArrowLeft ×10 **+28.648°**, keyboard pitch clamped at exactly **80** and **10**, focused outline
    `4px solid rgb(89, 201, 138)`, `keyboardStepsTotal 170`.
  * **Attempt 1: failed**, at `Run the unit and Node integration suites`, on UDG-003's `W-7` — the camera suite
    and every step before it were green, and `Verify probe invocation attribution` failed afterwards only because
    the UDG-003 probe step never ran once its test step aborted.

  **Run 43890629291 (head `3448bc6`) — failure, and the only one this task caused in its own test.** The camera suite
  failed case 8 on `the keyboard axis is not mirrored`; the diagnosis and the fix are in
  "What CI cost to get the keyboard assertions right" below. It is listed here rather than omitted so the green head's
  history reads honestly: `3448bc6` never had a green run of its own, and its behaviour is what `d318444` verifies.

  **Previous head 2d2be8646ad4ab7caa17637d10bdf553a20ce313 — run 43852121401.**

  * **Attempt 3: completed / success.** Camera suite green, `pnpm test` green (615 tests, 0 failures), all four
    capture bundles verified. The UDG-004 bundle is `UDG-004-2026-11-16T11-55-52-843Z-2d2be864`, retained at
    `/workspace/udg-evidence/ci-run-43852121401/` and re-verified here: **PASS, 0 issues**. Inside it
    `camera-browser-results.json` carries the direction measurements the reviewer asked for, measured on the
    runner: `mouseDragRightAzimuthDelta +68.755°`, `mouseDragLeftAzimuthDelta −68.755°`,
    `touchDragRightAzimuthDelta −68.755°`, `touchDragLeftAzimuthDelta +68.755°`,
    `mouseInvertedAgainstTouch true`, `mouseDragDownElevationDelta +20.626°`, with the bounds, UI exclusion and
    pose-write numbers unchanged (`10`/`80`, `2`/`20`, 2 regions ignored, 0 pose writes) and
    `chromium-1254`. Those values live in the artefact rather than in `measurements/UDG-004.json` on purpose: no
    capture-plan threshold was added for the direction, so nothing in the plan reads them, and the file is hashed
    into `checksums.sha256` either way.
  * **Attempt 1: failed** at `Run the unit and Node integration suites` on UDG-003's `W-7`, the same
    nondeterministic probe described further down; the camera suite and every step before it were green.
  * **Attempt 2: failed** at `Capture the evidence bundles`, and it is the most informative of the three: the
    job's own `pnpm test` passed `W-7`, but **UDG-003's capture** ran its own `pnpm test` and hit `W-7` inside
    itself, so its bundle recorded `EVIDENCE-GATE-NOT-PASS` and the capture loop stopped **before UDG-004's bundle
    was written**. UDG-001's and UDG-002's bundles from that attempt verified PASS. Nothing about the camera change
    was implicated in any of the three attempts.

  **Previous head 0ad8d9e9f57d98242e62b390f92bda54acfa755f — run 43770588357.**

  * **Attempt 2: completed / success.** Every step green, including the camera suite, `pnpm test` (615 tests,
    0 failures/errors/skipped), the UDG-004 task suite, all four evidence captures and all four bundle
    verifications. The job's `udg-evidence` artefact is the authoritative acceptance record; its UDG-004
    bundle is `UDG-004-2026-11-15T23-21-30-673Z-0ad8d9e9`, retained at
    `/workspace/udg-evidence/ci-run-43770588357/` and re-verified here: **PASS, 0 issues**. In that bundle
    `evidence.chromiumBuild` is `chromium-1254`, `camera.handednessPicks` is 9 with `camera.sweepFound` 9 and
    `camera.sweepMissed` 0, `camera.poseWritesDuringCameraOperations` is 0, and E-6 records
    `{UDG-001: verified, UDG-002: verified, UDG-003: verified}` — the three sibling bundles this job captured
    minutes earlier, verified inside UDG-004's own capture, which is the full form of the demonstration the
    local machine can only approximate.
  * **Attempt 1: failed**, at `Capture the evidence bundles`. UDG-001's bundle passed; **UDG-002's** capture
    failed inside its own `pnpm test` step on
    `tests/system/udg-003-phase-2/runtime.test.ts > W-7: the 4000 ms episode deadline expires with no fresh
    snapshot, and the three limits stay distinct` — `expected 1 to be 0`. That is a wall-clock-sensitive probe
    in another task's suite, not a UDG-004 assertion, and UDG-004 does not re-tune it.
  * **Attempt 3 of this work — the record commit `727cb86deaa7f75ffae1bc4cdd0c5b65907d0347`, whose implementation
    tree is byte-identical to the submitted head — went red at the same assertion**
    ([run 43775706274](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43775706274)), and its
    `Verify probe invocation attribution` step then failed as a knock-on because the UDG-003 probe step never ran
    after the test step aborted (`PROBE-INVOCATION-MISMATCH: PR-14.probe-result.json carries no invocationId`).
    Two reds and one green on **the same code** is the finding, so it is stated plainly:
  * **Both symptoms stay UDG-003's to resolve.** No assertion, deadline or retry policy in
    `tests/system/udg-003-phase-2/runtime.test.ts` was touched by this task, and none is proposed for change here.
  * **What W-7 actually does.** It calls `runScript('tests/runtime/udg-003-phase-2/impairment-population.ts')`,
    which runs a live transport with **wall-clock** deadlines and measures counters such as
    `deliveriesReachingTheSeatDuringTheEpisode`; the test then reads what the probe observed. `expected 1 to be 0`
    means a snapshot delivery landed inside a window the case intends to be silent — what a real-time probe does
    on a contended runner. The test itself takes 6 ms; the probe underneath it is the timing-sensitive part.
  * **Is UDG-004 the cause?** Not as a matter of execution order: in that run's own file order
    `tests/system/udg-003-phase-2/runtime.test.ts` completed before `tests/contracts/UDG-004.test.ts` and
    `tests/unit/udg-004/evidence-gates.test.ts` even started, and the UDG-004 unit file costs 419 ms of CPU. So no
    UDG-004 test was running when the probe measured. What UDG-004 did change is the job's total weight — a
    chromium install, a browser suite and two new test files on a job that used to run only `pnpm test` — and a
    heavier job can only make a wall-clock probe more likely to tip. That is offered as a plausible contributor
    with its counter-evidence attached, not as a conclusion, and the same job ran green on attempt 2.
  * **A second symptom of the same file, reproduced locally during this round's verification.**
    `runtime.test.ts > P-2b, reopened for the harness only, exercises GA-6a, GA-6b, GA-6c and GA-7 at the declared
    test values` failed on this machine with `expected 'seat reservation expired.' to match /token/i` — the probe
    recorded the seat-reservation refusal where the assertion expects the token-reconnect refusal, an ordering race
    inside the same live-transport file. The immediately following run of the same command, with **no repository
    file changed**, was green: 615 tests in 30 files, 0 failures. So two different assertions in that one file have
    now failed on two different machines — `W-7` on a GitHub runner, `P-2b` in a Linux container — and neither
    involves a UDG-004 file or a UDG-004 assertion. That is further evidence for the reading above (timing- and
    ordering-sensitive live-transport probes) and further reason it belongs to UDG-003 rather than to this task.
  * **What UDG-004 will not do.** It will not widen another task's deadline, mark another task's test flaky, or
    add a retry to the shared test step; each of those edits a different task's acceptance semantics and belongs
    to that task's owner. Three options are on the table and none is taken here: give W-7 a load allowance inside
    UDG-003's own suite; keep rerunning and recording red attempts as this record does; or reorder the CI job so
    sibling captures precede UDG-004's steps, which would put UDG-004's weight ahead of the probe at the cost of
    reordering other tasks' acceptance and is therefore not proposed.
  * The two earlier red runs on the way here — `43764611170` (head `2e9184b`, the pixel-sweep handedness check
    described above) and `43766691106` (head `1100233`, `chromiumBuild: unknown` plus UDG-004 tests failing
    inside UDG-001's and UDG-002's captures) — are kept for the same reason. All three are linked below.

  Acceptance head: `d318444fe8668f4485d85398ecc6eb88ff5e3b36` — **green on run 43893238010 attempt 2**, and the evidence above comes from that run. Earlier
  heads keep their own green runs: `805ede6` on 43871936471 (attempt 2), `2d2be86` on 43852121401 (attempt 3),
  `0ad8d9e` on 43770588357 (attempt 2). A reviewer who re-runs `main` should expect the same nondeterminism at W-7
  until UDG-003 deals with it: **seven attempts across five runs** have gone red there, and every green has arrived on a
  later attempt of the same run. Round 3 also produced the first red this task caused in **its own test** — run
  43890629291, described under "What CI cost to get the keyboard assertions right" below.

  https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43903672563 — success, first attempt (this record commit 58a4aaa; bundle UDG-004-2026-11-16T16-24-17-374Z-58a4aaa4, retained at /workspace/udg-evidence/ci-run-43903672563/, PASS 0 issues)
  https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43893238010 — success (attempt 2; attempt 1 red at W-7 inside UDG-004's capture `test` step, camera suite green on both attempts)
  https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43890629291 — failure (camera case 8: this task's own wall-clock keyboard tolerance, fixed in d318444)
  https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43871936471 — success (attempt 2; attempt 1 red at W-7)
  https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43863914596 — success (record commit bc5b8b1)
  https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43852121401 — success (attempt 3; attempts 1 and 2 red at W-7)
  https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43832089262 — success (record commit e889526)
  https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43778967831 — success (record commit c0bb0c9)
  https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43775706274 — failure at UDG-003's W-7 (record commit 727cb86)
  https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43770588357 — success (attempt 2)
  https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43766691106 — failure, fixed by 0ad8d9e
  https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43764611170 — failure, fixed by 1100233

ADRs accepted, rejected or still proposed:
  None accepted or rejected by this task. ADR-0001 (replica precision) and ADR-0002 (the two `apps/server`
  declaration projects) are untouched; UDG-004 deliberately took **no** new compiler-policy relaxation —
  `tsconfig.e2e.json` adds the DOM library and inherits `skipLibCheck: false`, which is also why UDG-003's
  accepted PR-0 probe (which audits projects claiming the ADR-0002 exception, and any project that loads a DOM
  library while claiming it) stayed green. ADR-P-0002 Part B remains unadopted.

Limitations and remaining downstream work:
  * Frame-time and frame-budget claims: none are made. The contract states these screenshots prove basic
    behaviour, not desktop or mobile frame-time budgets, and no claim beyond that appears in the artefacts.
  * Browser emulation certifies event mapping, not physical-device performance: no real touch device was
    used, and touch is driven by dispatched touch events.
  * WebGL resource release is evidenced by engine, scene, mesh, material, observer and listener counts plus
    frame-request silence after unmount, not by a GL-object audit: Babylon 8's public API in the pinned
    version offers no counter this suite could read honestly, and inventing one from private fields would
    have been a number the engine was asked to report about itself.
  * "Failed asset load" stays **untested** and is deferred to UDG-007 by owner decision, with the obligation
    written down under Deviations; no threshold of this task stands in for it.
  * Scene scale: a Babylon unit is not a metre in this scene (1 unit = 0.1 m by the adopted
    `AXIS_SCALE_METRES`), while camera radius is expressed in metres. Both scales are named wherever a number
    uses them; the unit policy itself is frozen at Gate A, which UDG-004 does not run.
  * Babylon 9.x, `@webgpu/types` and `@vitejs/plugin-react` are deferred with their measurements; each needs
    an owner decision before a pin moves.
  * The camera's pointer path uses pointer events for mouse and touch events for touch, because jsdom — the
    only DOM in `pnpm test` — synthesises no `pointerType`; unifying them is a later decision, documented in
    `camera-math.ts` and `docs/integration/client-stack-v1.md` §9.
  * `D-004-15` stands on the approved default (UDG-004's own suites gate screenshots; shared schema unchanged).
    Moving that gate into the shared verifier would be an edit to `tools/checks/src/evidence.ts` and needs its
    own instruction.
  * `D4` stays open and unprovisioned; this task retained evidence in the existing store only.
  * UDG-003 Phase 3 remains unassigned; Gates A, B and C Not Run; `stackCompatibility` not-established.

Implementer recommendation: **In Review**.
  Every acceptance item that can be executed is executed and measured at the submitted head, the bundle verifies
  with 0 issues, and the hosted CI link above is the acceptance record. Three items are reported short of
  acceptance and none as passed: the failed-asset-load condition is **untested**, deferred to UDG-007 by the
  owner's decision with the obligation recorded here; touch evidence is event mapping under browser emulation and
  certifies **no physical-device performance**; and WebGL release is evidenced by resource counts and frame-request
  silence rather than by a GL-object audit. The touch and WebGL limits are unchanged by this round's decisions.
  **Mac reachability is additionally unverified** until the reviewer runs the steps above. Acceptance is the
  owner's to record.

Reviewer decision and date: **Pending** — the owner records this.
Integration owner gate decision and date: **Not applicable to UDG-004** — no gate is decided here; Gates A,
B and C remain Not Run and UDG-SPIKE-001 remains the formal Gate A execution.
```

## Mac preview check — how to run it, and what it is worth

**Mac reachability is UNVERIFIED.** Nothing below was executed from a Mac: the implementer's environment is a Linux
container with no Docker CLI, so only the container side of the route was measured. Until the reviewer runs it,
"reachable from macOS Chrome" is an open question and not a claim of this record.

The route is the assignment record §7 ruling, unchanged:

* the container publishes **`-p 127.0.0.1:5173:5173`**, so the host side binds the Mac's own loopback and nothing
  is exposed on a routable interface;
* the dev server inside the **preview** container runs with **`UDG_DEV_HOST=0.0.0.0`**, because a container's
  `127.0.0.1` is its own and Docker's published-port proxy cannot reach it;
* the default bind everywhere else stays `127.0.0.1`, and nothing in the repository sets the variable;
* **Preview URL `http://127.0.0.1:5173/`, port 5173**, with `strictPort: true` so the server refuses rather than
  sliding to 5174.

The `docker run --network host alpine/socat tcp-listen:5173,fork,reuseaddr tcp-connect:<container-ip>:5173`
forwarding line that appeared in an earlier copy of this record and of
`docs/integration/client-stack-v1.md` is **withdrawn**, and so is any variant of it. It did work in the container,
but it is not the approved route: it depends on the container's mutable bridge address, it runs a second forwarding
mechanism outside Compose's control, and assignment record §7.1 authorises the published-port mapping instead. Use
Docker's own proxy.

### Step 1 — on the Mac: does the mapping already exist?

```sh
docker ps --format 'table {{.Names}}\t{{.Ports}}'
docker port <container>          # empty ⇒ no published ports ⇒ step 2
# what is actually published, in the machine-readable form
docker inspect -f '{{json .HostConfig.PortBindings}}' <container>
# want to see:  {"5173/tcp":[{"HostIp":"127.0.0.1","HostPort":"5173"}]}
```

Also confirm the host side of the mapping is listening on loopback:

```sh
lsof -nP -iTCP:5173 -sTCP:LISTEN    # expect a com.docker listener on 127.0.0.1:5173 and nothing else
```

If the mapping is absent it cannot be added to a running container. Assignment record §7.2 steps 2, 3a and 3b are
the procedure and are followed verbatim — record image, mounts, env, workdir and restart policy first; prefer the
Compose route (add `ports: ["127.0.0.1:5173:5173"]` to the service, then
`docker compose config >/dev/null && docker compose up -d --no-build <service>`); otherwise `docker stop` — never
`rm` — and recreate with the recorded values plus `-p 127.0.0.1:5173:5173`. §7.2 also states what recreation does
**not** preserve (the pinned Node under `$HOME/.local`, the corepack pnpm shims, the pnpm store), and its §2.1
provisioning snippet is idempotent.

### Step 2 — inside the container: start the preview

```sh
cd /workspace/UntitledDinosaurGame
git rev-parse HEAD                       # d318444fe8668f4485d85398ecc6eb88ff5e3b36 or its record successors
export PATH="$HOME/.local/node-v24.22.2-linux-arm64/bin:$HOME/.local/bin:$PATH"
UDG_DEV_HOST=0.0.0.0 VITE_UDG_SERVER_URL=ws://127.0.0.1:2567 pnpm dev
```

Expect the Vite banner with **both** lines — `Local: http://localhost:5173/` and
`Network: http://<container-ip>:5173/` — plus `[udg] UDG_CLIENT_READY server=ws://127.0.0.1:2567
client=http://127.0.0.1:5173/`. Without `UDG_DEV_HOST` the banner prints no `Network:` line and the mapping has
nothing to forward to; that is the default, not a failure. Check the container side first, from a second shell in
the same container:

```sh
curl -sS -o /dev/null -w 'container-side %{http_code}\n' http://127.0.0.1:5173/
```

`VITE_UDG_SERVER_URL` is optional and only names the socket the client dials; no UDG-003 server is running, so the
overlay is expected to show the failure state.

### Step 3 — on the Mac: the reachability check, then the browser

```sh
curl -sS -o /dev/null -w 'mac -> %{http_code}\n' http://127.0.0.1:5173/    # must be 200
open http://127.0.0.1:5173/
# and prove it did not reach the Mac's routable interface
curl -sS -m 2 -o /dev/null -w '%{http_code}\n' "http://$(ipconfig getifaddr en0):5173/" || echo "off-loopback: refused (expected)"
```

A `000` or refused result means the mapping is missing or the container was not recreated — a host configuration
problem, not a client bug. An HTTP 200 on the off-loopback address means the port is exposed on a routable
interface: stop the server and fix the mapping. `Host:` is `127.0.0.1:5173` on this route, so
`server.allowedHosts` stays unset (and must never be `true`), and HMR reconnects through the same port, so no
`server.hmr` override is needed.

### Step 4 — stop it

`Ctrl-C` in the terminal running `pnpm dev`, then confirm on both sides:

```sh
curl -sS -m 2 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5173/ || echo "host: refused (expected after stop)"
lsof -nP -iTCP:5173 -sTCP:LISTEN || echo "host: nothing listening"
```

Leaving the container running is fine; the published mapping is harmless while nothing listens, and the repository
has no command that sets `UDG_DEV_HOST`.

### What was measured, and what was not

Measured in this container on port 5173 with the pinned Vite 8.3.6: the banner lines above,
`curl http://127.0.0.1:5173/` → `200`, `curl http://<container-ip>:5173/` → `200` (the address Docker's `-p` proxy
connects to), and a second server refused with `Error: Port 5173 is already in use`, which is `strictPort` proven.
**Not measured here: the `-p` mapping itself, anything on the Docker host, and anything in macOS Chrome.**

This preview is **human inspection and produces no evidence**. GitHub CI is the acceptance record, because CI is
where the suite runs against the pinned Chromium and writes retained artefacts. A preview that looks right on a Mac
and was never run in CI proves nothing about this task's acceptance criteria — and, until it is run, it proves
nothing at all.

## Control rulings from the Mac review (2026-11-16, three rounds)

Three rounds came from the reviewer driving the preview on a Mac, and all three are recorded because the third
undoes part of the second — a record that kept only the latest wording would invite someone to "correct" the sign
back the wrong way.

**Round 1, at `2d2be86`.** Pitch and zoom felt right; horizontal mouse drag felt inverted. The ruling was to reverse
the horizontal direction for mouse drags and nothing else, which put the mouse on the opposite sign from touch. The
measurements from that head are kept in the table below as the "round 1" column.

**Round 2, this head.** Three changes, all narrow:

* **Middle-mouse drag orbits and pitches.** The mouse gesture moved off the left button, and its horizontal
  direction was reversed **again** from the round-1 build — which lands the azimuth on `−dx`, the sign a touch drag
  has always used. `camera-math.ts` therefore lost its per-device direction table entirely: one convention, no
  branch, and the comment on `orbitStepRadians` carries both rulings so the sign is not "corrected" back by
  someone who read only one round.
* **Left press and left drag do nothing at all**, counted in `leftPressesIgnored`, so UDG-008 has the button for
  click-to-move. Middle `mousedown` is default-prevented on the canvas, because middle-click is autoscroll on some
  platforms and primary-paste on X11 — an orbit control that triggers either is a bug report waiting.
* **Arrow keys move the camera while the scene canvas holds focus** — Left/Right orbit, Up/Down pitch through the
  same 10°–80° clamp a drag uses (`KEY_ORBIT_RADIANS_PER_PRESS` 0.05 rad ≈ 2.86°, `KEY_PITCH_DEGREES_PER_PRESS` 2°).
  The canvas is `tabindex="0"` with a 4 px focus ring drawn inside its own edge, the key listeners sit on the canvas
  and nowhere else, `preventDefault()` is called for those four keys and for nothing else, a modified arrow
  (ctrl/meta/alt) is left alone as a browser shortcut, and `blur` clears the held-key set so an arrow still down
  when focus leaves cannot keep driving the camera, nor its autorepeat.

**Round 3, this head.** Tested on a Mac again, two findings, both fixed here:

* **The middle-mouse horizontal direction is reversed again, in both directions**, and the one-finger touch orbit is
  left exactly as it is. That separates the two devices once more, so the per-device table came back — now
  `ORBIT_AZIMUTH_DIRECTION = { mouse: +1, touch: −1 }`, with the three rulings written into its comment. Vertical
  mouse pitch, wheel zoom, pinch zoom, the left button's inertness, the camera bounds and the overlay's gesture
  exclusion are untouched.
* **Holding an arrow key now moves the camera continuously.** A press used to be a step, which on a Mac reads as a
  pause and then a stutter, because it rode on the platform's key-repeat cadence. Now `keydown` adds to a `heldKeys`
  set, `keyup` removes it, and nothing on either event writes the camera; `ClientRuntime`'s render loop calls
  `camera.stepHeldKeys(deltaSeconds)` once a frame with the elapsed time measured around the loop body, and
  `heldKeyCameraStep` integrates whatever is held (`KEY_ORBIT_RADIANS_PER_SECOND` 1.2 rad ≈ 68.8°/s,
  `KEY_PITCH_DEGREES_PER_SECOND` 45°/s, interval clamped by `MAX_FRAME_SECONDS` 0.1 s). So there is no initial pause,
  no repeated jump, and no dependence on autorepeat — `event.repeat` is ignored outright. Motion ends when the state
  empties: `keyup`, canvas `blur`, and the window-blur / `visibilitychange: hidden` path that `ClientRuntime` already
  routes through `cancelActiveGestures()` while stopping the loop. Bounds are unchanged because pitch still goes
  through `elevationDegreesToBetaRadians`, the only place 10°–80° is written.

**Keyboard continuity, measured the way the reviewer has to be able to test it** — one `keydown`, **no repeat
events**, then the **client's own frame clock**. `cameraKeyFrames` counts the frames in which held keys drove the
camera, so the assertions below hold identically on a 60 fps laptop and on CI hardware that renders at a fraction of
that; the first version of this case measured angles inside fixed 500 ms windows instead, and CI run 43890629291
failed it. See "What CI cost to get the keyboard assertions right".

| Measurement (from the CI bundle at `d318444`) | Value | What it rules out |
| --- | --- | --- |
| One keydown, swept 25.34° | **18** driven frames, **1.408° per frame** | a single jump, or one step per keypress |
| Movement first visible | driven frame **3**, **118 ms** after the keydown | an initial pause |
| Same angle in the other direction | +25.04° over **18** frames — frame ratio **1.000** | an axis that works one way, or at two rates |
| Upper bound per frame | cap is **6.88°** (1.2 rad/s × 0.1 s clamp); measured **1.408°** | a teleport on the first frame |
| Frames driven after `keyup` | **0** | a held state that survives release |
| After canvas `blur`, key still down | azimuth identical across 350 ms, frames frozen | motion that continues unfocused |
| Held with focus on a button | **0** key steps, **0** driven frames, camera unchanged | a listener that ignores focus |
| ArrowUp / ArrowDown held | exactly **80°** and **10°**, never past | a second, keyboard-only bound |
| Whole case, cumulative | **234** driven frames (locally: 22 frames for the sweep, **1.145°/frame**, first movement on frame 1 at 16 ms) | — |

**Measured, all three rounds side by side.** Same case, same default camera state, 200 px drags at the canvas
centre, 10 key presses; the round-1 column is the retained artefact of `2d2be86`:

| Gesture | Round 1 | Round 2 | This build (round 3) |
| --- | --- | --- | --- |
| 200 px middle-mouse drag right | +68.755° | −68.755° | **+68.755°** (reversed again) |
| 200 px middle-mouse drag left | −68.755° | +68.755° | **−68.755°** |
| 200 px touch drag right | −68.755° | −68.755° | **−68.755°** — never changed |
| 200 px touch drag left | +68.755° | +68.755° | **+68.755°** — never changed |
| 60 px mouse drag down | +20.626° elevation | +20.626° | **+20.626°** — never changed |
| 200 px **left**-button drag ×2 | orbited | camera unchanged, 2 refusals | **camera unchanged to 6 decimals, 2 refusals** |
| Arrow keys, one keydown | keys did nothing | needed 10 press events for −28.6° | **25.34° swept in 18 driven frames, 1.408° each, no repeats sent** |
| ArrowUp / ArrowDown held | n/a | per press | **80°** and **10°**, clamped, never exceeded |
| Keys with focus on a button or off-canvas | n/a | 0 steps | **0 steps, 0 frames**, camera unchanged |
| Focused canvas outline | none | 4px ring | **4px solid rgb(89, 201, 138)** |

Mouse and touch are equal and **opposite** again (`camera.mouseInvertedAgainstTouch`, `|mouseRight + touchRight| < 2°`,
measured 0.000°) — recorded as numbers in the bundle, not only as a passing case, so a future drift is visible there.

**Why the assertions are signed, and why the unfocused-keyboard assertion reads a counter.** The orbit case used to
assert `|Δazimuth| > 5°`, which the opposite direction passes happily: it proved the axis moved, never which way. It
now names the sign for mouse-right, mouse-left, touch-right and touch-left, and requires the two mouse drags to be
mirror images. The keyboard case asserts against `cameraKeySteps` as well as against the camera, because "the camera
did not move" is also what a keyboard listener wired to nothing looks like — the counter says the refusal was
deliberate, and the case then refocuses the canvas and proves the same keys *do* move it, so the unfocused assertion
cannot be vacuous. Left-button inactivity is asserted the same way, with both presses counted.

### What CI cost to get the keyboard assertions right

Run [`43890629291`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43890629291) is red, and the
fault was mine rather than the client's: the first version of case 8 asserted that the two keyboard directions cover
the **same angle inside a fixed 500 ms window** (within 6°) and that the implied rate lands between 40°/s and 100°/s.
Locally, at 60 fps, that passed with room to spare. On CI it failed — the runner renders several times slower, and
`MAX_FRAME_SECONDS` deliberately caps how far one slow frame may carry the camera, so two identical holds
legitimately covered different angles. The assertion was measuring the machine.

That is worth recording rather than quietly amending, because the fix is the interesting part. Case 8 now measures on
`cameraKeyFrames`, which counts exactly the frames in which held keys drove the camera, and defines a sweep by an
**angle to cover** rather than a time to wait. The properties the reviewer asked for survive intact and are now
machine-independent: movement must appear within the first three driven frames (no initial pause), at least four
frames must carry the sweep (no repeated jump), no frame may carry more than the 6.88° that
`KEY_ORBIT_RADIANS_PER_SECOND × MAX_FRAME_SECONDS` permits (no teleport), both directions must need about the same
number of driven frames for the same angle (mirrored), and zero frames may be driven after `keyup` (it stops).
Because no repeat keydown is ever sent, a build that steps per keypress still fails the case outright: it never
completes the 25° sweep at all.

Run [`43893238010`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43893238010) then went red at
attempt 1 on UDG-003's `W-7` — inside UDG-004's own capture `test` step, with the camera suite green on both
attempts — and green on attempt 2. That red is UDG-003's, recorded under its own heading below, and it is now the
seventh W-7 red across five runs.

**No plan threshold moved this round.** Round 3 is behaviour inside cases the plan already counts: the middle-mouse
signs sit in the orbit case, and the continuous-keyboard measurements extend the eighth case rather than adding a
ninth, so `camera.cases` still reads `=== 8` and the required-file and screenshot lists are untouched.

**One plan threshold moved, and it is named.** `camera.cases` was `=== 7`; the keyboard needs its own case, so the
plan's own wording now says `=== 8 cases … suites.expected === 8` and the contract suite asserts both halves (eight
names declared, and the plan text saying eight). Nothing else in the plan moved: same required files, same six
screenshots — deliberately no seventh, because the screenshot gate rejects any PNG the plan does not name — same
commands, same other thresholds.

**Where the three rounds landed.** Round 1: `2d2be8646ad4ab7caa17637d10bdf553a20ce313`, green on run 43852121401
attempt 3. Round 2, with the middle button, the inert left button, the keyboard and the eighth case:
`805ede694dbc135ebd7e8afc047a905637dedae6`, green on run 43871936471 attempt 2. Round 3, the third horizontal
reversal plus continuous keyboard motion: `3448bc66fb97cb4c1e2a202a9779a5a67016510a`, red on run 43890629291 for a
reason in **my test** rather than in the client, and then `d318444fe8668f4485d85398ecc6eb88ff5e3b36` with that test
re-measured on the frame clock, green on run 43893238010 attempt 2, whose bundle is named under "Raw evidence directory".
The attempts that went red at UDG-003's W-7 before each green are named there too, so the rerun history is visible
rather than implied.

**What was preserved, with the number that says so.** Elevation still clamps at **10°** and **80°** for drag *and*
keyboard; radius still clamps at **2 m** and **20 m** by wheel and by pinch; UI-origin gestures are still ignored
(**2** regions tested, camera unchanged to six decimal places, now on the middle button as well); pose writes during
camera operations are still **0**; handedness probes still **9 of 9**; the ten mount/unmount cycles and the
production-seam absence checks are untouched, with the controller's listener count rising from 6 to 10 and returning
to **0** after dispose like everything else it registers.

## Browser checks the reviewer can try

With the dev server up (and no server on 2567, which is the normal state — the connection status will read
`failed` and should stay readable):

1. **Middle-drag to orbit; the left button must do nothing.** A **middle** drag turns the camera — right
   increases the azimuth, left decreases it (this direction was reversed a third time on the reviewer's Mac test) —
   and a drag **down** raises it toward 80°. A **left** press or drag leaves the camera exactly where it was: that
   button is reserved for UDG-008's click-to-move, and the overlay's `Gestures` line counts the refusals
   (`leftIgnored=`) so you can see the client saw the press and declined it. A one-finger **touch** drag still keeps
   the scene under the finger, which is deliberately the *opposite* direction to the mouse.
2. **Hold an arrow key on the focused canvas.** Tab (or Shift+Tab from the overlay's buttons) lands on the scene and
   a green ring appears inside its edge. **Holding** Right or Left should sweep the camera at a steady ~70°/s from
   the very first frame — no pause, no stepping — and stop the instant you release. Up/Down pitch to 80° and 10° and
   stay there. Tab away to a button, or click the overlay, and the same keys do nothing to the camera while still
   scrolling the page normally: only the four arrows on the focused canvas are swallowed, and the `keyFrames=`
   counter in the overlay shows the loop driving the motion.
3. **Wheel to zoom.** It stops hard at 2 m and at 20 m and does not creep past either on repeated notches.
4. **Pinch on a touch device or touch emulation.** Two fingers together → 4-pointer orbit, spread → zoom in.
   It clamps to the same 2 m and 20 m. (In Chrome DevTools device mode the suite's dispatched-touch path is
   what runs.)
5. **Gestures that start on the overlay or the status line must not move the camera.** Start a drag on the
   counters text or the connection status, not on a button — buttons are buttons on purpose.
6. **Watch the two markers.** One entity holds a static pose at x = 2.5, the other walks. Orbiting, zooming or
   pinching must not move either one, and if you blur the window (focus loss stops the loop) and orbit anyway,
   the numbers in the overlay stay put while the camera moves.
7. **Axis handedness.** The positive arms carry a cap and reach 3 units; the negative arms are shorter, on the
   negative side, and carry no cap. If the negative arms ever appear on the positive side, that is the exact
   regression the ray-probe check exists to catch.
8. **Resize the window.** The canvas follows, the camera stays framed on the target, and nothing throws.
9. **The mount/unmount button, then the harness.** `window.__udgClientHarness.cycle(10)` in the console, then
   `snapshot()`: after ten cycles `engines`, `scenes`, `meshes`, `materials`, `observers`, `listeners` are all
   0 and `frameRequestsAdvanced` stops advancing. Re-`mount()` and the scene is live again.
10. **Confirm the seam is not in what you ship.** `pnpm build && grep -r "__udgClientHarness" apps/client/dist`
   must print nothing, source maps included — that is the check the task suite runs on every acceptance
   capture.
