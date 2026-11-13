/**
 * Per-seat stream accounting, shared by every Phase 2 runtime evidence script that claims a seat's
 * stream was consumed (T-0 for the abuse population, T-0b for the recovery scenarios, T-3 for the
 * `B = 8` burst, T-4 for the projection comparison).
 *
 * Why it is shared rather than written per script: F-1 was possible precisely because "this seat's
 * stream works" was a conclusion each script drew from a field that could not show otherwise.
 * `PlayerSchema.inputResolvedThrough` advances for a frame that was **represented**, and ADR-003 §4
 * makes a refusal a representation — so a seat whose every frame was refused still reports a watermark
 * that reached its highest stamp. One implementation, one set of field names, one failure mode.
 *
 * Consumption is measured from two sources that cannot both be wrong the same way:
 *
 * * the room's per-tick `TickRecord.consumed` — what the authority **dequeued**; and
 * * the authority journal's `observation` rows — the disposition the screen returned.
 *
 * Pairing rule and why it holds: a seat drains at most one frame per tick and the accessor is FIFO, so
 * index n of the dequeued stamps is index n of the journalled dispositions. The two counts are
 * compared, so the pairing is checked rather than assumed.
 *
 * Stamp collisions are counted, not hidden: a seat that sends two frames between two server clocks can
 * stamp them identically (the stamp is an integer `inputTick` offset plus the entity's first tick), and
 * a collided stamp makes any per-stamp claim meaningless. `allSentStampsConsumed` is false for such a
 * seat, which forces a scenario that depends on per-stamp claims to pace its sender.
 */

export interface StreamAccounting {
  readonly stampsSent: number;
  /** Dequeued AND accepted: the stamp's own journalled disposition is `consumed`. */
  readonly stampsConsumed: number;
  readonly stampsRefused: number;
  readonly stampsDroppedAtClose: number;
  readonly missingStamps: readonly number[];
  readonly duplicateStamps: readonly number[];
  /**
   * The room records a dequeue on the tick it drains, BEFORE the screen's verdict, so a dequeued stamp
   * is not yet an accepted one. The two are joined by FIFO order per seat; a mismatch in their counts
   * means the pairing itself broke, and the accounting refuses to claim anything in that case.
   */
  readonly pairingConsistent: boolean;
  readonly collidedStamps: number;
  readonly movedMeters: number;
  /**
   * The compliant-stream assertion. True only when EVERY stamp this seat sent was consumed exactly once
   * and nothing was refused — the property the watermark was previously being asked to prove.
   */
  readonly allSentStampsConsumed: boolean;
  /** The stamps the authority accepted, in dequeue order (T-3 asserts these are 1..8 on 8 ticks). */
  readonly consumedStamps: readonly number[];
  /** The room tick on which each accepted stamp was consumed, same order. */
  readonly consumedTicks: readonly number[];
  /** Disposition tally by reason, so a refusal is reported as its reason rather than a bare count. */
  readonly refusedBy: Readonly<Record<string, number>>;
}

export interface StreamAccountingInput {
  /** The whole journal rows of the room the seat is in (filtered here, never by the caller). */
  readonly journalRows: readonly Record<string, unknown>[];
  /** `TickRecord.consumed` flattened across the room's ticks, in tick order. */
  readonly consumed: readonly { readonly entityId: string; readonly seq: number; readonly tick: number }[];
  readonly entityId: string;
  /** Every stamp this seat put on the wire, in send order, duplicates included. */
  readonly sentStamps: readonly number[];
  /** Count of duplicate stamps the sender noticed on its own side (0 when the sender paced itself). */
  readonly collidedStamps?: number;
  /** Window the metres figure covers. Dispositions are always counted over the seat's whole presence. */
  readonly fromTick?: number;
}

/**
 * Join what a seat sent against what the authority dequeued and journalled.
 *
 * `fromTick` windows the metres figure only. A window that silently excluded an early refusal is how a
 * refused stream becomes "all consumed", so dispositions are never windowed here.
 */
export const streamAccounting = (input: StreamAccountingInput): StreamAccounting => {
  const { journalRows, consumed, entityId, sentStamps } = input;
  const fromTick = input.fromTick ?? 0;
  const collidedStamps = input.collidedStamps ?? 0;

  // Client frames are `type: 'observation'` with `kind: 'direct'` and `origin: 'client-payload'`. The
  // other rows are the authority's own neutral steps and lifecycle dispositions; counting those as
  // client frames would inflate every claim made from this record.
  const dispositions = journalRows
    .filter((row) => row['type'] === 'observation'
      && row['entityId'] === entityId
      && row['kind'] === 'direct'
      && row['origin'] === 'client-payload')
    .map((row) => String(row['disposition'] ?? 'unknown'));

  const dequeued = consumed.filter((entry) => entry.entityId === entityId);
  // FIFO pairing: one drain produces exactly one disposition row. Without the count check the pairing
  // would silently mis-attribute a stamp to a neighbouring frame's verdict the moment the two sequences
  // drifted apart.
  const pairingConsistent = dequeued.length === dispositions.length;

  const accepted = new Map<number, number>();
  const refusedBy: Record<string, number> = {};
  const consumedStamps: number[] = [];
  const consumedTicks: number[] = [];
  let refused = 0;
  let dropped = 0;
  dequeued.forEach((entry, index) => {
    const disposition = dispositions[index] ?? 'unpaired';
    if (disposition === 'consumed') {
      accepted.set(entry.seq, (accepted.get(entry.seq) ?? 0) + 1);
      consumedStamps.push(entry.seq);
      consumedTicks.push(entry.tick);
    } else if (disposition.startsWith('refused')) {
      refused += 1;
      refusedBy[disposition] = (refusedBy[disposition] ?? 0) + 1;
    } else if (disposition.startsWith('dropped')) {
      dropped += 1;
    }
  });

  const missing = sentStamps.filter((stamp) => (accepted.get(stamp) ?? 0) === 0);
  const duplicates = [...accepted.entries()].filter(([, count]) => count > 1).map(([stamp]) => stamp);

  // Movement is claimed only from the authority's own journalled per-tick displacement, so a refused
  // frame cannot contribute metres: a refused tick resolves nothing.
  const movedMeters = journalRows
    .filter((row) => row['type'] === 'tick'
      && row['entityId'] === entityId
      && Number(row['tick']) >= fromTick)
    .reduce((total, row) => total + (Number(row['resolvedDisplacement']) || 0), 0);

  return {
    stampsSent: sentStamps.length,
    stampsConsumed: accepted.size,
    stampsRefused: refused,
    stampsDroppedAtClose: dropped,
    missingStamps: missing,
    duplicateStamps: duplicates,
    pairingConsistent,
    collidedStamps,
    movedMeters: Math.round(movedMeters * 1e6) / 1e6,
    allSentStampsConsumed: pairingConsistent
      && collidedStamps === 0
      && missing.length === 0
      && duplicates.length === 0
      && refused === 0
      && dropped === 0,
    consumedStamps,
    consumedTicks,
    refusedBy,
  };
};

/** Flatten a room's `tickRecords` into the `consumed` list this module wants, in tick order. */
export const flattenConsumed = (
  tickRecords: readonly {
    readonly tick: number;
    readonly consumed: readonly { readonly entityId: string; readonly seq: number }[];
  }[],
): { entityId: string; seq: number; tick: number }[] => {
  const out: { entityId: string; seq: number; tick: number }[] = [];
  for (const record of tickRecords) {
    for (const entry of record.consumed) out.push({ entityId: entry.entityId, seq: entry.seq, tick: record.tick });
  }
  return out;
};
