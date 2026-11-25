#!/usr/bin/env bash
# Sets the live site's passwords in /opt/udg/.env on the server (docs/operations/deploy.md).
#
#   tools/set-passwords.sh            # both: the playtest password and the staff /dev/ password
#   tools/set-passwords.sh play       # just the playtest password (the game)
#   tools/set-passwords.sh dev        # just the staff password (/dev/)
#   HOST=other tools/set-passwords.sh # another SSH host (default: project-server)
#
# Asks for each password twice without showing it, hashes it with bcrypt using Caddy's own
# tool (in Docker, locally), and sends only the hash to the server. The password itself is
# never written anywhere. Changing the playtest password also makes a new playtest cookie,
# so everyone has to sign in again. Then run tools/deploy.sh (or, if the stack is already up,
# `ssh project-server 'cd /opt/udg && docker compose up -d --force-recreate caddy'`).
set -euo pipefail
WHICH="${1:-all}"
HOST="${HOST:-project-server}"
DOMAIN="dinosaur.untitledgames.co.uk"
CADDY_IMAGE="caddy:2-alpine"

case "$WHICH" in all|play|dev) ;; *) echo "usage: tools/set-passwords.sh [all|play|dev]" >&2; exit 2 ;; esac
docker image inspect "$CADDY_IMAGE" >/dev/null 2>&1 || { echo "Needs the $CADDY_IMAGE image locally (docker pull $CADDY_IMAGE)." >&2; exit 1; }

ask() {  # $1 = what it's for; prints the bcrypt hash
  local a b
  while true; do
    read -r -s -p "$1 password: " a </dev/tty; echo >&2
    read -r -s -p "Again: " b </dev/tty; echo >&2
    if [[ "$a" != "$b" ]]; then echo "They don't match. Try again." >&2; continue; fi
    if (( ${#a} < 10 )); then echo "Use at least 10 characters." >&2; continue; fi
    break
  done
  printf '%s' "$a" | docker run --rm -i "$CADDY_IMAGE" caddy hash-password
}

lines=("UDG_DOMAIN='$DOMAIN'")
if [[ "$WHICH" == all || "$WHICH" == play ]]; then
  echo "The playtest password: testers type it to open the game. User name: play" >&2
  hash="$(ask "Playtest")"
  cookie="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 40)"
  lines+=("UDG_PLAY_USER='play'" "UDG_PLAY_PASSWORD_HASH='$hash'" "UDG_PLAY_COOKIE='$cookie'")
fi
if [[ "$WHICH" == all || "$WHICH" == dev ]]; then
  echo "The staff password for /dev/ (the internal docs). User name: staff" >&2
  hash="$(ask "Staff")"
  lines+=("UDG_DEV_USER='staff'" "UDG_DEV_PASSWORD_HASH='$hash'")
fi

keys="$(printf '%s\n' "${lines[@]}" | cut -d= -f1 | tr '\n' ' ')"
# Replace those keys in /opt/udg/.env (mode 600), keeping any others.
printf '%s\n' "${lines[@]}" | ssh "$HOST" "set -e; umask 077; mkdir -p /opt/udg; f=/opt/udg/.env; touch \"\$f\"; chmod 600 \"\$f\";
  new=\"\$(cat)\"; tmp=\"\$(mktemp /opt/udg/.env.XXXXXX)\";
  awk -v keys='$keys' 'BEGIN { n = split(keys, k, \" \"); for (i = 1; i <= n; i++) drop[k[i]] = 1 }
    { split(\$0, p, \"=\"); if (!(p[1] in drop)) print }' \"\$f\" >\"\$tmp\";
  printf '%s\n' \"\$new\" >>\"\$tmp\"; mv \"\$tmp\" \"\$f\"; chmod 600 \"\$f\""
echo "Saved to $HOST:/opt/udg/.env: $keys" >&2
