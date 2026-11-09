/**
 * Package dependency boundary and cycle checker (UDG-001).
 *
 * Implements the ownership table in docs/contracts/ownership.md 2.3 as an executable check, plus
 * the compiler-policy rules in docs/contracts/UDG-001.md: no DOM library and no ambient browser
 * types outside the client, and no browser global in shared or server code.
 *
 * Two modes:
 *   boundaries.js --workspace-root <root> [--report <file>]   check the real tree
 *   boundaries.js --fixtures <dir> [--report <file>]          run the positive/negative fixtures
 *
 * A negative fixture passes only when the expected rule ids are reported. An unexpected exception
 * or an unrelated rule id is a failure, per tests/AGENTS.md.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  discoverWorkspace,
  extractImports,
  findBrowserGlobals,
  isMainModule,
  parseArgs,
  requireFlag,
  flagString,
  sha256Bytes,
  sha256Canonical,
  sha256File,
  sourceFiles,
  toRepoPath,
  writeJson,
  type CliArgs,
  type PackageInfo,
  type RepoPath,
} from './support.js';

export const BOUNDARY_RULE_IDS = [
  'BOUNDARY-SCHEMA-INTO-DOMAIN',
  'BOUNDARY-DOMAIN-NO-SCHEMA',
  'BOUNDARY-FIRST-PARTY-FORBIDDEN',
  'BOUNDARY-ENGINE-FORBIDDEN',
  'BOUNDARY-UNDECLARED-DEPENDENCY',
  'BOUNDARY-RUNTIME-DEV-DEPENDENCY',
  'BOUNDARY-CROSS-PACKAGE-RELATIVE',
  'BOUNDARY-BROWSER-GLOBAL',
  'BOUNDARY-NODE-BUILTIN-FORBIDDEN',
  'BOUNDARY-CYCLE',
  'BOUNDARY-PACKAGE-CYCLE',
  'BOUNDARY-TSCONFIG-DOM',
  'BOUNDARY-TSCONFIG-AMBIENT-TYPES',
  'BOUNDARY-UNKNOWN-PACKAGE',
] as const;

export type BoundaryRuleId = (typeof BOUNDARY_RULE_IDS)[number];

export interface Violation {
  readonly ruleId: BoundaryRuleId;
  readonly pkg: string;
  readonly file: RepoPath;
  readonly line: number;
  readonly specifier: string;
  readonly detail: string;
}

export interface BoundaryReport {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly workspaceRoot: RepoPath;
  readonly ruleTableHash: string;
  readonly checkedFiles: number;
  readonly violations: readonly Violation[];
  readonly cycles: readonly (readonly string[])[];
  readonly ok: boolean;
}

interface PackageRule {
  readonly pkg: string;
  readonly allowedFirstParty: readonly string[];
  readonly denied: readonly string[];
  readonly allowBrowserGlobals: boolean;
  readonly allowNodeBuiltins: boolean;
  readonly allowedAmbientTypes: readonly string[];
  readonly allowDomLibrary: boolean;
  readonly note: string;
}

/** One row per workspace, transcribed from ownership.md 2.3 and the UDG-001 compiler policy. */
export const PACKAGE_RULES: readonly PackageRule[] = [
  {
    pkg: '@udg/protocol',
    allowedFirstParty: [],
    denied: ['@colyseus/core', '@colyseus/sdk', '@babylonjs/', '@dimforge/', 'recast-navigation', 'react', 'react-dom'],
    allowBrowserGlobals: false,
    allowNodeBuiltins: false,
    allowedAmbientTypes: [],
    allowDomLibrary: false,
    note: 'protocol/domain is TypeScript declarations only; the schema runtime belongs behind the @udg/protocol/schema entry point (UDG-002).',
  },
  {
    pkg: '@udg/config',
    allowedFirstParty: ['@udg/protocol', '@udg/protocol/domain'],
    denied: ['@colyseus/', '@babylonjs/', '@dimforge/', 'recast-navigation', 'react', 'react-dom'],
    allowBrowserGlobals: false,
    allowNodeBuiltins: false,
    allowedAmbientTypes: [],
    allowDomLibrary: false,
    note: 'Config holds shared readonly values for both runtimes, so neither Node nor browser APIs are available to it.',
  },
  {
    pkg: '@udg/simulation',
    allowedFirstParty: ['@udg/protocol', '@udg/protocol/domain', '@udg/config'],
    denied: ['@colyseus/', '@babylonjs/', '@dimforge/', 'recast-navigation', '@recast/', 'react', 'react-dom'],
    allowBrowserGlobals: false,
    allowNodeBuiltins: false,
    allowedAmbientTypes: [],
    allowDomLibrary: false,
    note: 'Shared locomotion consumes interfaces and fixed state only; it may not import a concrete engine, Room, UI or browser API.',
  },
  {
    pkg: '@udg/physics',
    allowedFirstParty: ['@udg/protocol', '@udg/protocol/domain'],
    denied: ['@babylonjs/', 'recast-navigation', '@recast/', '@colyseus/', 'react', 'react-dom'],
    allowBrowserGlobals: false,
    allowNodeBuiltins: false,
    allowedAmbientTypes: [],
    allowDomLibrary: false,
    note: 'Physics may use Rapier (UDG-006) but not Babylon or Recast, and it runs in both runtimes so Node builtins are out too.',
  },
  {
    pkg: '@udg/navigation',
    allowedFirstParty: ['@udg/protocol', '@udg/protocol/domain', '@udg/config'],
    denied: ['@babylonjs/', '@colyseus/', 'react', 'react-dom'],
    allowBrowserGlobals: false,
    allowNodeBuiltins: false,
    allowedAmbientTypes: [],
    allowDomLibrary: false,
    note: 'Server-side Recast queries only; Babylon must never be imported into server navigation.',
  },
  {
    pkg: '@udg/server',
    allowedFirstParty: [
      '@udg/protocol',
      '@udg/protocol/domain',
      '@udg/protocol/schema',
      '@udg/config',
      '@udg/simulation',
      '@udg/physics',
      '@udg/navigation',
    ],
    denied: ['@udg/client', '@babylonjs/', 'react', 'react-dom'],
    allowBrowserGlobals: false,
    allowNodeBuiltins: true,
    allowedAmbientTypes: ['node'],
    allowDomLibrary: false,
    note: 'Server owns authority and replication; client and browser UI are forbidden.',
  },
  {
    pkg: '@udg/client',
    allowedFirstParty: [
      '@udg/protocol',
      '@udg/protocol/domain',
      '@udg/protocol/schema',
      '@udg/config',
      '@udg/simulation',
      '@udg/physics',
      '@udg/navigation',
    ],
    denied: ['@udg/server', '@dimforge/', 'recast-navigation', '@recast/'],
    allowBrowserGlobals: true,
    allowNodeBuiltins: false,
    allowedAmbientTypes: [],
    allowDomLibrary: true,
    note: 'The only DOM-enabled application. Server, filesystem and database modules are forbidden; @udg/navigation is permitted only as an asset-compatibility probe, never as predicted client navigation.',
  },
  {
    pkg: '@udg/checks',
    allowedFirstParty: [],
    denied: ['@udg/'],
    allowBrowserGlobals: false,
    allowNodeBuiltins: true,
    allowedAmbientTypes: ['node'],
    allowDomLibrary: false,
    note: 'The checker must stay analysable without the systems it checks, so it depends on no other workspace.',
  },
  {
    pkg: '@udg/asset-pipeline',
    allowedFirstParty: ['@udg/protocol', '@udg/protocol/domain', '@udg/config', '@udg/navigation'],
    denied: ['@udg/server', '@udg/client', '@babylonjs/', '@colyseus/', 'react'],
    allowBrowserGlobals: false,
    allowNodeBuiltins: true,
    allowedAmbientTypes: ['node'],
    allowDomLibrary: false,
    note: 'Offline generation only: no server room and no browser runtime.',
  },
  {
    pkg: '@udg/load-test',
    allowedFirstParty: [
      '@udg/protocol',
      '@udg/protocol/domain',
      '@udg/protocol/schema',
      '@udg/config',
      '@udg/simulation',
      '@udg/physics',
      '@udg/navigation',
      '@udg/client',
    ],
    denied: ['@udg/server'],
    allowBrowserGlobals: true,
    allowNodeBuiltins: true,
    allowedAmbientTypes: ['node'],
    allowDomLibrary: true,
    note: 'The spike harness drives real browsers and Node processes; room code stays inside @udg/server.',
  },
];

