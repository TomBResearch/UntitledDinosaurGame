# Items, inventory, equipment and bank

## Inventory

- **30 slots (a 5 × 6 grid).** Decided on 2026-11-23.
- **Currency:** **shells** (`shells`), stackable. They come from drops and from selling to NPC shops.
- Stackable items (coins, ammo, some resources) take one slot. Everything else takes one slot each.
- Right-click options come from the item's data: use, eat, equip, drop, examine, and "use on" another item or a station.

## Equipment slots

Head, Neck, Back (pelts and cloaks), Body, Legs, Hands, Feet, Ring, Main hand, Off hand, Ammo.

A two-handed weapon takes both hands. Each slot's bonuses add up ([combat.md](combat.md)), and equipping an item can require skill levels.

## Bank

- Found at camps in safe areas (a "Stash Cave").
- **400 slots to start**, and everything stacks in the bank. Tabs and search come later.
- Deposit, withdraw (1, 5, 10, X or all), and deposit all of your inventory or equipment.
- A deposit or withdrawal saves the character straight away ([world-server.md](../architecture/world-server.md#saving-characters)).

## Drops and ground items

- When a creature dies, its drop table is rolled ([content-pipeline.md](../architecture/content-pipeline.md#content-data-data)). Every item lands on the ground where it died.
- **First build:** drops are visible only to the player who did the most damage, for 120 s, and then they disappear. Items you drop yourself are also visible only to you. This prevents loot stealing, and stops dropped items becoming a way to trade before trading exists. Decided on 2026-11-23; revisit when trading arrives.
- **Rare drops** (1/100 or rarer) get an announcement in your chat and an audit row.

## Trading and the marketplace

These aren't in the first build, but they're planned. To keep them easy to add later:
- Every item has a `tradeable` flag.
- Items only move between containers through the item module, which can be made transactional.
