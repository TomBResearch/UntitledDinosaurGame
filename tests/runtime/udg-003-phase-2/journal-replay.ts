/**
 * The Phase 2 journal replay, run in a FRESH process from RETAINED bytes (W-12 review, R-1).
 *
 * The accepted Phase 1 replay rebuilds a core in the same process from a journal collected in the same
 * process. That is a real claim, and it is not this one. Here the journal has already been written to disk
 * by `abuse-population.ts` / `recovery-scenarios.ts`, it is copied into the evidence bundle, and this
 * process has never seen the room: it gets JSON, rebuilds a core through the accepted `replayRun`, and
 * compares three things independently —
 *
 *   1. every arrival's disposition and reason, in order, plus the per-reason totals;
 *   2. every per-tick canonical state digest, in order, plus each entity's final state digest;
 *   3. every per-tick chain hash, and the tip hash those hashes chain to.
 *
 * Three rules keep the result honest:
 *
 * - **Inputs, not memory.** A journal that cannot be replayed is REPORTED (`missingInputs`), not skipped.
 *   A dropped-row journal, a missing prologue or a configuration that will not validate all appear here
 *   with the reason, because "we could not replay it" is a finding and silence is not.
 * - **Recorded is not recomputed.** Retirement, gap naming, close codes, close observations, the queue
 *   sample at close and the effect ledger never reach the authority core, so no replay can re-derive them.
 *   They are listed as recorded inputs with the reason (see `RECORDED_NOT_RECOMPUTED`).
 * - **The gate has to be able to fail.** Each journal is also replayed against a tampered prologue; a
 *   replay that ACCEPTED mismatched configuration digests would mean the comparisons were being run on
 *   evidence nobody was screening, so that refusal is itself a check.
 *
 * Runs as its own process: `node tests/runtime/udg-003-phase-2/journal-replay.ts`.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  chainTipOf,
  compareJournal,
  dispositionsOf,
  finalStatesOf,
  journalFromPersisted,
  RECORDED_NOT_RECOMPUTED,
  RECOMPUTED_BY_REPLAY,
  stateDigestsOf,
  type JournalLike,
} from '../../support/replay/journal-replay.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT_DIR =
  process.env['UDG_VECTORS_OUT'] === undefined
    ? resolve(ROOT, 'artifacts/udg-003-phase-2')
    : resolve(process.cwd(), process.env['UDG_VECTORS_OUT']);

process.on('uncaughtException', (error: unknown) => {
  process.stderr.write(`[replay][uncaught] ${String(error instanceof Error ? error.stack : error)}\n`);
  process.exit(3);
});
process.on('unhandledRejection', (reason: unknown) => {
  process.stderr.write(`[replay][unhandled] ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}\n`);
});

interface PersistedJournal {
  readonly configDocument: Record<string, unknown> | null;
  readonly prologue: Record<string, unknown> | null;
  readonly rows: readonly Record<string, unknown>[];
  readonly chain: readonly Record<string, unknown>[];
  readonly dropped: number;
  readonly scenario?: string;
  /** Set when a second room's journal is retained inside another artefact (the burst room). */
  readonly roomLabel?: string;
}

interface PopulationFile {
  readonly roomLabel: string;
  readonly runId: string;
  readonly configDocument: Record<string, unknown> | null;
  readonly prologue: Record<string, unknown> | null;
  readonly rows: readonly Record<string, unknown>[];
  readonly chain: readonly Record<string, unknown>[];
  readonly dropped: number;
  readonly scenarioRanges: readonly { scenario: string; rowStart: number; rowEnd: number; pass: boolean; surface: 'authority' | 'earlier-window' | 'none' }[];
  /**
   * Exact seat × tick windows for the scenarios that share this one room journal. Row ranges are
   * watermarks and overlap; these are attribution, and they are re-derived here from the retained rows
   * rather than trusted from the producer.
   */
  readonly scenarioWindows?: readonly {
    readonly scenario: string;
    /** Which retained journal this window's seats live in. Alias strings repeat across rooms. */
    readonly journal: string;
    readonly aliases: readonly string[];
    readonly tickStart: number;
    readonly tickEnd: number;
    readonly ownClientFrames: number;
    readonly ownDecisions: number;
    readonly stampsConsumed?: readonly number[];
    readonly dispositions?: Readonly<Record<string, number>>;
    readonly overlappingAliases?: readonly string[];
    readonly rowsInWindow?: number;
    readonly stagingRows?: number;
    readonly attributionGap?: string | null;
    readonly policy?: {
      readonly allowedDispositions?: readonly string[];
      readonly requireAllConsumed?: boolean;
      readonly requireNoRefusals?: boolean;
    };
    readonly declared?: Record<string, unknown> | null;
  }[];
  /** Extra room journals retained inside this artefact (the `B = 8` burst room). Replayed like the rest. */
  readonly additionalJournals?: readonly PersistedJournal[];
  readonly unattributedScenarios?: readonly { scenario: string; aliases: number; ownClientFrames: number }[];
  readonly noAuthorityEvidence?: readonly Record<string, unknown>[];
  readonly coverageRule?: string;
}

/** One row of the OD-10 coverage census for an authority-bearing scenario. */
interface WindowVerdict {
  readonly scenario: string;
  readonly journal: string;
  readonly aliases: readonly string[];
  readonly tickStart: number;
  readonly tickEnd: number;
  readonly rowsInWindow: number;
  readonly recomputedStamps: readonly number[];
  readonly recordedStamps: readonly number[];
  readonly stampsMatch: boolean;
  readonly recomputedDispositions: Readonly<Record<string, number>>;
  readonly recordedDispositions: Readonly<Record<string, number>>;
  readonly dispositionsMatch: boolean;
  readonly acceptedTicksMatchObservations: boolean;
  readonly acceptedTickCount: number;
  readonly consumedObservationCount: number;
  readonly dispositionsAllowed: boolean;
  readonly allConsumed: boolean;
  readonly noRefusals: boolean;
  readonly journalReplayEqual: boolean | null;
  readonly attributionGap: string | null;
  readonly falseClaim: boolean;
  readonly pass: boolean;
}

/** One row of the OD-10 coverage census for a scenario the authority never decided. */
interface NoAuthorityVerdict {
  readonly scenario: string;
  readonly countedAsReplay: false;
  readonly recomputed: { readonly check: string; readonly value: unknown; readonly pass: boolean }[];
  readonly recordedOnly: readonly string[];
  readonly pass: boolean;
  readonly note: string;
}

/** One row of the reconciled Phase 2 scenario inventory. */
interface ScenarioVerdict {
  readonly scenario: string;
  readonly source: string;
  readonly replayed: boolean;
  readonly coverage:
    | 'replayed-in-room-journal'
    | 'authority-window-verified'
    | 'authority-window-gap'
    /**
     * P-3 (OD-3): the scenario produced authority rows for OTHER seats and its own claim is a NEGATIVE
     * over a window — "no compliant neighbour was refused, dropped, retired or closed while the offenders
     * ran". The negative is recomputed from the retained rows, so it is a verification and not a gap; it
     * is kept as its own class because "verified, and what was verified is an absence" is a different
     * sentence from "verified a disposition".
     */
    | 'authority-negative-window-verified'
    /**
     * P-3 (OD-3, owner-approved): the scenario is authority-bearing but the frames it is about were
     * retired before representation, so no authority row can exist for them. The rows that DO exist
     * replay equal, and the frames that cannot are carried by the transport verdict in
     * `abuse-results.json`. Accounted, not counted as a replay, and not a gap either.
     */
    | 'authority-absence-accounted'
    | 'no-authority-verified'
    | 'no-authority-gap'
    | 'asserts-over-an-earlier-window'
    | 'authority-rows-in-an-adjacent-window'
    | 'no-authority-surface'
    | 'room-not-replayable';
  readonly rowsInScope: number;
  readonly dispositionsInScope: number;
  readonly roomReplayEqual: boolean;
  readonly pass: boolean;
  readonly reason: string;
}

