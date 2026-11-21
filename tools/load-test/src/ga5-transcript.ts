/**
 * UDG-SPIKE-001 slice 7 — the GA-5b TRANSCRIPT validator (harness-side evidence arithmetic).
 *
 * WHY this module exists: an earlier GA-5b report correlated a delivery row's `ack`/
 * `resolvedThrough` pair with the fate of a declined input and called it 'coverage'. That claim
 * failed review because it conflated two INDEPENDENT counters — the SDK's slot-ack layer and the
 * ROOM-owned resolved prefix — and because the delivery row it pointed at was never proven to
 * belong to the transcript's domain, nor the prefix proven rebuildable from real dequeues. This
 * module encodes the room's OWN rule and refuses any transcript where a published value cannot be
 * rebuilt from it:
 *
 *   apps/server/src/network/ColyseusInputAdapter.ts:190-193 — `resolvedThrough` advances ONLY when
 *   a REAL dequeued frame has `seq === resolvedThrough + 1`. A stamp declined at the pre-buffer
 *   boundary never enters the buffer, never dequeues, and therefore has NO room-owned disposition
 *   AT ALL. It is absent, not covered. The client guard (ColyseusPredictionAdapter.ts:339-340)
 *   REQUIRES `ack === inputResolvedThrough` on every accepted delivery — the two surfaces are
 *   fused only as a DETECTION seam (they refuse when they disagree), never as coverage.
 *
 * The validator is deliberately DUMB: it accepts a transcript only when every published number is
 * rebuildable from the room's own dequeued records within the SAME (roomId, sessionId, epoch) and
 * the declined stamps are proven absent. Anything else returns an issue list; the scenario turns
 * issues into FAILED rows, never into narrative.
 */

export interface TranscriptSend {
  /** Send ordinal inside the scenario, 1-based. */
  readonly ordinal: number;
  readonly role: 'twin' | 'eaten' | 'pump' | 'liveness';
  /** The stamp value READ BACK from the input data object at send time (what the wire carried). */
  readonly stagedSeq: number;
  /** SDK handle send-counter before/after this send (slot identity at source). */
  readonly slotBefore: number;
  readonly slotAfter: number;
  readonly ackReturn: number;
  readonly epoch: number;
  readonly sessionId: string;
  readonly atMs: number;
  /** Proxy c2s chunk receipts attributed to this send's window (aggregate; attribution labelled). */
  readonly wireChunksWindow: number;
  /** Distinctive content, for content attribution against the observer track. */
  readonly moveX: number;
  readonly moveZ: number;
}

export interface TranscriptDequeue {
  readonly tick: number;
  readonly seq: number;
  /** Room-clock ms for the tick (bridged), when available. */
  readonly atMs: number | null;
}

export interface TranscriptDelivery {
  readonly epoch: number;
  readonly authorityTick: number;
  readonly revision: number;
  readonly atMs: number;
  readonly ack: number;
  readonly resolvedThrough: number;
  readonly gapStart: number;
  readonly gapEnd: number;
  readonly retiredUnrepresented: number;
  readonly accepted: boolean;
  readonly reason: string;
}

export interface TranscriptPendingSample {
  readonly atMs: number;
  readonly seqs: readonly number[];
}

export interface Ga5Transcript {
  readonly roomId: string;
  readonly sessionId: string;
  readonly epoch: number;
  readonly sends: readonly TranscriptSend[];
  readonly dequeues: readonly TranscriptDequeue[];
  readonly refusals: number;
  readonly signals: readonly string[];
  readonly closures: readonly number[];
  readonly deliveries: readonly TranscriptDelivery[];
  readonly pendingSamples: readonly TranscriptPendingSample[];
  /** Declined frames as the fixture INTENDED them: a stamp whose pre-buffer decline must leave the
   * consumed count of that stamp EXACTLY `originalsBefore` (the same-stamp accepted send(s) that
   * predate the replay). Absence of disposition means: the decline contributes ZERO consumptions —
   * it is not 'covered', and it must not be scored as a second consumption either. */
  readonly declinedFrames: readonly { readonly seq: number; readonly originalsBefore: number }[];
}

/** The room's prefix rule, mirrored EXACTLY (advance only on `seq === prefix + 1`). */
export const rebuildPrefix = (dequeues: readonly TranscriptDequeue[]): number => {
  let prefix = 0;
  for (const d of dequeues) {
    if (d.seq === prefix + 1) prefix = d.seq;
  }
  return prefix;
};

/** Prefix rebuilt from the dequeues at or before `tick` (the room's own causality order). */
export const prefixAtTick = (dequeues: readonly TranscriptDequeue[], tick: number): number =>
  rebuildPrefix(dequeues.filter((d) => d.tick <= tick));

/**
 * Every published accepted delivery's `resolvedThrough` must equal the prefix REBUILT from real
 * same-domain dequeues at its publication tick. This is the assertion the reviewed evidence failed:
 * a published prefix with no dequeue chain behind it is an issue, whatever the prose said.
 */
