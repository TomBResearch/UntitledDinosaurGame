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
| `44191978254` | GitHub runner, records-only head `6061145b` | job red, in the capture step | **the run's own evidence artifact, downloaded and read**: `UDG-004-2026-11-17T23-06-08-302Z-6061145b/junit.xml`, extracted verbatim into [`UDG-003-phase-3-hosted-sighting-run-44191978254.json`](UDG-003-phase-3-hosted-sighting-run-44191978254.json) | **classified — `W-7` fired**, message `expected 1 to be +0`, and §9 names the two further reds, which were not defects of the product at all |

Nothing in `/workspace/udg-evidence` contained the string `expected 1 to be 0` in a junit from a failing
attempt at the time §§1-8 were written, so the two symptom identities came from prose and were treated as
*reported symptoms*. **That sentence is superseded for `W-7` by §9**: run `44191978254` produced exactly that
red, in bytes, fifteen minutes after the streak finished. `P-2b` remains a reported symptom with no retained
observation.

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
* **Forward reference, §9:** a `W-7` red has now been observed in a hosted run. It does not settle this
  section. The observed junit records the case and the message `expected 1 to be +0`, which vitest takes from
  the *first* failing assertion in the case; it does not record which of the case's zero-comparisons moved,
  and the artefact that the failing case read was not retained (§10). So the straddle is now *seen to be
  possible* in the sense that the case does go red on a hosted runner, and still *unnamed* in the sense this
  section asks for.

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

## 9. The sighting: `W-7` fired in hosted run `44191978254`, and the answer to "why another suite" is five

Run `44191978254` was the **records-only** push that reported the run before it. No source, test, tool, plan
or workflow file differed from the green head `f3d30626`. It went red, in the capture step.

The red is now classified from bytes rather than from prose, because the run's own evidence artifact
(`udg-evidence`, 4 156 191 bytes, artifact id `14379816039`) was downloaded and read. The failing bundle is
`UDG-004-2026-11-17T23-06-08-302Z-6061145b`, whose `test` command exited 1 with three failing cases out of 644:

| Case | Message, verbatim from the bundle junit | What it actually was |
| --- | --- | --- |
| `runtime.test.ts > … P-batch … > W-7: the 4000 ms episode deadline expires with no fresh snapshot, and the three limits stay distinct` | `expected 1 to be +0 // Object.is equality` | **the accepted `W-7` defect, live** — the first hosted sighting with retained bytes |
| `wa-audit-falsification.test.ts > reports the unmutated artefact clean …` | `the accepted artefact must audit clean: expected 1 to be +0` | **defect WA-5, this author's own** (§10) — not a product defect |
| `task-vectors.test.ts > proves the audit is falsifiable, per defect, from bytes this run produced` | `the accepted artefact audits clean: expected 1 to be +0` | **the same WA-5**, second copy |

The four other bundles of that run — `UDG-001`, `UDG-002`, `UDG-003` and `UDG-003-TASK` — each ran the same
644 cases with **zero** failures.

### 9.1 Why a docs-only push goes red "inside another task's suite"

**The whole suite runs five times in one job**, once inside each capture plan (`UDG-001`, `UDG-002`,
`UDG-003`, `UDG-003-TASK`, `UDG-004`), because each bundle must record its own `test` command and its own
junit. `W-7` is therefore executed five times per job, in five different processes, at five different points
in a 25-minute step, each execution re-producing its own impairment artefact. In this job the first four
executions passed and the fifth — `UDG-004`'s — did not.

So "it fails in another task's suite" is not a cross-task interaction. It is the same case, re-run, landing
on the invocation where the timing went the wrong way. Two consequences worth stating plainly:

* a red inside `UDG-004`'s bundle is **not** evidence about `UDG-004`, and any triage that reads the owning
  task from the bundle name will be wrong every time;
* five invocations per job multiply the chance of a rare timing outcome by five, which is why the failure
  rate of a *docs-only* push is the right measure of the defect's frequency and not of the push's content.

### 9.2 What the sighting does and does not prove

It proves the symptom, on the pinned toolchain, on a hosted runner, in retained bytes. It does not name the
counter: vitest reports the first failing assertion (`expected 1 to be +0`), and among the accepted case's
zero-comparisons the retained junit cannot distinguish them — the 84-check audit exists precisely to make
that distinction, and it was **unable** to, for the reason in §10.2.

