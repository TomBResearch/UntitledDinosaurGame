# Current project plan and specification baseline

The current M0 plan consists of the **Technical Specification v0.2** and the **Agent Implementation Contracts v1.0**. These documents use separate version numbers for different purposes. The contracts turn the specification into work packages; their v1.0 version does not supersede the v0.2 architecture baseline.

## Which files to use

| Planning layer | Current version and location | Purpose and status |
| --- | --- | --- |
| Architecture baseline | [UDG-SPEC-M0-002, v0.2](UDG-SPEC-M0-002.md) | Latest architecture specification. No successor specification has been adopted. Preserve the original text. |
| Executable task planning | [UDG-CONTRACTS-M0-001, v1.0](../contracts/README.md) | Eleven individual work packages through UDG-SPIKE-003, with linked shared contracts. Implementation has not started. |
| Shared operational details | [Interface owners](../interfaces/README.md), [integration validation](../integration/README.md) and [validation requirements](../validation/README.md) | Detailed interface, ordering, fixture, measurement and evidence requirements referenced by each task. Proposed refinements follow adoption status. |
| Proposed refinements | [Scope and authority](../contracts/scope.md) and [adoption record](../contracts/adoption.md) | P01-P10 remain pending. Publishing or restoring documents does not approve these decisions. |
| Architectural changes | [ADR procedure](../adr/README.md) | Accepted decisions amend the applicable contracts and record affected verification. No accepted decision currently replaces v0.2. |

## Agent starting point

Read the repository [AGENTS.md](../../AGENTS.md), then the assigned [task contract](../contracts/README.md) and its linked requirements. Use the baseline for architecture context and requirements not refined by an approved decision. The [scope and authority rules](../contracts/scope.md#12-normative-language-and-precedence) define precedence; a pending proposal must not silently override the baseline.

All eleven implementation tasks remain Not Started, and Gates A, B and C remain Not Run. UDG-009 through UDG-012 are later roadmap context, outside this contracts edition. There is no game implementation or verified third-party integration to infer from the planning files.

## Baseline identity and preservation

[UDG-SPEC-M0-002](UDG-SPEC-M0-002.md) is the full M0 Technical Specification v0.2 dated 7 November 2026. It is preserved byte-for-byte from the repository's original README at commit `26f9dc854dc160bae18b582222fd73ae095cae82`.

- Original Git blob SHA-1: `f0f39faabd1fc8602f41d738784c5294781878ca`
- File SHA-256: `b51e7afdd6810c377d2d2702d7673119521a59cd0d6b91686700bf9149b73fcf`
- Original location: `README.md`
- Current location: `docs/specifications/UDG-SPEC-M0-002.md`

Preserve this baseline. Changes to the working contracts belong in their authoritative files and require the [adoption/ADR procedure](../contracts/adoption.md). A successor baseline must have a new revision and a declared supersession relationship.

The Word review document is an earlier export of the v1.0 contracts. The linked Markdown files are the maintained working instructions. Keep one operational owner per requirement rather than copying all task instructions into this directory. [Provenance](../contracts/provenance.json) records source identity, packaging and maintenance history.
