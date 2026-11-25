#!/usr/bin/env bash
# Builds everything on this Mac and deploys it to the project server over SSH
# (docs/operations/deploy.md). Only /opt/udg and the udg compose project are touched.
#
#   tools/deploy.sh                  # build, copy, start, check
#   SKIP_BUILD=1 tools/deploy.sh     # re-send config and files and restart, without rebuilding
#   HOST=other tools/deploy.sh       # another SSH host (default: project-server)
#
# Needs: Docker, Go, Godot 4.7.2, brotli, and /opt/udg/.env on the server
# (tools/set-passwords.sh). The nginx file and certificate are a one-off step:
# sudo bash /opt/udg/nginx/setup-nginx.sh dinosaur.untitledgames.co.uk
set -euo pipefail
HOST="${HOST:-project-server}"
DOMAIN="dinosaur.untitledgames.co.uk"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GODOT="${GODOT:-/Applications/Godot.app/Contents/MacOS/Godot}"
IMAGE="udg-server:prod"
BUILD="$REPO_ROOT/build"

ssh "$HOST" 'test -f /opt/udg/.env' || {
  echo "No /opt/udg/.env on $HOST: run tools/set-passwords.sh first." >&2
  exit 1
}
# M1 secrets (docs/operations/deploy.md). Only the names are checked; the values never leave the server.
missing="$(ssh "$HOST" 'for k in POSTGRES_PASSWORD WORLD_TICKET_KEY DINOSAUR_SERVICE_KEY; do grep -q "^$k=." /opt/udg/.env || printf "%s " "$k"; done')"
if [[ -n "$missing" ]]; then
  echo "Missing from /opt/udg/.env on $HOST: $missing" >&2
  echo "Run tools/set-secrets.sh (it makes POSTGRES_PASSWORD and WORLD_TICKET_KEY, and tells you where DINOSAUR_SERVICE_KEY comes from)." >&2
  exit 1
fi

# The landing page and the game log in through the account platform, which must allow this
# site's origin first (docs/architecture/accounts.md). Without it every visitor would see
# "couldn't reach the accounts server", so don't deploy until it does.
allowed="$(curl -s -o /dev/null -D - --max-time 15 -X OPTIONS https://accounts.untitledgames.co.uk/auth/refresh \
  -H "Origin: https://$DOMAIN" -H "Access-Control-Request-Method: POST" | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}')"
if [[ "$allowed" != "https://$DOMAIN" ]]; then
  echo "The account platform doesn't allow https://$DOMAIN yet (ALLOWED_ORIGINS in the racing repo's infra/production)." >&2
  echo "Roll that out first: docs/architecture/accounts.md, \"Configuration changes needed on the platform\"." >&2
  exit 1
fi

