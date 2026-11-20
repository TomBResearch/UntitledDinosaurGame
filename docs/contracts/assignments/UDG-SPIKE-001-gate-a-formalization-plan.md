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
| **GA-3** confirmed retirement, prevention disabled | Missing leg — needs a room fixture variant with prevention disabled (the harness `defineOperatorRegionRoom({config: overrides})` seam already exists) | Config-variant cell; assert closure within `closureMaxMs`, residue > 0 bounded/named/attributed, reported even unacknowledged |
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
