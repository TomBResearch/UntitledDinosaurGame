# UDG-SPIKE-001 — private staging TRIAL record: owner-nominated AL2023 arm64 host, loopback smoke under limits

Status: **RECORD — SHORT PRIVATE-STAGING TRIAL. NOT A GATE DECISION.** No gate flips status here:
Gate A remains Not Run; GA-11 remains the sole nomination authority and its §15B(1)–(5)
prerequisites are NOT met by this trial; nothing here claims that a second (public) egress path
"suffices" for anything. This file records what was measured on one owner-nominated host, once,
with bounds, and what was deliberately NOT recorded. Related: [GA-11 staging
handoff](UDG-SPIKE-001-ga11-staging-handoff.md) — this trial exercises exactly the
"day-an-endpoint-exists" plumbing of that handoff and learns nothing beyond it about topology.

## 1. What ran, and who ran what

- Owner authorised private staging on the EXISTING shared AL2023 arm64 EC2 host (instance type
  **t4g.small**). EC2 SSH/Nginx/transport setup and the before/after access checks were Codex's
  scope on the host; this repository task made **no external EC2 access and no cloud changes** —
  the numbers in §3 are Codex's on-host observations transcribed here, measured with the shipped,
  unmodified `staging/smoke.sh` CLI.
- Artifact under trial: the off-host-prepared release `udg-room.tar.gz`,
  **sha256 `7210c3d6e03595762f3cb5896d81ed6744bd609f4a988c4c0529de7fe5ef0c15`** (50,619,327 bytes;
  checksum file `udg-room.tar.gz.sha256` travelled with it; per-file `SHA256SUMS` +
  `SHA256SYMLINKS` + `RELEASE.json` inside).
- Release source: PR #7 head `92ce2e6` + the reviewed `staging/` integration files
  (launcher / smoke CLI / packager / runbook; retained on this branch). The archive's own
  `RELEASE.json` carries the full provenance record.
- Runtime: the **bundled Linux `node` binary — pinned official build v24.22.2 linux-arm64**
  (tarball sha256 `eb187837a2230d4047161ac0be008584e16b46f726e9c9490ee35dc6b17d9ba8`, verified
  against nodejs.org SHASUMS256 off-host; requires glibc ≥ 2.28; AL2023 ships 2.34). No system
  runtime was used or required.
- Config: the shipped `staging/config/region-config.json` —
  `configHash 8aa736e2f852763e3e19aad6d3e2bb9f40dfc025477c1a482e0db045ab292981`,
  `manifestHash cef01d2c41367cc3dd575bda9f8c2369878587bcc4338d027d8ac20bcbc34150`; the smoke
  recomputed the gate triple from the shipped document and the server's join gate accepted the
  exact triple (wrong triples were verified refused off-host before shipping).

## 2. Bounds under which the trial ran (host side, Codex-configured)

- Service cgroup memory limit **256 MiB (268,435,456 B)** — this bound, not the launcher's
  `--max-old-space-size=512` heap ceiling, was the operative memory limit on the host.
- CPU quota **0.5 vCPU**.
- Service bound to `127.0.0.1:18673` only (loopback enforced by `staging/launch.mjs`); the public
  side was a **TLS vhost with Basic auth** (Nginx, Codex-owned). **This record deliberately
  contains NO passwords, NO credentials, NO origin/endpoint IP or host values** — per the
  redaction discipline of the GA-11 handoff §4 (and note there too: any such digest is redaction,
  not access control).

## 3. Measured (loopback, on-host, single bounded smoke window)

| Observation | Value |
| --- | --- |
| Server-authority tick continuity | **197 ticks / 10.001 s ≈ 19.7 Hz** vs declared 20 Hz (1.5% drift), **zero regressions** (strictly monotonic `serverTick`) |
| SDK ping samples | **4/4 replies** within the bounded sample budget |
| Bounded direct-input frame | **acknowledged by the server** (`inputResolvedThrough` resolved the sent seq on the seat's own replica row) |
| Cleanup survivor proof | **second seat joined the same room by id and was issued epoch 2** — the room and server survived the first seat's consented leave |
| Service cgroup peak memory | **40,042,496 B** against the 268,435,456 B limit (14.9% of limit) |

What these numbers are: one loopback smoke on one host under cgroup limits, run against the real
pinned `@colyseus/sdk` handshake. What they are NOT: a Gate A row, a GA-11 matrix input, a network
observation (the public vhost path was exercised only as owner-facing ingress plumbing by Codex;
no gameplay-path population was measured through it), or a reproducible evidence bundle (none was
captured; observation-only CLI, nothing retained beyond this record).

## 4. Honest limitations

- A single bounded smoke on one loopback interface says nothing about client-network topology,
  impairment, or multi-seat populations (§15B(2)–(4) untouched).
- The memory/CPU figures are one trial's peak under one configured cgroup, not a capacity model.
- The trial's ingress posture (Basic auth + private TLS) is Codex's staging configuration; it
  creates no egress grant and claims no second-egress sufficiency.

Reproduce the local-side mechanics (no host needed): see `staging/README-STAGING.md` (runbook) —
launch, smoke, shutdown are identical off-host and on-host; only the endpoint stays loopback.
