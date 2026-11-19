/**
 * UDG-004 contract suite — the browser client and camera, and the evidence that says it ran.
 *
 * ## What this file is for
 *
 * `docs/contracts/UDG-004.md` states requirements; `docs/contracts/assignments/UDG-004.md` states how this task
 * was scoped, what the owner approved, and which measurements were taken before a line of implementation
 * existed. This suite turns both into executable claims. It does not render anything: rendering is
 * `tests/e2e/camera.spec.ts`'s job, and the split is deliberate. What belongs here is everything that can be
 * settled about the *repository* — pins, surfaces, config, the dispatcher's refusals, the absence of the test
 * seam from the shipped build — plus the gate that decides whether the browser run is evidence at all.
 *
 * ## The gate, and why it lives in this suite
 *
 * `pnpm test` is the command whose JUnit report the evidence bundle carries. The camera suite runs *before* it
 * during capture and writes `camera-browser-results.json`, `lifecycle-counts.json`, `console-errors.json` and
 * six PNGs; this file then refuses the run if those bytes are missing, failed, stale, short a case, or carrying
 * a screenshot whose digest moved. That is what "the browser results gate the acceptance command transitively"
 * means in this repository, and `tests/unit/udg-004/evidence-gates.test.ts` proves each of those refusals
 * fires — a gate nobody has seen fail is a rumour (assignment record §6.2 E-1…E-3).
 *
 * ## Accepted things stay accepted
 *
 * UDG-004 took first use of shared tooling under the single-writer rule, so this file also pins the digests of
 * the things it was **not** allowed to change: the UDG-001/002/003 capture plans and the ESLint configuration.
 * A digest is used rather than "trust the diff" because the assertion has to survive being read a year later,
 * when there is no diff left to look at.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { CAPTURE_PLANS, guardUnavailable } from '@udg/checks';

import {
  CAMERA_CASE_NAMES,
  CAMERA_RESULTS_FILE,
  gateBrowserResults,
  gateCompanionArtefacts,
  type CameraBrowserResults,
} from '../unit/udg-004/browser-results.js';

const TASK = 'UDG-004';
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');

/** Where the camera artefacts are: the bundle during capture, a scratch directory for a local run. */
const BROWSER_OUT = process.env['UDG_BROWSER_OUT'] ?? join(ROOT, 'artifacts', '.local', 'browser-evidence');
const EVIDENCE_TASK = process.env['UDG_EVIDENCE_TASK'];
const EVIDENCE_DIR = process.env['UDG_EVIDENCE_OUT'];
/** True when this suite is running inside UDG-004's own evidence capture, and so is gating a bundle. */
const GATING_BUNDLE = EVIDENCE_TASK === TASK && EVIDENCE_DIR !== undefined;

/**
 * Strip comments from TypeScript source, so a "must not appear" assertion cannot be defeated by a comment
 * that merely names the thing it forbids.
 *
 * Approximate on purpose: it is used to *widen* a ban, never to compile or to require a token. A block comment
 * is only recognised at a line start or after whitespace, because a double-star glob (slash, star, star, slash,
 * star) opens and closes a comment pair inside its own text, and a naive match would eat half a file.
 */
