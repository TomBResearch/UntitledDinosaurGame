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
- **The connect-phase seam (new, this slice)**: `tools/load-test/src/staging-probe.ts` —
  N bounded WebSocket connect samples against an EXPLICIT endpoint; digest-only evidence; always
  finite; zero dependencies (Node built-ins + the runtime global WebSocket, absence NAMED).
  Independently verified WITHOUT any endpoint: `tests/unit/udg-spike-001/staging-probe.test.ts`
  (7/7: real loopback handshakes, redaction proof — host/port/URL appear NOWHERE in the record —
  named failures on destroy/silence, budgeted timeouts, pre-socket endpoint rejection with
  userinfo refusal, clamped samples, self-serve listener retirement). Localhost smoke retained:
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

## 4. Access limitation (by construction, test-pinned)

Dial-out to the single explicit endpoint ONLY; no listen socket ever binds non-loopback; the
endpoint VALUE never enters a record, log or commit — only `sha256(lowercased host:port)`
(unit-asserted absence of host literal, port literal and scheme prefix in the record); userinfo
URLs are REJECTED before any socket opens (no secrets ride URLs); wss uses the runtime's default
TLS verification (recorded as `runtime-default-verification`), plain ws is labelled
`plain-ws-not-private` and is acceptable ONLY for the self-serve smoke; samples ≤ 20, per-connect
timeout ≤ 10 s, every path finite — no grid can accidentally form.

## 5. Evidence capture and retirement

Capture: redirect the probe's stdout to `artifacts/.local/spike-001/<bundleId>/staging-connect.json`
plus a `run.log`; manifest with the repo's existing bundle process (`SHA256MANIFEST.txt`;
`node tools/checks/dist/evidence.js checksums --write` is for contracts, bundle manifests follow
the dpa8x/dpa9x convention). The record is ALREADY redaction-safe to commit (digest only) —
still keep it local until the owner rules on publication, consistent with every prior bundle.
Retirement: deletion of the bundle directory retires the evidence completely (nothing else
persists); the digest is irreversible, so the endpoint value survives only in the owner's own env.
Validity floors BEFORE any number counts (carried from §15B, not re-invented): reachability
witnessed by the room's own ledger; achieved-regime labelling; the dropModel label unless the
network itself is the impairment source.

## 6. GA-11 remaining matrix / readiness, as actually recorded (§19/§15B/§12, checked before writing)

The matrix is the 12 OFFICIAL coordinates (full-window cell × official profile/seed coordinates,
per plan §2 and the profile table) executed in FORMAL mode (`UDG_GATE_A_FORMAL=1`, clean tree,
official coordinates → kind-GATE-A row artefacts) through the §12/§13 T-7 manual workflow, over the
nominated deployment; dispatch shape today:
`pnpm test:spike -- --id UDG-SPIKE-001 --cell full-window --profile <lan|moderate|elevated|poor> --seed <n>`
per coordinate, plus the ga-scenarios scenario-evidence cell and the recovery cell, unchanged.
What remains between here and there is EXACTLY §15B(1)–(5) + the owner-executed matrix + the
§19 representative-deployment nomination; nothing in this repo substitutes, and none of it is
blocked on code that this repo is missing except the labelled full-session endpoint-injection mode
of §2 above, which should be built when, and only when, a nominated endpoint exists.

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
