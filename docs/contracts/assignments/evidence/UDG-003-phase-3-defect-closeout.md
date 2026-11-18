# UDG-003 Phase 3 — closeout table: the four defects that remain open after the `W-7` measurement repair

Recorded 2026-11-18 against the reviewer's decision of the same date: the `W-7` episode measurement repair and
its controls are **accepted** at `74aa8dabbef7fcae5c455c24dfb326c2a57f6be2` (hosted CI [`44299429735`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44299429735), first attempt, green),
and Phase 3 stays **In Review**. The controlled capture-retention proof was accepted as sufficient for review;
no hosted failure is to be waited for or provoked in order to demonstrate it further.

**This record closes nothing.** It states, for each defect still open, the assertion that is actually asserted,
the bytes retained, the guarantee the defect could affect, and one recommendation per defect: a blocking repair
or a carry-forward with a named owner and a byte-named condition for reopening. Where a cause is unclassified it
stays unclassified; nothing here promotes a hypothesis into a cause.

## 0. Register — the four carry-forwards

Approved as **CF-1 … CF-4** on 2026-11-18, when the owner accepted Phase 3 (§7). Each stays visible wherever the
guarantee it touches is evaluated; the pointers below are the places a reader of that guarantee is sent to.

| id | observation, unclassified unless stated | guarantee it touches | owner | reopening condition, in bytes | visible at |
| --- | --- | --- | --- | --- | --- |
| **CF-1** | `deliveriesReachingTheSeatDuringTheEpisode` non-zero — **unclassified** | GA-6c's "no fresh snapshot reaching the seat"; the three-limit map | `TomBResearch` | retained `vectors-phase-2-case/transport-impairment.json` with the counter non-zero, or junit naming `runtime.test.ts:702` | [UDG-003.md](../../UDG-003.md), [Phase 2 evidence matrix](../UDG-003-phase-2-evidence-matrix.md) GA-6 rows, [UDG-SPIKE-001](../../UDG-SPIKE-001.md) Gate A evidence |
| **CF-2** | `mappingMatchesTheAuthoritysOwnRecord=false` in a capture reproduction — **unclassified** | AC-6's `M` half as amended (`P`′ half: UDG-007) | `TomBResearch`; `P`′ half **UDG-007** | junit naming `runtime.test.ts:760` or `:761` red (a **case** read refusing), or a retained artefact with the check false | [UDG-003.md](../../UDG-003.md), [UDG-007.md](../../UDG-007.md), matrix AC-6 rows |
| **CF-3** | `noInputReachedTheRoomAfterTheEpisodeClosed=false` — **unclassified** | containment, hence GA-6c/GA-7's "the seat stayed stopped" | `TomBResearch`; production machine **UDG-008**, Gate A **UDG-SPIKE-001** | junit naming `runtime.test.ts:685` red for that control, or a retained artefact with `controls.noInputReachedTheRoomAfterTheEpisodeClosed: false` | [UDG-003.md](../../UDG-003.md), [UDG-008.md](../../UDG-008.md), [UDG-SPIKE-001](../../UDG-SPIKE-001.md), matrix GA-6/GA-7 rows |
| **CF-4** | `'seat reservation expired.'` where `/token/i` is expected — **quote only**, never reproduced | GA-7's branch attribution and `matchmaking-rejoin` claim | `TomBResearch`; production machine **UDG-008**, Gate A **UDG-SPIKE-001** | retained junit where `runtime.test.ts:577` fails on a non-token message | [UDG-003.md](../../UDG-003.md), [UDG-008.md](../../UDG-008.md), [UDG-SPIKE-001](../../UDG-SPIKE-001.md), matrix GA-7 rows |

None of the four blocks Phase 3 or UDG-003 (see §5 and §7). None is a waiver: each names the byte that reopens it.

Reading key for "generation": a hosted job runs the full suite **five times** (once inside each capture plan) and
the capture then **re-produces** the Phase 2 artefacts, so an artefact file can be written by a case's own
invocation or by the capture's later reproduction of the same producer. Those are different events, and since
`W-A-3` the case's own bytes are retained separately in `vectors-phase-2-case/`
([`tools/checks/src/evidence.ts`](../../../../tools/checks/src/evidence.ts), `CASE_ARTEFACT_FILES`).