const FIRST_PARTY_PREFIX = '@udg/';

/** Specifiers that may reach the schema runtime. Everyone else is a domain-only consumer. */
export const SCHEMA_ENTRY = '@udg/protocol/schema';
export const SCHEMA_ALLOWED = new Set(['@udg/protocol', '@udg/server', '@udg/client', '@udg/load-test']);

/**
 * The engine-free core, and the two routes by which it could acquire a schema runtime.
 *
 * `BOUNDARY-SCHEMA-INTO-DOMAIN` already refuses a *package* import of `@udg/protocol/schema` from a
 * consumer that is not allowed one. It cannot see the two routes that matter inside `@udg/protocol`
 * itself: a direct `@colyseus/*` import, and a relative import of the sibling `src/schema` modules.
 * Both stay inside one package, so no cross-package rule fires, and the acceptance criterion
 * "domain entry points import no schema runtime" would rest on review alone. This rule is what makes
 * that criterion enforced rather than hoped for.
 */
export const SCHEMA_FREE_DIRECTORY = 'packages/protocol/src/domain/';
export const SCHEMA_SOURCE_DIRECTORY = 'packages/protocol/src/schema/';
export const SCHEMA_RUNTIME_PREFIX = '@colyseus/';

const NODE_BUILTIN = /^(?:node:|fs$|path$|os$|url$|crypto$|child_process$|worker_threads$|stream$|net$|http$|https$)/;