const stripComments = (source: string): string =>
  source
    .replace(/(?:^|\s)\/\*[\s\S]*?\*\//gmu, ' ')
    .replace(/^\s*\/\/.*$/gmu, ' ')
    .replace(/([^:"'])\/\/[^"'\r\n]*$/gmu, '$1');

const read = (relativePath: string): string => readFileSync(join(ROOT, relativePath), 'utf8');

/**
 * A TypeScript-aware JSON reader for the tsconfig files.
 *
 * Only whole-line `//` comments are removed, which is all the tsconfigs in this repository use. Block comments
 * are deliberately not stripped here: the accepted `tsconfig.json` files carry a `"//"` documentation *value*
 * that quotes a double-star glob, whose own characters open and close a comment pair, and a block match would
 * hand `JSON.parse` a truncated file.
 */
const jsonc = <T>(relativePath: string): T =>
  JSON.parse(read(relativePath).replace(/^\s*\/\/.*$/gmu, '')) as T;

const json = <T>(relativePath: string): T => JSON.parse(read(relativePath)) as T;

/** Read JSON from a path that may live outside the repository, which the artefact directory often does. */
const jsonAt = <T>(absolutePath: string): T => JSON.parse(readFileSync(absolutePath, 'utf8')) as T;

const run = (argv: readonly string[], timeoutMs = 600_000): { exitCode: number; stdout: string; stderr: string } => {
  const result = spawnSync(argv[0] ?? '', argv.slice(1), { cwd: ROOT, encoding: 'utf8', timeout: timeoutMs });
  return {
    exitCode: result.status ?? -1,
    stdout: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    stderr: result.stderr ?? '',
  };
};

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** Key-sorted JSON, so a digest of a plan does not depend on the order its keys were written in. */
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : typeof value === 'object' && value !== null
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]))
      : value;

const measured: Record<string, number | string | boolean> = {};
const record = (key: string, value: number | string | boolean): void => {
  measured[key] = value;
};

/**
 * The files UDG-004 owns, exactly as `docs/contracts/UDG-004.md` lists them.
 *
 * Asserting the list rather than a directory listing means a file added under `apps/client/src` outside the
 * assignment is visible here as an absence — the contract's owned-paths list is the boundary, not the
 * filesystem's tolerance.
 */
const CONTRACT_OWNED = [
  'apps/client/index.html',
  'apps/client/vite.config.ts',
  'apps/client/src/main.tsx',
  'apps/client/src/App.tsx',
  'apps/client/src/rendering/create-scene.ts',
  'apps/client/src/rendering/PlayerView.ts',
  'apps/client/src/rendering/OrbitCamera.ts',
  'apps/client/src/ui/ConnectionStatus.tsx',
  'apps/client/src/ui/DevelopmentOverlay.tsx',
  'apps/client/src/game/ClientRuntime.ts',
  'apps/client/src/network/ClientConnection.ts',
  'tests/contracts/UDG-004.test.ts',
  'tests/e2e/camera.spec.ts',
] as const;

describe('UDG-004 owned surface exists and is configured as the contract states', () => {
  it('creates every file the contract names, and nothing else claims to own them', () => {
    for (const file of CONTRACT_OWNED) {
      expect(existsSync(join(ROOT, file)), `${file} is missing`).toBe(true);
    }
    record('ownedFiles.present', CONTRACT_OWNED.length);
  });

  it('pins the approved client stack exactly, and excludes what the assignment refused', () => {
    const manifest = json<{
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    }>('apps/client/package.json');
    const all = { ...manifest.dependencies, ...manifest.devDependencies };
    const approved: Readonly<Record<string, string>> = {
      '@babylonjs/core': '8.56.2',
      react: '19.3.1',
      'react-dom': '19.3.1',
      '@types/react': '19.3.0',
      '@types/react-dom': '19.3.0',
      vite: '8.3.6',
    };
    for (const [name, version] of Object.entries(approved)) {
      expect(all[name], `${name} is not pinned to ${version}`).toBe(version);
    }
    // Every specifier is exact. A range would let a future install change what the accepted screenshots prove.
    for (const [name, specifier] of Object.entries(all)) {
      // `workspace:*` is the repository's own protocol for the shared packages and carries no third-party
      // version to drift; the rule is about what npm can resolve differently on a later day.
      if (specifier.startsWith('workspace:')) continue;
      expect(/^\d+\.\d+\.\d+$/.test(specifier), `${name} carries the non-exact specifier ${specifier}`).toBe(true);
    }
    // Each exclusion was measured and decided in the assignment record, not assumed: Babylon 9.36.0 produced
    // 154 third-party declaration diagnostics under `skipLibCheck: false`; `@webgpu/types` is not Babylon's
    // declared dependency; `@babylonjs/loaders` has no consumer in a procedural greybox; `@vitejs/plugin-react`
    // was measured unnecessary and stays a separate owner decision.
    for (const forbidden of ['@babylonjs/loaders', '@webgpu/types', '@vitejs/plugin-react']) {
      expect(all[forbidden], `${forbidden} must not be a client dependency`).toBeUndefined();
    }
    // UDG-004 shipped a client with no networking SDK, and said so. That still holds for everything except the
    // one specifier UDG-SPIKE-001 §5 / ADR-0004 registered afterwards: `@colyseus/sdk` at exactly the pin the
    // workspace already installed, and nothing else from that scope. The authority must be named where the
    // client relaxes declaration checking, so a pin cannot arrive without the decision that carries it.
    const permittedColyseus: Readonly<Record<string, string>> = { '@colyseus/sdk': '0.18.9' };
    for (const name of Object.keys(all).filter((specifier) => specifier.startsWith('@colyseus/'))) {
      expect(permittedColyseus[name], `${name} is not a permitted client dependency`).toBe(all[name]);
    }
    expect(read('apps/client/tsconfig.json')).toContain('ADR-0004');
    expect(read('apps/client/tsconfig.tools.json'), 'the dev-seam project imports no Colyseus module and stays strict').not.toContain('"skipLibCheck": true');
    record('client.pinsExact', Object.keys(all).length);
    record('client.approvedPinsVerified', true);
  });

  it('keeps the toolchain and root scripts routed the way the repository contract requires', () => {
    const scripts = json<{ scripts: Record<string, string> }>('package.json').scripts;
    expect(scripts['dev'], 'the root dev script must start the client').toContain('@udg/client');
    // The browser suite is reachable only through the dispatcher, which is also what refuses the other suites.
    expect(scripts['test:e2e'], 'test:e2e must route through the dispatcher').toContain('dispatch.js');
    // `.tsx`, `vite.config.ts` and the browser specs are typechecked by the root command, which is the gap G-6
    // was opened for. `tests/e2e/**` is excluded from the root project (no DOM library there) and covered by
    // `tsconfig.e2e.json` instead, so "not checked" is no longer an option.
    expect(scripts['typecheck:root']).toContain('tsconfig.e2e.json');
    expect(scripts['typecheck']).toContain('@udg/checks');
    const rootProject = jsonc<{ exclude: string[] }>('tsconfig.json');
    expect(rootProject.exclude).toContain('tests/e2e/**');
    const e2eProject = jsonc<{ include: string[]; compilerOptions: { lib?: string[] } }>('tsconfig.e2e.json');
    expect(e2eProject.include).toContain('tests/e2e/**/*.ts');
    expect(e2eProject.compilerOptions.lib).toContain('DOM');
    record('typecheck.coversBrowserSpecs', true);
  });

  it('binds the dev server to loopback by default, refuses a taken port, and warns on exposure', () => {
    const config = read('apps/client/vite.config.ts');
    expect(config).toContain("process.env['UDG_DEV_HOST']");
    expect(config).toContain('127.0.0.1');
    expect(config).toContain('5173');
    expect(config).toContain('strictPort: true');
    // The warning is not decoration: the assignment's Mac preview route is the one case where a non-loopback
    // bind is correct, and it must never be the quiet default.
    expect(config).toMatch(/binds beyond loopback|EXPOSES|exposed/i);
    const envExample = read('.env.example');
    expect(envExample).toContain('UDG_DEV_HOST');
    expect(envExample).toContain('UDG_HOST=127.0.0.1');
    expect(envExample).toContain('UDG_CLIENT_PORT=5173');
    expect(envExample).toContain('UDG_SERVER_PORT=2567');
    expect(envExample).toMatch(/EXPOSES THE PORT|exposes/i);
    record('devServer.loopbackDefault', true);
  });

  it('compiles JSX, keeps the DOM library inside the client, and holds src/dev out of the emit', () => {
    const client = jsonc<{
      compilerOptions: { jsx?: string; lib?: string[]; types?: unknown[]; outDir?: string };
      include: string[];
      exclude: string[];
    }>('apps/client/tsconfig.json');
    expect(client.compilerOptions.jsx).toBe('react-jsx');
    expect(client.compilerOptions.lib).toContain('DOM');
    expect(client.compilerOptions.types).toEqual([]);
    expect(client.include).toContain('src/**/*.tsx');
    expect(client.exclude).toContain('src/dev');
    expect(client.exclude).toContain('src/main.tsx');
    const tools = jsonc<{ include: string[] }>('apps/client/tsconfig.tools.json');
    expect(tools.include).toContain('vite.config.ts');
    expect(tools.include).toContain('src/main.tsx');
    expect(tools.include).toContain('src/dev/**/*.ts');
    record('client.jsxProjectSeparateEmit', true);
  });

  it('configures one chromium project, serially, un-retried, with the dev server it needs', () => {
    const config = read('playwright.config.ts');
    expect(config).toContain("workers: 1");
    expect(config).toContain("retries: 0");
    expect(config).toContain("fullyParallel: false");
    expect(config).toMatch(/projects:\s*\[\s*\{\s*name:\s*'chromium'/);
    expect(config).toContain("command: 'pnpm dev'");
    expect(config).toContain('127.0.0.1:5173');
    // A flaky camera case is a blocker, not something to re-run into greenness (record §9 M-7).
    expect(config).not.toMatch(/retries:\s*[1-9]/);
    record('playwright.serialSingleProject', true);
  });
});

describe('UDG-004 public interface is what the contract states', () => {
  /** The `ClientRuntime` interface body, extracted so member count is asserted rather than eyeballed. */
  const runtimeInterfaceMembers = (): string[] => {
    const source = read('apps/client/src/game/ClientRuntime.ts');
    const start = source.indexOf('export interface ClientRuntime {');
    expect(start, 'ClientRuntime must be declared as an exported interface').toBeGreaterThan(-1);
    const body = source.slice(start + 'export interface ClientRuntime {'.length, source.indexOf('\n}', start));
    return body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('/') && !line.startsWith('*'))
      // `start(canvas: HTMLCanvasElement): void;` and `counters(): RuntimeCounters;` both name the member
      // before the first `(` or `:`, and nothing else in the body is a member declaration.
      .map((line) => /^([A-Za-z][A-Za-z0-9]*)\s*[(:]/.exec(line)?.[1] ?? line);
  };

  it('exposes the four contract methods, plus one readout, and no lifecycle lever', () => {
    const members = runtimeInterfaceMembers();
    expect(members.sort()).toEqual(['counters', 'dispose', 'removePresentedEntity', 'setPresentedPose', 'start'].sort());
    expect(members).toContain('start');
    expect(members).toContain('setPresentedPose');
    expect(members).toContain('removePresentedEntity');
    expect(members).toContain('dispose');
    // Assignment record §8 rejected "widen ClientRuntime's surface" as the way to make the acceptance
    // measurement. `counters()` is a read, not a lifecycle method: nothing in this list mounts, remounts or
    // disposes beyond the contract's own `dispose()`, and the ten-cycle measurement is driven from the
    // development seam instead.
    for (const forbidden of ['mount', 'unmount', 'remount', 'restart', 'resize', 'scene', 'engine', 'harness']) {
      expect(members, `ClientRuntime must not expose ${forbidden}()`).not.toContain(forbidden);
    }
    record('runtime.members', members.join('+'));
  });

  it('declares Pose as a readonly position and yaw over the protocol Vec3', () => {
    const source = read('apps/client/src/game/ClientRuntime.ts');
    expect(source).toMatch(/export interface Pose \{\s*readonly position: Vec3;\s*readonly yaw: number;\s*\}/);
    expect(source).toContain("import type { Vec3 } from '@udg/protocol'");
  });

  it('keeps the workspace entry map empty while the only caller is the app itself', () => {
    // `tests/contracts/UDG-001.test.ts` refuses an implemented workspace an entry the published map in
    // `docs/contracts/protocol-v1.md` does not carry, and that document is on this task's do-not-touch list.
    // So `src/index.ts` still exports nothing, and the surface is reached through `src/`. This assertion exists
    // so the next task cannot "helpfully" export the runtime without also earning the entry row.
    expect(read('apps/client/src/index.ts')).toContain('export {};');
  });

  it('reports connection status without importing a networking SDK', () => {
    const source = read('apps/client/src/network/ClientConnection.ts');
    for (const token of ["from '@colyseus", 'Client()', 'room.', 'leaveAll', 'reconnectionToken']) {
      expect(source, `ClientConnection must not contain ${token}`).not.toContain(token);
    }
    expect(source).toContain("export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'failed' | 'closed'");
    // The failure has to be a *rendered* state, which is what the browser suite then reads off the DOM.
    const banner = read('apps/client/src/ui/ConnectionStatus.tsx');
    expect(banner).toContain('data-udg-connection-status');
    expect(banner).toContain('data-udg-connection-reason');
    expect(banner).toContain('data-udg-ui');
    record('connection.sdkFree', true);
  });

  it('reads the adopted capsule size and nothing from the unassigned P07 movement surface', () => {
    const player = read('apps/client/src/rendering/PlayerView.ts');
    expect(player).toContain('MOVEMENT_DEFAULTS.capsuleHeight');
    expect(player).toContain('MOVEMENT_DEFAULTS.capsuleRadius');
    // P07 has no owner. A client that reached for its controller fields would silently decide that interface.
    for (const symbol of ['restCentreY', 'controllerOffset', 'groundSnap', 'gravity', 'terminalVelocity', 'damping', 'acceleration', 'jumps']) {
      for (const file of ['apps/client/src/rendering/PlayerView.ts', 'apps/client/src/rendering/create-scene.ts', 'apps/client/src/game/ClientRuntime.ts', 'apps/client/src/rendering/OrbitCamera.ts']) {
        // Comments are stripped first, because `PlayerView.ts` *names* these fields at length to explain why it
        // reads none of them; an assertion that fired on that paragraph would reward deleting the explanation.
        expect(stripComments(read(file)), `${file} must not reference the unassigned P07 symbol ${symbol}`).not.toContain(symbol);
      }
    }
    // The half-height is derived, never restated: `MOVEMENT_DEFAULTS.capsuleHeight / 2` is the only number
    // that may place a capsule centre, and the browser suite measures the resulting 1.8 m mesh.
    expect(player).toContain('MOVEMENT_DEFAULTS.capsuleHeight / 2');
    record('p07.symbolsAbsent', true);
  });

  it('keeps the camera limits and the gesture mapping in a Babylon-free module', () => {
    const math = read('apps/client/src/rendering/camera-math.ts');
    expect(math).toContain('radiusMinMeters: 2');
    expect(math).toContain('radiusMaxMeters: 20');
    expect(math).toContain('elevationMinDegrees: 10');
    expect(math).toContain('elevationMaxDegrees: 80');
    // No Babylon, no DOM: the clamp arithmetic is the part most worth unit-testing, and a module that needs a
    // canvas to test it will not get tested.
    expect(math).not.toContain('@babylonjs');
    expect(math).not.toMatch(/\bdocument\b|\bwindow\b/);
    record('camera.limitsInPureModule', true);
  });

  it('holds the input map the reviewer ruled, in the source rather than in a reply', () => {
    // Ruled on 2026-11-16, and cheap to lose silently: middle button orbits, left button never does, arrows move
    // the camera only while the canvas holds focus. Each clause below is a line of code, not a paragraph of doc,
    // because the browser suite proves behaviour and this proves the behaviour is wired the stated way.
    const orbit = read('apps/client/src/rendering/OrbitCamera.ts');
    expect(orbit, 'the mouse gesture is no longer gated on the middle button').toContain('event.button !== 1');
    expect(orbit).toContain('leftPressesIgnored');
    expect(orbit, 'the keyboard is listening somewhere other than the canvas').toContain(
      "this.canvas.addEventListener('keydown'",
    );
    expect(orbit, 'a window-level key listener would steal arrows from the page').not.toContain(
      "window.addEventListener('keydown'",
    );
    // The suppression has to be conditional: refuse the default only for the four keys this handler consumes.
    expect(orbit).toContain('if (!isCameraKey(event.key)) return;');
    expect(orbit).toContain('event.ctrlKey || event.metaKey || event.altKey');
    expect(orbit, 'blur does not stop keyboard motion').toContain('private onCanvasBlur');
    expect(orbit).toContain('this.heldKeys.clear()');
    // The middle button must not start a platform autoscroll or a primary-paste either.
    expect(orbit).toContain("this.canvas.addEventListener('mousedown'");

    // Continuous keyboard motion, structurally: a keydown is a state, and the **render loop** is the only thing
    // that moves the camera from it. A build that stepped on keydown would pass a test that sends a press per
    // step, so this pins where the movement is applied.
    // Positive structure only, deliberately: the drag path writes alpha too, so "keydown must not write the
    // camera" is not a string test. What is checkable here is that a per-frame entry point exists and integrates
    // the held set; the browser case is what proves no camera write happens on the keydown itself, by measuring
    // movement with **no repeat events** sent.
    expect(orbit, 'held keys are not integrated per frame').toContain('public stepHeldKeys(deltaSeconds: number)');
    expect(orbit).toContain('heldKeyCameraStep(this.heldKeys, deltaSeconds)');
    expect(orbit, 'autorepeat is treated as motion rather than ignored').toContain('if (event.repeat) return;');
    expect(orbit, 'keyup does not clear the held state').toContain('this.heldKeys.delete(event.key)');

    const runtime = read('apps/client/src/game/ClientRuntime.ts');
    expect(runtime, 'the render loop does not advance the held keys').toContain(
      'resources.camera.stepHeldKeys(deltaSeconds)',
    );
    expect(runtime, 'the loop has no elapsed-time source').toContain('performance.now()');

    const math = stripComments(read('apps/client/src/rendering/camera-math.ts'));
    expect(math).toContain('ArrowLeft');
    expect(math).toContain('ArrowRight');
    expect(math).toContain('ArrowUp');
    expect(math).toContain('ArrowDown');
    // Both directions of both axes, and pitch handed back in degrees so the single elevation clamp governs it.
    expect(math).toContain('KEY_ORBIT_RADIANS_PER_SECOND');
    expect(math).toContain('KEY_PITCH_DEGREES_PER_SECOND');
    // A held key integrated against a stalled frame would teleport the camera, so the interval is clamped where
    // the arithmetic lives rather than at each call site.
    expect(math).toContain('MAX_FRAME_SECONDS');
    expect(math).toContain('heldKeyCameraStep');
    expect(math, 'the pure module grew a DOM dependency').not.toMatch(/\bdocument\b|\bwindow\b/);

    // Focus has to be reachable and visible, or the keyboard rule is a trap.
    const page = read('apps/client/index.html');
    expect(page, 'the scene canvas is not in the tab order').toMatch(/<canvas[\s\S]*?tabindex="0"/);
    expect(page, 'the focused canvas has no visible focus ring').toMatch(/canvas\[data-udg-scene\]:focus\s*\{[^}]*outline:/);

    // The hint on screen is the only documentation a reviewer reads before touching the mouse.
    const overlay = read('apps/client/src/ui/DevelopmentOverlay.tsx');
    for (const phrase of ['Middle-drag', 'wheel', 'arrow keys', 'left button', 'Tab reaches the canvas']) {
      expect(overlay, `the on-screen controls hint no longer says "${phrase}"`).toContain(phrase);
    }
    // And the counters behind that hint are the ones the browser suite asserts on.
    const runtimeCounters = runtime;
    expect(runtimeCounters).toContain('cameraKeySteps');
    expect(runtimeCounters).toContain('cameraKeyFrames');
    expect(runtimeCounters).toContain('cameraLeftPressesIgnored');

    // Eight cases now, and the plan's own wording says eight, so the gate and the prose cannot disagree.
    expect(CAMERA_CASE_NAMES).toHaveLength(8);
    const plan = CAPTURE_PLANS['UDG-004'];
    expect(plan?.thresholds['camera.cases']).toContain('=== 8 cases');
    record('camera.inputMapPinned', true);
    // The third ruling separates the devices again, so the table that encodes it must exist and must say what the
    // reviewer asked for: mouse inverted, touch untouched.
    const directions = stripComments(read('apps/client/src/rendering/camera-math.ts'));
    expect(directions).toMatch(/mouse:\s*1/);
    expect(directions).toMatch(/touch:\s*-1/);
  });
});

describe('the browser dispatcher refuses per suite (grants G-2 and G-3)', () => {
  it('dispatches the camera suite and refuses every other answer a caller can construct', () => {
    expect(guardUnavailable('test:e2e', ['--suite=camera']).exitCode, 'camera must dispatch').toBe(0);
    // `netcode` stopped being an owed suite when UDG-SPIKE-001 landed `tests/e2e/netcode.spec.ts` (grant
    // T-1(a)). It dispatches now; the spec-file correspondence behind that flag is asserted by
    // `tests/contracts/UDG-SPIKE-001.test.ts`, which checks all five rows against the filesystem.
    expect(guardUnavailable('test:e2e', ['--suite=netcode']).exitCode, 'netcode must dispatch now that its spec exists').toBe(0);
    const owed: readonly (readonly [string, string])[] = [
      ['physics', 'UDG-006'],
      ['input', 'UDG-008'],
      ['hybrid', 'UDG-SPIKE-003'],
    ];
    for (const [suite, owner] of owed) {
      const guard = guardUnavailable('test:e2e', [`--suite=${suite}`]);
      expect(guard.exitCode, `${suite} must refuse`).toBe(1);
      expect(guard.message, `${suite} must name its owning task`).toContain(owner);
      expect(guard.message).toContain('never reported as a pass');
    }
    // An unknown suite name is a usage error (2): there is no owning task to name. A missing `--suite` is the
    // guarded command refusing (1), because UDG-001's accepted dispatch contract is what defines a refusal —
    // exit 1, owning task named, "never reported as a pass" — and a bare `pnpm test:e2e` is that command. The
    // usage text still says who owns each suite, because a refusal that cannot tell you what to read next is
    // not much of a refusal.
    expect(guardUnavailable('test:e2e', ['--suite=nonsense']).exitCode).toBe(2);
    expect(guardUnavailable('test:e2e', []).exitCode).toBe(1);
    // The usage text still names every suite's owner, and now marks `netcode` as implemented: that is grant
    // T-1(a)'s visible effect, asserted here so the flag cannot flip without a test noticing.
    expect(guardUnavailable('test:e2e', []).message).toContain('netcode (UDG-SPIKE-001, implemented)');
    // Commands other than `test:e2e` keep the behaviour UDG-001 pinned: an unknown command is exit 2, and the
    // guarded list still contains `test:e2e`, because four of its suites are still owed.
    expect(guardUnavailable('test:whatever', []).exitCode).toBe(2);
    expect(guardUnavailable(undefined, []).message).toContain('test:e2e');
    record('dispatch.perSuiteMatrix', true);
  });

  it('refuses through the real command, not only through the function', () => {
    // The function can be right while the script routing is wrong, and the second is what a developer types.
    const physics = run(['pnpm', 'test:e2e', '--', '--suite', 'physics'], 120_000);
    expect(physics.exitCode, physics.stdout).toBe(1);
    expect(physics.stdout).toContain('UDG-006');
    const unknown = run(['pnpm', 'test:e2e', '--', '--suite', 'somethingelse'], 120_000);
    expect(unknown.exitCode, unknown.stdout).toBe(2);
    expect(unknown.stdout).toContain('valid suites');
    record('dispatch.refusalEndToEnd', true);
  });

  it('names the seven camera cases in the spec, in order, and skips none of them', () => {
    const spec = read('tests/e2e/camera.spec.ts');
    // The titles come from the shared module rather than being restated here, because a name that only lives
    // in two places is a gate that silently checks nothing. Index `i` in the spec must be case `i` in the gate.
    CAMERA_CASE_NAMES.forEach((name, index) => {
      expect(spec, `the camera spec no longer declares case ${String(index)} ("${name}")`).toContain(`test(CAMERA_CASE_NAMES[${String(index)}]`);
    });
    expect(spec).toContain(`test(CAMERA_CASE_NAMES[${String(CAMERA_CASE_NAMES.length - 1)}]`);
    // A skipped case is reported as `skipped` in the artefact and the gate treats that as a failure; the point
    // of checking the source too is that a skip should be a conversation, not a merged line.
    expect(spec).not.toContain('test.skip(');
    expect(spec).not.toContain('test.fixme(');
    expect(spec).not.toContain('test.only(');
    expect(spec).toContain("test(CAMERA_CASE_NAMES[0]");
    expect(spec).toContain(`test(CAMERA_CASE_NAMES[${String(CAMERA_CASE_NAMES.length - 1)}]`);
    record('camera.casesNamed', CAMERA_CASE_NAMES.length);
  });
});

describe('the development mount/unmount seam is absent from every built artefact', () => {
  /**
   * Tokens that may not appear in a production artefact.
   *
   * The global name, the module name and the installer, checked together: a bundler that renamed one but kept
   * another is exactly the mistake this catches, and a comment in a source file cannot catch it.
   */
  const SEAM_TOKENS = ['__udgClientHarness', 'lifecycleHarness', 'installLifecycleHarness', 'sceneReadout'] as const;

/**
 * `pnpm --filter @udg/client build` under a Node environment that says production.
 *
 * Vitest exports `NODE_ENV=test`, and Vite honours `NODE_ENV` when it chooses a build mode: without this
 * override the scan below would build a *development* bundle — which is supposed to contain the seam — and
 * report the seam as a defect. The mode is set explicitly rather than inherited because the alternative is a
 * check that fails for a reason that has nothing to do with the code it is reading.
 */
const runProductionBuild = (): { exitCode: number; stdout: string; stderr: string } => {
  const result = spawnSync('pnpm', ['--filter', '@udg/client', 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 900_000,
    env: { ...process.env, NODE_ENV: 'production' },
  });
  return { exitCode: result.status ?? -1, stdout: `${result.stdout ?? ''}${result.stderr ?? ''}`, stderr: result.stderr ?? '' };
};

  const filesUnder = (directory: string): string[] => {
    const absolute = join(ROOT, directory);
    if (!existsSync(absolute)) return [];
    const out: string[] = [];
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = join(directory, entry.name);
      if (entry.isDirectory()) out.push(...filesUnder(child));
      else if (entry.isFile()) out.push(child);
    }
    return out;
  };

  it('builds the client and finds no seam token in the emit, the bundle or the source maps', () => {
    const built = runProductionBuild();
    expect(built.exitCode, built.stdout).toBe(0);
    const emitted = [...filesUnder('apps/client/dist')];
    expect(emitted.length, 'the client produced no build output to scan').toBeGreaterThan(5);
    const offenders: string[] = [];
    for (const file of emitted) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      for (const token of SEAM_TOKENS) {
        if (text.includes(token)) offenders.push(`${file}: ${token}`);
      }
    }
    // Source maps are the case a "grep the JS" check misses: with `sourcemap: true` the bundle stays tidy while
    // its `.map` carries the original `sourcesContent`, dev seam and all. The client build disables maps for
    // that reason, and this assertion is what keeps it that way.
    expect(offenders, `the development seam reached the built artefacts:\n${offenders.join('\n')}`).toEqual([]);
    record('seam.filesScanned', emitted.length);
    record('seam.tokensAbsent', true);
  });

  it('excludes the harness from the served bundle while keeping it in the dev server', () => {
    // Both halves matter. A seam missing from production *and* from development would pass the scan above while
    // leaving the acceptance measurement with nothing to drive.
    const main = read('apps/client/src/main.tsx');
    expect(main).toContain('import.meta.env.DEV');
    expect(main).toContain("import('./dev/lifecycleHarness.js')");
    const vite = read('apps/client/vite.config.ts');
    expect(vite).toContain("sourcemap: false");
    record('seam.developmentOnlyRoute', true);
  });
});

describe('the camera run is evidence, or the acceptance command fails', () => {
  /**
   * Resolve the artefacts, then gate them.
   *
   * During capture this suite runs with `UDG_BROWSER_OUT` pointing at the bundle, and a problem is a hard
   * failure — that is the transitive gate. Outside capture it gates the local scratch directory whenever one
   * exists, and says plainly when none does. It does not fail a fresh clone that has never run a browser: the
   * dispatcher and the capture plan are what make a browser run mandatory, and a unit checkout that cannot run
   * `pnpm test` at all teaches nobody anything. The refusals themselves are proven every run by
   * `tests/unit/udg-004/evidence-gates.test.ts`, which needs no browser to prove them.
   */
  const directory = resolve(GATING_BUNDLE ? (process.env['UDG_BROWSER_OUT'] ?? EVIDENCE_DIR ?? BROWSER_OUT) : BROWSER_OUT);
  const haveArtefacts = existsSync(join(directory, CAMERA_RESULTS_FILE));

  it('gates the browser results for identity, freshness, cases, screenshots and console errors', () => {
    record('evidence.directoryIsBundle', GATING_BUNDLE);
    record('evidence.artefactsPresent', haveArtefacts);
    if (!haveArtefacts) {
      // Two modes, and the difference is who is asking.
      //
      // During UDG-004's own capture the artefacts are the bundle's required files, so their absence is a
      // failure — and E-1 in `tests/unit/udg-004/evidence-gates.test.ts` proves the gate refuses it, while the
      // capture plan's own `requiredFiles` list and CI's artefact step refuse it twice more.
      //
      // Outside capture, absence is reported rather than failed, so that a checkout which has never run a
      // browser can still run `pnpm test`: what makes a browser run mandatory is the capture plan and CI, which
      // runs `pnpm test:e2e -- --suite camera` **before** `pnpm test` in the same job. Where artefacts do exist
      // locally they are gated exactly as strictly as in the bundle — that is the branch below, and it is the
      // reason a stale local run cannot quietly be read as a fresh one.
      if (GATING_BUNDLE) {
        expect(false, `no ${CAMERA_RESULTS_FILE} in ${directory}: the bundle carries no camera evidence`).toBe(true);
      }
      record('evidence.skippedReason', `no ${CAMERA_RESULTS_FILE} in ${directory}`);
      console.warn(
        `UDG-004: no camera evidence in ${directory}; run pnpm test:e2e -- --suite camera to gate it. `
        + 'Evidence capture and CI require it.',
      );
      return;
    }
    const issues = gateBrowserResults({
      directory,
      maxAgeMs: 6 * 60 * 60 * 1000,
      requireCleanConsole: true,
      requiredMeasurements: {
        unexplainedPageErrors: 0,
        unexplainedConsoleErrors: 0,
        frameRequestsAfterDispose: 0,
        listenersAfterDispose: 0,
      },
    });
    // A dirty tree is a bundle failure and a working-day fact. During capture the artefact must be attributable
    // to a commit, so `TREE_DIRTY` stays in the list below and stops the bundle; outside capture the same flag
    // is recorded and reported instead, because a developer mid-change should get `pnpm test` failures about
    // their code and not about their uncommitted diff. Every other refusal applies in both modes.
    const localTolerated = GATING_BUNDLE ? [] : ['TREE_DIRTY'];
    record('evidence.localTreeDirty', issues.some((issue) => issue.code === 'TREE_DIRTY'));
    expect(
      issues.filter((issue) => !localTolerated.includes(issue.code)),
      `the camera artefacts failed the gate:\n${issues.map((i) => `${i.code}: ${i.detail}`).join('\n')}`,
    ).toEqual([]);
    const results = jsonAt<CameraBrowserResults>(join(directory, CAMERA_RESULTS_FILE));
    expect(results.suites.expected).toBe(CAMERA_CASE_NAMES.length);
    expect(results.suites.failed).toBe(0);
    expect(results.suites.skipped).toBe(0);
    if (GATING_BUNDLE) expect(results.workingTreeDirty).toBe(false);
    expect(results.cases.length).toBeGreaterThanOrEqual(CAMERA_CASE_NAMES.length);
    // The numbers the capture plan's thresholds are written against, asserted here so a threshold cannot be
    // prose that nothing checks.
    expect(Number(results.measurements['cycles'])).toBeGreaterThanOrEqual(10);
    expect(Number(results.measurements['handednessPicksAgreeing'])).toBeGreaterThanOrEqual(5);
    expect(Number(results.measurements['presentedHeightUnits'])).toBeCloseTo(1.8, 3);
    expect(Number(results.measurements['positiveArmMetres'])).toBe(3);
    expect(Number(results.measurements['negativeArmMetres'])).toBeCloseTo(1.2, 3);
    expect(Number(results.measurements['targetFollowErrorMetres'])).toBeLessThan(0.05);
    expect(Number(results.measurements['uiGesturesIgnored'])).toBeGreaterThanOrEqual(1);
    expect(results.measurements['cameraMovedWhilePosesFrozen']).toBe(true);
    expect(results.measurements['gesturesAfterCancelStillTicking']).toBe(true);
    expect(results.measurements['screenshotChangedAfterDrag']).toBe(true);
    expect(results.browser.chromiumBuild).toMatch(/chromium-\d+/);
    // Every number the capture plan's thresholds point at, recorded beside the assertion that checked it.
    // A threshold with no measurement behind it is decoration, and `pnpm evidence:verify` says so with
    // EVIDENCE-THRESHOLD-UNMEASURED — which is the failure this list exists to prevent.
    record('camera.cases', results.suites.passed);
    record('evidence.casesPassed', results.suites.passed);
    record('evidence.chromiumBuild', results.browser.chromiumBuild);
    record('evidence.cycles', Number(results.measurements['cycles']));
    record('camera.pageErrors', Number(results.measurements['unexplainedPageErrors']));
    record('camera.consoleErrors', Number(results.measurements['unexplainedConsoleErrors']));
    record('camera.handednessPicks', Number(results.measurements['handednessPicksAgreeing']));
    record('camera.sweepFound', Number(results.measurements['screenMarkersFound'] ?? 0));
    record('camera.sweepMissed', Number(results.measurements['screenMarkersMissed'] ?? 0));
    record('camera.elevationClampLow', Number(results.measurements['elevationClampLow']));
    record('camera.elevationClampHigh', Number(results.measurements['elevationClampHigh']));
    record('camera.radiusMinMetres', Number(results.measurements['radiusMinMetres']));
    record('camera.radiusMaxMetres', Number(results.measurements['radiusMaxMetres']));
    record('camera.uiGesturesIgnored', Number(results.measurements['uiGesturesIgnored']));
    record('camera.poseWritesDuringCameraOperations', Number(results.measurements['poseWritesDuringCameraOperations']));
    record('camera.poseWritesBeforeFreeze', Number(results.measurements['poseWritesBeforeFreeze']));
    record('camera.targetFollowErrorMetres', Number(results.measurements['targetFollowErrorMetres']));
    record('camera.presentedHeightUnits', Number(results.measurements['presentedHeightUnits']));
    record('camera.positiveArmMetres', Number(results.measurements['positiveArmMetres']));
    record('camera.negativeArmMetres', Number(results.measurements['negativeArmMetres']));
    record('camera.cameraMovedWhilePosesFrozen', results.measurements['cameraMovedWhilePosesFrozen'] === true);
  });

  it('gates the lifecycle and console artefacts against the same run and commit', () => {
    if (!haveArtefacts) return;
    const results = jsonAt<CameraBrowserResults>(join(directory, CAMERA_RESULTS_FILE));
    const companionIssues = gateCompanionArtefacts(directory, {
      runId: results.runId,
      implementationSha: results.implementationSha,
      minCycles: 10,
    }).filter((issue) => !(GATING_BUNDLE ? false : issue.code === 'TREE_DIRTY'));
    expect(companionIssues, `companion artefacts failed the gate:\n${companionIssues.map((i) => `${i.code}: ${i.detail}`).join('\n')}`).toEqual([]);
    const lifecycle = jsonAt<{ after: Record<string, number | boolean> }>(join(directory, 'lifecycle-counts.json'));
    record('lifecycle.meshesAfterDispose', Number(lifecycle.after['meshes']));
    record('lifecycle.listenersAfterDispose', Number(lifecycle.after['listeners']));
    record('lifecycle.frameRequestsAfterDispose', Number(lifecycle.after['frameRequestsAdvanced']));
    record('lifecycle.cycles', Number(jsonAt<{ cycles: number }>(join(directory, 'lifecycle-counts.json')).cycles));
  });

  it('re-hashes every retained screenshot, so a stale or rewritten PNG is a failure and not a smaller pass', () => {
    if (!haveArtefacts) return;
    const results = jsonAt<CameraBrowserResults>(join(directory, CAMERA_RESULTS_FILE));
    for (const shot of results.screenshots) {
      const absolute = join(directory, 'browser', shot.name);
      expect(existsSync(absolute), `${shot.name} is named by the artefact but absent`).toBe(true);
      const bytes = readFileSync(absolute);
      expect(bytes.length, `${shot.name} changed size since it was hashed`).toBe(shot.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), `${shot.name} no longer hashes to what the artefact declares`).toBe(shot.sha256);
      expect(bytes.subarray(0, 8).toString('hex'), `${shot.name} is not a PNG`).toBe('89504e470d0a1a0a');
      // A 1×1 placeholder is a legal PNG and a dishonest artefact; the states named in the contract are wide
      // viewport captures, so a real one is orders of magnitude larger than an empty frame.
      expect(bytes.length, `${shot.name} is too small to be the state it claims to show`).toBeGreaterThan(10_000);
      expect(statSync(absolute).size).toBe(bytes.length);
    }
    record('screenshots.rehashed', results.screenshots.length);
  });
});

