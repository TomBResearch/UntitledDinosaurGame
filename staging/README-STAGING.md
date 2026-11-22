# UDG region-room service — private staging release (off-host preparation)

Archive kind: `udg-staging-release`. This is a **runnable artifact**, not an acceptance artifact:
**Gate A is Not Run here**, nothing in this package signs an external grant, and this package does
**not** assert that one public egress path suffices. Those calls stay open and belong to the
owner-reviewed evidence process, not to a staging smoke.

## What this is

The real `@udg/server` region-room service (Colyseus `0.18.x` pinned set, `WebSocketTransport`),
deployed **production dependencies only** (`pnpm deploy --prod`: zero devDependencies, workspace
packages `@udg/config` / `@udg/protocol` inlined), plus three staging integration files:

- `staging/launch.mjs` — boots via the repo's own supported boot modules in `main.ts`'s exact order
  (`loadServerConfig` → D5 bounds refusal → `defineServer`/`defineOperatorRegionRoom`/
  `WebSocketTransport` → `serverless()` → `listen`). Adds exactly one knob `main.ts` does not
  expose: a configurable bind port (`main.ts` hard-codes `listen(0, …)`).
- `staging/config/region-config.json` — the build's own `DEFAULT_SERVER_CONFIG` with the D5-required
  region bounds set explicitly (greybox extents x/z −50..50, y −5..20, mirroring the accepted
  UDG-003 emitted-artifact run). Round-trip validated by `validateServerConfig`; its hashes are in
  `RELEASE.json` and are re-verified by the packaged smoke.
- `staging/smoke.mjs` — the server-local CLI smoke (see below).

Posture, enforced by the code that ships:

- **Loopback-only bind.** `launch.mjs` refuses any `UDG_ROOM_HOST` that is not a loopback literal.
  Default `127.0.0.1:18673` (`UDG_ROOM_PORT` to change; 18673 is the staging target).
- **No dev servers, no maps/assets, no admin/evidence/debug endpoints.** The only socket in the
  process is the one `WebSocketTransport` http server. No evidence-bundle writers run, no map files
  ship, nothing else listens. (The room's own bounded `DevelopmentSessions` reconnect-holder and
  in-memory `TickMetrics` are part of the reviewed room module and open no surfaces.)
- **No external contact.** The server makes zero outbound connections; the smoke test refuses any
  non-loopback `--url`.
- **Bounded heap.** `launch.sh` execs Node with `--max-old-space-size` (default 512 MB, override
  `UDG_ROOM_MAX_OLD_SPACE_MB`). That is a heap ceiling, not an RSS promise — see Memory.
- **Clean shutdown.** SIGTERM/SIGINT → `gracefullyShutdown(false)` + listener close, bounded.

## Requirements / baseline sysdeps (verified off-host)

- Linux **aarch64/arm64**, 64-bit. The bundled `runtime/bin/node` is the pinned
  **Node v24.22.2 linux-arm64** official build, verified against nodejs.org `SHASUMS256.txt`
  (tarball sha256 recorded in `RELEASE.json`). It needs **glibc >= 2.28** (max symbol requirement;
  AL2023 ships 2.34 — compatible). It runs directly on a plain AL2023 t4g.small; no other runtime
  is required.
- Extract and run **offline**: nothing in here resolves anything at start-up. `SHA256SUMS` covers
  every regular file; verify with `sha256sum -c SHA256SUMS` after extraction. `SHA256SYMLINKS`
  records the relative pnpm `node_modules` symlink farm (no absolute or escaping links) exactly as
  the archive stores it.

## Launch

```sh
# 0) port check only (no process management, nothing global):
ss -ltn 'sport = :18673'            # expect empty

# 1) foreground (simplest):
./staging/launch.sh
# stdout ready line:
# region server listening ws://127.0.0.1:18673 configHash <hex> manifestHash <hex>

# or backgrounded, recording ONLY this PID (never kill-by-name/pattern):
nohup ./staging/launch.sh >/var/log/udg-room.out 2>/var/log/udg-room.err & echo $! | sudo tee /run/udg-room.pid

# or systemd: ExecStart=/opt/udg-room/staging/launch.sh, User=unprivileged,
#             MemoryMax=768M, no NewScope needed.
```

Env knobs: `UDG_ROOM_HOST` (loopback literal only), `UDG_ROOM_PORT` (default 18673),
`UDG_ROOM_CONFIG` (default `staging/config/region-config.json`),
`UDG_ROOM_MAX_OLD_SPACE_MB` (default 512), `UDG_ROOM_NODE` (runtime override; default: bundled
`runtime/bin/node`, then system node with a warning — the pin is 24.22.2).

