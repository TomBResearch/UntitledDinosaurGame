# W-A repair — the episode tallies are read where cleanup cannot reach them

Reviewer-directed, on the cause demonstrated in §17 of
[`UDG-003-phase-3-wa-diagnosis.md`](UDG-003-phase-3-wa-diagnosis.md). Scope as directed: harness and producer
instrumentation only. Deadlines, retry limits, close codes and every accepted assertion keep their values.

## 1. What changed, and where the reading moved

| | before | after |
| --- | --- | --- |
| `stateApplicationsDuringTheEpisode` | `ep.applied.length` read at artefact assembly (`impairment-population.ts:931`), after `restore()` and during `await room.leave(true)` | `epEpisodeEnd.stateApplicationsAtEpisodeEnd - stateApplicationsAtSilence`, both read at the policy-defined episode end (`:856`), before `restore()` (`:906`) and before `leave()` (`:907`) |
| `deliveriesReachingTheSeatDuringTheEpisode` | post-close counter sample | same snapshot |
| `publicationsSwallowedAtTheWrapper` | post-close counter sample | same snapshot |
| `resolvedThroughAtClose`, `epochAtClose` | row read after the post-close waits | row read at episode end, which is what the names claim |
| `recoveryEvents` | event list read at artefact assembly | event list read at episode end |
| `freshAuthoritativeSnapshotArrived` | mixture: counters from one instant, tally from another | one snapshot, so the flag and the tallies can no longer disagree |
| `surfacedError.socketClosedDuringEpisode` | post-close sample | episode-end sample; the later reading is retained in `cleanup` |

The snapshot is published inside the artefact as `snapshotAbsence.episodeEndSnapshot`, and the teardown
readings are published separately as `ga6Ga7.ga6cEpisodeDeadline.cleanup`. Nothing that used to be measured is
dropped; what changed is which of the two readings an assertion is allowed to consult.

The harness gained one counter field, `restored` (`impairment.mjs`, `impairment.d.mts`), because `silencing`
alone cannot date a reading: the layer keeps reporting the silence it was told to enforce after `restore()` has
taken it off the socket. That is asserted, not assumed, in `wa-cleanup-window.test.ts`.

## 2. The controls the reviewer asked for

**A callback during cleanup cannot alter the episode result.**

- `tests/system/udg-003-phase-3/wa-cleanup-window.test.ts` (3 tests) drives the **accepted harness** over a
  stand-in connection — no room, no network, no timers. It takes one snapshot while the layer is still on the
  socket, then restores and lets three more frames through: the callbacks really do fire
  (`applied` +3), the delivery counter records **none** of them (`+0`, because it is off the socket), and the
  snapshot is unmoved. The third test reads the producer's own structure: `snapshotAbsence` derives from
  `epEpisodeEnd` and contains neither `ep.applied.length` nor `epRowAfter`, and the snapshot statement precedes
  the restore statement.
- `wa-audit-falsification.test.ts` gives the same property over bytes: with `cleanup` recording three
  applications, a delivery, sixteen swallowed publications and a moved watermark/epoch — the exact demonstrated
  shape — the audit exits 0 with no failing check.

**A state application during the episode still fails.** The same file mutates the snapshot itself
(`stateApplicationsAtEpisodeEnd = atSilence + 1`, asserted delta 1) and requires `w7-state-applications` to
fail **and** the recomputation check to pass, i.e. the red is attributed to the episode and not to the
teardown. A third control covers the shape the repair removes: writing the asserted `1` while the snapshot says
`0` is refused twice over — by the accepted reading and by `w7-state-applications-recompute-from-snapshot`,
because the audit recomputes the delta from the snapshot instead of trusting the field.

A fourth control refuses a snapshot taken after the layer came off (`wrapperRestored: true`) or no longer
silencing, and a fifth asserts that an artefact captured before the repair is claimed by none of the new
checks. `wa-audit-falsification.test.ts`: 14 tests.

## 3. The audit, and no retroactive judgement

| artefact | checks | verdict |
| --- | --- | --- |
| repaired bytes (this run's `artifacts/udg-003-phase-2`) | 91 | 91/91 pass |
| pinned clean control (captured 2026-11-17, pre-repair shape) | 84 | 84/84 pass |
| historical red `UDG-003-2026-11-14T11-57-52-546Z-81a341fb` | 84 | 83/84, still named by exactly `w7-state-applications` |

The seven new checks are claimed only of bytes that carry the snapshot and cleanup blocks. An older artefact is
judged exactly as it was before, which is the same rule that keeps every historical bundle in the store
verifying as it did.

## 4. The declared ten-pass streak, rerun on the repaired implementation

Declaration unchanged and unchanged-before-the-streak
(`UDG-003-phase-3-wa-declaration.json`, four busy-spinner processes, full `pnpm test` order, ten passes, scored
per case id out of each iteration's own junit). Clean tree, `workingTreeDirty: false`.

| | |
| --- | --- |
| Tree | `79984f9e271b5f1615a17081f0a215c2d9a5a6db` |
| Started / finished | `2026-11-18T11:33:48.768Z` → `2026-11-18T11:52:22.654Z` (18 m 34 s) |
| Per-iteration wall | 110.5 – 112.4 s |
| **W-7** | **10/10** consecutive, `firstRedIteration: null` |
| **P-2b** | **10/10** consecutive, `firstRedIteration: null` |
| Per-assertion audit | 91/91 in all ten iterations, `auditFailures: []` |
| Suite exit | non-zero in all ten (the four known container reds, listed in the record) |
| Record | `UDG-003-phase-3-wa-streak.json`; per-iteration `junit.xml` and `wa-assertion-audit.json` under `artifacts/udg-003-phase-3/wa-streak/iter-01…10` |
| Previous streak | preserved verbatim as `UDG-003-phase-3-wa-streak-142b080.json` |

Four reds appeared, in all ten iterations: the Node pin, the foreign-host register, and their two cascades in
UDG-002. The earlier streak had seen seven, including two load-contention reds and a stale browser artefact;
those three did not recur here, and that is disclosed rather than presented as an improvement — the streak is
scored per case id, and the two affected cases did not move in either run.

## 5. What the streak does and does not establish

The reviewer's instruction stands as written: **a passing rerun does not establish the cause.** Ten green
iterations say the repaired measurement is stable under the declared load and order, and that nothing else
about the case's behaviour changed. The cause rests on other evidence: the retained artefact whose two readings
of one tally disagreed, the pinned SDK's `leave()`/`leaveCode` behaviour, and the harness fact that callbacks
fire after `restore()` — each demonstrated independently of how many green runs follow.

Also unchanged: the `W-7` **delivery-count** sighting, the `mappingMatchesTheAuthoritysOwnRecord` mismatch, the
post-close input observation and `P-2b` remain four separate things, each classified only as far as its own
bytes support (§§12-18). None was touched here, and none can be reached by this repair: a delivery still has to
pass through the wrapper to be counted, and the stage-sequence and post-close readings live in other producers.
