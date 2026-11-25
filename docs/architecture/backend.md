# Backend API (`cmd/api`)

A Go HTTP service (`server/cmd/api`, code in `server/internal/api`), served at `/api/*` through Caddy. It's stateless: everything that lasts is in Postgres, so it can run more than one copy later. Libraries and the migration runner: [ADR 0016](../decisions/0016-backend-api-libraries.md).

## Auth

- **Player routes:** `Authorization: Bearer <platform access token>`. The token is checked locally (`internal/platform`) against the platform's published keys: EdDSA (Ed25519) only, `iss` = `https://accounts.untitledgames.co.uk`, `aud` = `tomblundell-games`, `exp` (10 s leeway for clock drift), and `sub` must be a UUID.
  - **Keys** come from `/.well-known/jwks.json` and are cached for 5 minutes. A token with an unknown key id makes the API fetch the keys again (the platform may have rotated them), but at most once every 30 s. If a fetch fails, the keys already held keep working.
  - In production the API reads the keys and the service API inside Docker, at `http://accounts:3100`.
- **Fresh state:** `GET /service/accounts/:id` with `Authorization: Service <DINOSAUR_SERVICE_KEY>`, cached for 30 s. It gives the current role, Premium and ban state. `POST /api/join` and every staff route use it; nothing that needs it goes ahead without it (`503 accounts_unavailable`).
- **Deleted accounts:** the API keeps a `deleted_accounts` table and answers `401` for those ids even while an old token is still valid (up to 15 minutes). The deletion hook (a later M1 task) adds to it.
- **Staff routes** (none yet) need a fresh role of at least their minimum rank. The token's role is never enough, a banned account is refused, and `TestStaffRoutesRefuseLowerRanks` checks every lower rank is refused for every staff route the API has ([CLAUDE.md](../../CLAUDE.md) rule 8).

Errors are JSON: `{"error": "<code>"}`, sometimes with more fields. A missing or bad token is always plain `401 unauthorized`, with no reason given.

## Routes

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /api/health` | – | `{status, version}`. `503` if the database doesn't answer. |
| `GET /api/worlds` | – | `[{id, name, premiumOnly, population, online}]`. `population` is `"low"` / `"medium"` / `"high"` / `"full"`, or `null` while the world is offline. |
| `GET /api/characters` | Player | Your characters, up to 3, by slot (below). |
| `POST /api/characters` | Player | `{name, slot, appearance}` returns `201` and the character. Errors: `400 invalid_slot`, `400 invalid_name` (with `reason`), `400 invalid_appearance`, `409 slot_used`, `409 name_taken`. |
| `PATCH /api/characters/:id` | Player | Rename: `{name}` returns the character. Errors: `400 invalid_name`, `404 not_found`, `409 name_taken`, `409 character_online`, `429 rename_too_soon` (with `retryAt`). |
| `DELETE /api/characters/:id` | Player | `{confirmName}` (the character's name, any case) returns `204`. Errors: `400 confirm_name`, `404 not_found`, `409 character_online`. |
| `POST /api/join` | Player | `{characterId, worldId}` returns `{ticket, wsUrl}`. Errors, checked in this order: `404 not_found` (not your character), `404 unknown_world`, `403 banned`, `403 premium_required`, `409 already_online`, `503 world_offline`, `503 world_full`. |
| `DELETE /internal/players/:accountId` | Service key (from the platform) | **Not built yet** (the deletion hook task). Deletes every character and their data. Answers `204` even if the account was never seen, is idempotent, and records the id in `deleted_accounts`. |

**A character** is `{id, name, slot, appearance, totalLevel, lastRegion, lastPlayedAt, online, nextRenameAt}`:
- `appearance` is `{bodyType, skinTone, hairStyle, hairColour, beard}` (open question S2, answered 2026-11-25). Each value is the id of a choice in [`data/appearance.json`](../../data/appearance.json), and `POST /api/characters` refuses anything else with `400 invalid_appearance` (`content.Appearance.Valid`). The client gets a copy of the file to show the choices and draw them ([design/characters.md](../design/characters.md)).
- `totalLevel` is the sum of your level in every skill in `data/skills.json`, worked out from XP. Every skill starts at level 1, so a new character has 14.
- `combatLevel` isn't there yet: how it's worked out is open question C2 (M3).
- `lastRegion` and `lastPlayedAt` are `null` until persistence (a later M1 task) saves them.
- `online` is true while a world holds the character's online lease. `nextRenameAt` is when you can next rename, or `null` if you can now.

**Character names** (decided on 2026-11-23, code in `internal/names`):
- 3–12 characters: letters and numbers with single spaces between words, and no space at the start or end. **Plain ASCII only** (`A–Z`, `a–z`, `0–9`), so nobody can pass for someone else with look-alike letters from other alphabets.
- Unique across this game, ignoring case. Case is kept for display.
- Checked with the same filter as the platform's usernames, in [`data/name_filter.json`](../../data/name_filter.json) (copied from the platform's lists; keep them in step by hand): blocked words anywhere in the name (after undoing look-alike digits such as `1` → `i`), shorter words only as a whole name or one part between spaces and digits, and reserved staff-like names (`admin…`, `mod`, …). The chat word list (`data/chat_filter.json`) is refused too, as whole words. Like the platform, the filter leans strict (it refuses "Scunthor"); staff can rename. `400 invalid_name` gives a `reason`: `shape`, `not_allowed` or `reserved`.
- Can be changed once every 30 days. The old name is held for 30 days: nobody else can take it, but its owner can take it back. A change of case alone counts as a rename but doesn't release the name.
- A deleted character's name is held until the character is removed for good, 7 days later.

**Rate limits** are per IP and per account, in memory in each API copy: 60 a minute each, and `POST /api/characters` is limited to 10 an hour per account (refused attempts count). Over a limit answers `429 rate_limited` with `Retry-After`. Behind Caddy, the IP comes from `X-Real-IP` (`-trust-proxy`).

**One character online per account:** `POST /api/join` refuses (`409 already_online`) while any of your characters holds an online lease, on any world. Leases are kept by the world servers from the persistence task on; until then nothing sets them.

**World status:** the API asks each world's `GET /status` (inside Docker only: `http://world-<id>:8090/status`, answering `{world, players}`), caches it for 5 s and gives up after 1 s (offline). `population` is low under 25 % of `max_players`, medium under 60 %, high below full, then full. Players see the band, never the count.

