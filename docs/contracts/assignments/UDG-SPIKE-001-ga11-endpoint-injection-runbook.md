# UDG-SPIKE-001 — GA-11 endpoint-injection session RUNBOOK: the first real two-seat business session against the owner-nominated origin

Status: **RUNBOOK + REVIEWED CANDIDATE HARNESS MODE (slice 30). NOT a measurement, NOT a gate
decision, NOT a deployment act.** Nothing in this record was produced by touching the nominated
origin: the implementer (Pi) had NO live access, ran NOTHING outside this repository's loopback,
and the shipped loopback probe guard plus the official 4×3 impairment matrix are untouched and
remain separate evidence sets (handoff §6 holds unchanged). GA-11 remains the sole nomination
authority; §15B(1)–(5) are the prerequisites; Gate A remains Not Run. Related:
[GA-11 staging handoff](UDG-SPIKE-001-ga11-staging-handoff.md) (the mode built here is exactly the
labelled endpoint-injection session mode its §2 named as the only in-repo engineering gap),
[formalization plan](UDG-SPIKE-001-gate-a-formalization-plan.md) §15B/§19,
[private staging TRIAL record](UDG-SPIKE-001-private-staging-trial-record.md) (the loopback smoke
whose public ingress posture this session now measures THROUGH).

## 1. What exists now (candidate, review-bound)

- `tools/load-test/src/ga11-session.ts` — the pure seam (zero dependencies, Node built-ins, the
  package's rule held): endpoint guard (explicit `https:`/`wss:` origin only — no userinfo, no
  path; plain `ws:` admitted ONLY for the literal-loopback facsimile under a named flag, labelled
  `plain-not-private`); the stdin-netrc parser for the EXISTING host format
  `machine <host> login <l> password <p>` (exact machine match, `default` refused, duplicates
  refused, parse errors name line+token and NEVER a value); the redactor (login, password and
  endpoint host erased from every string the seam persists); the RTT eligibility rule against the
  PRE-REGISTERED fixed population; and the loopback facsimile hop (127.0.0.1 only) that
  validates the whole authed path UNDER THE ACTUAL POSTURE described in §3 — since slice-30r2 a
  TLS-TERMINATING HTTPS hop (Basic on every method including OPTIONS AND on the WSS upgrade) on
  an ephemeral, locally-owned, explicitly-UNTRUSTED test certificate (openssl per hop, key files
  unlinked on creation, no secret at rest), labelled `loopback-test-cert-untrusted`; TLS
  relaxation exists ONLY for that label — a real endpoint always navigates under runtime-default
  verification (`ga11SeatContextTlsOptions` pins the split structurally). Since slice-30r3 the
  guard's `webOrigin`/`socketOrigin` are WHATWG-CANONICAL (default ports omitted — Chromium
  matches `httpCredentials.origin` canonically, so an explicit `:443` would silently disable the
  credential; proven live); the digest stays the explicit host:effective-port pair.
