/**
 * Fixture-layout checker (UDG-002).
 *
 * docs/validation/fixtures.md describes fixtures as directories with manifests. The protocol case set
 * that the same document makes mandatory is instead three standalone JSON files, because a case there is
 * a data record rather than a miniature workspace. Supporting both layouts is only safe if the checker
 * fails closed on a layout it does not understand: a fixture that is silently skipped turns "all fixtures
 * pass" into a claim about a subset nobody named.
 *
 * These tests exercise the checker through its command line, because that is the thing CI runs.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');

const json = <T>(relativePath: string): T => JSON.parse(readFileSync(join(ROOT, relativePath), 'utf8')) as T;
const DIST = join(ROOT, 'tools', 'checks', 'dist');

const tempDirs: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'udg-fixture-layout-'));
  tempDirs.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const checker = (fixturesRoot: string, extra: readonly string[] = []) =>
  spawnSync(process.execPath, [join(DIST, 'fixtures.js'), '--root', fixturesRoot, ...extra], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 300_000,
  });

const output = (result: { stdout: string; stderr: string }): string => `${result.stdout}${result.stderr}`;

/** The first case of a fixture document, with the access guarded rather than assumed. */
const firstCase = (document: Record<string, unknown>): Record<string, unknown> => {
  const cases = document['cases'];
  if (!Array.isArray(cases) || cases.length === 0 || !isRecord(cases[0])) throw new Error('the fixture must carry at least one case');
  return cases[0] as Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A copy of the real fixture tree, so each case breaks exactly one thing. */
const copyFixtures = (): string => {
  const target = join(scratch(), 'fixtures');
  cpSync(join(ROOT, 'tests', 'fixtures'), target, { recursive: true });
  return target;
};

const editJson = (absolutePath: string, mutate: (document: Record<string, unknown>) => void): void => {
  const document = JSON.parse(readFileSync(absolutePath, 'utf8')) as Record<string, unknown>;
  mutate(document);
  writeFileSync(absolutePath, `${JSON.stringify(document, null, 2)}\n`);
};

describe('fixture discovery', () => {
  it('discovers both layouts and reports the protocol fixtures by id', () => {
    const result = checker('tests/fixtures');
    expect(result.status, output(result)).toBe(0);
    for (const id of ['UDG-002-protocol-valid', 'UDG-002-protocol-malformed', 'UDG-002-protocol-ordering']) {
      expect(result.stdout, id).toContain(id);
    }
    // The boundary fixtures are manifest directories; they must not be displaced by the new layout.
    expect(result.stdout).toContain('UDG-001-boundaries-allowed');
    expect(result.stdout).toContain('fixture validation OK');
    const total = Number(/fixture validation OK: (\d+) fixture\(s\)/.exec(result.stdout)?.[1] ?? '0');
    expect(total).toBeGreaterThan(10);
  });

  it('refuses a directory that is neither a manifest fixture nor a standalone fixture', () => {
    const fixtures = copyFixtures();
    mkdirSync(join(fixtures, 'protocol', 'notes'), { recursive: true });
    writeFileSync(join(fixtures, 'protocol', 'notes', 'readme.md'), 'a directory nobody recognised\n');

    const result = checker(fixtures);
    expect(result.status, output(result)).toBe(1);
    expect(output(result)).toContain('FIXTURE-LAYOUT-UNKNOWN');
    expect(output(result)).toContain('protocol/notes');
  });

  it('refuses a stray JSON file at the fixture root', () => {
    const fixtures = copyFixtures();
    writeFileSync(join(fixtures, 'left-over.json'), '{}\n');
    const result = checker(fixtures);
    expect(result.status).toBe(1);
    expect(output(result)).toContain('FIXTURE-LAYOUT-UNKNOWN');
    expect(output(result)).toContain('left-over.json');
  });

  it('refuses an empty fixture set rather than reporting success over nothing', () => {
    const fixtures = join(scratch(), 'empty-fixtures');
    mkdirSync(join(fixtures, 'protocol'), { recursive: true });
    const result = checker(fixtures);
    expect(result.status).toBe(1);
    expect(output(result)).toContain('FIXTURE-CATALOG-MISSING');
  });
});

describe('fixture catalog', () => {
  it('requires every fixture to be declared', () => {
    const fixtures = copyFixtures();
    writeFileSync(
      join(fixtures, 'protocol', 'extra.json'),
      readFileSync(join(fixtures, 'protocol', 'ordering.json'), 'utf8'),
    );
    const result = checker(fixtures);
    expect(result.status).toBe(1);
    expect(output(result)).toContain('FIXTURE-CATALOG-INCOMPLETE');
    expect(output(result)).toContain('protocol/extra.json');
  });

  it('fails when a required case id disappears from a fixture', () => {
    const fixtures = copyFixtures();
    const target = join(fixtures, 'protocol', 'malformed.json');
    editJson(target, (document) => {
      const cases = document['cases'] as { caseId: string }[];
      document['cases'] = cases.filter((entry) => entry.caseId !== 'P01');
    });

    const result = checker(fixtures);
    expect(result.status).toBe(1);
    expect(output(result)).toContain('is missing required case P01');
  });

  it('detects a file edit that the catalog hash does not cover', () => {
    const fixtures = copyFixtures();
    const target = join(fixtures, 'protocol', 'ordering.json');
    const before = readFileSync(target, 'utf8');
    // Edit the note of one case rather than its expectations, so the only signal is the pinned hash.
    editJson(target, (document) => {
      const first = firstCase(document);
      first['note'] = `${String(first['note'])} (tampered)`;
    });
    expect(readFileSync(target, 'utf8')).not.toBe(before);

    const result = checker(fixtures);
    expect(result.status).toBe(1);
    expect(output(result)).toContain('FIXTURE-CATALOG-HASH');
  });

  it('re-pins intentionally after an edit, so --write records rather than smuggles', () => {
    const fixtures = copyFixtures();
    const target = join(fixtures, 'protocol', 'valid.json');
    editJson(target, (document) => {
      const first = firstCase(document);
      first['note'] = `${String(first['note'])} (edited on purpose)`;
    });
    expect(checker(fixtures).status).toBe(1);

    const written = checker(fixtures, ['--write']);
    expect(written.status, output(written)).toBe(0);
    expect(output(written)).toContain('re-pinned');

    const after = checker(fixtures);
    expect(after.status, output(after)).toBe(0);
    expect(readFileSync(target, 'utf8')).toContain('edited on purpose');
  });
});

describe('standalone fixture envelope', () => {
  /**
   * Break one envelope field and report what the checker said.
   *
   * The run is deliberately not re-pinned first: every edit here also invalidates the pinned digest, and
   * that complaint is asserted separately below. Each assertion therefore names the exact structural
   * phrase it needs, rather than a word that the hash message might happen to contain.
   */
  const breakEnvelope = (mutate: (document: Record<string, unknown>) => void): { status: number | null; text: string } => {
    const fixtures = copyFixtures();
    editJson(targetOf(fixtures), mutate);
    const result = checker(fixtures);
    return { status: result.status, text: output(result) };
  };

  const targetOf = (fixtures: string): string => join(fixtures, 'protocol', 'malformed.json');

  it('requires the fields that make a fixture attributable', () => {
    for (const field of ['fixtureVersion', 'fixtureId', 'ownerTask', 'protocolVersion', 'configHash', 'boundsProvenance', 'note']) {
      const broken = breakEnvelope((document) => {
        delete document[field];
      });
      expect(broken.status, field).toBe(1);
      // The exact phrase, not just the field name: the stale-hash message mentions configHash too, and a
      // test that passed on that would not notice the required-field check disappearing.
      expect(broken.text, field).toContain(`${field} must be a non-empty string`);
    }
  });

  it('requires seed to be declared even when it is null', () => {
    const broken = breakEnvelope((document) => {
      delete document['seed'];
    });
    expect(broken.status).toBe(1);
    expect(broken.text).toContain('seed must be present');
  });

  it('refuses an unknown kind and a fixture id that does not name its owner', () => {
    const wrongKind = breakEnvelope((document) => {
      document['kind'] = 'protocol-just-vibes';
    });
    expect(wrongKind.status).toBe(1);
    expect(wrongKind.text).toContain('protocol-just-vibes');

    const wrongId = breakEnvelope((document) => {
      document['fixtureId'] = 'somebody-elses-fixture';
    });
    expect(wrongId.status).toBe(1);
    expect(wrongId.text).toContain('must start with ownerTask');
  });

  it('refuses a fixture that pins a stale configuration or protocol version', () => {
    const stale = breakEnvelope((document) => {
      document['configHash'] = 'f'.repeat(64);
    });
    expect(stale.status).toBe(1);
    expect(stale.text).toContain('does not match the current configuration');

    const wrongVersion = breakEnvelope((document) => {
      document['protocolVersion'] = 'udg-m0-9.9.9';
    });
    expect(wrongVersion.status).toBe(1);
    expect(wrongVersion.text).toContain('does not match the built protocol');
  });

  it('refuses invented bounds provenance, because a synthetic extent must say it is synthetic', () => {
    const broken = breakEnvelope((document) => {
      document['boundsProvenance'] = 'definitely-real';
    });
    expect(broken.status).toBe(1);
    expect(broken.text).toContain('boundsProvenance');
    expect(broken.text).toContain('test-only-synthetic');
  });

  it('refuses an empty case list', () => {
    const broken = breakEnvelope((document) => {
      document['cases'] = [];
    });
    expect(broken.status).toBe(1);
    expect(broken.text).toContain('cases must be a non-empty array');
  });

  it('refuses a case whose expected code is outside the rejection vocabulary', () => {
    const broken = breakEnvelope((document) => {
      const cases = document['cases'] as { expect: { errorCodes?: string[] } }[];
      const negative = cases.find((entry) => entry.expect.errorCodes !== undefined);
      if (negative === undefined) throw new Error('the fixture must carry at least one rejecting case');
      negative.expect.errorCodes = ['NOT_A_REAL_CODE'];
    });
    expect(broken.status).toBe(1);
    expect(broken.text).toContain('not in the declared rejection vocabulary');
  });

  it('refuses a duplicated case id and a case id that is not a documented shape', () => {
    const duplicated = breakEnvelope((document) => {
      const cases = document['cases'] as Record<string, unknown>[];
      const first = cases[0];
      const second = cases[1];
      if (first === undefined || second === undefined) throw new Error('the fixture must carry at least two cases');
      second['caseId'] = String(first['caseId']);
    });
    expect(duplicated.status).toBe(1);
    expect(duplicated.text).toContain('duplicate caseId');

    const misshapen = breakEnvelope((document) => {
      const first = firstCase(document);
      first['caseId'] = 'first-case';
    });
    expect(misshapen.status).toBe(1);
    expect(misshapen.text).toContain('caseId must look like');
  });

  it('refuses a case that targets something the fixtures cannot call', () => {
    const broken = breakEnvelope((document) => {
      const cases = document['cases'] as { target: string }[];
      cases[0] = { ...cases[0], target: 'validateAnythingAtAll' };
    });
    expect(broken.status).toBe(1);
    expect(broken.text).toContain('target must be one of');
  });

  it('requires at least one binary case in the protocol group', () => {
    const fixtures = copyFixtures();
    // Removing binary cases from every protocol file at once is the only way to reach the state where
    // the group as a whole stops exercising the codec.
    for (const file of ['valid.json', 'malformed.json', 'ordering.json']) {
      const target = join(fixtures, 'protocol', file);
      editJson(target, (document) => {
        const cases = document['cases'] as { encoding: string }[];
        document['cases'] = cases.filter((entry) => entry.encoding !== 'binary');
      });
    }
    const result = checker(fixtures);
    expect(result.status, output(result)).toBe(1);
    expect(output(result)).toContain('must contain at least one binary-encoded case');
  });

  it('refuses a tagged non-finite value on a case that expects acceptance', () => {
    // JSON has no NaN literal, so the fixture convention is a tagged value. It is only legitimate on a
    // case that must be refused: a positive case built on NaN would be asserting that a non-finite value
    // is acceptable somewhere.
    const fixtures = copyFixtures();
    const target = join(fixtures, 'protocol', 'valid.json');
    editJson(target, (document) => {
      const first = firstCase(document);
      first['input'] = { ...(first['input'] as Record<string, unknown>), moveX: { number: 'NaN' } };
    });
    const result = checker(fixtures);
    expect(result.status, output(result)).toBe(1);
    expect(output(result)).toContain('tagged values belong to negative cases only');
  });
});

describe('catalog consistency with the documented case set', () => {
  it('declares every P01 to P20 id that docs/validation/fixtures.md 7.2 makes mandatory', () => {
    const catalog = json<{ fixtures: { path: string; requiredCaseIds?: string[]; sha256?: string; layout: string }[] }>(
      'tests/fixtures/catalog.json',
    );
    const protocol = catalog.fixtures.filter((entry) => entry.path.startsWith('protocol/'));
    expect(protocol.map((entry) => entry.path).sort()).toEqual(['protocol/malformed.json', 'protocol/ordering.json', 'protocol/valid.json']);

    const required = new Set(protocol.flatMap((entry) => entry.requiredCaseIds ?? []));
    for (let index = 1; index <= 20; index += 1) {
      const id = `P${String(index).padStart(2, '0')}`;
      expect(required.has(id), `${id} must be declared as a required case`).toBe(true);
    }
    // A standalone fixture without a pinned hash could be edited without trace, so every one of them
    // carries a digest in the catalog.
    for (const entry of protocol) {
      expect(entry.sha256 ?? '', entry.path).toMatch(/^[0-9a-f]{64}$/);
    }
    // The catalog's own hashes must match the bytes on disk, which is the same rule the checker enforces.
    for (const entry of catalog.fixtures.filter((fixture) => fixture.layout === 'standalone-json')) {
      const bytes = readFileSync(join(ROOT, 'tests', 'fixtures', entry.path));
      const digest = createHash('sha256').update(bytes).digest('hex');
      expect(digest, `${entry.path} differs from the digest the catalog pins`).toBe(entry.sha256);
    }
  });
});
