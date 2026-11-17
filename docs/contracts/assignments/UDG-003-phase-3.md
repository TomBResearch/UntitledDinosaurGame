# UDG-003 Phase 3 assignment — abuse, evidence, CI, the `W-7`/`P-2b` defects, and the task-level submission

Task ID: `UDG-003` — phase `3` of `3`
Title: Task-level abuse and evidence completion on the accepted Phase 1 + Phase 2 substrate: the `W-7`/`P-2b`
diagnosis-and-repair (W-A), the whole-task capture (W-C), the task-level suites and records, and the task-level
submission that is UDG-003's path to Verified.

Status: **Assigned — Ready, implementation NOT started.** Assigned by the project owner on 2026-11-17 (dated by
the commit carrying this record): implementer **Pi**, reviewer and integration owner **`TomBResearch`**.
Work begins **only on the owner's separate build instruction**, which must name the implementer and reviewer;
nothing in this record starts implementation. UDG-003 as a whole stays **In Progress**; **Gate A remains
Not Run**; deduplication-triggered closure remains **disabled**; **D4 remains open**; `stackCompatibility`
remains **not-established**; Part B remains **unadopted**.

Owner/reviewer: project owner `TomBResearch`, acting as integration owner and reviewer. The implementer authors
no approval, records no acceptance and passes no gate.

Depends on: UDG-001 (**Verified**), UDG-002 (**Verified**), UDG-003 Phase 0 (accepted as ADR-0002), UDG-003
Phase 1 (**accepted at phase level**), UDG-003 Phase 2 (**accepted at phase level**), UDG-004 (**accepted /
Verified 2026-11-16**), [ADR-0003](../../adr/0003-input-acknowledgement-overflow-and-resynchronisation-policy.md)
(**Accepted, amended 2026-11-11**).

Base commit (implementation baseline): `eafe306578b64be37e6fd93a8b9f301ab3e43cf6` — retained CI for that head:
[43965274365](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43965274365), conclusion
`success` (the records head of the Phase 3 draft publication; implementation tree byte-identical to
`70f6d17`, whose run `43947298628` was green on the first attempt). A later `main` head is re-pinned by the
owner at start, not chosen by the implementer.

Supersedes: [UDG-003-phase-3-assignment-draft.md](UDG-003-phase-3-assignment-draft.md), retained for its
measurement history, its §0 owner directions and its dated §0 addenda (including the two unclassified red runs
of the publication sitting). Where this record and the draft differ, **this record governs**.

Six commits are prerequisites in the sense the evidence gate means, each resolved with `git rev-parse` from
this repository's history and confirmed an ancestor of the base commit. The gate reads these lines, so each sha
is written bare.

```text
Prerequisite commit (UDG-001 acceptance): 524658e1fb4c53a450cdf933886c7ad4b17c72e9
Prerequisite commit (UDG-002 acceptance): d364d2dafbc88f469ef60e5e61c5e5c5c6cfd7e4
Prerequisite commit (UDG-003 Phase 0, accepted as ADR-0002): 8987139f18653b05e57e64d0b14cdd1c753b6612
Prerequisite commit (UDG-003 Phase 1, accepted at phase level): 5d77c6125e1c3a8035ae5c0cb5d115e91f008c9c
Prerequisite commit (UDG-003 Phase 2, accepted at phase level): 6e0e5cc839f3d501a26998172438ded51914335d
Prerequisite commit (UDG-004 acceptance): 76db480892fa4aa21bd79c1bf7e939b5ddb6315e
Prerequisite commit (ADR-0003, the governing decision): 376469b171832adba8363642eaf2723d6528cdbc
Prerequisite commit (Phase 3 draft, published and green): 70f6d17ac4c8c5d4e064fd744d48c7b474634d01
```

## 0. Owner instruction behind this assignment, and what it is *not*

Recorded from the owner's instructions of 2026-11-17 (three sittings: scope approved in principle; the draft
published at `70f6d17` with its directions; this finalisation):

* **Phase 3 is assigned**, Pi as implementer, `TomBResearch` as reviewer, against implementation baseline
  `eafe3065…` (still current at finalisation — `origin/main` was re-checked and had not moved);
