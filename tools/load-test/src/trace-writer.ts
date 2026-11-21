/**
 * UDG-SPIKE-001 — trace writer semantics (assignment §2.2/§2.3; measurement.md §7.4).
 *
 * The Gate A traces (`matched-ack-trace.jsonl`, raw correction rows, proxy stall pairs) are
 * evidence files, so the writer's semantics ARE the evidence semantics, stated here once:
 *
 * - **JSONL, one record per line, deterministic serialization.** Keys are emitted in sorted
 *   order so a re-run of the same records hashes identically; a record that contains a
 *   non-JSON-safe value (NaN/Infinity/undefined inside a nested object) is refused at append
 *   time rather than silently coerced to null.
 * - **Stamped sequence.** Every appended record carries a writer-assigned `seq` starting at 1.
 *   A reader verifies continuity; a gap means a record was lost, and a lost sample FAILS the
 *   trace (`gaps()` on the read side, `missingSamples` on the summary). Samples are never
 *   renumbered to hide a hole, and a missing sample is never rewritten as zero.
 * - **Zero values are data.** The writer does not look at values; nothing here filters,
 *   deduplicates or compacts. Zero retention is enforced where populations are summarised
 *   (statistics.ts), and the round trip through this file proves it: write zeros, read zeros.
 * - **Explicit backpressure.** `append()` returns `false` when the underlying stream says
 *   "buffered enough"; the caller must `await drain()` before appending more if it wants no
 *   in-memory queueing. `append()` itself never drops.
 * - **Explicit close.** `close()` flushes and ends the file and returns the summary; appending
 *   after close throws (a record arriving after the trace closed is exactly the "missing
 *   sample" bug class). `finalize()` without `close()` leaves the file unterminated — callers
 *   that end a run must close, and the summary counts are the check that they did.
 */

import { createWriteStream, readFileSync } from 'node:fs';

export interface TraceSummary {
  readonly path: string;
  readonly records: number;
  readonly bytes: number;
  /** Writer-side this must be empty: [first, last] seq ranges that were never handed the stream. */
  readonly unwritten: number;
}

export interface TraceWriter {
  /** Append one record. Returns false on backpressure (see header); never drops, never reorders. */
  append(record: Readonly<Record<string, unknown>>): boolean;
  /** Wait until the stream buffer has flushed. */
  drain(): Promise<void>;
  /** Flush + end. Idempotent-safe: the second call resolves with the same summary. */
  close(): Promise<TraceSummary>;
  written(): number;
}

/** Deterministic JSON: sorted keys at every object level. Throws on non-JSON-safe values. */
export const canonicalJson = (value: unknown): string => {
  const seen = new Set<unknown>();
  const walk = (v: unknown): string => {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new Error(`non-finite number in trace: ${String(v)}`);
      return JSON.stringify(v);
    }
    if (typeof v === 'bigint') return JSON.stringify(String(v));
    if (v === null) return 'null';
    if (typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'undefined') throw new Error('undefined in trace record — an explicit missing sample must be recorded as a gap, not as undefined');
    if (Array.isArray(v)) return `[${v.map((item) => walk(item)).join(',')}]`;
    if (typeof v === 'object') {
      if (seen.has(v)) throw new Error('cyclic structure in trace record');
      seen.add(v);
      const obj = v as Record<string, unknown>;
      const parts = Object.keys(obj)
        .sort()
        .filter((key) => obj[key] !== undefined)
        .map((key) => `${JSON.stringify(key)}:${walk(obj[key])}`);
      seen.delete(v);
      return `{${parts.join(',')}}`;
    }
    throw new Error(`unserializable trace value of type ${typeof v}`);
  };
  return walk(value);
};

export const createTraceWriter = (path: string): TraceWriter => {
  const stream = createWriteStream(path, { encoding: 'utf8' });
  let seq = 0;
  let bytes = 0;
  let closed = false;
  let summary: TraceSummary | null = null;
  const flushErrors: Error[] = [];
  stream.on('error', (error) => {
    flushErrors.push(error instanceof Error ? error : new Error(String(error)));
  });

  return {
    append(record): boolean {
      if (closed) throw new Error('append after close(): a record after the trace closed is a missing-sample defect, not a late write');
      seq += 1;
      const line = `${canonicalJson({ ...record, seq })}\n`;
      bytes += Buffer.byteLength(line, 'utf8');
      return stream.write(line);
    },
    async drain(): Promise<void> {
      if (stream.writableFinished || stream.destroyed) return;
      await new Promise<void>((resolve) => {
        stream.once('drain', () => {
          resolve();
        });
      });
    },
    async close(): Promise<TraceSummary> {
      if (summary !== null) return summary;
      closed = true;
      await new Promise<void>((resolve, reject) => {
        stream.end(() => {
          if (flushErrors.length > 0) reject(flushErrors[0]);
          else resolve();
        });
      });
      summary = { path, records: seq, bytes, unwritten: 0 };
      return summary;
    },
    written(): number {
      return seq;
    },
  };
};

export interface TraceReadResult {
  readonly records: readonly Readonly<Record<string, unknown>>[];
  readonly seqs: readonly number[];
  /** Missing sequence numbers between 1 and the highest seen. Non-empty means the trace LOST samples. */
  readonly gaps: readonly number[];
  readonly outOfOrder: boolean;
  readonly duplicateSeqs: readonly number[];
}

/** Read a written trace and re-derive its continuity — the reader is the test, not the writer. */
export const readTrace = (path: string): TraceReadResult => {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n').filter((line) => line.length > 0);
  const records: Record<string, unknown>[] = [];
  const seqs: number[] = [];
  for (const line of lines) {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (typeof parsed['seq'] !== 'number' || !Number.isInteger(parsed['seq'])) {
      throw new Error(`trace line without an integer seq in ${path}`);
    }
    seqs.push(parsed['seq']);
    records.push(parsed);
  }
  const seen = new Set<number>();
  const duplicates: number[] = [];
  for (const s of seqs) {
    if (seen.has(s)) duplicates.push(s);
    seen.add(s);
  }
  const highest = seqs.length > 0 ? Math.max(...seqs) : 0;
  const gaps: number[] = [];
  for (let s = 1; s <= highest; s += 1) {
    if (!seen.has(s)) gaps.push(s);
  }
  let outOfOrder = false;
  for (let i = 1; i < seqs.length; i += 1) {
    if ((seqs[i] ?? 0) < (seqs[i - 1] ?? 0)) outOfOrder = true;
  }
  return { records, seqs, gaps, outOfOrder, duplicateSeqs: duplicates };
};
