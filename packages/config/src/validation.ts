/**
 * Configuration validation results and shared field checks.
 *
 * Declared as an addition to the UDG-002 file list because movement, network, limit and region
 * validation all need the same vocabulary and it must not live in one of their modules.
 *
 * A configuration problem is deliberately **not** expressed with a protocol `RejectionCode`: wire
 * rejections describe a peer's payload, while these describe this process's own startup data. Baseline
 * and docs/interfaces/configuration.md 4.5 both say a missing, non-finite or internally inconsistent
 * configuration fails startup, which is a startup error, not a message to a client.
 */

export type ConfigIssueCode =
  | 'MISSING'
  | 'WRONG_TYPE'
  | 'NOT_FINITE'
  | 'OUT_OF_RANGE'
  | 'NOT_POSITIVE'
  | 'EMPTY'
  | 'TOO_LONG'
  | 'INVALID_HASH'
  | 'INCONSISTENT'
  | 'UNKNOWN_KEY';

export interface ConfigIssue {
  readonly path: string;
  readonly code: ConfigIssueCode;
  readonly message: string;
}

export type ConfigResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] };

export const configFail = (path: string, code: ConfigIssueCode, message: string): ConfigIssue => ({
  path,
  code,
  message,
});

export const configOk = <T>(value: T): ConfigResult<T> => ({ ok: true, value });

export const configError = <T>(issues: readonly ConfigIssue[]): ConfigResult<T> => ({ ok: false, issues });

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Collect a check into an issue list; returns nothing so the call sites read as a list of checks. */
export const push = (issues: ConfigIssue[], issue: ConfigIssue | undefined): void => {
  if (issue !== undefined) issues.push(issue);
};

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const typeOrFinite = (path: string, value: unknown): ConfigIssue =>
  typeof value === 'number' ? configFail(path, 'NOT_FINITE', 'must be a finite number') : configFail(path, 'WRONG_TYPE', 'must be a finite number');

export const checkFinite = (path: string, value: unknown): ConfigIssue | undefined =>
  isFiniteNumber(value) ? undefined : typeOrFinite(path, value);

export const checkPositive = (path: string, value: unknown): ConfigIssue | undefined => {
  if (!isFiniteNumber(value)) return typeOrFinite(path, value);
  return value > 0 ? undefined : configFail(path, 'NOT_POSITIVE', 'must be greater than zero');
};

export const checkNonNegative = (path: string, value: unknown): ConfigIssue | undefined => {
  if (!isFiniteNumber(value)) return typeOrFinite(path, value);
  return value >= 0 ? undefined : configFail(path, 'OUT_OF_RANGE', 'must be zero or greater');
};

export const checkRange = (path: string, value: unknown, min: number, max: number): ConfigIssue | undefined => {
  if (!isFiniteNumber(value)) return typeOrFinite(path, value);
  return value >= min && value <= max
    ? undefined
    : configFail(path, 'OUT_OF_RANGE', `must be within [${String(min)}, ${String(max)}]`);
};

export const checkBoolean = (path: string, value: unknown): ConfigIssue | undefined =>
  typeof value === 'boolean' ? undefined : configFail(path, 'WRONG_TYPE', 'must be a boolean');

export const checkIdentifier = (path: string, value: unknown, maxLength = 64): ConfigIssue | undefined => {
  if (typeof value !== 'string') return configFail(path, 'WRONG_TYPE', 'must be a string');
  if (value.length === 0) return configFail(path, 'EMPTY', 'must not be empty');
  if (value.length > maxLength) return configFail(path, 'TOO_LONG', `must be at most ${String(maxLength)} characters`);
  return /^[\x21-\x7e]+$/.test(value)
    ? undefined
    : configFail(path, 'WRONG_TYPE', 'must be printable ASCII with no whitespace');
};

export const checkHash = (path: string, value: unknown): ConfigIssue | undefined =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
    ? undefined
    : configFail(path, 'INVALID_HASH', 'must be 64 lowercase hexadecimal characters');

/**
 * The accepted key set of a configuration block is closed.
 *
 * An unknown key means the file and the code disagree about which version this is, and a hash computed
 * over a document with unrecognised fields would be stable but meaningless.
 */
export const checkKnownKeys = (path: string, record: Readonly<Record<string, unknown>>, allowed: readonly string[]): ConfigIssue[] => {
  const unexpected = Object.keys(record).filter((key) => !allowed.includes(key));
  return unexpected.map((key) => configFail(`${path}.${key}`, 'UNKNOWN_KEY', `unrecognised configuration key "${key}"`));
};

export const checkMissing = (path: string, value: unknown): ConfigIssue | undefined =>
  value === undefined ? configFail(path, 'MISSING', 'is required') : undefined;

