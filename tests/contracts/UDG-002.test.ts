/**
 * UDG-002 contract suite (Protocol and validation).
 *
 * Every assertion maps to an acceptance line in docs/contracts/UDG-002.md. The unit suites under
 * tests/unit/udg-002/ prove the behaviour field by field; this suite proves that what was proved is
 * the contract: the owned files exist, the documented entry points are the ones a consumer resolves,
 * the replica field map in docs/contracts/protocol-v1.md is the declaration that ships, the fixture
 * ids the contract names actually run, and the rejections stay inside the documented vocabulary.
 *
 * Claims about the *packaged* surface (entry points, "the domain path imports no schema runtime") are
 * checked against the built output, because that is what a consumer actually loads.
 *
 * Evidence: when capture sets UDG_EVIDENCE_OUT and names this task in UDG_EVIDENCE_TASK, the suite
 * writes the artefacts the contract names — protocol-field-map.json, roundtrip-results.json,
 * config-hashes.json, live-rejection-probes.json (rejection-results.json comes from the fixture suite)
 * — each declaring schemaVersion and taskId, because an artefact that cannot say which run it belongs
 * to is not evidence. Measured thresholds go to UDG_EVIDENCE_MEASUREMENTS, and only when this task
 * owns the run.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { CONTRACT_TASK_IDS } from '@udg/checks';

import {
  DEFAULT_SERVER_CONFIG,
  PROTOCOL_LIMITS,
  PROVISIONAL_P07_FIELDS,
  computeConfigHash,
  movementHash,
  regionHash,
  validateServerConfig,
  withConfigOverrides,
} from '../../packages/config/dist/index.js';
import {
  MAX_GENERATION_FORWARD_GAP,
  MAX_IDENTIFIER_LENGTH,
  PROTOCOL_VERSION,
  REJECTION_CODES,
  REPLICA_WIDTHS,
  YAW_RANGE,
  directInputOf,
  neutralDirectFrame,
  validateDirectFrame,
  validateMoveTo,
} from '../../packages/protocol/dist/index.js';
import {
  DIRECT_INPUT_FIELDS,
  Decoder,
  DirectInputSchema,
  Encoder,
  PLAYER_FIELDS,
  PlayerSchema,
  REGION_FIELDS,
  RegionSchema,
} from '../../packages/protocol/dist/schema/index.js';
import type { MovementMode, PlayerSimulationState, RegionReplicaState } from '../../packages/protocol/dist/domain/index.js';
import {
  fromRegionReplica,
  fromReplica,
  readPlayerMap,
  toRegionReplica,
  toReplica,
  type MappingResult,
} from '../../packages/protocol/dist/mapping/index.js';

const ROOT = resolve(import.meta.dirname, '../..');
const PROTOCOL_SRC = join(ROOT, 'packages', 'protocol', 'src');
const PROTOCOL_DIST = join(ROOT, 'packages', 'protocol', 'dist');
const TASK = 'UDG-002';
const EVIDENCE_DIR = process.env['UDG_EVIDENCE_OUT'];
const MEASUREMENTS = process.env['UDG_EVIDENCE_MEASUREMENTS'];
/** Capture names the task whose bundle is being built; artefacts and measurements are only for it. */
const EVIDENCE_TASK = process.env['UDG_EVIDENCE_TASK'];

/**
 * Environment for a suite this suite invokes as a child.
 *
 * A child must not inherit an evidence destination. This suite runs the UDG-001 suite as a regression
 * check, and when that child inherited the measurements path it dutifully wrote UDG-001's measured
 * values into UDG-002's measurements file — bytes that were internally consistent, hashed, and
 * belonged to the wrong task. Verification now refuses that by identity, and stripping the environment
 * here stops it from being written in the first place.
 */
const childEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => {
  const inherited = { ...process.env, ...extra };
  for (const key of ['UDG_EVIDENCE_MEASUREMENTS', 'UDG_EVIDENCE_JUNIT', 'UDG_EVIDENCE_OUT', 'UDG_EVIDENCE_TASK']) {
    if (extra[key] === undefined) delete inherited[key];
  }
  return inherited;
};

const measured: Record<string, unknown> = { taskId: TASK, schemaVersion: 1 };

const record = (path: string, value: unknown): void => {
  const [head, ...rest] = path.split('.');
  if (head === undefined) return;
  if (rest.length === 0) {
    measured[head] = value;
    return;
  }
  const bucket = (measured[head] ??= {}) as Record<string, unknown>;
  let cursor = bucket;
  for (const key of rest.slice(0, -1)) cursor = (cursor[key] ??= {}) as Record<string, unknown>;
  cursor[rest[rest.length - 1] as string] = value;
};

const json = <T>(relativePath: string): T => JSON.parse(readFileSync(join(ROOT, relativePath), 'utf8')) as T;

/**
 * Remove SGR escape sequences from a child's output.
 *
 * GitHub Actions sets FORCE_COLOR, so a nested vitest writes a coloured summary — the counts are
 * wrapped in their own colour codes, which splits the very text a summary parser looks for. The first
 * UDG-002 run on a hosted runner read "0 tests executed" out of a run that had just passed 203. Plain
 * text is what a parser must parse, so colour is removed before any count is read.
 */
// The escape is constructed rather than written into a regex literal: the repository's lint config
// bans control characters in patterns (no-control-regex), which is a reasonable rule for a codebase
// that should not be matching terminal noise anywhere else.
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

const stripAnsi = (text: string): string => text.replace(ANSI_PATTERN, '');

const run = (command: readonly string[], cwd: string = ROOT, timeoutMs = 900_000, env: NodeJS.ProcessEnv = childEnv()) => {
  const [file, ...args] = command;
  if (file === undefined) throw new Error('empty command');
  return spawnSync(file, args, { cwd, encoding: 'utf8', timeout: timeoutMs, env });
};

const writeJson = (absolutePath: string, value: unknown): void => {
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
};

/** This suite's artefacts, or nowhere: outside capture there is no destination to write to. */
const evidenceDirectory = (): string | undefined =>
  EVIDENCE_DIR === undefined || EVIDENCE_TASK !== TASK ? undefined : resolve(ROOT, EVIDENCE_DIR);

const writeEvidence = (name: string, body: Record<string, unknown>): void => {
  const directory = evidenceDirectory();
  if (directory === undefined) return;
  writeJson(join(directory, name), { schemaVersion: 1, taskId: TASK, ...body });
};

afterAll(() => {
  if (MEASUREMENTS === undefined || MEASUREMENTS.length === 0) return;
  // Ownership, not luck: the measurements file is the artefact the gate reads, so it is written only
  // for the task that owns the run.
  if (EVIDENCE_TASK !== TASK) return;
  writeJson(resolve(ROOT, MEASUREMENTS), measured);
});

// ---------------------------------------------------------------------------
// Owned files
// ---------------------------------------------------------------------------

const OWNED_FILES = [
  'packages/protocol/src/domain/primitives.ts',
  'packages/protocol/src/domain/state.ts',
  'packages/protocol/src/domain/movement.ts',
  'packages/protocol/src/domain/commands.ts',
  'packages/protocol/src/domain/physics.ts',
  'packages/protocol/src/domain/navigation.ts',
  'packages/protocol/src/domain/wire.ts',
  'packages/protocol/src/schema/DirectInputSchema.ts',
  'packages/protocol/src/schema/PlayerSchema.ts',
  'packages/protocol/src/schema/RegionSchema.ts',
  'packages/protocol/src/validation/direct.ts',
  'packages/protocol/src/validation/commands.ts',
  'packages/protocol/src/validation/join.ts',
  'packages/protocol/src/validation/common.ts',
  'packages/protocol/src/mapping/to-replica.ts',
  'packages/protocol/src/mapping/from-replica.ts',
  'packages/protocol/src/version.ts',
  'packages/protocol/src/index.ts',
  'packages/config/src/movement.ts',
  'packages/config/src/network.ts',
  'packages/config/src/limits.ts',
  'packages/config/src/region.ts',
  'packages/config/src/index.ts',
  'tests/contracts/UDG-002.test.ts',
  'tests/fixtures/protocol/valid.json',
  'tests/fixtures/protocol/malformed.json',
  'tests/fixtures/protocol/ordering.json',
  'docs/contracts/protocol-v1.md',
];

