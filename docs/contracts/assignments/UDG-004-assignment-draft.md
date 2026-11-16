# UDG-004 Browser client and camera — **SUPERSEDED draft revision 2 — assigns nothing**

> **Superseded.** The owner's next instruction finalised this draft, and this file is no longer the operative document:
> the [UDG-004 assignment record](UDG-004.md) governs, on implementation baseline
> `089ae33d2d0df346d5a1de8e756971c605dc839a` (this revision-2 commit, CI run `43740515165` **success**). It is retained
> for its measurement tables and its rejected-option reasoning, which the record cites rather than duplicates. Where
> this draft and the record differ, **the record governs**. The four rulings the final round changed or fixed are:
> **G-5 withdrawn** ("keep ESLint unchanged", so `eslint.config.mjs` is byte-identical and `.tsx` coverage there was
> never a gap); the `--network container:…` + `-p` sidecar route **removed** in favour of `-p 127.0.0.1:5173:5173` with
> `UDG_DEV_HOST=0.0.0.0` in the preview container; **GitHub CI** ruled the authoritative capture with the
> **single-JUnit format kept**; and **G-9(b)** given a proof obligation — a real PNG must survive capture byte-for-byte
> *and* still open, which the record measures (§6.2 E-4/E-5) instead of asserting. Sections below still describe a draft
> in the proposing voice; read them as history of the measurement, not as a live proposal.

Status before supersession: **Draft for owner review. UDG-004 was Not Started and unassigned; implementation was
unstarted.**
This file granted no path, moved no status field, adopted no refinement and created no source file. On the owner's
instruction it became `docs/contracts/assignments/UDG-004.md`, re-pinned to `main` at that moment. The authority
for what UDG-004 must deliver stays in [UDG-004.md](../UDG-004.md); nothing here widened it.

Revision 2 responds to the owner's approval of the browser scope **in principle** and to four explicit rulings
(§0). It also **corrects one factual error in revision 1** about `.tsx` linting, and adds the four things the owner
asked for: the Mac-over-Docker access route, exact pins with compatibility evidence, the exact controlled-file
grants with the UDG-001 assertions they move, and the authoritative CI/evidence plan with the mount/unmount seam
and the Phase 3 merge order.

What is unchanged by this round, and unchanged by accepting it:

- [adoption](../adoption.md) still records *"Nothing beyond UDG-003 Phase 0 is assigned: UDG-003 Phases 1 to 3,
  UDG-004 and every later task stay unassigned"*, and the
  [UDG-003 Phase 2 acceptance](../adoption.md#udg-003-phase-2-acceptance-recorded-2026-11-14) still ends
  *"Authorises: acceptance records only. It assigns no further work and reopens no closed decision."*
- **Gate A, B and C remain Not Run.** `stackCompatibility` remains **not-established**.
- **UDG-003 Phase 3 remains unassigned**; UDG-003 as a whole remains **In Progress**.
- **D4 (independent evidence backup) remains open and undesignated.** No new store, archive, tag or release is
  authorised by this draft.
- No repository pin is changed to match the container this draft was written in (§8).

```text
Draft pinned to                                  81a341fb88d02550df663dfbe3142e083a8ff050 (main, clean tree)
                                                 — "docs(UDG-003): point the Phase 2 headers at the acceptance"
Baseline CI on exactly this commit               run 43591597910: UDG-001, UDG-002 and UDG-003(phase-2) bundles
                                                 all status PASS, 572 tests, 0 failures, 0 errors, 0 skipped,
                                                 environment.nodeVersion v24.22.2, gitDirty false
Retained at                                      /workspace/udg-evidence/ci-run-43591597910/
Contracts edition                                UDG-CONTRACTS-M0-001 v1.0, repository edition 1
UDG-004 task contract — docs/contracts/UDG-004.md  c6abc27b3268a2c3118dbd61cc24af111bcf911b088653057f8d7273736e1889
Checksum manifest at the draft commit             docs/contracts/checksums.json, 65 entries, `in sync … 0 change(s)`
                                                 (`docs/contracts/assignments/` is an excluded path, so this file
                                                 moves no manifest entry and needs no regeneration)
Baseline specification                           UDG-SPEC-M0-002 v0.2, SHA-256
                                                 b51e7afdd6810c377d2d2702d7673119521a59cd0d6b91686700bf9149b73fcf
Prerequisite — UDG-001                           Verified 2026-11-08, acceptance commit
                                                 524658e1fb4c53a450cdf933886c7ad4b17c72e9 (implementation 1c735c2,
                                                 reviewed submission 0e586b6)
Not a prerequisite — UDG-002                     Verified 2026-11-09, acceptance commit
                                                 d364d2dafbc88f469ef60e5e61c5e5c5c6cfd7e4; consumed for `Vec3`,
                                                 not required
UDG-003 at the draft commit                      In Progress: Phase 0 accepted as ADR-0002, Phase 1 accepted at
                                                 phase level `5d77c612…`, Phase 2 accepted at phase level
                                                 `6e0e5cc8…` CI 43584855957, Phase 3 **unassigned**
Revision history                                 revision 1 was returned for review in the working tree and was
                                                 never committed; this commit is the file's first entry in
                                                 `git log -- docs/contracts/assignments/UDG-004-assignment-draft.md`,
                                                 which stays authoritative for it because a commit cannot name itself
```

A draft pin is not an implementation base. Assignment re-pins to `main` and records the base commit, its CI run and
the contract hashes at that moment.

---

## 0. What changed in revision 2

### 0.1 Owner rulings this round (recorded, not re-opened below)

| Ruling | Effect in this draft |
| --- | --- |
| The UDG-004 browser scope is **approved in principle** | §4 stays as scoped; it is still *not assigned* (D-004-1) |
| **Use local test poses** | §4.2 stands: `setPresentedPose` is the only pose inlet, two named local poses, no server |
| **`ClientConnection.ts` stays free of Colyseus SDK imports** for this assignment | §4.3 is now the ruled position, not a proposal: no `@colyseus/sdk`, no `@colyseus/*` import in `apps/client`, register entry for the client records Babylon/React/Vite only |
| **2–20 m radius, 10–80° elevation, UI gesture exclusion** | §3/§4.1 W-5: these are the frozen values the clamping tests assert; **D-004-5 is answered** |
| **Placeholder placement independent of the pending physics decision** | §4.4 states the constraint as a tested rule: no P07 symbol, no controller offset, no gravity, no `restCentreY` |

### 0.2 Added in revision 2

- **§6** — how the owner opens the scene from a Mac while Pi runs in Docker: measured Vite bind behaviour, the
  publish/sidecar/tunnel routes, the Host-header rule, and the developer-preview vs Playwright-runner split.
- **§7** — exact proposed pins with the compatibility evidence actually measured against the repository's own
  compiler policy, including a Babylon line that cannot be used at all and the reason.
- **§8** — how Node `24.22.2`, pnpm `12.18.0` and Chromium get into the implementing environment **without editing
  a single repository pin**, plus what is already present in this container.
- **§9.3** — the exact grants for `.tsx` linting, browser/Vite-config typechecking and the camera dispatcher, with
  the accepted UDG-001 assertions each one moves and how the guard behaviour stays under test.
- **§10** — the authoritative CI and evidence capture plan, including two capture-mechanism defects measured while
  writing this revision.
- **§11** — the mount/unmount test seam, exactly.
- **§12** — merge order for the shared tooling files if UDG-003 Phase 3 starts in parallel.

### 0.3 Corrected from revision 1

**Revision 1 said `.tsx` is linted by nothing. That was wrong, and the measurement is in §9.4.** The accepted ESLint
config already lints `.tsx`: `--print-config` on a `.tsx` file reports the `typescript-eslint/parser@8.72.1`
parser, `@typescript-eslint/no-explicit-any: [2]`, `prefer-const: [2, …]` and `no-undef: [0]`, and a JSX file with a
`let` that is never reassigned plus an `any` produced exactly those two errors. So **grant G-5 is withdrawn**: no
ESLint change is requested. The real gap was never linting, it is **typechecking** (§9.4, grant G-6), and that one
is measured too.

---

## 1. Assignment record (template B1, proposed values)

| Field | Proposed value | Status |
| --- | --- | --- |
| Task ID and objective | `UDG-004` — **browser client and camera**: a Babylon.js greybox reachable in a browser, a React status UI and a bounded orbit/zoom camera driven by two local test poses | proposed |
| Contracts version and SHA-256 | `UDG-CONTRACTS-M0-001` v1.0 edition 1; `docs/contracts/UDG-004.md` `c6abc27b…` | re-taken at assignment |
| Baseline specification ID and SHA-256 | `UDG-SPEC-M0-002` v0.2 `b51e7afd…` | unchanged |
| Assigned implementer and reviewer | **unassigned** — draft only | **not assigned** |
| Integration owner | Project owner, GitHub `TomBResearch` | unchanged |
| Authorised checkout and branch | `main` of `TomBResearch/UntitledDinosaurGame`, no force-push | proposed |
| Prerequisite task IDs and commit SHAs | **UDG-001 Verified `524658e1…`** and nothing else required | prerequisite **met** (§2); the assignment is not |
| Verified gate evidence locations | Baseline bundles `/workspace/udg-evidence/ci-run-43591597910/`; task evidence to the **same existing store**, C-03 rules unchanged | **D4 remains undesignated**; no new storage location |
| Approved P01–P10 refinements and ADRs | P01, P02, P03, P06 approved; ADR-0001, 0002, 0003 accepted. UDG-004 declares no refinement. P07 pending is the reason for the §4.4 independence rule; P09 stays with UDG-008 | unchanged |
| Allowed file paths | §9 — proposed; controlled paths need the owner's named reviewer | **not granted** |
| Public interfaces implemented and consumed | `ClientRuntime` (`start`, `setPresentedPose`, `removePresentedEntity`, `dispose`) and `Pose {position: Vec3; yaw: number}`; consumes `@udg/protocol` (`Vec3`) and `@udg/config` (read-only adopted movement values). Implements no shared interface, changes none | proposed |
| Required commands, fixtures, profiles and seeds | §6, §10 and §13 — the four root commands, `pnpm test:contract -- --task UDG-004`, `pnpm test:e2e -- --suite camera`, `pnpm dependencies:verify`, `pnpm contracts:checksums`, `pnpm evidence:capture`/`verify` | proposed |
| Acceptance metrics and evidence destination | §13 — the ten contract checks, `camera-browser-results.json`, `lifecycle-counts.json`, `console-errors.json`, screenshots at the camera bounds; existing store only | proposed |
| Known blockers and escalation owner | §15 decisions, §12 merge order, §16 risks; escalation to the integration owner through an ADR | open |
| State and assignment date | **Draft revision 2. Not Ready, not assigned, no implementation started** | — |

---

## 2. Prerequisite confirmation, measured at the draft commit

**Dependency.** The contract requires Verified [UDG-001](../UDG-001.md) only; UDG-001 is Verified (owner acceptance
2026-11-08, `524658e1…`). The task index permits UDG-004 alongside UDG-002/003 once UDG-001 is done, so UDG-003's
unfinished Phase 3 does not gate UDG-004 — but it shares files with it (§12, §14).

**Refinements.** UDG-004 proposes none, so there is no P-number to adopt for it. P07 pending is *why* §4.4 exists.
P09 (dead zone, touch arbitration, mode handoff) is UDG-008's, so this deliverable builds a camera pointer handler
and no input-intent layer. P10 (numeric spike thresholds) does not reach a browser smoke suite. The boundary rule
table already permits `@babylonjs/` and `react` in `@udg/client` (neither appears in the client `denied` list), the
rule table hash is unchanged at `818c63d5b12f…`, and no boundary-rule edit is requested.

**Root commands at `81a341f`, executed here (exit codes as run, nothing inherited):**

| Command | Result | Note |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | exit **0** | 9 workspace projects; store `/workspace/.pnpm-store/v11`; "Already up to date" |
| `pnpm typecheck` | exit **0** | all workspaces, `@udg/client` still the intentional skeleton |
| `pnpm lint` | exit **0** | `boundary check OK: 72 file(s), 0 violations, rule table 818c63d5b12f` |
| `pnpm build` | exit **0** | clean, libraries, tools, both apps |
| `pnpm test` | exit **1** — `4 failed \| 568 passed (572)` | all four attributed to the host runtime, below |
| `pnpm contracts:checksums` | exit **0** | `in sync: docs/contracts/checksums.json (65 file(s), 0 change(s))` |
| `pnpm test:contract -- --task UDG-004` | exit **2** | `Task UDG-004 has no suite at tests/contracts/UDG-004.test.ts.` |
| `pnpm test:e2e -- --suite camera` | exit **1** | guarded refusal naming `UDG-004 (camera)` and `tests/e2e/<suite>.spec.ts plus installed Playwright browsers` |

**The four failures are this machine, not the tree.** This container runs Node **v24.22.3**; C-01 pins **24.22.2**.
`UDG-001 › toolchain pins` and `UDG-002 › measured thresholds` assert `process.version === 'v24.22.2'`;
`UDG-001 › workspace shape › verifies the register on a foreign host` fails because the register's
`runtime.node.version` is `v24.22.2` and `verification.excludes` covers `runtime.host.platform|arch` and
`generated.at|commit` but deliberately **not** the Node version; `UDG-002 › regression and scope › keeps the
UDG-001 suite green` is the cascade. CI on this exact commit is green (run `43591597910`, `nodeVersion
"v24.22.2"`, 572/572, three PASS bundles), so the baseline holds and the deviation is the local runtime — settled by
§8 rather than by relaxing an assertion.

**One stale accepted threshold, disclosed not repaired.** The retained UDG-001 bundle on this commit measures
`dispatch.refusedTasks = 8` and `dispatch.guardedCommands = 4` while the accepted plan prose still reads
`=== 10 (every contract task except UDG-001 refuses)` and `=== 5 guarded later-task commands…`. The prose moved
out of date as UDG-002/003 created suites and `test:unit` stopped being guarded; the verifier compares counts,
junit and hashes rather than prose, which is why it stayed green. UDG-004 does **not** edit that prose (it belongs
to accepted evidence); UDG-004's own plan states thresholds it actually measures, and the drift is named here so a
reader of the accepted plan is not misled.

**What is not met: the assignment itself.** Adoption records no implementer, reviewer or authorisation for UDG-004,
and the definition of done makes Ready conditional on the owner recording decision, date, reviewed commit and
manifest. §15 lists what remains.

---

## 3. What is already decided, so this draft does not re-open it

- `ClientRuntime` exposes exactly `start(canvas: HTMLCanvasElement)`, `setPresentedPose(entityId, pose)`,
  `removePresentedEntity(entityId)`, `dispose()`. `Pose` is `readonly {position: Vec3; yaw: number}`. **No method
  writes authoritative state.**
- Scene right-handed, Y-up, metres, configured **before** geometry; the floor carries an **asymmetrical** marker so
  a handedness error is visible.
- One animation loop, owned by the renderer; React renders status and debug controls only; mesh ownership and scene
  disposal explicit; no competing movement controller; camera/render state presentation-only.
- **Camera limits are owner-set for this assignment (revision 2): radius 2–20 m, elevation 10–80°, bounded target
  follow, pointer gestures consumed only outside active UI regions.** The clamping tests assert these numbers.
- **Local test pose** is permitted by the contract and required by the owner this round; **no Colyseus SDK import in
  `apps/client`** (owner ruling, §4.3).
- The README runtime contract: Vite development client on `http://127.0.0.1:5173`, ready signal *Vite ready line
  plus `UDG_CLIENT_READY` with the server URL it will contact*, shutdown on `SIGINT`, **loopback-only by default**.
  `.env.example` already names `UDG_CLIENT_PORT=5173`, `UDG_SERVER_URL=ws://127.0.0.1:2567`, `UDG_HOST=127.0.0.1`,
  and an accepted UDG-001 assertion requires those three lines to stay in that file.
- `playwright.config.ts` (UDG-001) pins chromium-only, `fullyParallel: false`, `workers: 1`, `retries: 0`,
  `baseURL: process.env['UDG_CLIENT_URL'] ?? 'http://127.0.0.1:5173'`, and writes
  `artifacts/.local/playwright-{junit,results}.*`.
- Evidence rules (§19.1, C-03): no tokens, cookies, private machine paths or credentials; `artifacts/` stays out of
  Git; screenshots prove basic behaviour only, and browser emulation certifies no device performance.

---

## 4. First deliverable (D-1) — the greybox you can open in a browser

One deliverable, one review: **a browser-visible greybox with two placeholder entities, a status UI and a bounded
orbit/zoom camera, driven by local test poses.** It joins no room, moves no character and owns no authority.

### 4.1 Work items

| id | Work | Boundary that keeps it honest |
| --- | --- | --- |
| **W-0** | **Pin probe (first commit, no feature code).** Install the §7 set frozen; prove `vite` boots and serves a `.tsx` module to the pinned Chromium; prove `tsc` is clean under the client project; record the result in `docs/integration/client-stack-v1.md` and refresh `docs/integration/dependencies.json` by command | this is the UDG-003 Phase 0 discipline applied to a client: pins and probes first, so a wrong pin costs one commit instead of a review round. Much of it is already measured (§7.3) — the probe re-measures it **on the pinned Node** |
| **W-1** | Client toolchain slice: exact pins in `apps/client/package.json`; `jsx: "react-jsx"` and a `.tsx`-covering `include`; `apps/client/vite.config.ts`; root `dev` script emitting the `UDG_CLIENT_READY` line | `apps/client/tsconfig.json` keeps `types: []` and `skipLibCheck: false` (§7.4); `vite.config.ts` imports no `node:*` (rule `BOUNDARY-NODE-BUILTIN-FORBIDDEN`) |
| **W-2** | `create-scene.ts`: right-handed Y-up metre scene, floor plane, **asymmetric axis marker** (unequal +X/+Z arms, distinct colours), at least one light | a light is required, not cosmetic: §13.2 records that an unlit mesh renders black, and a black-on-black screenshot would satisfy a naive non-blank check |
| **W-3** | `PlayerView.ts`: one mesh set per `entityId` from the adopted `@udg/config` movement values (`capsuleRadius 0.35`, `capsuleHeight 1.8`, centre `y = 0.9`) | §4.4 makes the independence from P07 a tested assertion rather than a comment |
| **W-4** | Local test poses (§4.2): frozen `Pose` objects, deterministic frame-driven motion, `setPresentedPose` as the only inlet | pose source only: reads no input, integrates no velocity into gameplay state, unreachable from the camera. "No method writes authoritative state" stays literally true |
| **W-5** | `OrbitCamera.ts`: pointer-drag orbit, wheel **and** pinch zoom, **radius clamp 2–20 m, elevation clamp 10–80°**, bounded target follow, gestures ignored over active UI regions | camera state lives in the camera; the only cross-boundary read is the followed entity's pose; nothing in the camera path may call `setPresentedPose` |
| **W-6** | `ConnectionStatus.tsx` + `DevelopmentOverlay.tsx`: explicit not-connected/failed state with the configured URL, no throw; overlay showing entity count, per-entity pose, camera radius/elevation/target, loop count, mesh/observer/listener counters and a mount/unmount control | React reads presentation state only; the status is displayed state, never an implied session |
| **W-7** | Lifecycle and disposal: loop created exactly once; aspect resize; blur/focus; `dispose()` releasing meshes, observers, engine, resize observer and every `window`/`document`/canvas listener, with a live-counter ledger | the ledger is the evidence for `lifecycle-counts.json`; a `dispose()` that returns fine but leaves a listener is FAIL |
| **W-8** | `tests/contracts/UDG-004.test.ts` (Node, no WebGL: pose immutability, clamp maths, UI-region predicate, status reducer, disposal ledger, exported-surface shape, §4.4 independence assertion) and `tests/e2e/camera.spec.ts` (browser: the ten contract checks) | the split is forced by WebGL, and neither suite may report the other's ground; the contract suite additionally **reads the Playwright JSON and fails if any browser case failed or the count is zero** (§10.2) |
| **W-9** | Evidence and docs: the §10.3 capture plan, the §10.4 CI step, README run/stop lines including the Docker route, `dependencies.json` refreshed by command | each is a controlled path in §9.3 |

### 4.2 Local test poses (the only "input" this deliverable has)

Two independent entities, so "renders the greybox and **two independent presented entities**" is met and camera
inertia is provable against both:

| entityId | Position (m) | yaw | Motion | Why |
| --- | --- | --- | --- | --- |
| `pose-local-0` | `(0, 0.9, 0)` | `0` | kinematic circle `x = 0.6·sin(t/2)`, `z = 0.6·cos(t/2)` from a monotonic frame counter | `0.9 = capsuleHeight / 2` from adopted config (§4.4); the circle stays inside the 2 m minimum radius so the clamp is observable at the marker |
| `pose-static-1` | `(2.5, 0.9, -1.5)` | `π / 2` | **static** | the control: must not move when the camera moves, and must survive removal of the first entity |

Poses are built once from `@udg/protocol` `Vec3` literals, `Object.freeze`d, driven by a frame counter rather than
`Date.now()` so a rerun reproduces. The driver lives in the dev harness, is labelled `LOCAL TEST POSE — not
authoritative` in the overlay, and is replaced by the real pose source in UDG-SPIKE-001/UDG-008 without changing a
`ClientRuntime` signature.

### 4.3 Connection status without the SDK *(owner ruling)*

`src/network/ClientConnection.ts` exposes a status state machine (`disabled → probing → failed`, carrying the
configured `UDG_SERVER_URL` for display) and **imports no `@colyseus/*` package**. This is now the ruled position
rather than a proposal. It keeps the status honest (no implied session), keeps `docs/integration/dependencies.json`
honest (the `@colyseus/sdk` entry keeps `importedBy: ["apps/server"]` and its note that prediction validation
remains UDG-SPIKE-001), and keeps ADR-0002 untouched — its "Not affected, explicitly" clause names
*"`apps/client` and every other workspace, package and tool"*, and its adoption entry records that the approval
"must **not** be extended to `apps/client` or any other project". The file carries a header naming UDG-SPIKE-001
(`ColyseusPredictionAdapter`) and UDG-008 as the owners of real transport, so the next task inherits a boundary
instead of a competing stack.

### 4.4 Placeholder placement independent of the pending physics decision *(owner ruling)*

P07 is **pending adoption**: the controller block, `gravity`, `controllerOffset`, ground snap and `restCentreY`
exist in `packages/config` as proposed test settings, and `docs/interfaces/configuration.md` ties the resting
height to "0.9 m plus the validated controller separation". So the greybox must not inherit a physics answer it has
no authority to assume. Concretely:

- placement reads **only** `MOVEMENT_DEFAULTS.capsuleHeight` and `capsuleRadius` (both adopted v0.2) and uses
  `capsuleHeight / 2` as the presentation centre;
- the client imports **no** controller/`restCentreY`/gravity symbol and no `@udg/config` value belonging to P07;
- the constant is declared in `apps/client/src/rendering/PlayerView.ts` as
  `PRESENTATION_CENTRE_Y_METRES = capsuleHeight / 2` with the comment "presentation convention, **not** a collision
  rest height; P07 pending";
- `tests/contracts/UDG-004.test.ts` asserts it by scanning the client sources for the banned identifiers
  (`restCentreY`, `controllerOffset`, `groundSnap`, `gravity`, `CONTROLLER_`) and by asserting the literal equals
  `MOVEMENT_DEFAULTS.capsuleHeight / 2`, so a later P07 adoption cannot silently move the greybox.

---

## 5. Explicitly out of scope for D-1

No Colyseus client, join, session, replica subscription or input send (UDG-SPIKE-001 owns
`src/network/{ColyseusPredictionAdapter,RemotePresentation}.ts`). No input intent controller, keyboard/touch/joystick
adapter, dead zone or destination marker (`apps/client/src/input/**` and `src/ui/{VirtualJoystickView,DestinationMarker}.tsx`
belong to [UDG-008](../UDG-008.md), P09 pending). No movement, prediction, reconciliation or camera-relative *intent*
mapping. No physics, collider or navigation import — `@udg/navigation` stays out of the client, since the boundary
rule permits it only as a UDG-007 compatibility probe. No `src/game/verify-region.ts` (UDG-007), no
`src/network/PredictionModeController.ts` (UDG-SPIKE-003). No server process is required by the camera suite. No
`skipLibCheck`, `types` or `tsconfig.base.json` change. No frame-time, fps or device-budget claim. No Gate A, and no
UDG-003/007/008 requirement inherited by proximity.

---

## 6. Opening the scene from the owner's Mac while Pi runs in Docker

### 6.1 What was measured about Vite's bind behaviour (not assumed)

Vite `8.3.6`, run inside this container (Debian 12, `aarch64`, eth0 `172.18.0.2`):

```text
$ vite --config v1.config.ts                      # server.port 5199, no host option
  VITE v8.3.6  ready in 108 ms
  ➜  Local:   http://localhost:5199/
  ➜  Network: use --host to expose

$ vite --config v1.config.ts --host
  ➜  Local:   http://localhost:5199/
  ➜  Network: http://172.18.0.2:5199/  eth0
```

Two facts follow, and they decide the whole section:

1. **By default Vite binds the container's loopback only.** Nothing outside that network namespace can reach it:
   neither the Mac, nor `172.18.0.2`, nor a published Docker port.
2. **`--host` binds `0.0.0.0` inside the container**, which is what a published port needs — because Docker's proxy
   connects to the container's *bridge* address, not to its loopback.

Vite 8.3.6 also exposes `server.allowedHosts?: string[] | true` (read from its shipped declarations): the Host-header
check rejects unknown hosts, and every route below presents `Host: 127.0.0.1:5173`, which the default already
allows. `allowedHosts` only needs a value for a named host or tunnel domain, and it takes a list, never `true`.

### 6.2 The loopback-only rule, and the one narrow opt-in

README and `.env.example` make loopback the default on purpose — *"Non-loopback exposure is refused unless the
owning task's explicit opt-in flag is set, because a development room bound to a routable interface is a security
problem"* — and an accepted UDG-001 assertion requires `.env.example` to keep `UDG_HOST=127.0.0.1`,
`UDG_CLIENT_PORT=5173` and `UDG_SERVER_PORT=2567`. So the client's dev-server bind is proposed as:

```
UDG_DEV_HOST   default 127.0.0.1        (Vite server.host). Any other value prints a loud warning naming
                                         the bind address and the fact that the port is now reachable
                                         from the host network; it is never set by a committed file.
```

`UDG_DEV_HOST` is a new `.env.example`/README line (grant G-1b, §9.3, **D-004-12**): the *default stays
`127.0.0.1`*, and the exposure decision is made by whoever sets the variable, in their own shell, each time. What
this draft does **not** propose is binding `0.0.0.0` by default, or publishing a port on the Mac's routable
interfaces.

### 6.3 Three routes from the Mac, in preference order

First, on the Mac, one look at what the container was given:

```sh
docker ps --format 'table {{.ID}}\t{{.Names}}\t{{.Ports}}'
```

**Route A — published port (preferred; needs the container to be (re)started with the mapping).**

1. Mac: start/restart the Pi container with `-p 127.0.0.1:5173:5173`. Binding the *Mac* side to `127.0.0.1` is what
   keeps the exposure loopback-only on the Mac.
2. Container: `UDG_DEV_HOST=0.0.0.0 pnpm dev` — required here, because a published port reaches the container via
   its bridge address and a loopback-bound Vite is invisible to it (§6.1).
3. Mac browser: **`http://127.0.0.1:5173/`**

**Route B — sidecar that shares the container's network namespace (no container restart, Vite stays loopback).**
**WITHDRAWN — do not run, in this or any variant.** Measured and found not to work as written: Docker registers the
mapping in the namespace `--network container:` joins, so nothing lands on the host. A `--network host`
`alpine/socat` forward to the container's bridge address does work but is withdrawn too, because it depends on a
mutable bridge address and puts forwarding outside Compose's control. The final ruling is Route A alone; see the
[assignment record](UDG-004.md) §7.1, and the completion record for the check/start/stop/curl steps.

1. Container: `pnpm dev` with the default `UDG_DEV_HOST=127.0.0.1`.
2. Mac: `docker run -d --rm --network container:<pi-container-name> -p 127.0.0.1:5173:5173 alpine/socat
   TCP-LISTEN:5173,fork,bind=0.0.0.0 TCP:127.0.0.1:5173`
   — `--network container:` puts the relay in the same namespace, so *its* `127.0.0.1` **is** the container's
   loopback: Vite never binds anything routable.
3. Mac browser: **`http://127.0.0.1:5173/`** — stop by deleting the relay container.

**Route C — remote Docker host.** Run **A** on that host (B is withdrawn above), then add
`ssh -N -L 5173:127.0.0.1:5173 <user>@<docker-host>` on the Mac and open **`http://127.0.0.1:5173/`**. The tunnel
does not cross the container boundary by itself; it carries one of the two routes above.

In the surviving routes the Host header stays `127.0.0.1:5173` → no `allowedHosts` entry. If a named host or a tunnel
domain is used instead, `server.allowedHosts: ['<that-host>']` is required and `server.hmr.clientPort` may be needed
for the HMR socket; the assignment's default config sets neither, and says so. Before starting, check the Mac port:
`lsof -nP -iTCP:5173 -sTCP:LISTEN` — a stale local server on 5173 produces a preview of something that is not this
repo, and `strictPort: true` is proposed so Vite refuses instead of silently sliding to 5174.

The preview also shows the failure state on demand: `UDG_SERVER_URL=ws://127.0.0.1:1 pnpm dev` must still render the
greybox with a visible failure — and inside the container that URL points at the container's own loopback, so the
"no server" case needs nothing running on 2567 at all.

### 6.4 Developer preview vs Playwright runner — different things, only one of them evidence

| | **Developer preview (the Mac)** | **Playwright runner (container / CI)** |
| --- | --- | --- |
| Browser | Chrome (or Safari/Firefox) on macOS, real GPU, real trackpad pinch | headless Chromium, build **1254** (measured UA `HeadlessChrome/158.0.8127.18`), software WebGL — §8.3 |
| Reached how | published port / namespace sidecar / tunnel, §6.3 | in the container's own namespace: `http://127.0.0.1:5173` — **`UDG_CLIENT_URL` is never pointed at the Mac** |
| Purpose | human inspection, feel of orbit/zoom/clamps, the status-failure case | the ten contract checks, and the only source of retained screenshots |
| Artefacts | none; nothing is written, hashed or retained | `camera-browser-results.json`, `lifecycle-counts.json`, `console-errors.json`, `browser/*.png` inside the bundle (§10) |
| Touch | real touch events on a real device | `hasTouch` emulation — proves event **mapping** only, certifies no device performance (contract, §19.3) |
| Authority | **not evidence.** A green/odd look here proves nothing about acceptance | **authoritative**, on the pinned runtime, and on CI by D-004-7 |

Two honesty consequences the completion record must keep: the Mac's trackpad pinch is a different input path from
the runner's emulated pinch, so neither certifies the other; and a Mac screenshot is never placed in a bundle,
because its bytes were not produced on the recorded runtime.

### 6.5 Today versus after the assignment

```sh
# TODAY, at 81a341f — there is no URL. Nothing serves 5173; no `dev` script exists;
# apps/client/src/index.ts is the intentional UDG-001 skeleton. These refusals are correct output:
pnpm test:contract -- --task UDG-004     # exit 2: "Task UDG-004 has no suite at tests/contracts/UDG-004.test.ts."
pnpm test:e2e -- --suite camera          # exit 1: guarded refusal naming UDG-004 (camera)
```

```sh
# AFTER assignment and D-1 — inside the container:
pnpm install --frozen-lockfile
pnpm dev                                 # ready line + UDG_CLIENT_READY {"serverUrl":"ws://127.0.0.1:2567"}
pnpm test:contract -- --task UDG-004
pnpm test:e2e -- --suite camera          # runner starts/stops its own dev server (§10.2)
pnpm evidence:capture -- --task UDG-004 --out artifacts
pnpm evidence:verify  -- --run artifacts/<UDG-004-RUN_ID>
# stop the preview with Ctrl-C (SIGINT) in the `pnpm dev` terminal; dispose must leave no loop or listener
```

### 6.6 What the owner will be able to try at that URL

1. A floor plane with an **asymmetric marker**: one long arm on +X, a shorter differently-coloured arm on +Z, so
   "which way is forward" is readable and a handedness swap is obvious rather than plausible.
2. **Two grey placeholders** at the adopted capsule proportions — one walking a slow circle, one standing at a
   different yaw — with the overlay printing both ids and live `x, y, z, yaw`.
3. **Orbit** by dragging on the canvas; the marker's parity and the follow target change as expected.
4. **Zoom** by wheel and pinch, hard-stopped at **2 m and 20 m**: past either limit the radius stops and the overlay
   reads exactly `2.000 m` / `20.000 m` rather than going through the floor or to infinity.
5. **Elevation** clamped at **10° and 80°**: no under-floor view, no gimbal-locked top-down.
6. **Target follow** on the moving entity, while the static one stays put — and both printed poses stay identical
   through every camera gesture, which is the contract's "camera operations never mutate either pose".
7. **The status pill** showing the configured server URL in an explicit not-connected/failed state, with the scene
   still rendering: no white screen, no permanent spinner.
8. **The overlay counters** (entities, loop count, meshes, observers, listeners) and the **mount/unmount control**,
   so the ten cycles can be done by hand and the counters watched returning to baseline.
9. **UI gesture exclusion**: a drag starting on the overlay or pill moves no camera; the same drag on the canvas does.
10. **Resize** (including a devtools device rotation): aspect re-fits without stretching, loop count unchanged.
11. **Tab blur/focus return**: the loop resumes without doubling and without a wheel-event burst.
12. **Touch emulation** (devtools): one-finger orbit, pinch zoom, same clamps — mapping only.

Not bugs: WASD movement, sessions, other players, physics, terrain, sound. Those are UDG-008, UDG-SPIKE-001,
UDG-006 and UDG-007.

---

## 7. Client dependency pins, with measured compatibility evidence

### 7.1 Proposed pins (exact, no ranges — P01 and `repository.md` §3.1; `.npmrc` is `save-exact=true`)

`apps/client/package.json` (all `dependencies` unless noted):

| Package | Pin | Licence | Role |
| --- | --- | --- | --- |
| `@babylonjs/core` | **`8.56.2`** | Apache-2.0 | the only engine package; ships its own `index.d.ts`, ESM `module`/`main` (unpacked 60,637,571 B / 6662 files) |
| `react` | **`19.3.1`** | MIT | UI |
| `react-dom` | **`19.3.1`** | MIT | `createRoot`; peer `react ^19.3.1` — satisfied by the exact pin |
| `vite` | **`8.3.6`** | MIT | dev server + build; `engines ^20.19.0 || >=22.12.0` |
| `@types/react` | **`19.3.0`** (dev) | MIT | |
| `@types/react-dom` | **`19.3.0`** (dev) | MIT | peer `@types/react ^19.3.0` — satisfied |

Deliberately **absent**, each for a stated reason:

- `@babylonjs/loaders` — no glTF in this deliverable (UDG-007 owns assets); its peers also drag
  `babylonjs-gltf2interface`.
- `@vitejs/plugin-react` — **measured unnecessary**: Vite 8.3.6 transformed and served a `.tsx` module that mounted
  React 19 and rendered a Babylon scene with no plugin at all (§7.3). Its own peer set (`vite ^8.0.0` required;
  `oxc-transform-react`, `@rolldown/plugin-babel`, `babel-plugin-react-compiler` optional) stays unexercised.
- `@webgpu/types` — not needed with Babylon 8.56.2, **and unusable anyway**: it would have to appear in
  `apps/client/tsconfig.json` `compilerOptions.types`, which an accepted UDG-001 assertion forbids (§9.4).
- `@colyseus/*` — owner ruling (§4.3).
- `vite@8.3.8` (current latest, same `engines`) — rejected in favour of `8.3.6`, which is **already the version the
  committed lockfile resolves for vitest 5.1.0** (rolldown 1.2.16-backed, no esbuild in the graph), so pinning it
  adds no second Vite and no new resolution to a lockfile that 572 accepted tests already exercise.

### 7.2 The problem the pin choice is answering

`tsconfig.base.json` sets `skipLibCheck: false`, ADR-0002's exception is confined to the two `apps/server` projects
and "must not be extended to `apps/client`", and the root tooling project's own relaxation is scoped to vitest and
playwright-core declarations. So **a client dependency's declarations are checked, in full, under repository
policy** — the same wall UDG-003 hit as PH0-B1, met here with a version choice instead of an exception.

### 7.3 Measured evidence (a scratch project outside the repository, the repo's own `tsconfig.base.json` options,
`lib: [ES2024, DOM, DOM.Iterable]`, `types: []`, `jsx: react-jsx`, TypeScript 5.9.3, and a probe exercising exactly
the UDG-004 surface: `Engine`, `Scene.useRightHandedSystem`, `ArcRotateCamera` with
`lowerRadiusLimit/lowerBetaLimit`, `MeshBuilder`, `StandardMaterial`, `Observable.observers`, React 19 `createRoot`
and JSX)

