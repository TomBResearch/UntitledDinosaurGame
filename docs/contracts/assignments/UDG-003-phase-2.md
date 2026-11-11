# UDG-003 Phase 2 assignment — transport, room and the ADR-0003 obligations

Task ID: `UDG-003` — phase `2` of `3`
Title: Sequenced input transport, `RegionRoom` and adapter wiring, the authoritative per-entity disposition record,
retirement accounting and its consequences, the client-local recovery rules proven by a test-only harness, and the
Gate A substrate (PR-14) — all carried on the accepted Phase 1 authority core.

Status: **Ready — assigned, not started.** Assigned by the project owner on 2026-11-11; no implementation of any work
item in §5 has begun. The implementer named in §4 works only inside the paths granted there.

Owner/reviewer: project owner `TomBResearch`, acting as integration owner and reviewer. The implementer authors no
approval, records no acceptance and passes no gate.

Depends on: UDG-001 (**Verified**), UDG-002 (**Verified**), UDG-003 Phase 0 (accepted as ADR-0002), UDG-003 Phase 1
(**accepted at phase level**), [ADR-0003](../../adr/0003-input-acknowledgement-overflow-and-resynchronisation-policy.md)
(**Accepted, amended 2026-11-11**), the probe and evidence hardening of §7.

Base commit (implementation baseline): `8716b8c6e3c4a3f005fe260eebf5569bb02201dd` — retained CI for that head:
[43079200640](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43079200640), conclusion `success`.

Supersedes: [UDG-003-phase-2-assignment-draft.md](UDG-003-phase-2-assignment-draft.md), which is retained for its risk
record and decision history and no longer carries live scope.

Revisions to this record: introduced by `2bec1a4c1faebe62177229741e2a517012512473` (CI 43116444505) and recorded in
[adoption](../adoption.md#udg-003-phase-2-assignment-recorded-2026-11-11). §8.2.1 — when the capture plan's phase label
moves — was added by the next commit to touch this file; its sha and covering CI run are named in the handoff report,
because a record cannot contain the identifier of the commit carrying it.

Four commits are prerequisites in the sense the evidence gate means: accepted work this phase builds on, each resolved
with `git rev-parse` from this repository's history and confirmed an ancestor of the base commit. The gate reads these
lines, so each sha is written bare.

```text
Prerequisite commit (UDG-001 acceptance): 524658e1fb4c53a450cdf933886c7ad4b17c72e9
Prerequisite commit (UDG-002 acceptance): d364d2dafbc88f469ef60e5e61c5e5c5c6cfd7e4
Prerequisite commit (UDG-003 Phase 0, accepted as ADR-0002): 8987139f18653b05e57e64d0b14cdd1c753b6612
Prerequisite commit (UDG-003 Phase 1, accepted at phase level): 5d77c6125e1c3a8035ae5c0cb5d115e91f008c9c
Prerequisite commit (ADR-0003, the governing decision): 376469b171832adba8363642eaf2723d6528cdbc
Prerequisite commit (probe and evidence hardening baseline): 8716b8c6e3c4a3f005fe260eebf5569bb02201dd
```

## 0. Owner instruction behind this assignment, and what it is *not*

Recorded from the owner's instruction of 2026-11-11:

* the PR-15 and CI evidence fixes reviewed at `8716b8c` with CI `43079200640` are **accepted**;
* **D-P2-2, D-P2-3 and D-P2-4 are approved for Phase 2 implementation** — apply the adopted movement-authority clause,
  make the specified protocol changes and reserve the close codes, and update the active config-hash pins and affected
  fixtures together; **preserve historical evidence and record which baseline it belongs to**; production tuning still
  depends on Gate A measurement;
* **D-P2-6 remains an evidence outcome** — report it either way; deduplication-triggered closure stays **disabled**
  unless the positive-evidence criteria are met;
* **D-P2-7 remains open** — no independent backup destination is designated or authorised;
* **D-P2-8 and D-P2-9 are approved** — amend ADR-0003 §3.2 to match draft §2.1, including at most two actual rejoins in
  a rolling 60 seconds and the four-second episode deadline, and add the dated reference to the R-2 and R-7 fixes with
  their CI evidence;
* the Phase 2 recovery harness stays **test-only**, production client work stays in **UDG-008**, and formal Gate A stays
  in **UDG-SPIKE-001**;
* **Phase 2 is left unstarted** by this instruction and **Gate A remains Not Run**; implementation starts only on an
  explicit later instruction.

What this assignment is **not**:

1. **not Gate A, and not a gate pass of any kind.** Gates A, B and C remain **Not Run**; Gate A's formal execution
   belongs to [UDG-SPIKE-001](../UDG-SPIKE-001.md) after that task's prerequisites are verified (owner decision
   **D-P2-5**). Phase 2 builds the substrate, exercises GA-1…GA-13 against it, and reports criterion evidence. A Phase 2
   record that reads "Gate A passed" is wrong even if every criterion happens to hold;
