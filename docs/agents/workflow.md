# Agent workflow

How agents (and humans) pick up, do and finish work. Keep it light. The aim is steady progress, not paperwork.

## Before starting

1. Read [CLAUDE.md](../../CLAUDE.md) and the current milestone in [milestones.md](../roadmap/milestones.md).
2. Read the architecture and design docs the task touches.
3. Check [open-questions.md](../open-questions.md). **If the task depends on an open question, ask the owner first.**
4. If a decision record is *Proposed* and your task depends on it, ask before building on it.

## While working

- **One task per branch:** `m<milestone>/<short-name>`, for example `m0/protocol-generator`.
- **Write tests first where you can.** For server logic, that means tick-stepped tests that call `region.Step()`. Never sleep in real time.
- **Run `tools/check.sh` before every push.** It's the same as the CI fast lane. Then carry on working: **don't stop to wait for CI after every commit.** Check CI when you open or update the PR.
- **GDScript:** static types everywhere, `class_name` for shared types, no magic numbers (they go in `data/` or a config resource).
- **Go:** standard layout, `internal/` packages, no global state, and as few allocations as possible in tick code.
- **Content and balance:** edit `data/` only. Never hard-code a number that's in data.
- Use the **Godot MCP** or headless Godot to run scenes and tests, and the **Blender MCP** for assets. Save Blender sources to `assets-src/`.
- Commit often, with clear messages.

## Definition of done

- [ ] The task's acceptance criteria pass.
- [ ] `tools/check.sh` passes, and so does the CI fast lane on the PR.
- [ ] Security-sensitive changes include the negative tests from [security.md](../architecture/security.md#required-tests).
- [ ] The headless Godot run of the affected scenes shows 0 errors and 0 warnings.
- [ ] Docs are updated if behaviour changed, with a new ADR for a significant technical choice.
- [ ] **If a player can see the change**, the matching `wiki/` page and [wiki/changelog.md](../../wiki/changelog.md) are updated, and the page is set to `status: published` if the feature now exists.
- [ ] Nothing internal was added to `wiki/` ([ADR 0008](../decisions/0008-public-wiki-private-docs.md)).

## Changing the design

- **Player-facing rule changes need the owner's approval.** Propose them; don't decide them.
- Technical choices within the documented architecture can be made by the agent. Record significant ones as an ADR.
- Changing an Accepted ADR needs a new ADR that supersedes it, plus the owner's approval.

## Keeping the docs accurate

The docs and wiki are the project's memory. If you find a doc that doesn't match the code, fix whichever one is wrong in the same PR, or raise it with the owner if you're not sure which is right.