if [[ "${SKIP_BUILD:-}" != 1 ]]; then
  echo "== Checking content and building the web client"
  (cd "$REPO_ROOT/server" && go run ./cmd/dataval -data ../data -emit-client ../client/data >/dev/null)
  rm -rf "$BUILD/web" && mkdir -p "$BUILD/web"
  "$GODOT" --headless --path "$REPO_ROOT/client" --export-release Web "$BUILD/web/index.html" >/dev/null 2>&1 \
    || { echo "The web export failed: run it by hand to see why (docs/architecture/client.md#web-export)." >&2; exit 1; }
  # Precompressed copies for Caddy (precompressed br gzip).
  for f in "$BUILD"/web/*.{wasm,pck,js,html}; do
    [[ -f "$f" ]] || continue
    gzip -k -9 -f "$f"
    brotli -f -q 11 "$f"
  done

  echo "== Building the wiki and docs site"
  "$REPO_ROOT/tools/build-site.sh" >/dev/null

  echo "== Building the server image (linux/arm64)"
  stage="$BUILD/server-image"
  rm -rf "$stage" && mkdir -p "$stage/data"
  version="$(git -C "$REPO_ROOT" describe --always --dirty)"
  (cd "$REPO_ROOT/server" && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o "$stage/world" ./cmd/world)
  (cd "$REPO_ROOT/server" && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="-s -w -X main.version=$version" -o "$stage/api" ./cmd/api)
  # Only what the server reads: content JSON and region files.
  (cd "$REPO_ROOT/data" && find . -name '*.json' -print0 | cpio -0 -pdm --quiet "$stage/data")
  docker build -q --platform linux/arm64 -f "$REPO_ROOT/infra/server/Dockerfile" -t "$IMAGE" "$stage" >/dev/null

  echo "== Copying the image to $HOST"
  docker save "$IMAGE" | gzip -1 | ssh "$HOST" 'gunzip | docker load' | tail -n 1
fi

echo "== Copying the stack files, web client and site"
CADDY_BEFORE="$(ssh "$HOST" 'md5sum /opt/udg/Caddyfile 2>/dev/null | cut -d" " -f1')"
ssh "$HOST" 'mkdir -p /opt/udg/nginx /opt/udg/web /opt/udg/site /opt/udg/landing'
rsync -q "$REPO_ROOT/infra/production/docker-compose.yml" "$REPO_ROOT/infra/production/Caddyfile" "$HOST:/opt/udg/"
rsync -q "$REPO_ROOT/infra/production/nginx/dinosaur.conf.template" "$REPO_ROOT/infra/production/setup-nginx.sh" "$HOST:/opt/udg/nginx/"
rsync -qa --delete "$BUILD/web/" "$HOST:/opt/udg/web/"
rsync -qa --delete "$BUILD/site/" "$HOST:/opt/udg/site/"
# The landing page: plain static files, stamped with a content version so browsers never mix
# old and new files (Cloudflare tells browsers to cache them for hours).
landing_version="$(python3 "$REPO_ROOT/tools/stage-landing.py" "$REPO_ROOT/web" "$BUILD/landing")"
rsync -qa --delete "$BUILD/landing/" "$HOST:/opt/udg/landing/"
echo "Landing page version $landing_version"
CADDY_AFTER="$(ssh "$HOST" 'md5sum /opt/udg/Caddyfile | cut -d" " -f1')"

echo "== Starting"
ssh "$HOST" 'cd /opt/udg && docker compose up -d --remove-orphans'
# The Caddyfile is a bind-mounted file: rsync replaces it with a new file, which the running
# container never sees. Recreate Caddy when it changed (players reconnect).
if [[ -n "$CADDY_BEFORE" && "$CADDY_BEFORE" != "$CADDY_AFTER" ]]; then
  echo "Caddyfile changed: restarting Caddy"
  ssh "$HOST" 'cd /opt/udg && docker compose up -d --force-recreate caddy'
fi
# Old udg-server images only (the label), never another stack's.
ssh "$HOST" 'docker image prune -f --filter label=project=udg >/dev/null'
ssh "$HOST" 'cd /opt/udg && docker compose ps --format "{{.Service}}: {{.Status}}"'

echo "== Checking"
# On the server first (Caddy and the world), then from outside through nginx and Cloudflare.
local_ok=0
for _ in $(seq 1 20); do
  if ssh "$HOST" 'curl -sf http://127.0.0.1:8082/healthz >/dev/null'; then local_ok=1; break; fi
  sleep 1
done
[[ $local_ok == 1 ]] || { echo "Caddy or the world isn't answering on the server: ssh $HOST 'cd /opt/udg && docker compose logs --tail 50'" >&2; exit 1; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$1"; }
health="$(code "https://$DOMAIN/healthz")"
if [[ "$health" != 200 ]]; then
  echo "The stack is up on the server, but https://$DOMAIN/healthz gave $health." >&2
  echo "If nginx isn't set up yet: ssh $HOST 'sudo bash /opt/udg/nginx/setup-nginx.sh $DOMAIN'" >&2
  exit 1
fi
landing="$(code "https://$DOMAIN/")"
game="$(code "https://$DOMAIN/play/")"
wiki="$(code "https://$DOMAIN/wiki/")"
dev="$(code "https://$DOMAIN/dev/")"
world="$(code "https://$DOMAIN/w/1")"
world2="$(code "https://$DOMAIN/w/2")"
api="$(code "https://$DOMAIN/api/health")"
echo "landing $landing (want 200), game $game (want 401), wiki $wiki (want 200), dev $dev (want 401), worlds without cookie $world and $world2 (want 403), api $api (want 200)"
[[ "$landing" == 200 && "$game" == 401 && "$wiki" == 200 && "$dev" == 401 && "$world" == 403 && "$world2" == 403 && "$api" == 200 ]] || { echo "Something answered unexpectedly." >&2; exit 1; }
# The world list: the API must see both worlds (it caches each world's status for 5 s).
online=0
for _ in $(seq 1 10); do
  online="$(curl -s --max-time 15 "https://$DOMAIN/api/worlds" | grep -o '"online":true' | wc -l | tr -d ' ')"
  [[ "$online" == 2 ]] && break
  sleep 2
done
echo "worlds online in /api/worlds: $online (want 2)"
[[ "$online" == 2 ]] || { echo "The API doesn't see both worlds: ssh $HOST 'cd /opt/udg && docker compose logs --tail 50 api world-1 world-2'" >&2; exit 1; }
echo "Live: https://$DOMAIN"
