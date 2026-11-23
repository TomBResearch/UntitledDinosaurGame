#!/usr/bin/env bash
# UDG-SPIKE-001 / GA-11 endpoint-injection — second-path wrapper (runbook §4B).
#
# Same client head, same endpoint, a DIFFERENT egress (e.g. cellular tether on the same Mac).
# Rules this wrapper upholds:
#   - credentials NEVER appear in chat, argv or logs and are NEVER stored in the container:
#     the netrc arrives EITHER on THIS script's STDIN (the proven SSH -> `docker exec -i`
#     pipeline streams it straight through) or from a pre-existing operator file path;
#   - the endpoint VALUE is never echoed — the preflight prints only its sha256 digest;
#   - pnpm is NOT in the stdin pipeline (it swallows piped stdin in the dispatch container):
#     the credential bytes go straight into ./node_modules/.bin/playwright, as runbook §4 does;
#   - trace/screenshot/JUnit/JSON retention stay OFF and the FAIL-CLOSED host-redaction filter
#     sits between stdout and the log file;
#   - the bundle directory is CREATE-ONLY (a repeat runId is REFUSED — nothing is overwritten);
#   - CHECKSUMS.txt is written on PASS *and* on a red measurement, includes run.log, excludes
#     itself, and the measurement's original exit code is preserved as the wrapper's own;
#   - the compiler is the PINNED LOCAL tsc (./node_modules/.bin/tsc) — no npx network fallback.
set -uo pipefail

die() { echo "ga11-second-path: $*" >&2; exit 1; }