| Babylon line | `compilerOptions.types` | Diagnostics | First-party errors |
| --- | --- | --- | --- |
| `9.36.0` (current latest) | `[]` — repository policy | **154**, across 30 Babylon declaration files (all `TS2304 Cannot find name 'GPUBuffer' | 'GPUDevice' | …`) | 0 |
| `9.36.0` | `["@webgpu/types"]` (0.1.74 **and** 0.1.73) | 17 (`TS2687`/`TS2717` declaration-merge conflicts with Babylon's own `GPUDeviceLimits` augmentation) | 0 |
| **`8.56.2`** | `[]` — repository policy | **0** | **0** |
| `8.56.2` | `["@webgpu/types"]` 0.1.74 | 139 (adding the ambient library *creates* conflicts) | 0 |
| `7.54.3` | `[]` | 58 | 10 — the API surface this deliverable needs does not typecheck there |

Read off the table: **Babylon 9.36.0 cannot be used under this repository's policy** without a compiler-policy
exception (154 diagnostics; the WebGPU types are absent from TypeScript 5.9.3's DOM library, and adding
`@webgpu/types` still leaves 17 Babylon-side conflicts, and is forbidden by an accepted assertion anyway).
**Babylon 8.56.2 is declaration-clean as shipped, with no ambient types and no exception**, which is why it is the
proposed pin. First-party code was clean in every configuration, so this is purely a vendor-declaration property.

Runtime end-to-end proof of the whole proposed set, measured in this container:

```text
$ pnpm install          # the six pins above, scratch project
Packages: +23 … Done in 3.5s using pnpm v12.18.0        → no ERR_PNPM_IGNORED_BUILDS
$ vite (8.3.6, no plugin) serving a .tsx that builds a right-handed Babylon scene and mounts React 19
GL_OK: true            (scene.activeCamera truthy after boot)
STATUS_TEXT: "greybox 0"   (React 19 createRoot + useState rendered)
CANVAS_COUNT: 1
ERRORS: []             (no pageerror, no console error)
headless chromium 1254 screenshot: canvas painted, mesh silhouette visible
```

Two notes from that screenshot. None of the six packages declares `hasInstallScript`, and the frozen install ran no
build script, so **`pnpm-workspace.yaml` needs no `allowBuilds` entry** (grant G-7 stays unexercised). And the mesh
silhouette rendered *black*, because that probe scene had no light — which is why W-2 requires a light and why §13.2
refuses a luminance-only screenshot assertion: a black box on a dark clear colour would pass it.

### 7.4 What the pin set must not touch

`apps/client/tsconfig.json` keeps `"types": []` and `skipLibCheck: false`; `tsconfig.base.json` is untouched; no
`@types/node` in the client (`allowedAmbientTypes: []`); `jsx: "react-jsx"` plus a `.tsx`-covering `include` are the
only compiler changes, and `vite.config.ts` lives outside `src`, so it needs its own project rather than joining the
`rootDir: "src"` app project (§9.3, G-6).

---

## 8. Pinned Node, pnpm and Chromium in the implementing environment — no repository pin changes

**Rule for this assignment: the repository pins are the fixed side; the environment is what moves.** `.node-version`,
`package.json` `engines`, `.npmrc` (`engine-strict=true`), the CI Node version and
`docs/integration/dependencies.json` stay at Node `24.22.2` / pnpm `12.18.0`. Nothing is widened to suit the
container, and an off-pin run is labelled off-pin rather than made authoritative.

### 8.1 The gap being closed

| Requirement | Pinned | This container today |
| --- | --- | --- |
| Node | `24.22.2` | `v24.22.3` at `/usr/local/bin/node` (root-owned; `/usr/local/bin` is not writable by uid 1000) |
| pnpm | `12.18.0` | not on `PATH`; corepack `0.36.0` is present and works |
| Playwright | `@playwright/test` `1.65.0` → chromium build **1254** | **already installed** — §8.3 |
| OS | CI `ubuntu-24.04`, x64 | Debian 12 bookworm, `aarch64`, in Docker (`eth0 172.18.0.2`) |

### 8.2 Node 24.22.2 and pnpm 12.18.0, provisioned in the container without touching a pin

```sh
# Node — official tarball for this container's arch, checksum verified, installed under $HOME only:
curl -fsSLO https://nodejs.org/dist/v24.22.2/SHASUMS256.txt
curl -fsSLO https://nodejs.org/dist/v24.22.2/node-v24.22.2-linux-arm64.tar.xz
grep ' node-v24.22.2-linux-arm64.tar.xz$' SHASUMS256.txt | sha256sum -c -
mkdir -p "$HOME/.local" && tar -xJf node-v24.22.2-linux-arm64.tar.xz -C "$HOME/.local"
export PATH="$HOME/.local/node-v24.22.2-linux-arm64/bin:$HOME/.local/bin:$PATH"

# pnpm — the pinned version through corepack, into a writable PATH directory:
corepack enable --install-directory "$HOME/.local/bin"
node --version && pnpm --version          # v24.22.2 and 12.18.0
```

Measured here: `v24.22.2` is published (dated 2026-10-27, LTS "Krypton") with `linux-arm64` binaries in
`https://nodejs.org/dist/index.json` — the container's current `v24.22.3` is simply the newer patch (2026-11-10);
`corepack enable --install-directory "$HOME/.local/bin"` yields `pnpm 12.18.0` and the repo's scripts run
(`pnpm install --frozen-lockfile`, `typecheck`, `lint`, `build`, `contracts:checksums` all exit 0 with it). A
version manager (nvm/fnm/volta) is an equally acceptable route to the same end; a *container image rebuilt on
24.22.2* is the cleanest of all. None of them edits a repository file.

Until that PATH is in place, `pnpm test` locally shows the four C-01 pin failures of §2. The rule proposed for the
assignment: **those four failures are never a reason to touch an assertion, a pin or the register** — they are the
pin doing its job, and the authoritative capture happens on the pinned runtime (§10.1).

### 8.3 Chromium: already present at the exact revision, and already WebGL-capable

`playwright-core@1.65.0`'s own `browsers.json` requires **chromium revision 1254** (`chromium` and
`chromium-headless-shell`, `installByDefault: true`). This container ships exactly that, with
`PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers`:

```text
/opt/playwright-browsers/{chromium-1254, chromium_headless_shell-1254, ffmpeg-1013}
chrome-linux-arm64            ← matches process.arch arm64; the reduced UA prints "Linux x86_64",
                                so evidence records the build directory and version, not the UA string
```

`pnpm exec playwright install chromium` in this container fails with
`EACCES: permission denied, mkdir '/opt/playwright-browsers/__dirlock'` — the directory is root-owned and
read-only. **That failure is harmless and must not be chased**: the browsers are already there. The assignment
therefore keeps `playwright install` **out** of the pinned command sequence for container runs (it stays in the CI
sequence, §10.4, where the runner can install), and any local re-install goes to a writable
`PLAYWRIGHT_BROWSERS_PATH=$HOME/.cache/ms-playwright` fallback rather than into `/opt`.

Measured launch of that exact build, headless, in this container:

```text
UA:      Mozilla/5.0 (X11; Linux x86_64) … HeadlessChrome/158.0.8127.18 Safari/537.36
WEBGL:   kind webgl2 · "WebGL 2.0 (OpenGL ES 3.0 Chromium)" · MAX_TEXTURE_SIZE 8192 · MAX_VERTEX_UNIFORM_VECTORS 4096
screenshot: written successfully
```

So the camera suite's hard dependency — a WebGL2 context in headless Chromium — is proven here, not assumed; and a
screenshot pipeline works end to end (§7.3). `environment.json` records the machine; the **browser build and version
go into UDG-004's own identity artefact** rather than into the shared evidence schema (§10.3).

