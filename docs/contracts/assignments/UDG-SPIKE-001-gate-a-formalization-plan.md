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

## 18A. Diagnostic #2 (hosted run 44791166883, candidate 0a69d84, attempt 1) — the poor stop is now NAMED
Raw evidence retained locally at artifacts/.local/spike-001/dpa8g/ (143 files, sha256 manifest;
candidate-bound CI: PR #7 routine all-green at 0a69d84, run 44790203558; workflow blob equal on
both sides 93ecb03c…606f; first diagnostic 44771876137 and dpa8e's 140 files byte-untouched).
BOTH prior fixture defects cleared on hosted first-attempt bytes: every lan coordinate green
under the SAME-OBSERVER-FRAME render gate (no cross-page race), and all 31 GA-scenario rows
green (deterministic drain + behaviourally named mover wire). TEN of twelve coordinates green
— the 9 LAN/moderate/elevated cells PLUS poor-1003; exactly TWO red (poor-1001, poor-1002)
(TALLY CORRECTED per reviewer: the first draft of this section miscounted "9 non-poor"; the
underlying per-coordinate table above is unchanged and correct). All ten green coordinates show
§2.2 OK, corrP95 0; p95−p50 recomputed from raw samples matches each artefact's recorded
achievedJitterMs to rounding (lan 1.9–2.1, moderate 5.3–6.8, elevated 13.6–15.2, poor-1003
27.1 ms); max−min kept separately (spread ≤ 78.9 ms) and never labelled jitter.
WHAT THE MOVER LEDGER RECORDS (poor-1001 AND poor-1002; poor-1003 green): during WARMUP, ~253 ms
(1002) / ~970 ms (1001) after the pump's first send, epoch 1, the client's OWN rule fired —
ledger trigger detail VERBATIM: "input-ack-stalled at 4" — then stop-sending, discard-pending
(4 journal entries), "domain 1 quarantined: subscriptions dropped, handle closing", "suspended:
host provides no rejoin route: staying stopped on the held snapshot" (the fixture's declared
configuration), then send-refused, and the cell early-stopped honestly (measureMs 10, window
checks RED, probe aborted socket-closed with 0 accepted samples, §2.2 networkValid FALSE,
correction NOT-CLAIMED — never re-hashed). At the trigger the ack/prefix watermark was 0/0 with
4 inputs outstanding while STATE DELIVERIES flowed healthily (authority ticks 22→28 at ~47 ms
spacing) and connectionError was null; the proxy saw exactly one client-initiated close
(lifetime 3720.76 ms) and the mover wire carried 8 c2s chunks. So: NOT the 500 ms snapshot
deadline (deliveries kept arriving); it is the INPUT-ACK-STALLED rule — config default
input.stallDetectionDeliveries = 3 (PROVISIONAL under GA-11) — counting 3 accepted deliveries
with the watermark unmoved, which at the poor profile's ~200 ms RTT is ≈ the first ack's
round trip: the pump starts sending the instant authority is seen, so the ack round trip and
the stall window are the same order of magnitude; whether the first ack-bearing delivery lands
inside the window is a cold-start coin-flip. Observed across two runs: 1001 red once/green
once, 1002 red twice, 1003 green twice — timing variance, not seed semantics. The first run's
poor-1002 shows the same SIGNATURE (client-initiated close at 3730 ms lifetime, send gate held,
motion frozen in warmup) but its artefact never persisted the reason string, so identity of its
trigger is NOT asserted — only that it matches the signature this run names.
OBSERVING ≠ TUNING: this is a diagnostic under GA-11-provisional settings. The client behaved
per the accepted §3.2 text (inputs genuinely outstanding, watermark genuinely unmoved); the
fixture refused to rejoin by construction. NOTHING here ratifies, changes or production-tunes
any threshold.
NEXT SMALLEST TARGETED INTERVENTION (contingent on exactly the above cause, harness-only, no
third matrix until approved): align the cell's pump start to the delivery phase — after join,
wait for ONE fresh authority delivery and start sending immediately after it, so the first ack
has a full round trip before the stall window can count three unmoved deliveries. Client rule,
config and fixtures' no-rejoin posture stay untouched; if a drained-phase start still stalls,
the episode reproduces again — named, with ledger — and the conversation moves to the client
team with evidence instead of inference.
Aggregator (exact, from its own log line): "gate-a-aggregate: 12/12 rows bound, 6 violation(s),
matrix INCOMPLETE-OR-RED, Gate A NOT-PASS (violations) (never PASS from this binder)" — 2 row-red
+ 2 lane-red + 2 check-red across poor-1001/poor-1002; decision remains NO PUBLISH: the verified
report artifact is absent from the run (5 raw uploads only, exactly as the guards allow).

