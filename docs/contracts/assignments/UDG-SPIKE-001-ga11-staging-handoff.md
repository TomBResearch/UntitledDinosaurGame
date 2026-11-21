# UDG-SPIKE-001 — GA-11 staging handoff: the smallest runnable path toward a FUTURE owner-nominated private endpoint

Status: HANDOFF ONLY. Nothing here provisions, accesses or probes anything external; no secret
exists to protect; the shipped probe seam has been pointed at exactly one place — 127.0.0.1.
Authority: the GA-11 prerequisites are §15B(1)–(5) of the
[formalization plan](UDG-SPIKE-001-gate-a-formalization-plan.md) and the §19 "EXACT OPEN NEED"
paragraph; this document makes the day-an-endpoint-exists mechanics concrete. GA-11 remains the
sole nomination authority for every provisional value; this handoff nominates nothing.

## 1. What CAN be measured today, and where the real browser lives

- **Full spike matrix locally**: the pinned real browser is the Playwright-pinned Chromium
  (`@playwright/test 1.65.0`'s browser build, headless) running on WHICHEVER machine executes the
  dispatch — today this container (arm64, Node pinned 24.22.2). Real `apps/client` pages, a real
  in-process `apps/server` room, the real TCP delay proxy; RTT/arrival/prefix/ledger populations
  all recorded per the cell schema. Topology recorded: loopback (127.0.0.1, private ephemeral
  ports). This is why `dropModel: application-layer delivery loss` labels every such number
  (ADR-0003 GA-11 row): the impairment SOURCE is the proxy model, never a network.
- **The connect-phase seam (new, slice 27; privacy statements corrected slice 28)**:
  `tools/load-test/src/staging-probe.ts` — N bounded WebSocket connect samples against an EXPLICIT
  endpoint; the record OMITS the endpoint value (only `sha256(lowercased host:port)` — see §4: that
  digest is REDACTION, NOT access control and NOT anonymity: a low-entropy hostname:port is
  dictionary-guessable by anyone who can read the record); zero dependencies (Node built-ins + the
  runtime global WebSocket, absence NAMED). Unit-verified WITHOUT any endpoint
  (`tests/unit/udg-spike-001/staging-probe.test.ts`, 7/7). Localhost smoke retained:
  `artifacts/.local/spike-001/dpa9g-staging-smoke/` (5/5 opens, self-serve 127.0.0.1 ephemeral).

## 2. What CANNOT be measured now, and the exact technical prerequisites

Not measurable now, by construction, not by tooling failure:
- connect RTT or any number against a REAL host — there is no nominated endpoint (§15B(1));
- gameplay-path populations on real ISP paths — client machines on two named provider egresses
  do not exist (§15B(2)), and two GitHub-hosted runners are NOT a network path (slice-17 fact
  correction stands);
- reachability-witnessed sessions — nothing to be reachable to (§15B(3));
- network-sourced impairment or its honest alternative label travelling with numbers (§15B(4)) —
  awaits a deployment whose network IS the impairment source;
- any exposure/ingress grant (§15B(5)) — a spike never opens a port; owner grant only.

Harness gap stated plainly (so nobody "discovers" it live on day one): the session cells
(full-window, ga-scenarios, ack-window) BOOT THEIR OWN in-process room and proxy — they do NOT
today accept an injected remote room URL. The probe seam covers connect phase only. The first
measurement against a nominated endpoint is therefore the PROBE, run by its owner; a FULL-SESSION
measurement needs one small, reviewed harness mode (endpoint injection into `joinSeat`/`joinImpSeat`
origins + proxy bypass or labelled on-path impairment) which is deliberately NOT built here —
building it before a deployment exists would invite measuring nothing.

## 3. Reproduce · validate · reset (all local, all independent of any endpoint)

```
# verification (independent of endpoints):
pnpm vitest run tests/unit/udg-spike-001/staging-probe.test.ts   # 7/7, loopback-only
npx tsc -p tools/load-test/tsconfig.json                          # seam compiles
# localhost smoke (records topology; retires its listener; exits finite):
npx tsc -p tools/load-test/tsconfig.json && \
  node tools/load-test/dist/staging-probe.js --self-serve
# against a FUTURE owner-nominated endpoint (the OWNER runs this; env is the only ingress):
UDG_STAGING_ENDPOINT=wss://<nominated-host>[:port] \
  [UDG_STAGING_SAMPLES=5] node tools/load-test/dist/staging-probe.js
```
Reset: the seam is STATELESS — no files, no listeners after exit (self-serve closes its ephemeral
127.0.0.1 port; proven by the unit test's port-change assertion). Unsetting the env var restores
"no endpoint" exactly; there is no config to roll back and nothing to delete.

## 4. Access limitation (by construction, test-pinned) — and what the digest does NOT do

Dial-out to the single explicit endpoint ONLY; no listen socket ever binds non-loopback; the
endpoint VALUE never enters a record, log or commit — only `sha256(lowercased host:port)`
(unit-asserted absence of host literal, port literal and scheme prefix in the record); userinfo
URLs are REJECTED before any socket opens (no secrets ride URLs); wss uses the runtime's default
TLS verification (recorded as `runtime-default-verification`), plain ws is labelled
`plain-ws-not-private` and is acceptable ONLY for the self-serve smoke; samples ≤ 20, per-connect
timeout ≤ 10 s, every path finite — no grid can accidentally form.

**The digest is NOT an access control, and NOT anonymity (statement corrected after review on
2026-11-21; earlier wording here implied more protection than exists).** `sha256(host:port)` is
one-way, but hostnames and ports are LOW-ENTROPY: anyone who can read the record can dictionary-
guess the endpoint (candidate domains, common ports) and confirm a guess in milliseconds. What the
redaction genuinely provides: the record carries no PLAINTEXT endpoint, so casual exposure (logs
pasted, bundles copied) does not hand the value over — but a determined reader with the candidate
set can recover it. Consequences that BIND anyone using this seam: the endpoint value must still be
treated as sensitive (owner-held env only); records are local-retained until the owner rules on
publication; the probe grants NO access to anything (it only dials what it is given); and access
limitation comes from the owner's endpoint firewall/allowlisting, never from this digest.

## 5. Evidence capture and retirement (bounds stated honestly)

Capture: redirect the probe's stdout to `artifacts/.local/spike-001/<bundleId>/staging-connect.json`
plus a `run.log`; manifest with the repo's existing bundle process (`SHA256MANIFEST.txt`).
**Capture and deletion bound ONLY the copies this process makes**: shell history, terminal scroll-
buffers, CI logs if anyone pastes a run, or any copy the owner makes are OUTSIDE deletion's reach —
deleting the bundle retires OUR copy completely (the probe writes nothing elsewhere and holds no
state), and nothing more. Because the record itself omits the endpoint value (with the guessability
caveat of §4), the record survives its own retention more safely than a raw log would, but the
OWNER'S copy of the endpoint value is the real secret and only the owner holds it.
Validity floors BEFORE any number counts (carried from §15B, not re-invented): reachability
witnessed by the room's own ledger; achieved-regime labelling; the dropModel label unless the
network itself is the impairment source.

## 6. GA-11 measurement vs the OFFICIAL 4×3 impairment matrix — TWO DIFFERENT EVIDENCE SETS
(conflated by an earlier revision of this document; corrected here, per review)

- **The official 4×3 Gate A matrix** (the impairment harness): 4 profiles (lan/moderate/elevated/
  poor — the IMPAIRMENT PROXY regimes) × 3 official seeds (1001/1002/1003) = 12 coordinates of the
  full-window cell, formal mode (`UDG_GATE_A_FORMAL=1`, clean tree) producing kind-GATE-A ROW
  artefacts, dispatched
  `pnpm test:spike -- --id UDG-SPIKE-001 --cell full-window --profile <p> --seed <n>`
  plus the ga-scenarios/recovery cells. Its evidence is about the PREDICTION/RECOVERY behaviour
  under the fixture's declared impairment class — `dropModel: application-layer delivery loss`
  labels EVERY number, because the impairment source is the proxy, not a network.
- **GA-11's representative-deployment measurement** is a DIFFERENT evidence set with its own
  requirements (§15B(1)–(5) + §19's EXACT OPEN NEED): a nominated production-like deployment and
  real client machines on named provider paths; the OFFICIAL PROFILES RE-DERIVED from that path
  topology; per-profile path CHARACTERISATION populations (matched-socket RTT percentiles, patch-
  interval distributions, arrival-stall maxima) feeding ADR-0003 §5's two NAMED inequalities
  (`B + J·λ + stall ≤ bufferMaxSize`; `clientSnapshotDeadlineMs ≥ 4 × patch interval + 2 × measured
  p99 RTT`); and the owner's NOMINATION of every provisional value (G, 500/4000/backoffs, the
  deadline, the 1000 ms floor proposal). Running the 4×3 matrix over the owner's deployment is
  the Gate A rows over real conditions — it does NOT by itself constitute GA-11's measurement,
  and GA-11 numbers must NEVER be sourced from loopback proxy runs (ADR-0003 GA-11 row: harness-
  modelled loss may not be presented as network loss).
What remains between here and either matrix is EXACTLY §15B(1)–(5) plus the owner-executed runs;
the only in-repo engineering gap is the labelled endpoint-injection session mode of §2 (build it
when a nomination exists, not before).

## 7. Unavoidable external inputs vs concrete remaining work

UNAVOIDABLE (owner/external, no local substitute exists): the deployment nomination (§15B(1));
two real-network client egresses (§15B(2)); the exposure/ingress grant (§15B(5)); the
owner-signed proposal disposition for GA-5b/GA-12 gate text (§21 names the exact lines); the
GA-11 numeric decisions; Tom's acceptance of the §D CONTRACT wording when implementation is ready.
CONCRETE REMAINING WORK (in-repo, sequenced, none of it a stall): implementation adoption of the
wait-first design WITH the recovery-budget pairing (the §20 dpa8i non-recovery + FOLLOW-UP-3
budget clause is the gate on that work); the labelled endpoint-injection harness mode WHEN (not
before) a nomination exists; the floor-aware GA-5l/malformed legs are ALREADY landed (opt-in);
denser trigger-time capture already landed (25 ms age watch + room watch). No local sequences are
needed to fill time between slices — the honest blocker list is above, and it is external.

## 8. RECONCILIATION (slice 29): what the client stall-floor seam can actually do today, and where
## production-enabling evidence must come from

The client now carries THREE clearly distinct surfaces (full statement at plan §21A): the legacy
numeric harness path (unchanged, PROTOTYPE-labelled, experimental only); the config-object path
(locally DECLARED waits, budgets labelled declared-matched-not-independently-verified); and the
new MEASURED-RECEIPT path — a machine-validated record of a measurement: recorded detection+recovery
are summed only on identical declared clock origins and timer bases, compared against the declared
available budget only on matching origins (or via an explicit, labelled declared send→fire offset),
with under-budget, missing, nonfinite, inconsistent, unprovenanced, wildcard-scoped and cross-clock
claims refused by named reason. Scope binds only to the ACTUAL supported room identity (join-supplied
or explicitly bound — never guessed, never wildcarded, never silently re-scoped), and a room/epoch
mismatch at use NEVER silently activates the measured profile: the shipped count-only default
continues with the refusal named in the trigger detail and in `stallAckFloorStatus()`. Applied
episodes reconcile the ACTUAL episode (seat-declared clock, fire → first accepted snapshot) against
the declared budget ONLY on matching origin+basis; anything else is stored as an explicitly
REPORTING-ONLY entry that carries no within/over wording. All exercises are SYNTHETIC test records;
no real value is admitted and the product default has not moved.

WHAT THIS SEAM CANNOT DO — the boundary this handoff exists to keep honest: machine validation
checks a receipt's INTERNAL coherence and scope only. It cannot confirm the truth of a measurement
about a network the client never saw. Production-enabling evidence comes exclusively from §15B(1)–(5)
— the owner's representative-deployment nomination, per-profile path characterisation, and the
owner-run formal matrix — whose measurements would ARRIVE AS RECEIPTS for this seam to validate,
never as something this seam manufactures. Until such receipts exist, every applied wait remains
local-experimental by labelling, and every GA row's status is exactly as previously recorded.
