# UDG-003 Phase 2 — the §9 evidence matrix, and the two reconciliations it forces

> Review basis for the Phase 2 submission. Submitted implementation SHA
> `cf34987445f737d21285b8b1f5d6b650f85873b5`; assignment version pinned at handoff
> `17ade43be0a64935cb2e06be02ebbe9756f6eb6f`; baseline `8716b8c6e3c4a3f005fe260eebf5569bb02201dd`.
> This file changes no implementation, no evidence artefact and no pin; it is the reviewer's index
> into bytes that already exist. **Status remains In Review**; acceptance is the owner's alone.

## 1. Retained evidence, and the verification result from the retained copy

| item | value |
| --- | --- |
| retained directory | `/workspace/udg-evidence/ci-run-43263252706/` |
| retained UDG-003 bundle | `/workspace/udg-evidence/ci-run-43263252706/UDG-003-2026-11-12T16-59-54-817Z-cf349874` |
| provenance | the `udg-evidence` artefact published by CI run [43263252706](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43263252706) (head `cf34987`, conclusion `success`), downloaded with `gh run download 43263252706 --name udg-evidence`; `diff -r` against the downloaded copy: **byte-identical**, nothing inside a bundle was edited |
| same run's other bundles | `UDG-001-2026-11-12T16-55-37-209Z-cf349874`, `UDG-002-2026-11-12T16-57-36-285Z-cf349874`, plus `probes/` (PR-0/1/2/3/8/12/13/14/15 + `probe-run-index.json` + `probe-invocations.json`), `udg-003-phase-1/`, `latest-UDG-00{1,2,3}.txt`, `UDG-00{1,2,3}-ci-summary.json`, `runner/runner-log.txt.gz` |
| verification from the retained copy | `PASS evidence verify …/ci-run-43263252706/UDG-003-2026-11-12T16-59-54-817Z-cf349874 (0 issue(s))`; UDG-001 and UDG-002 bundles from the same retained directory: `PASS`, 0 issues each |
| vector gates on the retained bytes | `PASS phase-1 vectors: 15 artefact(s) listed, hashed and attributable` · `PASS phase-2 vectors: 15 artefact(s) listed, hashed and attributable` |
| identity digests | `report.json` `5a438399c67b7cf0cb4e6f4c00e669655324d913aeed663e8b3e2ea3edaa2471`; `vectors/vectors-manifest.json` `c5fc1c49da91188e49052eba3bfda46660307e63f3c923ccc54e13c3474621c8`; `vectors-phase-2/vectors-manifest.json` `6953bf9d0b8d591e985d090df57e0f54dae149ae27e3d931d66a87183cd71935` |

Bundle `report.json`: `status PASS`, `phase phase-2`, `implementationSha cf34987…`,
`workingTreeDirty false`, 172 hashed files.

One caveat the reviewer will hit immediately: `evidence verify` is **plan-relative**, so the retained
bundles of *earlier* runs verify against the plan of their own commit and not against this tree's —
measured in §7 **E1**. Nothing in this directory was re-captured, renamed or edited to make anything
look green.

## 2. How to read the statuses

* **PASS** — measured, artefact retained in the bundle above, replay evidence where the criterion asks for it.
* **PARTIAL** — some sub-claims measured; the row names the exact sub-claim that is not.
* **FAIL** — §9's own rule: *"A criterion with a missing, unverifiable or non-replayable artefact is
  FAIL, not 'not run.'"* A FAIL is not a claim of broken behaviour; it is the absence of the artefact
  the criterion demands.
* **NOT PASSED (reported)** — the criterion's positive condition is unmet and the assignment required
  the verdict reported whichever way it fell (W-6, D-P2-6).
* A deferral is only a deferral if a clause says so. Rows therefore cite the clause, or say
  **no clause** — which means the item is simply missing inside Phase 2's own granted scope.

