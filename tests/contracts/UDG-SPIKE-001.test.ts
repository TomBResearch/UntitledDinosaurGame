/**
 * UDG-SPIKE-001 — the client seat: ADR-0004's declaration-checking audit, and grant T-1's dispatch proof.
 *
 * ## Why this suite exists
 *
 * [ADR-0004](../../docs/adr/0004-client-declaration-checking-exception.md) lets exactly one more project skip
 * checking *inside* third-party declaration files, because the pinned `@colyseus/sdk`/`@colyseus/core`
 * declarations carry three defects that no first-party code can fix. An exception that nothing enforces is not
 * a policy, it is a habit, so every part of the decision is asserted here on every `pnpm test`:
 *
 * 1. **Confinement.** The set of projects with `skipLibCheck: true` is pinned *with the authority each one
 *    cites* — ADR-0002 for the two `apps/server` projects, UDG-001 D1 for the root tooling project, ADR-0004 for
 *    `apps/client/tsconfig.json`. A fifth project, or one of these four citing someone else's decision, fails.
 * 2. **The retained strict check and its inventory.** `pnpm --filter @udg/client typecheck:declarations` must
 *    still report exactly the vendor diagnostics pinned in
 *    `docs/integration/colyseus-client-declaration-inventory.json` — no more, no fewer, no new file, no new
 *    code — and **zero** diagnostics inside repository code. A clean strict check fails this suite too: it
 *    would mean the pins moved and the record did not.
 * 3. **Controls that the exception does not blunt.** Throwaway fixtures are compiled against the real SDK
 *    declarations *with* the exception in force, and each unsupported call or invalid input must still fail to
 *    compile, while one correct usage must compile clean. A control that stops erroring is a failure, which is
 *    what turns "the compiler no longer catches that" into a review event instead of a surprise.
 * 4. **Grant T-1(a).** `--suite netcode` dispatches because its spec file exists, `physics`/`input`/`hybrid`
 *    still refuse with their owners named, `test:spike --id UDG-SPIKE-001` still refuses because the spike
 *    harness does not exist yet, and every `E2E_SUITES` row matches the filesystem.
 *
 * Gate A is **Not Run**: nothing here is gate evidence, and this file claims nothing about profiles, seeds,
 * corrections, P06 or `stackCompatibility`.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { E2E_SUITES, guardUnavailable } from '@udg/checks';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');

const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

const run = (command: string, args: readonly string[], timeoutMs = 300_000): { exitCode: number; stdout: string; stderr: string } => {
  const result = spawnSync(command, [...args], { cwd: ROOT, encoding: 'utf8', timeout: timeoutMs });
  return { exitCode: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

// --------------------------------------------------------------------------- 1. confinement

/** Every `tsconfig*.json` in the workspace, ignoring installed, generated and scratch trees. */
const tsconfigs = (directory = ROOT, found: string[] = []): string[] => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'artifacts' || entry.name.startsWith('.')) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) tsconfigs(absolute, found);
    else if (/^tsconfig.*\.json$/.test(entry.name)) found.push(absolute.slice(ROOT.length + 1).replaceAll('\\', '/'));
  }
  return found.sort();
};

/**
 * What each excepted project must say about itself.
 *
 * The two server projects cite ADR-0002 and the client cites ADR-0004. The root tooling project predates the ADR
 * index: UDG-001 decision D1 is recorded in that task's assignment record, and the file's own comment names the
 * two vendor bundles that motivated it. So the root check is that it states its own reason **and cites neither
 * ADR**, which is what stops a later relaxation hiding behind the server or client precedent.
 */
