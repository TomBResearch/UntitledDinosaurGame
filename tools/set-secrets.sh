#!/usr/bin/env bash
# Makes the M1 secrets in /opt/udg/.env on the server (docs/operations/deploy.md), if they aren't
# there yet. Run it once before the first M1 deploy; running it again changes nothing.
#
#   tools/set-secrets.sh             # HOST=other for another SSH host (default: project-server)
#
#   POSTGRES_PASSWORD     made on the server (hex, so it's safe inside a database URL)
#   WORLD_TICKET_KEY      made on the server, shared by the API and the worlds
#   DINOSAUR_SERVICE_KEY  NOT made here: it must match the platform's SERVICE_KEYS entry in
#                         /opt/urg/.env. This script copies it from there if the platform has it.
#
# The values are made and kept on the server; nothing secret passes through this Mac or its logs.
# Changing POSTGRES_PASSWORD later needs ALTER USER too (Postgres keeps the password it started with),
# so this script never replaces an existing value.
set -euo pipefail
HOST="${HOST:-project-server}"

ssh "$HOST" 'set -e; umask 077; f=/opt/udg/.env
  [ -f "$f" ] || { echo "No $f: run tools/set-passwords.sh first." >&2; exit 1; }
  has() { grep -q "^$1=." "$f"; }
  if has POSTGRES_PASSWORD; then echo "POSTGRES_PASSWORD: already set"; else
    printf "POSTGRES_PASSWORD=%s\n" "$(openssl rand -hex 24)" >>"$f"; echo "POSTGRES_PASSWORD: made"; fi
  if has WORLD_TICKET_KEY; then echo "WORLD_TICKET_KEY: already set"; else
    printf "WORLD_TICKET_KEY=%s\n" "$(openssl rand -base64 36)" >>"$f"; echo "WORLD_TICKET_KEY: made"; fi
  if has DINOSAUR_SERVICE_KEY; then echo "DINOSAUR_SERVICE_KEY: already set"; else
    key="$(grep -h "^DINOSAUR_SERVICE_KEY=." /opt/urg/.env 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
    if [ -n "$key" ]; then printf "DINOSAUR_SERVICE_KEY=%s\n" "$key" >>"$f"; echo "DINOSAUR_SERVICE_KEY: copied from /opt/urg/.env"
    else echo "DINOSAUR_SERVICE_KEY: missing. Add it to the platform first (docs/architecture/accounts.md), then run this again." >&2; exit 1; fi
  fi
  chmod 600 "$f"'
