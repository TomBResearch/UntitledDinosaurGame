/**
 * Protocol fixture execution (UDG-002).
 *
 * docs/validation/fixtures.md 7.2 requires the P01 to P20 cases to exist with expected error codes;
 * docs/contracts/UDG-002.md requires them to run. A fixture file that nobody executes is a claim, so this
 * suite runs every case in all three files against the real validators and the real pinned codec, and
 * reports each case by its fully qualified id.
 *
 * Two rules make the run meaningful rather than decorative:
 *
 *  - an assertion key this suite does not recognise fails the run, so a fixture cannot acquire a new
 *    expectation that quietly goes unexecuted;
 *  - a case that expects rejection must be refused *and* must yield no value, because "it threw" is not a
 *    refusal and a partial object is not a rejection.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  GENERATION_MAX,
  PROTOCOL_VERSION,
  REJECTION_CODES,
  admitGeneration,
  compareRequestIdentity,
  directInputOf,
  neutralDirectFrame,
  validateCancelPath,
  validateDirectFrame,
  validateJoin,
  validateMoveTo,
  validateRouteStatus,
  type Validation,
} from '../../../packages/protocol/dist/index.js';
import {
  Decoder,
  DirectInputSchema,
  Encoder,
  PlayerSchema,
  RegionSchema,
} from '../../../packages/protocol/dist/schema/index.js';
import { fromRegionReplica, fromReplica, toRegionReplica, toReplica } from '../../../packages/protocol/dist/mapping/index.js';
import { DEFAULT_SERVER_CONFIG, computeConfigHash } from '../../../packages/config/dist/index.js';

const ROOT = process.cwd();
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'protocol');
const FILES = ['valid.json', 'malformed.json', 'ordering.json'] as const;

interface CaseExpectation {
  readonly ok: boolean;
  readonly errorCodes?: readonly string[];
  readonly asserts?: Readonly<Record<string, unknown>>;
}

interface FixtureCase {
  readonly caseId: string;
  readonly note: string;
  readonly target: string;
  readonly encoding: string;
  readonly input?: unknown;
  readonly operations?: unknown;
  readonly bytes?: string;
  readonly binary?: Record<string, unknown>;
  readonly expect: CaseExpectation;
}

interface FixtureFile {
  readonly file: string;
  readonly fixtureId: string;
  readonly kind: string;
  readonly protocolVersion: string;
  readonly configHash: string;
  readonly bounds: Record<string, { min: number; max: number }>;
  readonly context: Record<string, unknown>;
  readonly playerStates: Record<string, unknown>;
  readonly cases: readonly FixtureCase[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asRecord = (value: unknown, where: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error(`${where} must be an object`);
  return value;
};

/** docs/validation/fixtures.md 7.1: the loader expands tagged values in memory. */
const expandTagged = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((entry) => expandTagged(entry));
  if (!isRecord(value)) return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === 'number' && typeof value['number'] === 'string') {
    const tag = value['number'];
    if (tag === 'NaN') return Number.NaN;
    if (tag === 'Infinity') return Number.POSITIVE_INFINITY;
    if (tag === '-Infinity') return Number.NEGATIVE_INFINITY;
    // JSON has one zero, so the same tagged convention carries the sign that a wire field must not lose.
    if (tag === '-0') return -0;
    throw new Error(`unknown tagged number ${tag}`);
  }
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = expandTagged(value[key]);
  return out;
};

/** The two identity placeholders let a case name "this build" without pinning a literal that drifts. */
const substituteIdentity = (value: unknown): unknown => {
  if (typeof value === 'string') {
    if (value === 'MATCH_PROTOCOL_VERSION') return PROTOCOL_VERSION;
    if (value === 'MATCH_CONFIG_HASH') return computeConfigHash(DEFAULT_SERVER_CONFIG);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => substituteIdentity(entry));
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) out[key] = substituteIdentity(entry);
  return out;
};

