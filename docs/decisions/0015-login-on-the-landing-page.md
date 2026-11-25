# 0015: Log in on the landing page, not inside the game

**Status:** Accepted (2026-11-25, owner)

## Context

The plan was for the Godot client to show the login, sign-up and verification screens itself, calling the platform through `JavaScriptBridge`. The owner then made a login page mock-up, and the remade page now lives at the site root (`web/`, [deploy.md](../operations/deploy.md)), with the game at `/play/`.

## Decision

- **Logging in, signing up, password reset and resending verification happen on the landing page** (`web/`, `js/auth.js`). The page also shows the signed-in account card with the Play button.
- **The game doesn't show login screens.** At `/play/` it gets its own access token by calling the platform's `/auth/refresh`. That uses the same HttpOnly refresh cookie, one refresh at a time, through `JavaScriptBridge` fetch. If there's no session, it sends the player back to `/`.
- The page and the game share the origin `https://dinosaur.untitledgames.co.uk`, so one `ALLOWED_ORIGINS` entry on the platform covers both.

## Consequences

- Password managers, autofill, accessibility and browser translation all work, because the forms are plain HTML.
- Players can log in, sign up or reset a password before downloading the ~7 MB game, and someone who only wants to manage their account never downloads it.
- The client still needs `session.gd`: refresh, keeping the token fresh, and logging out. It no longer needs login screens.
- **Two pages refresh with the same cookie.** The page must not refresh while the game is open in another tab: a refresh rotates the cookie, and two at once count as reuse. So the landing page refreshes only on load (to show the signed-in card), and the game refreshes only when it starts and before its token expires.

## Rejected

- **Login screens in Godot:** heavier for players (the download comes first), no password manager integration, and the forms have to be rebuilt in the engine.
