/**
 * UDG-SPIKE-001 — paired browser-seat netcode smoke (assignment §5 slice: pinned public SDK browser
 * import/API and the paired-client check).
 *
 * ## What this suite proves, in one sentence
 *
 * Two real Chromium **contexts** join the same pinned region room through the client modules under
 * `apps/client/src/network/**` — compiled by the client's own pipeline (the Vite dev server serves the
 * same TypeScript the accepted client build typechecks), importing the published `@colyseus/sdk` 0.18.9
 * exactly as documented — and **each seat observes the *other* seat's authoritative movement**, with the
 * server-issued epoch, monotonic authority ticks, the adopted speed ceiling held in the two forms a browser
 * can actually observe (an ack-budget bound and a tick-span **average** — not a per-tick maximum, which the
 * Gate A authoritative trace owns), and no credential retained anywhere in either context.
 *
 * ## What it does not prove
 *
 * **Gate A is Not Run.** This is the §5 smoke, not the acceptance matrix: no profiles, no seeds, no
 * impairment, no forced corrections, no p95 correction claim, no P06 freeze, and nothing about GA-10a/
 * GA-10b (outstanding, UDG-007) or the 20-client workload. Loopback only; the room is the accepted pinned
 * one and no schema, precision or policy moves for this run. A separate claim lives in
 * `docs/integration/colyseus-0.18-api-map.md` §12: the SDK's *declarations* carry three defects the client
 * project does not check inside (ADR-0004), while the *runtime* path exercised here works.
 *
 * ## How it is reached, and how it is not
 *
 * `pnpm test:e2e -- --suite netcode` is the only route, through `tools/checks/src/dispatch.ts`, which still
 * refuses every other unowned suite. The Vite dev server is started by `playwright.config.ts` (unchanged
 * from UDG-004: `workers: 1`, `retries: 0`, chromium-only); this file starts the **room** itself, on the
 * accepted test-only harness boot, on an ephemeral loopback port so the camera client's own development
 * socket (which points at 2567) never joins this room and never becomes a third seat.
 *
 * ## Why the page code is the client modules and not a copy
 *
 * Slice 1 ran the same exchange against the published IIFE bundle from a scratch page. This suite retires
 * that shortcut on purpose: the browser dynamic-imports `ColyseusPredictionAdapter.ts` and
 * `RemotePresentation.ts` from the dev server, so what runs in Chromium is the typed ESM the compiler
 * checked. The peer assertion is deliberately independent of the mover: seat A's movement is judged by
 * seat B's `RemotePresentation` track, and the other way round, so a seat that only ever saw itself
 * cannot pass.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium, expect, test, type Browser, type Page } from '@playwright/test';

import { startHarnessServer } from '../support/client-harness/transport.mjs';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const OUT_DIR = process.env['UDG_SPIKE_OUT'] ?? join('artifacts', '.local', 'spike-001');
const RESULTS_FILE = join(OUT_DIR, 'netcode-smoke-results.json');
const CLIENT_ORIGIN = process.env['UDG_CLIENT_URL'] ?? 'http://127.0.0.1:5173';
const ROOM_NAME = 'region';

const TASK_ID = 'UDG-SPIKE-001';
const RESULTS_SCHEMA_VERSION = 1;

/** The adopted P10 per-step ceiling for direct movement, and the room's own movement speed. */
const SPEED_LIMIT_PER_STEP_METRES = 0.2;
const FLOAT_TOLERANCE_METRES = 0.000001;

/** The region bounds this smoke runs the room with, and why: a 100 m square keeps a 10-step run unobstructed. */
const REGION_BOUNDS = { x: { min: -50, max: 50 }, y: { min: -5, max: 20 }, z: { min: -50, max: 50 } };

/** The movement the two seats perform: five consumed frames each, one axis at a time. */
const FRAMES_PER_PHASE = 5;

// --------------------------------------------------------------------------- page-side types

/** The shape the two client modules install on the page, per seat. */
interface PageSeatObservation {
  readonly key: string;
  readonly entityId: string;
  readonly sessionEpoch: number;
  readonly lastAuthorityTick: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly movementMode: number;
  readonly movementModeName: string;
  readonly connected: boolean;
}

interface PageSeatSnapshot {
  readonly serverTick: number;
  readonly deliveries: number;
  readonly self: PageSeatObservation | null;
  readonly peers: readonly PageSeatObservation[];
  readonly issues: readonly string[];
}

