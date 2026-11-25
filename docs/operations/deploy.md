# Deploying

First deployed on 2026-11-25. The certificate (Let's Encrypt, renewed by certbot's timer) is for `dinosaur.untitledgames.co.uk` only.

The live game is at **`https://dinosaur.untitledgames.co.uk`**, on the shared project server ([hosting.md](hosting.md), [ADR 0010](../decisions/0010-hosting-shared-server.md)). Everything is built on the Mac and copied over SSH; nothing is compiled on the server. Only `/opt/udg`, the `udg` compose project and one nginx file belong to this game.

## What's live (M0)

| URL | What | Who |
|---|---|---|
| `/` | The landing and login page ([web/](../../web/README.md)): log in, sign up, reset a password, and the signed-in card with Play | Everyone |
| `/play/` | The web client (the game). It refreshes the player's platform session and sends anyone without one back to `/`. | Playtest password ([ADR 0014](../decisions/0014-playtest-gate.md)) and a logged-in account |
| `/w/1` | World 1 (WebSocket), with dev tickets on | Needs the cookie the game page sets |
| `/wiki/` | The public wiki | Everyone |
| `/dev/` | These docs | Staff password ([site.md](site.md)) |
| `/healthz` | The world server's health check (`ok`) | Everyone |

On a deployed page the client connects to its own host's `/w/1` (`wss://` on https), so testers log in at `https://dinosaur.untitledgames.co.uk/`, press Play and give the playtest password. Until characters exist they join under their username (spaces for underscores, cut to 12 characters). `/play/?name=Grug` is still a dev run that skips the account check, which works only while the world has dev tickets on. Postgres and the backend API join the stack in M1.

## The pieces

| Path | What |
|---|---|
| [`infra/production/docker-compose.yml`](../../infra/production/docker-compose.yml) | The `udg` stack: `postgres`, `api`, `world-1` and `caddy` (on `127.0.0.1:8082`) |
| [`infra/production/Caddyfile`](../../infra/production/Caddyfile) | Routes, the playtest gate, `/dev/` auth, security headers. No COOP/COEP ([ADR 0013](../decisions/0013-region-streaming-web-threads.md)). |
| [`infra/server/Dockerfile`](../../infra/server/Dockerfile) | The `udg-server` image: `FROM scratch`, the static `world` and `api` binaries and `data/*.json`, running as a non-root user. |
| [`infra/production/nginx/dinosaur.conf.template`](../../infra/production/nginx/dinosaur.conf.template), [`setup-nginx.sh`](../../infra/production/setup-nginx.sh) | The host nginx file and the script that installs it |
| [`tools/set-passwords.sh`](../../tools/set-passwords.sh) | Writes the password hashes and cookie secret to `/opt/udg/.env` |
| [`tools/set-secrets.sh`](../../tools/set-secrets.sh) | Makes the M1 secrets in `/opt/udg/.env` ([below](#m1-secrets)) |
| [`tools/deploy.sh`](../../tools/deploy.sh) | Builds, copies, starts and checks |
| [`tools/stage-landing.py`](../../tools/stage-landing.py) | Copies `web/` to `build/landing/` with version stamps on every file reference |

## First time

1. **Passwords** (on the Mac; it asks for each one twice and never shows or stores it):

   ```bash
   tools/set-passwords.sh
   ```

   This creates `/opt/udg` if needed (with sudo, owned by your server user) and writes `/opt/udg/.env` (mode `600`) with the domain, the playtest login (user `play`), the cookie secret and the staff login for `/dev/` (user `staff`). Only bcrypt hashes leave the Mac.

2. **Deploy** the stack:

   ```bash
   tools/deploy.sh
   ```

   The first run stops at the outside check, because nginx doesn't know the name yet.

3. **nginx and the certificate**, once (on the server; it needs sudo):

   ```bash
   ssh project-server 'sudo bash /opt/udg/nginx/setup-nginx.sh dinosaur.untitledgames.co.uk'
   ```

   It only writes `/etc/nginx/conf.d/dinosaur.untitledgames.co.uk.conf`, tests with `nginx -t` (rolling back on failure), reloads rather than restarts, gets a certificate with `certbot --webroot` for this one name, and checks every other site answers the same before and after. Cloudflare already has a proxied DNS record for the name; until this step, requests for it fell through to another site on the box.

4. **Check** with `SKIP_BUILD=1 tools/deploy.sh`.

**The account platform must allow this site's origin** before a deploy with login on it. `tools/deploy.sh` checks the platform's CORS answer first and stops if `https://dinosaur.untitledgames.co.uk` isn't allowed ([accounts.md](../architecture/accounts.md#configuration-changes-needed-on-the-platform)).

## M1 secrets

From the `cmd/api` task on, the stack also needs three values in `/opt/udg/.env`, and `tools/deploy.sh` stops before building if any is missing:

| Value | What | Made by |
|---|---|---|
| `POSTGRES_PASSWORD` | The database password (hex, so it's safe in a URL) | `tools/set-secrets.sh`, on the server |
| `WORLD_TICKET_KEY` | Signs join tickets; the API and every world share it | `tools/set-secrets.sh`, on the server |
| `DINOSAUR_SERVICE_KEY` | This game's key for the platform's service API | The platform config step ([accounts.md](../architecture/accounts.md#configuration-changes-needed-on-the-platform)): it goes in `/opt/urg/.env` first, then `tools/set-secrets.sh` copies it across |

```bash
tools/set-secrets.sh
```

It only adds values that are missing, so running it again is safe. The values are made on the server and never pass through the Mac. Don't change `POSTGRES_PASSWORD` once the database exists: Postgres keeps the password it was created with (it would need `ALTER USER` as well).

## Every deploy after that

```bash
tools/deploy.sh
```

1. Checks the M1 secrets are in `/opt/udg/.env`, validates `data/`, exports the web client and precompresses it (Brotli and gzip), builds the wiki and docs site, cross-compiles the world server and the API for `linux/arm64` and builds the image.
2. Copies the image (`docker save | ssh docker load`), the stack files, `build/web/` to `/opt/udg/web/`, `build/site/` to `/opt/udg/site/` and `web/` (the landing page) to `/opt/udg/landing/`, through `tools/stage-landing.py`. That script stamps every file reference with `?v=<hash of web/>`, so a browser never mixes a new page with an old script. Cloudflare must also respect our `Cache-Control` headers ([hosting.md](hosting.md#nginx)).
3. Runs `docker compose up -d`, recreating Caddy if the Caddyfile changed, and removes old `udg-server` images (only those labelled `project=udg`).
4. Checks `/healthz` on the server and from outside, and that everything answers as it should: the landing page 200, the game (`/play/`) 401, the wiki 200, `/dev/` 401, the world without the cookie 403 and `/api/health` 200.

A deploy restarts the world: everyone gets "The world is restarting." and can reconnect. `SKIP_BUILD=1` re-sends config and files without rebuilding.

## Changing a password

```bash
tools/set-passwords.sh play    # or dev
ssh project-server 'cd /opt/udg && docker compose up -d --force-recreate caddy'
```

A new playtest password also makes a new cookie, so everyone signs in again. Share passwords out of band, never in the repo, an issue or chat logs.

## Looking at it

```bash
ssh project-server 'cd /opt/udg && docker compose ps && docker compose logs --tail 50'
```

The world server and the API log JSON to stderr: joins, leaves, refused tickets and warnings, never chat text, tokens or tickets.

To look at the database: `ssh project-server 'cd /opt/udg && docker compose exec postgres psql -U udg udg'`.