const ruleFor = (pkg: string): PackageRule | undefined => PACKAGE_RULES.find((rule) => rule.pkg === pkg);

const packageNameOf = (specifier: string): string => {
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/');
    return name === undefined ? (scope ?? specifier) : `${scope}/${name}`;
  }
  return specifier.split('/')[0] ?? specifier;
};

const isDenied = (rule: PackageRule, specifier: string): string | undefined => {
  for (const denied of rule.denied) {
    if (denied.endsWith('/') || denied.endsWith('-')) {
      if (specifier.startsWith(denied)) return denied;
    } else if (specifier === denied || specifier.startsWith(`${denied}/`)) {
      return denied;
    }
  }
  return undefined;
};

export const ruleTableHash = (): string =>
  sha256Canonical({
    rules: PACKAGE_RULES.map((rule) => ({ ...rule, denied: [...rule.denied] })),
    schemaAllowed: [...SCHEMA_ALLOWED].sort(),
    schemaFree: {
      directory: SCHEMA_FREE_DIRECTORY,
      schemaSource: SCHEMA_SOURCE_DIRECTORY,
      runtimePrefix: SCHEMA_RUNTIME_PREFIX,
    },
    ruleIds: BOUNDARY_RULE_IDS,
  });

/** sha256 of the shared strict compiler settings; the config hash input for compile fixtures. */
export const baseTsconfigHash = (root: string): string => {
  const base = join(root, 'tsconfig.base.json');
  return existsSync(base) ? sha256File(base) : 'missing-tsconfig-base';
};

/**
 * Configuration hash recorded into every boundary fixture. If a rule is weakened or the strict
 * compiler settings change, previously generated fixtures stop matching and test:fixtures fails.
 */
export const boundaryConfigHash = (root: string): string =>
  sha256Bytes(`${ruleTableHash()}\n${baseTsconfigHash(root)}`);

interface FileAnalysis {
  readonly file: RepoPath;
  readonly pkgName: string;
  readonly edges: readonly string[];
  readonly packageEdges: ReadonlySet<string>;
}

export interface WorkspaceCheck {
  readonly violations: Violation[];
  readonly cycles: string[][];
  readonly checkedFiles: number;
}