describe('owned files', () => {
  it('creates every file the contract names', () => {
    const missing = OWNED_FILES.filter((relativePath) => !existsSync(join(ROOT, relativePath)));
    expect(missing, 'contract owned files must all exist').toEqual([]);
    record('files.owned', OWNED_FILES.length);
  });

  it('documents the edition, the entry map and the encoding table', () => {
    const document = readFileSync(join(ROOT, 'docs/contracts/protocol-v1.md'), 'utf8');
    for (const requirement of [
      'udg-m0-1.0.0',
      'entry-map:begin',
      'entry-map:end',
      'Enum encoding',
      'Route sentinel',
      'Normalisation order',
      'Codec facts',
      'Configuration canonicalisation',
      'PROTOCOL_MISMATCH',
      'REQUEST_ID_CONFLICT',
      'verticalVelocity',
      '@colyseus/schema@5.0.45',
    ]) {
      expect(document, `protocol-v1.md must cover "${requirement}"`).toContain(requirement);
    }
    record('docs.protocolV1.sections', true);
  });
});

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

interface Manifest {
  exports: Record<string, { types?: string; default?: string } | string>;
}

/**
 * The entry map in protocol-v1.md is the authority. A package may not export a subpath the table does
 * not declare, and the table may not promise a subpath the manifest lacks.
 */
