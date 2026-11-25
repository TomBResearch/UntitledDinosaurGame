# Characters

What a player's characters are, and how they're made. The API rules are in [backend.md](../architecture/backend.md#routes); the screens are in [client.md](../architecture/client.md#characters-worlds-and-joining).

## Slots

- Up to **3 characters** per account, one per slot. A character is the same on every world.
- Only one character per account can be in a world at a time.

## Names

Decided on 2026-11-23 ([backend.md](../architecture/backend.md#routes) has the full rules):
- 3–12 characters: plain letters `A–Z` and numbers `0–9`, with single spaces between words.
- Unique in the game, ignoring case. Checked against the same word filter as platform usernames, plus the chat filter, and staff-like names are reserved.
- A character can be renamed once every 30 days. The old name is held for the character for 30 days.
- Deleting a character needs its name typed to confirm. Its name is held for 7 days, until the character is removed for good.

## Appearance

Open question S2, answered by the owner on 2026-11-25: **body type, skin tone, hair style, hair colour and beard**. More looks come later through items.

The choices are content, in [`data/appearance.json`](../../data/appearance.json). The API refuses an id that isn't in the file, and the client reads the same file to show the choices and draw them. The first set:

| Part | Choices |
|---|---|
| Body type | Sturdy, Lean, Broad (each scales the placeholder body's width and height) |
| Skin tone | Tone 1 to Tone 6, light to dark |
| Hair style | Shaggy, Short, Long, Topknot, Bald |
| Hair colour | Black, Dark brown, Brown, Auburn, Blond, Grey |
| Beard | None, Stubble, Short, Long |

- `default` in the file is how a character with no valid choice is drawn (and dev players, and for now everyone else you see in the world).
- **Adding a choice:** add it to the file. A colour needs only its `colour`. A new hair style or beard also needs a piece in the placeholder model (`client/entities/player/caveman.tscn`): a child of `Hair` or `Beard` named after the id. The client's tests check every listed style and beard has one.
- **Removing a choice** doesn't break old characters: they keep the id, and are drawn with the default for that part. But players lose that look, so it's the owner's call.
- The placeholder caveman is a capsule with box pieces until the art pass (M7). Its look is drawn from the same ids, so real models can replace the pieces without changing data.

## Starting gear

Every character starts in a **pelt loincloth**, drawn on the model. Items don't exist until M2, so for now it's part of the look, not an item. The placeholder's club is gone: the first weapon is the bone club in M3.

## Not yet

- **Other players' looks in the world:** the client draws your own character with your look and everyone else with the default. Showing everyone's needs the join ticket to carry the look, the world to keep it, and `entity_enter` to send it. That touches the region code, which the persistence task is changing, so it's a follow-up.
- Combat level on the character list (open question C2, M3).
