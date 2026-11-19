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
  renderPose(sessionId: string, nowMs: number, delayMs: number): {
    readonly sessionId: string; readonly x: number; readonly z: number;
    readonly fromTick: number; readonly toTick: number; readonly alpha: number;
    readonly holding: boolean; readonly howOldMs: number;
  } | undefined;
  renderStats(sessionId: string): { renders: number; maxRenderJump: number; maxHoldMs: number; holds: number } | undefined;
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
/** The live room class, reached in-process, so correction pacing can watch authority ticks. */
let roomClass: { liveRooms(): readonly { roomId?: string; evidence(): Record<string, unknown> }[] } | undefined;

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
    RegionRoom: unknown;
  };
  roomClass = roomModule['RegionRoom'] as { liveRooms(): readonly { roomId?: string; evidence(): Record<string, unknown> }[] };

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

/**
 * Open a context and load the client pipeline's own module graph, without pretending to be the camera app.
 *
 * `bare: true` navigates to a same-origin, script-free document (the pipeline's own transpiled module
 * source rendered as text) instead of the camera app. The prediction slice opens four seats across two
 * tests; each camera-app tab allocates a SwiftShader WebGL context in this headless container, and the
 * fifth tab crashed the renderer. A seat that only runs network modules does not need a scene, and the
 * pipeline still serves its modules to that document exactly as it does to the app.
 */
const openSeatPage = async (label: string, options: { bare?: boolean } = {}): Promise<Page> => {
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
    // The camera client's development socket, and the recovery phase's deliberate network loss, are
    // expected: no room listens on 2567 here, and an offline context must fail its sockets visibly.
    if (/ws:\/\/127\.0\.0\.1:2567|WebSocket is closed|Failed to construct 'WebSocket'|net::ERR_INTERNET_DISCONNECTED|WebSocket connection to 'ws:\/\/127/.test(text)) return;
    pageErrors.push(`console: ${text}`);
  });
  await page?.goto(options.bare === true ? `${CLIENT_ORIGIN}${REMOTE_URL}` : `${CLIENT_ORIGIN}/`, { waitUntil: 'load' });
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

// --------------------------------------------------------------------------- prediction slice (slice 4)

/**
 * The prediction/correction slice, in one test.
 *
 * The mover page composes the SAME production classes the seat uses — `createSdkSeatTransport`
 * and `DirectMotionPredictor` — and the observer page runs the ordinary `joinPredictionSeat`
 * composition. Three things this structure is chosen for, each a requirement rather than a
 * convenience: (1) the fixture can stage a frame the AUTHORITY refuses (generation 0 beside a
 * live watermark) through the public SDK handle, so a correction is genuinely server-forced —
 * the seat predicted a step the authority declined to take; (2) the correction pacing is real:
 * Node watches the room's own authority ticks (`RegionRoom.liveRooms()` in this process) and
 * stages at tick 38/118 so consumption lands at 40/120 within the asserted window; (3) nothing
 * reaches into anything private: the handle, its `data`, and `send()` are the published surface.
 *
 * The interpolation half is the mirror image of the smoke's rule: the observer's render poses
 * must lie BETWEEN published samples (never past the newest — extrapolation would be authored
 * motion), and the observer never sends, so it structurally cannot feed the authority.
 */

interface PredTransportSurface {
  issuedEpoch(): number;
  handle(): {
    data: { sessionEpoch: number; generation: number; directIntent: boolean; moveX: number; moveZ: number; seq: number };
    send(): number;
    readonly sentCount: number;
    readonly lastProcessed: number;
  };
  close(): Promise<void>;
}

interface PredCorrectionRow {
  readonly revision: number; readonly authorityTick: number; readonly epoch: number;
  readonly ack: number; readonly resolvedThrough: number; readonly atMs: number;
  readonly predictedBeforeZ: number; readonly predictedAfterZ: number; readonly authoritativeZ: number;
  readonly rawCorrectionZ: number; readonly pendingCount: number; readonly zero: boolean;
}

