# UDG-SPIKE-001 Networking gate (Gate A) — **assignment record**

Status: **ASSIGNED — Ready, implementation NOT started.** This record adopts P10 for the Gate A scope, grants
paths and records decisions. It writes no source file, installs no package, starts no server and passes no gate.
**Gate A remains Not Run**; its formal execution is this task's own act, and the decision on its result belongs to
the delegated integration approver named below, not to this record.

Task state per [definition of done](../definition-of-done.md): **Ready** — the prerequisite Verification checks and
the P10 adoption check have passed, the assignment exists against an adopted revision with immutable prerequisite
commits, and the allowed-file manifest is granted. It is **not** In Progress, **not** In Review and **not**
Verified.

```text
Implementation baseline (the code tree the build starts from)
                       fc63b65edca55a439862b6e674dc2eb63ef80708   "docs(contracts): the owner accepts CI routing
                       at 6d91c61, with its scope written down" — the main tip immediately before this record,
                       independently checked by the delegated reviewer.
Baseline CI            run 44415266083 (workflow "ci (routine)", event push) — status completed, conclusion
                       success, on fc63b65.
Record/handoff commit  the commit carrying this file; it cannot name itself, so
                       `git log -- docs/contracts/assignments/UDG-SPIKE-001.md` stays authoritative. It is
                       docs-only, so the code baseline and the record commit are never quoted for each other.
Contracts edition      UDG-CONTRACTS-M0-001 v1.0, repository edition 1
UDG-SPIKE-001 task     docs/contracts/UDG-SPIKE-001.md at review  8af4e270935da75b15207e5e5d82e94b1f054626820b04cb5baf06970d991e99
contract digests       (current in docs/contracts/checksums.json). This record moves that file's Assignment
                       metadata block only — "Not Started / unassigned" to "Ready / assigned, not started" with
                       the P10 adoption pointer — and nothing else: no requirement, no owned-path list, no
                       acceptance check, no exclusion changed.
Shared requirement     docs/contracts/scope.md            572b6ca2f3271fb87e8f4c8c620c768226008d5cee04889418804931b99652c5
sources at review      docs/validation/acceptance-gates.md 8f8fa0250348cb83419a4e6f488417d8efb7c17df211cc96f9109088854539d9
                       docs/validation/measurement.md      b92d739ec9a9c66ae0eae77338bad2c5fe5c797e596dd7babd6cc7f3d92b66a2
                       docs/validation/evidence-requirements.md
                                                          c8248da02a1d35939a8d48deba5c94df15edc22507b5fada81202f46848f3693
                       docs/adr/0003-…-policy.md (Accepted)
                                                          4ab67402d63af35fccd9c23787b24496e22b9771fc455b334be90351b41f62aa
Baseline specification UDG-SPEC-M0-002 v0.2, SHA-256 b51e7afdd6810c377d2d2702d7673119521a59cd0d6b91686700bf9149b73fcf
Manifest at review     docs/contracts/checksums.json, 66 entries
                       file SHA-256   1f1511db4e6d45058351793bfc1d5a2b2ae9442dc4486b38d0f622e7fe73f611
                       This record's commit regenerates the manifest, so the manifest of the adoption edition is
                       identified by that commit rather than by a self-referential digest (rule M-4).
Approval channel       Project-owner instruction of 2026-11-19, carried into this repository by **Codex** under
                       the owner's explicit in-chat delegation of the same date (see "Delegation and roles").
                       Dated by the commit carrying this record, the basis used since the Phase 1 record.
Prerequisites          UDG-003 **Verified** (task-level) — acceptance commit 4f567ae4596b1a5b99e35a3b48d7d9b728c2863d,
                       accepted implementation 74aa8dabbef7fcae5c455c24dfb326c2a57f6be2, submission CI 44299429735.
                       UDG-004 **Verified** — acceptance commit 76db480892fa4aa21bd79c1bf7e939b5ddb6315e,
                       accepted implementation d318444fe8668f4485d85398ecc6eb88ff5e3b36, submission CI
                       43893238010 attempt 2.
                       P01/P02/P03/P06 adoption as recorded in adoption.md; ADR-0001, ADR-0002, ADR-0003 accepted.
Retained evidence      /workspace/udg-evidence (the existing store only). **D4 stays open and unprovisioned**:
                       no archive, tag, release or second destination is created or designated by this record.
Gates                  A, B and C **Not Run**. P06 stays in its deferred-freeze form until this gate freezes it.
Still unassigned       UDG-005, UDG-006, UDG-SPIKE-002, UDG-007, UDG-008, UDG-SPIKE-003.
```

`pnpm evidence:verify` reads prerequisite lines in the form `Prerequisite commit: <40 hex>` (optional
parenthetical), so each sha is written bare below. The implementation baseline `fc63b65…` and this record's
handoff commit are deliberately **not** listed: a task's own baseline and own record are not prerequisite
accepted work (the UDG-004 §1 rule).

```text
Prerequisite commit (UDG-003 task-level Verified acceptance, a "Requires Verified" prerequisite): 4f567ae4596b1a5b99e35a3b48d7d9b728c2863d
Prerequisite commit (UDG-004 Verified acceptance, a "Requires Verified" prerequisite): 76db480892fa4aa21bd79c1bf7e939b5ddb6315e
```

## Delegation and roles

