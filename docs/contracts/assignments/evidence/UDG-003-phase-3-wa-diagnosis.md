# UDG-003 Phase 3 — W-A diagnosis: W-7 and P-2b, kept separate

> Work item **W-A** of [`UDG-003-phase-3.md`](UDG-003-phase-3.md) §5, under the owner ruling at §1 (D-P3-3:
> the remedy lives inside UDG-003's own suite; keep-rerunning and CI reordering are rejected) and the
> repeatability rule at §6.5 (D-P3-9). This record covers **W-7** and **P-2b** as two defects, never as one
> "flaky file". It is written before any harness change and it records the decision not to make one.

Baseline under diagnosis: `eafe306578b64be37e6fd93a8b9f301ab3e43cf6` (CI `43965274365`, success).
Records head at the start of the work: `66963eb2b08d3f9cd501342db7f7784864e61f1a`, which is also
`origin/main`; there was no diff to report before starting.

---

## 1. What the retained evidence actually establishes

| Attempt | Host | What is claimed | What is retained | Identity of the failing assertion |
| --- | --- | --- | --- | --- |
| `43770588357` attempt 1, `43775706274` (and the seven-run family recorded in UDG-004 §W-7) | GitHub runner | `runtime.test.ts > W-7: …` red with `expected 1 to be 0` | quoted in [`UDG-004-completion.md`](UDG-004-completion.md) | **quote only** — no bundle of that run carries the impairment artefact of the failing attempt |
| the P-2b container-local red | Linux container | `expected 'seat reservation expired.' to match /token/i` | quoted in the same record and in the Phase 3 draft | **quote only** |
| `43956003339`, `43962098658`, `44054653793`, `44056946395`, `44059160018` | GitHub runner, docs-only heads | job red before acceptance | **no** `ci-run-*` directory for `43956003339`; the others hold bundles of other tasks | **unclassified, and stays unclassified** — the retained bytes do not contain a junit or an artefact from the failing attempt, and the runner log is not readable without the owner's credentials |

Nothing in `/workspace/udg-evidence` contains the string `expected 1 to be 0` or `seat reservation expired`
in a junit or an impairment artefact from a failing attempt. So the two symptom identities come from prose
written by the task that observed them, and they are treated here as *reported symptoms*, not as evidence.

## 2. The instrument, so an identity becomes possible

`tests/system/udg-003-phase-3/wa-assertion-audit.ts` re-evaluates **84 assertions** — the two cases'
assertions, one at a time, against an impairment artefact — instead of stopping at the first failure the way
the accepted `it()` does. It is the thing that can answer "which counter moved on which attempt" from the
artefact alone.

An audit that has only ever been seen passing is not a control, so
`tests/system/udg-003-phase-3/wa-audit-falsification.test.ts` (in the suite, so it runs in CI) mutates a
copy of the accepted artefact once per defect and requires the audit to name the defect it guards:

* a W-7 counter `0 → 1` must be named as `w7-deliveries-in-window`, defect `W-7`;
* a P-2b refusal re-worded to `Seat reservation expired.` must be named as `p2b-first-refusal-matches-token`,
  defect `P-2b`;
* moving a deadline on the P-2b envelope must be named on the P-2b side, and moving the episode timing must
  be named on the W-7 side — the two cases read the same deadline from two places and a mutation of one must
  not be credited to the other;
* the unmutated accepted artefact must audit `84/84`.

The audit is exercised on real bytes before it is trusted: `84/84` on the accepted artefact and on every
retained saturated-profile artefact below. An example report, from a red probe run whose W-7/P-2b groups
still passed, is retained at
[`UDG-003-phase-3-wa-audit-example-saturated.json`](UDG-003-phase-3-wa-audit-example-saturated.json).

## 3. W-7 — what could produce a `1`, and what could not

The case reads `artifacts/udg-003-phase-2/transport-impairment.json`, written by
`tests/runtime/udg-003-phase-2/impairment-population.ts`. Reading the producer against the harness:

* `snapshotAbsence.deliveriesReachingTheSeatDuringTheEpisode` is
  `epCountersAfter.inboundDelivered - epDeliveriesAtSilence` (producer line 929). The baseline is sampled at
  line 819 and `silenceInbound()` is armed at line 825 with **no `await` between them**, so no inbound
  message can be processed in between on a single-threaded loop; and in the harness
  (`tests/support/client-harness/impairment.mjs`, `deliver()` at line 137) a swallowed publication increments
  `inboundSilentlyDropped` and **returns before touching `inboundDelivered`**. A queued delayed delivery that
  fires after arming takes the same swallow path. **This counter has no reachable path to `1` in the code as
  written.** UDG-004's record attributed the recorded `expected 1 to be 0` to a counter "such as" this one;
  the code does not support that attribution, and this record does not repeat it.
* The counters in the same case that *are* exposed to wall-clock ordering are the post-close ones, all of
  which the case pins to `0`: `epAttemptsAfterClose` (sampled 400 ms after the close, producer line 841),
  `epTransportSendsAfterClose`, `epFramesAfter === epFramesAtSilence` and
  `epRefusalsAfter === epRefusalsAtSilence` (sampled 1 200 ms after the close, lines 856-857), plus
  `epSnapshotDeadlineElapsedMs <= snapshotDeadlineMs + 150` inside `epControls`. A ladder rung that came due
  just before the close, or a room-side refusal journalled on the tick *after* the sample, is exactly the
  shape `expected 1 to be 0`.
* Conclusion, stated as a limit rather than as a cause: **the recorded W-7 message is consistent with a
  post-close timer straddle and inconsistent with the explanation it was given.** That is not a demonstrated
  cause — the straddle was never observed — so no assertion is changed on the strength of it.

## 4. P-2b — two refusals of the same rejoin, and the assertion pins one of them

The case pins the refusal wording: `expect(first.message).toMatch(/token/i)` style, against what
`ga6Ga7.reconnectFailures` recorded from `client.reconnect()`. In the pinned stack both texts come from the
server, both are `ErrorCode.MATCHMAKE_EXPIRED`, and they are **different branches of one rejoin**:

* `@colyseus/core@0.18.27``build/MatchMaker.mjs:151` — `reconnection token invalid or expired.`, thrown when
  `checkReconnectionToken(token)` returns no session, i.e. the token entry is already gone at matchmaking
  time;
* `@colyseus/core@0.18.27``build/Transport.mjs:130` (`connectClientToRoom`) — `seat reservation expired.`,
  thrown **after** matchmaking succeeded, when `room.hasReservedSeat(sessionId, reconnectionToken)`
  (`build/Room.mjs:449`) no longer honours the seat. For a reconnection reservation that check is
  `this._reconnections[reconnectionToken]?.[0] === sessionId`, so the seat is only honoured while the
  reconnection entry still maps to it.

`client.reconnect()` performs the matchmaking step and then the connect step, with a socket round trip
between them. The two steps read the same map at two instants, so on a contended runner the attempt can land
on either branch — and the case asserts only one of the two texts. That is a precise mechanism, and it is
exactly the ordering race UDG-004's record described in prose.

**It is still not a demonstrated cause.** It is a demonstrated *possibility* from pinned bytes, with one
quoted observation, and neither the harness nor the assertion is edited on that basis: accepting the second
text would weaken an accepted assertion to fit a hypothesis, and the pair of texts is precisely what a
reviewer needs to stay able to tell apart.

## 5. Reproduction attempts, including the ones that produced nothing

Two profiles were run against the producer, with every artefact retained
([repro-1](UDG-003-phase-3-wa-repro-1-saturated.json),
[repro-2](UDG-003-phase-3-wa-repro-2-two-core.json)):

| Profile | Iterations | Probe verdict | W-7 / P-2b audit | What went wrong |
| --- | --- | --- | --- | --- |
| 18 busy-spinners (one per core), full contention | 10 | `fail` in **10/10** | **84/84 in 10/10** | `controls.imposedDelayIsTheDifferenceBetweenTheSeats` false 10/10, `controls.noFrameArrivedWithoutAnAssociationEpoch` false 10/10, `controls.everySeatReportsBothMeasures` false 1/10 |
| `taskset -c 0,1` with two spinners | 8 | `pass` in 8/8 | 84/84 | nothing |

The saturated profile is recorded as **defect WA-3** and is explicitly *not* the declared streak load: it
invalidates the probe's own environment controls, so a green inside it would mean nothing. Note what it
does *not* do — under the heaviest contention this machine can produce, the two named assertion groups never
moved, while the population case in the same file did (next section). Contention in this suite reddens the
neighbour, which is a reason to distrust any "it was obviously W-7" reading of a red in this file.

## 6. Defect WA-4, found while looking: the pressure premise is assumed, not measured

Retained at [`UDG-003-phase-3-wa-abuse-pressure-premise.json`](UDG-003-phase-3-wa-abuse-pressure-premise.json).
Under contention, the accepted population scenario `pressure-throttles-and-never-closes` fails in this
container: the sender slipped to 20.64 frames/s against a designed 23.81/s over a 20/s drain, so peak depth
reached 7 and never crossed the pressure line of 8 — while `construction.insideBand` still reported `true`,
because it is computed from the *designed* rates. It is the same family as the W-7 symptom class (a fixture
whose wall-clock premise is assumed rather than re-read from measured bytes) and it is disclosed rather
than fixed: it belongs to the accepted Phase 2 probe and the W-10/W-9 case, not to W-A's two defects, and its
assertion is accepted evidence.

## 7. Decision

**No probe, harness, fixture or assertion was changed by W-A.** Not one deadline (500 ms snapshot,
4 000 ms episode), not one retry allowance, not one close code, not one accepted assertion. The reason is
the ruling that governs this work item: a cause must be demonstrated before the harness is touched, and
neither cause was demonstrated — one has no reachable path in the code, the other is a possibility with one
unretained observation.

What W-A delivers instead is the thing that makes the next red diagnosable rather than debatable:

1. the 84-check per-assertion audit, plus the falsification suite that proves it can fail;
2. a declared load and test order, committed before the streak
   ([`UDG-003-phase-3-wa-declaration.json`](UDG-003-phase-3-wa-declaration.json), `declaredAtCommit`
   recorded by commit timestamp and checked by the vectors, not by prose);
3. the declared repeatability streak, ten iterations of the full `pnpm test` order under four spinners,
   scored per case id out of each iteration's own junit (§8);
4. and through W-C, the whole-task capture: from this work item's landing commit onward, every CI run
   retains the impairment artefact **inside a bundle whose manifest covers it**, which is the gap that made
   five hosted reds unclassifiable.

## 8. Repeatability streak under the declared load

Ten iterations of the declared order (`pnpm test`, the two cases in place) under the declared load (four busy
spinner processes), on `142b08097a4210378e68a8420409a5aaedf468ac`, Node `v24.22.3` on
18 logical CPUs, started `2026-11-17T21:19:45.242Z` and finished
`2026-11-17T21:38:38.217Z`. The declaration's commit timestamp
(`2026-11-17T20:57:17+00:00`)
is not later than that start, and the vectors assert the comparison rather than restating it.

**Result: `W-7` 10/10 consecutive passes and `P-2b` 10/10
consecutive passes, scored per case id out of each iteration's own junit, with the per-assertion audit clean
(84/84) in all ten.**

| iteration | suite exit | seconds | W-7 | P-2b | audit (per-assertion) | probe verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | 113.7 | passed | passed | 84/84 | pass |
| 2 | 1 | 113.3 | passed | passed | 84/84 | pass |
| 3 | 1 | 113.9 | passed | passed | 84/84 | pass |
| 4 | 1 | 113.6 | passed | passed | 84/84 | pass |
| 5 | 1 | 114.3 | passed | passed | 84/84 | pass |
| 6 | 1 | 113.7 | passed | passed | 84/84 | pass |
| 7 | 1 | 114 | passed | passed | 84/84 | pass |
| 8 | 1 | 107.7 | passed | passed | 84/84 | pass |
| 9 | 1 | 114.7 | passed | passed | 84/84 | pass |
| 10 | 1 | 114 | passed | passed | 84/84 | pass |

**The suite was not green, and this record does not pretend it was.** Every one of the ten iterations
exited non-zero. The red set was the same seven cases throughout, with a count beside each one because two of
them did not move in every iteration:

| red case (all 10 iterations, same set) | iterations in which it was red |
| --- | --- |
| `tests/contracts/UDG-001.test.ts :: pins Node 24.22.2 and pnpm 12.18.0 exactly, and runs on them` | 10 |
| `tests/contracts/UDG-001.test.ts :: verifies the register on a foreign host while still refusing real drift (CI regression)` | 10 |
| `tests/contracts/UDG-002.test.ts :: keeps the UDG-001 suite green and the committed records in sync` | 10 |
| `tests/contracts/UDG-002.test.ts :: records the pinned toolchain and schema dependency the plan thresholds name` | 10 |
| `tests/contracts/UDG-004.test.ts :: gates the browser results for identity, freshness, cases, screenshots and console errors` | 10 |
| `tests/system/udg-003-phase-2/runtime.test.ts :: runs the adversarial population and reads back a passing verdict (W-10, W-9)` | 9 |
| `tests/unit/udg-003-phase-2/vectors.test.ts :: refuses a half-run and writes the manifest over all 27 artefacts` | 9 |

Five of those reds are this container, not the repository: they are red in **10 of 10** — the Node pin
(`24.22.2` declared, `24.22.3` here), the pnpm/toolchain assertions that read it, the register check that
assumes a CI host, and UDG-004's browser-result gate with no Chromium here. The other two are red in **9 of
10** and are **produced by the declared load itself** —
`pressure-throttles-and-never-closes` in the population probe (defect WA-4 above: the sender slips to about
20.6 frames/s against a designed 23.8/s over a 20/s drain, so the pressure line is never crossed while
`insideBand` still reports `true` from the designed numbers), and the Phase 2 vectors assertion that follows
that verdict. Nine of ten, not ten of ten: the population's own premise slips under the load, which is itself
the defect. They are named here rather than smoothed for two reasons: they are what the accepted suite
actually does under this load, and they show why scoring by case id was necessary. A streak scored on the
suite's exit code would have recorded **zero** consecutive passes for both defects while both defects passed
every single time — and the mirror image, a red scored on the exit code, would have been blamed on `W-7`.

That last point is the transferable one. Under this load the two cases in `runtime.test.ts` that go red are
`runs the adversarial population … (W-10, W-9)` and nothing named `W-7`; contention in this file reddens the
neighbour. It is a further reason not to read any past red in this file as self-identifying, which is the
condition the audit at §2 exists to end.