---

## 9. Proposed file ownership — **not granted by this draft**

### 9.1 Contract-owned (from the task contract, unchanged)

`apps/client/index.html`, `apps/client/vite.config.ts`, `apps/client/src/{main.tsx,App.tsx}`,
`apps/client/src/rendering/{create-scene,PlayerView,OrbitCamera}.ts`,
`apps/client/src/ui/{ConnectionStatus,DevelopmentOverlay}.tsx`, `apps/client/src/game/ClientRuntime.ts`,
`apps/client/src/network/ClientConnection.ts`, `tests/contracts/UDG-004.test.ts`, `tests/e2e/camera.spec.ts`.

### 9.2 Supporting paths, each needing an explicit grant

| Path | Why | Note |
| --- | --- | --- |
| `apps/client/package.json`, `apps/client/tsconfig.json` | the §7 pins; `jsx`, `.tsx` include | the workspace that owns a dependency owns its manifest (UDG-003 §3.3 precedent); a dependency-pin decision |
| `apps/client/tsconfig.tools.json` (new) | typechecks `vite.config.ts`, which cannot join the `rootDir: "src"` app project | `noEmit`, no DOM lib, `types: []`; **risk named:** Vite's declarations reference Node types, so the count of diagnostics under `skipLibCheck: false` is a **W-0 measurement**, and if it is nonzero the config check moves to the root project (§9.4) |
| `apps/client/src/index.ts` | export the documented `ClientRuntime` surface instead of `export {}` | package entry-point rule |
| `apps/client/src/dev/lifecycleHarness.ts` (new) | the §11 seam | dev-only, absent from the production bundle (asserted) |
| `apps/client/src/rendering/camera-math.ts` (optional) | clamp maths assertable without WebGL | implementer's choice, disclosed |
| `tests/unit/udg-004/**` (optional) | pure-unit coverage inside `pnpm test` | `tests/AGENTS.md`: only the assigned task's suites |
| `docs/integration/client-stack-v1.md` (new) | the W-0 pin/probe record, in the style of `colyseus-0.18-api-map.md` | new path |
| `docs/contracts/UDG-004.md`, `docs/contracts/checksums.json`, `README.md`, `docs/integration/dependencies.json`, `pnpm-lock.yaml` | status truth, regenerated manifest, run/stop + Docker instructions, selected-by-whom register, locked graph | controlled |
| `docs/contracts/assignments/{UDG-004,UDG-004-completion,UDG-004-evidence}.{md,json}` | assignment, completion, sanitised summary | existing store; **D4 unprovisioned** |

### 9.3 Controlled grants — permission to touch a file is never permission to widen scope

| Grant | Path | Limited to | Accepted assertions it moves |
| --- | --- | --- | --- |
| **G-1** | `package.json` (root) | add `dev` (and only that script); route `test:e2e` so `--suite camera` reaches Playwright while the other four suites still refuse; extend the client `typecheck` script with the tools project | none directly; G-2 forces **G-3** |
| **G-1b** | `.env.example`, `README.md` | add `UDG_DEV_HOST=127.0.0.1` + the Docker/Mac run-and-stop text; keep every existing line | `UDG-001 › planning.envExample` requires `UDG_HOST=127.0.0.1`, `UDG_CLIENT_PORT=5173`, `UDG_SERVER_PORT=2567` to stay; `planning.readmeCommands` requires README to keep naming `pnpm test:e2e`, `24.22.2`, `12.18.0`, `2567`, `5173` → additive edits only |
| **G-2** | `tools/checks/src/support.ts` | replace the single `UNAVAILABLE_SUITES['test:e2e']` entry with a **per-suite** guard: `camera` implemented; `netcode`, `physics`, `input`, `hybrid` and any unknown suite name still refused with owner task, required artefact and contract path, exit 1 | makes **G-3** mandatory (§9.5) |
| **G-3** | `tests/contracts/UDG-001.test.ts` | **only** the dispatcher assertions the per-suite guard invalidates — precedent: UDG-002 decision D3 granted "the UDG-001 test amendments" explicitly | `UDG-001 › refuses commands owned by later tasks` (see §9.5 for the exact lines) |
| **G-4** | `playwright.config.ts` | `webServer`, output paths for the camera suite, `strictPort`, and env-overridable reporter paths mirroring `UDG_EVIDENCE_JUNIT` (§10.2). `projects` stays chromium-only; `workers: 1`, `retries: 0`, `fullyParallel: false` **unchanged** | none; the accepted guard in §9.5 does not read this file |
| **G-6** | `apps/client/tsconfig.json` + `apps/client/tsconfig.tools.json` + root `tsconfig.json` | `include` covering `.tsx`; a project that typechecks `vite.config.ts`; a project that typechecks `tests/e2e/**` (recommended: the **root** project, which already carries the documented UDG-001 `skipLibCheck` relaxation for playwright-core declarations) | `compiler.strictFlagsPresent` reads `tsconfig.base.json` only → untouched; `compiler.domWorkspaces` and `compiler.ambientTypePolicy` must stay green (§9.4) |
| **G-8** | `.github/workflows/ci.yml` | one chromium install step and one camera-suite step, appended (§10.4). **No new third-party action** (every `uses:` must stay a 40-hex commit sha), no `continue-on-error`, no `secrets.` | `UDG-001 › authorship: the CI workflow runs the same scripts and pins third-party actions` — so: add steps, do not reorder or reformat existing ones |
| **G-9** | `tools/checks/src/evidence.ts` | (a) add the `'UDG-004'` capture plan; (b) **make sanitisation binary-safe** (§10.3 — measured PNG corruption). **No edit to the UDG-001/002/003 plans, their threshold strings or their prose** | accepted bundles must keep verifying (U2-1); D-P2-4 pin discipline; the binary-safe change needs a probe that a PNG survives capture byte-identical |
| ~~G-5~~ | ~~`eslint.config.mjs`~~ | **withdrawn — §9.4 measured that `.tsx` is already linted** | — |
| ~~G-7~~ | ~~`pnpm-workspace.yaml`~~ | **not requested — the §7 set runs no build script**; stays available only if a later probe adds a package that wants one | supply-chain decision remains the owner's |

