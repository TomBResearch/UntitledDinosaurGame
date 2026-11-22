#!/usr/bin/env node
/**
 * UDG private-staging launch entry (staging integration file; adds no capability to the repo).
 *
 * Boots the REAL region-room service (the deployed `@udg/server` dist at the archive root) with
 * the same supported boot API and in the same order as `apps/server/src/main.ts`:
 *
 *   1. `loadServerConfig({ documentPath })` — a validated ServerConfig or a non-zero exit (code 2).
 *   2. The region block MUST carry bounds (owner decision D5 — no production region asset exists;
 *      starting without bounds is refused, exactly as `main.ts` refuses it).
 *   3. `defineServer({ rooms: { region: defineOperatorRegionRoom(...) }, transport:
 *      new WebSocketTransport({ server }) })` + `await server.serverless()`, then `listen`.
 *
 * The one thing this file adds over `main.ts` is the staging knob `main.ts` does not expose:
 * a CONFIGURABLE bind port. `main.ts` hard-codes `listen(0, host)` (ephemeral). Everything else —
 * the transport, the registered room handler, the operator nonce, the config gate — is the repo's
 * own composition, imported from the built modules, not a reimplementation.
 *
 * Staging posture (hard-enforced here, verifiable by review):
 *  - binds ONLY to a loopback address (127.0.0.1 by default; UDG_ROOM_HOST may only be a loopback
 *    literal). Any non-loopback host is refused with exit 2. Public ingress is Nginx's job.
 *  - reads ONLY the configuration document it is pointed at (default: the shipped
 *    staging/config/region-config.json, regenerated from the build's own defaults + bounds).
 *  - starts NO extra listener, admin surface, map/asset file, or debug endpoint: the only socket
 *    is the Colyseus WebSocketTransport on the one http server, on the one loopback port.
 *  - prints exactly one ready line on stdout, refuses on stderr with exit 2.
 *  - SIGINT/SIGTERM run `gracefullyShutdown(false)` and close the listener (bounded cleanup).
 *
 * Memory is bounded by the runtime flag (`--max-old-space-size`, set by launch.sh, default 512 MB)
 * — a heap ceiling, not a promise of a small RSS; expectations are documented in README.md.
 *
 * Environment:
 *   UDG_ROOM_HOST  loopback literal, default "127.0.0.1"
 *   UDG_ROOM_PORT  integer 1..65535,   default 18673
 *   UDG_ROOM_CONFIG path to the configuration document (JSON), default staging/config/region-config.json
 */

import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadServerConfig } from '../dist/server-config.js';
import { defineOperatorRegionRoom } from '../dist/rooms/RegionRoom.js';

// Same imports main.ts composes; `defineServer` + transport come from the installed pinned set.
const { defineServer } = await import('@colyseus/core');
const { WebSocketTransport } = await import('@colyseus/ws-transport');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

const refuse = (messages) => {
  for (const line of messages) process.stderr.write(`  ${line}\n`);
  process.exitCode = 2;
  process.exit(2);
};

const host = process.env['UDG_ROOM_HOST'] ?? '127.0.0.1';
if (!LOOPBACK_HOSTS.has(host)) {
  refuse([`staging refuses host "${host}": UDG_ROOM_HOST must be a loopback literal (${[...LOOPBACK_HOSTS].join(', ')})`]);
}

const portText = process.env['UDG_ROOM_PORT'] ?? '18673';
const port = Number(portText);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  refuse([`UDG_ROOM_PORT must be an integer 1..65535, got "${portText}"`]);
}

const documentPath = resolve(process.env['UDG_ROOM_CONFIG'] ?? resolve(ROOT, 'staging', 'config', 'region-config.json'));

// 1. Config gate — identical contract to main.ts: validated or exit non-zero.
const load = loadServerConfig({ documentPath });
if (load.ok === false) refuse([`config refused (${documentPath})`, ...load.issues]);
// 2. Bounds gate (D5).
if (load.loaded.config.region.bounds === null) {
  refuse(['the region block carries no bounds; there is no production region asset to fall back on (D5)']);
}

// 3. The repo's own server composition (main.ts step 3), with the configurable bind port.
//
// The validated document travels to the ROOM as operator `config` overrides — exactly the
// `roomOptions.config` channel `startRegionServer` uses. A room built with `{}` would boot on the
// bounds-less defaults and then refuse every join at the authority (`region-bounds-missing`): the
// deployment must reach `RegionRoom.onCreate`, and nothing else is handed to it. `limits` is
// deliberately absent: the validator re-issues it and it is never an override.
const { protocolVersion, region, movement, controller, network, input } = load.loaded.config;
const rooms = { region: defineOperatorRegionRoom({ config: { protocolVersion, region, movement, controller, network, input } }) };
const httpServer = createServer();
const transport = new WebSocketTransport({ server: httpServer });
const server = defineServer({
  rooms,
  transport,
  // stdout contract for staging is ONE machine-readable ready line; the vendor greeting banner is
  // marketing text, not telemetry, and would pollute the log the readiness signal lives in.
  greet: false,
});
await server.serverless();

await new Promise((listening, failure) => {
  httpServer.once('error', failure);
  httpServer.listen(port, host, () => {
    httpServer.off('error', failure);
    listening();
  });
}).catch((error) => {
  // A failed bind is a named start-up failure, not a stack-trace show: the caller owns the port
  // and must be able to tell "something already holds it" from a crash.
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  refuse([`the region server could not bind ${host}:${String(port)} (${code || 'listen failed'}): ${String(error)}`]);
});

const address = httpServer.address();
if (address === null || typeof address === 'string') refuse(['the region server did not bind a TCP port']);
const boundPort = address.port;

process.stdout.write(
  `region server listening ws://${host}:${String(boundPort)} configHash ${load.loaded.configHash} manifestHash ${load.loaded.manifestHash}\n`,
);

let closing = false;
// The core registers its own SIGINT/SIGTERM handling; this launcher owns teardown (it created the
// http server and must close it), so the core's signal hooks are replaced, not stacked — otherwise
// a SIGTERM races two shutdown paths and logs `already_shutting_down` for nothing.
process.removeAllListeners('SIGINT');
process.removeAllListeners('SIGTERM');
const shutdown = (signal) => {
  if (closing) return;
  closing = true;
  process.stderr.write(`region server shutting down on ${signal}\n`);
  const guard = setTimeout(() => process.exit(1), 10_000);
  guard.unref();
  void server
    .gracefullyShutdown(false)
    .then(() => new Promise((closed) => httpServer.close(() => closed())))
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
