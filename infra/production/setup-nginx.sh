#!/usr/bin/env bash
# Adds the game's hostname to the server's existing nginx, safely (modelled on the racing
# game's script):
# - Only ever writes /etc/nginx/conf.d/dinosaur.untitledgames.co.uk.conf, and refuses if a
#   file there isn't ours. Other sites' files are never edited.
# - Every change is checked with `nginx -t` first and rolled back if it fails, and nginx is
#   reloaded (not restarted), so the other sites keep serving throughout.
# - Gets a Let's Encrypt certificate for the one name with certbot --webroot (other
#   certificates aren't touched); certbot's existing timer renews it and reloads nginx.
# - Checks every other site (the racing game and accounts included) answers the same before
#   and after.
# Run on the server: sudo bash /opt/udg/nginx/setup-nginx.sh dinosaur.untitledgames.co.uk
set -euo pipefail
DOMAIN="${1:?domain}"
CONF="/etc/nginx/conf.d/$DOMAIN.conf"
TEMPLATE="$(dirname "$0")/dinosaur.conf.template"
MARKER="MANAGED BY infra/production/setup-nginx.sh"

[[ -f "$TEMPLATE" ]] || { echo "Missing $TEMPLATE" >&2; exit 1; }
[[ "$DOMAIN" =~ ^[a-z0-9.-]+$ ]] || { echo "Odd domain: $DOMAIN" >&2; exit 1; }
if [[ -f "$CONF" ]] && ! grep -q "$MARKER" "$CONF"; then
  echo "$CONF exists and isn't ours: not touching it." >&2
  exit 1
fi

# Status of every other site nginx serves, to compare afterwards.
other_sites() {
  grep -rhoE "server_name[^;]+" /etc/nginx/conf.d/*.conf | sed 's/server_name//' | tr ' ' '\n' \
    | grep -E '\.' | grep -vxF "$DOMAIN" | grep -v '^www\.example\.com$' | sort -u
}
site_status() {
  for host in $(other_sites); do
    printf '%s %s\n' "$host" "$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$host:443:127.0.0.1" "https://$host/")"
  done
}
BEFORE="$(site_status)"

render() { sed -e "s/__DOMAIN__/$DOMAIN/g" "$TEMPLATE"; }
install_conf() {  # $1 = full|http
  local backup=""
  [[ -f "$CONF" ]] && backup="$(mktemp)" && cp "$CONF" "$backup"
  if [[ "$1" == http ]]; then
    render | sed '/#HTTPS_START/,/#HTTPS_END/d' >"$CONF"
  else
    render >"$CONF"
  fi
  if ! nginx -t 2>/tmp/udg-nginx-test.log; then
    echo "nginx rejected the new config; putting the old one back:" >&2
    cat /tmp/udg-nginx-test.log >&2
    if [[ -n "$backup" ]]; then cp "$backup" "$CONF"; else rm -f "$CONF"; fi
    exit 1
  fi
  systemctl reload nginx
}

mkdir -p /var/www/letsencrypt
if [[ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
  echo "== Getting a certificate for $DOMAIN"
  install_conf http
  certbot certonly --webroot -w /var/www/letsencrypt -d "$DOMAIN" --cert-name "$DOMAIN" \
    --non-interactive --keep-until-expiring --deploy-hook "systemctl reload nginx"
fi
echo "== Installing the HTTPS config"
install_conf full

AFTER="$(site_status)"
echo "== Other sites (before -> after)"
paste <(echo "$BEFORE") <(echo "$AFTER" | awk '{print $2}')
if [[ "$BEFORE" != "$AFTER" ]]; then
  echo "WARNING: another site's response changed. Check it now." >&2
  exit 2
fi
echo "Done: nginx passes $DOMAIN to the game stack on 127.0.0.1:8082; other sites unchanged."
