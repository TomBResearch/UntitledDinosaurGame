/**
 * UDG-SPIKE-001 — the client-side API probe (assignment §5 item 1).
 *
 * ## What it records, and why a probe rather than a comment
 *
 * The assignment asks for the **observed public surfaces** of the pinned `@colyseus/sdk` on the client side to be
 * recorded, not asserted from documentation. This file therefore reads the installed declarations and the pinned
 * inventory as they exist on disk, and writes a machine-readable record of:
 *
 * 1. the exact declared signature of every client name api map §12 claims — extracted from the `.d.ts` text, so a
 *    drift between the map and the package shows up as a failed check rather than as a stale sentence;
 * 2. the strict declaration-check inventory of the real client project (`--skipLibCheck false`), separated into
 *    vendor and first-party, with the first-party count required to be zero;
 * 3. the seat's own published `.d.ts` surface, when the client has been built, so the exported names are visible
 *    as emitted types rather than as a summary.
 *
 * ## What it does not do
 *
 * It imports no Colyseus package: the bare specifier resolves from `apps/client`, not from `tests/`, and a probe
 * that quietly re-pinned or hand-loaded a package would prove nothing about what the client imports. Runtime
 * behaviour is proved by `tests/e2e/netcode.spec.ts`, which drives two browsers, and by the accepted server probes;
 * this file's claims are declarations and inventory only. **Gate A is Not Run.**
 *
 * ## How to run it
 *
 * ```sh
 * pnpm build:libraries && pnpm --filter @udg/client build   # optional: adds the emitted .d.ts record
 * node tests/probes/colyseus-client.probe.ts                # writes artifacts/spike-001/…-result.json
 * UDG_CLIENT_PROBE_RESULT=/tmp/client.json node tests/probes/colyseus-client.probe.ts
 * ```
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Deliberately NOT under `artifacts/probes/`: that directory is the accepted probe ledger, whose invocation
// gate attributes every `*.probe-result.json` there to a registered probe run (UDG-003, R-7). This probe is not
// a registered PR id — registering one is `tools/checks/src/evidence.ts`'s business under grant T-5, not this
// slice's — so it records beside its own task instead of appearing in a ledger nobody owns for it.
const OUT = process.env['UDG_CLIENT_PROBE_RESULT'] ?? join('artifacts', 'spike-001', 'UDG-SPIKE-001-client.probe-result.json');

/** The client names api map §12 claims, with the declaration file each must appear in. */
const PUBLIC_SURFACE: readonly { readonly name: string; readonly declaration: string; readonly find: RegExp }[] = [
  { name: 'Client constructor', declaration: 'Client.d.ts', find: /constructor\(settings\?: string \| EndpointSettings, options\?: ClientOptions\)/ },
  { name: 'client.create<State>', declaration: 'Client.d.ts', find: /create<State = any>\(roomName: string, options\?: JoinOptions, rootSchema\?: SchemaConstructor<State>\): Promise<Room<any, State>>/ },
  { name: 'client.joinById<State>', declaration: 'Client.d.ts', find: /joinById<State = any>\(roomId: string, options\?: JoinOptions, rootSchema\?: SchemaConstructor<State>\): Promise<Room<any, State>>/ },
  { name: 'room.state', declaration: 'Room.d.ts', find: /get state\(\): State/ },
  { name: 'room.sessionId', declaration: 'Room.d.ts', find: /sessionId: string/ },
  { name: 'room.roomId', declaration: 'Room.d.ts', find: /roomId: string/ },
  { name: 'room.onStateChange', declaration: 'Room.d.ts', find: /onStateChange: \{/ },
  { name: 'room.input<I>', declaration: 'Room.d.ts', find: /input<I = .*>\(options\?: InputOptions<I>\): InputHandle<I>/ },
  { name: 'room.leave(consented?)', declaration: 'Room.d.ts', find: /leave\(consented\?: boolean\): Promise<number>/ },
  { name: 'InputHandle.data', declaration: 'input/InputHandle.d.ts', find: /readonly data: I/ },
  { name: 'InputHandle.send()', declaration: 'input/InputHandle.d.ts', find: /send\(\): number/ },
  { name: 'InputHandle.sentCount', declaration: 'input/InputHandle.d.ts', find: /readonly sentCount: number/ },
  { name: 'InputHandle.lastProcessed', declaration: 'input/InputHandle.d.ts', find: /readonly lastProcessed: number/ },
  { name: 'InputHandle.tickRate', declaration: 'input/InputHandle.d.ts', find: /readonly tickRate\?: number/ },
  { name: 'InputHandle.stepMs', declaration: 'input/InputHandle.d.ts', find: /readonly stepMs\?: number/ },
  { name: 'InputHandle.patchRate', declaration: 'input/InputHandle.d.ts', find: /readonly patchRate\?: number/ },
];

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** The installed SDK declaration directory, read from the client's own dependency link. */
const sdkBuild = (): string => {
  const manifestPath = join(ROOT, 'apps', 'client', 'node_modules', '@colyseus', 'sdk', 'package.json');
  if (!existsSync(manifestPath)) throw new Error('apps/client declares no @colyseus/sdk — the ADR-0004 registration is missing');
  return join(dirname(manifestPath), 'build');
};

/** Locate a declaration file inside a pinned package's build tree, resolving `@colyseus/core` through the SDK's own link. */
const declarationText = (build: string, file: string): string => {
  const direct = join(build, file);
  if (existsSync(direct)) return readFileSync(direct, 'utf8');
  throw new Error(`no declaration file at ${direct}`);
};

interface Diagnostic {
  readonly file: string;
  readonly code: string;
}

const parse = (output: string): Diagnostic[] =>
  output
    .split('\n')
    .map((line) => /^(.+?)\(\d+,\d+\): error (TS\d+):/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ file: match[1] ?? '', code: match[2] ?? '' }));

