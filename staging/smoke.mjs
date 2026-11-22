#!/usr/bin/env node
/**
 * UDG staging server-local CLI smoke test (staging integration file).
 *
 * What it proves, using ONLY the pinned packages that ship inside this archive:
 *
 *  1. real handshake — `new Client(endpoint)` + `joinOrCreate('region', presentation)` with the
 *     exact `{ protocolVersion, configHash, manifestHash }` triple recomputed HERE from the shipped
 *     configuration document via the same `@udg/config` the server validates against. The server's
 *     join gate (`screenJoin`) is authority: a mismatched triple is refused, and the smoke FAILS.
 *  2. server authority — after join, `state.protocolVersion/configHash/manifestHash` must equal the
 *     recomputed triple; the seat's own replica row must appear with a server-ISSUED epoch; and a
 *     single bounded direct-input frame sent through the pinned SDK input handle must be resolved
 *     by the SERVER (`inputResolvedThrough >= 1` on our own row) — an observed server disposition,
 *     not a client-side claim.
 *  3. tick continuity + cadence — `state.serverTick` sampled on every patch over a bounded window:
 *     strictly monotonic, and total advance within tolerance of the configured `network.tickRate`.
 *  4. counts and latencies — join latency, first-patch latency, epoch-issued latency, input-ack
 *     latency, `room.ping()` RTT samples, patch deliveries, observed tick rate.
 *  5. cleanup — consented `leave()`, then a SECOND short-lived client joins the same room by id,
 *     reads a live serverTick and leaves: the room and server survive the first seat's teardown.
 *
 * Bounded and safe by construction: loopback endpoint only (refuses anything else — this tool must
 * never dial outward); every wait has a deadline; sample counts and the window are clamped; no
 * process management of any kind (it never kills, signals, or scans processes — the caller owns
 * the server process); observation only — a JSON summary on stdout, progress on stderr, no files
 * written, no admin/debug endpoint touched.
 *
 * Usage:  node staging/smoke.mjs [--url ws://127.0.0.1:18673] [--window-ms 6000] [--pings 4]
 *                                 [--config <path>] [--json]
 * Exit:   0 all checks passed · 1 a check failed · 3 could not run as stated (unreachable/refused)
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---- pinned imports (resolved from the archive's own node_modules) ----------------------------
const { Client } = await import('@colyseus/sdk');
const { validateServerConfig, computeConfigHash, regionHash } = await import('@udg/config');

// ---- CLI (bounded) -----------------------------------------------------------------------------
const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] !== undefined ? process.argv[at + 1] : fallback;
};
const clampInt = (text, fallback, min, max) => {
  const value = Number(text);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
};

const url = arg('url', process.env['UDG_SMOKE_URL'] ?? 'ws://127.0.0.1:18673');
const windowMs = clampInt(arg('window-ms', '6000'), 6_000, 1_000, 60_000);
const pingCount = clampInt(arg('pings', '4'), 4, 0, 10);
const configPath = resolve(arg('config', process.env['UDG_ROOM_CONFIG'] ?? resolve(ROOT, 'staging', 'config', 'region-config.json')));
const compact = process.argv.includes('--json');

const log = (line) => process.stderr.write(`[smoke] ${line}\n`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const until = async (predicate, ms) => {
  const deadline = performance.now() + ms;
  for (;;) {
    if (predicate()) return true;
    if (performance.now() >= deadline) return false;
    await sleep(25);
  }
};

// Loopback-only guard: the smoke test must never become external contact.
let endpoint;
try {
  endpoint = new URL(url);
} catch {
  log(`refusing: --url is not a URL (${url})`);
  process.exit(3);
}
if (endpoint.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '::1'].includes(endpoint.hostname)) {
  log(`refusing: staging smoke is loopback-only, got ${endpoint.protocol}//${endpoint.hostname}`);
  process.exit(3);
}
const httpEndpoint = `http://${endpoint.host}`;

// ---- presentation recomputed locally; the SERVER decides whether it matches --------------------
let document;
try {
  document = JSON.parse(readFileSync(configPath, 'utf8'));
} catch (error) {
  log(`refusing: configuration document unreadable (${configPath}): ${String(error)}`);
  process.exit(3);
}
const validated = validateServerConfig(document); // the same validator the server boots through
if (validated.ok === false) {
  log(`refusing: configuration document invalid: ${validated.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  process.exit(3);
}
const live = validated.value;
if (live.region.bounds === null) {
  log('refusing: configuration document carries no region bounds (the server would refuse it too)');
  process.exit(3);
}
const presentation = Object.freeze({
  protocolVersion: live.protocolVersion,
  configHash: computeConfigHash(live),
  manifestHash: regionHash(live),
});
const tickRate = live.network.tickRate;

// ---- result plumbing ----------------------------------------------------------------------------
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`);
};
const timings = {};
let room = null;
let roomIdForCleanup = null;
const extraRooms = [];

const finish = (runCode) => {
  const allOk = checks.every((c) => c.ok);
  const result = {
    kind: 'udg-staging-smoke',
    ok: allOk && runCode === 0,
    endpoint: `${endpoint.protocol}//${endpoint.hostname}:${endpoint.port}`,
    protocolVersion: presentation.protocolVersion,
    configHash: presentation.configHash,
    manifestHash: presentation.manifestHash,
    declared: { tickRateHz: tickRate, windowMs, pingCount },
    checks,
    measurements: timings,
  };
  process.stdout.write(`${JSON.stringify(result, null, compact ? 0 : 2)}\n`);
  process.exit(allOk && runCode === 0 ? 0 : 1);
};

const main = async () => {
  // ---- 1. join (real handshake) -------------------------------------------------------------------
  const client = new Client(httpEndpoint);
  const joinStart = performance.now();
  try {
    const joinPromise = client.joinOrCreate('region', presentation);
    const raced = await Promise.race([joinPromise, sleep(10_000).then(() => 'TIMEOUT')]);
    if (raced === 'TIMEOUT') throw new Error('joinOrCreate deadline 10000 ms');
    room = raced;
    timings.joinLatencyMs = Math.round((performance.now() - joinStart) * 100) / 100;
    roomIdForCleanup = room.roomId;
    check('join-accepted', true, `room ${room.roomId} session issued in ${String(timings.joinLatencyMs)} ms`);
  } catch (error) {
    check('join-accepted', false, `joinOrCreate refused/failed: ${String(error)}`);
    finish(1);
    return;
  }

  // ---- 2. state observation ------------------------------------------------------------------------
  const samples = [];
  let firstStateAt = null;
  room.onStateChange((state) => {
    const at = performance.now();
    if (firstStateAt === null) firstStateAt = at;
    samples.push({ at, serverTick: Number(state.serverTick ?? 0) });
  });

  const haveState = await until(() => Number(room.state?.serverTick ?? NaN) >= 0 && typeof room.state?.configHash === 'string', 8_000);
  const served = {
    protocolVersion: String(room.state?.protocolVersion ?? ''),
    configHash: String(room.state?.configHash ?? ''),
    manifestHash: String(room.state?.manifestHash ?? ''),
  };
  check(
    'server-authority-triple',
    haveState &&
      served.protocolVersion === presentation.protocolVersion &&
      served.configHash === presentation.configHash &&
      served.manifestHash === presentation.manifestHash,
    `served ${JSON.stringify(served)}`,
  );

  await until(() => firstStateAt !== null, 8_000);
  timings.firstPatchLatencyMs = firstStateAt === null ? null : Math.round((firstStateAt - joinStart) * 100) / 100;
  check('first-patch-received', timings.firstPatchLatencyMs !== null, `first patch at ${String(timings.firstPatchLatencyMs)} ms after join start`);

  // Own row + server-issued epoch (entityId is the sessionId, per MovementAuthorityAdapter).
  const ownRow = () => {
    const players = room.state?.players;
    if (players === undefined) return undefined;
    const direct = players.get?.(room.sessionId.slice(0, 64));
    if (direct !== undefined) return direct;
    let found;
    players.forEach((row) => {
      if (found === undefined && Number(row.sessionEpoch ?? 0) > 0) found = row;
    });
    return found;
  };
  const haveEpoch = await until(() => Number(ownRow()?.sessionEpoch ?? 0) > 0, 10_000);
  const epoch = Number(ownRow()?.sessionEpoch ?? 0);
  timings.epochIssuedLatencyMs = haveEpoch ? Math.round((performance.now() - joinStart) * 100) / 100 : null;
  check('epoch-issued', haveEpoch, `server-issued sessionEpoch ${String(epoch)}`);

  // ---- 3. one bounded direct-input frame; the SERVER resolves it -----------------------------------
  if (haveEpoch) {
    try {
      const handle = room.input();
      handle.data.sessionEpoch = epoch;
      handle.data.generation = 1;
      handle.data.directIntent = true;
      handle.data.moveX = 0.1;
      handle.data.moveZ = 0;
      handle.data.seq = 1;
      const sentSeq = handle.send();
      timings.inputFramesSent = 1;
      const ackStart = performance.now();
      const acked = await until(() => Number(ownRow()?.inputResolvedThrough ?? 0) >= sentSeq, 8_000);
      timings.inputAckLatencyMs = Math.round((performance.now() - ackStart) * 100) / 100;
      const resolved = Number(ownRow()?.inputResolvedThrough ?? 0);
      check('server-resolved-input', acked, `inputResolvedThrough ${String(resolved)} for sent seq ${String(sentSeq)} after ${String(timings.inputAckLatencyMs)} ms`);
    } catch (error) {
      check('server-resolved-input', false, `input channel failed: ${String(error)}`);
    }
  } else {
    check('server-resolved-input', false, 'no epoch — input channel not attempted');
  }

  // ---- 4. RTT samples (bounded) ---------------------------------------------------------------------
  const pings = [];
  for (let i = 0; i < pingCount; i += 1) {
    const before = performance.now();
    const replied = await Promise.race([new Promise((done) => room.ping(() => done(true))), sleep(2_000).then(() => false)]);
    if (!replied) break;
    pings.push(Math.round((performance.now() - before) * 100) / 100);
    await sleep(50);
  }
  timings.pingRttMs = pings;
  check('ping-samples', pingCount === 0 ? true : pings.length >= 1, `${String(pings.length)} of ${String(pingCount)} ping replies`);

  // ---- 5. tick continuity + cadence over the window ---------------------------------------------------
  await sleep(50);
  const windowStart = performance.now();
  await sleep(windowMs);
  const elapsedMs = performance.now() - windowStart;
  const inWindow = samples.filter((s) => s.at >= windowStart - 1);
  const seq = inWindow.map((s) => s.serverTick);
  const firstTick = seq[0] ?? Number(room.state?.serverTick ?? 0);
  const lastTick = seq.at(-1) ?? Number(room.state?.serverTick ?? firstTick);
  const advance = lastTick - firstTick;
  const regressions = seq.filter((value, i) => i > 0 && value < seq[i - 1]).length;
  const maxPatchDelta = seq.reduce((max, value, i) => (i === 0 ? max : Math.max(max, value - seq[i - 1])), 0);
  const observedHz = (advance / elapsedMs) * 1_000;
  timings.tickWindow = {
    windowMs: Math.round(elapsedMs),
    patchDeliveriesInWindow: inWindow.length,
    patchDeliveriesTotal: samples.length,
    serverTickFrom: firstTick,
    serverTickTo: lastTick,
    ticksObserved: advance,
    observedTickRateHz: Math.round(observedHz * 100) / 100,
    regressions,
    maxPatchDelta,
  };
  check('tick-monotonic', regressions === 0, `${String(advance)} ticks ${String(firstTick)}→${String(lastTick)}, regressions ${String(regressions)}, max per-patch delta ${String(maxPatchDelta)}`);
  const drift = Math.abs(observedHz - tickRate) / tickRate;
  check('tick-cadence', drift <= 0.15, `observed ${observedHz.toFixed(2)} Hz vs declared ${String(tickRate)} Hz (drift ${(drift * 100).toFixed(1)}%, tolerance 15%)`);

  // ---- 6. leave + survivor proof (second short-lived seat) -------------------------------------------
  try {
    const leaveRace = await Promise.race([room.leave(true), sleep(5_000).then(() => 'TIMEOUT')]);
    if (leaveRace === 'TIMEOUT') throw new Error('leave deadline 5000 ms');
    check('seat-left', true, `consented leave code ${String(leaveRace)}`);
  } catch (error) {
    check('seat-left', false, `leave failed: ${String(error)}`);
  }
  room = null;

  try {
    const client2 = new Client(httpEndpoint);
    const joinRace = await Promise.race([client2.joinById(roomIdForCleanup, presentation), sleep(10_000).then(() => 'TIMEOUT')]);
    if (joinRace === 'TIMEOUT') throw new Error('survivor join deadline 10000 ms');
    const seat2 = joinRace;
    extraRooms.push(seat2);
    const sawLive = await until(() => Number(seat2.state?.serverTick ?? 0) > 0, 8_000);
    const haveEpoch2 = await until(() => Number(seat2.state?.players?.get?.(seat2.sessionId.slice(0, 64))?.sessionEpoch ?? 0) > 0, 8_000);
    const row2Epoch = Number(seat2.state?.players?.get?.(seat2.sessionId.slice(0, 64))?.sessionEpoch ?? 0);
    check('server-survives-cleanup', sawLive && haveEpoch2, `second seat sees serverTick ${String(seat2.state?.serverTick ?? 0)} epoch ${String(row2Epoch)}`);
    await Promise.race([seat2.leave(true), sleep(5_000).then(() => undefined)]);
    extraRooms.length = 0;
  } catch (error) {
    check('server-survives-cleanup', false, `second join failed: ${String(error)}`);
  }

  finish(0);
};

const bail = async (error) => {
  log(`run could not complete: ${String(error)}`);
  checks.push({ name: 'run-completed', ok: false, detail: String(error) });
  finish(3);
};

main().catch((error) => void bail(error));