## 19. Slice 23 — the ack-window diagnostic: the count-only stalled-ack rule cannot cover the poor envelope
DIAGNOSTIC ONLY, pre-registered before any run (artifacts/.local/spike-001/dpa8h/
PRE-REGISTRATION.md, addenda 1–6 record every failed MEASURING TOOL honestly — LCS pairing
inapplicable because the hop is a TCP-byte proxy, a dead page instrument, five runs; attempts
retained byte-wise, nothing rerolled into a nicer number; one dimension, bounded continuations,
NEVER repeated until green for a RESULT — only for the instrument). Seven shapes, single attempt
each, real room + real proxy poor profile (200/40) + real matched pings + the same deterministic
pump; G overrides and pump phase are ISOLATED knobs of this env-gated cell (no CI route, no
spike-CLI cell, no product default/pin/spec anywhere near them).
RESULTS (all valid times and variances in the artifact): in-envelope runs at G=3 AND at the
derived G (5 conservative / 4 declared basis; fastSpacingP01 = 67.5 ms measured) NEVER fired in
any start phase locally (5/5 no-fire; probe p50 201.4–205.9 ms, p95 ≤ 238.6 ms inside the
declared 240 ms envelope + 15 ms declared slack). The TERMINAL-LOST truth case fired at both
values: at G=3 input age 259.3 ms — only 14.3 ms after the declared causal floor (245 ms) — and
at G=5 age 515.1 ms; zero re-issued sends, exactly one dropped frame, REAL pending inputs only
(no invented state, no fake ack seam exists). THE STRUCTURAL FINDING (arithmetic on retained
bytes, holds on both envelope bases): post-send message inter-arrivals run p01 ≈ 61–70 ms, so a
G=3 streak can COMPLETE in ≈183 ms — BEFORE an ack is causally possible at 245 ms. A count-only
G cannot guarantee correctness at this envelope; R6's 14.3 ms margin shows how thin the line is
even when the rule fires CORRECTLY. This EXPLAINS the hosted poor reds' shape without indicting
the product: at ~200 ms RTT the stalled-ack count and the ack round trip are the same order, and
host timing decides. OBSERVING ≠ TUNING: every value involved remains PROVISIONAL UNDER GA-11;
nothing here ratifies, changes or production-tunes any threshold, and no client behaviour was
altered.
Time-based opportunity floor — necessary per the structural finding; EXACT RULE PROPOSED FOR
ADR REVIEW, NOT ADOPTED, NOT WIRED (wording UPDATED in slice 24 to establish the WAIT BEFORE
any stall is considered, and to say plainly what the wait is NOT): "INPUT_ACK_STALLED may be
CONSIDERED only after (a) the paired count/disposition condition (ack AND inputResolvedThrough
unmoved across G consecutive same-epoch state deliveries) holds, AND (b) the OLDEST ACTUAL
outstanding same-epoch input has been outstanding longer than the declared acknowledgement-
OPPORTUNITY WAIT — estRoundTripMs + delivery/authority service allowance, where
estRoundTripMs is the client's own same-socket RTT estimate (falling back to the configured RTT
envelope when no estimate exists) and the allowance is a declared constant. The wait is a
MEASURED CONSERVATIVE ENVELOPE — an acknowledgement OPPORTUNITY floor assembled from observed
distributions — and explicitly NOT a mathematical lower bound for every acknowledgement: an ack
may exist earlier, and a true loss may exist under it; what the wait eliminates is the
structural false-positive class where a delivery-count streak completes before any ack is
causally possible. The streak resets on progress, epoch change, or empty pending; obsolete
entries never hold the recovery condition; the independent snapshot deadline, episode deadline
and rolling rejoin cap are untouched and still own truly-missing deliveries; the wait requires
NO timed activity from the server." A CANDIDATE PROTOTYPE of exactly this shape (harness-supplied
option, product default UNCHANGED) is evidenced in §20. If adopted, GA-5l's
truth-case and the malformed-stamp controls must gain a floor-aware leg (they stay safe today:
their streams are 0-stall LAN-like, where floor and count agree).
SAFE NEXT CANDIDATE POLICY (for reviewer decision, contingent): keep G=3 as the provisional
default for 0-stall/LAN-shape profiles where the floor and the count agree; for RTT-bearing
profiles treat any poor-coordinate red as SUSPECT-BY-TIMING until either (i) the floor rule is
adopted, or (ii) GA-11's representative deployment provides the population that decides the
provisional values — no harness-side phase alignment or G bump may be used as a REMEDY (phase
alignment here is a diagnostic control only and stays that way).
EXACT OPEN NEED FOR GA-11 (representative deployment, NOT new host exposure): a nominated,
production-like deployment per §15B prerequisites — authoritative server in a real region
(nominated provider), real client machines over real ISP paths (the pinned browsers on machines
in the target regions), the official profiles re-derived from THAT path topology, and the
12-coordinate matrix executed against it by the owner. Absent that nomination nothing in this
repo can stand in; this document deliberately proposes NO hosting, NO exposure, NO infrastructure.
Hosted matrix dispatched: none. Gate A verdict: unchanged NOT-PASS; binder unchanged; both old
evidence bundles (dpa8e 140 files, dpa8g 143 files) retained untouched.
RACINESS OBSERVED WHILE VALIDATING (retained, both attempts at dpa8h/dec-leg-race/): the GA-5b
dec leg went RED once locally (trigger "input-ack-stalled at 1" 231 ms after a correctly
DECLINED staged stamp — the below-prefix outstanding slot §3.2 legitimately recovers from,
counted during the pump-stopped quiet window; every disposition datum of the row itself held)
and GREEN on the next single run. Named honestly: §19's structural finding in a 0-stall
microcosm; the harness's dec quiet-window is racily strict against an ADMISSIBLE §3.2 recovery.
Next-batch harness item (reviewer-approved, not executed here): make the dec observation
stall-aware. Product claims and hosted greens stand; the red attempt is retained, not rerolled.

