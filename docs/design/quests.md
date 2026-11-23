# Quests

## Types

- **Side quests:** short and self-contained. Example: Grug wants the small raptors cleared out of his cave.
- **Quest series:** longer story arcs across several quests, each needing the one before. These carry the main story.

## How a quest is built (data-driven)

Each quest is a file in `data/quests/<id>.json`:
- **Requirements:** skill levels, earlier quests, and Premium for premium quests.
- **Stages:** numbered steps with journal text. Each stage moves on when something happens:
  - talk to an NPC
  - kill N of a creature
  - bring items
  - reach a place (a `QuestTrigger` area in Godot)
  - use an item on something
- **Dialogue:** a small graph of NPC lines and player options. Options can check conditions (quest stage, items, levels) and trigger effects (give or take items, set the stage).
- **Rewards:** XP in chosen skills, items, quest points, and unlocks (new areas, recipes, abilities).

The server tracks each quest's stage and flags in `character_quests`. The client only shows dialogue and the journal.

## The quest journal

A list of quests that aren't started, are in progress or are complete. Selecting one shows the journal text written so far.

## First quest (M6 target)

"Grug's Cave Problem": a tutorial-sized side quest. It teaches talking to NPCs, combat, picking up drops and eating food, and rewards a little Strength XP and a pelt cape.
