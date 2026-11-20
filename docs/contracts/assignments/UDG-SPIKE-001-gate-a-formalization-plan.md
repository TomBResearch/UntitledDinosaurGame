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
| **GA-13** evidence integrity | Partially — journals are written per scenario and the replay substrate exists (`tests/support/replay/journal-replay.ts`) | Replay every formal scenario to identical dispositions/chain tip; sanitisation audit (no machine paths/tokens/credentials in any artefact); `stackCompatibility` asserted only where numeric gates actually pass |
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