const main = (): number => {
  const checks: Check[] = [];
  const observations: Record<string, unknown> = {};
  const limitations: string[] = [];
  const build = sdkBuild();
  const sdkManifest = JSON.parse(readFileSync(join(build, '..', 'package.json'), 'utf8')) as { version: string; exports?: Record<string, unknown> };

  observations['sdk'] = {
    version: sdkManifest.version,
    entryPoints: Object.keys(sdkManifest.exports ?? {}),
    buildFiles: readdirSync(build).filter((name) => name.endsWith('.d.ts')).length,
  };

  // 1. every public name api map §12 claims, found in the declaration it is claimed to live in.
  const coreBuild = join(ROOT, 'apps', 'client', 'node_modules', '@colyseus', 'sdk', 'node_modules', '@colyseus', 'core', 'build');
  const coreBuildFallback = join(ROOT, 'apps', 'server', 'node_modules', '@colyseus', 'core', 'build');
  for (const entry of PUBLIC_SURFACE) {
    let text: string;
    try {
      text = declarationText(build, entry.declaration);
    } catch {
      // `@colyseus/core`'s declarations are not inside the SDK tree; the workspace link is the same pin.
      text = existsSync(join(coreBuild, entry.declaration))
        ? readFileSync(join(coreBuild, entry.declaration), 'utf8')
        : readFileSync(join(coreBuildFallback, entry.declaration), 'utf8');
    }
    const found = entry.find.test(text);
    checks.push({ name: `surface:${entry.name}`, ok: found, detail: found ? `declared in ${entry.declaration}` : `NOT DECLARED as api map §12 states (${entry.declaration})` });
  }

  // 2. the strict declaration-check inventory of the real client project.
  const strict = spawnSync('pnpm', ['--filter', '@udg/client', 'typecheck:declarations'], { cwd: ROOT, encoding: 'utf8', timeout: 300_000 });
  const diagnostics = parse(`${strict.stdout ?? ''}\n${strict.stderr ?? ''}`);
  const vendor = diagnostics.filter((diagnostic) => diagnostic.file.includes('node_modules'));
  const firstParty = diagnostics.filter((diagnostic) => !diagnostic.file.includes('node_modules'));
  const pinned = JSON.parse(readFileSync(join(ROOT, 'docs', 'integration', 'colyseus-client-declaration-inventory.json'), 'utf8')) as {
    totalDiagnostics: number;
    adr: string;
    entries: readonly { readonly origin: string; readonly code: string; readonly count: number }[];
  };
  const counts = new Map<string, number>();
  for (const diagnostic of vendor) {
    const key = diagnostic.code;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const liveByCode = [...counts.entries()].map(([code, count]) => `${code} x${String(count)}`).sort().join('\n');
  const pinnedByCode = pinned.entries
    .reduce<Record<string, number>>((accumulator, entry) => {
      accumulator[entry.code] = (accumulator[entry.code] ?? 0) + entry.count;
      return accumulator;
    }, {});
  const pinnedCodes = [...Object.entries(pinnedByCode)].map(([code, count]) => `${code} x${String(count)}`).sort().join('\n');

  observations['strictCheck'] = {
    exitCode: strict.status ?? -1,
    totalDiagnostics: diagnostics.length,
    vendorDiagnostics: vendor.length,
    firstPartyDiagnostics: firstParty.length,
    inventoryByCode: liveByCode,
    pinnedFile: 'docs/integration/colyseus-client-declaration-inventory.json',
    pinnedAuthority: pinned.adr,
  };
  checks.push({ name: 'strict-check-still-fails', ok: (strict.status ?? 0) !== 0, detail: `exit ${String(strict.status ?? -1)}: the vendor defects must keep being reported` });
  checks.push({ name: 'strict-check-has-no-first-party-diagnostic', ok: firstParty.length === 0, detail: firstParty.map((diagnostic) => `${diagnostic.file} ${diagnostic.code}`).join('; ') || '0 in repository code' });
  checks.push({ name: 'strict-check-matches-the-pinned-inventory', ok: liveByCode === pinnedCodes && diagnostics.length === pinned.totalDiagnostics, detail: `live [${liveByCode}] vs pinned [${pinnedCodes}] (${String(diagnostics.length)}/${String(pinned.totalDiagnostics)})` });

  // 3. the seat's emitted public surface, when the client has been built.
  const emittedTypes = join(ROOT, 'apps', 'client', 'dist', 'network', 'ColyseusPredictionAdapter.d.ts');
  observations['emittedSurface'] = existsSync(emittedTypes)
    ? readFileSync(emittedTypes, 'utf8').split('\n').filter((line) => /^(export|declare)/.test(line))
    : 'apps/client has not been built in this run; no emitted surface to record';
  const remoteTypes = join(ROOT, 'apps', 'client', 'dist', 'network', 'RemotePresentation.d.ts');
  observations['remotePresentationImportsNoSdk'] = existsSync(remoteTypes)
    ? !readFileSync(remoteTypes, 'utf8').includes('@colyseus/')
    : 'not built';

  limitations.push('Declarations and inventory only: this probe proves what the pinned packages publish and what the compiler reports about them, never runtime behaviour (tests/e2e/netcode.spec.ts and the accepted server probes carry that).');
  limitations.push('Gate A is Not Run; no threshold, profile, correction or P06 claim appears here, and stackCompatibility remains not-established.');

  const verdict = checks.every((check) => check.ok) ? 'pass' : 'fail';
  const body = {
    probeId: 'UDG-SPIKE-001-CLIENT',
    subject: 'pinned @colyseus/sdk client public surface and the ADR-0004 strict declaration inventory',
    taskId: 'UDG-SPIKE-001',
    startedAt: new Date().toISOString(),
    ok: verdict === 'pass',
    verdict,
    checks,
    observations,
    limitations,
  };
  const out = join(ROOT, OUT);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(body, null, 2)}\n`);
  process.stdout.write(`${verdict}: ${String(checks.filter((check) => check.ok).length)}/${String(checks.length)} checks — ${out}\n`);
  for (const check of checks.filter((entry) => !entry.ok)) process.stdout.write(`  FAIL ${check.name}: ${check.detail}\n`);
  return verdict === 'pass' ? 0 : 1;
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
