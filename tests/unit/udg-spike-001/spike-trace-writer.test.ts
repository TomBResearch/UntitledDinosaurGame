/**
 * UDG-SPIKE-001 — trace-writer semantics: JSONL continuity, canonical serialization, explicit
 * close, backpressure return, and the two evidence rules the Gate A traces lean on — a missing
 * sample FAILS (gaps are re-derived on read), zero values survive the round trip.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { canonicalJson, createTraceWriter, readTrace } from '../../../tools/load-test/src/trace-writer.ts';
import { summarizeCorrections } from '../../../tools/load-test/src/statistics.ts';

const tempPath = (name: string): string => join(mkdtempSync(join(tmpdir(), 'udg-trace-')), name);

describe('UDG-SPIKE-001 trace writer', () => {
  it('writes deterministic key-ordered JSONL with stamped sequence numbers, and the reader re-derives continuity', async () => {
    const path = tempPath('matched-ack-trace.jsonl');
    const writer = createTraceWriter(path);
    for (let i = 0; i < 25; i += 1) {
      // Keys inserted out of order on purpose: the file must be canonical regardless.
      writer.append({ magnitudeMetres: i * 0.001, ackTo: i + 1, ackFrom: i, runLabel: 'unit' });
    }
    const summary = await writer.close();
    expect(summary.records).toBe(25);
    const read = readTrace(path);
    expect(read.gaps).toEqual([]);
    expect(read.outOfOrder).toBe(false);
    expect(read.duplicateSeqs).toEqual([]);
    expect(read.records[0]).toEqual({ ackFrom: 0, ackTo: 1, magnitudeMetres: 0, runLabel: 'unit', seq: 1 });
    // Close is idempotent-safe and returns the same summary.
    expect(await writer.close()).toEqual(summary);
  });

  it('zero values survive the round trip and land in the retained population (zeros are evidence)', async () => {
    const path = tempPath('zero-retention.jsonl');
    const writer = createTraceWriter(path);
    const rows = Array.from({ length: 120 }, (_, i) => ({ magnitudeMetres: i % 3 === 0 ? 0 : 0.02 }));
    for (const row of rows) writer.append(row);
    await writer.close();
    const read = readTrace(path);
    expect(read.gaps).toEqual([]);
    const magnitudes = read.records.map((r) => r['magnitudeMetres'] as number);
    const summary = summarizeCorrections(magnitudes.map((m) => ({ magnitudeMetres: m })), read.records.length);
    expect(summary.ok).toBe(true);
    expect(summary.zeroValues).toBe(40);
    expect(summary.percentiles?.n).toBe(120);
  });

  it('a lost record FAILS the trace: the reader reports the gap rather than the writer hiding it', async () => {
    const { readFileSync, writeFileSync } = await import('node:fs');
    const path = tempPath('gapped.jsonl');
    const writer = createTraceWriter(path);
    for (let i = 0; i < 6; i += 1) writer.append({ value: i });
    await writer.close();
    // Simulate the lost sample the way reality does it: a line that never made it to disk.
    const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.length > 0);
    lines.splice(2, 1); // seq 3 vanishes
    writeFileSync(path, `${lines.join('\n')}\n`);
    const read = readTrace(path);
    expect(read.gaps).toEqual([3]);
    expect(read.records.length).toBe(5);
    // And summarizeCorrections would fail this population as missing-samples against 6 opportunities.
    const magnitudes = read.records.map((r) => r['value'] as number);
    expect(summarizeCorrections(magnitudes.map((m) => ({ magnitudeMetres: m })), 6).failures).toContain('missing-samples');
  });

  it('refuses to serialize non-JSON-safe junk: NaN throws, undefined fields drop loudly at the boundary', () => {
    expect(() => canonicalJson({ v: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson({ v: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
    expect(() => canonicalJson({ v: undefined })).not.toThrow(); // object fields with undefined are dropped, not coerced to null
    expect(canonicalJson({ v: undefined })).toBe('{}');
    expect(canonicalJson({ b: 1, a: [{ z: 1, y: undefined }, 2] })).toBe('{"a":[{"z":1},2],"b":1}');
    expect(() => canonicalJson({ v: [undefined] })).toThrow(/undefined/); // inside an array there is nowhere to hide: throw
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]'); // arrays keep position — order IS the data
  });

  it('append after close throws — a record arriving after the run closed is the missing-sample bug class', async () => {
    const path = tempPath('closed.jsonl');
    const writer = createTraceWriter(path);
    writer.append({ a: 1 });
    await writer.close();
    expect(() => writer.append({ a: 2 })).toThrow(/after close/);
  });

  it('append returns a backpressure signal but never drops: everything drains to the file', async () => {
    const path = tempPath('pressure.jsonl');
    const writer = createTraceWriter(path);
    let sawBackpressure = false;
    const big = 'x'.repeat(64 * 1024);
    for (let i = 0; i < 400; i += 1) {
      if (writer.append({ i, pad: big }) === false) sawBackpressure = true;
      if (sawBackpressure) await writer.drain();
    }
    const summary = await writer.close();
    expect(sawBackpressure, 'a 400x64 KiB burst must exercise the drain path').toBe(true);
    const read = readTrace(path);
    expect(read.records.length).toBe(summary.records);
    expect(read.gaps).toEqual([]);
  }, 30_000);
});