- `tests/e2e/netcode.spec.ts` → env-gated cell `ga11-session` (`UDG_GA11_SESSION=1`; **no CI
  route, no spike-CLI cell** — the accepted slice-23/24 dispatch shape): TWO real seats in the
  pinned Chromium join the SAME room on the nominated origin over its own HTTPS/WSS Basic-auth
  path. Slice-30 review correction, binding: the actual vhost challenges EVERY method including
  OPTIONS, so the seat pages are SAME-ORIGIN — the DOCUMENT navigation itself authenticates the
  protected `/` through context-scoped `httpCredentials` (`origin` = the nominated origin, never
  a wildcard) and the HTTP STATUS IS ENFORCED per seat as a PROTECTED 2xx (a 401 — or any
  non-2xx: a 404 is not a page — after credentials is a named admission failure). The ONLY
  interception is the known local module-asset allowlist (`GA11_MODULE_PATH_PREFIXES`: the two
  harness entry modules + Vite's compiled-asset shapes); those assets are SERVED FROM NODE — a
  fresh, HEADERLESS loopback fetch (`headers: {}`; no browser request headers, cookies or
  Authorization copied; `redirect: 'error'`; hard timeout; 2xx-only) fulfilled via
  `route.fulfill` (`route.fallback({url})` is REMOVED — Playwright forbids a protocol change in
  fallbacks, which broke the real HTTPS path). The fetch target is pinned to literal-loopback
  http — no forward path to the nominated host exists at this seam; the SDK's matchmake routes
  and the WebSocket are NEVER intercepted. WS payload-byte distributions (per seat, per
  direction) are counted WINDOW-ONLY on the EXACT gameplay socket (canonical-origin match; the
  Vite HMR ws excluded at discovery and counted), collected in memory and discarded — only
  counts and nearest-rank summaries enter the record, with payload-only semantics, the scope
  label, and NO heartbeat-vs-patch claim. Every open/join/probe rides a named budget; a failed
  seat open closes its credential-carrying context before propagating; the negative control
  observes the real 401 with a clean bounded Playwright REQUEST probe (never a bare-document
  navigation — encrypted Chromium can throw ERR_INVALID_AUTH_CREDENTIALS) and then must fail to
  join; credentialed surfaces run in a CELL-LOCAL browser launched after the stdin relay env is
  deleted. Shipped `joinPredictionSeat`/`createSdkSeatTransport`/`DirectMotionPredictor` and the
  accepted `pingLatency → Room.ping` seam are reused unchanged. Slice-30r4 captures (from the
  a4 diagnosis): the EPOCH-AWARE sequence audit (per-proven-epoch evaluation, cross-epoch
  continuity, quarantine/negative), the separate outcome CLASSIFICATION (reachability / RTT
  eligibility / epoch verdict / behaviour findings; NOT-RUN on zero sessions), the sanitized
  episode timeline (scrubbed recovery ledger + node-clock state polls + raw-received-frame gap
  population distinct from accepted-patch lag), and `UDG_GA11_SERVER_SHA` recorded beside the run.
- `tests/support/ga11-stdin-setup.mjs` + one `globalSetup` line in `playwright.config.ts` — the
  credential RELAY: a Playwright worker never inherits the dispatched stdin, so the MAIN process
  reads the piped netrc and passes it through the child environment (base64, in-process only —
  never argv, never a file), and the cell deletes the variable the instant it decodes it. The
  setup is COMPLETELY INERT unless `UDG_GA11_SESSION=1`; the UDG-004 config pins (serial, one
  chromium project, `pnpm dev` webServer) hold and their contract test passes.
- Verification already done OFF-HOST, loopback only: unit 36/36 (epoch-audit regression and
  classification pins included since slice-30r4)
  (`tests/unit/udg-spike-001/ga11-session.test.ts`), and full facsimile runs of the real cell
  green UNDER THE STRICT POSTURE OVER TLS (Basic on every method including OPTIONS and the WSS
  upgrade, on the locally-owned untrusted test certificate; 3/3 sessions, 120/120 finite RTT
  samples per session, protected documents authenticated with a 2xx recorded and enforced,
  WINDOW-ONLY + GAMEPLAY-ONLY WS frame populations (one gameplay socket per seat, HMR excluded
  and counted, ~1 290 sent / ~708 received frames per mover in-window), resolved-prefix match
  under the tightened rule, negative control 401 via the clean request probe + refused join,
  zero failing checks, artifacts re-scanned secret- and identity-free — with the netrc actually
  PIPED through the relay). The
  routine suite's red/green set is byte-identical to `d69a7287` in this environment (pre-existing
  environment reds only: the container runs Node 24.22.3 against the 24.22.2 pin).

