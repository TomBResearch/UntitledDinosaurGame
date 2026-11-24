# Levels and XP

The owner set the **level cap at 100**. The curve below is a starting point for playtesting, and is expected to change. The settings live in `data/progression.json`, and the public table is in [wiki/levels-and-xp.md](../../wiki/levels-and-xp.md).

## Formula

XP needed to go from level `L` to `L + 1`:

```
xp_to_next(L) = round(base × growth^(L − 1) + linear × L)
base = 50, growth = 1.10, linear = 25
```

The total XP for a level is the sum of every step below it. **XP is stored**, and **levels are worked out from XP**, so the curve can be changed later without losing anyone's progress. (Changing the curve does move people's levels, so announce it if it ever happens after launch.)

## How it feels

| Level | Total XP | Share of level 100 | Step to the next level |
|---|---|---|---|
| 2 | 75 | 0.0% | 105 |
| 10 | 1,805 | 0.03% | 368 |
| 30 | 18,309 | 0.3% | 1,543 |
| 50 | 83,486 | 1.3% | 6,586 |
| 70 | 418,851 | 6.6% | 37,648 |
| 80 | 1,009,592 | 16% | 95,109 |
| 92 | 3,026,312 | 47% | 294,516 |
| 99 | 5,815,243 | 91% | 571,922 |
| 100 | 6,387,165 | 100% | – |

- The early levels are fast: you reach level 10 within minutes of starting a skill.
- **Level 92 is about halfway** to 100 in XP, so the last few levels are a long-term goal.
- The maximum XP per skill is **6,387,165** at level 100. XP keeps counting after 100, up to a cap of 200,000,000, for hiscores later.

## Pacing targets (private)

These are first guesses, measured in playtests and tuned afterwards. They're not shown to players.

| Milestone in one skill | Target hours of focused training |
|---|---|
| Level 30 | ~1 h |
| Level 50 | ~5 h |
| Level 70 | ~20 h |
| Level 90 | ~90 h |
| Level 100 | ~200 h |

To hit these targets, XP rates per action rise with level, through better nodes and recipes. The curve itself stays fixed.

## Other derived numbers

- **Total level:** the sum of all skill levels (14 to 1,400 with the current 14 skills).
- **Combat level:** to be decided ([open question](../open-questions.md#combat)).