It also does not mean the repeatability streak was wrong. §8 recorded ten consecutive passes under a declared
load on a declared order, and those ten iterations did pass. Fifteen minutes later the same case failed on an
unloaded runner in a job whose only content was documents. **A streak is a statement about iterations, not a
repair**: `W-7` is unresolved, nothing in this work item fixed it, and no assertion was changed to make it
appear otherwise.

## 10. Defect WA-5: this work item amplified the red it was sent to diagnose

### 10.1 What it was

Two Phase 3 files of this author's own required `artifacts/udg-003-phase-2/transport-impairment.json` to
audit **clean** — `wa-audit-falsification.test.ts` ("the accepted artefact must audit clean") and
`task-vectors.test.ts` ("the accepted artefact audits clean"). That file is rewritten *during* the run by the
accepted Phase 2 runtime case, which is the case `W-7` fails in. So whenever `W-7` fires, both controls
necessarily fail too, and one defect is reported as three failures in three files — two of which carry
Phase 3's name and read like capture bugs. Run `44191978254` is the observation: exactly that happened, and
the two extra reds are the second and third rows of the table in §9.

The assignment forbids making the red more likely. Amplifying one red into three does not make the defect
clearer; it makes the triage worse, and it put a false suspicion on W-C in exactly the run where W-C's own
bundle was clean.

### 10.2 The fix, and the limit that survives it

* Both controls now stand on a **pinned artefact whose bytes cannot move**:
  `tests/support/udg-003/wa-audit-clean-artefact.json`, taken from
  `UDG-003-2026-11-17T22-02-59-469Z-f3d30626/vectors-phase-2/transport-impairment.json` in the green run
  `44183269571`, digest `d9e1dce3cec976f9bb5ae1dca2271e0d8a87ecd6c75b1bb990a9e83ebc26f647`, asserted in both
  files so the base cannot drift silently. Mutations are applied to copies of that base.
* The **live** artefact is still audited — by `task-vectors.test.ts`, which writes the result into
  `wa-audit-falsification.json` as `liveArtefactAudit` — but as a **measurement**, so a real `W-7` produces
  one accepted-case red plus a vector that names which check moved, instead of three reds.
* `tests/system/udg-003-phase-3/wa-no-amplification.test.ts` is the failing control for WA-5 itself. It builds
  a synthetic artefact carrying exactly the `W-7` condition and requires: the audit **must** refuse it, naming
  `w7-deliveries-in-window` (so the suppression is suppression of something real), and the falsification
  suite **must** still pass against it, in a child vitest process. Both directions are asserted; a regression
  that reintroduces the dependency fails there rather than in a hosted capture.
* The same reasoning removed three *outcome* assertions from `task-vectors.test.ts`
  (`closures.length >= 2`, `no closure outside the offender pair`, `no reconnections`), which re-asserted the
  accepted population case's verdict over a live artefact and would have relocated a `W-10`-class red into a
  vector file. The values are still written into `task-abuse-summary.json`; what is asserted is the
  derivation, not the outcome.
* The producing tests no longer register skipped tests when inputs are absent; they take the accepted
  Phase 2 vectors pattern and assert the negative instead. `EVIDENCE-SKIP-PRESENT` no longer appears in a
  whole-task capture.

**The limit that survives the fix**, and the reviewer needs it: the bundle still does not retain the artefact
the accepted case *read*. The capture's Phase 2 step re-runs the producer
(`node tests/runtime/udg-003-phase-2/impairment-population.ts`) and gates the bytes that production yields;
the `test` command's case reads the file its own producer wrote a few seconds earlier, under
`artifacts/udg-003-phase-2/`, which no bundle covers. So a future hosted `W-7` red will come with a retained
artefact that may well audit clean, because it is a different production.

The remedy is small and is **proposed, not applied**, because it changes what the accepted case does inside a
capture and that is the reviewer's call like the other two:

* **W-A-3.** In the whole-task plan only, set `UDG_VECTORS_OUT: 'BUNDLE/vectors-phase-2-case'` on the `test`
  command. The accepted runtime case and its producer already honour `UDG_VECTORS_OUT`, so the case would
  write, read and be judged by bytes that the bundle then hash-covers — and the next red would be named by
  the 84-check audit instead of argued about. The accepted `UDG-003` phase plan stays untouched.