/**
 * Deep freeze.
 *
 * A validated configuration is handed out frozen, so a fixture mutation cannot alter it and a shared
 * default object cannot be edited into a different world for the next test.
 */
export const deepFreeze = <T>(value: T): Readonly<T> => {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    return Object.freeze(value);
  }
  return Object.freeze(value);
};

/**
 * Read the numeric fields of a block.
 *
 * This exists so validators narrow by reading instead of asserting. A validated block is rebuilt from
 * values that were read through a `number`-typed result, so no unchecked cast sits between "the checks
 * passed" and "this object is a configuration".
 */
export interface NumericField {
  readonly key: string;
  readonly check: (value: unknown) => ConfigIssue | undefined;
}

export interface ReadFieldsResult {
  readonly values: Readonly<Record<string, number>>;
  readonly issues: readonly ConfigIssue[];
}

export const readNumericFields = (
  record: Readonly<Record<string, unknown>>,
  prefix: string,
  fields: readonly NumericField[],
): ReadFieldsResult => {
  const values: Record<string, number> = {};
  const issues: ConfigIssue[] = [];
  for (const field of fields) {
    const raw = record[field.key];
    const path = `${prefix}.${field.key}`;
    const missing = checkMissing(path, raw);
    if (missing !== undefined) {
      issues.push(missing);
      continue;
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      // The field's own check reports the precise reason when it can.
      issues.push(field.check(raw) ?? typeOrFinite(path, raw));
      continue;
    }
    const issue = field.check(raw);
    if (issue !== undefined) {
      issues.push(issue);
      continue;
    }
    values[field.key] = raw;
  }
  return { values, issues };
};

/** Read the boolean fields of a block, with the same narrowing guarantee. */
export const readBooleanFields = (
  record: Readonly<Record<string, unknown>>,
  prefix: string,
  keys: readonly string[],
): { readonly values: Readonly<Record<string, boolean>>; readonly issues: readonly ConfigIssue[] } => {
  const values: Record<string, boolean> = {};
  const issues: ConfigIssue[] = [];
  for (const key of keys) {
    const raw = record[key];
    const path = `${prefix}.${key}`;
    const missing = checkMissing(path, raw);
    if (missing !== undefined) {
      issues.push(missing);
      continue;
    }
    if (typeof raw !== 'boolean') {
      issues.push(checkBoolean(path, raw) ?? configFail(path, 'WRONG_TYPE', 'must be a boolean'));
      continue;
    }
    values[key] = raw;
  }
  return { values, issues };
};

/** Read a string field through a `string`-typed result. */
export const readStringField = (
  record: Readonly<Record<string, unknown>>,
  path: string,
  check: (value: unknown) => ConfigIssue | undefined,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly issue: ConfigIssue } => {
  const key = path.slice(path.lastIndexOf('.') + 1);
  const raw = record[key];
  const missing = checkMissing(path, raw);
  if (missing !== undefined) return { ok: false, issue: missing };
  if (typeof raw !== 'string') {
    return { ok: false, issue: check(raw) ?? configFail(path, 'WRONG_TYPE', 'must be a string') };
  }
  const issue = check(raw);
  if (issue !== undefined) return { ok: false, issue };
  return { ok: true, value: raw };
};

/**
 * Build a validated block once every field has passed.
 *
 * This is the one place where the configuration layer turns a checked `Record<string, number>` into
 * typed fields, and it is guarded rather than assumed: `readNumericFields` and `readBooleanFields`
 * record a MISSING or invalid issue for every field they cannot read, so reaching `build` with no
 * issues means every requested key exists with the right type. A getter fails loudly instead of
 * substituting a default if that invariant were ever broken.
 */
export const buildBlock = <T>(
  prefix: string,
  numeric: ReadFieldsResult,
  booleans: { readonly values: Readonly<Record<string, boolean>>; readonly issues: readonly ConfigIssue[] },
  extraIssues: readonly ConfigIssue[],
  build: (number: (key: string) => number, boolean: (key: string) => boolean) => T,
): ConfigResult<T> => {
  const issues = [...numeric.issues, ...booleans.issues, ...extraIssues];
  if (issues.length > 0) return configError<T>(issues);
  const number = (key: string): number => {
    const value = numeric.values[key];
    if (value === undefined) throw new Error(`${prefix}.${key} was requested after validation passed`);
    return value;
  };
  const boolean = (key: string): boolean => {
    const value = booleans.values[key];
    if (value === undefined) throw new Error(`${prefix}.${key} was requested after validation passed`);
    return value;
  };
  return configOk(build(number, boolean));
};

export const emptyBooleans = {
  values: {} as Readonly<Record<string, boolean>>,
  issues: [] as readonly ConfigIssue[],
};
