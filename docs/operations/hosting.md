# Hosting

Decision: [ADR 0010](../decisions/0010-hosting-shared-server.md).

## The project server

| | |
|---|---|
| Access | `ssh project-server` |
| Machine | AWS EC2 t4g.small, eu-west-1: ARM64 (Graviton), 2 vCPU, about 1.8 GB RAM, 2 GB swap, 30 GB disk |
| OS | Amazon Linux 2023 |
| Front door | Cloudflare, then host nginx on ports 80/443 (certbot certificates), then each stack's Caddy on localhost |
| Neighbours | The racing stack in `/opt/urg` (Caddy on `127.0.0.1:8081`, which also runs the **account platform**), plus unrelated sites (posh-windows.co.uk, game.tomblundell.co.uk). **Never touch their files.** |

## This game's stack (`/opt/udg`, compose project `udg`)

| Service | Image | Network | Notes |
|---|---|---|---|
| `postgres` | `postgres:17-alpine` | `udg_default` | Volume `udg_pgdata` |
| `api` (container `udg-api`) | `udg-server:<ver>` (`/app/api`) | `udg_default` + **`urg_default` (external)** | Reaches `accounts:3100`, and the platform reaches its deletion hook |
| `world-1` | `udg-server:<ver>` (`/app/world`) | `udg_default` | World 1, free |
| `world-2` | `udg-server:<ver>` (`/app/world`) | `udg_default` | World 2, premium only |
| `caddy` | `caddy:2-alpine` | `udg_default` | Listens on `127.0.0.1:8082`. Serves the landing page at `/`, the web client at `/play/`, `/wiki/` and `/dev/` ([site.md](site.md)), and proxies `/api/*` and `/w/<id>`. The client is single-threaded, so **no COOP/COEP (cross-origin isolation) headers** ([ADR 0013](../decisions/0013-region-streaming-web-threads.md)). |

## nginx

A **new** file, `/etc/nginx/conf.d/dinosaur.untitledgames.co.uk.conf`, modelled on the racing game's file:
- Port 80 serves the ACME challenge from `/var/www/letsencrypt`, and everything else redirects to HTTPS.
- Port 443 uses its own certificate (`certbot certonly --webroot -d dinosaur.untitledgames.co.uk`). It takes the real IP from Cloudflare's `CF-Connecting-IP` header, and proxies to `127.0.0.1:8082` with WebSocket upgrade and long read timeouts.
- Cloudflare needs a DNS record for `dinosaur` (proxied) with WebSockets enabled.

## Memory budget (test server)

| | Estimate |
|---|---|
| Already in use (racing stack idle and other sites) | ~530 MB |
| Racing game servers while a race is running | up to 2 × 400 MB |
| UDG: Postgres, Caddy, API | ~100 MB |
| UDG: two worlds with a few playtesters | ~100–200 MB |

This fits for playtesting, as long as both games aren't busy at once. **Move to a t4g.medium (4 GB)** if both run playtests at the same time. At real scale, each world moves to its own machine.

## Deploy

`tools/deploy.sh` builds on the Mac, copies to `/opt/udg` and checks the result. How to use it, the passwords and the one-off nginx step: [deploy.md](deploy.md).

**M0 runs only `world-1` and `caddy`**, with dev tickets behind the playtest gate ([ADR 0014](../decisions/0014-playtest-gate.md)). `postgres`, `api` and `world-2` arrive in M1.

Worlds shut down gracefully on SIGTERM: everyone gets `kick(shutdown)`. From M1, a 60 s warning first and everyone saved.

## Backups

Nightly `pg_dump` of the `udg` database to `/opt/udg/backups`, keeping 7 days. Copying backups off the machine (S3) is an [open question](../open-questions.md).
