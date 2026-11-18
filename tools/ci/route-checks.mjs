/**
 * The changed-path router for the routine CI lane (C-07).
 *
 * ## What this decides
 *
 * A routine push or pull request must run the checks that the change can actually make red, and nothing
 * else. This file is the whole decision: one table of path rules, a few escalation rules, and a resolver
 * that turns a diff into a set of flags. It is a script rather than a GitHub `paths:` filter because the
 * two things that matter here cannot be expressed by a filter: the **union across a whole push or PR**
 * (including the two sides of a rename), and the rule that an **unrecognised impact runs everything**.
 *
 * ## The two rules that outrank the table
 *
 *   1. every changed path is considered, on both sides of a rename, and additions and deletions count;
 *   2. if any path matches no rule, or the diff itself cannot be resolved, every flag is set. A wrong
 *      route that runs too much costs minutes; a wrong route that runs too little costs coverage, and
 *      the repository has already paid for the second class of mistake once (`tests/unit/udg-003/
 *      capture-loop.test.ts` exists because a CI step silently stopped running plans).
 *
 * ## Where the checks actually run
 *
 * Nothing here executes a check. It emits flags; `.github/workflows/ci.yml` holds one conditional job per
 * flag, and `tests/unit/ci-routing/route-checks.test.ts` asserts that the flags and the jobs agree in both
 * directions. Full evidence capture is not routable: it lives in `.github/workflows/acceptance.yml` and is
 * dispatched explicitly, so no route — including this file's own — can produce or withhold a bundle.
 *
 * ## How it is driven
 *
 *   node tools/ci/route-checks.mjs --base <sha> --head <sha> [--three-dot] --output-file "$GITHUB_OUTPUT"
 *   node tools/ci/route-checks.mjs --paths-file paths.txt              # explain is the default output
 *   node tools/ci/route-checks.mjs --force camera,static               # lane measurement only
 *   node tools/ci/route-checks.mjs --base <sha> --head <sha> --quiet   # flags only, for a local dry run
 *
 * `--force` exists so a single lane can be timed on demand without manufacturing a change to a game path.
 * It is a workflow_dispatch affordance of the routine lane and can never enable evidence capture.
 */

import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Every routable group. One conditional job per flag in `.github/workflows/ci.yml`. */
export const ROUTE_FLAGS = Object.freeze([
  'records',
  'static',
  'protocol',
  'unit',
  'camera',
  'server',
  'runtime',
  'tooling',
  'fullSuite',
]);

/**
 * Rules that set every flag. Checked before the table, because a lockfile change is not "a change to one
 * area": it changes what every suite runs against.
 */
export const ESCALATION_RULES = Object.freeze([
  {
    id: 'root-manifest',
    detail: 'root manifest, workspace or toolchain pin — every suite runs against the installed graph',
    patterns: ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', '.npmrc', '.node-version', '.env.example'],
  },
  {
    id: 'root-tsconfig',
    detail: 'root TypeScript project — every workspace typechecks through it',
    patterns: ['tsconfig.json', 'tsconfig.base.json', 'tsconfig.declarations.json', 'tsconfig.e2e.json'],
  },
  {
    id: 'root-tooling-config',
    detail: 'root lint or test configuration — changes what every suite collects',
    patterns: ['eslint.config.mjs', 'vitest.config.ts'],
  },
  {
    id: 'ci-tooling',
    detail: 'CI workflow or CI tooling — the routing itself is under test, so everything is routed',
    patterns: ['.github/**', 'tools/ci/**'],
  },
]);

/**
 * The routing table. `flags` are additive: a path may match several rules and the run gets the union.
 *
 * Every entry names the reader that justifies it — the suite that opens the path — because "looks related"
 * is not a routing rule. A rule whose reader is deleted should be deleted with it, and the coverage test
 * in tests/unit/ci-routing/route-checks.test.ts fails a rule that can never match.
 */