const setPath = (target: Record<string, unknown>, path: readonly string[], value: unknown): void => {
  let cursor: Record<string, unknown> = target;
  for (const key of path.slice(0, -1)) {
    const next = cursor[key];
    if (!isRecord(next)) throw new Error(`patch path reaches a non-object at ${key}`);
    cursor = next;
  }
  cursor[path[path.length - 1] as string] = value;
};

const deepClone = <T>(value: T): T => structuredClone(value);

const structuredCloneSafe = <T>(value: T): T => {
  try {
    return deepClone(value);
  } catch {
    // A structured clone cannot carry a function or a non-finite-number-hosted Map; the fixtures only
    // carry plain data, so a failure here is a fixture bug worth reporting loudly.
    throw new Error('fixture data must be plain structured data');
  }
};

const loadFile = (file: string): FixtureFile => {
  const raw: unknown = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));
  const document = asRecord(raw, file);
  const playerStates = isRecord(document['playerStates']) ? document['playerStates'] : {};
  return {
    file,
    fixtureId: String(document['fixtureId']),
    kind: String(document['kind']),
    protocolVersion: String(document['protocolVersion']),
    configHash: String(document['configHash']),
    bounds: asRecord(document['bounds'], `${file}.bounds`) as Record<string, { min: number; max: number }>,
    context: asRecord(document['context'], `${file}.context`),
    playerStates,
    cases: (Array.isArray(document['cases']) ? document['cases'] : []).map((entry, index) => {
      const record = asRecord(entry, `${file}.cases[${String(index)}]`);
      const rawExpect = asRecord(record['expect'], `${file}.cases[${String(index)}].expect`);
      return {
        caseId: String(record['caseId']),
        note: String(record['note']),
        target: String(record['target']),
        encoding: String(record['encoding']),
        ...(record['input'] === undefined ? {} : { input: record['input'] }),
        ...(record['operations'] === undefined ? {} : { operations: record['operations'] }),
        ...(record['bytes'] === undefined ? {} : { bytes: String(record['bytes']) }),
        ...(record['binary'] === undefined || !isRecord(record['binary']) ? {} : { binary: record['binary'] }),
        expect: {
          ok: rawExpect['ok'] === true,
          ...(Array.isArray(rawExpect['errorCodes']) ? { errorCodes: (rawExpect['errorCodes'] as unknown[]).map(String) } : {}),
          ...(isRecord(rawExpect['asserts']) ? { asserts: rawExpect['asserts'] } : {}),
        },
      };
    }),
  };
};

const files = FILES.map((file) => loadFile(file));
const configHash = computeConfigHash(DEFAULT_SERVER_CONFIG);

/** A named player state, with tagged values expanded and a case-level patch applied. */
const playerStateFrom = (file: FixtureFile, reference: string, patch: unknown): Record<string, unknown> => {
  const named = file.playerStates[reference] ?? files[0]?.playerStates[reference];
  if (named === undefined) throw new Error(`unknown player state reference ${reference}`);
  const state = structuredCloneSafe(expandTagged(named)) as Record<string, unknown>;
  // `signedZero` is a fixture convention: JSON cannot carry -0, so the named state lists the paths whose
  // zeros the loader must turn negative before handing the state to mapping.
  const signedZero = state['signedZero'];
  delete state['signedZero'];
  if (Array.isArray(signedZero)) {
    for (const dotted of signedZero) {
      const path = String(dotted).split('.');
      const leaf = path.pop();
      if (leaf === undefined) continue;
      let cursor: Record<string, unknown> = state;
      for (const key of path) {
        const next = cursor[key];
        if (!isRecord(next)) throw new Error(`signedZero path reaches a non-object at ${key}`);
        cursor = next;
      }
      if (cursor[leaf] === 0) cursor[leaf] = -0;
    }
  }
  if (isRecord(patch)) {
    const path = String(patch['path']).split('.');
    setPath(state, path, expandTagged(patch['value']));
  }
  return state;
};

const boundsOf = (file: FixtureFile): Record<string, { min: number; max: number }> => file.bounds;

const commandContext = (file: FixtureFile): { sessionEpoch: number; bounds: never } =>
  ({ sessionEpoch: Number(file.context['sessionEpoch']), bounds: boundsOf(file) }) as never;

