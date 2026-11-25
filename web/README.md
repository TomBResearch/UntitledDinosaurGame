# The landing and login page (`web/`)

The page players see first: the title, an animated prehistoric valley, and the "Base Camp" card for logging in, creating an account, resetting a password and, once signed in, playing and managing the account. It replaces the single-file mock-up the owner made at game.tomblundell.co.uk, keeping its look (jungle greens, bark browns, bone and amber, the cartoon title and the central card) with much more detailed art.

Plain static files: no build step, no framework, no npm. Live at **`https://dinosaur.untitledgames.co.uk/`**. `tools/deploy.sh` copies the folder there, adding `?v=<hash>` to every file reference (`tools/stage-landing.py`), so a deploy is never mixed with old cached files; the game is at `/play/` ([deploy.md](../docs/operations/deploy.md)).

```bash
python3 -m http.server 8075 -d web
```

Then open `http://localhost:8075/`. Add `?demo=account` to see the signed-in card with sample data, and `#join`, `#forgot` or `#sent` to open the other panels.

## Files

| Path | What |
|---|---|
| `index.html` | The page and all five card panels. Works as a plain page if JS fails; the valley is then just a sky gradient. |
| `css/main.css` | Layout, the wooden card, inputs and buttons, responsive rules, reduced motion |
| `js/main.js` | Draws everything, switches panels (by URL hash), checks forms, parallax, the raptor's eye following the pointer |
| `js/scene.js` | The valley: one 1920 × 1080 SVG, anchored to the bottom and cropped at the sides on narrow screens, in parallax layers |
| `js/critters.js` | Hand-drawn creatures and props: brachiosaurus, stegosaurus, triceratops, the peeking raptor, pteranodon, dragonfly, egg nest, fossils, bones |
| `js/svg.js` | Drawing helpers: a seeded random generator, smooth curves, and generators for ferns, grass, conifers, cycads, tree ferns, rocks and clouds |
| `js/auth.js` | The account platform's API (log in, sign up, reset, resend, refresh, profile, log out) and player-facing text for every error ([Accounts](#accounts)) |
| `img/` | The wood grain texture, the show/hide password icons and the favicon |
| `fonts/` | Luckiest Guy (Apache 2.0) and Baloo 2 (OFL 1.1), Latin subsets, self-hosted so no visitor data goes to Google. Licences alongside. |

## How the art works

- **Style:** dark ink outlines, a flat base colour, a shadow shape on the far side and a few highlights, as in a cartoon.
- **Generated detail:** grass, fern leaflets, conifer needles and rocks come from generators with a fixed seed (`rng(66)`). The valley is the same on every visit, and tweaking a generator changes every plant at once. Each frond's leaflets share one path, so the scene stays at about 2,800 elements and builds in about 40 ms.
- **Animation:** SVG animation (SMIL), so each part moves about its own origin. Animated parts include:
  - clouds and the herd drift by;
  - the volcano smokes, its lava flows, and it throws the odd fireball;
  - the waterfall pours;
  - ferns and trees sway;
  - the brachiosaurus chews, and the stegosaurus grazes;
  - eyes blink, and an egg wobbles;
  - a pteranodon and a dragonfly fly.

  Parallax moves the layers a little with the pointer.
- **Reduced motion:** with `prefers-reduced-motion`, every SVG animation is paused, CSS animation is off, and there's no parallax.

## Accounts

Logging in happens here, not inside the game ([ADR 0015](../docs/decisions/0015-login-on-the-landing-page.md)). `js/auth.js` talks to the shared account platform at `accounts.untitledgames.co.uk`, which allows this site's origin ([accounts.md](../docs/architecture/accounts.md)).

| Panel | What it does |
|---|---|
| Log in (`#login`) | Email and password. An unconfirmed email gets "Send the confirmation link again" (the platform only says so after a correct password). |
| Create account (`#join`) | Username, email, password and date of birth, then the "check your inbox" panel |
| Forgotten password (`#forgot`) | Asks for a reset link, then the "check your inbox" panel |
| Check your inbox (`#sent`) | "Send it again" repeats whichever was sent: the confirmation link or the reset link |
| Signed in (`#account`) | The account card: Play (to `/play/`), email, member since, badges, Change password, Log out |

The forms follow the platform's rules (its `docs/spec.md`). They check these before sending, and the platform checks them again:
- You log in with **email** and password.
- Signing up takes a username (3–16 letters, numbers or underscores), an email, a password (10–200 characters, not containing the username or email), and a date of birth. You must be 13 or older, and the platform keeps only the year.

Every platform error code has friendly text in `auth.explain()`, and sign-up errors point at their field. The platform answers the same whether or not an email has an account, and so does the page.

**Sessions:**
- The access token is kept only in memory. The refresh token is the platform's HttpOnly cookie, which the page never sees.
- The page refreshes **once, on load**, to show the signed-in card, and never again. The game at `/play/` refreshes its own session with the same cookie.
- Refresh and log out run under a Web Lock (`udg-platform-session`) that the game takes too, so a landing page and a game open in two tabs never refresh at once. Two refreshes at once with the same cookie count as reuse, and the platform would log the player out everywhere.
- Logging out here ends the session for the game too: its next refresh finds no session and sends it back here.

**Email:** production email is still the staff-only Mailpit inbox, so a new player's confirmation link doesn't reach them. Staff send it on by hand ([accounts.md](../docs/architecture/accounts.md#known-gaps-affect-every-game)).

### Testing against a local platform

A page served from `localhost` can use a local copy of the platform with `?accounts=http://localhost:<port>` (a deployed page ignores it). Run the platform from `~/Dev/UntitledAccountSystem` with its own database and this page's origin allowed:

```bash
docker exec accounts-postgres-1 psql -U accounts -c "CREATE DATABASE udg_login_test"
```

```bash
cd ~/Dev/UntitledAccountSystem && PORT=3110 DATABASE_URL=postgres://accounts:accounts@localhost:5433/udg_login_test ALLOWED_ORIGINS=http://localhost:8075 APP_URL=http://localhost:3110 COOKIE_SECURE=false SMTP_PORT=1026 npx tsx src/server.ts
```

Then open `http://localhost:8075/?accounts=http://localhost:3110`. Emails land in the platform's dev Mailpit at `http://localhost:8026`. To try Play too, serve the page with the web export at `play/` (for example a folder with `web/`'s files and `build/web/` copied to `play/`). The Play button passes `?accounts=` on to the game.
