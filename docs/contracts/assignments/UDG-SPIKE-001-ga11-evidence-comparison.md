# UDG-SPIKE-001 · GA-11 — durable evidence comparison: the two verified remote-path sessions vs the Virgin sessions, and both GA-11 inequalities (slice 30r7)

Status: DIAGNOSTIC comparison of retained evidence. Not Gate A. No verdict, no threshold adoption,
no production justification — this document EVALUATES the two named GA-11 inequalities on the
recorded populations and states plainly what the evidence does and does not establish.
Sanitisation: no credential, no ISP/provider/path name (the provider association is
user-confirmed and stays unpublished), no raw room/session identifiers, no endpoint value —
only sha256 digests, run ids, commit shas and measured numbers. Reproduce every number with
`python3` + the bundle JSONs named below; nothing here asks the reader to trust a re-derivation.

## 1 · The evidence under comparison (all bundles byte-stable, checksum-verified, untouched)

| run id | head | path class | sessions eligible | measurement grade (recomputed AT REST by `tools/load-test/src/ga11-grade.ts`, digests-only) | notes |
| --- | --- | --- | --- | --- | --- |
| `ga11-ee-capture-1795436410228` | `0a8a7c1` | verified remote production-shaped path (HTTPS, real RTT, no impairment seam), provider user-confirmed (unnamed) | 2 / 3 | **PARTIAL** (16/16 diagnostic checks GREEN — the split the grade exists to express) | S3 lost its record to the `page.evaluate` cross-context closure bug (fixed + compiler-guarded since; the attempt itself is retained UNTOUCHED — the at-rest grade is a new reading, never a retroactive relabel) |
| `ga11-first-path-20261123-a4` | `5e1bef2` | the "Virgin" sessions, same nominated endpoint (endpoint digest `b69e7076…` — identical across both runs) | 3 / 3 | **COMPLETE** (11 checks recorded, 1 legacy RED carried in `checks`) | S3 ran a real recovery-churn episode (2 rejoins to epochs 3 and 4, 41 send refusals, worst patch gap 1303.89 ms); `deployedBuildSha` NOT recorded (a named gap of that era; the EE run records `92ce2e6…` for the same endpoint) |
| `ga11-FF-facsimile5-*` (this head) | `0a8a7c1`+ | loopback facsimile THROUGH the real wrapper | 3 / 3 | **COMPLETE**, `MEASUREMENT-GRADE.json` in-bundle and checksum-covered | harness-regression witness only — loopback, never a path population |

The EE attempt's failure mode and its replacements (atomic progress-before-cleanup, forced
teardown proof, deterministic nonempty-recovery proof, the grade split) are documented in
`UDG-SPIKE-001-ga11-staging-handoff.md` and the runbook; this file is only about what the two
verified remote paths MEASURE.

## 2 · Measured populations (every eligible session; ms; fixed N = 120 probes per session, probe loss 0 everywhere)

| session | RTT p50 | RTT p95 | RTT p99 | patch p50 | patch p95 | patch max (worst arrival gap) | epoch audit | refusals | rejoins |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| EE S1 | 65 | 99 | 184 | 100.2 | 118.79 | 282.5 | CLEAN | 0 | 0 |
| EE S2 | 75 | 104 | 112 | 100.2 | 119.8 | 364 | CLEAN | 0 | 0 |
| EE S3 | — | — | — | — | — | — | — | — | — (no record; closure bug; PARTIAL) |
| Virgin S1 | 21 | 29 | 44 | 100.2 | 103.29 | 110.7 | (pre-audit head) | 0 | 0 |
| Virgin S2 | 21 | 32 | 36 | 100.1 | 102.6 | 159.2 | (pre-audit head) | 0 | 0 |
| Virgin S3 | 21 | 31 | 38 | 100.2 | 105.19 | **1303.89** | (pre-audit head) | 41 | 2 |

Envelope (provisional, from `artifacts/udg-003-phase-2/envelope-hashes.json`, unchanged by this
document): B = `bufferPressureMargin` 8, J = `jitterAllowanceFrames` 2, λ = `inputRatePerTick` 1,
`bufferMaxSize` 32, `clientSnapshotDeadlineMs` 500, patch interval 100 ms, tick 50 ms.

## 3 · Inequality 2 — `clientSnapshotDeadlineMs ≥ 4 × patch interval + 2 × measured p99 RTT`

rhs = 400 + 2·p99; the provisional deadline is 500 ms (an admissible p99 is therefore ≤ 50 ms):

| session | rhs | ≤ 500? | margin |
| --- | --- | --- | --- |
| EE S1 | 768 | **FAIL** | −268 |
| EE S2 | 624 | **FAIL** | −124 |
| Virgin S1 | 488 | PASS | +12 |
| Virgin S2 | 472 | PASS | +28 |
| Virgin S3 | 476 | PASS | +24 |

