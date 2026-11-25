# The landing and login page (`web/`)

The page players see first: the title, an animated prehistoric valley, and the "Base Camp" card for logging in, creating an account, resetting a password and, once signed in, playing and managing the account. It replaces the single-file mock-up the owner made at game.tomblundell.co.uk, keeping its look (jungle greens, bark browns, bone and amber, the cartoon title and the central card) with much more detailed art.

Plain static files: no build step, no framework, no npm. Live at **`https://dinosaur.untitledgames.co.uk/`**, where `tools/deploy.sh` copies the folder as it is; the game is at `/play/` ([deploy.md](../docs/operations/deploy.md)).

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
| `js/auth.js` | The account platform's API (log in, sign up, reset, refresh, profile, log out) and player-facing error text. **Off until M1** (`ENABLED = false`). |
| `img/` | The wood grain texture, the show/hide password icons and the favicon |

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

## Accounts (M1)

The forms follow the platform's rules ([accounts.md](../docs/architecture/accounts.md), and the platform's `docs/spec.md`). They check these before sending, and the platform checks them again:
- You log in with **email** and password.
- Signing up takes a username (3–16 letters, numbers or underscores), an email, a password (10–200 characters, not containing the username or email), and a date of birth. You must be 13 or older, and the platform keeps only the year.

To turn accounts on:
1. Add this site's origin to the platform's `ALLOWED_ORIGINS`.
2. Set `ENABLED = true` in `js/auth.js`.

The access token is kept only in memory. The refresh token is the platform's HttpOnly cookie. The game page gets its own token by refreshing.

## Not done yet

- **Fonts:** Luckiest Guy and Baloo 2 still come from Google Fonts, as in the mock-up. Self-hosting them (both are under the OFL) would stop sending visitors' IP addresses to Google.
- **The "Playtest" link** in the footer goes to the game at `/play/`, behind the playtest password. Remove it when accounts open and the Play button takes over.
