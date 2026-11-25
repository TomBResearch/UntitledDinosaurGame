# The whole M1 flow on one machine

How to try logging in, making characters, the world list and joining both worlds locally, with the real web client. Everything runs on `127.0.0.1`. Nothing here touches the live server.

| Piece | Where | Notes |
|---|---|---|
| Account platform | `http://localhost:3110` | A local copy from `~/Dev/UntitledAccountSystem`, with its own throwaway database |
| Backend API | `http://127.0.0.1:3010` | Its own Postgres, which the worlds save characters to (as `udg_world`) |
| World 1 (free) | `ws://127.0.0.1:8091/w/1` | Join tickets, plus dev tickets |
| World 2 (premium only) | `ws://127.0.0.1:8092/w/2` | Join tickets only, `-premium-only` |
| Pages | `http://localhost:8060/` | `tools/serve-local.py`: the landing page at `/`, the game at `/play/`, and `/api/` passed to the API, as Caddy does in production |

The game calls `/api` on its own origin, so the API needs no CORS, just as live. The worlds are reached directly at the `wsUrl` the API gives (`-public-ws 'ws://127.0.0.1:809{id}'`).

## Once

1. **Secrets for this machine only.** Any 32+ characters each; keep them in your shell, not in the repo:

   ```bash
   export WORLD_TICKET_KEY=$(openssl rand -hex 24) DINOSAUR_SERVICE_KEY=$(openssl rand -hex 24) WORLD_DB_PASSWORD=$(openssl rand -hex 24)
   ```

2. **A database for the API.** `infra/dev/docker-compose.yml` uses port 5433. If that port is taken (the platform's own local Postgres often uses it), run a throwaway one on another port instead:

   ```bash
   docker run -d --name udg-local-pg -e POSTGRES_USER=udg -e POSTGRES_PASSWORD=udg -e POSTGRES_DB=udg -p 127.0.0.1:5434:5432 postgres:17-alpine
   ```

3. **A database for the platform**, in its own local Postgres ([web/README.md](../../web/README.md#testing-against-a-local-platform)):

   ```bash
   docker exec accounts-postgres-1 psql -U accounts -c "CREATE DATABASE udg_local_test"
   ```

## Start

Each in its own terminal. The platform:

```bash
cd ~/Dev/UntitledAccountSystem && PORT=3110 HOST=127.0.0.1 DATABASE_URL=postgres://accounts:accounts@localhost:5433/udg_local_test ALLOWED_ORIGINS=http://localhost:8060 APP_URL=http://localhost:3110 ISSUER=http://localhost:3110 COOKIE_SECURE=false SMTP_PORT=1026 SERVICE_KEYS="dinosaur=$DINOSAUR_SERVICE_KEY" npx tsx src/server.ts
```

The API first (from `server/`; use port 5433 if you used the dev Compose file). It applies the migrations and sets the worlds' database password (`WORLD_DB_PASSWORD`):

```bash
DATABASE_URL='postgres://udg:udg@127.0.0.1:5434/udg?sslmode=disable' go run ./cmd/api -platform http://localhost:3110 -jwks http://localhost:3110/.well-known/jwks.json -issuer http://localhost:3110 -public-ws 'ws://127.0.0.1:809{id}' -world-status 'http://127.0.0.1:809{id}/status' -trust-proxy
```

Then the two worlds (from `server/`). A world that takes join tickets saves its players, so it needs the database too ([ADR 0017](../decisions/0017-world-saves-to-postgres-directly.md)):

```bash
DATABASE_URL="postgres://udg_world:$WORLD_DB_PASSWORD@127.0.0.1:5434/udg?sslmode=disable" go run ./cmd/world -addr 127.0.0.1:8091 -world 1 -dev-tickets
```

```bash
DATABASE_URL="postgres://udg_world:$WORLD_DB_PASSWORD@127.0.0.1:5434/udg?sslmode=disable" go run ./cmd/world -addr 127.0.0.1:8092 -world 2 -premium-only
```

The web client and the pages (from the repo root):

```bash
mkdir -p build/web && /Applications/Godot.app/Contents/MacOS/Godot --headless --path client --export-release Web ../build/web/index.html
```

```bash
python3 tools/serve-local.py
```

## Try it

1. Open `http://localhost:8060/?accounts=http://localhost:3110` and create an account. Production email isn't wired up locally, so mark it verified in the platform's database:

   ```bash
   docker exec accounts-postgres-1 psql -U accounts -d udg_local_test -c "UPDATE accounts SET email_verified_at = now()"
   ```

2. Log in and press Play. The game shows your characters; make one, press Play, and join World 1.
3. **Premium refused:** World 2 is marked Premium, says why, and its Join is off. The API refuses it too (`403 premium_required`).
4. **Premium allowed:** give the account Premium, log out and in, and join World 2:

   ```bash
   docker exec accounts-postgres-1 psql -U accounts -d udg_local_test -c "UPDATE accounts SET premium_until = now() + interval '30 days' WHERE username = '<username>'"
   ```

5. **Reconnect:** stop World 1 (Ctrl-C) while you're in it. The game says the world is restarting; start it again and press Reconnect, which fetches a new ticket. You start where you were saved.

A dev run still works alongside: `/Applications/Godot.app/Contents/MacOS/Godot --path client -- --name=Grug --server=ws://127.0.0.1:8091/w/1`.

## Clean up

```bash
docker rm -f udg-local-pg && docker exec accounts-postgres-1 psql -U accounts -c "DROP DATABASE udg_local_test"
```
