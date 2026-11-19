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
let kernelStepper: { kernelStepperSentinel: { calls: number }; kernelStep: unknown } | undefined;

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
    defineOperatorRegionRoom: (options: { config?: unknown; stepperFactory?: unknown }) => unknown;
    RegionRoom: unknown;
  };
  roomClass = roomModule['RegionRoom'] as { liveRooms(): readonly { roomId?: string; evidence(): Record<string, unknown> }[] };

  // The harness loads the pinned packages the way `apps/server` sees them, and binds nothing by hand.
  // Review-amendment wiring (owner-approved): the live room steps the authority through the shared
  // kernel wrapper — a trusted `stepperFactory` on the deployment envelope, wrapping THE one exported
  // relation `apps/client/dist/network/flatStep.js` that the client side, the browser pages and the
  // AC-1 trace all consume. The wrapper module re-exports the function it steps with, and Node's
  // module registry gives every importer in this process the same function object.
  const kernelModule = (await import(
    pathToFileURL(join(ROOT, 'tests', 'support', 'step-kernel', 'kernel-stepper.mjs')).href,
  )) as {
    kernelStepperFactory: (speed: number) => unknown;
    kernelStepperSentinel: { calls: number };
    kernelStep: unknown;
  };
  kernelStepper = kernelModule;
  observations['kernelModule'] = {
    note: 'tests/support/step-kernel/kernel-stepper.mjs wraps apps/client/dist/network/flatStep.js; the AC-1 trace imports that same dist file',
  };
  const rooms = {
    [ROOM_NAME]: roomModule.defineOperatorRegionRoom({
      config: overrides,
      stepperFactory: kernelModule.kernelStepperFactory,
    }),
  };
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

  // Global safety net, AFTER the evidence is written: every recorded check across the whole suite
  // must pass, so a failure in ANY test's checks (recovery, retirement, batched control) fails the
  // run loudly — not just those whose prefix happens to be asserted inside a particular test body.
  const anyFailure = checks.filter((record) => !record.ok);
  expect(anyFailure, `failed checks across the suite: ${JSON.stringify(anyFailure.map((record) => record.name))}`).toEqual([]);
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

interface PredEndPoseRow {
  readonly revision: number; readonly authorityTick: number; readonly epoch: number;
  readonly ack: number; readonly resolvedThrough: number; readonly atMs: number;
  readonly predictedBeforeX: number; readonly predictedBeforeZ: number;
  readonly predictedAfterX: number; readonly predictedAfterZ: number;
  readonly authoritativeX: number; readonly authoritativeZ: number;
  readonly endPoseDeltaX: number; readonly endPoseDeltaZ: number;
  readonly pendingCount: number; readonly zero: boolean;
}

interface PredMatchedRow {
  readonly atMs: number; readonly authorityTick: number; readonly epoch: number;
  readonly ackFrom: number; readonly ackTo: number; readonly seqs: readonly number[];
  readonly status: string;
  readonly predictedAtAckX: number; readonly predictedAtAckZ: number;
  readonly authoritativeX: number; readonly authoritativeZ: number;
  readonly correctionX: number; readonly correctionZ: number; readonly magnitude: number;
  readonly legacyPendingApproximationMetres: number;
}

interface PredIdentityRow {
  readonly reconcileSeq: number; readonly atMs: number; readonly ack: number;
  readonly pendingSeqs: readonly number[];
  readonly residualX: number; readonly residualZ: number; readonly maxAbsResidualMetres: number;
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
  deliveryLedger(): readonly { accepted: boolean; reason: string; delivery: { revision: number; epoch: number; authorityTick: number; atMs: number } }[];
  tickLedger(): readonly { action: string; reason: string; reconcileSeq: number }[];
  /** END-POSE DIAGNOSTIC (renamed): pre-smoothing end-pose delta, pending window included. */
  endPoseDiagnostics(): readonly PredEndPoseRow[];
  /** The per-matched-ack correction ledger (checkpoint instrumenter, shared reference step). */
  matchedCorrections(): readonly PredMatchedRow[];
  /** Replay-identity ledger: adopted ⊕ Σ step(pending) − raw, per reconcile. */
  replayIdentityLedger(): readonly PredIdentityRow[];
  /** Adoption corroboration ledger: per reconcile, the ACTUAL adoption and the boundaries it covers. */
  adoptionLedger(): readonly PredAdoptionRow[];
  matchedInstrumentStats(): { measured: number; zero: number; anchored: number; invalidated: number; nonAdvancingDeliveries: number; adoptions: number; adoptionCoverageIncomplete: number };
  recoveryLedger(): readonly { event: string; detail: string; atMs: number }[];
  sentAudit(): readonly { seq: number; epoch: number; atMs: number }[];
  pruneAuthorityLedger(): { byResolvedThrough: number; byAckWatermark: number };
  rejoinTimestamps(): readonly number[];
  close(): Promise<void>;
}

interface PredModuleSurface {
  createSdkSeatTransport(options: unknown): Promise<{ transport: PredTransportSurface; roomId: string; sessionId: string }>;
  DirectMotionPredictor: new (transport: unknown, options: unknown) => PredPredictorSurface;
  /** THE shared reference step function — one implementation, used by predictor AND instrumenter. */
  flatDirectStep(pose: { x: number; z: number }, drive: { moveX: number; moveZ: number }, dtSeconds: number, speed: number): { x: number; z: number };
}

/** One adoption corroboration row (slice 5 review item 3): the reconcile's REAL state change. */
interface PredAdoptionRow {
  readonly reconcileSeq: number;
  readonly atMs: number;
  readonly epoch: number;
  readonly authorityTick: number;
  readonly adoptedAck: number;
  readonly prevAdoptedAck: number;
  readonly boundaries: readonly {
    ackFrom: number;
    ackTo: number;
    status: string;
    correctionX: number;
    correctionZ: number;
    directlyAdopted: boolean;
  }[];
  readonly coverageComplete: boolean;
  readonly attributedX: number;
  readonly attributedZ: number;
  readonly unresolvedSteppedX: number;
  readonly unresolvedSteppedZ: number;
  readonly actualAdoptionDeltaX: number;
  readonly actualAdoptionDeltaZ: number;
  readonly residualX: number;
  readonly residualZ: number;
  readonly maxAbsResidualMetres: number;
}

interface PredSeatWindow {
  __udgPredSeat?: {
    readonly transport: PredTransportSurface;
    readonly predictor: PredPredictorSurface;
    readonly roomId: string;
    readonly sessionId: string;
    generation: number;
    moverStop: boolean;
    moverPause: boolean;
    /** Slice 5 review item 3: hold the FRAME loop off so deliveries batch into one adoption. */
    tickStop: boolean;
    sendOne?: (moveX: number, moveZ: number, direct: boolean) => { seq?: number; error?: string };
    readonly joinEpoch: number;
    readonly joinZ: number;
    /** Protocol §4.2: a new epoch starts a new generation sequence — the mover tracks the epoch. */
    lastSeenEpoch?: number;
  };
  __udgRecSeat?: {
    readonly transport: PredTransportSurface;
    readonly predictor: PredPredictorSurface;
    readonly roomId: string;
    readonly sessionId: string;
    generation: number;
    moverStop: boolean;
    readonly joinEpoch: number;
    readonly joinZ: number;
    lastSeenEpoch?: number;
  };
  __udgRetSeat?: {
    readonly transport: PredTransportSurface;
    readonly predictor: PredPredictorSurface;
    readonly roomId: string;
    readonly sessionId: string;
    generation: number;
    moverStop: boolean;
    burstStop: boolean;
    readonly joinEpoch: number;
    readonly joinZ: number;
    replacementSessionId: string;
    lastSeenEpoch?: number;
    /** RED scenario keeps true: the mover DELIBERATELY violates protocol §4.2 for the red run. */
    continueGeneration?: boolean;
  };
  __udgObsSeat?: {
    readonly seat: PageSeatHandle;
    readonly presentation: PageRemotePresentation;
    readonly peerId: string;
    renders: { t: number; x: number; z: number; alpha: number; holding: boolean; fromTick: number; toTick: number }[];
    foldTimer: ReturnType<typeof setInterval> | null;
  };
}


const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * THE DETERMINISTIC TEST-ONLY SERVER SEAM (review item 3). The harness runs the pinned room in
 * this same process; its `tick()` method is PUBLIC, so the test wraps it on the live instance and
 * can FREEZE the authority between two ticks. A refused frame then enters the arrival buffer while
 * time stands still, and the very next tick — labelled by the room's own clock — consumes it. The
 * disposition tick is afterwards read from the room's public per-tick consumption ledger
 * (`tickRecords`): the actual mutation/disposition tick, tied to the exact label (40, 120), read
 * from the server's own record, separate from the delivery tick the client sees. No server file is
 * edited; the wrapper is removed at the end. This is a test-only seam, never shipped behaviour.
 */
interface GatedRoom {
  tick(): void;
  readonly tickRecords: readonly {
    tick: number;
    consumed: readonly { entityId: string; seq: number }[];
    refused?: readonly { entityId: string; count: number }[];
    closures?: readonly { entityId: string; code: number }[];
  }[];
  evidence(): Record<string, unknown>;
}

const gatedRoom = (roomId: string): GatedRoom => {
  const found = (roomClass?.liveRooms() ?? []).find((candidate) => candidate.roomId === roomId);
  if (found === undefined) throw new Error(`no live room ${roomId} for the tick gate`);
  return found as unknown as GatedRoom;
};

const installTickGate = (roomId: string): { room: GatedRoom; hold: () => void; release: () => void; restore: () => void; passOne: () => void } => {
  const room = gatedRoom(roomId);
  const original = room.tick.bind(room);
  const gate = { holding: false, pass: 0 };
  room.tick = (): void => {
    if (gate.pass > 0) {
      gate.pass -= 1;
      original();
      return;
    }
    if (gate.holding) return;
    original();
  };
  return {
    room,
    hold: () => {
      gate.holding = true;
    },
    release: () => {
      gate.holding = false;
    },
    restore: () => {
      gate.holding = false;
      gate.pass = 0;
      room.tick = original;
    },
    // Let EXACTLY ONE authority step run, then freeze again. With the mover driven from here,
    // this turns the whole correction phase into a lockstep: one input staged, one tick stepped,
    // the room's own ledger recording which seq each tick consumed.
    passOne: () => {
      gate.pass += 1;
    },
  };
};

