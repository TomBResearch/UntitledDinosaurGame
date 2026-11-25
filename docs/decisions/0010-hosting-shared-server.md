# 0010: Host on the shared project server as a separate stack

**Status:** Accepted (2026-11-23)

## Context

The owner's project server (an AWS t4g.small: ARM64, 2 vCPU, about 1.8 GB RAM, Amazon Linux 2023) already hosts Untitled Racing Game, the account platform and unrelated sites. This game must not disturb any of them.

## Decision

- This game's stack is its **own Docker Compose project (`udg`) in `/opt/udg`**, with its own Postgres, Caddy, API and world servers.
- **Domain:** `dinosaur.untitledgames.co.uk`. A **new, separate nginx file** (`/etc/nginx/conf.d/dinosaur.untitledgames.co.uk.conf`) terminates TLS (certbot) and proxies to this stack's Caddy on `127.0.0.1:8082`. No other site's nginx file is touched.
- **Only `udg-api` also joins the racing stack's `urg_default` network**, so it can call `accounts:3100` and so the platform can call our deletion hook. Game servers and the database stay on our own network.
  - **Update 2026-11-25:** the platform moved to its own stack (`/opt/accounts`, the platform's decision 0002). `udg-api` now joins the shared network `untitled_platform` instead, which holds only the platform and game backends. So it can no longer reach racing's database or game servers.
- **Images are built on the Mac** (or in CI) for `linux/arm64` and copied to the server, as the racing game does. Nothing is compiled on the server.
- **World servers are fixed services in Compose for now** (`world-1` free, `world-2` premium). Starting and stopping worlds on demand (like the racing game's runner) comes later, when it's needed.

## Consequences

- Memory budget on the test server: Postgres about 60 MB, Caddy about 20 MB, API about 20 MB, and each world about 50–150 MB depending on players. That fits next to the racing game for playtesting. If both games run playtests at the same time, move to a t4g.medium (4 GB).
- At about 1,000 players per world, worlds move to dedicated instances. The architecture doesn't change, only where the containers run.
- Details: [operations/hosting.md](../operations/hosting.md).

## Rejected

- **Adding our services to the racing stack's Compose file:** couples deploys and risks the racing game.
- **Sharing the racing stack's Postgres:** saves about 60 MB, but couples upgrades, backups and failures.
