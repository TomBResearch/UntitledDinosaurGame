# Combat

This is a first draft. The numbers come later, in `data/`, and are tuned in playtests. The exact formulas are private ([ADR 0008](../decisions/0008-public-wiki-private-docs.md)).

## Basics

- **Click a creature to attack.** You walk into range: melee 1.5 m, ranged and Voodoo set by the weapon, usually 8–12 m with line of sight. Then you auto-attack until the target dies, you click elsewhere, or you're out of range.
- **Your weapon sets your attack speed** (for example a bone club hits every 2.4 s and a flint dagger every 1.8 s), along with your style (crush, stab, slash, ranged or voodoo) and your range.
- **Each hit is rolled:** a hit chance from your accuracy against the target's defence for that style, then damage from 0 up to a max hit set by your skill level and strength bonus.
- **Combat bonuses** come from every equipped item:

| Bonus | Styles |
|---|---|
| Accuracy | melee, ranged, voodoo |
| Strength (damage) | melee, ranged, voodoo |
| Defence | melee, ranged, voodoo |
| Other | ability modifiers (for example "Dash distance +100%") |

- **Combat XP** goes to the skill matching your style (Strength, Ranged or Voodoo). **Hitpoints** always gets a share. **Defence** gets a share when you fight in a defensive stance (the exact split is tuned in M3). **Hunting** gets XP if you're on a task.
- **Your maximum HP** comes from your Hitpoints level, and your chance to avoid being hit comes from Defence plus your armour bonuses.
- **Healing** comes from eating cooked food. Eating has a short delay, which also delays your next attack.

## Abilities (keys 1–4)

Each slot has a basic version everyone has from the start. Gear can change what it does.

| Key | Base ability | Cooldown (first guess) | Example gear modifier |
|---|---|---|---|
| 1 | **Dash / Dodge:** move up to 4 m in a direction, can't be hit for 0.3 s | 8 s | "Raptor-hide sandals": double the dash distance |
| 2 | **Utility:** changes with your weapon style. Melee: a gap-closer leap at a target within 6 m. Ranged: a knockback shot that pushes the target back 3 m. Voodoo: a root that holds the target in place for 2 s. | 12 s | Gear can change it, for example "Vine bracers" making the root last 3 s |
| 3 | **Defensive:** take 50% less damage for 2 s | 20 s | A shield that adds reflect damage |
| 4 | **Weapon special:** set by the main-hand weapon (for example a club stuns for 1.2 s) | Per weapon | Different weapons have different specials |

- All ability timing is checked and applied by the server ([ADR 0002](../decisions/0002-free-movement-server-paths.md)).
- Using an ability doesn't reset your auto-attack timer, except where a weapon special says it does.

## Creatures and boss mechanics

- **Creature AI:** creatures wander near their spawn, become aggressive within a radius (some), chase up to a leash distance, then return to their spawn and heal fully.
- **Boss attacks are shown as ground shapes before they land** (circle, cone, line or ring). Each shape lasts at least 600 ms, and longer for heavier attacks. On the tick an attack lands, the server checks every player's position against the shape.
- These are positional, with no grid. Dash/Dodge exists to get out of them.

## Death

See [death.md](death.md). Death is safe.