**Not requested:** `packages/**`, `apps/server/**`, `docs/interfaces/**`, `docs/contracts/protocol-v1.md`,
`docs/contracts/adoption.md` (the owner's pen), `docs/integration/colyseus-0.18-api-map.md`,
`tsconfig.base.json`, `vitest.config.ts`, `eslint.config.mjs`, `apps/*/tsconfig.probes.json`, every `AGENTS.md`, and
`apps/client/src/input/**` (UDG-008).

### 9.4 TSX linting and typechecking — measured, with the rev-1 error corrected

**Linting needs nothing.** The accepted `eslint.config.mjs` already covers `.tsx`:

```text
$ eslint --print-config Jsx.tsx
parser: typescript-eslint/parser@8.72.1     no-explicit-any: [2]     prefer-const: [2, …]     no-undef: [0]

$ eslint Jsx.tsx            # let never reassigned + any, inside real JSX
  2:7   error  'n' is never reassigned. Use 'const' instead
  2:10  error  Unexpected any. Specify a different type
✖ 2 problems (2 errors)
```

`no-undef: 0` also means `window`/`document`/`HTMLCanvasElement` in client code produce no spurious lint errors, so
no `languageOptions.globals` addition is requested. **Revision 1's claim that `.tsx` is unlinted was wrong; the
grant is withdrawn and the accepted config stays byte-identical.**

**Typechecking is the real gap, and it is measured too:**

```text
$ cat src/Bad.tsx ; const b: string = 1; export const c = (<div>{b}</div>);
$ tsc -p apps/client-style tsconfig.json with include ["src/**/*.ts"]      # the current client pattern
→ no diagnostic for src/Bad.tsx at all
```

A `const b: string = 1` inside a `.tsx` file is invisible to the current pattern. So today the four `.tsx` files of
this deliverable would be **untypechecked**, `tests/e2e/camera.spec.ts` is excluded by name in the root project's
`exclude`, and `apps/client/vite.config.ts` belongs to neither project. G-6 exists to close exactly those three
holes, and W-0 must prove it closed (a deliberate type error in a `.tsx` must make `pnpm typecheck` fail — that is
the negative case that makes the grant worth granting).

The two accepted compiler-policy assertions G-6 must not disturb are:

```text
UDG-001 › keeps the DOM library out of every workspace except the client
    expect(domEnabled).toEqual(['@udg/client']);
UDG-001 › gives the client DOM types and no workspace ambient Node types except the server and tools
    allowed = { '@udg/server': ['node'], '@udg/checks': ['node'] };  expect(offenders).toEqual([]);
```

The second is the independent reason `@webgpu/types` is not on the table (§7.3): adding any `types` entry to
`apps/client/tsconfig.json` makes `@udg/client -> @webgpu/types` an offender and the accepted suite fails. Babylon
8.56.2 with `types: []` is the only proposed pin that leaves both assertions green.

### 9.5 The dispatcher: which assertions change, and how the guard is still tested

`test:e2e` is today one guard entry covering five suites, and the accepted suite asserts it is guarded:

```text
tests/contracts/UDG-001.test.ts › refuses commands owned by later tasks with an attributed reason
  const guarded = usage.replace('usage: ', '').trim().split(/\s*\|\s*/)…sort();
  expect(guarded.length).toBeGreaterThan(0);
  expect(guarded).toContain('test:e2e');                 ← moves
  expect(guarded).toContain('test:spike');               ← stays
  for (const command of guarded) { … expect(guard.exitCode).toBe(1);
      expect(guard.message).toContain('owning task');    ← stays (as a per-suite rule)
      expect(guard.message).toContain('never reported as a pass');
      expect(guard.message).toContain('UDG-');
      expect(rootScripts[command]).toContain(`dispatch.js ${command}`); }   ← must still hold for test:e2e
  expect(guarded).not.toContain('test:unit');            ← stays
```

**G-3 change, narrowly:** the guard becomes suite-aware, so `pnpm test:e2e -- --suite camera` runs while the other
four still refuse. The `test:e2e` command itself **remains routed through `dispatch.js`** (the root script is
unchanged in shape), so `expect(guarded).toContain('test:e2e')` is replaced by an assertion that
`test:e2e -- --suite camera` is *implemented* and that `test:e2e` with no suite, an unknown suite, or any of
`netcode|physics|input|hybrid` still exits 1 with the attributed message. Nothing else in that test changes.

**Guard behaviour stays under test, in three places rather than one:**

1. **UDG-001 (accepted suite, amended by G-3):** `test:spike`, `assets:build`, `assets:verify` still guarded with the
   same message contract; `test:unit` still not guarded; unknown task ids still exit 2; and the plans/refusals
   partition test (`UDG-004 is planned only if tests/contracts/UDG-004.test.ts exists, and the two sets are exact
   complements`) keeps its meaning with a fourth suite present.
2. **UDG-004 (new suite):** `test:e2e -- --suite netcode|physics|input|hybrid|nonsense|<empty>` each exit non-zero
   and name their owning task; `--suite camera` runs; the e2e runner refuses to report success when
   `tests/e2e/camera.spec.ts` yields zero cases (a zero-test pass is not a pass, `repository.md` §3.2).
3. **The dispatcher's own contract:** a command that has gained a real suite must stop being wholly guarded — the
   same rule that un-guarded `test:unit` in UDG-002 — and UDG-004 records it so UDG-SPIKE-001/006/008 each become a
   one-line removal later.

---

## 10. Authoritative CI and evidence capture plan

### 10.1 Which run is authoritative

| Run | Authoritative for | Why |
| --- | --- | --- |
| **GitHub CI** (`ubuntu-24.04`, Node `24.22.2`, pnpm `12.18.0`, chromium installed by the workflow) | **acceptance.** `report.json`, `junit.xml`, `camera-browser-results.json`, `lifecycle-counts.json`, `console-errors.json`, `browser/*.png` | it is the only run with the pinned toolchain, a writable browser path, and the same script sequence CI is asserted to mirror (precedent: C-05 for UDG-001) |
| Container dev run (§8.2 with the pinned Node) | developer feedback only, and a rerun of a failure | `PLAYWRIGHT_BROWSERS_PATH` is read-only, the image browser build must be reported rather than assumed, and an off-pin Node reproduces the §2 failures |
| **Mac preview (§6)** | nothing evidentiary | different browser, different GPU, different touch path; no artefacts written |

If the owner prefers a container-local authoritative capture (D-004-7), the conditions are: pinned Node on `PATH`
(§8.2), `PLAYWRIGHT_BROWSERS_PATH=$HOME/.cache/ms-playwright`, the browser build recorded, and headed/headless
declared — otherwise the bundle's `environment.json` and the plan's thresholds disagree with the accepted C-01
record.

### 10.2 Two capture-mechanism constraints measured while writing this revision

**(1) One junit per bundle, and `testCounts` comes only from it.** `capture()` builds its suite list as a
single hard-coded record named `vitest` and derives `report.testCounts` and the `PASS`/`FAIL` status purely from
`BUNDLE/junit.xml` (`counts.tests > 0 && counts.failures === 0` → PASS); the verifier then re-checks
report-vs-junit. Two commands both declaring `junit: true` would overwrite one file, and the bundle would silently
describe only the last suite. Rather than widen the accepted schema (§10.5 alternative), the plan runs **exactly one
junit-carrying command** and makes the browser results gate it transitively:

```
test:e2e runs first  →  camera-browser-results.json (identity artefact, 0 failures required)
                     →  tests/contracts/UDG-004.test.ts reads that file and FAILS if any case failed,
                        if the case count is zero, or if the file is absent
                     →  the junit-carrying `pnpm test:contract -- --task UDG-004` therefore goes red,
                        and a browser failure cannot be recorded as a PASS bundle
```

This is the same shape as the existing rule that a bundle whose own record is not PASS is refused with
`EVIDENCE-GATE-NOT-PASS` — the gate, not the suite, decides what counts as evidence.

**(2) Sanitisation destroys binary artefacts.** `sanitiseBundleDirectory()` walks the whole bundle and rewrites every
file except `report.json`, `checksums.sha256` and `.keep` through a UTF-8 read → `clean()` → write, and
`artefactsIntoBundle` copies the same way. Measured on a real screenshot from the §7.3 run:

```text
original PNG          4254 B   sha256 3878570f4a62a0d6…
UTF-8 round-trip      5393 B   sha256 580288d777978475…   identical? false
PNG signature preserved?  false
```

Hashes are written *after* sanitisation, so a mangled screenshot verifies happily and nobody notices until someone
opens it. Since `CapturePlan.manifests` resolves declared files relative to the manifest's own directory **inside**
the bundle, screenshots cannot dodge the problem by living outside it. Hence **G-9(b): make sanitisation
binary-safe** (skip files that are not valid UTF-8, or an explicit image/media allowlist), with a probe asserting a
PNG survives capture byte-identical and the secret/path scan still fires on text. This is not cosmetic and not
UDG-004-specific: UDG-SPIKE-001 and UDG-SPIKE-003 are contractually entitled to recordings, so the same defect
waits for them.

### 10.3 Proposed `'UDG-004'` capture plan (the exact shape, in `tools/checks/src/evidence.ts`)

```text
taskId              'UDG-004'
requiredFiles       environment.json, commands.json, junit.xml, report.json,
                    camera-browser-results.json, lifecycle-counts.json, console-errors.json,
                    browser/screenshots.json                       ← manifest of the PNGs (see below)
identityArtefacts   camera-browser-results.json, lifecycle-counts.json, console-errors.json
                    (each must parse and declare schemaVersion + taskId "UDG-004": a {} placeholder or another
                     run's file cannot pass)
requiresMeasurements true;  measurementsIntoBundle true            → measurements/UDG-004.json
artefactsIntoBundle **not used**: the suite writes every browser artefact, PNGs included, straight into
                    `BUNDLE/browser/` through `UDG_BROWSER_OUT`, so one writer owns that directory and no binary
                    file passes through the copy path (§10.2). The mechanism stays available for JSON-only sets
thresholds          camera.cases                              >= 10   (one per contract check)
                    camera.failures                           === 0
                    camera.skipped                            === 0
                    canvas.count                              === 1
                    animationLoop.count                       === 1    (and === 1 after blur/focus and 10 cycles)
                    camera.radiusMin                          === 2    (exact, ±1e-6 m, after over-scroll)
                    camera.radiusMax                          === 20
                    camera.elevationMinDegrees                === 10
                    camera.elevationMaxDegrees                === 80
                    pose.mutationsByCameraOperations          === 0    (both entities, every gesture)
                    lifecycle.mountUnmountCycles              === 10
                    lifecycle.canvasesAfterCycles             === 1
                    lifecycle.listenersAfterDispose           === baseline
                    consoleErrors.uncaught                    === 0
                    screenshots.count                         === 6    (named in browser/screenshots.json)
reportProse.notApplicable  traces/  "no gameplay trace: no movement, network or asset behaviour exists"
                         metrics/ "no CSV sampling; the clamp readings are recorded in measurements/UDG-004.json,
                                 and frame-time budgets are excluded from this task by its own contract"
                         decisions/ "Gate A is Not Run and its formal execution is UDG-SPIKE-001's"
commands            install-frozen  pnpm install --frozen-lockfile
                    typecheck | lint (UDG_BOUNDARY_REPORT=BUNDLE/boundary-report.json) | build (buildLog)
                    test            pnpm test              env UDG_EVIDENCE_JUNIT=BUNDLE/junit.xml   junit: true
                    e2e-camera      pnpm test:e2e -- --suite camera
                                      env UDG_BROWSER_OUT=BUNDLE/browser,
                                          UDG_EVIDENCE_BROWSER_RESULTS=BUNDLE/camera-browser-results.json,
                                          UDG_LIFECYCLE_OUT=BUNDLE/lifecycle-counts.json,
                                          UDG_CONSOLE_ERRORS_OUT=BUNDLE/console-errors.json,
                                          UDG_CLIENT_URL=http://127.0.0.1:5173
                    contract-UDG-004 pnpm test:contract -- --task UDG-004
                    dependencies-verify, contracts-checksums
```

`BUNDLE/` and `MEAS/` are substituted by the capturer in **both** env values and argv, so the suite is told where to
write instead of guessing — that is the mechanism UDG-003 already uses for `UDG_VECTORS_OUT`. Three consequences of
that design are deliberate: the browser suite writes its own three JSON artefacts, so a suite that quietly stopped
producing them is caught by `requiredFiles` rather than by attention; the PNGs are written straight into
`browser/` as bytes (G-9(b) protects them) and named by `browser/screenshots.json` with sha256 + byte count each;
and `pnpm evidence:verify -- --run artifacts/<RUN_ID>` then re-checks schema, non-emptiness, hashes, zero skips,
command exit codes, prerequisite SHAs, identity artefacts and the absence of credentials or private machine paths —
with the Chromium build and version recorded **inside `camera-browser-results.json`**, because `environment.json` is
the shared schema and this task does not own it.

### 10.4 CI additions (G-8), appended in that order

```yaml
      - name: Install the pinned Chromium for the camera suite
        if: ${{ !cancelled() }}
        run: pnpm exec playwright install --with-deps chromium   # no new action => every `uses:` stays sha-pinned

      - name: Run the UDG-004 camera browser suite
        run: pnpm test:e2e -- --suite camera
```

placed **before** "Capture the evidence bundles", with no reordering of existing steps and no `continue-on-error`
anywhere (`UDG-001 › authorship` enforces both the sha pinning and the absence of `secrets.`, and the existing
comment block forbids `continue-on-error` on pain of failing that suite). CI already loops over
`node tools/checks/dist/evidence.js plans`, so adding the plan makes the UDG-004 bundle captured, asserted, verified
and published without a further workflow edit — which is exactly why the flakiness rule in §12 matters: a flaky
camera test would redden every later task's run, including UDG-003's.

### 10.5 The alternative the owner may prefer, and its true cost

Adding a second suite record to `capture()` (so `report.testCounts` covers vitest **and** Playwright directly) is
cleaner in principle and bigger in practice: it changes the accepted evidence schema, the verifier's junit
cross-check, the `EVIDENCE-GATE-NOT-PASS` logic and the UDG-001 tests, and it must keep every retained bundle
verifying under U2-1. Proposed default: §10.2. Proposed as an owner decision (**D-004-14**) if the owner would
rather pay that now than carry the transitive gate.

---

## 11. The mount/unmount test seam (exact)

**Design: a dev-only harness that *calls* the public surface, never a fifth method on it.**

```
apps/client/src/dev/lifecycleHarness.ts        (new path; §9.2 grant)
  installLifecycleHarness(host: HTMLElement): void
    → globalThis.__udgClientHarness = { mount(canvas), unmount(), cycle(n), snapshot() }
      snapshot(): { cycles, canvases, loops, meshes, observers, listeners, mounted }
```

- `main.tsx` imports it behind `if (import.meta.env.DEV)`, so a production `vite build` tree-shakes the module out.
- **Two assertions make that claim a fact, not a hope:** the UDG-004 contract suite scans the built client output
  for the strings `__udgClientHarness` and `lifecycleHarness` and fails if either appears, and `tests/e2e/camera.spec.ts`
  fails if `window.__udgClientHarness` is **defined** when the app is served from a production build.
- Playwright drives it with `page.evaluate(() => window.__udgClientHarness.cycle(10))` and reads `snapshot()` into
  `lifecycle-counts.json` through `UDG_LIFECYCLE_OUT`. Ten cycles, not three, because the contract names ten.
- The DevelopmentOverlay keeps a visible mount/unmount button (§6.6 item 8) so the owner can do the same thing by
  hand; the harness exists because a click-driven cycle count would depend on layout, hit-testing and animation
  timing — and a lifecycle test that depends on layout is how a disposal bug becomes a flaky test.
- The seam is a caller of `start(canvas)` / `dispose()`, so `ClientRuntime`'s four contract methods stay exactly
  four, and nothing in the production path can reach the harness.

Rejected alternatives, recorded: a `data-testid`-and-click-only seam (no deterministic counts, and it couples
lifecycle to styling); widening `ClientRuntime` with a `mountCount()` method (the contract fixes its surface); a
Playwright route that stubs the app (tests a fake, not the app).

---

## 12. Merge order if UDG-003 Phase 3 starts in parallel

Phase 3 is *"abuse, evidence, CI: offender suite, buffer depth, capture plan, CI steps, submission"*
([readiness proposal §3.2](UDG-003-readiness-proposal.md)), and the Phase 2 record routes `apps/client/**` to
UDG-008 and kept D-P2-1's harness out of that directory — so **no client file is shared**. The shared surface is
tooling, CI and manifests, and it is genuinely writable by both tasks: `tools/checks/src/evidence.ts`,
`.github/workflows/ci.yml`, `docs/contracts/checksums.json`, `docs/integration/dependencies.json`,
`pnpm-lock.yaml`, `README.md`. Proposed rules:

| Rule | Content |
| --- | --- |
| **M-1 single writer** | One task at a time may hold any of the six files above. The owner names the holder when both are in flight; the other waits for the merge and rebases. `ownership.md` already makes the integration owner the collision resolver before merge |
| **M-2 append-only `CAPTURE_PLANS`** | A new plan is a new key appended at the end of the map. Existing entries — including the UDG-003 phase-1/phase-2 plans, their `thresholds` strings and their `reportProse` — are byte-identical after the change (D-P2-4). No shared-helper extraction, no reformatting, no key reordering, so the two tasks' diffs land in disjoint hunks |
| **M-3 append-only `ci.yml`** | Steps are appended in landing order; nobody renumbers, resorts or restyles an existing step; no `continue-on-error`; the browser step (if UDG-004 holds the file) sits immediately before "Capture the evidence bundles" |
| **M-4 regenerables belong to the landing commit** | `checksums.json` and `dependencies.json` are regenerated **by command** in the commit that lands, never hand-edited, and both digests are quoted in that task's completion record. Historical manifests stay as they are (U2-5) |
| **M-5 CI arbitrates on the merged head** | A submission must be green on the merge of its branch with current `main`, not on its own base, so a semantically conflicting pair (`evidence.ts` compile errors, a CI step referencing a script the other removed) surfaces before merge rather than after |
| **M-6 the order itself** | Two defensible orders, and the owner picks (**D-004-10**): **UDG-004 first** puts the browser step and binary-safe sanitisation in place before Phase 3 adds CI steps, and shortens the Gate A critical path (UDG-SPIKE-001 needs UDG-004 Verified); **Phase 3 first** front-loads the abuse/evidence/CI work UDG-003 owes and lets UDG-004 rebase onto a settled `evidence.ts`. Whichever lands second re-runs the four root commands **plus both tasks' suites** (`--task UDG-003` and `--task UDG-004`, `test:e2e -- --suite camera`) on the merged head |
| **M-7 flakiness is a merge blocker** | `retries: 0` stays. A camera case that fails once is investigated and fixed, never re-run into greenness (§19.2), because CI captures every plan and one flaky suite reddens the other task's evidence too |

---

## 13. Checks and evidence required for acceptance

### 13.1 The contract's checks, and how each is proved

| Contract check | Where | Artefact | Pass reading |
| --- | --- | --- | --- |
| One canvas, one animation loop | e2e | `camera-browser-results.json` | exactly 1 `<canvas>`; loop counter advances ~1 per frame and stays 1 across mount/unmount and blur/focus |
| Correct right-handed axis marker | e2e | `browser/axis-marker-default.png` + results | the +X and +Z arms are distinguishable **and** correctly ordered; a left-handed scene fails the assertion, and the assertion compares the two arm colours, not frame luminance (§7.3) |
| Orbit/zoom clamping | e2e | results + `browser/orbit-min-2m.png`, `browser/orbit-max-20m.png`, `browser/elevation-min-10deg.png`, `browser/elevation-max-80deg.png` | after deliberate over-scroll, radius is exactly 2.000/20.000 m (±1e-6) and elevation exactly 10°/80° (±1e-6 rad) |
| Aspect resize | e2e | results | projection not stretched, loop count unchanged |
| Focus loss | e2e | results, `console-errors.json` | no second loop, no gesture backlog |
| Touch rotation/pinch | e2e (emulated) | results + `browser/touch-pinch-*.png` | mapping only, labelled emulation; no device claim |
| UI input exclusion | e2e | results | a drag starting in an active UI region produces zero camera delta; the identical gesture outside it does not |
| Visible connection failure | e2e | `browser/status-connection-failed.png`, `console-errors.json` | failure text visible with the configured URL, canvas still rendering, 0 uncaught errors |
| Ten mount/unmount cycles | e2e via §11 | `lifecycle-counts.json` | 10/10; canvases back to 1; loop to 1; mesh/observer/listener counters to baseline |
| Removal of meshes, observers, listeners, WebGL resources | contract + e2e | `lifecycle-counts.json` | `removePresentedEntity` and `dispose()` each reach baseline; a second `dispose()` is a no-op, not a throw |
| Blocked pointer events / failed asset load must not crash the UI | both | results, `console-errors.json` | the expected safe outcome occurs with a live scene; a thrown exception alone is **not** a pass |
| *(new, from this draft)* placement independence | contract | results | §4.4 identifier scan and `PRESENTATION_CENTRE_Y_METRES === capsuleHeight / 2` |
| *(new)* `.tsx` really typechecked, harness absent from production build | contract | build output | a deliberate type error fails `pnpm typecheck`; no harness string in the built bundle (§9.4, §11) |

### 13.2 The acceptance condition, as the contract states it

Pass when the browser smoke test renders the greybox **and two independent presented entities**, camera operations
never mutate **either** pose, and disposal leaves **no live game loop or listener registered by the app** — with
nonzero counts, no skips, on the final submitted commit. `camera-browser-results.json`, `lifecycle-counts.json`,
`console-errors.json` and the bound screenshots are required by name; a criterion with a missing or unparseable
artefact is FAIL, not "not run".

A UDG-004 bundle is **not** evidence of: Gate A (**Not Run**; formally executed by UDG-SPIKE-001 over verified
prerequisites); any netcode, prediction or reconciliation behaviour; any physical-device frame budget; any UDG-008
input or UDG-007 asset claim. The completion record says so in those words, and an agent submission is **In Review**
until the owner accepts it.

### 13.3 Bundle

`artifacts/UDG-004-<UTC>-<sha>/` with `report.json`, `environment.json`, `commands.json`, `junit.xml`,
`checksums.sha256`, `logs/`, `measurements/UDG-004.json`, the three task JSON artefacts, and `browser/` with the
six named screenshots plus `browser/screenshots.json`. Raw bundles stay out of Git (C-03), to the **existing**
store, since **D4 designates no backup destination**.

---

## 14. Files that collide with future UDG-003 work

No `apps/client/**` file is shared with UDG-003: D-P2-1 kept Phase 2's harness out of it, the Phase 2 record routes
`apps/client/**` to UDG-008, and Phase 3's own list contains no client path. The collisions are all in shared
tooling — see §12 for the merge rules:

| File | UDG-004 needs it for | Future UDG-003 need | Collision shape |
| --- | --- | --- | --- |
| `tools/checks/src/evidence.ts` | the UDG-004 plan **and** binary-safe sanitisation | Phase 3 adds the offender-suite/buffer-depth capture plan | same file, same `CAPTURE_PLANS` map; a careless edit re-digests pinned threshold prose. M-2; accepted bundles must keep verifying (U2-1) |
| `.github/workflows/ci.yml` | chromium install + camera step (G-8) | Phase 3 "CI steps" | same job, same step list; CI captures **every** plan it finds, so the camera step becomes mandatory for UDG-003's runs too. M-3, M-7 |
| `docs/contracts/checksums.json` | regenerated when its status line moves | regenerated when Phase 3 records move | churn on a generated file. M-4 |
| `docs/integration/dependencies.json` + `pnpm-lock.yaml` | selects `@babylonjs/*`/`react` for `apps/client` (register moves from `not-selected`) | no pin expected, but any pin change touches both | register is derived from the install: whoever installs last rewrites it. The `@colyseus/*` entries and their notes stay untouched (§4.3) |
| `README.md` | command-availability table, `pnpm dev`, the §6 Docker route | Phase 3 status lines | same tables, adjacent rows; accepted README assertions require specific strings to survive (§9.3 G-1b) |
| `tools/checks/src/support.ts` + `tests/contracts/UDG-001.test.ts` | per-suite e2e guard (G-2, G-3) | UDG-003 does not need it — **UDG-SPIKE-001 (netcode) will make the identical edit** | make it per-suite once, so the remaining four are one-line removals |
| `playwright.config.ts`, root `tsconfig.json` | G-4, G-6 | UDG-003 does not need them; SPIKE-001/006/008 will | additive only, no reformat |

---

## 15. Owner decisions

### 15.1 Answered by this round's instruction (recorded, not re-asked)

| id | Ruling as recorded here |
| --- | --- |
| **D-004-2** | `ClientConnection.ts` imports no `@colyseus/*`; status only, local poses (§4.3) |
| **D-004-5** | Radius **2–20 m**, elevation **10–80°**, UI gesture exclusion — frozen as the asserted values (§3) |
| **D-004-8** | Seam: dev-only `__udgClientHarness` calling the four public methods, absent from production builds (§11) |
| — | Local test poses (§4.2); placeholder placement independent of P07 (§4.4) |

### 15.2 Still outstanding before assignment

| id | Question | Why it is the owner's |
| --- | --- | --- |
| **D-004-1** | **Assign UDG-004, to whom, against which base commit?** Also: `adoption.md`'s assignment line and README's stale "no task beyond UDG-002 is assigned" (already wrong for UDG-003) move on the owner's pen | only an owner instruction makes UDG-004 Ready |
| **D-004-3** | Approve the §7.1 pins — in particular **Babylon 8.56.2 rather than 9.36.0**, on the measured 154-vs-0 declaration result, and the "no `@vitejs/plugin-react`" finding | a dependency-pin decision (C-02 defers the choice to UDG-004; P01 requires exact pins, licences and a verifiable register) |
| **D-004-4** | Grants **G-1, G-1b, G-2, G-3, G-4, G-6, G-8, G-9** individually — G-3 (amending the accepted UDG-001 dispatcher assertions) and G-9(b) (binary-safe sanitisation in the shared evidence schema) most of all | controlled files, an accepted suite, and the accepted evidence schema |
| **D-004-6** | Confirm the corrected position: **no ESLint change** (measured), and G-6 as the real typechecking fix; note the `tsconfig.tools.json` Node-types risk is a W-0 measurement with a named fallback | the gap described in rev 1 was wrong; the grant list changed |
| **D-004-7** | Authoritative capture: **CI** (proposed) or container-local with §10.1's conditions | pinned toolchain, writable browser path, honest environment record |
| **D-004-9** | Runtime provisioning: `$HOME` Node 24.22.2 tarball (proposed), a rebuilt image, or a CI-only pinned run | C-01's pin is a repository invariant; only the environment moves |
| **D-004-10** | **Merge order** with UDG-003 Phase 3 (§12 M-6): UDG-004 first or Phase 3 first | both write `evidence.ts` and `ci.yml`; the integration owner resolves collisions before merge |
| **D-004-11** | Confirm the existing evidence store and that **no** backup/archive/storage provisioning is authorised here | D4 remains open after two owner rounds; a new task must not acquire a destination by convenience |
| **D-004-12** | `UDG_DEV_HOST` (default `127.0.0.1`, warn on any other value) as the single documented way to expose the dev server, and the loopback-only phrasing in README/`.env.example` that goes with it | it touches the loopback-only rule an accepted assertion protects (§9.3 G-1b) |
| **D-004-13** | Whether `@vitejs/plugin-react` may be added later if Fast Refresh or React Compiler work is wanted, and who reviews that pin | measured unnecessary today; a later addition is still a pin decision |
| **D-004-14** | §10.5: keep the single-junit capture schema with a transitive gate (proposed), or extend `capture()` to a second suite now | the second option edits accepted evidence machinery and U2-1 compatibility |

---

## 16. Known risks, recorded before assignment

| id | Risk | Mitigation carried into the assignment |
| --- | --- | --- |
| **R-1** | A WebGL-dependent suite discovered unable to run headless | **measured away**: chromium 1254 launches here with WebGL2 (§8.3) and rendered the probe scene (§7.3). W-0 re-proves it on the pinned Node |
| **R-2** | Babylon declarations breaking the repository's `skipLibCheck: false` policy — a repeat of PH0-B1 in the client | avoided by the §7.3 version evidence (8.56.2 → 0 diagnostics); if a later Babylon is wanted, it arrives with its own ADR, not quietly with an upgrade |
| **R-3** | The local test pose calcifying into a de facto movement controller (the D-P2-1 lesson) | §4.2: pose source only, `setPresentedPose`-only, labelled in the overlay, and the completion record names its replacement task |
| **R-4** | `ClientConnection.ts` becoming a second networking stack UDG-SPIKE-001 must delete | owner ruling §4.3; the file names its replacement owner in its header |
| **R-5** | Screenshots stored corrupted (§10.2 measured) or evidence that quietly stops describing the browser run | G-9(b) with a survive-the-capture probe; `requiredFiles` + `identityArtefacts` + the transitive gate in §10.2 |
| **R-6** | A flaky camera suite reddening UDG-003's CI runs because CI captures every plan | `retries: 0` stays; flakiness blocks verification (M-7); the seam is count-driven rather than click-driven (§11) |
| **R-7** | Off-pin local runs producing a bundle that fails accepted assertions | §8, D-004-7/D-004-9; `environment.json` records `nodeVersion` beside `expectedNodeVersion`, and a mismatch is disclosed, never explained away |
| **R-8** | Evidence read as performance data | no frame-time metric recorded at all; touch labelled emulation; §13.2 exclusions in the completion record |
| **R-9** | Dev-server exposure becoming routine non-loopback access | default `127.0.0.1`, per-session opt-in with a warning, Mac-side publish bound to `127.0.0.1`, `allowedHosts` never `true` (§6) |

---

## 17. Owner review checklist

- [ ] **D-004-1** assign, or record that UDG-004 stays unassigned. Nothing here does it by implication.
- [ ] **D-004-3** pins: Babylon **8.56.2**, React/React-DOM 19.3.1, types 19.3.0, Vite **8.3.6**, no plugin, no loaders, no SDK (§7).
- [ ] **D-004-4** grants G-1, G-1b, G-2, G-3, G-4, G-6, G-8, G-9 named individually — G-3 and G-9(b) explicitly.
- [ ] **D-004-6** accept the correction: no ESLint change (measured); G-6 closes the typechecking hole.
- [ ] **D-004-7** authoritative capture = CI (proposed) or container-local with conditions; headed/headless declared.
- [ ] **D-004-9** Node 24.22.2 provisioning route, with the repository pins untouched either way (§8).
- [ ] **D-004-10** merge order vs Phase 3 (§12).
- [ ] **D-004-11** store confirmed; **D4 still open, nothing provisioned**.
- [ ] **D-004-12** `UDG_DEV_HOST` exposure rule (§6.2).
- [ ] **D-004-13/14** later `@vitejs/plugin-react`; single-junit schema vs a second suite record.
- [ ] §6 routes and the URL (`http://127.0.0.1:5173/` on the Mac, `UDG_CLIENT_URL` in the container) read as intended.
- [ ] §13 read against the contract's ten checks, with the exclusions stated in §13.2.
- [ ] Still reported: **Gate A, B and C Not Run**; `stackCompatibility` not-established; **UDG-003 In Progress,
      Phase 3 unassigned**; UDG-004 **unassigned and unstarted**.

**This draft authorises the record only.** No implementation path was created or modified to write it: the
`apps/client` workspace, `tests/e2e/`, the root manifests, ESLint and TypeScript configs, CI, `evidence.ts` and
`adoption.md` are byte-identical to `81a341f`, and `pnpm contracts:checksums` still reports `in sync … 0 change(s)`
because `docs/contracts/assignments/` is an excluded path. Every measurement in §7, §8, §9 and §10 was taken in a
scratch project outside the repository, and the throwaway dev server used for §6.1 and §7.3 was stopped.