- **Project owner and integration owner of record:** `TomBResearch` (unchanged; not displaced by this record).
- **Delegated reviewer and integration approver for UDG-SPIKE-001:** **Codex**, acting for the owner under the
  owner's explicit in-chat delegation of **2026-11-19** covering the reviewer, assigner and integration-approval
  roles for UDG-SPIKE-001 (including Gate A). Codex signs **as delegated reviewer/integration approver** — never
  as Pi and never as, or impersonating, `TomBResearch`. Where any record requires the owner's own identity
  outside this delegation, the owner signs it themselves.
- **Implementer:** **Pi**, on the owner's separate, explicit build instruction. This record does not start work.
- The delegation covers UDG-SPIKE-001 assignment, review and the Gate A decision. It does not re-open settled
  earlier acceptances, move any other task's state, or change the definition of done, evidence requirements or
  any gate text.
- **Owner direct instruction, 2026-11-21 (recorded basis; owner of record unchanged):** *"You can make the
  decisions, use the tunnel to just continue with the project without me."* For the reviewed design decisions
  presented in the 2026-11-21 review — the §D qualitative wait-first adoption, the GA-5b row precision and the
  GA-12 safety/activation split — this instruction supersedes the "does not change any gate text" limit above for
  THAT reviewed set only. The delegated integration approver (Codex) RECORDS the owner's acceptance of exactly
  those decisions, within exactly the scope the owner stated (no numeric, threshold change, positive activation
  claim, GA-11 waiver, green rows, or retrospective acceptance), in
  **[ADR-0005](../adr/0005-stalled-ack-wait-first-design-and-gate-row-precision.md)**. Attribution remains the
  delegated approver recording the owner's acceptance — never Tom's signature. Decisions outside that reviewed
  set (gate VERDICTS, GA-11 numerics, deployments, merges, anything for other tasks) stay with the owner under
  the original terms.

## Owner instruction this record implements

The owner's instruction of 2026-11-19 (dated by the commit carrying this record) ruled the following. Each item is
a ruling, not a proposal.

1. **Adopt P10 for UDG-SPIKE-001 / Gate A only** — the numeric, workload and evidence limbs of scope.md §1.3 as
   specified by the UDG-SPIKE-001 contract, the applicable Gate A rows of acceptance-gates.md §7.3, all of
   measurement.md §7.4, evidence-requirements.md, and ADR-0003. §2 records the exact adopted content.
2. **Keep v0.2's 0.15 m elevated unobstructed p95 correction threshold**; apply the exact profiles, seeds,
   20 s + 120 s windows, the ≥100 eligible-acknowledgement floor, exact convergence, response timing and
   achieved-network validity rules as written.
3. **Input parity stays a Gate C row; Gate B and Gate C thresholds await their own adoption.** P10 is adopted
   for Gate A only.
4. **The ADR-0003 envelope parameters remain provisional test settings; GA-11 measures and justifies production
   settings.** GA-12 and the PE-1…PE-5 requirements stand exactly as written: no suspected-dedupe close without
   positive evidence, and the run must report the actual verdict. Codex reviews the GA-12 record against ADR-0003
   **before** any Gate A decision.
5. **CF-1, CF-3 and CF-4 must be resolved by actual Gate A evidence or block the gate.** CF-2 and the deferred
   navigation obligations (GA-10a, GA-10b) remain with their owners (UDG-003 AC-6's `M` half; UDG-007 for `P`′
   and the committed discrete effect).
6. **P06 receives its freeze only at Gate A.** D4 (independent backup destination) remains open.
7. **Prepare and publish the scoped adoption plus this assignment in one docs-only commit**, propose a
   candidate-bound Gate A full-matrix layout rather than loading it into routine CI, make the first
   implementation slice the pinned public SDK browser import/API and paired-client smoke check, and record
   compiler diagnostics and WS-proxy dependency needs as measurement-based decision points, not blockers to a
   disposable scratch feasibility probe. §3–§5 implement this.

---

## 1. Assignment record (template B1, filled)

