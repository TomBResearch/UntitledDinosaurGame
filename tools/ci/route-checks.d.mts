/**
 * Type surface for the routine CI router (`route-checks.mjs`).
 *
 * The module itself is plain JavaScript with no build step — the same shape as
 * `tests/support/client-harness/impairment.mjs` and its declaration — because CI runs it with `node`
 * directly and a build step in front of a CI routing decision would put the checker behind the thing it
 * checks.
 */

/** One routable group; each flag has exactly one conditional job in `.github/workflows/ci.yml`. */
export type RouteFlag =
  | 'records'
  | 'static'
  | 'protocol'
  | 'unit'
  | 'camera'
  | 'server'
  | 'runtime'
  | 'tooling'
  | 'fullSuite';

export type RouteFlags = Readonly<Record<RouteFlag, boolean>>;

export interface RouteRule {
  readonly id: string;
  /** The suite or command that reads the paths, so a rule can be checked against its reason for existing. */
  readonly reader: string;
  readonly flags: readonly RouteFlag[];
  readonly patterns: readonly string[];
}

export interface EscalationRule {
  readonly id: string;
  readonly detail: string;
  readonly patterns: readonly string[];
}

export interface RouteDecision {
  readonly path: string | null;
  readonly kind: 'routed' | 'unknown' | 'escalation' | 'forced';
  readonly rules: readonly string[];
  readonly flags?: readonly string[];
  readonly detail: string;
}

/** Why the run got the flags it got. Anything other than `routed` means the table did not decide alone. */
export type RouteReason =
  | 'routed'
  | 'empty-diff'
  | 'unresolved-diff'
  | 'unknown-path'
  | 'too-many-paths'
  | 'dispatch-all'
  | 'forced'
  | (string & {});

export interface RouteResult {
  readonly flags: RouteFlags;
  readonly all: boolean;
  readonly reason: RouteReason;
  readonly detail: string;
  readonly decisions: readonly RouteDecision[];
}

export interface RouteOptions {
  readonly force?: readonly string[];
  readonly all?: boolean;
  readonly pathLimit?: number;
}

export declare const ROUTE_FLAGS: readonly RouteFlag[];
export declare const ESCALATION_RULES: readonly EscalationRule[];
export declare const ROUTE_RULES: readonly RouteRule[];

export declare const globToRegExp: (glob: string) => RegExp;

export declare const routePaths: (paths: readonly string[] | undefined, options?: RouteOptions) => RouteResult;

/** `git diff --name-status` output → the deduplicated path list, keeping both sides of a rename. */
export declare const parseNameStatus: (text: string) => string[];

export declare const changedPaths: (options: {
  cwd: string;
  base?: string | undefined;
  head?: string | undefined;
  threeDot?: boolean | undefined;
}) => string[] | undefined;

export interface RouterArgs {
  cwd: string;
  explain: boolean;
  base?: string;
  head?: string;
  threeDot?: boolean;
  pathsFile?: string;
  paths?: string[];
  force?: string[];
  all?: boolean;
  outputFile?: string;
  jsonOut?: string;
}

export declare const parseArgs: (argv: readonly string[]) => RouterArgs;
export declare const main: (argv: readonly string[]) => number;