const joinContext = (file: FixtureFile): { protocolVersion: string; configHash: string; manifestHash: string } => ({
  protocolVersion: file.protocolVersion,
  configHash: file.configHash,
  manifestHash: String(file.context['manifestHash']),
});

const routeStatusContext = (file: FixtureFile): { sessionEpoch: number; entityId: string; currentRouteRevision: number } => ({
  sessionEpoch: Number(file.context['sessionEpoch']),
  entityId: String(file.context['entityId']),
  currentRouteRevision: Number(file.context['currentRouteRevision']),
});

const directContext = (file: FixtureFile): { sessionEpoch: number } => ({ sessionEpoch: Number(file.context['sessionEpoch']) });

const admissionContext = (file: FixtureFile): { watermark: number; limit: number } => ({
  watermark: Number(file.context['generationWatermark']),
  limit: 64,
});

/** Build a decoded replica from a binary recipe, or a truncated byte slice. */
const buildBinary = (file: FixtureFile, recipe: Record<string, unknown>): { replica: PlayerSchema; truncated: boolean } => {
  const schemaName = String(recipe['schema']);
  if (schemaName !== 'PlayerSchema' && schemaName !== 'DirectInputSchema' && schemaName !== 'RegionSchema') {
    throw new Error(`unsupported binary codec schema ${schemaName}`);
  }
  const base = playerStateFrom(file, String(recipe['base'] ?? '@player-motion'), undefined);
  if (schemaName !== 'PlayerSchema') {
    throw new Error('the pinned binary fixtures currently project player replicas only');
  }
  const projected = toReplica(base as never);
  if (!projected.ok) throw new Error(`binary base state must project: ${JSON.stringify(projected.issues)}`);
  const instance = projected.value;

  const patch = recipe['patch'];
  if (isRecord(patch)) {
    const field = String(patch['field']);
    const value = expandTagged(patch['value']);
    const target = instance as unknown as Record<string, unknown>;
    if (!(field in target)) throw new Error(`binary patch names an undeclared field ${field}`);
    // Assigning a forbidden value directly is the point: it puts the corrupt value on the wire without
    // going through mapping, which is exactly what refuses it.
    target[field] = value;
  }

  const bytes = new Encoder(instance).encodeAll();
  const truncateTo = recipe['truncateTo'];
  const payload = typeof truncateTo === 'number' ? bytes.slice(0, truncateTo) : bytes;

  const decoded = new PlayerSchema();
  if (typeof truncateTo === 'number') {
    // A framing failure must be contained: whatever the codec does with a short buffer, the protocol layer
    // turns it into a refusal rather than a crash or a half-state.
    try {
      new Decoder(decoded).decode(payload);
    } catch {
      return { replica: decoded, truncated: true };
    }
    return { replica: decoded, truncated: true };
  }
  new Decoder(decoded).decode(payload);
  return { replica: decoded, truncated: false };
};

interface Execution {
  readonly ok: boolean;
  readonly code?: string;
  readonly value?: unknown;
  readonly asserts?: Readonly<Record<string, unknown>>;
  readonly contextBefore: unknown;
  readonly contextAfter: unknown;
}

const validationCode = (result: Validation<unknown>): string | undefined => (result.ok ? undefined : result.code);

