# Deploying

The live game is at **`https://dinosaur.untitledgames.co.uk`**, on the shared project server ([hosting.md](hosting.md), [ADR 0010](../decisions/0010-hosting-shared-server.md)). Everything is built on the Mac and copied over SSH; nothing is compiled on the server. Only `/opt/udg`, the `udg` compose project and one nginx file belong to this game.

## What's live (M0)

| URL | What | Who |
|---|---|---|
| `/` | The web client | Playtest password ([ADR 0014](../decisions/0014-playtest-gate.md)) |
| `/w/1` | World 1 (WebSocket), with dev tickets on | Needs the cookie the game page sets |
| `/wiki/` | The public wiki | Everyone |
| `/dev/` | These docs | Staff password ([site.md](site.md)) |
| `/healthz` | The world server's health check (`ok`) | Everyone |

On a deployed page the client connects to its own host's `/w/1` (`wss://` on https), so testers only need the URL, the password and a name. `?name=Grug` skips the name box. Postgres and the backend API join the stack in M1.

## The pieces

| Path | What |
|---|---|
| [`infra/production/docker-compose.yml`](../../infra/production/docker-compose.yml) | The `udg` stack: `world-1` and `caddy` (on `127.0.0.1:8082`) |
| [`infra/production/Caddyfile`](../../infra/production/Caddyfile) | Routes, the playtest gate, `/dev/` auth, security headers. No COOP/COEP ([ADR 0013](../decisions/0013-region-streaming-web-threads.md)). |
| [`infra/server/Dockerfile`](../../infra/server/Dockerfile) | The `udg-server` image: `FROM scratch`, the static `world` binary and `data/*.json`, running as a non-root user. About 3 MB. |
| [`infra/production/nginx/dinosaur.conf.template`](../../infra/production/nginx/dinosaur.conf.template), [`setup-nginx.sh`](../../infra/production/setup-nginx.sh) | The host nginx file and the script that installs it |
| [`tools/set-passwords.sh`](../../tools/set-passwords.sh) | Writes the password hashes and cookie secret to `/opt/udg/.env` |
| [`tools/deploy.sh`](../../tools/deploy.sh) | Builds, copies, starts and checks |

## First time

1. **Passwords** (on the Mac; it asks for each one twice and never shows or stores it):

   ```bash
   tools/set-passwords.sh
   ```

   This writes `/opt/udg/.env` (mode `600`) with the domain, the playtest login (user `play`), the cookie secret and the staff login for `/dev/` (user `staff`). Only bcrypt hashes leave the Mac.

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

## Every deploy after that

```bash
tools/deploy.sh
```

1. Validates `data/`, exports the web client and precompresses it (Brotli and gzip), builds the wiki and docs site, cross-compiles the world server for `linux/arm64` and builds the image.
2. Copies the image (`docker save | ssh docker load`), the stack files, `build/web/` to `/opt/udg/web/` and `build/site/` to `/opt/udg/site/`.
3. Runs `docker compose up -d`, recreating Caddy if the Caddyfile changed, and removes old `udg-server` images (only those labelled `project=udg`).
4. Checks `/healthz` on the server and from outside, and that the gate answers as it should: the game 401, the wiki 200, `/dev/` 401 and the world without the cookie 403.

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

The world server logs JSON to stderr: joins, leaves and warnings, never chat text.
