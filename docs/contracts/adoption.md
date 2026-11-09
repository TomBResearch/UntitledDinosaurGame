# Contracts adoption record

Status: **Partially adopted — P01, P02 and P06 approved 2026-11-08; P03 to P05 and P07 to P10 pending**

Implementation assignment: **UDG-001** (authorised 2026-11-08 by the integration owner; **accepted and Verified 2026-11-08**, see [UDG-001 acceptance](#udg-001-acceptance-recorded-2026-11-08)) and **UDG-002** (authorised 2026-11-08, see [P02 and P06 adoption](#p02-and-p06-adoption-recorded-2026-11-08); **accepted and Verified 2026-11-09**, see [UDG-002 acceptance](#udg-002-acceptance-recorded-2026-11-09)). No task beyond UDG-002 is assigned.

Integration owner: **Project owner, GitHub account `TomBResearch`** — recorded 2026-11-08 at the owner's instruction as both integration owner and project reviewer. Replace with the owner's preferred display name on request; the identity, not the decision, is what may be restated.

The user authorised creating and publishing this repository planning structure. That is not a signature accepting each proposed technical refinement or permission to begin the game implementation. Preserve this distinction when assigning tasks. The 2026-11-08 instruction below is a separate, explicit signature for P01 and for UDG-001 only; it does not adopt P02 to P10 or assign any other task. A second 2026-11-08 instruction adopted P02 and P06 and assigned UDG-002; it adopts nothing else.

Before a task becomes Ready, the owner records the relevant refinement decision, date, reviewed repository commit, contract checksum manifest and any ADR. Adoption may occur per task; unresolved later proposals do not require reopening settled earlier work. An explicit later user/owner approval can be recorded without requesting the same approval again.

The proposal definitions and deadlines have one owner: [scope and authority](scope.md#13-proposed-refinements-requiring-adoption).

| Proposal | Decision | Owner/date | ADR or approval reference |
| --- | --- | --- | --- |
| P01 | **Approved** | Project owner (`TomBResearch`) / 2026-11-08 | Owner instruction recorded as clarifications C-01 to C-06 below. No ADR: the rulings change no baseline clause, protocol, timestep or collision owner. |
| P02 | **Approved** | Project owner (`TomBResearch`) / 2026-11-08 | Decision D1 of the [UDG-002 readiness proposal](assignments/UDG-002-readiness-proposal.md) revision 2, section 1. No ADR: the ruling elaborates baseline §4 to §5 and moves no protocol shape, timestep or collision owner. |
| P03 | Pending | Unassigned | None |
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