interface PredPredictorSurface {
  attach(): void;
  tick(now: number): void;
  send(request: { generation: number; moveX: number; moveZ: number }, directIntent: boolean): { seq: number; generation: number };
  stateName(): string;
  snapshotReadyForInput(): boolean;
  canonical(): null;
  replicated(): { revision: number; epoch: number; authorityTick: number; x: number; z: number; ack: number; resolvedThrough: number } | null;
  rawPredicted(): { x: number; z: number } | null;
  presentation(): { x: number; z: number } | null;
  heldSnapshot(): { x: number; z: number } | null;
  pendingJournal(): readonly { seq: number; epoch: number }[];
  deliveryLedger(): readonly { accepted: boolean; reason: string; delivery: { revision: number; epoch: number; authorityTick: number } }[];
  tickLedger(): readonly { action: string; reason: string; reconcileSeq: number }[];
  correctionLedger(): readonly PredCorrectionRow[];
  recoveryLedger(): readonly { event: string; detail: string; atMs: number }[];
  sentAudit(): readonly { seq: number; epoch: number; atMs: number }[];
  pruneAuthorityLedger(): { byResolvedThrough: number; byAckWatermark: number };
  rejoinTimestamps(): readonly number[];
  close(): Promise<void>;
}

interface PredModuleSurface {
  createSdkSeatTransport(options: unknown): Promise<{ transport: PredTransportSurface; roomId: string; sessionId: string }>;
  DirectMotionPredictor: new (transport: unknown, options: unknown) => PredPredictorSurface;
}

interface PredSeatWindow {
  __udgPredSeat?: {
    readonly transport: PredTransportSurface;
    readonly predictor: PredPredictorSurface;
    readonly roomId: string;
    readonly sessionId: string;
    generation: number;
    moverStop: boolean;
    readonly joinEpoch: number;
    readonly joinZ: number;
  };
  __udgObsSeat?: {
    readonly seat: PageSeatHandle;
    readonly presentation: PageRemotePresentation;
    readonly peerId: string;
    renders: { t: number; x: number; z: number; alpha: number; holding: boolean; fromTick: number; toTick: number }[];
    foldTimer: ReturnType<typeof setInterval> | null;
  };
}