* **D-P3-4 is ruled**: a separate whole-task capture is approved in principle, with the distinct selector,
  verifier-selection, CI-timing and runtime terms of §5 W-C — the existing phase plan and all historical
  evidence are preserved;
* **D-P3-9 is ruled**: the W-A repeatability check is ten consecutive passes per defect under a declared load
  and test order (declared **before** the streak, results retained), plus a first-attempt hosted green on the
  exact submission; **W-7 and P-2b stay separate diagnoses**; the two red runs of the publication sitting
  (`43956003339`, `43962098658`) **stay unclassified** unless logs or retained evidence identify their failing
  assertions;
* the owner's §0 directions in the superseded draft (harness grant bounded to a demonstrated cause; deadlines,
  retry limits, close codes and guarantees preserved; failures kept visible) carry into this record verbatim in
  §5–§7;
* **implementation remains unstarted** by this instruction and **Gate A remains Not Run**.

What this assignment is **not**:

1. **not Gate A, and not a gate pass of any kind.** Gate A's formal execution is
   [UDG-SPIKE-001](../UDG-SPIKE-001.md)'s; GA-11's two production inequalities, the production envelope values
   and the eviction consequence stay there. A Phase 3 record that reads "Gate A passed" is wrong even if every
   criterion happens to hold;
2. **not a compatibility claim** — `stackCompatibility` stays **not-established**;
3. **not authority over accepted phases** — `apps/server/src/authority/**` (Phase 1) and the accepted Phase 2
   transport, harness and records are accepted work; a change needs the owner's explicit instruction, and the
   W-A harness grant is the only exception, bounded to instrumenting and fixing a **demonstrated** cause;
4. **not Part B** — [ADR-P-0002 Part B](../../adr/proposals/UDG-003-compiler-exception-and-input-backlog-posture.md)
   stays unadopted; consumption remains one FIFO-selected observation and one authority step per connected
   entity per tick;
5. **not storage provisioning** — D4 has no designated destination; evidence goes to the existing store only;
6. **not the client** — `apps/client/**` stays UDG-008's; GA-10a, GA-10b, the discrete queue limits and AC-6's
   `P` results half stay UDG-007's acceptance obligations.

## 1. Owner decisions recorded against this assignment

| item | disposition | what binds Phase 3 |
| --- | --- | --- |
| **D-P3-1** assignment | **Decided 2026-11-17** | implementer Pi; reviewer `TomBResearch`; baseline `eafe3065…` CI `43965274365` success; build instruction separate; re-pin by the owner if `main` moves before start |
| **D-P3-2** shared tooling turn | **Decided (publication sitting, §0 of the draft)** | Phase 3 takes the next single-writer turn on the six shared files after UDG-004's accepted first use; as second lander it rebases and re-runs `pnpm test:contract -- --task UDG-003`, `--task UDG-004` and `pnpm test:e2e -- --suite camera` on the integrated head (M-5/M-6) |
| **D-P3-3** `W-7` remedy class | **Decided (publication sitting)** | option (i): fix inside UDG-003's own suite as W-A; keep-rerunning and CI reordering are rejected; the interim rerun-and-record discipline stands until W-A lands, with every red retained |
| **D-P3-4** whole-task capture | **Ruled at finalisation — §5 W-C in full** | separate whole-task capture approved in principle with the selector `UDG-003-TASK`; the existing `UDG-003` phase plan and all historical bundles are preserved and keep verifying; the verifier selects plans by content (§5 W-C.2); CI runs the whole-task capture from the W-C landing commit on, every run, appended to the existing plans loop; the added CI runtime is stated up front (§5 W-C.4) |
| **D-P3-5 / D-P3-9** W-A repeatability | **Ruled at finalisation — §5 W-A** | ten consecutive passes per defect under the declared load and test order; declaration written before the streak and retained with results; first-attempt hosted green on the exact submitted commit; a targeted reproducer or failing control per defect; an unreproducible failure is reported from the retained evidence before any change is proposed |
| **D-P3-6** harness grant | **Granted, bounded** | G-P3-2 reaches instrumenting and fixing a **demonstrated** cause in `tests/support/client-harness/**` only; the demonstration precedes the edit |
| **D-P3-7** D4 | **Open — reconfirmed** | existing store only; no new release, tag, archive or storage location |
| **D-P3-8** non-goals | **Reconfirmed** | Gate A **Not Run**; production tuning and any compatibility claim outside this assignment; dedupe-triggered closure disabled; no dependency pin moves; no protocol/config-value changes — the provisional envelope values stay provisional |
| **the two publication-sitting reds** | **Unclassified** | `43956003339` (test step) and `43962098658` (capture gate) on docs-only heads whose tree was byte-identical to the green baseline; shape-consistent with `W-7`/`P-2b` respectively, asserted nowhere; they enter W-A's step-1 table only if the bytes (owner-read run logs or retained artefacts) name the failing assertion |