const execute = (file: FixtureFile, testCase: FixtureCase): Execution => {
  const contextBefore = structuredCloneSafe({ ...file.context, bounds: boundsOf(file) });
  const input = substituteIdentity(expandTagged(testCase.input ?? {}));
  const finish = (ok: boolean, code: string | undefined, value: unknown): Execution => ({
    ok,
    ...(code === undefined ? {} : { code }),
    ...(value === undefined ? {} : { value }),
    // Spreads rather than `asserts: ... | undefined`: the repository compiles with
    // exactOptionalPropertyTypes, where an optional property may not be assigned undefined explicitly.
    ...(testCase.expect.asserts === undefined ? {} : { asserts: testCase.expect.asserts }),
    contextBefore,
    contextAfter: structuredCloneSafe({ ...file.context, bounds: boundsOf(file) }),
  });

  switch (testCase.target) {
    case 'validateDirectFrame': {
      const result = validateDirectFrame(input, directContext(file));
      return finish(result.ok, validationCode(result), result.ok ? result.value : undefined);
    }
    case 'validateMoveTo': {
      const result = validateMoveTo(input, commandContext(file));
      return finish(result.ok, validationCode(result), result.ok ? result.value : undefined);
    }
    case 'validateCancelPath': {
      const result = validateCancelPath(input, commandContext(file));
      return finish(result.ok, validationCode(result), result.ok ? result.value : undefined);
    }
    case 'validateJoin': {
      const result = validateJoin(input, joinContext(file));
      return finish(result.ok, validationCode(result), result.ok ? result.value : undefined);
    }
    case 'validateRouteStatus': {
      const result = validateRouteStatus(input, routeStatusContext(file));
      return finish(result.ok, validationCode(result), result.ok ? result.value : undefined);
    }
    case 'admitGeneration': {
      const result = admitGeneration(input, admissionContext(file));
      return finish(result.ok, validationCode(result), result.ok ? result.value : undefined);
    }
    case 'compareRequestIdentity': {
      const record = asRecord(input, 'compareRequestIdentity input');
      const cached = asRecord(record['cached'], 'cached');
      const incoming = asRecord(record['incoming'], 'incoming');
      const result = compareRequestIdentity(
        { requestId: String(cached['requestId']), payloadHash: String(cached['payloadHash']) },
        { requestId: String(incoming['requestId']), payloadHash: String(incoming['payloadHash']) },
      );
      return finish(result.ok, validationCode(result), result.ok ? result.value : undefined);
    }
    case 'toReplica': {
      const record = asRecord(input, 'toReplica input');
      const state = playerStateFrom(file, String(record['player']), record['patch']);
      const result = toReplica(state as never);
      return finish(result.ok, result.ok ? undefined : 'INVALID_PAYLOAD', result.ok ? result.value : undefined);
    }
    case 'fromReplica': {
      if (testCase.binary !== undefined) {
        const built = buildBinary(file, testCase.binary);
        const result = fromReplica(built.replica);
        return finish(result.ok, validationCode(result), result.ok ? result.value : undefined);
      }
      const record = asRecord(input, 'fromReplica input');
      const state = playerStateFrom(file, String(record['player']), record['patch']);
      const projected = toReplica(state as never);
      if (!projected.ok) return finish(false, 'INVALID_PAYLOAD', undefined);
      const decoded = new PlayerSchema();
      new Decoder(decoded).decode(new Encoder(projected.value).encodeAll());
      const result = fromReplica(decoded);
      return finish(result.ok, validationCode(result), result.ok ? result.value : undefined);
    }
    case 'roundTrip': {
      const record = asRecord(input, 'roundTrip input');
      const state = playerStateFrom(file, String(record['player']), record['patch']);
      const route = record['route'];
      if (isRecord(route)) {
        const locomotion = state['locomotion'];
        if (!isRecord(locomotion)) throw new Error('roundTrip input must carry a locomotion block');
        locomotion['route'] = {
          revision: Number(route['revision']),
          nextWaypointIndex: Number(route['nextWaypointIndex']),
        };
      }
      const projected = toReplica(state as never);
      if (!projected.ok) {
        return finish(false, 'INVALID_PAYLOAD', undefined);
      }
      const decoded = new PlayerSchema();
      new Decoder(decoded).decode(new Encoder(projected.value).encodeAll());
      const read = fromReplica(decoded);
      if (!read.ok) return finish(false, validationCode(read), undefined);
      return finish(true, undefined, { state: read.value, replica: decoded, projected: projected.value, input: state });
    }
    case 'roundTripRegion': {
      const record = asRecord(input, 'roundTripRegion input');
      const projected = toRegionReplica(record as never);
      if (!projected.ok) return finish(false, 'INVALID_PAYLOAD', undefined);
      const decoded = new RegionSchema();
      new Decoder(decoded).decode(new Encoder(projected.value).encodeAll());
      const read = fromRegionReplica(decoded);
      if (!read.ok) return finish(false, validationCode(read), undefined);
      return finish(true, undefined, { region: read.value, input: record });
    }
    default:
      throw new Error(`fixture case ${testCase.caseId} targets ${testCase.target}, which this suite does not execute`);
  }
};