export const ROUTE_RULES = Object.freeze([
  // --- documentation and records -----------------------------------------------------------------
  // The baseline doc rule. The records lane runs `pnpm contracts:checksums` and the UDG-001 suite, which
  // is the suite that reads docs/contracts/adoption.md, README.md and the checksum manifest itself.
  { id: 'docs-records', reader: 'tests/contracts/UDG-001.test.ts', flags: ['records'],
    patterns: ['docs/**', '**/*.md', '*.md'] },
  // The dependency register is gated by `pnpm dependencies:verify`, which the records lane does not run.
  { id: 'docs-dependency-register', reader: 'pnpm dependencies:verify + UDG-001 register tests', flags: ['records', 'tooling'],
    patterns: ['docs/integration/dependencies.json'] },
  // UDG-002's suite digests the contracts index and reads the protocol document and its records.
  { id: 'docs-protocol', reader: 'tests/contracts/UDG-002.test.ts', flags: ['records', 'protocol'],
    patterns: [
      'docs/contracts/README.md',
      'docs/contracts/protocol-v1.md',
      'docs/contracts/UDG-001.md',
      'docs/contracts/UDG-002.md',
      'docs/contracts/assignments/UDG-001*',
      'docs/contracts/assignments/UDG-002*',
    ] },
  // UDG-003's suite reads the Colyseus map and inventory, the protocol document and Phase 1's record.
  { id: 'docs-server', reader: 'tests/contracts/UDG-003.test.ts', flags: ['records', 'server', 'runtime'],
    patterns: [
      'docs/integration/colyseus*',
      'docs/contracts/UDG-003.md',
      'docs/contracts/assignments/UDG-003*',
      'docs/interfaces/movement-authority.md',
    ] },
  // UDG-004's contract is read by its suite; the client-stack document is the record it is read against.
  { id: 'docs-camera', reader: 'tests/contracts/UDG-004.test.ts', flags: ['records', 'camera'],
    patterns: ['docs/contracts/UDG-004.md', 'docs/integration/client-stack-v1.md', 'docs/integration/engines.md'] },

  // --- source, by the suite that asserts against it ------------------------------------------------
  { id: 'source-static', reader: 'pnpm typecheck + pnpm lint', flags: ['static'],
    patterns: ['packages/**', 'apps/**', 'tools/**', 'tests/**', '**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'] },
  { id: 'source-unit', reader: 'pnpm test:unit', flags: ['unit'],
    patterns: ['packages/**', 'apps/**', 'tests/unit/**', 'tests/checks/**', 'tools/checks/**', 'tests/fixtures/**'] },
  { id: 'protocol', reader: 'tests/contracts/UDG-002.test.ts + tests/unit/udg-002/**', flags: ['protocol'],
    patterns: [
      'packages/protocol/**',
      'packages/config/**',
      'tests/unit/udg-002/**',
      'tests/contracts/UDG-002.test.ts',
      'tests/fixtures/protocol/**',
      'tests/fixtures/catalog.json',
    ] },
  { id: 'camera', reader: 'tests/e2e/camera.spec.ts + tests/contracts/UDG-004.test.ts', flags: ['camera'],
    patterns: [
      'apps/client/**',
      'tests/e2e/**',
      'tests/unit/udg-004/**',
      'tests/contracts/UDG-004.test.ts',
      'playwright.config.ts',
    ] },
  { id: 'server', reader: 'tests/contracts/UDG-003.test.ts + apps/server probes', flags: ['server'],
    patterns: [
      'apps/server/**',
      'packages/simulation/**',
      'packages/protocol/**',
      'packages/config/**',
      'tests/probes/**',
      'tests/unit/udg-003/**',
      'tests/unit/udg-003-phase-2/**',
      'tests/contracts/UDG-003.test.ts',
      'tools/checks/src/evidence.ts',
      'tools/checks/src/run-contract.ts',
      'tools/checks/src/support.ts',
    ] },
  // The runtime/system half: the live-transport and reference-trace suites that assert behaviour, not
  // source text. A server or authority change must be shown to be exercised, not merely compiled.
  { id: 'runtime', reader: 'tests/system/** + tests/reference/flat-direct-step.ts', flags: ['runtime'],
    patterns: [
      'apps/server/**',
      'packages/simulation/**',
      'packages/protocol/**',
      'packages/config/**',
      'tests/system/**',
      'tests/runtime/**',
      'tests/reference/**',
      'tests/support/**',
      'tests/probes/**',
      'tests/contracts/UDG-003.test.ts',
      'tools/checks/src/evidence.ts',
    ] },
  { id: 'tooling', reader: 'tests/contracts/UDG-001.test.ts + tests/unit/udg-003/capture-loop.test.ts', flags: ['tooling'],
    patterns: [
      'tests/contracts/UDG-001.test.ts',
      'tests/unit/udg-003/capture-loop.test.ts',
      'docs/integration/dependencies.json',
    ] },

  // --- shared surfaces ---------------------------------------------------------------------------
  // Both apps depend on @udg/protocol and @udg/config (apps/client/package.json, apps/server/package.json),
  // so a change there is a client change and a server change at once. This rule is why a protocol edit
  // routes to the camera lane.
  { id: 'shared-app-dependency', reader: 'apps/client + apps/server dependency tables', flags: ['camera', 'server', 'runtime'],
    patterns: ['packages/protocol/**', 'packages/config/**'] },
  // The checker package is the shared substrate of every suite and of capture; it gets the broad set.
  { id: 'shared-checks', reader: 'every suite dispatched through tools/checks', flags: ['static', 'unit', 'protocol', 'server', 'runtime', 'tooling', 'fullSuite'],
    patterns: ['tools/checks/**'] },
  // The cross-suite command: `pnpm test` gates the browser artefacts and writes the acceptance junit.
  { id: 'shared-full-suite', reader: 'pnpm test', flags: ['fullSuite'],
    patterns: [
      'packages/protocol/**',
      'packages/config/**',
      'packages/simulation/**',
      'tools/checks/**',
      'playwright.config.ts',
      'tests/fixtures/**',
    ] },
]);

