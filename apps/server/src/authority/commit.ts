/**
 * Stage C, as a pure plan (P03-c C, P03-f).
 *
 * This is the only place the watermark may move, and the plan says so in one screen: `watermarkAfter`
 * is either the winner's generation or the value it already had, and `step.ts` is the only caller that
 * can act on it. The purge is computed here from the queue **after** stage Q's consumption, so a
 * frame cannot be both consumed and purged, and every purged item leaves with a code that says why it
 * was refused rather than consumed (P03-f).
 */

import type { Generation, MovementMode, RejectionCode, ServerTick } from '@udg/protocol';

import type { EntityView } from './entity.js';
import type { DiscreteScreening, ContinuousScreening } from './screen.js';
import type {
  ArbitrationDecision,
  ArbitrationLoser,
  ArrivalOrdinal,
  ArrivalRecord,
  Cutoff,
  HorizontalDrive,
  InputSource,
  IntentionCandidate,
  LatchedKind,
  PurgedObservation,
  TerminalResult,
} from './types.js';

/** The mode is derived from this tick's drive, never from the intention latch (P03-c state). */
export const modeForDrive = (drive: HorizontalDrive): MovementMode =>
  drive === 'NONE' ? 'idle' : 'direct';

const isNonzero = (axes: { readonly moveX: number; readonly moveZ: number } | null): boolean =>
  axes !== null && (axes.moveX !== 0 || axes.moveZ !== 0);

/**
 * `inputSource` is the honest description of what the tick consumed, and it is decided in one place so
 * the journal cannot drift: `direct` when a direct winner produced drive, `keepalive` when the
 * consumed observation was a keepalive, `rejected` when an observation was consumed and refused or
 * lost, and `neutral` otherwise (P03-f, P03-g).
 */
export const inputSourceFor = (
  continuous: ContinuousScreening | null,
  winner: IntentionCandidate | null,
  drive: HorizontalDrive,
): InputSource => {
  if (winner !== null && winner.kind === 'direct' && drive !== 'NONE') return 'direct';
  if (continuous !== null && continuous.keepalive) return 'keepalive';
  if (continuous !== null) return 'rejected';
  return 'neutral';
};

export interface CommitInput {
  readonly view: EntityView;
  readonly cutoff: Cutoff;
  /** What stage Q selected, or `null` when the continuous queue had nothing eligible. */
  readonly continuous: ContinuousScreening | null;
  /** What stage S produced for the discrete requests in this frozen batch. */
  readonly discrete: DiscreteScreening;
  /** Stage A's ranking over the surviving intentions. */
  readonly arbitration: ArbitrationDecision;
  readonly tick: ServerTick;
  /** The continuous queue **after** stage Q removed the selected observation. */
  readonly remainingContinuous: readonly ArrivalRecord[];
  /** The discrete queue as it stood for this tick, in arrival order. */
  readonly discreteQueue: readonly ArrivalRecord[];
}

export interface CommitPlan {
  readonly winner: IntentionCandidate | null;
  readonly losers: readonly ArbitrationLoser[];
  readonly watermarkBefore: Generation;
  readonly watermarkAfter: Generation;
  readonly latchedKindBefore: LatchedKind;
  readonly latchedKindAfter: LatchedKind;
  readonly heldBefore: Generation | null;
  readonly heldAfter: Generation | null;
  readonly drive: HorizontalDrive;
  readonly inputSource: InputSource;
  readonly modeBefore: MovementMode;
  readonly modeAfter: MovementMode;
  readonly intentionCommitted: boolean;
  readonly purge: readonly PurgedObservation[];
  /** The winner's terminal record — a `cancel` only, because a continuous frame has no identity. */
  readonly terminal: TerminalResult | null;
  readonly consumed: ArrivalRecord | null;
  readonly rejected: RejectionCode | null;
  /** Queue members that stay for a later cutoff, in arrival order. */
  readonly keptContinuous: readonly ArrivalOrdinal[];
  readonly keptDiscrete: readonly ArrivalOrdinal[];
  /** Ordinals that leave the queues this tick for a reason other than the purge. */
  readonly disposedContinuous: readonly ArrivalOrdinal[];
  readonly disposedDiscrete: readonly ArrivalOrdinal[];
  /** The intentions this tick resolved to a terminal result: the winner and every arbitration loser. */
  readonly intentionPublications: readonly TerminalResult[];
}