---

## CF-1 — `W-7`: the delivery count (`deliveriesReachingTheSeatDuringTheEpisode`)

| | |
| --- | --- |
| **Exact assertion** | [`tests/system/udg-003-phase-2/runtime.test.ts:702`](../../../../tests/system/udg-003-phase-2/runtime.test.ts) — `expect(ep.snapshotAbsence.deliveriesReachingTheSeatDuringTheEpisode).toBe(0);`, inside `UDG-003 Phase 2 runtime — the P-batch: impairment (OD-2) and the stage sequence (OD-4) > W-7: the 4000 ms episode deadline expires with no fresh snapshot, and the three limits stay distinct` (`:644`) |
| **Retained evidence** | [`UDG-003-phase-3-hosted-sighting-run-44191978254.json`](UDG-003-phase-3-hosted-sighting-run-44191978254.json) — junit bytes extracted verbatim from `UDG-004-2026-11-17T23-06-08-302Z-6061145b/junit.xml` of run `44191978254`, message `expected 1 to be +0`. Earlier sightings (`43770588357` attempt 1, `43775706274`, and the seven-run family in [UDG-004 §W-7](../UDG-004-completion.md)) are **quote only**. Scan: [`UDG-003-phase-3-w7-signature-scan.json`](UDG-003-phase-3-w7-signature-scan.json) — of the 12 retained artefacts carrying `ga6Ga7.ga6cEpisodeDeadline`, the `(deliveries, applications)` pairs are `(0,0)` × 11 and `(0,1)` × 1; **no retained artefact anywhere holds a non-zero delivery count** |
| **What the bytes establish** | That the assertion fires, in a capture invocation, on a documents-only head. They do **not** establish a mechanism: the scan contains no artefact from a failing attempt, so the watermark, epoch, `silencing` and wrapper counters at the moment of the counted delivery are unknown. The retained junit carries the message and counts, not the counters |
| **Classification** | **Unclassified, and stays unclassified.** The accepted repair does not touch this reading: the impairment wrapper still re-checks `silencing` at delivery time, and no accepted code path delivers while `silencing` is set (diagnosis §16) |
| **Guarantee it could affect** | **GA-6c**, specifically the premise of the case's own name — that the episode expired with **no fresh snapshot reaching the seat**. That premise is what keeps the three-limit map (`episode-deadline` / `allowance-exhausted` / `deadline`, preserve-list §6.5) discriminating: a delivery inside the window is exactly the event that would make an episode-deadline refusal indistinguishable from a stale-snapshot accident. Consequence for the assignment: on an attempt where it fires, the GA-6c vector cannot be produced, which is §7.3's FAIL territory, not "not run". Gate A's own GA-6c evidence stays **Not Run** (`UDG-SPIKE-001`), so nothing at Gate A is currently misstated by this defect |
| **Recommendation** | **Carry forward — not blocking.** Owner: `TomBResearch` (reviewer/owner) to decide whether Gate A's GA-6c evidence must be scored against this sighting; agent implementer acts only on that direction. **Reopen when** a retained artefact — specifically `vectors-phase-2-case/transport-impairment.json` under a case-artefact manifest — shows a non-zero `deliveriesReachingTheSeatDuringTheEpisode`, or junit names `runtime.test.ts:702`. Both detectors already exist (`w7-deliveries-in-window` in [`wa-assertion-audit.ts`](../../../../tests/system/udg-003-phase-3/wa-assertion-audit.ts), and `W-A-3` retention), so the next occurrence is classifiable from bytes without any further change. Only at that point, and justified by that retained fact as §6.4 requires, the minimal instrument to add is recording the wrapper's `silencing` and counter values **alongside each counted delivery** — harness-only, moving no deadline, allowance, close code or sample boundary |
| **Why not blocking now** | A fix requires a demonstrated cause (§6.1: "one fix, chosen by the demonstrated cause"; §5 W-A: "applied only to a demonstrated cause"). There is none, and the one change that would make the current evidence classify itself is retention, which `W-A-3` already provides |

