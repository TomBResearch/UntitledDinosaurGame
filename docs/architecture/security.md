# Security

## Authority

The server decides everything that matters. The client sends **intents**, and the server checks each one against its own state:

| Intent | Server checks |
|---|---|
| `move_to` | The point is inside region bounds and within 150 m. The server finds the path itself. |
| `interact` and `attack` | The target exists and is visible to you. You walk into reach first, and the action only happens once you're in reach and have line of sight (ranged and Voodoo). |
| `ability` | You know the ability and it's off cooldown. Dash distance is the server's own number, clamped by a navmesh raycast. |
| `item_action` and `item_move` | The slot really holds that item, the action is valid for it, and you meet the requirements. |
| `bank_action` | You're near a bank, and the amounts are positive and no more than you hold. |
| `chat_say` | Rate limit (over it is invalid), cleaned of control and invisible characters, at most 120 characters (over it is invalid), not muted, then the word filter. See [world-server.md](world-server.md#local-chat). |

**Rule:** if an intent is invalid, drop it, count it in a metric, and never crash or answer with details. If invalid intents keep coming (more than 50 a minute), disconnect the player and log it.

## Secrets

| Secret | Where |
|---|---|
| `WORLD_TICKET_KEY` | API and worlds (`/opt/udg/.env`) |
| `DINOSAUR_SERVICE_KEY` | API (and worlds, once staff actions need fresh roles in M7), plus the platform's `SERVICE_KEYS` |
| `POSTGRES_PASSWORD` | `/opt/udg/.env` (the API's database user, `udg`) |
| `WORLD_DB_PASSWORD` | `/opt/udg/.env`: the worlds' restricted database role, `udg_world` ([ADR 0017](../decisions/0017-world-saves-to-postgres-directly.md)) |

These live in environment variables only (`tools/set-secrets.sh` makes them on the server; [deploy.md](../operations/deploy.md#m1-secrets)). `.env` files are ignored by git, and gitleaks runs in CI. Logs never contain tokens, tickets, emails or service keys.

## Rate limits

- **API:** per IP and per account ([backend.md](backend.md)).
- **World:** per message type, plus a limit on bytes per second per connection (4 KB/s, burst 16 KB). The numbers and where each is checked are in [networking.md](networking.md#rate-limits).
- **Join tickets:** single use, 30 s ([backend.md](backend.md#join-tickets)).
- **Connections per IP:** at most 10 to a world.

## Staff actions (from M7)

Mute, kick, teleport to a player, and view a player's items. Every action re-checks the actor's **fresh** role through the service API, with strict rank (nobody acts on an equal or higher rank), and every attempt is audited. Hiding a button in the UI is never the protection.

## Required tests

Every security-relevant change comes with negative tests:
- An invalid ticket, an expired ticket, a reused nonce, or a ticket for the wrong world is refused.
- A premium world refuses a non-premium account, and accepts a premium account and staff.
- A banned account can't get a join ticket.
- An account can't have two characters online at the same time (`internal/world/persist_test.go`, `internal/persist/persisttest`, and against Postgres in the slow lane).
- The worlds' database role can't read or change anything a world doesn't need (`TestTheWorldRoleIsRestricted`, slow lane).
- An action on an out-of-range target, a missing item, or a slot the player doesn't own changes nothing.
- The item invariant test: random action sequences never create or destroy items except through sources and sinks.
- Each staff action: every lower rank is refused.
- Chat: a line over the rate limit or over 120 characters is dropped and counted as invalid; a muted player's line reaches nobody; control, bidi and zero-width characters never reach other players (`server/internal/region/chat_test.go`).
- The deletion hook: a wrong or missing service key is refused, it answers `204` for an unknown account, it's idempotent, and characters are gone afterwards.