## 2. Baseline, provenance and how this record is identified

| item | value |
| --- | --- |
| Implementation baseline | `eafe306578b64be37e6fd93a8b9f301ab3e43cf6`, CI [43965274365](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43965274365) (success). Records head of the Phase 3 draft; implementation tree byte-identical to `70f6d17` (CI `43947298628`, success, first attempt) |
| Red runs on the identical tree | `43956003339` (failed at `Run the unit and Node integration suites`) and `43962098658` (failed at `Capture the evidence bundles` / `Verify the captured evidence bundles`), both docs-only heads; **unclassified** (§1); recorded in the superseded draft §0 and in [UDG-004-completion.md](UDG-004-completion.md)'s running account. **Dated amendment (assignment sitting, same day):** a third — the assignment record's own naming commit `4c5a7675166ab00c120d34b016300d3cec7c1375`, run [44054653793](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44054653793), **failure at `Capture the evidence bundles` / `Verify the captured evidence bundles` with the test step green**, docs-only like the others; also **unclassified** — same recorded shape as `43962098658`, no log access, no assertion claimed. The assignment commit itself (`e58f32ce…`, run `44050911889`) was green, so the baseline `eafe3065…` stands. **Second amendment (same sitting, extended):** the commit recording that third red — `2daace842d1fc70029b603cd79ff8bf07518c8a8`, run [44056946395](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44056946395) — went red **at the same two steps**, and its own successor `54d3372586a9e1979baffa771db98d7247278f5a`, run [44059160018](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/44059160018), red at the same two steps again — five unclassified docs-only reds on the one unchanged implementation tree in a single day, against two greens (`43947298628`, `44050911889`) and the baseline `43965274365`. That record commits on an unchanged tree now go red about as often as green **is the finding**, and it is the one W-A exists to fix. **Naming-chain closure (this record's final amendment of the sitting):** the commit carrying this paragraph closes the per-commit naming chain; the outcome of *its own* hosted run does not spawn a further record — whatever colour it is, it joins this tally through W-A's step-1 table when the build instruction lands. Until then every docs-only run on this tree is tallied here or in the completion record, retained, never chased, and none of it re-opens the assignment: `e58f32ce…` is green (`44050911889`) and the baseline `eafe3065…` stands |
| Governing decision | [ADR-0003](../../adr/0003-input-acknowledgement-overflow-and-resynchronisation-policy.md) at `376469b1…`, amended 2026-11-11 — the recovery machine W-A must not change |
| Accepted Phase 2 | `6e0e5cc8…` CI `43584855957` (572 tests); records at `f0c8ccde…` CI `43586339612`; phase-level only |
| Accepted UDG-004 | implementation `d318444`, acceptance `76db480`, run `43931959796` (616 tests / 0 failures; camera suite 8/8 on chromium-1254) |
| Suite at the baseline | 616 tests in 30 files; capture plans for UDG-001, UDG-002, UDG-003 (phase-1 + phase-2 sets) and UDG-004, all PASS at the baseline run; probes all `pass`; `PR-14` present |
| Baseline specification | `UDG-SPEC-M0-002` v0.2, `b51e7afdd6810c377d2d2702d7673119521a59cd0d6b91686700bf9149b73fcf` |
| Contracts version | `UDG-CONTRACTS-M0-001` v1.0, repository edition 1 |
| CI runtime at the baseline (measured, run `43965274365`) | job 24.6 min; `Capture the evidence bundles` 16.6 min over the four existing plans — the number W-C's added runtime is measured against |

**The commit containing this record.** This file is carried into `main` by the assignment commit whose title
begins `docs(UDG-003): assign Phase 3`; its 40-character sha and the CI run covering that head are named in the
[adoption](../adoption.md) entry's follow-up records commit and in the handoff report — a commit cannot contain
its own hash, and inventing one would be the worst kind of tidy record. The implementation baseline above is a
*code* baseline; it is not the record commit and must not be quoted as one. The **handoff** is this record's
commit: implementation branches from the baseline, and the submission must be green on the merge of its branch
with current `main` (M-5).

## 3. Prerequisite verification

| Prerequisite | Verification | Result |
| --- | --- | --- |
| UDG-001 Verified | [UDG-001.md](../UDG-001.md), acceptance `524658e1…` CI `42511785889` | **Met** |
| UDG-002 Verified | [UDG-002.md](../UDG-002.md), acceptance `d364d2da…` CI `42632130409` | **Met** |
| Phase 0 accepted as ADR-0002 | `8987139…` CI `42794023731` | **Met as scoped** |
| Phase 1 accepted at phase level | `5d77c612…` CI `43010353106`; completion §16 | **Met for the authority core only** |
| Phase 2 accepted at phase level | `6e0e5cc8…` CI `43584855957`; completion §21; matrix §21 | **Met for the transport substrate only** |
| UDG-004 accepted | `d318444` / acceptance `76db480`, CI `43931959796` | **Met**; UDG-004's acceptance released the shared-tooling turn (D-P3-2) and keeps `W-7` under UDG-003 |
| ADR-0003 accepted | `376469b1…`, amended 2026-11-11 | **Met**; the machine W-A must preserve |
| P03 adopted | adoption row `P03 — Approved 2026-11-09` | **Met** |
| Phase 3 draft published green | `70f6d17` CI `43947298628` success, first attempt | **Met**; superseded by this record |
| Gate A criteria and harness | ADR-0003 §5, ADR-P-0003 §12.1 | Available as specification; **Gate A Not Run**; formal execution stays UDG-SPIKE-001's |
| D4 evidence backup | evidence-requirements, adoption | **Open** — recorded open here and in every Phase 3 record |

## 4. Exact paths this assignment may create or modify

Grants are narrow and named. A path absent from this list is not granted, however convenient.

### 4.1 Owned paths (new or extended by Phase 3)

| Path | Disposition |
| --- | --- |
| `tests/system/udg-003-phase-2/runtime.test.ts`, `tests/runtime/udg-003-phase-2/impairment-population.ts`, `tests/runtime/udg-003-phase-2/recovery-scenarios.ts` | W-A only — the diagnosis-selected fix and its regression assertions; every other assertion in these files stays byte-identical |
| `tests/support/client-harness/impairment.mjs`, `impairment.d.mts`, `recovery.ts`, `transport.mjs` | W-A only, under grant **G-P3-2**, bounded to **instrumenting and fixing a demonstrated cause**; no deadline, ladder, allowance or close-code value moves |
| `tests/system/udg-003-phase-3/**`, `tests/unit/udg-003/**`, `tests/integration/udg-003/**` | W-B task-level abuse/offender/buffer-depth suites and producers; W-A's standalone diagnosis entry points live here, not in the accepted files |
| `artifacts/udg-003-phase-3/**` (gitignored) | Phase 3 vectors; only SHA-256 digests are committed in records |
| `docs/contracts/assignments/UDG-003-phase-3-completion.md`, `UDG-003-completion.md`, `UDG-003-evidence.json`, `UDG-003-phase-3-evidence-matrix.md` | this phase's and the task's completion records, matrices, and the sanitised machine-readable evidence summary |

### 4.2 Supporting paths

| Path | Why |
| --- | --- |
| `tests/contracts/UDG-003.test.ts`, `tests/probes/colyseus-server.probe.ts` | task-level assertions over the new artefacts; the Phase 1/2 assertions keep passing in intent |
| `docs/integration/colyseus-0.18-api-map.md`, `docs/integration/README.md` | measured API facts and live status only |

### 4.3 Controlled paths, with the grant

| Grant | Path | Limited to | Boundary that still applies |
| --- | --- | --- | --- |
| **G-P3-1** | `tools/checks/src/evidence.ts` | W-C only, exactly the §5 W-C.1–W-C.3 changes; the new plan key appended (M-2) | the accepted plans keep their pinned digests (`UDG-001 3b450c283d165361`, `UDG-002 754df194a28d1e0a`, `UDG-003 3b93cfbbd9ca818e` as pinned in `tests/contracts/UDG-004.test.ts`); accepted bundles keep verifying (U2-1) |
| **G-P3-2** | `tests/support/client-harness/**` | W-A, instrumenting and fixing a demonstrated cause only | the demonstration precedes the edit; §5 W-A's preserve-list binds |
| **G-P3-3** | `.github/workflows/ci.yml` | steps appended (M-3) — the Phase 3 vectors gate and, if §5 W-C.4's measurement demands it, nothing else | no renumbering, no `continue-on-error`, `retries: 0` untouched (M-7); the capture/verify/upload steps stay as they are — the plans loop picks the new selector up automatically |
| **G-P3-4** | `docs/contracts/checksums.json`, `docs/integration/dependencies.json`, `pnpm-lock.yaml` | regenerated **by command** in the landing commit (M-4) | **no pin move is in scope**; a needed pin change stops and escalates |
| **G-P3-5** | `tests/contracts/UDG-001.test.ts`, `tests/contracts/UDG-004.test.ts`, `tests/unit/udg-004/evidence-gates.test.ts` | **only** assertions that the new plan key demonstrably invalidates (plan-key enumeration, upload-coverage enumeration) | enumerate old and new expectation in the completion record; refusal demonstrations stay refused; the E-6 accepted-plan digests and accepted-bundle verification must keep passing unedited |
| **G-P3-6** | `docs/contracts/UDG-003.md`, `README.md`, `docs/contracts/adoption.md` | status truth and records | adoption entries and acceptance lines are written on the owner's instruction; historical narrative stays dated-as-written |

### 4.4 Not granted

`apps/server/src/authority/**` (accepted Phase 1); `apps/client/**` (UDG-008); `packages/protocol/**`,
`packages/config/**`, `docs/contracts/protocol-v1.md` (no wire or config change belongs to Phase 3 — one is a
finding to escalate); `apps/server/src/**` (no production server change is planned; if W-A's diagnosis lands
on a production path it stops and escalates under the [ADR procedure](../../adr/README.md));
`docs/specifications/**`; any accepted completion record, retained bundle, historical inventory version or
accepted capture-plan entry; the pinned dependency set; any storage location, release, tag or archive (D4).
Phase 1/2 escape-hatch prohibitions continue verbatim: no `any`, `@ts-ignore`, `@ts-expect-error`,
`@ts-nocheck`, `eslint-disable`, non-null assertion, `as unknown` or `as never`; no DOM globals in server code;
no `Date.now`, `performance.now`, `Math.random`, filesystem, network or environment access inside the authority
core; `skipLibCheck` confined to the two ADR-0002 projects. **Specifically for W-A:** no retry, no
`.skip`/`.only`, no quarantine, no widened deadline, no exact assertion softened into an existence check.

## 5. Work items

No item may be dropped silently: an item not completed is reported incomplete, with the reason.

| id | work | deliverable |
| --- | --- | --- |
| **W-A** | **`W-7` and `P-2b`: diagnose, then fix — as two potentially separate defects.** Step 0 separates them; step 1 names the exact failing assertion per retained attempt from the bytes (including the two unclassified publication-sitting reds, classified only if bytes identify them); step 2 runs the standalone reproducers under the declared load; step 3 names the mechanism; the fix (G-P3-2) is minimal and applied only to a demonstrated cause. Full protocol and the repeatability check: §6 | diagnosis record with the per-attempt assertion table; per-defect reproducer or failing control; the declared load/order written before the streak; ten-pass streak outputs retained; fix commit(s) with the §6.3 regression assertions green |
| **W-B** | Task-level abuse/offender/buffer-depth suites: sustained-abuse buffer cap, offender survival and observer isolation re-proved at task level; task-level `abuse-results.json`, `buffer-depth.csv`, `room-lifecycle.json` | hardening suites + task-level artefacts under the whole-task gate |
| **W-C** | **The whole-task capture (§5.1–§5.4) and CI steps.** Phase 1 (15 artefacts) and Phase 2 (27 artefacts) sets keep being captured and gated inside their own plan; the probe step and ledger stay hashed in every bundle | appended `CAPTURE_PLANS` key; collector changes §5.2; vectors gate step (`--expect-phase phase-3` style, beside the phase-1/phase-2 steps); refusals proven |
| **W-D** | Task-level completion record: AC-1…AC-20 and GA ledgers closed against accepted Phase 1 + Phase 2 evidence plus Phase 3's; the baseline-to-digest table (`948f8c10…` → `2743a9a0…`); carried obligations named (GA-10a/b, discrete limits and `P`'s results half → UDG-007; production client, both recovery paths, prediction buffer → UDG-008; GA-11, formal GA-6/GA-7, GA-12/PE-1…PE-5 and Gate A → UDG-SPIKE-001) | completion record + verified bundles, submitted **In Review** |
| **W-E** | Stale-surface reconciliation with the owner's pen where required (status lines, adoption entries) | reconciled surfaces at submission |