What the session records, honestly: per session — server-issued identity (roomId, two distinct
sessionIds, epochs, the presented join-gate triple), the same-origin document navigation statuses
through which the actual service authenticated each seat (enforced), reachability witnessed by
the ROOM-REPLICATED state (both seats in the observer's validated snapshot), the mover's explicit
inputs matched to the server-issued epoch and to the room-replicated resolved prefix
(`inputResolvedThrough`, under the tightened positive/known-seq/same-epoch rule) with the label
`client-observed room replication — NOT room-internal evidence` (the deployment exposes no debug
endpoints BY DESIGN and none is added), the fixed Room.ping RTT population with eligibility
decided against the pre-registered constants, patch-interval p50/p95/max and arrival-stall max
over the FULL EXACT page-clock window with truncation state (client page clock, source-labelled),
and WS payload-byte distributions per seat and direction (payload-only semantics, raw lengths
discarded, no URLs persisted, heartbeat-vs-patch NOT claimed) — plus hop-level byte totals that
exist only in the facsimile.

## 2. What this first path is NOT (read before running, and before quoting anything)

- NOT a Gate A row, NOT an official 4×3 coordinate, NOT a source for one. `formal: false` and the
  classification string are in the artifact bytes.
- NOT a regime claim. The path is NATURAL network only; no profile, provider or ISP name may
  accompany these numbers until the §15B(4) per-path characterisation exists — these populations
  are INPUT to that characterisation, nothing more.
- NOT the full GA-11 evidence set: this dispatch runs from ONE client machine, so §15B(2)
  (two named provider egresses) is NOT yet met — the gap is NAMED, not manufactured around. Full
  GA-11 remains Not-Run until the owner executes it across the nominated paths under §15B(1)–(5).
- NOT room-internal evidence (see above), and NOT anonymity: the artifact carries
  `sha256(lowercased host:port)` which is REDACTION ONLY — dictionary-guessable, per handoff §4,
  which binds every reader of these records.

## 3. Ingress posture (Codex's Nginx side — NOTHING to weaken)

The ACTUAL vhost posture is the measured one and this harness conforms to it rather than asking
for exceptions: **Basic auth on every method including OPTIONS**, TLS on the one nominated host
serving both the matchmake HTTP and the WSS upgrade, and a **2xx document at `/`** (the seat
navigation requires a protected PAGE — a 404 `/` names the failure on every session; serving the
built app at `/` is the ordinary posture). Because the seat documents are SAME-ORIGIN with the
service (the navigation authenticates; the module assets arrive through Node-side fulfilment),
the session issues no cross-origin requests and no preflight ever needs to pass unauthenticated.
No new endpoint, no health check, no debug route, no CORS or auth relaxation — the session uses
ONLY the routes the pinned SDK already uses. The facsimile hop reproduces exactly this posture
OVER TLS — Basic on every method including OPTIONS and the upgrade, on its own locally-owned
untrusted test certificate — and the HTTPS facsimile runs are the proof the path works UNDER it.
One consequence, stated honestly: the page byte observations are WS payload lengths client-side
(window-only, gameplay socket only); hop-level byte totals (post-TLS cleartext, the hop's own
view) exist only in the facsimile.

## 4. Exact commands (Codex, inside container `603049da76e5`, pinned toolchain per repo pins)

WORKDIR: the repository root checked out at the candidate commit — in this container
`/workspace/UntitledDinosaurGame` (or the equivalent checkout root; every path below is relative
to it). SHELL: bash with `set -euo pipefail`. TOOLCHAIN: the repo pins Node **24.22.2** and pnpm
**12.18.0**; they must be FIRST on PATH (`command -v node pnpm` resolves to them, not a system
runtime — the UDG-001 contract makes the version itself a checked fact). BROWSERS: the pinned
`PLAYWRIGHT_BROWSERS_PATH` the container ships (Playwright 1.65.0's chromium build 1254) — do
NOT run `playwright install` there (read-only browsers; the config doc names that failure).
The candidate is the PR #7 head after fast-forward; the deployed server build SHA and its own
gate triple are stated in the run record per §6 BEFORE any number is read.

```sh
set -euo pipefail
cd /workspace/UntitledDinosaurGame            # repository root at the candidate commit
node -v && pnpm -v                            # MUST print v24.22.2 and 12.18.0 (repo pins)
git rev-parse HEAD                            # MUST equal the candidate sha

# 0) build:
pnpm install --frozen-lockfile
pnpm build:libraries && pnpm --filter @udg/client build && pnpm --filter @udg/server build
npx tsc -p tools/load-test/tsconfig.json      # the seam + the fail-closed run.log filter

# 1) pure-seam unit tests (no browser, no endpoint, no credentials — must be 36/36):
pnpm vitest run tests/unit/udg-spike-001/ga11-session.test.ts

# 2) loopback FACSIMILE rehearsal of the EXACT dispatched command UNDER THE ACTUAL AUTH POSTURE
#    (HTTPS hop: Basic on every method including OPTIONS and the upgrade; fake local credentials
#    piped; 127.0.0.1 ephemeral only; trace/screenshot retention off; artifact isolated under
#    UDG_SPIKE_OUT). STDIN SHAPE IS DISPATCHER-PROVEN INSIDE THIS CONTAINER: `pnpm …` swallows
#    the piped stdin, so pipe the shell-BUILTIN printf directly into ./node_modules/.bin/playwright
#    (no pnpm in the stdin pipeline; the gated globalSetup still relays the bytes to the worker):
printf 'machine 127.0.0.1 login rehearsal password %s\n' "$(openssl rand -base64 18)" | \
  env UDG_GA11_SESSION=1 UDG_GA11_FACSIMILE=1 UDG_E2E_TRACE=off \
      UDG_SPIKE_OUT=artifacts/.local/spike-001/ga11-facsimile-$(date -u +%Y%m%dT%H%M%SZ) \
      UDG_E2E_JUNIT=none UDG_E2E_RESULTS=none \
  ./node_modules/.bin/playwright test netcode.spec.ts -g "ga11-session"

# 3) THE REAL PATH. Credentials: the deployment's PROJECT-SPECIFIC netrc file for this project
#    (NOT /root/.netrc — the existing host keeps its `machine <nominated-host> login <l>
#    password <p>` line in the project's own root-owned file; the operator names the path, the
#    VALUE never appears in any command line, log, or this document). Read it with the shell-
#    builtin BLOCKING loop (`IFS= read -r`) piping builtin printf straight into
#    ./node_modules/.bin/playwright — again no pnpm in the stdin pipeline (pnpm swallows stdin
#    here; dispatcher-proven). The endpoint and the deployed build's own join-gate triple travel
#    via env (env is the only ingress). stdout passes through the FAIL-CLOSED host-redaction
#    filter before tee; trace, screenshots, JUnit and the JSON reporter are all off (and the
#    cell re-scans its own record).
export UDG_GA11_ENDPOINT=https://<nominated-origin>           # explicit; nothing is guessed
GA11_NETRC_FILE=<the project's own root-owned netrc path>     # project-specific; never committed
BUNDLE=<bundleId>
mkdir -p "artifacts/.local/spike-001/$BUNDLE"
{ while IFS= read -r line; do printf '%s\n' "$line"; done < "$GA11_NETRC_FILE"; } | \
  env UDG_GA11_SESSION=1 UDG_GA11_ENDPOINT="$UDG_GA11_ENDPOINT" \
      UDG_GA11_PROTOCOL='<protocolVersion of the deployed build>' \
      UDG_GA11_CONFIG_HASH='<hex64 from the server ready line / RELEASE.json>' \
      UDG_GA11_MANIFEST_HASH='<hex64 from the server ready line / RELEASE.json>' \
      UDG_RUN_ID="$BUNDLE" UDG_SPIKE_OUT="artifacts/.local/spike-001/$BUNDLE" \
      UDG_E2E_TRACE=off UDG_E2E_JUNIT=none UDG_E2E_RESULTS=none \
  ./node_modules/.bin/playwright test netcode.spec.ts -g "ga11-session" 2>&1 | \
  node tools/load-test/dist/ga11-log-filter.js | \
  tee "artifacts/.local/spike-001/$BUNDLE/run.log"
```

The join-gate triple MUST be the deployed build's own (a wrong triple is refused by the room's
gate — an honest named failure, never to be "fixed" by guessing). The cell's own wall budget is
1 500 s; a run that exceeds it fails loudly with nothing claimed. `ga11-log-filter` REFUSES
(exit 2) when `UDG_GA11_ENDPOINT` is unset — an unredacted silent log is not an option.

## 4B. Second path (§15B(2)-minimal): SAME Mac, cellular egress — exact procedure

This is the smallest independent second egress: the same machine, the same client head, the
same endpoint, a DIFFERENT network path. It earns no regime name by itself — two
single-ISP-labelled paths, distinguished only by what the operator CONFIRMS about each.

1. Operator confirms which ISP/plan each interface uses (ISP names stay operator-confirmed
   facts, never guessed; NO external IP-lookup service is queried by anyone — a local
   `route -n get default` interface change is the only verification performed).
2. Attach the phone via USB tethering (or share cellular to the Mac over Wi-Fi while the
   home Wi-Fi is off), and confirm the default route moved to the tether interface.
3. Run the wrapper. Credentials travel ONLY as a stream on the wrapper's stdin through the
   proven SSH → `docker exec -i` pipeline — no netrc file is ever stored in the container, and
   no value is ever echoed (paths in, digest out):

   ```sh
   # operator-side (values stay on the operator's machine; <alias> = the EXISTING SSH config):
   ssh <alias> 'docker exec -i 603049da76e5 bash -lc \
     "cd /workspace/UntitledDinosaurGame && \
      UDG_GA11_ENDPOINT=https://<nominated-origin> UDG_GA11_PROTOCOL=<...> \
      UDG_GA11_CONFIG_HASH=<...> UDG_GA11_MANIFEST_HASH=<...> \
      UDG_GA11_SERVER_SHA=<deployed sha> UDG_RUN_ID=ga11-second-path-<utc>-cellular \
      ./docs/contracts/assignments/UDG-SPIKE-001-ga11-second-path.sh"' \
     < <(the operator supplies the netrc bytes here, locally)
   ```

   Inside the container directly, the equivalent is `GA11_NETRC_FILE=<pre-existing project
   path>` OR piping the same bytes on stdin. `--dry-run` preflights env/paths and prints the
   host DIGEST only. The wrapper: validates the runId as a safe single path component; creates
   the bundle CREATE-ONLY (a repeat id is REFUSED — attempts are never overwritten); compiles
   with the PINNED LOCAL `./node_modules/.bin/tsc` (no npx network fallback); writes
   `CHECKSUMS.txt` (including `run.log`, excluding itself) on PASS **and** on a red measurement;
   and preserves the measurement's exit code as its own.
   Since slice-30r6 the bundle also carries `spike-cell-ga11-session.progress.json`: an ATOMIC,
   scrubbed (secret- and identity-free), PARTIAL-labelled attempt trail written BEFORE cleanup at
   every phase (admission, optimizer warm-up, joins, window opens, each settled session, negative
   control), so even a worker dying mid-window leaves a parseable, checksum-covered trail — the
   EE bundle's "checksums but no record" shape cannot recur. The progress file is NEVER a record
   and its partial populations are never valid measurements; the complete
   `spike-cell-ga11-session.json`, when written, supersedes it.
4. Compare bundle identities: same endpoint digest, same triple, same client head — the ONLY
   intended variables are the egress path and the run id. Artefacts and their sha256s stay
   local.

**Division of labour on the Mac (documented so nobody improvises):** CODEX runs every command
(inspect, dispatch, checksum, review). The HUMAN does exactly two things: (a) changes which
network is active on the Mac (home Wi-Fi ⇄ phone tether/cellular), and (b) identifies the
provider/plan for each — nothing else is asked of a person, and no credential is ever pasted
into chat.

**Network/tunnel notes:** running the ALREADY-BUILT harness needs NO Pi inference tunnel — the
cell executes entirely on the dispatch machine; the Pi tunnel exists only for the Pi agent's own
model traffic, which is irrelevant to a dispatch. If the cloud SSH endpoint is IP-restricted,
DO NOT broaden the allowlist when the Mac changes networks: reach the runner through the
existing allowed path (e.g. from whatever host is already permitted) or run the dispatch
locally on the allowed machine — narrowing stays operator-owned, and this runbook never
requests rule changes.

## 5. Artifacts, logs, retention

- `spike-cell-ga11-session.json` — the record (cell also writes the suite's usual
  `netcode-smoke-results.json`; both are checked secret-free by the cell's own final checks,
  including that page-error surfaces carry no room/session identifiers, and the operator SHOULD
  re-scan before any copy leaves the machine). WS byte evidence inside it is summary-only — raw
  frame lengths are discarded in memory; no URL and no payload content is ever written.
- `run.log` — the operator's tee AFTER `ga11-log-filter` (fail-closed host redaction; the filter
  refuses to run without the endpoint env rather than pass values through). Playwright
  trace/screenshot retention is OFF for the dispatch (`UDG_E2E_TRACE=off`) and the JUnit/JSON
  reporters are disabled, so no retained surface can carry request URLs, headers or identities.
  Deletion retires THIS copy only (handoff §5 binds here unchanged: shell history, scroll-backs
  and any copied bundle are outside its reach).
- Retention: local until the owner rules on publication (the digest is guessable; the record
  therefore behaves as sensitive); NEVER push a raw record containing the endpoint host or the
  digest alongside private host IDs to a public destination. A secret-free summary in a contract
  commit quotes the DIGEST, the eligibility outcomes and the percentiles only.
- Reset/rollback: the seam is stateless — no listener survives the cell (the facsimile hop binds
  127.0.0.1 ephemeral and is stopped in the cell; the real mode opens NO listening socket at all),
  unsetting the env vars restores "no endpoint" exactly, and deleting the artifact directory
  retires the run.

## 6. Pre-registered first-path population (register THESE before the run; they are the rules the
artifact is judged by, and the cell records them beside every number)

```text
candidate (implement this run):   the slice-30 commit on PR #7 (fast-forward onto d69a7287)
deployed server build:           state the deployed SHA + configHash/manifestHash pair from its
                                 ready line IN THE RUN RECORD BEFORE READING ANY NUMBER
sessions per dispatch:           3 (fixed, sequential, same room; epochs distinguish joins)
warm-up per session:             20 000 ms (the adopted spike warm-up)
measurement window per session:  60 000 ms FULL EXACT page-clock window — start stamped BEFORE
                                 the pump, end stamped AFTER it, the mover ledger read ONCE in
                                 between (no pre-pump snapshot, no threshold heuristic); ledger
                                 capacity (20 000 rows) is recorded and TRUNCATION DETECTED
RTT population per session:      120 Room.ping samples, 100 ms cadence, 4 000 ms per-probe
                                 timeout, on the MOVER's own joined gameplay socket (accepted
                                 pingLatency → Room.ping seam); timeout samples stay in the raw
eligibility:                     ≥ 99 finite samples AND probe loss ≤ 2 % (plan §15B-B floors);
                                 otherwise the session is recorded INVALID-BY-ITS-OWN-FLOOR with
                                 named reasons — never re-scoped, never quietly shrunk
input matching:                  resolved prefix must be POSITIVE (zero resolves nothing, never
                                 counts as a match), cover ONLY KNOWN sent seqs (one seq per
                                 accepted send in the predictor's own audit, sentTotal > 0), and
                                 resolve on the CURRENT transport epoch; pending entries same-epoch
byte evidence:                   WS DATA-frame payload-byte distributions per seat and direction
                                 (Playwright page API; WINDOW-ONLY and EXACT-gameplay-socket-only
                                 by CANONICAL-origin match — HMR and other sockets excluded at
                                 discovery and counted, out-of-window frames deliberately
                                 excluded, incomplete-by-design labelled; payload-only
                                 semantics; heartbeat-vs-patch NOT identifiable so NO patch-byte
                                 claim; raw lengths discarded, no URLs persisted); hop-level
                                 totals (post-TLS cleartext) exist ONLY in the facsimile
impairment source:               none injected — natural path only (label travels: regime
                                 NOT CLAIMED until §15B(4) characterisation exists)
validity floors before any use:  reachability witnessed by the room's own replication; each seat's
                                 same-origin document authenticated by the ACTUAL service with a
                                 PROTECTED 2xx (status enforced; 401 or non-2xx names the
                                 failure); per-session eligibility as above; the negative
                                 control's clean request probe met a real 401 and the SDK join
                                 then failed; artifacts secret- and identity-free on page-error
                                 surfaces (all are cell checks that fail the run if false)
decisions this population feeds: the §15B(4) per-path characterisation and, through it, the two
                                 ADR-0003 §5 inequalities under GA-11's provisional values —
                                 nothing else; NO Gate A row is decided by it
```

If a facility is missing on the night (no triple available, refusal, eligibility named), the run
still produces its record with the gap NAMED — deliver the genuinely measurable subset, state the
gap, and do not manufacture the rest. Remaining honest limits of the byte evidence: the
client-visible numbers are WS payload lengths (headers/TLS overhead excluded) and
heartbeat-vs-patch is NOT separable at this seam, so no patch-byte-size claim is made; separating
them needs an owner-run on-path counter, which this slice deliberately does not build (a harness
hop on the real path would contaminate the very network it measures).

## 7. Review path

Pi implements; Codex reviews and executes the live runs (owner's delegation, unchanged). A
credible result means: CI green on the routine lanes for the candidate, the facsimile rehearsal
green on the runner, then the §4 step-3 run whose artifact the review reads row-by-row. Gate A,
GA-11's verdict and every provisional value stay exactly where the accepted records put them.
