/**
 * UDG-003 Phase 2 R-1 — replaying a room's journal and comparing it to what the room recorded.
 *
 * GA-13 asks for journal replay over the Phase 2 artefacts; AC-3d asks that the input ledger, gaps,
 * retirement and effect accounting survive replay; AC-20 asks for the same over the consequence paths.
 * Phase 1 settled the replay mechanism against a synthetic harness and its own population (PA-1). What was
 * missing was the sentence every mechanism paper needs: a journal written by a real room, replayed, and
 * compared field by field against what that room recorded.
 *
 * What this module compares is the part replay can reproduce — see `RECOMPUTED_BY_REPLAY` — and what it
 * cannot is named in `RECORDED_NOT_RECOMPUTED`. The distinction is not decoration: a claim that replay
 * reproduces transport behaviour would credit the authority with the message-loss model, which is exactly
 * the conflation ADR-0003 §3.1 keeps separate.
 */

/** One arrival's decision, in journal order. */
export interface DispositionEntry {
  readonly tick: number | null;
  readonly ordinal: number | null;
  readonly entityId: string | null;
  readonly disposition: string | null;
  readonly reason: string | null;
}

/** The canonical state a tick published, in journal order. */
export interface StateEntry {
  readonly tick: number | null;
  readonly ordinal: number | null;
  readonly stateHash: string | null;
}

/** One tick's chain record, in chain order. */
export interface ChainEntry {
  readonly tick: number;
  readonly ordinal: number | null;
  readonly hash: string;
}

/**
 * A journal as a process holds it or reads it back.
 *
 * Rows and chain records are named as bags of keys on purpose: a journal that has been through JSON is
 * structurally a journal and nominally a bag, and every helper here reads fields by name and reports a
 * missing field as a mismatch — which fails louder than a cast that quietly succeeded.
 */
export interface JournalLike {
  readonly prologue: Record<string, unknown>;
  readonly rows: readonly Record<string, unknown>[];
  readonly chain: readonly Record<string, unknown>[];
  readonly dropped: number;
}

/** The single boundary where persisted bytes become a journal again. A null prologue stays empty, so the replay refuses it by name. */
export const journalFromPersisted = (input: {
  prologue: Record<string, unknown> | null;
  rows: readonly Record<string, unknown>[];
  chain: readonly Record<string, unknown>[];
  dropped: number;
}): JournalLike => ({
  prologue: input.prologue ?? {},
  rows: [...input.rows],
  chain: [...input.chain],
  dropped: input.dropped,
});

export interface Comparison {
  readonly label: string;
  readonly equal: boolean;
  readonly lengthEqual: boolean;
  readonly liveCount: number;
  readonly replayedCount: number;
  /** Number of entries that differ once both lists are lined up by index. */
  readonly differingEntries: number;
  readonly firstMismatch: Record<string, unknown> | null;
}

export interface RoomComparison {
  readonly dispositions: Comparison;
  readonly state: Comparison;
  readonly chain: Comparison;
  readonly tipEqual: boolean;
  readonly histogramEqual: boolean;
  readonly liveTip: string | null;
  readonly replayedTip: string | null;
  readonly equal: boolean;
  readonly mismatches: readonly Record<string, unknown>[];
}

const field = (row: Record<string, unknown>, key: string): string | null =>
  typeof row[key] === 'string' ? (row[key] as string) : null;

const numberOrNull = (row: Record<string, unknown>, key: string): number | null =>
  typeof row[key] === 'number' && Number.isFinite(row[key]) ? (row[key] as number) : null;

/** Journal rows in arrival order, with their dispositions. Joins and leaves carry none and are skipped. */
export const dispositionsOf = (rows: readonly Record<string, unknown>[]): DispositionEntry[] =>
  rows
    .filter((row) => typeof row['disposition'] === 'string')
    .map((row) => ({
      tick: numberOrNull(row, 'tick'),
      ordinal: numberOrNull(row, 'ordinal'),
      entityId: field(row, 'entityId'),
      disposition: field(row, 'disposition'),
      reason: field(row, 'reason'),
    }));