2. **not a compatibility claim.** `stackCompatibility` remains **not-established** and this assignment does not soften
   it, whatever the probe and criterion outcomes turn out to be;
3. **not authority over Phase 1's accepted core.** `apps/server/src/authority/**` is accepted work; a change there is a
   change to accepted behaviour and needs the owner's explicit instruction (§4.4);
4. **not Part B.** [ADR-P-0002 Part B](../../adr/proposals/UDG-003-compiler-exception-and-input-backlog-posture.md)
   remains unadopted and the [input-consumption rule](../../adr/proposals/UDG-003-input-consumption-rule.md) stays a
   proposal: consumption remains **one** FIFO-selected continuous observation and **one** authority step per connected
   entity per tick. `take(n)` with `n > 1`, `drain()`-to-latest and `InputAccessor.clear()` as a remedy remain outside
   this assignment; ADR-0003 bounds the admitted **rate**, not the consumed count;
5. **not storage provisioning.** D4 has no designated destination and nothing here provisions one;
6. **not Phase 3.** Abuse-suite hardening, the whole-task capture plan and the task-level submission are a separate
   authorisation.

## 1. Owner decisions recorded against this assignment

| item | disposition | what binds Phase 2 |
| --- | --- | --- |
| **D-P2-1** recovery-harness ownership | **Decided** | the ADR-0003 §3.2 client rules are implemented in a **test-only** harness under `tests/support/client-harness/**`. Phase 2 writes **no** production client code and touches no file under `apps/client/`. The frozen rule statement is handed to [UDG-008](../UDG-008.md) as its contract; the harness proves the rules, never the shipped client |
| **D-P2-2** apply the adopted clause | **Approved** | W-1 applies [ADR-0003 §4](../../adr/0003-input-acknowledgement-overflow-and-resynchronisation-policy.md) to [movement-authority.md §5.1](../../interfaces/movement-authority.md) **byte for byte** as adopted; every other clause in that file stays untouched |
| **D-P2-3** protocol edits and close codes | **Approved** | W-2 adds the per-frame `uint32` send sequence to `DirectInputSchema`, the per-entity record fields, the effect ledger and the reserved close codes, with validator, mapping and fixtures. This is a breaking wire change to protocol 1.0.0 and is disclosed as one |
| **D-P2-4** the `configHash` change | **Approved, with the §6 pin discipline** | W-3 declares the envelope and recovery values in `packages/config`; the **active** digest pins and their fixtures move together in one disclosed change, and **historical** evidence keeps the digest of the baseline it belongs to |
| **D-P2-5** where Gate A runs | **Decided** | formal execution in UDG-SPIKE-001; Phase 2 reports measured criteria and keeps Gate A **Not Run** |
| **D-P2-6** the dedupe strand signal | **Open — an evidence outcome, to be reported either way** | `INPUT_STRAND_SUSPECTED` stays **diagnostic**: record, attribute, may throttle, **never close**. Closure on a dedupe signature is enabled **only** if PE-1…PE-5 pass (§5 W-6, GA-12). If they do not pass, the record says so plainly and client-local recovery remains the only remedy. A convenient "validation succeeded" is exactly what PE-2 exists to prevent |
| **D-P2-7** D4 backup destination | **Open** | evidence continues to the existing store only; no new release, tag, archive or storage location |
| **D-P2-8** ADR-0003 §3.2 wording | **Approved and applied 2026-11-11** | §3.2 now carries the resolved recovery budget: 500 ms client-local snapshot deadline expirable with no delivery, a **4000 ms recovery-episode deadline** (`clientRecoveryDeadlineMs`, the operative key name), **at most two actual rejoins in a rolling 60-second window**, and a 250/500/1000 ms ladder that is a schedule rather than an entitlement. Whichever limit is reached first governs, and the behaviour at each limit is a required observation |
| **D-P2-9** forward-pointer in ADR-0003 | **Approved and applied 2026-11-11** | ADR-0003 §7 carries a dated note that R-2 and R-7 are fixed, naming `98cd592…`, `f2b31ad…` and the CI evidence, and recording that the retained red run is disclosed rather than re-run away |