A config-refused boot exits 2 with the issues on stderr (e.g. bounds removed from the document —
that is the D5 gate, by design). A failed bind (port already held) also exits 2 with a named
`could not bind` line — never a stack trace, and never a retry loop.

## Smoke (server-local CLI, observation only)

Against the running service (default `ws://127.0.0.1:18673`):

```sh
./staging/smoke.sh                          # or: runtime/bin/node staging/smoke.mjs --json
./staging/smoke.sh --url ws://127.0.0.1:18673 --window-ms 6000 --pings 4
```

The smoke uses **the pinned `@colyseus/sdk` shipped in this archive** and the real room handshake:

1. `joinOrCreate('region', { protocolVersion, configHash, manifestHash })` — the triple is
   recomputed locally from the shipped document through the same `@udg/config` validator; the
   **server's join gate** decides. A server that answers a wrong triple would fail this check.
2. Server authority: replicated `protocolVersion/configHash/manifestHash` must equal the
   recomputed triple; the seat's own row must carry a **server-issued epoch**; one bounded
   direct-input frame sent through the SDK input handle must come back **resolved by the server**
   (`inputResolvedThrough`).
3. Tick continuity/cadence: `serverTick` sampled per patch over a bounded window — monotonic,
   observed Hz vs the declared `network.tickRate` (20 Hz, 15% tolerance).
4. Counts/latencies: join, first-patch, epoch-issued, input-ack latencies; ping RTT samples; patch
   deliveries; ticks observed. JSON on stdout, progress on stderr.
5. Cleanup + survivor proof: consented `leave()`, then a **second short-lived seat** joins the same
   room by id and sees a live `serverTick` and its own issued epoch — then leaves.

Bounded by construction: loopback-only `--url` (refuses anything else), clamped window (1–60 s) and
ping count (0–10), every wait has a deadline, no files written, **no process management of any kind**
(it never starts, signals, scans, or kills processes — the caller owns the server PID).
Exit `0` all checks pass · `1` a check failed · `3` could not run as stated.

## Memory expectations

- `--max-old-space-size=512` bounds the V8 old space. Expected RSS on t4g.small with 0–2 loopback
  seats: roughly 90–170 MB; the journal/metric buffers in the room are bounded by configuration.
- Recommend a systemd `MemoryMax=768M` (or equivalent) around the service on the 2 GiB host, with
  the rest of the box reserved for Nginx + OS. If the ceiling is ever hit, Node dies on OOM with a
  heap-exceeded message — that is the bound working, report it, do not raise it silently.

## Staging ingress needs (for the SSH/Nginx owner)

- The service listens on **TCP 127.0.0.1:18673 only** (port configurable via `UDG_ROOM_PORT`).
  It never binds `0.0.0.0` and never dials out — **no egress rules are needed for the service**;
  inbound from the public interface is entirely Nginx's to terminate.
- Nginx must proxy **one WebSocket location** to it: `proxy_http_version 1.1`,
  `proxy_set_header Upgrade $http_upgrade`, `proxy_set_header Connection "upgrade"`, long
  `proxy_read_timeout`/`proxy_send_timeout` (≥ 120 s recommended — idle seats hold one socket),
  and TLS termination on Nginx's side (the service speaks plain `ws://` on loopback; the public
  side can be `wss://`). The SDK connects to the endpoint root path; no URL prefix rewriting
  is required.
- Readiness: the **stdout ready line** and the TCP port are the readiness signal. There is
  deliberately **no HTTP health endpoint** — do not add one to "fix" probes; tail stdout instead.
- Copy-in: only this archive + its `.sha256` need to travel. Verify `sha256sum -c
  udg-room.tar.gz.sha256` on the host, extract, `sha256sum -c SHA256SUMS`, launch, smoke.

## Provenance

`RELEASE.json` binds: source commit, pnpm version + lockfile sha256, deployed `@colyseus/*` and
`@udg/*` versions, the shipped document's `configHash`/`manifestHash` as computed **by the deployed
code**, the Node runtime sha256/url, and the archive posture. `SHA256SUMS` covers every regular
file and `SHA256SYMLINKS` records every symlink in the deployed `node_modules` farm.
Build environment: an aarch64 Linux container (same architecture family as the AL2023 t4g.small
target) ran: workspace build of
`@udg/protocol` → `@udg/config` → `@udg/server`, `pnpm deploy --prod`, runtime fetch + SHASUMS
verification, then a **clean offline extract-and-run test** of this exact archive on 127.0.0.1:18673
followed by the packaged smoke.