What this establishes: the provisional 500 ms deadline is unevaluated-no-longer — it FAILS on
both verified remote-path sessions at their measured p99s (184/112 ms), and only PASSES on the
Virgin sessions with margins of 12–28 ms, i.e. it survives there only because that path's RTT
tail happened to stay under ~44 ms. On the same endpoint digest, RTT p99 varied 36→184 ms
across verified captures: the deadline choice is path-sensitive, and no single capture
justifies it. This is exactly what GA-11's row demands be recorded — it is NOT yet a
production value beside a provisional one, because a two-sample remote-path population is
evidence-toward-production, not a production distribution (GA-11's own label rule).

## 4 · Inequality 1 — `B + J·λ + stall ≤ bufferMaxSize`

lhs = 8 + 2·1 + stall. The measured `stall` is the worst arrival gap (patch max). ONE unit
question must be named before any formal row: the expression's terms are in FRAMES (J is
"jitterAllowanceFrames") but the ADR never pins the frame basis for the stall term. The
input-accumulation-faithful reading counts unacknowledged inputs generated during the gap at
λ per TICK (50 ms — the conservative basis, since inputs accrue per tick while deliveries
stall); the patch-basis reading counts 100 ms patch frames. Both are shown; the unit choice is
an owner adjudication, NOT a judgement this document makes:

| session | stall (tick basis ⌈gap/50⌉) | lhs | ≤ 32? | stall (patch basis ⌈gap/100⌉) | lhs | ≤ 32? |
| --- | --- | --- | --- | --- | --- | --- |
| EE S1 | 6 | 16 | PASS | 3 | 13 | PASS |
| EE S2 | 8 | 18 | PASS | 4 | 14 | PASS |
| Virgin S1 | 3 | 13 | PASS | 2 | 12 | PASS |
| Virgin S2 | 4 | 14 | PASS | 2 | 12 | PASS |
| Virgin S3 | **27** | **37** | **FAIL** | 14 | 24 | PASS |

What this establishes: on every session WITHOUT a recovery-churn episode the inequality holds
with ≥ 14 frames of headroom under either basis. The single churn episode in the verified
evidence (Virgin S3: a 1303.89 ms delivery stall with §3.2 recovery, 2 rejoins, 41 refusals)
straddles the margin — it FAILS on the tick basis and passes on the patch basis. The buffer
headroom the inequality reserves (32 − B − J·λ = 22 frames) is therefore 8 frames deep against
a ~1.3 s stall on the tick basis: a real, ~2.6 s stall would breach it under BOTH bases. No
remote-path session has yet produced a churn episode in the verified evidence — the EE sessions
were CLEAN (worst gap 364 ms, zero §3.2 entries), so the stall term has never been measured on
the remote path where it actually matters.

## 5 · What the two verified paths jointly establish, and the exact gap

Established (diagnostic, remote path, endpoint digest `b69e7076…`):
1. Both inequalities are now EVALUATED on measured values — GA-11's "unevaluated" failure
   limb is discharged for these populations (the row's remaining limbs are not).
2. Inequality 2 is the binding one on the remote path: it fails for the EE path at 500 ms, and
   passes on the Virgin capture with margins thin enough (≤ 28 ms) that no capture, of either
   class, can be said to justify the provisional deadline.
3. Inequality 1 holds with wide margin for CLEAN sessions on both paths, and the one measured
   churn episode sits exactly on its sensitivity boundary (tick-basis fail / patch-basis pass).
4. The two paths share an endpoint digest and disagree on RTT by 4–5×: path variation, not
   endpoint choice, dominates inequality 2.

NOT established:
- any production value (two remote captures are evidence-toward-production under GA-11's own
  source-labelling rule);
- the stall term ON THE REMOTE PATH — no verified remote session has run a §3.2 episode, and
  the only stall population that stresses the buffer came from the Virgin capture's loopback-
  adjacent churn;
- the frame basis of the stall term (owner adjudication item, §4).

Is a further live-path capture STRICTLY NEEDED? For "the inequalities have been evaluated on
measured values": no — §3/§4 do that with retained, checksummed evidence. For a GA-11 row that
could actually justify production settings: YES, and precisely one shape of capture closes it —
the fixed-N fresh attempt (N = 3, wrapper-dispatched, `MEASUREMENT-GRADE.json` in-bundle) on a
verified remote path WITH the forced-recovery variant (`UDG_GA11_RECOVERY_EPISODE=<session
number>`: the mover context goes offline at 35% through that session's window for 2.5 s — the
episode seam is deterministic and proof-cell-pinned, phase D, in the pinned Chromium), so the
stall term is measured on the remote path beside the clean sessions. REHEARSAL NOTE (loopback,
this head, `ga11-FF-facsimile-episode-*`): the variant fires at exactly the 35% point and §3.2
arms every send (757 named refusals; window, harness and grade stay green and honest) — but the
rejoin did NOT complete within the rehearsal window THROUGH the loopback TLS hop (plain-loopback
witnesses complete in seconds: teardown-proof phase D, the recovery e2e cell). That is a named
property of the rehearsal hop, not of the adapter; the owner should rehearse the episode once
against the nominated path (or run one episode session inside a full attempt) before treating
the stall term as remote-measured. Broadening to more providers/paths is an owner-tuning
question, not a strict requirement of either inequality.

## 6 · Reading discipline (applies to every row above)

- The measurement GRADE (COMPLETE/PARTIAL/INCOMPLETE/NOT-RUN) is independent of the diagnostic
  checks and of exit codes: the EE attempt is 16/16-green AND PARTIAL, and both statements are
  true; the grade recomputed at rest NEVER relabels or mutates a historical bundle (the EE and
  a4 bundles are byte-identical to dispatch, re-verified before writing this document).
- Partial data is never labelled valid: interrupted collections are ineligible by construction,
  missing promised samples never count as arrivals, and the absence of a record is NOT a pass.
- No ISP/cause inference is made from any timing coincidence; the provider association is
  user-confirmed and unpublished; the EE network-layer cause remains unnamed by design.