## CF-2 — the authority-to-client mapping mismatch (`mappingMatchesTheAuthoritysOwnRecord`)

| | |
| --- | --- |
| **Exact assertion** | Producer check [`tests/runtime/udg-003-phase-2/stage-sequence.ts:497`](../../../../tests/runtime/udg-003-phase-2/stage-sequence.ts) `mappingMatchesTheAuthoritysOwnRecord: mappingMatchesAuthorityRecord`, inside `checks`, whose verdict is `Object.values(checks).every(v => v === true)` (`:656`) and which sets `process.exitCode = 2` when not pass (`:688`), naming the failing keys on stderr (`:675`). In the suite it is asserted by [`runtime.test.ts:760`](../../../../tests/system/udg-003-phase-2/runtime.test.ts) `expect(stages.verdict).toBe('pass')` and `:761` `expect(Object.values(stages.checks).every((value) => value === true)).toBe(true)`, inside `runs the stage sequence and keeps AC-6 qualified rather than overclaiming it (AC-6 under OD-4)` (`:741`) |
| **Retained evidence** | [`UDG-003-phase-3-stage-sequence-red-run-44206639883.json`](UDG-003-phase-3-stage-sequence-red-run-44206639883.json) — run `44206639883`, head `c9c4ed7320f3`, artifact `14385635505`, failing command `phase-2-stage-sequence` exit `2`, with the producer's own stderr retained verbatim: `mappingMatchesTheAuthoritysOwnRecord=false` and `patch median 100.30500199999983 ms, declared 100 ms, step 50 ms; mid-window {"clientAtOpen":6,"serverAtOpen":6,"clientAtMid":6,"serverAtMid":11,…}`. All test cases in every bundle produced by that run passed (`cases=647 failures=0`) |
| **What the bytes establish** | A **capture-reproduction** invocation of the accepted producer refused its own verdict; no test case failed. The mid-window sample shows the authority's record advancing (`serverAtMid` 6 → 11) while that client's replica sample stayed at 6 across a 304.8 ms window, i.e. the shape is a sample taken against a moving authority record — a *reading taken on either side of a settlement*, in the same family of boundary problems as the accepted `W-7` repair, but measured by a different producer and never observed failing in a case |
| **Classification** | **Unclassified.** No cause is demonstrated: the failing generation's `stage-sequence.json` bytes are not in the retained evidence store (`/workspace/udg-evidence` holds `ci-run-*` only up to `43937661401`), only the named stderr lines and the bundle summaries are |
| **Guarantee it could affect** | **AC-6**, and only the `M` half as amended — quoted in the artefact itself ([`stage-sequence.ts:539`](../../../../tests/runtime/udg-003-phase-2/stage-sequence.ts)): *"M = the server's canonical-to-replica mapping, applied per entity in the consuming tick; P = that room's publication of state and metrics at the declared patch interval, plus its flush"*, with `P`'s results half an explicit acceptance obligation of **UDG-007** and AC-6's overall verdict **qualified**. The other `M` controls in the same artefact (`byValueControl.*`, `refusalControl.*`, `perEntityNegative`, `runtime.test.ts:765-771`) are what carry the mapping claim, and they passed in every retained run; the defect puts at risk the *run-level* AC-6 evidence for the attempt that refused, not the qualification itself |
| **Recommendation** | **Carry forward — not blocking.** Owner: `TomBResearch`; the measurement belongs to UDG-003's OD-4, the outstanding `P`′ half to **UDG-007**. **Reopen when** junit names `runtime.test.ts:760` or `:761` red — that is, when a **case** read refuses, not only a reproduction — or when a retained artefact carries `mappingMatchesTheAuthoritysOwnRecord: false`. **Prerequisite the reviewer may authorise at any time** (deliberately not taken this turn, which is review-only): add `stage-sequence.json` to `CASE_ARTEFACT_FILES` so a future refusal is attributable to the generation that produced it. It is one entry in an existing list, and today the failing generation's bytes are the only thing missing to classify this defect |
| **Why not blocking now** | Nothing in this defect currently fails a test case; it fails a capture command, which the loop already handles honestly (`W-A-6` fixed), and §6.1 forbids choosing a fix that no cause has demonstrated |

