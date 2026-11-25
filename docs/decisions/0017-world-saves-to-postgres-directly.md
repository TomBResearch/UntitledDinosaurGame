# 0017: The world saves to Postgres directly, as a restricted role, with lease tokens

**Status:** Proposed (2026-11-25)

## Context

Persistence (M1) makes the world server load and save characters (position, region and HP) and keep each one's **online lease**, the `characters.online_world_id` and `lease_until` columns the backend API already reads to refuse a second login (`already_online`) and renames or deletes while you're online ([backend.md](../architecture/backend.md)).

That needs two choices:
- **How the world reaches the database:** straight to Postgres, or through internal endpoints on the API.
- **How a crashed world's leases are freed**, without ever letting a stalled world overwrite a character that another world has since taken.

The world is the authority for position and HP ([security.md](../architecture/security.md)). It's also the process most exposed to the internet: every player's WebSocket ends there.

## Decision

**The world talks to Postgres directly** (pgx, as the API does: [ADR 0016](0016-backend-api-libraries.md)), through `server/internal/persist` and its Postgres store `pgpersist`.

**It logs in as its own role, `udg_world`, which can only do what a world needs** (migration `0002_persistence.sql`):
- read a character's id, account, deletion time, region, position, HP and lease columns, and the world ids;
- update only region, position, HP, last played time and the lease columns.

It can't see or change names, appearance, skills, slots or deletions, can't read `character_names`, `deleted_accounts` or any later table, and can't create anything. The API stays the database's owner and runs the migrations. The role is made without a password; the API sets one from `WORLD_DB_PASSWORD` each time it starts (`migrations.SetWorldPassword`), so the password lives in `/opt/udg/.env` like the other secrets and can be changed by restarting the API. A slow-lane test (`TestTheWorldRoleIsRestricted`) checks the refusals.

**Leases:**
- The world takes a lease when a player with a join ticket says `hello`, in one transaction that locks every row of the account, so one character per account is online across all worlds even if two tickets were issued at once.
- Each lease carries a **token** (`lease_id`, a random UUID). The world saves, renews and releases only by token, on its own world id.
- The lease lasts 60 s and is renewed every 20 s. A crashed world stops renewing, so its characters can log in again within 60 s.
- A world that starts ends every lease still on its world id: they're left from a crash of that same world, which is the only process with that id.
- If a world stalls for over 60 s and another world takes a character, the stalled world's saves for it change nothing (the token doesn't match). When it next renews or saves, it learns the lease is gone and disconnects that player with `kick(already_online)`.

**Saving never blocks the tick.** A region hands saves to `persist.Saver`, which keeps the newest unsaved state per character in memory and writes them from its own goroutine, all in one transaction per batch, retrying after a failure. Times come from the world's clock, never the database's, as in the API.

## Consequences

- No new service, endpoint or key: the world needs only `DATABASE_URL`. Saving is one round trip, with no HTTP hop through the API, which matters at shutdown (everyone saved within Compose's grace period).
- A compromised world process can move characters and change HP, but nothing else in the database. Through API endpoints it could do the same, since the world is the authority for those numbers anyway, so the endpoints would add a hop without taking any power away.
- The world reads the characters table's layout directly, so a migration that changes those columns must update `pgpersist` in the same change. The API's and the world's store tests both run against Postgres in the slow lane.
- One more secret, `WORLD_DB_PASSWORD` (`tools/set-secrets.sh`). Roles belong to the whole Postgres server, so the migration makes `udg_world` only if it's missing.
- A world without `DATABASE_URL` (local development, dev tickets) saves nothing and refuses real join tickets, since it couldn't keep one character per account online.
- Positions in a crash are lost back to the last periodic save (at most 60 s of walking).

## Rejected

- **Internal API endpoints** (`PUT /internal/characters/:id/save` and so on, with a service key): another network surface and key, a hop on every save, and the API would have to accept whatever position the world sends anyway.
- **The world logging in as the API's database user:** simpler, but the most exposed process would then be able to read and change everything, including names, skills, items later and the deleted-accounts list.
- **Leases checked by world id only, without a token:** a world restarted after a crash would share the id of its old self, and a stalled world couldn't tell its lease had been taken and given back.
- **Expiry only (no release at start):** players would wait up to 60 s after every crash and restart, for nothing.