: "${UDG_GA11_ENDPOINT:?set UDG_GA11_ENDPOINT=https://<nominated-origin> in your environment}"
: "${UDG_GA11_PROTOCOL:?set to the deployed protocolVersion}"
: "${UDG_GA11_CONFIG_HASH:?set to the deployed configHash (hex64)}"
: "${UDG_GA11_MANIFEST_HASH:?set to the deployed manifestHash (hex64)}"
: "${UDG_RUN_ID:?set UDG_RUN_ID, e.g. ga11-second-path-$(date -u +%Y%m%dT%H%M%SZ)-cellular}"
: "${UDG_GA11_SERVER_SHA:=}"     # optional but strongly wanted: the deployed server build SHA
: "${UDG_GA11_FACSIMILE:=}"      # '1' = loopback rehearsal through this same wrapper (no real path)
[[ "$UDG_RUN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$ ]] || die "UDG_RUN_ID must be a safe single path component (letters/digits/dot/dash/underscore, no '/' or '..')"
[[ "$UDG_RUN_ID" != *..* ]] || die "UDG_RUN_ID must not contain '..'"

# Credential SOURCE: operator file path (path only travels here) OR this script's own stdin
# (streamed from the operator's machine through SSH -> docker exec -i; nothing is stored in
# the container). Exactly one is required.
NETRC_SOURCE=''
if [[ -n "${GA11_NETRC_FILE:-}" ]]; then
  [[ -f "$GA11_NETRC_FILE" && ! -d "$GA11_NETRC_FILE" ]] || die "GA11_NETRC_FILE not found at the given path (this script handles PATHS only, never values)"
  NETRC_SOURCE='file'
elif [[ ! -t 0 ]]; then
  NETRC_SOURCE='stdin'
else
  die 'no credential source: set GA11_NETRC_FILE to the project netrc path OR pipe the netrc on stdin (the SSH pipeline form documented in runbook §4B)'
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT"
umask 077

digest_only() {
  node -e 'const{createHash}=require("node:crypto");const u=new URL(process.env.UDG_GA11_ENDPOINT);const p=u.port||(u.protocol==="wss:"||u.protocol==="https:"?"443":"80");process.stdout.write(createHash("sha256").update(u.hostname.toLowerCase()+":"+p).digest("hex"))'
}

if [[ "${1:-}" == "--dry-run" ]]; then
  echo "preflight OK — endpoint host:port digest: $(digest_only)"
  echo "run id: $UDG_RUN_ID | deployed sha: ${UDG_GA11_SERVER_SHA:-NOT-SUPPLIED} | credential source: $NETRC_SOURCE | facsimile: ${UDG_GA11_FACSIMILE:-0}"
  exit 0
fi

TSC="./node_modules/.bin/tsc"
[[ -x "$TSC" ]] || die 'pinned local compiler missing (./node_modules/.bin/tsc) — run pnpm install --frozen-lockfile; this wrapper never falls back to a network npx fetch'
"$TSC" -p tools/load-test/tsconfig.json || die 'local compile failed (nothing was dispatched)'

OUT="artifacts/.local/spike-001/$UDG_RUN_ID"
# CREATE-ONLY: a pre-existing bundle is REFUSED, never overwritten (the first-attempt retention
# rule applies to every dispatch, including failures).
if [[ -e "$OUT" ]]; then
  die "bundle $OUT already exists — refusing to overwrite; choose a fresh UDG_RUN_ID (attempts are retained, never replaced)"
fi
mkdir -p artifacts/.local/spike-001 && mkdir "$OUT" || die 'could not create the bundle directory'

# The measurement. `set -e` is deliberately OFF so a RED measurement still reaches the checksum
# step; PIPESTATUS captures the measurement's OWN exit code (filter/tee failures are surfaced
# separately and never mask it).
if [[ "$NETRC_SOURCE" == 'file' ]]; then
  { while IFS= read -r line; do printf '%s\n' "$line"; done < "$GA11_NETRC_FILE"; } | \
    env UDG_GA11_SESSION=1 UDG_GA11_FACSIMILE="$UDG_GA11_FACSIMILE" \
        UDG_GA11_ENDPOINT="$UDG_GA11_ENDPOINT" \
        UDG_GA11_PROTOCOL="$UDG_GA11_PROTOCOL" UDG_GA11_CONFIG_HASH="$UDG_GA11_CONFIG_HASH" \
        UDG_GA11_MANIFEST_HASH="$UDG_GA11_MANIFEST_HASH" UDG_GA11_SERVER_SHA="$UDG_GA11_SERVER_SHA" \
        UDG_RUN_ID="$UDG_RUN_ID" UDG_SPIKE_OUT="$OUT" \
        UDG_E2E_TRACE=off UDG_E2E_JUNIT=none UDG_E2E_RESULTS=none \
    ./node_modules/.bin/playwright test netcode.spec.ts -g "ga11-session" 2>&1 | \
    node tools/load-test/dist/ga11-log-filter.js | tee "$OUT/run.log"
else
  env UDG_GA11_SESSION=1 UDG_GA11_FACSIMILE="$UDG_GA11_FACSIMILE" \
      UDG_GA11_ENDPOINT="$UDG_GA11_ENDPOINT" \
      UDG_GA11_PROTOCOL="$UDG_GA11_PROTOCOL" UDG_GA11_CONFIG_HASH="$UDG_GA11_CONFIG_HASH" \
      UDG_GA11_MANIFEST_HASH="$UDG_GA11_MANIFEST_HASH" UDG_GA11_SERVER_SHA="$UDG_GA11_SERVER_SHA" \
      UDG_RUN_ID="$UDG_RUN_ID" UDG_SPIKE_OUT="$OUT" \
      UDG_E2E_TRACE=off UDG_E2E_JUNIT=none UDG_E2E_RESULTS=none \
    ./node_modules/.bin/playwright test netcode.spec.ts -g "ga11-session" 2>&1 | \
    node tools/load-test/dist/ga11-log-filter.js | tee "$OUT/run.log"
fi
STATUS_CAPTURE=("${PIPESTATUS[@]}")
STATUS=${STATUS_CAPTURE[0]:-$?}
FILTER_STATUS=${STATUS_CAPTURE[1]:-0}
[[ "$STATUS" -eq 0 && "$FILTER_STATUS" -ne 0 ]] && STATUS=$FILTER_STATUS

# CHECKSUMS on PASS and on FAIL alike: every bundle file except this checksum file itself,
# recorded with BUNDLE-RELATIVE paths so `cd <bundle> && sha256sum -c CHECKSUMS.txt` verifies.
( cd "$OUT" && find . -maxdepth 1 -type f ! -name 'CHECKSUMS.txt' -print0 | sort -z | xargs -0 sha256sum > CHECKSUMS.txt )
STATUS_NOW=$?
[[ "$STATUS_NOW" -eq 0 ]] && echo "ga11-second-path: bundle $OUT checksummed (CHECKSUMS.txt, self-excluded; run.log included)" || echo "ga11-second-path: WARNING — checksum writing failed (exit $STATUS_NOW); measurement exit was $STATUS" >&2
echo "ga11-second-path: measurement exit preserved: $STATUS (bundle: $OUT)"
exit "$STATUS"