/** Documents are routed as records plus the carve-outs below, so a Markdown file under `tests/` does not
 * route as a suite and a manifest under `docs/` does not route as unknown. */
const isDocPath = (path) => path.endsWith('.md') || path === 'docs' || path.startsWith('docs/');

/**
 * Glob → anchored RegExp. Supports `**` (any depth, including none when followed by `/`), `*` (one path
 * segment), `?` and `*.{ts,tsx}`-free literal text. No character classes: the table is meant to stay
 * readable, and alternation is available by writing two rules.
 */
export const globToRegExp = (glob) => {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*') {
      if (glob[index + 1] === '*') {
        if (glob[index + 2] === '/') {
          source += '(?:.*\\/)?';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
        continue;
      }
      source += '[^/]*';
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    source += '\\^$.|+()[]{}'.includes(char) ? `\\${char}` : char;
  }
  return new RegExp(`^${source}$`);
};

const matchesRule = (rule, path) => rule.patterns.some((pattern) => globToRegExp(pattern).test(path));

const emptyFlags = () => Object.fromEntries(ROUTE_FLAGS.map((flag) => [flag, false]));

/**
 * The router. `paths` are repository-relative paths, already flattened from the diff — a rename contributes
 * both its old and its new path, so a move from the camera lane into the server lane routes to both.
 *
 * Returns the flags, why each path routed the way it did, and the single reason that governs the run.
 */