/** Decide stage C without touching anything. */
export const planCommit = (input: CommitInput): CommitPlan => {
  const { view, continuous, discrete, arbitration, cutoff, tick } = input;
  const winner = arbitration.winner;

  const watermarkAfter: Generation =
    winner !== null && winner.generation > view.watermark ? winner.generation : view.watermark;
  const latchedKindAfter: LatchedKind = winner !== null ? winner.kind : view.latchedKind;
  const heldAfter: Generation | null =
    winner === null
      ? view.heldDirectGeneration
      : winner.kind === 'direct'
        ? winner.generation
        : null;

  const winnerAxes = winner !== null && winner.kind === 'direct' ? winner.axes : null;
  const drive: HorizontalDrive =
    winnerAxes !== null && isNonzero(winnerAxes)
      ? { moveX: winnerAxes.moveX, moveZ: winnerAxes.moveZ }
      : 'NONE';

  const inputSource = inputSourceFor(continuous, winner, drive);

  // P03-f: purge what the committed decision made inadmissible — below the new watermark, or a
  // held intention-asserting frame whose kind is no longer `direct`. Keepalive frames are never
  // purged on kind grounds.
  const purge: PurgedObservation[] = [];
  for (const arrival of input.remainingContinuous) {
    const generation = arrival.declaredGeneration;
    if (generation === null) continue;
    const directIntent = renderedBoolean(arrival, 'directIntent');
    if (generation < watermarkAfter) {
      purge.push({ arrival, code: 'SUPERSEDED' });
    } else if (generation === watermarkAfter && directIntent === true && latchedKindAfter !== 'direct') {
      purge.push({ arrival, code: 'INVALID_GENERATION' });
    }
  }
  const purgedOrdinals = new Set(purge.map((item) => item.arrival.ordinal));

  // Every eligible discrete request is answered, refused or ranked in stage S/A, so the queue keeps
  // only what those stages did not dispose of — in practice the arrivals after this cutoff. Anything
  // else would be a screening gap, and it stays queued rather than vanishing.
  const handledOrdinals = new Set<ArrivalOrdinal>([
    ...discrete.refusals.map((refusal) => refusal.arrival.ordinal),
    ...discrete.answers.map((answer) => answer.arrival.ordinal),
    ...discrete.candidates.map((candidate) => candidate.ordinal),
  ]);
  const disposedDiscrete: ArrivalOrdinal[] = [];
  const keptDiscrete: ArrivalOrdinal[] = [];
  for (const arrival of input.discreteQueue) {
    const eligible = arrival.ordinal <= cutoff.ordinal;
    if (eligible && handledOrdinals.has(arrival.ordinal)) disposedDiscrete.push(arrival.ordinal);
    else keptDiscrete.push(arrival.ordinal);
  }

  const intentionPublications: TerminalResult[] = [];
  const terminal: TerminalResult | null =
    winner !== null && winner.requestId !== null && winner.payloadHash !== null
      ? {
          requestId: winner.requestId,
          payloadHash: winner.payloadHash,
          accepted: true,
          appliedTick: tick,
          routeRevision: null,
          reason: null,
          recordedTick: tick,
        }
      : null;
  if (terminal !== null) intentionPublications.push(terminal);

  for (const loser of arbitration.losers) {
    if (loser.candidate.requestId === null || loser.candidate.payloadHash === null) continue;
    intentionPublications.push({
      requestId: loser.candidate.requestId,
      payloadHash: loser.candidate.payloadHash,
      accepted: false,
      appliedTick: null,
      routeRevision: null,
      reason: loser.code,
      recordedTick: tick,
    });
  }

  const disposedContinuous: ArrivalOrdinal[] = continuous === null ? [] : [continuous.arrival.ordinal];

  return {
    winner,
    losers: arbitration.losers,
    watermarkBefore: view.watermark,
    watermarkAfter,
    latchedKindBefore: view.latchedKind,
    latchedKindAfter,
    heldBefore: view.heldDirectGeneration,
    heldAfter,
    drive,
    inputSource,
    modeBefore: view.state.locomotion.mode,
    modeAfter: modeForDrive(drive),
    intentionCommitted: winner !== null,
    purge,
    terminal,
    consumed: continuous === null ? null : continuous.arrival,
    rejected: continuous?.refusal ?? null,
    keptContinuous: input.remainingContinuous
      .filter((arrival) => !purgedOrdinals.has(arrival.ordinal))
      .map((arrival) => arrival.ordinal),
    keptDiscrete,
    disposedContinuous,
    disposedDiscrete,
    intentionPublications,
  };
};

const renderedBoolean = (arrival: ArrivalRecord, field: string): boolean | null => {
  const rendered = arrival.raw[field];
  if (rendered === undefined || rendered.kind !== 'value') return null;
  return typeof rendered.value === 'boolean' ? rendered.value : null;
};
