# Open questions

Agents: if your task depends on one of these, **ask the owner** before building. Proposals are only suggestions until the owner answers. When a question is answered, move it to the "Answered" table with the date.

## Combat

| # | Question | Proposal | Blocks |
|---|---|---|---|
| C2 | How is **combat level** worked out? | Based on the best of Strength, Ranged and Voodoo, plus Defence and Hitpoints, scaled to a maximum of 100 | M3 |
| C4 | What does **Voodoo** use up when casting? | Craftable "fetishes" or charm stones, made with Crafting or Herbology | M5 |

## Characters and social

| # | Question | Proposal | Blocks |
|---|---|---|---|
| S2 | **Appearance options at creation?** | Body type, skin tone, hair style and colour, beard. More options later through items. | M1 |

## Platform and operations

| # | Question | Proposal | Blocks |
|---|---|---|---|
| P1 | Production **email** for the shared platform (still Mailpit) | **Deferred by the owner** (2026-11-23). Later: a transactional email provider (for example SES). Until then, staff verify playtesters by hand. | Public playtests |
| P3 | **Off-site backups** | Nightly `pg_dump` copied to S3, keeping 30 days | M7 |
| P4 | **Mobile browsers:** supported, and when? | Desktop browsers first. Make sure the UI doesn't make touch impossible later, and decide after M3. | M3 |

## Answered

| Date | Question | Answer |
|---|---|---|
| 2026-11-23 | Movement model | Free click-to-move. A tile grid was rejected ([ADR 0002](decisions/0002-free-movement-server-paths.md)). |
| 2026-11-23 | Server language | Go, chosen over Rust, TypeScript and headless Godot ([ADR 0003](decisions/0003-go-server.md)) |
| 2026-11-23 | Accounts | Use the shared platform, config only ([ADR 0006](decisions/0006-shared-account-platform.md)) |
| 2026-11-23 | Death penalty | None. Death is safe ([design/death.md](design/death.md)). |
| 2026-11-23 | Trading and marketplace | Both wanted, but not in the first build |
| 2026-11-23 | PvP | Not in the first build. Possibly minigames later. |
| 2026-11-23 | Bank | Yes |
| 2026-11-23 | Level cap and XP curve | Cap of 100. The curve is mine to pick and is tuned later ([design/progression.md](design/progression.md)). |
| 2026-11-23 | Seamless world or loading screens | The owner doesn't mind. Seamless inside regions, short loading at chokepoints ([ADR 0007](decisions/0007-worlds-and-regions.md)). |
| 2026-11-23 | Premium | Premium-only worlds for now with no gameplay benefits. Premium content flags are built in. Buying happens on the website. ([design/worlds-and-premium.md](design/worlds-and-premium.md)) |
| 2026-11-23 | Characters per account | 3 slots |
| 2026-11-23 | Domain | `dinosaur.untitledgames.co.uk`. Accounts stay at `accounts.untitledgames.co.uk`. |
| 2026-11-23 | Wiki | A public wiki and a private one, split decided by me ([ADR 0008](decisions/0008-public-wiki-private-docs.md)) |
| 2026-11-23 | C1: Defence and Hitpoints skills | Add both, for 14 skills in total ([design/skills.md](design/skills.md)) |
| 2026-11-23 | C3: Ability key 2 | A utility move that depends on weapon style ([design/combat.md](design/combat.md)) |
| 2026-11-23 | S1: Character names | 3–12 characters (letters, numbers, single spaces), unique, filtered, changeable once every 30 days ([architecture/backend.md](architecture/backend.md)) |
| 2026-11-23 | E1: Inventory size | 30 slots |
| 2026-11-23 | E2: Drop visibility | Only the killer, for 120 s, then they disappear (until trading exists) |
| 2026-11-23 | E3: Currency | Shells |
| 2026-11-24 | S3: Chat radius | 40 m. A whole-region "shout" may come later. |
| 2026-11-24 | S4: Idle logout | 15 minutes without a click, key press or chat, with a 1-minute warning. Logging out saves you where you stand. Built in M1 with persistence ([architecture/networking.md](architecture/networking.md)). |
| 2026-11-23 | P2: Platform email links | Moved to generic confirmation pages on `accounts.untitledgames.co.uk` ([architecture/accounts.md](architecture/accounts.md)) |