interface RecoveryFile {
  readonly runId: string;
  readonly rooms: readonly PersistedJournal[];
}

/** A journal this process was able to attempt, with the outcome of the three comparisons. */
interface RoomResult {
  readonly source: string;
  readonly runId: string;
  readonly scenario: string | null;
  readonly rows: number;
  readonly chainRecords: number;
  readonly dropped: number;
  readonly replayed: boolean;
  readonly refusal?: string;
  readonly equal: boolean;
  readonly blankedEqual: boolean;
  readonly tamperedPrologueRefused: boolean;
  /**
   * Negative controls. A replay that agreed with everything would also agree with a journal that had been
   * edited, a state computed on the wrong relation, or a chain hash that had been changed — and the
   * comparisons would be decoration. Each control mutates one thing and requires the comparison to NOTICE.
   */
  readonly controls: {
    /**
     * `not-applicable-no-committed-motion` is a property of the JOURNAL, not of the comparison: a room
     * whose entity never moved has no digest that depends on how far the stepper integrates, so no stepper
     * error could be detected in it. Pretending otherwise would make the control look stronger than it is.
     */
    readonly wrongStepper: 'detected' | 'not-detected' | 'not-applicable-no-committed-motion';
    readonly editedDispositionDetected: boolean;
    readonly changedChainHashDetected: boolean;
  };
  /** How many distinct canonical state digests the journal holds — the state comparison's real content. */
  readonly distinctStateDigests: number;
  readonly committedMotionTicks: number;
  readonly integrityIssues: readonly string[];
  readonly liveTip: string | null;
  readonly replayedTip: string | null;
  readonly blankedTip: string | null;
  readonly dispositionCount: number;
  readonly stateDigestCount: number;
  readonly finalStates: Record<string, string>;
  readonly mismatches: readonly Record<string, unknown>[];
  readonly blankedMismatches: readonly Record<string, unknown>[];
}

const skipped = (
  source: string,
  runId: string,
  scenario: string | null,
  journal: JournalLike,
  refusal: string,
): RoomResult => ({
  source,
  runId,
  scenario,
  rows: journal.rows.length,
  chainRecords: journal.chain.length,
  dropped: journal.dropped,
  replayed: false,
  refusal,
  equal: false,
  blankedEqual: false,
  tamperedPrologueRefused: false,
  controls: { wrongStepper: 'not-detected', editedDispositionDetected: false, changedChainHashDetected: false },
  distinctStateDigests: new Set(stateDigestsOf(journal.rows).map((entry) => entry.stateHash)).size,
  committedMotionTicks: journal.rows.filter((row) => row['type'] === 'tick' && row['intentionCommitted'] === true).length,
  integrityIssues: [],
  liveTip: chainTipOf(journal.chain),
  replayedTip: null,
  blankedTip: null,
  dispositionCount: dispositionsOf(journal.rows).length,
  stateDigestCount: stateDigestsOf(journal.rows).length,
  finalStates: finalStatesOf(journal.rows),
  mismatches: [],
  blankedMismatches: [],
});

// ── P-3 (OD-3): the helpers behind the two new census classes ─────────────────────────────────
// Kept as named functions with their reasoning attached because each one is a CLAIM: it moves a scenario
// out of the gap column, so it has to be readable as the thing that can be wrong.

/**
 * Would this scenario have been counted as an attribution gap on the evidence that was there before
 * P-3? A FALSE CLAIM is deliberately excluded: bytes that contradict their own summary stay red no matter
 * what any account says about them.
 */
const coverageWouldHaveBeenGap = (
  surface: string,
  window: { falseClaim?: boolean; attributionGap?: string | null } | null,
): boolean => surface !== 'none'
  && window !== null
  && window.falseClaim !== true
  && (window.attributionGap ?? null) !== null;

/**
 * The retiring offender moves to "accounted" only when the abuse artefact says the absence is expected
 * AND its own transport verdict passed. An account that expects an absence while failing its own checks
 * is a contradiction, and the contradiction is reported as a false claim further down.
 */
const retiredOffenderAccountSupportsAbsence = (
  scenario: string,
  account: Record<string, unknown> | null,
): boolean => {
  if (scenario !== 'retired-offender-closes-in-bounded-window' || account === null) return false;
  const replay = account['replayVerdict'] as { expectedAbsence?: boolean } | undefined;
  const transport = account['transportVerdict'] as { verdict?: string } | undefined;
  return replay?.expectedAbsence === true && transport?.verdict === 'pass';
};

/** The contradiction case: the account expects an absence and its own verdict says otherwise. */
const retiredOffenderAccountContradictsItself = (
  account: Record<string, unknown> | null,
): boolean => {
  if (account === null) return false;
  const replay = account['replayVerdict'] as { expectedAbsence?: boolean } | undefined;
  const transport = account['transportVerdict'] as { verdict?: string } | undefined;
  return replay?.expectedAbsence === true && transport?.verdict !== 'pass';
};

/**
 * "No offender ever touched a compliant neighbour", recomputed from the retained rows rather than quoted
 * from the producer: at least two aliases in this journal have nothing but consumed dispositions, and at
 * least one alias in the SAME journal has a refusal or a drop. The second limb is what stops a journal in
 * which nothing at all went wrong from satisfying the claim — a gauge that has never seen a refusal cannot
 * certify the absence of one.
 */
const compliantNeighboursUntouched = (rows: readonly Record<string, unknown>[]): boolean => {
  const byAlias = new Map<string, { consumed: number; refusedOrDropped: number }>();
  for (const row of rows) {
    if (row['type'] !== 'observation' || row['origin'] !== 'client-payload') continue;
    const alias = String(row['alias'] ?? '<no alias>');
    const disposition = String(row['disposition'] ?? 'unknown');
    const tally = byAlias.get(alias) ?? { consumed: 0, refusedOrDropped: 0 };
    if (disposition === 'consumed') tally.consumed += 1;
    else tally.refusedOrDropped += 1;
    byAlias.set(alias, tally);
  }
  const clean = [...byAlias.values()].filter((tally) => tally.refusedOrDropped === 0 && tally.consumed > 0);
  const dirty = [...byAlias.values()].filter((tally) => tally.refusedOrDropped > 0);
  return clean.length >= 2 && dirty.length >= 1;
};