## Join tickets

```
ticket  = base64url(payload) + "." + base64url(HMAC-SHA256(WORLD_TICKET_KEY, payload))
payload = JSON {accountId, characterId, worldId, name, appearance, role, premium, nonce, exp}
```

- base64url without padding. `worldId` is the world's id as a string (`"1"`), the same as the world server's `-world`. `name` is the character's display name, and `appearance` its look (the same JSON as in the character), so the world can show it to everyone. `role` is the platform role name. `premium` is true for Premium accounts and staff. `nonce` is 16 random bytes (base64url). `exp` is Unix seconds.
- Valid for 30 s. The world keeps each used nonce until the ticket expires, so a ticket can't be used twice. It also refuses a ticket whose `exp` is more than 60 s away, even with a good signature.
- `WORLD_TICKET_KEY` (at least 32 characters; `openssl rand -base64 36`) is shared only by the API and the world servers, through their environment.
- The ticket carries the role and Premium status as they were at join time. Staff actions inside the world still re-check the service API ([security.md](security.md)). A world started with `-premium-only` refuses tickets without `premium`, as a second check after the API's.
- Code: `server/internal/ticket` (used by both). The world side is in [networking.md](networking.md#join-tickets).

## Database

Postgres 17. The migrations are numbered SQL files in [`server/migrations/`](../../server/migrations/migrations.go), built into the API binary and applied when it starts, each in its own transaction, under an advisory lock so two copies can't race. Applied ones are recorded in `schema_migrations`. **Never edit a merged migration**: add a new file. The world servers never run migrations.

Every time is written by the API from its own clock, never by `now()` in SQL, so tests control time.

| Table | Columns |
|---|---|
| `worlds` | id, name, premium_only, max_players, ws_path. Seeded by the first migration: World 1 (free) and World 2 (premium only), 1,000 players each. |
| `characters` | id (uuid), account_id, slot (1–3; one live character per slot), name, appearance (jsonb), region, created_at, last_played_at, renamed_at, deleted_at (soft delete), online_world_id, lease_until |
| `character_names` | name_lower (the key: unique ignoring case), character_id, held_until (null for a current name) |
| `character_skills` | character_id, skill, xp (bigint). Levels are derived from XP. |
| `deleted_accounts` | account_id, deleted_at |

Later tasks add their own migrations: position and HP (persistence), and items, quests and the item audit (M2 onwards):

| Table (planned) | Key columns |
|---|---|
| `character_items` | character_id, container (inventory / equipment / bank), state (jsonb: slots of item id and quantity). One row per container, saved in one transaction. |
| `character_quests` | character_id, quest_id, stage, flags (jsonb), completed_at |
| `item_audit` | at, character_id, item_id, quantity, reason, details (jsonb) |

Deleted characters are removed for good by the API once an hour, 7 days after they were deleted, with their names, skills and anything else that references them.

## Tests

- **Fast check:** handler tests (`internal/api/api_test.go`) run against `MemStore`, an in-memory store with the same rules, a stand-in platform (`internal/platform/platformtest`) and a fixed clock. They cover auth, deleted accounts, every route's errors, appearance checked against data, premium worlds for every role, bans, staff ranks and rate limits.
- **Joining end to end** (`internal/joine2e`, fast check): the API and two real world servers in one process, over real WebSockets. World 1 is free and World 2 is `-premium-only`. A player without Premium joins World 1 but is refused World 2 by the API (`premium_required`), and World 2 refuses a correctly signed ticket without Premium too. Premium players and staff join World 2, each ticket works once, and Premium bought after logging in counts at the next join.
- **Slow lane:** `tools/slow-tests.sh` starts a throwaway Postgres 17 in Docker and runs the same store contract (`internal/api/storetest`) against the real store (`internal/api/pgstore`), plus the migrations. So the memory store and Postgres can't drift apart. Set `UDG_TEST_DATABASE_URL` to use your own database instead.

## Running it locally

See [CLAUDE.md](../../CLAUDE.md#commands). In short: start the dev Postgres (`infra/dev/docker-compose.yml`, port 5433), fill in `infra/dev/api.env` from the example, then `go run ./cmd/api`. It listens on `127.0.0.1:3010` (production: `0.0.0.0:3000` inside Docker), reads world status from `http://127.0.0.1:8090/status`, and tells clients to connect to `ws://127.0.0.1:8090`. Run the world server with `-world=1` and the same `WORLD_TICKET_KEY`. For both worlds on one machine, put `{id}` in `-public-ws` and `-world-status` (`ws://127.0.0.1:809{id}`) and run each world on its own port; [local-stack.md](../operations/local-stack.md) has the whole set-up with the client. Flags: `-addr`, `-data`, `-platform`, `-jwks`, `-issuer`, `-audience`, `-public-ws`, `-world-status`, `-trust-proxy`.
