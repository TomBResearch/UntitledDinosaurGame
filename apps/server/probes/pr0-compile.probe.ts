/**
 * PR-0 — does first-party code typecheck against the pinned declarations, under the accepted exception?
 *
 * The claim of this probe, and nothing beyond it:
 *
 * > First-party code typechecks against the pinned declarations under the documented **ADR-0002** exception.
 *
 * [ADR-0002](../../../docs/adr/0002-server-declaration-checking-exception.md) is the owner's accepted compiler-policy
 * exception of 2026-11-10, confined to `apps/server/tsconfig.json` and `apps/server/tsconfig.probes.json`. It sets
 * `skipLibCheck: true` in those two projects because the pinned vendor declarations carry 27 recorded defects that
 * no published pin and no TypeScript version avoids. The exception stops the accepted gate looking *inside* those
 * declarations. It changes nothing about first-party code: `strict`, `noImplicitAny`, `exactOptionalPropertyTypes`
 * and `noUncheckedIndexedAccess` still apply, and every call this file and the other probes make against the pinned
 * declarations is still typechecked.
 *
 * So that a weaker gate cannot quietly become an invisible one, PR-0 also asserts the conditions the owner attached:
 *
 * - the exception appears in **exactly** the two approved projects, each naming ADR-0002, and nowhere else;
 *   `tsconfig.base.json` still says `skipLibCheck: false`;
 * - neither approved project loads a DOM lib;
 * - the **retained full check** (`pnpm --filter @udg/server typecheck:probes:full`, the same project with
 *   `skipLibCheck: false`) still produces the vendor defects, and its inventory must match
 *   `docs/integration/colyseus-declaration-inventory.json` exactly — an added file, a new code, a changed count or a
 *   vanished entry fails here, which is what makes a new vendor diagnostic a review event;
 * - UDG's own emitted declarations still typecheck strictly, with `skipLibCheck: false` and without importing
 *   `@colyseus/core`, `@colyseus/sdk` or `@colyseus/ws-transport` (`tsconfig.declarations.json`);
 * - no suppression comment, ambient shim or cast escape hatch appears in the projects that hold the exception.
 *
 * What this probe does **not** claim: that the vendor declaration defects are fixed (they are inventoried, not
 * resolved); that runtime behaviour, reconciliation or transport compatibility follows from compilation; that
 * `apps/client` or any other project is covered; or that `build:probes`, which emits with `--noCheck`, is a build
 * path — `build` does not use it, and the contract suite asserts that.
 *
 * Reports are handed in by the harness (`--typecheck-report`, `--declaration-report`) because no probe can see the
 * exit status of the command that built it; `first-party-declarations.json` is read from the same directory. A
 * missing report fails this probe rather than assuming anything.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Room,
  Server,
  defineRoom,
  defineServer,
  matchMaker,
  validate,
  type FixedTimestepCallback,
  type InputAccessor,
  type RegisteredHandler,
  type StepContext,
} from '@colyseus/core';
import { Client, registerSerializer, SchemaSerializer, type InputHandle } from '@colyseus/sdk';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { DirectInputSchema, PlayerSchema, RegionSchema, DIRECT_INPUT_FIELDS } from '@udg/protocol/schema';
import { validateDirectFrame } from '@udg/protocol';

import { flagValue, outputPath, runProbe, stripNonCode, type DirectInputFrame } from './support.js';

const declaredInput = DirectInputSchema;
const declaredState = RegionSchema;
const declaredPlayer = PlayerSchema;
const inputFieldCount = DIRECT_INPUT_FIELDS.length;
const protocolValidator = validateDirectFrame;

/** Repository root, found by walking up rather than by counting `../`, so moving the output tree cannot silently break a probe. */
function findRepositoryRoot(start: string): string {
  let current = start;
  for (;;) {
    if (existsSync(join(current, 'pnpm-lock.yaml')) && existsSync(join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`no repository root above ${start}`);
    current = parent;
  }
}

const APPROVED_EXCEPTION_PROJECTS = ['apps/server/tsconfig.json', 'apps/server/tsconfig.probes.json'];

/** Every `tsconfig*.json` in the workspace, ignoring installed and generated trees. */
function workspaceConfigs(repository: string): readonly string[] {
  const skip = new Set(['node_modules', 'dist', 'probes']);
  const found: string[] = [];
  const visit = (directory: string, depth: number): void => {
    if (depth > 2) return;
    for (const entry of readdirSync(directory)) {
      if (entry.startsWith('.') || skip.has(entry)) continue;
      const absolute = join(directory, entry);
      if (statSync(absolute).isDirectory()) visit(absolute, depth + 1);
      else if (/^tsconfig.*\.json$/.test(entry)) found.push(absolute.slice(repository.length + 1));
    }
  };
  visit(repository, 0);
  return found.sort();
}

const root = findRepositoryRoot(dirname(fileURLToPath(import.meta.url)));

async function main(): Promise<void> {
  const out = outputPath(process.argv.slice(2));
  await runProbe(
    'PR-0',
    'first-party code typechecks against the pinned declarations under the ADR-0002 exception',
    out,
    async (checks) => {
      const probeTsconfigPath = join(root, 'apps/server/tsconfig.probes.json');
      const probeTsconfigText = readFileSync(probeTsconfigPath, 'utf8');
      const probeTsconfig = JSON.parse(probeTsconfigText) as {
        compilerOptions?: Record<string, unknown>;
        extends?: string;
      };
      const baseText = readFileSync(join(root, 'tsconfig.base.json'), 'utf8');
      const base = JSON.parse(baseText) as { compilerOptions: Record<string, unknown> };

      checks.check(
        'probes inherit the shared policy',
        probeTsconfig.extends === '../../tsconfig.base.json',
        `tsconfig.probes.json extends ${String(probeTsconfig.extends)}`,
      );

      // The shared policy, unchanged. `skipLibCheck` is expected false at the root: the exception is confined
      // to the two approved projects, so the repository default must still check declarations.
      for (const flag of ['strict', 'noImplicitAny', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess', 'skipLibCheck']) {
        const value = base.compilerOptions[flag];
        const expected = flag === 'skipLibCheck' ? false : true;
        checks.check(`policy:${flag}`, value === expected, `tsconfig.base.json ${flag} = ${String(value)}, expected ${String(expected)}`);
        if (flag === 'skipLibCheck') continue;
        checks.check(
          `probe-project-does-not-relax:${flag}`,
          probeTsconfig.compilerOptions?.[flag] === undefined,
          `tsconfig.probes.json sets ${flag} to ${String(probeTsconfig.compilerOptions?.[flag])}`,
        );
      }

      // --- the exception, exactly as wide as the owner approved it ---
      const configs = workspaceConfigs(root);
      const withException: string[] = [];
      const undocumented: string[] = [];
      for (const config of configs) {
        const text = readFileSync(join(root, config), 'utf8');
        if (!/"skipLibCheck"\s*:\s*true\b/.test(text)) continue;
        withException.push(config);
        // Only the ADR-0002 projects must cite ADR-0002. The root tooling project is authorised by UDG-001 D1
        // and must not borrow this ADR's name — `adr-0002-tags-exactly-its-two-projects` checks both directions.
        if (APPROVED_EXCEPTION_PROJECTS.includes(config) && !text.includes('ADR-0002')) {
          undocumented.push(`${config} sets skipLibCheck: true without naming ADR-0002`);
        }
        let lib: unknown;
        try {
          lib = ((JSON.parse(text) as { compilerOptions?: { lib?: unknown } }).compilerOptions ?? {}).lib;
        } catch {
          lib = undefined;
        }
        const dom = (Array.isArray(lib) ? lib : []).filter((entry) => typeof entry === 'string' && /^DOM(\.Iterable)?$/i.test(entry));
        if (dom.length > 0) undocumented.push(`${config} loads DOM lib entries: ${String(dom.join(', '))}`);
      }
      // `skipLibCheck: true` may appear in exactly three places, each with its own authority: the two projects
      // ADR-0002 approves, and the repository tooling project that has carried it since UDG-001 decision D1
      // (playwright-core and vitest declaration bundles are not checkable under a non-DOM lib). A fourth
      // project would mean the exception spread, so it fails here rather than in review.
      const PREEXISTING = ['tsconfig.json'];
      const approved = [...APPROVED_EXCEPTION_PROJECTS, ...PREEXISTING].sort();
      const outside = withException.filter((config) => !approved.includes(config));
      const absent = approved.filter((config) => !withException.includes(config));
      checks.check(
        'exception-confined-to-the-approved-projects',
        outside.length === 0 && absent.length === 0,
        outside.length + absent.length === 0
          ? `skipLibCheck: true appears in the two ADR-0002 projects and, since UDG-001 D1, in ${PREEXISTING[0]}; nothing else (${String(configs.length)} tsconfig files scanned)`
          : `outside approval: [${outside.join(', ')}]; missing: [${absent.join(', ')}]`,
      );
      const adrTagged = withException.filter((config) => {
        const text = readFileSync(join(root, config), 'utf8');
        return text.includes('ADR-0002');
      });
      checks.check(
        'adr-0002-tags-exactly-its-two-projects',
        adrTagged.slice().sort().join(',') === APPROVED_EXCEPTION_PROJECTS.slice().sort().join(','),
        `projects naming ADR-0002: [${adrTagged.join(', ')}] — the pre-existing UDG-001 D1 tooling relaxation must not claim this ADR, and this ADR must not silently absorb it`,
      );
      checks.check(
        'exception-projects-name-the-adr-and-load-no-dom-lib',
        undocumented.length === 0 && withException.length > 0,
        undocumented.length === 0
          ? 'each exception project names ADR-0002 in its own `//` note and loads no DOM lib'
          : undocumented.join('; '),
      );
      checks.observe('declarationCheckingException', {
        adr: 'ADR-0002',
        approvedProjects: APPROVED_EXCEPTION_PROJECTS,
        preexistingRelaxation: {
          project: 'tsconfig.json',
          authority: 'UDG-001 decision D1 (root tooling project: playwright-core and vitest declaration bundles)',
          unchangedByThisAdr: true,
        },
        projectsWithException: withException,
        baseSkipLibCheck: base.compilerOptions['skipLibCheck'],
        tsconfigsScanned: configs.length,
      });

      // Every symbol the later probes rely on, checked as a runtime value. That a protected member is
      // not listed here is deliberate: `defineInput` is exercised by rooms.ts, and the fact that this
      // project compiles at all is that member's evidence.
      const values: readonly (readonly [string, unknown, string])[] = [
        ['Room', Room, 'function'],
        ['Room.prototype.setFixedTimestep', Room.prototype.setFixedTimestep, 'function'],
        ['Room.prototype.setState', Room.prototype.setState, 'function'],
        ['Room.prototype.allowReconnection', Room.prototype.allowReconnection, 'function'],
        ['defineRoom', defineRoom, 'function'],
        ['defineServer', defineServer, 'function'],
        ['Server.prototype.serverless', Server.prototype.serverless, 'function'],
        ['matchMaker', matchMaker, 'object'],
        ['validate', validate, 'function'],
        ['WebSocketTransport', WebSocketTransport, 'function'],
        ['sdk.Client', Client, 'function'],
        ['sdk.registerSerializer', registerSerializer, 'function'],
        ['sdk.SchemaSerializer', SchemaSerializer, 'function'],
        ['udg.DirectInputSchema', declaredInput, 'function'],
        ['udg.RegionSchema', declaredState, 'function'],
        ['udg.PlayerSchema', declaredPlayer, 'function'],
        ['udg.validateDirectFrame', protocolValidator, 'function'],
      ];
      const observed = values.map(([name, value, expected]) => {
        const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
        return [name, kind === expected, `typeof ${name} = ${kind}, expected ${expected}`] as const;
      });
      for (const [name, ok, detail] of observed) {
        checks.check(`symbol:${name}`, ok, detail);
      }

      // Type-level references. Nothing calls them; the compile is the only possible proof for a type.
      type ProbeRoomClass = Room;
      type ProbeServerInstance = Server;
      type ProbeStep = FixedTimestepCallback;
      type ProbeContext = StepContext;
      type ProbeAccessor = InputAccessor<DirectInputFrameAlias>;
      type ProbeClient = Client;
      type ProbeInputHandle = InputHandle<DirectInputFrameAlias>;
      type ProbeTransport = WebSocketTransport;
      const typeReferences: readonly (readonly [string, unknown])[] = [
        ['type ProbeRoomClass', null as ProbeRoomClass | null],
        ['type ProbeServerInstance', null as ProbeServerInstance | null],
        ['type ProbeStep', null as ProbeStep | null],
        ['type ProbeContext', null as ProbeContext | null],
        ['type ProbeAccessor', null as ProbeAccessor | null],
        ['type ProbeClient', null as ProbeClient | null],
        ['type ProbeInputHandle', null as ProbeInputHandle | null],
        ['type ProbeTransport', null as ProbeTransport | null],
        ['type ProbeHandler', null as RegisteredHandler | null],
      ];
      for (const [name, reference] of typeReferences) {
        checks.check(name, reference === null, 'declared in a typed position; the compile is the proof');
      }
      checks.check('input-field-count', inputFieldCount === 5, `DIRECT_INPUT_FIELDS has ${String(inputFieldCount)} entries`);

      // No escape hatches anywhere in the probe tree: the compile must be honest.
      const probeDir = join(root, 'apps/server/probes');
      const sources = readdirSync(probeDir)
        .filter((entry) => entry.endsWith('.ts'))
        .map((entry) => join(probeDir, entry));
      // The banned markers are assembled at runtime so that this file cannot match its own scan.
      const directive = '@' + 'ts-';
      const anyToken = 'an' + 'y';
      const escapePatterns: readonly (readonly [string, RegExp])[] = [
        ['any-annotation', new RegExp(`:\\s*${anyToken}\\b|\\bas ${anyToken}\\b|<${anyToken}>|\\b${anyToken}\\[\\]|\\|\\s*${anyToken}\\b|&\\s*${anyToken}\\b`)],
        ['error-suppression', new RegExp(directive + '(ignore|expect-error|nocheck)')],
        ['unknown-cast', new RegExp('as\\s+unk' + 'nown\\b')],
        // A cast to `never` satisfies any parameter type, so it can turn a wrong signature into a clean
        // compile — precisely the failure PR-0 exists to report. The reconnection callback is the case
        // that would otherwise look clean.
        ['never-cast', new RegExp('as\\s+nev' + 'er\\b')],
        ['lint-suppression', new RegExp('eslint' + '-(disable|enable)')],
        // Importing a package's internal path bypasses its public entry points. Reading a declaration file
        // as text for a visibility measurement is not an import and is not matched here.
        ['private-package-import', new RegExp("from\\s+['\"]@col" + 'yseus/[a-z-]+/(build|src)/')],
        // An ambient shim is the tempting workaround for a broken vendor declaration: it makes the error
        // disappear by describing a different library. ADR-0002 forbids it, and forbade it before ADR-0002.
        ['ambient-global-shim', new RegExp('declare\\s+glob' + 'al\\b')],
        ['ambient-module-shim', new RegExp('declare\\s+mod' + 'ule\\b')],
      ];
      const offenders: string[] = [];
      for (const file of sources) {
        // Comments and literals are removed first, so a docstring quoting a declaration path or writing the
        // words "as never" while banning them is not reported as an offender.
        const code = stripNonCode(readFileSync(file, 'utf8'));
        const relative = file.slice(root.length + 1);
        for (const [label, pattern] of escapePatterns) {
          if (pattern.test(code)) offenders.push(`${relative}: ${label}`);
        }
        if (/\bprocess\.exit\(/.test(code) && !relative.includes('support.ts')) offenders.push(`${relative}: exits the process outside the harness`);
      }
      checks.observe('escapeHatchPatterns', escapePatterns.map(([label]) => label));
      checks.check(
        'no-escape-hatches',
        offenders.length === 0,
        offenders.length === 0 ? `${String(sources.length)} probe modules are clean` : offenders.join('; '),
      );

      // The exception must not have made suppressions fashionable in the code that holds it.
      const serverTrees = ['apps/server/src', 'apps/server/probes'];
      const serverOffenders: string[] = [];
      for (const tree of serverTrees) {
        const directory = join(root, tree);
        if (!existsSync(directory)) continue;
        for (const entry of readdirSync(directory)) {
          if (!entry.endsWith('.ts')) continue;
          const code = stripNonCode(readFileSync(join(directory, entry), 'utf8'));
          for (const [label, pattern] of escapePatterns) {
            if (pattern.test(code)) serverOffenders.push(`${tree}/${entry}: ${label}`);
          }
        }
      }
      checks.check(
        'exception-projects-use-no-suppression-or-shims',
        serverOffenders.length === 0,
        serverOffenders.length === 0
          ? `${serverTrees.join(' and ')} are clean of suppression comments, ambient shims and cast escape hatches`
          : serverOffenders.join('; '),
      );

      // --- the accepted compiler gate ---------------------------------------------
      // The harness ran `pnpm --filter @udg/server typecheck:probes` and hands the report over, because
      // no probe can see the exit status of the command that built it.
      const reportPath = flagValue(process.argv.slice(2), '--typecheck-report');
      if (reportPath === undefined || !existsSync(reportPath)) {
        checks.check('accepted-typecheck-report-present', false, `PR-0 needs --typecheck-report <file>; got ${String(reportPath)}`);
        checks.block(
          'PR-0 has no accepted-gate report, so its claim is unsupported and it reports BLOCKED rather than passed. ' +
            'The claim is "first-party code typechecks against the pinned declarations under the ADR-0002 exception", ' +
            'and the only evidence for it is the exit status of the accepted typecheck. Assuming that status would ' +
            'invent a compile result.',
        );
      } else {
        const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
          command?: string;
          exitCode?: number;
          diagnostics?: readonly { readonly code?: string; readonly insideRepository?: boolean }[];
        };
        const diagnostics = report.diagnostics ?? [];
        const insideRepository = diagnostics.filter((diagnostic) => diagnostic.insideRepository === true);
        const acceptedClean = report.exitCode === 0 && diagnostics.length === 0;
        checks.observe('acceptedGate', {
          command: report.command ?? 'unknown',
          exitCode: report.exitCode ?? -1,
          diagnostics: diagnostics.length,
          inRepositoryCode: insideRepository.length,
          claim: 'first-party code typechecks against the pinned declarations under the documented ADR-0002 exception',
          notClaimed: [
            'the vendor declaration defects are fixed: they are inventoried by the retained full check, not resolved',
            'runtime behaviour, reconciliation or transport compatibility follows from compilation',
            'apps/client or any project other than the two approved server projects is covered',
            'build:probes is a build path: it emits with --noCheck for measurement only',
          ],
        });
        checks.check('accepted-typecheck-report-present', true, `report from ${reportPath.slice(root.length + 1)}`);
        checks.check(
          'accepted-typecheck-has-no-first-party-diagnostics',
          insideRepository.length === 0,
          `${String(insideRepository.length)} diagnostic(s) in repository code`,
        );
        checks.check(
          'accepted-typecheck-passes-under-the-exception',
          acceptedClean,
          `'${report.command ?? 'tsc'}' exited ${String(report.exitCode)} with ${String(diagnostics.length)} diagnostic(s). ` +
            (acceptedClean
              ? 'First-party code typechecks against the pinned declarations under the ADR-0002 exception, and that is the whole of what PR-0 claims.'
              : 'Under ADR-0002 a diagnostic here is a first-party problem: the vendor declaration noise the gate used to report is now measured separately.'),
        );
      }

      // --- the retained full check: the vendor defects stay visible, and a new one is loud ---
      const inventoryPath = flagValue(process.argv.slice(2), '--declaration-report');
      const pinnedPath = join(root, 'docs', 'integration', 'colyseus-declaration-inventory.json');
      const live = inventoryPath !== undefined && existsSync(inventoryPath)
        ? (JSON.parse(readFileSync(inventoryPath, 'utf8')) as {
            exitCode?: number;
            totalDiagnostics?: number;
            inRepositoryCode?: number;
            inThirdPartyDeclarations?: number;
            entries?: readonly { origin: string; code: string; count: number }[];
          })
        : undefined;
      const pinned = existsSync(pinnedPath)
        ? (JSON.parse(readFileSync(pinnedPath, 'utf8')) as {
            adr?: string;
            totalDiagnostics?: number;
            entries?: readonly { origin: string; code: string; count: number }[];
          })
        : undefined;
      if (live === undefined || pinned === undefined) {
        checks.check(
          'retained-full-declaration-check-ran',
          false,
          `live inventory ${String(inventoryPath)} present=${String(live !== undefined)}; pinned inventory present=${String(pinned !== undefined)}`,
        );
      } else {
        const keyOf = (entry: { origin: string; code: string }): string => `${entry.origin}|${entry.code}`;
        const liveEntries = live.entries ?? [];
        const pinnedEntries = pinned.entries ?? [];
        const liveMap = new Map(liveEntries.map((entry) => [keyOf(entry), entry]));
        const pinnedMap = new Map(pinnedEntries.map((entry) => [keyOf(entry), entry]));
        const added = [...liveMap.keys()].filter((key) => !pinnedMap.has(key));
        const removed = [...pinnedMap.keys()].filter((key) => !liveMap.has(key));
        const changed = [...liveMap.keys()].flatMap((key) => {
          const now = liveMap.get(key);
          const before = pinnedMap.get(key);
          return now !== undefined && before !== undefined && now.count !== before.count
            ? [`${key}: live ${String(now.count)} vs pinned ${String(before.count)}`]
            : [];
        });
        checks.observe('fullDeclarationCheck', {
          command: `tsc -p tsconfig.probes.json --noEmit --skipLibCheck false`,
          exitCode: live.exitCode ?? -1,
          totalDiagnostics: live.totalDiagnostics ?? 0,
          inRepositoryCode: live.inRepositoryCode ?? 0,
          inThirdPartyDeclarations: live.inThirdPartyDeclarations ?? 0,
          groups: liveEntries.length,
          pinnedInventory: 'docs/integration/colyseus-declaration-inventory.json',
          pinnedAdr: pinned.adr ?? 'missing',
        });
        checks.check(
          'retained-full-declaration-check-ran',
          (live.exitCode ?? -1) !== 0 && (live.totalDiagnostics ?? 0) > 0,
          `the retained check exits ${String(live.exitCode)} and still reports ${String(live.totalDiagnostics)} vendor diagnostic(s) — ADR-0002 hides them from the accepted gate, not from this repository`,
        );
        checks.check(
          'vendor-declaration-inventory-matches-the-pinned-inventory',
          added.length === 0 && removed.length === 0 && changed.length === 0,
          added.length + removed.length + changed.length === 0
            ? `${String(liveEntries.length)} defect group(s), ${String(live.totalDiagnostics)} diagnostics: identical to the pinned inventory`
            : `added [${added.join(', ')}]; removed [${removed.join(', ')}]; changed [${changed.join(', ')}] — a vendor type-surface change is a review event, and clearing one needs a pin change plus an update to the inventory that says which release fixed what`,
        );
        checks.check(
          'the-exception-hides-no-repository-diagnostics',
          (live.inRepositoryCode ?? -1) === 0,
          `${String(live.inRepositoryCode)} diagnostic(s) inside repository code when the same project is checked with skipLibCheck: false`,
        );
      }

      // --- UDG's own declarations keep a strict check of their own ---
      const firstPartyPath = inventoryPath === undefined ? undefined : join(dirname(inventoryPath), 'first-party-declarations.json');
      const firstParty = firstPartyPath !== undefined && existsSync(firstPartyPath)
        ? (JSON.parse(readFileSync(firstPartyPath, 'utf8')) as { exitCode?: number; diagnostics?: readonly unknown[] })
        : undefined;
      checks.observe('udgEmittedDeclarations', {
        report: firstPartyPath === undefined ? 'not passed' : firstPartyPath.slice(root.length + 1),
        exitCode: firstParty?.exitCode ?? -1,
        diagnostics: firstParty?.diagnostics?.length ?? -1,
        policy: 'skipLibCheck: false (tsconfig.declarations.json), no @colyseus/core, @colyseus/sdk or @colyseus/ws-transport',
      });
      checks.check(
        'udg-emitted-declarations-typecheck-with-skiplibcheck-false',
        firstParty !== undefined && firstParty.exitCode === 0 && (firstParty.diagnostics?.length ?? -1) === 0,
        firstParty === undefined
          ? 'first-party-declarations.json was not produced; run the probe suite rather than this probe alone'
          : `exit ${String(firstParty.exitCode)} with ${String(firstParty.diagnostics?.length ?? 0)} diagnostic(s) over the emitted declarations of @udg/protocol and @udg/config`,
      );

      checks.observe('probeModules', sources.map((file) => file.slice(root.length + 1)));
      checks.observe('repositoryRootIsGit', existsSync(join(root, '.git')) || existsSync(join(root, '.git-ref')));

      checks.limit('ADR-0002 means this probe no longer looks inside third-party declarations. A vendor type regression whose exported type degrades is invisible to the accepted gate; the retained full check and its pinned inventory are the compensating control, and both are asserted here.');
      checks.limit('A compile proves the declarations line up with this code; it proves nothing about behaviour. PR-2, PR-3, PR-8, PR-12 and PR-13 measure behaviour, and even together they do not establish stack compatibility.');
      checks.limit('The escape-hatch scan strips comments and literals before matching, so a banned pattern written inside a string is invisible to it; the strict compile plus the no-any/no-never rule is what a cast cannot hide.');
      checks.limit('PR-0 cannot show that an API the pinned set does not have is missing, because the repository does not import one. The api-map records each absent name as "not used, and why".');
    },
  );
}

/** The wire shape, taken from the harness rather than restated, so the two cannot drift. */
type DirectInputFrameAlias = DirectInputFrame;

await main();
