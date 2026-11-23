# 0008: Public `wiki/` and private `docs/`

**Status:** Accepted (2026-11-23)

## Context

The owner wants a public wiki for players and a private one for development. Both must stay accurate as the game changes, so they should live next to the code and change in the same commits.

## Decision

- **`wiki/`** is player-facing. It's published at `https://dinosaur.untitledgames.co.uk/wiki/`.
- **`docs/`** is developer-facing. It's published at `https://dinosaur.untitledgames.co.uk/dev/`, behind a password at first, and later behind a platform login for staff (admin and above).
- Both are plain Markdown, built to static HTML by one static site generator (chosen in M0 and recorded in its own ADR), and deployed with the game.
- **Wiki pages carry front matter** with `status: draft | published`. Only `published` pages are built. A page becomes `published` when its feature ships, so the public wiki never describes things that don't exist yet.

### What goes where

| Public `wiki/` | Private `docs/` |
|---|---|
| Getting started, controls, UI | Architecture, protocol, security, infrastructure |
| Skills: what they do, what unlocks at each level | Decision records, roadmap, open questions |
| The XP table (levels and XP needed) | The XP formula's reasoning and tuning notes |
| Items, equipment stats, recipes | Unreleased content of any kind |
| Creatures, their drops and drop rates (once released) | Balance reasoning and economy targets (hours to max level, gold sinks) |
| Released quests, with walkthroughs | Anti-cheat rules, rate limits, detection |
| World map, worlds and premium explained | Staff tools and moderation procedures |
| Patch notes (`wiki/changelog.md`) | Exact combat formulas (the wiki shows bonuses and effects, not the maths) |

When unsure, keep it in `docs/`.

## Consequences

- A change that alters anything a player can see updates the matching wiki page and the changelog in the same commit.
- Drop rates are public once released, because players value them and it's honest. Formulas stay private so tuning stays flexible.

## Rejected

- **A hosted wiki (MediaWiki, Notion):** it drifts from the code, and agents can't update it in the same change.