## 11. What W-A concludes, in one paragraph

`W-7` is real, hosted, reproducible-in-the-wild and **unresolved**: it fired in a job whose only content was
documents, in the fifth of five invocations, with the recorded message, and no assertion was changed to
silence it. Its mechanism remains analysed and unnamed — the counter that can be reached has no path to `1`,
the counters that could straddle are pinned to zero, and the sighting does not distinguish them. `P-2b`
remains a single container-local quote with a documented two-branch mechanism and no second observation. The
instrument, the declaration, the streak, the sighting, this defect and its fix are all retained, and the
three open remedies (accept the second refusal text, pin the post-close samples, or point the case's output
into the bundle) are decisions for the reviewer rather than bets made in the dark at midnight.

## 12. A second hosted red, sixteen minutes later, that is neither `W-7` nor `P-2b`

Run `44206639883` pushed **records only** on top of a head whose own run had been green. It failed in the
capture step, and it failed for a reason that had not been seen before:

```
failing commands: phase-2-stage-sequence (exit 2)
```

— a command of the **accepted** `UDG-003` phase plan, in the **third** of the five capture plans, so the job
never reached the whole-task plan and its artifact holds three bundles rather than five. All 644 cases of each
of those three bundles passed; `W-7` and `P-2b` both passed in this run. The bytes the command left behind,
retained verbatim in
[`UDG-003-phase-3-stage-sequence-red-run-44206639883.json`](UDG-003-phase-3-stage-sequence-red-run-44206639883.json),
are the whole diagnosis:

```
Room connection was closed unexpectedly (1008):
[stages][fail] mappingMatchesTheAuthoritysOwnRecord=false
[stages][fail] patch median 100.30500199999983 ms, declared 100 ms, step 50 ms; mid-window
  {"clientAtOpen":6,"serverAtOpen":6,"clientAtMid":6,"serverAtMid":11,"openAtMs":908.288077,"midAtMs":1213.055884}
```

The rate was inside tolerance — a 100.305 ms median against 100 ms declared with a 50 ms step is not the
problem. What moved is the **sequence comparison**: at the mid-window sample the authority had published 11
patches and the client had received 6, and the harness separately journalled an unexpected close (1008). A
client that stops receiving patches because its room closed cannot match an authority record taken at a fixed
wall-clock instant, which is the same family of failure as `W-7` — a sample taken at a moment that the runtime
is free to move — in a different accepted producer, on a different assertion.

**No cause is demonstrated beyond that observation, so nothing was changed.** What this record establishes is
narrower and worth having: the docs-only red family is **not one defect**. It contains at least `W-7` (§9),
this stage-sequence straddle (§12) and, in the container, the two-branch `P-2b` wording (§4) — three
mechanisms on three different assertions that have been discussed as if they were one flaky suite because the
only thing each run reported was "the capture step is red". Reading the bundle's own `logs/` and `junit.xml`
named all three in minutes, which is the argument for the whole-task capture, stated better by a failure than
by a design note.

## 13. The next records-only red named the mechanism: input reached the room after the episode closed

Run `44211208860` — documents only, on a head whose own run had been green — died in the same place as the
last one, the accepted `UDG-003` phase plan, third of five, before the whole-task plan could run. Once again
**every test case in every bundle passed** (647 of 647 in each of the three bundles the job produced). The red
was a producer refusing its own verdict:

```
[impairment][fail] noInputReachedTheRoomAfterTheEpisodeClosed=false
[impairment] fail: baseline intake p99 44.69 ms, imposed intake p50 83.62 ms, client-observed p50 baseline
  126.64 / imposed 188.94 ms, withheld 4 (never consumed: true, …
```

Read it against §3. The impairment producer carries its own containment field, and it is the containment half
that failed: **input reached the room after the recovery episode had closed**. The latency envelope was
comfortable — impaired median 83.62 ms against a baseline p99 of 44.69 ms, client-observed 188.94 ms against
126.64 ms — so nothing about the *rate* was wrong. The same production logged the matchmaking-side refusal text
three times (`reconnection token invalid or expired`), which is the branch the accepted `P-2b` assertion
expects rather than the seat-reservation one, so it says nothing against §4.