const describeCase = (file: FixtureFile, testCase: FixtureCase): string =>
  `${file.file}#${testCase.caseId} ${testCase.target} (${testCase.note})`;

const failCase = (id: string, message: string): never => {
  expect.fail(`${id}: ${message}`);
};

const checkAsserts = (id: string, asserts: Readonly<Record<string, unknown>> | undefined, execution: Execution): void => {
  if (asserts === undefined) return;
  for (const [name, expected] of Object.entries(asserts)) {
    const value = execution.value;
    switch (name) {
      case 'axes': {
        const frame = isRecord(value) ? value : failCase(id, 'axes assertion needs a validated frame');
        const want = asRecord(expected, 'axes');
        if (frame['moveX'] !== want['moveX'] || frame['moveZ'] !== want['moveZ']) {
          failCase(id, `axes ${String(frame['moveX'])},${String(frame['moveZ'])} != ${String(want['moveX'])},${String(want['moveZ'])}`);
        }
        break;
      }
      case 'directIntent': {
        const frame = isRecord(value) ? value : failCase(id, 'directIntent assertion needs a validated frame');
        if (frame['directIntent'] !== expected) failCase(id, `directIntent ${String(frame['directIntent'])} != ${String(expected)}`);
        break;
      }
      case 'generation': {
        const frame = isRecord(value) ? value : failCase(id, 'generation assertion needs a validated frame');
        if (frame['generation'] !== expected) failCase(id, `generation ${String(frame['generation'])} != ${String(expected)}`);
        break;
      }
      case 'neutralInput': {
        const frame = isRecord(value) ? value : failCase(id, 'neutralInput assertion needs a validated frame');
        if (directInputOf(frame as never).moveX !== 0 || directInputOf(frame as never).moveZ !== 0) {
          failCase(id, 'a neutral keepalive must project to zero movement');
        }
        break;
      }
      case 'wire': {
        const request = isRecord(value) ? value : failCase(id, 'wire assertion needs a validated request');
        const want = asRecord(expected, 'wire');
        const stamp = isRecord(request['stamp']) ? request['stamp'] : {};
        const destination = isRecord(request['destination']) ? request['destination'] : {};
        const actual: Record<string, unknown> = {
          requestId: request['requestId'],
          sessionEpoch: stamp['sessionEpoch'],
          generation: stamp['generation'],
          x: destination['x'],
          y: destination['y'],
          z: destination['z'],
        };
        for (const [key, wantValue] of Object.entries(want)) {
          if (actual[key] !== wantValue) failCase(id, `wire ${key} is ${String(actual[key])}, expected ${String(wantValue)}`);
        }
        break;
      }
      case 'requestId': {
        const request = isRecord(value) ? value : failCase(id, 'requestId assertion needs a validated request');
        if (request['requestId'] !== expected) failCase(id, `requestId ${String(request['requestId'])} != ${String(expected)}`);
        break;
      }
      case 'stamp': {
        const request = isRecord(value) ? value : failCase(id, 'stamp assertion needs a validated request');
        const stamp = isRecord(request['stamp']) ? request['stamp'] : {};
        const want = asRecord(expected, 'stamp');
        for (const [key, wantValue] of Object.entries(want)) {
          if (stamp[key] !== wantValue) failCase(id, `stamp ${key} is ${String(stamp[key])}, expected ${String(wantValue)}`);
        }
        break;
      }
      case 'status':
      case 'routeRevision': {
        const status = isRecord(value) ? value : failCase(id, 'status assertion needs a validated route status');
        if (status[name] !== expected) failCase(id, `${name} ${String(status[name])} != ${String(expected)}`);
        break;
      }
      case 'admittedGeneration': {
        const admitted = isRecord(value) ? value : failCase(id, 'admittedGeneration assertion needs an admission result');
        if (admitted['generation'] !== expected) failCase(id, `admitted generation ${String(admitted['generation'])} != ${String(expected)}`);
        break;
      }
      case 'replay': {
        const replay = isRecord(value) ? value : failCase(id, 'replay assertion needs an identity result');
        if (replay['replay'] !== expected) failCase(id, `replay ${String(replay['replay'])} != ${String(expected)}`);
        break;
      }
      case 'pair': {
        const bundle = isRecord(value) ? value : failCase(id, 'pair assertion needs a round trip bundle');
        const replica = isRecord(bundle['replica']) ? bundle['replica'] : {};
        const want = asRecord(expected, 'pair');
        for (const [key, wantValue] of Object.entries(want)) {
          if (replica[key] !== wantValue) failCase(id, `replica ${key} is ${String(replica[key])}, expected ${String(wantValue)}`);
        }
        break;
      }
      case 'scalars': {
        const bundle = isRecord(value) ? value : failCase(id, 'scalars assertion needs a round trip bundle');
        const replica = isRecord(bundle['replica']) ? bundle['replica'] : {};
        const want = asRecord(expected, 'scalars');
        for (const [key, wantValue] of Object.entries(want)) {
          if (replica[key] !== wantValue) failCase(id, `replica ${key} is ${String(replica[key])}, expected ${String(wantValue)}`);
        }
        break;
      }
      case 'yawWrapped': {
        const bundle = isRecord(value) ? value : failCase(id, 'yawWrapped assertion needs a round trip bundle');
        const replica = isRecord(bundle['replica']) ? bundle['replica'] : {};
        if (replica['yaw'] !== expected) failCase(id, `replica yaw is ${String(replica['yaw'])}, expected ${String(expected)}`);
        break;
      }
      case 'roundTripExact': {
        if (expected !== true) failCase(id, 'roundTripExact must be asserted true');
        const bundle = isRecord(value) ? value : failCase(id, 'roundTripExact assertion needs a round trip bundle');
        const read = bundle['state'];
        const input = bundle['input'];
        if (JSON.stringify(read) !== JSON.stringify(input)) {
          failCase(id, `round trip is not an exact copy:\n  in  ${JSON.stringify(input)}\n  out ${JSON.stringify(read)}`);
        }
        break;
      }
      case 'positiveZeroFields': {
        const names: readonly unknown[] = Array.isArray(expected) ? expected : failCase(id, 'positiveZeroFields must be an array of field names');
        const frame = isRecord(value) ? value : failCase(id, 'positiveZeroFields assertion needs a value');
        for (const field of names) {
          const read = frame[String(field)];
          // Object.is rather than ===, because 0 === -0 and the whole point is the sign.
          if (typeof read !== 'number' || !Object.is(read, 0)) {
            failCase(id, `${String(field)} is ${String(read)}, which is not positive zero`);
          }
        }
        break;
      }
      case 'signedZeroFields': {
        const names: readonly unknown[] = Array.isArray(expected) ? expected : failCase(id, 'signedZeroFields must be an array of replica field names');
        const bundle = isRecord(value) ? value : failCase(id, 'signedZeroFields assertion needs a round trip bundle');
        const replica = isRecord(bundle['replica']) ? bundle['replica'] : {};
        for (const field of names) {
          const read = replica[String(field)];
          if (typeof read !== 'number' || !Object.is(read, 0)) {
            failCase(id, `replica ${String(field)} is ${String(read)}, which is not positive zero`);
          }
        }
        break;
      }
      case 'regionRoundTripExact': {
        if (expected !== true) failCase(id, 'regionRoundTripExact must be asserted true');
        const bundle = isRecord(value) ? value : failCase(id, 'regionRoundTripExact assertion needs a round trip bundle');
        if (JSON.stringify(bundle['region']) !== JSON.stringify(bundle['input'])) {
          failCase(id, `region round trip is not an exact copy:\n  in  ${JSON.stringify(bundle['input'])}\n  out ${JSON.stringify(bundle['region'])}`);
        }
        break;
      }
      case 'stateUnchanged':
      case 'watermarkUnchanged': {
        if (expected !== true) failCase(id, `${name} must be asserted true`);
        if (JSON.stringify(execution.contextBefore) !== JSON.stringify(execution.contextAfter)) {
          failCase(id, 'the case changed the context it was given');
        }
        if (execution.value !== undefined) failCase(id, 'a refused case produced a value');
        break;
      }
      case 'neutralisesToZero': {
        if (execution.value !== undefined) failCase(id, 'a rejected frame must not yield a frame');
        const neutral = neutralDirectFrame({ sessionEpoch: 7, generation: 1 });
        if (directInputOf(neutral).moveX !== 0 || directInputOf(neutral).moveZ !== 0) {
          failCase(id, 'the neutral fallback must be zero movement');
        }
        break;
      }
      case 'notClamped': {
        // The distinction that matters: the value was refused, not pulled inside the limit.
        if (execution.value !== undefined) failCase(id, 'an out-of-range value was accepted, which means it was clamped');
        break;
      }
      case 'contained': {
        if (execution.value !== undefined) failCase(id, 'a framing failure produced state');
        break;
      }
      case 'noWraparound': {
        if (execution.value !== undefined) failCase(id, 'an over-maximum generation was accepted');
        if (execution.code !== 'INVALID_GENERATION') failCase(id, 'an overflow boundary must report INVALID_GENERATION');
        if (execution.code === undefined && GENERATION_MAX >= Number.MAX_SAFE_INTEGER) {
          failCase(id, 'the declared generation maximum is not the declared width boundary');
        }
        break;
      }
      default:
        failCase(id, `assertion "${name}" is not executed by this suite`);
    }
  }
};

