# UDG-004 completion record

Appendix B2 submission record for the browser client and camera. The implementer recorded no acceptance of its
own work (root [AGENTS.md](../../AGENTS.md), "do not self-sign adoption, reviewer acceptance, or gate passes"):
every decision field below is **Pending** until the owner records it. UDG-004 validates no gate — Gates A, B and
C stay **Not Run** and `stackCompatibility` stays **not-established** — so the gate field says so rather than
being left blank by accident.

```text
Task ID and final implementation SHA:
  UDG-004 Browser client and camera.
  Submitted head      0ad8d9e9f57d98242e62b390f92bda54acfa755f (pushed to main) — the head the acceptance
                      evidence below describes, the head CI run 43770588357 is green on, and the head whose
                      camera artefacts are stamped `implementationSha: 0ad8d9e9…` with
                      `workingTreeDirty: false`.
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
    * Not exercised: "a failed asset load must not crash the UI". The greybox loads no files — there is no
      asset pipeline and no network asset in this client — so the condition has no reachable path to test.
      The nearest measured evidence is that two other hostile conditions leave the UI rendering and the loop
      ticking: a refused WebSocket (the development socket, refused on purpose) and a cancelled pointer
      gesture (`gesturesAfterCancelStillTicking === true`). UDG-007 owns the asset pipeline.
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
  | camera.cases | 7 cases, each passed | 7 |
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
  CI capture (authoritative): `UDG-004-2026-11-15T23-21-30-673Z-0ad8d9e9` inside run 43770588357's
  `udg-evidence` artefact, retained at
  `/workspace/udg-evidence/ci-run-43770588357/UDG-004-2026-11-15T23-21-30-673Z-0ad8d9e9` — 35 files hashed,
  `pnpm evidence:verify` → **PASS, 0 issues** after the copy, beside the CI captures of UDG-001, UDG-002 and
  UDG-003 from the same job. The committed summary
  [UDG-004-evidence.json](UDG-004-evidence.json) is generated from **that** bundle, not from a local one.
  Local capture, same head: `UDG-004-2026-11-15T22-37-36-275Z-0ad8d9e9` — status PASS, 34 files hashed,
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
  Run 43770588357, workflow `ci`, event push, head 0ad8d9e9f57d98242e62b390f92bda54acfa755f.

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
    in another task's suite, not a UDG-004 assertion, and UDG-004 does not re-tune it. It is reported here
    because the same job that runs it is now measurably heavier than the job that used to run it (chromium
    download, a browser suite, two new test files), and because "a rerun was green" is only informative if the
    red run is named: run 43770588357 attempt 1, retained with its bundle on GitHub. If the owner prefers, the
    follow-up this observation suggests is to make UDG-004's E-6 verify sibling bundles **in-process** through
    the exported `verify()` rather than by spawning `pnpm evidence:verify`, which removes a CPU-heavy
    subprocess from inside every other task's capture without weakening the demonstration. That is an owner
    decision about another task's timing budget and about UDG-004's evidence work, so it is offered, not taken.
  * The two earlier red runs on the way here — `43764611170` (head `2e9184b`, the pixel-sweep handedness check
    described above) and `43766691106` (head `1100233`, `chromiumBuild: unknown` plus UDG-004 tests failing
    inside UDG-001's and UDG-002's captures) — are kept for the same reason. All three are linked below.

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
  * "Failed asset load" has no reachable path in this client, for the reason given under Deviations.
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
  Every acceptance item that can be executed is executed and measured at the submitted head, the bundle
  verifies with 0 issues, and the hosted CI link above is the acceptance record. Two items are reported as
  not-executable rather than as passed: the failed-asset-load condition (no reachable path in a client that
  loads no assets) and physical-device touch performance (browser emulation only). Neither is a claim of
  success about something untested.

Reviewer decision and date: **Pending** — the owner records this.
Integration owner gate decision and date: **Not applicable to UDG-004** — no gate is decided here; Gates A,
B and C remain Not Run and UDG-SPIKE-001 remains the formal Gate A execution.
```

## Mac preview check — how to run it, and what it is worth

The implementer's environment is a Linux container; **the Mac-side check was not performed**. The route was
measured end to end in the container (assignment record §7) and the commands are reproduced here so the
reviewer can run them without re-deriving them:

```console
# inside the container, from the repository root at the submitted head
export PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
UDG_DEV_HOST=0.0.0.0 VITE_UDG_SERVER_URL=ws://127.0.0.1:2567 pnpm dev
# banner shows both lines:  Local: http://localhost:5173/   Network: http://<container-ip>:5173/

# on the Docker host, mapped to the host's own loopback only
docker run -it --rm --network host alpine/socat \
  tcp-listen:5173,fork,reuseaddr tcp-connect:<container-ip>:5173

# in Chrome on the Mac
http://127.0.0.1:5173/
```

Measured on this container: `curl http://127.0.0.1:5173/` → `200`, `curl http://<container-ip>:5173/` → `200`,
and a second server on 5173 refused by `strictPort` with `Error: Port 5173 is already in use`. The default bind
stays loopback and prints no `Network:` line; `UDG_DEV_HOST=0.0.0.0` is the only way to expose it, and the
banner says so out loud.

This preview is **human inspection and produces no evidence**. GitHub CI is the acceptance record, because CI
is where the suite runs against the pinned Chromium and writes retained artefacts. A preview that looks right
on a Mac and was never run in CI proves nothing about this task's acceptance criteria.

## Browser checks the reviewer can try

With the dev server up (and no server on 2567, which is the normal state — the connection status will read
`failed` and should stay readable):

1. **Drag to orbit.** Left-drag on the scene: azimuth wraps within `[0, 360)` and elevation stops at 10° and
   80° without the camera flipping or going still-and-finite-broken. Dragging *down* raises the camera, which
   is the grab-the-world convention the client documents, not Babylon's pointer convention.
2. **Wheel to zoom.** It stops hard at 2 m and at 20 m and does not creep past either on repeated notches.
3. **Pinch on a touch device or touch emulation.** Two fingers together → 4-pointer orbit, spread → zoom in.
   It clamps to the same 2 m and 20 m. (In Chrome DevTools device mode the suite's dispatched-touch path is
   what runs.)
4. **Gestures that start on the overlay or the status line must not move the camera.** Start a drag on the
   counters text or the connection status, not on a button — buttons are buttons on purpose.
5. **Watch the two markers.** One entity holds a static pose at x = 2.5, the other walks. Orbiting, zooming or
   pinching must not move either one, and if you blur the window (focus loss stops the loop) and orbit anyway,
   the numbers in the overlay stay put while the camera moves.
6. **Axis handedness.** The positive arms carry a cap and reach 3 units; the negative arms are shorter, on the
   negative side, and carry no cap. If the negative arms ever appear on the positive side, that is the exact
   regression the ray-probe check exists to catch.
7. **Resize the window.** The canvas follows, the camera stays framed on the target, and nothing throws.
8. **The mount/unmount button, then the harness.** `window.__udgClientHarness.cycle(10)` in the console, then
   `snapshot()`: after ten cycles `engines`, `scenes`, `meshes`, `materials`, `observers`, `listeners` are all
   0 and `frameRequestsAdvanced` stops advancing. Re-`mount()` and the scene is live again.
9. **Confirm the seam is not in what you ship.** `pnpm build && grep -r "__udgClientHarness" apps/client/dist`
   must print nothing, source maps included — that is the check the task suite runs on every acceptance
   capture.