## 2. Baseline, provenance and how this record is identified

| item | value |
| --- | --- |
| Implementation baseline | `8716b8c6e3c4a3f005fe260eebf5569bb02201dd`, CI [43079200640](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43079200640) (success). Implementation branches from here; a later `main` head is re-pinned by the owner at start, not chosen by the implementer |
| Hardening commits inside the baseline | `98cd592fb2b4a35c53eec93f243a24449046faf8` (R-2 capture atomicity + R-7 attribution) · `f2b31ad6eca33c620dd54b1f6c079817f179115f` (R-8 sanitiser fidelity) · `a4b018561d5304630b1a4d9afee09ca24a619c9e` (invocation labelling) |
| Governing decision | [ADR-0003](../../adr/0003-input-acknowledgement-overflow-and-resynchronisation-policy.md), accepted at `376469b171832adba8363642eaf2723d6528cdbc`, **amended 2026-11-11** (§3.2 recovery budget, §6 assignment status, §7 dated fix note) |
| Accepted Phase 1 | `5d77c6125e1c3a8035ae5c0cb5d115e91f008c9c`, CI [43010353106](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43010353106); phase-level acceptance only — UDG-003 is not `Verified` |
| Baseline specification | `UDG-SPEC-M0-002` v0.2, `b51e7afdd6810c377d2d2702d7673119521a59cd0d6b91686700bf9149b73fcf` |
| Contracts version | `UDG-CONTRACTS-M0-001` v1.0, repository edition 1 |
| Active digests at the baseline | `configHash 948f8c10fc404e2ebdb015abc8e30b8e66caf357347db3a2636ace96687a208a`, `movementHash c80f61d451eaf9ee7dc2804ba04f1794e2e0149ac33647932dd14852edf522ce` — W-3 moves the **active** `configHash`; §6 governs how |
| Toolchain at the baseline | Node `24.22.2`, pnpm `12.18.0`; `@colyseus/core 0.18.27`, `@colyseus/sdk 0.18.9`, `@colyseus/ws-transport 0.18.4`, `@colyseus/schema 5.0.45` |
| Suite at the baseline | 535 tests in 26 files; checksum manifest 65 files, in sync; probes `PR-0 49 · PR-1 43 · PR-2 7 · PR-3 10 · PR-8 15 · PR-12 6 · PR-13 20 · PR-15 32`, all `pass`; `PR-14` absent by design and asserted absent |