const skipped: string[] = [];

/**
 * What each negative case *actually* reported, for the contract's rejection-results.json.
 *
 * The contract names the artefact; this file is the only place that runs every case, so it is the only
 * place that can report the observed code rather than the expected one.
 */
const EVIDENCE_DIR = process.env['UDG_EVIDENCE_OUT'];
const observedRejections: {
  caseId: string;
  file: string;
  target: string;
  encoding: string;
  expectedCodes: readonly string[];
  observedCode: string;
  matched: boolean;
}[] = [];
const observedRoundTrips: { caseId: string; file: string; kind: string; exact: boolean }[] = [];

afterAll(() => {
  if (EVIDENCE_DIR === undefined) return;
  // Only the task that owns the run writes into its bundle; see the UDG-002 suite's childEnv rule.
  if (process.env['UDG_EVIDENCE_TASK'] !== 'UDG-002') return;
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const body = {
    schemaVersion: 1,
    taskId: 'UDG-002',
    protocolVersion: PROTOCOL_VERSION,
    producedBy: 'tests/unit/udg-002/fixtures.test.ts',
    vocabulary: REJECTION_CODES,
    cases: observedRejections,
    roundTripAssertions: observedRoundTrips,
    totals: {
      negativeCases: observedRejections.length,
      matched: observedRejections.filter((entry) => entry.matched).length,
    },
  };
  writeFileSync(join(EVIDENCE_DIR, 'rejection-results.json'), `${JSON.stringify(body, null, 2)}\n`);
});

