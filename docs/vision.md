# Vision

## The pitch

A cosy-but-dangerous prehistoric sandbox MMORPG in the browser. You wake up as a caveman with nothing but a pelt loincloth, in a world of jungles, caves, tar pits and dinosaurs. There's no single path: chop, dig, fish, craft, cook, brew, hunt and fight your way up, at your own pace, alongside other players.

## Pillars

1. **Freedom to choose.** It's a sandbox: every skill is a valid way to play, and no activity is mandatory.
2. **Visible progress.** Every action earns XP towards a level (up to 100), and each level unlocks something you can see or use.
3. **A shared world.** Other players are always around you, gathering, fighting and chatting. A world feels alive even when you're doing your own thing.
4. **Readable, fair combat.** You click to attack, and your gear decides your speed, damage and defence. Four ability keys add skill: dodge a boss's telegraphed attack by actually moving out of it.
5. **Respect the player's time.** Death is safe (you keep everything), and everything works straight from a browser tab.

## Setting and tone

Stylised, colourful and slightly humorous. Think chunky low-poly cavemen, oversized ferns and expressive dinosaurs, not grim realism. The rendering has to suit WebGL 2 ([ADR 0001](decisions/0001-godot-web-client.md)), which favours this style anyway: low-poly models, vertex colours or small textures, toon-style lighting and baked ambient light.

## Who it's for

Players who like RuneScape-style skilling and progression, want a modern 3D look, and want to play instantly in a browser. A dedicated desktop client (Steam) comes later; the browser is first.

## Scope boundaries for the first build

| In | Not yet |
|---|---|
| Multiple worlds, premium-only worlds | Buying Premium (handled by the untitledgames.co.uk website) |
| The 14 skills in [skills.md](design/skills.md) | Trading between players, marketplace |
| Bank, inventory, equipment | PvP (possible later as minigames) |
| Click combat with abilities 1–4 | Steam or desktop client |
| Quests (side quests first) | Premium-only content (the flags exist; all starting content is free) |
| Local chat | Clans, private chat (friends come from the platform) |