const readEntryMap = (): Set<string> => {
  const document = readFileSync(join(ROOT, 'docs/contracts/protocol-v1.md'), 'utf8');
  const block = document.split('<!-- entry-map:begin -->')[1]?.split('<!-- entry-map:end -->')[0];
  if (block === undefined) throw new Error('protocol-v1.md declares no entry map block');
  const entries = new Set<string>();
  for (const line of block.split('\n')) {
    const match = /^\|\s*`(@udg\/[a-z-]+)`\s*\|\s*`([^`]+)`\s*\|/.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    entries.add(match[2] === '.' ? match[1] : `${match[1]}${match[2].replace(/^\./, '')}`);
  }
  if (entries.size < 5) throw new Error(`entry map parsed only ${String(entries.size)} entries; refusing to assert vacuously`);
  return entries;
};

const entryMap = readEntryMap();

describe('package entry points', () => {
  it('declares exactly the subpaths protocol-v1.md documents', () => {
    for (const manifestPath of ['packages/protocol/package.json', 'packages/config/package.json']) {
      const manifest = json<Manifest>(manifestPath);
      const packageDirectory = dirname(manifestPath);
      const packageName = manifestPath.includes('protocol') ? '@udg/protocol' : '@udg/config';
      const declared = Object.keys(manifest.exports).map((subpath) => (subpath === '.' ? packageName : `${packageName}${subpath.replace(/^\./, '')}`));

      const undocumented = declared.filter((entry) => !entryMap.has(entry));
      expect(undocumented, `${manifestPath} exports subpaths absent from protocol-v1.md`).toEqual([]);
      const documented = [...entryMap].filter((entry) => entry === packageName || entry.startsWith(`${packageName}/`));
      const unimplemented = documented.filter((entry) => !declared.includes(entry));
      expect(unimplemented, `${manifestPath} is missing documented subpaths`).toEqual([]);

      for (const [subpath, target] of Object.entries(manifest.exports)) {
        const entry = typeof target === 'string' ? { default: target } : target;
        for (const key of ['types', 'default'] as const) {
          const file = entry[key];
          if (file === undefined) continue;
          const absolute = join(ROOT, packageDirectory, file);
          expect(existsSync(absolute), `${packageName}${subpath === '.' ? '' : subpath} ${key} -> ${file}`).toBe(true);
        }
      }
    }
    record('entry.map.matchesManifests', true);
  });

  it('imports every documented entry point through the package name, as a consumer would', () => {
    // Resolution is proven from a workspace that really depends on @udg/protocol, so the exports map
    // and the workspace link are exercised, not a relative path that would resolve either way.
    const scratch = join(ROOT, 'packages', 'config', `.entry-probe-${process.pid}`);
    mkdirSync(scratch, { recursive: true });
    const probe = join(scratch, 'probe.mjs');
    try {
      writeFileSync(
        probe,
        [
          'const names = {};',
          "for (const specifier of ['@udg/protocol', '@udg/protocol/domain', '@udg/protocol/schema', '@udg/protocol/mapping', '@udg/config']) {",
          '  const module = await import(specifier);',
          '  names[specifier] = Object.keys(module).sort();',
          '}',
          'process.stdout.write(JSON.stringify(names));',
        ].join('\n'),
      );
      const result = run([process.execPath, probe]);
      expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
      const loaded = JSON.parse(result.stdout) as Record<string, string[]>;
      expect(Object.keys(loaded).sort()).toEqual([
        '@udg/config',
        '@udg/protocol',
        '@udg/protocol/domain',
        '@udg/protocol/mapping',
        '@udg/protocol/schema',
      ]);
      for (const required of ['validateDirectFrame', 'validateMoveTo', 'validateCancelPath', 'validateJoin']) {
        expect(loaded['@udg/protocol'], `${required} must be exported from the root entry`).toContain(required);
      }
      expect(loaded['@udg/protocol/domain']).toContain('REJECTION_CODES');
      expect(loaded['@udg/protocol/schema']).toContain('PlayerSchema');
      expect(loaded['@udg/protocol/mapping']).toContain('toReplica');
      expect(loaded['@udg/config']).toContain('computeConfigHash');
      record('entry.importedThroughPackageName', true);
      record('entry.exportCount', Object.values(loaded).reduce((total, list) => total + list.length, 0));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('keeps the schema runtime off the root and domain module graphs, in the built output', () => {
    // "domain entry points import no schema runtime" describes what a consumer loads, so the emitted
    // graph is walked transitively rather than trusting one import line in the source.
    const bareSpecifiers = (entry: string): Set<string> => {
      const seen = new Set<string>();
      const walked = new Set<string>();
      const queue = [join(PROTOCOL_DIST, entry)];
      while (queue.length > 0) {
        const file = queue.pop() as string;
        if (walked.has(file)) continue;
        walked.add(file);
        for (const match of readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) {
          const specifier = match[1] as string;
          if (specifier.startsWith('.')) queue.push(resolve(dirname(file), specifier));
          else seen.add(specifier);
        }
      }
      return seen;
    };

    const graphs: readonly [string, Set<string>][] = [
      ['.', bareSpecifiers('index.js')],
      ['./domain', bareSpecifiers('domain/index.js')],
    ];
    for (const [label, specifiers] of graphs) {
      const leaks = [...specifiers].filter((specifier) => specifier.startsWith('@colyseus'));
      expect(leaks, `@udg/protocol${label} must not reach the schema runtime`).toEqual([]);
    }
    // Not vacuous: the schema entry really does depend on the pinned package.
    expect([...bareSpecifiers('schema/index.js')]).toContain('@colyseus/schema');

    const checker = run(['node', join(ROOT, 'tools', 'checks', 'dist', 'boundaries.js'), '--workspace-root', '.']);
    expect(checker.status, `${checker.stdout}${checker.stderr}`).toBe(0);
    expect(checker.stdout).toContain('0 violations');
    expect(readFileSync(join(ROOT, 'tools', 'checks', 'src', 'boundaries.ts'), 'utf8')).toContain('BOUNDARY-DOMAIN-NO-SCHEMA');
    record('entry.domainImportsNoSchemaRuntime', true);
    record('boundaries.domainImportsSchema', 0);
  });
});

// ---------------------------------------------------------------------------
// Field map and mapping completeness
// ---------------------------------------------------------------------------

// The test builds its states as the domain declares them, not as a locally invented shape. A local
// copy would let the test compile while the contract it checks had drifted.
type PlayerState = PlayerSimulationState;
type Kinematic = PlayerSimulationState['locomotion']['kinematic'];

/** A mode the protocol does not define. The type refuses it; the runtime must refuse it too. */
const unlistedMode = 'sidling' as unknown as MovementMode;

const baseState = (): PlayerState => ({
  entityId: 'entity-001',
  sessionEpoch: 7,
  connected: true,
  locomotion: {
    kinematic: {
      position: { x: 12.25, y: 0.9, z: -3.5 },
      yaw: -2.5,
      velocity: { x: 4, y: -0.4905, z: 0 },
      grounded: true,
      verticalVelocity: -1.2345678901234567,
    },
    mode: 'direct',
    route: null,
    intentGeneration: 42,
    lastAuthorityTick: 1234,
  },
});

const withKinematic = (kinematic: Partial<Kinematic>): PlayerState => {
  const state = baseState();
  return { ...state, locomotion: { ...state.locomotion, kinematic: { ...state.locomotion.kinematic, ...kinematic } } };
};

const withLocomotion = (patch: Partial<PlayerState['locomotion']>): PlayerState => {
  const state = baseState();
  return { ...state, locomotion: { ...state.locomotion, ...patch } };
};

/** The table in protocol-v1.md section 6, parsed rather than restated. */
const documentedFieldMap = (): { index: number; field: string; width: string; path: string }[] => {
  const document = readFileSync(join(ROOT, 'docs/contracts/protocol-v1.md'), 'utf8');
  const section = document.split('## 6. Replica field map')[1]?.split('### 6.1')[0];
  if (section === undefined) throw new Error('protocol-v1.md has no replica field map section');
  const rows = [...section.matchAll(/^\|\s*(\d+)\s*\|\s*`([a-zA-Z]+)`\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/gm)].map((match) => ({
    index: Number(match[1]),
    field: match[2] as string,
    width: match[3] as string,
    path: match[4] as string,
  }));
  if (rows.length < 17) throw new Error(`parsed only ${String(rows.length)} field-map rows; refusing to assert vacuously`);
  return rows;
};

const fieldMap = documentedFieldMap();

const readPath = (root: unknown, dotted: string): unknown =>
  dotted.split('.').reduce<unknown>((cursor, key) => (cursor as Record<string, unknown> | undefined)?.[key], root);

/** A region-level state for the codec probe; the player map is carried separately by design. */
const regionStateForCodecProbe = (): RegionReplicaState => ({
  worldId: 'world-001',
  regionId: 'region-greybox-001',
  serverTick: 987_654_321,
  protocolVersion: PROTOCOL_VERSION,
  configVersion: '3',
  configHash: computeConfigHash(DEFAULT_SERVER_CONFIG),
  manifestHash: 'a'.repeat(64),
});

const decodePlayer = (state: PlayerState): PlayerSchema => {
  const projected = toReplica(state);
  if (!projected.ok) throw new Error(`state must project: ${JSON.stringify(projected.issues)}`);
  const decoded = new PlayerSchema();
  new Decoder(decoded).decode(new Encoder(projected.value).encodeAll());
  return decoded;
};

/**
 * Mapping reports issues field by field, whereas validation reports one rejection code. The evidence
 * artefacts and the probe list speak in codes, so a mapping refusal is translated here rather than at
 * every call site — with the translation stated once, in the one place that could get it wrong.
 */
const refusalOf = (result: MappingResult<unknown>): string => (result.ok ? 'accepted' : 'INVALID_PAYLOAD');

describe('replica field map', () => {
  it('declares the prediction-relevant scalar set and nothing else', () => {
    expect(fieldMap.map((row) => row.field)).toEqual([...PLAYER_FIELDS]);
    for (const row of fieldMap) {
      expect((REPLICA_WIDTHS as Record<string, string>)[row.field], row.field).toBe(row.width);
      // The documented index must be the declaration order, because the codec assigns by order.
      expect(PLAYER_FIELDS.indexOf(row.field as never), row.field).toBe(row.index);
    }
    expect(PLAYER_FIELDS).not.toContain('waypoints');
    expect(PLAYER_FIELDS).not.toContain('sessions');
    expect(REGION_FIELDS).toEqual([
      'worldId',
      'regionId',
      'serverTick',
      'protocolVersion',
      'configVersion',
      'configHash',
      'manifestHash',
      'players',
    ]);
    // Phase 2 (W-2): the wire schema gains the per-frame send sequence; the field-map rows, the
    // widths table and this pin move together with the schema, per §6.1 of the Phase 2 assignment.
    expect(DIRECT_INPUT_FIELDS).toEqual(['sessionEpoch', 'generation', 'directIntent', 'moveX', 'moveZ', 'seq']);
    record('field.map.rows', fieldMap.length);
  });

  it('maps every documented field bidirectionally and preserves the scalars exactly', () => {
    const decoded = decodePlayer(baseState());
    // `in`, not Object.keys: a decoded replica exposes its declared fields through the schema
    // prototype, so an own-keys check would report every field as missing.
    const missing = fieldMap.filter((row) => !(row.field in (decoded as object))).map((row) => row.field);
    expect(missing, 'every documented field must be present on a decoded replica').toEqual([]);

    const read = fromReplica(decoded);
    expect(read.ok, JSON.stringify(read.ok ? {} : read.code)).toBe(true);
    if (!read.ok) throw new Error('unreachable');

    const failures: string[] = [];
    for (const row of fieldMap) {
      const before = readPath(baseState(), row.path);
      const after = readPath(read.value, row.path);
      if (!Object.is(before, after)) failures.push(`${row.field}: ${String(before)} != ${String(after)}`);
    }
    expect(failures, 'a round trip must preserve every scalar bit-for-bit').toEqual([]);

    // verticalVelocity is named in the acceptance list on purpose: it is the scalar a predicted camera
    // consumes, and a receiver cannot derive it from vx/vy/vz.
    expect(Object.is(readPath(read.value, 'locomotion.kinematic.verticalVelocity'), -1.2345678901234567)).toBe(true);
    record('field.map.bidirectional', fieldMap.length);
  });

  it('round trips a route, an idle player and the numeric extremes, each an exact copy', () => {
    const cases: { name: string; state: PlayerState }[] = [
      { name: 'direct motion', state: baseState() },
      {
        name: 'active route at its first waypoint',
        state: withLocomotion({ mode: 'path', route: { revision: 5, nextWaypointIndex: 0 } }),
      },
      { name: 'no route', state: withLocomotion({ mode: 'idle', route: null }) },
      {
        name: 'subnormal and maximum magnitudes',
        state: withKinematic({
          position: { x: 5e-324, y: 0.9, z: Number.MAX_VALUE },
          yaw: -Math.PI,
          velocity: { x: 0, y: -Number.MAX_VALUE, z: 0 },
          grounded: false,
          verticalVelocity: -5e-324,
        }),
      },
    ];

    const results = cases.map((entry) => {
      const read = fromReplica(decodePlayer(entry.state));
      return {
        name: entry.name,
        ok: read.ok,
        exact: read.ok ? JSON.stringify(read.value) === JSON.stringify(entry.state) : false,
      };
    });
    const failed = results.filter((entry) => !entry.ok || !entry.exact);
    expect(failed, `exact round trips required: ${JSON.stringify(failed.map((entry) => entry.name))}`).toEqual([]);
    record('roundtrip.cases', results.length);

    writeEvidence('protocol-field-map.json', {
      protocolVersion: PROTOCOL_VERSION,
      producedBy: 'tests/contracts/UDG-002.test.ts',
      codec: { package: '@colyseus/schema', version: '5.0.45', licence: 'MIT' },
      encodingProvisional: { provisional: true, frozenAt: 'Gate A (UDG-SPIKE-001)', adr: 'docs/adr/0001-replica-precision-policy.md' },
      player: fieldMap,
      region: REGION_FIELDS,
      directInput: DIRECT_INPUT_FIELDS,
      movementModeEncoding: { idle: 0, direct: 1, path: 2 },
      routeSentinel: { absentRevision: 0, absentIndex: 0, activeRouteWithZeroIndex: 'accepted', zeroRevisionWithIndex: 'refused' },
      yawRange: { min: YAW_RANGE.min, max: YAW_RANGE.max, halfOpen: true, positivePiNormalisesTo: -Math.PI },
    });

    const lossless = [
      { label: '0.1 + 0.2', value: 0.1 + 0.2 },
      { label: '-Math.PI', value: -Math.PI },
      { label: 'subnormal minimum', value: 5e-324 },
      { label: 'maximum finite', value: Number.MAX_VALUE },
      { label: 'negative smallest normal', value: -Number.MIN_VALUE },
    ].map((entry) => {
      const replica = new PlayerSchema();
      replica.entityId = 'entity-001';
      replica.sessionEpoch = 7;
      replica.verticalVelocity = entry.value;
      const decoded = new PlayerSchema();
      new Decoder(decoded).decode(new Encoder(replica).encodeAll());
      return { label: entry.label, preserved: Object.is(decoded.verticalVelocity, entry.value) };
    });

    const signedZeroRefused = !toReplica(withKinematic({ position: { x: -0, y: 0.9, z: 0 } })).ok;

    let truncatedRefused = false;
    let truncatedMechanism = 'decode threw';
    try {
      const projected = toReplica(baseState());
      if (projected.ok) {
        const partial = new PlayerSchema();
        new Decoder(partial).decode(new Encoder(projected.value).encodeAll().slice(0, 24));
        truncatedRefused = !fromReplica(partial).ok;
        truncatedMechanism = 'a partial read leaves sessionEpoch at 0, below EPOCH_MIN, so mapping refuses it';
      }
    } catch {
      truncatedRefused = true;
    }
    expect(signedZeroRefused, 'signed zero must be refused before encoding').toBe(true);
    expect(truncatedRefused, 'a truncated payload must never reconstruct a player').toBe(true);

    writeEvidence('roundtrip-results.json', {
      protocolVersion: PROTOCOL_VERSION,
      producedBy: 'tests/contracts/UDG-002.test.ts',
      cases: results,
      losslessFloat64: lossless,
      signedZero: { refusedBeforeEncoding: signedZeroRefused, codecBehaviour: 'float64 decodes -0 as +0' },
      truncatedPayload: { refused: truncatedRefused, mechanism: truncatedMechanism, note: 'transport framing validation belongs to UDG-003 and Gate A' },
    });
  });

  it('refuses a state that mapping cannot represent losslessly', () => {
    const refusals: { label: string; state: PlayerState }[] = [
      { label: 'non-finite position', state: withKinematic({ position: { x: Number.NaN, y: 0.9, z: 0 } }) },
      { label: 'non-finite vertical velocity', state: withKinematic({ verticalVelocity: Number.POSITIVE_INFINITY }) },
      { label: 'signed zero scalar', state: withKinematic({ verticalVelocity: -0 }) },
      { label: 'unlisted movement mode', state: withLocomotion({ mode: unlistedMode }) },
      { label: 'route revision without a route', state: withLocomotion({ route: { revision: 0, nextWaypointIndex: 3 } }) },
      { label: 'epoch zero', state: { ...baseState(), sessionEpoch: 0 } },
      { label: 'identifier above the width', state: { ...baseState(), entityId: 'e'.repeat(MAX_IDENTIFIER_LENGTH + 1) } },
    ];
    const wrong = refusals.filter((entry) => toReplica(entry.state).ok).map((entry) => entry.label);
    expect(wrong, 'these states must be refused before the codec can silently coerce them').toEqual([]);
  });

  it('round trips the region-level fields exactly, then decodes the player map through its own reader', () => {
    const region = {
      worldId: 'world-001',
      regionId: 'region-greybox-001',
      serverTick: 987_654_321,
      protocolVersion: PROTOCOL_VERSION,
      configVersion: '3',
      configHash: computeConfigHash(DEFAULT_SERVER_CONFIG),
      manifestHash: 'a'.repeat(64),
    };
    const projected = toRegionReplica(region satisfies RegionReplicaState);
    expect(projected.ok, JSON.stringify(projected.ok ? {} : projected.issues)).toBe(true);
    if (!projected.ok) throw new Error('unreachable');

    // Player entries live in the region's map but are produced by player mapping, not by the region
    // projection: the protocol keeps one writer for a player's transform, and that writer is server-side
    // player projection.
    const source = projected.value;
    const first = toReplica(baseState());
    const second = toReplica({ ...baseState(), entityId: 'entity-002' });
    expect(first.ok && second.ok, 'the map entries must be valid player replicas').toBe(true);
    if (!first.ok || !second.ok) throw new Error('unreachable');
    source.players.set('entity-001', first.value);
    source.players.set('entity-002', second.value);

    const decoded = new RegionSchema();
    new Decoder(decoded).decode(new Encoder(source).encodeAll());

    const read = fromRegionReplica(decoded);
    expect(read.ok, JSON.stringify(read.ok ? {} : read.code)).toBe(true);
    if (!read.ok) throw new Error('unreachable');
    expect(JSON.stringify(read.value)).toBe(JSON.stringify(region));

    const entries = readPlayerMap(decoded);
    expect(entries.map((entry) => entry.key).sort()).toEqual(['entity-001', 'entity-002']);
    expect(entries.map((entry) => entry.issues)).toEqual([[], []]);
    const expected = [
      fromReplica(decodePlayer(baseState())),
      fromReplica(decodePlayer({ ...baseState(), entityId: 'entity-002' })),
    ].map((result) => (result.ok ? result.value : null));
    expect(JSON.stringify(entries.map((entry) => entry.state))).toBe(JSON.stringify(expected));

    // A map key that disagrees with the entity inside it is reported, never silently re-keyed: a stale
    // entry would otherwise shadow a live player.
    const hostile = new RegionSchema();
    hostile.worldId = region.worldId;
    hostile.regionId = region.regionId;
    hostile.serverTick = region.serverTick;
    hostile.protocolVersion = region.protocolVersion;
    hostile.configVersion = region.configVersion;
    hostile.configHash = region.configHash;
    hostile.manifestHash = region.manifestHash;
    hostile.players.set('entity-999', first.value);
    const mismatched = readPlayerMap(hostile);
    expect(mismatched.length).toBe(1);
    expect(mismatched[0]?.issues.map((entry) => entry.field)).toContain('entityId');
    record('roundtrip.regionExact', true);
    record('roundtrip.playerMapEntries', entries.length);
  });
});

// ---------------------------------------------------------------------------
// Fixtures named by the contract
// ---------------------------------------------------------------------------

interface FixtureCaseDocument {
  caseId: string;
  target: string;
  encoding: string;
  expect: { ok: boolean; errorCodes?: string[] };
}

const fixtureFiles = ['valid.json', 'malformed.json', 'ordering.json'] as const;
const allCases = fixtureFiles
  .flatMap((file) => json<{ cases: FixtureCaseDocument[] }>(`tests/fixtures/protocol/${file}`).cases.map((testCase) => ({ ...testCase, file })));

describe('protocol fixtures', () => {
  it('gives every P-numbered case the contract names an expected outcome', () => {
    const numbered = allCases
      .filter((testCase) => testCase.caseId.startsWith('P'))
      .map((testCase) => Number.parseInt(testCase.caseId.slice(1), 10))
      .sort((left, right) => left - right);
    for (const required of Array.from({ length: 20 }, (_unused, index) => index + 1)) {
      expect(numbered, `P${String(required).padStart(2, '0')} must exist in the protocol fixtures`).toContain(required);
    }

    const negativeWithoutCode = allCases
      .filter((testCase) => !testCase.expect.ok)
      .filter((testCase) => (testCase.expect.errorCodes ?? []).length === 0)
      .map((testCase) => `${testCase.file}#${testCase.caseId}`);
    expect(negativeWithoutCode, 'a negative fixture must declare the code it expects').toEqual([]);

    const unknownCodes = allCases
      .flatMap((testCase) => (testCase.expect.errorCodes ?? []).map((code) => ({ testCase, code })))
      .filter((entry) => !(REJECTION_CODES as readonly string[]).includes(entry.code))
      .map((entry) => `${entry.testCase.file}#${entry.testCase.caseId} -> ${entry.code}`);
    expect(unknownCodes, 'expected codes must come from the closed rejection vocabulary').toEqual([]);
    record('protocol.requiredIds', true);
    record('protocol.cases', allCases.length);
  });

  it('includes malformed binary cases, because a JSON-only fixture set would not test the codec', () => {
    const negativeBinary = allCases.filter((testCase) => testCase.encoding === 'binary' && !testCase.expect.ok);
    expect(negativeBinary.length, 'at least one binary case must be a rejection').toBeGreaterThan(0);
    expect(
      negativeBinary.filter((testCase) => !(testCase.expect.errorCodes ?? []).includes('INVALID_PAYLOAD')).map((testCase) => testCase.caseId),
    ).toEqual([]);
    record('protocol.binaryNegative', negativeBinary.length);
  });

  it('runs the unit suites for real rather than trusting that they exist', () => {
    // tests/unit/udg-002/fixtures.test.ts is what executes the fixture cases. Its evidence destination
    // is forwarded deliberately — it is the producer of rejection-results.json — while every other
    // evidence variable stays stripped.
    const unit = run(['pnpm', 'exec', 'vitest', 'run', 'tests/unit/udg-002', '--reporter=dot'], ROOT, 900_000, childEnv(EVIDENCE_DIR === undefined ? {} : { UDG_EVIDENCE_OUT: EVIDENCE_DIR, UDG_EVIDENCE_TASK: TASK }));
    const output = stripAnsi(`${unit.stdout}${unit.stderr}`);
    expect(unit.status, output).toBe(0);
    // Read the counts the runner reports rather than the absence of a phrase. `not.toMatch(/skipped\s+
    // [1-9]/)` could never match vitest's own "1 skipped" word order, so it proved nothing: a skipped
    // case set would have looked green. An absent count means zero here, which is the reported case.
    const count = (pattern: RegExp): number => Number(pattern.exec(output)?.[1] ?? '0');
    expect(count(/(\d+) failed/), output).toBe(0);
    expect(count(/(\d+) skipped/), output).toBe(0);
    expect(count(/(\d+) error/), output).toBe(0);
    const executed = count(/Tests\s+(\d+) passed/);
    expect(executed).toBeGreaterThan(150);
    record('protocol.executed', executed);
  });
});