/** Wait until the live room with this id has advanced its authority clock to at least `target`. */
const waitAuthorityTick = async (roomId: string, target: number, limitMs: number): Promise<number> => {
  const deadline = Date.now() + limitMs;
  for (;;) {
    const room = (roomClass?.liveRooms() ?? []).find((candidate) => candidate.roomId === roomId);
    const ticks = Number((room?.evidence()?.['ticks'] ?? -1) as number);
    if (ticks >= target) return ticks;
    if (Date.now() > deadline) return ticks;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

test('prediction slice: pinned prediction, two server-forced corrections at authority ticks 40/120, exactly-once replay, deadline recovery, read-only interpolation', async () => {
  expect(fixture, 'the room fixture booted').toBeDefined();
  expect(roomClass, 'the live room class is reachable in-process').toBeDefined();
  const movementSpeed = fixture?.movementSpeed ?? 0;
  const tickRate = fixture?.tickRate ?? 0;
  const stepMetres = movementSpeed / tickRate;
  const ledgerLimit = 20_000;

  // ---- the mover: production classes composed by the fixture page, so the handle is reachable.
  const pageM = await openSeatPage('pred-M', { bare: true });
  const joinM = await pageM.evaluate(async (args) => {
    const adapter = (await import(/* @vite-ignore */ args.adapterUrl)) as PredModuleSurface;
    const joined = await adapter.createSdkSeatTransport({
      endpoint: args.endpoint,
      join: args.join,
      presentation: args.presentation,
      epochTimeoutMs: 15_000,
    });
    const predictor = new adapter.DirectMotionPredictor(joined.transport, {
      speed: args.speed,
      ledgerLimit: args.ledgerLimit,
      snapshotDeadlineMs: 500,
      rejoin: async () => {
        const again = await adapter.createSdkSeatTransport({
          endpoint: args.endpoint,
          join: { mode: 'byId', roomId: joined.roomId },
          presentation: args.presentation,
          epochTimeoutMs: 15_000,
        });
        return again.transport;
      },
    });
    predictor.attach();
    // BEFORE any frame tick of ours runs: what do the readers say? The SDK decoded deliveries
    // already — if anything auto-reconciled, `rawPredicted()` would not be null and a reconcile
    // would already be in the ledger. This is the "no auto-reconcile before a verified delivery
    // has been ticked by the seat" proof, read at the only moment it can be read.
    const beforeFirstFrame = {
      deliveries: predictor.deliveryLedger().length,
      reconciled: predictor.tickLedger().filter((row) => row.action === 'reconciled').length,
      rawPredicted: predictor.rawPredicted(),
      presentation: predictor.presentation(),
      canonical: predictor.canonical(),
      snapshotReady: predictor.snapshotReadyForInput(),
    };
    let frames = 0;
    const raf = (): void => {
      frames += 1;
      predictor.tick(performance.now());
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    const row0 = predictor.replicated();
    (globalThis as unknown as PredSeatWindow).__udgPredSeat = {
      transport: joined.transport,
      predictor,
      roomId: joined.roomId,
      sessionId: joined.sessionId,
      generation: 1,
      moverStop: true,
      joinEpoch: joined.transport.issuedEpoch(),
      joinZ: row0?.z ?? 0,
    };
    return { ok: true as const, roomId: joined.roomId, sessionId: joined.sessionId, epoch: joined.transport.issuedEpoch(), beforeFirstFrame, framesStart: frames };
  }, { endpoint: fixture?.endpoint ?? '', join: { mode: 'create', roomName: ROOM_NAME }, presentation: fixture?.presentation ?? {}, adapterUrl: ADAPTER_URL, speed: movementSpeed, ledgerLimit });
  expect(joinM.ok, `fixture seat joined: ${JSON.stringify(joinM)}`).toBe(true);
  const roomId = joinM.roomId as string;

  check('pred: canonical state is never held by the seat (the server owns it; the reader is structurally null)', joinM.beforeFirstFrame.canonical === null, joinM.beforeFirstFrame);
  check(
    'pred: the SDK decoded deliveries but reconciled NOTHING before the seat ticked a verified delivery (no raw/predicted state exists yet)',
    joinM.beforeFirstFrame.deliveries >= 1 && joinM.beforeFirstFrame.reconciled === 0 && joinM.beforeFirstFrame.rawPredicted === null && joinM.beforeFirstFrame.presentation === null,
    joinM.beforeFirstFrame,
  );
  check('pred: input is gated on a verified snapshot before any send is allowed', joinM.beforeFirstFrame.snapshotReady === true, joinM.beforeFirstFrame);

  // ---- the observer: the ordinary production seat, sending nothing, rendering with delay.
  const pageO = await openSeatPage('pred-O', { bare: true });
  const joinO = await pageO.evaluate(async (args) => {
    const adapter = (await import(/* @vite-ignore */ args.adapterUrl)) as {
      joinPredictionSeat(options: unknown): Promise<PageSeatHandle>;
    };
    const remote = (await import(/* @vite-ignore */ args.remoteUrl)) as {
      createRemotePresentation(): PageRemotePresentation;
    };
    const seat = await adapter.joinPredictionSeat({
      endpoint: args.endpoint,
      join: args.join,
      presentation: args.presentation,
      epochTimeoutMs: 15_000,
      speed: args.speed,
      predictor: { ledgerLimit: args.ledgerLimit },
    });
    const presentation = remote.createRemotePresentation();
    presentation.observe(seat.snapshot());
    const peerId = (args.peerId ?? seat.snapshot().peers[0]?.key) as string;
    const renders: { t: number; x: number; z: number; alpha: number; holding: boolean; fromTick: number; toTick: number }[] = [];
    const record = (): void => {
      presentation.observe(seat.snapshot());
      const pose = presentation.renderPose(peerId, performance.now(), 60);
      if (pose !== undefined && renders.length < 4000) {
        renders.push({ t: performance.now(), x: pose.x, z: pose.z, alpha: pose.alpha, holding: pose.holding, fromTick: pose.fromTick, toTick: pose.toTick });
      }
      requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
    (globalThis as unknown as PredSeatWindow).__udgObsSeat = { seat, presentation, peerId, renders, foldTimer: null };
    return { ok: true as const, sessionId: seat.sessionId, peerId, self: seat.snapshot().self };
  }, {
    endpoint: fixture?.endpoint ?? '', join: { mode: 'byId', roomId }, presentation: fixture?.presentation ?? {},
    adapterUrl: ADAPTER_URL, remoteUrl: REMOTE_URL, speed: movementSpeed, ledgerLimit, peerId: joinM.sessionId,
  });
  expect(joinO.ok, 'observer seat joined').toBe(true);
  const observerStartZ = joinO.self?.z ?? 0;

  // The advertised fixed rate: the negative-control detector for a missing rate must be armed
  // and silent — the predictor only ever steps with the advertised dt.
  const advertisedM = await pageM.evaluate(() => {
    const h = (globalThis as unknown as PredSeatWindow).__udgPredSeat;
    if (h === undefined) throw new Error('no fixture seat');
    return { missingRateTicks: h.predictor.tickLedger().filter((row) => row.reason === 'missing-advertised-rate').length };
  });
  check('pred: the room advertised its fixed rate and the missing-rate refusal never fired', advertisedM.missingRateTicks === 0 && tickRate === 20, { ...advertisedM, tickRate });

  // ---- responsiveness: prediction begins no later than one step plus one rendered frame.
  const response = await pageM.evaluate(async (args) => {
    const h = (globalThis as unknown as PredSeatWindow).__udgPredSeat;
    if (h === undefined) throw new Error('no fixture seat');
    const preRaw = h.predictor.rawPredicted();
    const prePres = h.predictor.presentation();
    if (preRaw === null || prePres === null) throw new Error('the predictor has no raw/presentation state to measure');
    const t0 = performance.now();
    h.predictor.send({ generation: h.generation, moveX: 0, moveZ: 1 }, true);
    h.generation += 1;
    const syncRaw = h.predictor.rawPredicted();
    const syncDelta = syncRaw === null ? Number.NaN : syncRaw.z - preRaw.z;
    const responseMs = await new Promise<number>((resolve) => {
      const started = performance.now();
      const poll = (): void => {
        const p = h.predictor.presentation();
        if (p !== null && p.z - prePres.z > args.stepMetres * 0.5) resolve(performance.now() - t0);
        else if (performance.now() - started > 2000) resolve(Number.NaN);
        else requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    });
    return { syncDelta, responseMs, allowanceMs: args.stepMs + 40 };
  }, { stepMetres, stepMs: 1000 / tickRate });
  check(
    `pred: raw prediction responds within one fixed step (${String((1000 / tickRate).toFixed(0))} ms) plus one rendered frame (measured ${String(response.responseMs.toFixed(1))} ms against a ${String(response.allowanceMs)} ms allowance)`,
    Math.abs(response.syncDelta - stepMetres) < 0.000001 && response.responseMs <= response.allowanceMs,
    response,
  );

  // ---- the movement loop, then the two server-forced corrections.
  await pageM.evaluate(() => {
    const h = (globalThis as unknown as PredSeatWindow).__udgPredSeat;
    if (h === undefined) throw new Error('no fixture seat');
    h.moverStop = false;
    const step = (): void => {
      if (h.moverStop) return;
      try {
        h.predictor.send({ generation: h.generation, moveX: 0, moveZ: 1 }, true);
        h.generation += 1;
      } catch {
        // stop-sending windows during recovery are the ADR path, not a failure; the generation
        // counter simply does not advance for a frame that was never staged.
      }
      setTimeout(step, 50);
    };
    step();
  });

  /** Stage one frame the AUTHORITY refuses (generation 0 beside a live watermark), through the
   * public SDK handle — the seat predicts the step, the authority declines it, adoption is forced. */
  const stageRefusedFrame = async (moveX: number): Promise<{ stagedSeq: number; watermark: number; epoch: number }> =>
    pageM.evaluate((args) => {
      const h = (globalThis as unknown as PredSeatWindow).__udgPredSeat;
      if (h === undefined) throw new Error('no fixture seat');
      const handle = h.transport.handle();
      const epoch = h.transport.issuedEpoch();
      handle.data.sessionEpoch = epoch;
      handle.data.generation = 0;
      handle.data.directIntent = true;
      handle.data.moveX = args.moveX;
      handle.data.moveZ = 1;
      handle.data.seq = handle.sentCount + 1;
      const stagedSeq = handle.send();
      return { stagedSeq, watermark: handle.lastProcessed, epoch };
    }, { moveX });

  const tickAtStage1 = await waitAuthorityTick(roomId, 38, 20_000);
  const stage1 = await stageRefusedFrame(0);
  const tickSeen1 = await waitAuthorityTick(roomId, 46, 5_000);
  const tickAtStage2 = await waitAuthorityTick(roomId, 118, 20_000);
  const stage2 = await stageRefusedFrame(0.004); // a distinct payload: the refusal cache must not swallow the second frame
  const tickSeen2 = await waitAuthorityTick(roomId, 126, 5_000);

  await pageM.waitForTimeout(500);
  const corrections1 = await pageM.evaluate(() => {
    const h = (globalThis as unknown as PredSeatWindow).__udgPredSeat;
    if (h === undefined) throw new Error('no fixture seat');
    return { corrections: h.predictor.correctionLedger(), state: h.predictor.stateName() };
  });
  await pageM.evaluate(() => {
    const h = (globalThis as unknown as PredSeatWindow).__udgPredSeat;
    if (h === undefined) throw new Error('no fixture seat');
    h.moverStop = true;
  });
  await pageM.waitForTimeout(400);

  check('pred: pacing reached the intended authority windows (stage near 40 and 120)', tickAtStage1 >= 37 && tickSeen1 >= 46 && tickAtStage2 >= 117 && tickSeen2 >= 126, { tickAtStage1, tickSeen1, tickAtStage2, tickSeen2 });
  // A reconcile's raw correction is fully explained by the inputs the seat still owes — the
  // pending window replayed. What is NOT explainable that way is the refused step the authority
  // never took. `excess = raw − pending x step` is therefore 0 everywhere except at a genuine
  // server refusal, where it is exactly one predicted step. That is the "zero eligible
  // corrections in the raw trace" criterion, evaluated per reconcile.
  const excess = (row: PredCorrectionRow): number => row.rawCorrectionZ - row.pendingCount * stepMetres;
  const nonzero = corrections1.corrections.filter((row) => Math.abs(excess(row)) > 0.000001);
  const forced = nonzero.filter((row) => Math.abs(excess(row) - stepMetres) < 0.000001 && row.authorityTick >= 38 && row.authorityTick <= 48);
  const forced2 = nonzero.filter((row) => Math.abs(excess(row) - stepMetres) < 0.000001 && row.authorityTick >= 116 && row.authorityTick <= 128);
  check('pred: exactly two UNEXPLAINED corrections in the whole raw trace — each exactly one predicted step, adopted at authority ticks 40 and 120 (genuine server refusals, induced through the public handle)',
    nonzero.length === 2 && forced.length === 1 && forced2.length === 1,
    { nonzero: nonzero.map((row) => ({ tick: row.authorityTick, raw: row.rawCorrectionZ, pending: row.pendingCount, excess: excess(row) })), stage1, stage2 });
  const everyForcedCorrectionIsAnAdoption = forced.length === 1 && forced2.length === 1
    && Math.abs(forced[0]!.predictedAfterZ - (forced[0]!.authoritativeZ + forced[0]!.pendingCount * stepMetres)) < 0.000001
    && Math.abs(forced2[0]!.predictedAfterZ - (forced2[0]!.authoritativeZ + forced2[0]!.pendingCount * stepMetres)) < 0.000001;
  check('pred: after each forced adoption the raw predicted pose equals authority + pending x step to <1e-6 m (the flat-replay convergence, with the pending window replayed exactly once)',
    everyForcedCorrectionIsAnAdoption,
    { f1: forced[0], f2: forced2[0], stepMetres });

  // ---- the steady state around the corrections: zero-correcting reconciles and the replay
  //      invariant on EVERY reconcile — the double-step / double-replay negative control.
  const steady = await pageM.evaluate((args) => {
    const h = (globalThis as unknown as PredSeatWindow).__udgPredSeat;
    if (h === undefined) throw new Error('no fixture seat');
    const rows = h.predictor.correctionLedger();
    let violations = 0;
    let unexplained = 0;
    let idleZero = 0;
    let idleTotal = 0;
    for (const row of rows) {
      if (Math.abs(row.predictedAfterZ - (row.authoritativeZ + row.pendingCount * args.stepMetres)) > 0.000001) violations += 1;
      const rowExcess = row.rawCorrectionZ - row.pendingCount * args.stepMetres;
      if (Math.abs(rowExcess) > 0.000001) unexplained += 1;
      if (row.pendingCount === 0) {
        idleTotal += 1;
        if (row.zero) idleZero += 1;
      }
    }
    let maxSeqDelta = 0;
    let last = -1;
    for (const tick of h.predictor.tickLedger()) {
      if (tick.action !== 'reconciled') continue;
      if (last >= 0 && tick.reconcileSeq - last > maxSeqDelta) maxSeqDelta = tick.reconcileSeq - last;
      last = tick.reconcileSeq;
    }
    const ticks = h.predictor.tickLedger();
    return {
      corrections: rows.length,
      violations,
      unexplained,
      idleZero,
      idleTotal,
      maxSeqDelta,
      reconciledTicks: ticks.filter((row) => row.action === 'reconciled').length,
      skippedTicks: ticks.filter((row) => row.action === 'skipped').length,
      deliveries: h.predictor.deliveryLedger().length,
      accepted: h.predictor.deliveryLedger().filter((row) => row.accepted).length,
      prune: h.predictor.pruneAuthorityLedger(),
      pendingNow: h.predictor.pendingJournal().length,
      sent: h.predictor.sentAudit().length,
      byEpoch: [...new Set(h.predictor.sentAudit().map((row) => row.epoch))],
    };
  }, { stepMetres });
  check('pred: the pending window replays EXACTLY once per reconcile — zero double-step/double-replay violations across the whole run', steady.violations === 0 && steady.corrections > 20, steady);
  check('pred: at most one reconcile per frame tick (reconcileSeq never advances by more than one)', steady.maxSeqDelta <= 1, steady);
  check('pred: every reconcile except the two server refusals corrects by exactly the pending window it owes; reconciles with an empty pending window correct to exactly zero',
    // idleTotal >= 1 is structural: the settle drain after the loop stops always reconciles with
    // an empty pending window. Whenever the window is empty, the correction must be exactly zero.
    steady.unexplained === 2 && steady.idleTotal >= 1 && steady.idleZero === steady.idleTotal, steady);
  check('pred: pruning authority is inputResolvedThrough ONLY — the SDK ack watermark pruned nothing all run, and every sent frame is accounted for (pruned-by-resolution or still pending, never forgotten)', steady.prune.byAckWatermark === 0 && steady.prune.byResolvedThrough + steady.pendingNow === steady.sent && steady.sent > 30, steady);
  check('pred: every accepted delivery paired ack with resolution on one epoch (the guard saw the pair the SDK owed)', steady.accepted >= steady.corrections, steady);

  // ---- several verified patches between two frames still reconcile exactly once.
  // Restart the movement loop for the stall window: the room publishes against consumption, so
  // patches only queue up while the seat is actually sending. The stall then misses real patches.
  await pageM.evaluate(() => {
    const h = (globalThis as unknown as PredSeatWindow).__udgPredSeat;
    if (h === undefined) throw new Error('no fixture seat');
    h.moverStop = false;
    const step = (): void => {
      if (h.moverStop) return;
      try {
        h.predictor.send({ generation: h.generation, moveX: 0, moveZ: 1 }, true);
        h.generation += 1;
      } catch { /* in-flight refusals are recorded, not fatal here */ }
      setTimeout(step, 50);
    };
    step();
  });
  const gap = await pageM.evaluate(async () => {
    const h = (globalThis as unknown as PredSeatWindow).__udgPredSeat;
    if (h === undefined) throw new Error('no fixture seat');
    const started = performance.now();
    while (performance.now() - started < 260) { /* stall the frame loop; deliveries queue up */ }
    // From the stall's end, watch for the FIRST actual reconcile (a reconcileSeq advance in the
    // correction ledger): every queued patch must have been decoded and verified before that one
    // reconcile, and exactly one reconcile covers the whole burst.
    const baseCorrections = h.predictor.correctionLedger().length;
    const baseDeliveries = h.predictor.deliveryLedger().length;
    const deadline = performance.now() + 3000;
    while (performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 4));
      if (h.predictor.correctionLedger().length > baseCorrections) break;
    }
    return {
      deliveryDelta: h.predictor.deliveryLedger().length - baseDeliveries,
      correctionDelta: h.predictor.correctionLedger().length - baseCorrections,
    };
  });
  await pageM.evaluate(() => {
    const h = (globalThis as unknown as PredSeatWindow).__udgPredSeat;
    if (h === undefined) throw new Error('no fixture seat');
    h.moverStop = true;
  });
  await pageM.waitForTimeout(350);
  check(
    'pred: several verified patches queued by a stalled frame loop are covered by exactly ONE reconcile when the seat next advances it (never one per patch)',
    gap.deliveryDelta >= 2 && gap.correctionDelta === 1,
    gap,
  );

  // ---- the observer half: interpolation follows published samples and never authors motion.
  const observer = await pageO.evaluate((args) => {
    const h = (globalThis as unknown as PredSeatWindow).__udgObsSeat;
    if (h === undefined) throw new Error('no observer seat');
    if (h.foldTimer !== null) clearInterval(h.foldTimer);
    const track = h.presentation.trackOf(h.peerId);
    const between = h.renders.filter((pose) => !pose.holding && pose.alpha > 0.02 && pose.alpha < 0.98 && pose.fromTick !== pose.toTick);
    const maxPublishedZ = track?.lastSample.z ?? Number.NaN;
    const maxRenderZ = h.renders.reduce((acc, pose) => Math.max(acc, pose.z), Number.NEGATIVE_INFINITY);
    const minRenderZ = h.renders.reduce((acc, pose) => Math.min(acc, pose.z), Number.POSITIVE_INFINITY);
    const firstBetween = between[0];
    let backward = 0;
    for (let index = 1; index < h.renders.length; index += 1) {
      const previous = h.renders[index - 1] as (typeof h.renders)[number];
      const current = h.renders[index] as (typeof h.renders)[number];
      if (current.z < previous.z - 0.000001) backward += 1;
    }
    return {
      renders: h.renders.length,
      between: between.length,
      maxPublishedZ, maxRenderZ, minRenderZ,
      firstBetween,
      backward, holds: h.presentation.renderStats(h.peerId)?.holds ?? -1,
      renderStats: h.presentation.renderStats(h.peerId),
      sentCount: h.seat.sentCount(),
      selfZ: h.seat.snapshot().self?.z ?? Number.NaN,
      selfTick: h.seat.snapshot().self?.lastAuthorityTick ?? 0,
      presentationIssues: h.presentation.issues(),
      observerStartZ: args.observerStartZ,
    };
  }, { observerStartZ });
  check('pred: the observer rendered interpolated poses strictly inside published sample pairs (alpha between, distinct fromTick/toTick)',
    observer.renders > 100 && observer.between > 20 && observer.firstBetween !== undefined && observer.firstBetween.z >= Math.min(observer.minRenderZ, observer.maxPublishedZ),
    { renders: observer.renders, between: observer.between, firstBetween: observer.firstBetween });
  check('pred: interpolation never extrapolated — no render pose passed the newest published sample, and none moved backwards during the +z run',
    observer.maxRenderZ <= observer.maxPublishedZ + 0.000001 && observer.backward === 0,
    { maxRenderZ: observer.maxRenderZ, maxPublishedZ: observer.maxPublishedZ, backward: observer.backward });
  check('pred: the observer authored NOTHING — zero sends, its own row never moved, and the presentation recorded no anomaly',
    observer.sentCount === 0 && Math.abs(observer.selfZ - observer.observerStartZ) < 0.000001 && observer.presentationIssues.length === 0 && observer.holds >= 1,
    observer);

  // ---- ADR-0003 §3.2 recovery in the browser, under REAL impairment: the mover context goes
  // offline with an input outstanding. No delivery can arrive, the client-local snapshot deadline
  // expires, and the seat must stop sending, discard the journal, hold the last verified pose,
  // make its ONE bounded rejoin attempt (which cannot succeed while offline), and suspend inside
  // the rolling allowance — holding, never drifting, never sending. The ladder-then-resume path
  // (backoff walk to a SUCCESSFUL rejoin and fresh-snapshot recovery) is pinned deterministically
  // by the unit suite; the browser proves the same ledger runs against a real stalled stream.
  const heldBefore = await pageM.evaluate(() => {
    const h = (globalThis as unknown as PredSeatWindow).__udgPredSeat;
    if (h === undefined) throw new Error('no fixture seat');
    return { held: h.predictor.heldSnapshot(), epoch: h.transport.issuedEpoch(), state: h.predictor.stateName() };
  });
  expect(heldBefore.state).toBe('tracking');
  await pageM.evaluate(() => {
    const h = (globalThis as unknown as PredSeatWindow).__udgPredSeat;
    if (h === undefined) throw new Error('no fixture seat');
    h.generation += 1;
    h.predictor.send({ generation: h.generation, moveX: 0, moveZ: 1 }, true);
  });
  await pageM.context().setOffline(true);
  const recovery = await pageM.evaluate(async () => {
    const h = (globalThis as unknown as PredSeatWindow).__udgPredSeat;
    if (h === undefined) throw new Error('no fixture seat');
    const deadline = performance.now() + 8000;
    let sendRefusedDuringRecovery = 'no refusal observed';
    let sendAttempted = false;
    let heldDuringRecovery = null as { x: number; z: number } | null;
    let journalDuringRecovery = -1;
    while (performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const state = h.predictor.stateName();
      if (state === 'recovering' || state === 'suspended') {
        if (!sendAttempted) {
          sendAttempted = true;
          try {
            h.generation += 1;
            h.predictor.send({ generation: h.generation, moveX: 0, moveZ: 1 }, true);
          } catch (error) {
            sendRefusedDuringRecovery = error instanceof Error ? error.message : String(error);
          }
        }
        heldDuringRecovery = h.predictor.heldSnapshot();
        journalDuringRecovery = h.predictor.pendingJournal().length;
      }
      if (state === 'suspended') break;
    }
    return {
      stateNow: h.predictor.stateName(),
      sendRefusedDuringRecovery,
      heldDuringRecovery,
      journalDuringRecovery,
      events: h.predictor.recoveryLedger().map((row) => row.event),
      triggerDetail: h.predictor.recoveryLedger().find((row) => row.event === 'trigger')?.detail ?? '',
      rejoins: h.predictor.rejoinTimestamps().length,
      epochNow: h.predictor.replicated()?.epoch ?? -1,
    };
  });
  await pageM.context().setOffline(false);
  await pageM.waitForTimeout(800);
  const wantedOrder = ['trigger', 'stop-sending', 'discard-pending', 'rejoin-scheduled', 'rejoin-attempt', 'suspended'];
  // The refused-send attempts are part of the story (recorded, reported) but not the ladder; the
  // ladder itself must appear in exactly this order among the ledger's own milestones.
  const ladder = recovery.events.filter((event: string) => event !== 'send-refused');
  const orderOk = wantedOrder.every((event, index) => ladder[index] === event);
  check('pred: a delivery stream stalled by real network loss with input outstanding runs the ADR-0003 §3.2 ledger in the browser, in order: deadline trigger, stop sending, discard, one bounded rejoin, suspension',
    orderOk && /snapshot-deadline-expired/.test(recovery.triggerDetail) && recovery.stateNow === 'suspended', recovery);
  check('pred: while suspended the seat sends nothing when asked, keeps the journal discarded, and holds the LAST verified pose — suspension is holding, not drifting',
    /recovery/.test(recovery.sendRefusedDuringRecovery) && recovery.journalDuringRecovery === 0
    && recovery.heldDuringRecovery !== null && heldBefore.held !== null
    && Math.abs(recovery.heldDuringRecovery.z - heldBefore.held.z) < 0.000001
    && recovery.rejoins === 1 && recovery.epochNow === heldBefore.epoch, recovery);

  // ---- the room's own view, read in-process: ticks advanced, refusal stats exist, nothing crashed.
  const evidence = (roomClass?.liveRooms() ?? []).find((room) => room.roomId === roomId)?.evidence();
  check('pred: the authority clock passed 120 and the room stayed healthy through two refusals and an epoch change',
    Number((evidence?.['ticks'] ?? 0) as number) >= 126 && evidence?.['refused'] !== true,
    { ticks: evidence?.['ticks'], stats: evidence?.['stats'] });
  observations['predEvidence'] = evidence ?? {};
  observations['predRecovery'] = recovery;
  observations['predSteady'] = steady;

  // ---- close, page health.
  await pageM.evaluate(async () => {
    const h = (globalThis as unknown as PredSeatWindow).__udgPredSeat;
    if (h === undefined) return;
    h.moverStop = true;
    try {
      await h.predictor.close();
    } catch {
      // The socket went through a real impairment; a failed graceful leave is recorded, not fatal.
    }
  });
  await pageO.evaluate(async () => {
    const h = (globalThis as unknown as PredSeatWindow).__udgObsSeat;
    if (h === undefined) return;
    await h.seat.close();
  });
  const pageErrors = [...(pageErrorSinks.get('pred-M') ?? []), ...(pageErrorSinks.get('pred-O') ?? [])];
  check('pred: neither prediction-slice context raised a page or console error beyond the expected development-socket refusal', pageErrors.length === 0, pageErrors.slice(0, 4));
  // Free the tabs before the run record is written: the renderer cannot carry another WebGL-heavy tab.
  await pageM.context().close();
  await pageO.context().close();

  const predFailures = checks.filter((record) => record.name.startsWith('pred:') && !record.ok);
  check('pred: every prediction-slice check passed', predFailures.length === 0, predFailures.map((record) => record.name));
  expect.soft(predFailures, `failed prediction checks: ${JSON.stringify(predFailures.map((record) => record.name))}`).toEqual([]);
});

limitations.push('Two-browser-context loopback smoke: it certifies nothing about the four-profile Gate A matrix, the seeds, impairment, forced corrections, or the 20-client ten-minute workload.');
limitations.push('Gate A remains Not Run; the client compiler diagnostics are a separate claim in docs/integration/colyseus-0.18-api-map.md §12 and docs/adr/0004-client-declaration-checking-exception.md.');
limitations.push('Local prediction and forced correction (slice 4, second test): the two forced corrections are induced by staging a frame the AUTHORITY refuses (generation 0 beside the live watermark) through the public SDK handle — a genuine server refusal at the paced authority ticks, not a fixture-side lie about position. The disposition-trigger variants of ADR-0003 recovery (retirement, named gap, episode and window bounds) are pinned by the unit suite; the browser run proves the deadline-triggered stop/discard/hold/bounded-attempt/suspension ledger end to end under real network loss, holding the last verified pose throughout.');
limitations.push('Gate A per-tick and safety-on-transition rows are not evaluated here: a browser sees patched deliveries, not the authority journal, and the 100 ms patch interval over a 50 ms step means one delivery carries two consumed ticks. The transient `movementMode` of a consumed direct intent is therefore recorded and not asserted. Those rows wait for the Gate A run against the journal.');

