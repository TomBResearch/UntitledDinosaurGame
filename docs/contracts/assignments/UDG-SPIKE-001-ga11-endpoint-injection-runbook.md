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
  PRE-REGISTERED fixed population; and the loopback Basic-auth facsimile hop (127.0.0.1 only)
  that validates the whole authed path under the ACTUAL strict posture described in §3.
- `tests/e2e/netcode.spec.ts` → env-gated cell `ga11-session` (`UDG_GA11_SESSION=1`; **no CI
  route, no spike-CLI cell** — the accepted slice-23/24 dispatch shape): TWO real seats in the
  pinned Chromium join the SAME room on the nominated origin over its own HTTPS/WSS Basic-auth
  path. Slice-30 review correction, binding: the actual vhost challenges EVERY method including
  OPTIONS, so the seat pages are SAME-ORIGIN — the DOCUMENT navigation itself authenticates the
  protected `/` through context-scoped `httpCredentials` (`origin` = the nominated origin, never
  a wildcard) and the HTTP STATUS IS ENFORCED per seat (a 401 after credentials is a named
  admission failure; the earlier cross-origin-localhost priming design is removed). The ONLY
  interception is the known local module-asset allowlist (`GA11_MODULE_PATH_PREFIXES`: the two
  harness entry modules + Vite's compiled-asset shapes), rewritten via `route.fallback` to the
  loopback Vite pipeline; the SDK's matchmake routes and the WebSocket are NEVER intercepted and
  nothing is proxied. WS payload-byte distributions (per seat, per direction) are collected in
  memory via the Playwright page API and discarded — only counts and nearest-rank size summaries
  enter the record, with payload-only semantics and NO heartbeat-vs-patch claim. Shipped
  `joinPredictionSeat`/`createSdkSeatTransport`/`DirectMotionPredictor` and the accepted
  `pingLatency → Room.ping` seam are reused unchanged. A no-credentials negative control must
  meet the ACTUAL service's 401 on the document and then fail to join.
- `tests/support/ga11-stdin-setup.mjs` + one `globalSetup` line in `playwright.config.ts` — the
  credential RELAY: a Playwright worker never inherits the dispatched stdin, so the MAIN process
  reads the piped netrc and passes it through the child environment (base64, in-process only —
  never argv, never a file), and the cell deletes the variable the instant it decodes it. The
  setup is COMPLETELY INERT unless `UDG_GA11_SESSION=1`; the UDG-004 config pins (serial, one
  chromium project, `pnpm dev` webServer) hold and their contract test passes.
- Verification already done OFF-HOST, loopback only: unit 21/21
  (`tests/unit/udg-spike-001/ga11-session.test.ts`), and full facsimile runs of the real cell
  green UNDER THE STRICT POSTURE (Basic on every method including OPTIONS; 3/3 sessions,
  120/120 finite RTT samples per session, same-origin document navigations authenticated with
  the status enforced, resolved-prefix match under the tightened rule, WS frame distributions
  non-trivial and summary-only, negative control met a real 401, zero failing checks, artifacts
  re-scanned secret- and identity-free — with the netrc actually PIPED through the relay). The
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
serving both the matchmake HTTP and the WSS upgrade. Because the seat documents are SAME-ORIGIN
with the service (the navigation authenticates; the module assets arrive through the local
allowlist rewrite), the session issues no cross-origin requests and no preflight ever needs to
pass unauthenticated. No new endpoint, no health check, no debug route, no CORS or auth
relaxation — the session uses ONLY the routes the pinned SDK already uses. The facsimile hop
reproduces exactly this posture (OPTIONS included), and the facsimile runs above are the proof
the path works UNDER it. One consequence, stated honestly: the page byte observations are
WS payload lengths client-side; hop-level byte totals exist only in the facsimile.

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

# 1) pure-seam unit tests (no browser, no endpoint, no credentials — must be 21/21):
pnpm vitest run tests/unit/udg-spike-001/ga11-session.test.ts

# 2) loopback FACSIMILE rehearsal of the EXACT dispatched command UNDER THE ACTUAL AUTH POSTURE
#    (Basic on every method including OPTIONS; fake local credentials piped; 127.0.0.1 ephemeral
#    only; trace/screenshot retention off; artifact isolated under UDG_SPIKE_OUT):
printf 'machine 127.0.0.1 login rehearsal password %s\n' "$(openssl rand -base64 18)" | \
  env UDG_GA11_SESSION=1 UDG_GA11_FACSIMILE=1 UDG_E2E_TRACE=off \
      UDG_SPIKE_OUT=artifacts/.local/spike-001/ga11-facsimile-$(date -u +%Y%m%dT%H%M%SZ) \
      UDG_E2E_JUNIT=none UDG_E2E_RESULTS=none \
  pnpm exec playwright test netcode.spec.ts -g "ga11-session"

# 3) THE REAL FIRST PATH. Credentials: the root-owned netrc (existing host format, one
#    `machine <nominated-host> login <l> password <p>` line) piped on STDIN ONLY — never argv,
#    never a file this repository reads, never echoed. The endpoint and the deployed build's own
#    join-gate triple travel via env (the accepted staging-probe posture: env is the only
#    ingress). stdout passes through the FAIL-CLOSED host-redaction filter before tee; trace,
#    screenshots, JUnit and the JSON reporter are all off, so no retained surface can carry an
#    endpoint value, credential or session identity (and the cell re-scans its own record).
export UDG_GA11_ENDPOINT=https://<nominated-origin>           # explicit; nothing is guessed
BUNDLE=<bundleId>
mkdir -p "artifacts/.local/spike-001/$BUNDLE"
sudo cat /root/.netrc | \
  env UDG_GA11_SESSION=1 UDG_GA11_ENDPOINT="$UDG_GA11_ENDPOINT" \
      UDG_GA11_PROTOCOL='<protocolVersion of the deployed build>' \
      UDG_GA11_CONFIG_HASH='<hex64 from the server ready line / RELEASE.json>' \
      UDG_GA11_MANIFEST_HASH='<hex64 from the server ready line / RELEASE.json>' \
      UDG_RUN_ID="$BUNDLE" UDG_SPIKE_OUT="artifacts/.local/spike-001/$BUNDLE" \
      UDG_E2E_TRACE=off UDG_E2E_JUNIT=none UDG_E2E_RESULTS=none \
  pnpm exec playwright test netcode.spec.ts -g "ga11-session" 2>&1 | \
  node tools/load-test/dist/ga11-log-filter.js | \
  tee "artifacts/.local/spike-001/$BUNDLE/run.log"
```

The join-gate triple MUST be the deployed build's own (a wrong triple is refused by the room's
gate — an honest named failure, never to be "fixed" by guessing). The cell's own wall budget is
1 500 s; a run that exceeds it fails loudly with nothing claimed. `ga11-log-filter` REFUSES
(exit 2) when `UDG_GA11_ENDPOINT` is unset — an unredacted silent log is not an option.

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
                                 (Playwright page API; payload-only semantics; heartbeat-vs-patch
                                 NOT identifiable at this seam so NO patch-byte claim; raw lengths
                                 discarded, no URLs persisted); hop-level totals exist ONLY in the
                                 facsimile
impairment source:               none injected — natural path only (label travels: regime
                                 NOT CLAIMED until §15B(4) characterisation exists)
validity floors before any use:  reachability witnessed by the room's own replication; each seat's
                                 same-origin document authenticated by the ACTUAL service (status
                                 enforced, no 401 after credentials); per-session eligibility as
                                 above; the negative control met a real 401 and failed to join;
                                 artifacts secret- and identity-free on page-error surfaces (all
                                 are cell checks that fail the run if false)
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
