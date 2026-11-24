# Worlds and Premium

## Worlds

- After logging in and picking a character, you pick a **world** from a list, RuneScape-style. Each world is a full copy of the map with its own players ([ADR 0007](../decisions/0007-worlds-and-regions.md)).
- The list shows each world's name, whether it's **premium only**, and how busy it is (low, medium, high or full).
- **Your character is the same on every world.** Skills, items and bank go with you. You can only be logged into one world at a time, with one character per account online.
- **Test server:** World 1 (free) and World 2 (premium only).

## Premium

Premium is **global**: it comes from the shared account platform and covers all of the owner's games ([accounts.md](../architecture/accounts.md)).

**What Premium gives you now:** access to premium-only worlds. That's all. There are no gameplay advantages, and the starting world is **entirely free to play**.

**Later:** premium-only expansions (new regions, quests, skills, items).

### Built from day one so expansions are easy

- Every region, item, creature, quest and recipe in `data/` has `"premium": true | false`. It's false for all starting content.
- **Rules applied by the server**, all dormant until something is marked premium:
  - A non-premium player can't enter a premium region (the exit says "This area needs Premium").
  - A non-premium player can't equip or use premium items. They can still hold and bank them, so items aren't lost if Premium lapses.
  - Premium quests can't be started without Premium.
- **If Premium lapses while you're on a premium world**, you're told and moved to a free world at your next login. You aren't kicked mid-session; the check happens at join.
- **If Premium lapses while you're inside a premium region on a free world**, you're moved to the region's free entry point at your next login.
- **Staff count as Premium** (a platform rule).

### Buying Premium

This isn't in the game. It's handled by the untitledgames.co.uk website, which sets Premium on the platform. Until that exists, the owner sets Premium by hand.