export const checkWorkspace = (root: string): WorkspaceCheck => {
  const absoluteRoot = resolve(root);
  const workspace = discoverWorkspace(absoluteRoot);
  const byName = new Map(workspace.packages.map((info) => [info.name, info]));
  const rootDeps = rootDependencyNames(absoluteRoot);
  const violations: Violation[] = [];
  const analyses: FileAnalysis[] = [];

  for (const info of workspace.packages) {
    const rule = ruleFor(info.name);
    if (rule === undefined) {
      violations.push({
        ruleId: 'BOUNDARY-UNKNOWN-PACKAGE',
        pkg: info.name,
        file: `${info.dir}/package.json`,
        line: 0,
        specifier: info.name,
        detail: 'Workspace has no ownership rule. Add the rule in the same change that adds the workspace.',
      });
    }
    for (const file of sourceFiles(absoluteRoot, info.dir)) {
      const source = readFileSync(join(absoluteRoot, file), 'utf8');
      const analysis = analyseFile({
        absoluteRoot,
        info,
        rule,
        file,
        source,
        byName,
        packages: workspace.packages,
        rootDeps,
      });
      analyses.push(analysis.analysis);
      violations.push(...analysis.violations);
    }
    violations.push(...checkTsconfig(absoluteRoot, info, rule));
  }

  const cycles = findCycles(analyses);
  for (const cycle of cycles) {
    violations.push({
      ruleId: 'BOUNDARY-CYCLE',
      pkg: packageLabel(cycle[0] ?? '', workspace.packages),
      file: cycle[0] ?? '',
      line: 0,
      specifier: cycle.join(' -> '),
      detail: 'Import cycle between first-party modules, including cycles hidden behind barrel files.',
    });
  }

  for (const cycle of findPackageCycles(analyses, workspace.packages)) {
    violations.push({
      ruleId: 'BOUNDARY-PACKAGE-CYCLE',
      pkg: cycle[0] ?? '',
      file: '',
      line: 0,
      specifier: cycle.join(' -> '),
      detail: 'Package-level dependency cycle. The ownership table is a DAG, so a cross-package cycle always needs a forbidden edge as well.',
    });
  }

  violations.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId),
  );
  return { violations, cycles, checkedFiles: analyses.length };
};

interface AnalyseInput {
  readonly absoluteRoot: string;
  readonly info: PackageInfo;
  readonly rule: PackageRule | undefined;
  readonly file: RepoPath;
  readonly source: string;
  readonly byName: ReadonlyMap<string, PackageInfo>;
  readonly packages: readonly PackageInfo[];
  readonly rootDeps: ReadonlySet<string>;
}