Two consecutive documents-only runs, two accepted producers, two different post-close samples
(`mappingMatchesTheAuthoritysOwnRecord`, then `noInputReachedTheRoomAfterTheEpisodeClosed`), and no test
failure in either. That is the strongest evidence in this record for the shape §3 proposed — a timer or an
in-flight message straddling a close — and it is still not a demonstration of *which* line moves in the
accepted `W-7` case, because the case and the producer are different readers of the same production and the
producer's failure means the artefact this run needed was never written. Nothing was changed for it.

**The operational consequence for the reviewer**, stated plainly because it will otherwise look like a hole in
W-C: the five capture plans run in one step, in plan order, and the whole-task plan is fourth. A producer gate
in an earlier plan kills the step, so on those runs the `UDG-003-TASK` bundle does not exist. If the reviewer
wants the whole-task bundle to exist even when an accepted producer is red, the fix is ordering or
`--keep-going` semantics in the CI loop — a workflow decision, named here rather than taken.

## 14. Two sightings, two assertions, one window (run 44215794779)

The second hosted `W-7` sighting names a different line of the same case:

| run | junit line | assertion | what counted non-zero |
| --- | --- | --- | --- |
| `44191978254` | `runtime.test.ts:702:71` | `deliveriesReachingTheSeatDuringTheEpisode` | a transport delivery reached the seat during the silent window |
| `44215794779` | `runtime.test.ts:704:66` | `stateApplicationsDuringTheEpisode` | the client applied state during the silent window |

Both counters are zero-or-more tallies taken over the same interval: `epAppliedAtSilence` is captured before
`silenceInbound()` and `epCountersAfter` after close plus the waits, so `stateApplicationsDuringTheEpisode` is
`ep.applied.length - epAppliedAtSilence` and `ep.applied` grows in the SDK's `onStateChange` callback, which
fires after a `ROOM_STATE` baseline or a `ROOM_STATE_PATCH` application. Two observations, then, from bytes:

- the window is not "quiet and stays quiet" — it is quiet and then something arrives, and *which* tally notices
  depends on which frame the arrival is;
- §12's `mappingMatchesTheAuthoritysOwnRecord=false` (authority 11 patches, client 6, sampled 305 ms after the
  window opened) and §13's `noInputReachedTheRoomAfterTheEpisodeClosed=false` are the same shape seen from the
  server side and the containment side. Four independent observations, one family.

What is still not known, and what the audit still cannot say without the artefact: which frame arrived, and
whether it was in flight before `silenceInbound()` or created after it. That is a mechanism, not a counter, and
`W-A-3` exists so that the next sighting carries the 84 audited values around the moved counter rather than
leaving the argument at the counter.

## 15. The capture loop was losing the evidence, and that was a defect of ours

`44215794779` retained two bundles out of five. Not a verification complaint: the capture step's inline loop ran
under `set -euo pipefail` — as UDG-001 requires, with `continue-on-error` forbidden — so the first failing plan
ended the step. **WA-6**, fixed in this branch by `tools/ci/capture-plans.sh`: every plan attempted, every
bundle retained, the step still exits non-zero if any plan failed.

This is the second amplification defect this phase introduced and then removed (`WA-5` made one `W-7` red into
three red test files; `WA-6` made one `W-7` red into four missing bundles). The lesson is recorded where it
belongs: a control added next to an accepted artefact must not be able to change what other tasks' evidence
looks like when the accepted artefact goes red.

## 16. What the pinned dependency rules out, and the one thing the artefact cannot say

The two sightings are asymmetric, and the asymmetry is the most informative number in this whole diagnosis.
JUnit reports the *first* failing assertion, so `704` red at `44215794779` means `702` passed on the same
artefact milliseconds earlier:

```
snapshotAbsence.deliveriesReachingTheSeatDuringTheEpisode  === 0     ← line 702 passed
snapshotAbsence.stateApplicationsDuringTheEpisode          === 1     ← line 704 failed
```

An application with no recorded delivery. That combination is either a measurement artefact or the wrapper did
not see the frame, and settling it needs facts about the pinned stack rather than hypotheses, so here they are,
read from the installed packages (`@colyseus/sdk@0.18.9` under `@colyseus/core@0.18.27`, the pinned pair):

