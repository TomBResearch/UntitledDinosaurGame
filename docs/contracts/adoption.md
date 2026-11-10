# Contracts adoption record

Status: **Partially adopted — P01, P02, P03 and P06 approved (P03 on 2026-11-09); P04, P05 and P07 to P10 pending**

Implementation assignment: **UDG-001** (authorised 2026-11-08 by the integration owner; **accepted and Verified 2026-11-08**, see [UDG-001 acceptance](#udg-001-acceptance-recorded-2026-11-08)) and **UDG-002** (authorised 2026-11-08, see [P02 and P06 adoption](#p02-and-p06-adoption-recorded-2026-11-08); **accepted and Verified 2026-11-09**, see [UDG-002 acceptance](#udg-002-acceptance-recorded-2026-11-09)), and **UDG-003 Phase 0 only** (authorised 2026-11-09, see [P03 adoption](#p03-adoption-and-udg-003-phase-0-authorisation-recorded-2026-11-09)). Nothing beyond UDG-003 Phase 0 is assigned: UDG-003 Phases 1 to 3, UDG-004 and every later task stay unassigned.

Integration owner: **Project owner, GitHub account `TomBResearch`** — recorded 2026-11-08 at the owner's instruction as both integration owner and project reviewer. Replace with the owner's preferred display name on request; the identity, not the decision, is what may be restated.

The user authorised creating and publishing this repository planning structure. That is not a signature accepting each proposed technical refinement or permission to begin the game implementation. Preserve this distinction when assigning tasks. The 2026-11-08 instruction below is a separate, explicit signature for P01 and for UDG-001 only; it does not adopt P02 to P10 or assign any other task. A second 2026-11-08 instruction adopted P02 and P06 and assigned UDG-002; it adopts nothing else.

Before a task becomes Ready, the owner records the relevant refinement decision, date, reviewed repository commit, contract checksum manifest and any ADR. Adoption may occur per task; unresolved later proposals do not require reopening settled earlier work. An explicit later user/owner approval can be recorded without requesting the same approval again.

The proposal definitions and deadlines have one owner: [scope and authority](scope.md#13-proposed-refinements-requiring-adoption).

| Proposal | Decision | Owner/date | ADR or approval reference |
| --- | --- | --- | --- |
| P01 | **Approved** | Project owner (`TomBResearch`) / 2026-11-08 | Owner instruction recorded as clarifications C-01 to C-06 below. No ADR: the rulings change no baseline clause, protocol, timestep or collision owner. |
| P02 | **Approved** | Project owner (`TomBResearch`) / 2026-11-08 | Decision D1 of the [UDG-002 readiness proposal](assignments/UDG-002-readiness-proposal.md) revision 2, section 1. No ADR: the ruling elaborates baseline §4 to §5 and moves no protocol shape, timestep or collision owner. |
| P03 | **Approved** | Project owner (`TomBResearch`) / 2026-11-09 | Owner instruction recorded as clarifications Q-01 to Q-03 below, on revision 3 of the [UDG-003 readiness proposal](assignments/UDG-003-readiness-proposal.md) reviewed at `df59e540fc880b41a599c33c97e34fab4d7d7fa9`. No ADR: P03 elaborates baseline §5 and moves no protocol shape, timestep or collision owner. |
| P04 | Pending | Unassigned | None |
| P05 | Pending | Unassigned | None |
| P06 | **Approved (deferred-freeze form)** | Project owner (`TomBResearch`) / 2026-11-08 | Decision D2 of the same proposal, section 2, recorded as [ADR 0001 Replica precision policy](../adr/0001-replica-precision-policy.md) (Accepted). Concrete encoding widths and SDK integration remain subject to Gate A validation. |
| P07 | Pending | Unassigned | None |
| P08 | Pending | Unassigned | None |
| P09 | Pending | Unassigned | None |
| P10 | Pending | Unassigned | None |

## P01 adoption clarifications recorded 2026-11-08

The owner approved P01 with the following binding clarifications. They are part of the P01 adoption for assigned work and are reproduced here rather than copied into task files.

| ID | Owner ruling | Resolves |
| --- | --- | --- |
| C-01 | Pin Node `24.22.2` and pnpm `12.18.0` exactly, verify that installation and execution work in the implementation environment, and use the same versions in CI. | `repository.md` §3.1 "repository-pinned supported Node LTS release and exact pnpm version"; UDG-001 runtime pin |
| C-02 | Defer game-library selection to the first task that needs each dependency. UDG-002 selects and tests the Colyseus schema dependency; server/SDK integration follows in UDG-003 and UDG-SPIKE-001. Rapier and Recast remain with UDG-006 and UDG-007. UDG-001 records those libraries as unselected in `docs/integration/dependencies.json` and must not claim a tested compatibility set. | `repository.md` §3.1 "may be selected here" ambiguity; `colyseus.md` §6.1 "package choice is a UDG-001/003 deliverable" |
| C-03 | Keep large raw evidence bundles out of Git, store them durably where the owner can reach them, and permit committing sanitised machine-readable summaries plus evidence hashes with no credentials or sensitive machine details. | `repository.md` §3.1 exclusion of `artifacts/` versus UDG-001 "Retain artifacts/RUN_ID/…" |
| C-04 | UDG-001 must implement and test evidence verification against its own bundle. Suites owned by later, unstarted tasks may remain unavailable and must fail clearly when invoked. | `repository.md` §3.2 "dispatcher that fails clearly for unavailable suites"; §19.1 evidence schema ownership |
| C-05 | CI option 1: the workflow is authored in this task and the identical script sequence is proven locally. CI reproduction is not waived. UDG-001 stays In Review until the real GitHub Actions checks on the pushed commit pass and the owner accepts the work. | UDG-001 "CI reproduces the local result"; `definition-of-done.md` In Review rule |
| C-06 | Review groups R2 to R6 (P02, P06 / P03, P04 / P05, P07 / P08, P09 / P10) remain pending. Each blocks only its own dependants: UDG-002 and everything downstream of it, then the Gate A, B and C spikes, stay Not Started until the relevant group is approved. | `scope.md` §1.3 approval deadlines; adoption-per-task rule |

## P02 and P06 adoption recorded 2026-11-08

The owner approved the consolidated UDG-002 readiness proposal **revision 2**, reviewed at commit
`222a787fb61597fa60a6a465044893a9985dca8c`, and authorised UDG-002 with the clarifications below. This
instruction supersedes the "Next assignment: none" line of the UDG-001 acceptance section beneath it, which
recorded the state at the moment that acceptance was written down.

```text
Reviewed proposal            docs/contracts/assignments/UDG-002-readiness-proposal.md, revision 2,
                             reviewed at 222a787fb61597fa60a6a465044893a9985dca8c
Contract edition             UDG-CONTRACTS-M0-001 v1.0, repository edition 1 (unchanged)
Manifest at review           docs/contracts/checksums.json, 56 entries
                             file SHA-256   6ad6bdbb5540c38d6d142cc1e4f4bb78c76b36755803bb778c146a3c114474db
                             content digest 9b9177c0b57d3b3ee298794761f30fe77b52aa8a71eeef72401e8b86a665ac79
                             (procedure D-1 of the readiness proposal, section 5). This adoption commit
                             regenerates the manifest, so the manifest of the adoption edition is identified
                             by this commit rather than by a self-referential digest written into it.
Baseline                     UDG-SPEC-M0-002 v0.2, SHA-256
                             b51e7afdd6810c377d2d2702d7673119521a59cd0d6b91686700bf9149b73fcf
Approval channel             Owner instruction, 2026-11-08, recording decisions D1 to D5
```

| Decision | Owner ruling | Effect |
| --- | --- | --- |
| D1 | **P02 approved**, including the route-pair rule and the normalisation ordering, with no ADR | [interfaces/protocol.md](../interfaces/protocol.md) §4.2 to §4.4 is adopted as written, plus the pair rule (`routeRevision === 0` requires `nextWaypointIndex === 0`; a positive revision with index zero is an active route at its first waypoint) and normalisation of yaw and signed zero at validation time, before any exact-copy mapping assertion |
| D2 | **P06 approved in the deferred-freeze form**; record [ADR 0001](../adr/0001-replica-precision-policy.md); encoding widths and SDK integration stay subject to Gate A | Canonical domain is float64 end to end and the replica mapping must be lossless; schema encoding widths are provisional until Gate A per baseline §7.2 |
| D3 | **UDG-002 authorised**, including its narrowly scoped tooling extensions and the UDG-001 test amendments | Assignment record: [assignments/UDG-002.md](assignments/UDG-002.md). Grants authorise UDG-002 work only and do not widen functional scope |
| D4 | **Backup destinations remain undesignated.** The independent-backup risk stays open; no archive repository is created, no storage is provisioned and the risk is not claimed resolved | Recorded as an open residual risk in the UDG-002 assignment and completion records |
| D5 | **Explicit validated region bounds with no production defaults**; synthetic fixture bounds remain permitted and clearly labelled | `validateRegionBounds` receives bounds as an argument; absence is a configuration error. Real bounds arrive through UDG-007's `region.json` loaded by UDG-003, as those contracts already state |

Implementation clarifications recorded with the approval, binding on UDG-002:

| ID | Owner clarification |
| --- | --- |
| U2-1 | Historical UDG-001 evidence remains verifiable under its recorded format. New task or schema metadata requirements must not retroactively invalidate accepted bundles or rewrite their bytes, and backward compatibility must be tested. |
| U2-2 | Dependency-record idempotence compares substantive fields using the documented provenance exclusions. A fresh timestamp or recording-commit metadata must never fail a legitimate check. |
| U2-3 | The supporting paths required by the approved plan are included: `tests/unit/**`, `tests/fixtures/catalog.json`, the new boundary fixtures, `README.md`, the ADR, adoption and task metadata, and the UDG-002 assignment, completion and evidence records. These grants permit only UDG-002 work. |
| U2-4 | Neither UDG-002 nor the subsequent UDG-003 foundation may require an asset first produced by UDG-007. Region bounds stay explicitly supplied; later asset integration replaces that source through separately authorised work. |
| U2-5 | Historical checksum manifests are preserved in Git history. Current manifest entries are regenerated when authorised covered files change; historical preservation does not freeze the current manifest. |
| U2-6 | UDG-002 defines and tests protocol types, validation and mapping. It must not implement the authoritative admission, ordering or movement behaviour owned by later tasks. |

Still pending after this instruction: P03, P04, P05, P07, P08, P09 and P10. Gates A, B and C remain Not Run.
UDG-003 and every later task remain unassigned and Not Started.

## P03 adoption and UDG-003 Phase 0 authorisation recorded 2026-11-09

The owner authorised proceeding with **UDG-003 Phase 0 only**, on the basis of revision 3 of the
[UDG-003 readiness proposal](assignments/UDG-003-readiness-proposal.md), and adopted **P03** with the
binding clarifications Q-01 to Q-03 below. Phases 1 to 3 are **not** authorised, no spike gate moved,
and decision D-7 stays open pending probe evidence.

```text
Reviewed proposal            docs/contracts/assignments/UDG-003-readiness-proposal.md, revision 3,
                             reviewed at df59e540fc880b41a599c33c97e34fab4d7d7fa9
                             file SHA-256   d794f9c8ef30c1af23a71b342202195728d44f69c75b610abf86d1baf008d470
Passing CI at review         https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/42658548670
Contract edition             UDG-CONTRACTS-M0-001 v1.0, repository edition 1 (unchanged)
Manifest at review           docs/contracts/checksums.json, 58 entries
                             file SHA-256   afe610ead0f5ac8478ac865883b524d015f97bbb3d0486df903f0e5c5658d780
                             This adoption commit regenerates the manifest, so the manifest of the adoption
                             edition is identified by this commit rather than by a self-referential digest.
UDG-003 task contract        docs/contracts/UDG-003.md at review, SHA-256
                             096f3ff0755569230b884cf4138be035845e28d44ad7332dc6bbd0c9e0cafaf5
Prerequisites                UDG-001 Verified (1c735c2d845e399cc8b3cc33adac4ba7a6081387, CI 42511785889)
                             UDG-002 Verified (372be938f0dd825ff89fac56da7dc29d0789098f, CI 42627324928,
                             acceptance recorded at d364d2dafbc88f469ef60e5e61c5e5c5c6cfd7e4)
                             P01/P02/P06 adoption 74ffdaaba1bc3617999c99e73c7f197ebd01a570
Baseline                     UDG-SPEC-M0-002 v0.2, SHA-256
                             b51e7afdd6810c377d2d2702d7673119521a59cd0d6b91686700bf9149b73fcf
Shared requirement sources   docs/interfaces/movement-authority.md
                             0eaf5eb9d67cf34265ec28486b4b9b012ff42b2e0044ac8c98d49e8d28169f84
                             docs/integration/colyseus.md
                             8bba03fcfb12ac9042c78b3a570e9ff2f2170031079f7f5ac1c3565f78b1090c
Approval channel             Owner instruction, 2026-11-09, recording decisions D-1 to D-7 with D-7 left
                             undecided, and the three binding P03 clarifications below
Assignment record            assignments/UDG-003-phase-0.md (Phase 0 only)
```

| Decision | Owner ruling | Effect |
| --- | --- | --- |
| D-1 | **P03 approved**, as drafted in §1 of the reviewed proposal, with the binding clarifications Q-01 to Q-03 | [movement-authority.md 5.1–5.5](../interfaces/movement-authority.md) and [protocol.md 4.2–4.4](../interfaces/protocol.md) keep ownership; P03-a to P03-i become the adopted elaboration that UDG-003 implements. No ADR |
| D-2 | **The §2.1 pins are approved as provisional candidates only.** Compatibility is established by the authorised installation and the executed probes, never by registry metadata | Authorised install set: `@colyseus/core`, `@colyseus/ws-transport`, `@colyseus/sdk`, `@colyseus/schema` (already installed by UDG-002) and the resolved `express`. What actually resolves is what the register records, even where it differs from the proposed value; a PR-0, PR-2 or PR-3 failure ends Phase 0 with a blocker, not a relaxed compiler policy or a hand-rolled loop |
| D-3 | **`@colyseus/sdk` is permitted** as the transport smoke and probe client, with dependency-register ownership and the limitations recorded **under UDG-003**. Prediction validation remains **UDG-SPIKE-001**'s responsibility. `@colyseus/testing` is left unselected | The register group for `@colyseus/sdk` moves to owner `UDG-003` with its reason recording the limitation, so the package can be declared without a Not-Started task owning a selected library. No prediction, reconciliation or correction-replay behaviour is probed or claimed here; the api-map records every prediction-side name as "not used, and why" |
| D-4 | **Server abuse policy stays outside `configHash`**, with its own recorded digest | `ProtocolLimits` and the frozen UDG-002 `configHash` (`948f8c10fc40…`) are untouched. Abuse limits (1024 B payload, 64 per room, 8 per entity, 40 fps with burst 40) are server-side policy with a digest of their own, recorded where they are enforced. This is UDG-003's D-4 and does not reopen the UDG-002 D4 backup decision, which stays open |
| D-5 | **The explicit synthetic-region mechanism and its opt-in are approved** | Required `UDG_REGION_BOUNDS_PATH`, mandatory `"provenance": "test-only-synthetic"` label, explicit `UDG_ALLOW_SYNTHETIC_REGION=1`, and a derived non-asset `manifestHash` documented as not an asset manifest. No UDG-007 asset is required, per U2-4 |
| D-6 | **Supporting paths and controlled grants are approved only as needed for adoption, assignment and Phase 0** | Grants are listed per Phase in [assignments/UDG-003-phase-0.md](assignments/UDG-003-phase-0.md). A-3, A-4, A-5, A-6 and A-6b of the proposal's amendment schedule are **deferred**, because nothing in Phase 0 makes them necessary; deferral is recorded there rather than silently skipped |
| D-7 | **Undecided, pending the acknowledgement probe.** No requirement is waived | PR-8 must show experimentally what the pinned acknowledgement tracks. The prohibition on acknowledging frames that were never represented in state stays in force, and the outcome is returned for decision with its evidence |

Binding P03 clarifications recorded with the approval. They are part of the P03 adoption for assigned
work and are reproduced here rather than copied into task files.

| ID | Owner ruling | Resolves |
| --- | --- | --- |
| Q-01 | Queue selection, screening and backlog purging operate **only on the frozen eligible snapshot**. Observations that arrive after the cutoff remain untouched until a later tick | P03-b cutoff and P03-c stages Q/S/C: a tick must not act on input it never froze |
| Q-02 | Removal is explicit: the selected continuous observation leaves the queue **exactly once**, and each processed discrete request leaves its queue **exactly once**. Retained frames keep FIFO order. The accounting invariant and the arrival-during-tick cases are tested, not assumed | P03-c stage C and P03-f queue policy: double removal and silent retention are both observable failures |
| Q-03 | The frozen-batch duplicate registry must retain the original request's **arrival ordinal**, its **payload identity** and its **eventual shared disposition**, so an identical retry can neither create another terminal record nor cause another transition | P03-d stage S batch registry and P03-g `result` stream: "shares one disposition" has to be reconstructible from the record |

Still pending after this instruction: P04, P05, P07, P08, P09 and P10. **Gates A, B and C remain Not
Run** and no spike gate decision exists. UDG-003 Phases 1 to 3 stay unassigned, UDG-004 and every later
task stay Not Started, and the UDG-002 D4 independent-backup destination stays undesignated with that
risk open.

## UDG-001 acceptance recorded 2026-11-08

The project owner (`TomBResearch`), acting as reviewer and integration owner, accepted the UDG-001
implementation and its two scoped corrections on 2026-11-08. The task state is **Verified**.

```text
Accepted implementation   1c735c2d845e399cc8b3cc33adac4ba7a6081387
Reviewed submission       0e586b619796597266f7ec4942d24231dfb5ce62
Passing submission CI     https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/42511785889
Acceptance covers         the implementation, the scoped CI-evidence correction (50c6cee), the
                          non-PASS-bundle correction (1c735c2), declared additions A1 to A4 and
                          deviations D1 to D3 of the completion record
Clarification C-05        satisfied: the workflow ran green on the pushed commit and the owner
                          accepted the work. The ruling itself is unchanged and applies to any
                          later task that authors CI
Not adopted or passed     P02 to P10 remain Pending; Gates A, B and C remain Not Run; no spike gate
                          decision exists
Contract edition          UDG-CONTRACTS-M0-001 v1.0, repository edition 1 - unchanged by acceptance.
                          The reviewed digest
                          1b33cc20128ab75c59591448496164e30039018691e2a7d85ab21d7372926257 continues
                          to identify the edition the owner reviewed; docs/contracts/checksums.json
                          was regenerated for this acceptance edition (56 entries, verified in sync
                          against file bytes) and identifies the edition in which the acceptance was
                          written down, as the closing rule of this record requires
Next assignment           none. UDG-002 and every later task stay Not Started until the owner
                          records the relevant refinement decision and assigns the task
```

The decision fields of [assignments/UDG-001-completion.md](assignments/UDG-001-completion.md) carry
the same record, and the state history at the foot of
[assignments/UDG-001.md](assignments/UDG-001.md) shows the transition.

## UDG-002 acceptance recorded 2026-11-09

The project owner (`TomBResearch`), acting as reviewer and integration owner, accepted the UDG-002
implementation on 2026-11-09. The first submission was reviewed, drew four corrections, and the
corrected head was accepted. The task state is **Verified**.

```text
Accepted implementation   372be938f0dd825ff89fac56da7dc29d0789098f
Reviewed submission       a967c5f97ede7126837addcd192eb599648b9546
Passing submission CI     https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/42627324928
                          (success, 23 of 23 steps on the reviewed submission)
Review history            first submission a2a2318e31d38b731fed543e0eb49dce5474de55, reviewed by the
                          owner; four corrections implemented at
                          9b04ee2802dac72588163828beaaafeae39ff08f — GENERATION_MAX in both mapping
                          directions, canonical route round trips in both directions, removal of the
                          enforceRoutePairRule public bypass, and record/digest attribution — plus the
                          follow-up at 372be938f0dd825ff89fac56da7dc29d0789098f which reports each malformed route field once instead of
                          twice. Nothing became more permissive at any step
Acceptance covers         the implementation, the four review corrections, the follow-up route-report
                          tightening, the documentation corrections the review authorised, and the
                          declared additions and deviations recorded in
                          assignments/UDG-002-completion.md
Clarification C-05        satisfied: the workflow ran green on the pushed reviewed submission and the
                          owner accepted the work
Evidence preserved        every bundle from the first submission, the correction rounds and this
                          acceptance review is retained and still verifies; no bundle byte or recorded
                          digest was rewritten. The task-file digest moves again with this acceptance
                          entry, which is the disclosure already stated in the completion record: no
                          bundle can pin the bytes of a commit written after it, so each bundle's own
                          report remains the authority for the edition it recorded
Not adopted or passed     Gates A, B and C remain Not Run and no spike gate decision exists; schema
                          encoding widths and any SDK integration remain provisional under ADR 0001
                          until Gate A; P03, P04, P05, P07, P08, P09 and P10 remain Pending; owner
                          decision D4 leaves the independent-backup destination undesignated and that
                          risk open — no storage was provisioned and no archive repository created
Contract edition          UDG-CONTRACTS-M0-001 v1.0, repository edition 1 — unchanged by acceptance.
                          docs/contracts/checksums.json is regenerated for the acceptance edition by
                          `pnpm contracts:checksums -- --write`; the acceptance commit identifies that
                          edition, because a manifest cannot pin its own bytes
Next assignment           none. UDG-003 and every later task stay Not Started until the owner records
                          the relevant refinement decision and assigns the task
```

The decision fields of [assignments/UDG-002-completion.md](assignments/UDG-002-completion.md) carry the
same record, and the state history at the foot of
[assignments/UDG-002.md](assignments/UDG-002.md) shows the transition.

## UDG-003 Phase 0 review instruction recorded 2026-11-09

The owner reviewed the Phase 0 submission (head `83d33321`, CI run `42679471471`) and instructed the
corrections below. This is the owner's instruction, recorded by the implementer; the remedy options in
[assignments/UDG-003-phase-0-completion.md](assignments/UDG-003-phase-0-completion.md) §9.4 and api map §5.4
remain **recommendations** and nothing there is adopted. Decisions D-1…D-7 recorded above are unchanged.

| id | Owner instruction | Effect recorded |
| --- | --- | --- |
| D-8 | The Phase 0 candidate stack is **not** accepted as compatible and Phase 1 is **not** authorised | `stackCompatibility: "not-established"` in `artifacts/probes/compatibility-verdict.json`; Phases 1–3 stay unassigned; no pin promoted from provisional candidate |
| D-9 | Compiler status must be unambiguous and reported separately: strict typechecking is the gate, `--noCheck` is diagnostic emission and never the accepted build path | PR-0 reports `verdict: "blocked"`, `ok: false`, with `blockedReason`; api map §0 states the three questions apart; `--noCheck` removed from the `@udg/server` `build` script; the suite asserts all of it |
| D-10 | PR-8 must trace distinct frame identities through receipt, buffering, overflow, consumption, refusal, drop and acknowledgement; determine whether the acknowledgement is a count or a sequence watermark and which frames it retire; assert the observed relationship; preserve the earlier evidence while correcting the conclusion; keep D-7 undecided | The first submission's S4 conclusion ("dropped frames are never acknowledged") is **wrong** and is now recorded as superseded: overflow eviction counts as consumed, so dropped frames **are** retired by the watermark `lastProcessed` while never being represented in state. The acknowledgement is a sequence watermark equal to the server `consumedCount`, retiring a prefix with no per-frame disposition; applied, refused and dropped are indistinguishable to the client. An application journal is server-side evidence and does not prove client reconciliation. **D-7 remains open** |
| D-11 | Remove `client as never` from the reconnection probe, use the publicly declared client type, and make sure that bypass cannot be reported as clean | `apps/server/probes/rooms.ts` types `onJoin`/`onLeave`/`onDrop` with `Client` from `@colyseus/core` and passes it to `allowReconnection` uncast; PR-0's escape-hatch scan bans `as never` and `as unknown` and now scans code only (comments and literals stripped), so prose can neither create nor conceal an offender |
| D-12 | Prepare a concrete PH0-B1 remedy recommendation; separate configuration/type-environment issues from upstream declaration defects; investigate compatible exact versions first; a compiler-policy change must be narrowly scoped, explained precisely and demonstrated not to add DOM globals or hide errors; **do not adopt new pins, flags, shims or package patches without approval** | Recorded in api map §5.1–5.4 and completion §9.4: class A (23 × `HeadersInit`, DOM-lib assumption), class B (2 × `TS1192`, libraries default-import `node:http`), class C (2 × `TS2344`, a defect inside `@colyseus/sdk`'s own published types). All four pinned packages are already the latest published versions and every published candidate carries the same defects; TypeScript 5.8/6/7 does not clear them and TS 6/7 cannot read `esModuleInterop: false`. Measured variants: DOM lib 27→4 (adds DOM globals — demonstrated), `allowSyntheticDefaultImports` 27→25, ambient `HeadersInit` shim 27→4, both 27→2, `skipLibCheck` 27→0. **Recommendation R0: keep PH0-B1 open and change nothing.** Nothing adopted |
| D-13 | Reclassify the epoch finding accurately: UDG `sessionEpoch` is application-owned and distinct from SDK input bookkeeping, and the absence of a UDG epoch API in Colyseus is not a library defect | **PH0-B2 reclassified** from blocker to design obligation (it does not gate Phase 1). PR-12 records the supported lifecycle primitives measured, the renewal procedure UDG still has to build (specified, not implemented; Phase 2 `DevelopmentSessions`), and what remains unproved. No reset call invented |
| — | No retention provisioning is authorised | No release, tag, archive or storage location created, replaced or deleted. **D4 stays open**: the independent backup destination remains undesignated |

State after this instruction: **UDG-001 Verified**, **UDG-002 Verified**, **UDG-003 In Progress — Phase 0
revision 2 resubmitted for review**; Phases 1–3 unassigned; Gate A, B and C **Not Run**; P04, P05, P07–P10
Pending; encoding widths provisional under ADR 0001; **D-7 open**; **D4 open**. Nothing in this entry is an
acceptance, a gate pass or an adoption of a remedy.

## UDG-003 Phase 0 remedy investigations recorded 2026-11-09

The owner acknowledged the corrected Phase 0 findings, left **Phase 1 unassigned** and **D-7 undecided**, and
authorised two narrowly scoped investigations plus one decision document. These are recorded as instructions
(`I-*`), not decisions: no compiler setting, pin or protocol rule is adopted by them, and the recommendations they
produced stay recommendations.

| id | Owner instruction | Effect recorded |
| --- | --- | --- |
| I-1 | Evaluate `skipLibCheck: true` confined to the Colyseus integration projects as an explicit **proposed** exception, preserving strict first-party checking, `noImplicitAny`, the boundary rules, the DOM-globals prohibition and the bans on dependency patches and suppression comments; keep the full declaration-error inventory as a separate diagnostic; demonstrate in scratch configurations that first-party errors still fail, invalid calls to the public APIs UDG uses still fail, `window`/`document` stay unavailable, repository code does not acquire unchecked types through the affected declarations, and protocol/config plus unrelated workspaces retain current policy; distinguish internal declaration checking from checking application calls; identify exactly which future projects would need it; explain residual risk accurately; **do not apply the exception to repository configuration and do not describe PR-0 as passed under the existing policy** | Measured, nothing applied. `apps/server/.adr-scratch` scratch configs and 19 negative fixtures were created, measured and deleted; no repository tsconfig changed and PR-0 still reports **BLOCKED**. Probe project 27 third-party / 0 first-party diagnostics → 0 / 0 with the exception; with the negative fixtures 47 (27 + 20) → 20, **the identical 20 first-party diagnostics**; `window`, `document`, `HTMLElement` still error; 13 of 15 invalid public-API calls still error (the other 2 escape under **both** policies — pre-existing upstream looseness); compiler-API comparison over 752 first-party call expressions shows **identical resolved signatures** and 0 expressions acquiring a type from the six defective declaration files. Per-import measurement: `@udg/protocol`/`@udg/protocol/schema` need nothing; `apps/server` needs it (23–26 diagnostics by entry); `apps/client` needs it for 3 of its own once it imports `@colyseus/sdk`, because 22 of 23 `HeadersInit` diagnostics are an artefact of the server's Node `lib`. Residual risk measured too: an unresolvable **exported** type, and an error inside a declaration file the repository itself emits, are both silenced. Recorded in [ADR-P-0002 Part A](../adr/proposals/UDG-003-compiler-exception-and-input-backlog-posture.md) and api map §10, with a supersession note on api map R4. **Recommendation unchanged: R0** |
| I-2 | Using the current pins, run minimal Phase 0 probes to determine whether a public, supported mechanism can prevent overflow retirement (for example refusing or disconnecting an offender before an unrepresented frame is retired); prove bounded buffering; identify exactly which frames are consumed, neutralised, dropped and acknowledged; **no** unbounded queue, private SDK state, fabricated acknowledgement or custom prediction/input transport as a workaround; if no compliant mechanism exists, state that plainly and propose the smallest required architectural decision; do not present journal evidence as proof of client reconciliation; separate what the SDK proves from what UDG-SPIKE-001 must still prove | `apps/server/probes/pr13-overflow-policy.probe.ts` added (20 checks, plus `OverflowRoom`), nine postures measured. **No rejection lever exists**: `sanitize` is the only admission hook and is typed `(input) => void`, and no `InputAccessor`/`InputHandle` member withholds or retracts an acknowledgement. `clear()` moves the same watermark an eviction moves; `seqField` leaves the ack a send-order watermark; `drain()`-then-apply-latest acknowledges frames the server never simulated (the declarations warn; N7 measures it); a per-tick threshold plus `Client.leave()` and `Room.maxMessagesPerSecond` are **enforcement, not prevention** — frames were already acknowledged without a step before the 20 Hz tick or the rate cut arrived. Prevention was achieved twice: `take(n)` with `n ≥ ceil(admittedRate / stepRate)` (0 acked without a step, peak backlog 2 of 4, no disconnect) and a `Room.send()` backlog signal with an obeying sender. Buffering stayed at or below the declared bound in every scenario. Smallest architectural decision: admitted input rate + derived `take(n)` budget + derived `bufferMaxSize`, one deterministic offender consequence, one explicit client resync state. SDK-proof/SPIKE-proof split stated explicitly; no journal is offered as reconciliation evidence |
| I-3 | Produce one decision document with concrete measured options and a recommendation, not a request to choose among untested remedies; draft upstream bug reports **for review only** and do not publish them; preserve historical evidence; create or alter no release, tag or storage; D4 stays open | [docs/adr/proposals/UDG-003-compiler-exception-and-input-backlog-posture.md](../adr/proposals/UDG-003-compiler-exception-and-input-backlog-posture.md), status **Proposed**: Part A (compiler candidate, options A0–A6, recommendation A0), Part B (posture, sizing rule, four-item decision), impact, requested decisions, appendix A (reproducible scratch measurements), appendix B (two upstream report drafts, **not published**). No issue opened; no prior evidence rewritten; no release, tag, archive or storage touched |

State after these investigations: **UDG-001 Verified**, **UDG-002 Verified**, **UDG-003 In Progress — Phase 0
revision 3 submitted for review** (revision 2 corrections plus the two authorised investigations); Phases 1–3 still
unassigned; Gate A, B and C **Not Run**; P04, P05, P07–P10 Pending; widths provisional under ADR 0001;
**D-7 open**; **D4 open**; `stackCompatibility` remains **not-established** and PH0-B1 remains **blocked**.
Nothing in this entry is an acceptance, a gate pass, or an adoption of a remedy.

*Superseded on 2026-11-10 by D-16 and D-17 below, which accept Part A for the two `apps/server` projects and return
Part B. The rows above are kept as the record of what was measured and decided at that point.*

## UDG-003 Part A acceptance and Part B return recorded 2026-11-10

The owner decided Part A of [ADR-P-0002](../adr/proposals/UDG-003-compiler-exception-and-input-backlog-posture.md),
refused Part B as a solution, and required five corrections. Recorded here by the implementer on the owner's
instruction; the implementer authored no approval.

| id | Owner decision or instruction | Effect recorded |
| --- | --- | --- |
| D-16 | **Part A option A4 is approved as an explicit compiler-policy exception for the current `apps/server` projects only** — `apps/server/tsconfig.json` and `apps/server/tsconfig.probes.json`. The accepted ADR is recorded **before** applying it. The approval must **not** be extended to `apps/client` or any other project; the owning task reviews that separately. Strict first-party checking and all existing boundary rules are preserved. No DOM globals, no suppression comments, no dependency patches, no ambient shims. The full-check declaration diagnostic is retained and **new diagnostic changes must be visible to review**. Separate strict checks of UDG-owned package declarations are kept, **without importing the problematic server/SDK stack**. PR-0 is restated as: first-party code typechecks against the pinned declarations under this documented exception. It must not claim the vendor declaration defects are fixed, nor that runtime compatibility follows from compilation | Accepted as **[ADR-0002](../adr/0002-server-declaration-checking-exception.md)**. Applied to exactly the two named files, each naming the ADR, with `tsconfig.base.json` and every other project unchanged at `skipLibCheck: false`. The retained full check (`--skipLibCheck false` over the same project) produces the complete third-party declaration inventory, pinned in `docs/integration/colyseus-declaration-inventory.json`; the probe suite compares live against pinned and **fails on any delta**, so an added file, new code, changed count or vanished entry becomes a review event. A new root check `tsconfig.declarations.json` typechecks `@udg/protocol` and `@udg/config` emitted declarations strictly with `skipLibCheck: false` and without `@colyseus/core`, `@colyseus/sdk` or `@colyseus/ws-transport`. PR-0 now reports `verdict: "pass"` on the restated, weaker claim and lists `explicitlyNotClaimed`; `stackCompatibility` stays **not-established** and PH0-B1 is closed **by exception, not by a fix** — the 27 vendor diagnostics remain listed and unpinned-free |
| D-17 | **Part B is not approved as the backlog solution and Phase 1 remains unassigned.** Correct five conclusions: (C-1) `take(n)` changes the adopted one-input-per-entity-per-tick requirement and is a baseline/P03 amendment, not merely configuration; (C-2) the probe's `simulated`/`applied` arrays are bookkeeping, not an executed movement solver, so describe precisely what was measured; (C-3) the average-rate sizing formula is a necessary capacity consideration, not a sufficient guarantee against bursts, jitter or an adversarial sender; (C-4) an obedient loopback sender and a disconnect after eviction do not establish the required protection; (C-5) remove the assertion that catch-up draining is already part of the accepted design, because the current contract explicitly forbids draining and applying only the newest frame. Return a focused Part-B architectural recommendation instead, without another broad survey of postures and without implementing multi-input, the authority core or Phase 1 | Proposal §0 records C-1…C-5 as supersessions that keep the original sentences visible, with the affected passages marked inline; the "continuity with catch-up draining" claim is deleted. The replacement recommendation is **[UDG-003-input-consumption-rule.md](../adr/proposals/UDG-003-input-consumption-rule.md)**: it states whether the one-input rule survives a demonstrated supported mechanism, names the exact clauses that would have to change if it does not ([v0.2 §7.1 steps 1 and 5 and its anti-cheat constraint](../specifications/UDG-SPEC-M0-002.md); [movement-authority.md §5.1 paragraphs 3–4 and §5.2 final sentence](../interfaces/movement-authority.md)), specifies the conservation requirements for any multi-input alternative, and fixes the minimal real-state correctness probe and burst/adversarial acceptance tests that must pass **before** adoption. It is a proposal: no clause has been amended and no implementation is assigned |
| — | No additional retention provisioning or external publication is authorised; **D-7 remains open**; Gates A/B/C remain **Not Run** | No release, tag, archive or storage location created, replaced or deleted; no upstream report published (both remain drafts in the proposal appendix) |

State after this decision: **UDG-001 Verified**, **UDG-002 Verified**, **UDG-003 In Progress — Phase 0 revision 4
submitted for review** (revision 3 plus the ADR-0002 application and the Part B correction); Phases 1–3 still
unassigned; Gate A, B and C **Not Run**; P04, P05, P07–P10 Pending; widths provisional under ADR 0001;
**D-7 open**; **D4 open**. `stackCompatibility` remains **not-established**: a documented declaration-checking
exception is not a compatibility result.

## Reviewed edition and pins for the P01 approval

```text
Reviewed repository commit   555735b6b3b2b72ec23fb99f2db26cbe3cef67a2 (main, clean tree)
Contract edition             UDG-CONTRACTS-M0-001 v1.0, repository edition 1
Checksum manifest            docs/contracts/checksums.json, 56 entries, all verified against file bytes
Manifest digest reviewed     1b33cc20128ab75c59591448496164e30039018691e2a7d85ab21d7372926257
                             (SHA-256 over the manifest algorithm, entry count and sorted path+hash pairs
                              at the reviewed commit)
Approval channel             Owner instruction in the UDG-001 assignment session, 2026-11-08
Accepted ADRs                None
```

`docs/contracts/checksums.json` is regenerated whenever an edition-controlled planning file changes, including this record and the UDG-001 task metadata. The digest above identifies the edition the owner reviewed; the regenerated manifest identifies the edition in which that approval was written down. Assignment and completion records stay outside the edition manifest and pin their own commits, as stated below.

Baseline SHA-256: `b51e7afdd6810c377d2d2702d7673119521a59cd0d6b91686700bf9149b73fcf`

The baseline is [M0 Technical Specification v0.2](../specifications/UDG-SPEC-M0-002.md). The [current plan and version guide](../specifications/README.md) distinguishes that architecture baseline from these v1.0 agent contracts. Restoring the baseline and clarifying navigation on 7 November 2026 does not change the pending decisions above, assign implementation work or pass a gate.

The [contract checksum manifest](checksums.json) identifies this edition's planning files. Future approvals pin a Git commit and manifest digest rather than claiming an unchanged bundle after edits. Task assignment and completion records are outside this edition's immutable manifest; they must pin their own reviewed commits.
