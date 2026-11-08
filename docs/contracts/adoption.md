# Contracts adoption record

Status: **Partially adopted — P01 approved 2026-11-08; P02 to P10 pending**

Implementation assignment: **UDG-001 only** (authorised 2026-11-08 by the integration owner)

Integration owner: **Project owner, GitHub account `TomBResearch`** — recorded 2026-11-08 at the owner's instruction as both integration owner and project reviewer. Replace with the owner's preferred display name on request; the identity, not the decision, is what may be restated.

The user authorised creating and publishing this repository planning structure. That is not a signature accepting each proposed technical refinement or permission to begin the game implementation. Preserve this distinction when assigning tasks. The 2026-11-08 instruction below is a separate, explicit signature for P01 and for UDG-001 only; it does not adopt P02 to P10 or assign any other task.

Before a task becomes Ready, the owner records the relevant refinement decision, date, reviewed repository commit, contract checksum manifest and any ADR. Adoption may occur per task; unresolved later proposals do not require reopening settled earlier work. An explicit later user/owner approval can be recorded without requesting the same approval again.

The proposal definitions and deadlines have one owner: [scope and authority](scope.md#13-proposed-refinements-requiring-adoption).

| Proposal | Decision | Owner/date | ADR or approval reference |
| --- | --- | --- | --- |
| P01 | **Approved** | Project owner (`TomBResearch`) / 2026-11-08 | Owner instruction recorded as clarifications C-01 to C-06 below. No ADR: the rulings change no baseline clause, protocol, timestep or collision owner. |
| P02 | Pending | Unassigned | None |
| P03 | Pending | Unassigned | None |
| P04 | Pending | Unassigned | None |
| P05 | Pending | Unassigned | None |
| P06 | Pending | Unassigned | None |
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
