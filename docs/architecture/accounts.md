# Account platform integration

The shared platform lives in `TomBResearch/UntitledAccountSystem`; its `docs/spec.md` and `docs/integration.md` are the authority. This page covers only what this game uses and what has to be configured. Decision: [ADR 0006](../decisions/0006-shared-account-platform.md).

## What we use

| Need | How |
|---|---|
| Log in (landing page), refresh and log out (page and client) | `POST https://accounts.untitledgames.co.uk/auth/login`, `/auth/refresh` and `/auth/logout`, all with `credentials: "include"`. The refresh token is an HttpOnly cookie on the accounts domain that the client never sees. The access token is kept in memory and refreshed about 60 s before it expires, **one refresh at a time** (two at once count as reuse and log you out). The landing page ([web/README.md](../../web/README.md#accounts)) refreshes only on load; the game's `Session` autoload refreshes at start and before expiry ([client.md](client.md#platform-session)). Both take the same Web Lock, so two tabs never refresh at once. |
| Sign up, verify, reset password | The platform's `/auth/*` routes. The landing page (`web/`) shows the forms ([ADR 0015](../decisions/0015-login-on-the-landing-page.md)). |
| Who is this (API) | Verify the JWT with the JWKS. Claims: `sub` (account id), `username`, `role` (effective), `premium`. |
| Fresh role, Premium and ban state | `GET /service/accounts/:id` with `Authorization: Service <dinosaur key>`, cached for at most 30 s |
| Friends (later: "friend online", join friend) | `GET /service/accounts/:id/friends` |
| Player reports with chat context | `POST /service/reports` from the API or world, with `gameId: "dinosaur"` and the last chat lines the server saw |
| Account deletion | Done on the untitledgames.co.uk website, never in the game. The platform calls `DELETE http://udg-api:3001/internal/players/{id}` with `Authorization: Service <dinosaur key>` before it deletes the account; the API's [deletion hook](backend.md#deletion-hook) deletes every character and answers `204`. |

## Roles

These are global, shared with every game: normal 0, premium 1, moderator 2, admin 3, owner 4. Staff count as Premium. **In game:** names are coloured or badged by role in chat, and staff tools check rank on the server using the fresh role.

## Premium in this game

Premium only gets you into premium-only worlds for now ([design/worlds-and-premium.md](../design/worlds-and-premium.md)). Buying it is handled by the untitledgames.co.uk website. The owner sets it by hand with the platform's admin API (`POST /admin/accounts/:id/premium`).

## Configuration changes needed on the platform

Since 2026-11-25 the platform has its own stack (`/opt/accounts`), and these settings are PRs in its repo, [TomBResearch/UntitledAccountSystem](https://github.com/TomBResearch/UntitledAccountSystem): `infra/production/docker-compose.yml` and its `.env` ([its operations guide](https://github.com/TomBResearch/UntitledAccountSystem/blob/main/docs/operations/accounts-stack.md)). `udg-api` reaches the platform over the shared Docker network `untitled_platform`, and the platform reaches our hook the same way. Before that they went through the racing repo, as below. The table is kept as history.

| When | Change |
|---|---|
| M1 (before our login goes live) | `ALLOWED_ORIGINS: https://${GAME_DOMAIN},https://dinosaur.untitledgames.co.uk`. **Live since 2026-11-25** ([racing PR #47](https://github.com/TomBResearch/UntitledRacingGame/pull/47)). `tools/deploy.sh` here refuses to deploy if the platform ever stops allowing it. |
| M1 | `SERVICE_KEYS: racing=${PLATFORM_SERVICE_KEY},dinosaur=${DINOSAUR_SERVICE_KEY}` (same PR, **live since 2026-11-25**; the key was in `/opt/urg/.env`, `/opt/udg/.env` and the racing repo's `infra/production/.env` on the Mac; now it's in `/opt/accounts/.env`, `/opt/udg/.env` and the platform repo's `infra/production/.env`). The racing repo's `tools/deploy.sh` adds the key to its `.env` (48 random letters and digits, like its other keys); the same value goes in `/opt/udg/.env`. The compose file insists on it, because the platform won't start with a key under 32 characters. |
| M1, **ready** once the deletion hook is deployed (`udg-api` answers on port 3001, now over `untitled_platform`; port 3000 is only for Caddy) | `DELETION_HOOKS: racing=…,dinosaur=http://udg-api:3001/internal/players/{id}`. Needs the owner's OK. The racing repo PR has the exact rollout steps: settings only, no `tools/deploy.sh`. |

**After each change:** check both games still log in and delete accounts. The platform's `tools/prod-check.sh run` does this against the live platform, through both games' origins and both hooks. The racing repo's [deploy.md](https://github.com/TomBResearch/UntitledRacingGame/blob/main/docs/operations/deploy.md) lists these entries too.

## Known gaps (affect every game)

- **Email links:** fixed by the owner's decision on 2026-11-23. The platform now serves generic "Untitled Games account" pages at `accounts.untitledgames.co.uk/verify-email` and `/reset-password`, and production `APP_URL` points there. The code is on branch `claude/account-email-pages` in UntitledAccountSystem and the config on `claude/accounts-email-links` in the racing repo. **Live only once both are merged and deployed.** The game client never handles email links.
- **Production email** is still Mailpit (a staff-only inbox), so playtesters can't verify themselves. Real email is deferred by the owner. Until then, staff verify playtesters by hand.
- **Children's Code review** before public launch: the platform takes players aged 13 and up.