describe('what UDG-004 was not allowed to change has not changed', () => {
  /**
   * The accepted capture plans, by digest.
   *
   * UDG-004 is the first task to edit `tools/checks/src/evidence.ts` since those plans were accepted, and
   * G-9 authorised only two changes to it: the UDG-004 capture plan and binary-safe sanitisation. A key-sorted
   * digest of each existing plan is how this file proves nothing else moved — the assertion a reviewer can
   * still run in a year, when the diff that would have shown it is gone. A deliberate future change means
   * updating the digest in the same commit that changes the plan, which is the point: it cannot happen quietly.
   */
  const ACCEPTED_PLAN_DIGESTS: Readonly<Record<string, string>> = {
    'UDG-001': '3b450c283d165361',
    'UDG-002': '754df194a28d1e0a',
    'UDG-003': '3b93cfbbd9ca818e',
  };

  it('leaves the UDG-001, UDG-002 and UDG-003 capture plans byte-identical', () => {
    for (const [taskId, digest] of Object.entries(ACCEPTED_PLAN_DIGESTS)) {
      const plan = CAPTURE_PLANS[taskId];
      expect(plan, `${taskId} has no capture plan any more`).toBeDefined();
      const actual = sha256(JSON.stringify(canonical(plan ?? {})));
      expect(actual, `${taskId}'s capture plan changed (${digest} -> ${actual})`).toBe(digest);
    }
    const own = CAPTURE_PLANS['UDG-004'];
    expect(own, 'UDG-004 has no capture plan').toBeDefined();
    // The plan hands its browser artefacts to the bundle through the capture tool's `BUNDLE/` token, and that
    // token is substituted only in its slashed form. A bare `BUNDLE` is an ordinary relative path: the first
    // capture of this plan wrote its screenshots into <repo>/BUNDLE, the untracked directory made the tree
    // dirty merely by existing, and the bundle was refused for TREE_DIRTY — the right verdict for the wrong
    // reason. Pinned here, so the next person to touch a plan env value gets a test failure instead of that.
    for (const step of own?.commands ?? []) {
      const target = step.env?.['UDG_BROWSER_OUT'];
      if (target === undefined) continue;
      expect(target, 'a plan must name the bundle with the BUNDLE/ token, which is the form that expands').toBe('BUNDLE/');
    }
    record('plans.acceptedUnchanged', Object.keys(ACCEPTED_PLAN_DIGESTS).length);
  });

  it('leaves the ESLint configuration byte-identical, because .tsx was already linted', () => {
    // The revision-1 draft of the assignment claimed `.tsx` was not linted. It was: the accepted config's
    // rules apply to every `.ts`/`.tsx` file in the tree. The real gap was typechecking, which G-6 fixed, and
    // grant G-5 was withdrawn. This digest is the proof that the correction did not quietly add a parser.
    expect(sha256(read('eslint.config.mjs'))).toBe('5a29e7c2316f1917');
    record('eslint.configUnchanged', true);
  });

  it('still refuses to fake the other suites, so this task did not widen its own way in', () => {
    for (const command of ['test:spike', 'assets:build', 'assets:verify']) {
      expect(guardUnavailable(command, ['--suite', 'camera']).exitCode, `${command} must still refuse`).toBe(1);
    }
    record('dispatch.otherSuitesStillRefused', true);
  });
});