## 20. Slice 24 — the wait-first CANDIDATE prototyped and measured (default unchanged); one eligible failure published, not tuned away
PROTOTYPE SHAPE (reviewer-approved as candidate/diagnostic ONLY): a pure, clock-injected rule
helper (apps/client/src/network/stallAckFloor.ts, unit-pinned 7/7 on SYNTHETIC clocks against the
pre-registered adversarial set: fast healthy patches completing G while no ack is serviceable →
HELD; advancing backlog → no-condition; true loss older than the wait → FIRE; old-epoch/idle →
obsolete entries NEVER hold the condition; floor OFF → byte-identical count-only behaviour; the
snapshot-deadline path is orthogonal). The predictor gains ONE optional harness-supplied setting
(stallAckFloorMs; UNSET = today's adopted count-only rule EVERYWHERE — the product default is
UNCHANGED and every effect of the prototype is labelled in the ledger: stall-floor-held events and
a PROTOTYPE-tagged trigger detail). No config/schema/default/pin changed; no CPD polling; no live
pings feed the wait; snapshot timer, episode deadlines and the rolling cap are untouched and
require no timed server activity. The WAIT's epistemic status is stated in code, pre-registration
and §19/proposal §D alike: a MEASURED CONSERVATIVE ENVELOPE (opportunity floor), NEVER a
mathematical lower bound for every acknowledgement.
ONE POOR LIVE BATCH (dpa8i; W = 400 ms fixed from retained measurements BEFORE the run; single
attempt each; all phases; no favourable-phase suppression; stop-after-one-meaningful-result):
in-envelope F1–F3 never fired (one visible held event); the TERMINAL loss FIRED at age 428.8 ms
— after the wait, +169.5 ms measured over the retained count-only baseline — with zero reissues
and REAL pending only, and then DID NOT RECOVER within the provisional budget: final state
suspended. Cross-checked against the RETAINED slice-23 baseline: the count-only runs at the SAME
profile ended SUSPENDED TOO (ages 259.3 and 515.1 ms) — the non-recovery is the PROVISIONAL
recovery path (episode 4000 ms, backoff 250/500) failing to settle leave+join across a ~200 ms
hop for this fixture, NOT the wait masking anything; the 0-stall dec leg recovers normally. The
batch check failed on that recovery conjunct BY MEASUREMENT and the failure stands published —
no W re-tuning, no rerun.
DEC FIXTURE CORRECTED (assertions, not scope): the dec/dup row now admits a NAMED stray
pre-window chunk ONLY with a room-side zero-dequeue proof (asserted conjunct, recorded, never
silent — the retained attempt-A chunk), and the row's text separates the two identities: the
NATIVE decline assertions stand on RAW non-application (|z| < 0.05 m) and DEAD-PHASE IDENTITY
(consumed-exactly-once, baseline unique, refusal silence) INDEPENDENT of any episode, while a
legitimate BLIND §3.2 episode is asserted on its own row with identity (input-ack-stalled detail
only, never dedupe/stale/decline/retired names, no wrong route) and is NOT attributed as the
native cause. Not a forced pass: every original conjunct stands; scope moved nowhere. ga-
scenarios 31/31 on the corrected fixture (prior attempts retained at dpa8h/dec-leg-race).
READINESS, DISTINGUISHED: (A) REPRESENTATIVE GA-11 EVIDENCE — an EXTERNAL HOST DECISION: the
recovery-budget exposure above, the poor-envelope ack-opportunity margins, and every provisional
value (G, snapshot 500, episode 4000, backoff ladder, and the 400 ms wait candidate) can only be
DECIDED on a nominated production-like deployment (real region, real client paths, owner-executed
matrix). This repo proposes no hosting, no exposure, no infrastructure. (B) OPTIONAL NATIVE
CLOSURE / ADOPTION — a REVIEWER decision independent of (A): adopting the wait-first wording
(proposal §D) and/or naming GA-5b(ii)/GA-12-A closure on the already-measured evidence; the
prototype stays opt-in until then, and the recovery-budget finding argues for pairing adoption
with a budget conversation, not shipping the wait alone.
Gate A verdict unchanged (NOT-PASS); no hosted matrix; dpa8e/dpa8g/dpa8h bundles untouched;
no workflow/main/P06/GA-11 adoption; accepted ADR unchanged.