Clauses cited (all in force at the pinned assignment version): **§4.4** not-granted paths
(`apps/client/**` → UDG-008; navigation and assets → UDG-005/006/007); **D-P2-1** recovery harness
stays test-only; **D-P2-5** formal Gate A in UDG-SPIKE-001; **"not Gate A" item 1** (Phase 2 "builds
the substrate, exercises GA-1…GA-13 against it, and reports criterion evidence"); **§5 rule 7**
(production tuning remains Gate A's job, GA-11); **W-6** (the PE determination is reported with its
verdict either way); **§5 preamble** (an item not completed is reported incomplete, with the reason).

## 3. GA-1…GA-13

| GA | artefact (retained bundle) | measured result | replay evidence | status |
| --- | --- | --- | --- | --- |
| **GA-1** compliant sender | `vectors-phase-2/stamped-seq-roundtrip.json`, `retirement-arithmetic.json` (`compliantStream`), `abuse-results.json` (`compliant-control-population`), `buffer-depth.csv`, PR-14 `compliant-stream-resolves-all-six`/`-retires-nothing` | 3 control seats × 60 stamps: `resolvedThrough 60`, `retired 0`, `gaps null`, closures 0; room-wide `maxDepthEver 8` < 32; wire/authority closed sets 6 and 5 fields, projection exactly the five; stamp 0, missing `seq`, extra field, non-integer and over-max all refused | deterministic case replayed in the vectors suite (pure); transport run is not journaled-and-replayed → GA-13 | **PARTIAL** — the literal `B = 8` burst-then-idle construction is not run (a 6-frame burst and 60-frame λ-rate streams are); per-seat depth < 32 is not separated from the room-wide figure. **No clause** defers either; both are inside Phase 2's scope |
| **GA-2** pressure only, no confirmation | `consequence-handling.json` (`pressure`), `abuse-results.json` (`pressure-throttles-and-never-closes`), `tick-metrics.json` | pressure line `32 − 8 = 24`, signal latches once (`QUEUE_PRESSURE` ×2 over 200 ticks); `throttledSeen true`, `closuresTotal 0`, `retired 0`, seat still seated and resolving afterwards | deterministic (fake accessor) + live population | **PASS** |
| **GA-3** confirmed retirement | `abuse-results.json` (`retired-offender-closes-in-bounded-window`), `close-path-accounting.json`, `retirement-arithmetic.json` | closure `4100` at `closeElapsedMs 284` (window 250 ms, cap 1000 ms); residue `retiredUnrepresented 30`, `consumedCountAtClose 30`, attributed to that `entityId`; PR-14's offender residue `12` with `serverQueuedAtClose 31` | vectors case + live run | **PASS** — residue reported even though the §3.1 pre-buffer limit means the identities are unnameable (limit disclosed in `retirement-arithmetic.json`) |
| **GA-4** refused frames represented | PR-14 `refused-frame-is-dequeued-and-represented`, `-costs-no-retirement-and-keeps-the-seat-open`, `retirement-arithmetic.json` | wrong-epoch stamp 13 dequeued and recorded refused (1 refusal row), `retired 0`, closures 0, watermark unchanged; one consumed row per entity per tick (max 1) | PR-14 counters from the room's own rows | **PASS** |
| **GA-5a** dedupe then a later stamp | `retirement-arithmetic.json` (`namedGap`), PR-14 `gap-is-named-as-a-range`/`watermark-stops-at-the-gap`, `strand-and-dedupe-policy.json` | gap named as a range (`2..3` deterministic, `9..11` live), `retired 0` for that frame, watermark stops at 8; server does not close (no strand closure branch in the emitted room) | deterministic + live gap; the **client-detects-the-named-range** limb is measured only through the frozen rules on a deterministic clock (`input-reconciliation.json` `stall-by-deliveries`) | **PARTIAL** — D-P2-1 + §4.4 cover the production client; they do not cover the harness half, and no live scenario drives recovery off a *named gap* (the live scenarios drive the deadline, episode and allowance limits) |
| **GA-5b** terminal dedupe | `recovery-harness.json` (scenarios 2–4), `strand-and-dedupe-policy.json`, `input-reconciliation.json` | deadline expiry → stop-sending + discard-prediction → rejoin → recovered via epoch change and record rebasing; server reports the loss as unidentifiable (strand signal, no invented range or cause) | deterministic timelines + live harness | **PARTIAL** — "the frame is applied at most once" is unmeasurable here: every runtime `effectCount` in the retained artefacts is `0` because M0 refuses every discrete command (see GA-10). Clause: **§4.4** (navigation → UDG-007) defers the *work*, not the criterion |
| **GA-6** stalled stream, client-local deadline | `recovery-harness.json` (S2, S3, S4), `input-reconciliation.json` (T1–T5) | **6a** deadline fired `509 ms` after the last delivery against `clientSnapshotDeadlineMs 500`, sending stopped, prediction discarded, rejoin + snapshot recovery completed; **6b** the trigger was the client's own timer with zero deliveries — no server event involved; **6c** episode deadline closed the **client itself** at `4006 ms` with `4102`, and the rolling allowance refused the third rejoin after `2` actual rejoins, client closed `allowance-exhausted`; no send after expiry in any timeline | deterministic rule timelines are reproducible byte-for-byte; live scenarios recorded | **PASS** on the test-only harness (D-P2-1, §4.4: the production client is UDG-008; `recovery-harness.json` states the hand-off) |
| **GA-7** final publication withheld | `close-path-accounting.json`, PR-14 `closure-window-forced-one-final-publication`, `recovery-harness.json` S2 | the server still records residue, counters and `serverQueuedAtClose` (`8` queued / `6` consumed on the rate-closed seat; `31` / `13` on PR-14's offender); one forced final publication per closure window; the client's own deadline expires and it recovers through rejoin + snapshot | as GA-5b | **PARTIAL** — "applies nothing twice" unmeasured for the same reason as GA-5b (**§4.4**); the client-deadline-inside-the-server-window coupling is measured on separate seats, not as one coupled pair |
| **GA-8** same-delivery comparison | `recovery-harness.json` S1, PR-14 `pairing-reads-ack-and-record-from-one-delivery`, `input-reconciliation.json` R-A | 4 live deliveries and 8 PR-14 deliveries each read `(inputResolvedThrough, lastProcessed)` from the same state delivery; `allPairsConsistent true`; no rule reads across deliveries | R-A is asserted as a structural rule in the frozen rules module | **PASS** |
| **GA-9** isolation | `abuse-results.json` (`offenders-never-touch-the-compliant-population`), PR-14 `compliant-neighbour-is-untouched` | compliant survivors `retired 0`, `resolvedThrough 60`, `effectCount 0`, `closing false` while two offenders closed (`4101`, `4100`); closures attributed to offender entities only | live, single shared room | **PARTIAL** — the required artefact is the compliant entity's projection `(clientSeq \| null, disposition, dx, dy, entityStateDigest)` compared with a **solo baseline** run, plus room-wide ordinals compared as growth-only. Neither exists. **No clause** defers this: it needs no RTT, loss or client |
| **GA-10** exactly-once across an epoch change | PR-14 `abandoned-identity-charges-nothing`, `reissue-of-a-known-identity-is-answered-not-recharged`, `rejoin-restarts-the-stamp-domain`, `rejoin-carries-a-server-issued-epoch` | Δ = 0 for an abandoned identity (counters `refused:navigation 1`); Δ = 0 for a re-answer of a known identity (`answered 1`, `effectCount 0`); epoch change re-issued (replica epoch 2) with the stamp domain restarted | ledger keyed by `(epoch, requestId)`; no journal replay | **FAIL** (§9 rule) — both `Δ == 1` halves are unproduced: see §4 below. Clause **§4.4** defers the enabling work to UDG-007; nothing converts the criterion to pass |
| **GA-11** production settings measured | `envelope-hashes.json` (`envelopeInequality`, `settingsStatus`) | `B + J·λ + stall = 11 ≤ bufferMaxSize 32` evaluated **on provisional test values**; `settingsStatus` = provisional (D-P2-4) | none (nothing measured to replay) | **FAIL** — ADR-0003 §5: *"including GA-11, where failing to measure is itself the failure."* No jitter/overrun population, no RTT population, the second inequality (`clientSnapshotDeadlineMs ≥ 4 × patch interval + 2 × measured p99 RTT`) is **unevaluated**, and no production value is recorded beside a provisional one. Clauses **D-P2-5**, §5 rule 7 and W-3 defer *production tuning* — they do not supply the populations **W-10 names as Phase 2 deliverables**. See §5 |
| **GA-12** positive evidence for the dedupe closure signal | `pe-determination.json`, `strand-and-dedupe-policy.json`, `consequence-handling.json` (`strand`) | determination **not-passed**, PE-1…PE-5 each with its own reason; `dedupeClosureEnabled: false` in hashed config; the emitted room contains **no closure branch** for the signature; `strandSignalsAlongside 0` in the retirement closure run | deterministic strand timing (needs one sustained patch interval) | **NOT PASSED (reported)** — required outcome reporting under **W-6**/**D-P2-6**; the Gate A row itself remains unmet, Gate A **Not Run** |
| **GA-13** evidence integrity | bundle sanitisation (`report.json.sanitisation`, verify 0 issues), `probes/compatibility-verdict.json`, Phase 1 `vectors/pa1-c8-deferred-intake.json`, `pa1-c9-receipt-order.json`, `measurements/UDG-003.json` | no machine path, token or credential in any artefact (gate-enforced, and the retained copy re-verifies clean); `stackCompatibility` asserted only as `not-established`; **Phase 1** scenarios replay (all four C8 lifecycles and both C9 cases `replayable true`, `allEqual true`, digest-blanked replay equal) | Phase 1: yes. **Phase 2: none** | **FAIL** — no Phase 2 scenario replays from its recorded journal to the same dispositions, canonical state and chain tip. The room journals the bytes (`room-lifecycle.json` `journalRows 3621`, tick chain recorded), and no artefact replays them. **No clause** defers this; Phase 1's replay helpers already exist |

### 3.1 AC-1…AC-20

The AC set is the task-level acceptance criteria ([readiness proposal §3.7](UDG-003-readiness-proposal.md),
sourced from `acceptance-gates.md` 7.3); §9 requires them *with the numeric measures*. Phase 1
recorded which of them it did **not** decide (its §10: AC-1, AC-3c, AC-7, AC-9, AC-10/11/12, AC-13,
AC-15); those are exactly the rows a transport phase was expected to close, so their Phase 2 state is
reported row by row rather than inherited.

| AC | artefact | measured result at `cf34987` | replay evidence | status |
| --- | --- | --- | --- | --- |
| **AC-1** 200-tick 40 m trace | — | no artefact runs 200 valid direct ticks against the reference trace; the nearest are `clock.test.ts` (`desiredDisplacement == speed × dt`, 12 dp) and PR-14 `compliant-stream-moves-the-entity` (`x 0.5` after one flat step) | none | **FAIL** — missing artefact, **no clause**; Phase 1 §10 named AC-1 for the phase that owns a substrate, and Phase 2 did not pick it up |
| **AC-2** displacement bound | `vectors/pa1-4-…json`, `pa1-5-pa1-8-…json`, `tests/unit/udg-003/vectors.test.ts` | `boundMetres 0.2 + 1e-6`, every sample at or under the limit across 7 axis combinations and bursts | vectors suite is deterministic and re-run in this bundle | **PASS** |
| **AC-3a** consumption ∈ {0,1} | `measurements/UDG-003.json`, PR-14 `one-observation-per-entity-per-tick` | `authority.oneInputPerTick 1`; over the live room, max consumed rows in any tick **1** across 200 ticks / 203 consumed frames | live counters + Phase 1 burst/40 fps/empty-queue/no-winner cases | **PASS** |
| **AC-3b** bounded queues | `vectors-phase-2/buffer-depth.csv`, `tick-metrics.json`, Phase 1 `queues.test.ts` | client-frame high-water **8** of 32, room-wide, with an eviction burst of 44 into a 32 buffer proving the bound bites; core-side 64/8/128 bounds asserted in Phase 1 | CSV is per-tick rows of this run | **PARTIAL** — the CSV carries no discrete-operation column and the population sent no discrete traffic, so 64/room and 8/entity high-water marks are not reported from the named artefact |
| **AC-3c** displacement over the abuse population | — | not asserted: the population's control seats send `drive 0`, so no per-tick travel bound is exercised there | none | **FAIL** — **no clause**; AC-3c names the abuse population, which Phase 2 now owns |
| **AC-3d** replay equivalence | `measurements/UDG-003.json` (`replayEquivalence`), `vectors/pa1-c8-deferred-intake.json`, `pa1-c9-receipt-order.json` | core: `rowsEqual`, `tipEqual`, `digestBlankedReplayEqual` all `true`; all four C8 lifecycles and both C9 orderings `replayable true`, `allEqual true` | core: yes, in this bundle | **PASS (core) / FAIL (Phase 2 scenarios)** — no transport scenario is replayed from its journal; GA-13 row and §6 item 1 |
| **AC-3e** honest reporting by reason | PR-14 counters, `tick-metrics.json`, `abuse-results.json`, Phase 1 overflow-cause table | reasons exist and are journalled (`refused:epoch 2`, `refused:navigation 1`, answered 1, consumed 9 live; `overflowCauses['deferred-intake'] 3` at the core) | counters read from the room's own rows | **PARTIAL** — `abuse-results.json` carries no per-reason drop/refusal table, `rateLimited` appears as a close code and a signal but not as a reported reason, and `tick-metrics.json` is a summary, not the per-tick rows AC-3e names |
| **AC-4** input removal, next tick | `vectors/pa1-5-pa1-8-…json`, `neutral.test.ts` | zero horizontal desired displacement on the next tick, `idle`, `y` unchanged, heading preserved | deterministic vectors | **PASS** |
| **AC-5** stale routes / duplicate commits / old-epoch frames = 0 | Phase 1 lifecycle vectors, PR-14 counters | epoch-8 issuance over an epoch-7 backlog → 3 `refused:epoch` rows and zero applied; live `refused:epoch 2`; duplicate commits charge 0 (ledger keyed by `(epoch, requestId)`) | Phase 1 replay equal; live ledger counters | **PASS** |
| **AC-6** stage sequence F…X, M, P | `measurements/UDG-003.json` `stageOrder` | `[F, L, Q, S, A, C, R, X]` on executed ticks — **M and P are not authority stages in this build**; state reaches clients through the transport's own schema-patch pipeline, which nothing asserts as satisfying M/P | Phase 1 stage-order vectors | **PARTIAL** — owner ruling needed (accept the transport pipeline as M/P, amend AC-6, or assign M/P explicitly): §8 **OD-4**. Phase 1 disclosed M/P absent; Phase 1's own threshold prose expected them "as Phase 2" and no Phase 2 work item names them |
| **AC-7** offender causes no observer change | PR-14 `refused-frame-…`, `hash-gate-refuses-wrong-configHash`, `abuse-results.json` | no crash across 11 scenarios; observer-visible retirements 0 and no closure on compliant seats while offenders were refused and closed | live, shared room | **PARTIAL** — "no observer **trace** difference" needs the GA-9 projection instrument (§6 item 2) |
| **AC-8** `UDG_MOVE_TO` refused in screening | `measurements/UDG-003.json` `navigationRefusal`, PR-14 counters | admitted at the gate, refused in screening with `NAVIGATION_BUSY`, `pathCandidates 0`, `routeRevision` 0, no `path` candidate, no `UDG_ROUTE_STATUS` | Phase 1 `path-refusal.test.ts` + replay | **PASS** |
| **AC-9** startup and lifecycle | `abuse-results.json` (`unbounded-room-refuses-the-seat`, `server-disposes-cleanly`), `room-lifecycle.json` | boot without operator bounds refused with `region-bounds-missing` and the room never entered the live registry; after dispose, `liveRoomsAfterDispose 0`, ticks stopped, no post-dispose write (the `onDispose` fix at `cf34987` covers the refused-room path) | live | **PARTIAL** — holds for the bounds path actually implemented; AC-13's file-level refusals are the deferred half |
| **AC-10** probe modules clean | `probes/PR-0.probe-result.json`, `probes/declaration-inventory.json`, `pnpm run declarations:strict` | PR-0 pass with the escape-hatch scan over probe sources including the root probe; declaration inventory unchanged; 0 lint errors | probe bytes + ledger in the bundle | **PASS** |
| **AC-11** api-map completeness | `docs/integration/colyseus-0.18-api-map.md`, `probes/PR-8…PR-15` | rows exist for every API the shipped code uses (`setFixedTimestep`, the input accessor and `consumedCount`, `lastProcessed`, `allowReconnection`, `client.reconnect`, `gracefullyShutdown`), with PR-8's received ≠ applied finding escalated as **D-7** (still open, not restated as satisfied) | api-map rows cite probe paths and check ids | **PARTIAL** — the `Room.setFixedTimestep` row's signature is wrong for the pinned build (§7 **D2**); it is the argument Phase 2's own defect turned on |
| **AC-12** built before asserting | `tests/probes/colyseus-server.probe.ts` (`serverBuild`), contract assertion *rebuilds the server it probes* | the runner rebuilds `apps/server` on every invocation and records `serverBuild` (`exitCode 0`); the suite fails if the emitted room is absent, so PR-14 cannot measure a stale build | recorded in the probe index inside the bundle | **PASS** |
| **AC-13** startup refusals | `abuse-results.json`, `apps/server/src/server-config.ts` | absent bounds refused; unvalidated config refused; operator deployment ignored unless it carries the per-process nonce | live | **PARTIAL, clause: §4.4** — malformed bounds, inverted axis range, unknown key, world/region identity mismatch, non-finite bound and the synthetic-bounds opt-in have no input surface until the region asset (UDG-007) supplies one |
| **AC-14** journal row schema | Phase 1 `journal.test.ts`, `room-lifecycle.json` | the accepted schema test still refuses a digest-only journal; the room wrote **3 621** rows through the accepted sink in this run | rows are the replay input Phase 2 never replays (§6 item 1) | **PASS** |
| **AC-15** root commands, bundles, neighbours | CI run 43263252706, retained bundles | every §8.1 command green locally and on the hosted runner; the three bundles from this run verify **PASS, 0 issues** from the retained copies; UDG-001 49/49 and UDG-002 31/31 at this head; full suite 552/552; checksums in sync. The clause's last half — *every retained bundle still verifies* — is where §7 **E1** bites: pre-Phase-2 UDG-003 bundles no longer verify against this tree's plan | re-verification run against the retained bytes, both here and at the historical bundles' own commit | **PARTIAL** — this run's bundles: PASS. Historical UDG-003 bundles: FAIL at this head, PASS at their own commit (§7 **E1**, **OD-5**) |
| **AC-16** keepalive invariance | `vectors/pa1-5-pa1-8-…json` | keepalive frames leave `H`, `latchedKind`, `G_d` unchanged with `horizontalDrive NONE`; `direct → keepalive → direct` resumes at the same generation, one step per tick | deterministic vectors | **PASS** |
| **AC-17** queue policy and counter reconciliation | `vectors/disposition-reconciliation.json`, PR-14 counters | 5 scenarios `balanced: true`; live counters satisfy consumed + refused + answered + queued against observed on the room's rows | vectors + Phase 1 replay | **PASS** |
| **AC-18** no-winner branches | `neutral.test.ts`, `vectors` §PA1-7 | each branch steps the connected entity exactly once with neutral input; no branch dereferences an absent winner | deterministic vectors | **PASS** |
| **AC-19** identity completeness | Phase 1 `identity-cache.test.ts`, PR-14 `reissue-of-a-known-identity-is-answered-not-recharged` | intra-batch retries share one disposition/record/publish; same-id-different-payload conflicts without overwriting; the transport ledger is keyed by `(epoch, requestId)` so a re-answer charges nothing | Phase 1 replay equal; live ledger | **PASS** |
| **AC-20** replay sufficiency | `measurements/UDG-003.json`, Phase 1 `journal.test.ts` | digest-stripped journal replays to the same decisions and states; malformed-input journal replays | core: yes | **PASS (core) / FAIL (Phase 2 journal)** — the room's own rows are never replayed (§6 item 1) |

## 4. GA-10 reconciled against §9's completion rule

The criterion demands three ledger outcomes: `Δ == 1` per **committed** identity, `Δ == 0` for an
abandoned identity, `Δ == 1` for a deliberate reissue under a new identity.

Measured at `cf34987`: the two `Δ == 0` halves only. Every runtime `effectCount` in the retained
Phase 2 artefacts is `0`, and PR-14's counters say why — `refused:navigation 1`, `refused:epoch 2`:
M0 refuses **every** discrete command because no route can exist until UDG-007 ships routes
(`measurements/UDG-003.json` `authority.navigationRefusal` = `NAVIGATION_BUSY`, `pathCandidates 0`).
An identity that can never commit can never be applied exactly once, so **neither** `Δ == 1` half is
producible on this substrate. The submission had described this as the committed-identity half; the
reissue half is in the same position, and this matrix corrects that.

Against §9: "A criterion with a missing, unverifiable or non-replayable artefact is FAIL, not 'not
run'" ⇒ **GA-10 is FAIL**, and §9's completion sentence ("Phase 2 is complete when GA-1…GA-13 …
have measured criterion evidence") is therefore **not satisfied** — even though §4.4 forbids Phase 2
from building the thing that would satisfy it. That is not a reporting error to smooth over; it is a
conflict between the completion rule and the granted scope, and it is the owner's to resolve (§6,
decision **OD-1**). What Phase 2 legitimately claims is the sentence in "not Gate A" item 1: it
built the substrate, exercised the criterion against it, and reported the evidence — including the
half it could not produce, with the reason and the enabling dependency.

## 5. GA-11 reconciled, and the conflict inside the pinned assignment

* **ADR-0003 §5** requires, for GA-11 to pass: jitter/overrun and round-trip populations recorded,
  `B + J·λ + stall ≤ bufferMaxSize` evaluated **on measured values**, the client-deadline inequality
  evaluated on a measured p99 RTT, and production values recorded beside provisional ones — and it
  names failure-to-measure as the failure.
* **The assignment's own clauses** defer the measuring: "not Gate A" item 1 with **D-P2-5** (formal
  execution in UDG-SPIKE-001, Phase 2 reports criterion evidence), **§5 rule 7** ("Production tuning
  remains Gate A's job (GA-11)"), and **W-3**'s deliverable note ("GA-11 records that production
  values remain measurement-dependent").
* **But W-10** lists the populations as Phase 2 deliverables in their own words: *"Adversarial
  populations: RTT, jitter, loss, mid-tick arrival, reconnect, offender runs and the compliant
  control population GA-12 requires."*

So the assignment both assigns the populations to Phase 2 and assigns their evaluation to a gate
Phase 2 is forbidden to run. Current state against W-10: offender runs ✓, compliant control
population ✓ (3 seats, one room), reconnect ✓ (2 actual rejoins + a refused third), mid-tick arrival
✓ at the authority boundary (Phase 1 PA1-C8, and PR-15's withheld-step window), **RTT ✗, jitter ✗,
loss ✗** — the harness has no impairment path, and no pinned dependency provides one (loopback only,
disclosed in `abuse-results.json.limitations`). Under §5's preamble ("an item not completed is
reported incomplete, with the reason") this submission therefore reports **W-10 incomplete on its
RTT/jitter/loss deliverables**, and **GA-11 FAIL**. The completion record's W-ledger row for W-10
listed only what landed; the incompleteness belongs in the record, and this file is where the
reviewer finds it. Resolution is **OD-2**.

## 6. Missing or deferred, in one list

**Deferred with an owner-approved clause** (each stays deferred until the owner moves it):

| item | clause |
| --- | --- |
| production client recovery, production-client halves of GA-5b/GA-6/GA-7 | **D-P2-1** + §4.4 (`apps/client/**` → UDG-008) |
| a committable terminal identity (GA-10 `Δ == 1`, GA-5b/GA-7 "applied at most once") | **§4.4** (navigation and assets → UDG-005/006/007) |
| formal Gate A execution, numeric gates, production envelope values | **D-P2-5**, "not Gate A" item 1, §5 rule 7 |
| bounds-file validation surface of AC-13 (malformed bounds, inverted axis, unknown key, world/region identity mismatch, non-finite bound, synthetic-bounds opt-in) | **§4.4** — the bounds file is the region asset (UDG-007); Phase 2 receives operator bounds and refuses when they are absent |
| the PE determination's outcome (GA-12 unmet) | **W-6** / **D-P2-6** require the verdict reported either way; today it is `not-passed` |
| any `stackCompatibility` claim | §8.3 invariant 4 — asserted `not-established`, and the suite asserts it |

**Missing with no clause** (each is inside Phase 2's granted scope; none needs a dependency, a pin
change or a client):

1. **Journal replay for Phase 2 scenarios** — GA-13, AC-3d, AC-20. The room already writes rows and
   the tick chain (`journalRows 3621`); no artefact replays them to the same dispositions, canonical
   state and chain tip. Phase 1's replay helpers exist to do it with.
2. **The GA-9 projection instrument** — a solo baseline run and the per-tick projection tuple
   `(clientSeq | null, disposition, dx, dy, entityStateDigest)` compared against it, plus room-wide
   ordinals as growth-only. Its absence also leaves **AC-7**'s "no observer trace difference"
   unevidenced.
3. **AC-1** — no artefact produces the 200-tick 40 m flat trace within `1e-6 m`; Phase 1 §10 named
   AC-1 as not decided by Phase 1, and Phase 2 did not pick it up.
4. **AC-3c** — the displacement bound is not re-asserted per tick over the abuse population (the
   population's controls send `drive 0`, so displacement is not exercised there at all).
5. **AC-3b's discrete half** — `buffer-depth.csv` reports client-frame depth only (`maxDepthEver 8`
   ≤ 32); no discrete-operation high-water marks, because no discrete traffic was sent.
6. **AC-3e's reporting shape** — reasons are produced and journalled, but `abuse-results.json`
   carries no per-reason drop/refusal table and no `rateLimited` reason label, and
   `tick-metrics.json` is a summary rather than the per-tick rows AC-3e names.
7. **GA-1's literal construction** — the `B = 8` burst-then-idle case, and a per-seat depth bound
   rather than the room-wide `maxDepthEver`.
8. **AC-11's api-map accuracy** — see §7-D2.

## 7. Record defects this matrix found in the submitted batch

* **D1 — the bundle's own phase fields disagree.** `report.json` says `phase phase-2` (correct, per
  §8.2.1) while `measurements/UDG-003.json` still says `phase.scope "phase-1"`, and the plan's
  threshold line reads `phase.scope === "phase-2"`. The measurements file is written by the Phase 1
  suite and Phase 2 writes no measurements block, so the line is prose that its own bundle
  contradicts. Verification does not catch it (thresholds are recorded, not evaluated). Options: the
  Phase 2 vectors write a measurements block with the phase they measure, or the threshold line is
  corrected to say which file carries which label.
* **D2 — the api-map row for `Room.setFixedTimestep` is wrong for the pinned build.** It records
  `setFixedTimestep(intervalMs, callback)`; `@colyseus/core@0.18.27` declares
  `setFixedTimestep(step: FixedTimestepCallback, tickRate?: number, opts?)`. That is the very
  argument the W-10 defect turned on (a frequency, not a millisecond interval — the room ticked at
  ~55 Hz until the population could not build queue depth). AC-11 requires the map to be right about
  the APIs shipped code uses, with a probe path and check id; the row needs the corrected signature,
  the `tickRate` semantics, and PR-2's `rate-is-20hz` plus PR-14's `one-observation-per-entity-per-tick`
  as its runtime ids.
* **E1 — the §8.2.1 plan move makes every pre-Phase-2 UDG-003 bundle unverifiable *against this tree*.**
  Measured at `cf34987`/`e32dfed`, not reasoned:
  `UDG-003-2026-11-11T11-20-26-111Z-5d77c612` (the **accepted** Phase 1 bundle) fails with
  **25 issues** and `UDG-003-2026-11-11T23-28-12-047Z-17ade43b` (the handoff bundle) with **23** —
  all of them `vectors-phase-2/… is absent` plus `phase-2-* was never run`. The bytes are untouched
  and internally consistent; the gate is **plan-relative**, and `evidence verify` compares a bundle's
  `requiredFiles` and `commands.json` against the plan in the working tree rather than the plan that
  produced it. Verified in a worktree at `17ade43` with that commit's own tool: the same handoff
  bundle verifies **PASS, 0 issues**. Consequences, stated plainly: the UDG-001 and UDG-002 bundles
  still verify (their plans did not move), CI still passes (it verifies only freshly captured
  bundles), and no historical byte was rewritten — but any record that says "the bundle verifies"
  is now only reproducible at the commit that captured it, which is exactly the half of AC-15 that
  this matrix therefore reports as PARTIAL. §8.2.1 authorises the move and the mislabelling rule;
  nothing in it says historical bundles stop verifying, so the gap comes back as **OD-5**.
* **D3 — the flake history, restated with its instrumentation.** `pressure-throttles-and-never-closes`
  failed 3 times in ~20 runs before `dcae4ec`, unreproduced in 28+ runs since; the scenario now
  records its own `closureLedger` inside its observation so a recurrence names the code and entity
  instead of inviting a guess. In this retained run: `closureLedger []`, `throttledSeen true`.

## 8. Decisions the owner owes before any further Phase 2 work

1. **OD-1 — GA-10 against §9.** Either (a) accept Phase 2 at phase level with GA-10 recorded **FAIL**
   for a dependency reason and §9's completion sentence explicitly not satisfied; or (b) amend §9 (or
   ADR-0003 §5's GA-10 row) so the `Δ == 1` halves are conditioned on route existence and are
   evaluated in the UDG-007-dependent phase; or (c) sequence UDG-007 routes before Phase 2 acceptance.
   This record takes no position on which; it refuses to record GA-10 as anything but FAIL.
2. **OD-2 — W-10's RTT/jitter/loss populations vs D-P2-5.** Either Phase 2 (or a small follow-up
   inside it) grows an impairment path so the two GA-11 inequalities can be evaluated on measured
   values, or W-10's population list is amended and the populations move to UDG-SPIKE-001 with a
   clause that says so. Until one of those happens GA-11 stays FAIL and W-10 stays incomplete.
3. **OD-3 — the six no-clause gaps in §6.** Which of items 1–7 get closed inside Phase 2 before
   acceptance, and which are re-scoped. The replay gap (item 1) is the one that changes the phase's
   GA-13/AC-3d/AC-20 verdicts; items 2–4 change GA-9, AC-7, AC-1 and AC-3c.
4. **OD-4 — AC-6's M and P stages.** The measured stage sequence is `F…X`; the replica and patch
   stages exist only as the transport's own pipeline, and nothing asserts that pipeline as AC-6's M
   and P. Either accept that reading in writing, amend AC-6, or name the phase that gives the
   authority explicit M/P stages. Until then AC-6 is PARTIAL, not PASS.
5. **OD-5 — historical bundles and the plan-relative gate (E1).** Options: accept it and record it
   (historical UDG-003 bundles verify at their own commit, and the records that cite them say so);
   or give the tool the plan identity it needs — the bundle already carries `phase`, so `verify`
   could gate against the requirement set its own `phase` names, which is a `tools/checks` change
   under the narrow evidence-tooling grant and must not weaken any existing check. This submission
   changed no tool behaviour beyond §8.2.1 and does not fix this silently.
6. **OD-6 — the two record defects (D1, D2).** Both are corrections to records, not behaviour; D2 is
   an AC-11 requirement and D1 is a threshold line that currently contradicts its own bundle.
7. **OD-7 — acceptance.** Nothing in this file records or implies acceptance. Dedupe-triggered
   closure remains **disabled** in hashed config, **D4 remains undesignated**, Gate A remains **Not
   Run**, `stackCompatibility` remains **not-established**, and Phase 3 remains **unassigned**.