| Field | Value |
| --- | --- |
| Task ID and objective | `UDG-SPIKE-001` — prove server authority, local direct prediction and remote interpolation without Rapier or Recast; execute Gate A and freeze the listed semantics at it |
| Contracts version and SHA-256 | `UDG-CONTRACTS-M0-001` v1.0 edition 1; `docs/contracts/UDG-SPIKE-001.md` `8af4e270935d…` at review, moved by this record's status-block update only (§9 ledger) |
| Baseline specification ID and SHA-256 | `UDG-SPEC-M0-002` v0.2 `b51e7afdd681…` |
| Assigned implementer and reviewer | Implementer: **Pi** (begins on the build instruction). Reviewer and integration approver: **Codex, delegated** (see "Delegation and roles") |
| Integration owner | Project owner, GitHub `TomBResearch`; Gate A decision exercised by Codex under the 2026-11-19 delegation |
| Authorised checkout and branch | `main` of `TomBResearch/UntitledDinosaurGame`; no force-push; no rewrite of any retained history or evidence |
| Prerequisite task IDs and commit SHAs | UDG-003 Verified `4f567ae4596b…` (impl `74aa8da…`); UDG-004 Verified `76db480892fa…` (impl `d318444…`). Baseline for the build: `fc63b65edca5…`, routine CI `44415266083` (success) |
| Verified gate evidence locations | Existing store `/workspace/udg-evidence` only. No Gate A evidence exists yet; when produced it lands in the store bound to its candidate. **D4 open; nothing provisioned** |
| Approved P01–P10 refinements and ADRs | P01, P02, P03, P06 approved; **P10 approved 2026-11-19 for the Gate A scope (§2)**. ADR-0001 (P06 deferred-freeze — freeze happens only at Gate A), ADR-0002 (server-only; **no automatic extension or new exception is adopted here**), ADR-0003 (GA-1…GA-13; envelope parameters provisional, GA-11 measures production settings; GA-10a/b outstanding before UDG-007) |
| Allowed file paths | §3 — granted, each controlled grant limited to the wording in its own row |
| Public interfaces implemented and consumed | Implements the spike's own harness surface (`@udg/load-test` spike runner, proxy, trace writer, statistics) and `apps/client/src/network/{ColyseusPredictionAdapter,RemotePresentation}`. Consumes the pinned public `@colyseus/sdk` / `@colyseus/core` / `@colyseus/schema` API, the accepted UDG-002/003 protocol and config surfaces, and `tests/reference/flat-direct-step.ts` as the **sole movement function on both sides**. Changes no shared schema, protocol field, precision rule or config default outside the granted registration files |
| Required commands, fixtures, profiles and seeds | §6 — the four root commands, `pnpm test:contract -- --task UDG-SPIKE-001`, `pnpm test:e2e -- --suite netcode`, and `pnpm test:spike -- --id UDG-SPIKE-001 --profile <PROFILE> --seed <SEED>` for every profile/seed in measurement.md §7.4: profiles `lan` (0–10 ms, minimal jitter), `moderate` (50/10 ms), `elevated` (100/20 ms — carries the correction gate), `poor` (200/40 ms) × seeds **1001, 1002, 1003** — 12 full-matrix runs |
| Acceptance metrics and evidence destination | §2 (thresholds), §4 (run layout), §6–§7 (commands, bundle, store). Gate A acceptance = the contract's Gate A paragraph + §2 + ADR-0003 GA-1…GA-13 (GA-10a/b recorded outstanding) + AC-1…AC-20 as applicable, on the exact candidate commit |
| Known blockers and escalation owner | none blocking the start. Open decision points DPA-1 (client compiler diagnostics) and DPA-2 (WS-proxy dependency) in §5 are resolved by measurement, then decided by the delegated approver — not self-adopted. Escalation path for a genuine conflict: ADR proposal with a minimal reproduction and affected descendants, to Codex under the delegation |
| State and assignment date | **Assigned, Ready, implementation not started.** Dated by the commit carrying this record (2026-11-19 basis) |

---

## 2. P10 adoption for the Gate A scope (2026-11-19, dated by commit)