/** Disposition counts by kind — a histogram is harder to satisfy by accident than a boolean. */
export const dispositionHistogram = (rows: readonly Record<string, unknown>[]): Record<string, number> => {
  const histogram: Record<string, number> = {};
  for (const entry of dispositionsOf(rows)) {
    const key = entry.disposition ?? 'unknown';
    histogram[key] = (histogram[key] ?? 0) + 1;
  }
  return histogram;
};

/** Per-tick canonical state digests, in row order. */
export const stateDigestsOf = (rows: readonly Record<string, unknown>[]): StateEntry[] =>
  rows
    .filter((row) => typeof row['stateHash'] === 'string')
    .map((row) => ({
      tick: numberOrNull(row, 'tick'),
      ordinal: numberOrNull(row, 'ordinal'),
      stateHash: field(row, 'stateHash'),
    }));

/** The last state each entity appears in — the end state a replay has to reproduce. */
export const finalStatesOf = (rows: readonly Record<string, unknown>[]): Record<string, string> => {
  const last: Record<string, string> = {};
  for (const row of rows) {
    const entityId = field(row, 'entityId');
    const stateHash = field(row, 'stateHash');
    if (entityId !== null && stateHash !== null) last[entityId] = stateHash;
  }
  return last;
};

export const chainHashesOf = (chain: readonly Record<string, unknown>[]): ChainEntry[] =>
  chain
    .filter((record) => typeof record['hash'] === 'string' && typeof record['tick'] === 'number')
    .map((record) => ({
      tick: record['tick'] as number,
      ordinal: numberOrNull(record, 'ordinal'),
      hash: record['hash'] as string,
    }));

/** The tip hash, or null when the journal wrote no chain record at all. */
export const chainTipOf = (chain: readonly Record<string, unknown>[]): string | null => {
  const entries = chainHashesOf(chain);
  return entries.length === 0 ? null : (entries[entries.length - 1]?.hash ?? null);
};

const compareOrdered = (
  label: string,
  live: readonly Record<string, unknown>[],
  replayed: readonly Record<string, unknown>[],
): Comparison => {
  const shared = Math.min(live.length, replayed.length);
  let differing = 0;
  let firstMismatch: Record<string, unknown> | null = null;
  for (let index = 0; index < shared; index += 1) {
    const a = live[index];
    const b = replayed[index];
    if (a === undefined || b === undefined) continue;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    differing += 1;
    // The live/replayed keys are kept because a reviewer reading the artefact has to be able to tell a
    // missing field from a differing one without re-running anything.
    firstMismatch ??= { label, index, live: a, replayed: b };
  }
  const lengthEqual = live.length === replayed.length;
  if (firstMismatch === null && !lengthEqual) {
    firstMismatch = {
      label,
      reason: 'length',
      liveCount: live.length,
      replayedCount: replayed.length,
      tail: live.length > replayed.length ? live.slice(shared) : replayed.slice(shared),
    };
  }
  return {
    label,
    equal: lengthEqual && differing === 0,
    lengthEqual,
    liveCount: live.length,
    replayedCount: replayed.length,
    differingEntries: differing,
    firstMismatch,
  };
};

/**
 * The three comparisons R-1 requires — dispositions, canonical state, per-tick hashes through the tip —
 * plus two secondary checks (disposition histogram, chain tip) that make an accidental pass less likely.
 *
 * Comparison is ordered. Replay is deterministic and the journal is ordered by arrival, so a set
 * comparison would let an out-of-order replay pass; ordered comparison does not.
 */