// ---------------------------------------------------------------------------
// Validation behaviour named in the acceptance list
// ---------------------------------------------------------------------------

const REGION_TEST_BOUNDS = {
  x: { min: -100, max: 100 },
  y: { min: -10, max: 50 },
  z: { min: -100, max: 100 },
};

const commandContext = { sessionEpoch: 7, bounds: REGION_TEST_BOUNDS };

describe('validation acceptance list', () => {
  it('accepts the ±1 axis corners and normalises the diagonal', () => {
    for (const [moveX, moveZ] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, -1],
    ] as [number, number][]) {
      const result = validateDirectFrame({ sessionEpoch: 7, generation: 3, directIntent: true, moveX, moveZ }, { sessionEpoch: 7 });
      expect(result.ok, `move ${String(moveX)},${String(moveZ)}`).toBe(true);
      if (!result.ok) continue;
      const length = Math.hypot(result.value.moveX, result.value.moveZ);
      expect(Math.abs(length - 1), `move ${String(moveX)},${String(moveZ)} gave length ${String(length)}`).toBeLessThan(1e-12);
    }

    const neutral = validateDirectFrame({ sessionEpoch: 7, generation: 0, directIntent: false, moveX: 0, moveZ: 0 }, { sessionEpoch: 7 });
    expect(neutral.ok).toBe(true);
    expect(directInputOf(neutral.ok ? neutral.value : neutralDirectFrame({ sessionEpoch: 7, generation: 0 }))).toEqual({ moveX: 0, moveZ: 0 });
  });

  it('refuses out-of-range axes, non-finite scalars and unknown or missing keys', () => {
    const refusals: Record<string, Record<string, unknown>> = {
      'axis above 1': { sessionEpoch: 7, generation: 3, directIntent: true, moveX: 1.0000001, moveZ: 0 },
      'axis non-finite': { sessionEpoch: 7, generation: 3, directIntent: true, moveX: Number.NaN, moveZ: 0 },
      'unknown key': { sessionEpoch: 7, generation: 3, directIntent: true, moveX: 0, moveZ: 0, extra: 1 },
      'missing key': { sessionEpoch: 7, generation: 3, directIntent: true, moveX: 0 },
    };
    for (const [label, payload] of Object.entries(refusals)) {
      const result = validateDirectFrame(payload, { sessionEpoch: 7 });
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.code, label).toBe('INVALID_PAYLOAD');
    }
  });

  it('refuses malformed destinations, oversized identifiers and out-of-width integers, each with its documented code', () => {
    // The expected code is stated per case rather than as "any of a set", because a validator that
    // answers OUT_OF_BOUNDS to a malformed identifier has confused a client's error with the server's
    // geometry, and a client would retry a request that can never succeed.
    const cases: [string, Record<string, unknown>, string][] = [
      ['non-finite destination', { requestId: 'req-1', sessionEpoch: 7, generation: 4, x: Number.POSITIVE_INFINITY, y: 0, z: 0 }, 'INVALID_PAYLOAD'],
      ['destination outside bounds', { requestId: 'req-1', sessionEpoch: 7, generation: 4, x: 101, y: 0, z: 0 }, 'OUT_OF_BOUNDS'],
      ['fractional generation', { requestId: 'req-1', sessionEpoch: 7, generation: 4.5, x: 0, y: 0, z: 0 }, 'INVALID_GENERATION'],
      ['negative generation', { requestId: 'req-1', sessionEpoch: 7, generation: -1, x: 0, y: 0, z: 0 }, 'INVALID_GENERATION'],
      ['generation above uint32', { requestId: 'req-1', sessionEpoch: 7, generation: 4_294_967_296, x: 0, y: 0, z: 0 }, 'INVALID_GENERATION'],
      ['unicode request id', { requestId: 're✓q', sessionEpoch: 7, generation: 4, x: 0, y: 0, z: 0 }, 'INVALID_PAYLOAD'],
      ['oversized request id', { requestId: 'r'.repeat(MAX_IDENTIFIER_LENGTH + 1), sessionEpoch: 7, generation: 4, x: 0, y: 0, z: 0 }, 'INVALID_PAYLOAD'],
      ['empty request id', { requestId: '', sessionEpoch: 7, generation: 4, x: 0, y: 0, z: 0 }, 'INVALID_PAYLOAD'],
      ['epoch mismatch', { requestId: 'req-1', sessionEpoch: 6, generation: 4, x: 0, y: 0, z: 0 }, 'EPOCH_MISMATCH'],
    ];
    const wrong: string[] = [];
    for (const [label, payload, expected] of cases) {
      const result = validateMoveTo(payload, commandContext);
      if (result.ok) wrong.push(`${label}: accepted`);
      else if (result.code !== expected) wrong.push(`${label}: ${String(result.code)}, expected ${expected}`);
    }
    expect(wrong).toEqual([]);
  });

  it('does not mutate a validated result when the source fixture is mutated', () => {
    const source: Record<string, unknown> = { requestId: 'req-1', sessionEpoch: 7, generation: 4, x: 1.5, y: 0, z: -2.5 };
    const result = validateMoveTo(source, commandContext);
    expect(result.ok, JSON.stringify(result.ok ? {} : result.code)).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const snapshot = JSON.stringify(result.value);

    source['x'] = 999;
    source['requestId'] = 'tampered';
    expect(JSON.stringify(result.value)).toBe(snapshot);

    // A consumer cannot rewrite a validated request either.
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.stamp)).toBe(true);
    expect(() => {
      (result.value.stamp as { generation: number }).generation = 1;
    }).toThrow(TypeError);
    record('validation.readonlyResults', true);
  });

  it('keeps every rejection inside the closed vocabulary, and never throws', () => {
    const observed: string[] = [];
    const probes: [string, () => { ok: boolean; code?: string }][] = [
      ['null frame', () => validateDirectFrame(null, { sessionEpoch: 7 })],
      ['epoch zero', () => validateDirectFrame({ sessionEpoch: 0, generation: 1, directIntent: false, moveX: 0, moveZ: 0 }, { sessionEpoch: 7 })],
      ['intent at generation zero', () => validateDirectFrame({ sessionEpoch: 7, generation: 0, directIntent: true, moveX: 1, moveZ: 0 }, { sessionEpoch: 7 })],
      ['empty move-to', () => validateMoveTo({}, commandContext)],
      ['epoch mismatch', () => validateMoveTo({ requestId: 'r', sessionEpoch: 6, generation: 1, x: 0, y: 0, z: 0 }, commandContext)],
      ['non-ascii entity', () => ({ ok: false, code: refusalOf(toReplica({ ...baseState(), entityId: '✗' })) })],
      ['missing replica', () => fromReplica(undefined as never)],
    ];
    for (const [label, probe] of probes) {
      let result: { ok: boolean; code?: string };
      try {
        result = probe();
      } catch (error) {
        expect.fail(`${label}: a validation probe threw instead of refusing (${String(error)})`);
      }
      expect(result.ok, label).toBe(false);
      if (!result.ok && result.code !== undefined) observed.push(result.code);
    }
    const outside = observed.filter((code) => !(REJECTION_CODES as readonly string[]).includes(code));
    expect(outside, 'rejections must stay inside the documented vocabulary').toEqual([]);
    expect(observed.length).toBeGreaterThan(0);
    record('validation.codesObserved', [...new Set(observed)].sort());
  });
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