### 5.1 W-C — the selector (D-P3-4, as ruled)

A **new plan key `UDG-003-TASK`** is appended at the end of `CAPTURE_PLANS`. It is a second *selector*, not an
edit to the task's plan: the existing key `UDG-003` — its `phase: { label: 'phase-2', … }`, thresholds,
reportProse, manifests and command list — stays **byte-identical** (M-2; the pinned digest in
`tests/contracts/UDG-004.test.ts` keeps passing unedited). The new plan declares `taskId: 'UDG-003'` — so the
task-contract digest, the prerequisite SHAs and the measurements all remain UDG-003's — and
`phase: { label: 'task', note: … }` where the note carries the non-claims (Gate A **Not Run**; GA-11 not
evaluated; nothing about UDG-007/UDG-008 obligations). Selector command:
`pnpm evidence:capture -- --task UDG-003-TASK`, producing RUN_ID `UDG-003-TASK-<UTC>-<sha>`, pointer
`artifacts/latest-UDG-003-TASK.txt` and summary `UDG-003-TASK-ci-summary.json` — all visibly distinct from the
phase bundle's `UDG-003-<UTC>-<sha>` family, and all already covered by the existing upload globs
(`artifacts/UDG-*-*`, `artifacts/latest-*.txt`, `artifacts/*-ci-summary.json`).