afterAll(() => {
  const target = process.env['UDG_EVIDENCE_MEASUREMENTS'];
  if (target === undefined || target.length === 0) return;
  // Ownership, the same guard every other task suite carries: this suite also runs inside other tasks'
  // captures (`pnpm test` there runs it too), and its numbers must not land in another task's bundle.
  if (EVIDENCE_TASK !== undefined && EVIDENCE_TASK !== TASK) return;
  const absolute = resolve(target);
  mkdirSync(dirname(absolute), { recursive: true });
  // `measurements/UDG-004.json` is an identity artefact in the capture plan, so it must name its task and its
  // schema version: a measurements block copied out of an older bundle is the oldest way a green run lies.
  //
  // The dotted keys `record()` takes become nested objects on the way out, because that is the shape
  // `pnpm evidence:verify` walks when it resolves a plan threshold (`camera.cases` is `measured.camera.cases`,
  // not a key containing a dot). UDG-003's measurements file is nested for the same reason; a flat file is how
  // this suite's first capture failed verification with EVIDENCE-THRESHOLD-UNMEASURED on thirteen thresholds,
  // having passed every one of its own assertions a moment earlier.
  const nested: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(measured)) {
    const parts = key.split('.');
    let cursor = nested;
    for (const part of parts.slice(0, -1)) {
      const next = cursor[part];
      if (typeof next !== 'object' || next === null) cursor[part] = {};
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1] ?? key] = value;
  }
  writeFileSync(absolute, `${JSON.stringify({ taskId: TASK, schemaVersion: 1, ...nested }, null, 2)}\n`);
});