const analyseFile = (input: AnalyseInput): { analysis: FileAnalysis; violations: Violation[] } => {
  const { absoluteRoot, info, rule, file, source, byName, packages, rootDeps } = input;
  const violations: Violation[] = [];
  const edges: string[] = [];
  const packageEdges = new Set<string>();
  const isTestFile = /(?:^|\/)tests?\//.test(file) || /\.test\.ts$/.test(file);

  const add = (ruleId: BoundaryRuleId, specifier: string, line: number, detail: string): void => {
    violations.push({ ruleId, pkg: info.name, file, line, specifier, detail });
  };

  const schemaFree = file.startsWith(SCHEMA_FREE_DIRECTORY);

  for (const imported of extractImports(source)) {
    const { specifier, line, kind } = imported;

    if (specifier.startsWith(FIRST_PARTY_PREFIX)) {
      const targetName = packageNameOf(specifier);
      const targetPackage = byName.get(targetName);
      if (targetPackage !== undefined && targetPackage.dir !== info.dir) {
        packageEdges.add(targetPackage.name);
      }
      const isSchema = specifier === SCHEMA_ENTRY || specifier.startsWith(`${SCHEMA_ENTRY}/`);
      if (isSchema) {
        if (rule !== undefined && !SCHEMA_ALLOWED.has(rule.pkg)) {
          add(
            'BOUNDARY-SCHEMA-INTO-DOMAIN',
            specifier,
            line,
            `Only ${[...SCHEMA_ALLOWED].sort().join(', ')} may import the schema entry point. ${rule.note}`,
          );
        }
      } else if (rule !== undefined && !rule.allowedFirstParty.includes(specifier)) {
        add(
          'BOUNDARY-FIRST-PARTY-FORBIDDEN',
          specifier,
          line,
          `${info.name} may not depend on ${specifier}. Allowed first-party specifiers: ${rule.allowedFirstParty.join(', ') || 'none'}. ${rule.note}`,
        );
      }
      const targetFile = firstPartyTarget(absoluteRoot, specifier, byName);
      if (targetFile !== undefined) edges.push(targetFile);
      continue;
    }

    if (specifier.startsWith('.')) {
      // Relative specifiers resolve from the importing file, not the package root.
      const targetAbs = resolve(join(absoluteRoot, dirname(file)), specifier);
      const targetRepo = toRepoPath(absoluteRoot, targetAbs);
      if (schemaFree && targetRepo.startsWith(SCHEMA_SOURCE_DIRECTORY)) {
        add(
          'BOUNDARY-DOMAIN-NO-SCHEMA',
          specifier,
          line,
          `${file} is part of the engine-free domain and may not import the schema modules in ${SCHEMA_SOURCE_DIRECTORY} by a relative path. Consumers that need replica classes name @udg/protocol/schema themselves.`,
        );
      }
      const owner = ownerOf(packages, targetRepo);
      if (owner !== undefined && owner.dir !== info.dir) {
        add(
          'BOUNDARY-CROSS-PACKAGE-RELATIVE',
          specifier,
          line,
          `Relative import reaches ${owner.name}. Import its published entry point instead of another package's internals.`,
        );
      } else {
        const resolved = resolveTypeScript(targetAbs);
        if (resolved !== undefined) edges.push(toRepoPath(absoluteRoot, resolved));
      }
      continue;
    }

    if (schemaFree && specifier.startsWith(SCHEMA_RUNTIME_PREFIX)) {
      add(
        'BOUNDARY-DOMAIN-NO-SCHEMA',
        specifier,
        line,
        `${file} is part of the engine-free domain and may not import the schema runtime ${specifier}. Declare types, or name @udg/protocol/schema from the consumer that needs them.`,
      );
      continue;
    }

    if (NODE_BUILTIN.test(specifier)) {
      if (rule !== undefined && !rule.allowNodeBuiltins) {
        add(
          'BOUNDARY-NODE-BUILTIN-FORBIDDEN',
          specifier,
          line,
          `${info.name} is shared or browser-facing and may not import Node builtin ${specifier}. ${rule.note}`,
        );
      }
      continue;
    }

    if (rule !== undefined) {
      const denied = isDenied(rule, specifier);
      if (denied !== undefined) {
        add(
          'BOUNDARY-ENGINE-FORBIDDEN',
          specifier,
          line,
          `${info.name} may not depend on ${specifier} (denied prefix "${denied}"). ${rule.note}`,
        );
        continue;
      }
    }

    const pkgName = packageNameOf(specifier);
    const declaredHere = info.dependencies[pkgName] ?? info.devDependencies[pkgName];
    if (declaredHere === undefined && !rootDeps.has(pkgName)) {
      add(
        'BOUNDARY-UNDECLARED-DEPENDENCY',
        specifier,
        line,
        `${pkgName} is not a declared dependency of ${info.dir} or of the workspace root.`,
      );
      continue;
    }
    const runtimeFile = !isTestFile && /(?:^|\/)src\//.test(file);
    const prodDeclared = info.dependencies[pkgName] !== undefined || rootDeps.has(pkgName);
    if (runtimeFile && kind !== 'type' && !prodDeclared) {
      add(
        'BOUNDARY-RUNTIME-DEV-DEPENDENCY',
        specifier,
        line,
        `${pkgName} is only a devDependency; runtime source must not depend on a test-only package.`,
      );
    }
  }

  if (rule !== undefined && !rule.allowBrowserGlobals) {
    for (const hit of findBrowserGlobals(source)) {
      add(
        'BOUNDARY-BROWSER-GLOBAL',
        hit.name,
        hit.line,
        `Browser global ${hit.name} used in ${info.name}, which compiles without the DOM library. Shared and server code must stay engine-, UI- and browser-free.`,
      );
    }
  }

  return { analysis: { file, pkgName: info.name, edges, packageEdges }, violations };
};