interface PagePeerTrack {
  readonly sessionId: string;
  readonly epochs: readonly number[];
  readonly epoch: number;
  readonly samples: readonly { readonly tick: number; readonly x: number; readonly z: number; readonly movementMode: number }[];
  readonly firstSample: { readonly tick: number; readonly x: number; readonly z: number };
  readonly lastSample: { readonly tick: number; readonly x: number; readonly z: number };
  readonly delta: { readonly x: number; readonly z: number };
  readonly distinctTicks: number;
  readonly tickRegressions: number;
  readonly duplicateSamples: number;
  readonly epochChanges: number;
  readonly absences: number;
  readonly identityMismatches: number;
}

interface PageSeatHandle {
  readonly roomId: string;
  readonly sessionId: string;
  epoch(): number | null;
  advertised(): { tickRate: number | undefined; stepMs: number | undefined; patchRate: number | undefined };
  sendDirect(request: { generation: number; moveX: number; moveZ: number }): { seq: number };
  sendNeutral(generation: number): { seq: number };
  snapshot(): PageSeatSnapshot;
  deliveries(): number;
  acknowledged(): number;
  sentCount(): number;
  close(): Promise<void>;
}

interface PageRemotePresentation {
  observe(snapshot: PageSeatSnapshot): void;
  peers(): readonly string[];
  trackOf(sessionId: string): PagePeerTrack | undefined;
  issues(): readonly string[];
  observations(): number;
}

/** The window global one evaluate call installs, and the next ones read back. */
interface SeatWindow {
  __udgSpikeSeat?: {
    readonly seat: PageSeatHandle;
    readonly presentation: PageRemotePresentation;
    foldTimer: ReturnType<typeof setInterval> | null;
  };
}


// --------------------------------------------------------------------------- run record

