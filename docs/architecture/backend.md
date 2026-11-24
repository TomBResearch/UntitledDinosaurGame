# Backend API (`cmd/api`)

A Go HTTP service, at `/api/*` publicly and `/internal/*` inside Docker only. It's stateless: everything is in Postgres, so it can run more than one copy later.

## Auth

- **Player routes:** `Authorization: Bearer <platform access token>`. The token is checked locally against the platform JWKS (EdDSA, `iss` = `https://accounts.untitledgames.co.uk`, `aud` = `tomblundell-games`). The key set is cached for 5 minutes.
- **Fresh state:** `GET http://accounts:3100/service/accounts/:id` with `Authorization: Service <dinosaur key>`, cached for 30 s. It's used for bans, Premium (premium worlds) and staff roles.
- **Deleted accounts:** the API keeps a `deleted_accounts` table and refuses those ids even while an old token is still valid (up to 15 minutes).

## Routes

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /api/health` | – | `{status, version}` |
| `GET /api/worlds` | – | `[{id, name, premiumOnly, population: "low" / "medium" / "high" / "full", online}]` |
| `GET /api/characters` | Player | Your characters, up to 3: `{id, name, slot, combatLevel, totalLevel, lastRegion, lastPlayedAt}` |
| `POST /api/characters` | Player | `{name, slot, appearance}`. Possible errors: `409 name_taken`, `400 invalid_name`, `409 slot_used` |
| `DELETE /api/characters/:id` | Player | `{confirmName}`. Refused while the character is online. Soft-deleted for 7 days, then removed. |
| `POST /api/join` | Player | `{characterId, worldId}` returns `{ticket, wsUrl}`. Possible errors: `403 banned`, `403 premium_required`, `409 already_online`, `503 world_full` / `world_offline` |
| `DELETE /internal/players/:accountId` | Service key (from the platform) | Deletes every character and their data. Answers `204` even if the account was never seen, is idempotent, and records the id in `deleted_accounts`. |

**Character names** (decided on 2026-11-23):
- 3–12 characters: letters, numbers and single spaces, with no space at the start or end.
- Unique across this game, ignoring case.
- Checked with the same word filter as the platform's usernames.
- Can be changed once every 30 days. The old name is held for 30 days.

Rate limits are per IP and per account: 60 per minute by default, and `POST /api/characters` is limited to 10 per hour.

## Join tickets

```
ticket = base64url(payload) + "." + base64url(HMAC-SHA256(WORLD_TICKET_KEY, payload))
payload = {accountId, characterId, worldId, role, premium, nonce, exp}
```

- Valid for 30 s. The world keeps each used nonce until the ticket expires, so a ticket can't be used twice.
- `WORLD_TICKET_KEY` is shared only by the API and the world servers (environment variable).
- The ticket carries the role and Premium status as they were at join time. Staff actions inside the world still re-check the service API ([security.md](security.md)).

## Database (first draft)

| Table | Key columns |
|---|---|
| `worlds` | id, name, premium_only, max_players, ws_path, heartbeat_at, population |
| `characters` | id (uuid), account_id, slot (1–3), name, name_lower (unique), appearance (jsonb), region, x, y, z, hp, created_at, last_played_at, deleted_at, online_world_id, lease_until |
| `character_skills` | character_id, skill, xp (bigint). Levels are derived from XP, and this table can be indexed for hiscores later. |
| `character_items` | character_id, container (inventory / equipment / bank), state (jsonb: slots of item id and quantity). One row per container, saved in one transaction. |
| `character_quests` | character_id, quest_id, stage, flags (jsonb), completed_at |
| `item_audit` | at, character_id, item_id, quantity, reason, details (jsonb) |
| `deleted_accounts` | account_id, deleted_at |

Migrations are committed SQL files in `server/migrations/`, applied when the API starts. The world servers never run migrations.