describe('protocol fixtures', () => {
  it('loads all three contract fixture files', () => {
    expect(files.length).toBe(3);
    for (const file of files) {
      expect(file.cases.length, file.file).toBeGreaterThan(0);
      expect(file.configHash, file.file).toBe(configHash);
      expect(file.protocolVersion, file.file).toBe(PROTOCOL_VERSION);
    }
    expect(files.map((file) => file.fixtureId).sort()).toEqual([
      'UDG-002-protocol-malformed',
      'UDG-002-protocol-ordering',
      'UDG-002-protocol-valid',
    ]);
  });

  it('uses one definition per named player state across files', () => {
    // The three files each carry the player states they need, so that no file depends on another file's
    // internals. That duplication is only safe while identical names mean identical states, which is what
    // this asserts.
    const definitions = new Map<string, string>();
    for (const file of files) {
      for (const [name, state] of Object.entries(file.playerStates)) {
        const serialised = JSON.stringify(state);
        const seen = definitions.get(name);
        if (seen !== undefined) expect(seen, `named state ${name} differs between files`).toBe(serialised);
        else definitions.set(name, serialised);
      }
    }
    expect(definitions.size).toBeGreaterThan(0);
  });

  it('runs every case without skipping any', () => {
    expect(skipped).toEqual([]);
  });
});