## CF-3 — the post-close input observation (`noInputReachedTheRoomAfterTheEpisodeClosed`)

| | |
| --- | --- |
| **Exact assertion** | Producer control [`tests/runtime/udg-003-phase-2/impairment-population.ts:958`](../../../../tests/runtime/udg-003-phase-2/impairment-population.ts) `noInputReachedTheRoomAfterTheEpisodeClosed: epSendsAfterClose === 0`, part of `ga6Ga7.ga6cEpisodeDeadline.controls`, whose verdict is `Object.values(controls).every(v => v === true)` (`:1471`) and whose refusal sets `process.exitCode = 2` (`:1525`) after `[impairment][fail] …` (`:1505`). In the suite it is asserted by [`runtime.test.ts:685`](../../../../tests/system/udg-003-phase-2/runtime.test.ts) `expect(ep.controls[name], \`the episode-deadline case must assert ${name}\`).toBe(true);` in the `W-7` case |
| **Retained evidence** | [`UDG-003-phase-3-impairment-gate-red-run-44211208860.json`](UDG-003-phase-3-impairment-gate-red-run-44211208860.json) — run `44211208860`, head `eff55412a196`, artifact `14387004463`, failing command `phase-2-impairment-population`, stderr `[impairment][fail] noInputReachedTheRoomAfterTheEpisodeClosed=false`, with the stdout summary line retained (latency bands inside the declared envelope: baseline intake p99 44.69 ms, imposed intake p50 83.62 ms, client-observed p50 126.64 / 188.94 ms, withheld 4) and `reconnection token invalid or expired.` logged in the same run. All test cases passed (`cases=647 failures=0`) |
| **What the bytes establish** | That after the episode closed, at least one input **send** was counted, in a reproduction invocation, while every latency band stayed inside the envelope — so this is a containment observation, not a performance regression. It does not say *which* send, from which seat, on which side of the client's own close |
| **Distinction that must not be lost** | This counts **sends** from the client after its episode closed. The accepted repair's `cleanup` block counts what the **wrapper delivered or swallowed** after `restore()`. Adjacent, not the same counter: `cleanup` informs the timing shape of a future sighting and cannot substitute for this control |
| **Classification** | **Unclassified, and stays unclassified.** Its shape is consistent with the straddle mechanism diagnosed for the measurement family in §17, but §17's cause was demonstrated for *where a tally is read*, and this control counts a send, not a read. Treating the accepted repair as if it had explained this observation would be exactly the error of collapsing two signatures |
| **Guarantee it could affect** | The **containment** half of the `W-7` case's claim, and through it **GA-6c/GA-7**: that a seat whose episode deadline expired stays stopped, sends nothing further, and does not keep writing into a session the server retired. If it can send after close, then "the seat stayed stopped" is a claim this harness cannot make, and the recovery machine's ownership (**UDG-008** for the production client, **UDG-SPIKE-001** for Gate A's version) is where that claim has to be earned |
| **Recommendation** | **Carry forward — not blocking.** Owner: `TomBResearch`, with the production-side obligation recorded against **UDG-008** and Gate A's version against **UDG-SPIKE-001**. **Reopen when** junit names `runtime.test.ts:685` red for that control, or a retained artefact carries `controls.noInputReachedTheRoomAfterTheEpisodeClosed: false`. Both now arrive with more bytes than this defect has ever had: the case's own artefact is retained (`W-A-3`) and the same artefact publishes `cleanup.deliveriesObservedDuringCleanup`, `cleanup.swallowedObservedDuringCleanup` and `cleanup.wrapperSilencingAtEpisodeEnd`, so a future sighting self-diagnoses the side of the boundary it came from without a new instrument |
| **Why not blocking now** | Same clause: no demonstrated cause, therefore no permitted fix; and no test case has ever failed on it |

## CF-4 — `P-2b`: the rejoin refusal wording (`/token/i`)

| | |
| --- | --- |
| **Exact assertion** | [`tests/system/udg-003-phase-2/runtime.test.ts:577`](../../../../tests/system/udg-003-phase-2/runtime.test.ts) `expect(firstRefusal.message).toMatch(/token/i);`, conditional on a refusal existing (`:575-576`, `const firstRefusal = ga.reconnectFailures[0]; if (firstRefusal !== undefined) {`), in `P-2b, reopened for the harness only, exercises GA-6a, GA-6b, GA-6c and GA-7 at the declared test values` (`:513`). Its sibling, `:573` `expect(failure.case, 'only GA-7 may be refused a reconnect').toBe('GA-7')`, and `:578` `expect(ga.ga7.recoveryPath).toBe('matchmaking-rejoin')` travel with it |
| **Retained evidence** | **Quote only, and recorded as such.** The symptom `expected 'seat reservation expired.' to match /token/i` is quoted in [UDG-004-completion.md](../UDG-004-completion.md) (a Linux container, with the immediately following run of the same command green with no file changed) and in the Phase 3 draft (`UDG-003-phase-3-assignment-draft.md:251,258`); the step-1 table row in [the diagnosis](UDG-003-phase-3-wa-diagnosis.md) §1 marks the identity **quote only**. No junit byte, no bundle and no artefact from a failing `P-2b` attempt is retained anywhere: `44191978254` and `44215794779` retained `W-7` reds, and neither touched `:577`. `P-2b` did fire in the declared ten-pass streak environment: 10/10 passes, `firstRedIteration: null`, under the declared load and full-suite order |
| **What is known without being observed** | A code reading over the pinned dependency: the two texts come from two different branches of one rejoin — `reconnection token invalid or expired.` at `@colyseus/core@0.18.27` `build/MatchMaker.mjs:151`, and `seat reservation expired.` at `build/Transport.mjs:130` reached via `Room.mjs:449`. That is a reading of the dependency, **not** an observation of the failure, and it is offered as the shape a future reproduction should be tested against |
| **Classification** | **Unclassified, and stays unclassified.** The accepted repair moved nothing here by direction |
| **Guarantee it could affect** | **GA-7**: that a session the server has retired is refused a token reconnect and therefore recovers through the matchmaking rejoin path — the assertion names *which branch* refused, so the evidence's attribution of GA-7's recovery path depends on it. If the observed refusal is the transport/seat-reservation branch, then the recorded GA-7 event is not the token-expiry event the case claims to observe, and `:573`'s "only GA-7 may be refused a reconnect" plus `:578`'s `matchmaking-rejoin` become load-bearing on the same distinction. The accepted values are untouched and stay: `clientSnapshotDeadlineMs 500`, `clientRecoveryDeadlineMs 4000`, `rejoinWindowAllowance 2` (asserted at `runtime.test.ts:583-585`), close codes 4100/4101/4102, and the three-limit map |
| **Recommendation** | **Carry forward — not blocking.** Owner: `TomBResearch`; the production recovery machine is **UDG-008**, Gate A's version **UDG-SPIKE-001**. **Reopen when** a retained junit shows `:577` failing with a message that is not the token branch — at which point the minimal, cause-ready step is to record **which call refused** (matchmaking versus transport) inside `ga7.tokenReconnectRefusalsRecorded`, harness-only recording that changes no timing, and then decide whether `:573` must distinguish the branches too. Recording the branch is deliberately **not** done now: it would be an instrument aimed at a symptom that has never been caught in bytes, which §6.4 does not license |
| **Why not blocking now** | Two of the assignment's own statements collide here, and the conservative reading wins: §5 requires the fix to be "applied only to a demonstrated cause", and §6.4 makes publication-plus-open-questions the discharge when the failure cannot be reproduced. `P-2b` has never been reproduced |

---

## 5. Does the assignment require a fix before acceptance? Quote and reading

The clause that governs completion, verbatim (§7.3 of
[`UDG-003-phase-3.md`](../UDG-003-phase-3.md)):

> Phase 3 is complete when W-A's §6 gate is met per defect, W-B/W-C's artefacts pass the whole-task gate, W-D's
> ledgers close with their carried obligations named, and the §4 grants were not exceeded. **A criterion with a
> missing, unverifiable or non-replayable artefact is FAIL, not "not run."**

"W-A's §6 gate" is §6.1's chain, verbatim:

> **Per defect, separately** (`W-7` in `runtime.test.ts` line ~644 and the episode-deadline probe; `P-2b` in the
> same file and the GA-6/GA-7 harness seat): step-1 assertion table from retained bytes → targeted reproducer
> **or** failing control (fails unfixed, passes fixed, under the declared conditions) → one fix, chosen by the
> demonstrated cause.

and §5's work-item row adds the condition on the fix itself:

> the fix (G-P3-2) is minimal and applied only to a demonstrated cause.

and §6.4 supplies the path when there is nothing to fix yet:

> **Non-reproduction:** if an original failure cannot be reproduced, W-A publishes what the retained evidence
> establishes — the step-1 table, the attempt logs, the identical-code red/green pairs, the load correlation —
> and what it leaves open, **before** proposing any change; a change proposed against an unreproduced failure
> must name the retained fact that justifies it.

**Reading.** No clause authorises a fix for any of the four defects as they stand: three have no demonstrated
cause and one (`P-2b`) has never been reproduced in bytes at all. So the answer to "is a fix required before
acceptance" is *no fix is permitted*, and the four entries above are the §6.4 discharge. But §7.3's sentence
cannot be reported **met** for the `W-7` defect while one of its two assertion families stands unclassified,
because §6.1 ends in "one fix" and no fix may be chosen for that family. That is a clause-level conflict, and it
is reported rather than resolved silently. The amendments proposed, **all three approved on 2026-11-18 as bounded closeout amendments** (§7; recorded in [`UDG-003-phase-3.md`](../UDG-003-phase-3.md) §9.1):

- **A-P3-5 (§6.1 read with §7.3 — closure granularity).** Close `W-A` per **assertion family**, not per case
  name. One case (`W-7: the 4000 ms episode deadline expires…`) asserts two readings that have failed apart on
  the same bytes — `:702` deliveries (1 sighting, unclassified) and `:704` applications (cause demonstrated,
  repaired) — and junit reports only the first failure, so a case name cannot carry a per-defect gate. Under
  this amendment the applications family is **met**, the deliveries family is discharged by §6.4 plus the
  carry-forward entry in §1 above, and neither inherits the other's verdict. Left unamended, §7.3 either reads as
  unsatisfiable or pressures a fix without a cause, which §6.1 forbids.
- **A-P3-6 (§6.3 — what the ten passes score).** State that the streak scores **case ids out of junit** (already
  the operative rule, `D-P3-WA-junit-scoring`) and that a family-level carry-forward therefore does not inherit a
  case-level green. The retained streak says what it says: `W-7` 10/10 and `P-2b` 10/10 under the declaration, on
  the repaired tree, with `firstRedIteration: null` for both — stability, not cause.
- **A-P3-7 (§7.3 — scope of the artefact clause).** State that a refusal by an accepted producer inside the
  capture's **reproduction** invocation, where the case's own generation passed and every test case passed
  (`44206639883`, `44211208860`), makes **that attempt's bundle** FAIL and does not retro-FAIL the criterion for
  bundles holding a passing artefact. This is how the two runs above are already being read, and how the store
  behaves: the 222 bundles visible under `/workspace/udg-evidence` verify to identical outcomes under HEAD's
  verifier and this branch's ([`UDG-003-phase-3-verify-preservation-head-vs-wa3.txt`](UDG-003-phase-3-verify-preservation-head-vs-wa3.txt): 0 differences, 187 PASS / 35 FAIL, the 35 pre-existing).

Two of the four defects are not named in §6.1 at all — the mapping mismatch and the post-close input observation
were found as capture refusals during Phase 3, and §7.3's explicit non-claim covers a different pair ("the two
publication-sitting reds", `43956003339` and `43962098658`, which stay **unclassified** and are not these). Their
obligation arrives through §7.3's artefact sentence, and both are recommended forward rather than inward: `AC-6`
`P`′ half to **UDG-007**, the containment and recovery claims to **UDG-008** and **UDG-SPIKE-001**.

## 6. The three statements the owner attached to acceptance

Recorded verbatim as conditions of the acceptance, not as commentary:

1. **The ten-run results show stability under the declared conditions. They do not establish a cause for any
   carried-forward item.** `W-7` 10/10 and `P-2b` 10/10 on the repaired tree, per case id out of each iteration's
   own junit, under the declaration committed before the streak — and still: CF-1, CF-2, CF-3 and CF-4 each have
   no cause, and nothing in the streak may be quoted as one.
2. **Failed captures retain their original verdicts.** A bundle recorded FAIL stays FAIL: it is not re-run until
   green, not re-judged by a later rule, and not excluded from the store. The 35 failing bundles in
   `/workspace/udg-evidence` failed before this record and fail now
   ([`UDG-003-phase-3-verify-preservation-head-vs-wa3.txt`](UDG-003-phase-3-verify-preservation-head-vs-wa3.txt):
   222 bundles, 0 differences between HEAD's verifier and this branch's). A-P3-7 fixes the *scope* of a FAIL, not
   its existence.
3. **The four unresolved observations are recorded separately**, each with its owner and its reopening condition,
   in §0 above — and they travel to the places where the guarantees they touch are evaluated, rather than resting
   only in this file.

## 7. Acceptance recorded 2026-11-18 (dated by commit)

The integration owner accepted **UDG-003 Phase 3** at `74aa8dabbef7fcae5c455c24dfb326c2a57f6be2`
(hosted CI [`44299429735`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44299429735),
**attempt 1**, success) with this closeout reviewed at `5bec5ff665389e3c95946336b2df4275ebb2404f`
(CI [`44316260678`](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44316260678), first attempt,
success), approved A-P3-5, A-P3-6 and A-P3-7 as bounded closeout amendments, and recorded **UDG-003 task-level
Verified** under the amended criteria. The full acceptance entry is
[`adoption.md`](../../adoption.md); the assignment's own record of it is
[`UDG-003-phase-3.md`](../UDG-003-phase-3.md) §9.2.

```text
acceptance commit        4f567ae4596b1a5b99e35a3b48d7d9b728c2863d (2026-11-18, main)
its CI                   44325176142 — success on the first attempt, 34.0 min job, every step green, all five
                         capture bundles verified PASS at 666 cases with 0 failures each (the +1 against the
                         submission run's 665 is wa-cleanup-window.test.ts's fourth control, added in
                         bc6879172885 and inside the reviewed closeout range; nothing removed, skipped or renamed)
this line added by       the records commit that follows the acceptance commit, per the convention this repository
                         uses for acceptance blocks
```

What the acceptance does **not** do: it passes no gate — Gates A, B and C remain **Not Run**, GA-11 unevaluated,
`stackCompatibility` **not-established**; it does not establish task scope completion; it does not enable
deduplication-triggered closure, which stays **disabled**; it leaves **D4 open** with evidence in the existing
store only; and it promotes no unclassified observation. CF-1 … CF-4 remain open observations of an accepted
task, not defects that block it.

## 8. What this record does not change

- Nothing in the tree beyond records. No probe, harness, fixture, deadline, retry allowance, close code, refusal
  matching, policy sample or accepted assertion moved, and `stage-sequence.json` was **not** added to the retained
  case-artefact set — that extension is offered, not taken, because this turn authorises review only.
- No hosted failure was waited for or provoked. The controlled capture-retention proof stands as accepted:
  `tests/unit/udg-003/capture-loop.test.ts`, `tests/unit/udg-003/task-case-artefacts.test.ts`,
  [`UDG-003-phase-3-wa3-local-capture.md`](UDG-003-phase-3-wa3-local-capture.md), plus the two hosted runs whose
  retained case bytes differ from their own run's reproduction.
- Statuses unchanged: Phase 3 **In Review**; acceptance, task-level **Verified**, Gate A/B/C (**Not Run**),
  GA-11 (unevaluated), `stackCompatibility` (not-established), deduplication-triggered closure (**disabled**) and
  **D4** (open, existing store only) all remain the reviewer's and are untouched here.
- The four defects stay four. Nothing in this table collapses one into another, and no unclassified cause has
  been promoted.
