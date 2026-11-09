/**
 * PR-0 — is the pinned stack usable under this repository's compiler policy?
 *
 * The probe has two halves, and they must not be conflated.
 *
 * **The compile half is the verdict.** `pnpm --filter @udg/server typecheck:probes` typechecks this
 * file and every other probe module with `skipLibCheck: false`, `strict`,
 * `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`, so a signature that differs from the
 * declarations is a compile error and not a runtime surprise. The harness runs that command, writes the
 * report, and passes it here with `--typecheck-report`; when it exits non-zero this probe reports
 * **blocked** and fails, because reproducing a failure is not the same as establishing compatibility.
 * The `--noCheck` emit that lets the other probes run is a diagnostic measurement aid, never an accepted
 * build path, and this probe says so in its own result file.
 *
 * **The typed-reference half** references the symbols the later probes depend on, in a typed position,
 * so removing or renaming one breaks the build rather than producing `undefined` at run time. The
 * runtime half records what was actually checked and proves that no escape hatch was used — including
 * casts to `never`, which silence exactly the mismatch PR-0 exists to find.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

const root = findRepositoryRoot(dirname(fileURLToPath(import.meta.url)));

async function main(): Promise<void> {
  const out = outputPath(process.argv.slice(2));
  await runProbe('PR-0', 'pinned stack typechecks under the strict compiler policy', out, async (checks) => {
    const probeTsconfig = JSON.parse(readFileSync(join(root, 'apps/server/tsconfig.probes.json'), 'utf8')) as {
      compilerOptions?: Record<string, unknown>;
      extends?: string;
    };
    const base = JSON.parse(readFileSync(join(root, 'tsconfig.base.json'), 'utf8')) as { compilerOptions: Record<string, unknown> };

    checks.check(
      'probes inherit the shared policy',
      probeTsconfig.extends === '../../tsconfig.base.json',
      `tsconfig.probes.json extends ${String(probeTsconfig.extends)}`,
    );
    for (const flag of ['strict', 'noImplicitAny', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess', 'skipLibCheck']) {
      const value = base.compilerOptions[flag];
      // skipLibCheck must be false and everything else true; the probe project overrides nothing.
      const expected = flag === 'skipLibCheck' ? false : true;
      checks.check(`policy:${flag}`, value === expected, `tsconfig.base.json ${flag} = ${String(value)}, expected ${String(expected)}`);
      checks.check(
        `probe-project-does-not-relax:${flag}`,
        probeTsconfig.compilerOptions?.[flag] === undefined,
        `tsconfig.probes.json sets ${flag} to ${String(probeTsconfig.compilerOptions?.[flag])}`,
      );
    }

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
    // The compile half of PR-0: the harness ran the strict typecheck and hands the report over, because
    // no probe can see the exit status of the command that built it.
    const reportPath = flagValue(process.argv.slice(2), '--typecheck-report');
    if (reportPath === undefined || !existsSync(reportPath)) {
      checks.check('strict-typecheck-report-present', false, `PR-0 needs --typecheck-report <file>; got ${String(reportPath)}`);
      checks.block('PR-0 is BLOCKED: without the strict typecheck report there is no evidence the pinned stack compiles.');
    } else {
      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
        command?: string;
        exitCode?: number;
        diagnostics?: readonly { readonly code?: string; readonly insideRepository?: boolean }[];
      };
      const diagnostics = report.diagnostics ?? [];
      const insideRepository = diagnostics.filter((diagnostic) => diagnostic.insideRepository === true);
      const insideDeclarations = diagnostics.length - insideRepository.length;
      checks.observe('strictTypecheck', {
        command: report.command ?? 'unknown',
        exitCode: report.exitCode ?? -1,
        diagnostics: diagnostics.length,
        inRepositoryCode: insideRepository.length,
        inThirdPartyDeclarations: insideDeclarations,
      });
      checks.check('strict-typecheck-report-present', true, `report from ${reportPath.slice(root.length + 1)}`);
      checks.check(
        'strict-typecheck-has-no-first-party-diagnostics',
        insideRepository.length === 0,
        `${String(insideRepository.length)} diagnostic(s) in repository code`,
      );
      const compiles = report.exitCode === 0 && diagnostics.length === 0;
      checks.check(
        'strict-typecheck-passes',
        compiles,
        `'${report.command ?? 'tsc'}' exited ${String(report.exitCode)} with ${String(diagnostics.length)} diagnostic(s) (${String(insideDeclarations)} inside third-party declarations)`,
      );
      if (!compiles) {
        checks.block(
          `PH0-B1: the strict probe typecheck ('${report.command ?? 'tsc --noEmit'}') exits ${String(report.exitCode)} with ${String(diagnostics.length)} diagnostics${insideDeclarations === diagnostics.length ? ', every one inside a third-party declaration' : ''}. PR-0 is BLOCKED, not passed: the pinned stack has not been shown to compile under this repository's policy, so its compatibility is NOT established. Emitting JavaScript with --noCheck keeps the other probes measurable and is a diagnostic path only, never the accepted build path.`,
        );
      }
    }

    checks.observe('probeModules', sources.map((file) => file.slice(root.length + 1)));
    checks.observe('repositoryRootIsGit', existsSync(join(root, '.git')) || existsSync(join(root, '.git-ref')));

    checks.limit('The escape-hatch scan strips comments and literals before matching, so a banned pattern written inside a string is invisible to it; the strict compile plus the no-any/no-never rule is what a cast cannot hide.');
    checks.limit('A compile proves the declarations match; it proves nothing about behaviour. That is what PR-2, PR-3, PR-8 and PR-12 are for.');
    checks.limit('PR-0 reports blocked while the strict typecheck fails. The other probes still measure real behaviour on emitted JavaScript, and their results say so; none of them implies the stack typechecks.');
    checks.limit('PR-0 cannot show that an API the pinned set does not have is missing, because the repository does not import one. The api-map records each absent name as "not used, and why".');
  });
}

/** The wire shape, taken from the harness rather than restated, so the two cannot drift. */
type DirectInputFrameAlias = DirectInputFrame;

await main();