## 20A. Slice 25–26 close-out — the F4 startup-timeout history and the rejoin attribution, LOCAL-ONLY evidence, NO recovered test verdict
STARTUP-TIMEOUT HISTORY (no verdict recovered). The slice-24 F4 cell hung ~700 s after the room
banner with no stage output. Twelve BOUNDED component diagnostics (node/Chromium/room server/real
join/Vite/browser+Vite/full composition, one sample each, private ports) each came back healthy; the
STALL MECHANISM was named: a `page.goto` with no `navigationTimeout` against a silent listener waits
indefinitely (the same call with a 3 s deadline names itself in 3 s), and `runCommand` buffers child
stdio through `spawnSync`, so a run killed from OUTSIDE yields ZERO Playwright stage output. One
authorized dispatcher re-run (dpa8j) with an untracked bounded overlay (navigation 60 s / action 30 s)
exited 124 at the outer cap WITHOUT reaching F4 and WITHOUT attribution — exactly the observability
gap named above. NOTHING HERE RECOVERED A TEST VERDICT: the F4 cell's verdict remains NOT RUN, and no
green was manufactured.
LIGHT DIRECT REPRODUCTION + STALE FIELD CORRECTED (dpa8l). A direct (no-E2E-harness) composition of
room + hop + Vite + pinned Chromium + the real adapter reproduced the §3.2 chain and, under LIGHT load,
RECOVERED at +1 003 ms (`snapshot-recovered revision 12 epoch 2`, state `tracking`). The JSON's
`recovery.recovered:false` is a STALE FIELD of that instrument — it read the epoch from the ORIGINAL
transport handle instead of the newest delivery-ledger row, and its 12 s pump was never awaited (2
sends, not ~240). The raw JSON is retained byte-wise; the correction lives in that bundle's README, not
in a rewrite.
ONE HEAVIER RUN, PRECONDITION-GATED BEFORE ARMING (dpa8m; single execution, 45.9 s, exit 0). Gate
PASSED before the drop: **232 sends / 121 deliveries / room `resolvedThrough` == client `ack` 232 /
one single monotone epoch (room = transport = ledger)**. Exactly ONE input terminally withheld (hop
dropped 1 once, received 241 / delivered 240; room stayed 232 while the client sent 233). Trigger
detail: **input age 519 ms** against the 400 ms opportunity wait, after two correctly HELD streaks.
Chain: stop-sending → discard-pending → domain quarantine (socket close 4000) → backoff 250 ms; the
rejoin attempt **ENTERED at +251 ms and NEVER SETTLED** (no exit, no error even past the 15 s epoch
timeout it was given; NO second WebSocket ever constructed; the room never admitted and never refused a
second seat — `joinRefusals 0`, ticks 258 → 784). The **INDEPENDENT 4 000 ms episode deadline produced
the only terminal outcome**: `suspended`, `suspensionReason episode-deadline`, connection error
`recovery-episode-expired`, pending empty, sent audit frozen at 233 = **no reissue**. MATCHED CONTROLS
in the same room at the same moment: same poor profile on a clean handle, the identical `byId` the
rejoin performs — **772 ms → epoch 2**; direct endpoint, no proxy — **67 ms → epoch 2**.
KNOWN vs CAUSE-STILL-UNKNOWN. KNOWN (proven in that composition): the opportunity floor holds then
fires as specified; §3.2 executes in order; the rejoin ladder wakes on time; the attempt never settles;
only the independent deadline resolves the episode; the room, matchmaker and hop demonstrably serve
that identical join in <1 s while the attempt sits in flight; the client re-issues nothing. STILL
UNKNOWN (THE CAUSE): WHICH step inside `createSdkSeatTransport → client.joinById` produced neither seat,
refusal nor error. There is **NO SAME-LOSS-HANDLE REQUEST TRACE**: the heavier run observed only
prototype-level WebSocket lifecycle plus the hop's chunk counters, and because a browser keep-alive
pool can carry the matchmake POST on an existing pair, "no new TCP pair at the hop" cannot prove "no
request left the page"; the earlier light run's fetch trace (`POST /matchmake/joinById → 200 in 349 ms`)
belongs to a DIFFERENT handle under light load. Closing this needs an SDK-/matchmaker-side observation
seam (new harness surface) — deliberately NOT built here. Parity limits named in the artifact: one
mover seat (no quiet/probe/observer), 20 s drain and 20 s watch vs the tracked 30 s / 8 s, pinned-Vite
binary with a private cacheDir instead of Playwright-managed `pnpm dev`, no tick gate / page-error net /
results writer, healthy-join controls rather than a second loss, n = 1 each side.
LOCAL-ONLY EVIDENCE, AND WHAT WAS NOT PUSHED. `dpa8j` (dispatcher timeout run record), `dpa8k` (first
direct reproduction, control confounded by reuse of the already-dropped handle), `dpa8l` (light
reproduction + the correction above) and `dpa8m` (the heavier run) live under `artifacts/.local/…`,
which is NOT tracked: those receipts, the diagnostic scripts and the overlay config are NOT pushed —
only this document is. `dpa8m` now carries a SHA-256 manifest of its four receipts (manifest file added
after the run; the originals byte-unchanged). The slice-25/26 harness instrumentation stays UNCOMMITTED
in the worktree and is not part of this commit.
SIDE EFFECT KNOWINGLY UNKNOWN (recorded honestly, without host-specific detail). Early in the
startup-diagnostic session a BROAD process-stop command was issued to clear a wedged child; every later
run used exact owned-PID cleanup with `/proc/<pid>/cmdline` + `cwd` verification and per-listener
`/proc/net/tcp` checks. Whether that earlier broad stop disturbed any unrelated user-local process
(e.g. a locally running dev preview or a session timeline/preview side effect) CANNOT BE RECONSTRUCTED
from the retained evidence; later observations found the pre-existing private listener still serving,
but that is not attribution. No user-/host-specific identifiers, ports or personal paths are recorded
here, deliberately: this is a public document.
STATUS. Gate A remains NOT-PASS overall and **NOT RUN for acceptance** (no hosted matrix dispatched; the
F4 cell verdict unrecovered; §20's eligible failure stands published). GA-11 still needs the STAGING
NOMINATION of §19's exact open need — a nominated production-like deployment per region with real client
paths and the owner-executed matrix — before ANY provisional value can be DECIDED: G, snapshot 500 ms,
episode 4 000 ms, the backoff ladder, the 400 ms wait candidate, and now explicitly the RECOVERY BUDGET
FOR RTT-BEARING HOPS (this close-out's finding is that a rejoin can be admitted by nothing and refused
by nothing while the budget alone terminates the episode). The wait-first wording remains a PROPOSAL
DRAFT for ADR review. NOTHING IN §20A ADOPTS IT, CHANGES A DEFAULT OR BUDGET, CLOSES A GA ROW, ROLLS AN
ATTEMPT, OR TOUCHES MAIN / THE ACCEPTED ADR / P06 / WORKFLOWS.

### §20A FOLLOW-UP (slice 26 close-out, part 2) — composed tree, the three capture defects NAMED and repaired, the closed-direction review, and ONE bounded attribution per previously-red poor seed

REFS RECONCILED FIRST (an earlier narrative contradicted itself about pushes). Measured from the
repository and the remote, in this order: PR #7's branch (codex/udg-spike-001-dpa2-impairment)
stands at cd992779d6bfa2564e264c5ddd4146a3be223159 on origin; b5e68eb, 2b56acc and 7d46bff were
LOCAL-ONLY (dpa8t's "nothing was pushed" is the true side; any push claim was wrong). The protected
STAGED attribution blob 07e7e2db52ee17250f40a17aa1fdbe48f0503459 (tests/e2e/netcode.spec.ts over
b5e68eb, the slice-25 captures) was verified untouched in its original dirty worktree before and
after this work; that worktree was never edited.
COMPOSITION (reviewer instruction, honored exactly): a NEW clean branch/worktree at 7d46bff; the
staged index diff (git diff --cached over its base) applied with `git apply -3`. The two conflicts
were PURELY ADDITIVE (RunResult field list; the res literal) and resolved by keeping BOTH the
slice-26 timeline fields and the slice-25 captures. Composition + repairs commit
10c2f55691f5e11bf0031257a13bf01a20933cc6; both e2e dispatches below recorded commit=10c2f55…,
dirty=false — exact clean-HEAD diagnostics.
THE THREE dpa8x-NAMED DEFECTS — ROOT CAUSES NAMED FROM THE SOURCES, NOT RETRIED:
(1) eqeqeq (`rr.call(…) != null`): explicit !== null / !== undefined. (2) roomView NULL in every
run: the capture reached the room's PRIVATE `#seats` map through a cast (RegionRoom.ts:172 defines
`#seats`; `roomG.seats.keys()` is undefined, the whole literal threw, the catch swallowed it). It
now reads ONLY published surface — the public readonly joinRefusals/closeObservations arrays
(RegionRoom.ts:178/180) and evidence().seats per-seat {entityId, epoch, resolvedThrough}, which
also delivers the SERVER-SIDE ack watermark the attribution needed. A capture failure now names
itself in notes, and a loss-run hard expectation makes silently-null roomView RED. (3) controlJoin
`ok:false, error:""` in every run: the leg passed `presentation: {}`, which the room's OWN hash
gate screenJoin refuses BY DESIGN (onJoin → joinRefusals push + 1008 close), and the pinned SDK
surfaces that refusal as an Error whose message is EMPTY — the leg attributed nothing. The
legitimate seats all pass fixture.presentation {protocolVersion, configHash, manifestHash}
(joinGaSeat); the control now passes the SAME and exercises the ADMITTED path. EXPECTED (asserted,
with the room's own refusal delta `newJoinRefusals` in the message): ok, measured msToRoomId,
issued epoch, first OWN row with rowEpoch === issuedEpoch (same-epoch guard — foreign rows count as
staleEpochRowsRejected, never accepted), IMMEDIATE PREFIRE CHECK (row tested before the first
sleep — both seeds measured msToFirstOwnRow = 0) and IMMEDIATE EXPIRY CHECK (deadline tested
before sleeping). Nothing was manufactured: every read is published socket/room/SDK surface;
dpa8m's 772 ms matched control is the expectation basis.
CLOSED-DIRECTION REVIEW AFTER b5e68eb (reviewer item): a new unit case exercises the NONEMPTY
reverse response for a closed direction — client FINs while its request is still in the tube, the
hop propagates the FIN after draining, the target answers with a NONEMPTY body: measured Node
semantics (probed directly BEFORE writing the case) show an accepted socket with the default
allowHalfOpen:false is DESTROYED the moment its peer FINs, so the hop CANNOT hand such bytes to a
half-closed client; the honest, asserted outcome is received-at-hop, counted LOST AT DESTINATION
exactly once, attributed firstFin 'client' with NO error, pair RETIRES — and the test times out if
anything hangs (the dpa8o failure mode). NO REGRESSION found. Consumers re-reviewed: the only
tracked closed-stats equalities (netcode.spec.ts:3064/3235) stayed green on this tree
(counter-consumer cell, 1 passed, exit 0, 24.2 s); run-spike/proxy-host consume the new fields
additively.
ONE BOUNDED LOCAL ATTRIBUTION PER PREVIOUSLY-RED POOR SEED (existing approved F-batch setup;
`UDG_ACK_FLOOR=1`, W = 400 ms PROTOTYPE wait — product default UNCHANGED count-only; new isolated
knob UDG_ACK_SEED selects ONLY this env-gated cell's impairment RNG seed, default 1001 unchanged,
no CI route; CI=1, bounded overlay config navigation 60 s / action 30 s; private loopback ports;
ONE dispatch each, FIRST attempt green both seeds, so no repeat was permitted or made):
• poor-1001 (dpa8y, also the clean-HEAD diagnostic): F4 fired — 2 floor-held events, then
  `input-ack-stalled at PROTOTYPE stalled-ack floor`, input age 462.9 ms, pending 1; ledger:
  stop-sending → discard-pending 1 → quarantine → rejoin-scheduled 250 → rejoin-attempt +252 ms →
  rejoin-COMPLETE +1051 ms (epoch 5) → snapshot-recovered +1052 ms; ONE monotonic page-observed
  timeline fire→tracking 1063.5 ms (budget 4 300, lateStart false, stale rows 0); ROOM view
  (public seam, measured): joinRefusals [], closeObservationCount 1, mover resolvedThrough 232
  while the client sent 233 — the server's own record of the ONE terminally withheld input;
  suspension null; sendsAfterFinal 0, pendingAtEnd 0, droppedFrames 1; control join ok
  (msToRoomId 598.6, epoch 5, own row 0 ms, same-epoch, newJoinRefusals []). F1/F2/F3 no-fire.
• poor-1002 (dpa8z, UDG_ACK_SEED=1002): identical shape — fire at age 469 ms; rejoin-attempt
  +252 ms → rejoin-complete +1119 ms → recovered epoch 5; fire→tracking 1147.4 ms (within budget,
  stale 0, pendingAfter 0, recovered true); resolvedThrough 232 vs 233; joinRefusals []; control
  join ok (641.3 ms, epoch 5, row 0 ms); probe n 30 p50 198.9–210.7 ms p95 ≤ 237.4 aborted null.
  F1/F2/F3 no-fire.
FOUR-CLASS DISTINCTION, BOTH SEEDS, FROM THESE BYTES: ACTUAL NO PROGRESS — ABSENT on this tree:
the rejoin attempt SETTLES every time (+252→+1051/+1119 ms); dpa8m's never-settled attempt is now
attributable to the keep-alive-FIN fixture fault repaired at b5e68eb (the client's NEXT request
was written into a socket whose peer was gone — no response, no failure). NORMAL TRANSIT EXCEEDING
THE TIMER — the healthy case does NOT fire (three no-fire phases; acks arrive inside the window
while transit is normal); the only fire is the TERMINALLY WITHHELD input outliving the declared
wait, which is the rule firing CORRECTLY. EARLY FIXTURE DISPOSAL — absent: recovery lands well
before teardown, probe ran to completion (aborted null), pending 0. UNCERTAINTY — none for the
recovery interval (page-observed single-clock timeline with named provenance). LIMITS (stated, not
hidden): n = 1 per seed — shape attribution, not a population; the 400 ms wait is the labelled
PROTOTYPE harness setting, the adopted product rule remains count-only; hosted poor-1001/1002
reds STAND AT THEIR OWN BYTES (44791166883, 44771876137) — this is forward attribution on the
repaired fixture, no rehash; GA-11's §19 EXACT OPEN NEED (nominated production-like deployment)
is unchanged and still decides every provisional value; Gate A remains NOT-PASS overall and NOT
RUN for acceptance.
LOCAL CHECKS ON THE TESTED HEAD 10c2f55691f5e11bf0031257a13bf01a20933cc6 (receipts retained in
dpa8y/verification/): tsc root AND e2e exit 0; eslint (whole repo) exit 0; tests/unit/udg-spike-001
198/198 (the 197 + the new closed-direction case); tests/unit 661 passed / 3 skipped; contract
UDG-SPIKE-001 green; fixtures green; boundaries green.
RETAINED DIGESTS (bundles at artifacts/.local/spike-001/, NOT tracked, sha256-manifested; no raw
secrets — session ids are ephemeral harness handles): dpa8y artefact
0822651e52b096e7253f550d55ac0297cffba7e969e2fdf2cf2e3d82c4b4a9aa, run log
f5e8397ecc4642de1a882a57a8b5574e800f5b1f0d4ba48e7b92982075abbf38, counter-consumer log
f14b036d1660dc0cd0bac438f20e2b912c1a1b43af3c52bb8de7303516112416; dpa8z artefact
8d1f8fd140e3023ea7587376e0610cec0f0d22cb3cf849d7e7269ef6d2565c22, run log
e2652c7ce6670a11d2d3a04fe65cfd7aed9ac364c79e27559c82219bd35d2985; composed spec file
d91287acbc684392d0016a46c27d90f7347e130d0494152428f6b051e20524af; composed unit file
1ec970267974c1336ac729fe09d526e67a95e319554034284c11f7e3dd58d3e9.
PUSH (reviewer-authorized, minimal): FAST-FORWARD of PR #7's existing branch only — cd99277 →
b5e68eb → 2b56acc → 7d46bff → 10c2f55 → this docs commit; no force, no merge, no workflow change,
no hosted grid dispatched; the routine CI on the exact pushed head is verified and reported
separately from this file. NOTHING HERE ADOPTS the wait-first wording, changes a default,
threshold, profile or status, closes a GA row, or touches main / the accepted ADR / P06 /
workflows.

### §20A FOLLOW-UP 2 (slice 26, reviewer correction) — the hop's half-close rule FIXED (the earlier follow-up pinned the WRONG behavior), the W-diagnostic vs DEFAULT-baseline distinction, and the per-seed default-path results AS MEASURED

CORRECTION, NAMED NOT ERASED (§17 precedent). The FOLLOW-UP 1 closed-direction paragraph and its
unit case measured and PINNED A FIXTURE DEFECT, not the primitive's contract: the published
primitive is a TRANSPARENT TCP hop, an orderly FIN of the client's WRITE side is a HALF-CLOSE of
that direction only, and a peer may legitimately keep reading. The code connected the UPSTREAM
with allowHalfOpen:true but accepted the DOWNSTREAM with createServer((client)=>…) — Node's
default auto-END + destroy on peer FIN — so the hop silently tore down a reverse leg that still
worked, and "reverse bytes after a client FIN counted lost at destination" was that defect
mislabelled as honest semantics. FIX (commit 467acffefb72075b1f820530bbf41d7d73e4bbb8, code change
test-harness-only): the accepted side is created with allowHalfOpen:true, symmetric with the
upstream; every direction still FINs its destination only after its own queue drains; retirement
stays bounded on every path (both-directions drain → finish; reset → loud abort; proxy.close()
drain grace unchanged). TESTS, re-derived not rebased: a half-open-capable client writes the
request and socket.end(); the TARGET receives the request BYTES and the EOF (the b5e68eb
propagation rule, retained as the initial stale-pool regression in the same file); the target
sends a delayed MULTI-CHUNK response; the client receives the EXACT bytes then EOF; accounting
asserts both chunks DELIVERED, nothing lost, no error, firstFin 'client', buffered 0, pair
RETIRES. The LOSS guarantee is kept as a GENUINE abort: a client RESET (RST, no FIN) makes the
queued reverse byte counted LOST exactly once with an ERRORED (loud) closure — the previous
case's plain destroy() with no unread data was an orderly FIN in disguise, i.e. the half-close
class, and is covered by the delivery case instead. 15/15 ws-delay-proxy, 198/198 spike-001,
full unit 661 passed / 3 SKIPPED — ACCOUNTED: the three skips are the UDG-003 PHASE-3
BYTES-PRESENT gates (tests/unit/udg-003/task-capture-refusals.test.ts, itBytes = existsSync of
phase-3/vectors-manifest.json): Phase-3 vector bytes are not staged in this local checkout; they
are existence skips, unrelated to this change and never counted as passes. The paired-browser
closed-stats counter-consumer cell re-ran green on the fixed hop (26.9 s, exit 0).
WHAT FOLLOW-UP 1'S PER-SEED RUNS ACTUALLY WERE (distinction the reviewer required): dpa8y/dpa8z
exercised the LOCAL W DIAGNOSTIC — the harness env-gated F-batch with the PROTOTYPE W = 400 ms
test wait AND one INTENTIONALLY injected terminal loss (the F4 leg's design). They prove the
rejoin MACHINERY settles under the composed tree and the captures measure; they DO NOT attribute
the DEFAULT poor path, which fires no W and injects no loss. The FORWARD-path attribution in
FOLLOW-UP 1 (dpa8m's never-settled attempt = the keep-alive-FIN fixture fault repaired at
b5e68eb) stands: that fault was the UPSTREAM-FIN direction, unaffected by this fix, and the F4
legs demonstrate the settled attempt. The FOUR-CLASS verdicts in FOLLOW-UP 1 apply to the W
diagnostic ONLY.
DEFAULT BASELINE (reviewer instruction): ONE bounded local reproduction of the ORIGINAL
full-window mover baseline per previously-red poor seed, on the APPROVED dispatcher
(pnpm test:spike -- --id UDG-SPIKE-001 --cell full-window --profile poor --seed N), the REAL
harness topology and inputs, the DEFAULT count-only rule (no opt-in W — GA_STALL_FLOOR_MS null
when unset), NO injected loss, NO rejoin hook (joinImpSeat wires none by construction — FIXTURE
CONFIGURATION, unchanged), first attempts retained, ZERO retries. Instrumentation inspected
BEFORE running: the mover ledger already captured page sends (sent), authoritative prefix/ack
return, lastAccepted receipts, connectionError and the recoveryLedger events VERBATIM; the
artifact did NOT capture the FIRST observed receipt or any ack AGE, so the ledger probe gained
two TEST-ONLY read-only fields (firstDelivery = delivery-ledger first row {atMs, authorityTick,
epoch}; oldestOutstandingAgeMs = page-clock age of the oldest UNACKED input via
PendingInput.sentAtMs, the same clock the predictor stamps) — no product surface touched.
RESULTS AS MEASURED (HEAD 467acff…, worktree clean, first dispatch each):
• poor-1001 (dpa9a): 1 PASSED, exit 0, 2.9 m. ZERO ledger events — NO episode on the default
  path. firstDelivery atMs 1097.6 authorityTick 6 epoch 1 (stable across all 634 samples); ack
  and prefix returned to 2560/2560 by window end; ack AGE captured in 633/634 samples, max
  371 ms — healthy poor-hop transit routinely EXCEEDS the 400 ms-adjacent count-window order,
  the §19 structural finding visible on the DEFAULT baseline; last sample tracking, single
  epoch, connectionError null throughout.
• poor-1002 (dpa9b): 1 FAILED, exit 1, 2.6 m — KEPT RED, first attempt, NOT retried, NOT
  re-hashed. The hosted-class stop REPRODUCED ON THE DEFAULT PATH locally: ledger VERBATIM,
  +252.4 ms of pump clock (WARMUP) trigger `input-ack-stalled at 4` with ack 0 / prefix 0 and
  sent 4 (4 inputs OUTSTANDING) while STATE deliveries flowed healthily (firstDelivery atMs
  1154 authorityTick 7 epoch 1; deliveries 9 → 12, authorityTick 23 → 29 at ~47 ms spacing,
  connectionError null) → stop-sending → discard-pending 4 → domain 1 quarantined → `suspended:
  host provides no rejoin route` (the fixture's declared configuration) → send-refused → window
  truncated (measureMs 15) → the cell published itself INVALID (no-achieved-samples, probe
  aborted socket-closed) rather than being re-hashed. Consistent with §18A's cold-start
  coin-flip (hosted: 1001 red once/green once, 1002 red twice, 1003 green twice — timing
  variance, not seed semantics) and §19's arithmetic (the count-only streak at poor RTT
  completes while the FIRST ack is still in normal transit). MISSING EVIDENCE, SAID PLAINLY:
  oldestOutstandingAgeMs is null in ALL 590 samples — the stop and discard-pending land between
  the 250 ms ledger ticks, so the run captured NO numeric ack age at the stop (the trigger row
  plus sent 4 / ack 0 is the only age evidence); and the full-window artefact does NOT capture
  a ROOM-SIDE observation AFTER the stop, so whether those 4 in-transit inputs were ultimately
  resolved server-side is UNCERTAIN from these bytes — NOT claimed either way. Whether the same
  coordinate would have red on 7d46bff is NOT asserted (not run there; a reroll is exactly what
  the retention rule forbids).
HISTORICAL HOSTED RESULTS STAND UNCHANGED: poor-1001 and poor-1002 remain RED AT run
44791166883 (and the first-run poor-1002 at 44771876137) at their own bytes; the three published
layers are now DISTINGUISHED: (1) LOCAL W DIAGNOSTIC (dpa8y/dpa8z: W=400 + injected terminal
loss, rejoin machinery settles, captures measure); (2) DEFAULT BASELINE LOCAL (dpa9a green /
dpa9b red — the default rule's cold-start coin-flip reproduced forward, no hosted rehash);
(3) HISTORICAL HOSTED (reds stand, cited as such). FORWARD/REVERSE/FIXTURE attribution
corrected: FORWARD (dpa8o/dpa8m keep-alive-FIN hang) — repaired at b5e68eb, unchanged here;
REVERSE (half-close) — FOLLOW-UP 1's "lost at destination is the honest outcome" was the
ACCEPTED-SIDE DEFECT mislabelled; the hop now preserves reverse traffic across an orderly
half-close (467acff), and only GENUINE resets lose; FIXTURE (no-rejoin stop) — unchanged and
still FIXTURE CONFIGURATION: dpa9b's stop staying stopped is the fixture's declared posture, not
a product rejoin failure, and NOTHING here ratifies any threshold: every value involved remains
PROVISIONAL UNDER GA-11, the wait-first wording remains a PROPOSAL DRAFT for ADR review, Gate A
remains NOT-PASS overall and NOT RUN for acceptance, no hosted matrix dispatched, main/ADR/P06/
workflows untouched.
LOCAL CHECKS ON 467acff…: tsc root+e2e exit 0; eslint exit 0; ws-delay-proxy 15/15; spike-001
198/198; tests/unit 661 passed / 3 accounted skips; counter-consumer cell green (26.9 s);
dpa9a dispatch exit 0; dpa9b dispatch exit 1 (RETAINED — the red is evidence, not a task
failure). RETAINED DIGESTS (bundles local-only, sha256-manifested, no secrets): dpa9a artefact
under cell-full-window-poor-1001/spike-cell.json, dpa9b artefact under
cell-full-window-poor-1002/spike-cell.json (exact digests in each bundle's SHA256MANIFEST.txt).

FOLLOW-UP 3 (dpa9c/dpa9e family — the dpa9b evidence gap CLOSED under a PRE-REGISTERED fixed-N
plan; `UDG-SPIKE-001-gate-a-local-poor-seed-fixed-n-plan.md`, protocol committed at 69a9b59
BEFORE any dispatch). §20A FOLLOW-UP 2 limitation 4 (age-at-trigger unseen; room-side receipts
uncaptured) is closed by READ-ONLY watchers: a 25 ms page trigger-age watch (the trigger event is
AGED against its own cause — the oldest UNACKED input's send stamp from the retained sent audit,
same page clock; explicit triggered:false record when nothing fires) and a 200 ms node-side room
watch (the room's OWN evidence().seats resolvedThrough/epoch plus tick-record CONSUMED seq for the
seat's authority entityId = sessionId.slice(0, 64) — identity, never proxy byte-counter
inference). FIXED-N POPULATION (N=3 per seed, first attempts only, all retained): poor-1001
GREEN 3/3 (explicit non-events; client ack 2520/2521/2526 EQUALS room resolvedThrough/consumed
seq to the last input); poor-1002 RED 3/3 — every attempt stopped at `input-ack-stalled at 4`
with oldest unacked = SEQ 1 aged 213.5/209.7/201.6 ms at the trigger, client prefix frozen at
epoch 1 : tick 29 : ack 0 BEFORE the stop and identical at the end (suspended, no rejoin wired),
while the ROOM consumed seq 1/2/3 at ticks 30/32/33 and resolved through 3 AFTER the third frozen
delivery: at every local trigger the aged inputs were LATE WITHIN THE PROFILE'S OWN DELAY
ENVELOPE, NOT LOST; the 4th discarded entry's wire fate is unreachable and stated so. The
stop-line class matches dpa9b and hosted dpa8r; hosted rows are NOT re-hashed. LOCAL FLOOR-AWARE
CONTROLS (opt-in UDG_GA_FLOOR + harness-supplied UDG_GA_FLOOR_MS=400, labelled PROTOTYPE, product
default unchanged, unset = tracked cell shape): gafloor-truth fired ONLY after the wait and was
aged against the suppressed input's OWN stamp (441.1 ms > 400 ms), 8 stall-floor-held events
preceded, nothing re-issued, discard followed the trigger, settle bounded (green on the corrected
check after Fix B named in place at 0ae1741); the GA-5b malformed-stamp trio re-ran with the
floor armed and the wait added NO episode. NAMED HARNESS CORRECTIONS (all bytes retained, nothing
re-hashed): Fix A — watcher reads placed after pageM.close() killed dpa9c-trigger-1001-a1..a3 in
teardown (dpa9c-trigger-1001-defect/README.md; population continues as dpa9c2/dpa9d2 under the
same pre-registration); Fix B — gafloor settles conjunct read GaSnapshot.transportEpoch (never
moves on rejoin) instead of the recovered domain epoch. LOCAL GA-5l TIMING ROWS ARE PROVEN
ENVIRONMENT-CLASS: the suppression quiet-window and benign-release rows went red locally on the
CURRENT code AND on a named control running the PRE-INSTRUMENTATION 7af95d4 spec file in this
container (dpa9e-facility/README.md) — the pinned CI stays the green authority for that cell.
DIRECTION, NOT ADOPTION: 3/3 local stops fired against inputs still in flight within the
profile's declared envelope, and the floor legs show a wait-aged rule fires exactly when the age
says lost and never strands — this is direction-evidence for the ADR §D wait-first wording
(reviewers own that decision) and NOTHING here adopts a numeric, changes a default/threshold/
status, dispatches a hosted grid, or moves Gate A (still NOT-PASS overall, NOT RUN for
acceptance; GA-11 §19 stays the sole nomination authority). Local checks on 5efaddf: tsc 0,
eslint 0, six full-window dispatches + five ga-scenarios runs all retained with READMEs and
per-bundle digests (bundles local-only, no secrets).
