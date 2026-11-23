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
  that validates the whole authed path — including the CORS-preflight posture requirement below.
- `tests/e2e/netcode.spec.ts` → env-gated cell `ga11-session` (`UDG_GA11_SESSION=1`; **no CI
  route, no spike-CLI cell** — the accepted slice-23/24 dispatch shape): TWO real seats in the
  pinned Chromium join the SAME room on the nominated origin over its own HTTPS/WSS Basic-auth
  path, authenticating ONLY through context-scoped `httpCredentials` (`origin` = the nominated
  origin — never wildcard) primed by one bounded no-cors GET per context, using the shipped
  `joinPredictionSeat`/`createSdkSeatTransport`/`DirectMotionPredictor` and the accepted
  `pingLatency → Room.ping` seam. A no-credentials negative control MUST be refused.
- `tests/support/ga11-stdin-setup.mjs` + one `globalSetup` line in `playwright.config.ts` — the
  credential RELAY: a Playwright worker never inherits the dispatched stdin, so the MAIN process
  reads the piped netrc and passes it through the child environment (base64, in-process only —
  never argv, never a file), and the cell deletes the variable the instant it decodes it. The
  setup is COMPLETELY INERT unless `UDG_GA11_SESSION=1`; the UDG-004 config pins (serial, one
  chromium project, `pnpm dev` webServer) hold and their contract test passes.
- Verification already done OFF-HOST, loopback only: unit 16/16
  (`tests/unit/udg-spike-001/ga11-session.test.ts`), and TWO full facsimile runs of the real cell
  green (3/3 sessions, 120/120 finite RTT samples per session, resolved-prefix match, negative
  control refused at the 401, zero failing checks, artifacts scanned secret-free — including one
  run with a netrc actually PIPED through the relay). The routine suite's red/green set is
  byte-identical to `d69a7287` in this environment (pre-existing environment reds only: the
  container runs Node 24.22.3 against the 24.22.2 pin).

What the session records, honestly: per session — server-issued identity (roomId, two distinct
sessionIds, epochs, the presented join-gate triple), reachability witnessed by the ROOM-REPLICATED
state (both seats in the observer's validated snapshot), the mover's explicit inputs matched to the
server-issued epoch and to the room-replicated resolved prefix (`inputResolvedThrough`) with the
label `client-observed room replication — NOT room-internal evidence` (the deployment exposes no
debug endpoints BY DESIGN and none is added), the fixed Room.ping RTT population with eligibility
decided against the pre-registered constants, patch-interval p50/p95/max and arrival-stall max
(client page clock, source-labelled), and byte sizes ONLY where a counting hop exists (facsimile)
— on the real natural path the browser seam sees no frame bytes and the record says so explicitly
rather than zero-filling.

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

## 3. Ingress posture the deployment must have (Codex's Nginx side — one requirement, standard)

Basic auth must NOT challenge CORS preflights: `OPTIONS` requests must pass without a 401 (a
browser never attaches credentials to a preflight; an auth-challenged OPTIONS kills every
cross-origin join before a socket opens). This is the ordinary Basic-auth + CORS combination, and
the facsimile hop deliberately reproduces exactly this rule so nobody meets it for the first time
live. Same-origin TLS on the one nominated host serves both the matchmake HTTP and the WSS
upgrade; `Authorization` is already in the pinned core's default `Access-Control-Allow-Headers`.
No new endpoint, no health check, no debug route — the session uses ONLY the routes the pinned SDK
already uses.

## 4. Exact commands (Codex, inside container `603049da76e5`, pinned toolchain per repo pins)

The candidate is the PR #7 head after fast-forward (see §6 for the candidate/SHAs to state in the
record). Browsers: use the pinned `PLAYWRIGHT_BROWSERS_PATH` the container ships; do NOT run
`playwright install` there (read-only browsers — the config doc names this).