const authorityOf = (config: string): ((text: string) => string | undefined) => {
  if (config.startsWith('apps/server/')) {
    return (text) => (text.includes('ADR-0002') ? undefined : 'must cite ADR-0002');
  }
  if (config === 'apps/client/tsconfig.json') {
    return (text) => (text.includes('ADR-0004') ? undefined : 'must cite ADR-0004');
  }
  return (text) =>
    text.includes('playwright-core') && text.includes('vitest') && !text.includes('ADR-0002') && !text.includes('ADR-0004')
      ? undefined
      : 'must state its own UDG-001 D1 reason (playwright-core/vitest declarations) and cite neither ADR-0002 nor ADR-0004';
};

const APPROVED_EXCEPTED = ['apps/client/tsconfig.json', 'apps/server/tsconfig.json', 'apps/server/tsconfig.probes.json', 'tsconfig.json'];

describe('UDG-SPIKE-001 — ADR-0004 keeps the client exception confined and visible', () => {
  it('excepts declaration checking in exactly the four approved projects, each citing its own authority', () => {
    const configs = tsconfigs();
    expect(configs.length, 'the scan must see the workspace tsconfigs').toBeGreaterThan(8);
    const excepted = configs.filter((config) => read(config).includes('"skipLibCheck": true'));
    expect(excepted.sort()).toEqual([...APPROVED_EXCEPTED].sort());

    // Each one says where its permission comes from, so precedent cannot be borrowed silently.
    for (const config of APPROVED_EXCEPTED) {
      const problem = authorityOf(config)(read(config));
      expect(problem, `${config} sets skipLibCheck: true and ${problem ?? 'is correctly documented'}`).toBeUndefined();
    }

    // The shared policy is not what moved.
    const base = JSON.parse(read('tsconfig.base.json')) as { compilerOptions: Record<string, unknown> };
    expect(base.compilerOptions['skipLibCheck']).toBe(false);
    expect(base.compilerOptions['strict']).toBe(true);
    expect(base.compilerOptions['noImplicitAny']).toBe(true);
    expect(base.compilerOptions['exactOptionalPropertyTypes']).toBe(true);
    expect(base.compilerOptions['noUncheckedIndexedAccess']).toBe(true);
    expect(base.compilerOptions['esModuleInterop']).toBe(false);

    // The client's own dev-seam project imports no Colyseus module, so it keeps full checking. Nothing else in
    // the client moved either: no ambient types, no synthetic defaults, no `--noCheck` hidden in a config.
    const client = JSON.parse(read('apps/client/tsconfig.json')) as { compilerOptions: Record<string, unknown> };
    expect(client.compilerOptions['types']).toEqual([]);
    for (const flag of ['allowSyntheticDefaultImports', 'noImplicitAny', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess', 'esModuleInterop', 'noEmit']) {
      expect(client.compilerOptions[flag], `apps/client/tsconfig.json must not set ${flag}`).toBeUndefined();
    }
    expect(read('apps/client/tsconfig.tools.json'), 'the dev-seam project stays strict').not.toContain('"skipLibCheck": true');
    for (const config of configs) {
      expect(read(config), `${config} must keep --noCheck on a command line, not in a config`).not.toMatch(/"noCheck"/);
    }
  });

  it('keeps the client gate clean, which is the only thing the exception may buy', () => {
    const gate = run('pnpm', ['--filter', '@udg/client', 'typecheck']);
    expect(gate.exitCode, `${gate.stdout}${gate.stderr}`).toBe(0);
  });
});

// --------------------------------------------------------------------------- 2. inventory

interface Diagnostic {
  readonly file: string;
  readonly code: string;
  readonly message: string;
}

/** Parse `tsc --pretty false` output. Continuation lines belong to the preceding diagnostic. */
const parseDiagnostics = (output: string): Diagnostic[] => {
  const found: Diagnostic[] = [];
  for (const line of output.split('\n')) {
    const match = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line);
    if (match === null) continue;
    found.push({ file: match[1] ?? '', code: match[4] ?? '', message: match[5] ?? '' });
  }
  return found;
};

