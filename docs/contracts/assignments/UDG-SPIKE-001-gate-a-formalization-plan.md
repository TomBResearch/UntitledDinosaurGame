# UDG-SPIKE-001 — formal Gate A candidate dispatch & evidence: exact preparation plan (T-5…T-8 aligned)

> Status: PREPARATION ONLY. No workflow is edited or dispatched by this document; no suite is
> re-run by it; no threshold, target, or window moves. It states what a FORMAL candidate run needs,
> what is runnable today versus missing, and the release-to-host path that stays consistent with
> `workflow_dispatch` discovery rules and review isolation. The spike harness to date is DIAGNOSTIC
> evidence of feasibility, never Gate A itself.

## 1. What "formal" means here (prerequisites, each already evidenced as feasible)

1. **Candidate identity**: a clean full-40-hex `candidate_sha`; the run refuses itself unless the
   checkout equals it (the accepted `acceptance.yml` refusal pattern); every bundle declares
   `implementationSha == candidate_sha` and the verifier re-asserts the binding.
2. **Quiet-runner receipt**: per-run environment record (`captureEnvironmentRecord`) + contamination
   diagnostics beside the accepted metric, with achieved validity under `networkValidity` deciding
   VALID/INVALID — an INVALID run stays INVALID and captures nothing as a pass.