export const validatePublishedPrefixes = (t: Ga5Transcript): string[] => {
  const issues: string[] = [];
  for (const d of t.deliveries) {
    if (!d.accepted) continue;
    if (d.epoch !== t.epoch) {
      issues.push(`foreign-epoch-delivery: revision ${String(d.revision)} published epoch ${String(d.epoch)} for domain ${String(t.epoch)}`);
      continue;
    }
    const rebuilt = prefixAtTick(t.dequeues, d.authorityTick);
    if (d.resolvedThrough !== rebuilt) {
      issues.push(`published-prefix-not-rebuildable: revision ${String(d.revision)} at tick ${String(d.authorityTick)} published resolvedThrough ${String(d.resolvedThrough)}, real dequeues rebuild ${String(rebuilt)}`);
    }
    if (d.ack !== d.resolvedThrough) {
      issues.push(`ack-disposition-conflation: revision ${String(d.revision)} has ack ${String(d.ack)} !== resolvedThrough ${String(d.resolvedThrough)} — the ACCEPTED-delivery guard requires equality; unequal rows must be REFUSALS (reason 'ack-ahead/behind-of-resolution'), never accepted coverage`);
    }
  }
  return issues;
};

/** Stamps the room consumed must all have been STAGED by a transcript send (catches aliasing or a
 * record from a foreign connection), and declined stamps must be ABSENT everywhere. */
export const validateConsumptionAndAbsence = (t: Ga5Transcript): string[] => {
  const issues: string[] = [];
  const staged = new Set(t.sends.map((s) => s.stagedSeq));
  const consumed = t.dequeues.map((d) => d.seq);
  const seen = new Set<number>();
  for (const seq of consumed) {
    if (seen.has(seq)) issues.push(`duplicate-consumption: stamp ${String(seq)} dequeued twice`);
    seen.add(seq);
    if (!staged.has(seq)) issues.push(`consumed-stamp-never-staged: stamp ${String(seq)} dequeued but NO transcript send staged it — aliasing (shared input object) or a foreign record`);
  }
  for (const frame of t.declinedFrames) {
    const count = consumed.filter((seq) => seq === frame.seq).length;
    if (count > frame.originalsBefore) {
      issues.push(`decline-not-silent: stamp ${String(frame.seq)} consumed ${String(count)} time(s) but only ${String(frame.originalsBefore)} accepted original(s) predate the decline — the declined frame was applied`);
    }
    if (count < frame.originalsBefore) {
      issues.push(`original-not-consumed: stamp ${String(frame.seq)} had ${String(frame.originalsBefore)} accepted original(s) yet consumed count is ${String(count)}`);
    }
  }
  const stagedCounts = new Map<number, number>();
  for (const send of t.sends) stagedCounts.set(send.stagedSeq, (stagedCounts.get(send.stagedSeq) ?? 0) + 1);
  for (const [seq, count] of stagedCounts) {
    if (count > 1 && !t.declinedFrames.some((f) => f.seq === seq)) {
      issues.push(`ambiguous-stamp-intent: ${String(count)} sends staged stamp ${String(seq)} without a declared declinedFrames entry — duplicate staging must be DECLARED intent, never inferred`);
    }
  }
  if (t.refusals > 0) issues.push(`unexpected-refusals: ${String(t.refusals)} refusal(s) on the supported substrate`);
  if (t.signals.includes('RETIRED_UNREPRESENTED')) issues.push('retired-unrepresented signal appeared');
  for (const code of t.closures) issues.push(`server closure ${String(code)} inside the transcript window`);
  return issues;
};

/**
 * Pending may disappear ONLY when the rebuilt prefix covers the stamp (or when a labelled
 * recovery discarded the journal — `discard-pending`). Anything else is an early prune: coverage
 * by faith, which is the exact failure this slice exists to forbid.
 */
export const validatePendingPrunes = (
  t: Ga5Transcript,
  discards: readonly { readonly atMs: number }[],
): string[] => {
  const issues: string[] = [];
  const accepted = t.deliveries.filter((d) => d.accepted && d.epoch === t.epoch);
  for (let i = 1; i < t.pendingSamples.length; i += 1) {
    const before = t.pendingSamples[i - 1]!;
    const now = t.pendingSamples[i]!;
    for (const seq of before.seqs) {
      if (now.seqs.includes(seq)) continue;
      const covered = accepted.some(
        (d) => d.atMs <= now.atMs && d.atMs >= before.atMs && d.resolvedThrough >= seq,
      );
      const discarded = discards.some((e) => e.atMs >= before.atMs && e.atMs <= now.atMs);
      if (!covered && !discarded) {
        issues.push(`early-prune: pending stamp ${String(seq)} disappeared between ${String(before.atMs)} and ${String(now.atMs)} with no accepted delivery whose rebuilt prefix covers it and no labelled discard-pending`);
      }
    }
  }
  return issues;
};

/**
 * The stale-row control: selecting the LAST ledger row without the epoch filter is NOT evidence.
 * Returns whether the naive selection diverges from the transcript-keyed selection; the scenario
 * records this as a control (and the unit tests prove the detector fires on forged ledgers).
 */
export const naiveVsJoined = (
  t: Ga5Transcript,
): { readonly naiveLast: TranscriptDelivery | null; readonly joinedLast: TranscriptDelivery | null; readonly diverged: boolean } => {
  const naiveLast = t.deliveries.at(-1) ?? null;
  const sameDomain = t.deliveries.filter((d) => d.epoch === t.epoch);
  const joinedLast = sameDomain.at(-1) ?? null;
  const diverged =
    naiveLast === null || joinedLast === null
      ? naiveLast !== joinedLast
      : naiveLast.revision !== joinedLast.revision || naiveLast.epoch !== joinedLast.epoch;
  return { naiveLast, joinedLast, diverged };
};

/** Full transcript audit: all invariants at once. Empty list means the transcript is sound. */
export const auditGa5Transcript = (
  t: Ga5Transcript,
  discards: readonly { readonly atMs: number }[] = [],
): string[] => [
  ...validatePublishedPrefixes(t),
  ...validateConsumptionAndAbsence(t),
  ...validatePendingPrunes(t, discards),
];
