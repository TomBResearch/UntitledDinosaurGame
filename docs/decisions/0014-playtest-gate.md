# 0014: A playtest password over the live game until platform login

**Status:** Accepted (2026-11-25, owner)

## Context

M0 ends with the game live at `dinosaur.untitledgames.co.uk`: you and another person open the URL, each get a dev character, and play together. Joining by name needs **dev tickets** (`-dev-tickets`, [networking.md](../architecture/networking.md#dev-tickets)), which let anyone in under any name. Real join tickets only arrive with platform login in M1, and the docs said dev tickets must never be on a public server.

## Decision

- The live world runs with dev tickets **only behind a playtest gate** in the stack's Caddy ([Caddyfile](../../infra/production/Caddyfile)):
  - **The game page** (`/play/`; it was `/` until the landing page took the root on 2026-11-25) needs a shared playtest password (HTTP Basic, bcrypt in `/opt/udg/.env`). Every response from it sets an `HttpOnly`, `Secure`, `SameSite=Strict` cookie, `udg_play`, scoped to `/w/`, whose value is a random 40-character secret.
  - **The world connection** (`/w/1`) is proxied only when that cookie is present; otherwise it gets 403. Browsers don't reliably send a page's Basic auth with a WebSocket, but they always send cookies.
- The **landing page** (`/`), the **public wiki** (`/wiki/`) and the **health check** (`/healthz`) stay open. **`/dev/`** keeps its own staff password ([site.md](../operations/site.md)).
- Changing the playtest password (`tools/set-passwords.sh play`) also makes a new cookie, so everyone signs in again.
- **When M1 login lands, the gate and `-dev-tickets` both go.** Worlds then accept only the backend's join tickets. Turning them off is the owner's call at deploy time; what's ready is below.

## When real join tickets exist: what's ready (2026-11-25)

| Needed before the gate and dev tickets go | State |
|---|---|
| Players log in on the landing page and the game keeps the session ([ADR 0015](0015-login-on-the-landing-page.md)) | Built, merged |
| The API issues join tickets, and the worlds check them (`WORLD_TICKET_KEY`) | Built, merged. The API isn't deployed yet: it needs `tools/set-secrets.sh` first ([deploy.md](../operations/deploy.md#m1-secrets)). |
| The client makes characters, shows the world list and joins with a ticket, not a dev ticket | Built (character creation and world select task). Dev runs (`?name=`, desktop) still use dev tickets. |
| World 2 (premium only) runs, with join tickets only | In the Compose file; starts on the next deploy. It never had dev tickets. |
| Players come back where they left off | The persistence task |

**Still on, on purpose:** the playtest password on `/play/`, the `udg_play` cookie on `/w/1` and `/w/2`, and `-dev-tickets` on World 1. To turn them off once the owner decides: remove `-dev-tickets` from `world-1` in the Compose file, remove the `basic_auth`, `Set-Cookie` and cookie checks from the Caddyfile, and deploy. `/play/?name=` dev runs then stop working on the live site, which is the point.

## Consequences

- Testers need the password, shared by the owner out of band. Anyone who has it can still pick any name, as locally; nothing is saved and there are no roles yet, so a fake name gets nothing.
- The cookie is one shared secret, not per person. That's enough to keep strangers and crawlers out of a playtest. It isn't access control for anything that matters, and nothing that matters exists until M1.
- Password-protected responses are `Cache-Control: private`, so Cloudflare doesn't cache them.

## Rejected

- **Open to anyone:** simplest, but puts an unauthenticated world on the internet, against the security rules, for no gain in M0.
- **No joining until M1:** the site would go live, but M0's "play with a friend" check would wait for M1.
- **Basic auth on the WebSocket too:** whether a browser sends cached Basic credentials with a WebSocket varies by browser and version. The cookie works everywhere.