export const routePaths = (paths, options = {}) => {
  const flags = emptyFlags();
  const decisions = [];
  const limit = options.pathLimit ?? 40;

  const escalate = (reason, detail, path) => {
    for (const flag of ROUTE_FLAGS) flags[flag] = true;
    decisions.push({ path: path ?? null, kind: 'escalation', rules: [reason], detail });
    return { flags, all: true, reason, detail, decisions };
  };

  if (options.force !== undefined && options.force !== null) {
    for (const flag of options.force) {
      if (!ROUTE_FLAGS.includes(flag)) {
        throw new Error(`route-checks: --force names an unknown group: ${flag}`);
      }
      flags[flag] = true;
    }
    decisions.push({ path: null, kind: 'forced', rules: ['forced'], detail: `forced groups: ${options.force.join(' ')}` });
    return { flags, all: false, reason: 'forced', detail: options.force.join(','), decisions };
  }

  if (options.all === true) {
    return escalate('dispatch-all', 'a routine dispatch asks for the broad answer; no diff is implied', null);
  }
  if (paths === undefined || paths === null) {
    return escalate('unresolved-diff', 'the diff could not be resolved against this checkout', null);
  }
  if (paths.length === 0) {
    return escalate('empty-diff', 'the diff named no changed path', null);
  }
  if (paths.length > limit) {
    return escalate('too-many-paths', `${String(paths.length)} paths changed, more than the ${String(limit)} a route is trusted to summarise`, null);
  }

  let unknownPath = null;
  for (const path of paths) {
    const escalations = ESCALATION_RULES.filter((rule) => matchesRule(rule, path));
    if (escalations.length > 0) {
      return escalate('path:' + escalations[0].id, escalations[0].detail, path);
    }

    const applicable = isDocPath(path)
      ? ROUTE_RULES.filter((rule) => rule.id === 'docs-records' || rule.id.startsWith('docs-'))
      : ROUTE_RULES.filter((rule) => !rule.id.startsWith('docs-'));

    const matched = applicable.filter((rule) => matchesRule(rule, path));
    if (matched.length === 0) {
      unknownPath = path;
      decisions.push({ path, kind: 'unknown', rules: [], detail: 'no rule matched this path' });
      continue;
    }
    for (const rule of matched) {
      for (const flag of rule.flags) flags[flag] = true;
    }
    decisions.push({
      path,
      kind: 'routed',
      rules: matched.map((rule) => rule.id),
      flags: [...new Set(matched.flatMap((rule) => rule.flags))].sort(),
    });
  }

  if (unknownPath !== null) {
    return escalate('unknown-path', `no rule matches ${unknownPath}; the impact is unknown, so everything is routed`, unknownPath);
  }

  const groups = ROUTE_FLAGS.filter((flag) => flags[flag]);
  return { flags, all: false, reason: groups.length > 0 ? 'routed' : 'empty-diff', detail: groups.join(','), decisions };
};

/**
 * `git diff --name-status` → the path list the router consumes.
 *
 * Renames and copies carry two paths and both are kept: routing only the new name would let a rename move
 * a live camera case out of the camera lane. Deletions route the removed path, because the suite that read
 * it is exactly the suite that goes red.
 */
export const parseNameStatus = (text) => {
  const paths = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const fields = trimmed.split('\t');
    // `M<TAB>path`, `D<TAB>path`, `R100<TAB>old<TAB>new`. The status column is the only thing dropped, so a
    // rename keeps both of its paths.
    for (const field of fields.slice(1)) {
      if (field !== '') paths.push(field);
    }
  }
  return [...new Set(paths)].sort();
};

const git = (args, cwd) =>
  // stderr is swallowed on purpose: `changedPaths` treats a git failure as "the diff is unresolvable", which
  // is an expected outcome (first push, force-push, shallow fetch) and must not spray errors into a green
  // routing log. The router reports the reason instead.
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 });

/**
 * Resolve the changed paths for a push or a pull request.
 *
 * A push compares the previous head with the new head, so a push of five commits routes the union of all
 * five. A pull request compares the merge base with the head, so the route answers "what would this PR
 * change", not "what does the merge commit contain". An unresolvable or non-ancestral base (first push to a
 * branch, force-push, shallow fetch) is not guessed at: it returns undefined and the router escalates.
 */
export const changedPaths = (options) => {
  const { cwd, base, head, threeDot = false } = options;
  if (typeof base !== 'string' || base === '' || /^0+$/.test(base)) return undefined;
  if (typeof head !== 'string' || head === '') return undefined;
  try {
    const baseCommit = git(['rev-parse', '--verify', `${base}^{commit}`], cwd);
    const headCommit = git(['rev-parse', '--verify', `${head}^{commit}`], cwd);
    const range = threeDot ? `${baseCommit.trim()}...${headCommit.trim()}` : `${baseCommit.trim()}..${headCommit.trim()}`;
    if (!threeDot) {
      // A force-push makes `base` unreachable from `head`; diffing it would report a invented history.
      git(['merge-base', '--is-ancestor', baseCommit.trim(), headCommit.trim()], cwd);
    }
    return parseNameStatus(git(['diff', '--name-status', '-M', '--no-color', range], cwd));
  } catch {
    return undefined;
  }
};

