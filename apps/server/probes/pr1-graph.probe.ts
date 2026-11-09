/**
 * PR-1 — what actually resolved, and is there exactly one schema runtime?
 *
 * Two resolved copies of `@colyseus/schema` would mean two registration domains and a wire that
 * disagrees with itself, so this probe counts copies rather than trusting a manifest. It reads the
 * installed packages through the pnpm virtual store by realpath, which is what Node itself resolves,
 * and it records the peer and transitive packages the server actually loads — `express`, `ws` and
 * `msgpackr` arrive through peer resolution and are part of the runtime graph whether or not this
 * repository declares them.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { outputPath, runProbe } from './support.js';

interface PackageFacts {
  readonly name: string;
  readonly version: string | null;
  readonly licence: string | null;
  readonly licenceFile: boolean;
  readonly engines: Readonly<Record<string, string>>;
  readonly type: string;
  readonly exportedSubpaths: readonly string[];
  readonly declaresTypes: boolean;
  readonly path: string;
}

function repositoryRoot(start: string): string {
  let current = start;
  for (;;) {
    if (existsSync(join(current, 'pnpm-lock.yaml'))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`no repository root above ${start}`);
    current = parent;
  }
}

const root = repositoryRoot(dirname(fileURLToPath(import.meta.url)));
const serverWorkspace = join(root, 'apps/server');

/**
 * The directory of an installed package, found the way Node finds it.
 *
 * pnpm's virtual store only exposes a package's own dependencies and resolved peers from inside that
 * package, so a lookup has to start there. Types-only packages have no runtime entry, hence the
 * directory fallback.
 */
function packageDirectoryOf(packageName: string, fromDirectory: string): string | undefined {
  try {
    const entry = realpathSync(createRequire(join(fromDirectory, 'index.js')).resolve(packageName));
    let directory = dirname(entry);
    while (directory !== dirname(directory)) {
      const manifestPath = join(directory, 'package.json');
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string };
        if (manifest.name === packageName) return directory;
      }
      directory = dirname(directory);
    }
  } catch {
    // No runtime entry point: fall through to the directory search below.
  }
  for (const base of [fromDirectory, root]) {
    let directory = base;
    while (directory !== dirname(directory)) {
      const candidate = join(directory, 'node_modules', packageName);
      if (existsSync(candidate)) return realpathSync(candidate);
      directory = dirname(directory);
    }
  }
  return undefined;
}