interface CheckRecord {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const checks: CheckRecord[] = [];
const limitations: string[] = [];
const observations: Record<string, unknown> = {};

const check = (name: string, ok: boolean, detail: unknown): void => {
  checks.push({ name, ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
};

const headSha = (): string => spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();

/** Horizontal distance between two consecutive published samples. */
const workingTreeDirty = (): boolean => spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim() !== '';

// --------------------------------------------------------------------------- fixture

interface Fixture {
  readonly endpoint: string;
  readonly presentation: { protocolVersion: string; configHash: string; manifestHash: string };
  readonly movementSpeed: number;
  readonly tickRate: number;
  close(): Promise<void>;
}

let fixture: Fixture | undefined;
let browser: Browser | undefined;

test.beforeAll(async () => {
  // The room module is the accepted pinned one; the harness boots it exactly as the UDG-003 suites do.
  const build = spawnSync('pnpm', ['--filter', '@udg/server', 'build'], { cwd: ROOT, encoding: 'utf8' });
  expect(build.status, `apps/server build failed: ${build.stderr}`).toBe(0);

  const config = (await import('../../packages/config/dist/index.js')) as {
    DEFAULT_SERVER_CONFIG: object;
    withConfigOverrides(base: object, overrides: unknown): object;
    computeConfigHash(config: object): string;
    regionHash(config: object): string;
    MOVEMENT_DEFAULTS: { speed: number };
    NETWORK_DEFAULTS: { tickRate: number };
  };
  const overrides = { region: { bounds: REGION_BOUNDS } };
  const live = config.withConfigOverrides(config.DEFAULT_SERVER_CONFIG, overrides);
  const presentation = {
    protocolVersion: (live as { protocolVersion: string }).protocolVersion,
    configHash: config.computeConfigHash(live),
    manifestHash: config.regionHash(live),
  };

  const roomModulePath = join(ROOT, 'apps', 'server', 'dist', 'rooms', 'RegionRoom.js');
  expect(existsSync(roomModulePath), `the pinned room module ${roomModulePath}`).toBe(true);
  const roomModule = (await import(pathToFileURL(roomModulePath).href)) as {
    defineOperatorRegionRoom: (options: { config?: unknown }) => unknown;
  };

  // The harness loads the pinned packages the way `apps/server` sees them, and binds nothing by hand.
  const rooms = { [ROOM_NAME]: roomModule.defineOperatorRegionRoom({ config: overrides }) };
  const server = await startHarnessServer(ROOT, rooms as never);

  fixture = {
    endpoint: server.endpoint,
    presentation,
    movementSpeed: config.MOVEMENT_DEFAULTS.speed,
    tickRate: config.NETWORK_DEFAULTS.tickRate,
    close: () => server.close(),
  };

  observations['server'] = {
    endpoint: server.endpoint,
    presentation,
    movementSpeed: config.MOVEMENT_DEFAULTS.speed,
    tickRate: config.NETWORK_DEFAULTS.tickRate,
    bounds: REGION_BOUNDS,
  };

  browser = await chromium.launch({ headless: true });
  observations['browser'] = { chromium: browser.version(), headless: true };
});

test.afterAll(async () => {
  await browser?.close();
  await fixture?.close();

  const results = {
    schemaVersion: RESULTS_SCHEMA_VERSION,
    taskId: TASK_ID,
    runId: process.env['UDG_RUN_ID'] ?? `local-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    implementationSha: headSha(),
    workingTreeDirty: workingTreeDirty(),
    gate: { gateA: 'Not Run — this is the assignment §5 smoke, not the acceptance matrix' },
    environment: {
      node: process.version,
      sdkDeclaredVersion: (JSON.parse(
        readFileSync(join(ROOT, 'apps', 'client', 'node_modules', '@colyseus', 'sdk', 'package.json'), 'utf8'),
      ) as { version: string }).version,
      clientPipeline: `Vite dev server at ${CLIENT_ORIGIN}, serving apps/client/src/network/*.ts`,
      ...observations,
    },
    checks,
    limitations,
    verdict: checks.every((record) => record.ok) ? 'pass' : 'fail',
  };
  mkdirSync(dirname(RESULTS_FILE), { recursive: true });
  writeFileSync(RESULTS_FILE, `${JSON.stringify(results, null, 2)}\n`);
});

// --------------------------------------------------------------------------- helpers

/** Page errors collected per seat label, asserted at the end of the run. */
const pageErrorSinks = new Map<string, string[]>();

/** Open a context and load the client pipeline's own module graph, without pretending to be the camera app. */
const openSeatPage = async (label: string): Promise<Page> => {
  const context = await browser?.newContext();
  expect(context, 'a browser context must open').toBeDefined();
  const page = await context?.newPage();
  expect(page, 'a page must open in the context').toBeDefined();
  const pageErrors: string[] = [];
  pageErrorSinks.set(label, pageErrors);
  page?.on('pageerror', (error) => pageErrors.push(String(error)));
  page?.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // The camera client's development socket is expected to fail: no room listens on 2567 here, and
    // UDG-004's contract requires that refusal to be a rendered state rather than a crash. Same rule as
    // the camera suite's own expected-console list.
    if (/ws:\/\/127\.0\.0\.1:2567|WebSocket is closed|Failed to construct 'WebSocket'/.test(text)) return;
    pageErrors.push(`console: ${text}`);
  });
  await page?.goto(`${CLIENT_ORIGIN}/`, { waitUntil: 'load' });
  await primeClientModules(page as Page, label);
  return page as Page;
};

/**
 * Load the two client modules once, before any seat logic runs.
 *
 * The SDK is not part of the camera app's import graph, so Vite's dependency optimiser discovers it here for
 * the first time and reloads the page when it rewrites the pre-bundle. That is a real property of the client
 * pipeline, not a defect in it, and the honest handling is to reload and retry a bounded number of times
 * rather than to pre-seed the app's graph for it (which would change UDG-004's Vite config for a spike).
 * A page that still cannot load the modules after three attempts fails the suite instead of limping on.
 */
const primeClientModules = async (page: Page, label: string): Promise<void> => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const loaded = await page.evaluate(async (urls) => {
      try {
        const adapter = await import(/* @vite-ignore */ urls.adapterUrl);
        const remote = await import(/* @vite-ignore */ urls.remoteUrl);
        return adapter !== undefined && remote !== undefined;
      } catch {
        return false;
      }
    }, { adapterUrl: ADAPTER_URL, remoteUrl: REMOTE_URL });
    observations[`modulePriming:${label}`] = { attempt, loaded };
    if (loaded) return;
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
  }
  throw new Error(`the client pipeline never served ${ADAPTER_URL} to seat ${label} in three attempts`);
};

interface SeatSetup {
  readonly ok: boolean;
  readonly roomId?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly epoch?: number | null | undefined;
  readonly advertised?: { readonly tickRate: number | undefined; readonly stepMs: number | undefined; readonly patchRate: number | undefined } | undefined;
  readonly error?: string | undefined;
}

/**
 * The two client modules, addressed the way the browser addresses them: as URLs on the client pipeline.
 *
 * The specifier is a variable, not a literal, on purpose. A literal would ask the spec's own `tsc` project to
 * resolve a browser URL, which it cannot (and must not) do; the runtime answer is Vite's. The shapes the page
 * then hands back are the `Page*` interfaces above, checked field by field against what the modules publish.
 */
const ADAPTER_URL = '/src/network/ColyseusPredictionAdapter.ts';
const REMOTE_URL = '/src/network/RemotePresentation.ts';

/** Join the seat inside the page, over the client modules the pipeline serves. */
const joinSeat = async (
  page: Page,
  target: { mode: 'create'; roomName: string } | { mode: 'byId'; roomId: string },
): Promise<SeatSetup> =>
  page.evaluate(async (args) => {
    const adapter = (await import(/* @vite-ignore */ args.adapterUrl)) as {
      joinPredictionSeat(options: unknown): Promise<PageSeatHandle>;
    };
    const remote = (await import(/* @vite-ignore */ args.remoteUrl)) as {
      createRemotePresentation(): PageRemotePresentation;
    };
    try {
      const seat = await adapter.joinPredictionSeat({
        endpoint: args.endpoint,
        join: args.join,
        presentation: args.presentation,
        epochTimeoutMs: 15_000,
      });
      const presentation = remote.createRemotePresentation();
      presentation.observe(seat.snapshot());
      // A presentation cadence of its own: the peer track advances on frames, not on the deliveries, so
      // "the observer never authored a movement" is a statement about a loop that only reads.
      const foldTimer = setInterval(() => presentation.observe(seat.snapshot()), 16);
      (globalThis as unknown as SeatWindow).__udgSpikeSeat = { seat, presentation, foldTimer };
      return {
        ok: true,
        roomId: seat.roomId,
        sessionId: seat.sessionId,
        epoch: seat.epoch(),
        advertised: seat.advertised(),
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }, {
    endpoint: fixture?.endpoint ?? '',
    join: target,
    presentation: fixture?.presentation ?? {},
    adapterUrl: ADAPTER_URL,
    remoteUrl: REMOTE_URL,
  });

/** Send `frames` direct frames on one axis, and report the movement mode the authority published mid-run. */
const moveOnAxis = async (
  page: Page,
  axis: 'x' | 'z',
  frames: number,
): Promise<{ readonly sent: number; readonly modeDuringMovement: string | null }> => {
  const result = await page.evaluate(
    async (args) => {
      const holder = (globalThis as unknown as SeatWindow).__udgSpikeSeat;
      if (holder === undefined) throw new Error('the seat is not joined');
      for (let index = 0; index < args.frames; index += 1) {
        holder.seat.sendDirect({
          generation: holder.seat.sentCount() + 1,
          moveX: args.axis === 'x' ? 1 : 0,
          moveZ: args.axis === 'z' ? 1 : 0,
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      // Read the mode the authority published for this seat while its frames were landing. A seat the
      // authority put in `path` or left `idle` would be a different experiment, and the spike says which.
      const mode = holder.seat.snapshot().self?.movementModeName ?? null;
      return { sent: args.frames, modeDuringMovement: mode };
    },
    { axis, frames },
  );
  await page.waitForTimeout(400);
  return result;
};

/** One neutral keepalive frame: it must consume an input and move nothing. */
const sendIdleFrame = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const holder = (globalThis as unknown as SeatWindow).__udgSpikeSeat;
    if (holder === undefined) throw new Error('the seat is not joined');
    holder.seat.sendNeutral(holder.seat.sentCount() + 1);
  });
  await page.waitForTimeout(300);
};

/** Read one seat's own view plus its peer tracks, for the assertions below. */
interface SeatReport {
  readonly sessionId: string;
  readonly epoch: number | null;
  readonly self: PageSeatObservation | null;
  readonly snapshotIssues: readonly string[];
  readonly deliveries: number;
  readonly sentCount: number;
  readonly acknowledged: number;
  readonly peers: readonly string[];
  readonly tracks: readonly PagePeerTrack[];
  readonly presentationIssues: readonly string[];
  readonly storage: { readonly local: number; readonly session: number };
}

const reportSeat = async (page: Page): Promise<SeatReport> =>
  page.evaluate(() => {
    const holder = (globalThis as unknown as SeatWindow).__udgSpikeSeat;
    if (holder === undefined) throw new Error('the seat is not joined');
    holder.presentation.observe(holder.seat.snapshot());
    const snapshot = holder.seat.snapshot();
    return {
      sessionId: holder.seat.sessionId,
      epoch: holder.seat.epoch(),
      self: snapshot.self,
      snapshotIssues: snapshot.issues,
      deliveries: holder.seat.deliveries(),
      sentCount: holder.seat.sentCount(),
      acknowledged: holder.seat.acknowledged(),
      peers: holder.presentation.peers(),
      tracks: holder.presentation.peers()
        .map((peer) => holder.presentation.trackOf(peer))
        .filter((track): track is PagePeerTrack => track !== undefined),
      presentationIssues: holder.presentation.issues(),
      storage: { local: localStorage.length, session: sessionStorage.length },
    };
  });

const closeSeat = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    const holder = (globalThis as unknown as SeatWindow).__udgSpikeSeat;
    if (holder === undefined) return;
    if (holder.foldTimer !== null) clearInterval(holder.foldTimer);
    await holder.seat.close();
  });
};

// --------------------------------------------------------------------------- the smoke

test('two browser seats over the client pipeline each observe the other seat\'s authoritative movement', async () => {
  expect(fixture, 'the room fixture booted').toBeDefined();
  const movementSpeed = fixture?.movementSpeed ?? 0;
  const tickRate = fixture?.tickRate ?? 0;
  const stepSeconds = 1 / tickRate;
  const perStepMetres = movementSpeed * stepSeconds;
  check('fixture: room movement speed and fixed rate are the configured pair', Math.abs(perStepMetres - SPEED_LIMIT_PER_STEP_METRES) < 0.0000001, {
    movementSpeed,
    tickRate,
    perStepMetres,
  });

  const pageA = await openSeatPage('A');
  const setupA = await joinSeat(pageA, { mode: 'create', roomName: ROOM_NAME });
  check('seat A: joined the region room through the client module', setupA.ok === true && typeof setupA.sessionId === 'string', setupA);
  check('seat A: the replica row carried a server-issued epoch', typeof setupA.epoch === 'number' && setupA.epoch >= 1, setupA.epoch);
  check('seat A: the room advertised its fixed step', setupA.advertised?.tickRate === tickRate, setupA.advertised);

  const roomId = setupA.roomId ?? '';
  const pageB = await openSeatPage('B');
  const setupB = await joinSeat(pageB, { mode: 'byId', roomId });
  check('seat B: joined the same room by id through the client module', setupB.ok === true && setupB.roomId === roomId, setupB);
  check('seat A and seat B hold distinct session ids', setupA.sessionId !== setupB.sessionId, [setupA.sessionId, setupB.sessionId]);
  check('seat A and seat B hold distinct server-issued epochs', setupA.epoch !== setupB.epoch, [setupA.epoch, setupB.epoch]);

  observations['seats'] = { A: setupA, B: setupB, roomId };

  // ---- phase 1: A moves on +z while B observes. The assertion is B's, not A's.
  const beforeA = await reportSeat(pageA);
  const beforeB = await reportSeat(pageB);
  const moveA = await moveOnAxis(pageA, 'z', FRAMES_PER_PHASE);
  const afterB = await reportSeat(pageB);
  const afterA = await reportSeat(pageA);

  const trackOfAOnB = afterB.tracks.find((track) => track.sessionId === (setupA.sessionId as string));
  check('seat B observed a track for seat A at all', trackOfAOnB !== undefined, afterB.tracks.map((track) => track.sessionId));
  check('seat B saw seat A\'s authority ticks advance', (trackOfAOnB?.distinctTicks ?? 0) > (beforeB.tracks.find((t) => t.sessionId === setupA.sessionId)?.distinctTicks ?? 0), {
    before: beforeB.tracks.find((t) => t.sessionId === setupA.sessionId)?.distinctTicks,
    after: trackOfAOnB?.distinctTicks,
  });
  check('seat B saw seat A move on +z and nowhere else', (trackOfAOnB?.delta.z ?? 0) > 0 && Math.abs(trackOfAOnB?.delta.x ?? 1) < FLOAT_TOLERANCE_METRES, trackOfAOnB?.delta);
  check(
    'seat B\'s view of seat A equals seat A\'s own authoritative row (both read the authority, neither authored it)',
    (trackOfAOnB?.lastSample.z ?? NaN) === (afterA.self?.z ?? NaN) && (trackOfAOnB?.lastSample.x ?? NaN) === (afterA.self?.x ?? NaN),
    { fromB: trackOfAOnB?.lastSample, fromA: afterA.self },
  );
  check('seat B observed seat A under seat A\'s issued epoch', trackOfAOnB?.epoch === setupA.epoch, { observed: trackOfAOnB?.epoch, issued: setupA.epoch });
  check('seat B saw no tick regression and no epoch change for seat A', (trackOfAOnB?.tickRegressions ?? 1) === 0 && (trackOfAOnB?.epochChanges ?? 1) === 0, trackOfAOnB);
  const acksForA = afterA.acknowledged - beforeA.acknowledged;
  const phase1Expected = moveA.sent * perStepMetres;
  check('the authority acknowledged every frame seat A sent', acksForA >= moveA.sent, { ackedBefore: beforeA.acknowledged, ackedAfter: afterA.acknowledged, sent: moveA.sent });
  check(
    `seat B saw seat A cover exactly the distance the authority owes for those frames (${String(moveA.sent)} frames at ${String(movementSpeed)} m/s over a ${String(stepSeconds * 1000)} ms step)`,
    Math.abs((trackOfAOnB?.delta.z ?? Number.NaN) - phase1Expected) <= FLOAT_TOLERANCE_METRES,
    { observed: trackOfAOnB?.delta.z, expected: phase1Expected, framesSent: moveA.sent, acksAdvanced: acksForA },
  );
  check('seat B did not move while it sent nothing', (afterB.self?.z ?? NaN) === (beforeB.self?.z ?? NaN) && (afterB.self?.x ?? NaN) === (beforeB.self?.x ?? NaN), {
    before: beforeB.self,
    after: afterB.self,
  });
  check('seat A\'s own row moved too, which is the authority moving it and not the page', (afterA.self?.z ?? 0) > (beforeA.self?.z ?? 0), afterA.self);

  // A neutral keepalive consumes an input and must move nothing, on either seat's view of the mover.
  const beforeIdle = await reportSeat(pageA);
  await sendIdleFrame(pageA);
  const afterIdleA = await reportSeat(pageA);
  const afterIdleB = await reportSeat(pageB);
  const idleTrackOfA = afterIdleB.tracks.find((track) => track.sessionId === (setupA.sessionId as string));
  check(
    'a neutral frame consumed input without moving the seat, on both views',
    (afterIdleA.self?.z ?? NaN) === (beforeIdle.self?.z ?? NaN) && (idleTrackOfA?.lastSample.z ?? NaN) === (afterIdleA.self?.z ?? NaN),
    { mover: afterIdleA.self, observer: idleTrackOfA?.lastSample, acked: afterIdleA.acknowledged - beforeIdle.acknowledged },
  );

  // ---- phase 2: B moves on +x while A observes. The mirror image, so neither seat passes on its own view.
  const beforeB2 = await reportSeat(pageB);
  const moveB = await moveOnAxis(pageB, 'x', FRAMES_PER_PHASE);
  const afterA2 = await reportSeat(pageA);
  const afterB2 = await reportSeat(pageB);
  const acksForB = afterB2.acknowledged - beforeB2.acknowledged;
  const phase2Expected = moveB.sent * perStepMetres;
  check('seat B did not move on z, and moved on x', (afterB2.self?.x ?? 0) > (beforeB2.self?.x ?? 0) && (afterB2.self?.z ?? NaN) === (beforeB2.self?.z ?? NaN), {
    before: beforeB2.self,
    after: afterB2.self,
  });

  const trackOfBOnA = afterA2.tracks.find((track) => track.sessionId === (setupB.sessionId as string));
  check('seat A observed a track for seat B at all', trackOfBOnA !== undefined, afterA2.tracks.map((track) => track.sessionId));
  check('seat A saw seat B move on +x and nowhere else', (trackOfBOnA?.delta.x ?? 0) > 0 && Math.abs(trackOfBOnA?.delta.z ?? 1) < FLOAT_TOLERANCE_METRES, trackOfBOnA?.delta);
  check(
    'seat A\'s view of seat B equals seat B\'s own authoritative row',
    (trackOfBOnA?.lastSample.x ?? NaN) === (afterB2.self?.x ?? NaN) && (trackOfBOnA?.lastSample.z ?? NaN) === (afterB2.self?.z ?? NaN),
    { fromA: trackOfBOnA?.lastSample, fromB: afterB2.self },
  );
  check('seat A observed seat B under seat B\'s issued epoch', trackOfBOnA?.epoch === setupB.epoch, { observed: trackOfBOnA?.epoch, issued: setupB.epoch });
  check(
    `seat A saw seat B cover exactly the distance the authority owes for those ${String(moveB.sent)} frames`,
    Math.abs((trackOfBOnA?.delta.x ?? Number.NaN) - phase2Expected) <= FLOAT_TOLERANCE_METRES && acksForB >= moveB.sent,
    { observed: trackOfBOnA?.delta.x, expected: phase2Expected, acksAdvanced: acksForB },
  );
  check('seat A saw no tick regression and no epoch change for seat B', (trackOfBOnA?.tickRegressions ?? 1) === 0 && (trackOfBOnA?.epochChanges ?? 1) === 0, trackOfBOnA);
  check('seat A did not move while it sent nothing in phase 2', (afterA2.self?.x ?? NaN) === (afterA.self?.x ?? NaN), { before: afterA.self, after: afterA2.self });

  // The published `movementMode` is momentary: it names the tick that consumed a direct intent, and a
  // 100 ms patch over a 50 ms step batches two ticks into one delivery, so a delivery can legitimately miss
  // it. Recorded rather than asserted (limitation at the foot of this file): consumption is evidenced by the
  // acknowledgements and by the exact distance the authority owes, both asserted above.
  observations['movementModes'] = {
    seatAOwnMidRun: moveA.modeDuringMovement,
    seatBOwnMidRun: moveB.modeDuringMovement,
    seatAAsSeenByB: (trackOfAOnB?.samples ?? []).map((sample) => sample.movementMode),
    seatBAsSeenByA: (trackOfBOnA?.samples ?? []).map((sample) => sample.movementMode),
  };

  // ---- the adopted speed ceiling, in the two forms an observer can actually see.
  //
  // (1) **No seat outruns its acknowledged frames.** An observer's total distance cannot exceed what the
  //     authority acknowledged for that seat: `distance ≤ acks × 0.2 m`. This is the abuse half of the
  //     adopted P10 row, read from outside the room.
  // (2) **The observed distance stays inside the ceiling *on average* over the authority ticks it spans.**
  //     The room publishes every 100 ms over a 50 ms step, so one delivery legitimately carries two consumed
  //     ticks and a sample pair can differ by 0.4 m; dividing the observed distance by the tick span the
  //     samples cover is the honest bound a browser can show. It is an average over a patch-covered span,
  //     **not** a proof of any individual authority tick's maximum speed — that per-tick maximum is proven
  //     against the authority journal by the formal Gate A trace.
  // Gate A's per-tick and transition safety rows are measured against the authority journal in the Gate A
  // run, not from a browser; this smoke says so rather than claiming them.
  const outrunsAcks = (distance: number, acks: number): boolean => distance > acks * perStepMetres + FLOAT_TOLERANCE_METRES;
  const phase1Distance = Math.abs(trackOfAOnB?.delta.z ?? 0) + Math.abs(trackOfAOnB?.delta.x ?? 0);
  const phase2Distance = Math.abs(trackOfBOnA?.delta.x ?? 0) + Math.abs(trackOfBOnA?.delta.z ?? 0);
  check('neither observer ever saw a seat outrun its acknowledged frames', !outrunsAcks(phase1Distance, acksForA) && !outrunsAcks(phase2Distance, acksForB), {
    phase1: { distance: phase1Distance, acks: acksForA, ceiling: acksForA * perStepMetres },
    phase2: { distance: phase2Distance, acks: acksForB, ceiling: acksForB * perStepMetres },
  });
  const perTickBound = (track: PagePeerTrack | undefined, distance: number): { ok: boolean; perTick: number; span: number } => {
    if (track === undefined) return { ok: false, perTick: Number.POSITIVE_INFINITY, span: 0 };
    const span = track.lastSample.tick - track.firstSample.tick;
    const perTick = span > 0 ? distance / span : distance;
    return { ok: perTick <= SPEED_LIMIT_PER_STEP_METRES + FLOAT_TOLERANCE_METRES, perTick, span };
  };
  const phase1PerTick = perTickBound(trackOfAOnB, phase1Distance);
  const phase2PerTick = perTickBound(trackOfBOnA, phase2Distance);
  check('the observed distance stays inside the adopted 0.2 m ceiling as an average over the authority ticks it covers (a per-tick maximum would need the Gate A journal)', phase1PerTick.ok && phase2PerTick.ok, {
    phase1: phase1PerTick,
    phase2: phase2PerTick,
    ceilingPerTick: SPEED_LIMIT_PER_STEP_METRES,
  });

  // ---- no tokens, no local state, nothing retained.
  const storageReports = { A: afterA2.storage, B: afterB2.storage };
  check('neither context holds localStorage or sessionStorage state', storageReports.A.local === 0 && storageReports.A.session === 0 && storageReports.B.local === 0 && storageReports.B.session === 0, storageReports);
  const seatSurface = await pageA.evaluate(() => {
    const holder = (globalThis as unknown as SeatWindow).__udgSpikeSeat;
    if (holder === undefined) throw new Error('the seat is not joined');
    // Whatever the seat exposes to the page, it exposes no credential: the check is over the observable
    // surface a page could leak, not over a private field nobody can read.
    return JSON.stringify({
      seat: { roomId: holder.seat.roomId, sessionId: holder.seat.sessionId, snapshot: holder.seat.snapshot() },
    });
  });
  check('the observable seat surface names no reconnection token or credential', !/reconnectionToken|"token"/.test(seatSurface), seatSurface.slice(0, 400));

  // ---- the local refusal path: an out-of-domain frame never reaches the wire.
  const refusal = await pageA.evaluate(() => {
    const holder = (globalThis as unknown as SeatWindow).__udgSpikeSeat;
    if (holder === undefined) throw new Error('the seat is not joined');
    const before = holder.seat.sentCount();
    let message = 'no refusal thrown';
    try {
      holder.seat.sendDirect({ generation: holder.seat.sentCount() + 1, moveX: Number.NaN, moveZ: 1 });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    return { message, transmitted: holder.seat.sentCount() - before };
  });
  check('an out-of-domain axis is refused locally and transmits nothing', refusal.transmitted === 0 && /refused locally/.test(refusal.message), refusal);

  // ---- issues and page health.
  check('no replica-shape issues were recorded by either seat', afterA2.snapshotIssues.length === 0 && afterB2.snapshotIssues.length === 0, {
    A: afterA2.snapshotIssues,
    B: afterB2.snapshotIssues,
  });
  check('the remote presentations recorded no anomaly', afterA2.presentationIssues.length === 0 && afterB2.presentationIssues.length === 0, {
    A: afterA2.presentationIssues,
    B: afterB2.presentationIssues,
  });

  observations['seatReports'] = { A: afterA2, B: afterB2 };

  // ---- clean close, then a screenshot that identifies both seats.
  await closeSeat(pageA);
  await closeSeat(pageB);
  await pageA.screenshot({ path: join(OUT_DIR, 'screenshots', 'seat-A-after-close.png') }).catch((error: unknown) => String(error));
  await pageB.screenshot({ path: join(OUT_DIR, 'screenshots', 'seat-B-after-close.png') }).catch((error: unknown) => String(error));

  const pageErrors = [...(pageErrorSinks.get('A') ?? []), ...(pageErrorSinks.get('B') ?? [])];
  check('neither context raised a page or console error beyond the expected development-socket refusal', pageErrors.length === 0, pageErrors.slice(0, 4));

  check('every recorded check passed', checks.every((record) => record.ok), checks.filter((record) => !record.ok).map((record) => record.name));
  expect.soft(checks.filter((record) => !record.ok), `failed checks: ${JSON.stringify(checks.filter((record) => !record.ok))}`).toEqual([]);
});

limitations.push('Two-browser-context loopback smoke: it certifies nothing about the four-profile Gate A matrix, the seeds, impairment, forced corrections, or the 20-client ten-minute workload.');
limitations.push('Gate A remains Not Run; the client compiler diagnostics are a separate claim in docs/integration/colyseus-0.18-api-map.md §12 and docs/adr/0004-client-declaration-checking-exception.md.');
limitations.push('Local prediction and forced correction are later slices of this spike: the seat publishes what the authority replicated, and this smoke asserts nothing about correction magnitude.');
limitations.push('Gate A per-tick and safety-on-transition rows are not evaluated here: a browser sees patched deliveries, not the authority journal, and the 100 ms patch interval over a 50 ms step means one delivery carries two consumed ticks. The transient `movementMode` of a consumed direct intent is therefore recorded and not asserted. Those rows wait for the Gate A run against the journal.');