export const compareJournal = (
  liveRows: readonly Record<string, unknown>[],
  liveChain: readonly Record<string, unknown>[],
  replayedRows: readonly Record<string, unknown>[],
  replayedChain: readonly Record<string, unknown>[],
): RoomComparison => {
  const dispositions = compareOrdered('dispositions', dispositionsOf(liveRows) as unknown as Record<string, unknown>[], dispositionsOf(replayedRows) as unknown as Record<string, unknown>[]);
  const state = compareOrdered('canonical-state', stateDigestsOf(liveRows) as unknown as Record<string, unknown>[], stateDigestsOf(replayedRows) as unknown as Record<string, unknown>[]);
  const chain = compareOrdered('per-tick-chain-hashes', chainHashesOf(liveChain) as unknown as Record<string, unknown>[], chainHashesOf(replayedChain) as unknown as Record<string, unknown>[]);
  const liveTip = chainTipOf(liveChain);
  const replayedTip = chainTipOf(replayedChain);
  const histogramEqual =
    JSON.stringify(dispositionHistogram(liveRows)) === JSON.stringify(dispositionHistogram(replayedRows));
  const tipEqual = liveTip === replayedTip;
  const mismatches: Record<string, unknown>[] = [];
  for (const step of [dispositions, state, chain]) {
    if (!step.equal && step.firstMismatch !== null) mismatches.push(step.firstMismatch);
  }
  if (!tipEqual) mismatches.push({ label: 'chain-tip', live: liveTip, replayed: replayedTip });
  if (!histogramEqual) {
    mismatches.push({ label: 'disposition-histogram', live: dispositionHistogram(liveRows), replayed: dispositionHistogram(replayedRows) });
  }
  return {
    dispositions,
    state,
    chain,
    tipEqual,
    histogramEqual,
    liveTip,
    replayedTip,
    equal: dispositions.equal && state.equal && chain.equal && tipEqual && histogramEqual,
    mismatches,
  };
};

/** What a serialised journal must carry before a replay can even be attempted. */
export const REQUIRED_JOURNAL_FIELDS = [
  'prologue',
  'rows',
  'chain',
  'dropped',
  'configDocument',
  'stepper',
  'runId',
] as const;

/**
 * Transport and room facts a journal can RECORD but replay cannot REPRODUCE.
 *
 * ADR-0003 §3.1 attributes eviction to the enqueue attempt: a frame is dropped because the server's buffer
 * was full, which is a property of the socket and the buffer, not of the transition function. Replaying a
 * journal recomputes the decision made about each input; it does not re-run the delivery process that
 * decided how many inputs existed to be decided about. Claiming otherwise would credit the authority with
 * the message-loss model — the conflation §3.1 exists to keep separate — so these fields are reported as
 * recorded-only, and a scenario whose whole claim is one of them is reported as out of replay's reach.
 */
export const RECORDED_NOT_RECOMPUTED: readonly { readonly fact: string; readonly why: string }[] = [
  {
    fact: 'retiredUnrepresented',
    why: 'the queue-drain arithmetic is transport-side (§3.1); replay sees the recorded number, it cannot re-derive it',
  },
  {
    fact: 'input gap naming (inputGapStart / inputGapEnd)',
    why: 'a gap exists because a stamp was never dequeued — an eviction event, not a transition decision',
  },
  {
    fact: 'close code and the closure window',
    why: 'the close follows from retirement and wall-clock windows; the room owns both, the transition function owns neither',
  },
  {
    fact: 'serverQueuedAtClose / consumedCountAtClose',
    why: 'buffer occupancy at a wall-clock instant; nothing in the journal reconstitutes a buffer',
  },
  {
    fact: 'effect ledger fields (effectCount, lastAppliedRequestId)',
    why: 'RECORDABLE, not reproducible: replay re-derives the committed identity and its outcome, which is what the ledger is evidence about',
  },
  {
    fact: 'resolvedThrough watermark arithmetic',
    why: 'the watermark advances over dequeued contiguous stamps — dequeue again being a transport event',
  },
];

/** What replay recomputes and the comparison is therefore about. */
export const RECOMPUTED_BY_REPLAY: readonly { readonly output: string; readonly source: string }[] = [
  { output: 'disposition and reason per arrival', source: 'the same validated input applied to the same state (ADR-0002 §4: same input, same state, same outcome)' },
  { output: 'per-tick canonical state digest', source: 'the state reducer over the accepted inputs' },
  { output: 'per-tick chain hash and the chain tip', source: 'the hash chain itself, prevHash forward' },
  { output: 'watermark and throttle-latch transitions', source: 'the consequence mapping over recorded dispositions' },
  { output: 'committed identity and its outcome', source: 'the committed record — GA-5a’s idempotence limb' },
  { output: 'lifecycle decision and epoch issue', source: 'the lifecycle rule under the same configuration' },
];