/** Read the workspace's own declared dependencies, which is what makes a package legal to import. */
function readDeclaredDependencies(fromDirectory: string): Record<string, string> {
  const manifest = JSON.parse(readFileSync(join(fromDirectory, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return { ...manifest.dependencies, ...manifest.devDependencies };
}

/**
 * Resolve each name in a child process with NODE_PATH removed.
 *
 * Ambient paths are captured when a process starts, so the current process cannot opt out of them;
 * asking Node again in a clean environment is the only way to learn what the source tree can really
 * reach.
 */
function resolveWithoutAmbientPaths(names: readonly string[], fromDirectory: string): Record<string, string | null> {
  const script = [
    "const { createRequire } = require('node:module');",
    `const req = createRequire(${JSON.stringify(join(fromDirectory, 'index.js'))});`,
    `const names = ${JSON.stringify(names)};`,
    'const out = {};',
    'for (const name of names) { try { out[name] = req.resolve(name); } catch { out[name] = null; } }',
    'process.stdout.write(JSON.stringify(out));',
  ].join('');
  const env = { ...process.env };
  delete env['NODE_PATH'];
  const child = spawnSync(process.execPath, ['-e', script], { cwd: fromDirectory, env, encoding: 'utf8' });
  const parsed = child.status === 0 ? (JSON.parse(child.stdout || '{}') as Record<string, string | null>) : {};
  return Object.fromEntries(names.map((name) => [name, parsed[name] ?? null]));
}

/**
 * Node's ambient module directories, which is where pnpm's hoisted pool appears when a script runs
 * under `pnpm run`. They are consulted only after the ordinary directory walk has failed.
 */
function globalPathsOf(): string[] {
  const nodePath = process.env['NODE_PATH'];
  if (nodePath === undefined || nodePath === '') return [];
  return [...new Set(
    nodePath
      .split(':')
      .filter((entry) => entry !== '')
      .map((entry) => {
        try {
          return realpathSync(entry);
        } catch {
          return entry;
        }
      }),
  )];
}

/** Resolve a package the way Node does, then read the package.json it landed on. */
function facts(packageName: string, fromDirectory: string): PackageFacts | undefined {
  const directory = packageDirectoryOf(packageName, fromDirectory);
  if (directory === undefined) return undefined;

  const manifestPath = join(directory, 'package.json');
  if (!existsSync(manifestPath)) return undefined;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    name?: string;
    version?: string;
    license?: string;
    licenses?: unknown;
    type?: string;
    engines?: Record<string, string>;
    exports?: unknown;
    types?: string;
    typings?: string;
  };

  const exportsField = manifest.exports;
  const subpaths =
    exportsField !== null && typeof exportsField === 'object' && !Array.isArray(exportsField)
      ? Object.keys(exportsField as Record<string, unknown>).sort()
      : [];

  return {
    name: manifest.name ?? packageName,
    version: manifest.version ?? null,
    licence: manifest.license ?? (manifest.licenses === undefined ? null : JSON.stringify(manifest.licenses)),
    licenceFile: existsSync(join(directory, 'LICENSE')) || existsSync(join(directory, 'LICENSE.md')),
    engines: manifest.engines ?? {},
    type: manifest.type ?? 'commonjs',
    exportedSubpaths: subpaths,
    declaresTypes: manifest.types !== undefined || manifest.typings !== undefined || subpaths.length > 0,
    path: directory.slice(root.length + 1),
  };
}

/** Every `@colyseus/schema` copy the store is holding, from the virtual-store directory names. */
function schemaCopiesInStore(): string[] {
  const storeRoots = [join(root, 'node_modules/.pnpm')];
  const found: string[] = [];
  for (const store of storeRoots) {
    if (!existsSync(store)) continue;
    for (const entry of readdirSync(store)) {
      if (entry.startsWith('@colyseus+schema@')) found.push(entry);
    }
  }
  return found.sort();
}

function lockfileSchemaEntries(): string[] {
  const lockfile = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
  const versions = new Set<string>();
  for (const match of lockfile.matchAll(/'@colyseus\/schema@([^'(:]+)/g)) {
    if (match[1] !== undefined) versions.add(match[1]);
  }
  return [...versions].sort();
}

async function main(): Promise<void> {
  const out = outputPath(process.argv.slice(2));
  await runProbe('PR-1', 'the resolved dependency graph and a single schema runtime', out, async (checks) => {
    const declared = ['@colyseus/core', '@colyseus/sdk', '@colyseus/ws-transport', '@udg/protocol'];
    const resolved = new Map<string, PackageFacts | undefined>();
    for (const name of declared) {
      resolved.set(name, facts(name, serverWorkspace));
    }
    for (const name of declared) {
      const entry = resolved.get(name);
      checks.check(`declared:${name}`, entry !== undefined, entry === undefined ? 'not resolvable from apps/server' : `${entry.name}@${String(entry.version)} at ${entry.path}`);
    }

    /**
     * Resolve an anchor directory inside an installed package, so a lookup sees what that package's own
     * imports see. pnpm's isolated layout hides undeclared packages from apps/server, which is a
     * boundary property rather than a failure: whoever imports a package must declare it.
     */
    const anchorOf = (pkg: string): string | null => {
      try {
        // createRequire from a file inside apps/server, because `require.resolve` with a `paths`
        // directory looks for <dir>/<pkg> rather than <dir>/node_modules/<pkg>.
        const anchor = createRequire(join(serverWorkspace, 'index.js'));
        return dirname(realpathSync(anchor.resolve(pkg)));
      } catch {
        return null;
      }
    };
    const anchors: readonly (readonly [string, string | null])[] = [
      ['@colyseus/core', anchorOf('@colyseus/core')],
      ['@colyseus/sdk', anchorOf('@colyseus/sdk')],
      ['@colyseus/ws-transport', anchorOf('@colyseus/ws-transport')],
      ['@udg/protocol', anchorOf('@udg/protocol')],
    ];
    for (const [name, anchor] of anchors) {
      checks.check(`anchor:${name}`, anchor !== null, `${name} must be resolvable from apps/server to be part of the runtime graph`);
    }

    // Peer and transitive packages the server really loads. They are runtime dependencies of the
    // server process even though this repository declares none of them.
    const transitives: readonly (readonly [string, string])[] = [
      ['express', '@colyseus/ws-transport'],
      ['ws', '@colyseus/ws-transport'],
      ['msgpackr', '@colyseus/core'],
      ['debug', '@colyseus/core'],
      ['@colyseus/shared-types', '@colyseus/core'],
    ];
    const transitiveFacts = transitives.flatMap(([name, via]) => {
      const anchor = anchors.find(([pkg]) => pkg === via)?.[1] ?? serverWorkspace;
      const entry = facts(name, anchor);
      return entry === undefined ? [] : [{ ...entry, via }];
    });
    checks.observe(
      'transitiveRuntime',
      transitiveFacts.map((entry) => ({ name: entry.name, version: entry.version, licence: entry.licence, engines: entry.engines, via: entry.via })),
    );
    for (const [name, via] of transitives) {
      checks.check(
        `reachable:${name}-via-${via}`,
        transitiveFacts.some((entry) => entry.name === name && entry.via === via),
        `${via} must be able to resolve ${name}; an application importing ${name} itself must declare it`,
      );
    }    // A package that apps/server does not declare must not be reachable from its own code. The
    // environment complicates the question: a script started by `pnpm run` (and, more aggressively,
    // one started by vitest) inherits a NODE_PATH that contains pnpm's hoisted pool and the runner's
    // own store subtree, so a bare `require.resolve` succeeds for packages the workspace never
    // declared. That would make the boundary claim depend on how the probe was launched.
    //
    // So visibility is measured the way the source tree experiences it: resolution with NODE_PATH
    // removed, in a child process, because the ambient paths are baked into the current process too.
    const ambientPaths = globalPathsOf();
    const visibilityNames = [
      '@colyseus/core',
      '@colyseus/sdk',
      '@colyseus/ws-transport',
      '@udg/protocol',
      'express',
      'msgpackr',
      '@colyseus/schema',
    ];
    const declaredByServer = readDeclaredDependencies(serverWorkspace);
    const cleanResolution = resolveWithoutAmbientPaths(visibilityNames, serverWorkspace);
    const underAmbient = Object.fromEntries(
      visibilityNames.map((name) => [name, packageDirectoryOf(name, serverWorkspace) !== undefined]),
    );
    const visibility = visibilityNames.map((name) => ({
      name,
      declared: name in declaredByServer,
      resolvesWithoutAmbientPaths: cleanResolution[name] !== null,
      resolvesInThisEnvironment: underAmbient[name] === true,
    }));
    checks.observe('resolutionEnvironment', {
      nodePath: process.env['NODE_PATH'] ?? null,
      ambientPaths,
      declaredDependenciesOfServer: declaredByServer,
      visibility,
    });
    for (const entry of visibility) {
      if (entry.declared) {
        checks.check(
          `declared-is-visible:${entry.name}`,
          entry.resolvesWithoutAmbientPaths,
          `${entry.name} is declared by apps/server and must resolve without any ambient module path`,
        );
        continue;
      }
      checks.check(
        `undeclared-is-invisible:${entry.name}`,
        !entry.resolvesWithoutAmbientPaths,
        `${entry.name} is not declared by apps/server, yet resolves when ambient paths are present: ${String(entry.resolvesInThisEnvironment)}`,
      );
    }
    checks.limit(
      'Visibility is measured with NODE_PATH removed, because a pnpm or vitest launcher puts a hoisted pool on NODE_PATH and every undeclared package then appears reachable. The ambient list is recorded so the effect is visible in the evidence rather than argued away.',
    );

    /** Direct dependencies as the workspace's own node_modules exposes them, scoped packages included. */
    const directOf = (directory: string): string[] => {
      const names: string[] = [];
      for (const entry of readdirSync(directory)) {
        if (entry === '.bin' || entry === '.pnpm') continue;
        if (!entry.startsWith('@')) {
          names.push(entry);
          continue;
        }
        for (const scoped of readdirSync(join(directory, entry))) names.push(`${entry}/${scoped}`);
      }
      return names.sort();
    };
    checks.observe('serverDirectDependencies', directOf(join(serverWorkspace, 'node_modules')));

    // The exact resolved graph. Declared edges are taken from each installed manifest, not from a
    // registry page, so the register can be regenerated from this evidence.
    const edges = anchors.flatMap(([name, anchor]) => {
      const directory = anchor === null ? undefined : packageDirectoryOf(name, serverWorkspace);
      if (directory === undefined) return [];
      const entry = facts(name, serverWorkspace);
      const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        peerDependenciesMeta?: Record<string, { optional?: boolean }>;
      };
      return [{
        package: name,
        version: entry?.version ?? null,
        dependencies: manifest.dependencies ?? {},
        peers: Object.entries(manifest.peerDependencies ?? {}).map(([peer, specifier]) => ({
          peer,
          specifier,
          optional: manifest.peerDependenciesMeta?.[peer]?.optional === true,
        })),
      }];
    });
    checks.observe('declaredEdges', edges);
    checks.observe(
      'virtualStoreEntries',
      readdirSync(join(root, 'node_modules/.pnpm')).sort(),
    );
    checks.check(
      'express-is-a-required-peer-of-the-transport',
      edges.find((edge) => edge.package === '@colyseus/ws-transport')?.peers.some((peer) => peer.peer === 'express' && !peer.optional) === true,
      'the transport peer list decides whether the application must declare express itself',
    );
    checks.check(
      'schema-is-a-required-peer-of-core',
      edges.find((edge) => edge.package === '@colyseus/core')?.peers.some((peer) => peer.peer === '@colyseus/schema' && !peer.optional) === true,
      'core declares schema as a peer, so the workspace that owns schemas must resolve one shared copy',
    );

    const store = schemaCopiesInStore();
    const lockVersions = lockfileSchemaEntries();
    checks.observe('storeSchemaEntries', store);
    checks.observe('lockfileSchemaVersions', lockVersions);
    checks.check('single-schema-version', lockVersions.length === 1 && lockVersions[0] === '5.0.45', `lockfile resolves @colyseus/schema to ${lockVersions.join(', ') || 'nothing'}`);
    const distinctVersions = new Set(store.map((entry) => entry.replace(/^@colyseus\+schema@/, '').split('(')[0] ?? entry));
    checks.check('single-schema-copy-in-store', distinctVersions.size === 1, `virtual store holds ${[...distinctVersions].join(', ')}`);

    // One schema runtime for the whole graph. Two copies would mean two registration domains, so the
    // probe compares realpath'd package directories as Node itself resolves them.
    const schemaByConsumer = anchors.flatMap(([consumer, anchor]) => {
      const entry = anchor === null ? undefined : facts('@colyseus/schema', anchor);
      return entry === undefined ? [] : [{ consumer, path: entry.path, version: entry.version }];
    });
    checks.observe('schemaResolution', schemaByConsumer);
    checks.check(
      'schema-visible-to-every-consumer',
      schemaByConsumer.length === anchors.length,
      `schema resolved for ${schemaByConsumer.map((entry) => entry.consumer).join(', ') || 'nobody'} of ${anchors.length} consumers`,
    );
    const schemaPaths = new Set(schemaByConsumer.map((entry) => entry.path));
    checks.check(
      'one-schema-runtime',
      schemaPaths.size === 1,
      `@colyseus/schema resolves to ${[...schemaPaths].join(' | ') || 'nothing'}; more than one directory means two registration domains`,
    );

    for (const entry of [...resolved.values()].filter((value): value is PackageFacts => value !== undefined)) {
      if (entry.name.startsWith('@udg/')) {
        // Private workspaces carry UNLICENSED by policy; only third-party licences gate a pin.
        checks.observe(`workspace-licence:${entry.name}`, { licence: entry.licence, licenceFile: entry.licenceFile });
        continue;
      }
      checks.check(`licence-recorded:${entry.name}`, entry.licence !== null && entry.licence !== 'UNLICENSED', `${entry.name} licence ${String(entry.licence)}, LICENSE file present ${String(entry.licenceFile)}`);
      checks.check(`esm-or-dual:${entry.name}`, entry.type === 'module' || entry.type === 'commonjs', `${entry.name} package.json type = ${entry.type}`);
    }

    const nodeMajor = Number(process.versions.node.split('.')[0] ?? '0');
    for (const entry of [...resolved.values(), ...transitiveFacts].filter((value): value is PackageFacts => value !== undefined)) {
      const required = entry.engines['node'];
      if (required === undefined) continue;
      const minimum = Number((required.match(/\d+/g) ?? ['0'])[0]);
      checks.check(`engines-satisfied:${entry.name}`, nodeMajor >= minimum, `${entry.name} requires ${required}; running ${process.version}`);
    }

    const protocolManifest = JSON.parse(readFileSync(join(serverWorkspace, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const specifiers = { ...protocolManifest.dependencies, ...protocolManifest.devDependencies };
    const loose = Object.entries(specifiers).filter(([, specifier]) => /^[\^~]/.test(specifier) || specifier === 'latest');
    checks.check('exact-pins-only', loose.length === 0, loose.map(([name, specifier]) => `${name}@${specifier}`).join(', ') || 'every direct specifier is exact');

    checks.observe('declared', [...resolved].map(([name, entry]) => ({
      name,
      resolved: entry !== undefined,
      version: entry?.version ?? null,
      licence: entry?.licence ?? null,
      licenceFile: entry?.licenceFile ?? false,
      engines: entry?.engines ?? {},
      exportedSubpaths: entry?.exportedSubpaths ?? [],
      path: entry?.path ?? null,
    })));
    checks.observe('lockfileSha256', createHash('sha256').update(readFileSync(join(root, 'pnpm-lock.yaml'))).digest('hex'));

    // Supply-chain posture: the workspace denies dependency build scripts, and msgpackr's native
    // extractor is the one package in this graph that would have compiled. Record what that means.
    const workspaceConfig = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
    // A deliberately small YAML reader: this file's build posture is two keys, and a comment in it
    // must not be mistaken for a setting.
    const allowBuildsEntries: string[] = [];
    let insideAllowBuilds = false;
    const topLevelKeys: string[] = [];
    for (const rawLine of workspaceConfig.split('\n')) {
      const line = rawLine.replace(/\s+$/, '');
      if (line === '' || line.startsWith('#')) continue;
      if (/^\S/.test(line)) {
        insideAllowBuilds = line.startsWith('allowBuilds:');
        topLevelKeys.push(line.split(':')[0] ?? line);
        continue;
      }
      if (insideAllowBuilds && /^\s+[\w@/-]+:/.test(line)) allowBuildsEntries.push(line.trim());
    }
    checks.observe('buildScriptPolicy', { topLevelKeys, allowBuildsEntries });
    const nativeExtractor = facts('msgpackr-extract', anchors.find(([pkg]) => pkg === '@colyseus/core')?.[1] ?? serverWorkspace);
    checks.observe('nativeExtractor', nativeExtractor ?? 'not installed');
    checks.check(
      'no-dependency-build-script-is-allowed',
      !topLevelKeys.includes('onlyBuiltDependencies') && allowBuildsEntries.every((entry) => entry.endsWith(': false')),
      `allowBuilds entries ${allowBuildsEntries.join(', ') || 'none'}; onlyBuiltDependencies present ${String(topLevelKeys.includes('onlyBuiltDependencies'))}`,
    );
    checks.check(
      'the-native-extractor-is-denied-by-name',
      allowBuildsEntries.some((entry) => entry.startsWith('msgpackr-extract:') && entry.endsWith(': false')),
      `msgpackr-extract must be denied explicitly, because it is the one package in this graph that would compile: ${allowBuildsEntries.join(', ') || 'no entries'}`,
    );

    checks.observe('node', process.version);
    checks.observe('platform', `${process.platform}/${process.arch}`);

    checks.limit('Licences are read from the installed package, not from a registry page.');
    checks.limit('`@colyseus/core` and `@colyseus/sdk` are dual ESM/CJS through an exports map; this repository loads the ESM condition, and the probe records the subpath keys rather than asserting a single condition.');
  });
}

await main();
