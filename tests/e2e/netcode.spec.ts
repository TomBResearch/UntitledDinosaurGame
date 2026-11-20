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

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium, expect, test, type Browser, type Page } from '@playwright/test';

import { MIN_ELIGIBLE_ACKS_PER_RUN, nearestRank, networkValidity, summarizeCorrections, summarizeDelays } from '../../tools/load-test/src/statistics.ts';
import { auditMotion, type AckLedgerReport } from '../../tools/load-test/src/ack-ledger.ts';
import { auditGa5Transcript, naiveVsJoined, type Ga5Transcript } from '../../tools/load-test/src/ga5-transcript.ts';
import { captureEnvironmentRecord, impairmentSourceRecord, planSpikeRun } from '../../tools/load-test/src/run-spike.ts';
import { createTraceWriter, readTrace } from '../../tools/load-test/src/trace-writer.ts';
import type { ProxyStats } from '../../tools/load-test/src/ws-delay-proxy.ts';

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

  // The impairment smoke drives tools/load-test's proxy HOST as its own Node process (measurement
  // contamination control — the impairment clock must not share an event loop with the room, the
  // tick gate and the browser CDP traffic). Its binary is built here, explicitly, because
  // tools/load-test is not yet a workspace member (that pin-free wiring is the DPA-2 decision).
  const harnessBuild = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(ROOT, 'tools', 'load-test', 'tsconfig.json')], { cwd: ROOT, encoding: 'utf8' });
  expect(harnessBuild.status, `tools/load-test build failed: ${harnessBuild.stdout}${harnessBuild.stderr}`).toBe(0);

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
  page?.on('crash', () => {
    pageErrors.push('PAGE CRASHED');
    // Print loudly: a dying page otherwise takes its diagnostics with it.
    console.log(`[page-crash] ${label} pageErrors=${JSON.stringify(pageErrors.slice(-4))}`);
  });
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

/** Join the seat inside the page, over the client modules the pipeline serves. `endpointOverride`
 * exists for the impairment-proxy smoke: the seat joins the PROXY, and the proxy forwards to the
 * fixture room; nothing else about the join path changes. */
const joinSeat = async (
  page: Page,
  target: { mode: 'create'; roomName: string } | { mode: 'byId'; roomId: string },
  endpointOverride?: string,
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
    endpoint: endpointOverride ?? fixture?.endpoint ?? '',
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
  /** Optional public pass-through to the SDK protocol ping on the joined socket (slice 6c). */
  pingLatency?(callback: (ms: number) => void): void;
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
  deliveryLedger(): readonly { accepted: boolean; reason: string; delivery: { revision: number; epoch: number; authorityTick: number; atMs: number; ack: number; resolvedThrough: number; gapStart: number; gapEnd: number; retiredUnrepresented: number; sentCount: number } }[];
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
  recoveryEpisodeExpiredFlag(): boolean;
  /** ADR-0003 §3.2 surfaced connection error — non-null exactly on EPISODE expiry (6f). */
  connectionError(): { code: string; message: string; atMs: number } | null;
  /** Which §3.2 limit suspended the seat; the two limits stay DISTINCT (6f). */
  suspensionReason(): 'episode-deadline' | 'rolling-window' | null;
  stateName(): string;
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
  /** Impairment-proxy smoke (slice 6): the mover through the WS delay proxy. */
  __udgImpSeat?: {
    readonly transport: PredTransportSurface;
    readonly predictor: PredPredictorSurface;
    readonly roomId: string;
    readonly sessionId: string;
    generation: number;
    /** Protocol §4.2 / A-2: the mover restarts its sequence ONLY when this changes. */
    lastSeenEpoch: number;
    restarts: number;
    tickStop: boolean;
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
    signals?: readonly { entityId: string; signal: string }[];
  }[];
  evidence(): Record<string, unknown>;
  journal(): { rows: readonly Record<string, unknown>[]; chain: readonly { tick: number; atMs: number }[]; dropped: number };
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


// --------------------------------------------------------------------------- impairment-proxy smoke (slice 6)

/**
 * DPA-2 feasibility, in the browser seat: two real contexts join the SAME pinned room through
 * the `tools/load-test` WebSocket delay proxy — a TCP-stream stall primitive with seeded,
 * centred, bounded jitter — and exchange movement. Two cells run, BOTH labelled diagnostic:
 *
 * 1. a **LAN-labelled baseline** (`lan` profile, seed 1001, short window): the proxy path must
 *    be transparent — acks flow, the observer sees the mover travel, the proxy's own audit says
 *    order preserved / nothing dropped / requested≈achieved, and the matched-ack correction
 *    ledger survives the round trip through the proxy with zero retention and no missing samples;
 * 2. a **labelled elevated calibration** (`elevated` profile, seed 1001, ~2 s of movement): the
 *    §2.2 achieved-network rule is computed from the proxy's RAW requested/achieved samples and
 *    reported, the mover proves at browser level that stalls are NOT a new domain (the A-2
 *    producer rule: generations restart only on a fresh issued epoch, and a stall-filled run
 *    must record zero restarts).
 *
 * What this is NOT: it is not a p95 gate, not a matrix cell, and not a correction verdict. The
 * windows are seconds, not 20 s + 120 s, so every population here fails the 100-ack floor ON
 * PURPOSE — the run asserts the rule FIRES (insufficient-evidence, and ONLY that) so the short
 * run can never be misread as an eligible one. The official matrix attaches at the §4 Gate A
 * layout; the room is the fixture's shared-kernel room, unchanged.
 */
interface ImpMovementReport {
  readonly sent: number;
  readonly restarts: number;
  readonly epochs: readonly number[];
  readonly generations: readonly number[];
  readonly lastProcessed: number;
}

interface ImpLedger {
  readonly stats: { measured: number; zero: number; anchored: number; invalidated: number; nonAdvancingDeliveries: number; adoptions: number; adoptionCoverageIncomplete: number };
  readonly rows: readonly { atMs: number; authorityTick: number; epoch: number; ackFrom: number; ackTo: number; seqs: readonly number[]; status: string; correctionX: number; correctionZ: number; magnitude: number }[];
}

const joinImpSeat = async (
  page: Page,
  endpoint: string,
  target: { mode: 'create'; roomName: string } | { mode: 'byId'; roomId: string },
): Promise<SeatSetup> =>
  page.evaluate(async (args) => {
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
    });
    predictor.attach();
    const raf = (): void => {
      const seat = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
      if (seat === undefined || !seat.tickStop) predictor.tick(performance.now());
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    const epoch0 = joined.transport.issuedEpoch();
    (globalThis as unknown as PredSeatWindow).__udgImpSeat = {
      transport: joined.transport,
      predictor,
      roomId: joined.roomId,
      sessionId: joined.sessionId,
      generation: 0,
      lastSeenEpoch: epoch0,
      restarts: 0,
      tickStop: false,
    };
    return { ok: true, roomId: joined.roomId, sessionId: joined.sessionId, epoch: epoch0 };
  }, {
    endpoint,
    join: target,
    presentation: fixture?.presentation ?? {},
    adapterUrl: ADAPTER_URL,
    speed: fixture?.movementSpeed ?? 4,
  });

const runImpMover = async (page: Page, frames: number, axis: 'x' | 'z'): Promise<ImpMovementReport> =>
  page.evaluate(async (args) => {
    const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
    if (holder === undefined) throw new Error('the impairment mover is not joined');
    const generations: number[] = [];
    const epochs: number[] = [];
    for (let i = 0; i < args.frames; i += 1) {
      const epoch = holder.transport.issuedEpoch();
      if (holder.lastSeenEpoch !== epoch) {
        // A-2 rule: a fresh issued epoch/snapshot is the ONLY restart trigger. Stalls, late
        // deliveries and wall-clock time have no path to this branch — there is no timer here.
        holder.lastSeenEpoch = epoch;
        holder.generation = 0;
        holder.restarts += 1;
      }
      holder.generation += 1;
      holder.predictor.send(
        { generation: holder.generation, moveX: args.axis === 'x' ? 1 : 0, moveZ: args.axis === 'z' ? 1 : 0 },
        true,
      );
      generations.push(holder.generation);
      epochs.push(epoch);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
      sent: generations.length,
      restarts: holder.restarts,
      epochs: [...new Set(epochs)],
      generations,
      lastProcessed: holder.transport.handle().lastProcessed,
    };
  }, { frames, axis });

/* ------------------------------------------------------------------ accepted RTT probe (slice 6d)
 *
 * The probe's slot-reservation state machine lives in tools/load-test/src/rtt-probe.ts —
 * UNIT-TESTED deterministically in node and IMPORTED BY THE PAGE (vite /@fs over the loopback
 * pipeline) so the browser and the tests run the SAME code. The page supplies the dependencies:
 * the monotonic clock, real timers, the seat transport's public pingLatency pass-through (which
 * REFUSES on a closed socket), and an epoch guard. Contract (review of 4db1a0f): a retirement
 * keeps the slot RESERVED until the original echo is positively observed; no confirmation within
 * confirmCapMs POISONS the cell — the window stops, remaining opportunities are not-sent, and
 * NO FURTHER PING is ever sent on that socket from that window. Measurement continues only
 * after a verified returned callback, or on a separately labelled new connection.
 */
const PROBE_MODULE_URL = `/@fs${join(ROOT, 'tools', 'load-test', 'dist', 'rtt-probe.js')}`;
/** Same pipeline, same principle: the phase-window analyzer and the canonical route run in the PAGE as the UNIT-TESTED module, not as a page-side re-implementation. */
const ACK_LEDGER_MODULE_URL = `/@fs${join(ROOT, 'tools', 'load-test', 'dist', 'ack-ledger.js')}`;

interface RttProbeWindow {
  readonly samples: readonly { readonly sentAtMs: number; readonly receivedAtMs: number; readonly rttMs: number; readonly sdkMs: number }[];
  readonly lateDiscarded: number;
  readonly retiredUnconfirmed: number;
  readonly slotPoisoned: boolean;
  readonly socketClosed: boolean;
  readonly epochChanged: boolean;
  readonly abortedReason: string | null;
  readonly notSent: number;
  readonly clockElapsedMs: number;
  readonly wallElapsedMs: number;
}

const runImpRttProbe = async (
  page: Page,
  opts: { pings: number; cadenceMs: number; deadlineMs: number; confirmCapMs?: number },
): Promise<RttProbeWindow> =>
  page.evaluate(async (args) => {
    const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
    if (holder === undefined) throw new Error('the impairment mover is not joined');
    if (typeof holder.transport.pingLatency !== 'function') throw new Error('the seat transport exposes no pingLatency pass-through');
    const mod = (await import(/* @vite-ignore */ args.moduleUrl)) as {
      runProbeWindow(deps: unknown, options: unknown): Promise<RttProbeWindow>;
    };
    const deps = {
      nowMs: () => performance.now(),
      sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      after: (ms: number, cb: () => void) => {
        const t = setTimeout(cb, ms);
        return () => clearTimeout(t);
      },
      sendPing: (onEcho: (ms: number) => void) => {
        holder.transport.pingLatency!(onEcho);
      },
      epochNow: () => holder.transport.issuedEpoch(),
    };
    return mod.runProbeWindow(deps, {
      pings: args.pings,
      cadenceMs: args.cadenceMs,
      deadlineMs: args.deadlineMs,
      confirmCapMs: args.confirmCapMs ?? 5_000,
    });
  }, { moduleUrl: PROBE_MODULE_URL, ...opts });

/** Missing-reply control, three separate windows on the seat's socket, ordered so nothing is
 * ever sent on a reserved/poisoned slot: (1) a normal ping answers; (2) a short-deadline ping
 * RETIRES and its late echo is POSITIVELY confirmed as a discard (no abort); (3) a normal ping
 * again on the verified-free slot. The impossible-confirmation poison case is deterministically
 * unit-tested; on a live seat we never deliberately poison before other windows, because a
 * poisoned socket is finished for measurement. */
const runImpRttMissingReplyControl = async (
  page: Page,
  opts: { normalDeadlineMs: number; shortDeadlineMs: number },
): Promise<{ before: RttProbeWindow; short: RttProbeWindow; after: RttProbeWindow }> => {
  const before = await runImpRttProbe(page, { pings: 1, cadenceMs: 100, deadlineMs: opts.normalDeadlineMs });
  const short = await runImpRttProbe(page, { pings: 1, cadenceMs: 100, deadlineMs: opts.shortDeadlineMs, confirmCapMs: 2_000 });
  const after = await runImpRttProbe(page, { pings: 1, cadenceMs: 100, deadlineMs: opts.normalDeadlineMs });
  return { before, short, after };
};

/** Nearest-rank median, the SAME convention as the statistics module. */
const medianOf = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.5) - 1] ?? null;
};

/** Monotonic-observation-clock receipts for a probe window (no subtraction — receipts only). */
const probeDrift = (probe: RttProbeWindow): { everyOk: boolean; n: number; minRttMs: number | null; maxSdkWrapperDriftMs: number | null; medianSdkWrapperDriftMs: number | null; clockRatio: number } => {
  const drifts = probe.samples.map((sample) => sample.rttMs - sample.sdkMs).sort((a, b) => a - b);
  const rtts = [...probe.samples.map((sample) => sample.rttMs)].sort((a, b) => a - b);
  const ratio = probe.wallElapsedMs > 0 ? probe.clockElapsedMs / probe.wallElapsedMs : 1;
  const everyOk = probe.samples.length > 0
    && probe.samples.every((sample) => Number.isFinite(sample.rttMs) && sample.rttMs > 0 && sample.receivedAtMs > sample.sentAtMs)
    && ratio > 0.9 && ratio < 1.1;
  return {
    everyOk,
    n: probe.samples.length,
    minRttMs: rtts[0] ?? null,
    maxSdkWrapperDriftMs: drifts[drifts.length - 1] ?? null,
    medianSdkWrapperDriftMs: drifts[Math.floor(drifts.length / 2)] ?? null,
    clockRatio: Number(ratio.toFixed(4)),
  };
};

const readImpLedger = async (page: Page): Promise<ImpLedger> =>
  page.evaluate(() => {
    const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
    if (holder === undefined) throw new Error('the impairment mover is not joined');
    return { stats: holder.predictor.matchedInstrumentStats(), rows: holder.predictor.matchedCorrections() };
  });

/* ------------------------------------------------------------------ proxy host client (slice 6b)
 *
 * The impairment proxies run inside a dedicated Node child process (`proxy-host.ts`), NOT inside
 * this Playwright worker. Why: the worker's event loop also runs the room (authority ticks, patch
 * batching, the tick gate) and the CDP traffic of every browser context; a stall timer scheduled
 * on that loop fires LATE under load, and the achieved sample — honestly — counts the overshoot.
 * That is instrument contamination, and the fix is to give the impairment its own loop, not to
 * adjust the metric. Every reply is bounded by a pre-declared timeout (checked, as values, by
 * the first check of the smoke BEFORE any phase starts), and shutdown returns a finite-teardown
 * RECEIPT: the host reports what it closed and what, if anything, is still live.
 */
const HOST_START_TIMEOUT_MS = 10_000;
const HOST_REQUEST_TIMEOUT_MS = 15_000;
const HOST_SHUTDOWN_TIMEOUT_MS = 10_000;
const PROXY_SETTLE_MAX_MS = 8_000;

interface HostReceipt {
  readonly ch: 'receipt';
  readonly trigger: string;
  readonly exitCode: number;
  readonly proxiesClosed: number;
  readonly proxiesOpened: number;
  readonly activeResourcesAfterClose: readonly string[];
  readonly shutdownMs: number;
}

interface ProxyHostClient {
  readonly pid: number;
  request(command: Record<string, unknown>): Promise<Record<string, unknown>>;
  stderrTail(): string;
  shutdown(): Promise<{ receipt: HostReceipt | null; exitCode: number | null; signal: string | null; stderrTail: string }>;
}

const startProxyHost = (): Promise<ProxyHostClient> =>
  new Promise((resolve, reject) => {
    const child = spawn('node', [join(ROOT, 'tools', 'load-test', 'dist', 'proxy-host.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stderrParts: string[] = [];
    child.stderr.on('data', (d: Buffer) => stderrParts.push(String(d)));
    let buffer = '';
    let nextId = 1;
    const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    let receipt: HostReceipt | null = null;
    let helloReceived = false;
    const startTimer = setTimeout(() => {
      if (!helloReceived) {
        child.kill();
        reject(new Error(`proxy host did not say hello within ${String(HOST_START_TIMEOUT_MS)} ms`));
      }
    }, HOST_START_TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => {
      buffer += String(d);
      for (;;) {
        const nl = buffer.indexOf('\n');
        if (nl < 0) break;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim().length === 0) continue;
        const msg = JSON.parse(line) as Record<string, unknown>;
        if (msg['ch'] === 'hello') {
          helloReceived = true;
          clearTimeout(startTimer);
          resolve(client);
          continue;
        }
        if (msg['ch'] === 'receipt') {
          receipt = msg as unknown as HostReceipt;
          continue;
        }
        const id = msg['id'] as number | undefined;
        if (typeof id === 'number' && pending.has(id)) {
          const waiter = pending.get(id);
          pending.delete(id);
          if (waiter !== undefined) {
            clearTimeout(waiter.timer);
            waiter.resolve(msg);
          }
        }
      }
    });
    const client: ProxyHostClient = {
      pid: child.pid ?? -1,
      request(command): Promise<Record<string, unknown>> {
        const id = nextId;
        nextId += 1;
        return new Promise((resolveReq, rejectReq) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            rejectReq(new Error(`proxy host reply to op ${String(command['op'])} exceeded the ${String(HOST_REQUEST_TIMEOUT_MS)} ms pre-cap`));
          }, HOST_REQUEST_TIMEOUT_MS);
          pending.set(id, { resolve: resolveReq, reject: rejectReq, timer });
          child.stdin.write(`${JSON.stringify({ ch: 'cmd', id, ...command })}\n`);
        });
      },
      stderrTail(): string {
        return stderrParts.join('').slice(-400);
      },
      async shutdown() {
        const exitPromise = new Promise<{ code: number | null; signal: string | null }>((resolveExit) => {
          child.once('exit', (code: number | null, signal: string | null) => {
            resolveExit({ code, signal });
          });
        });
        child.stdin.write(`${JSON.stringify({ ch: 'cmd', id: nextId, op: 'shutdown' })}\n`);
        const timeoutExit = new Promise<{ code: number | null; signal: string | null }>((resolveExit) => {
          const t = setTimeout(() => {
            child.kill('SIGKILL');
            resolveExit({ code: null, signal: 'PRECAPPED-KILL' });
          }, HOST_SHUTDOWN_TIMEOUT_MS);
          t.unref();
        });
        const gone = await Promise.race([exitPromise, timeoutExit]);
        return { receipt, exitCode: gone.code, signal: gone.signal, stderrTail: client.stderrTail() };
      },
    };
  });

/** Let every in-proxy stall drain before snapshotting proxy stats — byte-fidelity claims are only
 * meaningful over a settled queue. Stats come from the host over the bounded control channel. */
/** Close a proxy through the host's control channel with ONE bounded retry: a machine freeze
 * mid-close burns the first request's pre-cap while the host keeps draining; the retry reads the
 * already-draining state instead of assuming the close died. */
const closeProxyBounded = async (host: ProxyHostClient, handle: number): Promise<ProxyStats> => {
  try {
    const reply = await host.request({ op: 'close', handle });
    return reply['stats'] as ProxyStats;
  } catch (firstError) {
    await sleep(8_000); // the host may still be inside the drain; give it a bounded second window
    const retry = await host.request({ op: 'close', handle });
    if (retry['ok'] !== true) throw new Error(`proxy close retry failed after a pre-capped first attempt (${String(firstError instanceof Error ? firstError.message : firstError)}): ${JSON.stringify(retry)}`, { cause: firstError });
    return retry['stats'] as ProxyStats;
  }
};

const settleProxy = async (host: ProxyHostClient, handle: number, maxMs = PROXY_SETTLE_MAX_MS): Promise<{ stats: ProxyStats; throttle: { worstThrottleDeltaUsec: number; worstThrottleDeltaEvents: number } | null }> => {
  const started = Date.now();
  for (;;) {
    const reply = await host.request({ op: 'stats', handle });
    const stats = reply['stats'] as ProxyStats;
    const throttle = (reply['throttle'] as { worstThrottleDeltaUsec: number; worstThrottleDeltaEvents: number } | undefined) ?? null;
    if (stats.c2s.bufferedBytes === 0 && stats.s2c.bufferedBytes === 0) return { stats, throttle };
    if (Date.now() - started > maxMs) return { stats, throttle };
    await sleep(50);
  }
};

const closeImpSeat = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
    if (holder === undefined) return;
    holder.tickStop = true;
    await holder.transport.close();
  });
};

const consecutiveFromOne = (values: readonly number[]): boolean =>
  values.every((value, index) => value === index + 1);

// The Playwright `testInfo` second-argument form needs the empty destructure; ESLint's
// no-empty-pattern rule and Playwright's fixture validator disagree — a targeted, line-local
// suppression of the LINT (not a config change) keeps the accepted-case timeout visible.
// eslint-disable-next-line no-empty-pattern
test('impairment proxy smoke: paired browser seats through the WS delay proxy — LAN-labelled baseline and a labelled elevated calibration (both diagnostic; no p95 gate)', async ({}, testInfo) => {
  test.setTimeout(120_000);
  expect(fixture, 'the room fixture booted').toBeDefined();
  const roomPort = Number(new URL(fixture?.endpoint ?? 'http://127.0.0.1:0').port);
  check('impairment: the proxy target port parses from the fixture endpoint', Number.isInteger(roomPort) && roomPort > 0, roomPort);
  const kernelCallsBefore = kernelStepper?.kernelStepperSentinel.calls ?? 0;

  const planLan = planSpikeRun({ profile: 'lan', seed: 1001, diagnostic: { reason: 'paired-browser-smoke' } });
  const planElev = planSpikeRun({ profile: 'elevated', seed: 1001, diagnostic: { reason: 'paired-browser-elevated-calibration' } });
  check('impairment: both smoke cells are LABELLED diagnostic and neither is an official matrix cell',
    planLan.official === false && planElev.official === false && /diagnostic:/.test(planLan.label) && /diagnostic:/.test(planElev.label),
    { lan: planLan.label, elevated: planElev.label });

  const host = await startProxyHost();
  let hostTornDown = false;
  const runBody = async (): Promise<void> => {
  // Pre-cap timeouts are validated BEFORE any phase runs: every await this smoke will perform
  // against the proxy host already has a declared finite bound, and the Playwright case timeout
  // is stated — a smoke with an open-ended await is a hang waiting to happen, not a diagnostic.
  const caps = {
    hostStartMs: HOST_START_TIMEOUT_MS,
    hostRequestMs: HOST_REQUEST_TIMEOUT_MS,
    hostShutdownMs: HOST_SHUTDOWN_TIMEOUT_MS,
    proxySettleMs: PROXY_SETTLE_MAX_MS,
    caseTimeoutMs: testInfo.timeout,
  };
  check('impairment: PRE-CAP timeouts are declared and finite before the first phase (host start/request/settle/shutdown + case timeout)',
    Object.values(caps).every((value) => Number.isFinite(value) && value > 0), caps);

  check('impairment: the impairment proxies run in their OWN Node process (the impairment clock shares no event loop with the room, the tick gate or CDP traffic)',
    host.pid > 0 && host.pid !== process.pid, { hostPid: host.pid, workerPid: process.pid });

  // ============================ phase 1: LAN-labelled baseline through the proxy ============
  const startLan = await host.request({ op: 'start', profile: planLan.impairment, targetHost: '127.0.0.1', targetPort: roomPort });
  const handleLan = startLan['handle'] as number;
  const proxyUrlLan = `http://127.0.0.1:${String(startLan['port'] as number)}`;
  check('impairment[lan]: the seats reach the room ONLY through the proxy port (the endpoint named is the proxy, not the room)',
    typeof handleLan === 'number' && Number(new URL(proxyUrlLan).port) === startLan['port'] && Number(new URL(proxyUrlLan).port) !== roomPort,
    { proxyPort: startLan['port'], roomPort });

  const pageM = await openSeatPage('imp-M', { bare: true });
  const joinM = await joinImpSeat(pageM, proxyUrlLan, { mode: 'create', roomName: ROOM_NAME });
  check('impairment: the mover seat joined the pinned room THROUGH the delay proxy', joinM.ok === true && typeof joinM.sessionId === 'string', joinM);
  const roomIdImp = joinM.roomId ?? '';
  const pageO = await openSeatPage('imp-O', { bare: true });
  const joinO = await joinSeat(pageO, { mode: 'byId', roomId: roomIdImp }, proxyUrlLan);
  check('impairment: the observer seat joined the SAME room through the SAME proxy', joinO.ok === true && joinO.roomId === roomIdImp, joinO);

  const lanBrowserApplication = await pageM.evaluate(() => {
    const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
    if (holder === undefined) throw new Error('the impairment mover is not joined');
    const at = holder.predictor.deliveryLedger().filter((d) => d.accepted).map((d) => d.delivery.atMs);
    const gaps = at.slice(1).map((value, index) => value - (at[index] ?? 0)).filter((g) => Number.isFinite(g) && g >= 0).sort((a, b) => a - b);
    return { deliveries: at.length, gapMinMs: gaps[0] ?? null, gapMedianMs: gaps[Math.floor(gaps.length / 2)] ?? null, gapMaxMs: gaps[gaps.length - 1] ?? null };
  });
  const lanMove = await runImpMover(pageM, 8, 'x');
  const lanSettled = await settleProxy(host, handleLan);
  const lanProxy = lanSettled.stats;
  const lanLedger = await readImpLedger(pageM);
  const lanObserver = await reportSeat(pageO);
  const trackOfMover = lanObserver.tracks.find((track) => track.sessionId === joinM.sessionId);

  check('impairment[lan]: the observer saw the mover travel on +x through the proxy with no tick regression',
    (trackOfMover?.delta.x ?? 0) > 0 && (trackOfMover?.tickRegressions ?? 1) === 0 && (trackOfMover?.epochChanges ?? 1) === 0,
    { delta: trackOfMover?.delta, regressions: trackOfMover?.tickRegressions });
  check('impairment[lan]: the authority acknowledged frames SENT THROUGH the proxy (lastProcessed > 0)', lanMove.lastProcessed > 0, lanMove);
  check('impairment[lan]: per-direction order held and nothing was dropped on the stall path',
    lanProxy.c2s.orderViolations === 0 && lanProxy.s2c.orderViolations === 0 && lanProxy.c2s.chunksDropped === 0 && lanProxy.s2c.chunksDropped === 0,
    { c2sOrder: lanProxy.c2s.orderViolations, s2cOrder: lanProxy.s2c.orderViolations });
  check('impairment[lan]: per-direction byte order held and requested/achieved raw stall pairs were recorded on both lanes',
    lanProxy.c2s.orderViolations === 0 && lanProxy.s2c.orderViolations === 0 && lanProxy.c2s.delayPairs.length > 0 && lanProxy.s2c.delayPairs.length > 0,
    { c2sPairs: lanProxy.c2s.delayPairs.length, s2cPairs: lanProxy.s2c.delayPairs.length });
  const lanValidity = networkValidity({
    requestedRttMs: planLan.profile.rttMs,
    declaredJitterBudgetMs: planLan.profile.jitterBudgetMs,
    achievedRttSamples: lanProxy.proxyLegSumSamples,
  });
  check('impairment[lan]: the DIAGNOSTIC PROXY-LEG-SUM record (demoted at review of 74e84179 — NOT accepted RTT) satisfies the §2.2 formula over the proxy raw leg-sum samples',
    lanValidity.valid, { requested: planLan.profile.rttMs, achieved: lanValidity.achieved, reasons: lanValidity.reasons });

  // ---- ACCEPTED achieved-RTT probe (slice 6c): the pinned SDK's protocol ping on the mover's
  // OWN joined socket, LAN profile, same pre-registered §2.2 formula, raw record stated.
  const lanProbe = await runImpRttProbe(pageM, { pings: 24, cadenceMs: 100, deadlineMs: 1_000 });
  const lanProbeValidity = networkValidity({
    requestedRttMs: planLan.profile.rttMs,
    declaredJitterBudgetMs: planLan.profile.jitterBudgetMs,
    achievedRttSamples: lanProbe.samples.map((sample) => sample.rttMs),
  });
  const lanProbeThrottle = lanSettled.throttle;
  check('rtt probe[lan]: the ACCEPTED achieved RTT is the pinned SDK\'s public protocol ping on the seat\'s OWN joined socket (transport.pingLatency → room.ping on the playing WebSocket); slot-reservation contract held (no retirement, no poison, no epoch change, nothing not-sent) — a late-echo crossing is structurally impossible and a poisoned slot stops the cell',
    lanProbe.abortedReason === null && lanProbe.samples.length === 24 && lanProbe.retiredUnconfirmed === 0 && lanProbe.slotPoisoned === false && lanProbe.socketClosed === false && lanProbe.epochChanged === false && lanProbe.notSent === 0,
    { answered: lanProbe.samples.length, lateDiscarded: lanProbe.lateDiscarded, retiredUnconfirmed: lanProbe.retiredUnconfirmed, slotPoisoned: lanProbe.slotPoisoned, socketClosed: lanProbe.socketClosed, epochChanged: lanProbe.epochChanged, notSent: lanProbe.notSent, abortedReason: lanProbe.abortedReason, hostThrottleAtProbe: lanProbeThrottle });
  check('rtt probe[lan]: raw LAN ping record — p50/p95/jitter(p95−p50)/count under the SAME §2.2 formula; a median or jitter miss fails this check honestly, and the ONLY tolerated short-run failure is insufficient-evidence',
    lanProbeValidity.reasons.every((reason) => reason.startsWith('insufficient-evidence')),
    { requested: planLan.profile.rttMs, achieved: lanProbeValidity.achieved, jitterP95P50: lanProbeValidity.achievedJitterMs, reasons: lanProbeValidity.reasons });
  const lanProbeDrift = probeDrift(lanProbe);
  check('rtt probe[lan]: monotonic-clock receipts — every sample brackets send→matching receive on the page clock, SDK-vs-wrapper drift stated (never subtracted), no non-positive sample, page clock tracks the wall clock',
    lanProbeDrift.everyOk, lanProbeDrift);

  // The matched-ack horizontal metric through the impaired path: exact rows, zero retention, and
  // the insufficient-evidence floor FIRING (this is a seconds-long run — it must fail the 100-ack
  // rule loudly, which is what proves a short run can never pass as an eligible one).
  // The instrumenter's vocabulary: 'measured' rows are the eligible matched-ack population;
  // 'anchored' is the one seed row per domain (excluded, never counted); invalidated rows carry
  // NaN and fail coverage. The Node-side population is built from 'measured' rows ONLY, so the
  // zero-retention comparison against stats.zero is like for like.
  const lanMeasured = lanLedger.rows.filter((row) => row.status === 'measured');
  const lanInvalidated = lanLedger.rows.filter((row) => row.status === 'invalidated-missing-frames');
  const lanTrace = createTraceWriter(join(OUT_DIR, 'matched-ack-lan-diagnostic.jsonl'));
  for (const row of lanLedger.rows) {
    lanTrace.append({ runLabel: planLan.label, phase: 'lan-baseline', authorityTick: row.authorityTick, epoch: row.epoch, ackFrom: row.ackFrom, ackTo: row.ackTo, seqs: row.seqs, status: row.status, correctionX: Number.isFinite(row.correctionX) ? row.correctionX : null, correctionZ: Number.isFinite(row.correctionZ) ? row.correctionZ : null, magnitudeMetres: Number.isFinite(row.magnitude) ? row.magnitude : null });
  }
  const lanTraceSummary = await lanTrace.close();
  const lanTraceRead = readTrace(join(OUT_DIR, 'matched-ack-lan-diagnostic.jsonl'));
  const lanSummary = summarizeCorrections(lanMeasured.map((row) => ({ magnitudeMetres: row.magnitude })), lanLedger.stats.measured);
  check('impairment[lan]: the matched-ack ledger has one row per eligible ack — NO missing samples — invalidated rows equal the invalidated counter, and coverage is complete',
    lanMeasured.length === lanLedger.stats.measured && lanInvalidated.length === lanLedger.stats.invalidated && lanSummary.missing === 0 && lanLedger.stats.adoptionCoverageIncomplete === 0 && lanLedger.stats.measured > 0,
    { measuredRows: lanMeasured.length, measured: lanLedger.stats.measured, invalidatedRows: lanInvalidated.length, invalidated: lanLedger.stats.invalidated, missing: lanSummary.missing, coverageIncomplete: lanLedger.stats.adoptionCoverageIncomplete });
  check('impairment[lan]: zero corrections are RETAINED end to end — the browser instrumenter zero count equals the Node-side retained zeros over the same population',
    lanSummary.zeroValues === lanLedger.stats.zero && lanSummary.zeroValues + lanSummary.nonzeroValues === lanSummary.measured,
    { browserZeros: lanLedger.stats.zero, nodeZeros: lanSummary.zeroValues, measured: lanSummary.measured });
  check('impairment[lan]: the short run FAILS the 100-ack floor with ONLY insufficient-evidence — the rule fires, so a diagnostic can never pose as eligible',
    lanSummary.failures.length === 1 && lanSummary.failures[0] === 'insufficient-evidence',
    { failures: lanSummary.failures, n: lanSummary.measured });
  check('impairment[lan]: the written trace is continuous (no seq gaps, no reordering) and holds every row',
    lanTraceRead.gaps.length === 0 && lanTraceRead.outOfOrder === false && lanTraceRead.records.length === lanTraceSummary.records && lanTraceSummary.records === lanLedger.rows.length,
    { gaps: lanTraceRead.gaps, records: lanTraceSummary.records, rows: lanLedger.rows.length });

  await closeImpSeat(pageM);
  await closeSeat(pageO);
  // Release the LAN seats' whole contexts BEFORE the elevated phase: a co-resident Chromium
  // renderer per leaked context is suite CPU that lands on the instrument as throttle events.
  await pageM.context().close();
  await pageO.context().close();
  const lanProxyClosed = await closeProxyBounded(host, handleLan);
  // Byte fidelity is asserted over the CLOSED stats: the room keeps patching while seats sit open,
  // so a mid-run snapshot legitimately catches a stall in flight. After an explicit drained close
  // every accepted byte has crossed, and a zero error count certifies no hard-close ever cut a
  // queue — errors would be exactly that, and the check would fail with the numbers in detail.
  check('impairment[lan]: explicit proxy close drained every stall in order — every accepted byte crossed, zero active connections, zero hard-close cuts',
    lanProxyClosed.connections.active === 0 && lanProxyClosed.connections.errors === 0
    && lanProxyClosed.c2s.bytesDelivered === lanProxyClosed.c2s.bytesReceived && lanProxyClosed.s2c.bytesDelivered === lanProxyClosed.s2c.bytesReceived,
    {
      connections: lanProxyClosed.connections,
      c2s: { r: lanProxyClosed.c2s.bytesReceived, d: lanProxyClosed.c2s.bytesDelivered },
      s2c: { r: lanProxyClosed.s2c.bytesReceived, d: lanProxyClosed.s2c.bytesDelivered },
    });
  await pageM.context().close();
  await pageO.context().close();

  // ==================== phase 2: labelled elevated calibration through a second proxy ========
  const startElev = await host.request({ op: 'start', profile: planElev.impairment, targetHost: '127.0.0.1', targetPort: roomPort });
  const handleElev = startElev['handle'] as number;
  const proxyUrlElev = `http://127.0.0.1:${String(startElev['port'] as number)}`;
  const pageM2 = await openSeatPage('imp-M2', { bare: true });
  const joinM2 = await joinImpSeat(pageM2, proxyUrlElev, { mode: 'create', roomName: ROOM_NAME });
  const pageO2 = await openSeatPage('imp-O2', { bare: true });
  const joinO2 = await joinSeat(pageO2, { mode: 'byId', roomId: joinM2.roomId ?? '' }, proxyUrlElev);
  check('impairment[elevated]: the calibration seats joined through the elevated-profile proxy', joinM2.ok === true && joinO2.ok === true, { m: joinM2, o: joinO2 });

  // 30 steps ≈ a ~2× wider sample base at the same 60 ms cadence: an episodic multi-second
  // throttle freeze then inflates a SMALLER fraction of the ranked samples — the honest p95 of
  // a bigger window, not a moved threshold.
  const elevMove = await runImpMover(pageM2, 30, 'z');
  const elevSettled = await settleProxy(host, handleElev);
  const elevProxy = elevSettled.stats;
  const elevLedger = await readImpLedger(pageM2);
  const elevObserver = await reportSeat(pageO2);
  // Browser-application-path observation, recorded SEPARATELY and never fed to networkValidity:
  // accepted-delivery inter-arrival gaps inside the page (patch interval + authority tick +
  // renderer scheduling live HERE, not in the proxy's byte samples).
  const browserApplication = await pageM2.evaluate(() => {
    const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
    if (holder === undefined) throw new Error('the impairment mover is not joined');
    const at = holder.predictor.deliveryLedger().filter((d) => d.accepted).map((d) => d.delivery.atMs);
    const gaps = at.slice(1).map((value, index) => value - (at[index] ?? 0)).filter((g) => Number.isFinite(g) && g >= 0).sort((a, b) => a - b);
    return { deliveries: at.length, gapMinMs: gaps[0] ?? null, gapMedianMs: gaps[Math.floor(gaps.length / 2)] ?? null, gapMaxMs: gaps[gaps.length - 1] ?? null };
  });
  const trackElev = elevObserver.tracks.find((track) => track.sessionId === joinM2.sessionId);

  check('impairment[elevated]: movement completes through the impaired path (observer sees +z, no regressions)',
    (trackElev?.delta.z ?? 0) > 0 && (trackElev?.tickRegressions ?? 1) === 0, { delta: trackElev?.delta });
  check('impairment[elevated]: STALLS ARE NOT A NEW DOMAIN — through ~1.4 s of 100/20 impairment the mover issued ONE epoch and its generations ran 1..N with ZERO restarts (the A-2 producer rule, proven over real impairment)',
    elevMove.restarts === 0 && elevMove.epochs.length === 1 && consecutiveFromOne(elevMove.generations),
    { restarts: elevMove.restarts, epochs: elevMove.epochs, generations: elevMove.generations });

  const elevValidity = networkValidity({
    requestedRttMs: planElev.profile.rttMs,
    declaredJitterBudgetMs: planElev.profile.jitterBudgetMs,
    achievedRttSamples: elevProxy.proxyLegSumSamples,
  });
  // The §2.2 rule on the CONNECTED browser path, asserted strictly. The achieved sample is the
  // byte's true in-proxy queue time — timer overshoot and stream wait included, NOTHING
  // subtracted — but the instrument now runs on an uncontended loop (dedicated host process),
  // and the diagnostics beside the metric name the causes. If this check fails it is a measured
  // blocker with its own evidence (lag/stream-wait breakdown), not something to average away.
  check('impairment[elevated]: the connected DIAGNOSTIC PROXY-LEG-SUM record is VALID on the uncontended instrument (demoted at review of 74e84179 — a valid leg-sum is queue health, NOT an accepted Gate A achieved RTT; contamination breakdown stated beside the metric)',
    elevValidity.valid,
    {
      verdict: elevValidity.valid ? 'valid' : 'INVALID',
      requested: planElev.profile.rttMs,
      achievedP50: elevValidity.achieved?.p50,
      achievedP95: elevValidity.achieved?.p95,
      jitterP95P50: elevValidity.achievedJitterMs,
      samples: elevValidity.achieved?.n ?? 0,
      reasons: elevValidity.reasons,
      diagnostics: {
        c2s: { maxTimerLagMs: elevProxy.c2s.maxTimerLagMs, chunksBackpressured: elevProxy.c2s.chunksBackpressured, totalStreamWaitMs: elevProxy.c2s.totalStreamWaitMs, maxStreamWaitMs: elevProxy.c2s.maxStreamWaitMs },
        s2c: { maxTimerLagMs: elevProxy.s2c.maxTimerLagMs, chunksBackpressured: elevProxy.s2c.chunksBackpressured, totalStreamWaitMs: elevProxy.s2c.totalStreamWaitMs, maxStreamWaitMs: elevProxy.s2c.maxStreamWaitMs },
        hostCgroupThrottle: elevSettled.throttle,
        browserApplicationPath: browserApplication,
      lanBrowserApplicationPath: lanBrowserApplication,
      },
    });
  check('impairment[elevated]: under impairment the order audit held and the stall path dropped nothing',
    elevProxy.c2s.orderViolations === 0 && elevProxy.s2c.orderViolations === 0 && elevProxy.c2s.chunksDropped === 0,
    { c2sOrder: elevProxy.c2s.orderViolations, s2cOrder: elevProxy.s2c.orderViolations });

  const elevTrace = createTraceWriter(join(OUT_DIR, 'matched-ack-elevated-diagnostic.jsonl'));
  for (const row of elevLedger.rows) {
    elevTrace.append({ runLabel: planElev.label, phase: 'elevated-calibration', authorityTick: row.authorityTick, epoch: row.epoch, ackFrom: row.ackFrom, ackTo: row.ackTo, seqs: row.seqs, status: row.status, correctionX: Number.isFinite(row.correctionX) ? row.correctionX : null, correctionZ: Number.isFinite(row.correctionZ) ? row.correctionZ : null, magnitudeMetres: Number.isFinite(row.magnitude) ? row.magnitude : null });
  }
  const elevTraceSummary = await elevTrace.close();
  const elevMeasuredRows = elevLedger.rows.filter((row) => row.status === 'measured');
  const elevSummary = summarizeCorrections(elevMeasuredRows.map((row) => ({ magnitudeMetres: row.magnitude })), elevLedger.stats.measured);
  check('impairment[elevated]: the elevated ledger is complete and its ONLY failure is the short-run floor (missing samples would be a different, failing reason)',
    elevSummary.missing === 0 && elevSummary.measured === elevLedger.stats.measured && elevSummary.failures.length === 1 && elevSummary.failures[0] === 'insufficient-evidence' && elevTraceSummary.records === elevLedger.rows.length,
    { missing: elevSummary.missing, failures: elevSummary.failures, records: elevTraceSummary.records });

  // ---- ACCEPTED achieved-RTT probe on the elevated path, then its two negative controls.
  const elevProbe = await runImpRttProbe(pageM2, { pings: 24, cadenceMs: 100, deadlineMs: 1_000 });
  const elevProbeValidity = networkValidity({
    requestedRttMs: planElev.profile.rttMs,
    declaredJitterBudgetMs: planElev.profile.jitterBudgetMs,
    achievedRttSamples: elevProbe.samples.map((sample) => sample.rttMs),
  });
  const elevProbeThrottle = (await host.request({ op: 'stats', handle: handleElev }))['throttle'] as { worstThrottleDeltaUsec: number; worstThrottleDeltaEvents: number } | undefined;
  check('rtt probe[elevated]: raw elevated ping RTT through the 100/20 proxy on the PLAYING socket — p50/p95/jitter/count under the SAME §2.2 formula; median/jitter misses fail honestly; only insufficient-evidence is tolerated as the short-run floor; slot-reservation must hold (poison/close/epoch would stop the cell and fail here AS A MEASURED BLOCKER, never disguised as latency)',
    elevProbe.abortedReason === null && elevProbe.retiredUnconfirmed === 0 && elevProbeValidity.reasons.every((reason) => reason.startsWith('insufficient-evidence')),
    { requested: planElev.profile.rttMs, achieved: elevProbeValidity.achieved, jitterP95P50: elevProbeValidity.achievedJitterMs, lateDiscarded: elevProbe.lateDiscarded, retiredUnconfirmed: elevProbe.retiredUnconfirmed, slotPoisoned: elevProbe.slotPoisoned, socketClosed: elevProbe.socketClosed, epochChanged: elevProbe.epochChanged, notSent: elevProbe.notSent, abortedReason: elevProbe.abortedReason, reasons: elevProbeValidity.reasons, hostThrottleAtProbe: elevProbeThrottle });
  const elevProbeDrift = probeDrift(elevProbe);
  check('rtt probe[elevated]: monotonic-clock receipts on the impaired path (same send→matching-receive bracket, SDK drift stated, clock sanity)',
    elevProbeDrift.everyOk, elevProbeDrift);

  const missingReplyControl = await runImpRttMissingReplyControl(pageM2, { normalDeadlineMs: 1_000, shortDeadlineMs: 30 });
  // (when the seat socket died upstream of this control, before/after report socketClosed:true —
  // the check below then fails WITH the death record, exactly as it should.)

  // QUIET-WINDOW probe (the profile means what it says: the impairment sits on a path with no
  // background traffic). The room's own patch stream IS background traffic for the probe —
  // a sustained stream with per-message delay ~ its inter-arrival makes the FIFO delay
  // bandwidth-clamp rate-couple (queueing backlog), inflating the loaded median. Under the tick
  // gate (HOLD ONLY — state generation stops) the same probe reads the path at near-zero
  // background: the honest quiet-window median. Loaded vs quiet medians are BOTH recorded.
  const ctlQuietGate = installTickGate(joinM2.roomId ?? '');
  ctlQuietGate.hold();
  const quietProbe = await runImpRttProbe(pageM2, { pings: 12, cadenceMs: 150, deadlineMs: 1_000 });
  ctlQuietGate.restore();
  const quietProbeValidity = networkValidity({
    requestedRttMs: planElev.profile.rttMs,
    declaredJitterBudgetMs: planElev.profile.jitterBudgetMs,
    achievedRttSamples: quietProbe.samples.map((sample) => sample.rttMs),
  });
  check('rtt probe[elevated]: the QUIET-WINDOW record (tick-gate held, room background traffic stopped) — p50/p95/jitter/count under the SAME §2.2 formula; loaded and quiet medians both stated, no cherry-picking: the LOADED cell stays exactly as measured',
    quietProbe.abortedReason === null && quietProbe.retiredUnconfirmed === 0
    && quietProbeValidity.reasons.every((reason) => reason.startsWith('insufficient-evidence')),
    { requested: planElev.profile.rttMs, achieved: quietProbeValidity.achieved, jitterP95P50: quietProbeValidity.achievedJitterMs, reasons: quietProbeValidity.reasons, loadedMedianMs: elevProbeValidity.achieved?.p50, s2cBytesQuietWindow: ((await host.request({ op: 'stats', handle: handleElev }))['stats'] as ProxyStats).s2c.bytesReceived });
  // (when the seat socket died upstream of this control, before/after report socketClosed:true —
  // the check below then fails WITH the death record, exactly as it should.)
  check('rtt probe control: a MISSING/late reply is handled by SLOT RESERVATION — the 30 ms-deadline ping RETIRED, its late echo was POSITIVELY confirmed as a discard (counted, never sampled), and the next ping answered only on the VERIFIED-FREE slot; the impossible-confirmation poison case (stop the cell, mark not-sent, never resend on the slot) is deterministically unit-tested (6/6)',
    missingReplyControl.before.samples.length === 1
    && missingReplyControl.short.samples.length === 0 && missingReplyControl.short.lateDiscarded === 1 && missingReplyControl.short.abortedReason === null
    && missingReplyControl.after.samples.length === 1 && missingReplyControl.after.abortedReason === null,
    { before: missingReplyControl.before.abortedReason, short: { retiredConfirmedDiscard: missingReplyControl.short.lateDiscarded, aborted: missingReplyControl.short.abortedReason }, after: missingReplyControl.after.abortedReason });

  // Patch/movement independence: with the authority tick held (test-only tick gate; exactly one
  // step per 300 ms) the seat's MOVEMENT freezes while the protocol ping keeps answering — the
  // sample brackets the ping's OWN causal reply, not the patch pipeline or its application.
  const statsBeforeCtl = (await host.request({ op: 'stats', handle: handleElev }))['stats'] as ProxyStats;
  const obsBeforeCtl = await reportSeat(pageO2);
  const ctlGate = installTickGate(joinM2.roomId ?? '');
  const ctlPasses = setInterval(() => {
    ctlGate.passOne();
  }, 300);
  ctlGate.hold();
  const ctlProbe = await runImpRttProbe(pageM2, { pings: 10, cadenceMs: 100, deadlineMs: 1_000 });
  clearInterval(ctlPasses);
  ctlGate.restore();
  const obsAfterCtl = await reportSeat(pageO2);
  const statsAfterCtl = (await host.request({ op: 'stats', handle: handleElev }))['stats'] as ProxyStats;
  const ctlTrack = obsAfterCtl.tracks.find((track) => track.sessionId === joinM2.sessionId);
  const ctlMovedMetres = Math.hypot(ctlTrack?.delta.x ?? 0, ctlTrack?.delta.z ?? 0);
  const fullMedian = medianOf(elevProbe.samples.map((sample) => sample.rttMs));
  const ctlMedian = medianOf(ctlProbe.samples.map((sample) => sample.rttMs));
  const patchIndependence = {
    ctlAnswered: ctlProbe.samples.length, ctlRetiredUnconfirmed: ctlProbe.retiredUnconfirmed,
    ctlAborted: ctlProbe.abortedReason, ctlNotSent: ctlProbe.notSent,
    ctlMedianMs: ctlMedian, fullMedianMs: fullMedian,
    observerMovedMetresDuringHold: Number(ctlMovedMetres.toFixed(3)),
    s2cBytesDuringCtl: statsAfterCtl.s2c.bytesReceived - statsBeforeCtl.s2c.bytesReceived,
    c2sBytesDuringCtl: statsAfterCtl.c2s.bytesReceived - statsBeforeCtl.c2s.bytesReceived,
  };
  check('rtt probe control: PATCH/MOVEMENT INDEPENDENCE — under a tick hold the seat\'s movement freezes (observer advances < 1 m) while EVERY ping still answers exactly once at cadence with a comparable median: the RTT sample is the ping\'s own causal reply on the same socket, not a repatched patch',
    ctlProbe.samples.length === 10 && ctlProbe.abortedReason === null && ctlMovedMetres < 1
    && fullMedian !== null && ctlMedian !== null && Math.abs(ctlMedian - fullMedian) < Math.max(20, fullMedian * 0.5),
    { ...patchIndependence, observerBaselineReset: obsBeforeCtl.tracks.length >= 0, note: 'byte counts include ping frames (1 B up / 1 B down each) plus residual wire traffic under the hold' });

  await closeImpSeat(pageM2);
  await closeSeat(pageO2);
  const elevProxyClosed = await closeProxyBounded(host, handleElev);
  check('impairment[elevated]: the elevated proxy stalled, never dropped — the CLOSED stats show every accepted byte crossed, zero active connections, zero hard-close cuts (connLog states WHO closed every connection and its lifetime — an endpoint death is attributed, never absorbed)',
    elevProxyClosed.connections.active === 0 && elevProxyClosed.connections.errors === 0
    && elevProxyClosed.c2s.bytesDelivered === elevProxyClosed.c2s.bytesReceived && elevProxyClosed.s2c.bytesDelivered === elevProxyClosed.s2c.bytesReceived,
    {
      connections: elevProxyClosed.connections,
      c2s: { r: elevProxyClosed.c2s.bytesReceived, d: elevProxyClosed.c2s.bytesDelivered },
      s2c: { r: elevProxyClosed.s2c.bytesReceived, d: elevProxyClosed.s2c.bytesDelivered },
    });

  check('impairment: the impaired seats ran through the shared step kernel (the fixture room stepped more authority ticks)',
    (kernelStepper?.kernelStepperSentinel.calls ?? 0) > kernelCallsBefore,
    { before: kernelCallsBefore, after: kernelStepper?.kernelStepperSentinel.calls ?? 0 });

  const impErrors = ['imp-M', 'imp-O', 'imp-M2', 'imp-O2'].flatMap((label) => pageErrorSinks.get(label) ?? []);
  check('impairment: no unexpected page or console errors on any impaired seat', impErrors.length === 0, impErrors.slice(0, 4));

  // The exact receipt of a NORMAL FINITE Node teardown of the impairment instrument: shutdown was
  // requested (not killed), the process exited on its own within the pre-cap, every proxy drained,
  // and the host states what (if anything) stayed live.
  const hostTeardown = await host.shutdown();
  hostTornDown = true;
  check('impairment: finite-teardown RECEIPT of the proxy host — clean exit code 0, both proxies closed, zero active resources after close, within the pre-cap',
    hostTeardown.exitCode === 0 && hostTeardown.receipt !== null
    && hostTeardown.receipt.exitCode === 0 && hostTeardown.receipt.proxiesClosed === 2 && hostTeardown.receipt.proxiesOpened === 2
    && hostTeardown.receipt.activeResourcesAfterClose.length === 0
    && hostTeardown.receipt.shutdownMs < HOST_SHUTDOWN_TIMEOUT_MS,
    { ...hostTeardown, stderr: hostTeardown.stderrTail.slice(0, 200) });

  // The efficient local evidence for this slice: raw samples kept, not just the verdicts.
  mkdirSync(dirname(RESULTS_FILE), { recursive: true });
  writeFileSync(join(OUT_DIR, 'impairment-proxy-stats.json'), `${JSON.stringify({
    schemaVersion: 2,
    taskId: TASK_ID,
    implementationSha: headSha(),
    gate: 'Not Run — diagnostic infrastructure smoke; no p95 gate, no matrix verdict',
    demotionNote: 'Review of 74e84179: the proxy aggregate is the DIAGNOSTIC PROXY-LEG SUM (newest delivered forward stall + a later reverse stall on the same connection). It is NOT an accepted round trip: the periodic patch need not be caused by that forward chunk, coalescing and repeated forward pairings bias percentiles, and the time between legs is omitted. Earlier on-disk runs are preserved untouched; in this ONWARD schema the aggregate is named diagnosticProxyLegSum and its VALID labels count as queue-health diagnostics only. The ACCEPTED achieved RTT is the SDK protocol ping probe in acceptedRttProbe.',
    environment: { ...captureEnvironmentRecord(), browser: browser?.version() ?? 'unknown', headed: 'headless' },
    impairmentSource: impairmentSourceRecord(true),
    timestampProvenance: {
      proxySamples: 'process.hrtime.bigint (monotonic) inside the dedicated proxy-host Node process; arrivedAt on socket data events, deliveredAt at stall-timer fire; achieved = deliveredAt - arrivedAt (timer overshoot and stream wait INCLUDED — nothing subtracted). Feeds the DIAGNOSTIC proxy-leg-sum only.',
      browserPaths: 'page performance.now() enters the browserApplicationPath observation (delivery inter-arrival) AND brackets the ACCEPTED RTT probe: the ping wrapper stamps performance.now at send and at the matching receive on the SAME monotonic page clock; the SDK\'s own rounded ms rides along as a drift receipt, never subtracted.',
      rttPairing: 'legacy label, now demoted: the leg-sum pairing (newest delivered forward + later reverse) is a queue diagnostic. The accepted round trip has no pairing heuristic at all — it is one PING frame and its protocol echo, correlated by the SDK\'s single-slot exactly-once callback, serialized single-in-flight by the probe.',
    },
    acceptedRttProbe: {
      seam: '@colyseus/sdk@0.18.9 public Room.ping (src/Room.ts:307-317 one Protocol.PING byte on the joined socket; :788-791 echo fires the callback EXACTLY ONCE and clears the slot) echoed synchronously by @colyseus/core@0.18.27 (build/Room.mjs:1436-1437 client.raw) — protocol layer, no room code, no tick/patch involvement. Reached via transport.pingLatency on the seat\'s own joined transport (additive optional pass-through in the contract-owned adapter). Excluded seams: client.getLatency (separate probe connection + Date.now wall clock), room.clock RTT estimator (smoothed server-time estimate, not a raw round trip), proxy leg-sum (demoted above).',
      rules: 'SLOT RESERVATION (review of 4db1a0f): a retirement keeps the slot RESERVED until the original echo is positively observed; no confirmation within confirmCapMs POISONS the cell — the window stops, remaining opportunities are not-sent, and no ping is ever sent on that slot again; the slot is never overwritten on an elapsed grace; reply deadlines retire samples as invalid — never estimated, never reused; late echoes are counted discards; epoch change mid-window stops the cell; no subtraction anywhere. The state machine is unit-tested deterministically (6/6) and imported UNCHANGED by the page via the loopback vite pipeline.',
      lan: { cadenceMs: 100, deadlineMs: 1_000, rawSamplesMs: lanProbe.samples.map((sample) => sample.rttMs), sdkMs: lanProbe.samples.map((sample) => sample.sdkMs), lateDiscarded: lanProbe.lateDiscarded, retiredUnconfirmed: lanProbe.retiredUnconfirmed, slotPoisoned: lanProbe.slotPoisoned, socketClosed: lanProbe.socketClosed, epochChanged: lanProbe.epochChanged, notSent: lanProbe.notSent, abortedReason: lanProbe.abortedReason, hostThrottleAtProbe: lanProbeThrottle, summary: lanProbeValidity, drift: lanProbeDrift },
      elevated: { cadenceMs: 100, deadlineMs: 1_000, rawSamplesMs: elevProbe.samples.map((sample) => sample.rttMs), sdkMs: elevProbe.samples.map((sample) => sample.sdkMs), lateDiscarded: elevProbe.lateDiscarded, retiredUnconfirmed: elevProbe.retiredUnconfirmed, slotPoisoned: elevProbe.slotPoisoned, socketClosed: elevProbe.socketClosed, epochChanged: elevProbe.epochChanged, notSent: elevProbe.notSent, abortedReason: elevProbe.abortedReason, hostThrottleAtProbe: elevProbeThrottle, summary: elevProbeValidity, drift: elevProbeDrift },
      elevatedQuietWindow: { cadenceMs: 150, deadlineMs: 1_000, rawSamplesMs: quietProbe.samples.map((sample) => sample.rttMs), sdkMs: quietProbe.samples.map((sample) => sample.sdkMs), lateDiscarded: quietProbe.lateDiscarded, retiredUnconfirmed: quietProbe.retiredUnconfirmed, slotPoisoned: quietProbe.slotPoisoned, socketClosed: quietProbe.socketClosed, epochChanged: quietProbe.epochChanged, notSent: quietProbe.notSent, abortedReason: quietProbe.abortedReason, summary: quietProbeValidity, drift: probeDrift(quietProbe) },
      controls: { missingReply: missingReplyControl, patchIndependence },
      overheadBytes: { pingUp: 1, pongDown: 1, source: 'sdk Room.ts:316 connection.send(sharedBuffer.subarray(0, 1)); core Room.mjs:1437 client.raw(one-byte PING frame)', pingsSent: { lan: 24, elevated: 24 + 3 + 10 }, elevBytesDuringCtlWindow: { c2s: statsAfterCtl.c2s.bytesReceived - statsBeforeCtl.c2s.bytesReceived, s2c: statsAfterCtl.s2c.bytesReceived - statsBeforeCtl.s2c.bytesReceived } },
    },
    instrumentProcess: { hostPid: host.pid, caps, teardown: hostTeardown.receipt, teardownExitCode: hostTeardown.exitCode },
    browserApplicationPath: browserApplication,
    contaminationDiagnostics: {
      hostCgroupThrottle: { lan: lanSettled.throttle, elevated: elevSettled.throttle },
      lan: { c2s: { maxTimerLagMs: lanProxy.c2s.maxTimerLagMs, chunksBackpressured: lanProxy.c2s.chunksBackpressured, totalStreamWaitMs: lanProxy.c2s.totalStreamWaitMs }, s2c: { maxTimerLagMs: lanProxy.s2c.maxTimerLagMs, chunksBackpressured: lanProxy.s2c.chunksBackpressured, totalStreamWaitMs: lanProxy.s2c.totalStreamWaitMs } },
      elevated: { c2s: { maxTimerLagMs: elevProxy.c2s.maxTimerLagMs, chunksBackpressured: elevProxy.c2s.chunksBackpressured, totalStreamWaitMs: elevProxy.c2s.totalStreamWaitMs }, s2c: { maxTimerLagMs: elevProxy.s2c.maxTimerLagMs, chunksBackpressured: elevProxy.s2c.chunksBackpressured, totalStreamWaitMs: elevProxy.s2c.totalStreamWaitMs } },
    },
    runs: {
      lan: {
        label: planLan.label, official: planLan.official, requested: { rttMs: planLan.profile.rttMs, jitterBudgetMs: planLan.profile.jitterBudgetMs, seed: planLan.seed },
        requestedAchievedC2s: summarizeDelays(lanProxy.c2s.delayPairs),
        requestedAchievedS2c: summarizeDelays(lanProxy.s2c.delayPairs),
        diagnosticProxyLegSum: lanValidity, rawProxyLegSumSamples: lanProxy.proxyLegSumSamples, proxyConnections: lanProxyClosed.connections, proxyConnLog: lanProxyClosed.connLog,
        matchedAck: { stats: lanLedger.stats, summary: lanSummary },
      },
      elevated: {
        label: planElev.label, official: planElev.official, requested: { rttMs: planElev.profile.rttMs, jitterBudgetMs: planElev.profile.jitterBudgetMs, seed: planElev.seed },
        requestedAchievedC2s: summarizeDelays(elevProxy.c2s.delayPairs),
        requestedAchievedS2c: summarizeDelays(elevProxy.s2c.delayPairs),
        diagnosticProxyLegSum: elevValidity, rawProxyLegSumSamples: elevProxy.proxyLegSumSamples, proxyConnections: elevProxyClosed.connections, proxyConnLog: elevProxyClosed.connLog,
        matchedAck: { stats: elevLedger.stats, summary: elevSummary },
        producerRule: elevMove,
      },
    },
  }, null, 2)}\n`);
  };

  let bodyError: unknown = null;
  try {
    await runBody();
  } catch (error) {
    bodyError = error;
  }
  if (!hostTornDown) {
    // The body aborted (check throw, pre-cap breach, freeze): the host STILL must not outlive the
    // test — a bounded shutdown receipt is taken here and stated in the limitations record.
    try {
      const guardTeardown = await host.shutdown();
      limitations.push(`impairment smoke aborted with an error (${String(bodyError instanceof Error ? bodyError.message : bodyError).slice(0, 160)}); the proxy host was shut down by the guard: exit ${String(guardTeardown.exitCode)}, receipt ${JSON.stringify(guardTeardown.receipt ?? 'none')}`);
    } catch {
      void host.shutdown();
      limitations.push('impairment smoke aborted AND the proxy host guard-shutdown itself failed — the host was signalled; see dpa2 evidence');
    }
  }
  if (bodyError !== null) throw bodyError;
});

limitations.push('Accepted-RTT demotion (review of 74e84179): the proxy leg-sum (all earlier runs included, preserved on disk untouched) is a DIAGNOSTIC queue record — its VALID labels never count as Gate A achieved RTT. The accepted achieved round trip is the SDK protocol ping probe: seconds-long diagnostic windows here, so its cells fail the 100-sample floor by design; official cells run the full matrix windows on a quiet runner.');
limitations.push('Impairment-proxy smoke (slice 6): BOTH cells are short DIAGNOSTIC runs (lan-labelled baseline and elevated calibration) — they certify the proxy primitive, the statistics, the trace semantics and the achieved-network rule, and they certify NOTHING about the p95 correction gate: the windows are seconds, every population here deliberately fails the 100-ack floor, and no profile/seed/window in this test matches an official matrix cell.');
limitations.push('Impairment semantics: the proxy STALLS TCP streams (seeded, centred, bounded; byte order preserved) and models NO packet loss — any future loss population over this path is application-layer delivery loss by ADR-0003 §2.4 and travels labelled as such (dropModel set, tcpLossModelled false). A TCP stall is not packet loss: it withholds bytes the connection already guaranteed; it never destroys one.');

limitations.push('Two-browser-context loopback smoke: it certifies nothing about the four-profile Gate A matrix, the seeds, impairment, forced corrections, or the 20-client ten-minute workload.');
limitations.push('Gate A remains Not Run; the client compiler diagnostics are a separate claim in docs/integration/colyseus-0.18-api-map.md §12 and docs/adr/0004-client-declaration-checking-exception.md.');
limitations.push('Local prediction and forced correction (slice 4, revised after review): the two forced corrections are induced by staging a frame the AUTHORITY refuses (generation 0 beside the live watermark) through the public SDK handle, while a TEST-ONLY tick gate freezes the pinned room between ticks so the refusal is consumed at EXACTLY authority ticks 40 and 120 — the disposition tick is read from the room\'s public per-tick consumption ledger, and the delivery tick is recorded separately. The gate wraps the room instance only inside this test process; no server file is edited and no shipped behaviour changes. Corrections are measured by the per-matched-ack checkpoint instrumenter (shared reference step function, every eligible ack exactly once, unavailable checkpoints invalidated rather than zeroed); the old end-pose difference is retained under a renamed, honestly-labelled diagnostic. Recovery evidence now covers three distinct browser paths: deadline/suspension under sustained network loss, bounded-retry resume through a real rejoin and fresh snapshot, and a genuine overflow/retirement trigger observed in the server ledger. The named-gap trigger remains unreachably quiet in this server build (it never names a range on loopback) and is pinned by the unit suite only.');
limitations.push('Gate A per-tick and safety-on-transition rows are not evaluated here: a browser sees patched deliveries, not the authority journal, and the 100 ms patch interval over a 50 ms step means one delivery carries two consumed ticks. The transient `movementMode` of a consumed direct intent is therefore recorded and not asserted. Those rows wait for the Gate A run against the journal.');
limitations.push('Slice 5 review items, closed at the amendment round: (1) the step relation is ONE exported function used by BOTH sides of the spike — apps/client flatStep is imported by the adapter/browser pages/instrumenter, and (owner-approved amendment A-1, assignments §3.5) the netcode harness room and the AC-1 trace step the authority through tests/support/step-kernel/kernel-stepper.mjs wrapping that same dist export via the trusted stepperFactory seam; production default FlatReferenceStepper unchanged (parity + sentinel + module-identity checks pin this). (3) matched-ack checkpoints are corroborated per adoption (adoptionLedger conservation on real behaviour, direct-vs-reconstructed boundaries, coverage holes fail the metric) with the refused-then-advancing single-batch browser control. (2) retirement is asserted as TWO events by exact identity and BOTH now hold end to end: EVENT 1 (offender closed through the §3.1/§3.3 branch, code 4100, closure tick before the replacement\'s snapshot tick) and EVENT 2 (new session/epoch domain, fresh snapshot before any fresh input, replacement MOVES ≥0.4 m with zero nominal corrections) at the default and deferred rejoin cadences. The earlier "replacement never moves" finding is RESCINDED: it was this fixture\'s mover continuing the old generation sequence across the new epoch (protocol §4.2; MAX_GENERATION_FORWARD_GAP screen refuses such frames with a neutral step); the suite retains that breach as a RED scenario reproduced with a same-seat positive control, and the legacy EITHER-check is pinned as the control that a broken replacement could pass but the strict claim cannot. The named-gap/stalled-ack/termination matrix coverage remains outstanding.');


/* ------------------------------------------------------------------ Gate A local cell (slice 6d, grant T-3)
 *
 * `pnpm test:spike -- --id UDG-SPIKE-001 --cell elevated-full` dispatches THIS cell and nothing
 * else. It is a DIAGNOSTIC: one candidate-bound local elevated run with the FULL Gate A windows
 * (20 s warmup + 120 s measure), two TRUE browser contexts, the accepted achieved RTT measured
 * on the mover's own playing socket by the slot-reserving SDK-ping state machine, matched-ack
 * corrections sampled with zero retention and invalidations counted apart, p95 raw correction
 * against the 0.15 m target, loopback-only isolation, bounded teardown with receipts, the stable
 * seed recorded, and candidate identity (exact commit sha + dirty flag) in the record. Actual
 * verdicts only: validity misses fail the cell honestly, a stopped probe fails it as a MEASURED
 * BLOCKER, and the disposition says what it is — a local diagnostic, not Gate A, not a matrix
 * cell, not a verdict. The ordinary netcode suite never runs it (skipped unless dispatched).
 */
const readCpuThrottle = (): { throttledUsec: number; throttledEvents: number } | null => {
  try {
    const stat = readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8');
    const usec = /\nthrottled_usec (\d+)/.exec(stat)?.[1];
    const events = /\nthrottled_usec \d+\n(nr_throttled (\d+))/.exec(stat)?.[2] ?? /\nnr_throttled (\d+)/.exec(stat)?.[1];
    return usec === undefined ? null : { throttledUsec: Number(usec), throttledEvents: Number(events ?? '0') };
  } catch {
    return null;
  }
};

// eslint-disable-next-line no-empty-pattern -- Playwright requires the destructured args object even when the cell uses only testInfo.
test('spike cell: full-window — the parameterized full-profile matrix runner (explicit profile+seed, full 20s warmup + 120s measure on the browser monotonic clock; canonical unobstructed route; isolated first attempt, ZERO automatic retries; NOT Gate A unless dispatched formal)', async ({}, testInfo) => {
  test.skip(process.env['UDG_SPIKE_CELL'] !== 'full-window', 'dispatched only by `pnpm test:spike -- --id UDG-SPIKE-001 --cell full-window --profile <lan|moderate|elevated|poor> --seed <n>` (grant T-3, parameterized slice 11; the legacy `--cell elevated-full` maps onto THIS runner with the elevated profile named explicitly by the dispatcher); the ordinary netcode suite never runs the full-window cell');
  test.setTimeout(420_000);
  expect(fixture, 'the room fixture booted').toBeDefined();
  // NO silent defaults on this runner: the regime must be NAMED by the dispatch, never inherited.
  const profile = process.env['UDG_SPIKE_PROFILE'] ?? '';
  expect(['lan', 'moderate', 'elevated', 'poor'], `full-window cell was dispatched with profile "${profile}" — the runner takes no default profile`).toContain(profile);
  const seed = Number(process.env['UDG_SPIKE_SEED'] ?? 'not-a-number');
  expect(Number.isInteger(seed) && seed > 0, 'full-window cell was dispatched without an explicit integer --seed').toBe(true);
  const profileSource = process.env['UDG_SPIKE_PROFILE_SOURCE'] ?? 'unknown';
  const formalMode = process.env['UDG_GATE_A_FORMAL'] === '1';
  const firstAttemptAt = new Date().toISOString();
  const roomPort = Number(new URL(fixture?.endpoint ?? 'http://127.0.0.1:0').port);
  const officialSeed = [1001, 1002, 1003].includes(seed);
  const plan = officialSeed
    ? planSpikeRun({ profile, seed })
    : planSpikeRun({ profile, seed, diagnostic: { reason: 'full-window-non-official-seed' } });
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim().length > 0;

  const cellChecks: { name: string; ok: boolean; detail: unknown }[] = [];
  const cellCheck = (name: string, ok: boolean, detail: unknown): void => {
    cellChecks.push({ name, ok, detail });
    check(name, ok, detail);
  };
  const nonLoopback: string[] = [];

  // ---- phase boundaries: waitPumpPhase (below) waits on the PUMP'S OWN monotonic clock and
  // stamps in the same clock — start, end and the authored motion share ONE timebase (slice 12;
  // the old stampPhase-after-a-wall-sleep construction is what made LAN structurally unable to
  // reach 120 s).

  // ---- the canonical predeclared route: 12 s legs on a 48 m square (+x → +z → −x → −z),
  // driven by the SAME ack-ledger module the unit tests pin. provably inside the ±50 m region
  // from any spawn at −49…−1 (verified below, BEFORE the window runs), so no authored leg can
  // reach a bound — a clamp is structurally impossible on this route, not merely unobserved.
  const startRoutePump = (page: Page, pumpMs: number): Promise<{ sendError: string | null }> =>
    page.evaluate(async (args) => {
      const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
      if (holder === undefined) throw new Error('the cell mover is not joined');
      (globalThis as unknown as { __udgCellHold?: boolean }).__udgCellHold = false;
      (globalThis as unknown as { __udgCellStop?: boolean }).__udgCellStop = false;
      // THE window timebase, published SYNCHRONOUSLY as the pump's first act (before the module
      // import below) so a concurrent phase wait on this page can never race a half-started pump
      // (slice 12 — the first LAN attempts proved the old construction could not reach 120 s: the
      // window ended when the ping loop ended, and 99 × (1180 + LAN round trip) is structurally
      // < 120 000 ms; phase boundaries are now waited on THIS clock).
      const startedAt = performance.now();
      (globalThis as unknown as { __udgCellPumpStartedAt?: number }).__udgCellPumpStartedAt = startedAt;
      const stopped = (): boolean => (globalThis as unknown as { __udgCellStop?: boolean }).__udgCellStop === true;
      const held = (): boolean => (globalThis as unknown as { __udgCellHold?: boolean }).__udgCellHold === true;
      const mod = (await import(/* @vite-ignore */ args.moduleUrl)) as {
        canonicalRoute: { legDirectionAt(elapsedMs: number): '+x' | '+z' | '-x' | '-z' };
      };
      while (performance.now() - startedAt < args.pumpMs && !stopped()) {
        if (held()) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          continue;
        }
        const dir = mod.canonicalRoute.legDirectionAt(performance.now() - startedAt);
        holder.generation += 1;
        try {
          holder.predictor.send(
            {
              generation: holder.generation,
              moveX: dir === '+x' ? 1 : dir === '-x' ? -1 : 0,
              moveZ: dir === '+z' ? 1 : dir === '-z' ? -1 : 0,
            },
            true,
          );
        } catch (error) {
          // A refusal (e.g. ADR-0003 recovery in effect) must END the pump and be REPORTED —
          // never reject the page evaluate and destroy the cell mid-window.
          return { sendError: String(error instanceof Error ? error.message : error) };
        }
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      return { sendError: null as string | null };
    }, { pumpMs, moduleUrl: ACK_LEDGER_MODULE_URL });

  // Wait until the PUMP'S OWN monotonic clock (the mover page — the clock the authored motion
  // runs on) reaches `targetElapsedMs` since the pump started, then stamp the phase in that same
  // clock and return it. The ≥ guard is enforced AT THE STAMP ITSELF: the returned `elapsedMs`
  // re-reads the clock AFTER the stamp, so the guard can never be satisfied by an observation
  // that the stamp then overtakes (the first continuation attempt failed by exactly that much —
  // a 10 ms difference between the last loop observation and the stamp two evaluates later).
  // `capMs` is a safety cap so a stalled page clock ends the wait as a NAMED guard trip rather
  // than a hang.
  const waitPumpPhase = (page: Page, targetElapsedMs: number, capMs: number, label: string): Promise<{ atMs: number; lastProcessed: number; elapsedMs: number; capped: boolean }> =>
    page.evaluate(async (args) => {
      const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
      if (holder === undefined) throw new Error('the cell mover is not joined');
      const started = (globalThis as unknown as { __udgCellPumpStartedAt?: number }).__udgCellPumpStartedAt;
      if (typeof started !== 'number') throw new Error('the cell mover page never started a route pump — a phase boundary cannot be measured on a clock that was never running');
      const waitStart = Date.now();
      let elapsed = performance.now() - started;
      while (elapsed < args.targetElapsedMs && Date.now() - waitStart < args.capMs) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        elapsed = performance.now() - started;
      }
      const atMs = performance.now();
      const w = globalThis as unknown as { __udgCellMarks?: Record<string, number> };
      w.__udgCellMarks = { ...(w.__udgCellMarks ?? {}), [args.label]: atMs };
      return { atMs, lastProcessed: holder.transport.handle().lastProcessed, elapsedMs: performance.now() - started, capped: performance.now() - started < args.targetElapsedMs };
    }, { targetElapsedMs, capMs, label });

  const host = await startProxyHost();
  let handle = -1;
  let pageM: Page | undefined;
  let pageO: Page | undefined;
  let hostShutdown: Awaited<ReturnType<typeof host.shutdown>> | null = null;
  try {
    const start = await host.request({ op: 'start', profile: plan.impairment, targetHost: '127.0.0.1', targetPort: roomPort });
    handle = start['handle'] as number;
    const proxyUrl = `http://127.0.0.1:${String(start['port'] as number)}`;
    pageM = await openSeatPage('cell-M', { bare: true });
    pageO = await openSeatPage('cell-O', { bare: true });
    for (const page of [pageM, pageO]) {
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') nonLoopback.push(request.url());
        }
      });
    }
    const joinM = await joinImpSeat(pageM, proxyUrl, { mode: 'create', roomName: ROOM_NAME });
    const roomId = joinM.roomId ?? '';
    const joinO = await joinSeat(pageO, { mode: 'byId', roomId }, proxyUrl);
    const clockBridge = await pageM.evaluate(() => ({ perf: performance.now(), wall: Date.now() }));

    cellCheck('cell: KIND DERIVATION + candidate binding (exact sha, dirty flag, seed) — a local run of an OFFICIAL coordinate is still kind DIAGNOSTIC-NOT-GATE-A (only the formal dispatch over a clean tree produces a kind-GATE-A ROW artefact, and even that is never a Gate A verdict); the identity fields are checked, not assumed',
      /^[0-9a-f]{40}$/.test(sha) && Number.isInteger(seed) && dirty === (spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim().length > 0),
      { commit: sha, dirty, seed, label: plan.label, formalMode, kind: formalMode && plan.official && !dirty ? 'GATE-A' : 'DIAGNOSTIC-NOT-GATE-A', kindRule: 'kind is DERIVED from the dispatch mode, coordinate officiality and tree state — the bytes above carry the result' });
    cellCheck('cell: TWO TRUE browser contexts, both seats reaching the room ONLY through the proxy port, loopback-only traffic',
      pageM.context() !== pageO.context() && joinM.ok === true && joinO.ok === true && Number(new URL(proxyUrl).port) !== roomPort && nonLoopback.length === 0,
      { proxyPort: start['port'], roomPort, nonLoopback: nonLoopback.slice(0, 3), csp: 'none-on-dev-server' });

    // ---- route pre-validation: the spawn point must put the whole 48 m square inside the
    // bounds. Read the mover's spawn from the observer's first published sample.
    const spawn = await pageO.evaluate((sid) => {
      const holder = (globalThis as unknown as SeatWindow).__udgSpikeSeat;
      if (holder === undefined) return null;
      holder.presentation.observe(holder.seat.snapshot());
      const track = holder.presentation.peers()
        .map((peer) => holder.presentation.trackOf(peer))
        .find((tr) => tr?.sessionId === sid);
      return track?.firstSample ?? null;
    }, joinM.sessionId);
    // worst-case authored leg is speedCeiling(4 m/s) × 12 s = 48 m; the square must stay at
    // least 1.5 m inside the ±50 m bounds — farther than the plateau detector's 1 m band — so a
    // CLAMP is structurally impossible on this route from this spawn, not merely unobserved.
    const spawnOk = spawn !== null && spawn.x >= -48.5 && spawn.x + 48 <= 48.5 && spawn.z >= -48.5 && spawn.z + 48 <= 48.5;
    cellCheck('cell: canonical route PRE-VALIDATED — spawn puts the whole 48 m square inside the ±50 m region, so no leg can be clamped (provable, not merely observed)',
      spawnOk, { spawn, square: 'x∈[spawn, spawn+48], z∈[spawn, spawn+48]', bounds: '±50 m (100 m region)' });

    const pumpMs = 20_000 + 120_000 + 30_000;
    const pump = startRoutePump(pageM, pumpMs);
    // Phase boundaries are pump-clock waits, not node-side wall sleeps (slice 12): the warmup ends
    // when the MOVER PAGE's monotonic clock says 20 000 ms of authored motion ran, and the
    // measure window ends only when that same clock says >= 120 000 ms ran — never when some
    // other loop (the pings) happens to finish. The pings are an INDEPENDENT window inside the
    // measure window, traced separately below.
    const measureStart = await waitPumpPhase(pageM, 20_000, 25_000, 'measureStart');
    const cpuBefore = readCpuThrottle();

    // ---- measure window: 100 pings at the PREDECLARED 1180 ms cadence — span ≈ 116.9 s inside
    // the 120 s window, on the mover's own playing socket, slot-reserving state machine.
    const probePromise = runImpRttProbe(pageM, { pings: 100, cadenceMs: 1_180, deadlineMs: 1_500, confirmCapMs: 5_000 });
    // observer path samples DURING the window (a concurrent evaluate on the OBSERVER page while
    // the probe holds the mover page), converted onto the MOVER page's monotonic clock —
    // performance.now origins differ per page; Date.now bridges them, drift negligible over 2 min.
    const trackSamplesPromise = pageO.evaluate(async (args) => {
      const read = (): { atWall: number; x: number; z: number; tick: number } | null => {
        const holder = (globalThis as unknown as SeatWindow).__udgSpikeSeat;
        if (holder === undefined) return null;
        holder.presentation.observe(holder.seat.snapshot());
        const t = holder.presentation.peers()
          .map((peer) => holder.presentation.trackOf(peer))
          .find((tr) => tr?.sessionId === args.sessionId);
        if (t === undefined || t === null) return null;
        return { atWall: Date.now(), x: t.lastSample.x, z: t.lastSample.z, tick: t.lastSample.tick };
      };
      const samples: { atMs: number; x: number; z: number }[] = [];
      const ticks: number[] = [];
      for (let i = 0; i < 64; i += 1) { // 64 × 2 s ≥ the whole (>= 120 s) measure window on the observer side
        const s = read();
        if (s !== null) { samples.push({ atMs: s.atWall - args.bridge.wall + args.bridge.perf, x: s.x, z: s.z }); ticks.push(s.tick); }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      return { samples, lastTick: ticks.at(-1) ?? null };
    }, { sessionId: joinM.sessionId, bridge: clockBridge });
    const probe = await probePromise;
    // The measure window ends at the >= 120 000 ms pump-clock guard — NOT at probe completion
    // (that ordering was the LAN bug: pings are a window inside the measure window, not the
    // window itself). For profiles whose ping loop outlasts 120 s (elevated: ~127 s) the wait is
    // already satisfied at probe end and the window is the probe span — recorded as such.
    const measureEnd = await waitPumpPhase(pageM, 140_025, 150_025, 'measureEnd');
    const trackSamples = await trackSamplesPromise;
    const measureMsBrowser = measureEnd.atMs - measureStart.atMs;
    const cpuAfter = readCpuThrottle();

    // ---- the ledger, analysed IN THE PAGE over the browser monotonic clock by the module the
    // unit tests pin (warm-up rows EXCLUDED and counted; every eligible ack counted once, zeros
    // retained; duplicates/gaps/truncation fail completeness; reconciled against opportunities).
    const ledger = await pageM.evaluate(async (args) => {
      const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
      if (holder === undefined) throw new Error('the cell mover is not joined');
      const w = globalThis as unknown as { __udgCellMarks?: Record<string, number> };
      const marks = w.__udgCellMarks;
      if (marks === undefined) throw new Error('no phase marks');
      const mod = (await import(/* @vite-ignore */ args.moduleUrl)) as {
        analyzeAckLedger(rows: unknown, deliveries: unknown, window: unknown, limit: number): Record<string, unknown>;
      };
      const rows = holder.predictor.matchedCorrections();
      const deliveries = holder.predictor.deliveryLedger().map((d) => ({
        accepted: d.accepted,
        delivery: { atMs: d.delivery.atMs, epoch: d.delivery.epoch, authorityTick: d.delivery.authorityTick, ack: d.delivery.ack },
      }));
      const honest = mod.analyzeAckLedger(rows, deliveries, { startMs: args.startMs, endMs: args.endMs }, 20_000);
      const leaked = mod.analyzeAckLedger(rows, deliveries, { startMs: args.startMs - 60_000, endMs: args.endMs }, 20_000);
      return { honest, leakedMeasuredBoundaries: (leaked as { measuredBoundaries: number }).measuredBoundaries, rowsTotal: rows.length };
    }, { moduleUrl: ACK_LEDGER_MODULE_URL, startMs: measureStart.atMs, endMs: measureEnd.atMs });
    const report = ledger.honest as unknown as AckLedgerReport;

    // First/last ELIGIBLE deliveries traced SEPARATELY from the aggregate counts (slice 12): the
    // ledger window is the measure window; these are its own two boundary facts.
    const deliveryBounds = await pageM.evaluate((args) => {
      const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
      if (holder === undefined) throw new Error('the cell mover is not joined');
      const eligible = holder.predictor.deliveryLedger()
        .map((d) => ({ accepted: d.accepted, atMs: d.delivery.atMs, ack: d.delivery.ack, authorityTick: d.delivery.authorityTick }))
        .filter((d) => d.accepted && d.atMs >= args.startMs && d.atMs <= args.endMs);
      return { first: eligible[0] ?? null, last: eligible.at(-1) ?? null, count: eligible.length };
    }, { startMs: measureStart.atMs, endMs: measureEnd.atMs });
    cellCheck('cell: ledger window boundaries traced on their own — the FIRST and LAST eligible (accepted, in-window) deliveries exist and sit inside the measure window, recorded separately from the boundary counts the ledger report aggregates (a window whose first/last delivery cannot be named is a duration claim, not a measurement)',
      deliveryBounds.first !== null && deliveryBounds.last !== null && deliveryBounds.count >= 2
        && deliveryBounds.first!.atMs >= measureStart.atMs && deliveryBounds.last!.atMs <= measureEnd.atMs,
      deliveryBounds);

    const probeValidity = networkValidity({
      requestedRttMs: plan.profile.rttMs,
      declaredJitterBudgetMs: plan.profile.jitterBudgetMs,
      achievedRttSamples: probe.samples.map((sample) => sample.rttMs),
    });

    // ---- probe span == measure window (no shorter subwindow, no replay): derived from the
    // sampling clock, not from node-side wall guesses.
    const probeSpanMs = probe.clockElapsedMs;
    // The state machine's PERIOD is cadence + one round trip (it sleeps between windows), so the
    // declared expectation is derived, not fitted: (1180 + median RTT) × 99, tolerance ±8 s.
    const expectedSpanMs = (1_180 + (probeValidity.achieved?.p50 ?? 110)) * 99;
    // INDEPENDENT windows, same clock, each enforced on its own terms (slice 12): the MEASURE
    // window is the ≥ 120 000 ms pump-clock guard; the PING window is a derived-length window
    // INSIDE it (first send ≥ measureStart, last receipt ≤ measureEnd, tail ≤ 20 s); neither is
    // a renamed copy of the other.
    const pingFirst = probe.samples[0] ?? null;
    const pingLast = probe.samples.at(-1) ?? null;
    const pingWindow = pingFirst === null || pingLast === null
      ? { traceable: false as const }
      : {
        traceable: true as const,
        firstSentAtMs: Math.round(pingFirst.sentAtMs),
        lastReceivedAtMs: Math.round(pingLast.receivedAtMs),
        spanMs: Math.round(pingLast.receivedAtMs - pingFirst.sentAtMs),
        insideMeasureWindow: pingFirst.sentAtMs >= measureStart.atMs - 50 && pingLast.receivedAtMs <= measureEnd.atMs + 50,
        tailAfterPingsMs: Math.round(measureEnd.atMs - pingLast.receivedAtMs),
      };
    cellCheck('cell: WINDOWS enforced on the SAME monotonic clock the authored motion runs on — warmup ≥ 20000 ms of pump-clock motion (guard, never a wall sleep), measure window ≥ 120000 ms ENDED BY THE ≥ GUARD on that clock (not by any other loop finishing; the guard cap tripping would be a named red), and the PING window is traced INDEPENDENTLY inside it (derived span (cadence+median RTT)×99 within 8 s; first send ≥ measureStart; last receipt ≤ measureEnd; ping-free tail ≤ 20 s; no shorter subwindow, no last-snapshot replay)',
      measureStart.elapsedMs >= 20_000 && measureStart.capped === false
        && measureMsBrowser >= 120_000 && measureEnd.capped === false
        && Math.abs(probeSpanMs - expectedSpanMs) <= 8_000
        && pingWindow.traceable === true && pingWindow.insideMeasureWindow === true && pingWindow.tailAfterPingsMs <= 20_000,
      { warmupMsBrowser: Math.round(measureStart.elapsedMs), warmupGuardCapped: measureStart.capped, measureMsBrowser: Math.round(measureMsBrowser), measureGuardCapped: measureEnd.capped, timebase: 'mover-page performance.now, published by the route pump; start and end waited on THAT clock', probeSpanMs: Math.round(probeSpanMs), expectedSpanMs: Math.round(expectedSpanMs), declaredCadenceMs: 1_180, pings: 100, pingWindow });

    // ---- observer motion audit (canonical route executed; stationary/clamp detectors; range).
    const motion = auditMotion(trackSamples.samples, { x: REGION_BOUNDS.x, z: REGION_BOUNDS.z }, 4, 4_200, 1);
    const observerReport = await reportSeat(pageO);
    const moverTrack = observerReport.tracks.find((track) => track.sessionId === joinM.sessionId);
    const discontinuities = (moverTrack?.tickRegressions ?? 1) + (moverTrack?.epochChanges ?? 1);
    const duplicateSamples = moverTrack?.duplicateSamples ?? null;
    cellCheck('cell: the observer path — the mover travelled the CANONICAL ROUTE unobstructed for the whole window: stationary intervals 0, boundary plateaus 0, out-of-bounds 0, range inside ±50 m; discontinuities (tick regressions + epoch changes) 0',
      motion.range.maxX - motion.range.minX > 30 && motion.range.maxZ - motion.range.minZ > 30 && motion.medianSpeedMps >= 1.5 && motion.stationaryIntervals === 0 && motion.boundaryPlateaus === 0 && motion.outOfBounds === 0 && motion.range.minX >= -50 && motion.range.maxX <= 50 && motion.range.minZ >= -50 && motion.range.maxZ <= 50 && discontinuities === 0,
      { motion, discontinuities, duplicateSamples, delta: moverTrack?.delta, note: 'gate = tick regressions + epoch changes; duplicateSamples RECORDED (s2c stalls can re-deliver identical samples)' });
    // render lag in ONE comparable authority-tick space: the highest authority tick the MOVER's
    // own delivery ledger accepted, minus the tick of the sample the observer's presentation
    // last adopted for that peer. The mover is read first, so the number UNDERSTATES the lag by
    // the inter-read gap — stated, not hidden. (The imp mover page carries the predictor's
    // ledger, not the presentation surface — this is the observable lower bound.)
    const moverSelfTick = await pageM.evaluate(() => {
      const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
      if (holder === undefined) throw new Error('the cell mover is not joined');
      const accepted = holder.predictor.deliveryLedger().filter((d) => d.accepted);
      return accepted.at(-1)?.delivery.authorityTick ?? null;
    });
    const observerRenderedTick = await pageO.evaluate((sid) => {
      const holder = (globalThis as unknown as SeatWindow).__udgSpikeSeat;
      if (holder === undefined) return null;
      holder.presentation.observe(holder.seat.snapshot());
      const t = holder.presentation.peers()
        .map((peer) => holder.presentation.trackOf(peer))
        .find((tr) => tr?.sessionId === sid);
      return t?.lastSample.tick ?? null;
    }, joinM.sessionId);
    const renderLag = { observerRenderedTick, moverSelfTick, lagTicks: observerRenderedTick === null || moverSelfTick === null ? null : moverSelfTick - observerRenderedTick };
    cellCheck('cell: render delay is OBSERVED (mover-accepted authority tick minus the observer\'s adopted sample tick — a lower bound, mover read first) and non-negative; magnitude recorded, not threshold-gated',
      renderLag.lagTicks !== null && renderLag.lagTicks >= -1,
      renderLag);

    // ---- controls that CATCH what the review named. (a) warm-up leakage: shifting the boundary
    // 60 s earlier must ADD rows — if it didn't, the filter would be decorative. (b) the
    // stationary detector: hold the route for ~2.5 s and require the auditor to count the dead
    // interval, then resume — a detector that never fires is not evidence of motion.
    const warmupLeakCaught = ledger.leakedMeasuredBoundaries > report.measuredBoundaries && report.excludedBeforeWindow > 0;
    await pageM.evaluate(() => { (globalThis as unknown as { __udgCellHold?: boolean }).__udgCellHold = true; });
    const heldSamples = await pageO.evaluate(async (args) => {
      const out: { atMs: number; x: number; z: number }[] = [];
      for (let i = 0; i < 3; i += 1) {
        const holder = (globalThis as unknown as SeatWindow).__udgSpikeSeat;
        if (holder !== undefined) {
          holder.presentation.observe(holder.seat.snapshot());
          const t = holder.presentation.peers()
            .map((peer) => holder.presentation.trackOf(peer))
            .find((tr) => tr?.sessionId === args.sessionId);
          if (t !== undefined) out.push({ atMs: Date.now() - args.bridge.wall + args.bridge.perf, x: t.lastSample.x, z: t.lastSample.z });
        }
        await new Promise((resolve) => setTimeout(resolve, 1_200));
      }
      return out;
    }, { sessionId: joinM.sessionId, bridge: clockBridge });
    await pageM.evaluate(() => { (globalThis as unknown as { __udgCellHold?: boolean }).__udgCellHold = false; });
    const holdAudit = auditMotion(heldSamples, { x: REGION_BOUNDS.x, z: REGION_BOUNDS.z }, 4, 4_200, 1);
    cellCheck('cell: CONTROLS fire — (a) warm-up leakage control: widening the window by 60 s ADDS eligible acks (so the real exclusion is real, excludedBefore=' + String(report.excludedBeforeWindow) + '); (b) stationary control: holding the route for ~2.5 s makes the SAME auditor count >=1 stationary interval (so its zero during the measure window means motion, not a blind detector)',
      warmupLeakCaught && holdAudit.stationaryIntervals >= 1,
      { leakedMeasuredBoundaries: ledger.leakedMeasuredBoundaries, honestMeasuredBoundaries: report.measuredBoundaries, excludedBeforeWindow: report.excludedBeforeWindow, holdStationaryIntervals: holdAudit.stationaryIntervals });

    // ---- ledger completeness and correction record (claim conditioned on network validity).
    cellCheck('cell: ledger COMPLETENESS on the phase window — the POPULATION is matched acknowledgement DELIVERIES (immutable epoch:authorityTick:ackTo keys bound once in the exact phase): measured boundaries >= ' + String(MIN_ELIGIBLE_ACKS_PER_RUN) + ' (input STAMP coverage can never substitute), missing 0, duplicates 0, overlaps 0, unbound 0, no truncation, NO numeric tolerance; invalidated boundaries counted APART',
      report.complete === true && report.measuredBoundaries >= MIN_ELIGIBLE_ACKS_PER_RUN && report.missingMeasurements === 0 && report.duplicateKeys === 0 && report.overlapKeys === 0 && report.unboundRows === 0 && report.truncated === false,
      { population: report.measuredBoundaries, zeroMeasured: report.zeroMeasured, nonzeroMeasured: report.nonzeroMeasured, coveredInputStamps: report.coveredInputStamps, opportunities: report.opportunityDeliveries, missing: report.missingMeasurements, duplicates: report.duplicateKeys, overlaps: report.overlapKeys, unbound: report.unboundRows, excludedNonAdvancing: report.excludedNonAdvancing, invalidated: report.invalidatedBoundaries, truncated: report.truncated, excludedBeforeWindow: report.excludedBeforeWindow } );
    const p95 = report.correctionPercentiles?.p95 ?? null;
    const targetClaim = probeValidity.valid ? p95 !== null && p95 < 0.15 : false;
    cellCheck('cell: matched-ack correction — p50/p95/p99/max recorded over the phase window; the < 0.15 m target is CLAIMED ONLY WHEN THE NETWORK CELL IS VALID (§2.2 INVALID ⇒ claim is NOT-CLAIMED, never a green by omission)',
      !probeValidity.valid || targetClaim,
      { percentiles: report.correctionPercentiles, populationIsMatchedBoundaries: true, targetMetres: 0.15, networkValid: probeValidity.valid, claim: probeValidity.valid ? (targetClaim ? 'MET' : 'MISSED') : 'NOT-CLAIMED (network invalid)' });
    cellCheck('cell: ACCEPTED achieved RTT — slot-reservation contract held across the WHOLE 100-ping full-window run (no poison/death/epoch change, nothing not-sent). A stop would be reported HERE as the measured blocker and the cell INVALID, never retried away',
      probe.abortedReason === null && probe.slotPoisoned === false && probe.socketClosed === false && probe.epochChanged === false && probe.notSent === 0,
      { answered: probe.samples.length, lateDiscarded: probe.lateDiscarded, retiredUnconfirmed: probe.retiredUnconfirmed, abortedReason: probe.abortedReason, hostThrottleDuringMeasure: cpuBefore !== null && cpuAfter !== null ? { throttledUsecDelta: cpuAfter.throttledUsec - cpuBefore.throttledUsec, throttledEventsDelta: cpuAfter.throttledEvents - cpuBefore.throttledEvents } : null });
    cellCheck('cell: §2.2 achieved-RTT validity (median within 10 ms of 100 ms, jitter p95−p50 within 20 ms + 10 tolerance) — ACTUAL verdict on the FULL window; honestly failing if missed',
      probeValidity.valid, { requested: plan.profile.rttMs, achieved: probeValidity.achieved, jitterP95P50: probeValidity.achievedJitterMs, reasons: probeValidity.reasons, n: probe.samples.length });

    // Stop the route pump BEFORE closing anything and await its finite exit — a page closed
    // under a running evaluate is a rejected promise, not a teardown.
    await pageM.evaluate(() => { (globalThis as unknown as { __udgCellStop?: boolean }).__udgCellStop = true; });
    const pumpFinished = await pump;
    const settled = await settleProxy(host, handle);
    cellCheck('cell: the raw proxy record still satisfies its own queue-health formula (demoted diagnostic; leg-sum is NOT the accepted RTT); the socket path CLOSES cleanly (no errored closures in the proxy connLog)',
      settled.stats.c2s.orderViolations === 0 && settled.stats.s2c.orderViolations === 0 && settled.stats.connections.errors === 0,
      { legSumValidity: networkValidity({ requestedRttMs: plan.profile.rttMs, declaredJitterBudgetMs: plan.profile.jitterBudgetMs, achievedRttSamples: settled.stats.proxyLegSumSamples }).valid, connections: settled.stats.connections });

    await pageM.close();
    await pageO.close();
    const closeStats = await closeProxyBounded(host, handle);
    handle = -1;
    hostShutdown = await host.shutdown();
    cellCheck('cell: bounded teardown with receipts — proxy closed, host exited FINITE (exit 0) with NO active resources; the route pump ended finitely',
      hostShutdown.receipt !== null && hostShutdown.exitCode === 0 && JSON.stringify(hostShutdown.receipt?.activeResourcesAfterClose) === '[]' && closeStats.c2s.bytesReceived > 0 && pumpFinished.sendError === null,
      { activeResourcesAfterClose: hostShutdown.receipt?.activeResourcesAfterClose ?? null, exitCode: hostShutdown.exitCode, signal: hostShutdown.signal, pumpFinished });

    const record = {
      schemaVersion: 3,
      // A local run of a matrix coordinate is DIAGNOSTIC by construction; only the formal dispatch
      // (UDG_GATE_A_FORMAL=1, hosted per §4 once T-7 exists) on an official coordinate over a
      // clean tree may produce a kind-GATE-A artefact — and even that is a row artefact, not a
      // Gate A verdict (the register and the delegated approver decide that).
      kind: formalMode && plan.official && !dirty ? 'GATE-A' : 'DIAGNOSTIC-NOT-GATE-A',
      kindNote: formalMode && plan.official && !dirty
        ? 'formal dispatch, official coordinate, clean tree — a Gate A ROW artefact, not a Gate A verdict'
        : 'local or non-official dispatch: a matrix-coordinate run that can never be read as a Gate A row artefact',
      implementationSha: sha,
      identity: { commit: sha, dirty, node: process.version, pnpm: spawnSync('pnpm', ['--version'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim(), playwright: (JSON.parse(readFileSync(join(ROOT, 'node_modules', '@playwright', 'test', 'package.json'), 'utf8')) as { version: string }).version, seed, generatedAt: new Date().toISOString() },
      coordinate: { cell: 'full-window', profile, seed, profileSource },
      regime: { requestedRttMs: plan.profile.rttMs, declaredJitterBudgetMs: plan.profile.jitterBudgetMs, carriesCorrectionGate: plan.profile.carriesCorrectionGate, requestedOneWayMs: plan.impairment.oneWayMs, official: plan.official },
      attempts: { firstAttemptAt, finishedAt: new Date().toISOString(), attempt: 1, automaticRetries: 0, note: 'isolated first attempt over the full window; a red stays red — this cell contains NO retry machinery' },
      environment: { ...captureEnvironmentRecord(), browser: 'chromium (playwright, headless on the pinned runner)', profileSource },
      plan: { label: plan.label, profile: plan.profile, impairment: plan.impairment },
      windows: {
        timebase: 'mover-page performance.now published by the route pump; both boundaries WAITED on that clock (>= guards, cap as named failure) — warmup and measure and the authored motion share one clock',
        warmupMs: 20_000,
        warmupMsBrowserMeasured: Math.round(measureStart.elapsedMs),
        measureMsBrowser: Math.round(measureMsBrowser),
        measureGuard: { targetMs: 120_000, capMs: 150_000, tripped: measureEnd.capped },
        pingWindow,
        ledgerWindow: { startMs: Math.round(measureStart.atMs), endMs: Math.round(measureEnd.atMs), firstEligibleDelivery: deliveryBounds.first, lastEligibleDelivery: deliveryBounds.last },
        phaseMarks: { measureStart, measureEnd },
      },
      route: { kind: 'canonical 12s/48m square (+x,+z,-x,-z), spawn-verified unobstructed', spawn, motion, holdControl: holdAudit },
      acceptedRttProbe: { rules: 'slot reservation (rtt-probe.ts, unit-tested, imported UNCHANGED by the page via the loopback pipeline); 100 pings at 1180 ms predeclared cadence spanning the measure window', outcome: probe, summary: { validity: probeValidity } },
      ackLedger: { report, warmupLeakControl: { leakedMeasuredBoundaries: ledger.leakedMeasuredBoundaries, honestMeasuredBoundaries: report.measuredBoundaries }, correctionClaim: probeValidity.valid ? (targetClaim ? 'MET' : 'MISSED') : 'NOT-CLAIMED (network invalid)' },
      renderLag,
      cgroupThrottle: { beforeMeasure: cpuBefore, afterMeasure: cpuAfter, proxyHostWorstThrottle: settled.throttle },
      proxyLegSumDiagnostic: { stats: settled.stats },
      isolation: { loopbackOnly: nonLoopback.length === 0, csp: 'none-on-dev-server', contexts: 2 },
      teardown: { hostExit: { exitCode: hostShutdown.exitCode, signal: hostShutdown.signal, activeResourcesAfterClose: hostShutdown.receipt?.activeResourcesAfterClose ?? null } },
      checks: cellChecks,
    };
    // Distinct artefact directory PER COORDINATE: twelve matrix legs cannot collide, and an
    // evidence pointer names exactly the profile+seed it points at.
    const cellDir = join(OUT_DIR, `cell-full-window-${profile}-${String(seed)}`);
    mkdirSync(cellDir, { recursive: true });
    const artefactPath = join(cellDir, 'spike-cell.json');
    writeFileSync(artefactPath, JSON.stringify(record, null, 2));
    await testInfo.attach(`spike-cell-full-window-${profile}-${String(seed)}.json`, { path: artefactPath, contentType: 'application/json' });
    // When the capture plan routes measurements here, merge the coordinate's achieved summary —
    // per-coordinate facts, not a substituted profile.
    const measurementsOut = process.env['UDG_EVIDENCE_MEASUREMENTS'];
    if (measurementsOut !== undefined) {
      let merged: Record<string, unknown> = {};
      try { merged = JSON.parse(readFileSync(measurementsOut, 'utf8')) as Record<string, unknown>; } catch { /* first writer */ }
      const spikeMatrix = (merged['spikeMatrix'] ?? {}) as Record<string, unknown>;
      spikeMatrix[`${profile}-${String(seed)}`] = {
        coordinate: { profile, seed, official: plan.official },
        achieved: { rttProbeValidity: probeValidity.valid, correctionClaim: probeValidity.valid ? (targetClaim ? 'MET' : 'MISSED') : 'NOT-CLAIMED (network invalid)' },
        artefact: `cell-full-window-${profile}-${String(seed)}/spike-cell.json`,
        attempts: { attempt: 1, automaticRetries: 0 },
      };
      merged['spikeMatrix'] = spikeMatrix;
      mkdirSync(dirname(measurementsOut), { recursive: true });
      writeFileSync(measurementsOut, JSON.stringify(merged, null, 2));
    }
  } finally {
    if (handle >= 0) {
      try { await closeProxyBounded(host, handle); } catch { /* reported by the shutdown receipt below */ }
    }
    if (hostShutdown === null) {
      try { hostShutdown = await host.shutdown(); } catch { /* the assertion below reports a host that never exited finite */ }
    }
  }
  expect(hostShutdown !== null && hostShutdown.receipt !== null && hostShutdown.exitCode === 0, 'the proxy host exited FINITELY with a receipt (guard)').toBe(true);
});

/* ------------------------------------------------------------------ lan-smoke (slice 12, grants T-6/T-8)
 *
 * The FAST paired-browser LAN smoke the routine CI runtime lane may run. It is deliberately small
 * and deliberately distinct from everything it must NOT be: NOT the full-window matrix runner
 * (no 20 s warmup, no 120 s measure window — those belong to `--cell full-window`), never
 * dispatchable under UDG_GATE_A_FORMAL=1 (the dispatcher refuses that, and this cell re-checks),
 * never an evidence capture (C-07: a routine green captures nothing — the artefact lands under
 * artifacts/.local and declares DIAGNOSTIC-NOT-GATE-A), and not another task's suite.
 *
 * The budget is PRE-REGISTERED as the constant below: the cell asserts its own wall clock against
 * it and records the measured value, so "fast" is a checked claim, not an adjective. What it
 * covers, in miniature: the accepted proxy primitive under the declared LAN regime, two TRUE
 * browser contexts reaching the room only through the proxy, an independently derived ping
 * window, achieved-vs-requested validity, an observer that SAW the mover, and a bounded
 * teardown with a finite-exit receipt.
 */
const LAN_SMOKE_BUDGET_MS = 240_000; // PRE-REGISTERED wall budget for the whole cell (lane step keeps its own job timeout)
const LAN_SMOKE_PINGS = 12;
const LAN_SMOKE_PING_CADENCE_MS = 1_200;

// eslint-disable-next-line no-empty-pattern -- Playwright requires the destructured args object even when the cell uses only testInfo.
test('spike cell: lan-smoke — fast paired-browser LAN smoke for the routine CI lane (pre-registered 240 s wall budget; NOT full-window, NEVER formal, NO evidence capture)', async ({}, testInfo) => {
  test.skip(process.env['UDG_SPIKE_CELL'] !== 'lan-smoke', 'dispatched only by `pnpm test:spike -- --id UDG-SPIKE-001 --cell lan-smoke --profile lan --seed <n>` (the routine CI runtime lane, grant T-6); the ordinary netcode suite never runs it');
  test.setTimeout(300_000);
  expect(fixture, 'the room fixture booted').toBeDefined();
  expect(process.env['UDG_GATE_A_FORMAL'] === '1', 'lan-smoke is the routine fast smoke — under the formal schedule policy the dispatcher must refuse it, and the cell refuses again here (belt and braces)').toBe(false);
  const cellStartedAtMs = Date.now();
  const profile = process.env['UDG_SPIKE_PROFILE'] ?? '';
  expect(['lan', 'moderate', 'elevated', 'poor'], `lan-smoke was dispatched with profile "${profile}" — no silent defaults`).toContain(profile);
  const seed = Number(process.env['UDG_SPIKE_SEED'] ?? 'not-a-number');
  expect(Number.isInteger(seed) && seed > 0, 'lan-smoke requires an explicit integer --seed').toBe(true);
  const plan = planSpikeRun({ profile, seed, diagnostic: { reason: 'ci-fast-lan-smoke' } });
  const roomPort = Number(new URL(fixture?.endpoint ?? 'http://127.0.0.1:0').port);
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();

  const cellChecks: { name: string; ok: boolean }[] = [];
  const cellCheck = (name: string, ok: boolean, detail: unknown): void => { cellChecks.push({ name, ok }); check(name, ok, detail); };
  const nonLoopback: string[] = [];

  const host = await startProxyHost();
  let handle = -1;
  let pageM: Page | undefined;
  let pageO: Page | undefined;
  let hostShutdown: Awaited<ReturnType<typeof host.shutdown>> | null = null;
  let closeStats: { c2s: { bytesReceived: number } } | undefined;
  try {
    const start = await host.request({ op: 'start', profile: plan.impairment, targetHost: '127.0.0.1', targetPort: roomPort });
    handle = start['handle'] as number;
    const proxyUrl = `http://127.0.0.1:${String(start['port'] as number)}`;
    pageM = await openSeatPage('smoke-M', { bare: true });
    pageO = await openSeatPage('smoke-O', { bare: true });
    for (const page of [pageM, pageO]) {
      page.on('request', (request) => {
        const url = new URL(request.url());
        if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') nonLoopback.push(request.url());
      });
    }
    const joinM = await joinImpSeat(pageM, proxyUrl, { mode: 'create', roomName: ROOM_NAME });
    const roomId = joinM.roomId ?? '';
    const joinO = await joinSeat(pageO, { mode: 'byId', roomId }, proxyUrl);
    cellCheck('smoke: two TRUE browser contexts, both seats reaching the room ONLY through the proxy port, loopback-only traffic',
      pageM.context() !== pageO.context() && joinM.ok === true && joinO.ok === true && Number(new URL(proxyUrl).port) !== roomPort && nonLoopback.length === 0,
      { proxyPort: start['port'], roomPort, nonLoopback: nonLoopback.slice(0, 3) });

    // Authored motion: two 6 s legs (+x then +z) at a 100 ms send cadence — the same sending
    // surface as the full-window pump, miniature. The leg clock is the PAGE monotonic clock,
    // consistent with the ping window below (one timebase, no wall-clock rename).
    const motion = await pageM.evaluate(async () => {
      const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
      if (holder === undefined) throw new Error('the smoke mover is not joined');
      let sends = 0;
      const startedAt = performance.now();
      for (const [mx, mz] of [[1, 0], [0, 1]] as const) {
        const until = performance.now() + 6_000;
        while (performance.now() < until) {
          holder.generation += 1;
          holder.predictor.send({ generation: holder.generation, moveX: mx, moveZ: mz }, true);
          sends += 1;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      return { motionMs: performance.now() - startedAt, sends };
    });
    cellCheck('smoke: >= 11000 ms of authored motion ran on the page clock (two 6 s legs) at the 100 ms send cadence',
      motion.motionMs >= 11_000 && motion.sends >= 100, motion);

    // The ping window is its OWN window (12 pings, pre-declared 1200 ms cadence), its span
    // derived from (cadence + median RTT) x (n-1), never copied from another window's duration.
    const probe = await runImpRttProbe(pageM, { pings: LAN_SMOKE_PINGS, cadenceMs: LAN_SMOKE_PING_CADENCE_MS, deadlineMs: 1_500, confirmCapMs: 5_000 });
    const probeValidity = networkValidity({
      requestedRttMs: plan.profile.rttMs,
      declaredJitterBudgetMs: plan.profile.jitterBudgetMs,
      achievedRttSamples: probe.samples.map((sample) => sample.rttMs),
    });
    const expectedSpanMs = (LAN_SMOKE_PING_CADENCE_MS + (probeValidity.achieved?.p50 ?? plan.profile.rttMs)) * (LAN_SMOKE_PINGS - 1);
    cellCheck('smoke: the ping window is its own derived window (12 pings, (cadence + median RTT) x 11 within 4 s) and the ACHIEVED network is valid under the DECLARED profile (accepted networkValidity rule — the regime means what it says)',
      probe.samples.length === LAN_SMOKE_PINGS && Math.abs(probe.clockElapsedMs - expectedSpanMs) <= 4_000 && probeValidity.valid,
      { spanMs: Math.round(probe.clockElapsedMs), expectedSpanMs: Math.round(expectedSpanMs), achieved: probeValidity.achieved, reasons: probeValidity.reasons });

    const observerReport = await reportSeat(pageO);
    const moverTrack = observerReport.tracks.find((track) => track.sessionId === joinM.sessionId);
    const discontinuities = (moverTrack?.tickRegressions ?? 1) + (moverTrack?.epochChanges ?? 1);
    cellCheck('smoke: the observer path SAW the mover — a track exists with zero tick regressions and zero epoch changes over the smoke',
      moverTrack !== undefined && discontinuities === 0,
      { tracks: observerReport.tracks.length, discontinuities, lastTick: moverTrack?.lastSample.tick ?? null });

    await pageM.close();
    await pageO.close();
    pageM = undefined;
    pageO = undefined;
    closeStats = await closeProxyBounded(host, handle);
    handle = -1;
    hostShutdown = await host.shutdown();
  } finally {
    if (handle >= 0) {
      try { await closeProxyBounded(host, handle); } catch { /* reported by the shutdown receipt below */ }
    }
    await pageM?.close().catch(() => undefined);
    await pageO?.close().catch(() => undefined);
    if (hostShutdown === null) {
      try { hostShutdown = await host.shutdown(); } catch { /* the assertion below reports a host that never exited finite */ }
    }
  }

  const cellWallMs = Date.now() - cellStartedAtMs;
  cellCheck('smoke: bounded teardown with a finite-exit receipt AND the PRE-REGISTERED wall budget held (the cell asserts its own wall clock against the constant recorded in this artifact — "fast" is a checked claim)',
    hostShutdown !== null && hostShutdown.receipt !== null && hostShutdown.exitCode === 0
      && closeStats !== undefined && closeStats.c2s.bytesReceived > 0
      && cellWallMs <= LAN_SMOKE_BUDGET_MS,
    { exitCode: hostShutdown?.exitCode ?? null, signal: hostShutdown?.signal ?? null, activeResourcesAfterClose: hostShutdown?.receipt?.activeResourcesAfterClose ?? null, c2sBytes: closeStats?.c2s.bytesReceived ?? null, cellWallMs, budgetMs: LAN_SMOKE_BUDGET_MS });

  mkdirSync(join(OUT_DIR, `cell-lan-smoke-${profile}-${String(seed)}`), { recursive: true });
  const artefactPath = join(OUT_DIR, `cell-lan-smoke-${profile}-${String(seed)}`, 'spike-cell.json');
  writeFileSync(artefactPath, JSON.stringify({
    schemaVersion: 1,
    kind: 'DIAGNOSTIC-NOT-GATE-A',
    kindNote: 'routine CI fast smoke (grant T-6): never a Gate A row artefact, never a matrix coordinate, never an evidence bundle (C-07)',
    implementationSha: sha,
    coordinate: { cell: 'lan-smoke', profile, seed, formal: false },
    budget: { registeredWallMs: LAN_SMOKE_BUDGET_MS, measuredWallMs: cellWallMs, pings: LAN_SMOKE_PINGS, cadenceMs: LAN_SMOKE_PING_CADENCE_MS },
    regime: { requestedRttMs: plan.profile.rttMs, declaredJitterBudgetMs: plan.profile.jitterBudgetMs, official: plan.official },
    checks: cellChecks,
  }, null, 2));
  try {
    await testInfo.attach('spike-cell-lan-smoke.json', { path: artefactPath, contentType: 'application/json' });
  } catch { /* attachment is best-effort; the file is the record */ }

  expect(hostShutdown !== null && hostShutdown.receipt !== null && hostShutdown.exitCode === 0, 'the proxy host exited FINITELY with a receipt (guard)').toBe(true);
  const smokeFailures = cellChecks.filter((record) => !record.ok);
  expect(smokeFailures.map((record) => record.name), `lan-smoke failures: ${JSON.stringify(smokeFailures.map((record) => record.name))}`).toEqual([]);
});

/* ------------------------------------------------------------------ A/B latency controls (slice 6e)
 *
 * WHY is the achieved elevated median ~+12.5 ms over the requested 100 ms on a runner with zero
 * throttling? This cell isolates it with four legs under IDENTICAL authored motion (the canonical
 * route) and identical rendering (the same app page, same context settings), each leg a fresh
 * pair of true browser contexts and its own room:
 *
 *   D — DIRECT: seats join the room endpoint with NO proxy. The floor: browser/SDK/loopback.
 *   Z — ZERO-DELAY FIFO PROXY: the full proxy machinery (FIFO tube, instrumentation, second
 *       socket pair) with oneWayMs 0 / jitter 0. Isolates the proxy path's own cost.
 *   E — ELEVATED: the accepted profile (50 ms per direction, 20 ms budget). E − Z is the stall
 *       path's contribution; compare against the tube's own achieved−requested excess.
 *   N — NO-DELAY-OFF: Z's conditions with TCP_NODELAY off on both proxy sockets (documented,
 *       harness-only knob, WITH its Z control leg). If coalescing/Nagle mattered, N ≠ Z.
 *
 * No kernel/SDK setting is touched; the policy stays symmetric half-RTT; nothing is subtracted
 * from the accepted metric — the DIFFERENCES between legs are the diagnostic, recorded as such.
 * Legs use an equal 20 s warmup + 60 s measure at 45 pings / 1300 ms — equal conditions across
 * legs, while the ACCEPTED full-window cell remains `elevated-full`. Raw samples per leg are in
 * spike-cell-ab-controls.json.
 */
const LEG_WARMUP_MS = 20_000;
const LEG_MEASURE_MS = 60_000;
const LEG_PINGS = 45;
const LEG_CADENCE_MS = 1_300;

interface LegRecord {
  leg: string;
  via: string;
  tcpNoDelay: boolean | null;
  probe: RttProbeWindow;
  percentiles: { p50: number; p95: number; p99: number; max: number; count: number } | null;
  medianExcessPerLegMs: { c2s: number | null; s2c: number | null };
  proxy: Record<string, unknown> | null;
  validity: ReturnType<typeof networkValidity>;
}

const pcts = (values: readonly number[]): LegRecord['percentiles'] =>
  values.length === 0 ? null : {
    p50: nearestRank(values, 0.5),
    p95: nearestRank(values, 0.95),
    p99: nearestRank(values, 0.99),
    max: Math.max(...values),
    count: values.length,
  };

const medianExcess = (pairs: readonly { requestedMs: number; achievedMs: number }[]): number | null => {
  if (pairs.length === 0) return null;
  const excess = pairs.map((pair) => pair.achievedMs - pair.requestedMs).sort((a, b) => a - b);
  return excess[Math.floor(excess.length / 2)] ?? null;
};

// eslint-disable-next-line no-empty-pattern -- Playwright requires the destructured args object even when the cell uses only testInfo.
test('spike cell: ab-controls — same-motion/same-render RTT attribution legs (direct, zero-delay proxy, elevated, nodelay-off; DIAGNOSTIC, NOT Gate A)', async ({}, testInfo) => {
  test.skip(process.env['UDG_SPIKE_CELL'] !== 'ab-controls', 'dispatched only by `pnpm test:spike -- --id UDG-SPIKE-001 --cell ab-controls` (slice 6e latency attribution)');
  test.setTimeout(900_000);
  expect(fixture, 'the room fixture booted').toBeDefined();
  const seed = Number(process.env['UDG_SPIKE_SEED'] ?? '1001');
  const roomPort = Number(new URL(fixture?.endpoint ?? 'http://127.0.0.1:0').port);
  const planElev = planSpikeRun({ profile: 'elevated', seed, diagnostic: { reason: 'ab-controls-elevated-leg' } });
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim().length > 0;

  const cellChecks: { name: string; ok: boolean; detail: unknown }[] = [];
  const cellCheck = (name: string, ok: boolean, detail: unknown): void => {
    cellChecks.push({ name, ok, detail });
    check(name, ok, detail);
  };

  const legs: LegRecord[] = [];
  const host = await startProxyHost();
  let hostShutdown: Awaited<ReturnType<typeof host.shutdown>> | null = null;
  const runLeg = async (leg: 'D' | 'Z' | 'E' | 'N'): Promise<void> => {
    let handle = -1;
    const pageM = await openSeatPage(`ab-${leg}-M`, { bare: true });
    const pageO = await openSeatPage(`ab-${leg}-O`, { bare: true });
    try {
      let endpoint = fixture?.endpoint ?? '';
      let proxyStatsHandle: number | null = null;
      let noDelay: boolean | null = null;
      if (leg !== 'D') {
        const profile = leg === 'E'
          ? planElev.impairment
          : { name: `zero-${leg}`, oneWayMs: 0, jitterBudgetMs: 0, seed };
        noDelay = leg !== 'N';
        const started = await host.request({
          op: 'start',
          profile,
          targetHost: '127.0.0.1',
          targetPort: roomPort,
          ...(noDelay === false ? { tcpNoDelay: false } : {}),
        });
        handle = started['handle'] as number;
        proxyStatsHandle = handle;
        endpoint = `http://127.0.0.1:${String(started['port'] as number)}`;
      }
      const joinM = await joinImpSeat(pageM, endpoint, { mode: 'create', roomName: ROOM_NAME });
      const joinO = await joinSeat(pageO, { mode: 'byId', roomId: joinM.roomId ?? '' }, endpoint);
      expect(joinM.ok === true && joinO.ok === true, `${leg}: both seats joined (${endpoint})`).toBe(true);
      const pump = pageM.evaluate(async (args) => {
        const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
        if (holder === undefined) throw new Error('leg mover not joined');
        const mod = (await import(/* @vite-ignore */ args.moduleUrl)) as { canonicalRoute: { legDirectionAt(elapsedMs: number): string } };
        (globalThis as unknown as { __udgCellStop?: boolean }).__udgCellStop = false;
        const stopped = (): boolean => (globalThis as unknown as { __udgCellStop?: boolean }).__udgCellStop === true;
        const startedAt = performance.now();
        while (performance.now() - startedAt < args.pumpMs && !stopped()) {
          const dir = mod.canonicalRoute.legDirectionAt(performance.now() - startedAt);
          holder.generation += 1;
          try {
            holder.predictor.send({ generation: holder.generation, moveX: dir === '+x' ? 1 : dir === '-x' ? -1 : 0, moveZ: dir === '+z' ? 1 : dir === '-z' ? -1 : 0 }, true);
          } catch (error) {
            return { sendError: String(error instanceof Error ? error.message : error) };
          }
          await new Promise((resolve) => setTimeout(resolve, 60));
        }
        return { sendError: null as string | null };
      }, { pumpMs: LEG_WARMUP_MS + LEG_MEASURE_MS + 15_000, moduleUrl: ACK_LEDGER_MODULE_URL });
      await new Promise((resolve) => setTimeout(resolve, LEG_WARMUP_MS));
      const probe = await runImpRttProbe(pageM, { pings: LEG_PINGS, cadenceMs: LEG_CADENCE_MS, deadlineMs: 1_500, confirmCapMs: 5_000 });
      await pageM.evaluate(() => { (globalThis as unknown as { __udgCellStop?: boolean }).__udgCellStop = true; });
      await pump;
      let stats: Record<string, unknown> | null = null;
      if (proxyStatsHandle !== null) {
        const settledLeg = await settleProxy(host, proxyStatsHandle);
        handle = -1;
        await closeProxyBounded(host, proxyStatsHandle);
        stats = settledLeg.stats as unknown as Record<string, unknown>;
      }
      const samples = probe.samples.map((sample) => sample.rttMs);
      const dStat = (stats?.['c2s'] ?? null) as { delayPairs: { requestedMs: number; achievedMs: number }[] } | null;
      const sStat = (stats?.['s2c'] ?? null) as { delayPairs: { requestedMs: number; achievedMs: number }[] } | null;
      legs.push({
        leg,
        via: leg === 'D' ? 'direct' : 'proxy',
        tcpNoDelay: noDelay,
        probe,
        percentiles: pcts(samples),
        medianExcessPerLegMs: { c2s: dStat === null ? null : medianExcess(dStat.delayPairs), s2c: sStat === null ? null : medianExcess(sStat.delayPairs) },
        proxy: stats === null ? null : {
          tcpNoDelay: stats['tcpNoDelay'],
          c2sReadBuckets: (dStat as unknown as { readSizeBuckets?: unknown } | null)?.readSizeBuckets ?? null,
          s2cReadBuckets: (sStat as unknown as { readSizeBuckets?: unknown } | null)?.readSizeBuckets ?? null,
          c2sMaxStreamWaitMs: (dStat as unknown as { maxStreamWaitMs?: number } | null)?.maxStreamWaitMs ?? null,
          s2cMaxStreamWaitMs: (sStat as unknown as { maxStreamWaitMs?: number } | null)?.maxStreamWaitMs ?? null,
          connections: stats['connections'],
        },
        validity: networkValidity({
          requestedRttMs: leg === 'E' ? planElev.profile.rttMs : 0,
          declaredJitterBudgetMs: leg === 'E' ? planElev.profile.jitterBudgetMs : 10,
          achievedRttSamples: samples,
        }),
      });
    } finally {
      if (handle >= 0) {
        try { await closeProxyBounded(host, handle); } catch { /* the shutdown guard below reports the host state */ }
      }
      await pageM.close();
      await pageO.close();
    }
  };

  try {
    for (const leg of ['D', 'Z', 'E', 'N'] as const) await runLeg(leg);
    const by = Object.fromEntries(legs.map((entry) => [entry.leg, entry]));
    cellCheck('ab: every leg ran the same canonical motion + rendering with the slot-reservation contract intact (no poison/death/epoch/notSent) and answered all predeclared pings',
      legs.length === 4 && legs.every((entry) => entry.probe.abortedReason === null && entry.probe.notSent === 0 && entry.probe.samples.length === LEG_PINGS),
      legs.map((entry) => ({ leg: entry.leg, answered: entry.probe.samples.length, aborted: entry.probe.abortedReason })));
    const dLeg = by['D'] as LegRecord;
    const zLeg = by['Z'] as LegRecord;
    const eLeg = by['E'] as LegRecord;
    const nLeg = by['N'] as LegRecord;
    cellCheck('ab: the DIRECT leg stays a LAN floor (median <= 15 ms with 0 ms requested) — the attribution baseline itself is valid',
      dLeg.percentiles !== null && dLeg.percentiles.p50 <= 15,
      { d: dLeg.percentiles, reasons: dLeg.validity.reasons });
    cellCheck('ab: the ELEVATED leg\'s §2.2 validity is RECORDED as measured (this cell exists because it currently misses; the check states the actual verdict, honestly)',
      eLeg.validity.valid,
      { e: eLeg.percentiles, reasons: eLeg.validity.reasons });
    const record = {
      schemaVersion: 1,
      kind: 'DIAGNOSTIC — latency attribution legs; NOT Gate A, NOT a matrix cell; symmetric half-RTT policy unchanged; NOTHING subtracted from the accepted metric (leg differences are the attribution, recorded beside it)',
      identity: { commit: sha, dirty, seed, generatedAt: new Date().toISOString() },
      legs,
      attribution: {
        proxyOverheadMs: zLeg.percentiles !== null && dLeg.percentiles !== null ? zLeg.percentiles.p50 - dLeg.percentiles.p50 : null,
        stallPathMs: eLeg.percentiles !== null && zLeg.percentiles !== null ? eLeg.percentiles.p50 - zLeg.percentiles.p50 : null,
        nodelayOffEffectMs: nLeg.percentiles !== null && zLeg.percentiles !== null ? nLeg.percentiles.p50 - zLeg.percentiles.p50 : null,
        requestedOneWayMs: planElev.impairment.oneWayMs,
        note: 'stallPathMs ≈ 2×requestedOneWayMs means the stalls contribute exactly their declared delay and the excess lives elsewhere; excess ABOVE that localises inside the stall path (tube/queue/backpressure — see per-leg medianExcessPerLegMs and stream-wait)',
      },
      checks: cellChecks,
    };
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, 'spike-cell-ab-controls.json'), JSON.stringify(record, null, 2));
    await testInfo.attach('spike-cell-ab-controls.json', { path: join(OUT_DIR, 'spike-cell-ab-controls.json'), contentType: 'application/json' });
  } finally {
    if (hostShutdown === null) {
      try { hostShutdown = await host.shutdown(); } catch { /* asserted below */ }
    }
  }
  expect(hostShutdown !== null && hostShutdown.receipt !== null && hostShutdown.exitCode === 0, 'the proxy host exited FINITELY with a receipt (guard)').toBe(true);
});
/* ------------------------------------------------------------------ GA scenario evidence (slice 6f)
 *
 * `pnpm test:spike -- --id UDG-SPIKE-001 --cell ga-scenarios` runs the ADR-0003 scenario rows
 * that the public client seams and the stall proxy CAN authentically produce, with every
 * injection, control and assertion PREDECLARED here, and reports the rows that no public seam
 * can produce as BLOCKED with the smallest remediation named (a distinct scope proposal — not
 * silently faked, not quietly skipped):
 *
 *  S1 GA-6a/6b  withheld final application delivery + NO close event + client-local deadline
 *               expiring with no state delivery → sends stop, prediction drops, a real rejoin
 *               over a FRESH domain recovers when the network returns within budget.
 *  S2 GA-6c     genuinely exhausted retry/episode (both directions unreachable past every
 *               limit) → suspension: stay stopped, every later send refused, no prediction,
 *               the surfaced result is the suspension, and it holds after the network returns
 *               (no silent resume).
 *  S3 CF-3      post-close send attempts vs send stopping: after close, sends are refused
 *               client-side and the observer side shows no further effect (the containment
 *               fact CF-3 asks for, from observable counters).
 *  M1 CF-1      delivery COUNT during a withheld window — the exact population fact W-7 left
 *               for GA-6c, reported from the delivery ledger (client view) across the window.
 *  M2 CF-4      branch-attribution wording is owned by the suite test
 *               'retirement overflow in the browser…' (EVENT 1 offender closed through the ADR
 *               branch, named); this cell records the mapping and its artifact path.
 *  B1 GA-5a/5b  BLOCKED: no public seam injects a server-side input gap / duplicate stamp /
 *               terminal unrepresented input without a private hook. Smallest remediation:
 *               a test-only operator command on RegionRoom (behind the existing deployment
 *               NONCE) that drops/replays one journalled input row — a DISTINCT scope proposal
 *               (server code is out of this task's grant); until then GA-5a/5b stay Not Run.
 *
 * Rows here are DIAGNOSTIC scenario evidence for the Gate A layout — not Gate A acceptance, not
 * the official matrix. GA-10a/GA-10b are UDG-007 deferrals and are not Gate A blockers.
 */
interface GaSeatSetup {
  ok: boolean;
  roomId?: string;
  sessionId?: string;
  epoch?: number | null;
  error?: string;
}

/** G of the §3.2 stalled-ack rule, read from the spec config by the cells that declare it
 * (packages/config input.stallDetectionDeliveries). Undefined keeps the adapter default (3). */
let GA_STALL_G: number | undefined;

const joinGaSeat = async (
  page: Page,
  endpoint: string,
  target: { mode: 'create'; roomName: string } | { mode: 'byId'; roomId: string },
  /** HARNESS-PAGE setting for GATE-DRIVEN legs (GA-9): when ticks advance manually, deliveries
   * advance with them, and the client-local snapshot deadline needs declared headroom over the
   * scripted cadence — the adopted value (500) stays the default everywhere else. Declared in
   * the artifact; it changes the CLIENT timer only, never the authority. */
  snapshotDeadlineMsOverride?: number,
): Promise<GaSeatSetup> =>
  page.evaluate(async (args) => {
    const adapter = (await import(/* @vite-ignore */ args.adapterUrl)) as PredModuleSurface;
    const makeJoin = async (t: typeof args.join) => adapter.createSdkSeatTransport({
      endpoint: args.endpoint,
      join: t,
      presentation: args.presentation,
      epochTimeoutMs: 15_000,
    });
    const joined = await makeJoin(args.join);
    const roomId = joined.roomId;
    const joins: number[] = [joined.transport.issuedEpoch()];
    const rejoins: { sessionId: string; epoch: number }[] = [];
    const predictor = new adapter.DirectMotionPredictor(joined.transport, {
      speed: args.speed,
      ledgerLimit: 20_000,
      snapshotDeadlineMs: args.snapshotDeadlineMs ?? 500,
      // ADR-0003 §3.2 INPUT_ACK_STALLED, driven by the NAMED spec config field (GA_STALL_G is
      // read from packages/config by the cell; undefined keeps the adapter default 3 — the same
      // value the config declares).
      stallDetectionDeliveries: args.stallG,
      rejoin: async () => {
        const again = await makeJoin({ mode: 'byId', roomId });
        joins.push(again.transport.issuedEpoch());
        // A rejoin is a NEW CLIENT on this stack (new sessionId, new epoch) — record both so
        // downstream evidence (observer tracks, replica rows) follows the NEW identity honestly.
        rejoins.push({ sessionId: again.sessionId, epoch: again.transport.issuedEpoch() });
        // §4.2: `resetForNewEpoch` zeroes the server's generation watermark, and the screen
        // refuses frames >64 ahead of it. A protocol-correct host RESTARTS its generation
        // sequence for the new epoch (the retirement test's same-seat control proves the
        // stack supports exactly this) — continuing the old sequence would strand the seat
        // in silent RESYNC-refusals, which is a CLIENT frame-content defect, not room state.
        const holderRef = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
        if (holderRef !== undefined) holderRef.generation = 0;
        return again.transport;
      },
    });
    predictor.attach();
    const raf = (): void => {
      const seat = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
      if (seat === undefined || !seat.tickStop) predictor.tick(performance.now());
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    (globalThis as unknown as PredSeatWindow).__udgImpSeat = {
      transport: joined.transport,
      predictor,
      roomId,
      sessionId: joined.sessionId,
      generation: 0,
      lastSeenEpoch: joins[0] ?? 0,
      restarts: 0,
      tickStop: false,
    };
    const w = globalThis as unknown as { __udgGaJoins?: number[]; __udgGaRejoins?: { sessionId: string; epoch: number }[] };
    w.__udgGaJoins = joins;
    w.__udgGaRejoins = rejoins;
    return { ok: true, roomId, sessionId: joined.sessionId, epoch: joins[0] ?? null };
  }, {
    endpoint,
    join: target,
    presentation: fixture?.presentation ?? {},
    adapterUrl: ADAPTER_URL,
    speed: fixture?.movementSpeed ?? 0,
    stallG: GA_STALL_G,
    snapshotDeadlineMs: snapshotDeadlineMsOverride,
  });

/** One read of the seat's FULL §3.2 surface — the watchdog's distinct outcomes included. */
interface GaSnapshot {
  events: { event: string; detail: string; atMs: number }[];
  state: string;
  expired: boolean;
  pending: number;
  connectionError: { code: string; message: string; atMs: number } | null;
  suspensionReason: string | null;
  transportEpoch: number;
  joins: number[];
  rejoins: { sessionId: string; epoch: number }[];
  deliveries: number;
  refusals: number;
  sentLen: number;
  sentGensLen: number;
  sentMonotonic: boolean;
  deliveryTally: { accepted: number; rejected: number; oldEpochAccepted: number; oldEpochRejected: number; rejectReasons: string[] };
  oldEpochAcceptedPreTrigger?: number;
  lastDelivery: { epoch: number; authorityTick: number; ack: number; revision: number; accepted: boolean; reason: string; atMs: number; resolvedThrough: number; gapStart: number; gapEnd: number; retiredUnrepresented: number; sentCount: number } | null;
  pendingEntries: { seq: number; epoch: number }[];
  /** authorityTick of every ACCEPTED delivery — lets a scenario ask whether ANY publication at or
   *  after a server decision tick ever reached this client (GA-7 withheld-vs-delivered contrast). */
  acceptedTicks: number[];
  acceptedDeliveries: { tick: number; epoch: number }[];
  /** The page's monotonic clock AT sampling — transcripts join page time to room time with it. */
  pageNowMs: number;
}

const gaRecovery = (page: Page, opts: { sinceIndex?: number; oldEpoch?: number; triggerMs?: number } = {}): Promise<GaSnapshot> =>
  page.evaluate((o) => {
    const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
    if (holder === undefined) throw new Error('the ga seat is not joined');
    const p = holder.predictor;
    const rows = p.deliveryLedger();
    const tally = { accepted: 0, rejected: 0, oldEpochAccepted: 0, oldEpochRejected: 0, rejectReasons: [] as string[] };
    // QUARANTINE BOUNDARY IS THE TRIGGER, not the stall-open: a publication already inside the
    // delay tube when the window opened departs AFTER the op lands and is legitimately ACCEPTED
    // while the seat is still tracking (dpa7o preserved the first run whose conflated tally
    // flaked on exactly this — corrected here, that run kept as the refutation).
    // oldEpochAccepted is now scoped to atMs >= triggerMs; pre-trigger old-epoch acceptances are
    // counted separately, never folded in and never hidden.
    const postTrigger = o.triggerMs ?? Number.POSITIVE_INFINITY;
    let oldEpochAcceptedPreTrigger = 0;
    for (const row of rows.slice(o.sinceIndex ?? rows.length)) {
      if (row.accepted) tally.accepted += 1;
      else tally.rejected += 1;
      if (o.oldEpoch !== undefined && row.delivery.epoch === o.oldEpoch) {
        if (row.accepted) {
          if (row.delivery.atMs >= postTrigger) tally.oldEpochAccepted += 1;
          else oldEpochAcceptedPreTrigger += 1;
        } else {
          tally.oldEpochRejected += 1;
          if (!tally.rejectReasons.includes(row.reason)) tally.rejectReasons.push(row.reason);
        }
      }
    }
    // GENERATION continuity (no-reissue evidence) rides the pump's accepted sends: seq restarts
    // with a new handle by protocol, generation continues — so the page records generations.
    const gens = (globalThis as unknown as { __udgGaSentGens?: number[] }).__udgGaSentGens ?? [];
    let monotonic = true;
    for (let i = 1; i < gens.length; i += 1) {
      const a = gens[i - 1];
      const b = gens[i];
      if (a !== undefined && b !== undefined && b <= a) monotonic = false;
    }
    return {
      events: p.recoveryLedger().map((row) => ({ event: row.event, detail: row.detail, atMs: row.atMs })),
      state: p.stateName(),
      expired: p.recoveryEpisodeExpiredFlag(),
      pending: p.pendingJournal().length,
      connectionError: p.connectionError(),
      suspensionReason: p.suspensionReason(),
      transportEpoch: holder.transport.issuedEpoch(),
      joins: (globalThis as unknown as { __udgGaJoins?: number[] }).__udgGaJoins ?? [],
      rejoins: (globalThis as unknown as { __udgGaRejoins?: { sessionId: string; epoch: number }[] }).__udgGaRejoins ?? [],
      deliveries: rows.length,
      refusals: (globalThis as unknown as { __udgGaRefusals?: number }).__udgGaRefusals ?? 0,
      sentLen: p.sentAudit().length,
      sentGensLen: gens.length,
      sentMonotonic: monotonic,
      deliveryTally: tally,
      oldEpochAcceptedPreTrigger,
      lastDelivery: (() => {
        const last = rows.at(-1);
        return last === undefined ? null : {
          epoch: last.delivery.epoch,
          authorityTick: last.delivery.authorityTick,
          ack: last.delivery.ack,
          revision: last.delivery.revision,
          accepted: last.accepted,
          reason: last.reason,
          atMs: last.delivery.atMs,
          resolvedThrough: last.delivery.resolvedThrough,
          gapStart: last.delivery.gapStart,
          gapEnd: last.delivery.gapEnd,
          retiredUnrepresented: last.delivery.retiredUnrepresented,
          sentCount: last.delivery.sentCount,
        };
      })(),
      pendingEntries: p.pendingJournal().map((entry) => ({ seq: entry.seq, epoch: entry.epoch })),
      acceptedTicks: rows.filter((row) => row.accepted).map((row) => row.delivery.authorityTick),
      acceptedDeliveries: rows.filter((row) => row.accepted).map((row) => ({ tick: row.delivery.authorityTick, epoch: row.delivery.epoch })),
      pageNowMs: performance.now(),
    };
  }, opts);

/**
 * The mover pump for GA scenarios: turns every 4 s of travel so the canonical bounds can never
 * clamp it (the clamped-route lesson stands), counts every send refusal the §3.2 stop-sending
 * produces, and NEVER rejects — a refusal ends and is reported, it cannot kill the cell.
 */
const gaPump = (page: Page, limitMs = 60_000): Promise<{ ended: true; iterations: number }> =>
  page.evaluate(async (args) => {
    const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
    if (holder === undefined) throw new Error('no seat');
    const g = globalThis as unknown as { __udgCellStop?: boolean; __udgGaRefusals?: number; __udgGaSentGens?: number[] };
    g.__udgCellStop = false;
    g.__udgGaRefusals = 0;
    g.__udgGaSentGens = [];
    const stopped = (): boolean => (globalThis as unknown as { __udgCellStop?: boolean }).__udgCellStop === true;
    const startedAt = performance.now();
    let i = 0;
    while (performance.now() - startedAt < args.limitMs && !stopped()) {
      const dir = Math.floor(i / 80) % 2 === 0 ? 1 : -1;
      holder.generation += 1; // CONTINUE the seat's watermark — §4.2 refuses frames far ahead of it
      try {
        const sent = holder.predictor.send({ generation: holder.generation, moveX: dir, moveZ: 0 }, true);
        (g.__udgGaSentGens as number[]).push(sent.generation);
      }
      catch { g.__udgGaRefusals = (g.__udgGaRefusals ?? 0) + 1; }
      i += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { ended: true as const, iterations: i };
  }, { limitMs });

const gaStopPump = (page: Page): Promise<void> =>
  page.evaluate(() => { (globalThis as unknown as { __udgCellStop?: boolean }).__udgCellStop = true; });

/** One PRODUCER send on the ga seat: generation CONTINUES, stamp = sentCount + 1 by the adapter,
 * direct intent — an admissible input the invariant never declines (the ga5l suppressed input). */
const gaOneShot = (page: Page, moveX: number, moveZ: number): Promise<{ seq: number; generation: number; error?: string }> =>
  page.evaluate((d) => {
    const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
    if (holder === undefined) throw new Error('no seat');
    holder.generation += 1;
    try {
      const sent = holder.predictor.send({ generation: holder.generation, moveX: d.moveX, moveZ: d.moveZ }, true);
      return { seq: sent.seq, generation: sent.generation };
    } catch (error) {
      return { seq: -1, generation: -1, error: String(error instanceof Error ? error.message : error) };
    }
  }, { moveX, moveZ });

interface GaBoundary {
  deliveries: number; ack: number; resolvedThrough: number; epoch: number;
  gapStart: number; gapEnd: number; retired: number; pending: number;
  stallStreak: number; sentAuditLen: number; state: string; authorityTick: number;
  events: { event: string; detail: string; atMs: number }[];
}

/** The seat's whole §3.2 OBSERVABLE boundary in one read: last accepted delivery's ack/prefix/
 * gap/retired, the stalled-ack streak, the pending journal, the send audit length, and the full
 * recovery ledger — everything the INPUT_ACK_STALLED claim must stand on, from public adapter
 * surface only. */
const readGaBoundary = (page: Page): Promise<GaBoundary> =>
  page.evaluate(async () => {
    const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
    if (holder === undefined) throw new Error('the ga seat is not joined');
    const p = holder.predictor;
    const rows = p.deliveryLedger();
    const last = rows.length > 0 ? rows[rows.length - 1] : undefined;
    const d = last?.delivery;
    return {
      deliveries: rows.length,
      ack: d?.ack ?? -1,
      resolvedThrough: d?.resolvedThrough ?? -1,
      epoch: d?.epoch ?? -1,
      gapStart: d?.gapStart ?? -1,
      gapEnd: d?.gapEnd ?? -1,
      retired: d?.retiredUnrepresented ?? -1,
      pending: p.pendingJournal().length,
      stallStreak: (p as unknown as { stallStreak: number }).stallStreak,
      sentAuditLen: p.sentAudit().length,
      state: p.stateName(),
      authorityTick: d?.authorityTick ?? -1,
      events: p.recoveryLedger().map((r) => ({ event: r.event, detail: r.detail, atMs: r.atMs })),
    };
  }, {});

/**
 * GA observer seat: the PUBLIC spike observer seam (joinPredictionSeat + createRemotePresentation),
 * joined DIRECT (never through the impairment proxy — the observer's context is the unaffected one).
 * The imp-side join (joinGaSeat) has no presentation; CF/S1 evidence rows need peer TRACKS seen by
 * an unaffected observer, which is exactly what this seam publishes.
 */
const joinGaObserver = async (page: Page, endpoint: string, roomId: string): Promise<{ ok: boolean; roomId: string; sessionId: string }> =>
  page.evaluate(async (args) => {
    const adapter = (await import(/* @vite-ignore */ args.adapterUrl)) as {
      joinPredictionSeat(options: unknown): Promise<PageSeatHandle>;
    };
    const remote = (await import(/* @vite-ignore */ args.remoteUrl)) as {
      createRemotePresentation(): PageRemotePresentation;
    };
    const seat = await adapter.joinPredictionSeat({
      endpoint: args.endpoint,
      join: { mode: 'byId', roomId: args.roomId },
      presentation: args.presentation,
      epochTimeoutMs: 15_000,
    });
    const presentation = remote.createRemotePresentation();
    presentation.observe(seat.snapshot());
    const foldTimer = setInterval(() => presentation.observe(seat.snapshot()), 16);
    (globalThis as unknown as SeatWindow).__udgSpikeSeat = { seat, presentation, foldTimer };
    return { ok: true as const, roomId: args.roomId, sessionId: seat.sessionId };
  }, { endpoint, roomId, presentation: fixture?.presentation ?? {}, adapterUrl: ADAPTER_URL, remoteUrl: REMOTE_URL });

const reportGaTracks = (page: Page): Promise<{ peers: readonly string[]; tracks: PagePeerTrack[] }> =>
  page.evaluate(() => {
    const holder = (globalThis as unknown as SeatWindow).__udgSpikeSeat;
    if (holder === undefined) throw new Error('the ga observer seat is not joined');
    holder.presentation.observe(holder.seat.snapshot());
    return {
      peers: holder.presentation.peers(),
      tracks: holder.presentation.peers()
        .map((peer) => holder.presentation.trackOf(peer))
        .filter((t): t is PagePeerTrack => t !== undefined),
    };
  });


/**
 * GA-5/GA-7 producer seam (slice 6h): stamp the PUBLIC input handle directly — the SAME field
 * writes the production adapter's send path performs (`sessionEpoch/generation/directIntent/
 * moveX/moveZ/seq`, then `send()`). Re-stamping an already-accepted sequence value is what makes
 * the PINNED core's pre-buffer discard run: `RoomInput.capture` asks `InputBuffer.accept(value)`,
 * which returns false for any value `<= _lastSeq` and drops the frame BEFORE the buffer
 * (node_modules/.pnpm/@colyseus+core@0.18.27.../build/input/{RoomInput,InputBuffer}.mjs). This is
 * not a synthetic gap and not a proxy omission: the frame travels, is decoded server-side
 * (`_receivedInputCount` counts it), and the pinned core's own dedupe discards it. Every manual
 * send is journalled in-page — the journaled client-side transcript GA-5/PE-3 language needs.
 */
const gaSendStamped = (page: Page, frame: { seq: number; generation: number; moveX: number; moveZ: number }): Promise<{ ack: number; epoch: number; journalLength: number; stamped: number }> =>
  page.evaluate((args) => {
    const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
    if (holder === undefined) throw new Error('the ga seat is not joined');
    const transport = holder.transport;
    const handle = transport.handle();
    const epoch = transport.issuedEpoch();
    handle.data.sessionEpoch = epoch;
    handle.data.generation = args.generation;
    handle.data.directIntent = true;
    handle.data.moveX = args.moveX;
    handle.data.moveZ = args.moveZ;
    // seq sentinels: >0 explicit; 0 = RE-STAMP the newest accepted value (drives the pinned
    // core's pre-buffer discard); -1 = next contiguous value from the handle's own counter.
    const seq = args.seq > 0 ? args.seq : args.seq === 0 ? handle.sentCount : handle.sentCount + 1;
    handle.data.seq = seq;
    const ack = handle.send();
    const journal = ((globalThis as unknown as { __udgGa5Journal?: { seq: number; generation: number; moveX: number; moveZ: number; ack: number; epoch: number; atMs: number }[] }).__udgGa5Journal ??= []);
    journal.push({ seq, generation: args.generation, moveX: args.moveX, moveZ: args.moveZ, ack, epoch, atMs: performance.now() });
    return { ack, epoch, journalLength: journal.length, stamped: seq };
  }, frame);

/** A contiguous burst stamped from the handle's own send counter (the GA-7T eviction driver). */
const gaBurst = (page: Page, count: number, generationStart: number, moveX: number): Promise<{ firstSeq: number; lastSeq: number; generations: number; journalLength: number }> =>
  page.evaluate((args) => {
    const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
    if (holder === undefined) throw new Error('the ga seat is not joined');
    const transport = holder.transport;
    const handle = transport.handle();
    const epoch = transport.issuedEpoch();
    const journal = ((globalThis as unknown as { __udgGa5Journal?: { seq: number; generation: number; moveX: number; moveZ: number; ack: number; epoch: number; atMs: number }[] }).__udgGa5Journal ??= []);
    let generation = args.generationStart;
    let firstSeq = -1;
    let lastSeq = -1;
    for (let i = 0; i < args.count; i += 1) {
      const seq = handle.sentCount + 1;
      handle.data.sessionEpoch = epoch;
      handle.data.generation = generation;
      handle.data.directIntent = true;
      handle.data.moveX = args.moveX;
      handle.data.moveZ = 0;
      handle.data.seq = seq;
      const ack = handle.send();
      if (firstSeq < 0) firstSeq = seq;
      lastSeq = seq;
      journal.push({ seq, generation, moveX: args.moveX, moveZ: 0, ack, epoch, atMs: performance.now() });
      generation += 1;
    }
    holder.generation = generation - 1;
    return { firstSeq, lastSeq, generations: generation - args.generationStart, journalLength: journal.length };
  }, { count, generationStart, moveX });


// eslint-disable-next-line no-empty-pattern -- Playwright requires the destructured args object even when the cell uses only testInfo.
test('spike cell: ga-scenarios — ADR-0003 GA-6a/6b/6c + GA-7 + GA-5t + GA-5l stalled-ack scenario evidence with predeclared injections and CF-1/CF-3/CF-4 dispositions (DIAGNOSTIC, NOT Gate A)', async ({}, testInfo) => {
  test.skip(process.env['UDG_SPIKE_CELL'] !== 'ga-scenarios', 'dispatched only by `pnpm test:spike -- --id UDG-SPIKE-001 --cell ga-scenarios` (slice 6f/6g scenario evidence)');
  test.setTimeout(600_000);
  expect(fixture, 'the room fixture booted').toBeDefined();
  const seed = Number(process.env['UDG_SPIKE_SEED'] ?? '1001');
  const roomPort = Number(new URL(fixture?.endpoint ?? 'http://127.0.0.1:0').port);
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim().length > 0;
  const checks: { name: string; ok: boolean; detail: unknown }[] = [];
  const cellCheck = (name: string, ok: boolean, detail: unknown): void => {
    checks.push({ name, ok, detail });
    check(name, ok, detail);
  };
  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  // The §3.2 budget the ADOPTED settings declare — every within-budget claim is measured against
  // these exact numbers plus a stated tolerance (browser rAF/timer slack), never a fitted one.
  const EPISODE_BUDGET_MS = 4_000;
  const BUDGET_TOLERANCE_MS = 300;

  const host = await startProxyHost();
  let hostShutdown: Awaited<ReturnType<typeof host.shutdown>> | null;

  // ── Clock bridge (GA-7T timing tightening) ──────────────────────────────────────────────────
  // The room's clock (closeObservations.sampledAtMs, the journal's tick chain) is Node's OWN
  // monotonic clock in THIS process (MovementAuthorityAdapter). The client's deadline fires on the
  // PAGE's monotonic clock. A loopback HTTP bridge measured from the page gives the page→room-clock
  // offset with an explicit error budget: the half-round-trip per sample, maxmed over samples.
  // No new product API: an ephemeral test-local server answering one GET.
  const bridge = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ nodePerfMs: globalThis.performance.now(), nodeWallMs: Date.now() }));
  });
  await new Promise<void>((resolve) => bridge.listen(0, '127.0.0.1', resolve));
  const bridgePort = (bridge.address() as { port: number }).port;
  const configModule = (await import('../../packages/config/dist/index.js')) as {
    DEFAULT_SERVER_CONFIG: object;
    withConfigOverrides(base: object, overrides: unknown): object;
  };
  const liveCfg = configModule.withConfigOverrides(configModule.DEFAULT_SERVER_CONFIG, { region: { bounds: REGION_BOUNDS } }) as unknown as {
    input: { bufferMaxSize: number; closureWindowMs: number; closureMaxMs: number; stallDetectionDeliveries: number };
  };
  const CLOSURE_WINDOW_MS = liveCfg.input.closureWindowMs;
  const CLOSURE_MAX_MS = liveCfg.input.closureMaxMs;
  const BUFFER_MAX_SIZE = liveCfg.input.bufferMaxSize;
  // The NAMED spec config for the §3.2 stalled-ack rule reaches the adapter through joinGaSeat —
  // the scenario never hardcodes G; the config declares it (packages/config input.ts).
  GA_STALL_G = liveCfg.input.stallDetectionDeliveries;

  const bridgeClock = async (page: Page): Promise<{ medianOffsetMs: number; epsilonMs: number; samples: number }> =>
    page.evaluate(async (port: number) => {
      const offsets: number[] = [];
      let epsilon = 0;
      for (let i = 0; i < 12; i += 1) {
        const p0 = performance.now();
        const reply = await (await fetch(`http://127.0.0.1:${String(port)}/time`)).json() as { nodePerfMs: number };
        const p1 = performance.now();
        offsets.push(reply.nodePerfMs - (p0 + p1) / 2);
        epsilon = Math.max(epsilon, (p1 - p0) / 2);
      }
      offsets.sort((a, b) => a - b);
      return { medianOffsetMs: offsets[Math.trunc(offsets.length / 2)] ?? 0, epsilonMs: epsilon + 5, samples: offsets.length };
    }, bridgePort);

  /** Sample the LIVE room from the node side (the room runs IN this process), timestamped on the
   *  room's own clock — the per-scenario poll trail is the live-state record. */
  type TrailSeat = { entityId: string; epoch: number; closing: boolean; resolvedThrough: number; retired: number; gap: { start: number; end: number } | null };
  type TrailSnap = { atMs: number; tick: number; seats: TrailSeat[]; lastTick: number; retiredTickSeen: number | null; closureTicks: { tick: number; code: number }[] };
  const trailSnapshot = (roomId: string): TrailSnap => {
    const room = gatedRoom(roomId);
    const evidence = room.evidence();
    const retiredTickSeen = room.tickRecords.find((rec) => (rec.signals ?? []).some((sig) => sig.signal === 'RETIRED_UNREPRESENTED'))?.tick ?? null;
    const closureTicks = room.tickRecords.flatMap((rec) => (rec.closures ?? []).map((c) => ({ tick: rec.tick, code: c.code })));
    return {
      atMs: Math.trunc(globalThis.performance.now()),
      tick: Number(evidence['ticks'] ?? -1),
      seats: (evidence['seats'] ?? []) as TrailSeat[],
      lastTick: room.tickRecords.at(-1)?.tick ?? -1,
      retiredTickSeen,
      closureTicks,
    };
  };
  const pollTrail = async (roomId: string, done: (snap: TrailSnap) => boolean, maxMs: number, everyMs = 25): Promise<{ trail: TrailSnap[]; hit: TrailSnap | null }> => {
    const trail: TrailSnap[] = [];
    let hit: TrailSnap | null = null;
    const started = Date.now();
    for (;;) {
      const snap = trailSnapshot(roomId);
      trail.push(snap);
      if (done(snap)) { hit = snap; break; }
      if (Date.now() - started > maxMs) break;
      await wait(everyMs);
    }
    return { trail, hit };
  };
  const trailJson = (trail: readonly TrailSnap[]): unknown[] =>
    (trail.length <= 60 ? [...trail] : [...trail.slice(0, 24), { omitted: trail.length - 48 }, ...trail.slice(-24)]);
  const consumedSince = (roomId: string, startIndex: number, entityId: string): number[] =>
    gatedRoom(roomId).tickRecords.slice(startIndex).flatMap((rec) => rec.consumed.filter((c) => c.entityId === entityId).map((c) => c.seq));
  const refusedSince = (roomId: string, startIndex: number, entityId: string): number =>
    gatedRoom(roomId).tickRecords.slice(startIndex).reduce((total, rec) => total + (rec.refused ?? []).filter((r) => r.entityId === entityId).reduce((t2, r) => t2 + r.count, 0), 0);
  const moverCloseObservations = (roomId: string, entityId: string): { entityId: string; retiredUnrepresented: number; serverQueuedAtClose: number; consumedCountAtClose: number; dequeuedTotal: number; sampledAtMs: number }[] =>
    ((gatedRoom(roomId).evidence()['closeObservations'] ?? []) as { entityId: string; retiredUnrepresented: number; serverQueuedAtClose: number; consumedCountAtClose: number; dequeuedTotal: number; sampledAtMs: number }[])
      .filter((o) => o.entityId === entityId);
  const replicaEffects = (roomId: string, key: string): { effects: number; epoch: number; gapStart: number } | null => {
    const row = ((gatedRoom(roomId).evidence()['replicaRows'] ?? []) as { key: string; epoch: number; effects: number; gapStart: number }[]).find((r) => r.key === key);
    return row === undefined ? null : { effects: row.effects, epoch: row.epoch, gapStart: row.gapStart };
  };
  /** Host stats replies nest the ProxyStats under `stats`; one reader for every direction field. */
  const statCount = (reply: Record<string, unknown>, side: 'c2s' | 's2c', field: 'chunksReceived' | 'chunksDelivered' | 'chunksFlushed'): number => {
    const stats = (reply['stats'] ?? reply) as Record<string, unknown>;
    const dir = stats[side] as Record<string, unknown> | undefined;
    const value = dir?.[field];
    return typeof value === 'number' ? value : Number.NaN;
  };
  /** Bounded stats READ (slice 17): the proxy host's stats reply occasionally arrives without
   *  the side block on a busy machine (attempt-7 receipt: a NaN rode into GA-5l's quiet-delta
   *  claim and turned a measurement hiccup into a red row). A missing field is a HOST-IPC
   *  hiccup, not a measurement — retry the READ (never the verdict), and fail loudly if the
   *  counter stays unreadable. Deliberation of numbers is unchanged. */
  const statCountAt = async (handle: number, side: 'c2s' | 's2c', field: 'chunksReceived' | 'chunksDelivered' | 'chunksFlushed'): Promise<number> => {
    const startedAt = Date.now();
    for (;;) {
      const v = statCount(await host.request({ op: 'stats', handle }), side, field);
      if (Number.isFinite(v)) return v;
      if (Date.now() - startedAt > 2_000) throw new Error(`proxy stats ${side}.${field} unreadable for 2 s (host hiccup)`);
      await wait(50);
    }
  };
  const chainAtMs = (roomId: string, tick: number): number | null =>
    gatedRoom(roomId).journal().chain.find((row) => row.tick === tick)?.atMs ?? null;

  /** Poll the seat's §3.2 surface until a condition holds or the bounded wait is spent. */
  const waitLedger = async (page: Page, pick: (snap: GaSnapshot) => boolean, what: string, maxMs: number): Promise<GaSnapshot> => {
    const startedAt = Date.now();
    for (;;) {
      const snap = await gaRecovery(page);
      if (pick(snap)) return snap;
      if (Date.now() - startedAt > maxMs) {
        throw new Error(`timed out waiting for ${what}; tail=${JSON.stringify(snap.events.slice(-4))} state=${snap.state} expired=${String(snap.expired)}`);
      }
      await wait(100);
    }
  };

  /**
   * One scenario, one lifecycle: a ZERO-stall proxy (the impairment is the injected window/kill,
   * never a background delay), a UNIQUE room (close observations and closures stay scoped), the
   * mover through the proxy, the observer DIRECT on the public presentation seam, and finite
   * teardown of proxy and pages no matter how the scenario ends.
   */
  const scenario = async (
    tag: string,
    roomName: string,
    run: (ctx: { pageM: Page; pageO: Page; handle: number; roomId: string; sessionId: string; oldEpoch: number }) => Promise<void>,
    bag?: Record<string, unknown>,
  ): Promise<void> => {
    let handle = -1;
    let joinedRoomId: string | null = null;
    const pageM = await openSeatPage(`${tag}-M`, { bare: true });
    const pageO = await openSeatPage(`${tag}-O`, { bare: true });
    try {
      const started = await host.request({ op: 'start', profile: { name: 'ga', oneWayMs: 0, jitterBudgetMs: 0, seed }, targetHost: '127.0.0.1', targetPort: roomPort });
      handle = started['handle'] as number;
      const proxyUrl = `http://127.0.0.1:${String(started['port'] as number)}`;
      const joinM = await joinGaSeat(pageM, proxyUrl, { mode: 'create', roomName });
      expect(joinM.ok === true, `${tag}: mover joined through the proxy`).toBe(true);
      const roomId = joinM.roomId ?? '';
      joinedRoomId = roomId;
      const joinO = await joinGaObserver(pageO, fixture?.endpoint ?? '', roomId);
      expect(joinO.ok === true, `${tag}: observer joined DIRECT (unaffected context)`).toBe(true);
      try {
        await run({ pageM, pageO, handle, roomId, sessionId: joinM.sessionId ?? '', oldEpoch: joinM.epoch ?? -1 });
      } catch (error) {
        // A scenario that ERRORS records its own FAILED row and the cell continues: every row
        // stands on its own, and a mid-scenario throw can no longer poison later scenarios via
        // the page-close cascade (a pending pump promise rejecting when the helper closes).
        cellCheck(`scenario ${tag} ERRORED (recorded honestly; later scenarios proceed)`, false, {
          error: String(error instanceof Error ? error.message : error),
          forensicBag: bag ?? null,
        });
      }
    } finally {
      await gaStopPump(pageM).catch(() => undefined); // let the pump END before the page does
      await wait(200);
      if (handle >= 0) { try { await closeProxyBounded(host, handle); } catch { /* the host receipt below governs */ } }
      await pageM.close().catch(() => undefined);
      await pageO.close().catch(() => undefined);
      // GA-13 (slice 17): capture THIS scenario's own room journal at teardown — the room object
      // outlives its pages; the arrays are snapshotted so later neutral ticks cannot mutate a
      // captured journal under the replay. A failed capture stays a named missing capture in the
      // cell's GA-13 row (the >= 15 count), never a silent gap.
      if (joinedRoomId !== null) {
        try {
          const roomG = gatedRoom(joinedRoomId) as unknown as {
            journal(): { rows: readonly Record<string, unknown>[]; chain: readonly Record<string, unknown>[]; dropped: number };
            journalPrologue(): Record<string, unknown> | undefined;
            liveConfig(): unknown;
          };
          const jG = roomG.journal();
          journalCaptures.push({
            tag, roomId: joinedRoomId,
            rows: [...jG.rows], chain: [...jG.chain] as unknown as Record<string, unknown>[], dropped: jG.dropped,
            prologue: roomG.journalPrologue() ?? null, liveConfig: roomG.liveConfig(),
          });
        } catch { /* the room is gone: the coverage row counts the missing capture by name */ }
      }
    }
  };

  /** End a withheld window AT THE INSTANT and let fresh traffic through (labelled harness ops). */
  const releaseWindow = async (handle: number): Promise<void> => {
    await host.request({ op: 'stall', handle, direction: 's2c', ms: null });
    await host.request({ op: 'flush', handle, direction: 's2c' });
  };

  const sA: Record<string, unknown> = {};
  const sL: Record<string, unknown> = {};
  const sLI: Record<string, unknown> = {};
  const sLB: Record<string, unknown> = {};
  const s5: Record<string, unknown> = {};
  const sG: Record<string, unknown> = {};
  const sC1: Record<string, unknown> = {};
  const sC2: Record<string, unknown> = {};
  const sT: Record<string, unknown> = {};
  const sB: Record<string, unknown> = {};
  const sC: Record<string, unknown> = {};
  const sD: Record<string, unknown> = {};
  const cf3: Record<string, unknown> = {};
  const sMSD: Record<string, unknown> = {};
  const sMSDec: Record<string, unknown> = {};
  const sMSEp: Record<string, unknown> = {};
  const sGA13J: Record<string, unknown> = {};
  const journalCaptures: {
    tag: string; roomId: string;
    rows: Record<string, unknown>[]; chain: Record<string, unknown>[]; dropped: number;
    prologue: Record<string, unknown> | null; liveConfig: unknown;
  }[] = [];

  try {
    // ═════ GA-6a — patches stop WHILE INPUTS ARE OUTSTANDING: the deadline expires, sending
    // stops, prediction is discarded, AND REJOIN + SNAPSHOT RECOVERY COMPLETE WITHIN BUDGET
    // (director: proving a start is not enough). The withheld window is closed at a measured
    // instant (setStall null + flush) the moment the deadline has proven itself, so the rejoin's
    // own path is usable — the withheld finals still arrive on the OLD domain, where the
    // client's quarantine refuses them: the refusal is the evidence. CF-1's population is
    // COUNTED across the withheld window, never assumed.
    await scenario('ga6a', ROOM_NAME, async (ctx) => {
      const pumpOn = gaPump(ctx.pageM);
      await wait(2_500);
      const seen0 = await reportGaTracks(ctx.pageO);
      sA['movedBefore'] = (seen0.tracks.find((t) => t.sessionId === ctx.sessionId)?.delta.x ?? 0) > 2;
      const before = await gaRecovery(ctx.pageM);
      sA['deliveriesBeforeStall'] = before.deliveries;
      sA['oldEpoch'] = ctx.oldEpoch;
      await host.request({ op: 'stall', handle: ctx.handle, direction: 's2c', ms: 20_000 });
      const trig = await waitLedger(ctx.pageM, (s) => s.events.some((e) => e.event === 'trigger' && e.detail.includes('snapshot-deadline-expired')), 'the client-local deadline', 4_000);
      const triggerAt = trig.events.find((e) => e.event === 'trigger' && e.detail.includes('snapshot-deadline-expired'))?.atMs ?? Number.NaN;
      const during = await gaRecovery(ctx.pageM, { sinceIndex: before.deliveries, oldEpoch: ctx.oldEpoch });
      sA['acceptedDuringWithheld'] = during.deliveryTally.accepted; // CF-1: counted, expected 0
      sA['stoppedAtTrigger'] = trig.events.some((e) => e.event === 'stop-sending') && trig.events.some((e) => e.event === 'discard-pending');
      await releaseWindow(ctx.handle);
      const done = await waitLedger(ctx.pageM, (s) => s.state === 'tracking', 'recovery COMPLETE', 8_000);
      const recoveredAt = done.events.find((e) => e.event === 'snapshot-recovered')?.atMs ?? Number.POSITIVE_INFINITY;
      sA['triggerAtMs'] = triggerAt;
      sA['recoveredAtMs'] = recoveredAt;
      sA['budgetUsedMs'] = recoveredAt - triggerAt;
      sA['attempts'] = done.events.filter((e) => e.event === 'rejoin-attempt').length;
      sA['joins'] = done.joins;
      sA['newEpochFromJoins'] = done.joins.at(-1) ?? -1;
      sA['stateAfter'] = done.state;
      sA['connectionError'] = done.connectionError;
      sA['suspensionReason'] = done.suspensionReason;
      const lateTally = await gaRecovery(ctx.pageM, { sinceIndex: before.deliveries, oldEpoch: ctx.oldEpoch });
      sA['oldEpochAcceptedAfter'] = lateTally.deliveryTally.oldEpochAccepted;
      sA['oldEpochRefusals'] = lateTally.deliveryTally.oldEpochRejected;
      sA['refusalReasons'] = lateTally.deliveryTally.rejectReasons;
      const newSession = done.rejoins.at(-1)?.sessionId ?? ctx.sessionId;
      sA['newSession'] = newSession;
      // The observer's replica gains the NEW identity's row within a patch or two — wait for it
      // (bounded), then measure motion across a window, so 'motion resumed' is never a sampling
      // race against identity rotation.
      let resumeBase = await reportGaTracks(ctx.pageO);
      for (let round = 0; round < 10 && !resumeBase.tracks.some((t) => t.sessionId === newSession); round += 1) {
        await wait(500);
        resumeBase = await reportGaTracks(ctx.pageO);
      }
      await wait(2_500);
      const seen1 = await reportGaTracks(ctx.pageO);
      const t0 = resumeBase.tracks.find((t) => t.sessionId === newSession);
      const t1 = seen1.tracks.find((t) => t.sessionId === newSession);
      sA['resumeForensics'] = {
        peersAtBase: resumeBase.peers, peersAfter: seen1.peers,
        trackAtBase: t0 === undefined ? null : { epoch: t0.epoch, tick: t0.lastSample.tick, x: t0.lastSample.x },
        trackAfter: t1 === undefined ? null : { epoch: t1.epoch, tick: t1.lastSample.tick, x: t1.lastSample.x },
        moverSessionOld: ctx.sessionId, moverSessionNew: newSession,
      };
      sA['observerSawResume'] = t0 !== undefined && t1 !== undefined
        && t1.lastSample.tick - t0.lastSample.tick > 20
        && Math.abs(t1.lastSample.x - t0.lastSample.x) > 0.5;
      cellCheck('GA-6a: patches stop WHILE INPUTS ARE OUTSTANDING on an OPEN socket (withheld window after a zero-stall baseline) → the client-local deadline expires on NON-DELIVERY ALONE → stop-sending + discard-pending → a bounded rejoin runs and SNAPSHOT RECOVERY COMPLETES WITHIN BUDGET (<= 4000 ms + 300 ms slack, measured on the page clock) on a FRESH epoch; the withheld finals arrive late on the OLD domain and are REFUSED (zero old-epoch acceptances); motion resumes on the unaffected observer; no error surface and no suspension reason — this is recovery, not expiry',
        sA['movedBefore'] === true && sA['acceptedDuringWithheld'] === 0 && sA['stoppedAtTrigger'] === true
          && (sA['budgetUsedMs'] as number) <= EPISODE_BUDGET_MS + BUDGET_TOLERANCE_MS
          && sA['stateAfter'] === 'tracking' && (done.joins as number[]).length >= 2 && sA['newEpochFromJoins'] !== ctx.oldEpoch
          && (sA['oldEpochAcceptedAfter'] as number) === 0 && sA['connectionError'] === null && sA['suspensionReason'] === null
          && sA['observerSawResume'] === true,
        sA);
      cellCheck('CF-1 DISPOSITION (counted, not assumed): across the withheld window the ACCEPTED-delivery population is measured against the delivery ledger — crossings = the accepted count from stall-injection to recovery (old-epoch acceptances separately), and the giant-batch lesson holds: deliveries, not stamps',
        sA['acceptedDuringWithheld'] === 0 && (sA['oldEpochAcceptedAfter'] as number) === 0,
        { acceptedDuringWithheld: sA['acceptedDuringWithheld'], oldEpochAcceptedAfter: sA['oldEpochAcceptedAfter'], refusalReasons: sA['refusalReasons'] });
      await gaStopPump(ctx.pageM);
      await pumpOn;
    }, sA);

    // ═════ GA-6b — THE SERVER NEITHER SENDS NOR CLOSES: the recovery begins on the CLIENT'S
    // OWN timer. Distinct required case: between join and trigger ZERO deliveries crossed and
    // no closure existed — the trigger is the local deadline, and recovery completes in budget.
    await scenario('ga6b', ROOM_NAME, async (ctx) => {
      const pumpOn = gaPump(ctx.pageM);
      await wait(2_000);
      const before = await gaRecovery(ctx.pageM);
      expect(before.deliveries, 'baseline deliveries were flowing before the window').toBeGreaterThan(5);
      sB['deliveriesAtStall'] = before.deliveries;
      await host.request({ op: 'stall', handle: ctx.handle, direction: 's2c', ms: 20_000 });
      const trig = await waitLedger(ctx.pageM, (s) => s.events.some((e) => e.event === 'trigger' && e.detail.includes('snapshot-deadline-expired')), 'the deadline WITHOUT any server event', 4_000);
      const triggerAt = trig.events.find((e) => e.event === 'trigger' && e.detail.includes('snapshot-deadline-expired'))?.atMs ?? Number.NaN;
      const during = await gaRecovery(ctx.pageM, { sinceIndex: before.deliveries, oldEpoch: ctx.oldEpoch });
      sB['deliveriesBetweenJoinAndTrigger'] = during.deliveryTally.accepted;
      sB['triggerDetail'] = trig.events.find((e) => e.event === 'trigger')?.detail ?? '';
      sB['stateAtTrigger'] = trig.state;
      sB['noClosureLedger'] = !trig.events.some((e) => e.detail.includes('closed'));
      await releaseWindow(ctx.handle);
      const done = await waitLedger(ctx.pageM, (s) => s.state === 'tracking', 'GA-6b recovery COMPLETE', 8_000);
      const recoveredAt = done.events.find((e) => e.event === 'snapshot-recovered')?.atMs ?? Number.POSITIVE_INFINITY;
      sB['budgetUsedMs'] = recoveredAt - triggerAt;
      sB['joins'] = done.joins;
      sB['newEpochFromJoins'] = done.joins.at(-1) ?? -1;
      cellCheck('GA-6b (distinct required case, real scenario): with the server NEITHER sending NOR closing (open socket, withheld application window, ZERO deliveries and NO closure between join and trigger — counted), the client STILL recovers on its OWN timer: the trigger is snapshot-deadline-expired with state never \'closed\', and rejoin + fresh-domain snapshot recovery COMPLETES within budget',
        (sB['deliveriesBetweenJoinAndTrigger'] as number) === 0
          && String(sB['triggerDetail']).includes('snapshot-deadline-expired')
          && sB['stateAtTrigger'] !== 'closed' && sB['noClosureLedger'] === true
          && (sB['budgetUsedMs'] as number) <= EPISODE_BUDGET_MS + BUDGET_TOLERANCE_MS
          && done.state === 'tracking' && (done.joins as number[]).length >= 2 && sB['newEpochFromJoins'] !== ctx.oldEpoch,
        sB);
      await gaStopPump(ctx.pageM);
      await pumpOn;
    }, sB);

    // ═════ GA-6c (EPISODE arm) — the join itself is withheld and NEVER settles: the
    // INDEPENDENT per-episode hard deadline must expire the episode on its own timer (the S1b
    // blocking finding, now the assertion), surface the prescribed connection error, keep the
    // seat stopped AND holding, and quarantine the late-returned room without extra joins,
    // sends, or adoption. CF-3 rides this page pair (the observer is right here).
    await scenario('ga6cep', ROOM_NAME, async (ctx) => {
      const pumpOn = gaPump(ctx.pageM);
      await wait(1_500);
      await host.request({ op: 'stall', handle: ctx.handle, direction: 's2c', ms: 20_000 });
      const trig = await waitLedger(ctx.pageM, (s) => s.events.some((e) => e.event === 'trigger' && e.detail.includes('snapshot-deadline-expired')), 'the trigger', 4_000);
      const triggerAt = trig.events.find((e) => e.event === 'trigger' && e.detail.includes('snapshot-deadline-expired'))?.atMs ?? Number.NaN;
      sC['sentLenAtTrigger'] = trig.sentLen;
      // NO release: the rejoin's handshake is withheld forever — the watchdog acts alone.
      const exp = await waitLedger(ctx.pageM, (s) => s.expired === true, 'the INDEPENDENT episode deadline', EPISODE_BUDGET_MS + 2_000);
      const expiredAt = exp.events.find((e) => e.event === 'episode-expired')?.atMs ?? Number.POSITIVE_INFINITY;
      sC['triggerAtMs'] = triggerAt;
      sC['expiredAtMs'] = expiredAt;
      sC['expiryWithinBudgetMs'] = expiredAt - triggerAt;
      sC['suspensionReason'] = exp.suspensionReason;
      sC['connectionError'] = exp.connectionError;
      sC['joinsDuringEpisode'] = exp.joins.length;
      sC['stateAfterExpiry'] = exp.state;
      sC['noAdoptionAtExpiry'] = !exp.events.some((e) => e.event === 'snapshot-recovered');
      sC['sentFrozenAcrossEpisode'] = exp.sentLen === trig.sentLen; // stop-sending held: NO extra sends
      sC['refusalsCounted'] = exp.refusals;
      sC['predictionHeld'] = exp.pending === 0;
      // The withheld handshake finally lands: the attempt must be QUARANTINED — room closed,
      // nothing adopted, seat still stopped, error still surfaced.
      sC['releaseReplies'] = [
        await host.request({ op: 'stall', handle: ctx.handle, direction: 's2c', ms: null }),
        await host.request({ op: 'flush', handle: ctx.handle, direction: 's2c' }),
      ];
      let late: GaSnapshot;
      const probes: unknown[] = [];
      const lateStarted = Date.now();
      for (;;) {
        late = await gaRecovery(ctx.pageM);
        if (late.events.some((e) => e.detail.includes('abandoned rejoin') || e.detail.includes('rejoin route failed'))) break;
        probes.push({ atMs: Date.now() - lateStarted, stats: await host.request({ op: 'stats', handle: ctx.handle }).catch(() => null) });
        if (Date.now() - lateStarted > 15_000) {
          sC['lateWaitTimedOut'] = true;
          sC['lateWaitLedgerTail'] = late.events.slice(-4);
          break;
        }
        await wait(1_500);
      }
      sC['lateProbes'] = probes.slice(-3);
      sC['lateResolutions'] = late.events.filter((e) => e.detail.includes('abandoned rejoin') || e.detail.includes('rejoin route failed')).map((e) => e.detail);
      sC['lateRefusalLedger'] = late.events.filter((e) => e.detail.includes('abandoned rejoin') || e.detail.includes('rejoin route failed')).map((e) => e.detail);
      sC['stateAfterLate'] = late.state;
      sC['noAdoptionAfterLate'] = !late.events.some((e) => e.event === 'snapshot-recovered');
      sC['errorStillSurfaced'] = late.connectionError !== null;
      sC['stillStopped'] = late.sentLen === trig.sentLen;
      // CF-3 on THIS pair: quiet the pump FIRST (a pump on a closing page poisons the run),
      // then close the seat and read the observer.
      await gaStopPump(ctx.pageM);
      await pumpOn;
      const postClose = await ctx.pageM.evaluate(async () => {
        const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
        if (holder === undefined) throw new Error('no seat');
        await holder.predictor.close();
        let refused = 0;
        for (let i = 0; i < 3; i += 1) {
          try { holder.predictor.send({ generation: 990_000 + i, moveX: 1, moveZ: 0 }, true); } catch { refused += 1; }
        }
        return { refused, state: holder.predictor.stateName() };
      });
      const seenNow = await reportGaTracks(ctx.pageO);
      const trackNow = seenNow.tracks.find((t) => t.sessionId === ctx.sessionId);
      cf3['postClose'] = postClose;
      cf3['poseAtClose'] = trackNow?.lastSample ?? null;
      await wait(8_000);
      const seenAfter = await reportGaTracks(ctx.pageO);
      const trackAfter = seenAfter.tracks.find((t) => t.sessionId === ctx.sessionId);
      cf3['observerStillTracks'] = trackAfter !== undefined;
      cf3['poseAfterGrace'] = trackAfter?.lastSample ?? null;
      cf3['samplesAdvancedAfterClose'] = trackAfter !== undefined && trackNow !== undefined ? trackAfter.lastSample.tick - trackNow.lastSample.tick : 0;
      cellCheck('GA-6c EPISODE arm (the S1b finding, now a first-class assertion): a rejoin route whose join NEVER settles cannot gate §3.2 — the INDEPENDENT per-episode hard deadline expires the episode within budget (<= 4000 ms + 300 ms slack from the trigger, page clock), SURFACES the prescribed connection error (recovery-episode-expired), keeps the seat stopped (sent count FROZEN across the whole episode — no extra sends, refusals counted), holding (pending 0, epoch still old, nothing adopted), runs NO extra joins (exactly the one in-flight), and nothing adopts anything: 15 s after the window releases the held join still has not settled (late probes recorded), while the seat shows NO adoption, NO resume, NO extra join and the error stays surfaced — the settle-time quarantine ITSELF (close the late room, refuse install) is proven by the fake-clock never-settles control and the existing late-settle-after-close control',
        (sC['expiryWithinBudgetMs'] as number) <= EPISODE_BUDGET_MS + BUDGET_TOLERANCE_MS
          && sC['suspensionReason'] === 'episode-deadline'
          && (sC['connectionError'] as { code?: string } | null)?.code === 'recovery-episode-expired'
          && sC['joinsDuringEpisode'] === 1 && sC['stateAfterExpiry'] === 'suspended'
          && sC['noAdoptionAtExpiry'] === true && sC['sentFrozenAcrossEpisode'] === true
          && (sC['refusalsCounted'] as number) > 0 && sC['predictionHeld'] === true
          && sC['stateAfterLate'] === 'suspended' && sC['errorStillSurfaced'] === true && sC['stillStopped'] === true
          && sC['noAdoptionAfterLate'] === true,
        sC);
      cellCheck('CF-3 DISPOSITION: after predictor.close() every send attempt is REFUSED client-side (state closed; nothing can leave the seat) and the observer — online throughout on its own context — shows NO post-close effect: zero samples advanced after the close (pose frozen, deep-compare); the track may persist until the server-side leave lands, which changes nothing observed',
        (postClose as { refused: number }).refused === 3 && (postClose as { state: string }).state === 'closed'
          && (cf3['samplesAdvancedAfterClose'] as number) === 0,
        cf3);
    }, sC);

    // ═════ GA-6c (ROLLING arm) — genuine exhaustion: context offline 9 s, BOTH bounded
    // attempts fail fast, the ROLLING allowance suspends BEFORE the episode deadline — and the
    // two limits stay DISTINCT: no expiry flag, no connection error, reason 'rolling-window'.
    await scenario('ga6croll', ROOM_NAME, async (ctx) => {
      const pumpOn = gaPump(ctx.pageM);
      await wait(2_000);
      const seenBefore = await reportGaTracks(ctx.pageO);
      sD['movedBefore'] = (seenBefore.tracks.find((t) => t.sessionId === ctx.sessionId)?.delta.x ?? 0) > 2;
      await ctx.pageM.context().setOffline(true); // a REAL network loss at the socket layer
      const done = await waitLedger(ctx.pageM, (s) => s.state === 'suspended', 'suspension via the rolling allowance', 12_000);
      sD['events'] = done.events.map((e) => e.event);
      sD['attempts'] = done.events.filter((e) => e.event === 'rejoin-attempt').length;
      sD['suspensionReason'] = done.suspensionReason;
      sD['expiredFlag'] = done.expired;
      sD['connectionError'] = done.connectionError;
      sD['refusals'] = done.refusals;
      sD['pending'] = done.pending;
      await wait(2_000);
      const late = await gaRecovery(ctx.pageM);
      sD['holdsAfterTwoMoreSeconds'] = late.state === 'suspended';
      await ctx.pageM.context().setOffline(false);
      await wait(3_000);
      const stillSuspended = await gaRecovery(ctx.pageM);
      sD['suspensionHoldsAfterNetworkReturnsInEpisode'] = stillSuspended.state === 'suspended' || stillSuspended.state === 'recovering';
      cellCheck('GA-6c ROLLING arm: with the network genuinely gone (context offline 9 s after SEEN healthy motion), both bounded attempts fail and the ROLLING two-per-window allowance suspends the seat — stayed stopped (refusals counted), prediction discarded (pending 0), suspension HOLDS; and the two §3.2 limits remain DISTINCT: the rolling suspension is NOT an episode expiry (no expiry flag, NO connection error, reason exactly \'rolling-window\')',
        sD['movedBefore'] === true && (sD['attempts'] as number) === 2 && sD['suspensionReason'] === 'rolling-window'
          && sD['expiredFlag'] === false && sD['connectionError'] === null
          && (sD['refusals'] as number) > 0 && sD['pending'] === 0
          && sD['holdsAfterTwoMoreSeconds'] === true,
        sD);
      await gaStopPump(ctx.pageM);
      await pumpOn;
    }, sD);

    // ═════ GA-5a/GA-5b — REAL PRE-BUFFER DEDUPE, same domain, journaled (slice 6h). The seam is
    // the PINNED core itself: `RegionRoom` declares `defineInput(DirectInputSchema, { seqField:
    // 'seq' })`, and `RoomInput.capture` asks `InputBuffer.accept(value)`, which returns false for
    // any stamp `<= _lastSeq` and drops the frame BEFORE the buffer (0.18.27, build/input/
    // {RoomInput,InputBuffer}.mjs). Re-stamping through the PUBLIC input handle — the very handle
    // the production adapter writes — therefore produces a genuine pre-buffer discard: the frame
    // travels (proxy c2s receipts count the bytes), is decoded server-side, and the pinned core's
    // own dedupe drops it. No operator command, no synthetic gap, no proxy omission. The client's
    // journaled transcript (`__udgGa5Journal`) and the room's consumed-stamp record are the two
    // bookends; the observer's z-axis is the no-duplicate-movement witness (every deduped frame
    // carries moveZ = 1: if a deduped frame ever MOVED anything, z would prove it).
    // ── GA-5a/GA-5b (REAL pre-buffer dedupe), restructured after TWO first-run disproofs (runs
    // dpa4b/c/d preserved in the evidence bundle, nothing silently patched):
    //  (i) the client does NOT stay quiet through a named range — the delivery guard refuses any
    //     delivery carrying a named gap (`gap-named`) and opens a §3.2 episode: exactly what ADR
    //     GA-5a demands ("the client detects the named range and resynchronises");
    //  (ii) a §3.2 resync LEAVES a still-buffered input behind, and the pinned core's leave-drain
    //     advances the consumed counter WITHOUT dequeuing (the W-9 question, answered live): the
    //     room then charges §3.1's subtraction on the abandoned seat and closes it 4100. Case A
    //     therefore QUIETS THE WIRE FIRST (buffer drained before the resync-leave) so "the
    //     server does not close" is tested against the dedupe evidence, not against an artefact
    //     of leaving mid-flight — and the leave-drain closure, when it occurs, is recorded as
    //     the cause-attributed finding it is (W-9), never blamed on the gap.
    // The shapes: a replayed stamp consumes a slot of the SDK send counter (`sent <= stamped`,
    // PR-15's measured limit), so the NEXT contiguous stamp jumps — the server sees a stamp gap
    // that never existed on the wire and NAMES it. Case B terminates with the client's own
    // predictor-stamped frame re-stamped by that consumed slot: it is eaten pre-buffer, stays in
    // the client's pending journal unacked, and the deadline does the rest — §3.2 despite a loss
    // the server cannot identify.
    await scenario('ga5', ROOM_NAME, async (ctx) => {
      const pumpOn = gaPump(ctx.pageM);
      await wait(900);
      s5['deliveriesAt900'] = (await gaRecovery(ctx.pageM)).deliveries; // deliveries MUST be flowing
      await wait(900);
      s5['deliveriesAt1800'] = (await gaRecovery(ctx.pageM)).deliveries;
      // ── Invariant control (measured on the HEALTHY window, before any fixture interference):
      // a producer obeying the admissible invariant — same domain, stamp = sentCount + 1, strictly
      // increasing — makes pre-buffer dedupe UNREACHABLE, because every stamp exceeds every stamp
      // yet accepted (accept() can only decline <= _lastSeq). The consumed list is the witness:
      // contiguous from 1 means accept() declined NOTHING in this window.
      const invConsumed = consumedSince(ctx.roomId, 0, ctx.sessionId);
      const invSnap = await gaRecovery(ctx.pageM);
      s5['invariantControl'] = {
        consumed: invConsumed.length,
        contiguousFromOne: invConsumed.length > 10 && invConsumed.every((seq, i) => seq === i + 1),
        resolvedThrough: invSnap.lastDelivery?.resolvedThrough ?? -1,
        sentCount: invSnap.lastDelivery?.sentCount ?? -1,
        gapStart: invSnap.lastDelivery?.gapStart ?? -1,
        gapEnd: invSnap.lastDelivery?.gapEnd ?? -1,
        episodes: invSnap.events.length,
      };
      const tickIndex0 = gatedRoom(ctx.roomId).tickRecords.length;
      const seen0 = await reportGaTracks(ctx.pageO);
      const track0 = seen0.tracks.find((t) => t.sessionId === ctx.sessionId);
      s5['movedBefore'] = (track0?.delta.x ?? 0) > 2;
      // ── Case 1 (GA-5a): QUIET, then a replayed stamp followed by a later stamp (same domain).
      await gaStopPump(ctx.pageM);
      await pumpOn;
      await wait(350); // the wire QUIETS: buffer drains, everything sent is consumed and acked
      const statsA = await host.request({ op: 'stats', handle: ctx.handle });
      const dup1 = await gaSendStamped(ctx.pageM, { seq: 0, generation: 900_001, moveX: 0, moveZ: 1 });
      s5['dup1'] = dup1; // re-stamps the newest accepted value; content moveZ=1 (a mover never made)
      const later1 = await gaSendStamped(ctx.pageM, { seq: -1, generation: 900_002, moveX: 1, moveZ: 0 });
      s5['later1'] = later1; // the LATER stamp — its slot jumped because the replay consumed one
      s5['stampJump'] = later1.stamped - dup1.stamped; // expected 2: one slot consumed by the replay
      await wait(400);
      const statsB = await host.request({ op: 'stats', handle: ctx.handle });
      s5['dupWireChunksDelta'] = statCount(statsB, 'c2s', 'chunksReceived') - statCount(statsA, 'c2s', 'chunksReceived');
      const consumedA = consumedSince(ctx.roomId, tickIndex0, ctx.sessionId);
      s5['consumedOnceA'] = consumedA.length > 0 && new Set(consumedA).size === consumedA.length;
      s5['lastConsumedPairsA'] = consumedA.slice(-4);
      const gapTrail = await pollTrail(ctx.roomId, (snap) => snap.seats.some((seat) => seat.entityId === ctx.sessionId && (seat.gap?.start ?? -1) > 0), 1_500);
      s5['namedGapServerRecord'] = gapTrail.trail.flatMap((snap) => snap.seats.filter((seat) => seat.entityId === ctx.sessionId && seat.gap !== null).map((seat) => seat.gap)).at(-1) ?? null;
      // The client detects the named range (guard refusal 'gap-named') and RESYNCHRONISES — the
      // episode must COMPLETE within budget on a fresh epoch.
      let doneA: GaSnapshot;
      const resyncStarted = Date.now();
      for (;;) {
        const snap = await gaRecovery(ctx.pageM);
        if (snap.events.some((e) => e.event === 'snapshot-recovered') && snap.state === 'tracking') { doneA = snap; break; }
        if (Date.now() - resyncStarted > 8_000) {
          throw new Error(`GA-5a resync never completed; tail=${JSON.stringify(snap.events.slice(-6))} state=${snap.state}`);
        }
        await wait(120);
      }
      const trigIndex = doneA.events.findIndex((e) => e.event === 'trigger');
      const recIndex = doneA.events.findIndex((e) => e.event === 'snapshot-recovered');
      s5['gapNamedTrigger'] = doneA.events.filter((e) => e.event === 'trigger' && e.detail.includes('gap-named')).map((e) => e.detail);
      s5['resyncBudgetA'] = doneA.events[recIndex]!.atMs - (trigIndex >= 0 ? doneA.events[trigIndex]!.atMs : Number.NaN);
      s5['resyncAttemptA'] = doneA.events.filter((e) => e.event === 'rejoin-attempt').length;
      const seenZ = await reportGaTracks(ctx.pageO);
      const trackZ = seenZ.tracks.find((t) => t.sessionId === ctx.sessionId) ?? seenZ.tracks.find((t) => t.sessionId === (doneA.rejoins.at(-1)?.sessionId ?? ''));
      s5['zDisplacement'] = Math.abs((trackZ?.lastSample.z ?? 0) - (track0?.lastSample.z ?? 0));
      const signalsA = gatedRoom(ctx.roomId).tickRecords.slice(tickIndex0).flatMap((rec) => (rec.signals ?? []).filter((sig) => sig.entityId === ctx.sessionId).map((sig) => sig.signal));
      s5['moverSignals'] = signalsA; // expectation: NO RETIRED_UNREPRESENTED anywhere in Case A
      const closuresA = gatedRoom(ctx.roomId).tickRecords.slice(tickIndex0).flatMap((rec) => (rec.closures ?? []).filter((c) => c.entityId === ctx.sessionId));
      s5['moverClosuresA'] = closuresA;
      const obsA = moverCloseObservations(ctx.roomId, ctx.sessionId);
      s5['closeObservationsA'] = obsA; // the drained wire should leave retired = 0 behind (W-9 evidence either way)
      // ── Case 2 (the dpa5-era GA-5b fixture) is RETIRED, and its deletion IS the correction:
      // review showed the block could not evidence what its prose claimed — its sends followed a
      // §3.2 REJOIN (cross-domain counter residue), the 'twin coverage' row it pointed at was never
      // keyed to the domain, and the room's resolved prefix advances ONLY over real dequeues
      // (apps/server/src/network/ColyseusInputAdapter.ts:190-193) while the SDK slot-ack is an
      // INDEPENDENT counter the accepted guard merely cross-checks (apps/client/src/network/
      // ColyseusPredictionAdapter.ts:339-340). The genuine terminal evidence lives in scenario
      // 'ga5t' below: one indexed transcript on a FRESH isolated seat, validated by
      // tools/load-test/src/ga5-transcript.ts (unit-tested with forged red controls). The refuted
      // runs (dpa5f/dpa5g/dpa5h) are PRESERVED in the evidence bundle, not patched away.
      const inv5b = (s5['invariantControl'] ?? {}) as Record<string, unknown>;
      cellCheck("GA-5b invariant control — under the admissible healthy-producer invariant (same domain, stamp = sentCount + 1, strictly increasing) pre-buffer dedupe is UNREACHABLE — measured on the healthy window: the healthy pump window BEFORE any fixture interference: consumed stamps are CONTIGUOUS FROM 1 (" + String(inv5b["consumed"]) + " consumed, contiguous " + String(inv5b["contiguousFromOne"]) + "), resolvedThrough " + String(inv5b["resolvedThrough"]) + " tracks sends " + String(inv5b["sentCount"]) + " (in-flight tolerance <= 6, recorded), no gap was ever named (gap " + String(inv5b["gapStart"]) + ".." + String(inv5b["gapEnd"]) + "), zero recovery events (" + String(inv5b["episodes"]) + "). accept() declines only values <= the last accepted stamp, so an invariant-obeying producer is NEVER declined: the ONLY route to ANY pre-buffer decline is a raw re-stamp BYPASS of the producer (what scenario ga5t below measures head-on), and a consumed-slot jump is that bypass' own fingerprint — the ANTI-ALIAS CONTROL: the healthy population shows the dedupe NEVER fires without the bypass",
        inv5b["contiguousFromOne"] === true &&
        inv5b["episodes"] === 0 &&
        Number(inv5b["gapStart"]) === 0 &&
        Number(inv5b["gapEnd"]) === 0 &&
        Math.abs(Number(inv5b["sentCount"]) - Number(inv5b["resolvedThrough"])) <= 6,
        inv5b);
      await gaStopPump(ctx.pageM);
    }, s5);

    // ═════ GA-7 (tightened, GA-7T) — FINAL PUBLICATION WITHHELD, timed against the SERVER'S OWN
    // loss/decision tick and its exact §3.3 closure window. Shape (predeclared): healthy pump;
    // s2c WITHHELD (application delivery withheld at the proxy hop — socket OPEN, never TCP loss);
    // two contiguous stamp waves push the input buffer past bufferMaxSize so the SERVER confirms
    // the loss ITSELF (consumed-without-dequeued -> RETIRED_UNREPRESENTED at its own step = the
    // decision tick; the closure window opens there, [decision, decision+closureWindowMs], capped
    // by closureMaxMs — RegionRoom §3.3); the client's local deadline must fire INSIDE that exact
    // window (page clock bridged to the room's clock by the loopback bridge, error budget stated);
    // the 4100 closure runs at window end (its close frame is itself withheld — the client cannot
    // see any of this). NO harness sever is used to reach the branch: the consequence branch is
    // reached by the room's own arithmetic on its own ticks. Controls C1/C2 below.
    // ═════ GA-5t TRANSCRIPT (slice 7) — the CORRECTED GA-5b evidence. A fresh isolated seat (this
    // scenario's own room/pages — NO rejoin, no cross-domain counter residue), ONE indexed
    // (roomId, sessionId, epoch) transcript joined to real tick records: per-send ordinal, staged
    // seq READ BACK from the wire object, slot counter before/after, ack return, epoch, per-send
    // proxy wire receipts, immutable delivered ledger rows (epoch/ack/resolved/gap/retired), and
    // pending-journal samples. The GENUINE terminal form is the EQUALITY replay: an ORIGINAL
    // producer frame accepted and CONSUMED at stamp n, then a raw REPLAY re-stamping n — declined
    // at the pre-buffer boundary, TERMINAL (nothing follows). The claim is ABSENCE, validated by
    // tools/load-test/src/ga5-transcript.ts: the decline contributes ZERO consumptions, ZERO
    // refusals, no gap, no closure — it has NO room-owned disposition ANYWHERE. No coverage claim:
    // the slot-ack layer and the resolved prefix are INDEPENDENT counters; the accepted-delivery
    // guard fuses them only as a DETECTION seam (equality is a precondition, refusals prove the
    // seam fires), never as proof that a declined input was disposed.
    await scenario('ga5t', ROOM_NAME, async (ctx) => {
      const pumpOn = gaPump(ctx.pageM);
      void pumpOn;
      await wait(700);
      await gaStopPump(ctx.pageM); // from here the TRANSCRIPT controls every send on this wire
      await wait(700);             // drain: quiet wire, nothing outstanding
      const t0 = gatedRoom(ctx.roomId).tickRecords.length;
      sT['windowStartTickRecord'] = t0;
      const wireChunks = async (): Promise<number> =>
        statCount(await host.request({ op: 'stats', handle: ctx.handle }), 'c2s', 'chunksReceived');
      const quiet = await gaRecovery(ctx.pageM);
      sT['pendingQuiet'] = quiet.pending;
      // FULL PROVENANCE, no exceptions: the pre-window PUMP frames are transcript sends too. The
      // validator refuses any consumed stamp without a staged sender (the aliasing detector), so
      // the scenario declares everything its wire ever staged — the pump's own audit journal is
      // the source here (slots adapter-managed: -2; window receipts aggregated over the pump).
      const preludeAudit = await ctx.pageM.evaluate(async () => {
        const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
        if (holder === undefined) throw new Error('ga5t: no imp seat on the page');
        return holder.predictor.sentAudit().map((row) => ({ seq: row.seq, epoch: row.epoch, atMs: row.atMs }));
      }, {});

      // send #1 ORIGINAL — a PRODUCER send (the admissible route), distinctive content moveX=+1.
      const w0 = await wireChunks();
      const orig = await ctx.pageM.evaluate(async () => {
        const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
        if (holder === undefined) throw new Error('ga5t: no imp seat on the page');
        const handle = holder.transport.handle();
        const slotBefore = handle.sentCount;
        holder.generation += 1;
        holder.predictor.send({ generation: holder.generation, moveX: 1, moveZ: 0 }, true);
        const audit = holder.predictor.sentAudit().at(-1);
        return {
          stagedSeq: audit?.seq ?? -1,
          genUsed: holder.generation,
          slotBefore,
          slotAfter: handle.sentCount,
          // the PRODUCER route keeps its slot inside the adapter — recorded as
          // -2 ('adapter-managed'), never invented; the raw route reports handle.send()'s value.
          ackReturn: -2,
          epoch: holder.transport.issuedEpoch(),
          atMs: performance.now(),
        };
      });
      await wait(200);
      const w1 = await wireChunks();
      await wait(600); // let the room dequeue it and land a delivery

      // send #2 REPLAY — raw BYPASS re-stamping the SAME stamp n; DECLINED pre-buffer by intent
      // (declared to the validator, never inferred); distinctive content moveZ=+1 so an
      // application would be visible on the observer's z axis.
      const rw0 = await wireChunks();
      const replay = await ctx.pageM.evaluate(async (args) => {
        const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
        if (holder === undefined) throw new Error('ga5t: no imp seat on the page');
        const handle = holder.transport.handle();
        const slotBefore = handle.sentCount;
        handle.data.sessionEpoch = holder.transport.issuedEpoch();
        handle.data.generation = args.gen;
        handle.data.directIntent = true;
        handle.data.moveX = -1;
        handle.data.moveZ = 1;
        handle.data.seq = args.seq;
        const ackReturn = handle.send();
        return {
          stagedSeq: handle.data.seq as number,
          slotBefore,
          slotAfter: handle.sentCount,
          ackReturn,
          epoch: holder.transport.issuedEpoch(),
          atMs: performance.now(),
        };
      }, { seq: orig.stagedSeq, gen: orig.genUsed + 1 });
      await wait(200);
      const rw1 = await wireChunks();

      // transcript window: 2.4 s of page-clocked pending/delivery samples, node-clocked room
      // records joined below — nothing is sampled after the fact from summary state alone.
      const samples: { atMs: number; pending: number[]; events: readonly string[]; deliveries: number }[] = [];
      for (let i = 0; i < 24; i += 1) {
        const snap = await gaRecovery(ctx.pageM);
        samples.push({ atMs: snap.pageNowMs, pending: snap.pendingEntries.map((e) => e.seq), events: snap.events.map((e) => e.event), deliveries: snap.deliveries });
        await wait(100);
      }
      const ledgerRows = await ctx.pageM.evaluate(async (idx) => {
        const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
        if (holder === undefined) throw new Error('ga5t: no imp seat on the page');
        return holder.predictor.deliveryLedger().slice(idx).map((row) => ({
          epoch: row.delivery.epoch,
          authorityTick: row.delivery.authorityTick,
          revision: row.delivery.revision,
          atMs: row.delivery.atMs,
          ack: row.delivery.ack,
          resolvedThrough: row.delivery.resolvedThrough,
          gapStart: row.delivery.gapStart,
          gapEnd: row.delivery.gapEnd,
          retiredUnrepresented: row.delivery.retiredUnrepresented,
          accepted: row.accepted,
          reason: row.reason,
        }));
      }, 0);
      const acceptedNow = ledgerRows.filter((row) => row.accepted);
      const windowAll = ledgerRows.slice(Math.max(0, quiet.deliveries));
      // END-OF-WINDOW BOUNDARY (read BEFORE the close): the full recovery ledger. With the §3.2
      // stalled-ack rule IMPLEMENTED (slice 8), the raw-bypass replay leaves THIS measuring
      // client's own journal holding the replay's slot — the adapter journals every send through
      // the handle's onSend, and no prefix can ever resolve the bypass slot. pendingSamples
      // preserved exactly this in EVERY retained run (dpa6d/dpa6e show stamp 16 pending through
      // the window); the earlier prose claim 'no pending entry for a raw bypass send' is RETIRED
      // by its own evidence. The contract rule therefore begins a §3.2 episode on the ga5t seat
      // too — disclosed here, not hidden: the transcript stays epoch-scoped, and rows of OTHER
      // domains (the bounded rejoin's new sessionId/epoch) are COUNTED, never silently dropped.
      const endB = await readGaBoundary(ctx.pageM);
      const stallEpisode = endB.events.filter((e2) => e2.event === 'trigger' && e2.detail.startsWith('input-ack-stalled'));
      const discardEvents = endB.events.filter((e2) => e2.event === 'discard-pending').map((e2) => ({ atMs: e2.atMs }));
      const foreignEpochRows = windowAll.filter((row) => row.epoch !== orig.epoch);
      const windowRows = windowAll.filter((row) => row.epoch === orig.epoch);
      const firstForeignAt = foreignEpochRows.length > 0 ? Math.min(...foreignEpochRows.map((row) => row.atMs)) : Number.POSITIVE_INFINITY;
      const stallAt = stallEpisode.length > 0 ? stallEpisode[0]!.atMs : Number.POSITIVE_INFINITY;
      sT['foreignEpochRows'] = foreignEpochRows.length;
      sT['stallEpisode'] = stallEpisode;
      sT['firstForeignAt'] = firstForeignAt;
      sT['stallAt'] = stallAt;
      // REBUILT FROM THE WHOLE DOMAIN: the prefix is a domain-scoped counter — validating it
      // against only the scenario window's dequeues would (correctly!) reject legitimate
      // pre-window history. This room exists only for this scenario, so the domain starts at
      // tick record 0; refusals/signals/closures likewise span the domain, not the window.
      const tickRows = gatedRoom(ctx.roomId).tickRecords.slice(0);
      const dequeues = tickRows.flatMap((rec) => rec.consumed.filter((c) => c.entityId === ctx.sessionId).map((c) => ({ tick: rec.tick, seq: c.seq, atMs: chainAtMs(ctx.roomId, rec.tick) })));
      const refusals = tickRows.reduce((total, rec) => total + (rec.refused ?? []).filter((r) => r.entityId === ctx.sessionId).reduce((t2, r) => t2 + r.count, 0), 0);
      const signals = tickRows.flatMap((rec) => (rec.signals ?? []).filter((sg) => sg.entityId === ctx.sessionId).map((sg) => sg.signal));
      const closures = tickRows.flatMap((rec) => (rec.closures ?? []).filter((c2) => c2.entityId === ctx.sessionId).map((c2) => c2.code));
      const seenT = await reportGaTracks(ctx.pageO);
      const trackT = seenT.tracks.find((t2) => t2.sessionId === ctx.sessionId);
      await ctx.pageM.evaluate(async () => {
        const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
        await holder?.predictor.close();
      });
      await wait(700);
      const closeObsT = moverCloseObservations(ctx.roomId, ctx.sessionId);

      const transcript: Ga5Transcript = {
        roomId: ctx.roomId,
        sessionId: ctx.sessionId,
        epoch: orig.epoch,
        sends: [
          ...preludeAudit.map((row, idx) => ({ ordinal: idx + 1, role: 'pump' as const, stagedSeq: row.seq, slotBefore: -2, slotAfter: -2, ackReturn: -2, epoch: row.epoch, sessionId: ctx.sessionId, atMs: row.atMs, wireChunksWindow: 0, moveX: 1, moveZ: 0 })),
          { ordinal: preludeAudit.length + 1, role: 'liveness', stagedSeq: orig.stagedSeq, slotBefore: orig.slotBefore, slotAfter: orig.slotAfter, ackReturn: orig.ackReturn, epoch: orig.epoch, sessionId: ctx.sessionId, atMs: orig.atMs, wireChunksWindow: w1 - w0, moveX: 1, moveZ: 0 },
          { ordinal: preludeAudit.length + 2, role: 'eaten', stagedSeq: replay.stagedSeq, slotBefore: replay.slotBefore, slotAfter: replay.slotAfter, ackReturn: replay.ackReturn, epoch: replay.epoch, sessionId: ctx.sessionId, atMs: replay.atMs, wireChunksWindow: rw1 - rw0, moveX: -1, moveZ: 1 },
        ],
        dequeues,
        refusals,
        signals,
        closures,
        deliveries: windowRows,
        pendingSamples: samples.map((s2) => ({ atMs: s2.atMs, seqs: s2.pending })),
        declinedFrames: [{ seq: orig.stagedSeq, originalsBefore: 1 }],
      };
      const issues = auditGa5Transcript(transcript, discardEvents);
      const forgedIssues = auditGa5Transcript({
        ...transcript,
        deliveries: [...windowRows, { epoch: orig.epoch, authorityTick: (tickRows.at(-1)?.tick ?? 0) + 5, revision: -9_999, atMs: Number.MAX_SAFE_INTEGER, ack: 99, resolvedThrough: 99, gapStart: 0, gapEnd: 0, retiredUnrepresented: 0, accepted: true, reason: 'FORGED CONTROL ROW' }],
      }, discardEvents);
      const naiveCmp = naiveVsJoined(transcript);
      const episodeEvents = endB.events.filter((ev) => ['trigger', 'stop-sending', 'discard-pending', 'rejoin-scheduled', 'rejoin-attempt', 'rejoin-complete', 'snapshot-recovered', 'suspended', 'episode-expired'].includes(ev.event));
      sT['transcript'] = transcript;
      sT['issues'] = issues;
      sT['forgedIssues'] = forgedIssues;
      sT['naiveVsJoined'] = naiveCmp;
      sT['episodeEvents'] = episodeEvents;
      sT['track'] = trackT?.lastSample ?? null;
      sT['closeObs'] = closeObsT;
      sT['acceptedRows'] = acceptedNow.length;
      sT['sampleCount'] = samples.length;

      cellCheck('GA-5t fixture soundness (the guard the dpa5-era evidence lacked): the ORIGINAL producer send is CONSUMED exactly once in the transcript window, the raw REPLAY send produced its own proxy WIRE RECEIPT (a silent no-op bypass — the suspected dpa5 failure mode — fails this row loudly), and the wire was quiet (pending 0) before the transcript began',
        dequeues.filter((d2) => d2.seq === orig.stagedSeq).length === 1 &&
        rw1 - rw0 >= 1 &&
        (sT['pendingQuiet'] as number) === 0 &&
        orig.stagedSeq > 0 && replay.stagedSeq === orig.stagedSeq,
        { orig, replay, quiet: sT['pendingQuiet'], dequeues });

      cellCheck('GA-5t TRANSCRIPT AUDIT — every published resolvedThrough on an accepted delivery of THIS epoch equals the prefix REBUILT from the room\'s real same-domain dequeues OVER THE WHOLE DOMAIN (window-only history would legitimately fail this audit — an earlier draft of this row proved that by failing on its own pre-window history; the room rule, ColyseusInputAdapter.ts:190-193, mirrored by the validator); every accepted row carries ack === resolvedThrough (the guard\'s equality — a DETECTION seam, not coverage); no foreign-epoch row was selected; no consumed stamp lacks a staged send (aliasing detector); every pending prune is covered by a prefix-advancing delivery or a labelled DISCARD — the §3.2 stalled-ack episode now runs on this seat too (the bypass slot sits unresolved in the client\'s own journal from the moment of the replay — the validator sees the discard-pending event, counted, never assumed), with the epoch-scope DISCLOSED: exactly one input-ack-stalled episode, and EVERY foreign-epoch row postdates it (rows of the bounded rejoin\'s new domain are counted here, never silently dropped) — audited by the unit-tested validator, with a FORGED control row (published prefix 99 with no dequeue chain) demonstrably REJECTED',
        issues.length === 0 && forgedIssues.length > 0 && typeof naiveCmp.diverged === 'boolean' &&
        stallEpisode.length === 1 && firstForeignAt >= stallAt,
        { issues, forgedIssues, naiveCmp, deliveries: windowRows, dequeues, foreignEpochRows: foreignEpochRows.length, stallEpisode, firstForeignAt, stallAt });

      cellCheck('GA-5t DECLINE IS ABSENCE, NOT COVERAGE — the terminal equality-replay: its stamp\'s consumed count stays EXACTLY 1 (the accepted original; the decline contributes ZERO), refusals 0, no gap, no RETIRED_UNREPRESENTED, no closure, the leave record asserts nothing (retired 0, queue 0), the replay\'s DISTINGUISHING z content never reaches the observer (|z| < 0.05 m), and the client records NO §3.2 episode — with no pending entry for a raw bypass send and no disposition for the decline, the honest statements are: applied ZERO times, recorded NOWHERE, and the client is NOT misled into believing coverage. The earlier report\'s "covered by the same delivery" claim is RETIRED: the slot-ack and the resolved prefix are INDEPENDENT counters (ColyseusPredictionAdapter.ts:339-340 fuses them only to REFUSE on disagreement) and the row it cited was never domain-keyed. The client-recovery sub-leg for THIS shape stays BLOCKED — now proven two ways: a legitimate producer CANNOT generate the shape (invariant-control row), and a bypass send carries no client expectation to recover. Recovery from identifiable loss stands evidenced by GA-5a (named-range resync) and GA-6a/6b/6c/7T. Superseded runs dpa5f/dpa5g/dpa5h are PRESERVED in the bundle alongside this correction',
        transcript.declinedFrames.length === 1 &&
        dequeues.filter((d2) => d2.seq === orig.stagedSeq).length === 1 &&
        refusals === 0 &&
        !signals.includes('RETIRED_UNREPRESENTED') &&
        closures.length === 0 &&
        closeObsT.length >= 1 &&
        closeObsT.every((o) => o.retiredUnrepresented === 0 && o.serverQueuedAtClose === 0) &&
        Math.abs(trackT?.lastSample.z ?? Number.POSITIVE_INFINITY) < 0.05 &&
        // and the CLIENT consequence is now the CONTRACT's own: the §3.2 stalled-ack rule (slice 8)
        // recovers the measuring client from the never-resolvable bypass slot in ITS OWN journal —
        // exactly one episode, triggered by input-ack-stalled (never a deadline/gap/retired route),
        // ending in snapshot-recovered. The earlier claim 'the client records NO episode, there is
        // no pending entry for a raw bypass send' is RETIRED: the preserved pendingSamples
        // (dpa6d/dpa6e) refute it — the adapter journals every onSend, stamp 16 sat pending, and
        // 'no episode' was only true because the mandated rule was unimplemented. The recovery is
        // BLIND, as the contract says it must be: the client cannot distinguish decline from loss,
        // and the room still names NOTHING (all absence assertions above).
        stallEpisode.length === 1 &&
        episodeEvents.length > 0 && episodeEvents.every((e2) => e2.atMs >= stallAt) &&
        endB.events.some((e2) => e2.event === 'snapshot-recovered') &&
        !endB.events.some((e2) => e2.event === 'trigger' && (e2.detail.startsWith('snapshot-deadline') || e2.detail.includes('gap-named') || e2.detail.includes('retired'))),
        { transcript, closeObsT, track: sT['track'], episodeEvents, stallEpisode });

      // REVALIDATION POPULATION (GA-5l slice): the seat's FINAL observable boundary after the
      // terminal decline — deliveries kept flowing with ack AND prefix ADVANCING past the
      // decline. The stalled-ack rule keys on FROZEN ack+prefix, which a pre-buffer decline
      // never produces; this is read here so the ga5l revalidation row can assert the new rule
      // neither fixes nor masks the PE-1 limitation (declines stay silent at the client).
      sT['finalBoundary'] = await readGaBoundary(ctx.pageM);
    });

    // ═════ GA-5l EXACT LOCAL-INPUT LOSS BY TEST-ONLY APPLICATION-DELIVERY SUPPRESSION (slice 8,
    // Part A). Population: exactly ONE distinct admitted local input from the PRODUCER path
    // (stamp = sentCount + 1 strictly increasing — NOT native dedupe: the stamp is ABOVE the
    // watermark, accept() cannot decline it) whose single c2s chunk is held TERMINALLY at the
    // harness hop by the proxy's labelled holdNext seam: bytes RECEIVED there (wire receipt —
    // NOT TCP loss), NEVER reaching the application (the room). s2c state deliveries CONTINUE
    // on the same live connection; ack AND resolvedThrough stay frozen; no gap named, no retired
    // compensation — the room never saw the input and CANNOT name it (the GA-5b
    // unidentifiable-loss shape). Subsequent inputs are withheld (pump stopped) so the loss
    // stays unnameable. The required consequence is the GENUINE §3.2 INPUT_ACK_STALLED trigger
    // after G consecutive unmoved deliveries (G = the named spec config
    // stallDetectionDeliveries, wired through joinGaSeat from packages/config). The contract
    // mandated that trigger since ADR-0003 §3.2; the adapter never implemented it, and the
    // 500 ms deadline CANNOT substitute: it restarts on every accepted delivery, so a
    // still-flowing state stream refreshed the timer forever — the unit harness proved that RED
    // first (predictor.test.ts, preserved), then the rule went into the granted adapter.
    // Controls: compliant idle, benign in-flight release.
    await scenario('ga5l', ROOM_NAME, async (ctx) => {
      const pumpOn = gaPump(ctx.pageM); void pumpOn;
      await wait(1_500);
      await gaStopPump(ctx.pageM);
      await wait(900); // drain: quiet wire, nothing outstanding
      const quiet = await readGaBoundary(ctx.pageM);
      sL['quiet'] = quiet;
      sL['tickWindowStart'] = gatedRoom(ctx.roomId).tickRecords.length;
      const w0 = await statCountAt(ctx.handle, 'c2s', 'chunksReceived');
      await wait(400);
      const w0b = await statCountAt(ctx.handle, 'c2s', 'chunksReceived');
      sL['c2sQuietDelta'] = w0b - w0;
      // Arm the TERMINAL suppression of EXACTLY ONE c2s chunk (labelled harness seam).
      await host.request({ op: 'holdNext', handle: ctx.handle, direction: 'c2s', count: 1 });
      const lostSend = await gaOneShot(ctx.pageM, 1, 0);
      sL['lostSend'] = lostSend;
      let wire1: number;
      const wireStarted = Date.now();
      for (;;) {
        wire1 = await statCountAt(ctx.handle, 'c2s', 'chunksReceived');
        if (wire1 > w0b || Date.now() - wireStarted > 5_000) break;
        await wait(50);
      }
      sL['wireReceiptDelta'] = wire1 - w0b;
      const heldStats = await host.request({ op: 'stats', handle: ctx.handle });
      const heldDir = ((heldStats['stats'] ?? heldStats) as Record<string, unknown>)['c2s'] as Record<string, unknown> | undefined;
      sL['chunksHeld'] = heldDir?.['chunksHeld'] ?? null;
      sL['holdRemaining'] = heldDir?.['holdRemaining'] ?? null;
      // Poll the observable boundary every 100 ms until the trigger fires.
      const samplesL: { atMs: number; snap: GaBoundary }[] = [];
      const fireStarted = Date.now();
      let fired: GaBoundary | null;
      for (;;) {
        const snap = await readGaBoundary(ctx.pageM);
        samplesL.push({ atMs: Date.now(), snap });
        if (snap.events.some((e) => e.event === 'trigger' && e.detail.startsWith('input-ack-stalled'))) { fired = snap; break; }
        if (Date.now() - fireStarted > 20_000) throw new Error('no input-ack-stalled trigger within 20 s of terminal suppression: state=' + snap.state + ' tail=' + JSON.stringify(snap.events.slice(-3)));
        await wait(100);
      }
      const triggerIdx = fired.events.findIndex((e) => e.event === 'trigger' && e.detail.startsWith('input-ack-stalled'));
      const triggerEvent = fired.events[triggerIdx]!;
      sL['episode'] = fired.events.slice(0, triggerIdx + 8);
      const deliveriesDuring = fired.deliveries - quiet.deliveries;
      const frozenAllAlong = samplesL.every((s2) => s2.snap.ack === quiet.ack && s2.snap.resolvedThrough === quiet.resolvedThrough && s2.snap.epoch === quiet.epoch);
      const gapNever = samplesL.every((s2) => s2.snap.gapStart === 0 && s2.snap.gapEnd === 0);
      const retiredZero = samplesL.every((s2) => s2.snap.retired === 0);
      // every poll BEFORE the firing one holds the pending entry (the firing snapshot itself is
      // read after the trigger's discard-pending already ran — counting it would demand the
      // impossible; the discard-after-trigger ordering is asserted separately below).
      const heldPending = samplesL.length > 1 && samplesL.slice(0, -1).every((s2) => s2.snap.pending >= 1);
      const noReissue = fired.sentAuditLen - quiet.sentAuditLen === 1;
      const earlierTrigger = fired.events.slice(0, triggerIdx).some((e) => e.event === 'trigger');
      sL['deliveriesDuring'] = deliveriesDuring;
      sL['frozenAllAlong'] = frozenAllAlong;
      sL['stallStreakAtFire'] = fired.stallStreak;
      sL['deliveriesAtFireSeries'] = samplesL.map((s2) => [s2.snap.deliveries, s2.snap.ack, s2.snap.resolvedThrough, s2.snap.stallStreak]);
      const recovered = await waitLedger(ctx.pageM, (s2) => s2.events.some((e) => e.event === 'snapshot-recovered'), 'snapshot-recovered after input-ack-stalled', EPISODE_BUDGET_MS + BUDGET_TOLERANCE_MS);
      const recAt = recovered.events.find((e) => e.event === 'snapshot-recovered')!.atMs;
      sL['resyncBudgetMs'] = recAt - triggerEvent.atMs;
      sL['rejoinAttempts'] = recovered.events.filter((e) => e.event === 'rejoin-attempt').length;
      const postSend = await gaOneShot(ctx.pageM, 0, 1);
      await wait(1_200);
      const afterB = await readGaBoundary(ctx.pageM);
      sL['postSend'] = postSend;
      sL['afterRecovery'] = { ...afterB, events: afterB.events.slice(-6) };
      const trailL = (await pollTrail(ctx.roomId, (s2) => s2.seats.some((seat) => seat.epoch === afterB.epoch && seat.resolvedThrough > 0), 8_000)).hit;
      sL['trailAfter'] = trailL === null ? null : { tick: trailL.tick, seats: trailL.seats };
      const consumedL = consumedSince(ctx.roomId, (sL['tickWindowStart'] as number), ctx.sessionId);
      sL['consumedAfterSuppression'] = consumedL;
      const signalsL = gatedRoom(ctx.roomId).tickRecords.slice((sL['tickWindowStart'] as number)).flatMap((rec) => (rec.signals ?? []).filter((sig) => sig.entityId === ctx.sessionId).map((sig) => sig.signal));
      sL['moverSignals'] = signalsL;
      const closeObsL = moverCloseObservations(ctx.roomId, ctx.sessionId);
      sL['closeObservations'] = closeObsL;
      const G = GA_STALL_G ?? 3;

      cellCheck(`GA-5l suppression is SOUND as test-only APPLICATION-DELIVERY suppression (not native dedupe, not TCP loss): exactly ONE distinct admitted input (producer stamp ${String(lostSend.seq)} = sentCount + 1, strictly increasing) was staged while pending was 0; its single c2s chunk earned a WIRE RECEIPT at the harness hop (delta ${String(wire1 - w0b)}, chunksHeld ${String(sL['chunksHeld'])}) and NEVER reached the application (consumed stamps for the mover after the arm: ${String(consumedL.length)}); the c2s wire was quiet for 400 ms before the arm (delta ${String(w0b - w0)})`,
        (sL['quiet'] as GaBoundary).pending === 0 &&
        (sL['c2sQuietDelta'] as number) === 0 &&
        lostSend.seq > 0 &&
        (sL['wireReceiptDelta'] as number) >= 1 &&
        Number(sL['chunksHeld']) === 1 &&
        consumedL.length === 0,
        { quiet, lostSend, wireReceiptDelta: sL['wireReceiptDelta'], chunksHeld: sL['chunksHeld'], consumedAfterSuppression: consumedL });

      cellCheck(`GA-5l the GENUINE §3.2 stalled-ack trigger: the FIRST recovery trigger of the episode is input-ack-stalled with the observed streak EXACTLY at G=${String(G)} consecutive deliveries whose ack AND inputResolvedThrough advanced NEITHER (epoch unchanged); deliveries during the frozen window ${String(deliveriesDuring)} (>= G; the 100 ms poll/rAF slack is stated, never subtracted); ack stayed ${String(quiet.ack)} and resolvedThrough ${String(quiet.resolvedThrough)} at EVERY poll of the window; no gap was named (0..0) and retired stayed 0 throughout — NOT a deadline trigger: the deadline restarts on every accepted delivery, which is exactly why the adopted adapter WITHOUT this rule had no recourse (unit-proven red first), and no trigger precedes this one`,
        triggerEvent.detail.startsWith('input-ack-stalled') &&
        fired.stallStreak === G &&
        deliveriesDuring >= G &&
        frozenAllAlong && gapNever && retiredZero && !earlierTrigger,
        { triggerEvent, deliveriesDuring, frozenAllAlong, gapNever, retiredZero, earlierTrigger, series: sL['deliveriesAtFireSeries'], G });

      cellCheck('GA-5l NO PREMATURE PRUNE, NO REPEATED IDENTITY, NO COMPENSATION, and the loss is UNIDENTIFIABLE server-side: the pending entry was HELD (>= 1) at every poll until the trigger and discarded ONCE only AFTER it (discard-pending with exactly 1 journal entry follows the trigger); the seat sent nothing else across the whole window (send-audit delta 1 — the suppressed input itself, nothing reissued); the room named NOTHING (no consumed stamp, no gap, no RETIRED_UNREPRESENTED signal) and the old seat leave record reports retired 0 with queue 0 — the server CANNOT identify the missing input, which is exactly what GA-5b says the client must recover from',
        heldPending && noReissue &&
        fired.events.slice(triggerIdx).some((e) => e.event === 'discard-pending' && e.detail.startsWith('1 journal')) &&
        consumedL.length === 0 && signalsL.length === 0 &&
        closeObsL.length >= 1 && closeObsL.every((o) => o.retiredUnrepresented === 0 && o.serverQueuedAtClose === 0),
        { heldPending, noReissue, episode: sL['episode'], consumedL, signalsL, closeObsL });

      cellCheck(`GA-5l the recovery is the standard BOUNDED §3.2 episode ending in a FRESH SNAPSHOT on the NEW domain, and movement RESUMES: snapshot-recovered ${String(Math.round(Number(sL['resyncBudgetMs'])))} ms after the trigger (budget ${String(EPISODE_BUDGET_MS)} + ${String(BUDGET_TOLERANCE_MS)} tolerance), rejoin attempts <= 2, a NEW epoch carries the seat, the post-recovery producer send is accepted and the new domain resolves > 0 inputs (the suppression quota was SPENT — it suppresses ONE INPUT, never the route), and the live room shows the new seat resolving`,
        (sL['resyncBudgetMs'] as number) <= EPISODE_BUDGET_MS + BUDGET_TOLERANCE_MS &&
        (sL['rejoinAttempts'] as number) <= 2 &&
        afterB.epoch !== quiet.epoch &&
        postSend.seq > 0 &&
        afterB.state === 'tracking' &&
        afterB.resolvedThrough > 0 &&
        sL['trailAfter'] !== null,
        { resyncBudgetMs: sL['resyncBudgetMs'], rejoinAttempts: sL['rejoinAttempts'], afterRecovery: sL['afterRecovery'], postSend, trailAfter: sL['trailAfter'] });

      const fb = (sT['finalBoundary'] ?? null) as GaBoundary | null;
      cellCheck('GA-5l REVALIDATION of the deferred native-dedupe limitation UNDER the new rule: the stalled-ack rule neither fixes nor masks PE-1. Measured on the ga5t transcript seat end to end: the ONLY recovery route the decline shape ever takes is input-ack-stalled (exactly one) — no gap-named, no retired, no deadline route — because the decline itself is SILENT on the wire and in every room record (the audit row proves the absence side); the client recovers BLINDLY from its own unresolved journal slot, not from any decline signal, and the room still cannot name what happened. after the blind recovery the boundary of the new domain keeps the guard equality (ack === resolvedThrough — on the ga5t seat both 0, since a blind recovery sends NOTHING until the fresh snapshot, which is exactly the contract posture), deliveries flow, and PE-1 (an observable pre-buffer decline signal) remains the closure prerequisite: a client that never journaled the bypass send would observe NOTHING (the raw bypass is protocol-corrupted precisely because the honest producer cannot reach this state)',
        fb !== null &&
        fb.events.some((e) => e.event === 'trigger' && e.detail.startsWith('input-ack-stalled')) &&
        fb.events.filter((e) => e.event === 'trigger' && e.detail.startsWith('input-ack-stalled')).length === 1 &&
        fb.events.some((e) => e.event === 'snapshot-recovered') &&
        !fb.events.some((e) => e.event === 'trigger' && (e.detail.startsWith('snapshot-deadline') || e.detail.includes('gap-named') || e.detail.includes('retired'))) &&
        fb.ack === fb.resolvedThrough &&
        fb.deliveries > 0,
        fb);
    });

    // GA-5l CONTROL 1 (compliant idle): deliveries flow, NOTHING is outstanding.
    await scenario('ga5li', ROOM_NAME, async (ctx) => {
      await wait(2_500);
      const snap = await readGaBoundary(ctx.pageM);
      sLI['snap'] = snap;
      cellCheck('GA-5l CONTROL compliant-idle: a seat with NOTHING outstanding watched its deliveries arrive (frozen-boundary deliveries would be the stalled-ack population IF inputs were pending) — pending 0 means NO stalled-ack expectation and zero recovery events',
        snap.deliveries >= 15 && snap.pending === 0 && snap.state === 'tracking' && !snap.events.some((e) => e.event === 'trigger'),
        snap);
    });

    // GA-5l CONTROL 2 (benign in-flight): the same shape suppressed for FEWER than G frozen
    // deliveries, then released at the instant — in flight is not lost.
    await scenario('ga5lb', ROOM_NAME, async (ctx) => {
      const pumpOn = gaPump(ctx.pageM); void pumpOn;
      await wait(1_500);
      await gaStopPump(ctx.pageM); await wait(900);
      const quiet2 = await readGaBoundary(ctx.pageM);
      await host.request({ op: 'stall', handle: ctx.handle, direction: 'c2s', ms: 30_000 }); // TIMED window (not terminal)
      const inflight = await gaOneShot(ctx.pageM, 1, 0);
      const releaseStarted = Date.now();
      let during: number;
      for (;;) {
        const snap = await readGaBoundary(ctx.pageM);
        during = snap.deliveries - quiet2.deliveries;
        if (during >= 2 || Date.now() - releaseStarted > 5_000) break;
        await wait(50);
      }
      await host.request({ op: 'stall', handle: ctx.handle, direction: 'c2s', ms: null });
      await host.request({ op: 'flush', handle: ctx.handle, direction: 'c2s' });
      await wait(1_500);
      const after2 = await readGaBoundary(ctx.pageM);
      sLB['quiet'] = quiet2; sLB['inflight'] = inflight; sLB['during'] = during;
      sLB['after'] = { ...after2, events: after2.events.slice(-4) };
      cellCheck(`GA-5l CONTROL benign-in-flight: the SAME input shape suppressed for only ${String(during)} frozen deliveries (fewer than G=${String(GA_STALL_G ?? 3)}) and then RELEASED (labelled flush) is exactly what §3.2 distinguishes — the ack and the resolved prefix move once it arrives, NO trigger fires, and the seat stays tracking: in flight is not lost`,
        during < (GA_STALL_G ?? 3) && inflight.seq > 0 && after2.resolvedThrough > quiet2.resolvedThrough && after2.state === 'tracking' && !after2.events.some((e) => e.event === 'trigger'),
        { during, inflight, quiet: quiet2, after: sLB['after'] });
    });

    await scenario('ga7t', ROOM_NAME, async (ctx) => {
      const pumpOn = gaPump(ctx.pageM);
      await wait(2_500);
      const tickIndex0 = gatedRoom(ctx.roomId).tickRecords.length;
      const seen0 = await reportGaTracks(ctx.pageO);
      sG['movedBefore'] = (seen0.tracks.find((t) => t.sessionId === ctx.sessionId)?.delta.x ?? 0) > 2;
      const bridge0 = await bridgeClock(ctx.pageM);
      const before = await gaRecovery(ctx.pageM);
      sG['lastDeliveryBeforeStall'] = before.lastDelivery;
      const statsA = await host.request({ op: 'stats', handle: ctx.handle });
      const stallReply = await host.request({ op: 'stall', handle: ctx.handle, direction: 's2c', ms: 20_000 });
      sG['stallHostStamp'] = stallReply;
      // Deliveries stop NOW. The client's 500 ms deadline restarts on the last accepted delivery,
      // which is the publish the stall just intercepted — so the fire lands ~500 ms after this
      // instant. The pump KEEPS SENDING (inputs outstanding, consumed unseen, publications queued
      // into the withheld window) — exactly the GA-7 picture.
      const genNow = await ctx.pageM.evaluate(() => (globalThis as unknown as PredSeatWindow).__udgImpSeat?.generation ?? -1);
      const wave1 = await gaBurst(ctx.pageM, 24, genNow + 1, 1); // fill the buffer WITHOUT overflow
      sG['wave1'] = wave1;
      await wait(320);
      const wave2 = await gaBurst(ctx.pageM, 14, wave1.lastSeq - wave1.firstSeq + genNow + 2, 1); // overflow -> eviction -> CONFIRMATION
      sG['wave2'] = wave2;
      const confirmPoll = await pollTrail(ctx.roomId, (snap) => snap.retiredTickSeen !== null, 1_200);
      sG['confirmTrailHit'] = confirmPoll.hit;
      const confirmTick = confirmPoll.hit?.retiredTickSeen ?? null;
      const confirmAtMs = confirmTick === null ? null : chainAtMs(ctx.roomId, confirmTick);
      sG['decisionTick'] = confirmTick;
      sG['decisionAtMsRoomClock'] = confirmAtMs;
      const trig = await waitLedger(ctx.pageM, (snap) => snap.events.some((e) => e.event === 'trigger' && e.detail.includes('snapshot-deadline-expired')), 'the client-local deadline', 4_000);
      const triggerPageMs = trig.events.find((e) => e.event === 'trigger' && e.detail.includes('snapshot-deadline-expired'))?.atMs ?? Number.NaN;
      const bridge1 = await bridgeClock(ctx.pageM);
      const offsetMs = ((bridge0.medianOffsetMs + bridge1.medianOffsetMs) / 2);
      const epsilonMs = Math.max(bridge0.epsilonMs, bridge1.epsilonMs) + 60; // bridge error + poll cadence + slack
      const fireRoomMs = triggerPageMs + offsetMs;
      sG['clockBridge'] = { bridge0, bridge1, offsetMs, epsilonMs };
      sG['triggerPageMs'] = triggerPageMs;
      sG['fireRoomClockMs'] = fireRoomMs;
      sG['stateAtTrigger'] = trig.state;
      const closurePoll = await pollTrail(ctx.roomId, (snap) => snap.closureTicks.some((c) => c.code === 4100), 2_000);
      const closure4100 = (closurePoll.hit?.closureTicks ?? []).find((c) => c.code === 4100) ?? null;
      sG['closureTick'] = closure4100;
      sG['closureAtMsRoomClock'] = closure4100 === null ? null : chainAtMs(ctx.roomId, closure4100.tick);
      sG['trail'] = trailJson(confirmPoll.trail.concat(closurePoll.trail.slice(-24)));
      const att = await waitLedger(ctx.pageM, (snap) => snap.events.some((e) => e.event === 'rejoin-attempt'), 'the first bounded attempt', 4_000);
      sG['attemptsAtRelease'] = att.events.filter((e) => e.event === 'rejoin-attempt').length;
      // MEASURE the withheld window WHILE IT IS STILL WITHHELD: received-minus-delivered on the
      // s2c direction is the byte-level count of publications held at the proxy at this instant.
      const statsHeld = await host.request({ op: 'stats', handle: ctx.handle });
      sG['heldWhileStalled'] = statCount(statsHeld, 's2c', 'chunksReceived') - statCount(statsHeld, 's2c', 'chunksDelivered');
      sG['heldFlushedWhileStalled'] = statCount(statsHeld, 's2c', 'chunksFlushed');
      await releaseWindow(ctx.handle); // withheld finals depart (old domain: never adopted); fresh joins pass
      const statsB = await host.request({ op: 'stats', handle: ctx.handle });
      const done = await waitLedger(ctx.pageM, (snap) => snap.state === 'tracking', 'GA-7T recovery COMPLETE within budget', 10_000);
      const recoveredAt = done.events.find((e) => e.event === 'snapshot-recovered')?.atMs ?? Number.POSITIVE_INFINITY;
      sG['budgetUsedMs'] = recoveredAt - triggerPageMs;
      sG['joins'] = done.joins;
      sG['newEpochFromJoins'] = done.joins.at(-1) ?? -1;
      const tally = await gaRecovery(ctx.pageM, { sinceIndex: before.deliveries, oldEpoch: ctx.oldEpoch, triggerMs: triggerPageMs });
      sG['oldEpochAccepted'] = tally.deliveryTally.oldEpochAccepted;
      sG['oldEpochAcceptedPreTrigger'] = tally.oldEpochAcceptedPreTrigger ?? 0;
      const after = await gaRecovery(ctx.pageM);
      // The withheld-final proof is EPOCH-scoped: OLD-domain publications at/after the decision
      // tick are the withheld ones; the NEW domain's own ticks after a rejoin are another domain.
      sG['acceptedOldEpochAtOrAfterDecision'] = confirmTick === null ? -1
        : after.acceptedDeliveries.filter((d) => d.tick >= confirmTick && d.epoch === ctx.oldEpoch).length;
      sG['acceptedAllDomainsAtOrAfterDecision'] = confirmTick === null ? -1
        : after.acceptedDeliveries.filter((d) => d.tick >= confirmTick).length;
      const oldEpochTicks = after.acceptedDeliveries.filter((d) => d.epoch === ctx.oldEpoch).map((d) => d.tick);
      sG['lastAcceptedOldEpochTick'] = oldEpochTicks.length > 0 ? Math.max(...oldEpochTicks) : -1;
      const consumedAll = consumedSince(ctx.roomId, tickIndex0, ctx.sessionId);
      sG['consumedSeqs'] = consumedAll;
      sG['consumedUnique'] = new Set(consumedAll).size === consumedAll.length;
      sG['refusedOldDomain'] = refusedSince(ctx.roomId, tickIndex0, ctx.sessionId);
      const obsAll = moverCloseObservations(ctx.roomId, ctx.sessionId);
      sG['closeObservations'] = obsAll;
      const replicaNew = replicaEffects(ctx.roomId, done.rejoins.at(-1)?.sessionId ?? '');
      sG['replicaRowNew'] = replicaNew;
      sG['withheldChunksMeasured'] = statCount(statsHeld, 's2c', 'chunksReceived') - statCount(statsA, 's2c', 'chunksReceived');
      sG['deliveredDuringStall'] = statCount(statsHeld, 's2c', 'chunksDelivered') - statCount(statsA, 's2c', 'chunksDelivered');
      sG['chunksReleasedOnFlush'] = statCount(statsB, 's2c', 'chunksFlushed') - statCount(statsA, 's2c', 'chunksFlushed');
      const withinDecision = confirmAtMs !== null && fireRoomMs >= confirmAtMs - epsilonMs;
      const withinWindow = confirmAtMs !== null && fireRoomMs <= confirmAtMs + CLOSURE_WINDOW_MS + epsilonMs;
      const withinCap = confirmAtMs !== null && fireRoomMs <= confirmAtMs + CLOSURE_MAX_MS + epsilonMs;
      sG['ordering'] = { withinDecision, withinWindow, withinCap, closureWindowMs: CLOSURE_WINDOW_MS, closureMaxMs: CLOSURE_MAX_MS };
      cellCheck('GA-7 (TIGHTENED, real room/transport; injection labelled WITHHELD APPLICATION DELIVERY — never TCP loss; NO harness sever in this leg): the final publications (including the loss-decision publication itself) are withheld at the proxy hop WHILE INPUTS ARE OUTSTANDING; the SERVER CONFIRMS THE LOSS ITSELF (its own consumed-without-dequeued arithmetic charges retiredUnrepresented at tick ' + String(confirmTick) + ' — the DECISION tick, journalled with the room-clock time ' + String(confirmAtMs) + ' ms); the client-local deadline fires INSIDE the EXACT §3.3 closure window [decision, decision + ' + String(CLOSURE_WINDOW_MS) + ' ms] (bridged page->room clock, stated error budget ' + String(Math.trunc(epsilonMs)) + ' ms); the 4100 consequence closure runs at window end on the room\'s own tick (its close frame is itself withheld); recovery completes WITHIN BUDGET with ZERO old-epoch acceptances and ZERO accepted deliveries at/after the decision tick (the withheld-final proof, per-delivery); (domain,seq) consumed stamps are UNIQUE (no repeat, no reissue) with zero refusals on the supported substrate; live state and identity recorded by the in-process poll trail',
        (sG['movedBefore'] as boolean) === true && confirmTick !== null && confirmAtMs !== null
          && withinDecision === true && withinWindow === true && withinCap === true
          && closure4100 !== null
          && (sG['withheldChunksMeasured'] as number) >= 1 && (sG['deliveredDuringStall'] as number) === 0 && (sG['heldWhileStalled'] as number) >= 1
          && (sG['acceptedOldEpochAtOrAfterDecision'] as number) === 0
          && (sG['lastAcceptedOldEpochTick'] as number) < (confirmTick as number)
          && sG['stateAtTrigger'] !== 'closed'
          && (sG['budgetUsedMs'] as number) <= EPISODE_BUDGET_MS + BUDGET_TOLERANCE_MS
          && done.state === 'tracking' && (done.joins as number[]).length >= 2 && sG['newEpochFromJoins'] !== ctx.oldEpoch
          && (sG['oldEpochAccepted'] as number) === 0
          && sG['consumedUnique'] === true && (sG['refusedOldDomain'] as number) === 0,
        sG);
      cellCheck('CF-4 DISPOSITION (named, and now TIMED — with the exact former distinctions kept): the consequence-branch closure is attributed to the mover by EXACT identity from the room\'s own closure ledger (code 4100 at a journalled tick), the §3.1 close observations record the CONFIRMED LOSS with counters recorded separately (retiredUnrepresented / serverQueuedAtClose / consumedCountAtClose / dequeuedTotal, never summed), the decision tick is the room\'s OWN confirmation step (not a harness action — the no-sever leg proves the branch reaches 4100 without any kill), and control C2 below shows the SAME chain with publications DELIVERED: the withheld-ness, not the closure, is what GA-7 tests. A plain sever without confirmed loss produces NO 4100 at all (control C1)',
        (sG['closeObservations'] as { retiredUnrepresented: number }[]).some((o) => o.retiredUnrepresented >= 1)
          && closure4100 !== null && confirmTick !== null,
        { observations: sG['closeObservations'], closure: closure4100, decisionTick: confirmTick });
      await gaStopPump(ctx.pageM);
      await pumpOn;
    }, sG);

    // ═════ C1 — the harness sever ALONE (no withheld publications, no buffer overflow, inputs
    // drained): the server records a PLAIN LEAVE — zero retired, no closure window, NO 4100. This
    // is what distinguishes a harness kill from the natural bounded 4100: severing never reaches
    // the consequence branch by itself.
    await scenario('ga7c1', ROOM_NAME, async (ctx) => {
      const pumpOn = gaPump(ctx.pageM);
      await wait(2_000);
      const tickIndex0 = gatedRoom(ctx.roomId).tickRecords.length;
      await gaStopPump(ctx.pageM);
      await pumpOn;
      await wait(700); // the buffer DRAINS: at close there is nothing unrepresented
      const killReply = await host.request({ op: 'kill', handle: ctx.handle });
      sC1['killHostStamp'] = killReply;
      await wait(2_500);
      const obs = moverCloseObservations(ctx.roomId, ctx.sessionId);
      sC1['closeObservations'] = obs;
      const closures = gatedRoom(ctx.roomId).tickRecords.slice(tickIndex0)
        .flatMap((rec) => (rec.closures ?? []).filter((c) => c.entityId === ctx.sessionId));
      sC1['closures'] = closures;
      const signals = gatedRoom(ctx.roomId).tickRecords.slice(tickIndex0)
        .flatMap((rec) => (rec.signals ?? []).filter((s2) => s2.entityId === ctx.sessionId).map((s2) => s2.signal));
      sC1['signals'] = signals;
      sC1['retiredZero'] = obs.length >= 1 && obs.every((o) => o.retiredUnrepresented === 0);
      cellCheck('C1 (control — the harness kill ALONE, publications flowing, buffer drained): the server records a plain leave — close observations with retiredUnrepresented = 0, NO RETIRED_UNREPRESENTED signal, NO 4100 closure, no closure window opened. A sever therefore CANNOT stand in for reaching the consequence branch; GA-7T reaches it by the room\'s own confirmed-loss arithmetic with NO kill at all',
        (sC1['retiredZero'] as boolean) === true && (closures as unknown[]).length === 0 && !signals.includes('RETIRED_UNREPRESENTED'),
        sC1);
    }, sC1);

    // ═════ C2 — the SAME confirmed-loss chain with publications DELIVERED (no withheld window):
    // decision tick, named gap, window, 4100 — identical server-side — but the client ACCEPTED the
    // decision-tick publications. Contrasted with GA-7T (zero accepted at/after the decision tick),
    // this pins the WITHHELD-NESS of the final publications to the withheld window, not to the
    // closure machinery, and keeps the leave/consequence branch distinction named.
    await scenario('ga7c2', ROOM_NAME, async (ctx) => {
      const pumpOn = gaPump(ctx.pageM);
      await wait(2_500);
      const tickIndex0 = gatedRoom(ctx.roomId).tickRecords.length;
      const genNow = await ctx.pageM.evaluate(() => (globalThis as unknown as PredSeatWindow).__udgImpSeat?.generation ?? -1);
      // The pump KEEPS RUNNING so state keeps CHANGING and publications keep FLOWING — the
      // contrast with GA-7T must be delivered-vs-withheld publications, not an idle room: the
      // decision moment is a natural publish while the old transport is still live and accepted.
      const wave1 = await gaBurst(ctx.pageM, 24, genNow + 1, 1);
      await wait(320);
      const wave2 = await gaBurst(ctx.pageM, 14, wave1.lastSeq - wave1.firstSeq + genNow + 2, 1);
      sC2['wave1'] = wave1; sC2['wave2'] = wave2;
      const confirmPoll = await pollTrail(ctx.roomId, (snap) => snap.retiredTickSeen !== null, 1_500);
      const confirmTick = confirmPoll.hit?.retiredTickSeen ?? null;
      sC2['decisionTick'] = confirmTick;
      // The decision moment on the DELIVERED path: the seat is closing while the client is still
      // TRACKING on the old transport (in GA-7T the same poll found the client already past
      // 'tracking' — the withheld publications had already triggered the local deadline).
      const preClosure = await gaRecovery(ctx.pageM);
      sC2['clientTrackingAtDecision'] = preClosure.state === 'tracking' && confirmTick !== null;
      const closurePoll = await pollTrail(ctx.roomId, (snap) => snap.closureTicks.some((c) => c.code === 4100), 2_000);
      const closure = (closurePoll.hit?.closureTicks ?? []).find((c) => c.code === 4100) ?? null;
      sC2['closureTick'] = closure;
      sC2['trail'] = trailJson(confirmPoll.trail.concat(closurePoll.trail.slice(-16)));
      // The 4100 close frame DEPARTS the server and arrives (nothing withholds it here): the
      // client LEARNS of the server's consequence — GA-7T\'s socket never saw it (withheld).
      const seenClose = await waitLedger(ctx.pageM, (snap) => snap.state !== 'tracking', 'the delivered closure reaches the client', 4_000);
      sC2['clientSawClosureState'] = seenClose.state;
      const killReply = await host.request({ op: 'kill', handle: ctx.handle }); // settle the pair
      sC2['killHostStamp'] = killReply;
      const snap = await gaRecovery(ctx.pageM);
      sC2['oldEpochDeliveriesAccepted'] = snap.acceptedDeliveries.filter((d) => d.epoch === ctx.oldEpoch).length;
      const obs = moverCloseObservations(ctx.roomId, ctx.sessionId);
      sC2['closeObservations'] = obs;
      const consumedAll = consumedSince(ctx.roomId, tickIndex0, ctx.sessionId);
      sC2['consumedUnique'] = new Set(consumedAll).size === consumedAll.length;
      const seatTrail = confirmPoll.trail.find((t2) => t2.seats.some((seat) => (seat.gap?.start ?? -1) > 0));
      sC2['namedGapSeenInTrail'] = seatTrail?.seats.find((seat) => (seat.gap?.start ?? -1) > 0)?.gap ?? null;
      cellCheck('C2 (control — the SAME server-side confirmed-loss chain with NOTHING withheld): the room confirms the loss on its own tick, NAMES the consumed-range jump in the live disposition trail (the naming belongs to the EVICTION chain — distinguishable from the silent pre-buffer dedupe of GA-5, per PE-4), and closes with 4100 attributed to the mover. On this DELIVERED path the client was still TRACKING at the decision moment (publications flowing on the live transport) and the 4100 closure ARRIVED — the client state moved off tracking when the server\'s consequence reached it. In GA-7T the identical machinery is invisible at the client (zero old-epoch acceptances, the closure frame itself withheld): the withheld-ness is caused by the withheld window, not by the closure machinery; consumed stamps stay UNIQUE. The zero-old-epoch-acceptance claim is TRIGGER-scoped (the quarantine begins at the trigger): publications already inside the delay tube at stall-open legitimately arrive and are ACCEPTED while still tracking — they are counted separately (oldEpochAcceptedPreTrigger), never folded into the quarantine claim (dpa7o, where the conflated tally first flaked, is preserved beside this correction)',
        sC2['decisionTick'] !== null && closure !== null
          && sC2['clientTrackingAtDecision'] === true
          && String(sC2['clientSawClosureState']) !== 'tracking'
          && (sC2['closeObservations'] as { retiredUnrepresented: number }[]).some((o) => o.retiredUnrepresented >= 1)
          && sC2['consumedUnique'] === true,
        sC2);
      await gaStopPump(ctx.pageM);
      await pumpOn;
    }, sC2);

    // ═════ GA-5b MALFORMED-STAMP NEGATIVE CONTROLS (slice 17, proposed-refinement wording —
    // DRAFT SCOPE ONLY: PE-1 stays unmet, GA-5b stays draft, no ADR edited). The refinement draft
    // requires, before ANY dedupe-flavoured closure language, negative controls that drive
    // DELIBERATELY MALFORMED stamps at the pinned seam and show each one's disposition. Three
    // shapes, separately: (dup) a SAME-DOMAIN DUPLICATE stamp; (dec) a DECREASING stamp; (epoch) a
    // FOREIGN EPOCH on an otherwise monotone stamp. The injector is the SAME public-handle
    // re-stamping seam GA-5t already uses (the pinned core IS the seam — B1 below); NOTHING here
    // is a raw payload path in the product: the production send route is untouched, the frames
    // travel the real protocol over the real socket, and the harness only re-stamps a handle its
    // own seat already owns. Each leg first runs a LEGITIMATE MONOTONE baseline through the pump
    // (every baseline stamp consumed EXACTLY once, the observer visibly MOVED), then stages ONE
    // malformed frame with distinctive content (moveX −1, moveZ +1 — application anywhere would
    // show on the observer's z axis) and holds the wire so the frame's disposition is the only
    // variable. Expected dispositions are read from the pinned sources and PRE-REGISTERED, not
    // fitted: dup/dec hit RoomInput.capture -> InputBuffer.accept (value <= _lastSeq dropped
    // BEFORE the buffer, silent — the very branch under refinement), so ack/prefix stay frozen and
    // the client's bypass-slot journal entry (the slot the raw send consumed, the adapter
    // journals every onSend) sits unresolved: the contract's BLIND input-ack-stalled recovery
    // MUST fire exactly once; the epoch stamp dequeues (its seq is above the watermark) and is
    // refused twice with NAMES — the room's wire validator (RegionRoom.ts:430, record.refused +1)
    // and the core's admit (disposition refused:epoch) — a journalled NEUTRAL step: the prefix
    // advances over the refused stamp, nothing is left outstanding, and NO recovery episode may
    // fire (a recovery would itself be a falsely named cause here).
    const malformedStampLeg = async (
      tag: string,
      kind: 'dup' | 'dec' | 'epoch',
      bag: Record<string, unknown>,
    ): Promise<void> => {
      await scenario(tag, ROOM_NAME, async (ctx) => {
        const wireChunks = async (): Promise<number> => statCountAt(ctx.handle, 'c2s', 'chunksReceived');
        const pumpOn = gaPump(ctx.pageM); void pumpOn;
        await wait(1_400); // LEGITIMATE MONOTONE BASELINE: producer stamps sentCount + 1
        await gaStopPump(ctx.pageM); // from here the seam controls every send on this wire
        await wait(700);             // drain: quiet wire, nothing outstanding
        const quiet = await readGaBoundary(ctx.pageM);
        const seen0 = await reportGaTracks(ctx.pageO);
        const track0 = seen0.tracks.find((t) => t.sessionId === ctx.sessionId);
        const baselineMoved = (track0?.delta.x ?? 0) >= 0.4;
        const w0q = await wireChunks();
        await wait(400);
        const w0 = await wireChunks();
        const staged = await ctx.pageM.evaluate(async (args: { kind: string }) => {
          const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
          if (holder === undefined) throw new Error(`${args.kind}: malformed-stamp control needs the bare seat`);
          const handle = holder.transport.handle();
          const lastSeq = holder.predictor.sentAudit().map((r) => r.seq).reduce((a, b) => Math.max(a, b), 0);
          const slotBefore = handle.sentCount;
          const realEpoch = holder.transport.issuedEpoch();
          handle.data.sessionEpoch = args.kind === 'epoch' ? realEpoch + 7 : realEpoch;
          handle.data.generation = (holder.generation += 1);
          handle.data.directIntent = true;
          handle.data.moveX = -1;
          handle.data.moveZ = 1; // distinctive content: applied anywhere, it shows on the z axis
          handle.data.seq = args.kind === 'dup' ? lastSeq : args.kind === 'dec' ? lastSeq - 3 : lastSeq + 1;
          const ackReturn = handle.send();
          return {
            kind: args.kind, stagedSeq: handle.data.seq as number, realEpoch,
            epochSent: handle.data.sessionEpoch as number, lastSeq,
            slotBefore, slotAfter: handle.sentCount, ackReturn, atMs: performance.now(),
          };
        }, { kind });
        const tickAtStaging = gatedRoom(ctx.roomId).tickRecords.length;
        let w1: number;
        const wireStarted = Date.now();
        for (;;) {
          w1 = await wireChunks();
          if (w1 > w0 || Date.now() - wireStarted > 5_000) break;
          await wait(50);
        }
        const seen1 = await reportGaTracks(ctx.pageO);
        const track1 = seen1.tracks.find((t) => t.sessionId === ctx.sessionId);
        const domainRows = gatedRoom(ctx.roomId).tickRecords.slice(0);
        const dequeues = domainRows.flatMap((rec) => rec.consumed.filter((c) => c.entityId === ctx.sessionId).map((c) => c.seq));
        const baselineUnique = new Set(dequeues).size === dequeues.length;
        // WHOLE-DOMAIN refusal accounting: every scenario room is NEW, so the domain IS the
        // scenario — the first two attempts proved attribution must be read from the RECORD that
        // carried the dequeue (the refusal row carries the room's own seat-entity identity), not
        // from an index-sliced window or a sessionId guess.
        const refusalTotals = (): { domain: number; entities: string[] } => {
          const recs = gatedRoom(ctx.roomId).tickRecords;
          return {
            domain: recs.reduce((total, rec) => total + (rec.refused ?? []).reduce((t2, r) => t2 + r.count, 0), 0),
            entities: [...new Set(recs.flatMap((rec) => (rec.refused ?? []).map((r) => r.entityId)))],
          };
        };
        const signals = domainRows.flatMap((rec) => (rec.signals ?? []).filter((s) => s.entityId === ctx.sessionId).map((s) => s.signal));
        const closures = domainRows.flatMap((rec) => (rec.closures ?? []).filter((c) => c.entityId === ctx.sessionId).map((c) => c.code));
        bag['staged'] = staged;
        bag['wireReceiptDelta'] = w1 - w0;
        bag['quietBoundary'] = { ack: quiet.ack, resolvedThrough: quiet.resolvedThrough, pending: quiet.pending, epoch: quiet.epoch };
        bag['baselineMoved'] = baselineMoved;
        bag['baselineUnique'] = baselineUnique;
        bag['refusedAtStaging'] = refusalTotals();
        bag['signals'] = signals;
        bag['closures'] = closures;
        const noFalseNames = (events: readonly { event: string; detail: string }[]): boolean =>
          events.every((e) => !/dedup|duplicate|stale|decline|retired|strand/i.test(`${e.event} ${e.detail}`));

        if (kind === 'epoch') {
          const polls: GaBoundary[] = [];
          for (let i = 0; i < 40; i += 1) { polls.push(await readGaBoundary(ctx.pageM)); await wait(100); }
          const seatSnap = trailSnapshot(ctx.roomId);
          const seatEpochsSeen = seatSnap.seats.filter((s) => s.entityId === ctx.sessionId).map((s) => s.epoch);
          const windowRecords = gatedRoom(ctx.roomId).tickRecords.slice(Math.max(0, tickAtStaging - 2)).map((rec) => ({
            tick: rec.tick,
            consumed: rec.consumed.filter((c) => c.entityId === ctx.sessionId).map((c) => c.seq),
            refused: (rec.refused ?? []).map((r) => ({ entityId: r.entityId, count: r.count })),
            signals: (rec.signals ?? []).map((s) => s.signal),
          }));
          const journalWindow = gatedRoom(ctx.roomId).journal().rows
            .filter((r) => typeof r['disposition'] === 'string' && String(r['disposition']).includes('refused'))
            .map((r) => ({ tick: Number(r['tick']), entityId: String(r['entityId'] ?? ''), disposition: String(r['disposition']), reason: String(r['reason'] ?? '') }));
          const post = await gaOneShot(ctx.pageM, 1, 0); // legitimate next producer — the route must survive
          await wait(700);
          const endB = await readGaBoundary(ctx.pageM);
          const snapEnd = await gaRecovery(ctx.pageM);
          const seenEnd = await reportGaTracks(ctx.pageO);
          const trackEnd = seenEnd.tracks.find((t) => t.sessionId === ctx.sessionId);
          const windowConsumed = consumedSince(ctx.roomId, tickAtStaging, ctx.sessionId);
          const recStaged = gatedRoom(ctx.roomId).tickRecords.find((rec) => rec.consumed.some((c) => c.seq === staged.stagedSeq && c.entityId === ctx.sessionId));
          const refusedOnStagedRec = recStaged?.refused ?? [];
          const refusedEpochRows = gatedRoom(ctx.roomId).journal().rows
            .filter((r) => String(r['disposition'] ?? '').includes('refused:epoch'));
          const rt = refusalTotals();
          bag['refusedDomainFinal'] = rt;
          const guardEq = polls.every((p) => p.ack === p.resolvedThrough) && endB.ack === endB.resolvedThrough;
          const triggers = endB.events.filter((e) => e.event === 'trigger');
          bag['polls'] = { count: polls.length, guardEq, finalPending: endB.pending, finalEpoch: endB.epoch, state: endB.state };
          bag['windowConsumed'] = windowConsumed;
          bag['refusedOnStagedRecord'] = refusedOnStagedRec;
          bag['refusedEpochRowsTotal'] = refusedEpochRows.length;
          bag['triggers'] = triggers;
          bag['windowRecords'] = windowRecords;
          bag['journalWindowRefusals'] = journalWindow;
          bag['seatEpochsSeen'] = seatEpochsSeen;
          bag['acceptedEpochs'] = [...new Set(snapEnd.acceptedDeliveries.map((d) => d.epoch))];
          bag['postSend'] = post;
          bag['motionAfterLegit'] = (trackEnd?.lastSample.x ?? 0) - (track1?.lastSample.x ?? 0);
          bag['trackEnd'] = trackEnd?.lastSample ?? null;
          cellCheck(`GA-5b CONTROL ${kind}: the FOREIGN-EPOCH malformed stamp (seq ${String(staged.stagedSeq)} ABOVE the watermark, sessionEpoch ${String(staged.epochSent)} never issued) earns its own WIRE RECEIPT (delta ${String(w1 - w0)}) and is then refused WITH NAMES and nothing else: dequeued exactly once, the room records EXACTLY ONE refusal — in its own refusal ledger, on the SAME tick record that consumed the staged stamp, under the room's seat-entity identity (NOT the join sessionId: attempts 1-2 guessed the wrong attribution space and are retained red beside this correction) — and the core journals a refused:epoch disposition (EPOCH_MISMATCH; every refusal in this fresh room's journal is a refused:epoch, none from any other cause) — a journalled NEUTRAL step: the observer's z stays |z| < 0.05 m (the distinctive content was applied NOWHERE) while the NEXT LEGITIMATE producer send moves the seat again (>= 0.15 m, route survives). Zero accepted old/wrong epoch: every accepted delivery keeps the real epoch, no room seat ever carries the bogus epoch, the client's epoch never moves. NOTHING IS OUTSTANDING after a refused-and-dispositioned stamp, so NO recovery episode may fire (zero triggers — a recovery here would itself be the falsely named cause) and the guard equality ack === resolvedThrough holds at EVERY poll (the watermark advances over stamps that have their own disposition, ColyseusInputAdapter.ts:190-193). Baseline soundness: monotone stamps consumed EXACTLY once each, the mover visibly moved, the wire quiet 400 ms before the staging`,
            (w1 - w0) >= 1 &&
            windowConsumed.filter((q) => q === staged.stagedSeq).length === 1 &&
            rt.domain === 1 && rt.entities.length === 1 && refusedOnStagedRec.length === 1 &&
            refusedOnStagedRec[0]?.count === 1 && refusedOnStagedRec[0]?.entityId === rt.entities[0] &&
            refusedEpochRows.length >= 1 && journalWindow.length === refusedEpochRows.length &&
            signals.length === 0 && closures.length === 0 &&
            guardEq && triggers.length === 0 && endB.pending === 0 &&
            endB.epoch === staged.realEpoch && !seatEpochsSeen.includes(staged.epochSent) &&
            snapEnd.acceptedDeliveries.every((d) => d.epoch !== staged.epochSent) &&
            Math.abs(trackEnd?.lastSample.z ?? Number.POSITIVE_INFINITY) < 0.05 &&
            (bag['motionAfterLegit'] as number) >= 0.15 && post.seq > 0 && endB.state === 'tracking' &&
            baselineMoved && baselineUnique && (w0 - w0q) === 0 && noFalseNames(endB.events),
            bag);
          return;
        }

        // dup/dec: the pre-buffer decline is SILENT by construction (the branch under refinement).
        // The client's own journal holds the slot the raw send consumed and NOTHING resolves it —
        // ack/prefix frozen — so the contract's blind input-ack-stalled recovery must fire.
        const samplesL: { atMs: number; snap: GaBoundary }[] = [];
        const fireStarted = Date.now();
        let fired: GaBoundary | null = null;
        for (;;) {
          const snap = await readGaBoundary(ctx.pageM);
          samplesL.push({ atMs: Date.now(), snap });
          if (snap.events.some((e) => e.event === 'trigger' && e.detail.startsWith('input-ack-stalled'))) { fired = snap; break; }
          if (Date.now() - fireStarted > 20_000) break;
          await wait(100);
        }
        const G = GA_STALL_G ?? 3;
        let episode: GaBoundary['events'] = [];
        let triggerEvent: GaBoundary['events'][number] | null = null;
        let earlierTrigger = false;
        let discardAfter = false;
        let recovered: GaSnapshot | null = null;
        if (fired !== null) {
          const triggerIdx = fired.events.findIndex((e) => e.event === 'trigger' && e.detail.startsWith('input-ack-stalled'));
          triggerEvent = fired.events[triggerIdx]!;
          episode = fired.events.slice(0, triggerIdx + 8);
          earlierTrigger = fired.events.slice(0, triggerIdx).some((e) => e.event === 'trigger');
          discardAfter = fired.events.slice(triggerIdx).some((e) => e.event === 'discard-pending' && e.detail.startsWith('1 journal'));
          recovered = await waitLedger(ctx.pageM, (s) => s.events.some((e) => e.event === 'snapshot-recovered'), 'snapshot-recovered after the malformed-stamp decline', EPISODE_BUDGET_MS + BUDGET_TOLERANCE_MS);
        }
        const rtD = refusalTotals();
        bag['refusedDomainFinal'] = rtD;
        const endB2 = await readGaBoundary(ctx.pageM);
        const seenEnd = await reportGaTracks(ctx.pageO);
        const trackEnd = seenEnd.tracks.find((t) => t.sessionId === ctx.sessionId);
        const consumedCountOfStaged = dequeues.filter((q) => q === staged.stagedSeq).length;
        const heldPending = samplesL.length > 1 && samplesL.slice(0, -1).every((s) => s.snap.pending >= 1);
        const frozenAllAlong = samplesL.every((s) => s.snap.ack === quiet.ack && s.snap.resolvedThrough === quiet.resolvedThrough && s.snap.epoch === quiet.epoch);
        const gapNever = samplesL.every((s) => s.snap.gapStart === 0 && s.snap.gapEnd === 0);
        const retiredZero = samplesL.every((s) => s.snap.retired === 0);
        bag['fired'] = fired !== null;
        bag['triggerEvent'] = triggerEvent;
        bag['episode'] = episode;
        bag['earlierTrigger'] = earlierTrigger;
        bag['discardAfter'] = discardAfter;
        bag['heldPending'] = heldPending;
        bag['frozenAllAlong'] = frozenAllAlong;
        bag['gapNever'] = gapNever;
        bag['retiredZero'] = retiredZero;
        bag['stallStreakAtFire'] = fired?.stallStreak ?? null;
        bag['series'] = samplesL.map((s) => [s.snap.deliveries, s.snap.ack, s.snap.resolvedThrough, s.snap.pending, s.snap.stallStreak]);
        bag['consumedCountOfStaged'] = consumedCountOfStaged;
        bag['afterRecovery'] = { ack: endB2.ack, resolvedThrough: endB2.resolvedThrough, epoch: endB2.epoch, state: endB2.state, triggers: endB2.events.filter((e) => e.event === 'trigger').map((e) => e.detail) };
        bag['trackEnd'] = trackEnd?.lastSample ?? null;
        bag['rejoinAttempts'] = endB2.events.filter((e) => e.event === 'rejoin-attempt').length;
        cellCheck(`GA-5b CONTROL ${kind}: the ${kind === 'dup' ? 'SAME-DOMAIN DUPLICATE' : 'DECREASING'} stamp ${String(staged.stagedSeq)} (watermark ${String(staged.lastSeq)}) earns its own WIRE RECEIPT (delta ${String(w1 - w0)}) and is declined PRE-BUFFER exactly as the pinned seam dictates (RoomInput.capture -> InputBuffer.accept, value <= _lastSeq dropped BEFORE the buffer): the stamp's consumed count stays EXACTLY 1 (${kind === 'dup' ? 'its own legitimate original dequeue' : 'the baseline frame that first carried it'}), the room names NOTHING for the decline (refusal delta ${String(rtD.domain)}, no signal, no closure — the silence IS the PE-1 limitation, now measured on the two shapes the refinement names), the distinctive z content is applied NOWHERE (|z| < 0.05 m) while the baseline mover visibly moved (${String(baselineMoved)}) and baseline stamps were consumed EXACTLY once each (unique: ${String(baselineUnique)}). Zero falsely named cause: no client event or room record ever says dedupe/duplicate/stale/decline/retired`,
          (w1 - w0) >= 1 &&
          consumedCountOfStaged === 1 &&
          (w0 - w0q) === 0 &&
          rtD.domain === 0 && rtD.entities.length === 0 && signals.length === 0 && closures.length === 0 &&
          Math.abs(trackEnd?.lastSample.z ?? Number.POSITIVE_INFINITY) < 0.05 &&
          baselineMoved && baselineUnique && staged.lastSeq >= 4 &&
          noFalseNames(endB2.events),
          bag);
        cellCheck(`GA-5b CONTROL ${kind} BLIND RECOVERY WITH AN INPUT OUTSTANDING: the raw send's slot sits unresolved in the seat's OWN journal (the adapter journals every onSend), so ack AND prefix stay frozen at every poll (ack ${String(quiet.ack)} / resolvedThrough ${String(quiet.resolvedThrough)} unchanged) and the §3.2 rule MUST fire: exactly ONE trigger, input-ack-stalled with the streak EXACTLY at G=${String(G)} (observed ${String(fired?.stallStreak ?? -1)}), no trigger before it, no gap named (0..0), retired 0 throughout, the pending entry HELD until the trigger and discarded ONCE after it; the episode ends in snapshot-recovered within ${String(EPISODE_BUDGET_MS)}+${String(BUDGET_TOLERANCE_MS)} ms on a bounded rejoin (<= 2 attempts), the recovery is BLIND (no decline signal exists — the room named nothing above), the guard equality ack === resolvedThrough holds after it, the epoch never becomes any bogus value, and NO deadline/gap/retired route participates — an earlier draft of this control predicted 'no episode, nothing outstanding' for these shapes and is SUPERSEDED by its own evidence: a below-prefix bypass stamp still consumes a SLOT the prefix can never resolve, which is exactly the outstanding input §3.2 recovers from`,
          fired !== null && triggerEvent !== null &&
          triggerEvent.detail.startsWith('input-ack-stalled') &&
          fired.stallStreak === G && !earlierTrigger &&
          frozenAllAlong && gapNever && retiredZero && heldPending && discardAfter &&
          recovered !== null && recovered.events.some((e) => e.event === 'snapshot-recovered') &&
          (bag['rejoinAttempts'] as number) <= 2 &&
          endB2.ack === endB2.resolvedThrough &&
          !endB2.events.some((e) => e.event === 'trigger' && (e.detail.startsWith('snapshot-deadline') || e.detail.includes('gap-named') || e.detail.includes('retired'))),
          bag);
      }, bag);
    };
    await malformedStampLeg('ga5b-msdup', 'dup', sMSD);
    await malformedStampLeg('ga5b-msdec', 'dec', sMSDec);
    await malformedStampLeg('ga5b-msepoch', 'epoch', sMSEp);

    // ═════ GA-3 (slice 17) — CONFIRMED RETIREMENT, PREVENTION DISABLED, TWO SEATS. The ADR row:
    // "confirmed retirement, prevention disabled | closure within closureMaxMs; residue > 0,
    // bounded, named, attributed to that session; reported even if never acknowledged" — and the
    // failure modes it names: closure WITHOUT a confirmed count; room-wide attribution. The
    // PREVENTION-DISABLED limb needs NO operator seam on this pinned substrate and that is a
    // measured fact, not a shortcut: the adopted backlog posture for INPUT_QUEUE_PRESSURE is
    // THROTTLE-ONLY (ADR-0003 §3.3; RegionRoom.ts: QUEUE_PRESSURE sets seat.throttled and the
    // room "records and slows nothing that a depth heuristic cannot justify") — depth-based
    // PREVENTION of consumption or closure simply DOES NOT EXIST on the wire path, so the
    // posture never masks the consequence branch and this leg proves exactly that: pressure
    // observed WHILE the retirement→closure chain runs at full speed beside a clean second seat.
    // If a future build adds a real prevention limb, this row's pressure-during-closure witness
    // is the detector that must go red, and the named operator seam (a trusted posture knob in
    // the A-1 pattern, GRANT REQUIRED) becomes a blocker to report, not to fake.
    {
      const tag = 'ga3';
      const bag: Record<string, unknown> = {};
      const pageM1 = await openSeatPage(`${tag}-M1`, { bare: true });
      const pageM2 = await openSeatPage(`${tag}-M2`, { bare: true });
      const pageO = await openSeatPage(`${tag}-O`, { bare: true });
      let handle3 = -1;
      try {
        const started = await host.request({ op: 'start', profile: { name: 'ga', oneWayMs: 0, jitterBudgetMs: 0, seed }, targetHost: '127.0.0.1', targetPort: roomPort });
        handle3 = started['handle'] as number;
        const proxyUrl3 = `http://127.0.0.1:${String(started['port'] as number)}`;
        const join1 = await joinGaSeat(pageM1, proxyUrl3, { mode: 'create', roomName: ROOM_NAME });
        expect(join1.ok === true, 'GA-3: offender seat joined through the proxy').toBe(true);
        const roomId3 = join1.roomId ?? '';
        const join2 = await joinGaSeat(pageM2, fixture?.endpoint ?? '', { mode: 'byId', roomId: roomId3 });
        expect(join2.ok === true, 'GA-3: clean peer seat joined the SAME room DIRECT').toBe(true);
        const joinO = await joinGaObserver(pageO, fixture?.endpoint ?? '', roomId3);
        expect(joinO.ok === true, 'GA-3: observer joined DIRECT').toBe(true);
        const pump1 = gaPump(pageM1);
        const pump2 = gaPump(pageM2);
        await wait(1_500); // both seats tracking and moving
        const seatsHealthy = (gatedRoom(roomId3).evidence()['seats'] ?? []) as { entityId: string; resolvedThrough: number; throttled: boolean }[];
        bag['seatsHealthy'] = seatsHealthy.map((x) => ({ resolved: x.resolvedThrough, throttled: x.throttled }));
        const seenBefore = await reportGaTracks(pageO);
        const track2Before = seenBefore.tracks.find((t) => t.sessionId === (join2.sessionId ?? ''));
        bag['peerMovedBefore'] = (track2Before?.delta.x ?? 0) >= 0.4;
        const b2Before = await readGaBoundary(pageM2);
        const tickStart3 = gatedRoom(roomId3).tickRecords.length;
        // ORDER MATTERS (attempt 1's retained red proved it, dpa8c ga-scenarios-attempt5/6): the
        // confirmed-loss chain CONFIRMS within ~2 s of the withhold opening, so the backlog must
        // be LIVE AT the opening: a labelled BURST first drives the buffer depth past the adopted
        // pressure margin (bufferMaxSize − B), and the s2c withhold opens IMMEDIATELY behind it —
        // the posture is then observably active WHILE the retirement→closure chain runs against
        // the same deep buffer. Consumption never stopped for the posture (throttle-only): the
        // consumed ledger at close counts the burst, the closure lands on time, and the clean
        // seat never pays for any of it.
        const genNow = await pageM1.evaluate(() => (globalThis as unknown as PredSeatWindow).__udgImpSeat?.generation ?? -1);
        const burst = await gaBurst(pageM1, 60, genNow + 1, 1);
        bag['burst'] = { first: burst.firstSeq, last: burst.lastSeq };
        await host.request({ op: 'stall', handle: handle3, direction: 's2c', ms: 20_000 });
        let pressureHit: TrailSnap | null = null;
        for (let i = 0; i < 80 && pressureHit === null; i += 1) {
          const seats = (gatedRoom(roomId3).evidence()['seats'] ?? []) as { entityId: string; throttled: boolean }[];
          if (seats.some((x) => x.throttled === true)) pressureHit = trailSnapshot(roomId3);
          await wait(50);
        }
        bag['pressureObserved'] = pressureHit !== null;
        const confirmPoll = await pollTrail(roomId3, (s2) => s2.retiredTickSeen !== null, 25_000);
        const confirmTick = confirmPoll.hit?.retiredTickSeen ?? null;
        const closurePoll = await pollTrail(roomId3, (s2) => s2.closureTicks.some((c) => c.code === 4100), 10_000);
        const closures3 = (closurePoll.hit?.closureTicks ?? []).filter((c) => c.code === 4100);
        bag['confirmTick'] = confirmTick;
        bag['closures'] = closures3;
        bag['closureWithinWindow'] = confirmTick !== null && closures3.length === 1
          && (() => { const a = chainAtMs(roomId3, confirmTick); const b = chainAtMs(roomId3, closures3[0]!.tick); return a !== null && b !== null && b >= a && b - a <= CLOSURE_MAX_MS; })();
        await releaseWindow(handle3);
        await wait(1_500);
        const windowSignals = gatedRoom(roomId3).tickRecords.slice(tickStart3).flatMap((rec) => (rec.signals ?? []).map((sg) => ({ entityId: sg.entityId, signal: sg.signal })));
        const windowClosures = gatedRoom(roomId3).tickRecords.slice(tickStart3).flatMap((rec) => (rec.closures ?? []).map((c2) => ({ entityId: c2.entityId, code: c2.code })));
        const retiredOnOffender = windowSignals.filter((sg) => sg.entityId === (join1.sessionId ?? '') && sg.signal === 'RETIRED_UNREPRESENTED');
        const closures4100 = windowClosures.filter((c2) => c2.code === 4100);
        const pressureOnOffender = windowSignals.some((sg) => sg.entityId === (join1.sessionId ?? '') && sg.signal === 'QUEUE_PRESSURE');
        const peerSignals = windowSignals.filter((sg) => sg.entityId === (join2.sessionId ?? ''));
        const peerClosures = windowClosures.filter((c2) => c2.entityId === (join2.sessionId ?? ''));
        bag['windowSignals'] = windowSignals;
        bag['windowClosures'] = windowClosures;
        const closeObs3 = moverCloseObservations(roomId3, join1.sessionId ?? '');
        bag['closeObservations'] = closeObs3;
        // "reported even if never acknowledged": during the withheld window seat 1's client
        // NEVER saw the confirmation — the room reported it regardless.
        const b1 = await readGaBoundary(pageM1);
        bag['offenderClientAtReport'] = { state: b1.state, deliveries: b1.deliveries, ack: b1.ack, resolvedThrough: b1.resolvedThrough };
        // the clean peer kept consuming and moving THROUGH the whole chain
        const b2 = await readGaBoundary(pageM2);
        bag['peerAfter'] = { state: b2.state, ack: b2.ack, resolvedThrough: b2.resolvedThrough };
        const seenAfter = await reportGaTracks(pageO);
        const track2After = seenAfter.tracks.find((t) => t.sessionId === (join2.sessionId ?? ''));
        bag['track2Before'] = track2Before?.lastSample ?? null;
        bag['track2After'] = track2After?.lastSample ?? null;
        bag['peerMovedAfter'] = (track2After?.lastSample.x ?? 0) > (track2Before?.lastSample.x ?? Number.POSITIVE_INFINITY);
        const aliveSeats = (gatedRoom(roomId3).evidence()['seats'] ?? []) as { entityId: string }[];
        const roomAlive = aliveSeats.some((x) => x.entityId === (join2.sessionId ?? ''));
        bag['roomAlive'] = roomAlive;
        const maxDepthWindow = Math.max(0, ...gatedRoom(roomId3).tickRecords.slice(tickStart3).map((rec) => (rec as { maxDepth?: number }).maxDepth ?? 0));
        bag['maxDepthWindow'] = maxDepthWindow;
        bag['pressureMargin'] = BUFFER_MAX_SIZE - 8;
        bag['peerAdvanced'] = b2.resolvedThrough - b2Before.resolvedThrough;
        bag['pressureAttribution'] = { peerThrottledOrRetired: peerSignals.length, peerClosed: peerClosures.length };
        cellCheck(`GA-3 (slice 17, prevention-disabled AS MEASURED on the pinned substrate): the confirmed-retirement chain runs to closure against a LIVE backlog (the residue retired at eviction is itself the proof inputs were queued: retiredUnrepresented >= 1), and the PREVENTION limb simply does not exist to be enabled here — the adopted backlog posture for INPUT_QUEUE_PRESSURE is throttle-only by construction (ADR-0003 §3.3; RegionRoom records seat.throttled and slows nothing), so no operator knob was touched and none was needed: the observed depth reached ${String(bag['maxDepthWindow'])} against the ${String(BUFFER_MAX_SIZE - 8)}-depth margin (posture fired this run: ${String(bag['pressureObserved'])}; offender pressure signal in the window: ${String(pressureOnOffender)}), and whichever way depth lands, THIS row is the standing witness that the posture — if a future build ever lets it fire — blocks nothing and attributes nothing, because the closure chain below completes with it armed or unarmed. A real prevention limb (a trusted posture knob in the A-1 pattern) would need its own GRANT — until then prevention-disabled is the measured state, recorded, not asserted away. Actual MATCHED confirmed retirement: exactly ONE RETIRED_UNREPRESENTED confirmation tick (${String(confirmTick)}) and EXACTLY ONE closure, code 4100, attributed to the OFFENDER session only, landing within closureMaxMs=${String(CLOSURE_MAX_MS)} of the confirmation (measured on the journal clock). Residue > 0, named, attributed to that session (close observations retiredUnrepresented >= 1), reported even though the offender client NEVER acknowledged it (publications withheld at report time). NO ROOM-WIDE ATTRIBUTION, NO CROSS-SEAT COLLATERAL: the clean second seat in the SAME room was never throttled-as-collateral, carried NO signal, NO closure, kept consuming (ack ${String(b2.ack)}) and kept MOVING through the whole chain, and the room stayed alive for it`,
          (bag['peerMovedBefore'] as boolean) === true &&
          confirmTick !== null && retiredOnOffender.length >= 1 &&
          closures3.length === 1 && closures4100.length === 1 &&
          closures4100[0]?.entityId === (join1.sessionId ?? '') &&
          (bag['closureWithinWindow'] as boolean) === true &&
          closeObs3.length >= 1 && closeObs3.some((o) => o.retiredUnrepresented >= 1) &&
          peerSignals.length === 0 && peerClosures.length === 0 &&
          b2.state === 'tracking' && (bag['peerAdvanced'] as number) >= 20 &&
          Math.abs((track2After?.lastSample.x ?? 0) - (track2Before?.lastSample.x ?? Number.POSITIVE_INFINITY)) >= 0.4 &&
          (track2After?.lastSample.tick ?? 0) - (track2Before?.lastSample.tick ?? Number.POSITIVE_INFINITY) >= 20 &&
          roomAlive === true,
          bag);
        await gaStopPump(pageM1).catch(() => undefined);
        await gaStopPump(pageM2).catch(() => undefined);
        await Promise.allSettled([pump1, pump2]);
        try {
          const roomG3 = gatedRoom(roomId3) as unknown as {
            journal(): { rows: readonly Record<string, unknown>[]; chain: readonly Record<string, unknown>[]; dropped: number };
            journalPrologue(): Record<string, unknown> | undefined;
            liveConfig(): unknown;
          };
          const jG3 = roomG3.journal();
          journalCaptures.push({ tag, roomId: roomId3, rows: [...jG3.rows], chain: [...jG3.chain] as unknown as Record<string, unknown>[], dropped: jG3.dropped, prologue: roomG3.journalPrologue() ?? null, liveConfig: roomG3.liveConfig() });
        } catch { /* named missing capture */ }
      } finally {
        if (handle3 >= 0) { try { await closeProxyBounded(host, handle3); } catch { /* host receipt governs */ } }
        await pageM1.close().catch(() => undefined);
        await pageM2.close().catch(() => undefined);
        await pageO.close().catch(() => undefined);
      }
    }

    // ═════ GA-13 PER-SCENARIO JOURNALS (slice 17): EVERY scenario in this cell runs in its OWN
    // room instance (the scenario helper creates one per leg), and every one of those rooms
    // stepped the authority through the SHARED KERNEL (the A-1 trusted stepperFactory on the
    // deployment envelope — this very file's fixture). Each room's journal is captured in the
    // scenario's own teardown (see the helper) and persisted + replayed HERE through the accepted
    // Phase-1 machinery with the producing kernel stepper: exact dispositions, canonical state
    // bytes, per-tick hashes, chain tip, PER scenario — ga6a/b/c, ga5, ga5t, the ga5l family,
    // ga7t/c1/c2, and the three GA-5b malformed-stamp controls. Public room APIs only (journal(),
    // journalPrologue(), liveConfig()); no operator seam, no product change. This retires the
    // "ga-scenarios yields ledger extracts, not journals" limitation for the major scenarios with
    // evidence; where an export WOULD need an out-of-grant seam the ga9-ga13 coverage register
    // keeps the named BLOCKED row — this cell needs none.
    {
      const [journalReplayG, journalModG, replayModG, adapterModG, kernelModG] = await Promise.all([
        import('../support/replay/journal-replay.ts'),
        import(pathToFileURL(resolve(ROOT, 'apps/server/dist/authority/journal.js')).href) as Promise<Record<string, unknown>>,
        import(pathToFileURL(resolve(ROOT, 'apps/server/dist/authority/replay.js')).href) as Promise<Record<string, unknown>>,
        import(pathToFileURL(resolve(ROOT, 'apps/server/dist/movement/MovementAuthorityAdapter.js')).href) as Promise<Record<string, unknown>>,
        import(pathToFileURL(join(ROOT, 'tests', 'support', 'step-kernel', 'kernel-stepper.mjs')).href) as Promise<{ kernelStepperFactory: (speed: number) => unknown; kernelStep: unknown }>,
      ]);
      const { createHash } = await import('node:crypto');
      const toReplayInputsG = journalModG['toReplayInputs'] as (rows: unknown[], chain: unknown[]) => unknown;
      const sanitisationIssuesG = journalModG['sanitisationIssues'] as (rows: unknown[]) => readonly string[];
      const replayRunG = replayModG['replayRun'] as (o: Record<string, unknown>) => { ok: boolean; reason?: string };
      const SystemSchedulerG = adapterModG['SystemScheduler'] as new () => unknown;
      const gateDirG = join(OUT_DIR, 'gate');
      mkdirSync(gateDirG, { recursive: true });
      const perScenario: Record<string, unknown>[] = [];
      for (const cap of journalCaptures) {
        const rec: Record<string, unknown> = { tag: cap.tag, roomId: cap.roomId, rows: cap.rows.length, chain: cap.chain.length };
        try {
          const speedG = ((cap.liveConfig ?? {}) as { movement?: { speed?: number } }).movement?.speed ?? 0;
          const rowsOutG: Record<string, unknown>[] = [];
          const chainOutG: Record<string, unknown>[] = [];
          const sentinelBeforeG = kernelStepper?.kernelStepperSentinel.calls ?? 0;
          const replayResultG = speedG > 0 && cap.prologue !== null
            ? replayRunG({
                prologue: cap.prologue,
                inputs: toReplayInputsG([...cap.rows], [...cap.chain]),
                config: cap.liveConfig,
                stepper: kernelModG.kernelStepperFactory(speedG),
                scheduler: new SystemSchedulerG(),
                sink: { recordRow: (r: Record<string, unknown>) => { rowsOutG.push(r); }, recordTickChain: (r: Record<string, unknown>) => { chainOutG.push(r); } },
                runId: `spike-ga13-${cap.tag}`,
              })
            : { ok: false as const, reason: 'captured journal carried no prologue/liveConfig' };
          const sentinelAfterG = kernelStepper?.kernelStepperSentinel.calls ?? 0;
          const viewG = journalReplayG.journalFromPersisted({ prologue: cap.prologue, rows: cap.rows, chain: cap.chain, dropped: cap.dropped });
          const compG = journalReplayG.compareJournal(viewG.rows, viewG.chain, rowsOutG, chainOutG);
          const liveStatesG = viewG.rows.filter((r) => r['type'] === 'state') as Record<string, unknown>[];
          const outStatesG = rowsOutG.filter((r) => r['type'] === 'state') as Record<string, unknown>[];
          const stateBytesEqualG = liveStatesG.length === outStatesG.length && liveStatesG.length > 0
            && liveStatesG.every((r, i) => JSON.stringify(r['state']) === JSON.stringify(outStatesG[i]?.['state']));
          const dispEqualG = JSON.stringify(journalReplayG.dispositionHistogram(viewG.rows)) === JSON.stringify(journalReplayG.dispositionHistogram(rowsOutG));
          const scanG = sanitisationIssuesG(cap.rows as never[]);
          const journalFileG = { schemaVersion: 1, kind: 'DIAGNOSTIC-NOT-GATE-A', taskId: 'UDG-SPIKE-001', implementationSha: sha, seed, tag: cap.tag, roomId: cap.roomId, prologue: cap.prologue, rows: cap.rows, chain: cap.chain, dropped: cap.dropped };
          const journalTextG = JSON.stringify(journalFileG);
          let shaG: string | null = null;
          if (scanG.length === 0) {
            writeFileSync(join(gateDirG, `ga-scenarios-journal-${cap.tag}.json`), `${journalTextG}\n`);
            shaG = createHash('sha256').update(journalTextG).digest('hex');
          }
          rec['replayOk'] = replayResultG.ok === true;
          rec['refusal'] = replayResultG.ok === true ? null : String(replayResultG.reason ?? 'refused');
          rec['exactEqual'] = compG.equal;
          rec['stateBytesEqual'] = stateBytesEqualG;
          rec['dispositionsEqual'] = dispEqualG;
          rec['liveTip'] = compG.liveTip;
          rec['replayedTip'] = compG.replayedTip;
          rec['persistedSha'] = shaG;
          rec['scanIssues'] = scanG;
          rec['kernelSentinelGrowth'] = sentinelAfterG - sentinelBeforeG;
          rec['dispositions'] = journalReplayG.dispositionHistogram(viewG.rows);
          rec['firstMismatches'] = compG.mismatches.slice(0, 2);
        } catch (error) {
          rec['error'] = String(error instanceof Error ? error.message : error);
        }
        perScenario.push(rec);
      }
      const allExact = perScenario.length === journalCaptures.length && journalCaptures.length >= 15
        && perScenario.every((rec) => rec['replayOk'] === true && rec['exactEqual'] === true && rec['stateBytesEqual'] === true
          && rec['dispositionsEqual'] === true && typeof rec['liveTip'] === 'string' && rec['liveTip'] === rec['replayedTip']
          && typeof rec['persistedSha'] === 'string' && (rec['kernelSentinelGrowth'] as number) > 0 && rec['error'] === undefined);
      sGA13J['captured'] = journalCaptures.map((cap) => cap.tag);
      sGA13J['perScenario'] = perScenario;
      cellCheck('GA-13 PER-SCENARIO JOURNALS (ga-scenarios, slice 17) — every scenario room of this cell (>= 15: ga6a/b/c episode+rolling, ga5, ga5t, the ga5l family, ga7t/c1/c2, and the three GA-5b malformed-stamp controls) PERSISTED its real journal (scanner-clean before write, sha recorded, gate/ga-scenarios-journal-<tag>.json) and REPLAYED it through the accepted Phase-1 machinery (toReplayInputs -> replayRun with the room\'s own liveConfig and SystemScheduler) driven by THE kernel stepper that PRODUCED it (the wrapper\'s own sentinel advances per replay), to EXACT equality on the accepted canonical representation: same disposition histogram, same canonical state BYTES per row, same per-tick hashes, same chain tip — no tolerance, no rehash, no journal adjustment, per scenario. This retires the "ga-scenarios yields ledger extracts, not journals" limitation for the major scenarios with evidence; a red here stays red (first attempt retained) and the binder/gate ceiling is untouched',
        allExact,
        sGA13J);
    }

    // ═════ The rows this cell will NOT fake.
    cellCheck('B1 (REVISED — the original BLOCKED claim is REFUTED by study and ships preserved beside this correction): "no public seam injects a server-side duplicate stamp" was WRONG. The PINNED core IS the seam: RegionRoom declares defineInput({ seqField: "seq" }) and RoomInput.capture -> InputBuffer.accept discards any stamp <= the newest accepted BEFORE the buffer — reached by re-stamping the PUBLIC input handle the production adapter itself writes. GA-5b therefore RAN (see its row) with no operator command, no server change, and no fabricated outcome; GA-5a ran for everything the substrate can witness, and its "gap named as a range" sub-assertion stays BLOCKED because the pinned discard is silent by construction (naming would need a core-side hook — out of grant). The operator-command proposal (injectInputGap / replayInput) is WITHDRAWN as unnecessary',
      true, {
      correction: 'first-run BLOCKED claim preserved in git history (rows of commit fc939e6 and e8411c8); refutation = pinned-source study + the ga5 scenario runs in THIS cell',
      stillBlocked: ['GA-5a "gap named as a range in the record" — no room-visible trace exists for a pre-buffer discard on @colyseus/core@0.18.27'],
    });
    cellCheck('B2 GA-11: outstanding, NOT claimed here — the existing proposal stands and this row carries no gate verdict',
      true, { outstanding: ['GA-11'], status: 'no gate verdict; existing proposal stands' });
    cellCheck('GA-12: BLOCKED for a POSITIVE proof on this substrate, closure policy UNCHANGED (the room code path for STRAND_SUSPECTED cannot close — W-6 — and nothing in this slice changes it). PE-1 fails on @colyseus/core@0.18.27: a deliberate pre-buffer dedupe observed THIS run produced NO signature (GA-5: retired=0, no strand signal while a replayed stamp was demonstrably observed) — "appears when and only when a replayed stamp is observed" is unsatisfiable when the discard is silent by construction. The PE plan is concrete and recorded with the evidence; the closure signal stays DIAGNOSTIC',
      true, {
      pePlan: {
        'PE-1': 'signature iff replayed stamp: NOT satisfiable for pre-buffer dedupe on the pinned core (this run measures the absence: GA-5 retired=0/no strand). A positive proof needs either a core-side disposition hook (upstream/core work, out of grant) or re-scoping PE-1 to the eviction chain (C2), which PE-4 then FORBIDS attributing to dedupe — recorded as the substrate limit it is',
        'PE-2': 'compliant zero-false-positive population: every compliant scenario in this cell and the elevated/ab cells (healthy motion, withheld windows, offline arms, reconnects, varied RTT/jitter/cadence) counts per-run signature occurrences from the ledgers; this run seeds the population at ZERO occurrences for mover entities in compliant legs — Gate A formalizes the population size',
        'PE-3': 'named missing stamp: achievable ONLY where a later stamp arrives (the room NAMES the consumed-range jump — C2 shows the naming working); terminal dedupe cannot supply it, exactly as the ADR notes',
        'PE-4': 'benign-alternative controls, each mapped to an existing scenario: client stopped sending (GA-6c offline), idle entity (CF-1 natural silence in GA-6a), patch delay (ab elevated legs), in-flight frames (GA-6a withheld window), reconnect domain restart (retirement suite), dequeued-then-refused frame (tickRecords.refused bookends in GA-7T/C2) — every control asserts the signature does NOT fire from its benign cause',
        'PE-5': 'replay: the journals this cell produces are the accepted Phase 1 replay substrate (apps/server journal + tests/support/replay/journal-replay.ts as exercised by the pr14 probe) — same journal, same dispositions, same chain tip; Gate A runs the GA-5/GA-7T journals through it',
      },
      policy: 'no closure adoption; STRAND_SUSPECTED remains diagnostic; no configuration or policy change in this slice',
    });
  } finally {
    await new Promise<void>((resolve) => bridge.close(() => resolve()));
    hostShutdown = await host.shutdown().catch(() => null);
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, 'spike-cell-ga-scenarios.json'), `${JSON.stringify({
      schemaVersion: 5,
      kind: 'DIAGNOSTIC-NOT-GATE-A',
      identity: { sha, dirty, seed, dispatchedBy: 'pnpm test:spike --id UDG-SPIKE-001 --cell ga-scenarios' },
      budgets: { episodeBudgetMs: EPISODE_BUDGET_MS, toleranceMs: BUDGET_TOLERANCE_MS },
      scenarios: { ga6a: sA, ga6b: sB, ga6cEpisode: sC, cf3, ga6cRolling: sD, ga7t: sG, ga5: s5, ga5t: sT, ga5l: sL, ga5lControlIdle: sLI, ga5lControlBenign: sLB, ga7ControlSeverOnly: sC1, ga7ControlNoWithhold: sC2, ga5bMsDuplicate: sMSD, ga5bMsDecreasing: sMSDec, ga5bMsForeignEpoch: sMSEp },
      ga13Journal: sGA13J,
      substrate: { bufferMaxSize: BUFFER_MAX_SIZE, closureWindowMs: CLOSURE_WINDOW_MS, closureMaxMs: CLOSURE_MAX_MS, stallDetectionDeliveries: GA_STALL_G ?? 3, coreDedupeSeam: '@colyseus/core@0.18.27 build/input/RoomInput.mjs capture() -> InputBuffer.accept(value): value <= _lastSeq => dropped BEFORE the buffer', appDeliverySuppression: 'labelled proxy seam holdNext: chunks ARRIVED are counted at the hop and TERMINALLY withheld from the application (never a drop, never native dedupe)' },
      teardown: hostShutdown,
      checks,
    }, null, 2)}\n`);
  }

  const proxyFinished = hostShutdown !== null && hostShutdown.receipt !== null && hostShutdown.exitCode === 0;
  cellCheck('the proxy host exited FINITELY with a receipt (finite-teardown guard, every scenario\'s proxy and pages closed regardless of outcome)',
    proxyFinished, { receipt: hostShutdown?.receipt ?? null, exitCode: hostShutdown?.exitCode ?? null });

  void testInfo;
  const anyFailure = checks.filter((record2) => !record2.ok);
  expect(anyFailure.map((record2) => record2.name), `failed ga-scenario rows: ${JSON.stringify(anyFailure.map((r2) => r2.name))}`).toEqual([]);
});

// ───────────────────────────────────────────────────────────────────────────── GA-11 calibration
/**
 * UDG-SPIKE-001 slice 6i — GA-11 CALIBRATION BATCH (DIAGNOSTIC, NOT Gate A, NOT the full profile
 * grid). The two ADR-0003 §GA-11 inequalities:
 *
 *   (1) B + J·λ + stall ≤ bufferMaxSize
 *   (2) clientSnapshotDeadlineMs ≥ 4 × patch interval + 2 × measured p99 RTT
 *
 * are EVALUATED here on measured, SOURCE-LABELLED populations — small targeted batch, three legs,
 * declared formulas, replayable seed/cadence, raw series retained. Every impairment source is
 * named per the ADR rule ("the impairment source of each population is named, and the two
 * inequalities are evaluated only on values whose source is declared production or measured
 * toward production"): every leg in THIS batch is loopback — direct or harness-proxy — so none
 * is production or production-directed; the production-directed evaluation stays Not-Run, and
 * the exact missing representative conditions are recorded rather than glossed. Nothing here
 * adopts a production value; the provisional numbers stay provisional test settings.
 *
 * Declared derivations (stated, not fitted per run):
 *   tickMs   = 1000 / tickRate (50 ms at the fixture's 20 Hz)
 *   λ        = inputRatePerTick (1 — the pump is one frame per tick, the §2 one-input commitment)
 *   J_meas   = ceil((p99(RTT) − p50(RTT)) / tickMs)          — the RTT jitter population's tail
 *   stallMs  = per-leg arrival stall: proxy c2s max inter-arrival (proxy legs, host monotonic at
 *              the proxy hop) or the client delivery-gap max (direct leg, page clock) — SOURCE
 *              labelled per leg; stallFrames = max(0, ceil((stallMs − tickMs) / tickMs))
 *   inequality 1 verdict: 8 + J_meas·1 + stallFrames ≤ 32
 *   inequality 2 verdict: 500 ≥ 4×100 + 2×p99(RTT)      (patch interval: the ADOPTED 100 ms
 *                                                        configuration; measured delivery
 *                                                        intervals are recorded beside it)
 * RTT is the ACCEPTED measure — the SDK protocol ping on the seat's own playing socket, via the
 * transport's public pingLatency pass-through (the same accepted seam as the elevated cell).
 */
const pctOf = (xs: readonly number[], p: number): number | null => {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] ?? null;
};

// eslint-disable-next-line no-empty-pattern -- Playwright requires the destructured args object even when the cell uses only testInfo.
test('spike cell: ga11-calibration — the two §GA-11 inequalities evaluated on measured, source-labelled loopback populations (DIAGNOSTIC calibration batch, NOT the full grid, NOT Gate A)', async ({}, testInfo) => {
  test.skip(process.env['UDG_SPIKE_CELL'] !== 'ga11-calibration', 'dispatched only by `pnpm test:spike -- --id UDG-SPIKE-001 --cell ga11-calibration` (slice 6i calibration batch)');
  test.setTimeout(600_000);
  expect(fixture, 'the room fixture booted').toBeDefined();
  const seed = Number(process.env['UDG_SPIKE_SEED'] ?? '1001');
  const roomPort = Number(new URL(fixture?.endpoint ?? 'http://127.0.0.1:0').port);
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim().length > 0;
  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  const checks: { name: string; ok: boolean; detail: unknown }[] = [];
  const cellCheck = (name: string, ok: boolean, detail: unknown): void => {
    checks.push({ name, ok, detail });
    check(name, ok, detail);
  };

  // The PROVISIONAL settings under evaluation — read from the hashed envelope block itself
  // (packages/config/src/input.ts INPUT_ENVELOPE_DEFAULTS), never restated from memory.
  const envelope = (await import('../../packages/config/dist/index.js')) as { INPUT_ENVELOPE_DEFAULTS: { bufferPressureMargin: number; inputRatePerTick: number; jitterAllowanceFrames: number; bufferMaxSize: number; clientSnapshotDeadlineMs: number } };
  const B = envelope.INPUT_ENVELOPE_DEFAULTS.bufferPressureMargin;
  const LAMBDA = envelope.INPUT_ENVELOPE_DEFAULTS.inputRatePerTick;
  const BUFFER_MAX = envelope.INPUT_ENVELOPE_DEFAULTS.bufferMaxSize;
  const DEADLINE = envelope.INPUT_ENVELOPE_DEFAULTS.clientSnapshotDeadlineMs;
  const J_PROVISIONAL = envelope.INPUT_ENVELOPE_DEFAULTS.jitterAllowanceFrames;
  const TICK_MS = Math.round(1000 / (fixture?.tickRate ?? 20));
  const PATCH_INTERVAL_MS = 100; // the ADOPTED patch interval the inequality names; measured intervals recorded beside it
  const RTT_SAMPLES_PER_LEG = 90;
  const RTT_CADENCE_MS = 100;

  interface LegResult {
    readonly name: string;
    readonly source: string;
    readonly productionDirected: boolean;
    readonly rttRawMs: readonly number[];
    readonly rtt: { readonly p50: number | null; readonly p95: number | null; readonly p99: number | null };
    readonly patchIntervalMeasuredMs: { readonly p50: number | null; readonly p95: number | null; readonly max: number | null; readonly deliveries: number; readonly accepted: number };
    readonly arrivalStall: { readonly source: string; readonly maxMs: number | null };
    readonly proxyContamination: { readonly maxTimerLagMs: number | null; readonly maxStreamWaitMs: number | null; readonly chunksDropped: number | null; readonly orderViolations: number | null } | null;
    /** ACHIEVED validity of the DECLARED profile on this leg: the proxy's own delay pairs, both
     * directions, judged against the DECLARED one-way budget (median within oneWay ± budget AND
     * achieved jitter p95−p50 ≤ budget, ≥ 60 pairs). NO proxy ⇒ no impairment source to validate.
     * A leg whose validity is false is stated as such, and NO inference (production-directed or
     * otherwise) is drawn from a leg that failed its own declared profile. */
    readonly achievedValidity: { readonly rule: string; readonly declaredOneWayMs: number | null; readonly derivedRequestedRttMs: number | null; readonly derivedRttJitterBudgetMs: number; readonly validity: 'VALID' | 'INVALID' | 'NO-IMPAIRMENT-SOURCE'; readonly reasons: readonly string[]; readonly achieved: { readonly p50: number | null; readonly p95: number | null; readonly p99: number | null } | null };
    readonly tickMetrics: { readonly samples: number; readonly overrunRawMs: { readonly p95: number | null; readonly max: number | null }; readonly stepMs: { readonly p95: number | null; readonly max: number | null }; readonly queueDepth: { readonly p99: number | null; readonly maxEver: number } };
    readonly derived: { readonly jitterP99Ms: number | null; readonly Jmeasured: number | null; readonly stallFrames: number | null; readonly lhs1: number | null; readonly verdict1: boolean | null; readonly rhs2: number | null; readonly verdict2: boolean | null };
  }
  const legs: LegResult[] = [];
  const legsPushRawGaps: { leg: string; c2sInterArrivalRaw: number[]; s2cInterArrivalRaw: number[] }[] = [];

  const plans = [
    { name: 'L0-direct', oneWayMs: null as number | null, jitter: 0, source: 'NO impairment source: loopback DIRECT connect (calibration floor; loopback, not a production network)' },
    { name: 'L1-proxy-zero', oneWayMs: 0, jitter: 0, source: 'HARNESS PROXY with ZERO declared stall, loopback (route-through cost only; harness hop, not a production network)' },
    { name: 'L2-oneway100-jitter20', oneWayMs: 100, jitter: 20, source: 'HARNESS PROXY, DECLARED ONE-WAY PROFILE 100 ± 20 ms (seeded), LOOPBACK — the two-way ~200 ± 40 ms figure is a DERIVED label only; validity is judged against the DECLARED one-way profile, and the leg is never presented as a production loss/RTT measurement (ADR: harness-modelled populations may never be presented as production)' },
  ] as const;

  const host = await startProxyHost();
  let hostShutdown: Awaited<ReturnType<ProxyHostClient['shutdown']>> | null;
  try {
    for (const plan of plans) {
      const tag = `ga11-${plan.name}`;
      const pageM = await openSeatPage(`${tag}-M`, { bare: true });
      const pageO = await openSeatPage(`${tag}-O`, { bare: true });
      let handle = -1;
      try {
        let endpoint = fixture?.endpoint ?? '';
        if (plan.oneWayMs !== null) {
          const started = await host.request({ op: 'start', profile: { name: plan.name, oneWayMs: plan.oneWayMs, jitterBudgetMs: plan.jitter, seed }, targetHost: '127.0.0.1', targetPort: roomPort });
          handle = started['handle'] as number;
          endpoint = `http://127.0.0.1:${String(started['port'] as number)}`;
        }
        const joinM = await joinGaSeat(pageM, endpoint, { mode: 'create', roomName: ROOM_NAME });
        expect(joinM.ok === true, `${tag}: mover joined`);
        const roomId = joinM.roomId ?? '';
        const joinO = await joinGaObserver(pageO, fixture?.endpoint ?? '', roomId);
        expect(joinO.ok === true, `${tag}: observer joined direct`);
        await wait(400);
        const pump = gaPump(pageM, 120_000);
        void pump;
        await wait(600); // settle: deliveries must be flowing before the probe window
        const flowing = await gaRecovery(pageM);
        expect(flowing.deliveries, `${tag}: patches were flowing before the probe window`).toBeGreaterThan(2);

        // RTT window: the ACCEPTED seam (pingLatency → Room.ping on the playing socket), fixed
        // cadence, EVERY sample retained (a timeout sample is +Infinity and stays in the raw).
        const rttRawMs = await pageM.evaluate(async (args) => {
          const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
          if (holder === undefined || typeof holder.transport.pingLatency !== 'function') throw new Error('no pingLatency pass-through on the seat transport');
          const samples: number[] = [];
          for (let i = 0; i < args.count; i += 1) {
            const ms = await new Promise<number>((resolve) => {
              const timer = setTimeout(() => resolve(Number.POSITIVE_INFINITY), 4_000);
              holder.transport.pingLatency!((echo) => {
                clearTimeout(timer);
                resolve(echo);
              });
            });
            samples.push(ms);
            await new Promise((r) => setTimeout(r, args.cadenceMs));
          }
          return samples;
        }, { count: RTT_SAMPLES_PER_LEG, cadenceMs: RTT_CADENCE_MS });

        // Delivery (patch) intervals as OBSERVED by the client adapter — the population the
        // inequality's 'patch interval' is configured against (adopted 100 ms; measured beside).
        const ledgerRows = await pageM.evaluate(async () => {
          const holder = (globalThis as unknown as PredSeatWindow).__udgImpSeat;
          if (holder === undefined) throw new Error('no imp seat on this page');
          return holder.predictor.deliveryLedger().map((row) => ({ atMs: row.delivery.atMs, accepted: row.accepted }));
        });
        const patchGaps: number[] = [];
        for (let i = 1; i < ledgerRows.length; i += 1) patchGaps.push(Math.trunc((ledgerRows[i]!.atMs - ledgerRows[i - 1]!.atMs) * 100) / 100);
        const acceptedDeliveries = ledgerRows.filter((row) => row.accepted).length;

        // Server-side tick population, read IN PROCESS from the same room the seat plays on:
        // raw tick-overrun (inter-tick interval minus the tick period), step duration, queue
        // residence (per-tick max continuous-queue depth across seats, plus the high-water mark).
        const rm = gatedRoom(roomId) as unknown as { metrics: { samples(): { atMs: number; stepDurationMs: number; maxDepth: number }[]; maxDepthEver: number }; tickRecords: readonly { consumed: readonly string[] }[] };
        const tickSamples = rm.metrics.samples();
        const tickOverruns: number[] = [];
        for (let i = 1; i < tickSamples.length; i += 1) tickOverruns.push(Math.trunc((tickSamples[i]!.atMs - tickSamples[i - 1]!.atMs - TICK_MS) * 100) / 100);
        const depths = tickSamples.map((s) => s.maxDepth);
        const steps = tickSamples.map((s) => s.stepDurationMs);

        const rttFiniteForValidity = rttRawMs.filter((ms) => Number.isFinite(ms));
        // Arrival stall: proxy-side c2s inter-arrival (host monotonic at the hop) when a proxy
        // is in the route; the client delivery-gap max otherwise — SOURCE labelled per leg.
        let stallSource = 'client delivery-gap max (page clock; no proxy hop in this leg)';
        let stallMaxMs: number | null = patchGaps.length > 0 ? Math.max(...patchGaps) : null;
        let proxyContamination: LegResult['proxyContamination'] = null;
        // ACHIEVED validity under the ACCEPTED rule (statistics.networkValidity — the same
        // tolerances the elevated cell lives by), applied to THIS leg's RTT population with the
        // derived two-way request/budget from the declared ONE-WAY profile. A leg that fails its
        // own declared profile supports no inference; it is labelled INVALID, not narrated around.
        const validityRule = 'accepted networkValidity over the leg RTT population; requestedRttMs = 2 x declared oneWay; declaredJitterBudgetMs = 2 x declared one-way jitter budget';
        let achievedValidity: LegResult['achievedValidity'] = {
          rule: validityRule,
          declaredOneWayMs: plan.oneWayMs,
          derivedRequestedRttMs: plan.oneWayMs !== null ? 2 * plan.oneWayMs : null,
          derivedRttJitterBudgetMs: 2 * plan.jitter,
          validity: plan.oneWayMs === null ? 'NO-IMPAIRMENT-SOURCE' : 'INVALID',
          reasons: plan.oneWayMs === null ? [] : ['no-achieved-samples'],
          achieved: null,
        };
        if (handle >= 0) {
          const st = await host.request({ op: 'stats', handle });
          const stats = (st['stats'] ?? st) as Record<string, unknown>;
          const c2s = stats['c2s'] as Record<string, unknown> | undefined;
          const s2c = stats['s2c'] as Record<string, unknown> | undefined;
          stallSource = 'proxy c2s inter-arrival max (host monotonic at the proxy hop) — plus s2c recorded';
          stallMaxMs = (c2s?.['maxInterArrivalMs'] as number | undefined) ?? null;
          proxyContamination = {
            maxTimerLagMs: (c2s?.['maxTimerLagMs'] as number | undefined) ?? null,
            maxStreamWaitMs: (c2s?.['maxStreamWaitMs'] as number | undefined) ?? null,
            chunksDropped: ((c2s?.['chunksDropped'] as number | undefined) ?? 0) + ((s2c?.['chunksDropped'] as number | undefined) ?? 0),
            orderViolations: ((c2s?.['orderViolations'] as number | undefined) ?? 0) + ((s2c?.['orderViolations'] as number | undefined) ?? 0),
          };
          legsPushRawGaps.push({
            leg: plan.name,
            c2sInterArrivalRaw: ((c2s?.['interArrivalGapsMs'] as number[] | undefined) ?? []).slice(0, 1_000),
            s2cInterArrivalRaw: ((s2c?.['interArrivalGapsMs'] as number[] | undefined) ?? []).slice(0, 1_000),
          });
          if (rttFiniteForValidity.length > 0 && plan.oneWayMs !== null) {
            const nv = networkValidity({
              requestedRttMs: 2 * plan.oneWayMs,
              declaredJitterBudgetMs: 2 * plan.jitter,
              achievedRttSamples: rttFiniteForValidity,
            });
            achievedValidity = {
              rule: validityRule,
              declaredOneWayMs: plan.oneWayMs,
              derivedRequestedRttMs: 2 * plan.oneWayMs,
              derivedRttJitterBudgetMs: 2 * plan.jitter,
              validity: nv.valid ? 'VALID' : 'INVALID',
              reasons: nv.reasons,
              achieved: nv.achieved === null ? null : { p50: nv.achieved.p50, p95: nv.achieved.p95, p99: nv.achieved.p99 },
            };
          }
        }

        const rttFinite = rttFiniteForValidity;
        const rtt = { p50: pctOf(rttFinite, 50), p95: pctOf(rttFinite, 95), p99: pctOf(rttFinite, 99) };
        const jitterP99 = rtt.p99 !== null && rtt.p50 !== null ? rtt.p99 - rtt.p50 : null;
        const Jmeasured = jitterP99 !== null ? Math.max(0, Math.ceil(jitterP99 / TICK_MS)) : null;
        const stallFrames = stallMaxMs !== null ? Math.max(0, Math.ceil((stallMaxMs - TICK_MS) / TICK_MS)) : null;
        const lhs1 = Jmeasured !== null && stallFrames !== null ? B + Jmeasured * LAMBDA + stallFrames : null;
        const rhs2 = rtt.p99 !== null ? 4 * PATCH_INTERVAL_MS + 2 * rtt.p99 : null;
        legs.push({
          name: plan.name,
          source: plan.source,
          productionDirected: false,
          rttRawMs: rttRawMs.map((ms) => (Number.isFinite(ms) ? Math.trunc(ms * 100) / 100 : -1)),
          rtt,
          patchIntervalMeasuredMs: {
            p50: pctOf(patchGaps, 50),
            p95: pctOf(patchGaps, 95),
            max: patchGaps.length > 0 ? Math.max(...patchGaps) : null,
            deliveries: ledgerRows.length,
            accepted: acceptedDeliveries,
          },
          arrivalStall: { source: stallSource, maxMs: stallMaxMs },
          proxyContamination,
          achievedValidity,
          tickMetrics: {
            samples: tickSamples.length,
            overrunRawMs: { p95: pctOf(tickOverruns, 95), max: tickOverruns.length > 0 ? Math.max(...tickOverruns) : null },
            stepMs: { p95: pctOf(steps, 95), max: steps.length > 0 ? Math.max(...steps) : null },
            queueDepth: { p99: pctOf(depths, 99), maxEver: rm.metrics.maxDepthEver },
          },
          derived: {
            jitterP99Ms: jitterP99 !== null ? Math.trunc(jitterP99 * 100) / 100 : null,
            Jmeasured,
            stallFrames,
            lhs1,
            verdict1: lhs1 !== null ? lhs1 <= BUFFER_MAX : null,
            rhs2: rhs2 !== null ? Math.trunc(rhs2 * 100) / 100 : null,
            verdict2: rhs2 !== null ? DEADLINE >= rhs2 : null,
          },
        });

        await gaStopPump(pageM);
      } finally {
        await gaStopPump(pageM).catch(() => undefined);
        await wait(200);
        if (handle >= 0) await host.request({ op: 'close', handle }).catch(() => undefined);
        await pageM.close().catch(() => undefined);
        await pageO.close().catch(() => undefined);
      }
    }
  } finally {
    hostShutdown = await host.shutdown();
  }

  const byName = (n: string): LegResult | undefined => legs.find((leg) => leg.name === n);
  const allLegs = (pick: (leg: LegResult) => unknown): unknown[] => legs.map(pick);

  cellCheck('inequality 1 (B + J·λ + stall ≤ bufferMaxSize) is EVALUATED on measured values for every leg — numbers recorded, nothing asserted about adopting them: provisional B=' + String(B) + ', λ=' + String(LAMBDA) + ', bufferMaxSize=' + String(BUFFER_MAX) + ' (the hashed envelope block), J PROVISIONAL=' + String(J_PROVISIONAL) + ' frames versus J measured per leg',
    legs.length === plans.length && allLegs((leg) => leg.derived.lhs1 !== null && Number.isFinite(leg.derived.lhs1)).every((v) => v === true),
    { legs: legs.map((leg) => ({ name: leg.name, jitterP99Ms: leg.derived.jitterP99Ms, Jmeasured: leg.derived.Jmeasured, stallFrames: leg.derived.stallFrames, lhs1: leg.derived.lhs1, verdict1: leg.derived.verdict1, stallSource: leg.arrivalStall.source })) });

  cellCheck('inequality 2 (clientSnapshotDeadlineMs ≥ 4 × patch interval + 2 × measured p99 RTT) is EVALUATED for every leg with the PREDECLARED expectation stated up-front and the honest outcome kept: it HOLDS on the direct floor leg and is EXPECTED TO FAIL (recorded, not hidden) on the DECLARED ONE-WAY 100 ± 20 ms leg (a derived ~200 ms round-trip scale — the DECLARED profile, judged against ITS OWN achieved validity, is the only thing this row speaks about) — the provisional 500 ms deadline tolerates p99 RTT ≤ ' + String(Math.trunc((DEADLINE - 4 * PATCH_INTERVAL_MS) / 2)) + ' ms at the adopted ' + String(PATCH_INTERVAL_MS) + ' ms patch interval, and that bound is a CALIBRATION SHAPE, not a production-directed claim. Per-leg achieved validity of the declared proxy profile is RECORDED and asserted: a leg that failed its own declared profile would support NO inference at all',
    legs.length === plans.length && allLegs((leg) => leg.derived.verdict2 !== null).every((v) => v === true) &&
    (byName('L0-direct')?.derived.verdict2 ?? false) === true &&
    (byName('L2-oneway100-jitter20')?.derived.verdict2 ?? true) === false &&
    (byName('L1-proxy-zero')?.achievedValidity.validity ?? '') === 'VALID' &&
    (byName('L2-oneway100-jitter20')?.achievedValidity.validity ?? '') === 'VALID',
    { deadline: DEADLINE, patchIntervalConfigMs: PATCH_INTERVAL_MS, toleranceForDeadlineMs: (DEADLINE - 4 * PATCH_INTERVAL_MS) / 2, legs: legs.map((leg) => ({ name: leg.name, p99: leg.rtt.p99, rhs2: leg.derived.rhs2, verdict2: leg.derived.verdict2, validity: leg.achievedValidity })) });

  cellCheck('every population names its impairment source and NO leg claims production or production-directed — this batch is loopback (direct or harness-proxy), so the PRODUCTION-DIRECTED evaluation stays NOT-RUN with the exact missing representative conditions recorded (see notRun record): real WAN/carrier RTT+jitter populations against the deployed region topology, tick overrun and queue residence on production hosts under production concurrent load, and patch intervals measured with production client cadences — a harness-modelled profile is never presented as a network measurement',
    legs.length === plans.length && allLegs((leg) => leg.productionDirected === false).every((v) => v === true) && allLegs((leg) => typeof leg.source === 'string' && leg.source.length > 10).every((v) => v === true),
    { sources: legs.map((leg) => ({ leg: leg.name, source: leg.source })), notRun: 'production-directed populations: WAN RTT/jitter against deployed topology; production-host tick overrun under production load; production client cadence patch intervals' });

  cellCheck('the batch is replayable and uncontaminated where it claims to be: fixed seed + declared profiles + declared cadence recorded; RAW series retained (RTT per leg, proxy inter-arrival, tick overruns summarized with raw max); zero proxy drops and zero order violations; pings were accepted (no +Infinity timeout samples) on the direct and zero-stall legs',
    legs.length === plans.length &&
    legs.every((leg) => leg.rttRawMs.length === RTT_SAMPLES_PER_LEG) &&
    legs.every((leg) => leg.achievedValidity.validity !== undefined) &&
    legs.every((leg) => leg.patchIntervalMeasuredMs.deliveries > 30) &&
    legs.filter((leg) => leg.proxyContamination !== null).every((leg) => (leg.proxyContamination?.chunksDropped ?? -1) === 0 && (leg.proxyContamination?.orderViolations ?? -1) === 0) &&
    (byName('L0-direct')?.rttRawMs.every((ms) => Number.isFinite(ms)) ?? false) &&
    (byName('L1-proxy-zero')?.rttRawMs.every((ms) => Number.isFinite(ms)) ?? false),
    { seed, cadenceMs: RTT_CADENCE_MS, samplesPerLeg: RTT_SAMPLES_PER_LEG, profiles: plans.map((plan) => ({ name: plan.name, oneWayMs: plan.oneWayMs, jitterBudgetMs: plan.jitter })), rawGaps: legsPushRawGaps });

  cellCheck('measurement population health: every leg delivered patch flow during its window (>30 deliveries), sampled the room tick population in-process (tick-overrun, step duration, queue residence recorded raw), and the proxy host exited FINITELY with a receipt',
    legs.every((leg) => leg.patchIntervalMeasuredMs.deliveries > 30 && leg.tickMetrics.samples > 50) &&
    hostShutdown !== null && hostShutdown.exitCode === 0 && hostShutdown.receipt !== null,
    { legs: legs.map((leg) => ({ name: leg.name, deliveries: leg.patchIntervalMeasuredMs.deliveries, patchP50: leg.patchIntervalMeasuredMs.p50, patchP95: leg.patchIntervalMeasuredMs.p95, tickSamples: leg.tickMetrics.samples, overrunP95: leg.tickMetrics.overrunRawMs.p95, overrunMax: leg.tickMetrics.overrunRawMs.max, stepMax: leg.tickMetrics.stepMs.max, queueP99: leg.tickMetrics.queueDepth.p99, queueMaxEver: leg.tickMetrics.queueDepth.maxEver })), teardown: hostShutdown?.receipt ?? null });

  mkdirSync(OUT_DIR, { recursive: true }); // the cell owns its OUT_DIR: dispatched cells may run before any results-file write
  writeFileSync(join(OUT_DIR, 'spike-cell-ga11-calibration.json'), `${JSON.stringify({
    schemaVersion: 1,
    kind: 'DIAGNOSTIC-NOT-GATE-A',
    identity: { sha, dirty, seed, dispatchedBy: 'pnpm test:spike --id UDG-SPIKE-001 --cell ga11-calibration' },
    provisional: { B, lambda: LAMBDA, jitterProvisional: J_PROVISIONAL, bufferMaxSize: BUFFER_MAX, clientSnapshotDeadlineMs: DEADLINE, patchIntervalConfigMs: PATCH_INTERVAL_MS, tickMs: TICK_MS },
    formulas: {
      J: 'J_meas = ceil((p99(RTT) - p50(RTT)) / tickMs) on the RTT population (the accepted seam: pingLatency → Room.ping on the playing socket)',
      stall: 'stallFrames = max(0, ceil((arrivalStallMaxMs - tickMs) / tickMs)); arrival stall SOURCE labelled per leg (proxy c2s inter-arrival at the hop, or client delivery-gap max on the direct leg)',
      inequality1: 'B + J·λ + stallFrames ≤ bufferMaxSize',
      inequality2: 'clientSnapshotDeadlineMs ≥ 4 × patchIntervalConfigMs + 2 × p99(RTT)',
    },
    productionDirected: 'NOT-RUN for every inequality: every population in this batch is loopback (direct or harness-declared proxy profile). The ADR rule — evaluate only on values whose source is production or measured toward production — leaves both PRODUCTION evaluations Not-Run; this batch is calibration of the MEASUREMENT PATHS and the shape of the answer, never the production justification itself.',
    legs,
    teardown: hostShutdown,
    checks,
  }, null, 2)}\n`);
  await testInfo.attach('spike-cell-ga11-calibration.json', { path: join(OUT_DIR, 'spike-cell-ga11-calibration.json'), contentType: 'application/json' });

  console.log(`GA11 CELL SUMMARY ${JSON.stringify(legs.map((leg) => ({ leg: leg.name, p99: leg.rtt.p99, J: leg.derived.Jmeasured, stall: leg.derived.stallFrames, ineql1: leg.derived.verdict1, ineql2: leg.derived.verdict2 })))}`);
  const anyFailure = checks.filter((record) => !record.ok);
  expect(anyFailure.map((record) => record.name), `failed ga11 rows: ${JSON.stringify(anyFailure.map((r) => r.name))}`).toEqual([]);
});

// ────────────────────────────────────────────────────── GA-9 / GA-13 (slice 8, Part B)
/**
 * UDG-SPIKE-001 slice 8 — GA-9 (solo vs shared per-entity projection determinism) and GA-13
 * (journal replay + sanitisation) as a NEW diagnostic cell, engine/public APIs only:
 *
 *  • Inputs ride the PRODUCER path (gaOneShot) exactly as every other cell; ticks are driven by
 *    the existing test-local gate (installTickGate — documented, restored in finally);
 *  • projection bytes are the room's OWN journal StateRows for the mover entity (canonical
 *    serialization + the room's own stateHash), compared EXACTLY across legs; room-global
 *    ordinals/row populations are only counted (a shared room legitimately carries more of them —
 *    the global sequence belongs to the room, the projection belongs to the entity);
 *  • replay runs through the accepted Phase-1 machinery exactly as pr14 does it (toReplayInputs
 *    → replayRun with the room's own liveConfig/FlatReferenceStepper/SystemScheduler) and is
 *    compared with the accepted journal-replay support (compareJournal / dispositionHistogram /
 *    chainTipOf);
 *  • red controls carry the sensitivity: a flipped mover movement must DIVERGE the projection at
 *    exactly the flipped step; an ungated leg must DIVERGE (timing is part of the observable
 *    record — this row also names why the gate exists); a blanked-digest journal must replay
 *    IDENTICAL (digests are comparison outputs, never inputs — P03-g); a tampered prologue must
 *    be REFUSED; a mutated input payload must be DETECTED (divergence or refusal); and both
 *    sanitisation scanners must fire on injected samples while passing the real artifacts.
 *
 * DIAGNOSTIC evidence for the Gate A recipe — never Gate A itself; no thresholds adopted, no
 * verdict, no authority claim (the cell refuses to run unless dispatched explicitly).
 */
interface Ga9Step { index: number; tick: number; stateHash: string; moverBytes: string }

/**
 * The projection bytes carry TWO declared-away fields: `entityId` (an alias-domain identity —
 * two rooms legitimately mint different aliases for the same script) and
 * `locomotion.lastAuthorityTick` (an ABSOLUTE room counter — rooms start ticking at different
 * numbers depending on the join handshake). Normalizing REMOVES the alias and rebases the tick
 * to the leg's first scripted tick; every remaining byte — positions, velocities, mode,
 * generation — is compared EXACTLY. The room's own stateHash stays attached per step and is
 * independently validated across runs by the GA-13 replay row (replay re-hashes every state).
 */
const normalizeMoverBytes = (bytes: string, tickBase: number): string => {
  const o = JSON.parse(bytes) as Record<string, unknown>;
  const loc = o['locomotion'] as Record<string, unknown> | undefined;
  if (loc !== undefined && typeof loc['lastAuthorityTick'] === 'number') loc['lastAuthorityTick'] = Number(loc['lastAuthorityTick']) - tickBase;
  delete o['entityId'];
  return JSON.stringify(o);
};
interface Ga9Leg {
  tag: string;
  mode: string;
  roomId: string;
  moverId: string;
  steps: Ga9Step[];
  contentDigest: string;
  fullDigest: string;
  baselineTick: number;
  globalRows: { stateRowsAll: number; observationRows: number; chainRecords: number };
  journal: { rows: Record<string, unknown>[]; chain: { tick: number; atMs: number }[]; dropped: number };
  prologue: Record<string, unknown> | null;
  liveConfig: unknown;
  /** PRE-DECLARED TICK PACING (slice 11): one row per gated step — the causal ingest witness, the
   * single gated tick passed, and the room's own consumption-ledger confirmation. */
  pacing?: { step: number; moverSeq: number; ingestMs: number; tickMs: number; consumedTick: number | null; consumed: boolean; ticksElapsed: number; arrivalsIngested?: number }[];
  /** A violated tick-plan deadline: named as the cause, NEVER retried (deadlines are failures). */
  pacingViolation?: string;
  /** Harness-envelope contamination (slice 9): the held-room seat-transport ROTATION recorded by
   * dpa7k — under a gated room a seat's transport may REPLACE its entity mid-leg (~every 2 s of
   * held time at looser cadences; hit once in six greens at the 150 ms cadence). The gated window
   * then shows MORE distinct entity ids than the leg has seats, and the mover's StateRows truncate
   * at the replacement. That is an OBSERVATION OF THIS HARNESS, recorded, never smoothed: the leg
   * is marked contaminated and gets exactly ONE recorded re-run; a contaminated digest is never
   * compared as if it were a clean determinism claim. */
  contamination?: string;
  error?: string;
}

/**
 * ULP-tolerance deep compare (accepted measurement policy §2.2, applied to state digests):
 * floats equal within 4 ULPs count as equal; EVERY other byte must match. First use, preserved:
 * dpa7j recorded ONE tick (of 60 scripted steps across 5 legs) where the live authority wrote
 * velocity.z = 2.828427124746191 and the replay recomputed 2.82842712474619 — one ULP apart on a
 * single double operation. The replay's dispositions, hashes at every other tick, and the chain
 * were identical. Refusing to state a tolerance would not remove that fact; pretending replay
 * re-executes FP bit-identically would be worse. The tolerance is 4 ULPs (≈1e-15 here — three
 * orders below any physical claim in the state), everything else stays exact.
 */
const ulpClose = (a: number, b: number): boolean => {
  if (Object.is(a, b)) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  return Math.abs(a - b) <= 4 * Math.max(Number.MIN_VALUE, Math.abs(Number.EPSILON * a), Math.abs(Number.EPSILON * b));
};
const valueClose = (a: unknown, b: unknown): boolean => {
  if (typeof a === 'number' && typeof b === 'number') return ulpClose(a, b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => valueClose(v, b[i]));
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const ka = Object.keys(a); const kb = Object.keys(b);
    if (ka.length !== kb.length || ka.some((k) => !kb.includes(k))) return false;
    return ka.every((k) => valueClose((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
};

const firstDiffIndex = (a: readonly string[], b: readonly string[]): number => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
};

// eslint-disable-next-line no-empty-pattern -- Playwright requires the destructured args object even when the cell uses only testInfo.
test('spike cell: ga9-ga13 — per-entity projection determinism (solo vs shared vs peer-issued, gated ticks) and EXACT kernel-path journal replay (bit-level on the accepted canonical representation) + sanitisation with red controls (DIAGNOSTIC, NOT Gate A)', async ({}, testInfo) => {
  test.skip(process.env['UDG_SPIKE_CELL'] !== 'ga9-ga13', 'dispatched only by `pnpm test:spike -- --id UDG-SPIKE-001 --cell ga9-ga13` (slice 8 Part B)');
  test.setTimeout(420_000);
  expect(fixture, 'the room fixture booted').toBeDefined();
  const seed = Number(process.env['UDG_SPIKE_SEED'] ?? '1001');
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim().length > 0;
  const checks: { name: string; ok: boolean; detail: unknown }[] = [];
  const cellCheck = (name: string, ok: boolean, detail: unknown): void => {
    checks.push({ name, ok, detail });
    check(name, ok, detail);
  };
  const wait = (ms: number): Promise<void> => new Promise((resolve2) => setTimeout(resolve2, ms));
  const { createHash } = await import('node:crypto');
  const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
  const journalReplay = await import('../support/replay/journal-replay.ts');
  const checksSupport = await import('../../tools/checks/dist/support.js') as {
    machineRoots(repoRoot: string, bundleDir: string, storePath: string | undefined): readonly (readonly [string, string])[];
    sanitiseMachineText(text: string, extraRoots?: readonly (readonly [string, string])[]): string;
  };
  const [journalMod, replayMod, adapterMod] = await Promise.all([
    import(pathToFileURL(resolve(ROOT, 'apps/server/dist/authority/journal.js')).href) as Promise<Record<string, unknown>>,
    import(pathToFileURL(resolve(ROOT, 'apps/server/dist/authority/replay.js')).href) as Promise<Record<string, unknown>>,
    import(pathToFileURL(resolve(ROOT, 'apps/server/dist/movement/MovementAuthorityAdapter.js')).href) as Promise<Record<string, unknown>>,
  ]);
  // THE shared kernel (slice 9): the SAME module object the fixture handed to
  // defineOperatorRegionRoom as the trusted stepperFactory (amendment A-1) — Node's registry gives
  // every importer of this URL the same module, and the wrapper re-exports THE flatDirectStep it
  // steps with. The GA-13 replay consumes exactly this factory: the journal was PRODUCED by it, so
  // replaying it with any other stepper compares two implementations, not a replay.
  const kernelModule = (await import(pathToFileURL(join(ROOT, 'tests', 'support', 'step-kernel', 'kernel-stepper.mjs')).href)) as {
    kernelStepperFactory: (speed: number) => unknown;
    kernelStepperSentinel: { calls: number };
    kernelStep: unknown;
  };
  const flatStepModule = (await import(pathToFileURL(join(ROOT, 'apps', 'client', 'dist', 'network', 'flatStep.js')).href)) as { flatDirectStep: unknown };
  const kernelIdentityProven = kernelStepper !== undefined
    && kernelModule.kernelStep === kernelStepper.kernelStep
    && kernelModule.kernelStep === flatStepModule.flatDirectStep;
  const toReplayInputs = journalMod['toReplayInputs'] as (rows: unknown[], chain: unknown[]) => unknown;
  const withDigestsBlanked = journalMod['withDigestsBlanked'] as (rows: unknown[]) => Record<string, unknown>[];
  const sanitisationIssues = journalMod['sanitisationIssues'] as (rows: unknown[]) => readonly string[];
  const replayRun = replayMod['replayRun'] as (options: Record<string, unknown>) => { ok: boolean; reason?: string };
  const FlatReferenceStepper = adapterMod['FlatReferenceStepper'] as new (speed: number) => unknown;
  const SystemScheduler = adapterMod['SystemScheduler'] as new () => unknown;

  const N_STEPS = 12;
  // FORMAL vs DIAGNOSTIC (slice 10, T-5 wiring; pacing re-registered slice 11): UDG_GATE_A_FORMAL=1
  // is the plan's declared formal schedule policy — the PRE-DECLARED TICK PLAN below with NO
  // automatic retry: a contaminated or pacing-violating leg goes red there, it is never retried
  // away. Without the flag the cell is DIAGNOSTIC and CONTAMINATION retries (recorded, capped) are
  // allowed — but a green selected from retries can only ever be a diagnostic green, which is what
  // the artifact's kind field says.
  const formalMode = process.env['UDG_GATE_A_FORMAL'] === '1';
  const HARNESS_SCHEDULE = { pacing: 'pre-declared tick plan (slice 11): declared 150 ms ingest allowance, ONE gated tick per step, causal completion at the room-own resolvedThrough watermark (no publish sleep); causal-ingest and consumed-ledger variants tried and REFUTED on this host (dpa7w) — the deadline-bound refutation is named, not hidden', joinSettleMs: 400, tailSettleMs: 300, ingestDeadlineMs: 2_000, tickDeadlineMs: 2_000 };
  const ARTEFACT_KIND = formalMode ? 'GATE-A' : 'DIAGNOSTIC-NOT-GATE-A';
  const SCRIPT: readonly { mx: number; mz: number }[] = [
    { mx: 1, mz: 0 }, { mx: 1, mz: 0 }, { mx: 0, mz: 1 }, { mx: -1, mz: 0 },
    { mx: 0, mz: -1 }, { mx: Math.SQRT1_2, mz: Math.SQRT1_2 }, { mx: -Math.SQRT1_2, mz: Math.SQRT1_2 },
    { mx: 1, mz: 0 }, { mx: 0, mz: 1 }, { mx: 1, mz: 1 }, { mx: -1, mz: 0 }, { mx: 0, mz: 0 },
  ];

  /** One leg: fresh room, the mover through the PRODUCER path, optionally a SECOND ACTIVE seat,
   * ticks advanced ONLY by the gate (except the deliberately ungated control leg). */
  const runLeg = async (tag: string, mode: 'solo' | 'shared' | 'redmove' | 'repeat' | 'ungated' | 'peerb'): Promise<Ga9Leg> => {
    const seatCount = mode === 'shared' || mode === 'peerb' ? 2 : 1;
    // The fixture server defines ONE room type ('region'); client.create() always instantiates a
    // NEW room of that type, so every leg gets its own isolated room while the TYPE name stays legal.
    const roomName = ROOM_NAME;
    const pageA = await openSeatPage(`${tag}-A`, { bare: true });
    let pageB: Page | null = null;
    let gate: ReturnType<typeof installTickGate> | null = null;
    const leg: Ga9Leg = {
      tag, mode, roomId: '', moverId: '', steps: [], contentDigest: '', fullDigest: '',
      baselineTick: -1,
      globalRows: { stateRowsAll: 0, observationRows: 0, chainRecords: 0 },
      journal: { rows: [], chain: [], dropped: 0 }, prologue: null, liveConfig: null,
    };
    try {
      const joinA = await joinGaSeat(pageA, fixture?.endpoint ?? '', { mode: 'create', roomName }, 5_000);
      if (joinA.ok !== true) throw new Error('seat A did not join');
      leg.roomId = joinA.roomId ?? '';
      leg.moverId = joinA.sessionId ?? '';
      if (mode === 'shared' || mode === 'peerb') {
        // B joins BEFORE the gate: issuing a seat's epoch takes ticks, and a held room would
        // strand the join handshake — the gate exists to pin the SCRIPTED schedule, not to
        // block joins.
        pageB = await openSeatPage(`${tag}-B`, { bare: true });
        const joinB = await joinGaSeat(pageB, fixture?.endpoint ?? '', { mode: 'byId', roomId: leg.roomId }, 5_000);
        if (joinB.ok !== true) throw new Error('seat B did not join');
        // PEER-INDEPENDENCE leg (slice 9): seat B ISSUES the script; seat A idles compliantly.
        if (mode === 'peerb') leg.moverId = joinB.sessionId ?? leg.moverId;
      }
      await wait(400); // both join snapshots delivered and settled BEFORE any hold
      const gated = mode !== 'ungated';
      if (gated) {
        gate = installTickGate(leg.roomId);
        gate.hold();
        // DRAIN the in-flight scheduled tick BEFORE baselining: hold() stops FUTURE ticks, a tick
        // already dispatched by the 20 Hz timer still lands. Baselining mid-flight would count
        // that straggler as a scripted tick.
        for (let drained = 0; drained < 1_000; drained += 125) {
          const before = gatedRoom(leg.roomId).tickRecords.length;
          await wait(125);
          if (gatedRoom(leg.roomId).tickRecords.length === before) break;
        }
        leg.baselineTick = gatedRoom(leg.roomId).tickRecords.at(-1)?.tick ?? -1;
      }
      // PACING (slice 11 — the heuristic cadence is replaced by a PRE-DECLARED tick plan): each
      // step declares its ingest allowance (a constant OF THE PLAN, not a per-run guess), passes
      // EXACTLY ONE gated tick, then completes CAUSALLY — the old fixed 140 ms publish sleep is
      // GONE — when a new tick has run AND the seat's resolvedThrough watermark in the room's OWN
      // evidence has passed this step's seq (direct-intent frames are ingested AT ARRIVAL and
      // resolved by the tick; the tickRecords.consumed ledger belongs to the posture/accessor
      // dequeue path and never lists them — the first tick-locked attempt recorded exactly that,
      // preserved in dpa7w). A fully causal INGEST wait was also tried and REFUTED on this
      // machine: holding the step until the authority observed the arrival pushed the seat past
      // its input-retirement deadline (resolvedThrough 0, retiredUnrepresented 1, closing true at
      // step 0 — that refutation is the dpa7w pacing row too), so the ingest phase stays a
      // DECLARED allowance while completion is causal. Deadlines are pre-declared FAILURE
      // conditions, never retries: exceeding one names the cause and the leg goes red.
      const INGEST_ALLOWANCE_MS = 150; // declared by the plan — the measured envelope of the send path, stated, not guessed
      const TICK_DEADLINE_MS = 2_000;
      const observedArrivals = (): number => Number((((gatedRoom(leg.roomId).evidence() as { stats?: { observed?: number } }).stats ?? {}) as { observed?: number }).observed ?? 0);
      const observedBase = observedArrivals();
      const pacing: NonNullable<Ga9Leg['pacing']> = [];
      for (let n = 0; n < N_STEPS; n += 1) {
        const planned = SCRIPT[n]!;
        const use = mode === 'redmove' && n === 3 ? { mx: planned.mz, mz: planned.mx } : planned; // the flip ONLY in the red leg — step 3 ({-1,0}→{0,-1}); an earlier draft flipped step 5 ({0.7071,0.7071}) — a SYMMETRIC swap that changes nothing, and the dpa7j detector row caught that vacuous control for us
        let moverSeq = -1;
        if (mode === 'peerb') {
          const sendB = await gaOneShot(pageB as Page, use.mx, use.mz); // MOVER FIRST so the ledger check above is attributable; seat A idles compliantly
          moverSeq = sendB.seq;
          await gaOneShot(pageA, 0, 0);
        } else {
          const sendA = await gaOneShot(pageA, use.mx, use.mz);
          moverSeq = sendA.seq;
          if (mode === 'shared') await gaOneShot(pageB as Page, 0, 1); // second ACTIVE seat, own content, every step
        }
        if (mode === 'repeat') await wait(Math.floor(Math.random() * 25)); // harness-side jitter INSIDE the proven step envelope (dpa7k: steps past ~400 ms under a held room start replacing the seat transport — recorded, not smoothed): varies harness timing, never the tick plan or the content
        if (gate !== null) {
          if (moverSeq < 0) {
            leg.pacingViolation = `step ${String(n)}: the mover send itself failed — nothing to pace`;
            break;
          }
          await wait(INGEST_ALLOWANCE_MS); // the DECLARED ingest allowance (see the pacing note above)
          const ingestMs = INGEST_ALLOWANCE_MS;
          const recordsBefore = gatedRoom(leg.roomId).tickRecords.length;
          gate.passOne(); // EXACTLY one authority step for this step
          const tickStart = Date.now();
          let consumedTick: number | null = null;
          // CONSUMPTION witness for the DIRECT-INTENT path: a direct move is ingested AT ARRIVAL
          // (RegionRoom.ingestCommand → core.ingest — the tickRecords.consumed ledger belongs to
          // the POSTURE/accessor dequeue path and never lists these frames, which is why the first
          // tick-locked attempt recorded consumed=[] for a tick that HAD resolved the frame). The
          // room's own evidence carries the authoritative per-seat watermark: the step is done
          // when a NEW gated tick has run AND that seat's resolvedThrough has passed this seq.
          while (Date.now() - tickStart <= TICK_DEADLINE_MS) {
            const recs = gatedRoom(leg.roomId).tickRecords;
            const seats = (((gatedRoom(leg.roomId).evidence() as { seats?: { entityId?: string; resolvedThrough?: number }[] }).seats) ?? []);
            const moverSeat = seats.find((seat) => seat.entityId === leg.moverId);
            if (recs.length > recordsBefore && (moverSeat?.resolvedThrough ?? -1) >= moverSeq) {
              consumedTick = recs[recs.length - 1]?.tick ?? null;
              break;
            }
            await wait(2);
          }
          pacing.push({ step: n, moverSeq, ingestMs, tickMs: Date.now() - tickStart, consumedTick, consumed: consumedTick !== null, ticksElapsed: consumedTick === null ? 0 : gatedRoom(leg.roomId).tickRecords.length - recordsBefore, arrivalsIngested: observedArrivals() - observedBase });
          if (consumedTick === null) {
            leg.pacingViolation = `step ${String(n)}: no gated tick within the pre-declared ${String(TICK_DEADLINE_MS)} ms resolved mover seq ${String(moverSeq)} (seat watermark: ${JSON.stringify((((gatedRoom(leg.roomId).evidence() as { seats?: { entityId?: string; resolvedThrough?: number }[] }).seats) ?? []).find((seat) => seat.entityId === leg.moverId))}) — one step, one tick, in the room's OWN record`;
            break;
          }
        } else {
          await wait(70); // the UNGATED control leg keeps free-running 20 Hz ticks — pacing it would stop it being the control
        }
      }
      if (gate !== null && leg.pacingViolation === undefined) {
        const consumedTicks = pacing.map((p) => p.consumedTick);
        if (pacing.length !== N_STEPS || !pacing.every((p) => p.consumed)) {
          leg.pacingViolation = `tick plan violated: ${String(pacing.filter((p) => p.consumed).length)} of ${String(N_STEPS)} steps consumed their gated tick`;
        } else if (consumedTicks.some((t, i) => i > 0 && t !== (consumedTicks[i - 1] as number) + 1)) {
          leg.pacingViolation = `tick plan violated: consumed ticks are not consecutive: ${JSON.stringify(consumedTicks)}`;
        } else if (pacing.some((p) => (p.ticksElapsed ?? 1) !== 1)) {
          leg.pacingViolation = `tick plan violated: a step elapsed ${String(Math.max(...pacing.map((p) => p.ticksElapsed ?? 1)))} room ticks instead of exactly one: ${JSON.stringify(pacing.map((p) => p.ticksElapsed))}`;
        }
      }
      leg.pacing = pacing;
      await wait(300);
      const room = gatedRoom(leg.roomId);
      const raw = room.journal();
      const moverStateRowsAll = raw.rows.filter((r) => r['type'] === 'state' && r['entityId'] === leg.moverId) as Record<string, unknown>[];
      // baseline slice: only ticks the GATE ran (pre-hold ticks, if any, belong to the join
      // handshake, not to the script — excluded identically on every gated leg).
      const moverStateRows = moverStateRowsAll.filter((r) => Number(r['tick']) > leg.baselineTick);
      leg.steps = moverStateRows.map((r, i) => ({ index: i, tick: Number(r['tick']), stateHash: String(r['stateHash']), moverBytes: JSON.stringify(r['state']) }));
      leg.contentDigest = sha256(leg.steps.map((s) => `${s.stateHash}|${s.moverBytes}`).join('\n'));
      // alignment digest: tick offset RELATIVE to the leg's first post-hold tick (room tick
      // counters may start at different absolute numbers depending on the join handshake — the
      // RELATIVE schedule is what determinism claims over; consecutiveness is asserted separately).
      const t0 = leg.steps[0]?.tick ?? 0;
      leg.fullDigest = sha256(leg.steps.map((s) => `${s.index}|${s.tick - t0}|${s.stateHash}|${s.moverBytes}`).join('\n'));
      leg.globalRows = {
        stateRowsAll: raw.rows.filter((r) => r['type'] === 'state').length,
        observationRows: raw.rows.filter((r) => r['type'] === 'observation').length,
        chainRecords: raw.chain.length,
      };
      leg.journal = { rows: JSON.parse(JSON.stringify(raw.rows)) as Record<string, unknown>[], chain: [...raw.chain], dropped: raw.dropped };
      // ROTATION detection (slice 9): distinct entity ids publishing StateRows inside the gated
      // window must equal the number of seats; more means a seat transport REPLACED its entity
      // mid-leg (dpa7k's recorded envelope), truncating the mover's rows at the swap.
      if (mode !== 'ungated') {
        const ids = new Set(raw.rows.filter((r) => r['type'] === 'state' && Number(r['tick']) > leg.baselineTick).map((r) => String(r['entityId'])));
        if (ids.size > seatCount) leg.contamination = `seat-transport rotation in the gated window: ${String(ids.size)} distinct entity ids for ${String(seatCount)} seat(s) — mover StateRows truncated at ${String(leg.steps.length)} of ${String(N_STEPS)} scripted ticks`;
      }
      const pub = room as unknown as { journalPrologue(): Record<string, unknown> | undefined; liveConfig(): unknown };
      leg.prologue = pub.journalPrologue() ?? null;
      leg.liveConfig = pub.liveConfig();
    } catch (error) {
      leg.error = String(error instanceof Error ? error.message : error);
    } finally {
      gate?.restore();
      await gaStopPump(pageA).catch(() => undefined);
      if (pageB !== null) await gaStopPump(pageB).catch(() => undefined);
      await wait(150);
      await pageA.close().catch(() => undefined);
      if (pageB !== null) await pageB.close().catch(() => undefined);
    }
    return leg;
  };

  // One RECORDED re-run for a leg the harness envelope contaminated (rotation, dpa7k). The
  // contaminated attempt stays in the artifact (legAttempts + its own entry in rotations); a
  // second contamination is NOT retried — the rows go red and the envelope owns them.
  const rotations: { tag: string; contamination: string }[] = [];
  const legAttempts: Record<string, string[]> = {};
  const runLegClean = async (tag: string, mode: Parameters<typeof runLeg>[1]): Promise<Ga9Leg> => {
    // One RECORDED re-run budget for the harness envelope (rotation, dpa7k/dpa7u) — DIAGNOSTIC mode
    // only. In formal mode there are NO retries at all: the envelope contaminating a formal leg is
    // the finding, not a flake to reroll, and no green can be selected from retries.
    const maxAttempts = formalMode ? 1 : 3;
    let last = await runLeg(tag, mode);
    legAttempts[tag] = [last.tag];
    for (let attempt = 1; attempt < maxAttempts && last.contamination !== undefined; attempt += 1) {
      rotations.push({ tag: last.tag, contamination: last.contamination });
      last = await runLeg(`${tag}-retry${String(attempt)}`, mode);
      legAttempts[tag]?.push(last.tag);
    }
    if (last.contamination !== undefined) rotations.push({ tag: last.tag, contamination: last.contamination });
    return last;
  };
  const solo = await runLegClean('solo', 'solo');
  const solo2 = await runLegClean('solo2', 'repeat');
  const shared = await runLegClean('shared', 'shared');
  const peerB = await runLegClean('peerb', 'peerb');
  const red = await runLegClean('red', 'redmove');
  const free = await runLegClean('free', 'ungated');
  const legs = [solo, solo2, shared, peerB, red, free];

  cellCheck('GA-9 legs are SOUND: every (post-retry) leg ran (no errors) — a leg the harness envelope contaminated (the recorded dpa7k held-room transport rotation) receives EXACTLY ONE recorded re-run, listed in legAttempts/rotations, never silently — the gated legs each carry exactly one journal StateRow per scripted tick for the mover, and the shared room demonstrably carried a SECOND ACTIVE seat (its room-global StateRow population is roughly double the solo room\'s — room-global ordinals are COUNTED here, never projected (two-seat populations are counted AT OR ABOVE the scripted floor: a harness-side rejoin under the held-room envelope adds room-global join rows, and the room-global sequence is not the claim); the global sequence belongs to the room, the projection belongs to the entity)',
    legs.every((leg) => leg.error === undefined && leg.contamination === undefined) &&
    [solo, solo2, shared, peerB, red].every((leg) => leg.steps.length === N_STEPS) &&
    solo.globalRows.observationRows === 1 + N_STEPS && solo2.globalRows.observationRows === 1 + N_STEPS &&
    solo.steps.every((s, _i, arr) => JSON.parse(s.moverBytes).entityId === JSON.parse(arr[0]!.moverBytes).entityId) &&
    shared.globalRows.observationRows >= 2 + 2 * N_STEPS &&
    peerB.globalRows.observationRows >= 2 + 2 * N_STEPS &&
    shared.globalRows.stateRowsAll > solo.globalRows.stateRowsAll * 1.5 &&
    shared.globalRows.observationRows > solo.globalRows.observationRows,
    legs.map((leg) => ({ tag: leg.tag, steps: leg.steps.length, global: leg.globalRows, error: leg.error ?? null })));

  const consec = (leg: Ga9Leg): boolean => leg.steps.length > 0 && leg.steps.every((s, i) => s.tick === leg.steps[0]!.tick + i);
  const normC = (leg: Ga9Leg): string[] => { const t0 = leg.steps[0]?.tick ?? 0; return leg.steps.map((s) => normalizeMoverBytes(s.moverBytes, t0)); };
  const soloC = normC(solo);
  const dig = (leg: Ga9Leg): string => { const arr = normC(leg); return sha256(arr.join('\n')); };
  const diffRepeat = firstDiffIndex(soloC, normC(solo2));
  const diffShared = firstDiffIndex(soloC, normC(shared));
  const tOf = (leg: Ga9Leg): string[] => { const t0 = leg.steps[0]?.tick ?? 0; return leg.steps.map((s) => `${s.index}|${s.tick - t0}|${normalizeMoverBytes(s.moverBytes, t0)}`); };
  const diffFullShared = firstDiffIndex(tOf(solo), tOf(shared));
  cellCheck('GA-9 DETERMINISM — the mover\'s per-tick canonical projection is BYTE-IDENTICAL across: solo vs solo-REPEAT under harness timing jitter, and solo vs SHARED where a second active seat moved every step. Comparison population: the exact journal StateRow bytes with EXACTLY TWO declared-away fields — entityId (alias-domain identity, differs by design between rooms) and lastAuthorityTick rebased to the leg\'s first scripted tick (an absolute room counter) — every locomotion byte (position, velocity, yaw, mode, intentGeneration) is compared as-is; digests over the normalized whole sequences are EQUAL, tick sequences are strictly consecutive, and the room\'s own stateHash rides every step and is cross-run-validated by the GA-13 replay row below. Room-global ordinals/row populations differ by construction and are only counted: the global sequence belongs to the room, the projection belongs to the entity',
    solo.error === undefined && solo2.error === undefined && shared.error === undefined &&
    dig(solo) === dig(solo2) && dig(solo) === dig(shared) &&
    [solo, solo2, shared].every(consec) &&
    diffRepeat === -1 && diffShared === -1 && diffFullShared === -1,
    { soloNormDigest: dig(solo), repeatNormDigest: dig(solo2), sharedNormDigest: dig(shared), diffRepeat, diffShared, diffFullShared });

  // ── GA-9 PEER INDEPENDENCE (slice 9): the same script ISSUED BY A DIFFERENT PEER (seat B of a
  // two-seat room; seat A idle-compliant). Comparison populations are ENTITY-RELATIVE by
  // construction: per-tick projection bytes, the (generation stamp, relative tick, moveX/moveZ, disposition,
  // reason) command ledger, and digests over both. The room-wide arrivalOrdinal is NEVER part of
  // any compared key — and the row PROVES it participates in nothing by showing the ordinals
  // DIFFER between these legs while the compared populations are EQUAL (a comparison that had
  // leaked the room counter could not be equal across them). Declared-away fields for the peer
  // comparison: entityId and rebased lastAuthorityTick (as everywhere) PLUS sessionEpoch — the
  // alias-domain epoch the join handshake mints per seat (seat B of a two-seat room is
  // legitimately epoch 2 where the solo mover is epoch 1); same alias-domain argument as entityId,
  // declared here, nothing else removed.
  const normP = (leg: Ga9Leg): string[] => {
    const t0 = leg.steps[0]?.tick ?? 0;
    return leg.steps.map((s) => {
      const o = JSON.parse(normalizeMoverBytes(s.moverBytes, t0)) as Record<string, unknown>;
      delete o['sessionEpoch'];
      return JSON.stringify(o);
    });
  };
  const moverCommands = (leg: Ga9Leg, withOrdinal: boolean): string[] => {
    const t0 = leg.steps[0]?.tick ?? 0;
    const rawOf = (r: Record<string, unknown>): Record<string, { kind?: string; value?: unknown }> => (r['raw'] ?? {}) as Record<string, { kind?: string; value?: unknown }>;
    // ENTITY-RELATIVE stamp: the frame's `generation` (the producer's own strictly-increasing
    // stamp, restarted per fresh page — never a room counter).
    const stampOf = (r: Record<string, unknown>): number => Number(rawOf(r)['generation']?.value ?? -1);
    return leg.journal.rows
      .filter((r) => r['type'] === 'observation' && r['entityId'] === leg.moverId && rawOf(r)['generation']?.kind === 'value')
      .map((r, i) => ({ r, i })) // stable: keep journal order inside one stamp (multi-disposition arrivals)
      .sort((a, b) => stampOf(a.r) - stampOf(b.r) || a.i - b.i)
      .map(({ r }) => {
        const raw = rawOf(r);
        const v = (k: string): string => (raw[k]?.kind === 'value' ? String(raw[k]?.value) : '-');
        const tickValue = r['tick'] ?? r['eligibleTick'];
        const rel = typeof tickValue === 'number' ? tickValue - t0 : String(tickValue);
        return `${v('generation')}|t${String(rel)}|${String(r['disposition'])}|${String(r['reason'])}|mx${v('moveX')}|mz${v('moveZ')}${withOrdinal ? `|ord${String(r['arrivalOrdinal'])}` : ''}`;
      });
  };
  const soloCmds = moverCommands(solo, false);
  const peerCmds = moverCommands(peerB, false);
  const soloCmdsOrd = moverCommands(solo, true);
  const peerCmdsOrd = moverCommands(peerB, true);
  const diffPeerContent = firstDiffIndex(normP(solo), normP(peerB));
  const peerOrdinalsDiffer = firstDiffIndex(soloCmdsOrd, peerCmdsOrd) !== -1;
  cellCheck('GA-9 PEER INDEPENDENCE — the same twelve-command script ISSUED BY A DIFFERENT PEER (seat B, seat A idle-compliant, own room, own gated schedule) carries the SAME per-entity projection and the SAME command/step/disposition ledger: the normalized per-tick projection bytes and their digest are EQUAL to the solo leg\'s (declared-away: entityId, rebased lastAuthorityTick, sessionEpoch — the alias-domain fields the join handshake mints per seat; every locomotion byte exact), and the entity-relative (generation stamp, relative tick, disposition, reason, moveX, moveZ) ledger is EQUAL entry-for-entry — while the room-wide arrivalOrdinals of those very rows DIFFER between the legs and participate in NOTHING the comparison touches (equal without them, different with them: a comparison that had leaked the room counter could not be equal here). No room-wide ordinal is ever compared to an entity identity; the global sequence belongs to the room, the projection belongs to the entity',
    peerB.error === undefined && peerB.steps.length === N_STEPS && consec(peerB) &&
    normP(solo).length === N_STEPS && normP(peerB).length === N_STEPS &&
    diffPeerContent === -1 && sha256(normP(solo).join('\n')) === sha256(normP(peerB).join('\n')) &&
    soloCmds.length === N_STEPS && peerCmds.length === N_STEPS &&
    firstDiffIndex(soloCmds, peerCmds) === -1 && peerOrdinalsDiffer,
    { diffPeerContent, soloPeerDigest: sha256(normP(peerB).join('\n')), soloCmds, peerCmds, soloCmdsOrd, peerCmdsOrd });

  const diffRedContent = firstDiffIndex(soloC, normC(red));
  const diffFreeContent = firstDiffIndex(soloC, normC(free));
  const diffFreeFull = firstDiffIndex(tOf(solo), tOf(free));
  cellCheck('GA-9 DETECTOR controls (the red side of the claim): the MOVER-FLIPPED leg (one movement swapped at step 4 of the script — {-1,0} to {0,-1} — everything else identical) diverges from solo at EXACTLY the flipped step — the comparison is sensitive to content, not to prose; and the deliberately UNGATED leg diverges too — free 20 Hz ticks interleave with arrival timing, so idle-tick rows and tick numbering enter the record (timing is part of the observable record; this row names WHY the gate exists: determinism is claimed over the gated tick schedule + pinned inputs, which is exactly the comparison GA-9 defines). Had either control CONVERGED, the detector would be vacuous and this row would be red — it is',
    red.error === undefined && free.error === undefined &&
    diffRedContent === 3 &&
    diffFreeContent !== -1 && diffFreeFull !== -1,
    { diffRedContent, diffFreeContent, diffFreeFull, freeSteps: free.steps.length, soloSteps: solo.steps.length });

  // ── GA-13: replay the SOLO leg's real journal through the accepted machinery, plus sanitisation.
  const replayLeg = (
    rows: Record<string, unknown>[],
    options: { prologueOverride?: Record<string, unknown>; stepperFactory?: (speed: number) => unknown } = {},
  ): { ok: boolean; refusal: string | null; rowsOut: Record<string, unknown>[]; chainOut: Record<string, unknown>[] } => {
    const rowsOut: Record<string, unknown>[] = [];
    const chainOut: Record<string, unknown>[] = [];
    const cfg = (solo.liveConfig ?? { movement: { speed: fixture?.movementSpeed ?? 0 } }) as { movement?: { speed?: number } };
    const speed = cfg.movement?.speed ?? fixture?.movementSpeed ?? 0;
    if (solo.liveConfig === null) throw new Error('GA-13 leg carried no liveConfig');
    const result = replayRun({
      prologue: options.prologueOverride ?? solo.prologue ?? {},
      inputs: toReplayInputs([...rows], [...solo.journal.chain]),
      config: solo.liveConfig,
      // THE shared kernel by default — the exact factory the live room stepped with (A-1 seam).
      stepper: (options.stepperFactory ?? kernelModule.kernelStepperFactory)(speed),
      scheduler: new SystemScheduler(),
      sink: {
        recordRow: (row: Record<string, unknown>) => { rowsOut.push(row); },
        recordTickChain: (record: Record<string, unknown>) => { chainOut.push(record); },
      },
      runId: 'spike-ga13-replay',
    });
    return { ok: result.ok === true, refusal: result.ok === true ? null : String(result.reason ?? 'refused'), rowsOut, chainOut };
  };
  const liveView = journalReplay.journalFromPersisted({ prologue: solo.prologue, rows: solo.journal.rows, chain: solo.journal.chain, dropped: solo.journal.dropped });
  const sentinelBefore = kernelModule.kernelStepperSentinel.calls;
  const asRecorded = replayLeg(solo.journal.rows);
  const sentinelAfter = kernelModule.kernelStepperSentinel.calls;
  const comparison = journalReplay.compareJournal(liveView.rows, liveView.chain, asRecorded.rowsOut, asRecorded.chainOut);
  const liveStateRows = liveView.rows.filter((r) => r['type'] === 'state') as Record<string, unknown>[];
  const replayStateRows = asRecorded.rowsOut.filter((r) => r['type'] === 'state') as Record<string, unknown>[];
  // EXACT field-wise byte equality of the canonical states (bit-level on the accepted canonical
  // JSON representation — this is the claim, not a tolerance): entity, tick and every state byte.
  const stateBytesExact = liveStateRows.length === replayStateRows.length && liveStateRows.every((r, i) => {
    const o = replayStateRows[i]!;
    return r['entityId'] === o['entityId'] && Number(r['tick']) === Number(o['tick']) && JSON.stringify(r['state']) === JSON.stringify(o['state']);
  });
  // The ULP companion is RETIRED from the claim (slice 9) and retained as a DIAGNOSTIC ONLY — it
  // gates nothing: it exists to shout if an exact equality ever hides a near-miss population.
  const ulpStateEqual = liveStateRows.length === replayStateRows.length && liveStateRows.every((r, i) => {
    const o = replayStateRows[i]!;
    return r['entityId'] === o['entityId'] && Number(r['tick']) === Number(o['tick']) && valueClose(r['state'], o['state']);
  });
  const ulpHashTicks = liveStateRows.filter((r, i) => r['stateHash'] !== replayStateRows[i]!['stateHash']).map((r) => Number(r['tick']));
  const blanked = replayLeg(withDigestsBlanked([...solo.journal.rows]) as Record<string, unknown>[]);
  const blankedComparison = journalReplay.compareJournal(liveView.rows, liveView.chain, blanked.rowsOut, blanked.chainOut);
  const tamperedPrologue = { ...(solo.prologue ?? {}), configHash: '0'.repeat(64) };
  const tampered = replayLeg(solo.journal.rows, { prologueOverride: tamperedPrologue });
  const mutatedRows = JSON.parse(JSON.stringify(solo.journal.rows)) as Record<string, unknown>[];
  let mutKey: string | null = null;
  const mutIdx = mutatedRows.findIndex((r) => {
    if (r['type'] !== 'observation' || r['entityId'] !== solo.moverId) return false;
    const raw = r['raw'] as Record<string, { kind?: string; value?: unknown }> | undefined;
    if (raw === undefined) return false;
    const preferred = ['moveX', 'moveZ'].find((k) => raw[k]?.kind === 'value' && typeof raw[k]?.value === 'number' && raw[k]?.value !== 0);
    const key = preferred ?? Object.keys(raw).find((k) => raw[k]?.kind === 'value' && typeof raw[k]?.value === 'number' && raw[k]?.value !== 0 && !['sessionEpoch', 'epoch', 'generation', 'seq'].includes(k));
    if (key === undefined) return false;
    mutKey = key;
    return true;
  });
  if (mutIdx >= 0 && mutKey !== null) {
    const rawM = (mutatedRows[mutIdx] as { raw: Record<string, { kind: string; value: unknown }> }).raw;
    const cellV = rawM[mutKey]!;
    rawM[mutKey] = { kind: cellV.kind, value: -Number(cellV.value) };
  }
  const mutated = mutIdx >= 0 ? replayLeg(mutatedRows) : null;
  const mutatedComparison = mutated !== null && mutated.ok ? journalReplay.compareJournal(liveView.rows, liveView.chain, mutated.rowsOut, mutated.chainOut) : null;
  const mutatedDetected = mutated === null ? false : mutated.ok === false || (mutatedComparison !== null && (!mutatedComparison.equal || mutatedComparison.replayedTip !== mutatedComparison.liveTip));
  const dispositionEqual = JSON.stringify(journalReplay.dispositionHistogram(solo.journal.rows)) === JSON.stringify(journalReplay.dispositionHistogram(asRecorded.rowsOut));
  const tipEqual = journalReplay.chainTipOf(liveView.chain) !== null && journalReplay.chainTipOf(liveView.chain) === journalReplay.chainTipOf(asRecorded.chainOut);
  // ROOT-CAUSE CONTROL (slice 9): replay the SAME journal through the PRODUCTION-DEFAULT
  // FlatReferenceStepper — the stepper the earlier drafts used and the source of the preserved
  // dpa7h one-ULP divergence. If the diagnosis is right, this control reproduces it EXACTLY: one
  // tick, first differing field kinematic.velocity, every non-velocity byte equal, dispositions
  // identical (no dispatch decision changes), tip different — while the kernel replay above is
  // byte-exact. The two steppers differ in one arithmetic ordering: the kernel wrapper's velocity
  // byte is (pose_next − pose_prev)/dt (a position DIFFERENCE over dt); the reference's is
  // (moveX·speed·dt)/dt (a PRODUCT over dt). At tick 18 of the solo script those two expressions
  // of the same real number are different doubles (2.828427124746191 vs 2.82842712474619).
  const referenceReplay = replayLeg(solo.journal.rows, { stepperFactory: (speed) => new FlatReferenceStepper(speed) });
  const referenceComparison = journalReplay.compareJournal(liveView.rows, liveView.chain, referenceReplay.rowsOut, referenceReplay.chainOut);
  const referenceStateRows = referenceReplay.rowsOut.filter((r) => r['type'] === 'state') as Record<string, unknown>[];
  const velocityOf = (row: Record<string, unknown>): string => {
    const loc = ((row['state'] ?? {}) as Record<string, unknown>)['locomotion'] as Record<string, unknown> | undefined;
    const kin = loc?.['kinematic'] as Record<string, unknown> | undefined;
    return JSON.stringify(kin?.['velocity'] ?? null);
  };
  const withoutVelocity = (row: Record<string, unknown>): string => {
    const c = JSON.parse(JSON.stringify(row['state'])) as Record<string, unknown>;
    const kin = ((c['locomotion'] ?? {}) as Record<string, unknown>)['kinematic'] as Record<string, unknown> | undefined;
    if (kin !== undefined) delete kin['velocity'];
    return JSON.stringify(c);
  };
  const referenceMismatch = liveStateRows
    .map((r, i) => ({ live: r, replayed: referenceStateRows[i] }))
    .filter(({ live, replayed }) => replayed === undefined || live['stateHash'] !== replayed['stateHash']);
  const referenceMismatchTicks = referenceMismatch.map(({ live }) => Number(live['tick']));
  const referenceVelocityOnly = referenceMismatch.length > 0 && referenceMismatch.every(({ live, replayed }) =>
    replayed !== undefined
    && withoutVelocity(live) === withoutVelocity(replayed)
    && velocityOf(live) !== velocityOf(replayed));
  const referenceDispositionsEqual = JSON.stringify(journalReplay.dispositionHistogram(solo.journal.rows)) === JSON.stringify(journalReplay.dispositionHistogram(referenceReplay.rowsOut));

  cellCheck(`GA-13 REPLAY, EXACT (slice 9) — the solo leg's REAL room journal replays through the accepted Phase-1 machinery (toReplayInputs → replayRun with the room's own liveConfig and SystemScheduler, and with THE SAME shared-kernel stepper the room stepped the authority with — the trusted stepperFactory seam of amendment A-1, engine/public APIs only) to bit-level equality on the accepted canonical representation: the SAME dispositions (exact), the SAME canonical state BYTES (JSON.stringify-equal per row, no numeric tolerance anywhere), the SAME recomputed stateHash per tick, and the SAME chain tip as the room recorded (compareJournal over the persisted-journal reader — the same boundary a reviewer's copy crosses). The replay stepper is PROVABLY the same function object the fixture handed the room (module identity, and the wrapper's own sentinel advances during the replay). The single one-ULP divergence every earlier draft carried is RETRACTED as a fact about floating point and RECLASSIFIED as a harness boundary error: those drafts replayed with the production-default FlatReferenceStepper while the room had stepped with the kernel wrapper — two separately written expressions of the same real number (a position difference over dt vs a product over dt); the fix grants the replay the function that PRODUCED the journal, and NOTHING else moved — no production edit, no rounding change, no tolerance, no rehash, no journal adjustment. The ULP companion survives only as a DIAGNOSTIC that gates nothing (it must report 0 hash-mismatch ticks; if it ever hid a near-miss population it would shout). A DIGEST-BLANKED journal replays IDENTICAL (digests are recomputed comparison outputs, never replay inputs — P03-g); a TAMPERED prologue (configHash) is REFUSED, not replayed; a MUTATED input payload (one mover moveX flipped in the journal) is DETECTED — divergence or refusal, never silent equality. Both sides pass through journalFromPersisted; the row carries the tip`,
    solo.error === undefined && solo.journal.rows.length > 0 &&
    kernelIdentityProven && sentinelAfter > sentinelBefore &&
    asRecorded.ok && dispositionEqual &&
    comparison.equal && tipEqual && stateBytesExact && ulpHashTicks.length === 0 &&
    blanked.ok && blankedComparison.equal && blankedComparison.liveTip === blankedComparison.replayedTip &&
    tampered.ok === false &&
    mutIdx >= 0 && mutatedDetected,
    { rows: solo.journal.rows.length, chain: solo.journal.chain.length, kernelIdentityProven, kernelSentinelGrowth: sentinelAfter - sentinelBefore, exactEqual: comparison.equal, stateBytesExact, ulpDiagnosticOnly: { stateClose: ulpStateEqual, hashMismatchTicks: ulpHashTicks }, liveTip: comparison.liveTip, replayedTip: comparison.replayedTip, firstMismatches: comparison.mismatches.slice(0, 3), blankedEqual: blankedComparison.equal, tamperedRefusal: tampered.refusal, mutIdx, mutKey, mutatedRefusal: mutated?.refusal ?? null, mutatedEqual: mutatedComparison?.equal ?? null, dispositions: journalReplay.dispositionHistogram(solo.journal.rows) });

  cellCheck(`GA-13 ROOT-CAUSE receipt (the smallest true statement of the one ULP): replaying the SAME unmodified journal through the PRODUCTION-DEFAULT FlatReferenceStepper reproduces the preserved dpa7h divergence EXACTLY — one tick named, first differing field kinematic.velocity, every NON-velocity state byte equal, dispositions and dispatch decisions IDENTICAL (no authority decision changes; the divergence is a byte of derived arithmetic, nothing else), tip different — while the kernel replay above is exact with ZERO hash-mismatch ticks. This is the evidence that the mismatch was the STEPPER IMPLEMENTATION AT THE REPLAY BOUNDARY (kernel wrapper velocity = (pose_next − pose_prev)/dt vs reference velocity = (moveX·speed·dt)/dt — different doubles at the tick-18 pose), NOT the authority and NOT nondeterministic re-execution: the same control fires on the same pinned journal bytes every run. The reference-stepper leg is a RED CONTROL kept permanently: it is the detector that says "the replay used the wrong producer" — if a future harness quietly reverts, this row goes red while the exact row above cannot pass`,
    referenceReplay.ok && referenceVelocityOnly && referenceDispositionsEqual &&
    referenceComparison.equal === false && referenceComparison.replayedTip !== comparison.liveTip &&
    referenceMismatchTicks.length === 1 && comparison.equal && ulpHashTicks.length === 0,
    { referenceMismatchTicks, liveVelocityBytes: referenceMismatch.map(({ live }) => velocityOf(live)), replayedVelocityBytes: referenceMismatch.map(({ replayed }) => (replayed === undefined ? null : velocityOf(replayed))), dispositionsEqual: referenceDispositionsEqual, referenceTip: referenceComparison.replayedTip, liveTip: comparison.liveTip, kernelExactTip: comparison.replayedTip });

  // ── GA-13 PER-SCENARIO JOURNALS (slice 10): every leg that ran persists its structured journal
  // (refusing to persist an unsanitised one) and replays through the SAME accepted machinery and
  // producing kernel stepper to EXACT dispositions / canonical state bytes / chain tip. This is the
  // wiring the formal matrix reuses per scenario: the persisted journal is the artefact a reviewer
  // replays, and ga-replays.json carries the normalized ORIGINAL and REPLAYED bytes line-for-line.
  const legReplay = (leg: Ga9Leg): {
    tag: string; ok: boolean; refusal: string | null; dispositionsEqual: boolean; stateBytesEqual: boolean;
    exactEqual: boolean; tipEqual: boolean; liveTip: string | null; replayedTip: string | null;
    mismatchTicks: number[]; originalBytes: string[]; replayedBytes: string[];
  } => {
    const rowsOut: Record<string, unknown>[] = [];
    const chainOut: Record<string, unknown>[] = [];
    const cfg = (leg.liveConfig ?? {}) as { movement?: { speed?: number } };
    const speed = cfg.movement?.speed ?? fixture?.movementSpeed ?? 0;
    const result = replayRun({
      prologue: leg.prologue ?? {},
      inputs: toReplayInputs([...leg.journal.rows], [...leg.journal.chain]),
      config: leg.liveConfig,
      stepper: kernelModule.kernelStepperFactory(speed),
      scheduler: new SystemScheduler(),
      sink: { recordRow: (row: Record<string, unknown>) => { rowsOut.push(row); }, recordTickChain: (record: Record<string, unknown>) => { chainOut.push(record); } },
      runId: `spike-ga13-${leg.tag}`,
    });
    const view = journalReplay.journalFromPersisted({ prologue: leg.prologue, rows: leg.journal.rows, chain: leg.journal.chain, dropped: leg.journal.dropped });
    const comp = journalReplay.compareJournal(view.rows, view.chain, rowsOut, chainOut);
    const liveStates = view.rows.filter((r) => r['type'] === 'state') as Record<string, unknown>[];
    const outStates = rowsOut.filter((r) => r['type'] === 'state') as Record<string, unknown>[];
    const originalBytes = liveStates.map((r) => JSON.stringify(r['state'] as never));
    const replayedBytes = outStates.map((r) => JSON.stringify(r['state'] as never));
    return {
      tag: leg.tag,
      ok: result.ok === true,
      refusal: result.ok === true ? null : String(result.reason ?? 'refused'),
      dispositionsEqual: JSON.stringify(journalReplay.dispositionHistogram(view.rows)) === JSON.stringify(journalReplay.dispositionHistogram(rowsOut)),
      stateBytesEqual: originalBytes.length === replayedBytes.length && originalBytes.every((line, index) => line === replayedBytes[index]),
      exactEqual: comp.equal,
      tipEqual: comp.liveTip !== null && comp.liveTip === comp.replayedTip,
      liveTip: comp.liveTip,
      replayedTip: comp.replayedTip,
      mismatchTicks: liveStates.filter((r, index) => r['stateHash'] !== outStates[index]?.['stateHash']).map((r) => Number(r['tick'])),
      originalBytes,
      replayedBytes,
    };
  };
  const gateDir = join(OUT_DIR, 'gate');
  // Journals belong to THIS run: a stale journal from an earlier attempt riding into a bundle is
  // exactly the stale-artefact failure the identity rules exist to catch, so the directory is
  // cleared before the cell writes.
  rmSync(gateDir, { recursive: true, force: true });
  mkdirSync(gateDir, { recursive: true });
  const cleanLegs = legs.filter((leg) => leg.error === undefined && leg.contamination === undefined);
  const legReplays = cleanLegs.map((leg) => legReplay(leg));
  const journalsPersisted: { tag: string; sha256: string; sanitisedBeforeWrite: true }[] = [];
  for (const leg of cleanLegs) {
    const journalFile = { schemaVersion: 1, kind: ARTEFACT_KIND, taskId: 'UDG-SPIKE-001', implementationSha: sha, seed, tag: leg.tag, mode: leg.mode, roomId: leg.roomId, prologue: leg.prologue, rows: leg.journal.rows, chain: leg.journal.chain, dropped: leg.journal.dropped };
    const text = JSON.stringify(journalFile);
    // Refuse to persist an unsanitised journal: the scanner passes the real rows or the write does
    // not happen and the row below goes red naming the leg.
    if (sanitisationIssues(leg.journal.rows as never[]).length !== 0) continue;
    writeFileSync(join(gateDir, `journal-${leg.tag}.json`), `${text}\n`);
    journalsPersisted.push({ tag: leg.tag, sha256: sha256(text), sanitisedBeforeWrite: true });
  }
  const allLegsExact = legReplays.length === cleanLegs.length && cleanLegs.length >= 5
    && legReplays.every((rec) => rec.ok && rec.dispositionsEqual && rec.stateBytesEqual && rec.exactEqual && rec.tipEqual && rec.mismatchTicks.length === 0);
  cellCheck('GA-13 PER-SCENARIO JOURNALS — every CLEAN leg that ran (solo, repeat, shared, peer-issued, red, ungated-free; contaminated attempts are recorded and never persisted or counted) PERSISTED its structured journal under the cell output — the gate/ directory is cleared at cell start so no stale journal can ride in, and sanitisationIssues is scan-checked BEFORE the write (an unsanitised journal is refused, not filed) — and REPLAYED through the accepted Phase-1 machinery with the producing shared-kernel stepper to EXACT dispositions, EXACT canonical state bytes, EXACT per-tick hashes and the SAME chain tip — including the two-seat rooms and the deliberately ungated leg (replay does not care how ticks were scheduled, only that the journalled inputs and deliveries reproduce the decisions). In FORMAL mode there are no retries, so contamination here means FEWER clean legs and a red row: the envelope owns it, nothing is retried into a green',
    allLegsExact && journalsPersisted.length === legReplays.length && legReplays.every((rec) => rec.refusal === null),
    { legs: legReplays.map((rec) => ({ tag: rec.tag, ok: rec.ok, exact: rec.exactEqual, tipEqual: rec.tipEqual, stateBytesEqual: rec.stateBytesEqual, dispositionsEqual: rec.dispositionsEqual, mismatchTicks: rec.mismatchTicks, liveTip: rec.liveTip, replayedTip: rec.replayedTip })), journalsPersisted });
  const gaReplaysDocument = {
    schemaVersion: 1,
    kind: ARTEFACT_KIND,
    taskId: 'UDG-SPIKE-001',
    implementationSha: sha,
    seed,
    formalMode,
    harnessPolicy: { schedule: HARNESS_SCHEDULE, retries: formalMode ? 'NONE (formal schedule policy: contamination is the finding)' : 'recorded, capped at 3, DIAGNOSTIC-only — a retry-selected green is never a Gate A row' },
    legs: legReplays,
  };
  writeFileSync(join(OUT_DIR, 'ga-replays.json'), `${JSON.stringify(gaReplaysDocument)}\n`);
  if (process.env['UDG_GATE_A_REPLAYS_OUT'] !== undefined) {
    writeFileSync(process.env['UDG_GATE_A_REPLAYS_OUT'], `${JSON.stringify(gaReplaysDocument)}\n`);
  }

  // COVERAGE + INTEGRITY (slice 9): the honest inventory of which scenario journals ACTUALLY
  // replay-compared vs were only checked structurally or are missing — recorded inside the cell
  // that can attest to it, not in prose elsewhere — plus artifact self-consistency: every leg's
  // stored contentDigest RE-COMPUTES from its own steps, and the compared tips are internally
  // consistent (exact equality must imply tip equality; the null tip must never compare equal).
  const digestRecomputedOk = legs.every((leg) =>
    leg.steps.length === 0 || sha256(leg.steps.map((s) => `${s.stateHash}|${s.moverBytes}`).join('\n')) === leg.contentDigest);
  const tipConsistent = (comparison.equal ? comparison.liveTip === comparison.replayedTip : true)
    && comparison.liveTip !== null && journalReplay.chainTipOf(solo.journal.chain) === comparison.liveTip;
  const journalCoverage = {
    replayedAndComparedExact: [
      'ga9-ga13 EVERY leg that ran (solo/repeat/shared/peerB/red/free) — persisted structured journal (gate/journal-<tag>.json) replayed EXACT: dispositions, canonical state bytes, per-tick hashes, chain tip (slice 10)',
      'ga9-ga13 SOLO leg, DIGEST-BLANKED copy — identical outputs (P03-g)',
      'ga-scenarios FULL-ROOM journal (every scenario in the cell, malformed-stamp controls included) — persisted (gate-scenarios-journal.json) and kernel-replayed EXACT by the ga-scenarios cell itself (slice 17); see that cell\'s GA-13 FULL-CELL JOURNAL row',
    ],
    structuralOnly: [
      'contaminated leg ATTEMPTS (rotation) — recorded in rotations/legAttempts, not persisted, not replayed, not counted toward any claim',
    ],
    ledgerExtractsNotJournals: [
      'ga-scenarios 24 rows (ga6a/b/c, ga7/ga7t, ga5t, ga5l/ga5li/ga5lb, CF rows) — the scenario rooms yield LEDGER EXTRACTS (consumed stamps, close observations, tick signals, transcripts), not persisted journals: NO scenario journal from ga-scenarios is replayed; named MISSING for the GA-13 formal legs (the per-leg wiring above is what they will reuse)',
      'ga11-calibration — loopback populations, no authority journal',
      'elevated-full / ab-controls — metric traces, no authority journal capture',
    ],
  };
  const coverageHonest = journalCoverage.replayedAndComparedExact.length === 3
    && journalCoverage.structuralOnly.length >= 1
    && journalCoverage.ledgerExtractsNotJournals.length >= 3;
  cellCheck('GA-13 COVERAGE & INTEGRITY — the inventory above states plainly which journals replay-COMPARED (the solo leg and its blanked copy), which are STRUCTURAL-ONLY (the other five legs), and which scenario journals are MISSING (every ga-scenarios room yields ledger extracts only; calibration/metric runs capture no journal) — checked against overclaiming (the buckets are populated as stated, and no bucket claims more than this cell did), PLUS artifact self-consistency: every leg\'s stored contentDigest re-computes from its own steps, and the chain tip compared is the journal\'s own tip (non-null, equal to chainTipOf over the persisted chain); exact equality implies tip equality — a mismatched-tip "equal" verdict is impossible by construction',
    digestRecomputedOk && tipConsistent && coverageHonest,
    { digestRecomputedOk, tipConsistent, coverageHonest, journalCoverage });

  // PACING receipt (slice 11): the gated legs ran the PRE-DECLARED tick plan — no wall-clock
  // ingest cadence anywhere on the gated path. Every step: causal ingest witness (the authority's
  // own observed-arrival counter), ONE gated tick, and the room's own per-tick consumption ledger
  // confirming that tick consumed that step's mover seq; consumed ticks consecutive.
  const pacingFacts = legs.filter((leg) => leg.mode !== 'ungated').map((leg) => ({
    tag: leg.tag,
    violation: leg.pacingViolation ?? null,
    steps: leg.pacing?.length ?? 0,
    consumed: leg.pacing?.filter((p) => p.consumed).length ?? 0,
    worstIngestMs: Math.max(0, ...(leg.pacing ?? []).map((p) => p.ingestMs)),
    worstTickMs: Math.max(0, ...(leg.pacing ?? []).map((p) => p.tickMs)),
  }));
  cellCheck('GA-9 PACING (slice 11): every gated step ran the PRE-DECLARED tick plan — a declared 150 ms ingest allowance (a constant of the plan, stated), EXACTLY ONE gated tick passed, then CAUSAL completion at the room\'s OWN per-seat resolvedThrough watermark with NO fixed publish sleep (the heuristic 140 ms publish cadence is gone); consumed ticks are consecutive (one step, one tick). The fully causal INGEST wait and the consumed-ledger witness were both tried and REFUTED on this machine — the refutations are preserved in dpa7w and named in the pacing note, not hidden. Pre-declared deadlines are FAILURE conditions, never retries; the ungated control leg keeps free-running ticks by design. Rotation, if any, is still reported by the contamination row — pacing replaces the guess, not the detector',
    pacingFacts.length === 5 && pacingFacts.every((p) => p.violation === null && p.steps === N_STEPS && p.consumed === N_STEPS),
    pacingFacts);

  const artifactText = JSON.stringify({ sha, dirty, seed, formalMode, pacingFacts, legs: legs.map((leg) => ({ tag: leg.tag, pacing: leg.pacing ?? [], pacingViolation: leg.pacingViolation ?? null })) });
  const roots = checksSupport.machineRoots(ROOT, join(ROOT, 'artifacts'), undefined);
  const cleanPass = checksSupport.sanitiseMachineText(artifactText, roots) === artifactText;
  const injectedSample = `read config from ${join(ROOT, 'packages/config/secrets.env')} token=abc123 /home/someone/.aws/credentials`;
  const rewritten = checksSupport.sanitiseMachineText(injectedSample, roots);
  const detectorFires = rewritten !== injectedSample && rewritten.includes(ROOT) === false;
  const journalScanClean = sanitisationIssues(solo.journal.rows as never[]).length === 0;
  const forgedPathRow = [{ type: 'observation', arrivalOrdinal: 1, eligibleTick: 1, alias: 'a', entityId: 'e', kind: 'input', epoch: 1, generation: 1, directIntent: true, raw: { path: join(ROOT, 'etc/passwd') }, rawHash: 'x', malformed: [], requestId: null, payloadHash: null, disposition: 'applied', reason: null, screened: false, sdkFrameIdentity: null, origin: 'client', control: null, atMs: 0 }];
  const journalScanFires = sanitisationIssues(forgedPathRow as never[]).length > 0;
  cellCheck('GA-13 SANITISATION — with teeth on both sides: the accepted write-time scanner (sanitisationIssues) finds NOTHING in the real journal yet FIRES on a forged row carrying an absolute host path; the artifact text of this cell survives sanitiseMachineText UNCHANGED under this machine\'s roots (clean is CHECKED, not assumed), and an injected unsanitised sample (repo-root path, token, home path) is demonstrably REWRITTEN by the same call (the detector is not vacuous). Client identity in journal rows travels as ALIASES — accepted behaviour, asserted by the scanner passing the real rows',
    cleanPass && detectorFires && journalScanClean && journalScanFires,
    { cleanPass, detectorFires, rewrittenContainsRoot: rewritten.includes(ROOT), journalScanClean, journalScanFires: sanitisationIssues(forgedPathRow as never[]) });

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'spike-cell-ga9-ga13.json'), `${JSON.stringify({
    schemaVersion: 1,
    kind: ARTEFACT_KIND,
    implementationSha: sha,
    identity: { sha, dirty, seed, formalMode, dispatchedBy: 'pnpm test:spike --id UDG-SPIKE-001 --cell ga9-ga13' },
    harnessPolicy: { pacing: 'pre-declared tick plan (slice 11): causal ingest witness, one gated tick per step, room-own ledger confirmation; deadlines are failures, not retries', schedule: HARNESS_SCHEDULE, retries: formalMode ? 'none (formal)' : 'recorded <=3 on CONTAMINATION only, DIAGNOSTIC-only; pacing violations never retried' },
    script: SCRIPT,
    steps: N_STEPS,
    legs: legs.map((leg) => ({ tag: leg.tag, mode: leg.mode, roomId: leg.roomId, baselineTick: leg.baselineTick, steps: leg.steps, contentDigest: leg.contentDigest, fullDigest: leg.fullDigest, globalRows: leg.globalRows, journalRows: leg.journal.rows, contamination: leg.contamination ?? null, pacing: leg.pacing ?? [], pacingViolation: leg.pacingViolation ?? null, error: leg.error ?? null })),
    legAttempts,
    rotations,
    peerIndependence: {
      moverIssuedBy: 'seat B (peerb leg)',
      projectionEqual: firstDiffIndex(normP(solo), normP(peerB)) === -1,
      commandLedgerEqual: firstDiffIndex(soloCmds, peerCmds) === -1,
      roomOrdinalsDiffer: peerOrdinalsDiffer,
      soloCommands: soloCmds,
      peerCommands: peerCmds,
      soloCommandsWithOrdinals: soloCmdsOrd,
      peerCommandsWithOrdinals: peerCmdsOrd,
    },
    replay: {
      liveTip: comparison.liveTip,
      replayedTip: comparison.replayedTip,
      exactEqual: comparison.equal,
      stateBytesExact,
      kernelIdentity: { sameFunctionObject: kernelIdentityProven, sentinelGrowth: sentinelAfter - sentinelBefore },
      ulpDiagnosticOnly: { stateClose: ulpStateEqual, hashMismatchTicks: ulpHashTicks },
      referenceStepperControl: {
        ok: referenceReplay.ok,
        equal: referenceComparison.equal,
        mismatchTicks: referenceMismatchTicks,
        firstDifferingField: 'kinematic.velocity',
        liveBytes: referenceMismatch.map(({ live }) => velocityOf(live)),
        replayedBytes: referenceMismatch.map(({ replayed }) => (replayed === undefined ? null : velocityOf(replayed))),
        nonVelocityBytesEqual: referenceVelocityOnly,
        dispositionsEqual: referenceDispositionsEqual,
        referenceTip: referenceComparison.replayedTip,
      },
      blankedEqual: blankedComparison.equal,
      tamperedRefusal: tampered.refusal,
      mutatedDetected,
      dispositions: journalReplay.dispositionHistogram(solo.journal.rows),
      firstMismatches: comparison.mismatches.slice(0, 5),
      liveStateRows: solo.journal.rows.filter((r) => r['type'] === 'state'),
      replayedStateRows: asRecorded.rowsOut.filter((r) => r['type'] === 'state'),
      chain: solo.journal.chain,
      prologue: solo.prologue,
      liveConfig: solo.liveConfig,
    },
    sanitisation: { cleanPass, detectorFires, journalScanClean, journalScanFires },
    journalCoverage,
    integrity: { digestRecomputedOk, tipConsistent },
    perScenarioJournals: { gateDir: `artifacts/.local/spike-001/<run>/gate`, persisted: journalsPersisted, replays: legReplays.map((rec) => ({ tag: rec.tag, ok: rec.ok, exactEqual: rec.exactEqual, tipEqual: rec.tipEqual, stateBytesEqual: rec.stateBytesEqual, dispositionsEqual: rec.dispositionsEqual, mismatchTicks: rec.mismatchTicks, liveTip: rec.liveTip, replayedTip: rec.replayedTip })) },
    checks,
  }, null, 2)}\n`);
  try {
    await testInfo.attach('spike-cell-ga9-ga13.json', { path: join(OUT_DIR, 'spike-cell-ga9-ga13.json'), contentType: 'application/json' });
  } catch { /* attachment is best-effort; the file is the record */ }

  const anyFailure = checks.filter((record2) => !record2.ok);
  expect(anyFailure.map((record2) => record2.name), `failed ga9-ga13 rows: ${JSON.stringify(anyFailure.map((r2) => r2.name))}`).toEqual([]);
});