| Fact | Where | Consequence |
| --- | --- | --- |
| `onStateChange` has exactly two invoke sites, `ROOM_STATE` and `ROOM_STATE_PATCH`, both inside frame dispatch and both **synchronous** with `setState`/`patch` | `sdk/build/Room.mjs:597`, `:612` (grep for `onStateChange.invoke` returns nothing else) | a state application cannot be observed without a frame having been dispatched first; there is no deferred/queued callback path, and no third source |
| the room's `onmessage` handler is assigned once, in `Room.connect` | `sdk/build/Room.mjs:127` | the wrapper installed after connect is not silently replaced mid-episode by the join path |
| the only other client-side `onmessage` assignment is `Client.getLatency`'s **own** `new Connection(protocol)` | `sdk/build/Client.mjs:204`, `:178` | an RTT probe cannot detach the room's wrapper — candidate mechanism, eliminated |
| the third site is the opt-in debug monkey-patch | `sdk/build/debug.mjs:181-182` | not enabled here |
| frames arriving after `leave()` are dropped by the SDK before dispatch | `sdk/build/Room.mjs:486-492` (`if (this.leaveCode !== undefined) return;`) | the window after `await ep.room.leave(true)` (`impairment-population.ts:869`) cannot grow `applied` |
| the impairment wrapper silences **every** inbound frame while `state.silencing` is true, and resumes only on an explicit `resumeInbound()`; `restore()` runs only on teardown | `impairment.mjs:142-148`, `:208-214`, `:262-266` | nothing in the accepted `ep` path lifts the silence, so a post-silence delivery to the SDK requires the wrapper not to have seen the frame |

So the shape is narrowed to: a frame reached the SDK's dispatch **without being counted by the wrapper**, in
the interval between the two samples. Which is where the second, blunter finding comes from, and it stands on
its own regardless of what the next sighting says:

**the accepted producer does not read the two numbers as one snapshot.** `epCountersAfter` is taken at
`impairment-population.ts:858`; `snapshotAbsence.stateApplicationsDuringTheEpisode` is
`ep.applied.length - epAppliedAtSilence` evaluated at `:931`, seventy-three lines and one
`await ep.room.leave(true)` later. `deliveriesReachingTheSeatDuringTheEpisode` (`:929`) uses the *earlier*
sample, `stateApplicationsDuringTheEpisode` uses a *later* one. Two tallies of one interval, sampled at two
instants and then compared to zero as though they were simultaneous.

And **the artefact cannot say whether the silence was still in force at the end.** `controller.counters()`
reports `silencing`, `inboundDelivered` and `patchArrivalsMs` — none of the three reaches
`ga6Ga7.ga6cEpisodeDeadline`: the episode block records `publicationsSwallowedAtTheWrapper` and the two deltas
and nothing else. So a red on `704` is, from the bytes alone, exactly as consistent with "the wrapper stopped
observing this socket" as with "one publication arrived", and the accepted audit — which checks `w7-deliveries-in-window`
and `w7-state-applications` among 84 checks — has nothing more to look at.

Proposed, **not applied** (each changes what an accepted producer records, or when it records it):

1. read `inboundDelivered`, `inboundSilentlyDropped`, `silencing` and `applied.length` in **one** synchronous
   sample, immediately before the close, and write all four;
2. write the wrapper's `patchArrivalsMs` for the episode window, so "a publication arrived" becomes a timestamp
   rather than an inference from a delta;
3. keep `W-A-3`'s retained `vectors-phase-2-case` bytes as the object of the audit, so the next sighting is
   scored against all 84 checks instead of against one counter and a junit line.

None of these is a change to an assertion, a deadline, an allowance, a close code or a probe, and none was made
here: `702` and `704` still both require zero, and the cause of the `W-7` sightings is still **not demonstrated**.

## 17. A retained artefact with the 704 signature, and the cause it demonstrates

Searching the evidence store for the signature rather than waiting for another sighting found one. Twelve
retained artefacts carry a `ga6Ga7.ga6cEpisodeDeadline` block; eleven have `deliveries = 0, applications = 0`;
one does not:

```
/workspace/udg-evidence/ci-run-43591597910/UDG-003-2026-11-14T11-57-52-546Z-81a341fb
  /vectors-phase-2/transport-impairment.json

  freshAuthoritativeSnapshotArrived        false
  deliveriesReachingTheSeatDuringTheEpisode 0
  publicationsSwallowedAtTheWrapper        60
  stateApplicationsDuringTheEpisode         1     ← the 704 signature
  resolvedThroughAtSilence / AtClose        1 / 1
  epochAtSilence / AtClose                 11 / 11
```