```sh
# 0) build (pinned toolchain: node 24.22.2, pnpm 12.18.0; chromium = Playwright 1.65.0's build):
pnpm install --frozen-lockfile
pnpm build:libraries && pnpm --filter @udg/client build && pnpm --filter @udg/server build
npx tsc -p tools/load-test/tsconfig.json

# 1) pure-seam unit tests (no browser, no endpoint, no credentials — must be 16/16):
pnpm vitest run tests/unit/udg-spike-001/ga11-session.test.ts

# 2) loopback FACSIMILE rehearsal of the EXACT dispatched command (fake netrc piped; proves the
#    relay + auth posture on the runner itself; binds 127.0.0.1 ephemeral only, retires finite):
printf 'machine 127.0.0.1 login rehearsal password <generated-local-only>\n' | \
  UDG_GA11_SESSION=1 UDG_GA11_FACSIMILE=1 \
  UDG_SPIKE_OUT=artifacts/.local/spike-001/ga11-facsimile-$(date -u +%Y%m%dT%H%M%SZ) \
  UDG_E2E_JUNIT=none UDG_E2E_RESULTS=none \
  pnpm exec playwright test netcode.spec.ts -g "ga11-session"

# 3) THE REAL FIRST PATH (owner-approved nominated origin; root-owned netrc on STDIN ONLY — the
#    existing host format `machine <nominated-host> login <l> password <p>` (one machine line for
#    the nominated origin's host; the VALUE stays owner-side — this document names no host, per
#    the TRIAL record's own discipline); nothing on the command line carries a secret; env carries
#    only the endpoint and the build triple, the same "env is the only ingress" posture as the
#    accepted staging probe):
sudo cat /root/.netrc | \
  UDG_GA11_SESSION=1 \
  UDG_GA11_ENDPOINT=https://<nominated-origin> \
  UDG_GA11_PROTOCOL=<protocolVersion of the deployed build> \
  UDG_GA11_CONFIG_HASH=<hex64 from the server's ready line / RELEASE.json> \
  UDG_GA11_MANIFEST_HASH=<hex64 from the server's ready line / RELEASE.json> \
  UDG_RUN_ID=<bundleId> \
  UDG_SPIKE_OUT=artifacts/.local/spike-001/<bundleId> \
  UDG_E2E_JUNIT=none UDG_E2E_RESULTS=none \
  pnpm exec playwright test netcode.spec.ts -g "ga11-session" 2>&1 | tee artifacts/.local/spike-001/<bundleId>/run.log
```

The join-gate triple MUST be the deployed build's own (the wrong triple is refused by the room's
gate — an honest named failure, never to be "fixed" by guessing). The cell's own wall budget is
1 500 s; a run that exceeds it fails loudly with no artifact claimed.

## 5. Artifacts, logs, retention

- `spike-cell-ga11-session.json` — the record (cell also writes the suite's usual
  `netcode-smoke-results.json`; both are checked secret-free by the cell's own final checks, and
  the operator SHOULD re-scan before any copy leaves the machine).
- `run.log` — operator's own tee of stdout; the endpoint value and credentials never enter the
  record; stdout carries the same digest-only lines. Deletion retires THIS copy only (handoff §5
  binds here unchanged: shell history, scroll-backs and any copied bundle are outside its reach).
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
measurement window per session:  60 000 ms (patch-interval + stall populations)
RTT population per session:      120 Room.ping samples, 100 ms cadence, 4 000 ms per-probe
                                 timeout, on the MOVER's own joined gameplay socket (accepted
                                 pingLatency → Room.ping seam); timeout samples stay in the raw
eligibility:                     ≥ 99 finite samples AND probe loss ≤ 2 % (plan §15B-B floors);
                                 otherwise the session is recorded INVALID-BY-ITS-OWN-FLOOR with
                                 named reasons — never re-scoped, never quietly shrunk
impairment source:               none injected — natural path only (label travels: regime
                                 NOT CLAIMED until §15B(4) characterisation exists)
validity floors before any use:  reachability witnessed by the room's own replication; per-
                                 session eligibility as above; negative control refused; artifacts
                                 secret-free (all four are cell checks that fail the run if false)
decisions this population feeds: the §15B(4) per-path characterisation and, through it, the two
                                 ADR-0003 §5 inequalities under GA-11's provisional values —
                                 nothing else; NO Gate A row is decided by it
```

If a facility is missing on the night (no triple available, hop refused, eligibility named), the
run still produces its record with the gap NAMED — deliver the genuinely measurable subset, state
the gap, and do not manufacture the rest. Byte sizes on the real path are a KNOWN gap of this
seam (explicit `available: false` in the record); closing it needs an owner-run on-path counter,
which this slice deliberately does not build (a harness hop on the real path would contaminate
the very network it is measuring and re-enter the ADR-0003 labelling trap).

## 7. Review path

Pi implements; Codex reviews and executes the live runs (owner's delegation, unchanged). A
credible result means: CI green on the routine lanes for the candidate, the facsimile rehearsal
green on the runner, then the §4 step-3 run whose artifact the review reads row-by-row. Gate A,
GA-11's verdict and every provisional value stay exactly where the accepted records put them.
