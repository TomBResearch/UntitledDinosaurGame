# Skills

Every skill goes from level 1 to **100** ([progression.md](progression.md)). The names are working names: the owner may rename them, and ids in `data/skills.json` stay stable even if display names change.

## The skill list

| Group | Skill (id) | How you train it | What it's for |
|---|---|---|---|
| Combat | **Strength** (`strength`) | Melee attacks | Melee accuracy and damage. Unlocks melee weapons. |
| Combat | **Ranged** (`ranged`) | Slingshots, throwing spears, bolas | Ranged accuracy and damage. Unlocks ranged weapons. |
| Combat | **Voodoo** (`voodoo`) | Casting with staffs and totems | Magic accuracy and damage, plus utility spells. Unlocks staffs. |
| Combat | **Defence** (`defence`) | Any combat, with a defensive stance (or a share of all combat XP; tuned in M3) | Reduces enemy hit chance. Unlocks armour. |
| Combat | **Hitpoints** (`hitpoints`) | A share of all combat XP | Raises your maximum HP |
| Gathering | **Digging** (`digging`) | Dig sites | Fossils, teeth, bones, relics |
| Gathering | **Lumberjacking** (`lumberjacking`) | Trees | Logs (crafting, weapons, fires) |
| Gathering | **Excavating** (`excavating`) | Rocks and ore | Flint, stone, obsidian and other minerals |
| Gathering | **Angling** (`angling`) | Fishing spots | Raw fish (cooking) |
| Processing | **Crafting** (`crafting`) | Making things at workbenches | Clothing, armour, jewellery, tools |
| Processing | **Weapon-Crafting** (`weaponcrafting`) | Making things at workbenches | Clubs, spears, slingshots, voodoo staffs, ammo |
| Processing | **Herbology** (`herbology`) | Gathering herbs and brewing | Potions: boosts, cures, utility |
| Processing | **Cooking** (`cooking`) | Fires and cooking spots | Food, which is how you heal |
| Other | **Hunting** (`hunting`) | Tasks from Hunt Masters ([below](#hunting)) | Some creatures can only be hunted at a high enough Hunting level, and special rewards |

That's **14 skills** in total. Defence and Hitpoints were added by the owner on 2026-11-23. How combat level is worked out is still open ([open-questions.md](../open-questions.md#combat)).

## Shared rules for gathering and processing

- **Gathering:** click a node and your character repeats the action until your inventory is full or the node runs out. Each attempt takes `attempt_ticks`, and succeeds with a chance that rises with your level above the node's requirement. Nodes run out and respawn: a tree might last several logs, and a rock might give one ore.
- **Processing:** use an item on a station (a workbench, fire or brewing pot), or with another item. A "make X" dialogue then repeats the action. Each action takes `action_ticks`. Low-level cooking can burn food, and the chance falls as your level rises.
- **Tools:** gathering needs a tool (axe, pick, shovel, rod). A better tool tier is faster, and each tier needs a level.
- **XP** is given per successful action, by the amount set in `data/`.
- **Everything lives in data files:** the level needed, the XP, the timing and the items in and out (`data/nodes/`, `data/recipes/`).

## Material tiers (working ideas)

These are flavour ideas for the first regions. They're not final, and they're tuned in `data/`.

| Tier | Level | Material | Example uses |
|---|---|---|---|
| 1 | 1 | Bone, wood, flint | Bone club, flint axe, pelt wrap |
| 2 | 15 | Hardwood, hide | Spear, leather armour |
| 3 | 30 | Obsidian | Obsidian blades, polished tools |
| 4 | 45 | Jade | Jade jewellery, totems |
| 5 | 60 | Amber | Amber-set staffs, charms |
| 6 | 75 | Dinosaur ivory and big-game parts | Tooth spears, plated armour |
| 7 | 90 | Meteorite ("sky stone") | Endgame gear |

## Hunting

- A **Hunt Master** NPC gives you a task: "Hunt 25 small raptors". Which creatures you can be given depends on your Hunting level and combat levels.
- Killing a creature on your task gives Hunting XP (based on the creature's HP), on top of your normal combat XP.
- Finishing tasks earns **Hunt points**, spent on unlocks and rewards later.
- Some creatures need a Hunting level to damage at all (for example tar-pit beasts need Hunting 40). Those creatures can drop exclusive items.
- Details are designed in M6.