const checkTsconfig = (
  absoluteRoot: string,
  info: PackageInfo,
  rule: PackageRule | undefined,
): Violation[] => {
  if (rule === undefined) return [];
  const absolute = join(absoluteRoot, info.dir, 'tsconfig.json');
  if (!existsSync(absolute)) return [];
  const parsed = JSON.parse(readFileSync(absolute, 'utf8')) as {
    compilerOptions?: { lib?: unknown; types?: unknown };
  };
  const lib = stringArray(parsed.compilerOptions?.lib);
  const types = parsed.compilerOptions?.types === undefined ? undefined : stringArray(parsed.compilerOptions?.types);
  const file = `${info.dir}/tsconfig.json`;
  const violations: Violation[] = [];

  if (lib.some((entry) => entry.startsWith('DOM')) && !rule.allowDomLibrary) {
    violations.push({
      ruleId: 'BOUNDARY-TSCONFIG-DOM',
      pkg: info.name,
      file,
      line: 0,
      specifier: lib.join(','),
      detail: `${info.name} compiles against the DOM library but may not. Only @udg/client and @udg/load-test are permitted.`,
    });
  }
  if (types !== undefined) {
    const extra = types.filter((entry) => !rule.allowedAmbientTypes.includes(entry));
    if (extra.length > 0) {
      violations.push({
        ruleId: 'BOUNDARY-TSCONFIG-AMBIENT-TYPES',
        pkg: info.name,
        file,
        line: 0,
        specifier: extra.join(','),
        detail: `${info.name} enables ambient types [${extra.join(', ')}]; only [${rule.allowedAmbientTypes.join(', ') || 'none'}] are permitted. Browser or vendor globals must not leak in through configuration.`,
      });
    }
  }
  return violations;
};

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const ownerOf = (packages: readonly PackageInfo[], repoPath: RepoPath): PackageInfo | undefined => {
  let best: PackageInfo | undefined;
  for (const info of packages) {
    if ((repoPath === info.dir || repoPath.startsWith(`${info.dir}/`)) && (best === undefined || info.dir.length > best.dir.length)) {
      best = info;
    }
  }
  return best;
};

const isDirectory = (candidate: string): boolean => {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
};

const existsFile = (candidate: string): boolean => existsSync(candidate) && !isDirectory(candidate);

/** Resolve a specifier that may use the emitted `.js` extension back to its `.ts` source. */
const resolveTypeScript = (absolutePath: string): string | undefined => {
  const candidates: string[] = [];
  if (absolutePath.endsWith('.js') || absolutePath.endsWith('.mjs') || absolutePath.endsWith('.cjs')) {
    const base = absolutePath.replace(/\.[cm]?js$/, '');
    candidates.push(`${base}.ts`, `${base}.tsx`, `${base}/index.ts`);
  } else {
    candidates.push(`${absolutePath}.ts`, `${absolutePath}.tsx`, `${absolutePath}/index.ts`, absolutePath);
  }
  return candidates.find(existsFile);
};

const firstPartyTarget = (
  absoluteRoot: string,
  specifier: string,
  byName: ReadonlyMap<string, PackageInfo>,
): string | undefined => {
  const name = packageNameOf(specifier);
  const target = byName.get(name);
  if (target === undefined) return undefined;
  const subpath = specifier === name ? undefined : specifier.slice(name.length + 1);
  const base =
    subpath === undefined
      ? join(absoluteRoot, target.dir, 'src', 'index')
      : join(absoluteRoot, target.dir, 'src', subpath);
  return resolveTypeScript(base);
};