export const parseArgs = (argv) => {
  const args = { cwd: process.cwd(), explain: true };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = () => {
      index += 1;
      const value = argv[index];
      if (value === undefined) throw new Error(`route-checks: ${flag} needs a value`);
      return value;
    };
    if (flag === '--base') args.base = next();
    else if (flag === '--head') args.head = next();
    else if (flag === '--three-dot') args.threeDot = true;
    else if (flag === '--paths-file') args.pathsFile = next();
    else if (flag === '--paths') args.paths = next().split(',').map((path) => path.trim()).filter((path) => path !== '');
    else if (flag === '--force') args.force = next().split(',').map((group) => group.trim()).filter((group) => group !== '');
    else if (flag === '--all') args.all = true;
    else if (flag === '--output-file') args.outputFile = next();
    else if (flag === '--json-out') args.jsonOut = next();
    else if (flag === '--quiet') args.explain = false;
    else if (flag === '--cwd') args.cwd = next();
    else throw new Error(`route-checks: unknown argument ${String(flag)}`);
  }
  return args;
};

/**
 * A paths file is either a plain list (one path per line, what the tests use) or a captured
 * `git diff --name-status` (what a reviewer reproducing a hosted route pastes).
 */
const readPathsFile = (file, cwd) => {
  const path = resolve(cwd, file);
  if (!existsSync(path)) throw new Error(`route-checks: --paths-file ${file} does not exist`);
  const lines = readFileSync(path, 'utf8').split('\n');
  const asPlainList = lines.map((line) => line.trim()).filter((line) => line !== '' && !line.includes('\t'));
  if (asPlainList.length > 0) return [...new Set(asPlainList)].sort();
  return parseNameStatus(lines.join('\n'));
};

export const main = (argv) => {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${String(error.message ?? error)}\n`);
    return 2;
  }

  let paths;
  if (args.pathsFile !== undefined) paths = readPathsFile(args.pathsFile, args.cwd);
  else if (args.paths !== undefined) paths = [...new Set(args.paths)].sort();
  else paths = changedPaths({ cwd: args.cwd, base: args.base, head: args.head, threeDot: args.threeDot === true });

  let result;
  try {
    result = routePaths(paths, { force: args.force, all: args.all === true });
  } catch (error) {
    process.stderr.write(`${String(error.message ?? error)}\n`);
    return 2;
  }

  const groups = ROUTE_FLAGS.filter((flag) => result.flags[flag]);

  if (args.explain) {
    process.stdout.write(`route: ${groups.length > 0 ? groups.join(' ') : '(none)'} — reason: ${result.reason}\n`);
    if (result.detail !== '') process.stdout.write(`  ${result.detail}\n`);
    for (const decision of result.decisions) {
      if (decision.path === null) continue;
      const rules = decision.rules.length > 0 ? decision.rules.join(',') : '—';
      const flags = decision.flags === undefined ? '' : ` → ${decision.flags.join(',')}`;
      process.stdout.write(`  ${decision.path}  [${decision.kind}: ${rules}]${flags}\n`);
    }
    process.stdout.write(
      '  capture is not routable: evidence bundles come only from an acceptance run (acceptance.yml)\n',
    );
  }

  if (args.outputFile !== undefined) {
    const lines = [
      ...ROUTE_FLAGS.map((flag) => `${flag}=${result.flags[flag] ? 'true' : 'false'}`),
      `groups=${groups.join(' ')}`,
      `any=${groups.length > 0 ? 'true' : 'false'}`,
      `reason=${result.reason}`,
      '',
    ].join('\n');
    appendFileSync(args.outputFile, lines);
  }

  if (args.jsonOut !== undefined) {
    writeFileSync(resolve(args.cwd, args.jsonOut), `${JSON.stringify(result, null, 2)}\n`);
  }

  return 0;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