**The commit containing this record.** This file is carried into `main` by the assignment commit whose title begins
`docs(UDG-003): assign Phase 2`; its 40-character sha and the CI run covering that head are named in the
[adoption entry](../adoption.md#udg-003-phase-2-assignment-recorded-2026-11-11) and in the handoff report, and are not
written here — a commit cannot contain its own hash, and inventing one would be the worst kind of tidy record. The
implementation baseline above is a *code* baseline; it is not the record commit and must not be quoted as one.

## 3. Prerequisite verification

| Prerequisite | Verification | Result |
| --- | --- | --- |
| UDG-001 Verified | [UDG-001.md](../UDG-001.md), adoption entry, acceptance `524658e1…` CI `42511785889` | **Met** |
| UDG-002 Verified | [UDG-002.md](../UDG-002.md), adoption entry, acceptance `d364d2da…` CI `42632130409` | **Met**; its protocol/config surface is what W-2/W-3 amend |
| Phase 0 accepted as ADR-0002 | [ADR-0002](../../adr/0002-server-declaration-checking-exception.md) at `8987139…` CI `42794023731`; 27 vendor declaration diagnostics still pinned | **Met as scoped** — a compiler-policy exception, not a compatibility claim; it does not extend to `apps/client` |
| Phase 1 accepted at phase level | [UDG-003-phase-1.md §0.6](UDG-003-phase-1.md), [completion §16](UDG-003-phase-1-completion.md), accepted `5d77c612…` CI `43010353106`, bundle `/workspace/udg-evidence/ci-run-43010353106` | **Met for the authority core only**; Phase 1 is not task-level `Verified` and authorises nothing beyond that core |
| ADR-0003 accepted | [ADR-0003](../../adr/0003-input-acknowledgement-overflow-and-resynchronisation-policy.md); amended 2026-11-11 on D-P2-8 | **Met**, and it is the policy this phase implements |
| P03 adopted | [adoption](../adoption.md) row `P03 — Approved 2026-11-09`, clarifications Q-01…Q-03 | **Met**; stage Q semantics are unchanged by this assignment |
| Probe and evidence reliability | §7, accepted at `8716b8c…` CI `43079200640` | **Met**; PR-15 is admissible as a Gate A substrate, PR-14 remains reserved |
| Gate A criteria and harness | ADR-0003 §5, [ADR-P-0003 §12.1](../../adr/proposals/UDG-003-d7-input-acknowledgement-policy.md) | Available as specification; **Gate A Not Run** |
| D-7 | decided by ADR-0003 | **Decided**, and not re-opened by this phase |
| D4 evidence backup | [evidence-requirements.md](../../validation/evidence-requirements.md), adoption | **Open** — recorded open here and in every Phase 2 record |

## 4. Exact paths this assignment may create or modify

Grants are narrow and named. A path absent from this list is not granted, however convenient.

### 4.1 Owned paths (new or extended by this phase)

| Path | Disposition |
| --- | --- |
| `apps/server/src/rooms/RegionRoom.ts` | New — room lifecycle, session association with the UDG session epoch, sequenced-input attachment, one observation per entity per tick through the accepted core, disposition publication in the consuming tick |
| `apps/server/src/network/ColyseusInputAdapter.ts` | New — the only module that talks to the SDK input API; retirement accounting per ADR-0003 §3.1 |
| `apps/server/src/network/join-validation.ts` | New — join validation and epoch issuance; never `InputHandle.epoch` |
| `apps/server/src/movement/MovementAuthorityAdapter.ts` | New — binds the room to the Phase 1 core without re-implementing it |
| `apps/server/src/state/map-player.ts` | New/extended — the per-entity disposition record and effect ledger mapping into the replicated schema |
| `apps/server/src/lifecycle/DevelopmentSessions.ts` | New — development sessions and reconnection, bounded and logged |
| `apps/server/src/telemetry/tick-metrics.ts` | New — tick, queue-depth and disposition metrics; no wall-clock gameplay input |
| `apps/server/src/main.ts`, `apps/server/src/server-config.ts` | New — the real server entry the smoke run starts; region-bound startup |
| `tests/reference/flat-direct-step.ts`, `tests/reference/gate-a/**` | New — the PR-14 Gate A substrate: flat reference step plus real replicated state, **no** dependency on locomotion, physics or navigation |
| `tests/support/client-harness/**` | New — the **test-only** recovery harness (§1 D-P2-1); must never be imported by `apps/client` |
| `tests/unit/udg-003/**`, `tests/integration/udg-003/**` | Extended — Phase 2 unit/integration suites and the vector producers |
| `tests/probes/pr14-gate-a.probe.ts` | New — the reserved probe; registers in the probe registry and the contract suite |
| `artifacts/udg-003-phase-2/**` (gitignored) | New — machine-readable Phase 2 vectors; only SHA-256 digests are committed in records |

### 4.2 Supporting paths

| Path | Why |
| --- | --- |
| `tests/probes/colyseus-server.probe.ts` | register PR-14; keep the attribution and ledger contract intact |
| `tests/contracts/UDG-003.test.ts` | Phase 2 assertions, including the invariants in §8.3 |
| `docs/integration/colyseus-0.18-api-map.md` | measured API facts only, each with its probe citation |
| `docs/integration/README.md`, `docs/integration/dependencies.json` | live status and the pinned dependency register |
| `docs/contracts/assignments/UDG-003-phase-2-completion.md` | the completion record, written at submission |

### 4.3 Controlled paths, with the grant

| Path | Grant | Boundary that still applies |
| --- | --- | --- |
| `docs/interfaces/movement-authority.md` | **D-P2-2 (approved)** — W-1 only | the adopted clause text exactly as ADR-0003 §4; no other clause moves |
| `packages/protocol/src/**` | **D-P2-3 (approved)** — W-2 | schema, validator, mapping, close codes; protocol meaning changes are disclosed, not smuggled |
| `docs/contracts/protocol-v1.md` | **D-P2-3** | the documented wire contract must match the shipped one |
| `tests/fixtures/protocol/*.json`, `tests/fixtures/catalog.json` | **D-P2-4 (approved)** — §6 | re-pin digests in the same change that changes the bytes; every refusal fixture must still refuse |
| `packages/config/src/**` | **D-P2-4 (approved)** — W-3 | declare and hash; values provisional-test unless Gate A measures them |
| `tools/checks/src/evidence.ts`, `tools/checks/src/support.ts`, `.github/workflows/ci.yml`, `package.json` | narrowly scoped evidence/CI support only, as with Phase 1 grants A9–A12 | must not weaken an existing gate, and must not touch the accepted §7 behaviours |
| `docs/contracts/checksums.json` | re-pin when a tracked document changes | re-pin is a consequence, never a way to make drift disappear |

### 4.4 Not granted

`apps/server/src/authority/**` (accepted Phase 1 behaviour — any change needs the owner's explicit instruction and
re-opens that phase); `apps/client/**` and any production client code (UDG-008); `packages/physics/**`,
`packages/locomotion/**`, navigation and assets (UDG-005/006/007); `docs/specifications/**`; any accepted completion
record or retained evidence bundle; the pinned dependency set without a separate owner decision; any storage location,
release, tag or archive (D4 open). The escape-hatch prohibitions from Phase 1 continue verbatim: no `any`,
`@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable`, module augmentation, non-null assertion,
`as unknown` or `as never`; no DOM globals in server code; no `Date.now`, `performance.now`, `Math.random`,
filesystem, network or environment access inside the authority core. `skipLibCheck` stays confined to the two
`apps/server` projects named by [ADR-0002](../../adr/0002-server-declaration-checking-exception.md).

## 5. Work items

Each item cites the clause it implements. No item may be dropped silently: an item not completed is reported
incomplete, with the reason.

| id | work | deliverable and clause link |
| --- | --- | --- |
| **W-1** | Apply ADR-0003 §4 to `movement-authority.md` §5.1 exactly as adopted; leave the buffer bound and every other clause untouched | amended interface document; a contract assertion that the applied text matches ADR-0003 §4 byte for byte |
| **W-2** | Protocol surface: per-frame `uint32` send sequence on `DirectInputSchema` declared as the room `seqField`; per-entity record fields `inputResolvedThrough`, `inputGapStart`, `inputGapEnd`, `inputRetiredUnrepresented`; effect ledger (`effectCount`, `lastAppliedRequestId`); reserved close codes for `INPUT_RETIRED_UNREPRESENTED`, `INPUT_RATE_CEILING` and recovery | schema + validator + `to-replica`/`from-replica` + fixtures + `protocol-v1.md`; GA-1…GA-5 |
| **W-3** | Declare and hash `λ`, `B`, `J`, `closureWindowMs`, `closureMaxMs`, `G`, `clientSnapshotDeadlineMs`, `clientRecoveryDeadlineMs = 4000 ms`, the rolling allowance (2 per 60 s) and the close codes, in `packages/config` | config entries + the §6 digest move, disclosed; GA-11 records that production values remain measurement-dependent |
| **W-4** | `ColyseusInputAdapter` + `RegionRoom`: attach the sequenced input, reserve arrival order on receipt, consume exactly one FIFO-selected observation per entity per tick through the accepted core, publish the disposition record **in the consuming tick**, and run join validation and session association on the UDG-owned epoch | room + adapter + suites; GA-1, GA-4, GA-9. The revision-5 receipt-order rule survives: no arrival may overtake one already waiting to be admitted |
| **W-5** | Retirement accounting exactly as ADR-0003 §3.1: per-domain base snapshot, `wasIdle === false` guard, refused frames inside `dequeuedCount`, `clear()` charged, empty ticks contributing nothing, three separate close observations never summed | implementation + vectors proving each clause; GA-1…GA-4 |
| **W-6** | Consequences: `INPUT_QUEUE_PRESSURE` throttles; `INPUT_RETIRED_UNREPRESENTED` closes the seat inside the bounded window with one forced final publication; `INPUT_RATE_CEILING` closes directly; `INPUT_STRAND_SUSPECTED` is recorded and **cannot close** | implementation + evidence that pressure alone never closes, plus the **PE-1…PE-5** determination and its verdict either way; GA-2, GA-3, GA-12 |
| **W-7** | **Test-only** client harness implementing ADR-0003 §3.2 as amended: same-delivery comparison, `INPUT_ACK_STALLED`, the client-local deadline, stop-sending, discard-prediction, bounded rejoin, snapshot recovery, and the recorded behaviour at **each** of the three limits (500 ms deadline, 4000 ms episode deadline, two rejoins per rolling 60 s) | harness + scenario evidence + the frozen rule statement handed to UDG-008; GA-6, GA-7 |
| **W-8** | PR-14 real-state Gate A substrate: flat reference step + real replicated `RegionSchema`/`PlayerSchema`, no locomotion, physics or navigation dependency | `PR-14` probe + registry + contract assertions; substrate for GA-1…GA-13 |
| **W-9** | **Measure** the close-path accounting ADR-0003 §3.1 leaves unmeasured: whether frames still buffered at seat close are dropped without advancing the accessor's consumed count, and therefore whether `serverQueuedAtClose` must enter the retirement total | measurement record + the resulting rule, or an explicit statement that the question is unanswerable on these pins; GA-3, GA-7 |
| **W-10** | Adversarial populations: RTT, jitter, loss, mid-tick arrival, reconnect, offender runs and the **compliant control population** GA-12 requires | `abuse-results.json`, `buffer-depth.csv`, `room-lifecycle.json`, per-criterion vectors; GA-2, GA-9, GA-12 |
| **W-11** | Tick metrics, disposal, and a real server smoke run through the harness; CI steps and the phase evidence gate extended to Phase 2 vectors | metrics + CI + gate; GA-13 |
| **W-12** | Produce the Phase 2 vector set: one machine-readable artefact per GA criterion touched, per reviewer correction, and per §5 item with a numeric claim, with the manifest and gate mirroring Phase 1 | `artifacts/udg-003-phase-2/` + committed digests; GA-13 |

## 6. Digest, fixture and history discipline (owner condition on D-P2-4)

The owner authorised the `configHash` change **and** the condition that pins move together and history keeps its
provenance. Both halves bind.

1. **Active pins move in one disclosed change.** `packages/config` defaults, every assertion of the active digest, and
   the affected protocol fixtures change in the same commit as the values that change them. The new digest is written
   into the completion record and the api-map status line. A commit that changes bytes without moving the pin, or the
   pin without the bytes, is a defect.
2. **Machine-checked active pins at the baseline** — all three must move with W-3/W-2 and be re-pinned in
   `tests/fixtures/catalog.json`:
   `tests/fixtures/protocol/valid.json`, `tests/fixtures/protocol/malformed.json`,
   `tests/fixtures/protocol/ordering.json`.
3. **Historical evidence is immutable.** Recorded digests inside accepted completion records, retained bundles,
   retained vector files and the inventory chain are **never** rewritten, re-stated or "corrected" to the new value.
   [Readiness-proposal rule R-1](UDG-003-readiness-proposal.md) stands: new facts go in new records.
4. **Baseline attribution is required, not implied.** The Phase 2 completion record carries a baseline-to-digest table —
   `UDG-002 baseline` → `configHash 948f8c10…`, `Phase 2 post-W-3` → the new digest — and every retained artefact is
   labelled with the baseline it belongs to, so a reader never has to guess which digest a bundle was produced under.
5. **The UDG-002 suite stays green in intent.** Its assertions must still refuse what they refused: a malformed payload
   still refuses, an out-of-order sequence still refuses, a stale digest in the catalog still fails
   `pnpm test:fixtures`. Relaxing an assertion to accommodate a new field is a scope violation, not a fix. Where an
   assertion legitimately changes, the completion record quotes the old and new expectation and says which clause moved.
6. **`movementHash` is not in scope.** W-3 changes configuration, not movement semantics; if `movementHash` moves,
   that is a finding to escalate under the [ADR procedure](../../adr/README.md), not to accommodate.
7. Production tuning remains Gate A's job (GA-11): the values declared in `packages/config` are provisional test
   settings until measured, and the records say so in the same sentence as the value.

## 7. Reliability baseline this phase builds on (accepted 2026-11-11)

Reviewed at `8716b8c6e3c4a3f005fe260eebf5569bb02201dd`, CI
[43079200640](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43079200640). Two disclosed incidents
and one defect they exposed are fixed, and Phase 2 must not regress any of the four properties below. Full incident
narrative: [the superseded draft §9.1–§9.3](UDG-003-phase-2-assignment-draft.md) and
[ADR-0003 §7](../../adr/0003-input-acknowledgement-overflow-and-resynchronisation-policy.md).

| property | how it is enforced | what Phase 2 must not do |
| --- | --- | --- |
| **One observation, captured once** | `IdentityRoom.snapshot()` copies every array by value and derives `skipped`, `peakSize`, `retiredUnrepresented`, `firstConsumedSeq` and `unnamedLeading` inside the one read, recording `capturedOnce: true`; the settle condition is server-side `accessor.size === 0`, not client `pendingCount` | publish a live reference beside point-in-time scalars; settle a capture on a client counter the SDK can advance on eviction |
| **Exact assertions only where the case is controlled** | the interior-gap case is constructed with steps withheld so `1 → 4, skipped 2` is deterministic; the leading-only case is asserted on its **count** with no interior gap; the uncontrolled burst is asserted only on `consumed + skipped + unnamed = frames sent` | demand an exact gap from a run whose arrival interleaving is not pinned — that is how the pre-fix probe produced false failures — or quietly weaken an exact assertion into an existence check |
| **Every probe invocation attributable** | each result file carries `invocationId`; each invocation writes `artifacts/probes/invocations/<id>/`; `probe-invocations.json` is append-only; the latest index lists every invocation that ever failed; `evidence.js probes` gates it in CI and inside bundle verification | reuse one output path for two invocations; treat a green latest view as proof that no earlier invocation failed; delete or overwrite an invocation directory |
| **Evidence must stay readable** | `sanitiseMachineText` normalises only Windows-style absolute paths, so JSON escapes survive; a contract test requires every probe JSON artefact to remain parseable and machine-root-free after sanitisation | reintroduce a blanket character rewrite into the sanitiser, or file an artefact that no reader can parse |

Retained runs named by this section, all still present in the evidence store:
`ci-run-43070703836` (**failure**, retained with `NOTICE.txt`; it is the run the new attribution gate produced, and the
sanitiser defect it exposed), `ci-run-43074409506`, `ci-run-43077105336`, `ci-run-43079200640` (success). The earlier
incident runs `ci-run-43053089415` and `ci-run-43055416863` keep their `NOTICE.txt` files and are not rewritten.

**PR-15 is admissible as a Gate A substrate** on these fixes (32 checks, `pass`), and **PR-14 remains reserved** for
the Gate A real-state probe until W-8 creates it. A green run after a red one is still not a fix: when a Phase 2 run
fails, retain the bytes, report the rate, and do not re-run for a colour.

## 8. Commands, evidence and gate rules

### 8.1 Required commands

`pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm build`,
`pnpm --filter @udg/server build:probes`, `pnpm --filter @udg/server typecheck:probes`,
`pnpm run declarations:strict`, `pnpm dependencies:verify`, `pnpm test:boundaries`, `pnpm test:fixtures`,
`pnpm test:contract -- --task UDG-001`, `pnpm test:contract -- --task UDG-002`,
`pnpm test:contract -- --task UDG-003`, `pnpm test`, `pnpm contracts:checksums`, `pnpm evidence:probes`,
`pnpm evidence:capture -- --task UDG-003`, `pnpm evidence:verify`.

A command that cannot run is reported as unable, with its error. A zero-test run, a skipped suite or an empty vector
directory is not evidence: the gates refuse them and the submission must say so.

### 8.2 Evidence

Bundles go to the **existing** store (`/workspace/udg-evidence/ci-run-<id>/…`) with the sanitisation and machine-path
rules unchanged; **D4 remains undesignated** and no new storage, release, tag or archive is created. Phase 2 vectors are
produced by the suite into the gitignored artefact directory, gated by the tool rather than by a sentence, and only
their SHA-256 digests are committed. Vector artefacts carry no machine paths. The UDG-003 bundle keeps hashing
`probes/probe-run-index.json` and the probe ledger alongside its vectors, and a Phase 2 bundle additionally names its
own baseline (§6.4).

### 8.2.1 What moves in the capture plan when Phase 2 artefacts land

The UDG-003 capture plan still describes the evidence that exists today, and a bundle captured at this baseline
correctly reports `phase: phase-1` with the 15 Phase 1 vector artefacts, the manifest and `probes/probe-run-index.json`
plus the probe ledger. That label is a claim about the artefacts, not about the task, and it stops being true the
moment Phase 2 evidence is produced. W-11/W-12 therefore move it deliberately, in one disclosed change:

1. the plan's `phase` label becomes `phase-2`, with a scope note saying what the bundle is and is not — the same
   discipline Phase 1 used, where the label exists precisely so a green UDG-001 or UDG-002 bundle cannot be read as
   Phase 2 proof;
2. the required-artefact list gains the Phase 2 vector set and its manifest, and the vector gate runs with the Phase 2
   expectation instead of the default `phase-1` one; a missing, empty, altered or unattributable Phase 2 artefact is a
   gate failure, not a gap in the record;
3. the Phase 1 vector requirement is **not** removed: accepted evidence keeps being captured and gated, so the plan
   carries both sets and each is attributed to its own phase;
4. `pnpm evidence:probes` stays a required step and the probe bytes stay hashed inside the bundle;
5. the bundle names the baseline it was produced under (§6.4), because after W-3 two different `configHash` values are
   legitimately in the record and a bundle must say which one it belongs to.

A capture that reports `phase: phase-1` after Phase 2 vectors exist is a mislabelled bundle, and a capture that renames
the phase while the Phase 1 artefacts are still the only ones present is the same error in the other direction.

### 8.3 Invariants that must survive Phase 2 (regression-asserted, not asserted in prose)

1. the Phase 1 suite stays green **in intent**: one observation per entity per tick, the frozen cutoff, receipt order
   across both admission paths, replay from persisted inputs to the same dispositions, canonical state and chain tip;
2. the UDG-001 and UDG-002 suites stay green in intent, including every refusal fixture;
3. `apps/server/src/index.ts` stays `export {};` unless the owner assigns otherwise, and `@udg/server` gains no package
   export or entry-map row without instruction;
4. `stackCompatibility` stays `not-established` in the machine-readable artefact until the numeric gates pass on real
   transport — and this phase does not declare them passed;
5. no disposition claim is inferred from a client payload field; lifecycle authority comes from the server call path
   only, as in Phase 1 revision 2;
6. the close path never consumes more than one observation per entity per tick, whatever the overflow posture.

## 9. Acceptance, submission and non-claims

Phase 2 is complete when GA-1…GA-13 of ADR-0003 §5 have **measured criterion evidence** on the W-8 substrate together
with AC-1…AC-20 and the numeric measures; when every scenario replays from its recorded journal to the same
dispositions, canonical state and chain tip; when the D-P2-6 determination is reported with its outcome, whichever way
it fell; and when the §6 digest discipline is satisfied with its baseline table. **A criterion with a missing,
unverifiable or non-replayable artefact is FAIL, not "not run."**

Submission is **In Review** with source, tests, exact SHAs, CI links and verified bundles. Acceptance is recorded by the
owner alone; a phase-level acceptance would still leave UDG-003 **In Progress**, because Phase 3 and the gates remain.

Explicit non-claims at assignment time: no work item is started; **Gate A is Not Run**; Gate A's formal execution is
UDG-SPIKE-001's; no production client behaviour exists; no protocol file has been edited; no digest has moved;
`stackCompatibility` is **not-established**; Part B is **unadopted**; D4 is **undesignated**; Phase 3 is
**unassigned**.

## 10. Stale references reconciled by this handoff

A record that assigns new work while older live surfaces still say the work is unassigned is a record that will be
misread, so the following were updated in the same change as this assignment. Dated historical narrative inside
investigation records is deliberately left as written, and says when it was written.

| surface | change |
| --- | --- |
| [UDG-003.md](../UDG-003.md) | implementation status and assignment line now say Phase 2 is **assigned, Ready, unstarted**, with the baseline and this record linked; the draft is no longer the live pointer |
| [adoption.md](../adoption.md) | new dated entry `UDG-003 Phase 2 assignment recorded 2026-11-11` carries the decision table, the record commit and the covering CI run; the D-7 entry's provisional-settings row keeps its historical wording and gains a dated pointer to the amended §3.2 |
| [ADR-0003](../../adr/0003-input-acknowledgement-overflow-and-resynchronisation-policy.md) | §3.2 amended (D-P2-8), §6 now reads "assigned, none performed" with Gate A located in UDG-SPIKE-001, §7 carries the dated R-2/R-7 fix note (D-P2-9), and the header's live status replaced "Phase 2 and Phase 3 remain unassigned" |
| [ADR-0003's proposal paper](../../adr/proposals/UDG-003-d7-input-acknowledgement-policy.md) | its live-status paragraph now says Phase 2 is assigned and unstarted, and restates PR-15 at 32 checks; its decision-disposition table and dated reasoning stay as written |
| [this file's draft](UDG-003-phase-2-assignment-draft.md) | header marked **Superseded**, retaining the risk record and decision history |
| [readiness proposal](UDG-003-readiness-proposal.md) rule R-2 | a dated pointer notes that the owner authorised a deliberate, disclosed `configHash` change on 2026-11-11; the rule's prohibition on **silent** digest change stands unchanged |
| [api map](../../integration/colyseus-0.18-api-map.md) | dated Phase 0 narrative left intact — it says when it was written and is the evidence for ADR-0002 |

Still open after this handoff: **D-P2-7** (D4 destination, undesignated), **D-P2-6** (an evidence outcome Phase 2 must
report either way), Gate A **Not Run**, Part B **unadopted**, Phase 3 **unassigned**, `stackCompatibility`
**not-established**, and UDG-003 **In Progress**.