const packageRelative = (file: string): string => {
  const marker = 'node_modules/';
  const index = file.lastIndexOf(marker);
  return index === -1 ? file : file.slice(index + marker.length).replaceAll('\\', '/');
};

const firstParty = (file: string): boolean => !file.includes('node_modules');

const inventoryOf = (diagnostics: readonly Diagnostic[]): string => {
  const counts = new Map<string, number>();
  for (const diagnostic of diagnostics) {
    const key = `${packageRelative(diagnostic.file)}|${diagnostic.code}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => `${key} x${String(count)}`).sort().join('\n');
};

describe('UDG-SPIKE-001 — the retained strict check keeps the vendor defects visible', () => {
  const strict = run('pnpm', ['--filter', '@udg/client', 'typecheck:declarations']);
  const diagnostics = parseDiagnostics(strict.stdout);

  it('still fails, and still only inside vendor declarations', () => {
    expect(strict.exitCode, 'the retained strict check must keep reporting the vendor defects').not.toBe(0);
    expect(diagnostics.length, strict.stdout).toBeGreaterThan(0);
    const ours = diagnostics.filter((diagnostic) => firstParty(diagnostic.file));
    expect(ours.map((diagnostic) => `${diagnostic.file} ${diagnostic.code}: ${diagnostic.message}`), 'no first-party diagnostic may hide behind the exception').toEqual([]);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.file).toContain('node_modules');
      expect(packageRelative(diagnostic.file)).toMatch(/\.d\.(ts|mts|cts)$/);
      expect(packageRelative(diagnostic.file)).toMatch(/^@colyseus\//);
    }
  });

  it('matches the pinned inventory exactly, so a vendor drift is a review event', () => {
    const pinned = JSON.parse(read('docs/integration/colyseus-client-declaration-inventory.json')) as {
      adr: string;
      totalDiagnostics: number;
      firstPartyDiagnostics: number;
      entries: { readonly origin: string; readonly code: string; readonly count: number; readonly message: string }[];
    };
    expect(pinned.adr).toContain('0004');
    expect(pinned.firstPartyDiagnostics).toBe(0);
    expect(pinned.totalDiagnostics).toBe(pinned.entries.reduce((total, entry) => total + entry.count, 0));
    const fromDocument = inventoryOf(
      pinned.entries.flatMap((entry) =>
        Array.from({ length: entry.count }, () => ({ file: entry.origin.split('::')[1] ?? entry.origin, code: entry.code, message: entry.message })),
      ),
    );
    expect(inventoryOf(diagnostics)).toBe(fromDocument);
    expect(diagnostics.length).toBe(pinned.totalDiagnostics);
  });

  it('names the client exception in the api map, apart from the runtime claim', () => {
    const apiMap = read('docs/integration/colyseus-0.18-api-map.md');
    expect(apiMap).toContain('§12');
    expect(apiMap).toContain('ADR-0004');
    expect(apiMap).toContain('colyseus-client-declaration-inventory.json');
    // The distinction has to be written down, not implied: vendor declarations are defective, the runtime path
    // the browser smoke exercises is a separate claim with its own row and its own evidence.
    expect(apiMap).toMatch(/Did those diagnostics cost anything at runtime\?/);
    expect(apiMap).toMatch(/Is the pinned stack compatible at runtime\?/);
    expect(apiMap).toContain('tests/e2e/netcode.spec.ts');
  });
});

// --------------------------------------------------------------------------- 3. controls

/**
 * Misuse fixtures, compiled with the exception **in force**.
 *
 * Each entry is a file that must produce at least one diagnostic carrying `expectCode`, so the exception cannot
 * quietly become a licence to misuse the SDK. `positive` is the counterweight: correct public usage must still
 * compile, which is what proves the fixtures fail for their own reasons and not for a broken project.
 */
const CONTROLS: readonly { readonly file: string; readonly expectCode: string; readonly source: string }[] = [
  {
    file: 'control-unknown-member.ts',
    expectCode: 'TS2339',
    source: `import { Client } from '@colyseus/sdk';
const client = new Client('http://127.0.0.1:1');
export const probe = (): unknown => client.thisIsNotAnSdkMethod();
`,
  },
  {
    file: 'control-join-arity.ts',
    expectCode: 'TS2554',
    source: `import { Client } from '@colyseus/sdk';
const client = new Client('http://127.0.0.1:1');
export const probe = async (): Promise<unknown> => client.joinById();
`,
  },
  {
    file: 'control-join-target.ts',
    expectCode: 'TS2322',
    source: `import { joinPredictionSeat } from '../src/network/ColyseusPredictionAdapter.js';
export const probe = (): Promise<unknown> =>
  joinPredictionSeat({
    endpoint: 'http://127.0.0.1:1',
    join: { mode: 'sideways', roomName: 'region' },
    presentation: { protocolVersion: 'p', configHash: 'c', manifestHash: 'm' },
  });
`,
  },
  {
    file: 'control-readonly-view.ts',
    expectCode: 'TS2540',
    source: `import type { SeatObservation } from '../src/network/ColyseusPredictionAdapter.js';
export const probe = (observation: SeatObservation): void => {
  observation.x = 5;
};
`,
  },
  {
    file: 'control-axis-type.ts',
    expectCode: 'TS2339',
    source: `import { joinPredictionSeat } from '../src/network/ColyseusPredictionAdapter.js';
export const probe = async (seat: Awaited<ReturnType<typeof joinPredictionSeat>>): void => {
  const frame = seat.sendDirect({ generation: 1, moveX: 'north', moveZ: 0 });
  void frame.seq.trim();
};
`,
  },
];

const POSITIVE = {
  file: 'control-positive-usage.ts',
  source: `import { Client } from '@colyseus/sdk';
import { joinPredictionSeat, type PredictionSeat, type RegionJoinPresentation } from '../src/network/ColyseusPredictionAdapter.js';
import { createRemotePresentation } from '../src/network/RemotePresentation.js';

const presentation: RegionJoinPresentation = { protocolVersion: 'p', configHash: 'c', manifestHash: 'm' };

export const probe = async (): Promise<number> => {
  const client = new Client('http://127.0.0.1:1');
  void client;
  const seat: PredictionSeat = await joinPredictionSeat({
    endpoint: 'http://127.0.0.1:1',
    join: { mode: 'create', roomName: 'region' },
    presentation,
  });
  const remote = createRemotePresentation();
  remote.observe(seat.snapshot());
  seat.sendDirect({ generation: 1, moveX: 0, moveZ: 1 });
  const track = remote.trackOf(seat.sessionId);
  return track?.distinctTicks ?? 0;
};
`,
};

const CONTROL_DIRECTORY = join(ROOT, 'apps', 'client', '.adr0004-controls');

const writeControls = (): void => {
  // A self-ignoring directory inside `apps/client`: the fixtures must resolve `@colyseus/sdk` exactly as the
  // client does, which only a file under that package can do. Nothing here outlives the run.
  mkdirSync(CONTROL_DIRECTORY, { recursive: true });
  writeFileSync(join(CONTROL_DIRECTORY, '.gitignore'), '*\n');
  for (const control of [...CONTROLS, POSITIVE]) {
    writeFileSync(join(CONTROL_DIRECTORY, control.file), control.source);
  }
  writeFileSync(
    join(CONTROL_DIRECTORY, 'tsconfig.json'),
    `${JSON.stringify(
      {
        extends: '../../../tsconfig.base.json',
        compilerOptions: { noEmit: true, skipLibCheck: true, lib: ['ES2024', 'DOM', 'DOM.Iterable'], types: [] },
        include: [...CONTROLS.map((control) => control.file), POSITIVE.file],
      },
      null,
      2,
    )}\n`,
  );
};

afterAll(() => {
  rmSync(CONTROL_DIRECTORY, { recursive: true, force: true });
});

describe('UDG-SPIKE-001 — the exception does not blunt the compiler', () => {
  const compiled = (() => {
    writeControls();
    const run0 = run('node', [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(CONTROL_DIRECTORY, 'tsconfig.json'), '--noEmit', '--pretty', 'false']);
    return { ...run0, diagnostics: parseDiagnostics(run0.stdout) };
  })();

  it('compiles the controls at all (a project that never ran proves nothing)', () => {
    expect(compiled.exitCode, `${compiled.stdout}${compiled.stderr}`).not.toBe(0);
    expect(compiled.diagnostics.length).toBeGreaterThan(0);
  });

  it('refuses every unsupported SDK call and invalid input it was given', () => {
    for (const control of CONTROLS) {
      const mine = compiled.diagnostics.filter((diagnostic) => diagnostic.file.endsWith(control.file));
      expect(mine.length, `${control.file} must fail to compile`).toBeGreaterThan(0);
      expect(mine.map((diagnostic) => diagnostic.code), `${control.file} must fail with ${control.expectCode}`).toContain(control.expectCode);
    }
  });

  it('still accepts correct public usage, so the controls fail for their own reasons', () => {
    const noise = compiled.diagnostics.filter((diagnostic) => diagnostic.file.endsWith(POSITIVE.file));
    expect(noise.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)).toEqual([]);
  });

  it('reports nothing outside the control files and the vendor tree', () => {
    const unexpected = compiled.diagnostics.filter(
      (diagnostic) => !diagnostic.file.includes('.adr0004-controls') && !diagnostic.file.includes('node_modules'),
    );
    expect(unexpected.map((diagnostic) => `${diagnostic.file} ${diagnostic.code}`)).toEqual([]);
  });
});

// --------------------------------------------------------------------------- 4. seat source policy

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

describe('UDG-SPIKE-001 — the seat modules keep the prohibitions the ADR rests on', () => {
  const adapter = 'apps/client/src/network/ColyseusPredictionAdapter.ts';
  const remote = 'apps/client/src/network/RemotePresentation.ts';

  it('carry no suppression comment, ambient shim, any or broad cast', () => {
    for (const file of [adapter, remote]) {
      const source = stripComments(read(file));
      for (const forbidden of ['@ts-ignore', '@ts-expect-error', '@ts-nocheck', 'declare module', 'declare global', ': any', 'as any', ' as unknown as ', 'require(']) {
        expect(source, `${file} must not contain ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('never touch a reconnection token, and hold no credential in the published surface', () => {
    for (const file of [adapter, remote]) {
      expect(stripComments(read(file)), `${file} must not read a reconnection token`).not.toContain('reconnectionToken');
    }
    expect(stripComments(read(remote)), 'remote presentation holds no client, room or SDK import').not.toContain('@colyseus/');
  });

  it('name the public SDK members the api map records, and no private ones', () => {
    const source = stripComments(read(adapter));
    for (const member of ['new Client(', '.create<', '.joinById<', '.input<', '.onStateChange(', '.leave()', '.sentCount', '.lastProcessed', '.send()']) {
      expect(source, `the seat must use the documented ${member}`).toContain(member);
    }
    expect(source, 'no private field access').not.toMatch(/#\w+/);
  });
});

// --------------------------------------------------------------------------- 5. grant T-1

describe('UDG-SPIKE-001 — grant T-1(a): netcode dispatches, the owed suites still refuse', () => {
  it('marks a suite implemented if and only if its spec file exists, for every row', () => {
    for (const [name, row] of Object.entries(E2E_SUITES)) {
      expect(row.implemented, `${name}: implemented must match the filesystem`).toBe(existsSync(join(ROOT, row.specPath)));
    }
    expect(E2E_SUITES['netcode']?.owningTask).toBe('UDG-SPIKE-001');
  });

  it('dispatches netcode and camera, and refuses physics, input and hybrid with their owners named', () => {
    expect(guardUnavailable('test:e2e', ['--suite=netcode']).exitCode, 'netcode dispatches now that its spec exists').toBe(0);
    expect(guardUnavailable('test:e2e', ['--suite=camera']).exitCode).toBe(0);
    for (const [suite, owner] of [['physics', 'UDG-006'], ['input', 'UDG-008'], ['hybrid', 'UDG-SPIKE-003']] as const) {
      const guard = guardUnavailable('test:e2e', [`--suite=${suite}`]);
      expect(guard.exitCode, `${suite} must still refuse`).toBe(1);
      expect(guard.message).toContain(owner);
      expect(guard.message).toContain('never reported as a pass');
    }
    expect(guardUnavailable('test:e2e', ['--suite=nonsense']).exitCode).toBe(2);
    expect(guardUnavailable('test:e2e', []).exitCode).toBe(1);
  });

  it('still refuses the spike command, because this slice built no spike harness', () => {
    const spike = guardUnavailable('test:spike', ['--id', 'UDG-SPIKE-001']);
    expect(spike.exitCode, 'the spike harness is a later slice').toBe(1);
    expect(spike.message).toContain('UDG-SPIKE-001');
    expect(spike.message).toContain('never reported as a pass');
    expect(guardUnavailable('test:spike', ['--id', 'UDG-SPIKE-002']).exitCode).toBe(1);
    expect(guardUnavailable('test:spike', []).exitCode).toBe(1);
    // An id the task index does not contain is refused by the same guard that owns the command (exit 1), and the
    // refusal still names what is owed rather than pretending to have run something.
    const unknown = guardUnavailable('test:spike', ['--id', 'UDG-NOPE']);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.message).toContain('never reported as a pass');
  });
});

