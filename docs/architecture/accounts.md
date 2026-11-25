# Account platform integration

The shared platform lives in `TomBResearch/UntitledAccountSystem`; its `docs/spec.md` and `docs/integration.md` are the authority. This page covers only what this game uses and what has to be configured. Decision: [ADR 0006](../decisions/0006-shared-account-platform.md).

## What we use

| Need | How |
|---|---|
| Log in (landing page), refresh and log out (page and client) | `POST https://accounts.untitledgames.co.uk/auth/login`, `/auth/refresh` and `/auth/logout`, all with `credentials: "include"`. The refresh token is an HttpOnly cookie on the accounts domain that the client never sees. The access token is kept in memory and refreshed about 60 s before it expires, **one refresh at a time** (two at once count as reuse and log you out). |
| Sign up, verify, reset password | The platform's `/auth/*` routes. The landing page (`web/`) shows the forms ([ADR 0015](../decisions/0015-login-on-the-landing-page.md)). |
| Who is this (API) | Verify the JWT with the JWKS. Claims: `sub` (account id), `username`, `role` (effective), `premium`. |
| Fresh role, Premium and ban state | `GET /service/accounts/:id` with `Authorization: Service <dinosaur key>`, cached for at most 30 s |
| Friends (later: "friend online", join friend) | `GET /service/accounts/:id/friends` |
| Player reports with chat context | `POST /service/reports` from the API or world, with `gameId: "dinosaur"` and the last chat lines the server saw |
| Account deletion | The platform calls `DELETE http://udg-api:3000/internal/players/{id}` before it deletes the account |

## Roles

These are global, shared with every game: normal 0, premium 1, moderator 2, admin 3, owner 4. Staff count as Premium. **In game:** names are coloured or badged by role in chat, and staff tools check rank on the server using the fresh role.

## Premium in this game

Premium only gets you into premium-only worlds for now ([design/worlds-and-premium.md](../design/worlds-and-premium.md)). Buying it is handled by the untitledgames.co.uk website. The owner sets it by hand with the platform's admin API (`POST /admin/accounts/:id/premium`).

## Configuration changes needed on the platform

These go through the racing repo's `infra/production/docker-compose.yml` and `.env` (compose project `urg`). They're additive only, and racing keeps working.

| When | Change |
|---|---|
| M1 (before our login goes live) | `ALLOWED_ORIGINS: https://${GAME_DOMAIN},https://dinosaur.untitledgames.co.uk` |
| M1 | `SERVICE_KEYS: racing=${PLATFORM_SERVICE_KEY},dinosaur=${DINOSAUR_SERVICE_KEY}`, with the new key added to `/opt/urg/.env` (`openssl rand -base64 36`) and the same value in `/opt/udg/.env` |
| M1, **only after** `udg-api` answers `204` on `/internal/players/{id}` and is on `urg_default` | `DELETION_HOOKS: racing=…,dinosaur=http://udg-api:3000/internal/players/{id}` |

**After each change:** check racing login, refresh and account deletion still work (the racing repo's `tools/e2e-smoke.sh` and a manual check).

## Known gaps (affect every game)

- **Email links:** fixed by the owner's decision on 2026-11-23. The platform now serves generic "Untitled Games account" pages at `accounts.untitledgames.co.uk/verify-email` and `/reset-password`, and production `APP_URL` points there. The code is on branch `claude/account-email-pages` in UntitledAccountSystem and the config on `claude/accounts-email-links` in the racing repo. **Live only once both are merged and deployed.** The game client never handles email links.
- **Production email** is still Mailpit (a staff-only inbox), so playtesters can't verify themselves. Real email is deferred by the owner. Until then, staff verify playtesters by hand.
- **Children's Code review** before public launch: the platform takes players aged 13 and up.