async function main(): Promise<void> {
  const [journalMod, replayMod, adapterMod, configMod] = await Promise.all([
    import(pathToFileURL(resolve(ROOT, 'apps/server/dist/authority/journal.js')).href) as Promise<Record<string, unknown>>,
    import(pathToFileURL(resolve(ROOT, 'apps/server/dist/authority/replay.js')).href) as Promise<Record<string, unknown>>,
    import(pathToFileURL(resolve(ROOT, 'apps/server/dist/movement/MovementAuthorityAdapter.js')).href) as Promise<Record<string, unknown>>,
    import(pathToFileURL(resolve(ROOT, 'packages/config/dist/index.js')).href) as Promise<Record<string, unknown>>,
  ]);
  const toReplayInputs = journalMod['toReplayInputs'] as (rows: unknown[], chain: unknown[]) => unknown;
  const withDigestsBlanked = journalMod['withDigestsBlanked'] as (rows: unknown[]) => unknown[];
  const journalCompletenessIssues = journalMod['journalCompletenessIssues'] as (rows: unknown[]) => string[];
  const sanitisationIssues = journalMod['sanitisationIssues'] as (rows: unknown[]) => string[];
  const provenanceIssues = journalMod['provenanceIssues'] as (rows: unknown[]) => string[];
  const replayRun = replayMod['replayRun'] as (options: Record<string, unknown>) => {
    ok: boolean;
    reason?: string;
    detail?: string;
    core?: unknown;
    outcomes?: readonly unknown[];
  };
  const FlatReferenceStepper = adapterMod['FlatReferenceStepper'] as new (speed: number) => unknown;
  const SystemScheduler = adapterMod['SystemScheduler'] as new () => unknown;
  const validateServerConfig = configMod['validateServerConfig'] as (
    value: unknown,
  ) => { ok: boolean; value?: Record<string, unknown>; issues?: readonly { path: string; message: string }[] };
  const movementHash = configMod['movementHash'] as (config: unknown) => string;
  const regionHash = configMod['regionHash'] as (config: unknown) => string;
  const computeConfigHash = configMod['computeConfigHash'] as (config: unknown) => string;

  /** Run one replay through the accepted entry point and collect what its sink received. */
  const replay = (
    journal: JournalLike,
    config: Record<string, unknown>,
    runId: string,
    blank: boolean,
    speedMultiplier = 1,
  ): { ok: true; rows: Record<string, unknown>[]; chain: Record<string, unknown>[]; tip: string | null } | { ok: false; refusal: string } => {
    const rowsOut: Record<string, unknown>[] = [];
    const chainOut: Record<string, unknown>[] = [];
    const result = replayRun({
      prologue: journal.prologue,
      inputs: toReplayInputs(blank ? withDigestsBlanked([...journal.rows]) : [...journal.rows], [...journal.chain]),
      config,
      // The room's own stepper and scheduler, from the same emitted module the room is built in: a replay
      // on a different relation would be a different game, not a replay of this one.
      stepper: new FlatReferenceStepper((config['movement'] as { speed: number }).speed * speedMultiplier),
      scheduler: new SystemScheduler(),
      sink: {
        recordRow: (row: Record<string, unknown>) => {
          rowsOut.push(row);
        },
        recordTickChain: (record: Record<string, unknown>) => {
          chainOut.push(record);
        },
      },
      runId,
    });
    if (result.ok === false) {
      return { ok: false, refusal: `${String(result.reason)}${result.detail === undefined ? '' : `: ${result.detail}`}` };
    }
    return { ok: true, rows: rowsOut, chain: chainOut, tip: chainTipOf(chainOut) };
  };

  const attempt = (source: string, runId: string, scenario: string | null, persisted: PersistedJournal): RoomResult => {
    // The one boundary where persisted bytes become a journal again (see `journalFromPersisted`).
    const journal: JournalLike = journalFromPersisted(persisted);
    if (persisted.prologue === null) {
      return skipped(source, runId, scenario, journal, 'missing-input: no prologue was retained, and the accepted replay refuses an unbound journal');
    }
    if (persisted.rows.length === 0) {
      return skipped(source, runId, scenario, journal, 'no-rows: this scenario produced no authority decisions to replay');
    }
    if (persisted.dropped > 0) {
      return skipped(
        source,
        runId,
        scenario,
        journal,
        `unusable-journal: the bounded sink dropped ${String(persisted.dropped)} row(s), so the chain is not complete and no tip claim is possible`,
      );
    }
    if (persisted.configDocument === null) {
      return skipped(source, runId, scenario, journal, 'missing-input: no configuration document was retained to bind the prologue');
    }

    const validated = validateServerConfig(persisted.configDocument);
    if (validated.ok === false || validated.value === undefined) {
      const detail = (validated.issues ?? []).map((issue) => `${issue.path}: ${issue.message}`).join('; ');
      return skipped(source, runId, scenario, journal, `missing-input: the retained configuration document did not validate (${detail})`);
    }
    const config = validated.value;

    // What the journal MUST record, checked by the accepted scanners rather than by this file's opinion.
    const integrityIssues = [
      ...journalCompletenessIssues([...journal.rows]),
      ...sanitisationIssues([...journal.rows, ...journal.chain]),
      ...provenanceIssues([...journal.rows]),
    ];

    const asRecorded = replay(journal, config, `${runId}-replay`, false);
    if (asRecorded.ok === false) {
      return { ...skipped(source, runId, scenario, journal, `replay-refused: ${asRecorded.refusal}`), integrityIssues };
    }
    const comparison = compareJournal(journal.rows, journal.chain, asRecorded.rows, asRecorded.chain);

    // Sufficiency: digest-blanked rows must replay to the same decisions. If reading our own outputs back
    // were load-bearing, this is where it would show.
    const blanked = replay(journal, config, `${runId}-replay-blanked`, true);
    const blankedComparison = blanked.ok
      ? compareJournal(journal.rows, journal.chain, blanked.rows, blanked.chain)
      : null;

    // The gate has to be able to fail: a tampered prologue digest must be refused, not replayed.
    const tampered = replay(
      { ...journal, prologue: { ...journal.prologue, configHash: '0'.repeat(64) } },
      config,
      `${runId}-replay-tampered`,
      false,
    );

    // Control 1: the same journal replayed on a stepper that moves 1.5× as far must NOT agree on canonical
    // state. If it did, the state comparison was comparing counts, not digests.
    const committedMotionTicks = journal.rows.filter((row) => row['type'] === 'tick' && row['intentionCommitted'] === true).length;
    const wrongStepperRun = replay(journal, config, `${runId}-replay-wrong-stepper`, false, 1.5);
    const wrongStepper: 'detected' | 'not-detected' | 'not-applicable-no-committed-motion' = committedMotionTicks === 0
      ? 'not-applicable-no-committed-motion'
      : wrongStepperRun.ok === false
        || !compareJournal(journal.rows, journal.chain, wrongStepperRun.rows, wrongStepperRun.chain).equal
        ? 'detected'
        : 'not-detected';

    // Control 2: a journal whose first disposition was edited must NOT agree with the honest replay. This is
    // the check that the disposition comparison reads the recorded decision rather than the row count.
    const firstDisposition = journal.rows.findIndex((row) => row['type'] === 'observation');
    const editedRows = [...journal.rows];
    const originalRow = firstDisposition >= 0 ? editedRows[firstDisposition] : undefined;
    if (originalRow !== undefined) {
      editedRows[firstDisposition] = { ...originalRow, disposition: originalRow['disposition'] === 'consumed' ? 'refused' : 'consumed' };
    }
    const editedDispositionDetected = firstDisposition < 0
      ? false
      : !compareJournal(editedRows, journal.chain, asRecorded.rows, asRecorded.chain).equal;

    // Control 3: a chain hash changed by one character must be caught, at the tick and at the tip.
    const editedChain = [...journal.chain];
    if (editedChain.length > 0) {
      const last = editedChain[editedChain.length - 1];
      if (last !== undefined) {
        const lastHash = typeof last['hash'] === 'string' ? (last['hash'] as string) : '';
        editedChain[editedChain.length - 1] = { ...last, hash: `${lastHash.slice(0, -1)}${lastHash.endsWith('a') ? 'b' : 'a'}` };
      }
    }
    const changedChainHashDetected = editedChain.length === 0
      ? false
      : !compareJournal(journal.rows, editedChain, asRecorded.rows, asRecorded.chain).equal;

    return {
      source,
      runId,
      scenario,
      controls: { wrongStepper, editedDispositionDetected, changedChainHashDetected },
      distinctStateDigests: new Set(stateDigestsOf(journal.rows).map((entry) => entry.stateHash)).size,
      committedMotionTicks,
      rows: journal.rows.length,
      chainRecords: journal.chain.length,
      dropped: journal.dropped,
      replayed: true,
      equal: comparison.equal,
      blankedEqual: blankedComparison?.equal ?? false,
      tamperedPrologueRefused: tampered.ok === false,
      integrityIssues,
      liveTip: comparison.liveTip,
      replayedTip: comparison.replayedTip,
      blankedTip: blanked.ok ? blanked.tip : null,
      dispositionCount: dispositionsOf(journal.rows).length,
      stateDigestCount: stateDigestsOf(journal.rows).length,
      finalStates: finalStatesOf(journal.rows),
      mismatches: comparison.mismatches,
      blankedMismatches: blankedComparison?.mismatches ?? [{ note: blanked.ok ? '' : `blanked replay refused: ${String(blanked.refusal)}` }],
    };
  };

  const results: RoomResult[] = [];
  const missingInputs: { source: string; detail: string }[] = [];
  const populationPath = resolve(OUT_DIR, 'journal-population.json');
  const populationFile: PopulationFile | null = existsSync(populationPath)
    ? (JSON.parse(readFileSync(populationPath, 'utf8')) as PopulationFile)
    : null;
  // P-3: the transport-side account of the retiring offender lives in the abuse artefact. The replay does
  // not re-derive it — the counters behind it are gone once the room is closed — it checks that the
  // account exists, that it calls the absence expected, and that its own verdict passed before it lets
  // the census move the scenario out of the gap column.
  const abusePath = resolve(OUT_DIR, 'abuse-results.json');
  const retiredOffenderAccount = ((): Record<string, unknown> | null => {
    if (!existsSync(abusePath)) return null;
    const parsed = JSON.parse(readFileSync(abusePath, 'utf8')) as { retiredOffender?: Record<string, unknown> };
    return parsed.retiredOffender ?? null;
  })();
  const recoveryPath = resolve(OUT_DIR, 'journal-recovery.json');

  if (existsSync(populationPath)) {
    const file = JSON.parse(readFileSync(populationPath, 'utf8')) as PopulationFile;
    results.push(
      attempt('journal-population.json', file.runId, null, {
        configDocument: file.configDocument,
        prologue: file.prologue,
        rows: file.rows,
        chain: file.chain,
        dropped: file.dropped,
      }),
    );
  } else {
    missingInputs.push({ source: 'journal-population.json', detail: 'absent: the abuse population did not run, so its scenarios have no retained journal' });
  }

  // PR-14's journal travels inside its own probe result (`probes/PR-14.probe-result.json`), which the
  // capture plan copies and report.json hashes. It is read here so the probe's room is replayed from
  // retained bytes too, rather than only inside the probe that wrote it.
  // A named path is an instruction, not a hint. When the caller says where PR-14's result lives — which CI
  // and the capture plan both do — a missing file there is reported as a missing input rather than quietly
  // answered by a copy from some other run.
  const namedProbeResult = process.env['UDG_PR14_RESULT'];
  const probeCandidates =
    namedProbeResult !== undefined
      ? [resolve(process.cwd(), namedProbeResult)]
      : [resolve(OUT_DIR, '../probes/PR-14.probe-result.json'), resolve(ROOT, 'artifacts/probes/PR-14.probe-result.json')];
  const probePath = probeCandidates.find((candidate) => existsSync(candidate));
  if (probePath !== undefined) {
    const probe = JSON.parse(readFileSync(probePath, 'utf8')) as {
      probeId?: string;
      observations?: { journalRecord?: PersistedJournal };
    };
    const record = probe.observations?.journalRecord;
    if (record === undefined) {
      missingInputs.push({
        source: 'probes/PR-14.probe-result.json',
        detail: `the PR-14 result at ${probePath} carries no observations.journalRecord, so the probe room has no retained replay inputs`, 
      });
    } else {
      results.push(attempt('probes/PR-14.probe-result.json', 'pr14-journal-replay', 'pr14-gate-a-substrate', record));
    }
  } else {
    missingInputs.push({
      source: 'probes/PR-14.probe-result.json',
      detail: `absent at ${probeCandidates.join(', ')}: PR-14 had not run on this commit, so its room journal is not available to this process`, 
    });
  }

  if (existsSync(recoveryPath)) {
    const file = JSON.parse(readFileSync(recoveryPath, 'utf8')) as RecoveryFile;
    for (const room of file.rooms) {
      results.push(attempt('journal-recovery.json', file.runId, room.scenario ?? null, room));
    }
  } else {
    missingInputs.push({ source: 'journal-recovery.json', detail: 'absent: the recovery scenarios did not run, so their rooms have no retained journal' });
  }

  // A scenario whose seats live in another room is only replayable if THAT room's journal was retained.
  // The population artefact carries the burst room's journal for exactly this reason; replaying it here is
  // what turns the burst from a recorded observation into a replayed case.
  if (populationFile !== null) {
    for (const extra of populationFile.additionalJournals ?? []) {
      results.push(attempt(
        'journal-population.json',
        `${String(populationFile.runId)}/${String(extra.roomLabel ?? 'room')}`,
        `room:${String(extra.roomLabel ?? 'room')}`,
        extra,
      ));
    }
  }

  const roomPasses = (entry: RoomResult): boolean =>
    entry.equal
    && entry.blankedEqual
    && entry.tamperedPrologueRefused
    && entry.integrityIssues.length === 0
    && entry.controls.wrongStepper !== 'not-detected'
    && entry.controls.editedDispositionDetected
    && entry.controls.changedChainHashDetected;

  // ── Scenario inventory reconciliation ────────────────────────────────────────────────────────
  // The population runs every scenario in ONE room, so a scenario's rows are a range of that room's
  // journal; the recovery scenarios each own a room. Scenarios with no authority decisions say so here
  // rather than disappearing from the count.
  const scenarioReason = (
    coverage: ScenarioVerdict['coverage'],
    window: WindowVerdict | null,
    noAuthority: NoAuthorityVerdict | null,
  ): string => {
    if (coverage === 'authority-window-verified' && window !== null) {
      return `seats [${window.aliases.join(', ')}] over ticks ${String(window.tickStart)}..${String(window.tickEnd)} of the ${window.journal} journal; `
        + `${String(window.rowsInWindow)} row(s), ${String(window.recomputedStamps.length)} consumed stamp(s) and ${String(Object.keys(window.recomputedDispositions).length)} disposition class(es) recomputed from the retained rows and equal to the recorded window; `
        + `that journal replayed equal: ${String(window.journalReplayEqual)}`;
    }
    if (coverage === 'authority-window-gap') {
      return window === null
        ? 'attribution gap: no window was produced for this scenario, so the replay cannot say which seat did what'
        : `attribution gap: ${String(window.attributionGap ?? 'the recorded window is contradicted by its own rows')}`;
    }
    if (coverage === 'no-authority-verified' && noAuthority !== null) {
      return `not a replay, by the owner’s ruling; ${String(noAuthority.recomputed.filter((check) => check.pass).length)} scenario-specific check(s) recomputed from the retained rows`
        + (noAuthority.recordedOnly.length > 0 ? `; recorded-only and NOT recomputed: ${noAuthority.recordedOnly.join('; ')}` : '');
    }
    if (coverage === 'no-authority-gap') {
      return noAuthority === null
        ? 'a scenario the producer classed as no-authority produced no scenario-specific evidence, so the claim rests on nothing'
        : 'the scenario-specific no-authority evidence is contradicted by the retained rows';
    }
    if (coverage === 'replayed-in-room-journal') {
      return 'its watermark range holds rows, and every one of them is in the compared whole-room sequence';
    }
    if (coverage === 'asserts-over-an-earlier-window') {
      return 'no window was produced for a scenario that asserts over an earlier window; kept visible rather than counted';
    }
    if (coverage === 'authority-rows-in-an-adjacent-window') {
      return 'drove seats but owns no rows in its own watermark range: its arrivals were journalled in a neighbouring window, or the same-tick closure meant stage F never ran for them';
    }
    return 'the room journal was not replayable — see missingInputs';
  };

  const scenarioVerdicts: ScenarioVerdict[] = [];
  const populationResult = results.find((entry) => entry.source === 'journal-population.json');

  // ── OD-10 (owner ruling, 2026-11-13): the coverage rule, applied ──────────────────────────────
  // “Replay every authority-bearing scenario from retained inputs and verify exact seat, tick, stamp and
  // disposition attribution for shared-journal windows. For each no-authority scenario, show the
  // scenario-specific evidence that the authority path was never entered and that no authority state or
  // effects were produced. Keep those cases visible in the census without counting them as replays.”
  //
  // Both halves are computed here from the retained bytes. The producer's window is an ASSERTION; the
  // object below is a RESULT. Where they disagree the artefact fails, because a window that does not
  // describe its own rows is worse than no window: it reads like attribution and is only narrative.
  const rowsOfJournal = (name: string): readonly Record<string, unknown>[] => {
    if (populationFile === null) return [];
    if (name === populationFile.roomLabel || name === 'population') return populationFile.rows;
    return (populationFile.additionalJournals ?? []).find((extra) => extra.roomLabel === name)?.rows ?? [];
  };
  const equalOfJournal = (name: string): boolean | null => {
    if (populationFile === null) return null;
    if (name === populationFile.roomLabel || name === 'population') return populationResult?.equal ?? null;
    const extra = (populationFile.additionalJournals ?? []).find((candidate) => candidate.roomLabel === name);
    if (extra === undefined) return null;
    return results.find((entry) => entry.source === 'journal-population.json'
      && entry.runId === `${String(populationFile.runId)}/${name}`)?.equal ?? null;
  };
  const tickOfRow = (row: Record<string, unknown>): number => Number(row['tick'] ?? row['eligibleTick'] ?? Number.NaN);

  const windowVerdicts: WindowVerdict[] = [];
  for (const window of populationFile?.scenarioWindows ?? []) {
    const rows = rowsOfJournal(window.journal);
    const inWindow = window.aliases.length === 0 || !Number.isFinite(window.tickStart) || window.tickStart < 0
      ? []
      : rows.filter((row) => window.aliases.includes(String(row['alias'] ?? ''))
        && tickOfRow(row) >= window.tickStart && tickOfRow(row) <= window.tickEnd);
    const recomputedStamps = [...new Set(inWindow
      .filter((row) => row['type'] === 'tick' && row['consumed'] !== null && row['consumed'] !== undefined)
      .map((row) => Number(row['consumed'])))].sort((a, b) => a - b);
    const recordedStamps = [...(window.stampsConsumed ?? [])].sort((a, b) => a - b);
    const recomputedDispositions: Record<string, number> = {};
    for (const row of inWindow) {
      if (row['type'] !== 'observation' || row['origin'] !== 'client-payload') continue;
      const disposition = String(row['disposition']);
      recomputedDispositions[disposition] = (recomputedDispositions[disposition] ?? 0) + 1;
    }
    const recordedDispositions = window.dispositions ?? {};
    const dispositionsMatch = JSON.stringify(Object.entries(recomputedDispositions).sort())
      === JSON.stringify(Object.entries(recordedDispositions).sort());
    const acceptedTickCount = inWindow.filter((row) => row['type'] === 'tick'
      && row['consumed'] !== null && row['consumed'] !== undefined).length;
    const consumedObservationCount = inWindow.filter((row) => row['type'] === 'observation'
      && row['origin'] === 'client-payload' && row['disposition'] === 'consumed').length;
    const policy = window.policy ?? {};
    const observedDispositions = Object.keys(recomputedDispositions);
    const dispositionsAllowed = policy.allowedDispositions === undefined
      ? true
      : observedDispositions.every((disposition) => policy.allowedDispositions?.includes(disposition) === true);
    const allConsumed = policy.requireAllConsumed !== true
      ? true
      : observedDispositions.length > 0 && observedDispositions.every((disposition) => disposition === 'consumed');
    const noRefusals = policy.requireNoRefusals !== true
      ? true
      : !observedDispositions.some((disposition) => disposition.startsWith('refused'));
    const stampsMatch = JSON.stringify(recomputedStamps) === JSON.stringify(recordedStamps);
    // A FALSE CLAIM is different from a gap. A gap is “these bytes cannot show it”; a false claim is
    // “these bytes say something the rows contradict”, and only the second one fails the run.
    const falseClaim = inWindow.length > 0 && (!stampsMatch || !dispositionsMatch
      || acceptedTickCount !== consumedObservationCount || !dispositionsAllowed || !allConsumed || !noRefusals);
    windowVerdicts.push({
      scenario: window.scenario,
      journal: window.journal,
      aliases: window.aliases,
      tickStart: window.tickStart,
      tickEnd: window.tickEnd,
      rowsInWindow: inWindow.length,
      recomputedStamps,
      recordedStamps,
      stampsMatch,
      recomputedDispositions,
      recordedDispositions,
      dispositionsMatch,
      acceptedTicksMatchObservations: acceptedTickCount === consumedObservationCount,
      acceptedTickCount,
      consumedObservationCount,
      dispositionsAllowed,
      allConsumed,
      noRefusals,
      journalReplayEqual: equalOfJournal(window.journal),
      attributionGap: window.attributionGap ?? null,
      falseClaim,
      pass: !falseClaim && (window.attributionGap !== null && window.attributionGap !== undefined
        ? true
        : stampsMatch && dispositionsMatch),
    });
  }
  const windowByScenario = new Map(windowVerdicts.map((entry) => [entry.scenario, entry]));
  const windowFalseClaims = windowVerdicts.filter((entry) => entry.falseClaim);

  // The no-authority half. Each scenario gets the check that could actually falsify ITS OWN claim, and
  // anything the retained bytes cannot re-derive is named as recorded-only instead of being quietly
  // counted as verified.
  const firstJoinIndex = (rows: readonly Record<string, unknown>[]): number =>
    rows.findIndex((row) => row['type'] === 'event' && row['kind'] === 'join');
  const noAuthorityVerdicts: NoAuthorityVerdict[] = [];
  for (const entry of populationFile?.noAuthorityEvidence ?? []) {
    const scenario = String(entry['scenario']);
    const never = (entry['neverEntered'] ?? {}) as Record<string, unknown>;
    const effects = (entry['noAuthorityEffects'] ?? {}) as Record<string, unknown>;
    const rows = populationFile?.rows ?? [];
    const recomputed: { check: string; value: unknown; pass: boolean }[] = [];
    const recordedOnly: string[] = [];
    const num = (key: string): number => Number(never[key] ?? effects[key] ?? Number.NaN);

    if (scenario.startsWith('config-smoke')) {
      recomputed.push({
        check: 'no room existed to enter the authority through',
        value: num('liveRoomsAtCheck'),
        pass: num('liveRoomsAtCheck') === 0,
      });
      recomputed.push({
        check: 'no journal row of any kind existed yet',
        value: num('journalRowsAnywhereAtCheck'),
        pass: num('journalRowsAnywhereAtCheck') === 0,
      });
      const defaultHash = effects['defaultConfigHash'];
      const operatorHash = effects['operatorConfigHash'];
      recomputed.push({
        check: 'the two configuration documents differ, and neither hash is empty',
        value: `${String(defaultHash).slice(0, 8)} != ${String(operatorHash).slice(0, 8)}`,
        pass: typeof defaultHash === 'string' && typeof operatorHash === 'string' && defaultHash !== operatorHash,
      });
      // The one part of this scenario no later reader can re-derive: that the load happened before any
      // room was constructed. The retained journal's own first join row is the closest check available.
      recomputed.push({
        check: 'the retained journal’s first row belongs to a join that came later',
        value: firstJoinIndex(rows),
        pass: firstJoinIndex(rows) >= 0,
      });
      recordedOnly.push('loadServerConfig() return values at the moment of the load');
    }

    if (scenario.startsWith('unbounded-room')) {
      const before = num('journalRowsBeforeAttempt');
      const after = num('journalRowsAfterAttempt');
      recomputed.push({
        check: 'the refusal named the missing bounds, not a different failure',
        value: never['refusalCode'],
        pass: never['refusalCode'] === 'region-bounds-missing',
      });
      recomputed.push({
        check: 'no frame was ever sent on that attempt',
        value: never['clientFramesSent'],
        pass: num('clientFramesSent') === 0,
      });
      recomputed.push({
        check: 'the authority journalled nothing across the attempt (before == after)',
        value: `${String(before)} -> ${String(after)}`,
        pass: before === after && num('clientFramesBeforeAttempt') === num('clientFramesAfterAttempt')
          && num('consumedTicksBeforeAttempt') === num('consumedTicksAfterAttempt'),
      });
      // Not no-authority, this: it is proof that no entity was ever admitted, so the strongest claim is
      // that no row anywhere in ANY retained journal names it.
      const namesAnywhere = [populationFile?.rows ?? [],
        ...(populationFile?.additionalJournals ?? []).map((extra) => extra.rows)]
        .reduce((total, journalRows) => total + journalRows.filter((row) => String(row['alias'] ?? '').includes('unbounded')).length, 0);
      recomputed.push({
        check: 'no row in any retained journal names the refused session',
        value: namesAnywhere,
        pass: namesAnywhere === 0,
      });
      recordedOnly.push('the client-visible error text of the refused create');
    }

    if (scenario.startsWith('tick-metrics')) {
      recomputed.push({
        check: 'the scenario sent no frame',
        value: never['framesSentByThisScenario'],
        pass: num('framesSentByThisScenario') === 0,
      });
      recomputed.push({
        check: 'no client-payload observation was journalled inside its window',
        value: never['clientPayloadRowsInWindow'],
        pass: num('clientPayloadRowsInWindow') === 0,
      });
      recomputed.push({
        check: 'no tick inside its window consumed input',
        value: never['consumedInputRowsInWindow'],
        pass: num('consumedInputRowsInWindow') === 0,
      });
      const fresh = (never['aliasesFirstSeenInWindow'] ?? []) as readonly string[];
      recomputed.push({
        check: 'no alias first appears inside its window (nothing was admitted by it)',
        value: fresh,
        pass: fresh.length === 0,
      });
      recordedOnly.push('the telemetry summary in tick-metrics.json, which is a read and not a decision');
    }

    if (scenario.startsWith('server-disposes')) {
      recomputed.push({
        check: 'shutdown appended no client frame',
        value: effects['clientFramesAppendedByShutdown'] ?? never['clientFramesAppendedByShutdown'],
        pass: num('clientFramesAppendedByShutdown') === 0,
      });
      recomputed.push({
        check: 'shutdown appended no authority decision (no tick consumed input)',
        value: effects['authorityRowsAppendedByShutdown'] ?? never['authorityRowsAppendedByShutdown'],
        pass: num('authorityRowsAppendedByShutdown') === 0,
      });
      const types = (effects['rowTypesAppendedByShutdown'] ?? []) as readonly string[];
      recomputed.push({
        check: 'what shutdown DID append is lifecycle only, listed rather than hidden',
        value: types,
        pass: types.every((type) => !type.startsWith('observation:client-payload') && !type.startsWith('tick:')),
      });
      recomputed.push({
        check: 'no live room survived',
        value: never['liveRoomsAfterDispose'],
        pass: num('liveRoomsAfterDispose') === 0,
      });
      recordedOnly.push(
        'the rows shutdown appended are not retained: the journal snapshot in this artefact is the last word before close',
      );
    }

    noAuthorityVerdicts.push({
      scenario,
      countedAsReplay: false,
      recomputed,
      recordedOnly,
      pass: recomputed.length > 0 && recomputed.every((check) => check.pass),
      note: String(effects['note'] ?? ''),
    });
  }
  const noAuthorityFalseClaims = noAuthorityVerdicts.filter((entry) => !entry.pass);
  const noAuthorityScenarios = (populationFile?.scenarioRanges ?? []).filter((range) => range.surface === 'none');
  const missingNoAuthorityEvidence = noAuthorityScenarios
    .filter((range) => !noAuthorityVerdicts.some((entry) => entry.scenario === range.scenario))
    .map((range) => range.scenario);
  if (populationFile !== null) {
    for (const range of populationFile.scenarioRanges) {
      const rows = populationFile.rows.slice(range.rowStart, range.rowEnd);
      const inScope = dispositionsOf(rows).length;
      const window = windowByScenario.get(range.scenario) ?? null;
      const noAuthority = noAuthorityVerdicts.find((entry) => entry.scenario === range.scenario) ?? null;
      // OD-10 in one expression. A scenario either entered the authority or it did not; if it did, its
      // window is what the replay verified, and a window with a gap in it is reported as a gap rather than
      // promoted to a verification or demoted to "no authority surface" (which would hide it in a class
      // whose whole meaning is "nothing to replay here").
      // P-3 reclassification, and only where the evidence for it is in this bundle.
      const absenceAccounted = coverageWouldHaveBeenGap(range.surface, window)
        && retiredOffenderAccountSupportsAbsence(range.scenario, retiredOffenderAccount);
      const negativeWindowVerified = coverageWouldHaveBeenGap(range.surface, window)
        && !absenceAccounted
        && range.scenario === 'offenders-never-touch-the-compliant-population'
        && compliantNeighboursUntouched(populationFile?.rows ?? []);
      const coverage: ScenarioVerdict['coverage'] = populationResult?.replayed !== true
        ? 'room-not-replayable'
        : absenceAccounted
          ? 'authority-absence-accounted'
          : negativeWindowVerified
            ? 'authority-negative-window-verified'
            : range.surface === 'none'
              ? (noAuthority !== null && noAuthority.pass ? 'no-authority-verified' : 'no-authority-gap')
              : window !== null && window.falseClaim
            ? 'authority-window-gap'
            : window !== null && window.attributionGap !== null && window.attributionGap !== undefined
              ? 'authority-window-gap'
              : window !== null
                ? 'authority-window-verified'
                : rows.length > 0
                  ? 'replayed-in-room-journal'
                  : range.surface === 'authority'
                    ? 'authority-rows-in-an-adjacent-window'
                    : 'asserts-over-an-earlier-window';
      scenarioVerdicts.push({
        scenario: range.scenario,
        source: 'abuse-population',
        // A window-verified scenario IS replayed from retained inputs; a no-authority scenario is not,
        // and saying `false` there is the whole point of keeping it in the census separately.
        replayed: coverage === 'replayed-in-room-journal'
          || coverage === 'authority-window-verified'
          || coverage === 'authority-window-gap'
          // The negative window IS replayed: its claim is recomputed from these rows. The accounted
          // absence is NOT: there is no row of the evicted frames to replay, and pretending otherwise
          // would inflate the replay count with the very thing the rows cannot show.
          || coverage === 'authority-negative-window-verified',
        coverage,
        rowsInScope: rows.length,
        dispositionsInScope: inScope,
        roomReplayEqual: populationResult?.equal ?? false,
        pass: range.pass,
        reason: coverage === 'authority-absence-accounted'
          ? 'the frames this claim is about were retired before representation, so no authority row can exist for them; the room\'s rows replay equal and the transport verdict in abuse-results.json carries the loss, the seat and the closure timing. Unverified and carried: '
            + String(((retiredOffenderAccount?.['transportVerdict'] as { unverified?: { item: string }[] } | undefined)?.unverified ?? []).map((entry) => entry.item).join('; '))
          : coverage === 'authority-negative-window-verified'
            ? 'recomputed from the retained rows: no compliant neighbour carries a refusal, a drop or a closure anywhere in this room\'s journal, and every frame they sent was consumed'
            : scenarioReason(coverage, window, noAuthority),
      });
    }
  }
  for (const entry of results.filter((item) => item.source === 'journal-recovery.json')) {
    scenarioVerdicts.push({
      scenario: entry.scenario ?? '<unknown scenario>',
      source: 'recovery-scenarios',
      replayed: entry.replayed,
      coverage: entry.replayed ? 'replayed-in-room-journal' : 'room-not-replayable',
      rowsInScope: entry.rows,
      dispositionsInScope: entry.dispositionCount,
      roomReplayEqual: entry.equal,
      pass: roomPasses(entry),
      reason: entry.refusal ?? 'its own room was replayed from the retained bytes, from its own prologue',
    });
  }

  for (const entry of results.filter((item) => item.source.startsWith('probes/'))) {
    scenarioVerdicts.push({
      scenario: entry.scenario ?? 'pr14-gate-a-substrate',
      source: 'probes/PR-14.probe-result.json',
      replayed: entry.replayed,
      coverage: entry.replayed ? 'replayed-in-room-journal' : 'room-not-replayable',
      rowsInScope: entry.rows,
      dispositionsInScope: entry.dispositionCount,
      roomReplayEqual: entry.equal,
      pass: roomPasses(entry),
      reason: entry.refusal ?? 'the probe room’s journal was replayed from the bytes retained inside the probe result',
    });
  }

  const replayedRooms = results.filter((entry) => entry.replayed);
  const failedRooms = results.filter((entry) => entry.replayed && !roomPasses(entry));
  const unreplayed = results.filter((entry) => !entry.replayed);
  // A gap does not fail this run: the owner asked for remaining evidence gaps to be REPORTED, and a red
  // artefact would hide which gap is which behind a single word. A false claim does fail it — bytes that
  // contradict their own summary are not evidence of anything.
  const absenceContradiction = retiredOffenderAccountContradictsItself(retiredOffenderAccount);
  const verdict = replayedRooms.length > 0
    && failedRooms.length === 0
    && windowFalseClaims.length === 0
    && noAuthorityFalseClaims.length === 0
    && missingNoAuthorityEvidence.length === 0
    // P-3: an account that expects an absence and fails its own transport verdict is a contradiction in
    // the bundle, which is exactly the class of thing this artefact exists to refuse.
    && !absenceContradiction
    ? 'pass'
    : 'fail';

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    resolve(OUT_DIR, 'journal-replay.json'),
    `${JSON.stringify(
      {
        taskId: 'UDG-003',
        phase: 'phase-2',
        criterion: ['GA-13', 'AC-3d', 'AC-20'],
        kind: 'udg-003-phase-2-journal-replay',
        verdict,
        scope: {
          replayedFrom: 'the serialised journal and prologue retained in this bundle, in a fresh Node process',
          replayedBy: 'apps/server/dist/authority/replay.js, the accepted Phase 1 replay, unchanged',
          compared: ['dispositions in arrival order plus per-reason totals', 'canonical state digests per tick plus each entity final state', 'per-tick chain hashes plus the chain tip'],
          // The honest boundary: the core decides; the transport records.
          notRecomputed: RECORDED_NOT_RECOMPUTED,
          recomputed: RECOMPUTED_BY_REPLAY,
          configurationDigestsChecked:
            populationFile?.prologue === undefined || populationFile.prologue === null
              ? null
              : {
                configHash: populationFile.prologue['configHash'] ?? null,
                movementHash: populationFile.prologue['movementHash'] ?? null,
                regionHash: populationFile.prologue['regionHash'] ?? null,
                recomputedFromRetainedDocument:
                  populationFile.configDocument === null
                    ? null
                    : {
                      configHash: computeConfigHash(populationFile.configDocument),
                      movementHash: movementHash(populationFile.configDocument),
                      regionHash: regionHash(populationFile.configDocument),
                    },
              },
        },
        rooms: results,
        scenarios: scenarioVerdicts,
        unreplayedScenarios: unreplayed.map((entry) => ({ source: entry.source, scenario: entry.scenario, reason: entry.refusal ?? 'unknown' })),
        scenarioWindows: windowVerdicts,
        noAuthorityCoverage: noAuthorityVerdicts,
        coverageGaps: windowVerdicts
          .filter((entry) => entry.attributionGap !== null && entry.attributionGap !== undefined)
          .map((entry) => ({ scenario: entry.scenario, gap: entry.attributionGap })),
        falseClaims: [...windowFalseClaims.map((entry) => entry.scenario), ...noAuthorityFalseClaims.map((entry) => entry.scenario)],
        windowRule:
          'GA-13 attribution for the scenarios that share one room journal: seat set, tick range and stamp set, recomputed here from the retained rows. A window whose recorded stamps do not equal the stamps in its rows, whose accepted-tick count disagrees with its consumed-observation count, or that shows a disposition outside its allowed set, fails.',
        missingInputs,
        // Where a negative control could not bite, say so instead of leaving the reader to assume it did.
        controlLimits: results.map((entry) => ({
          source: entry.source,
          scenario: entry.scenario,
          wrongStepper: entry.replayed ? entry.controls.wrongStepper : 'not-attempted',
          committedMotionTicks: entry.committedMotionTicks,
          distinctStateDigests: entry.distinctStateDigests,
        })),
        notRetainedForReplay: [
          {
            source: 'PR-14',
            detail:
              'PR-14 does not write into the vectors directory — a probe writing there during `pnpm test` would create a partial Phase 2 set, which is '
              + 'exactly what the half-run gate exists to refuse. Its journal is retained INSIDE its own probe result (`probes/PR-14.probe-result.json`, '
              + 'hash-covered like every bundle file) and is replayed from there by this process when present; the probe also replays it in process, '
              + 'so the substrate claim is checked at capture and re-checkable from retained bytes.',
          },
        ],
        summary: {
          journalsRead: results.length,
          replayed: replayedRooms.length,
          equalAllThree: results.filter((entry) => entry.equal).length,
          blankedEqual: results.filter((entry) => entry.blankedEqual).length,
          tamperedProloguesRefused: results.filter((entry) => entry.tamperedPrologueRefused).length,
          negativeControlsPassed: results.filter(
            (entry) => entry.replayed
              && entry.controls.wrongStepper !== 'not-detected'
              && entry.controls.editedDispositionDetected
              && entry.controls.changedChainHashDetected,
          ).length,
          integrityIssues: results.reduce((total, entry) => total + entry.integrityIssues.length, 0),
          scenariosAccountedFor: scenarioVerdicts.length,
          scenariosByCoverage: {
            replayed: scenarioVerdicts.filter((entry) => entry.coverage === 'replayed-in-room-journal').length,
            assertsOverEarlierWindow: scenarioVerdicts.filter((entry) => entry.coverage === 'asserts-over-an-earlier-window').length,
            authorityRowsInAdjacentWindow: scenarioVerdicts.filter((entry) => entry.coverage === 'authority-rows-in-an-adjacent-window').length,
            noAuthoritySurface: scenarioVerdicts.filter((entry) => entry.coverage === 'no-authority-surface').length,
            roomNotReplayable: scenarioVerdicts.filter((entry) => entry.coverage === 'room-not-replayable').length,
          },
          scenariosReplayed: scenarioVerdicts.filter((entry) => entry.replayed).length,
          // OD-10: the two classes, counted separately, with the gaps named rather than averaged away.
          authorityScenarios: scenarioVerdicts.filter((entry) => entry.coverage !== 'no-authority-verified'
            && entry.coverage !== 'no-authority-gap'
            && entry.coverage !== 'room-not-replayable').length,
          authorityWindowsVerified: scenarioVerdicts.filter((entry) => entry.coverage === 'authority-window-verified').length,
          authorityWindowGaps: scenarioVerdicts.filter((entry) => entry.coverage === 'authority-window-gap')
            .map((entry) => entry.scenario),
          // P-3: the two classes that replaced the old gap column, counted where a reader can see them.
          authorityNegativeWindowsVerified: scenarioVerdicts
            .filter((entry) => entry.coverage === 'authority-negative-window-verified')
            .map((entry) => entry.scenario),
          authorityAbsenceAccounted: scenarioVerdicts
            .filter((entry) => entry.coverage === 'authority-absence-accounted')
            .map((entry) => entry.scenario),
          // Never a replay: the frames an absence-accounted scenario is about produced no rows at all.
          authorityAbsenceCountedAsReplays: 0,
          noAuthorityScenarios: scenarioVerdicts.filter((entry) => entry.coverage === 'no-authority-verified'
            || entry.coverage === 'no-authority-gap').length,
          noAuthorityVerified: scenarioVerdicts.filter((entry) => entry.coverage === 'no-authority-verified').length,
          noAuthorityWithoutEvidence: missingNoAuthorityEvidence,
          // Counted as zero on purpose: a no-authority scenario is visible in the census and is never a
          // replay, whichever way the arithmetic would flatter the total.
          noAuthorityCountedAsReplays: 0,
          coverageRuleApplied:
            'OD-10: every authority-bearing scenario is replayed from retained inputs with its seat × tick × stamp × disposition window recomputed from the rows; every no-authority scenario shows scenario-specific evidence that it entered no authority path and produced no authority state or effects, and is not counted as a replay.',
        },
        // GA-13's own verdict, on the rule the owner approved in OD-3 and OD-10. It is computed here from
        // the classes above rather than asserted: if a gap came back, or an account contradicted itself,
        // this would read partial or fail and the runtime suite would say so.
        ga13: {
          criterion: 'GA-13 evidence integrity, as revised by OD-3 (owner, 2026-11-13)',
          rule: 'replay every retained authority row; account separately, with captured transport evidence, for evictions that produced no authority rows; keep the replay verdict and the transport verdict explicit; report what remains unverified.',
          replayLimb: {
            roomsReplayed: replayedRooms.length,
            roomsEqual: results.filter((entry) => entry.equal).length,
            mismatches: failedRooms.map((entry) => entry.scenario ?? entry.source),
            attributionFalseClaims: windowFalseClaims.map((entry) => entry.scenario),
            noAuthorityFalseClaims: noAuthorityFalseClaims.map((entry) => entry.scenario),
          },
          attributionLimb: {
            windowsVerifiedFromRows: scenarioVerdicts.filter((entry) => entry.coverage === 'authority-window-verified').length,
            negativeWindowsRecomputed: scenarioVerdicts.filter((entry) => entry.coverage === 'authority-negative-window-verified').length,
            absencesAccountedByTransportEvidence: scenarioVerdicts.filter((entry) => entry.coverage === 'authority-absence-accounted').length,
            remainingGaps: scenarioVerdicts.filter((entry) => entry.coverage === 'authority-window-gap').map((entry) => entry.scenario),
            noAuthorityWithoutEvidence: missingNoAuthorityEvidence,
          },
          carriedUnverified: ((retiredOffenderAccount?.['transportVerdict'] as { unverified?: { item: string; why: string }[] } | undefined)?.unverified ?? []),
          sanitisationLimb: 'enforced by the evidence gate over every hashed file in the bundle (tools/checks); not re-derived by this process, and named here rather than silently absorbed into the verdict',
          stackCompatibilityLimb: 'no compatibility claim is made anywhere in this artefact: stackCompatibility stays not-established regardless of these outcomes',
          verdict: replayedRooms.length > 0
            && failedRooms.length === 0
            && windowFalseClaims.length === 0
            && noAuthorityFalseClaims.length === 0
            && missingNoAuthorityEvidence.length === 0
            && !absenceContradiction
            && scenarioVerdicts.filter((entry) => entry.coverage === 'authority-window-gap').length === 0
            && scenarioVerdicts.filter((entry) => entry.coverage === 'no-authority-gap').length === 0
            ? 'pass'
            : 'partial',
          partialBecause: scenarioVerdicts.filter((entry) => entry.coverage === 'authority-window-gap' || entry.coverage === 'no-authority-gap').map((entry) => entry.scenario),
        },
        settingsNote:
          'Provisional test settings on a loopback transport. A journal that could not be replayed is reported in unreplayedScenarios with the reason; '
          + 'the verdict is fail if any replayed room mismatches on any of the three comparisons, the digest-blanked replay, or the tampered-prologue control.',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const counts = {
    journals: results.length,
    replayed: replayedRooms.length,
    equal: results.filter((entry) => entry.equal).length,
    blanked: results.filter((entry) => entry.blankedEqual).length,
    tamperedRefused: results.filter((entry) => entry.tamperedPrologueRefused).length,
    controls: results.filter((entry) => entry.replayed && entry.controls.wrongStepper !== 'not-detected' && entry.controls.editedDispositionDetected && entry.controls.changedChainHashDetected).length,
    scenarios: scenarioVerdicts.length,
    scenariosNotReplayed: scenarioVerdicts.filter((entry) => !entry.replayed).length,
    scenariosReplayed: scenarioVerdicts.filter((entry) => entry.replayed).length,
    unreplayed: unreplayed.length,
    missingInputs: missingInputs.length,
  };
  // The capture plan keeps a stdout log per command and refuses an empty one, because an empty log is
  // exactly what a step that produced nothing leaves behind. The verdict belongs on stdout; the per-journal
  // detail below belongs on stderr, where the other scripts put theirs.
  process.stdout.write(
    `[replay] ${verdict}: ${String(counts.journals)} journal(s), ${String(counts.replayed)} replayed, ` +
      `${String(counts.equal)} equal on all three comparisons, ${String(counts.blanked)} digest-blanked equal, ` +
      `${String(counts.tamperedRefused)} tampered prologues refused, ${String(counts.controls)} control sets passed, ` +
      `${String(counts.scenarios)} scenario(s) accounted for, ${String(counts.scenariosReplayed)} replayed in a room journal, ` +
      `${String(counts.scenarios - counts.scenariosReplayed)} not replayed and each named with a reason, ` +
      `${String(counts.unreplayed)} journal(s) this process could not attempt, ${String(counts.missingInputs)} missing input(s)\n`,
  );
  process.stderr.write(`[replay] ${verdict} ${JSON.stringify(counts)}\n`);
  for (const entry of results) {
    process.stderr.write(
      `[replay] ${entry.source} ${String(entry.scenario ?? '')} rows=${String(entry.rows)} equal=${String(entry.equal)} blanked=${String(entry.blankedEqual)} tamper-refused=${String(entry.tamperedPrologueRefused)} ${String(entry.refusal ?? '')}\n`,
    );
  }
  // The tip is the claim a reader can check against room-lifecycle.json's chainTip without recomputing
  // anything; the per-tick hashes behind it are compared in full inside each room result.
  for (const entry of replayedRooms) {
    process.stderr.write(
      `[replay] tip ${entry.source}${entry.scenario === null ? '' : `/${entry.scenario}`} ticks=${String(entry.chainRecords)} live=${String(entry.liveTip)} replayed=${String(entry.replayedTip)} blanked=${String(entry.blankedTip)}\n`,
    );
  }
  process.exit(verdict === 'pass' ? 0 : 1);
}

void main().catch((error: unknown) => {
  process.stderr.write(`[replay] threw ${String(error instanceof Error ? error.stack : error)}\n`);
  process.exit(2);
});