### 5.2 W-C — the collector changes, minimal and enumerated (grant G-P3-1)

1. `capture()` resolves the measurements file by selector key and **falls back to `plan.taskId`** when the
   key-named file is absent; `commands.json` and bundle metadata record `plan.taskId` as the bundle's task. For
   every accepted plan the selector key equals `plan.taskId`, so behaviour is **provably unchanged** — a
   negative demonstration shows each accepted plan capturing byte-identically before and after the edit.
2. `verify()`'s plan resolution becomes content-driven: a bundle whose `report.json` declares
   `phase: "task"` resolves to `CAPTURE_PLANS['UDG-003-TASK']`; **every other bundle resolves exactly as
   today** (`CAPTURE_PLANS[report.taskId]`). Selection is by the declared label, not the directory name, so a
   renamed or copied bundle cannot pick its plan.
3. The phase-pairing rule (R-2) extends to the new label: a `task`-labelled bundle must carry
   `measurementsScope` for the whole task and all three vector manifests — Phase 1 (15), Phase 2 (27), Phase 3 —
   each attributed to its own phase; a missing, empty, altered or unattributable artefact is a gate failure.

### 5.3 W-C — how the verifier selects the correct plan (new and historical)

* **Historical bundles** (no `phase` label, or `phase-1`, or `phase-2`): resolved by `report.taskId` as today;
  their digests, bundles, inventories and manifests are never rewritten. Demonstration **E-6′**: at the
  submitted commit, every sibling bundle visible in the store — UDG-001, UDG-002, UDG-003 phase bundles,
  UDG-004 — verifies **PASS 0 issues**, unedited.