// --------------------------------------------------------------------------- 6. the registered pin

describe('UDG-SPIKE-001 — the client SDK dependency is the registered pin, not an incidental install', () => {
  it('is declared once in apps/client at 0.18.9 and recorded in the register', () => {
    const manifest = JSON.parse(read('apps/client/package.json')) as { dependencies: Record<string, string> };
    expect(manifest.dependencies['@colyseus/sdk']).toBe('0.18.9');
    const register = JSON.parse(read('docs/integration/dependencies.json')) as {
      workspaces: { readonly dir: string; readonly dependencies: Record<string, string> }[];
      packages: { readonly name: string; readonly declared: string; readonly importedBy: readonly string[] }[];
    };
    expect(register.workspaces.find((workspace) => workspace.dir === 'apps/client')?.dependencies['@colyseus/sdk']).toBe('0.18.9');
    const entry = register.packages.find((pkg) => pkg.name === '@colyseus/sdk');
    expect(entry?.declared).toBe('0.18.9');
    expect(entry?.importedBy).toContain('apps/client');
    // No new pin arrived with this slice: the workspace still installs one SDK version, and no server pin moved.
    const serverManifest = JSON.parse(read('apps/server/package.json')) as { dependencies: Record<string, string> };
    expect(serverManifest.dependencies['@colyseus/sdk']).toBe('0.18.9');
    expect(manifest.dependencies['@colyseus/core']).toBeUndefined();
    expect(manifest.dependencies['@colyseus/ws-transport']).toBeUndefined();
    expect(manifest.dependencies['@colyseus/schema']).toBeUndefined();
  });

  it('is reachable from the client through the declared dependency, not a hoisted accident', () => {
    const path = join(ROOT, 'apps', 'client', 'node_modules', '@colyseus', 'sdk', 'package.json');
    expect(existsSync(path), 'pnpm must have linked the pin into apps/client').toBe(true);
    expect((JSON.parse(readFileSync(path, 'utf8')) as { version: string }).version).toBe('0.18.9');
  });
});
