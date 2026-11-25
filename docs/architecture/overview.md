# Architecture overview

## Components

```
Browser (Godot web client, GDScript)
   │  HTTPS: login, refresh                 │  HTTPS: worlds, characters, join     │  WSS: gameplay
   ▼                                        ▼                                      ▼
accounts.untitledgames.co.uk         dinosaur.untitledgames.co.uk ── nginx (TLS) ── Caddy (udg)
(shared account platform,                 │  /            → static web client
 racing stack, unchanged)                 │  /api/*       → udg-api (Go)
   ▲                                      │  /w/<world>   → world-<n> (Go, WebSocket)
   │ service API + deletion hook          │  /wiki/       → public wiki (static)
   └──────────── udg-api ─────────────────┘  /dev/        → private docs (static, password)
                    │
                    ▼
               udg-postgres  ◄──── world servers (save characters, online leases)
```

| Component | Language | Responsibility |
|---|---|---|
| Web client | Godot / GDScript | Input, rendering, UI, playing back server paths. No rules. |
| `udg-api` | Go (`cmd/api`) | World list, character slots, join tickets, deletion hook, staff lookups |
| `world-<n>` | Go (`cmd/world`) | Simulation: regions, movement, combat, skills, items, quests, chat. Saves characters. |
| `udg-postgres` | PostgreSQL 17 | Characters, skills, items, bank, quests, worlds, audit |
| Account platform | TypeScript (separate repo) | Accounts, login, roles, Premium, bans, friends, reports |

## How a player gets into a world

1. **Log in** on the landing page at `/` ([ADR 0015](../decisions/0015-login-on-the-landing-page.md)). It posts to `accounts.untitledgames.co.uk/auth/login` with credentials, and the platform sets the HttpOnly refresh cookie. **Play** opens the game at `/play/`, which gets its own 15-minute access token by refreshing (`fetch` with credentials through `JavaScriptBridge`). The token is kept in memory only, and the refresh cookie is never visible to the page or the client.
2. **Pick a world.** `GET /api/worlds` returns every world's name, whether it's premium-only, how busy it is (as a band, not a count) and its status.
3. **Pick or create a character.** `GET /api/characters` lists up to 3 slots. `POST /api/characters` creates one.
4. **Join.** The client calls `POST /api/join {characterId, worldId}` with the access token. The API then:
   1. verifies the token with the platform's JWKS
   2. gets fresh ban and Premium state from the service API (cached for at most 30 s)
   3. refuses a premium world unless Premium is active (staff count as Premium)
   4. refuses if the account already has a character online anywhere
   5. issues a **join ticket**: HMAC-signed with `WORLD_TICKET_KEY`, valid for 30 s, single use, and holding the account, character, world, name, role, Premium and a nonce ([backend.md](backend.md#join-tickets))
5. **Connect.** The client opens `wss://dinosaur.untitledgames.co.uk/w/<world-id>` and sends `hello(ticket, protocol_hash, content_hash)`. The world server:
   1. checks the ticket and that the nonce is unused
   2. takes the character's **online lease** in Postgres
   3. loads the character and puts them in their saved region
   4. replies `welcome`
6. **Play.** Intents go up, events come down ([networking.md](networking.md)).
7. **Leave.** On logout or disconnect, the world saves the character and releases the lease. If the world server crashes, the lease runs out by itself after 60 s.

## Data ownership

| Data | Owner | Stored in |
|---|---|---|
| Account, email, password, username, role, Premium, bans, friends | Account platform | Platform DB (never copied here, except account ids) |
| Characters, skills, inventory, equipment, bank, quest progress, position | World server while the character is online, `udg-api` when offline | `udg-postgres` |
| World list and status | `udg-api`: the list from the `worlds` table, status from each world's `GET /status` | `udg-postgres` (the list) |
| Content definitions | The repo | `data/` ([ADR 0011](../decisions/0011-content-as-json-data.md)) |
| Level layout and navmesh | Godot scenes | Exported to `data/regions/` ([ADR 0004](../decisions/0004-navmesh-baked-in-godot.md)) |

**A character's state is changed by exactly one process at a time:** the world holding its online lease. The API only edits characters that are offline: creating, deleting and renaming them.

## Related decisions

[0001](../decisions/0001-godot-web-client.md) client · [0002](../decisions/0002-free-movement-server-paths.md) movement · [0003](../decisions/0003-go-server.md) Go · [0005](../decisions/0005-websocket-generated-protocol.md) protocol · [0006](../decisions/0006-shared-account-platform.md) accounts · [0007](../decisions/0007-worlds-and-regions.md) worlds and regions · [0010](../decisions/0010-hosting-shared-server.md) hosting
