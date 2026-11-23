#!/usr/bin/env bash
# UDG-SPIKE-001 / GA-11 endpoint-injection — second-path wrapper (runbook §4B).
#
# Same client head, same endpoint, a DIFFERENT egress (e.g. cellular tether on the same Mac).
# Rules this wrapper upholds:
#   - credentials NEVER appear in chat, argv or logs: values live ONLY in the operator's own
#     netrc FILE (path supplied via GA11_NETRC_FILE) and the operator's environment;
#   - the endpoint VALUE is never echoed — the preflight prints only its sha256 digest;
#   - pnpm is NOT in the stdin pipeline (it swallows piped stdin in the dispatch container):
#     the credential bytes are fed with the shell-builtin `read`/`printf` straight into
#     ./node_modules/.bin/playwright, exactly as the runbook §4 command does;
#   - trace/screenshot/JUnit/JSON retention stay OFF and the FAIL-CLOSED host-redaction filter
#     sits between stdout and the log file;
#   - a per-bundle CHECKSUMS.txt is written beside every artifact set (local retention pattern).
set -euo pipefail

: "${UDG_GA11_ENDPOINT:?set UDG_GA11_ENDPOINT=https://<nominated-origin> in your environment}"
: "${GA11_NETRC_FILE:?set GA11_NETRC_FILE=/path/to/the/project-owned/ga11.netrc (operator/root-owned, mode 0600; the PATH travels here, values stay in the file)}"
: "${UDG_GA11_PROTOCOL:?set to the deployed protocolVersion}"
: "${UDG_GA11_CONFIG_HASH:?set to the deployed configHash (hex64)}"
: "${UDG_GA11_MANIFEST_HASH:?set to the deployed manifestHash (hex64)}"
: "${UDG_RUN_ID:?set UDG_RUN_ID, e.g. ga11-second-path-$(date -u +%Y%m%dT%H%M%SZ)-cellular}"
: "${UDG_GA11_SERVER_SHA:=}"   # optional but strongly wanted: the deployed server build SHA

if [[ ! -f "$GA11_NETRC_FILE" ]]; then
  echo "netrc file not found at the given path (this script handles PATHS only, never values)" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT"
umask 077

digest_only() {
  node -e 'const{createHash}=require("node:crypto");const u=new URL(process.env.UDG_GA11_ENDPOINT);const p=u.port||(u.protocol==="wss:"||u.protocol==="https:"?"443":"80");process.stdout.write(createHash("sha256").update(u.hostname.toLowerCase()+":"+p).digest("hex"))'
}

if [[ "${1:-}" == "--dry-run" ]]; then
  echo "preflight OK — endpoint host:port digest: $(digest_only)"
  echo "run id: $UDG_RUN_ID | deployed sha: ${UDG_GA11_SERVER_SHA:-NOT-SUPPLIED}"
  exit 0
fi

OUT="artifacts/.local/spike-001/$UDG_RUN_ID"
mkdir -p "$OUT"
npx tsc -p tools/load-test/tsconfig.json

# The runbook §4 stdin shape: builtin read-loop + builtin printf, straight into the local
# Playwright binary (no pnpm), through the fail-closed filter, tee'd to the bundle's run.log.
{ while IFS= read -r line; do printf '%s\n' "$line"; done < "$GA11_NETRC_FILE"; } | \
  env UDG_GA11_SESSION=1 UDG_GA11_ENDPOINT="$UDG_GA11_ENDPOINT" \
      UDG_GA11_PROTOCOL="$UDG_GA11_PROTOCOL" UDG_GA11_CONFIG_HASH="$UDG_GA11_CONFIG_HASH" \
      UDG_GA11_MANIFEST_HASH="$UDG_GA11_MANIFEST_HASH" UDG_GA11_SERVER_SHA="$UDG_GA11_SERVER_SHA" \
      UDG_RUN_ID="$UDG_RUN_ID" UDG_SPIKE_OUT="$OUT" \
      UDG_E2E_TRACE=off UDG_E2E_JUNIT=none UDG_E2E_RESULTS=none \
  ./node_modules/.bin/playwright test netcode.spec.ts -g "ga11-session" 2>&1 | \
  node tools/load-test/dist/ga11-log-filter.js | \
  tee "$OUT/run.log"

sha256sum "$OUT"/* | tee "$OUT/CHECKSUMS.txt"