* **New whole-task bundles**: resolved only by the `task` label to the new plan. Negative demonstrations: a
  `task`-labelled bundle missing the Phase 3 vector set fails; a whole-task capture whose measurements carry
  the phase-2 scope fails the pairing; and the old plan, untouched, still refuses a `task`-labelled report if
  resolution were bypassed (asserted directly on the resolver).

### 5.4 W-C — when CI runs the whole-task capture, and its cost, stated up front

CI's capture step iterates `evidence.js plans` (sorted keys), so **the plan key and everything it requires
must land in one commit** — the W-C commit adds the plan, the producers that fill it, and the collector
changes together; there is no intermediate state where the plan exists but its artefacts cannot exist. From
that commit onward **every CI run** captures and verifies the whole-task bundle — no conditionals, no
`continue-on-error`: from W-C on, a run where the whole-task bundle is absent is red by design. Before W-C
lands, nothing changes: the plans loop never sees the key. Ordering: sorted, the new capture runs after
`UDG-003`'s phase capture and before `UDG-004`'s; its failure aborts the loop exactly as a phase capture's
does, and the existing artefact-assert and verify steps then behave as they do today.

**Added CI runtime (explicit before implementation, per the owner's condition).** Measured at the baseline
(run `43965274365`): job **24.6 min**, capture step **16.6 min** over four plans (~4.2 min average; the
whole-task capture re-runs the same command set as the phase capture plus the Phase 3 vectors, so ≈4–5 min is
the estimate). Expected post-W-C job: **≈29–30 min**. The W-C and completion records report the **measured**
delta against this estimate, and the estimate itself travels with the record — nobody gets to discover the
cost after merge.

## 6. W-A — the repeatability check and the preserve-list (D-P3-9, as ruled)

1. **Per defect, separately** (`W-7` in `runtime.test.ts` line ~644 and the episode-deadline probe; `P-2b` in
   the same file and the GA-6/GA-7 harness seat): step-1 assertion table from retained bytes → targeted
   reproducer **or** failing control (fails unfixed, passes fixed, under the declared conditions) → one fix,
   chosen by the demonstrated cause.
2. **Declared load and test order, declared before the streak and retained:** the declaration names the case
   ids, the machine class, the file order (the full `pnpm test` order as resolved by the pinned vitest
   config — the contention is the environment under test) and the load (the background CPU-load process
   approximating the CI job's chromium-install + browser-suite load, command recorded). The declaration is
   written into the working record **before the first streak run** and cannot be edited afterwards; results
   (per-run logs/junit digests) are retained and bundled.
3. **Ten consecutive passes** of each affected case under that declaration, then the **first-attempt hosted
   green on the exact submitted commit** (any earlier red of that commit is retained and named).
4. **Non-reproduction:** if an original failure cannot be reproduced, W-A publishes what the retained
   evidence establishes — the step-1 table, the attempt logs, the identical-code red/green pairs, the load
   correlation — and what it leaves open, **before** proposing any change; a change proposed against an
   unreproduced failure must name the retained fact that justifies it.
5. **Preserve-list (nothing here may move):** `clientSnapshotDeadlineMs = 500 ms`,
   `clientRecoveryDeadlineMs = 4000 ms`, two rejoins per rolling 60 s, `closureWindowMs = 250`,
   `closureMaxMs = 1000`, close codes 4100/4101/4102, the three-limit discrimination map
   (`episode-deadline` / `allowance-exhausted` / `deadline`), every `ep.controls` entry, the GA-6a/6b/6c/GA-7
   controls (13/13), the pinned close-reason `toEqual`, U2-1 bundle verification, and §7's reliability
   properties inherited from Phase 2 (single capture, exact assertions on controlled cases, attributable
   invocations, parseable artefacts). Fixes move *where and when a counter is read*, never *what the policy
   does*. Historical artefacts keep their bytes; the corrected probe produces new ones.

## 7. Commands, evidence and gate rules

### 7.1 Required commands

`pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm build`,
`pnpm --filter @udg/server build:probes`, `pnpm --filter @udg/server typecheck:probes`,
`pnpm run declarations:strict`, `pnpm dependencies:verify`, `pnpm test:boundaries`, `pnpm test:fixtures`,
`pnpm test:contract -- --task UDG-001`, `pnpm test:contract -- --task UDG-002`,
`pnpm test:contract -- --task UDG-003`, `pnpm test:contract -- --task UDG-004`,
`pnpm test:e2e -- --suite camera`, `pnpm test`, `pnpm contracts:checksums`, `pnpm evidence:probes`,
`pnpm evidence:capture -- --task UDG-003`, `pnpm evidence:capture -- --task UDG-003-TASK`,
`pnpm evidence:capture -- --task UDG-001`, `pnpm evidence:capture -- --task UDG-002`,
`pnpm evidence:capture -- --task UDG-004`, `pnpm evidence:verify` (every bundle taken, all PASS 0 issues) —
plus the M-6 second-lander set on the integrated head. A command that cannot run is reported unable with its
error; a zero-test run, a skipped suite or an empty vector directory is not evidence.

### 7.2 Evidence

Bundles to the **existing store only** (D4 open). The whole-task bundle carries the Phase 1 (15) + Phase 2 (27)
+ Phase 3 vector sets with their manifests, `probes/probe-run-index.json` and the probe ledger, the task
contract's named artefacts (`ticks.jsonl`, `inputs.jsonl`, `buffer-depth.csv`, `abuse-results.json`,
`api-map.md`, `room-lifecycle.json`), W-A's retained streak evidence, and the baseline attribution each
artefact belongs to. Only SHA-256 digests of vectors are committed; artefacts carry no machine paths, tokens or
credentials; the E-6′ cross-verification (§5.3) runs on the submitted head.

### 7.3 Acceptance and non-claims at assignment

Phase 3 is complete when W-A's §6 gate is met per defect, W-B/W-C's artefacts pass the whole-task gate, W-D's
ledgers close with their carried obligations named, and the §4 grants were not exceeded. **A criterion with a
missing, unverifiable or non-replayable artefact is FAIL, not "not run."** Submission is **In Review**;
acceptance — task-level **Verified** included — is the owner's alone, and even then **Gate A stays Not Run** and
UDG-SPIKE-001's to execute. Explicit non-claims at assignment: no work item is started; Gate A **Not Run**;
GA-11 not evaluated; dedupe-triggered closure **disabled**; D4 **undesignated**; Part B **unadopted**;
`stackCompatibility` **not-established**; the two publication-sitting reds **unclassified**; Phase 3
implementation begins only on the owner's build instruction.

## 8. Stale references reconciled by this assignment

| surface | change |
| --- | --- |
| [UDG-003.md](../UDG-003.md) | status and assignment lines now say Phase 3 is **assigned, Ready, unstarted** on `eafe3065…` with this record linked; the W-7 line gains a dated pointer to the two unclassified reds; Gate A **Not Run**, closure disabled, D4 open stay as written |
| [adoption.md](../adoption.md) | new dated entry `UDG-003 Phase 3 assignment recorded` carries the decision table and, in the following records commit, this record's sha and covering CI run |
| [the draft](UDG-003-phase-3-assignment-draft.md) | header marked **Superseded**; §0 directions and dated addenda retained as history |
| `README.md` | the three assignment-status sentences now say Phase 3 assigned, Ready, unstarted; every accepted assertion string (`24.22.2`, `12.18.0`, `2567`, `5173`, command names, loopback-only phrasing) stays present |
| `docs/contracts/checksums.json` | regenerated by command in this commit — the `UDG-003.md` and `README.md` status moves are consequences, disclosed here |

Still open after this handoff: **D4** (undesignated), Gate A **Not Run**, GA-11 unevaluated, GA-12 and
PE-1…PE-5 not passed, dedupe-triggered closure disabled, Part B unadopted, `stackCompatibility`
not-established, the two publication-sitting reds unclassified, and the owner's build instruction — without
which Phase 3 stays Ready and unstarted.