3. **Full windows**: the 20 s measurement windows and the 120 s sustained leg (the spike cells use
   short calibration windows deliberately — a formal run must use the contract's windows, uncut).
4. **Non-diagnostic plans**: the capture plan for a Gate A run is appended under **T-5**
   (append-only; the five accepted plans byte-identical; `CAPTURE_PLANS` diff statement + retained
   bundles re-verified with 0 issues). Every spike artifact keeps its `DIAGNOSTIC-NOT-GATE-A` kind;
   the formal plan is a NEW plan, not a relabel.
5. **Hosted first-attempt green**: the first hosted full-matrix attempt on the candidate must be
   green as-dispatched (no local-vs-host discrepancy smuggled in by retries); the local
   `--cell` receipts are the recipe, and the hosted attempt is the evidence.

## 2. GA rows — runnable today vs missing (all runnable pieces use ONLY existing harness seams)

| Row | State today | Exact remaining step for a formal run |
|---|---|---|
| **GA-1** compliant burst (B=8) then idle | Runnable — fixtures complete (pump, depth/retired/resolved records, gap ledger). Diagnostic-only today | Port the diagnostic burst shape into the T-5 plan's scenario list; assert `retired==0`, `depth<32`, resolved reaches the highest stamp at rest, zero resyncs; full windows |
| **GA-2** pressure without closure | Runnable — withheld-window primitive produces depth + `QUEUE_PRESSURE`; closure absence asserted in ga cells | Formal leg: throttle obeyed within one RTT (measured against the leg's own validity), zero closures, zero retirements |
| **GA-3** confirmed retirement, prevention disabled | **RUN locally at slice 17** (`--cell ga-scenarios`, seed 1001, `dpa8c`): matched confirmed retirement → exactly one 4100 attributed to the offender session only, closure within `closureMaxMs` of the confirmation tick, residue > 0 named/attributed (retiredUnrepresented >= 1), reported while the offender client never acknowledged it, zero cross-seat collateral (second seat unthrottled-in-effect, no signals, no closure, kept consuming/moving, room stayed alive). Prevention-disabled is the MEASURED substrate state: the adopted INPUT_QUEUE_PRESSURE posture is throttle-only and no prevention limb exists on the wire path — no operator seam exists to disable (none is needed), and no production config/defaults were touched; an optional posture-ARMED config-variant cell (harness `defineOperatorRegionRoom({config: overrides})`, test values only) remains the named next witness if the reviewer wants prevention actively armed during closure | DONE locally for the harness limb; the formal-grid leg still awaits the hosted dispatch like every other formal leg |
| **GA-4** refused frames represented | Runnable — refusal records (`refused` per tick) and the rate-ceiling path exist | Dedicated scenario driving refusals (rate ceiling), then assert refused-inside-dequeuedCount, not retired, advances resolved, one neutral step journaled |
| **GA-5/6/7/11/12, CF-1/3/4** | Scenario recipes EXIST and are twice-green as DIAGNOSTIC (ga-scenarios 17 rows incl. `ga5t`; ga11 calibration) | Re-emit under the T-5 plan on full windows with no message relabelling; GA-5b's client sub-leg and GA-12 PE-1 stay BLOCKED per `PROPOSED-0003a` rev 2 — the formal matrix reports them as such, never as passes |
| **GA-8** same-delivery comparison | Partially evidenced — the accepted guard already refuses cross-value deliveries (`ack === inputResolvedThrough` per row), and `ga5t` audits per-row equality | Formal assertion set: every trigger evaluation cites ONE delivery (guard ledger + `ga5t`-style per-row audit); zero cross-delivery comparisons |
| **GA-9** isolation | Missing leg — needs paired runs (solo vs co-resident) and per-entity projection digests | Two-leg harness: capture `(clientSeq|null, disposition, dx, dy, entityStateDigest)` per entity; compare shared-vs-solo identical; room-wide ordinals as growth-only |
| **GA-10** (committed half) | Partially evidenced — discrete effect ledger, consumed-unique per (domain,seq), abandon-Δ0 recorded in ga cells | Formal ledger comparison: charge-once per `(epoch, identity)`, cache/batch re-answers zero, `effectCount` monotone per epoch, ledger equality-replay assertion |
| **GA-13** evidence integrity | Partially — the `ga9-ga13` cell replays the solo leg's REAL journal to EXACT equality (dispositions, canonical state bytes, per-tick hashes, chain tip; digest-blanked identical; tamper refused; mutation detected) through the accepted Phase-1 machinery with the PRODUCING kernel stepper (slice 9, `dpa7u`); the cell's `journalCoverage` inventory names what replays-compared, what is structural-only, and which scenario journals are MISSING | Extend the replay leg to EVERY formal scenario (the ga-scenarios rooms currently yield ledger extracts only — persisted journals for those rooms are the owed artefact); sanitisation audit already general; `stackCompatibility` asserted only where numeric gates actually pass |
| GA-10a/GA-10b | **Out of Gate A scope** — deferred to UDG-007; the matrix records them outstanding-elsewhere, never resolved | none (report wording only) |

**Contract AC coverage (AC-1…AC-20 as applicable)**: the UDG-003 phase evidence matrices
(`docs/contracts/assignments/UDG-003-phase-2-evidence-matrix.md` and the phase-3 draft) already map
each AC to its owning suite. A Gate A candidate run does NOT replace those suites; it re-runs the
contract's §2 metrics + GA rows on the candidate. Missing coverage at Gate A is therefore: (a) the
GA rows above marked Missing; (b) the full-window sustained legs; (c) GA-13 replay legs wired into
the capture plan; (d) the two BLOCKED GA sub-claims, reported as blocked with their proofs. No AC
is claimed closed by a spike cell.

## 3. Release-to-host strategy (discovery + review isolation, no edits yet)

GitHub lists `workflow_dispatch` inputs only for workflows that exist **on the default branch**.
The T-7 `gate-a.yml` therefore must reach `main` through its own reviewed change before any hosted
dispatch exists — and until it does, there is NO hosted dispatch, local or otherwise, and local
`--cell` runs stay labelled exactly what they are (recipes, non-authoritative).

Ordered steps (each its own reviewable unit; none performed by this document):

1. **T-5** (code PR): append the Gate A capture plan + GA-rows register identity to
   `tools/checks/src/evidence.ts`; byte-identical accepted plans; retained bundles re-verified.
2. **T-8 + T-6** (code PR, one routing contract): `route-checks.mjs` maps spike/netcode/load-test/
   client-network paths to their FAST lanes; two-way route/lane tests; the router provably cannot
   select the full matrix or enable capture (C-07 invariant asserted); `ci.yml` gains only the fast
   steps the router already assigns, pins intact.
3. **T-7** (workflow PR, reviewed as a workflow addition): `gate-a.yml` — `workflow_dispatch`
   only; required 40-hex `candidate_sha` that must equal the checkout (refused before install,
   mirroring `acceptance.yml` refusal cases incl. missing/short/mismatch tests); bundles must
   declare `implementationSha == candidate_sha`; verified bundles published; same Node/pnpm pins;
   40-hex action pins; no `continue-on-error`; unreachable from push/PR; runs no routine check.
   Merging T-7 is what MAKES the dispatcher discoverable — it is the release-to-host step, and it
   lands only after review of 1–3 together with its refusal tests.
4. **First formal dispatch** (owner action, post-merge): dispatched against a reviewed candidate
   sha; first-attempt outcome recorded whatever it is (a red first attempt is retained, not
   retried away); the bundle lands in the accepted evidence store only via the existing
   `evidence:verify` path.

Review isolation throughout: the hosted job consumes ONLY the pinned candidate sha and emits
artefacts; review consumes artefacts; nothing un-reviewed feeds another run; no workflow step
writes to the store directly.

## 4. Explicitly NOT done here

No workflow file created or edited; no dispatch; no full-matrix run; no rerun of unrelated suites
(camera et al.); no threshold/target/window change; no merges; no Gate A verdict; no P06 freeze.

## 5. Blockers, separated from diagnostic-suite success (as of this slice)

- **Diagnostic success**: ga-scenarios 17/17 (incl. `ga5t` transcript rows) twice; ga11 calibration
  5/5 with per-leg achieved validity; unit suites green — these prove the MEASUREMENT PATHS and the
  honest shape of every owed row.
- **Blockers (stay open regardless)**: GA-5b client-recovery sub-leg (blocked-with-proof per
  `PROPOSED-0003a` rev 2 — no lawful terminal-decline expectation can exist on the pinned stack);
  GA-12 positive PE-1 (silent pre-buffer decline has no signature; PE-1…PE-5 remain the closure
  prerequisite; `dedupeClosureEnabled` false); GA-10a/GA-10b (UDG-007); production-directed GA-11
  populations (Not-Run; missing conditions named); GA-3/GA-9 formal legs and GA-13 replay legs
  (runnable, not yet built); hosted dispatch (needs T-5…T-7 merged).

## 6. Slice-8 update (2026-11-24)

- Diagnostic success, current: ga-scenarios 24/24 (dpa7c/p/q), ga9-ga13 5/5 (dpa7m/r),
  ga11-calibration 5/5 with the stall rule live (dpa7s); units 575/575 (stalled-ack rule red-first
  + `holdNext` seam included); lint/boundaries/tsc green; lockfile byte-identical.
- Blockers MOVED: GA-9 formal legs and GA-13 replay legs are no longer "runnable, not yet built" —
  the `ga9-ga13` cell builds and passes them (determinism byte-exact with declared normalizations;
  replay through the accepted Phase-1 machinery with the §2.2 exact-or-named-ULP comparison;
  sanitisation with a firing control). GA-5b's client-recovery sub-leg is NARROWED, not closed
  (`PROPOSED-0003a` rev 3 §6): blind recovery from the terminal shape is now MEASURED (the §3.2
  stalled-ack rule, implemented in the granted adapter, fires once and recovers); recovery that
  KNOWS what happened remains blocked on PE-1.
- Blockers UNCHANGED: GA-12 positive PE-1; GA-10a/GA-10b (UDG-007); production-directed GA-11
  populations (Not-Run); hosted dispatch (needs T-5…T-7 merged). Nothing adopted; no ADR edit; no
  workflow edits or dispatch; no Gate A verdict.

## 7. Slice-9 update (2026-11-24)

- **GA-13 exact replay CLOSED at the diagnostic lane** (`dpa7u`, `ga9-ga13` cell): the solo leg's
  real journal replays to bit-level equality on the accepted canonical representation — states,
  per-tick hashes and chain tip — when the replay steps with THE SAME shared-kernel stepper the
  room produced the journal with (A-1 seam; function-object identity proven, sentinel advances).
  The preserved one-ULP divergence is reclassified WITH A RECEIPT as a harness boundary error
  (kernel wrapper velocity `(pose_next − pose_prev)/dt` vs `FlatReferenceStepper` velocity
  `(moveX·speed·dt)/dt` — different doubles at the tick-18 pose; first field
  `kinematic.velocity.x`; dispositions identical under both, so no dispatch decision moved;
  it propagated only via stateHash → chain hash → tip). The repair is harness-side only
  (`tests/e2e/netcode.spec.ts`): no production edit, no tolerance in any pass condition (the 4-ULP
  companion survives solely as a non-gating diagnostic), no rounding change, no rehash, no journal
  adjustment. A permanent RED CONTROL replays the same journal through the production default
  every run and must reproduce exactly that divergence — a reverting harness goes red.
- **GA-9 independent verification**: a peer-issued leg (seat B runs the script) carries the same
  per-entity projection digest and the same entity-relative command/step/disposition ledger, while
  the room-wide arrivalOrdinals of those rows differ and participate in nothing compared (proved,
  not asserted). Digests/tips identical across seeds 1001/1002 (`dpa7u`, greens 8/8 ×2; five
  refutations preserved, including the measured held-room rotation rate and the recorded-retry
  policy).
- Slice-8 carry-forward: the `holdNext` scope declaration (one c2s chunk, one named connection,
  target stamp = quiet-ack+1, wire receipt, not control/seat/publication) is written into
  `artifacts/.local/spike-001/dpa7u/README.md` from the PRESERVED dpa7q green (that cell was not
  re-run — no repo evidence change was required); the stalled-ack + idle/in-flight controls stand;
  `PROPOSED-0003a` and the acceptance-refinement remain PROPOSED/DRAFT only.
- Remaining GA-13 boundary UNCHANGED: a replay leg per formal scenario under the T-5 plan (the
  ga-scenarios rooms yield ledger extracts only — the cell's `journalCoverage` inventory names it).
  Next is still T5–T8 on this reviewed exact candidate.

## 9. Slice 10 update — T-5 wired, one complete short dry-run, pinned toolchain restored (candidate `dba824c` + `artifacts/.local/spike-001/dpa7v/`, DIAGNOSTIC)

- **The pinned toolchain was restored, not re-pinned.** Node v24.22.2 was reinstated from the prior
  verified local install, re-verified by archive sha against the retained official `SHASUMS256.txt` and a
  fresh-extraction byte-compare of `bin/` (only corepack's own cache differs); pnpm 12.18.0. Every slice-10
  run — cells, dry-run, suites — is on the pinned pair; no 24.22.3 result is used anywhere, and no toolchain
  or dependency pin moved.
- **T-5 exists as an append**: `CAPTURE_PLANS` gained **only** the key `UDG-SPIKE-001` (phase `gate-a`,
  scope `gate-a`, `ga-rows.json`/`ga-replays.json` as identity artefacts); the five accepted plans are
  byte-identical under recorded digests in a unit test, the report schema and the verifier's status logic
  are untouched. The plan carries the candidate sha, the clean tree, the toolchain checks, all 12 cells,
  `UDG_GATE_A_FORMAL=1` on formal legs, **no retry machinery at all**, and `gate-a-check` as its own final
  command — a capture that cannot report success over a register it failed.
- **The register refuses to write what its own bytes disprove**: a PASS citing a non-`GATE-A` artefact is
  demoted at the builder (the real dpa7v diagnostics produced two demotions and a NOT-PASS), the verdict is
  a **function of the rows**, GA-10a/b may stand OUTSTANDING only with owner UDG-007 named, a PASS beside
  non-PASS rows is refused, an implementer-signed decision is refused, replay legs must be exact with the
  normalized original and replayed bytes present and equal, and a machine path or token fails the scan.
  Offline negatives cover each rule (seven unit tests), with the honest NOT-PASS bundle proven to produce
  zero issues — the teeth are demonstrably real.
- **The dry-run ran the whole pipeline and was rated diagnostic by it**: `evidence.js verify` **REFUSED**
  the bundle (`EVIDENCE-GATE-NOT-PASS` + 19 formal commands never run + 11 thresholds unmeasured — zero
  identity/hash/pairing issues: the wiring verifies, only the absent formal work keeps it out);
  `gate-a-check` accepted the honest bundle while **printing the NOT-PASS it does not hide**, and the
  forged-verdict, wrong-candidate, implementer-decision and non-exact-replay variants each exited 1 with
  its named code (kept under `gate-a-dryrun/variants/`). The cell persists a structured journal **per clean
  leg** (dir cleared at start, sanitisation scanned before the write) and replays every leg EXACT through
  the producing shared-kernel stepper, candidate-bound on a clean tree (9/9, `ga-replays.json` carrying
  original and replayed bytes).
- **Retries are out of formal cells by construction**: `UDG_GATE_A_FORMAL=1` runs the pre-registered
  schedule (150/140/400/300 ms, step wall ≈290 ms) with **maxAttempts = 1**; both formal attempts on this
  machine went **RED by the held-room transport rotation — recorded, not rerolled**; non-formal retries are
  recorded and the artefact kind stays `DIAGNOSTIC-NOT-GATE-A`, so a retry-selected green cannot present as
  Gate A. Formal GA-9/GA-13 eligibility awaits a quiet-runner receipt or a tightened pre-registered schedule.
- Focused suites: full `pnpm test` 863/864 — the sole failure is the camera suite's staleness gate, failing
  identically at the clean HEAD before this slice's diff (stash-and-run proof), named and not recaptured;
  the two pre-existing contract reds were slices 7/8 moving tracked files without regenerating
  `checksums.json` — fixed **by the command** (M-4, two entries). `evidence.js plans` now lists
  `UDG-SPIKE-001`; routine CI gains no capture (C-07 intact). Next: T-6/T-7/T-8 in the workflow lane, then
  the first formal Grid on a hosted quiet runner.

## 10. Slice 11 update — profile and evidence integrity made executable (candidate `8fc0596` + `artifacts/.local/spike-001/dpa7w/`, DIAGNOSTIC)

- **One real matrix runner.** The first T-5 table called `elevated-full` for eleven rows and
  `ga9-ga13` for a LAN coordinate — eleven silently-elevated runs and a scenario cell posing as a
  matrix leg. Now the twelve rows all dispatch `--cell full-window` with an **explicit**
  `--profile` and `--seed`: the runner has no defaults in any mode, formal mode additionally pins
  the seed to the official set and refuses `self-check` and the legacy `elevated-full` alias, and
  a unit test proves the table against the adopted `SPIKE_PROFILES` regimes — 12 distinct pairs,
  each row equal to its label, each regime the one its coordinate names. Scenario cells keep
  separate rows; they can no more substitute for a matrix leg than for a Gate A row. Each
  coordinate writes its OWN artefact directory with a timestamped isolated first attempt and
  `attempt: 1, automaticRetries: 0` in the bytes. One wiring proof, not twelve: lan/1001 ran the
  full 20 s + 120 s twice — the first attempt's reds (one stale pre-parameterization assertion,
  fixed; a consistent ~1.3 s mover-page monotonic window shortfall, **preserved, not rerolled**)
  are the record, and a hosted runner decides whether the coordinate stands.
- **Rows are worth their bytes.** `gate-a-check` no longer takes a citation on faith: the artefact
  must be a regular file **confined to the bundle** (no absolute path, traversal or symlink), must
  re-hash to the registered SHA-256, and its OWN bytes must carry the kind, the candidate sha and
  an attestation; PASS rows additionally refuse red internal checks and any recorded
  rotation/multi-attempt leg, and the register now binds its rows manifest by digest with a
  sanitised copy travelling in the bundle (`ga-rows-source.json`). A `kind: "GATE-A"` JSON string
  alone decides nothing — byte-level downgrades, appended bytes, fabricated paths and
  cross-candidate citations each refuse, offline-tested, and the formal first-attempt artefact
  earned its GA-9/GA-13 PASS rows on bytes while the verdict stayed NOT-PASS and `gate-a-check`
  exited 0 printing exactly that. Schema and verifier generation untouched; the five accepted
  plans stay byte-identical.
- **The held-room guess lost its clock.** The gated legs no longer pace on wall-clock guesses: a
  PRE-DECLARED tick plan (declared ingest allowance, one gated tick per step, causal completion at
  the room's own per-seat `resolvedThrough` watermark, consecutive consumed ticks, deadlines as
  failure conditions rather than retries, in-flight tick drained before baselining). Two witness
  designs were tried and REFUTED on this machine and their refutations preserved rather than
  iterated away: the `consumed` ledger never lists direct-intent frames, and a fully causal ingest
  wait holds the seat past its retirement deadline. With the plan in place the formal first
  attempt, retries OFF, came back 10/10 with **zero rotations and every leg at one attempt** — the
  rotation was the heuristic cadence, and pacing removed the cause instead of rerolling it.
- Focused suites: full `pnpm test` 874/875 (the lone red is the camera suite's staleness, named
  and untouched); spike unit suites 150/150; typecheck and lint clean; lockfile byte-identical.
  Next: T-6/T-7/T-8 in the workflow lane, then the hosted Grid over the twelve `full-window` rows
  and the three scenario rows exactly as the plan now states them.

## 11. Slice-12 update (2026-11-25): the LAN window fixed at the source; T-6 and T-8 landed

**(a) The LAN full-window failure was structural, and the three retained reds say exactly where.**
Pre-fix attempts authored 117 763 ms and 118 661 ms of motion against the declared 120 000 ms
window; the first continuation after the timebase fix authored 119 990 ms. Root cause, in order of
discovery: the window opened on a NODE-side wall sleep and closed when the PROBE loop finished, so
its length was 99 × (1180 ms + RTT) — on LAN's 4 ms regime that is ≈117.3 s, structurally always
under 120 s; the residual 10 ms was the ≥ guard being read one `evaluate` before the stamp that
closed the window. The fix (test harness only, no production path): the route pump publishes its
`performance.now()` origin synchronously as its first act; `measureStart`/`measureEnd` are waited
on THAT clock — the same monotonic clock the authored motion runs on — and the ≥ guard is enforced
AT the stamp itself (25 ms stamp margin, pre-declared cap still a named trip); the first/last
eligible deliveries are traced in their own evaluates; and the ledger and ping windows are now
INDEPENDENT windows with their own bounds (`pingWindow` derived from cadence + median RTT,
`ledgerWindow` from the delivery ledger) rather than renames of one another. Teardown is unchanged
and still bounded. LAN/1001 then ran 14/14 with a measured window of 120 001 ms. Every prior red is
retained in `dpa7w/` by filename — the fix is evidenced by the numbers, not over them.

**(b) T-8 and T-6, as one routing contract.** `tools/ci/route-checks.mjs` gains rule
`spike-netcode-fast`: the netcode suite, `tests/spikes/**`, `tests/unit/udg-spike-001/**`,
`tools/load-test/**` and `apps/client/src/network/**` route to EXISTING lanes only — `unit` and
`runtime` — while their pre-existing `camera`/`source-static` routing is untouched (a netcode-spec
change still fires the camera lane exactly as before). The rule adds NO new group: the Gate A
matrix is T-7's, living in the dispatched acceptance workflow, which is never routed; and capture
is not a routable group at all (C-07). Two-way tested: the mandatory probe map fires the rule,
lookalike negatives (`tools/load-test2/**`, `apps/client/src/networking/**`, `netcode.spec.tsx`)
stay out of the spike lane, a spike route never sets `fullSuite`, and `workflow-policy.test.ts`
asserts the smoke step exists in exactly the `runtime` job and nowhere else. T-6 is one step in
that existing runtime job (not a new job — T-8's own words: existing lanes): `pnpm test:spike --
--id UDG-SPIKE-001 --cell lan-smoke --profile lan --seed 1001`. `lan-smoke` is a new isolated
cell — two true browser contexts through the accepted proxy primitive, 12 ping window, observer
saw-the-mover check, bounded teardown — with the 240 s wall budget PRE-REGISTERED as a constant
the cell asserts against its own clock and records in its artefact (measured 32–37 s locally). It
is not the full-window runner, captures nothing, writes only under `artifacts/.local`, and the
dispatcher refuses it under `UDG_GATE_A_FORMAL=1` — with the cell refusing again in its own body.

Focused suites: ci-routing + spike units 197/197; the smoke cell ran green twice locally; LAN
full-window 14/14. T-7 remains unimplemented here by grant boundary. Nothing adopted; no workflow
dispatch; no camera recapture; no Gate A verdict.

## 12. Slice-13 update (2026-11-20): T-7 preparation — the manual gate-a workflow, the binder, and one recorded grant

**Recorded grant (reviewer, 2026-11-20).** Following the hosted full-suite red at 1b96bad (attribution in §11
and the PR #7 body), the reviewer independently confirmed run 44741338298 green across all jobs at
`4dc866d` and **approved and documented a narrow, self-contained, BUILD-ONLY grant** for
`tests/system/udg-003-phase-2/runtime.test.ts`: the suite's existing one-build-before-scripts
guarantee now also builds `@udg/client` because the shared kernel stepper imports the client-emitted
`flatStep.js`. No system expectation changed. T-6/T-8 stand as reviewed baseline.

**T-7 preparation (this slice): `.github/workflows/gate-a.yml` + `tools/checks/src/gate-a-aggregate.ts`.**
The manual dispatched grid, per plan §4: FOUR independent profile jobs (matrix, `fail-fast: false` for
diagnostics), each running ONLY its own three official seeds ORDERED (1001→1003, pinned against the
dispatcher's own list by test) on the full-window runner (`--cell full-window`, 20 s + 120 s, two true
contexts, `UDG_GATE_A_FORMAL=1`), every coordinate exactly once — no retry machinery anywhere, every
mandatory error fails its job, and a red row's bytes are still uploaded (always()). The full capture
plan is never invoked. `candidate` must be full 40-hex and the checked-out HEAD must equal it BEFORE
install or test (all three jobs); no workflow expression reaches a shell body (inputs travel via
`env:`, tested); actions are exactly the three pins the repo already carries (checkout, setup-node,
upload-artifact, full sha), `persist-credentials: false` on every checkout, `permissions: contents:
read` (the evidence job additionally takes `actions: read`, solely to `gh run download` artefacts the
runner already received). The scenario lane is SEPARATE and states its own statuses and every declared
gap (GA-5b/PE-1, GA-12/PE-1, GA-10a/b UDG-007, GA-11 production Not-Run) in `gate-a-scenario-status.json`
— the binder never infers statuses.

**The missing interface, closed with the smallest reviewed helper.** The existing capture glue binds
artefacts INSIDE one plan-produced bundle; nothing could bind externally collected matrix artefacts or
scenario rows. `evidence.js gate-a-aggregate --dir --scenarios --candidate --out` now does exactly
that and NOTHING else: it executes no test, re-runs no matrix, and reports per-row candidate/coordinate/
byte-SHA/toolchain/threshold bindings. Missing → MISSING (blocked, not passed); two artefacts →
DUPLICATES; outside the twelve → UNEXPECTED; and the tamper surface is named case by case — wrong SHA,
dirty identity, kind downgrade, path/bytes coordinate disagreement, red internal checks, rerolled
attempts, window shortfall or guard trip, one browser context, off-table thresholds, mixed toolchains,
scenario artefacts from another candidate, invented or absent scenario statuses (20 unit tests, mock
end-to-end, plus a live CLI demo). The report binds every row to candidate/profile/seed and the ACTUAL
toolchain and thresholds. **The binder's ceiling is deliberate: with the declared gaps standing, even a
perfect green matrix yields `Gate A NOT-PASS (open gaps)`** — no code path in this helper can write
PASS for Gate A. An unsuccessful dispatch publishes no evidence bundle: the upload sits behind the
binder's own exit status, and the refusal step is a hard failure, not a warning.

**Verification and limits.** ci-routing 58/58 (new `gate-a-workflow.test.ts` pins every rule above
against the file, including the ordered-seed list against `SPIKE_OFFICIAL_SEEDS` and the three pins
against ci.yml/acceptance.yml); spike units 171/171; typecheck 0; lint/boundaries 0 (the boundary
scanner's regex-literal tokenisation of the cell-directory pattern is documented in-file, the
pattern now lives in a string). LIMITS: GitHub only discovers a dispatchable workflow once the file
reaches `main` (official behaviour), so actually DISPATCHING this grid remains a post-review step
that this batch neither performs nor pre-empt — no merge happened here, nothing was dispatched, and
the formal matrix remains blocked for a PASS by the GA-11 production populations and the unresolved
GA-5b/GA-12 policy exactly as before. Full YAML acceptance is the runner's at first dispatch; local
validation is the policy suite above plus the structural parse it performs.

## 13. Slice-14 update (2026-11-20): bounded T-7 corrections + the static-lane root red, kept and fixed

**Root red, kept and attributed.** Hosted run 44744981957 (PR #7 @ e733c42) went red in
`routine / static`, step 6 "Typecheck every populated workspace":
`gate-a-aggregate.test.ts(187): TS2307 Cannot find module tools/load-test/dist/run-spike.js`.
Reproduced verbatim on a truly clean clone (fresh checkout, install, `pnpm typecheck`, zero dists
present): the root typecheck chain builds `@udg/checks` and the packages but never `tools/load-test`,
so a module-import tripwire in a test is a build-order assumption. The log and the reproduction are
retained (`dpa7z/`); the fix changed only the responsible file: the threshold mirror now reads the
adopted `SPIKE_PROFILES` table FROM ITS SOURCE TEXT (`tools/load-test/src/run-spike.ts`) — the same
drift check, needing no build phase, portable on the pinned Node 24.22.2, and clean-clone typecheck
returns 0. No suppression, no rerun-to-hide.

**T-7 corrections (this batch), all inside the supplied workflow + binder + their tests.**
(1) The dispatch input is the assignment's exact `candidate_sha`; `run_id` is an optional printable
label (`[A-Za-z0-9._-]{1,64}`, validated BEFORE checkout/install in every job) while every artefact
name carries the immutable `github.run_id` as the dispatch identity. (2) Per-profile
`timeout-minutes: 30` (and 30 for scenarios) per §4's ≤ 30-minute overall matrix target — the old
150-minute cap would have hidden a stalled lane for hours. (3) Failure propagation: the evidence job
passes `--lanes profile=<needs.profile.result>,scenarios=<needs.scenarios.result>` (via env) and the
binder refuses ANY non-success value (`GATEA-AGG-LANE`) — red, skipped, cancelled or unknown — even
when all twelve files happen to be complete; proven by mock (complete set + failed upstream) and by
CLI exit-code fixture tests (the contract the publish gate actually keys on). (4) Mandatory
no-artefact for malformed/short/wrong SHA: every upload sits behind
`if: always() && steps.inputgate.outcome == 'success' && steps.headbind.outcome == 'success'`.
(5) Diagnostic honesty: the standalone aggregate report is published as
`gate-a-report-diagnostic-…` and the lane states in-file that it is never a verified evidence
bundle — a bona fide candidate bundle follows the accepted bounded path (authorized capture plan →
bundle directory → `pnpm evidence:verify`, i.e. `evidence.js verify --run <BUNDLE>`, re-deriving
every digest from the manifest), which stays with acceptance.yml. (6) Inputs still never reach a
shell body; pins, permissions and persist-credentials unchanged; no other workflow was touched.

**Validation limits.** actionlint, yamllint, ruby/PyYAML/perl-YAML were all probed ABSENT in this
offline environment and no dependency may be added, so full YAML job-graph acceptance remains the
runner's own at first dispatch; what CAN be conformance-tested offline is: the policy suite (static
semantics of every grant rule), the binder module tests, and the new CLI exit-code fixture tests.
GitHub still discovers dispatchable workflows only from `main`; nothing here merges or dispatches,
and the formal matrix stays blocked for a PASS by GA-11 production populations and unresolved
GA-5b/GA-12 policy — with open gaps this lane publishes labelled diagnostics only, never a bundle.

## 14. Slice-15 update (2026-11-20): standards-YAML correction, first-attempt guard, corrected recommendations

- **Psych rejection (line 151 col 121) retained and fixed**: an unquoted plain-scalar step name
  carried `: `; reworded. No YAML parser exists in this container (ruby/PyYAML/perl/js-yaml/yaml all
  probed absent; manifest untouched), so the pushed head is the reviewer's parse candidate and a
  dependency-free plain-scalar conformance scanner (with a positive control firing on the exact
  rejected class) is the local fixture. Red receipt: `dpa8a/`.
- **First-attempt guard**: `github.run_attempt` (env-only) must equal `1` in every job before
  checkout/install; uploads and the bind sit behind that gate. A manual rerun keeps the run_id —
  attempt > 1 can no longer reuse first-attempt identities or be mistaken for a first attempt.
- **Corrected recommendations** (replacing the slice-14 wording): GA-10a/GA-10b are **explicitly
  deferred by owner decision and are NOT Gate A blockers**; what still waits is **verification
  (the hosted formal dispatch + evidence:verify path), GA-11 production populations, GA-5b and
  GA-12**. And the conductor-only framing is corrected: PR #7 spans the entire spike program
  (harness, kernel seam, evidence tooling, CI lanes), so **merging the whole PR is NOT a
  conductor-only release**; a conductor-only step would need its own scoped cherry-pick/release
  decision, which nothing in this batch performs. Nothing merged, nothing dispatched.

## 15. Slice-16 decision record (2026-11-20, DRAFT — doc/evidence only, no code churn)

Reviewer verification at `be613c6`: Psych parses the exact YAML, sole trigger `workflow_dispatch`,
three jobs, all 23 script bodies pass `bash -n`; T-7 syntax and the first-attempt guard are
ACCEPTED. This record prepares three decisions; nothing here edits an accepted ADR, adopts policy,
merges, or dispatches.

### A. Proposed narrow amendments — GA-5b and GA-12 (DRAFT decision record) — **WORDING SUPERSEDED 2026-11-20**

> **Superseded:** the reviewer found this section's framing of GA-5b's original criterion
> inaccurate (GA-5b never promised a known native cause — it requires recovery WHILE UNABLE to
> identify the cause). The precise replacement draft lives at
> [`docs/adr/proposals/UDG-SPIKE-001-ga5b-ga12-precision-amendment-proposal.md`](../../adr/proposals/UDG-SPIKE-001-ga5b-ga12-precision-amendment-proposal.md)
> (PROPOSED, not accepted; accepted ADR-0003 unchanged). This section stays as written on its own
> date — history is superseded, never deleted — including its malformed-stamp-control requirement,
> which the replacement RETAINS in harness-control form while explicitly refusing any new
> requirement that a conforming producer generate forbidden duplicates.

**Why narrow amendments exist (history preserved exactly).** GA-5b's original criterion reads
"a client expectation for the lost input … triggers recovery"; the spike's honest-core finding is
that the terminal decline creates NO client expectation and NO observable signature
(`UDG-SPIKE-001-acceptance-refinement-draft.md`, PROPOSED/DRAFT). The inadequate measurements are
on the record and stay: the dpa5g/dpa5h stale-input-inference claims were RETRACTED
(`PROPOSED-0003a` rev 2 §0 — the cautionary exemplar), and GA-5b's own row forbids the server
inferring a gap from silence. No rewriting.

**Proposed GA-5b amendment (narrow, behavioural, runnable).** Split the row honestly:
*GA-5b(i) blind terminal-loss recovery* — satisfied by `ga5l` as it runs today and required to
stay exactly as worded: the suppressed input is UNNAMEABLE by the client, recovery fires through
the live stalled-ack rule (`ColyseusPredictionAdapter.ts` `input-ack-stalled`, ~:599/:1206), the
transcript is replay-audited (GA-5t audit, `netcode.spec.ts:5272`, forged control row REJECTED),
and the invariants hold — no lying on the prefix, no duplicate consumption, no accepted
old-epoch row. Evidence: ga-scenarios cells (dpa7c/p/q lineage, `dpa7k`-series contamination
receipts), the retained red reproduction of the generation-continuation breach, and
`ga5l` checks at `netcode.spec.ts:5311/5401/5435`. Verification stays runnable:
`pnpm test:spike -- --id UDG-SPIKE-001 --cell ga-scenarios --profile elevated --seed 1001`.
*GA-5b(ii) known-what-happened recovery* — remains BLOCKED on PE-1; nothing may close it.
**Native terminal dedupe**: within the explicitly stated domain — pinned producer
@colyseus/core@0.18.27 (`RoomInput.mjs` `capture() → InputBuffer.accept: value <= _lastSeq ⇒
dropped BEFORE the buffer`, asserted at `netcode.spec.ts:5700`) driven by the honest stamp rule
(sentCount + 1, strictly increasing, `netcode.spec.ts:5311`) — the dedupe branch is recorded
**inapplicable/unobservable**, never "verified harmless". Refinement REQUIRES negative controls
before ANY dedupe-flavoured closure language: deliberately malformed stamps (duplicate stamp;
decreasing stamp; foreign-domain stamp) driven at the seam, each demonstrably dropped/labelled.
Those controls DO NOT EXIST TODAY and would block under the refined gate as named red/missing
tests. Application suppression stays labelled exactly: `holdNext` is test-only
APPLICATION-DELIVERY suppression, explicitly "never a drop, never native dedupe"
(`netcode.spec.ts:5401/5700`) — **confirmed: no application suppression anywhere in this repo is
labelled native**, and no safety is inferred from absence of telemetry (the GA-5l revalidation,
`netcode.spec.ts:5435`, proves the decline is silent on the wire and in every room record — the
absence is AUDITED, which is the opposite of inference).
**Proposed GA-12 amendment (narrow).** Keep PE-1…PE-5 as the categorical precondition — quoted
requirement unchanged: no suspected-dedupe close without PE-1…PE-5 ALL passing;
`dedupeClosureEnabled: false` stays shipped false with NO closure branch for the signature at all
(`vectors.test.ts:507`; config fact asserted at `input.ts:140/158`, `vectors.test.ts:545`). The
amendment only records: until PE-1 delivers a server-observable decline signature, the ONLY valid
GA-12 disposition is BLOCKED-WITH-PROOF, and the blocking test failure is itself the evidence:
any future "GA-12 closed" assertion must first make a PE-1 signature test PASS — today the
revalidation check proves byte-identity between decline and health, so the required positive test
is guaranteed red, and that guaranteed-red state is what must be visible, not hidden.
Draft only; owner of `docs/contracts/workflow.md` syntax decides adoption.

### B. Smallest production-directed GA-11 measurement (proposal — no adoption, no invented topology)

Read sources: `docs/adr/0003…` §5 GA-11 (the two inequalities: `B + J·λ + stall ≤ bufferMaxSize`;
`clientSnapshotDeadlineMs ≥ 4 × patch interval + 2 × measured p99 RTT`), provisional settings row
(`adoption.md:438`: B=8, bufferMaxSize 32, closure 250/1000, clientSnapshotDeadlineMs 500 ms),
threshold-denial rule AR-3 (refinement draft), and the deployment reality: no production site
exists in any project doc (docs/integration names only Colyseus/browser stack; runners are GitHub
ubuntu-24.04). So the SMALLEST measurement with a named "measured toward production" source is:
**one scripted two-browser business session (the SAME paired-context netcode harness, real
`apps/client` pages, no proxy) between TWO distinct GitHub hosted runners** — genuinely different
hosts on the provider's real network, no new hosting, no site invented — profile: the production
candidate regime (moderate + poor), 3 sessions × 2 profiles, per-session artefacts in the existing
spike-cell schema recording: named Node/browser versions, the actual TCP/WSS path (runner-to-runner
endpoint pair, source label `measured-toward-production (two hosted runners, provider network)`),
measured arrival scheduling (patch-interval p50/p95), arrival-stall maxima, 99-probe RTT
population (nearest-rank percentiles per the refinement draft's stated method) and delivered patch
sizes. Failure floors PRE-REGISTERED before running (from the AR-3 discipline): a leg is INVALID
if RTT validity fails the declared regime, if stalls exceed the recorded p95×4, or if probe loss
>2 %.
**FACT CORRECTION (slice 17 review): two standard GitHub-hosted runners do NOT by themselves
establish a peer-reachable gameplay network.** Hosted runners are isolated CI workers; nothing in
this repository nominates a provider, a network path, or a deployment, and inbound/inter-runner
reachability is neither documented nor guaranteed. The two-runner shape above is therefore NOT
schedulable as written and is NOT scheduled; what it needs is enumerated below (the exact bounded
prerequisites), and until those exist as a nominated, owner-approved deployment the
measured-toward-production population stays Not-Run. The 500 ms finding below stands — it is
computed from harness data and says nothing about any network that does not exist yet.

**Exact bounded prerequisites to a representative GA-11 test (all owned by the owner/delegated
approver, none implementable from the harness):** (1) a NOMINATED deployment target (a real
server host, named in a contract, with its Node version and network identity recorded); (2)
client endpoints on DIFFERENT real networks from the server (at minimum two distinct egress paths,
each with a named provider), not two CI workers; (3) demonstrated peer REACHABILITY (the business
session completes end to end over the intended path, witnessed by the room's own ledger, before
any number counts); (4) an impairment SOURCE that is the network itself (measured RTT against the
declared regime, per the achieved-validity rule) or, absent that, the ADR's
`dropModel: application-layer delivery loss` label traveling with every number; (5) an explicit
owner grant for any service exposure/ingress (a spike never opens a port by itself); (6) the
evidence-identity wiring already built (cell schema, validity floors, candidate binding) reused
unchanged. Until 1–5 exist: GA-11 production populations are BLOCKED with these conditions named;
the provisional floor PROPOSAL (1000 ms, §15B) stays a proposal informed by harness data only.

**Why 500 ms is invalid across the poorer p99, from the NAMED valid sample** (`dpa7s/spike-cell-ga11-calibration.json`,
poor leg, validity achieved = valid): measured patch interval p50 100.19 / p95 113.8 ms; RTT
p50 203 / p95 217 / p99 218 ms; arrival-stall max 707.8 ms. Formula: 4 × 113.8 + 2 × 218 =
**891.2 ms > 500 ms** — the provisional deadline fails the formula on the poor regime even in the
harness. **Defensible candidate floor (proposal only): 1000 ms**, chosen over the bare 891.2
because a nearest-rank p99 from ~100 samples carries tail uncertainty and the margin must at least
cover one declared jitter budget (40 ms): 891.2 + 40 ≈ 931 ⇒ round to the already-adopted
closureMaxMs 1000 for review. Inequality 1 on the same sample: 8 (B) + ceil(40 ms × 20 Hz → 1)
+ ceil(707.8 ms × 20 Hz → 15) = 24 ≤ 32 (8-tick headroom). **What this data can and cannot do**:
it can INFORM the proposal (named, valid, declared-regime samples) and pre-register formulas; it
CANNOT support a production claim — the impairment source is the proxy model on loopback and
"harness-modelled loss may not be presented as network loss" (ADR-0003 GA-11 row). Only the
two-runner measured-toward-production population (or real production data) may move contract text.

### C. Conductor-only release shape (exact, verified reasoning — no PR created, main untouched)

PR #7 spans the whole spike program; merging it is NOT conductor-only (corrected §14). Feasible
shape: **one file to `main`: `.github/workflows/gate-a.yml`** (blob at `be613c6`:
`19992d3abf22f535de250311447f51a3909aca27`). Mechanism check (CORRECTED slice 17 for precision): `workflow_dispatch` executes the copy of the
workflow FILE **on the ref being dispatched** — dispatching `--ref main` runs main's copy, but a
dispatch at any OTHER ref that carries that file (a branch or tag) runs THAT revision's copy. The
shape below is therefore sound only under two named conditions: the dispatch is pinned to
`--ref main`, and the blob-equality guard (added below) proves the running copy equals the
candidate's reviewed file at the candidate commit. Every job in either copy checks out
`inputs.candidate_sha` and runs THE CANDIDATE'S harness/binder
THE CANDIDATE'S harness/binder — so a workflow-only main is functionally complete provided the
candidate commit is reachable from a ref: it is, via branch `codex/udg-spike-001-dpa2-impairment`
(which must therefore NOT be deleted before the dispatch). GitHub CLI dispatch (`gh workflow run
gate-a.yml --ref main -f candidate_sha=<sha>`) resolves the definition by (repository, workflow
path, ref=main) — staleness vector is main's copy drifting from the reviewed blob. Guards, exact:
(1) rerun/stale protection ALREADY in-file: `run_attempt == 1` before checkout/install/upload/bind;
(2) definition-mismatch guard to add in the same commit — one step per job, after `headbind`:

    - name: The candidate must carry the SAME workflow definition the runner is executing
      run: |
        set -euo pipefail
        a="$(git hash-object .github/workflows/gate-a.yml)"
        b="$(git show "$CANDIDATE:.github/workflows/gate-a.yml" | git hash-object --stdin)"
        if [ "$a" != "$b" ]; then echo "::error::main's gate-a.yml ($a) differs from the candidate's ($b) — refusing: the reviewed definition is the one under execution"; exit 1; fi

(3) worktree-vs-candidate mismatch is structurally impossible (HEAD-equality before install); (4)
against the open-gap revision (`be613c6`) this lane can ONLY produce diagnostics (binder ceiling
NOT-PASS; report labelled diagnostic) — so a dispatch before the A/B decisions is useful solely
as a diagnostic grid collection and must be recorded as such. **Recommendation / action order if
the conductor opts in**: 1) cherry-pick exactly `.github/workflows/gate-a.yml` @ `be613c6` to main
(review the one-file diff + the guard step above); 2) keep the candidate branch ref alive; 3)
dispatch only with `candidate_sha=be613c6…` and an explicit diagnostic-only note; 4) do not treat
any artefact of that run as bundle or Gate A progress (the bona fide path is capture plan +
`evidence:verify`). Where a standalone workflow is NOT enough: none found mechanically — but the
EVIDENCE dependency stands: no formal PASS can be collected before the A amendments are adopted
and the B measurement exists, so the release grants collection, never closure.

### Evidence-register contrast + hosted status

- **Remaining formal legs (NOT blockers, just work)**: GA-3/GA-9 formal grid legs and GA-13
  replay legs — runnable-now cells awaiting a hosted dispatch (§8: "no longer runnable-not-built";
  owed: ga-scenarios persisted journals for every-formal-scenario replay coverage).
- **True blockers (unchanged)**: verification (hosted formal dispatch + `evidence:verify` bundle
  path), GA-11 production/measured-toward-production populations, GA-5b(ii)/GA-12 on PE-1…PE-5.
  GA-10a/GA-10b remain DEFERRED by owner (not blockers).
- **Hosted at `be613c6` (reported as measured, terminal)**: run `44748120423` — head verified =
  `be613c66043aa92f09b5aa00c5b52545ae6cc29e`; ALL ten jobs success including `routine / full suite`
  (success) and the aggregate gate **`routine outcome` = success**. First fully-green hosted routine
  on this branch.

## 16. Slice 17 — malformed-stamp controls, GA-3 leg, GA-13 scenario journals (code in-harness, not docs)

All of it ran in the EXISTING accepted harness (`pnpm test:spike -- --id UDG-SPIKE-001 --cell
ga-scenarios --profile elevated --seed 1001`), one file touched (`tests/e2e/netcode.spec.ts`), no
product/raw-payload path, no ADR edited, PE-1 unmet, GA-5b draft-only, no config/defaults touched.
Raw evidence: `dpa8c/` (every attempt's log + `spike-cell-ga-scenarios.json` + `gate/` journals).

- **GA-5b malformed-stamp negative controls (three, separately, on the accepted public-handle
  re-stamping seam GA-5t already uses — the pinned core IS the seam; the production send route is
  untouched).** (dup) same-domain duplicate stamp; (dec) decreasing stamp; (epoch) FOREIGN EPOCH
  on an otherwise monotone stamp; each leg: legitimate monotone baseline through the pump first
  (every baseline stamp consumed EXACTLY once, mover visibly moved, wire quiet 400 ms), then ONE
  malformed frame with distinctive content (moveX −1, moveZ +1). Measured dispositions, each
  proven by exact consumption/prefix AND wire+different movement: dup/dec are declined
  PRE-BUFFER SILENTLY (the stamp's consumed count stays exactly 1, zero room records for the
  decline — the PE-1 silence, now measured on the two shapes the refinement names), their z
  content applied NOWHERE (|z| < 0.05 m on the independent observer), and because the raw send
  still consumed a SLOT the prefix can never resolve, the client's own journal holds an
  OUTSTANDING input and the contract's BLIND input-ack-stalled recovery fires EXACTLY once
  (streak = G from the named config, no deadline/gap/retired route, guard equality after). The
  earlier draft prediction "no episode for these shapes" is SUPERSEDED by the control's own
  first-attempt evidence. The foreign-epoch frame is refused WITH NAMES and nothing else:
  dequeued once, exactly one refusal in the room's ledger on the SAME tick record that consumed
  the stamp (attribution by the room's own seat-entity identity — attempts 1–2 guessed the join
  sessionId and are retained red, `dpa8c`), a journalled `refused:epoch` (EPOCH_MISMATCH)
  NEUTRAL step, zero motion from it, the watermark advances over the refused stamp, guard
  equality holds at every poll, NOTHING is left outstanding so NO recovery episode fires (a
  recovery there would itself be a falsely named cause), zero accepted wrong-epoch deliveries,
  and the next legitimate frame moves the seat again (route survives). Zero falsely named cause
  across all three: no client event or room record ever says dedupe/duplicate/stale/decline/
  retired. These controls are the ones §15A requires before any dedupe-flavoured closure
  wording, and they are usable NOW for deciding the refined wording — while PE-1 stays
  unmeeted (the dup/dec silence IS the missing signature) and GA-5b stays DRAFT.
- **GA-3 leg (confirmed retirement, prevention disabled, two seats)** — see the corrected register
  row above: matched confirmed retirement + bounded 4100 attributed to the offender ONLY + residue
  ≥ 1 named + reported while unacknowledged + zero cross-seat collateral + room alive for the
  clean seat. Prevention-disabled is the measured substrate state (throttle-only posture, no
  prevention limb, no operator seam exists to disable and none was needed; NO production config
  touched). First-attempt reds retained: attempts 5–6 (posture-fire over-claim and its ordering),
  attempt 7 (a proxy-stats host hiccup rode a NaN into the UNRELATED GA-5l row — fixed at the
  measurement: `statCountAt` retries the READ, never a verdict).
- **GA-13 per-scenario journals for the major scenarios** — every scenario room of the cell is
  built through the A-1 kernel-stepper envelope, so each REAL journal is now captured at its own
  teardown, persisted scanner-clean with a sha (`gate/ga-scenarios-journal-<tag>.json`) and
  kernel-replayed to EXACT dispositions/state bytes/tick hashes/chain tip: **16/16 exact**
  (ga6a/b/c episode+rolling, ga5, ga5t, the ga5l family, ga7t/c1/c2, ga3, and the three GA-5b
  controls). The "ga-scenarios yields LEDGER EXTRACTS, not journals" line in the ga9-ga13
  coverage register is updated accordingly (that cell re-run green with the register edit). No
  journal export in this cell needed an out-of-grant seam; the named-BLOCKED export rows for the
  metric-trace runs (calibration/elevated-full/ab-controls) stay named, not relabelled.
- Boundary kept: DIAGNOSTIC kind throughout (`DIAGNOSTIC-NOT-GATE-A`); the binder ceiling and the
  gate-a workflow are untouched; no gate language changed; the malformed-stamp legs are evidence
  for the DRAFT refinement, not a closure of anything.

## 17. First hosted diagnostic (2026-11-20): run 44771876137 — real reds, real numbers, nothing laundered
Release: PR #8 squash-merged with expected-head guard → main 4f96bf0c…; workflow-only (1 commit,
1 file, blob 93ecb03c…606f); candidate 8338e46… carried the identical blob. Dispatch
--ref main, run_id diagnostic-onward, event workflow_dispatch, attempt 1; defbind passed in every
lane ("loaded blob == candidate blob"); binder published NO report (ceiling NOT-PASS honored —
12/12 rows bound, 5 violations: ROW-RED lan-1002 + poor-1002, LANE ×2, SCENARIO-STATUS ×1).
Evidence dir dpa8e (140 files sha256-manifested, downloaded once, local-only).

Per-coordinate first-attempt outcomes (RTT p50 / p95 / jitter AS p95−p50 ms over the 100 accepted
slot-reservation pings — RECOMPUTED FROM THE RETAINED RAW SAMPLES (slice 22) AND MATCHING the
artefacts’ own recorded achievedJitterMs to rounding (pipeline nearest-rank vs linear
interpolation differ ≤ 0.1 ms; the recorded pipeline values are printed). CORRECTION
(reviewer-caught): the FIRST publication of this table MISLABELLED its jitter column — the
numbers shown there were max−min, not p95−p50 (e.g. elevated-1001 true p95−p50 = 115.91 −
102.90 = 13.01 ms, not 38.80). The mislabel is recorded here rather than silently deleted; the
column is replaced, the spread (max−min) is kept separately and NAMED, and no §2.2 verdict
changes — the pipeline computed §2.2 on p95−p50 all along, with no conflicting metadata found.
correction p95 m; eligible matched deliveries; browser-measured warmup / measure ms):
| coordinate | p50 | p95 | jitter p95−p50 | spread max−min | corrP95 | elig | warm/ms | meas/ms | §2.2 | outcome (elapsed) |
|---|---|---|---|---|---|---|---|---|---|---|
| lan 1001 | 5.00 | 6.70 | 1.70 | 4.60 | 0.0000 | 1197 | 20001 | 120039 | OK | green (2.8m) |
| lan 1002 | 4.80 | 6.91 | 2.10 | 5.00 | 0.0000 | 1197 | 20023 | 120017 | OK | RED 1 check (2m45s) |
| lan 1003 | 4.90 | 6.41 | 1.50 | 5.50 | 0.0000 | 1196 | 20012 | 120034 | OK | green (2.7m) |
| moderate 1001 | 51.75 | 58.70 | 7.00 | 16.80 | 0.0000 | 1227 | 20022 | 123208 | OK | green |
| moderate 1002 | 51.60 | 57.80 | 6.20 | 17.80 | 0.0000 | 1228 | 20002 | 123198 | OK | green |
| moderate 1003 | 51.80 | 58.20 | 6.40 | 17.20 | 0.0000 | 1228 | 20002 | 123215 | OK | green |
| elevated 1001 | 102.90 | 115.91 | 13.00 | 38.80 | 0.0000 | 1279 | 20012 | 128305 | OK | green |
| elevated 1002 | 101.85 | 115.23 | 13.40 | 35.50 | 0.0000 | 1279 | 20021 | 128141 | OK | green |
| elevated 1003 | 100.95 | 114.60 | 13.70 | 32.20 | 0.0000 | 1275 | 20022 | 128116 | OK | green |
| poor 1001 | 205.15 | 226.21 | 21.10 | 71.70 | 0.0000 | 1381 | 20008 | 138516 | OK | green (3.1m) |
| poor 1002 | n/a | n/a | n/a | n/a | n/a | 0 | 20024 | 120023 | FAIL(no-achieved-samples) | RED 9 checks (2m47s) |
| poor 1003 | 201.90 | 229.22 | 27.40 | 68.70 | 0.0000 | 1378 | 20001 | 138316 | OK | green (2.9m) |
Scenario lane: ga9-ga13 green (28.5s), ga11-calibration green (1.1m), ga-scenarios RED 1 row
(3m08s): GA-5l soundness — c2sQuietDelta was 1 where 0 was required (one extra c2s chunk crossed
the hop inside the 400 ms pre-arm quiet window); suppression itself held intact (wireReceipt 1,
chunksHeld 1, consumed 0) and the room side read pending 0 with ack/resolvedThrough 30 while
CLIENT-side deliveries stood at 26 — the pre-arm quiet read did not wait for client-side
confirmation drain, so a durable re-issue crossed the hop. Harness pre-arm race, kept red.
poor-1002 (2m47s, kept red): an ADR-0003 recovery episode fired on the mover ~3.7 s after connect
(during WARM-UP): proxy connLog shows exactly one close — firstFin client, lifetime 3730 ms, no
error — i.e. the client-side quarantine close; no rejoin connection appears afterwards; the send
gate then held for the rest of the window ("sending is stopped: ADR-0003 recovery is in effect"),
motion froze at x=0.8 (63/64 intervals stationary), the probe refused its first ping
(abortedReason socket-closed, notSent 99 — a dead socket was never posed as a slow reply), and the
cell reported itself INVALID (no-achieved-samples) rather than being re-hashed. CAUSALITY, stated
to evidence not names: the stop IS client-side — but WHICH client rule fired cannot be named from
that artefact: the episode reason string was not persisted (named evidence gap, closed by the
mover event ledger in slice 22, which records the recoveryLedger trigger detail verbatim). What
can be stated without speculation: the fixture (joinImpSeat) constructs DirectMotionPredictor
with NO rejoin wiring and an explicitly passed snapshotDeadlineMs: 500 — a value PROVISIONAL
under GA-11, not a ratified production value — so “no rejoin connection appears afterwards” is
FIXTURE CONFIGURATION, not a measured product rejoin failure; and because the seat cannot
resume, no compliant mid-window resync or closed period can silently pass — the send gate keeps
refusing and every downstream check stays red, exactly as retained. The same profile/settings passed seeds 1001 and 1003 on the same runner class, so this
is a timing-sensitive cold-start stop (hosted runner, dev-server + browser cold start), not a
uniform GA-11 timeout failure; ga11-calibration ran green alongside. Smallest corrective actions,
in order: (1) harness-only — persist the mover's recovery event log (trigger, timestamps, episode
id) into the full-window cell artefact, and make the render-lag observation compare each seat's
LATEST monotonic tick at a shared boundary (lan-1002's lagTicks −2 at window end is the
point-sample protocol racing monotonic counters, not an observer ahead of its own authority), and
drain client-side confirmations before the GA-5l pre-arm quiet window; (2) nothing production —
GA-11 production-directed populations stay Not-Run/blocked, the proposed GA-5b/GA-12 precision
stays DRAFT (PE-1 unmet), no thresholds changed, no rerun, verdict ceiling unchanged.
GA-3/GA-13 legs ran green hosted (inside ga9-ga13 + ga-scenarios' other 30 checks). Nothing here
closes, narrows or rehashes anything; all three reds stay red with first attempts retained.

## 18. Slice 22 — closing the three first-attempt reds' measurement gaps (harness/evidence only, no production)
Old retained evidence is IMMUTABLE (dpa8e stays byte-for-byte; no rerun erases a red: hosted
lan-1002, poor-1002 and the GA-5l row remain red AT 44771876137 and are cited as such).
(1) FULL-WINDOW MOVER EVENT LEDGER + EARLY STOP. The cell now runs a 250 ms page-side ledger
bound to clock, phase and epoch: predictor state, ack/prefix/sent/outstanding, last accepted
delivery, the surfaced connectionError and every recoveryLedger event VERBATIM (the trigger
detail string is where snapshot-deadline-expired and input-ack-stalled name themselves — the
poor-1002 gap is closed forward). A send-gate stop now ends the window EARLY (the refusal is
published synchronously), the artefact is still written with full identity, ledger and hashes,
and the window checks stay honestly RED on the truncated window. joinImpSeat wires NO rejoin —
recorded in the artefact (rejoinConfigured: false) as FIXTURE CONFIGURATION: it neither indicts
the product nor lets any resync/closed period pass. snapshotDeadlineMs: 500 passed by the
fixture is PROVISIONAL under GA-11; nothing here deploys or ratifies any setting.
(2) RENDER DELAY AT THE OBSERVER'S OWN FRAME BOUNDARY. New pure rule
(tools/load-test/src/render-lag.ts, unit-pinned 7/7: an INTENTIONALLY-AHEAD observer FAILS, a
delayed/holding observer PASSES, backwards jumps name themselves as discontinuities separately
from delay, mixed identities are refused, an empty series cannot pass). The cell records
~1200 same-frame samples per run (pose fromTick/toTick/alpha/holding/howOldMs against THIS
page's latest validated authority tick, identity + epoch kept); the old cross-page point sample
is retained as a NAMED diagnostic only. Local verification: lan-1001 1232 frames, aheadFrames 0,
discontinuities 0, green (2.7m); poor-1002 local 1250 frames green (2.9m) — the hosted stop did
NOT reproduce locally (host cold-start condition; retained hosted red stands).
(3) GA-5L/LEG QUIET WINDOWS: DETERMINISTIC DRAIN + BEHAVIOURAL CONNECTION IDENTITY. All
pre-staging/pre-arm waits now drain the CLIENT's own domain (ack AND prefix exactly at the last
sent stamp, pending empty; bounded single pass, never warmed), and the quiet window gates the
MOVER WIRE — the connection identified by the baseline pump's own traffic, not by open order.
Why order failed, from retained bytes: the epoch leg showed the aggregate moving +2 while
index 0 moved 0 — the mover WS is NOT always connection 0 (client internals open other sockets
at the hop), so both the hosted GA-5l breach and a local dec-leg breach were measured against an
UNNAMED aggregate; attribution is now behavioural and the hop's FULL per-connection counts ride
in the artefact (moverConnection). A breach on the named mover wire inside the reserved 400 ms
is genuine, recorded and failing; no retries. Controls (target identity, terminal loss, idle,
blind-recovery, epoch) retained unchanged; blind and epoch rows now carry named conjunct maps
and every errored scenario captures the throw's origin line, so future reds self-attribute.
Local verification: ga-scenarios 31/31 green (2.9m) after the fix; the batch's own intermediate
red runs (two drain/identity iterations, three ERRORED rows + one epoch conjunct red caused by
this batch's own harness edits) are retained on disk at dpa8f, not rerolled.
Also: proxy stats gained c2sPerConn (per-connection c2s receipts by open order); errorOrigin on
scenario errors; §17's jitter column corrected in place with the mislabel recorded. All new
artefacts are schemaVersion 4 and kind DIAGNOSTIC-NOT-GATE-A — diagnostics, published nowhere.
Hosted: NO dispatch. Thresholds, production config, ADR, gate state: untouched.