describe('configuration acceptance list', () => {
  it('validates the defaults and reports no issue', () => {
    const result = validateServerConfig(DEFAULT_SERVER_CONFIG);
    expect(result.ok, JSON.stringify(result.ok ? {} : result.issues)).toBe(true);
  });

  it('changes configHash when a single parameter changes', () => {
    const base = computeConfigHash();
    const changes: [string, ReturnType<typeof withConfigOverrides>][] = [
      ['movement.speed', withConfigOverrides(DEFAULT_SERVER_CONFIG, { movement: { speed: 4.5 } })],
      ['network.tickRate', withConfigOverrides(DEFAULT_SERVER_CONFIG, { network: { tickRate: 30, simulationStepSeconds: 1 / 30 } })],
      ['controller.groundSnapDistance', withConfigOverrides(DEFAULT_SERVER_CONFIG, { controller: { groundSnapDistance: 0.2 } })],
      [
        'region.bounds',
        withConfigOverrides(DEFAULT_SERVER_CONFIG, {
          region: { bounds: { x: { min: -10, max: 10 }, y: { min: -1, max: 1 }, z: { min: -10, max: 10 } } },
        }),
      ],
    ];
    const failures: string[] = [];
    for (const [label, config] of changes) {
      const validated = validateServerConfig(config);
      if (!validated.ok) failures.push(`${label}: invalid ${JSON.stringify(validated.issues)}`);
      else if (computeConfigHash(config) === base) failures.push(`${label}: hash unchanged`);
    }
    expect(failures).toEqual([]);

    // A movement-only change must not move the region hash, or the two hashes would carry no
    // information about which half of the configuration a client is missing.
    const movementOnly = withConfigOverrides(DEFAULT_SERVER_CONFIG, { movement: { speed: 5 } });
    expect(movementHash(movementOnly)).not.toBe(movementHash());
    expect(regionHash(movementOnly)).toBe(regionHash());
    record('config.hashSensitive', changes.length);
  });

  it('keeps units consistent across the movement and network blocks', () => {
    const movement = DEFAULT_SERVER_CONFIG.movement;
    const network = DEFAULT_SERVER_CONFIG.network;
    expect(network.simulationStepSeconds).toBe(1 / network.tickRate);
    // v0.2 gives gravity in m/s^2 and the step in seconds, so the per-step velocity change must be a
    // small fraction of the movement speed, not the same magnitude.
    const perStep = Math.abs(movement.gravity) * network.simulationStepSeconds;
    expect(perStep).toBeLessThan(movement.speed);
    expect(movement.capsuleHeight).toBeGreaterThan(2 * movement.capsuleRadius);
    expect(DEFAULT_SERVER_CONFIG.controller.restCentreY).toBeGreaterThan(movement.capsuleHeight / 2);
    // The limits in configuration are the protocol's own numbers, not a second copy that can drift.
    expect(PROTOCOL_LIMITS.maxGenerationForwardGap).toBe(MAX_GENERATION_FORWARD_GAP);
    record('config.unitsConsistent', true);
  });

  it('ships no production region bounds default and records the hashes', () => {
    expect(DEFAULT_SERVER_CONFIG.region.bounds).toBeNull();
    expect(PROVISIONAL_P07_FIELDS.join(' ')).toContain('restCentreY');
    const hashes = {
      config: computeConfigHash(),
      movement: movementHash(),
      region: regionHash(),
    };
    for (const [label, value] of Object.entries(hashes)) expect(value, label).toMatch(/^[0-9a-f]{64}$/);
    record('config.regionDefaults', 0);
    record('config.hashStable', true);

    writeEvidence('config-hashes.json', {
      canonicalisation: {
        encoding: 'UTF-8',
        objectKeys: 'sorted lexicographically',
        arrays: 'order preserved',
        values: 'finite JSON values only',
        negativeZero: 'written as 0',
        digest: 'SHA-256, lowercase hex',
        implementation: 'pure TypeScript in @udg/config, cross-checked against node:crypto by tests/unit/udg-002/config.test.ts',
      },
      hashes,
      provisionalFields: PROVISIONAL_P07_FIELDS,
      limitsFromProtocol: PROTOCOL_LIMITS,
      regionBoundsDefault: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Rejection evidence, regression surface and scope
// ---------------------------------------------------------------------------

describe('rejection evidence', () => {
  it('records the negative cases and re-runs a live probe for each surface', () => {
    const fixtureCases = allCases
      .filter((testCase) => !testCase.expect.ok)
      .map((testCase) => ({
        caseId: testCase.caseId,
        file: testCase.file,
        target: testCase.target,
        encoding: testCase.encoding,
        expectedCodes: testCase.expect.errorCodes ?? [],
      }));
    expect(fixtureCases.length).toBeGreaterThan(20);

    const tightBounds = { x: { min: -1, max: 1 }, y: { min: -1, max: 1 }, z: { min: -1, max: 1 } };
    const liveProbes: { label: string; code: string }[] = [];
    const probes: [string, () => { ok: boolean; code?: string }][] = [
      ['direct-frame/unknown-key', () => validateDirectFrame({ sessionEpoch: 7, generation: 1, directIntent: false, moveX: 0, moveZ: 0, junk: 1 }, { sessionEpoch: 7 })],
      ['move-to/out-of-bounds', () => validateMoveTo({ requestId: 'req-1', sessionEpoch: 7, generation: 2, x: 1e6, y: 0, z: 0 }, { sessionEpoch: 7, bounds: tightBounds })],
      ['to-replica/non-finite', () => ({ ok: false, code: refusalOf(toReplica(withKinematic({ position: { x: Number.NaN, y: 0, z: 0 } }))) })],
      ['from-replica/missing', () => fromReplica(undefined as never)],
    ];
    for (const [label, probe] of probes) {
      const result = probe();
      expect(result.ok, label).toBe(false);
      if (!result.ok && result.code !== undefined) liveProbes.push({ label, code: result.code });
    }
    expect(liveProbes.length).toBe(probes.length);
    record('validation.noNonFiniteEscape', true);

    // rejection-results.json belongs to the suite that executes every case, because it can report the
    // code each case *actually* returned. This suite records the probes it ran itself, so the two
    // artefacts describe different things and neither duplicates the other.
    writeEvidence('live-rejection-probes.json', {
      protocolVersion: PROTOCOL_VERSION,
      producedBy: 'tests/contracts/UDG-002.test.ts',
      vocabulary: REJECTION_CODES,
      negativeFixtureCases: fixtureCases.length,
      liveProbes,
    });
  });
});

describe('measured thresholds', () => {
  it('records the pinned toolchain and schema dependency the plan thresholds name', () => {
    const pinned = readFileSync(join(ROOT, '.node-version'), 'utf8').trim();
    expect(process.version).toBe(`v${pinned}`);

    const packageManagerField = json<{ packageManager: string }>('package.json').packageManager;
    expect(packageManagerField).toMatch(/^pnpm@/);

    const pnpm = run(['pnpm', '--version']);
    expect(pnpm.status, `${pnpm.stdout}${pnpm.stderr}`).toBe(0);
    const pnpmCli = pnpm.stdout.trim();
    expect(packageManagerField).toContain(`pnpm@${pnpmCli}`);

    const manifest = json<{ dependencies: Record<string, string> }>('packages/protocol/package.json');
    const declared = manifest.dependencies['@colyseus/schema'];
    // An exact specifier, not a range: a drifting codec version would silently change the wire.
    expect(declared, 'the schema dependency must be pinned exactly').toBe('5.0.45');
    // pnpm isolates the store, so the installed copy is read through the workspace that declares it.
    const installedPath = join(ROOT, 'packages', 'protocol', 'node_modules', '@colyseus', 'schema', 'package.json');
    expect(existsSync(installedPath), 'the pinned schema package must be installed for @udg/protocol').toBe(true);
    const installed = JSON.parse(readFileSync(installedPath, 'utf8')) as { name: string; version: string };
    expect(installed.name).toBe('@colyseus/schema');
    expect(installed.version).toBe(declared);

    // The committed register is the published statement of the same fact, so the two cannot drift.
    const register = json<{ packages: { name: string; declared: string; installedVersion: string; licence: string }[] }>(
      'docs/integration/dependencies.json',
    );
    const entry = register.packages.find((pkg) => pkg.name === '@colyseus/schema');
    expect(entry, 'the dependency register must record the schema pin').toBeDefined();
    expect(entry?.declared).toBe('5.0.45');
    expect(entry?.installedVersion).toBe('5.0.45');
    expect(entry?.licence).toBe('MIT');

    record('toolchain.node', process.version);
    record('toolchain.pnpmCli', pnpmCli);
    record('schema.pin', `@colyseus/schema@${declared}`);
  });

  it('round trips each declared schema kind and proves float64 is carried exactly', () => {
    const vectors = [0.1 + 0.2, -Math.PI, 5e-324, Number.MAX_VALUE, -Number.MAX_VALUE, -0];
    const kinds: string[] = [];

    const player = decodePlayer(withKinematic({ position: { x: vectors[0] as number, y: -Math.PI, z: 5e-324 }, velocity: { x: Number.MAX_VALUE, y: 0, z: 0 }, verticalVelocity: -Number.MAX_VALUE }));
    const playerRead = fromReplica(player);
    kinds.push('PlayerSchema');

    const input = new DirectInputSchema();
    input.sessionEpoch = 7;
    input.generation = 4294967294;
    input.directIntent = true;
    input.moveX = vectors[0] as number;
    input.moveZ = -Math.PI;
    const inputDecoded = new DirectInputSchema();
    new Decoder(inputDecoded).decode(new Encoder(input).encodeAll());
    kinds.push('DirectInputSchema');

    const region = toRegionReplica(regionStateForCodecProbe());
    if (!region.ok) throw new Error(`region projection must succeed: ${JSON.stringify(region.issues)}`);
    const regionDecoded = new RegionSchema();
    new Decoder(regionDecoded).decode(new Encoder(region.value).encodeAll());
    kinds.push('RegionSchema');

    // -0 is the documented exception: the codec carries signed zero as +0, and mapping refuses to send
    // it, so the exactness claim covers every other vector.
    const exact =
      playerRead.ok &&
      playerRead.value.locomotion.kinematic.position.x === (0.1 + 0.2) &&
      playerRead.value.locomotion.kinematic.position.y === -Math.PI &&
      playerRead.value.locomotion.kinematic.position.z === 5e-324 &&
      playerRead.value.locomotion.kinematic.velocity.x === Number.MAX_VALUE &&
      playerRead.value.locomotion.kinematic.verticalVelocity === -Number.MAX_VALUE &&
      inputDecoded.moveX === (0.1 + 0.2) &&
      inputDecoded.moveZ === -Math.PI &&
      inputDecoded.generation === 4294967294 &&
      regionDecoded.configVersion === regionStateForCodecProbe().configVersion &&
      regionDecoded.serverTick === 987_654_321 &&
      regionDecoded.protocolVersion === PROTOCOL_VERSION &&
      regionDecoded.manifestHash === 'a'.repeat(64);

    expect(kinds).toEqual(['PlayerSchema', 'DirectInputSchema', 'RegionSchema']);
    expect(exact, 'the pinned codec must carry every float64 vector unchanged').toBe(true);

    record('schema.roundTrips', kinds.length);
    record('schema.roundTripKinds', kinds);
    record('schema.losslessFloat64', true);
  });
});

describe('regression and scope', () => {
  it('keeps the UDG-001 suite green and the committed records in sync', () => {
    const foundation = run(['pnpm', 'test:contract', '--', '--task', 'UDG-001']);
    expect(foundation.status, `${foundation.stdout}${foundation.stderr}`).toBe(0);

    const checksums = run(['pnpm', 'contracts:checksums']);
    expect(checksums.status, `${checksums.stdout}${checksums.stderr}`).toBe(0);
    expect(checksums.stdout).toContain('in sync');

    const dependencies = run(['pnpm', 'dependencies:verify']);
    expect(dependencies.status, `${dependencies.stdout}${dependencies.stderr}`).toBe(0);

    // The stripping rule itself, asserted rather than trusted: an evidence destination is never
    // inherited, and is forwarded only where a named artefact depends on it.
    const stripped = childEnv();
    expect(stripped['UDG_EVIDENCE_MEASUREMENTS']).toBeUndefined();
    expect(stripped['UDG_EVIDENCE_JUNIT']).toBeUndefined();
    expect(stripped['UDG_EVIDENCE_OUT']).toBeUndefined();
    expect(stripped['UDG_EVIDENCE_TASK']).toBeUndefined();
    expect(childEnv({ UDG_EVIDENCE_OUT: '/bundle', UDG_EVIDENCE_TASK: TASK })['UDG_EVIDENCE_TASK']).toBe(TASK);

    expect(CONTRACT_TASK_IDS).toContain('UDG-002');
    record('regression.UDG001', 'green');
  });

  it('separates the contracts-index digest from the task-contract digest in every record', () => {
    /**
     * Review correction: this submission's completion record quoted the contracts-index digest under a
     * "task contract" label. The producer hashes two different files into two different fields, so the
     * labels are now asserted instead of trusted.
     */
    const digest = (relativePath: string): string =>
      createHash('sha256').update(readFileSync(join(ROOT, relativePath))).digest('hex');
    const indexDigest = digest('docs/contracts/README.md');
    const taskDigest = digest(`docs/contracts/${TASK}.md`);
    expect(indexDigest).not.toBe(taskDigest);

    // The producer's field semantics, as the committed summary carries them.
    const summary = json<{ contractHash: string; configHashes: Record<string, string> }>(
      `docs/contracts/assignments/${TASK}-evidence.json`,
    );
    expect(summary.contractHash, 'contractHash is the contracts index').toBe(indexDigest);
    expect(summary.configHashes['taskContract']).toMatch(/^[0-9a-f]{64}$/);
    expect(summary.configHashes['taskContract'], 'taskContract is never the index digest').not.toBe(indexDigest);

    // The prose record, field by field: the digest quoted beside the index label is the index digest,
    // and no digest quoted beside a task-contract label is the index digest.
    const completion = readFileSync(join(ROOT, `docs/contracts/assignments/${TASK}-completion.md`), 'utf8');
    const digestsUnder = (marker: string): string[] => {
      const lines = completion.split('\n');
      const start = lines.findIndex((line) => line.includes(marker));
      expect(start, marker).toBeGreaterThanOrEqual(0);
      return [...lines.slice(start, start + 5).join(' ').matchAll(/\b[0-9a-f]{64}\b/g)].map((match) => match[0] as string);
    };
    expect(digestsUnder('Contracts index')).toContain(indexDigest);
    const taskLine = digestsUnder('configHashes.taskContract');
    expect(taskLine.length).toBeGreaterThan(0);
    expect(taskLine).not.toContain(indexDigest);
  });

  it('builds the libraries before anything asserts against their output', () => {
    // This suite and the unit suites assert against packages/*/dist, because that is what a consumer
    // loads. A fresh checkout has no dist, so on the first GitHub-hosted run of this task `pnpm
    // typecheck` failed with TS2307 for every built-module import while passing on any machine that had
    // built before: the local tree was carrying state the gate did not create. The scripts now produce
    // what they assert against, so the gate order is not a hidden prerequisite of a correct run.
    const manifest = json<{ scripts: Record<string, string> }>('package.json');
    const buildsLibraries = manifest.scripts['build:libraries'] ?? '';
    expect(buildsLibraries, 'the library build must be one named step').toContain('./packages/*');
    // The tokens that actually assert. A script that builds and then runs neither is not a check, so an
    // absent token is a failure rather than an infinite distance that would pass the ordering test.
    const assertionTokens = ['vitest', 'typecheck:root', 'tsc'];
    for (const script of ['typecheck', 'test', 'test:unit']) {
      const body = manifest.scripts[script] ?? '';
      expect(body, `pnpm ${script} must build the libraries it asserts against`).toContain('run build:libraries');
      const positions = assertionTokens
        .map((token) => body.indexOf(token))
        .filter((position) => position >= 0);
      expect(positions.length, `pnpm ${script} must run something that asserts`).toBeGreaterThan(0);
      expect(body.indexOf('run build:libraries'), `pnpm ${script} must build before it asserts`).toBeLessThan(
        Math.min(...positions),
      );
    }
    record('gate.buildsBeforeAsserting', true);
  });

  it('has a populated unit suite per surface the contract lists', () => {
    const directory = join(ROOT, 'tests', 'unit', 'udg-002');
    const files = ['config.test.ts', 'fixtures.test.ts', 'mapping.test.ts', 'schema-roundtrip.test.ts', 'validation.test.ts'];
    expect(files.filter((file) => !existsSync(join(directory, file)))).toEqual([]);
    // A suite with no tests is a placeholder, not coverage.
    for (const file of files) {
      const tests = readFileSync(join(directory, file), 'utf8').split('\n').filter((line) => /^\s*it\(/.test(line)).length;
      expect(tests, file).toBeGreaterThan(3);
    }
    record('unit.suites', files.length);
  });

  it('implements no behaviour owned by a later task', () => {
    // UDG-002 owns declarations, validation and projection. Admission state, watermarks, movement and
    // route computation belong to UDG-003, UDG-005, UDG-006 and UDG-007, so their names may not appear
    // as implemented exports in the two packages this task owns.
    const forbidden = ['advanceWatermark', 'issueResync', 'applyMovement', 'computeRoute', 'createRoom', 'authorizeJoin'];
    const offenders: string[] = [];
    const scan = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        const absolute = join(directory, entry);
        if (statSync(absolute).isDirectory()) {
          scan(absolute);
          continue;
        }
        if (!absolute.endsWith('.ts')) continue;
        const source = readFileSync(absolute, 'utf8');
        for (const symbol of forbidden) {
          if (new RegExp(`export (?:const|function|class) ${symbol}\\b`).test(source)) offenders.push(`${relative(ROOT, absolute)}: ${symbol}`);
        }
      }
    };
    scan(PROTOCOL_SRC);
    scan(join(ROOT, 'packages', 'config', 'src'));
    expect(offenders).toEqual([]);
    record('scope.noLaterTaskBehaviour', true);
  });

  const artefactNames = [
    'protocol-field-map.json',
    'roundtrip-results.json',
    'rejection-results.json',
    'config-hashes.json',
    'live-rejection-probes.json',
  ];
  // Five names, two producers: this suite writes four, the fixture suite writes the rejection set.

  it('writes the evidence artefacts the contract names when capture asks for them', () => {
    // The directory this task owns, which is no directory at all when capture is running for someone
    // else. `pnpm test` inside a UDG-001 capture sets an evidence destination for that bundle, and
    // asserting that UDG-002's artefacts sit in it would be a false failure — while asserting nothing
    // about a destination this task does write to would be a false pass. The capture plan declares
    // these files as required artefacts, and verification refuses a placeholder.
    const directory = evidenceDirectory();
    if (directory === undefined) {
      expect(true).toBe(true);
      return;
    }
    for (const name of artefactNames) {
      const path = join(directory, name);
      expect(existsSync(path), name).toBe(true);
      const body = JSON.parse(readFileSync(path, 'utf8')) as { schemaVersion: number; taskId: string };
      expect(body.taskId, name).toBe(TASK);
      expect(body.schemaVersion, name).toBe(1);
      expect(statSync(path).size, name).toBeGreaterThan(200);
    }
    record('evidence.artefacts', artefactNames.length);
  });
});