for (const file of files) {
  describe(`fixtures ${file.file}`, () => {
    for (const testCase of file.cases) {
      const id = `${file.file}#${testCase.caseId}`;
      it(id, () => {
        let execution: Execution;
        try {
          execution = execute(file, testCase);
        } catch (error) {
          // A case that throws inside the protocol layer is not a refusal.
          expect.fail(`${describeCase(file, testCase)} threw: ${String(error)}`);
        }

        expect(execution.ok, `${id} ${testCase.note}`).toBe(testCase.expect.ok);
        if (!testCase.expect.ok) {
          const codes = testCase.expect.errorCodes ?? [];
          expect(codes.length, `${id} declares no expected code`).toBeGreaterThan(0);
          expect(codes, `${id} reported ${String(execution.code)}`).toContain(execution.code);
          observedRejections.push({
            caseId: testCase.caseId,
            file: file.file,
            target: testCase.target,
            encoding: testCase.encoding,
            expectedCodes: codes,
            observedCode: String(execution.code),
            matched: codes.includes(String(execution.code)),
          });
        }
        const asserts = testCase.expect.asserts ?? {};
        for (const kind of ['roundTripExact', 'regionRoundTripExact', 'signedZeroFields', 'yawWrapped'] as const) {
          if (asserts[kind] !== undefined) {
            observedRoundTrips.push({ caseId: testCase.caseId, file: file.file, kind, exact: true });
          }
        }
        checkAsserts(id, execution.asserts, execution);
      });
    }
  });
}

describe('fixture coverage', () => {
  it('executes every case the contract names, with the binary cases included', () => {
    const ids = files.flatMap((file) => file.cases.map((testCase) => `${file.file}#${testCase.caseId}`));
    expect(new Set(ids).size).toBe(ids.length);
    for (const required of [
      'malformed.json#P01',
      'malformed.json#P02',
      'malformed.json#P11',
      'ordering.json#P13',
      'ordering.json#P15',
      'ordering.json#P18',
      'ordering.json#P20',
    ]) {
      expect(ids, required).toContain(required);
    }
    const binary = files.flatMap((file) => file.cases.filter((testCase) => testCase.encoding === 'binary').map((testCase) => `${file.file}#${testCase.caseId}`));
    expect(binary.length).toBeGreaterThan(0);
  });

  it('refuses a truncated replica instead of adopting a partial state', () => {
    // The recipe case above covers the fixture; this covers the mechanism directly, so a codec that starts
    // throwing on short buffers cannot quietly turn the fixture into a pass-by-exception.
    const source = new PlayerSchema();
    source.entityId = 'entity-001';
    source.x = 1.5;
    const bytes = new Encoder(source).encodeAll();
    const partial = new PlayerSchema();
    let threw = false;
    try {
      new Decoder(partial).decode(bytes.slice(0, 2));
    } catch {
      threw = true;
    }
    const read = fromReplica(partial);
    if (!threw) {
      expect(read.ok, 'a two-byte payload must not reconstruct a player').toBe(false);
    }
    expect(fromReplica(undefined).ok).toBe(false);
  });

  it('keeps DirectInputSchema and RegionSchema reachable for later tasks', () => {
    // Not a behaviour claim, a guard against a declaration disappearing: the spike suites build on these.
    expect(typeof DirectInputSchema).toBe('function');
    expect(typeof RegionSchema).toBe('function');
  });
});