test('prediction slice: pinned prediction, two server-forced corrections consumed at EXACTLY authority ticks 40 and 120 via the test-only tick gate, matched-ack corrections, exactly-once replay identity, deadline recovery, read-only interpolation', async () => {
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
      const seat = (globalThis as unknown as PredSeatWindow).__udgPredSeat;
      if (seat === undefined || !seat.tickStop) predictor.tick(performance.now());
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    const row0 = predictor.replicated();
    (globalThis as unknown as PredSeatWindow).__udgPredSeat = {
      transport: joined.transport,
      predictor,
      roomId: joined.roomId,
      sessionId: joined.sessionId,
      tickStop: false,
      generation: 1,
      moverStop: true,
      moverPause: false,
      joinEpoch: joined.transport.issuedEpoch(),
      joinZ: row0?.z ?? 0,
      lastSeenEpoch: joined.transport.issuedEpoch(),
    };
    const seatWindow = (globalThis as unknown as PredSeatWindow).__udgPredSeat;
    if (seatWindow !== undefined) {
      // The lockstep driver: one staged frame per call, through the SAME predictor.send path, so
      // the journal, the guard and the checkpoint instrumenter see exactly what a live seat sees.
      seatWindow.sendOne = (moveX: number, moveZ: number, direct: boolean): { seq?: number; error?: string } => {
        try {
          const frame = seatWindow.predictor.send({ generation: seatWindow.generation, moveX, moveZ }, direct);
          seatWindow.generation += 1;
          return { seq: frame.seq };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      };
    }
    return { ok: true as const, roomId: joined.roomId, sessionId: joined.sessionId, epoch: joined.transport.issuedEpoch(), beforeFirstFrame, framesStart: frames };
  }, { endpoint: fixture?.endpoint ?? '', join: { mode: 'create', roomName: ROOM_NAME }, presentation: fixture?.presentation ?? {}, adapterUrl: ADAPTER_URL, speed: movementSpeed, ledgerLimit });
  expect(joinM.ok, `fixture seat joined: ${JSON.stringify(joinM)}`).toBe(true);
  const roomId = joinM.roomId as string;

  // ---- FREEZE THE AUTHORITY NOW, while the room is still young (the assignment pins the
  // corrections to authority ticks 40 and 120 — the gate must take control before tick ~36).
  // Everything until `gate.restore()` is lockstep: node stages one input, lets exactly ONE
  // authority step run, and reads back what that tick consumed from the room's own ledger.
  const gate = installTickGate(roomId);
  gate.hold();
  const frozenAt = Number(gate.room.evidence()['ticks'] ?? -1);

  // ---- the observer: the ordinary production seat, sending nothing, rendering with delay.
  const pageO = await openSeatPage('pred-O', { bare: true });
  // The join runs CONCURRENTLY with the lockstep pump below: the room writes a seat's row on
  // its first tick, and the pump supplies ticks while wall time supplies the handshake.
  const observerJoin = pageO.evaluate(async (args) => {
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

  check('pred: canonical state is never held by the seat (the server owns it; the reader is structurally null)', joinM.beforeFirstFrame.canonical === null, joinM.beforeFirstFrame);
  check(
    'pred: the SDK decoded deliveries but reconciled NOTHING before the seat ticked a verified delivery (no raw/predicted state exists yet)',
    joinM.beforeFirstFrame.deliveries >= 1 && joinM.beforeFirstFrame.reconciled === 0 && joinM.beforeFirstFrame.rawPredicted === null && joinM.beforeFirstFrame.presentation === null,
    joinM.beforeFirstFrame,
  );
  check('pred: input is gated on a verified snapshot before any send is allowed', joinM.beforeFirstFrame.snapshotReady === true, joinM.beforeFirstFrame);


  // The advertised fixed rate: the negative-control detector for a missing rate must be armed
  // and silent — the predictor only ever steps with the advertised dt.
  const advertisedM = await pageM.evaluate(() => {
    const h = (globalThis as unknown as PredSeatWindow).__udgPredSeat;
    if (h === undefined) throw new Error('no fixture seat');
    return { missingRateTicks: h.predictor.tickLedger().filter((row) => row.reason === 'missing-advertised-rate').length };
  });
  check('pred: the room advertised its fixed rate and the missing-rate refusal never fired', advertisedM.missingRateTicks === 0 && tickRate === 20, { ...advertisedM, tickRate });


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


  // ---- LOCKSTEP: one input staged, exactly one authority step, per iteration. The refused
  // frames are staged AT the pump iterations that reach absolute ticks 40 and 120 — the pump
  // itself is the clock, so "exactly tick 40 / 120" is a construction, not a race won.
  const sendOne = async (drive: { mx: number; mz: number; direct: boolean }): Promise<number> => {
    const sent = await pageM.evaluate((d) => {
      const w = (globalThis as unknown as PredSeatWindow).__udgPredSeat;
      if (w === undefined || w.sendOne === undefined) throw new Error('no fixture seat');
      return w.sendOne(d.mx, d.mz, d.direct);
    }, drive);
    if (sent.seq === undefined) throw new Error(`lockstep send refused: ${sent.error ?? 'unknown'}`);
    return sent.seq;
  };
  const pumpOne = async (target: number): Promise<void> => {
    gate.passOne();
    const until = Date.now() + 4000;
    while (Number(gate.room.evidence()['ticks'] ?? -1) < target) {
      if (Date.now() > until) throw new Error(`authority never advanced to tick ${String(target)}`);
      await sleep(4);
    }
  };
  const mixedSeqs: number[] = [];
  let stage1Seq = -1;
  let stage2Seq = -1;
  check('pred: the tick gate took control of the authority early enough for the assignment labels (frozen before tick 36)', frozenAt >= 0 && frozenAt <= 35, { frozenAt });
  try {
    for (let target = frozenAt + 1; target <= 126; target += 1) {
      const since = target - frozenAt;
      // The room labels a step by the tick counter BEFORE that step (its tickRecords and replica
      // rows both use that convention; `evidence().ticks` is the completed-step count). So the
      // step LABELED 40 / 120 is the one taken when the completed count is 40 / 120 about to
      // become 41 / 121 — stage when the pump target implies the desired label.
      if (target === 41) {
        stage1Seq = (await stageRefusedFrame(0)).stagedSeq;
      } else if (target === 121) {
        stage2Seq = (await stageRefusedFrame(0.004)).stagedSeq;
      } else if (since <= 4) {
        mixedSeqs.push(await sendOne({ mx: 1, mz: 0, direct: true }));
      } else if (since <= 8) {
        mixedSeqs.push(await sendOne({ mx: Math.SQRT1_2, mz: Math.SQRT1_2, direct: true }));
      } else if (since <= 12) {
        mixedSeqs.push(await sendOne({ mx: 0, mz: 0, direct: false }));
      } else {
        await sendOne({ mx: 0, mz: 1, direct: true });
      }
      await pumpOne(target);
    }
  } finally {
    gate.restore();
  }

  // The room's OWN per-tick consumption ledger decides what each tick consumed: the refused
  // frames must sit in the records for EXACTLY ticks 40 and 120.
  const records = gatedRoom(roomId).tickRecords;
  const consumedAtTick = (seq: number): number =>
    records.find((record) => record.consumed.some((entry) => entry.entityId === joinM.sessionId && entry.seq === seq))?.tick ?? -1;
  const disposition1 = consumedAtTick(stage1Seq);
  const disposition2 = consumedAtTick(stage2Seq);
  check('pred: the room\'s own consumption ledger shows the refused frames consumed at EXACTLY authority ticks 40 and 120 (the test-only tick-gate seam made that construction, not timing luck)',
    disposition1 === 40 && disposition2 === 120,
    { stage1Seq, stage2Seq, disposition1, disposition2, frozenAt });

  // Review-amendment sentinel: this room — including the two exact 40/120 dispositions above —
  // stepped its authority through the wrapper around THE shared kernel function for EVERY tick.
  // The vectors the browser comparisons expect are computed from the same function object.
  check('pred: the live room stepped the authority through the shared-kernel wrapper (trusted stepperFactory) — the sentinel counts every authority step, and the exact 40/120 refusals above were produced by THE same flatDirectStep the client and the trace import',
    (kernelStepper?.kernelStepperSentinel.calls ?? 0) > 120, { kernelStepCalls: kernelStepper?.kernelStepperSentinel.calls ?? -1 });

  // No second authority step: the server\'s own per-tick consumption ledger never shows the same
  // sequence number consumed twice, on any tick, for this entity.
  const consumption = records
    .flatMap((record) => record.consumed.filter((entry) => entry.entityId === joinM.sessionId).map((entry) => entry.seq));
  const duplicateConsumptions = consumption.length - new Set(consumption).size;
  check('pred: no second authority step — every input seq appears in AT MOST ONE tick consumption record (rooms own ledger, whole run)',
    duplicateConsumptions === 0 && consumption.length > 60,
    { consumedCount: consumption.length, duplicateConsumptions });

  await pageM.waitForTimeout(400);
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

  const joinO = await observerJoin;
  expect(joinO.ok, 'observer seat joined').toBe(true);
  const observerStartZ = joinO.self?.z ?? 0;

  await pageM.waitForTimeout(500);
  await pageM.evaluate(() => {
    const h = (globalThis as unknown as PredSeatWindow).__udgPredSeat;
    if (h === undefined) throw new Error('no fixture seat');
    h.moverStop = true;
  });
  await pageM.waitForTimeout(400);

  // ---- the matched-ack correction ledger: the REAL metric (review item 2), evaluated against
  // the refused frame's step vector computed with the SAME shared `flatDirectStep` the predictor
  // and the instrumenter use — one function, not two implementations kept in parity by a test.
  const matched = await pageM.evaluate((args) => {
    const h = (globalThis as unknown as PredSeatWindow).__udgPredSeat;
    if (h === undefined) throw new Error('no fixture seat');
    return (async () => {
      const mod = (await import(/* @vite-ignore */ args.adapterUrl)) as PredModuleSurface;
      const matched = h.predictor.matchedCorrections();
      const identities = h.predictor.replayIdentityLedger();
      const endPose = h.predictor.endPoseDiagnostics();
      const covering = (seq: number) => matched.filter((row) => row.status === 'measured' && row.seqs.includes(seq));
      const refusal1 = covering(args.stage1Seq);
      const refusal2 = covering(args.stage2Seq);
      // The expected corrections, from the shared reference step function itself.
      const expect1 = mod.flatDirectStep({ x: 0, z: 0 }, { moveX: 0, moveZ: 1 }, args.dtSeconds, args.speed);
      const expect2 = mod.flatDirectStep({ x: 0, z: 0 }, { moveX: 0.004, moveZ: 1 }, args.dtSeconds, args.speed);
      const nonZeroMeasured = matched
        .filter((row) => row.status === 'measured' && row.magnitude > 0.000001)
        .map((row) => ({ tick: row.authorityTick, ackFrom: row.ackFrom, ackTo: row.ackTo, cx: row.correctionX, cz: row.correctionZ, mag: row.magnitude }));
      // Negative control: the mixed-drive window (seqs 2..25: +x, diagonal, neutral) must measure
      // EXACTLY zero, while the rejected pending x step approximation — and the old end-pose
      // excess diagnostic — would have flagged those very boundaries.
      const mixedSet = new Set<number>(args.mixedSeqs as number[]);
      const mixedRows = matched.filter((row) => row.status === 'measured' && row.seqs.some((seq) => mixedSet.has(seq)));
      const mixedAllZero = mixedRows.every((row) => row.magnitude < 0.000001);
      const mixedLegacyFlags = mixedRows.filter((row) => row.legacyPendingApproximationMetres > 0.0001).length;
      let oldEndPoseFalsePositives = 0;
      for (const row of endPose) {
        if (row.authorityTick >= args.mixedTickFrom && row.authorityTick <= args.mixedTickTo) {
          const ex = row.endPoseDeltaZ - row.pendingCount * args.stepMetres;
          if (Math.abs(ex) > 0.000001) oldEndPoseFalsePositives += 1;
        }
      }
      const nonEmpty = identities.filter((row) => row.pendingSeqs.length > 0);
      let maxResidual = 0;
      for (const row of identities) if (row.maxAbsResidualMetres > maxResidual) maxResidual = row.maxAbsResidualMetres;
      return {
        refusal1, refusal2, expect1, expect2, nonZeroMeasured,
        mixedRowCount: mixedRows.length, mixedAllZero, mixedLegacyFlags, oldEndPoseFalsePositives,
        stats: h.predictor.matchedInstrumentStats(),
        identityCount: identities.length,
        nonEmptyIdentityCount: nonEmpty.length,
        maxIdentityResidual: maxResidual,
        endPoseRows: endPose.length,
        state: h.predictor.stateName(),
      };
    })();
  }, { adapterUrl: ADAPTER_URL, stage1Seq, stage2Seq, dtSeconds: 1 / tickRate, speed: movementSpeed, stepMetres, mixedSeqs, mixedTickFrom: frozenAt, mixedTickTo: frozenAt + 13 });

  const r1 = matched.refusal1[0];
  const r2 = matched.refusal2[0];
  check('pred: each server-forced refusal measures as EXACTLY the refused frame step vector at the matched ack boundary (x and z, <1e-6 m) — correction attributed to the disposition tick 40 / 120 tied by the server seam, the delivery tick recorded separately',
    r1 !== undefined && r2 !== undefined
    && Math.abs(r1.correctionX - matched.expect1.x) < 0.000001 && Math.abs(r1.correctionZ - matched.expect1.z) < 0.000001
    && Math.abs(r2.correctionX - matched.expect2.x) < 0.000001 && Math.abs(r2.correctionZ - matched.expect2.z) < 0.000001
    && r1.authorityTick >= 40 && r1.authorityTick <= 46 && r2.authorityTick >= 120 && r2.authorityTick <= 126,
    { r1, r2, expect1: matched.expect1, expect2: matched.expect2, stage1Seq, stage2Seq, disposition1, disposition2 });
  check('pred: exactly TWO non-zero measured corrections in the whole run (only the two genuine refusals); every other matched ack is measured and zero — each eligible ack exactly once (monotone cursor is asserted by the unit suite against the same code)',
    matched.nonZeroMeasured.length === 2 && matched.stats.measured === matched.stats.zero + 2 && matched.stats.measured > 20,
    { nonZero: matched.nonZeroMeasured, stats: matched.stats });
  check('pred: negative control — across the MIXED-drive window (turns, diagonal, neutral inputs) every matched correction is exactly zero, while the rejected pending x step metric would have flagged it and the old end-pose diagnostic produced false positives',
    matched.mixedRowCount >= 3 && matched.mixedAllZero && matched.mixedLegacyFlags >= 3 && matched.oldEndPoseFalsePositives >= 3,
    matched);
  check('pred: pure-flat replay convergence — adopted ⊕ Σ step(pending) − raw is under 1e-6 m at EVERY reconcile including the windows right after each forced correction (each remaining seq stepped exactly once, no extra authority step)',
    matched.identityCount > 20 && matched.nonEmptyIdentityCount >= 5 && matched.maxIdentityResidual < 0.000001,
    { identityCount: matched.identityCount, nonEmpty: matched.nonEmptyIdentityCount, maxResidual: matched.maxIdentityResidual });

  // ---- the steady state around the corrections: replay identity on EVERY reconcile, and the
  //      renamed end-pose diagnostic kept as what it is — a diagnostic, not the correction.
  const steady = await pageM.evaluate(() => {
    const h = (globalThis as unknown as PredSeatWindow).__udgPredSeat;
    if (h === undefined) throw new Error('no fixture seat');
    const identities = h.predictor.replayIdentityLedger();
    let identityViolations = 0;
    let emptyWindows = 0;
    let nonEmptyWindows = 0;
    for (const row of identities) {
      if (row.maxAbsResidualMetres > 0.000001) identityViolations += 1;
      if (row.pendingSeqs.length === 0) emptyWindows += 1;
      else nonEmptyWindows += 1;
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
      identities: identities.length,
      identityViolations,
      emptyWindows,
      nonEmptyWindows,
      endPoseRows: h.predictor.endPoseDiagnostics().length,
      maxSeqDelta,
      reconciledTicks: ticks.filter((row) => row.action === 'reconciled').length,
      skippedTicks: ticks.filter((row) => row.action === 'skipped').length,
      deliveries: h.predictor.deliveryLedger().length,
      accepted: h.predictor.deliveryLedger().filter((row) => row.accepted).length,
      prune: h.predictor.pruneAuthorityLedger(),
      pendingNow: h.predictor.pendingJournal().length,
      sent: h.predictor.sentAudit().length,
      byEpoch: [...new Set(h.predictor.sentAudit().map((row) => row.epoch))],
      matched: h.predictor.matchedInstrumentStats(),
    };
  }, {});
  check('pred: the replay identity (adopted + pending replayed once - raw) holds within 1e-6 m at EVERY reconcile across the whole run — zero double-step/double-replay evidence anywhere', steady.identityViolations === 0 && steady.identities > 20, steady);
  check('pred: at most one reconcile per frame tick (reconcileSeq never advances by more than one)', steady.maxSeqDelta <= 1, steady);
  check('pred: matched-ack accounting covers the run — every advancing ack boundary measured once (nonzero ones are exactly the two refusals, checked above), and empty-pending windows reconcile with zero residual too',
    // emptyWindows >= 1 is structural: the settle drain after the loop stops always reconciles
    // with an empty pending window. The identity check above already demands zero residual there.
    steady.emptyWindows >= 1 && steady.nonEmptyWindows >= 5 && steady.matched.measured === steady.matched.zero + 2, steady);
  check('pred: pruning authority is inputResolvedThrough ONLY — the SDK ack watermark pruned nothing all run, and every sent frame is accounted for (pruned-by-resolution or still pending, never forgotten)', steady.prune.byAckWatermark === 0 && steady.prune.byResolvedThrough + steady.pendingNow === steady.sent && steady.sent > 30, steady);
  check('pred: every accepted delivery paired ack with resolution on one epoch (the guard saw the pair the SDK owed)', steady.accepted >= steady.matched.measured, steady);

  // ---- SAME-FUNCTION IDENTITY (slice 5 review item 1): the adapter's public re-export and the
  // kernel module resolve to ONE function object inside the page's module graph — the reconciler,
  // the instrumenter and these in-page expectations all step with that single function.
  const sameFunction = await pageM.evaluate(async (args) => {
    const adapter = (await import(/* @vite-ignore */ args.adapterUrl)) as PredModuleSurface;
    const kernel = (await import(/* @vite-ignore */ args.kernelUrl)) as { flatDirectStep: unknown };
    return { identity: (adapter as unknown as { flatDirectStep: unknown }).flatDirectStep === kernel.flatDirectStep };
  }, { adapterUrl: ADAPTER_URL, kernelUrl: '/src/network/flatStep.ts' });
  check('pred: the step relation is ONE function object in the browser graph — adapter re-export and kernel module are identical (no second formula, no parity-as-sole-evidence)', sameFunction.identity, sameFunction);

  // ---- ADOPTION CORROBORATION UNDER RENDER BATCHING (slice 5 review item 3). The review's exact
  // scenario: a refused frame, then ANOTHER advancing matched delivery, both before the next
  // predictor tick. Deliveries must not adopt (the adoption ledger stays empty however many
  // matched deliveries land); ONE reconcile then adopts the batch; the adoption row must then
  // balance against REAL controller behaviour — the actual pose delta equals the attributed
  // corrections plus the unresolved tail, and the refusal is attributed to exactly one boundary
  // (reconstructed inside the adoption, since only the LATEST state is the direct SDK adoption).
  // The probe only observes: it reads ledgers and stages input through the same public handle
  // the lockstep pump used; nothing in this section writes predictor or SDK state.
  const batching = await pageM.evaluate(async (args) => {
    const h = (globalThis as unknown as PredSeatWindow).__udgPredSeat;
    if (h === undefined) throw new Error('no fixture seat');
    const adapter = (await import(/* @vite-ignore */ args.adapterUrl)) as PredModuleSurface;
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    const waitFor = async <T>(read: () => T | null, ms: number): Promise<T | null> => {
      const until = performance.now() + ms;
      for (;;) {
        const value = read();
        if (value !== null) return value;
        if (performance.now() > until) return null;
        await sleep(20);
      }
    };
    // Quiesce, then hold the frame loop: deliveries keep being ACCEPTED (that is the SDK's own
    // subscription path), but no reconcile can run — the batch window.
    h.moverStop = true;
    await sleep(300);
    h.tickStop = true;
    const adoptionsBefore = h.predictor.adoptionLedger().length;
    const reconcilesBefore = h.predictor.tickLedger().filter((row) => row.action === 'reconciled').length;
    // 1) a frame the AUTHORITY refuses (generation 0 beside the live watermark, public handle):
    // resolved by the next ticks, NO motion — a matched delivery whose ack advances.
    const handle = h.transport.handle();
    const epoch = h.transport.issuedEpoch();
    handle.data.sessionEpoch = epoch;
    handle.data.generation = 0;
    handle.data.directIntent = true;
    handle.data.moveX = 0;
    handle.data.moveZ = 1;
    handle.data.seq = handle.sentCount + 1;
    const refusedSeq = handle.send();
    const refusedDelivery = await waitFor(() => {
      const row = h.predictor.replicated();
      return row !== null && row.ack >= refusedSeq ? row : null;
    }, 6000);
    // 2) INSIDE THE SAME batch (still zero ticks): another advancing matched delivery, this one
    // consumed and MOVED by the authority.
    h.predictor.send({ generation: h.generation, moveX: 0, moveZ: 1 }, true);
    h.generation += 1;
    const advancedSeq = refusedSeq + 1;
    const advancedDelivery = await waitFor(() => {
      const row = h.predictor.replicated();
      return row !== null && row.ack >= advancedSeq ? row : null;
    }, 6000);
    const adoptionsDuringBatch = h.predictor.adoptionLedger().length - adoptionsBefore;
    const reconcilesDuringBatch = h.predictor.tickLedger().filter((row) => row.action === 'reconciled').length - reconcilesBefore;
    // 3) the render loop returns: exactly ONE reconcile adopts the whole batch.
    h.tickStop = false;
    const adoption = await waitFor(() => {
      const rows = h.predictor.adoptionLedger();
      return rows.length > adoptionsBefore ? (rows[rows.length - 1] as PredAdoptionRow) : null;
    }, 3000);
    if (refusedDelivery === null || advancedDelivery === null || adoption === null) {
      return {
        failed: 'timing',
        refusedSeq, adoptedAck: -1, prevAdoptedAck: -1, coverageComplete: false, boundaryCount: -1,
        adoptionsDuringBatch, reconcilesDuringBatch, coveringCount: -1, coveringDirect: false,
        coveringMagnitude: -1, expectedRefusedStepMetres: Number.NaN, attributedCount: -1,
        lastDirectlyAdopted: false, lastAckTo: -1, maxResidualMetres: Number.NaN,
        actualAdoptionDeltaZ: Number.NaN, attributedZ: Number.NaN, unresolvedSteppedZ: Number.NaN,
        matchedRowsCoveringRefused: -1,
        statsIncomplete: h.predictor.matchedInstrumentStats().adoptionCoverageIncomplete,
      };
    }
    // The expectation for the refused frame's step, computed with the SAME shared function the
    // reconciler steps with — not a separately written formula.
    const refusedStep = adapter.flatDirectStep({ x: 0, z: 0 }, { moveX: 0, moveZ: 1 }, args.stepSeconds, args.speed);
    const covering = adoption.boundaries.filter((b) => b.ackFrom < refusedSeq && refusedSeq <= b.ackTo);
    const attributedBoundaries = adoption.boundaries.filter((b) => Math.hypot(b.correctionX, b.correctionZ) > 1e-6);
    const lastBoundary = adoption.boundaries[adoption.boundaries.length - 1];
    return {
      failed: '',
      refusedSeq,
      adoptedAck: adoption.adoptedAck,
      prevAdoptedAck: adoption.prevAdoptedAck,
      coverageComplete: adoption.coverageComplete,
      boundaryCount: adoption.boundaries.length,
      adoptionsDuringBatch,
      reconcilesDuringBatch,
      coveringCount: covering.length,
      coveringDirect: covering.length === 1 ? (covering[0]?.directlyAdopted ?? false) : false,
      coveringMagnitude: covering.length === 1 ? Math.hypot((covering[0]?.correctionX ?? 0) + 0, covering[0]?.correctionZ ?? 0) : -1,
      expectedRefusedStepMetres: refusedStep.z,
      attributedCount: attributedBoundaries.length,
      lastDirectlyAdopted: lastBoundary?.directlyAdopted ?? false,
      lastAckTo: lastBoundary?.ackTo ?? -1,
      maxResidualMetres: adoption.maxAbsResidualMetres,
      actualAdoptionDeltaZ: adoption.actualAdoptionDeltaZ,
      attributedZ: adoption.attributedZ,
      unresolvedSteppedZ: adoption.unresolvedSteppedZ,
      matchedRowsCoveringRefused: h.predictor.matchedCorrections().filter((r) => r.status === 'measured' && r.seqs.includes(refusedSeq)).length,
      statsIncomplete: h.predictor.matchedInstrumentStats().adoptionCoverageIncomplete,
    };
  }, { adapterUrl: ADAPTER_URL, stepSeconds: 1 / tickRate, speed: movementSpeed });
  observations['predBatchAdoption'] = batching;
  const batchOk = batching.failed === '';
  check('pred: batched control: deliveries never adopt — a refused frame plus an advancing matched delivery in one render batch produce ZERO reconciles while the frame loop is held',
    batchOk && batching.adoptionsDuringBatch === 0 && batching.reconcilesDuringBatch === 0, batching);
  check('pred: batched control: the single reconcile adopts the batch to the LATEST ack with a fully chained coverage span (no unobservable hole inside the adoption)',
    batchOk && batching.adoptedAck === batching.refusedSeq + 1 && batching.coverageComplete === true && batching.boundaryCount >= 2 && batching.statsIncomplete === 0, batching);
  check('pred: batched control: the refusal is attributed to EXACTLY ONE boundary — the refused seq\'s own span, magnitude equal to the shared function\'s refused step, and that boundary is flagged RECONSTRUCTED (the direct adoption boundary is the latest ack)',
    batchOk && batching.coveringCount === 1 && batching.coveringDirect === false && batching.attributedCount === 1
    && Math.abs(batching.coveringMagnitude - batching.expectedRefusedStepMetres) < 1e-6
    && batching.lastDirectlyAdopted === true && batching.lastAckTo === batching.refusedSeq + 1
    && batching.matchedRowsCoveringRefused === 1, batching);
  check('pred: batched control: adoption conservation on REAL behaviour — rawBefore minus adopted equals attributed corrections plus the unresolved tail within 1e-6 m (no hypothetical rebase on an unapplied delivery could satisfy this), and the raw pose had actually stepped both batched frames',
    batchOk && batching.maxResidualMetres < 1e-6
    && Math.abs(batching.actualAdoptionDeltaZ - batching.expectedRefusedStepMetres) < 1e-6
    && Math.abs(batching.unresolvedSteppedZ) < 1e-9, batching);

  // ---- several verified patches between two frames still reconcile exactly once.
  // Restart the movement loop for the stall window: the room publishes against consumption, so
  // patches only queue up while the seat is actually sending. The stall then misses real patches.
  await pageM.evaluate(() => {
    const h = (globalThis as unknown as PredSeatWindow).__udgPredSeat;
    if (h === undefined) throw new Error('no fixture seat');
    h.moverStop = false;
    const step = (): void => {
      if (h.moverStop) return;
      // Protocol §4.2: a new epoch starts a NEW generation sequence (the core resets the watermark
      // to zero on epoch change), so a mover that crosses an epoch boundary must restart its
      // counter — otherwise the forward-gap screen refuses every frame.
      const rowEpoch = h.predictor.replicated()?.epoch;
      if (rowEpoch !== undefined && rowEpoch !== h.lastSeenEpoch) { h.lastSeenEpoch = rowEpoch; h.generation = 1; }
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
    const baseCorrections = h.predictor.endPoseDiagnostics().length;
    const baseDeliveries = h.predictor.deliveryLedger().length;
    const deadline = performance.now() + 3000;
    while (performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 4));
      if (h.predictor.endPoseDiagnostics().length > baseCorrections) break;
    }
    return {
      deliveryDelta: h.predictor.deliveryLedger().length - baseDeliveries,
      correctionDelta: h.predictor.endPoseDiagnostics().length - baseCorrections,
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
  // The refused-send attempts and the retry records are part of the story but not the ladder;
  // the ladder milestones must appear, in this relative order, among the ledger's own events.
  const ladder = recovery.events.filter((event: string) => event !== 'send-refused');
  const ladderIndex = wantedOrder.map((event) => ladder.indexOf(event));
  const orderOk = ladderIndex.every((index) => index >= 0) && ladderIndex.every((index, k) => k === 0 || index > (ladderIndex[k - 1] as number));
  check('pred: a delivery stream stalled by real network loss with input outstanding runs the ADR-0003 §3.2 ledger in the browser, in order: deadline trigger, stop sending, discard, bounded rejoin attempts under retry semantics, suspension',
    orderOk && /snapshot-deadline-expired/.test(recovery.triggerDetail) && recovery.stateNow === 'suspended', recovery);
  check('pred: while suspended the seat sends nothing when asked, keeps the journal discarded, and holds the LAST verified pose — suspension is holding, not drifting; the attempts stayed inside the rolling allowance (retry semantics spend the allowance, never exceed it)',
    /recovery/.test(recovery.sendRefusedDuringRecovery) && recovery.journalDuringRecovery === 0
    && recovery.heldDuringRecovery !== null && heldBefore.held !== null
    && Math.abs(recovery.heldDuringRecovery.z - heldBefore.held.z) < 0.000001
    && recovery.rejoins >= 1 && recovery.rejoins <= 2 && recovery.epochNow === heldBefore.epoch, recovery);

  // ---- the room's own view, read in-process: ticks advanced, refusal stats exist, nothing crashed.
  const evidence = (roomClass?.liveRooms() ?? []).find((room) => room.roomId === roomId)?.evidence();
  check('pred: the authority clock passed 120 and the room stayed healthy through two refusals and an epoch change',
    Number((evidence?.['ticks'] ?? 0) as number) >= 126 && evidence?.['refused'] !== true,
    { ticks: evidence?.['ticks'], stats: evidence?.['stats'] });
  observations['predEvidence'] = evidence ?? {};
  observations['predRecovery'] = recovery;
  observations['predSteady'] = steady;
  observations['predGate'] = { stage1Seq, stage2Seq, disposition1, disposition2, frozenAt, consumption: { consumedCount: consumption.length, duplicateConsumptions } };
  observations['predMatched'] = { stats: matched.stats, nonZero: matched.nonZeroMeasured, mixed: { rows: matched.mixedRowCount, allZero: matched.mixedAllZero, legacyFlags: matched.mixedLegacyFlags, oldFalsePositives: matched.oldEndPoseFalsePositives }, maxIdentityResidual: matched.maxIdentityResidual, r1, r2 };

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

/**
 * Recovery that ACTUALLY REJOINS, in the browser, under real impairment (review item 1):
 * offline with input outstanding → deadline trigger → stop/discard/hold → attempt 1 fails while
 * the network is still down → the ADR retry semantics schedule the next bounded attempt → the
 * network returns before it → the attempt succeeds → the seat attaches a NEW transport, receives
 * the NEW domain's fresh snapshot, and only then resumes — movement continues, corrections stay
 * zero, and nothing from the old domain replayed, re-issued, or completed the recovery.
 */
test('recovery resumes through a real rejoin and a fresh snapshot once the network returns (bounded retries, no stale-domain recovery)', async () => {
  expect(fixture, 'the room fixture booted').toBeDefined();
  const pageR = await openSeatPage('rec-R', { bare: true });
  const movementSpeed = fixture?.movementSpeed ?? 0;
  const joinR = await pageR.evaluate(async (args) => {
    const adapter = (await import(/* @vite-ignore */ args.adapterUrl)) as PredModuleSurface;
    const joined = await adapter.createSdkSeatTransport({
      endpoint: args.endpoint,
      join: args.join,
      presentation: args.presentation,
      epochTimeoutMs: 15_000,
    });
    const predictor = new adapter.DirectMotionPredictor(joined.transport, {
      speed: args.speed,
      ledgerLimit: 20_000,
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
    const raf = (): void => {
      predictor.tick(performance.now());
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    (globalThis as unknown as PredSeatWindow).__udgRecSeat = {
      transport: joined.transport,
      predictor,
      roomId: joined.roomId,
      sessionId: joined.sessionId,
      generation: 1,
      moverStop: false,
      joinEpoch: joined.transport.issuedEpoch(),
      joinZ: predictor.replicated()?.z ?? 0,
      lastSeenEpoch: joined.transport.issuedEpoch(),
    };
    const step = (): void => {
      const h = (globalThis as unknown as PredSeatWindow).__udgRecSeat;
      if (h === undefined || h.moverStop) return;
      // Protocol §4.2: restart the generation sequence when the epoch changes (the core resets
      // the watermark on epoch change; continuing the counter lands outside the forward gap).
      const rowEpoch = h.predictor.replicated()?.epoch;
      if (rowEpoch !== undefined && rowEpoch !== h.lastSeenEpoch) { h.lastSeenEpoch = rowEpoch; h.generation = 1; }
      try {
        h.predictor.send({ generation: h.generation, moveX: 0, moveZ: 1 }, true);
        h.generation += 1;
      } catch {
        // stop-sending under recovery is the ADR path, not a failure
      }
      setTimeout(step, 50);
    };
    step();
    return { ok: true as const, roomId: joined.roomId, epoch: joined.transport.issuedEpoch() };
  }, { endpoint: fixture?.endpoint ?? '', join: { mode: 'create', roomName: ROOM_NAME }, presentation: fixture?.presentation ?? {}, adapterUrl: ADAPTER_URL, speed: movementSpeed });
  expect(joinR.ok, `recovery seat joined: ${JSON.stringify(joinR)}`).toBe(true);

  // Let a clean baseline exist, then cut the network with inputs outstanding.
  await pageR.waitForTimeout(1200);
  await pageR.context().setOffline(true);

  // Wait (in-page) until the ledger shows the FIRST rejoin attempt — it happens while offline and
  // must fail; only then does the test restore the network, so the SECOND bounded attempt is the
  // one that can succeed.
  const attempted = await pageR.evaluate(async () => {
    const h = (globalThis as unknown as PredSeatWindow).__udgRecSeat;
    if (h === undefined) throw new Error('no recovery seat');
    // Windows are generous (trigger+first offline attempt needs ~0.8 s in isolation): a loaded
    // runner starves the page's timers, and the CLAIM here is ORDERING (attempt before network
    // return), not latency. Nothing is asserted that a faster run would not also satisfy.
    const deadline = performance.now() + 15_000;
    while (performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      if (h.predictor.recoveryLedger().some((row) => row.event === 'rejoin-attempt')) {
        return {
          attempted: true,
          events: h.predictor.recoveryLedger().map((row) => row.event),
          state: h.predictor.stateName(),
          held: h.predictor.heldSnapshot(),
        };
      }
    }
    return { attempted: false, events: h.predictor.recoveryLedger().map((row) => row.event), state: h.predictor.stateName(), held: h.predictor.heldSnapshot() };
  });
  check('resume-recovery: the deadline trigger and the first (offline) rejoin attempt happened while the network was down',
    attempted.attempted && attempted.state === 'recovering', attempted);
  await pageR.context().setOffline(false);

  const resumed = await pageR.evaluate(async () => {
    const h = (globalThis as unknown as PredSeatWindow).__udgRecSeat;
    if (h === undefined) throw new Error('no recovery seat');
    const deadline = performance.now() + 12_000;
    let recovered = false;
    while (performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (h.predictor.recoveryLedger().some((row) => row.event === 'snapshot-recovered')) {
        recovered = true;
        break;
      }
    }
    if (!recovered) {
      return { recovered: false, events: h.predictor.recoveryLedger().map((row) => row.event), state: h.predictor.stateName() };
    }
    const epochAtRecovery = h.predictor.replicated()?.epoch ?? -1;
    const zAtRecovery = h.predictor.replicated()?.z ?? Number.NaN;
    const matchedAtRecovery = h.predictor.matchedCorrections().length;
    const identitiesAtRecovery = h.predictor.replayIdentityLedger().length;
    // Movement must actually resume on the new domain, with clean corrections. The window is
    // 4 s for a 0.6 m requirement (the seat owes ~4 m/s when consuming) — the threshold stands;
    // only the allowance for a starved runner grows.
    const until = performance.now() + 4000;
    let zNow = zAtRecovery;
    while (performance.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      zNow = h.predictor.replicated()?.z ?? Number.NaN;
      if (zNow - zAtRecovery >= 0.6) break;
    }
    const matchedAfter = h.predictor.matchedCorrections().slice(matchedAtRecovery);
    const measuredAfter = matchedAfter.filter((row) => row.status === 'measured');
    let worstCorrection = 0;
    for (const row of measuredAfter) if (row.magnitude > worstCorrection) worstCorrection = row.magnitude;
    const identitiesAfter = h.predictor.replayIdentityLedger().slice(identitiesAtRecovery);
    let worstResidual = 0;
    for (const row of identitiesAfter) if (row.maxAbsResidualMetres > worstResidual) worstResidual = row.maxAbsResidualMetres;
    const events = h.predictor.recoveryLedger();
    const triggerAt = events.find((row) => row.event === 'trigger')?.atMs ?? Number.MAX_SAFE_INTEGER;
    const reissuedAfterTrigger = h.predictor.sentAudit().filter((row) => row.atMs >= triggerAt && row.epoch !== epochAtRecovery).length;
    h.moverStop = true;
    return {
      recovered: true,
      state: h.predictor.stateName(),
      events: events.map((row) => row.event),
      rejoins: h.predictor.rejoinTimestamps().length,
      epochAtRecovery,
      joinEpoch: h.joinEpoch,
      movedAfterResume: zNow - zAtRecovery,
      measuredAfterCount: measuredAfter.length,
      worstCorrection,
      identitiesAfterCount: identitiesAfter.length,
      worstResidual,
      reissuedAfterTrigger,
    };
  });
  check('resume-recovery: once the network returned, a bounded retry succeeded and recovery completed ONLY through the new domain\'s fresh snapshot (never a late old-room delivery)',
    resumed.recovered === true && resumed.state === 'tracking' && (resumed.rejoins ?? 0) >= 1 && (resumed.rejoins ?? 0) <= 2
    && resumed.epochAtRecovery !== resumed.joinEpoch,
    resumed);
  check('resume-recovery: input resumed after the fresh snapshot and the seat is moving again (>= 0.6 m), with every post-recovery matched correction zero and every replay identity under 1e-6 m',
    resumed.recovered === true && (resumed.movedAfterResume ?? -1) >= 0.6 && (resumed.measuredAfterCount ?? 0) >= 2
    && (resumed.worstCorrection ?? 1) < 0.000001 && (resumed.identitiesAfterCount ?? 0) >= 2 && (resumed.worstResidual ?? 1) < 0.000001,
    resumed);
  check('resume-recovery: nothing from the old domain re-issued after the trigger — discarded pending was never resent on the old epoch',
    resumed.recovered === true && resumed.reissuedAfterTrigger === 0,
    resumed);
  observations['predResumeRecovery'] = resumed;

  await pageR.evaluate(async () => {
    const h = (globalThis as unknown as PredSeatWindow).__udgRecSeat;
    if (h === undefined) return;
    h.moverStop = true;
    try {
      await h.predictor.close();
    } catch {
      // a failed graceful leave after real impairment is recorded, not fatal
    }
  });
  const recErrors = pageErrorSinks.get('rec-R') ?? [];
  check('resume-recovery: no unexpected page or console errors', recErrors.length === 0, recErrors.slice(0, 4));
  await pageR.context().close();
  const resumeFailures = checks.filter((record) => record.name.startsWith('resume-recovery') && !record.ok);
  expect.soft(resumeFailures, `failed resume-recovery checks: ${JSON.stringify(resumeFailures.map((record) => record.name))}`).toEqual([]);
});

/**
 * RETIREMENT, REPLACEMENT AND THE §3.3 CLOSURE — BY EXACT IDENTITY, BOTH EVENTS, WITH THE
 * GENERATION-SEQUENCE BREACH REPRODUCED AS THE RED RUN (slice 5 review item 2, resolved at the
 * amendment round). ADR-0003 §3.1/§3.3 makes a confirmed retirement TWO distinct events, and the
 * earlier EITHER-check (`closeObservations.length >= 1` OR motion) could be satisfied by ANY
 * closure — including the offender's own — even when replacement was broken. The two events, each
 * attributed by exact session/epoch:
 *
 *   EVENT 1 (the offender): the seat that over-ran the authority is closed through the ADR branch:
 *   the room's per-tick CLOSURE ledger attributes a code-4100 closure to the offender's exact
 *   entityId (= its sessionId), and its own §3.1 close observation carries the retirement
 *   (retiredUnrepresented >= 1) and the consumed count frozen at closure.
 *
 *   EVENT 2 (the replacement): a new domain (NEW session — a rejoin through `joinById` is a new
 *   Client on this stack — new epoch) applies a fresh snapshot BEFORE any fresh input AND MOVES:
 *   ≥0.4 m of authoritative travel across the settle window with zero nominal corrections and
 *   zero identity residual, at BOTH rejoin cadences (default ~250 ms ladder and deferred 1500 ms
 *   past the §3.3 window).
 *
 * WHY THERE IS NO SERVER DEFECT HERE: the earlier "consumed-but-frozen replacement" finding was
 * this fixture's own mover CONTINUING the offender's generation sequence into the replacement's
 * new-epoch domain. Protocol §4.2 (`entity.ts::resetForNewEpoch` zeroes the generation watermark;
 * `screen.ts` refuses frames further than MAX_GENERATION_FORWARD_GAP = 64 ahead of it) turns such
 * frames into journalled RESYNC_REQUIRED refusals — a disposition and a NEUTRAL step: consumed,
 * acked, watermark-advanced, unmoving. The RED scenario below keeps that breach under test: it
 * reproduces the frozen signature (room ledger: frames consumed, ZERO wire-level refusals — the
 * refusals are core-screen dispositions) and then runs a SAME-SEAT POSITIVE CONTROL — restart the
 * generation sequence at 1, change nothing else, motion resumes within 2 s — attributing the
 * failure to client frame content, not room state, before any layer is named. CONTROL against the
 * legacy claim: the loose EITHER-check is satisfied by the FROZEN red run while the strict
 * BOTH-events claim fails it; only the protocol-correct green runs satisfy the strict claim.
 * The offline-deadline scenario remains a separate test.
 */
const retirementServerFacts = (roomId: string, sessionId: string): {
  closures: readonly { tick: number; entityId: string; code: number }[];
  closeObservations: readonly { entityId: string; retiredUnrepresented: number; consumedCountAtClose: number }[];
  seats: readonly { entityId: string; epoch: number; retired: number; effects: number; throttled: boolean; resolvedThrough: number; closing: boolean }[];
  retiredTotalWhileRunning: number;
  ticks: number;
  offenderClosures: readonly { tick: number; entityId: string; code: number }[];
  offenderCloseObservations: readonly { entityId: string; retiredUnrepresented: number; consumedCountAtClose: number }[];
} => {
  const room = gatedRoom(roomId);
  const evidence = room.evidence();
  const closures: { tick: number; entityId: string; code: number }[] = [];
  for (const record of room.tickRecords) {
    for (const closure of record.closures ?? []) closures.push({ tick: record.tick, entityId: closure.entityId, code: closure.code });
  }
  const closeObservations = (evidence['closeObservations'] ?? []) as readonly {
    entityId: string; retiredUnrepresented: number; consumedCountAtClose: number;
  }[];
  const seats = (evidence['seats'] ?? []) as readonly {
    entityId: string; epoch: number; retiredUnrepresented: number; effectCount: number; throttled: boolean; resolvedThrough: number; closing: boolean;
  }[];
  return {
    closures,
    closeObservations: closeObservations.map((o) => ({
      entityId: o.entityId,
      retiredUnrepresented: Number(o.retiredUnrepresented),
      consumedCountAtClose: Number(o.consumedCountAtClose),
    })),
    seats: seats.map((s) => ({
      entityId: s.entityId,
      epoch: Number(s.epoch),
      retired: Number(s.retiredUnrepresented),
      effects: Number(s.effectCount),
      throttled: Boolean(s.throttled),
      resolvedThrough: Number(s.resolvedThrough),
      closing: Boolean(s.closing),
    })),
    retiredTotalWhileRunning: seats.reduce((total, s) => total + Number(s.retiredUnrepresented), 0),
    ticks: Number(evidence['ticks'] ?? -1),
    // EVENT 1's identity: entityId === sessionId (authorityEntityId is the session id), code 4100
    // (CLOSE_CODE_INPUT_RETIRED_UNREPRESENTED, protocol-v1: the §3.3 bounded-window closure).
    offenderClosures: closures.filter((c) => c.entityId === sessionId && c.code === 4100),
    offenderCloseObservations: closeObservations
      .map((o) => ({ entityId: o.entityId, retiredUnrepresented: Number(o.retiredUnrepresented), consumedCountAtClose: Number(o.consumedCountAtClose) }))
      .filter((o) => o.entityId === sessionId && o.retiredUnrepresented >= 1),
  };
};

interface RetirementRun {
  ok: boolean;
  roomId: string;
  sessionId: string;
  joinEpoch: number;
  triggered: boolean;
  triggerDetail: string;
  recovered: boolean;
  state: string;
  events: string[];
  sendRefused: string;
  journalDuringRecovery: number;
  journalAtSnapshot: number;
  oldDomainAfterTrigger: number;
  reissuedOldEpoch: number;
  sendsBetweenTriggerAndSnapshot: number;
  rejoins: number;
  epochAtRecovery: number;
  snapshotTickAtRecovery: number;
  replacementSessionId: string;
  movedAfterResume: number;
  measuredAfterCount: number;
  worstCorrection: number;
  worstIdentityResidualAfter: number;
  motionWindow: { sentDelta: number; deliveriesDelta: number; ackAdvanced: number; resolvedAdvanced: number; zAtResume: number; zNow: number; zTraceMin: number; zTraceMax: number; zTraceSpan: number };
  /** RED scenario only: did the mover deliberately continue the old generation sequence (§4.2 breach). */
  continueGeneration: boolean;
  /** RED scenario's positive control: restart the sequence and re-measure motion. */
  controlDeltaZ: number;
  controlSentDelta: number;
  controlWorstCorrection: number;
  controlTailWorstCorrection: number;
}

/** Join a seat, over-run the authority until the SERVER retires inputs, then watch the whole ladder. */
const runRetirementScenario = async (
  seatKey: string,
  rejoinBackoffMs: readonly number[] | null,
  continueGeneration: boolean,
): Promise<{ page: Page; run: RetirementRun; factsAtTrigger: ReturnType<typeof retirementServerFacts> }> => {
  const page = await openSeatPage(seatKey, { bare: true });
  const movementSpeed = fixture?.movementSpeed ?? 0;
  const joined = await page.evaluate(async (args) => {
    const adapter = (await import(/* @vite-ignore */ args.adapterUrl)) as PredModuleSurface;
    const joined = await adapter.createSdkSeatTransport({
      endpoint: args.endpoint,
      join: args.join,
      presentation: args.presentation,
      epochTimeoutMs: 15_000,
    });
    const predictor = new adapter.DirectMotionPredictor(joined.transport, {
      speed: args.speed,
      ledgerLimit: 20_000,
      snapshotDeadlineMs: 500,
      ...(args.rejoinBackoffMs === null ? {} : { rejoinBackoffMs: args.rejoinBackoffMs }),
      rejoin: async () => {
        const again = await adapter.createSdkSeatTransport({
          endpoint: args.endpoint,
          join: { mode: 'byId', roomId: joined.roomId },
          presentation: args.presentation,
          epochTimeoutMs: 15_000,
        });
        // A rejoin through joinById is a NEW Client/session on this stack — record the
        // replacement's OWN session identity on the seat handle for attribution.
        const seatHandle = (globalThis as unknown as PredSeatWindow).__udgRetSeat;
        if (seatHandle !== undefined) seatHandle.replacementSessionId = again.sessionId;
        return again.transport;
      },
    });
    predictor.attach();
    const raf = (): void => {
      predictor.tick(performance.now());
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    (globalThis as unknown as PredSeatWindow).__udgRetSeat = {
      transport: joined.transport,
      predictor,
      roomId: joined.roomId,
      sessionId: joined.sessionId,
      generation: 1,
      moverStop: false,
      burstStop: false,
      joinEpoch: joined.transport.issuedEpoch(),
      joinZ: predictor.replicated()?.z ?? 0,
      replacementSessionId: joined.sessionId,
      lastSeenEpoch: joined.transport.issuedEpoch(),
      continueGeneration: args.continueGeneration,
    };
    // The over-rate loop: 30 ms while bursting (~33/s against 20/s consumption, under the 40/s
    // arrival ceiling), 50 ms afterwards.
    const step = (): void => {
      const h = (globalThis as unknown as PredSeatWindow).__udgRetSeat;
      if (h === undefined || h.moverStop) return;
      // Protocol §4.2: a new epoch starts a NEW generation sequence (the core resets the watermark
      // to zero). The GREEN scenario obeys this; the RED scenario DELIBERATELY ignores it, which
      // is what puts every replacement frame outside MAX_GENERATION_FORWARD_GAP of the fresh
      // watermark and into the journalled RESYNC_REQUIRED refusal (consumed, neutral step).
      if (h.continueGeneration !== true) {
        const rowEpoch = h.predictor.replicated()?.epoch;
        if (rowEpoch !== undefined && rowEpoch !== h.lastSeenEpoch) { h.lastSeenEpoch = rowEpoch; h.generation = 1; }
      }
      try {
        h.predictor.send({ generation: h.generation, moveX: 0, moveZ: 1 }, true);
        h.generation += 1;
      } catch {
        // stop-sending under recovery is the ADR path, not a failure
      }
      setTimeout(step, h.burstStop ? 50 : 30);
    };
    step();
    return { ok: true as const, roomId: joined.roomId, sessionId: joined.sessionId, epoch: joined.transport.issuedEpoch() };
  }, {
    endpoint: fixture?.endpoint ?? '',
    join: { mode: 'create', roomName: ROOM_NAME },
    presentation: fixture?.presentation ?? {},
    adapterUrl: ADAPTER_URL,
    speed: movementSpeed,
    rejoinBackoffMs,
    continueGeneration,
  });
  expect(joined.ok, `the ${seatKey} retirement seat joined`).toBe(true);

  // The SERVER ledger decides the trigger was real: retirement must turn nonzero there.
  const serverDeadline = Date.now() + 25_000;
  let facts = retirementServerFacts(joined.roomId, joined.sessionId);
  while (facts.retiredTotalWhileRunning === 0 && Date.now() < serverDeadline) {
    await sleep(100);
    facts = retirementServerFacts(joined.roomId, joined.sessionId);
  }

  const run = await page.evaluate(async () => {
    const h = (globalThis as unknown as PredSeatWindow).__udgRetSeat;
    if (h === undefined) throw new Error('no retirement seat');
    const scenarioContinueGeneration = h.continueGeneration === true;
    const sleepPage = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    let triggered = false;
    let triggerAt = 0;
    const triggerDeadline = performance.now() + 12_000;
    while (performance.now() < triggerDeadline) {
      await sleepPage(25);
      const events = h.predictor.recoveryLedger();
      const hit = events.find((row) => row.event === 'trigger' && row.detail.includes('retirement-nonzero'));
      if (hit !== undefined) {
        triggered = true;
        triggerAt = hit.atMs;
        break;
      }
    }
    const events = h.predictor.recoveryLedger();
    if (!triggered) {
      return {
        ok: true, roomId: h.roomId, sessionId: h.sessionId, joinEpoch: h.joinEpoch,
        triggered: false, triggerDetail: '', recovered: false, state: h.predictor.stateName(),
        events: events.map((row) => row.event), sendRefused: '', journalDuringRecovery: -1,
        journalAtSnapshot: -1, oldDomainAfterTrigger: -1, reissuedOldEpoch: -1,
        sendsBetweenTriggerAndSnapshot: -1, rejoins: -1, epochAtRecovery: -1,
        snapshotTickAtRecovery: -1, replacementSessionId: '',
        movedAfterResume: 0, measuredAfterCount: 0,
        worstCorrection: 0, worstIdentityResidualAfter: 0,
        continueGeneration: h.continueGeneration === true,
        controlDeltaZ: 0, controlSentDelta: 0, controlWorstCorrection: 0, controlTailWorstCorrection: 0,
        motionWindow: { sentDelta: -1, deliveriesDelta: -1, ackAdvanced: -1, resolvedAdvanced: -1, zAtResume: 0, zNow: 0, zTraceMin: 0, zTraceMax: 0, zTraceSpan: 0 },
      } satisfies RetirementRun;
    }
    const sendRefused = (() => {
      try {
        h.generation += 1;
        h.predictor.send({ generation: h.generation, moveX: 0, moveZ: 1 }, true);
        return 'NOT refused';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    })();
    const journalDuringRecovery = h.predictor.pendingJournal().length;
    let recovered = false;
    let snapshotAtMs = 0;
    const until = performance.now() + 15_000;
    while (performance.now() < until) {
      await sleepPage(50);
      const hit = h.predictor.recoveryLedger().find((row) => row.event === 'snapshot-recovered');
      if (hit !== undefined) {
        recovered = true;
        snapshotAtMs = hit.atMs;
        break;
      }
    }
    const row = h.predictor.replicated();
    const epochAtRecovery = row?.epoch ?? -1;
    const snapshotTickAtRecovery = row?.authorityTick ?? -1;
    const journalAtSnapshot = h.predictor.pendingJournal().length;
    // The replacement's OWN session identity (a rejoin through joinById is a new Client/session).
    const replacementSessionId = h.replacementSessionId;
    const sendsBetweenTriggerAndSnapshot = h.predictor.sentAudit().filter(
      (entry) => entry.atMs >= triggerAt && entry.atMs < snapshotAtMs,
    ).length;
    // Stop the burst; keep driving at the ordinary cadence for a four-second settle and TRACE
    // the replacement's absolute position — this is where a consumable-but-frozen seat shows.
    h.burstStop = true;
    const zAtResume = row?.z ?? Number.NaN;
    const sentBefore = h.predictor.sentAudit().length;
    const deliveriesBefore = h.predictor.deliveryLedger().filter((entry) => entry.accepted).length;
    const ackBefore = row?.ack ?? -1;
    const resolvedBefore = row?.resolvedThrough ?? -1;
    const matchedAtRecovery = h.predictor.matchedCorrections().length;
    const identitiesAtRecovery = h.predictor.replayIdentityLedger().length;
    const settle = performance.now() + 4000;
    let zNow = zAtResume;
    const zTrace: number[] = [];
    while (performance.now() < settle) {
      await sleepPage(100);
      zNow = h.predictor.replicated()?.z ?? Number.NaN;
      zTrace.push(zNow);
    }
    const motionWindow = {
      sentDelta: h.predictor.sentAudit().length - sentBefore,
      deliveriesDelta: h.predictor.deliveryLedger().filter((entry) => entry.accepted).length - deliveriesBefore,
      ackAdvanced: (h.predictor.replicated()?.ack ?? -1) - ackBefore,
      resolvedAdvanced: (h.predictor.replicated()?.resolvedThrough ?? -1) - resolvedBefore,
      zAtResume,
      zNow,
      zTraceMin: Math.min(...zTrace),
      zTraceMax: Math.max(...zTrace),
      zTraceSpan: Math.max(...zTrace) - Math.min(...zTrace),
    };
    const matchedAfter = h.predictor.matchedCorrections().slice(matchedAtRecovery).filter((row2) => row2.status === 'measured');
    let worstCorrection = 0;
    for (const row2 of matchedAfter) if (row2.magnitude > worstCorrection) worstCorrection = row2.magnitude;
    let worstIdentityResidualAfter = 0;
    for (const row2 of h.predictor.replayIdentityLedger().slice(identitiesAtRecovery)) {
      if (row2.maxAbsResidualMetres > worstIdentityResidualAfter) worstIdentityResidualAfter = row2.maxAbsResidualMetres;
    }
    const oldDomainAfterTrigger = h.predictor.deliveryLedger().filter(
      (entry) => entry.accepted && entry.delivery.atMs >= triggerAt && entry.delivery.epoch !== epochAtRecovery,
    ).length;
    const reissuedOldEpoch = h.predictor.sentAudit().filter(
      (entry) => entry.atMs >= triggerAt && entry.epoch !== epochAtRecovery,
    ).length;
    // POSITIVE CONTROL (red scenario only): the frozen seat exists; now restart the generation
    // sequence exactly as protocol §4.2 requires for the new epoch and re-settle for two seconds.
    // Motion resuming in THIS window — same room, same seat, same session, same epoch, only the
    // frame generation changed — attributes the failing layer to the client's frame content, not
    // to room state, the seat, the epoch, the bounds or the published row.
    let controlDeltaZ = 0;
    let controlSentDelta = 0;
    let controlWorstCorrection = 0;
    let controlTailWorstCorrection = 0;
    if (h.continueGeneration === true) {
      const matchedAtControl = h.predictor.matchedCorrections().length;
      const sentAtControl = h.predictor.sentAudit().length;
      const zBeforeControl = h.predictor.replicated()?.z ?? Number.NaN;
      h.continueGeneration = false;
      const epochNowControl = h.predictor.replicated()?.epoch;
      if (epochNowControl !== undefined) h.lastSeenEpoch = epochNowControl;
      h.generation = 1;
      const controlUntil = performance.now() + 2000;
      while (performance.now() < controlUntil) {
        await sleepPage(100);
      }
      controlDeltaZ = (h.predictor.replicated()?.z ?? Number.NaN) - zBeforeControl;
      controlSentDelta = h.predictor.sentAudit().length - sentAtControl;
      for (const row2 of h.predictor.matchedCorrections().slice(matchedAtControl)) {
        if (row2.status === 'measured' && row2.magnitude > controlWorstCorrection) controlWorstCorrection = row2.magnitude;
      }
      // The TAIL of the control window is the steady-state claim: once the restarted sequence is
      // in step, the most recent matched corrections are zero again. (The single lead-collapsing
      // correction at the restart instant is the honest, expected correction of the breach — the
      // client DID predict motion the authority refused — so it is reported, not thresholded.)
      const controlMeasured = h.predictor.matchedCorrections()
        .slice(matchedAtControl)
        .filter((row2) => row2.status === 'measured');
      for (const row2 of controlMeasured.slice(-8)) {
        if (row2.magnitude > controlTailWorstCorrection) controlTailWorstCorrection = row2.magnitude;
      }
    }
    h.moverStop = true;
    return {
      ok: true, roomId: h.roomId, sessionId: h.sessionId, joinEpoch: h.joinEpoch,
      triggered: true,
      triggerDetail: events.find((row2) => row2.event === 'trigger')?.detail ?? '',
      recovered, state: h.predictor.stateName(),
      sendRefused, journalDuringRecovery, journalAtSnapshot,
      oldDomainAfterTrigger, reissuedOldEpoch, sendsBetweenTriggerAndSnapshot,
      rejoins: h.predictor.rejoinTimestamps().length,
      epochAtRecovery, snapshotTickAtRecovery, replacementSessionId,
      movedAfterResume: zNow - zAtResume,
      measuredAfterCount: matchedAfter.length,
      worstCorrection, worstIdentityResidualAfter,
      continueGeneration: scenarioContinueGeneration,
      controlDeltaZ, controlSentDelta, controlWorstCorrection, controlTailWorstCorrection,
      motionWindow,
      events: h.predictor.recoveryLedger().map((row2) => row2.event),
    } satisfies RetirementRun;
  });
  return { page, run, factsAtTrigger: facts };
};

/** The strict BOTH-events claim: offender closed AND the replacement MOVES cleanly. */
const replacementRestored = (run: RetirementRun): boolean =>
  run.triggered === true
  && run.recovered === true
  && run.state === 'tracking'
  && run.epochAtRecovery !== run.joinEpoch
  && run.sendsBetweenTriggerAndSnapshot === 0
  && run.movedAfterResume >= 0.4
  && run.worstCorrection < 0.000001
  && run.worstIdentityResidualAfter < 0.000001;

/** The consumed-but-frozen signature the settle trace exposes when replacement is broken. */
const replacementFrozenDespiteConsumption = (run: RetirementRun): boolean =>
  run.motionWindow.sentDelta > 20
  && run.motionWindow.resolvedAdvanced > 20
  && run.motionWindow.deliveriesDelta > 5
  && run.motionWindow.zTraceSpan < 0.000001;

/** Wire-level consumption/refusal for one entity after a given tick, from the room's own ledger. */
const replacementTickFacts = (roomId: string, entityId: string, fromTick: number): {
  consumed: number; wireRefused: number; ticks: number;
} => {
  const room = gatedRoom(roomId);
  let consumed = 0;
  let wireRefused = 0;
  let ticks = 0;
  for (const record of room.tickRecords) {
    if (record.tick <= fromTick) continue;
    ticks += 1;
    for (const entry of record.consumed ?? []) if (entry.entityId === entityId) consumed += 1;
    for (const entry of record.refused ?? []) if (entry.entityId === entityId) wireRefused += Number(entry.count);
  }
  return { consumed, wireRefused, ticks };
};

/** Stop the mover, attempt the graceful leave, collect the page-error sink, close the context. */
const closeRetirementRun = async (page: Page, key: string): Promise<readonly string[]> => {
  await page.evaluate(async () => {
    const h = (globalThis as unknown as PredSeatWindow).__udgRetSeat;
    if (h === undefined) return;
    h.moverStop = true;
    try {
      await h.predictor.close();
    } catch {
      // the server may have closed this seat through §3.3; a failed graceful leave is recorded, not fatal
    }
  });
  const errors = pageErrorSinks.get(key) ?? [];
  await page.context().close();
  return errors;
};

test('retirement overflow in the browser: EVENT 1 (offender closed through the ADR branch) holds by exact identity; EVENT 2 (replacement MOVES cleanly) PASSES with the protocol-correct generation sequence; the generation-continuation breach is reproduced as the consumed-but-frozen red run and attributed by a same-seat positive control', async () => {
  expect(fixture, 'the room fixture booted').toBeDefined();

  // ---- RED run (the known red run, retained): the replacement mover DELIBERATELY continues the
  // offender's generation sequence across the new domain — the exact client-side §4.2 breach
  // ("a new epoch starts a new generation sequence") behind the slice-4/slice-5 "replacement
  // never moves" finding: the core resets the generation watermark to zero for the new epoch,
  // every continued frame sits outside MAX_GENERATION_FORWARD_GAP of it, and the screen's
  // RESYNC_REQUIRED refusal is a journalled disposition with a NEUTRAL step — consumed, acked,
  // watermark-advanced, unmoving. The same-seat control then restarts the sequence and nothing
  // else: motion resuming there attributes the failing layer to client frame content, not to the
  // room, the seat, the epoch, the bounds, or the published row.
  const runRed = await runRetirementScenario('ret-RED', null, true);
  const factsRed = retirementServerFacts(runRed.run.roomId, runRed.run.sessionId);
  const redTickFacts = replacementTickFacts(runRed.run.roomId, runRed.run.replacementSessionId, runRed.run.snapshotTickAtRecovery);
  observations['predRetirementRed'] = {
    facts: factsRed, run: runRed.run, tickFacts: redTickFacts, strictBothEvents: replacementRestored(runRed.run),
  };

  check('retirement RED reproduction: a replacement that CONTINUES the old generation sequence is consumed-but-frozen — the room consumes every frame (seat resolvedThrough advances, ZERO wire-level refusals in the room ledger) while the row never moves (4 s trace, span 0): the refusals are core-screen dispositions (RESYNC_REQUIRED, neutral step), exactly the signature the previous slices reported',
    runRed.run.continueGeneration === true
    && replacementFrozenDespiteConsumption(runRed.run)
    && replacementRestored(runRed.run) === false
    && redTickFacts.consumed > 20 && redTickFacts.wireRefused === 0,
    { motion: runRed.run.motionWindow, tickFacts: redTickFacts });

  check('retirement RED positive control: on the SAME seat, in the SAME room, under the SAME session and epoch, restarting the generation sequence at 1 (§4.2) restores authoritative motion within 2 s (≥0.6 m, frames still flowing) and the TAIL matched corrections return to zero — the server replaced the seat correctly; the frozen variant fails on client frame content alone (the single lead-collapsing correction at the restart instant is the breach\'s own honest correction — the client predicted motion the authority refused — and is reported, not thresholded), so no server defect is named',
    runRed.run.controlDeltaZ >= 0.6 && runRed.run.controlSentDelta >= 20 && runRed.run.controlTailWorstCorrection < 0.000001,
    { controlDeltaZ: runRed.run.controlDeltaZ, controlSentDelta: runRed.run.controlSentDelta, controlWorstCorrection: runRed.run.controlWorstCorrection, controlTailWorstCorrection: runRed.run.controlTailWorstCorrection, frozenSpan: runRed.run.motionWindow.zTraceSpan });

  // THE CONTROL the review asked for, pinned against reality in BOTH directions: the OLD loose
  // EITHER-claim is satisfied by the FROZEN red run while the strict BOTH-events claim fails it;
  // the green runs below must PASS the same strict claim. A broken replacement cannot pass the
  // strict claim, and the loose claim demonstrably could.
  check('retirement CONTROL: the legacy EITHER-claim (any close observation) is satisfied by the FROZEN red run while the strict BOTH-events claim fails it — broken replacement movement cannot pass the strict claim the green runs must satisfy',
    factsRed.closeObservations.length >= 1
    && replacementRestored(runRed.run) === false
    && replacementFrozenDespiteConsumption(runRed.run),
    { loose: factsRed.closeObservations.length >= 1, strict: replacementRestored(runRed.run) });
  const errorsRed = await closeRetirementRun(runRed.page, 'ret-RED');
  check('retirement: no unexpected page or console errors in run RED', errorsRed.length === 0, errorsRed.slice(0, 4));

  // ---- GREEN run A: protocol-correct replacement (the mover restarts its generation sequence
  // when the epoch changes), default rejoin ladder (first attempt ~250 ms, INSIDE the window).
  const runA = await runRetirementScenario('ret-A', null, false);
  const factsA = retirementServerFacts(runA.run.roomId, runA.run.sessionId);
  observations['predRetirementA'] = { facts: factsA, run: runA.run, strictBothEvents: replacementRestored(runA.run) };
  check('retirement GREEN (default rejoin cadence): the strict BOTH-events claim HOLDS — the offender is closed through the ADR branch (exactly one code-4100 closure on its own entityId) AND the replacement MOVES cleanly on the new domain (fresh snapshot before any fresh input, ≥0.4 m across the settle window, zero nominal corrections, zero identity residual)',
    replacementRestored(runA.run)
    && factsA.offenderClosures.filter((c) => c.entityId === runA.run.sessionId && c.code === 4100).length === 1,
    { strict: replacementRestored(runA.run), motion: runA.run.motionWindow, offenderClosures: factsA.offenderClosures });
  const errorsA = await closeRetirementRun(runA.page, 'ret-A');
  check('retirement: no unexpected page or console errors in run A', errorsA.length === 0, errorsA.slice(0, 4));

  // ---- GREEN run B: the rejoin ladder deferred to 1500 ms, landing AFTER the §3.3 bounded
  // closure has removed the offender seat. Full attribution set on this run.
  const runB = await runRetirementScenario('ret-B', [1500], false);
  const factsB = retirementServerFacts(runB.run.roomId, runB.run.sessionId);
  observations['predRetirementB'] = { facts: factsB, run: runB.run, strictBothEvents: replacementRestored(runB.run) };

  check('retirement: the authority really evicted unrepresented inputs — the server ledger shows nonzero retirement under an over-rate stream (read while the offender seat was still seated; a genuine overflow trigger, not a fixture assertion)',
    runB.factsAtTrigger.retiredTotalWhileRunning > 0 && runB.run.triggered === true && /retirement-nonzero/.test(runB.run.triggerDetail),
    { factsAtTrigger: runB.factsAtTrigger, triggerDetail: runB.run.triggerDetail });

  const ladderOk = (() => {
    const milestones = ['trigger', 'stop-sending', 'discard-pending', 'rejoin-scheduled', 'rejoin-attempt', 'rejoin-complete', 'snapshot-recovered'];
    const indexes = milestones.map((event) => runB.run.events.indexOf(event));
    return indexes.every((index) => index >= 0) && indexes.every((index, k) => k === 0 || index > (indexes[k - 1] as number));
  })();
  check('retirement: the row-named retirement (not a deadline) triggered ADR-0003 §3.2 in the browser and the ladder milestones ran in order to a fresh-snapshot resume',
    runB.run.triggered === true && runB.run.recovered === true && ladderOk, runB.run);
  check('retirement: stop-sending held (send refused), the journal stayed discarded, and NOTHING replayed, re-issued, or recovered from the quarantined old domain',
    /recovery/.test(runB.run.sendRefused) && runB.run.journalDuringRecovery === 0
    && runB.run.oldDomainAfterTrigger === 0 && runB.run.reissuedOldEpoch === 0 && runB.run.rejoins <= 2,
    runB.run);

  const closureTick = factsB.offenderClosures[0]?.tick ?? Number.POSITIVE_INFINITY;
  const offenderClosedThroughAdr = factsB.offenderClosures.length === 1
    && factsB.offenderClosures[0]?.entityId === runB.run.sessionId
    && factsB.offenderCloseObservations.length >= 1
    && (factsB.offenderCloseObservations[0]?.retiredUnrepresented ?? 0) >= 1
    && (factsB.offenderCloseObservations[0]?.consumedCountAtClose ?? 0) >= 1;
  check('retirement EVENT 1 (the offender, exact identity): the seat that over-ran the authority — entityId === sessionId === the joining session — is CLOSED through the ADR branch (closure ledger, code 4100) with its retirement and consumed count in its OWN §3.1 close observation, and the closure tick precedes the replacement\'s snapshot tick',
    offenderClosedThroughAdr && closureTick < runB.run.snapshotTickAtRecovery,
    { closureTick, offenderClosures: factsB.offenderClosures, offenderCloseObservations: factsB.offenderCloseObservations, snapshotTickAtRecovery: runB.run.snapshotTickAtRecovery });

  check('retirement EVENT 2a (the replacement, client half, exact identity): a NEW domain (new session identity after joinById, epoch different from join) applied a fresh snapshot BEFORE any fresh input — nothing sent between trigger and snapshot — and kept the ledgers clean (empty journal at snapshot, zero old-epoch re-issue, zero old-domain deliveries)',
    runB.run.recovered === true
    && runB.run.epochAtRecovery !== runB.run.joinEpoch
    && runB.run.replacementSessionId !== runB.run.sessionId
    && runB.run.sendsBetweenTriggerAndSnapshot === 0
    && runB.run.oldDomainAfterTrigger === 0
    && runB.run.reissuedOldEpoch === 0,
    runB.run);

  // EVENT 2's server half, asserted as PASSING behaviour (the previous round's REPORTED server
  // failure is rescinded: the frozen replacement was the §4.2 generation-continuation breach in
  // this fixture's mover, reproduced by the red run and attributed by the same-seat control).
  const replacementSeat = factsB.seats.find((s) => s.epoch === runB.run.epochAtRecovery);
  check('retirement EVENT 2b (the replacement, server half, exact identity): the seat this room minted for the replacement session and epoch CONSUMES AND APPLIES — resolvedThrough advances, deliveries flow, the authoritative row travels ≥0.4 m across the 4 s settle window with a nonzero trace span, its effect ledger is empty and it is not closing — so BOTH §3.3 replacement clauses (new domain AND can move) hold against the protocol-correct client at the deferred cadence',
    replacementRestored(runB.run)
    && replacementSeat !== undefined
    && replacementSeat.resolvedThrough > 20
    && replacementSeat.effects === 0
    && replacementSeat.closing === false
    && runB.run.motionWindow.zTraceSpan > 0.4,
    { roomId: runB.run.roomId, offenderSession: runB.run.sessionId, replacementSession: runB.run.replacementSessionId, epoch: runB.run.epochAtRecovery, seat: replacementSeat, motion: runB.run.motionWindow, worstCorrectionMetres: runB.run.worstCorrection });

  check('retirement: no double effect and no ghost seat — after the run exactly ONE seat is seated (the replacement epoch under the replacement session), its effect ledger is empty, and the offender\'s consumed count stopped at its closure',
    factsB.seats.length === 1
    && factsB.seats[0]?.epoch === runB.run.epochAtRecovery
    && factsB.seats[0]?.effects === 0
    && factsB.seats[0]?.entityId === runB.run.replacementSessionId
    && factsB.offenderCloseObservations.every((o) => o.consumedCountAtClose >= 1),
    { seats: factsB.seats, epochAtRecovery: runB.run.epochAtRecovery, replacementSession: runB.run.replacementSessionId });

  const errorsB = await closeRetirementRun(runB.page, 'ret-B');
  check('retirement: no unexpected page or console errors in run B', errorsB.length === 0, errorsB.slice(0, 4));
  const retirementFailures = checks.filter((record) => record.name.startsWith('retirement') && !record.ok);
  expect.soft(retirementFailures, `failed retirement checks: ${JSON.stringify(retirementFailures.map((record) => record.name))}`).toEqual([]);
});

limitations.push('Two-browser-context loopback smoke: it certifies nothing about the four-profile Gate A matrix, the seeds, impairment, forced corrections, or the 20-client ten-minute workload.');
limitations.push('Gate A remains Not Run; the client compiler diagnostics are a separate claim in docs/integration/colyseus-0.18-api-map.md §12 and docs/adr/0004-client-declaration-checking-exception.md.');
limitations.push('Local prediction and forced correction (slice 4, revised after review): the two forced corrections are induced by staging a frame the AUTHORITY refuses (generation 0 beside the live watermark) through the public SDK handle, while a TEST-ONLY tick gate freezes the pinned room between ticks so the refusal is consumed at EXACTLY authority ticks 40 and 120 — the disposition tick is read from the room\'s public per-tick consumption ledger, and the delivery tick is recorded separately. The gate wraps the room instance only inside this test process; no server file is edited and no shipped behaviour changes. Corrections are measured by the per-matched-ack checkpoint instrumenter (shared reference step function, every eligible ack exactly once, unavailable checkpoints invalidated rather than zeroed); the old end-pose difference is retained under a renamed, honestly-labelled diagnostic. Recovery evidence now covers three distinct browser paths: deadline/suspension under sustained network loss, bounded-retry resume through a real rejoin and fresh snapshot, and a genuine overflow/retirement trigger observed in the server ledger. The named-gap trigger remains unreachably quiet in this server build (it never names a range on loopback) and is pinned by the unit suite only.');
limitations.push('Gate A per-tick and safety-on-transition rows are not evaluated here: a browser sees patched deliveries, not the authority journal, and the 100 ms patch interval over a 50 ms step means one delivery carries two consumed ticks. The transient `movementMode` of a consumed direct intent is therefore recorded and not asserted. Those rows wait for the Gate A run against the journal.');
limitations.push('Slice 5 review items, closed at the amendment round: (1) the step relation is ONE exported function used by BOTH sides of the spike — apps/client flatStep is imported by the adapter/browser pages/instrumenter, and (owner-approved amendment A-1, assignments §3.5) the netcode harness room and the AC-1 trace step the authority through tests/support/step-kernel/kernel-stepper.mjs wrapping that same dist export via the trusted stepperFactory seam; production default FlatReferenceStepper unchanged (parity + sentinel + module-identity checks pin this). (3) matched-ack checkpoints are corroborated per adoption (adoptionLedger conservation on real behaviour, direct-vs-reconstructed boundaries, coverage holes fail the metric) with the refused-then-advancing single-batch browser control. (2) retirement is asserted as TWO events by exact identity and BOTH now hold end to end: EVENT 1 (offender closed through the §3.1/§3.3 branch, code 4100, closure tick before the replacement\'s snapshot tick) and EVENT 2 (new session/epoch domain, fresh snapshot before any fresh input, replacement MOVES ≥0.4 m with zero nominal corrections) at the default and deferred rejoin cadences. The earlier "replacement never moves" finding is RESCINDED: it was this fixture\'s mover continuing the old generation sequence across the new epoch (protocol §4.2; MAX_GENERATION_FORWARD_GAP screen refuses such frames with a neutral step); the suite retains that breach as a RED scenario reproduced with a same-seat positive control, and the legacy EITHER-check is pinned as the control that a broken replacement could pass but the strict claim cannot. The named-gap/stalled-ack/termination matrix coverage remains outstanding.');