const rootDependencyNames = (absoluteRoot: string): ReadonlySet<string> => {
  const absolute = join(absoluteRoot, 'package.json');
  if (!existsFile(absolute)) return new Set();
  const parsed = JSON.parse(readFileSync(absolute, 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return new Set([...Object.keys(parsed.dependencies ?? {}), ...Object.keys(parsed.devDependencies ?? {})]);
};

/** Tarjan strongly connected components larger than one node, plus self imports. */
const findCycles = (analyses: readonly FileAnalysis[]): string[][] => {
  const graph = new Map<string, string[]>();
  for (const analysis of analyses) {
    graph.set(analysis.file, [...new Set(analysis.edges)]);
  }

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let next = 0;

  const strongConnect = (node: string): void => {
    index.set(node, next);
    low.set(node, next);
    next += 1;
    stack.push(node);
    onStack.add(node);
    for (const target of graph.get(node) ?? []) {
      if (!graph.has(target)) continue;
      if (!index.has(target)) {
        strongConnect(target);
        low.set(node, Math.min(low.get(node) ?? 0, low.get(target) ?? 0));
      } else if (onStack.has(target)) {
        low.set(node, Math.min(low.get(node) ?? 0, index.get(target) ?? 0));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      for (;;) {
        const member = stack.pop();
        if (member === undefined) break;
        onStack.delete(member);
        component.push(member);
        if (member === node) break;
      }
      const selfImport = component.length === 1 && (graph.get(component[0] ?? '') ?? []).includes(component[0] ?? '');
      if (component.length > 1 || selfImport) components.push(component.sort());
    }
  };

  for (const node of [...graph.keys()].sort()) {
    if (!index.has(node)) strongConnect(node);
  }
  return components.sort((a, b) => a.join(',').localeCompare(b.join(',')));
};

/** Enumerate package-level cycles (every node may start a cycle; results are deduplicated). */
const findPackageCycles = (
  analyses: readonly FileAnalysis[],
  packages: readonly PackageInfo[],
): string[][] => {
  const graph = new Map<string, Set<string>>();
  for (const info of packages) graph.set(info.name, new Set());
  for (const analysis of analyses) {
    const set = graph.get(analysis.pkgName);
    if (set === undefined) continue;
    for (const target of analysis.packageEdges) {
      if (target !== analysis.pkgName) set.add(target);
    }
  }

  const found = new Set<string>();
  const walk = (start: string, path: readonly string[], visited: ReadonlySet<string>): void => {
    for (const target of [...(graph.get(path[path.length - 1] ?? start) ?? [])].sort()) {
      if (target === start && path.length > 1) {
        found.add(canonicalCycle(path));
        continue;
      }
      if (path.includes(target) || visited.has(target)) continue;
      walk(start, [...path, target], new Set([...visited, target]));
    }
  };
  for (const name of [...graph.keys()].sort()) {
    walk(name, [name], new Set([name]));
  }
  return [...found].map((cycle) => cycle.split('->')).sort();
};

const canonicalCycle = (cycle: readonly string[]): string => {
  const smallest = cycle.reduce((acc, value) => (value < acc ? value : acc), cycle[0] ?? '');
  const start = cycle.indexOf(smallest);
  return [...cycle.slice(start), ...cycle.slice(0, start)].join('->');
};

const packageLabel = (file: RepoPath, packages: readonly PackageInfo[]): string =>
  ownerOf(packages, file)?.name ?? file;

export interface BoundaryFixtureManifest {
  readonly schemaVersion: number;
  readonly fixtureVersion: string;
  readonly fixtureId: string;
  readonly kind: string;
  readonly configHash: string;
  readonly expectation: 'allow' | 'reject';
  readonly expectedRuleIds: readonly string[];
}

export interface FixtureResult {
  readonly fixtureId: string;
  readonly kind: string;
  readonly expectation: string;
  readonly ok: boolean;
  readonly expectedRuleIds: readonly string[];
  readonly actualRuleIds: readonly string[];
  readonly violationCount: number;
  readonly violations: readonly Violation[];
  readonly problems: readonly string[];
}

/** Run every dependency-boundaries fixture and compare against its declared expectation. */
export const runBoundaryFixtures = (root: string, fixturesDir: string): FixtureResult[] => {
  const absoluteFixturesDir = resolve(root, fixturesDir);
  const results: FixtureResult[] = [];
  for (const entry of listDirectories(absoluteFixturesDir)) {
    const manifestPath = join(absoluteFixturesDir, entry, 'fixture.json');
    if (!existsFile(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BoundaryFixtureManifest;
    if (manifest.kind !== 'dependency-boundaries') continue;

    const check = checkWorkspace(join(absoluteFixturesDir, entry));
    const actualRuleIds: string[] = [...new Set<string>(check.violations.map((violation) => violation.ruleId))].sort();
    const expectedRuleIds = [...manifest.expectedRuleIds].sort();
    const problems: string[] = [];

    if (manifest.expectation === 'allow') {
      if (check.violations.length !== 0) {
        problems.push(`expected no violations, got ${String(check.violations.length)}`);
      }
    } else {
      if (check.violations.length === 0) problems.push('expected a rejection, got no violations');
      const missing = expectedRuleIds.filter((id) => !actualRuleIds.includes(id));
      const unexpected = actualRuleIds.filter((id) => !expectedRuleIds.includes(id));
      if (missing.length > 0) problems.push(`missing expected rule ids: ${missing.join(', ')}`);
      if (unexpected.length > 0) problems.push(`unexpected rule ids: ${unexpected.join(', ')}`);
    }

    results.push({
      fixtureId: manifest.fixtureId,
      kind: manifest.kind,
      expectation: manifest.expectation,
      ok: problems.length === 0,
      expectedRuleIds,
      actualRuleIds,
      violationCount: check.violations.length,
      violations: check.violations,
      problems,
    });
  }
  return results;
};

const listDirectories = (absoluteDir: string): string[] => {
  if (!existsSync(absoluteDir)) return [];
  return readdirSync(absoluteDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
};

const runFixtureMode = (root: string, fixtures: string, reportPath: string | undefined): number => {
  const results = runBoundaryFixtures(root, fixtures);
  const failed = results.filter((result) => !result.ok);
  for (const result of results) {
    process.stdout.write(
      `${result.ok ? 'PASS' : 'FAIL'} ${result.fixtureId} [${result.expectation}]` +
        ` expected=${result.expectedRuleIds.join('|') || 'none'} actual=${result.actualRuleIds.join('|') || 'none'}` +
        ` violations=${String(result.violationCount)}` +
        `${result.problems.length > 0 ? ` problems="${result.problems.join('; ')}"` : ''}\n`,
    );
  }
  if (results.length === 0) {
    process.stderr.write(
      `No dependency-boundary fixtures found under ${fixtures}.\nA missing fixture set is not a pass.\n`,
    );
    return 1;
  }
  if (reportPath !== undefined) {
    writeJson(resolve(root, reportPath), {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      mode: 'fixtures',
      fixturesDir: fixtures,
      ruleTableHash: ruleTableHash(),
      configHash: boundaryConfigHash(root),
      results,
      ok: failed.length === 0,
    });
  }
  return failed.length === 0 ? 0 : 1;
};

const runWorkspaceMode = (root: string, workspaceRoot: string, reportPath: string | undefined): number => {
  const absolute = resolve(root, workspaceRoot);
  const check = checkWorkspace(absolute);
  const report: BoundaryReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    workspaceRoot: toRepoPath(process.cwd(), absolute) || '.',
    ruleTableHash: ruleTableHash(),
    checkedFiles: check.checkedFiles,
    violations: check.violations,
    cycles: check.cycles,
    ok: check.violations.length === 0,
  };
  const destination = reportPath ?? process.env['UDG_BOUNDARY_REPORT'];
  if (destination !== undefined) writeJson(resolve(root, destination), report);

  if (report.ok) {
    process.stdout.write(
      `boundary check OK: ${String(report.checkedFiles)} file(s), 0 violations, rule table ${report.ruleTableHash.slice(0, 12)}\n`,
    );
    return 0;
  }
  for (const violation of report.violations) {
    process.stderr.write(
      `${violation.ruleId} ${violation.file}:${String(violation.line)} ${violation.specifier} :: ${violation.detail}\n`,
    );
  }
  process.stderr.write(`boundary check FAILED: ${String(report.violations.length)} violation(s)\n`);
  return 1;
};

const main = (flags: CliArgs['flags']): number => {
  const root = process.cwd();
  const reportPath = flagString(flags, 'report');
  const fixtures = flagString(flags, 'fixtures');
  if (fixtures !== undefined) return runFixtureMode(root, fixtures, reportPath);
  return runWorkspaceMode(root, flagString(flags, 'workspace-root') ?? '.', reportPath);
};

if (isMainModule(import.meta.url)) {
  const flags = parseArgs(process.argv.slice(2)).flags;
  if (flags['fixtures'] === true) requireFlag(flags, 'fixtures', 'usage: boundaries.js --fixtures <dir>');
  if (flags['workspace-root'] === true) requireFlag(flags, 'workspace-root', 'usage: boundaries.js --workspace-root <dir>');
  process.exit(main(flags));
}
