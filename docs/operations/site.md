# The wiki and docs site

Decision: [ADR 0012](../decisions/0012-static-site-generator.md). What goes where: [ADR 0008](../decisions/0008-public-wiki-private-docs.md).

| URL | Built from | Who can see it |
|---|---|---|
| `https://dinosaur.untitledgames.co.uk/wiki/` | `wiki/*.md` with `status: published` | Everyone |
| `https://dinosaur.untitledgames.co.uk/dev/` | all of `docs/`, plus `/dev/wiki-preview/` with every wiki page (drafts marked) | Staff, with a password for now; later a platform login for admin and above |

## Building

```bash
tools/build-site.sh
```

This writes `build/site/wiki/` and `build/site/dev/` (git-ignored) in well under a second. `tools/check.sh` runs it too, and so does the `docs.yml` workflow on every docs or wiki change.

To look at it locally, with no password:

```bash
tools/build-site.sh --serve
```

Then open `http://localhost:8070/wiki/` and `http://localhost:8070/dev/`.

The pieces:

| Path | What |
|---|---|
| `server/cmd/sitegen/` | The command. Flags: `-root`, `-out`, `-theme`, `-repo-url`. |
| `server/internal/sitegen/` | Markdown to HTML, link rewriting, GitHub heading slugs and the leak guard, with tests |
| `site/page.html`, `site/site.css` | The theme: one template and one stylesheet. No external fonts or scripts. |

## When the build fails

Every problem is printed as `file:line: what's wrong. What to do.` A failed build writes nothing. The usual causes:

- **A published wiki page links into `docs/`, to a draft, or to another repo file.** Public pages may only link to other published wiki pages and to external `https://` sites. Remove the link. If players need the information, put the player-facing part on a wiki page. Only publish the linked page if its feature is in the game.
- **A broken link or anchor.** Anchors use GitHub's heading slugs: lower case, punctuation dropped, spaces become hyphens, and a repeated heading gets `-1`, `-2` and so on. `python3 tools/check-links.py` lists broken file links.
- **Bad wiki front matter.** Every wiki page starts with:

  ```yaml
  ---
  title: The bank
  status: draft        # or published
  updated: 2026-11-24
  ---
  ```

A **warning** (the build still passes) means a draft links somewhere a published page can't. Fix it before publishing that page.

Publishing is the owner's call. Set `status: published` only when the feature is in the game ([workflow.md](../agents/workflow.md#definition-of-done)).

## Deploying (for the deploy task)

The stack's Caddy ([hosting.md](hosting.md#this-games-stack-optudg-compose-project-udg)) serves the site next to the web client.

1. **Build** with `tools/build-site.sh` on the machine running the deploy.
2. **Copy** `build/site/` to `/opt/udg/site/` on the server, replacing what's there (for example `rsync -a --delete build/site/ project-server:/opt/udg/site/`). It holds only `wiki/` and `dev/`.
3. **Mount** it read-only into the `caddy` service: `/opt/udg/site:/srv/site:ro`.
4. **Set the password.** Generate a bcrypt hash on any machine with Docker. This command prompts for the password, so it stays out of your shell history:

   ```bash
   docker run --rm -it caddy:2-alpine caddy hash-password
   ```

   Put the user name and hash in `/opt/udg/.env` on the server (mode `600`, never committed). Use **single quotes**, so Compose doesn't treat the `$` signs in the hash as variables:

   ```bash
   UDG_DEV_USER='staff'
   UDG_DEV_PASSWORD_HASH='<bcrypt hash from caddy hash-password>'
   ```

   Pass both into the `caddy` service with `env_file: .env` (or `environment:`). Share the password with staff out of band. To change it, update `.env` and recreate the container (`docker compose up -d caddy`).
5. **Add the snippet** below to the stack's Caddyfile, inside the `:8082` site block and before the catch-all `handle` that serves the web client.

### Caddy snippet

```caddyfile
# Wiki and dev docs (ADR 0012, docs/operations/site.md).
# build/site/ is copied to /opt/udg/site and mounted at /srv/site.
redir /wiki /wiki/ 308
redir /dev /dev/ 308

handle /wiki/* {
	root * /srv/site
	file_server
}

handle /dev/* {
	basic_auth {
		{$UDG_DEV_USER} {$UDG_DEV_PASSWORD_HASH}
	}
	header X-Robots-Tag "noindex, nofollow"
	header Cache-Control "private, no-cache"
	root * /srv/site
	file_server
}
```

The snippet was tested locally with `caddy:2-alpine`, a throwaway password and `build/site` mounted at `/srv/site`. `/wiki` redirects to `/wiki/`, and `/wiki/` serves with no password. Draft pages return 404 under `/wiki/`. `/dev/` returns 401 without the password or with a wrong one, and 200 with the right one. The client's catch-all `handle` still serves `/`.

### Later: staff login instead of a password

When the backend API can check a platform session, replace `basic_auth` with `forward_auth` to an API endpoint that allows **admin and above**, using the fresh role from the platform ([accounts.md](../architecture/accounts.md), CLAUDE.md rule 8). The generator doesn't need to change.