and the W-A audit over exactly those bytes: **83/84 checks pass; the only failing check is
`w7-state-applications`**. Nothing else moved — not the timings, not the ladder, not the containment controls,
all six `controls` entries `true`. Base rate, all twelve artefacts: 11 clean, 1 with the signature.

That artefact also carries its own contradiction, and it is the whole finding:

- `freshAuthoritativeSnapshotArrived` is `false`. It is computed at `impairment-population.ts:861-863` from
  `epCountersAfter.inboundDelivered`, **`ep.applied.length`** and the row watermark — so at line 862
  `applied.length` still equalled `epAppliedAtSilence`.
- `stateApplicationsDuringTheEpisode` is `1`. It is `ep.applied.length - epAppliedAtSilence` evaluated at
  `:931`, in the object literal, **seventy-three lines and one `await` later**.

Between those two reads sit exactly these statements (`:866-869`):

```ts
const epSocketClosedByClient = epCountersAfter.socketClosedDuring;
ep.stopClock();
ep.controller.restore();                       // ← the impairment wrapper comes OFF the socket
await ep.room.leave(true).catch(() => undefined);  // ← the seat asks to leave and keeps receiving
```

and the pinned stack says what those two lines allow:

| Fact | Where | Consequence |
| --- | --- | --- |
| `leave(consented = true)` does **not** set `leaveCode`; it sets `leaving`, sends the leave request, and waits for the server. `leaveCode` is set only by `finish()`, which runs when the close lands | `sdk/build/Room.mjs:200-215`, `:236-239` | frames are still dispatched to this Room while `await leave(true)` is in flight |
| the dispatch guard is `if (this.leaveCode !== undefined) return;` | `sdk/build/Room.mjs:488` | during the leave await the guard is **open**, so a patch arriving then reaches `serializer.patch()` and `onStateChange.invoke()` (`:611-612`) |
| the wrapper's `restore()` puts the original handler back and is called **before** `leave()` | `impairment.mjs:262-266`, producer `:868` | any frame the seat receives after that point is applied by the SDK and is **not counted at all** by `inboundDelivered` |
| the queued-inbound path, once `state.restored` is true, hands the held frame to `connection.events.onmessage` directly, bypassing `deliver()` and therefore bypassing both the silencing check and the delivery counter | `impairment.mjs:169-176` | a second route to the same signature: applied tally ticks, delivery counter never moves |
| the seat's own row did not move (`resolvedThrough` 1 → 1, `epoch` 11 → 11) while `applied` ticked | the retained artefact above | the state change was not information *about this seat*: `applied.push` runs on **any** schema change, `impairment-population.ts:596-614` |

**Cause, for the `stateApplicationsDuringTheEpisode` family:** the tally is not a measurement of the episode.
Its "before" reading is taken at `:820`, before `silenceInbound()`, and its "after" reading is taken at `:931`,
*after the wrapper has been restored and while the seat's own `leave()` is in flight*. A patch that arrives in
that tail — about anything, from anyone — is counted as an application "during the episode", while the delivery
counter that would have recorded it is frozen at `:858` and detached at `:868`. The assertion
`stateApplicationsDuringTheEpisode === 0` is therefore not asserting that the window was silent; it is
asserting that the server sent nothing at all to a leaving seat for the few milliseconds it takes the leave to
land. That is a race the test does not control, and it is why the case is red once in a dozen invocations and
green otherwise.

What the same reasoning does **not** cover, stated plainly: the `deliveriesReachingTheSeatDuringTheEpisode`
sighting (`44191978254`, line `702:71`). Line numbering is identical at both heads (`git show 6061145b:…` and
`git show 498d6a9e:…` both put deliveries at 702 and applications at 704, and the reported columns — 71 and 66
— match the two property accesses), so the two sightings really are two fields. A non-zero delivery count
requires the wrapper to have *delivered* a frame while `state.silencing` was true, and `deliver()` re-checks
`silencing` at delivery time (`impairment.mjs:142`), with the queue path re-checking it too unless the wrapper
has already been restored (`:169-176`). No path in the accepted code produces that. That sighting stays
**unclassified**, and collapsing the two into one defect would be exactly the mistake this phase has been
correcting.

## 18. What the evidence now warrants, kept as a proposal