P10 ("numeric spike thresholds, sample sizes and evidence schema", [scope.md §1.3](../scope.md#13-proposed-refinements-requiring-adoption))
is **approved for UDG-SPIKE-001 / Gate A only**. The adopted limbs, each by reference to its authoritative text
as reviewed at the digests in the provenance block — this record restates the numbers so the adoption is
checkable, it does not re-source them:

### 2.1 Numeric limb — [acceptance-gates.md §7.3](../acceptance-gates.md) Gate A-applicable rows

| Row | Adopted condition (binding for Gate A) |
| --- | --- |
| Flat direct travel | 200 unobstructed ticks at 4 m/s produce 40 m horizontal travel within **0.000001 m** in pure simulation |
| Speed abuse | Every tick's horizontal desired distance is at most **0.2 m + 0.000001 m**; a burst cannot increase the count of steps |
| Direct correction | At 100 ms RTT and 20 ms jitter (the elevated profile), **p95 raw horizontal correction below 0.15 m** on unobstructed movement — v0.2's threshold, kept unchanged |
| Safety on transition — applicable subset | Old-epoch accepted frames **zero**; duplicate movement commits **zero**. The stale-route-activation half is a navigation obligation: it travels with CF-2 / GA-10a / GA-10b and their owners (UDG-003 `M` half, UDG-007 `P`′ half), is reported as outstanding at this gate, and is not silently inherited or silently dropped |

**Not adopted by this row:** the Collision, Physics adoption, Physics replay, Route traversal, Route
responsiveness and Route query CPU rows belong to Gates B/C; the Input parity row is a **Gate C** obligation.
Gate B and Gate C P10 thresholds await their own adoptions at their own spikes' Ready gates — nothing in this
adoption pre-commits them. The §7.3 clauses on labelled fixture resets (bounded floor or reset between trace
segments, labelled and excluded from direct-travel calculations) and the separation of gravity/contact
correction populations at B/C apply as written.

### 2.2 Workload and statistics limb — [measurement.md §7.4](../measurement.md), all of it, as written

Seeds **1001, 1002, 1003** per scenario; two real browser client contexts per browser network run; **20 s warm-up
+ 120 s measurement**; collect every eligible authoritative acknowledgement including zero corrections; report
total ack opportunities, zero values, nonzero values, excluded labelled resets and p50/p95/p99/max; **nearest-rank
percentiles** (sorted sample at `ceil(p·N)`); **if N < 100 eligible measured acknowledgements per run the run
fails as insufficient evidence**; correction is the raw predicted-versus-authoritative horizontal magnitude at the
same acknowledged input boundary before display smoothing, with render offsets a separate metric; all four
profiles at the spike with the **elevated profile carrying the numerical correction gate**; the development
WebSocket proxy with symmetric half-RTT one-way delay and bounded uniform jitter, byte order preserved, TCP
stalls modelled as stalls and never called packet-loss simulation; **achieved-network validity**: record
requested and achieved p50/p95 RTT, jitter statistic and sample count, and if achieved median RTT differs by more
than 10 ms, or measured p95−p50 exceeds the declared budget by more than 10 ms, mark the profile **INVALID** and
rerun without claiming a pass; environment recording (server OS/CPU/memory, Node version, browser/version,
headed/headless, monotonic clock source); matched simulation boundaries, not wall-clock positions; and the
standing limit that a two-client spike does not certify the 20-client ten-minute workload.

### 2.3 Evidence limb — [evidence-requirements.md](../validation/evidence-requirements.md) + the contract

The complete common evidence bundle (§19.1 structure, `report.json` fields, `commands.json`, `junit.xml`,
`checksums.sha256`, traces/metrics/browser/decisions directories, no tokens/credentials/machine paths) **plus**
the contract-named Gate A artefacts: `docs/integration/gate-a.md` (PASS or FAIL, thresholds, actual values,
unresolved limitations, prerequisite SHAs, integration-owner decision), `api-map.md`, `schema-freeze.json`,
`raw-corrections.csv`, `matched-ack-trace.jsonl`, `remote-render.csv`, and the annotated browser recording or
screenshots identifying both clients and ticks. Remote interpolation delay and maximum discontinuity are reported
separately; labelled correction teleports are excluded from smoothness statistics but their raw corrections stay
in diagnostic reports. `report.json.status` is the **actual** verdict — PASS, FAIL, BLOCKED or INVALID — and only
PASS can support a gate pass.

### 2.4 ADR-0003 limb — [ADR-0003](../../adr/0003-input-acknowledgement-overflow-and-resynchronisation-policy.md)

GA-1…GA-13 as accepted, with these readings from the owner's instruction recorded as binding:

- **Envelope parameters stay provisional.** `B = 8`, `closureWindowMs = 250 ms`, `closureMaxMs = 1000 ms`,
  `clientSnapshotDeadlineMs = 500 ms`, `clientRecoveryDeadlineMs = 4000 ms` and the rolling two-rejoin/60 s
  allowance are **test settings**. **GA-11 measures and justifies production settings** and names the impairment
  source of every population; where the runner cannot produce `tc`/`netem` impairment, the loss population is
  recorded `dropModel: "application-layer delivery loss"`, `tcpLossModelled: false`, and that limitation travels
  with every GA-11 number.
- **GA-12 and the PE requirements are unchanged:** no suspected-dedupe closure without PE-1…PE-5 all passing
  (positive evidence, zero-false-positive compliant control population, named missing stamp, replayable
  detection); terminal dedupe stays permanently outside the closure path; the run reports the **actual** GA-12
  verdict. **Codex reviews the GA-12 evidence against ADR-0003 before any Gate A decision is taken.**
- **GA-10a and GA-10b are recorded outstanding** for any Gate A run preceding UDG-007 verification, each with
  the reason and owning task named in the run record (UDG-007); they do not block Gate A at its own prerequisites,
  and no Gate A claim covering successful navigation effects may be made without citing both.
- A criterion whose artefact is missing, unverifiable or not replayable is **FAIL**, not "Not Run". GA-10a/b are
  the two named outstanding rows; nothing else may be relabelled.

### 2.5 Carried-forward findings and remaining obligations

| Item | Position at this assignment |
| --- | --- |
| **CF-1** (W-7 delivery count vs GA-6c premise), **CF-3** (post-close input observation vs GA-6c/GA-7 containment), **CF-4** (P-2b refusal wording vs GA-7 branch attribution) | Inherited by Gate A as open, unclassified limitations. A Gate A run must **resolve each with its own evidence or be blocked by it** — the UDG-003 harness numbers cannot close them (the spike's own envelope is the evidence). The run record says which. Source: [UDG-003 Phase 3 closeout §0](evidence/UDG-003-phase-3-defect-closeout.md) |
| **CF-2** (authority-to-client mapping, AC-6 `M` half) | **Not Gate A's to close.** Stays with UDG-003 for the `M` half and UDG-007 for `P`′, with its byte-named reopening conditions. Gate A reports it as outstanding-elsewhere, never as resolved |
| **P06** | Deferred-freeze form (ADR-0001) until **this gate** freezes input/schema encoding, replica precision, framework bookkeeping, ack semantics and neutral idle behaviour. Until a Gate A pass, widths remain provisional |
| **D4** | **Open.** Existing `/workspace/udg-evidence` remains the only evidence destination; no backup destination is designated by this record |
| Unused v0.2 state fields | Listed as encoded defaults in the schema freeze; not removed (the flat spike uses no gravity or paths) |

---

## 3. Granted file paths

Permission to touch a file is never permission to widen scope. Anything outside these rows needs a new
instruction from the delegated approver.

### 3.1 Contract-owned (the task contract's own list)

`apps/client/src/network/{ColyseusPredictionAdapter,RemotePresentation}.ts`;
`tests/probes/{colyseus-client,colyseus-roundtrip}.probe.ts`; `tests/spikes/spike-001.test.ts`;
`tests/e2e/netcode.spec.ts`; `tests/fixtures/network/direct.json`;
`tools/load-test/{package.json,tsconfig.json}`; `tools/load-test/src/{run-spike,ws-delay-proxy,trace-writer,statistics}.ts`;
`docs/integration/gate-a.md` (new); and updates to `docs/integration/colyseus-0.18-api-map.md`.

### 3.2 Supporting paths inside the owned workspaces

| Path | Limit |
| --- | --- |
| `tools/load-test/src/**` (beyond the four named files) | the spike harness only; minimum implementation per [tools/load-test/AGENTS.md](../../tools/load-test/AGENTS.md) |
| `tests/fixtures/catalog.json` | register `tests/fixtures/network/direct.json` — additive entry only |
| `tests/e2e/netcode.spec.ts` env/identity wiring | must follow the accepted camera-suite identity pattern (`schemaVersion`, `taskId`, `runId`, `implementationSha`, `workingTreeDirty: false`) |
| `apps/client/spike-scratch/` (new, disposable, §5) | the §5 feasibility probe only; deleted after measurement, with the measurements preserved in the api map / probe evidence, not in the scratch dir |
| `apps/server/spike-scratch/` (new, disposable, §5) | same, server side |
| `docs/integration/gate-a.md`, `docs/integration/colyseus-0.18-api-map.md` | Gate A record and API map, per the contract; the api map records every prediction-side name used or explicitly "not used, and why" |

### 3.3 Controlled tooling grants — outline, each with its limit

These exist to **enable netcode/spike only, add candidate-bound Gate A evidence while preserving older plans, and
keep routine routing fast.** They are exercised only under the build instruction.

| Grant | Path | Limited to | Accepted assertions it must not break |
| --- | --- | --- | --- |
| **T-1** | `tools/checks/src/support.ts` | (a) flip the `netcode` row of `E2E_SUITES` to `implemented: true` **when and only when** `tests/e2e/netcode.spec.ts` exists and runs; (b) make `test:spike` id-aware: `--id UDG-SPIKE-001` dispatches once the harness exists, `UDG-SPIKE-002`, `UDG-SPIKE-003`, unknown ids and a missing `--id` still refuse with owning task, required artefact, contract path, exit 1. **`physics`/`input`/`hybrid`, `assets:build`, `assets:verify` rows stay exactly as they are** | every guard the accepted UDG-001 suite asserts for un-owned suites must survive and keep passing; a zero-case suite run is never a pass (`repository.md` §3.2) |
| **T-2** | `tests/contracts/UDG-001.test.ts` | only the guarded-command/partition assertions T-1 necessarily moves (the plans/refusals complement gains UDG-SPIKE-001 as a planned task); every other accepted assertion — guards, pins, compiler policy, README/env, CI authorship — survives unchanged and green | `UDG-001 › refuses commands owned by later tasks…`; `planning.readmeCommands` |
| **T-3** | root `package.json` | wiring so `test:spike`/`test:e2e -- --suite netcode` reach the real harness once implemented; a `gate-a:full` script may be added **only** as a thin wrapper over the §4 dispatch inputs. No pin moves; `packageManager`/`engines` untouched | frozen-lockfile install in every lane |
| **T-4** | `playwright.config.ts` | netcode-suite output/reporter wiring mirroring the camera pattern. **Camera config, `workers: 1`, `retries: 0`, `fullyParallel: false`, chromium-only `projects` and both screenshot/trace settings are unchanged** | the accepted camera suite keeps producing byte-compatible identity artefacts |
| **T-5** | `tools/checks/src/evidence.ts` | append a `UDG-SPIKE-001` capture plan (and the Gate A evidence identity: per-run profile/seed, achieved-network validity fields, GA-rows register). **The five accepted plans, their threshold strings and prose stay byte-identical; `CAPTURE_PLANS` is append-only (M-2); the report schema and verifier status logic are untouched** | every retained bundle keeps verifying (U2-1); `evidence:verify` parity over the retained store |
| **T-6** | `.github/workflows/ci.yml` | append the **fast** netcode/spike steps to the lane the router already assigns them (static/unit/server/runtime per the route). Full matrix and spike evidence capture do **not** go here (C-07: a routine green captures nothing). Every `uses:` stays a 40-hex sha the register records or an explicitly approved acceptance-only pin; no `continue-on-error`; no step reordering | `UDG-001 › authorship: the CI workflow runs the same scripts and pins third-party actions`; `routine outcome` semantics |
| **T-7** | `.github/workflows/gate-a.yml` (new) | the §4 candidate-bound Gate A full-matrix dispatch. `workflow_dispatch` only; required `candidate_sha` (full 40-hex, must equal the checkout, refused before install otherwise — the accepted acceptance.yml pattern); bundles must declare `implementationSha == candidate_sha`; publishes verified bundles; same Node/pnpm pins; same action-pin policy | must not be reachable from push/PR; must not run any routine check; a refused dispatch writes no bundle |
| **T-8** | `tools/ci/route-checks.mjs` + `tests/unit/ci-routing/route-checks.test.ts` | add route rules so `tests/spikes/**`, `tests/e2e/netcode.spec.ts`, `tools/load-test/**`, `apps/client/src/network/**` and the client probes imply their existing lanes (fast smoke only). **No route may select the full Gate A matrix; the router cannot produce or enable evidence capture (the C-07 invariant the workflow-policy test guards)** | route/lane two-way agreement test; "unknown impact runs everything" rule; `--force` can never enable capture |
| **T-9** | `docs/integration/dependencies.json` + `pnpm-lock.yaml` | **conditional, not automatic:** used only if DPA-1/DPA-2 (§5) end in an approved dependency or pin decision, recorded by `pnpm dependencies:record` and verified by `pnpm dependencies:verify`. Nothing in this record adopts an install | register verify in every lane; the pinned `@colyseus/*` set stays as registered |
| **Do not touch** | `eslint.config.mjs` · `tsconfig.base.json` · `vitest.config.ts` · `pnpm-workspace.yaml` (the `tools/*` glob already admits `tools/load-test`) · `packages/**` · `packages/protocol/**` and `packages/config/**` (protocol/precision changes need their own ADR/scope) · every retained bundle · `docs/interfaces/**` · `docs/contracts/protocol-v1.md` · `docs/validation/**` · `docs/adr/**` · `docs/contracts/adoption.md` except the owner/delegated-pen records of this round · every `AGENTS.md` | — |

Local instruction files that apply to the granted paths and must be read before editing them: root
[AGENTS.md](../../AGENTS.md), [docs/AGENTS.md](../AGENTS.md), [tests/AGENTS.md](../../tests/AGENTS.md),
[apps/client/AGENTS.md](../../apps/client/AGENTS.md), [apps/server/AGENTS.md](../../apps/server/AGENTS.md),
[tools/load-test/AGENTS.md](../../tools/load-test/AGENTS.md). They specialise scope and cannot widen this grant.

### 3.4 Grant inventory and required grant tests (summary)

| Grant | Enables | Must be proven by |
| --- | --- | --- |
| T-1/T-2 | netcode suite + `test:spike -- --id UDG-SPIKE-001` become runnable while SPIKE-002/003 still refuse | new UDG-SPIKE-001 contract suite cases: each refused id exits 1 and names its owner; unknown id and missing `--id` exit 2; `--suite netcode` dispatches; `physics|input|hybrid` still refuse; the UDG-001 partition test green with SPIKE-001 planned |
| T-3/T-4 | command wiring | frozen install + the accepted camera suite still green; zero-case netcode run reported as failure, never silence |
| T-5 | Gate A capture plan | the five accepted plans byte-identical (diff statement) and all retained bundles re-verified with 0 issues and 0 changed verdicts |
| T-6/T-8 | fast routine routing of netcode/spike paths | route tests both directions; measured routine run on a netcode-only change stays inside the existing lane budgets |
| T-7 | candidate-bound Gate A evidence | dispatch refusal cases (missing/short/mismatched `candidate_sha`) reproduce the accepted acceptance.yml behaviour; a green run re-asserts the binding against every captured `report.json` |
| T-9 | conditional dependency registration | `dependencies:verify` green; only an approved DPA outcome may appear |

---

### 3.5 Amendments (dated, reviewer-approved)

**A-1 (2026-11-19) — the trusted stepper seam.** Reviewer scoped-approval: ONE optional process-local
`stepperFactory?: (speed: number) => EntityStepper` parameter on each of (1)
`buildMovementAuthority`'s options in `apps/server/src/movement/MovementAuthorityAdapter.ts`, with the
default expression constructing exactly the `FlatReferenceStepper(config.movement.speed)` the prior line
constructed, and (2) `RegionRoomOptions` in `apps/server/src/rooms/RegionRoom.ts` with a conditional
passthrough at the existing `buildMovementAuthority` call. This entry narrows the grant: those two server
files are granted for exactly those edits. Trust boundary: factory selection is unreachable from the wire
(fixed six-field exact-key frame gate), from configuration (the config compiler drops unknown keys) and
from untrusted create/join options (the per-process-nonce gate discards them wholesale) — pinned by
`tests/unit/udg-spike-001/trusted-stepper-seam.test.ts`. Consumers are test compositions only: the netcode
harness room and the AC-1 reference trace, both through `tests/support/step-kernel/kernel-stepper.mjs`
wrapping THE `flatDirectStep` exported by `apps/client/dist/network/flatStep.js`. No new architecture
dependency: nothing in `apps/server` imports the client or test trees; the direction stays trusted-caller →
adapter. Production default unchanged and every other composition (camera suite, shipped server) exercises
precisely the default path. Evidence: the netcode suite's kernel-stepper sentinel check beside the exact
40/120 dispositions, the AC-1 trace fields `rowsSteppedBySharedKernel` / `kernelStepperCalls` /
`productionDefaultMatchesKernel`, and `docs/integration/colyseus-0.18-api-map.md` §13.2.

**A-2 (2026-11-19) — post-retirement replacement diagnosis, resolved without any server change.** The
previously reported "replacement consumes frames but never moves" finding was diagnosed from the
authority sources (protocol §4.2: `resetForNewEpoch` zeroes the generation watermark; the screening
window `MAX_GENERATION_FORWARD_GAP = 64`; a screen refusal is a journalled disposition with a neutral
step) and confirmed with a same-seat positive control (only the frame generation restarted → motion
resumes). Root cause: this spike's own test mover continued the offender's generation sequence into
the replacement's new-epoch domain. The fix is fixture-only and inside already-granted test paths (the
browser movers now restart the generation counter when the epoch changes); no production logic needed
to change, and none did. The server-defect claim is rescinded in
`docs/integration/colyseus-0.18-api-map.md` §13.4, with standing client guidance recorded there.

## 4. Full-profile matrix: candidate-bound layout, not routine CI

The full matrix is **4 profiles × 3 seeds = 12 runs**, each with 20 s warm-up + 120 s measurement plus room
setup, proxy setup, pairing and trace flush. Bare measurement work alone is 12 × 140 s = **28 min serial**;
realistic wall time with process and room lifecycle is well above that. Putting it unconditionally into routine
CI would rebuild the 35-minute baseline C-07 removed. The adopted layout (owner instruction item 7; implemented
under T-7):

```text
ci (routine)                       unchanged routing; netcode/spike code changes route only their FAST existing
                                   lanes (spec parse, proxy unit behaviour, statistics, one short paired-client
                                   smoke case at the lan profile inside the runtime lane budget). No spike
                                   evidence, no capture, no full matrix.

ci (gate A — full profile matrix)  new workflow, workflow_dispatch only (T-7):
  dispatch input: candidate_sha    required, full 40-hex, must equal the checkout (refused before install
                                   otherwise — the accepted acceptance.yml guard pattern, reproduced and tested)
  matrix jobs: one per profile (lan, moderate, elevated, poor), jobs run in parallel;
  inside a job: seeds 1001 → 1002 → 1003 sequentially, three full 20 s + 120 s runs per seed
  per-job timeout-minutes: 30      (≈ 3 × 140 s work + install/build/setup + margin ≈ 12–15 min expected;
                                   a job that cannot beat 30 min has a stall, which is itself a Gate A finding)
  wall-clock target: ≤ 30 min total at four-way parallelism (28 min serial floor ÷ 4 + lifecycle)
  per run: full §7.4 record incl. achieved RTT/jitter validity (INVALID runs fail the job and are reported,
           never silently re-run); bundles declare implementationSha == candidate_sha and are verified and
           published per profile/seed
  gate-a.md: written by the final job once all twelve runs are in, from the actual verdicts
```

Acceptance capture for this spike (the five existing plans plus the new Gate A plan) remains the dispatched
`ci (acceptance — full evidence capture)` workflow's job; the Gate A matrix workflow may be dispatched on the same
candidate. **Any Gate A evidence not bound to the exact candidate commit it describes is not Gate A evidence.**
Where the hosted runner cannot provide `NET_ADMIN` network impairment, that limitation is recorded per §2.4 and
travels with the numbers; the harness-layer loss re-measurement route named in the task file applies.

## 5. First implementation slice: pinned public SDK browser import/API + paired-client smoke probe

The build instruction's first slice is a **feasibility probe of the client side of the spike**, before any Gate A
run is scheduled:

1. **Pinned public SDK browser import/API probe.** Import the pinned `@colyseus/sdk` in `apps/client` **exactly
   as published** (public API only — no private fields, no casts past the declarations, no invented methods;
   root AGENTS.md pin rule), and a browser-context paired-client smoke check: two Playwright contexts join the
   same room on the pinned server, exchange one movement frame and one state delivery each, and record the
   observed public surfaces in `tests/probes/colyseus-client.probe.ts` and the api map.
2. **Scratch, disposable.** Compiler and import diagnostics are first measured under the §3.2 disposable
   scratch paths (`apps/client/spike-scratch/`, `apps/server/spike-scratch/`, the I-1 pattern: create, measure,
   delete; no repository tsconfig changes survive the probe). The paired-client smoke check then runs as the
   granted probe file.
3. **Decision points — measured, then decided by the delegated approver. They do not block the scratch probe
   itself:**

| id | Decision point | Standing rule at this assignment |
| --- | --- | --- |
| **DPA-1** | Client-side declaration/compiler diagnostics once `apps/client` imports the SDK | **ADR-0002 is server-only: its exception covers the two `apps/server` projects and is not extended to `apps/client` — no exception and no new pin is "automatically adopted" by this assignment.** The probe records the exact diagnostic inventory under current policy; any relief (a scoped exception, a shim, an upstream fix) is a separate decision with its own evidence, reviewed before any production client code carries it |
| **DPA-2** | WS-delay-proxy dependency needs (`tools/load-test/src/ws-delay-proxy.ts`) | The proxy must preserve byte order and model stalls as stalls (§2.2). Whether an existing registered dependency suffices or a new pin is needed is recorded from measurement; a new dependency is a D-2-style owner-approved registration under T-9, never an incidental install |

## 6. Required commands and acceptance

```sh
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm build && pnpm test
pnpm test:contract -- --task UDG-SPIKE-001
pnpm test:e2e -- --suite netcode
pnpm test:spike -- --id UDG-SPIKE-001 --profile <lan|moderate|elevated|poor> --seed <1001|1002|1003>   # all 12 combinations
pnpm dependencies:verify && pnpm contracts:checksums
pnpm evidence:capture -- --task UDG-SPIKE-001 --out artifacts
pnpm evidence:verify  -- --run artifacts/<UDG-SPIKE-001-RUN_ID>
pnpm evidence:summary -- --run artifacts/<UDG-SPIKE-001-RUN_ID> --out docs/contracts/assignments/UDG-SPIKE-001-evidence.json
```

Required test coverage is the contract's list: N01–N06, malformed axes, speed attempt, missing frame, queue
burst/overflow, duplicate sender registration, forced correction (labelled server corrections at ticks **40**
and **120**, adoption then replay of remaining valid inputs exactly once), server restart, patch batching and
missing advertised fixed rate. A missing required runtime field is an explicit failure. The local raw predicted
state must respond within **one fixed input step plus one rendered frame** under the declared browser schedule;
render reads are derived from the validated SDK controller and the received schema is never mutated to fake
prediction; observer interpolation follows the accepted timeline without authoring it; local prediction never
causes a second authoritative movement step. Gate A numerical acceptance is §2; a forced correction must converge
to the matched acknowledged state within **0.000001 m** in the pure flat replay check, and `tests/reference/flat-direct-step.ts`
is the sole movement function on both sides.

**Acceptance sequence, fixed:** implement → submit In Review → Codex reviews (including the GA-12 record against
ADR-0003 per §2.4) → Gate A evidence produced on the exact candidate → Codex records the Gate A decision as
delegated integration approver. Only after a Gate A **pass** do P06's freeze and `gate-a.md`'s PASS entry land,
and only then do UDG-005/006 unblock. Failure blocks 005, 006 and all later gates. A custom predictor requires an
ADR; silently replacing Colyseus primitives is prohibited.

## 7. Evidence, integrity and handoff rules

1. Existing store `/workspace/udg-evidence` only; **D4 open**; sanitisation per §19.1; no tokens or private paths
   in any artefact; per-run aliases keep joinability.
2. Every Gate A artefact is candidate-bound (§4). A routine green is not evidence (C-07). A recorded FAIL stays
   FAIL (A-P3-7); flaky tests block verification; a diagnostic rerun never erases an initial failure (§19.2).
3. The completion record states what the bundle is **not** evidence of: Gate B/C thresholds, input parity (Gate
   C), navigation effects (GA-10a/b outstanding), 20-client release performance, or any production tuning not
   measured under GA-11.
4. Re-pin rule: if `main` has moved when the build instruction arrives, the completion record names the new base
   and its green routine run before any code, as UDG-003 Phase 2 / UDG-004 require.

## 8. What this record does not do

- It does not start implementation; the task is **Ready**, and work begins only on the build instruction.
- It adopts **no** Gate B/C thresholds and no Gate C input-parity threshold; it moves no acceptance-gates.md,
  measurement.md or evidence-requirements.md text — the adoption references those files as written.
- It installs nothing, changes no protocol/precision/encoding, adds no dependency, and authorises no private-API
  use at this docs stage; T-9 and DPA-1/DPA-2 exist precisely so those cannot happen silently.
- It extends ADR-0002 to nothing and adopts no new compiler policy, pin or exception (§5).
- It passes no gate and claims no gate: **Gates A, B and C remain Not Run**; `stackCompatibility` remains
  **not-established**; P06 is not frozen; CF-1…CF-4 stay open; GA-10a/GA-10b stay outstanding; **D4 stays open**;
  Part B stays unadopted; UDG-005…UDG-SPIKE-003 stay unassigned.
- It records no acceptance of any UDG-SPIKE-001 work — none exists yet.

## 9. Checksum ledger for the commit carrying this record

`docs/contracts/checksums.json` is regenerated by command
(`node tools/checks/dist/evidence.js checksums --write`, confirmed by `pnpm contracts:checksums` reporting
`in sync`), never hand-edited (M-4). Of the tracked files, **three** digests move and each move is this record's
own edit:

| Tracked file | Moved | Why, and what did not move |
| --- | --- | --- |
| `docs/contracts/UDG-SPIKE-001.md` | `8af4e270935d…` → new | Assignment metadata block only (`Not Started`→`Ready`, `unassigned`→`assigned` with the P10 pointer and prerequisite/baseline/evidence lines). Objective, prerequisites, owned paths, commands, Gate A acceptance text and the CF/GA-10/GA-11 carried-forward notes are unchanged |
| `docs/contracts/adoption.md` | `de49e1908aed…` → new | Header status lines, the P10 table row, and the new *P10 adoption and UDG-SPIKE-001 assignment* section. Historical adoption/acceptance prose is left as written on its own date |
| `README.md` | `976ef5042612…` → new | The assignment-status sentences updated to state UDG-SPIKE-001 is assigned-but-unstarted with P10 adopted for Gate A only. Every string an accepted assertion reads (`24.22.2`, `12.18.0`, `2567`, `5173`, the command names) stays present |

This assignment record, the defect closeouts and other files under `assignments/` are not in the tracked set, so
adding them moves no digest. `docs/contracts/scope.md`, `acceptance-gates.md`, `measurement.md`,
`evidence-requirements.md` and ADR-0003 are untouched; their reviewed digests are the ones in the provenance
block.

## 10. Handoff

| Item | Value |
| --- | --- |
| Implementation baseline | `fc63b65edca55a439862b6e674dc2eb63ef80708` — routine CI `44415266083` (success) |
| Handoff (record) commit | the commit carrying this file, recorded in its own git history; **docs-only** |
| Implementer / reviewer | **Pi** / **Codex (delegated reviewer and integration approver, 2026-11-19)** |
| First slice | §5 — pinned public SDK browser import/API and paired-client smoke check, scratch diagnostics measured, DPA-1/DPA-2 returned for decision |
| Escalation | blockers go to the delegated approver (Codex) through an ADR proposal with a minimal reproduction and affected descendants; blocked is a state, not a licence to relax a requirement |
| Next owner actions | the **build instruction** (names branch/commit and releases the §5 slice); at review time, Codex's review incl. GA-12 against ADR-0003; the Gate A decision only after §4 evidence on an exact candidate |