The reviewer's standing instruction was to leave sample boundaries alone "until evidence shows which change is
warranted". For this one boundary, it now does. Recorded as a proposal with the patch spelled out, **not
applied**, because it changes what an accepted producer records:

1. **Take the after-sample once, where the window ends.** At `:858` read the tally into the same synchronous
   sample as the counters — `const epAppliedAtSample = ep.applied.length;` — and derive
   `stateApplicationsDuringTheEpisode` from it instead of from `ep.applied.length` at `:931`. The metric then
   measures the interval its name describes; the accepted assertion `toBe(0)` is unchanged, as are the
   deadlines, the allowance, the close codes and the probe. Expected effect: the `stateApplications…` family of
   hosted reds stops; nothing else about the client's behaviour is claimed differently.
2. **Order the teardown so it cannot fabricate a delivery.** Move `ep.controller.restore()` after
   `await ep.room.leave(true)`, so the wrapper stays on the socket for the whole of the seat's life and any
   frame the seat really does receive is counted rather than silently applied.
3. **Record the tail rather than infer it.** Write `applied.length`, `inboundDelivered`,
   `inboundSilentlyDropped` and `silencing` at both instants — at the `:858` sample and at artefact assembly —
   so "the tally moved in the teardown tail" becomes a reading in the bundle instead of an argument from line
   numbers. With W-A-3's retained `vectors-phase-2-case` bytes this is the difference between a sighting that
   diagnoses itself and one that has to be reconstructed.

Items 1 and 2 are behaviour-visible in the accepted producer's output, so they are the reviewer's call. Item 3
is additive. Nothing in this file has been applied to `impairment-population.ts`, `impairment.mjs`,
`runtime.test.ts`, the policy or the server: `W-7`'s cause is demonstrated for one of its two signatures, and
both `W-7` sightings remain **open** until the fix lands and the declared repeatability streak is re-run on
top of it.

## 19. The repair landed, and the four defects are still four

Reviewer-directed, harness and instrumentation only, on the cause §17 demonstrated: `ga6cEpisodeDeadline` now
takes one snapshot (`epEpisodeEnd`) at the policy-defined episode end — the client's own close under the
4000 ms episode deadline — in the same synchronous region as the counter sample, before
`ep.controller.restore()` and before the seat is asked to leave, and every episode field the accepted case reads
is derived from it. The teardown's readings are retained beside it as `cleanup`, where the case cannot reach
them. The harness gained one counter field, `restored`, because `silencing` cannot date a reading: the layer
keeps reporting the silence after it has been taken off the socket. Implementation, controls and the rerun
streak: [`UDG-003-phase-3-wa-repair.md`](UDG-003-phase-3-wa-repair.md).

What that changes in this diagnosis, and what it does not:

| defect | status after the repair | why |
| --- | --- | --- |
| `W-7`, `stateApplicationsDuringTheEpisode` signature | **cause demonstrated, measurement repaired, case still open** | the reading is now taken inside the window it names; the retained contradictory artefact and the pinned `leave()`/`leaveCode` behaviour stand independently of any rerun |
| `W-7`, `deliveriesReachingTheSeatDuringTheEpisode` signature (`44191978254`) | **unclassified, untouched** | a non-zero delivery count requires the wrapper to deliver while `silencing` is set (`impairment.mjs:142` re-checks at delivery time); no accepted path does that, and this repair does not go near the wrapper's delivery logic |
| `mappingMatchesTheAuthoritysOwnRecord` (`44206639883`) | **separate, unclassified** | a different producer's mid-window sample (`phase-2-stage-sequence`); the repair changes no sample in that file |
| `noInputReachedTheRoomAfterTheEpisodeClosed` (`44211208860`) | **separate, unclassified** | a containment reading about frames reaching the *room* after close; the repair only changes when the *client's* tallies are read, and the post-close observations it used to provide are retained as `cleanup` |
| `P-2b` two refusal wordings | **separate, untouched** | two server-side branches of one rejoin (`MatchMaker.mjs:151`, `Transport.mjs:130` via `Room.mjs:449`); matching is unchanged by direction |

A green streak is not a cause. The ten passes say the repaired measurement is stable under the declared load and
order and that nothing else about the case moved; the cause rests on the bytes in §17 and on the pinned
dependency's behaviour, which were established before any rerun and would not be undone by one.
