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
}

/** One row of the reconciled Phase 2 scenario inventory. */
interface ScenarioVerdict {
  readonly scenario: string;
  readonly source: string;
  readonly replayed: boolean;
  readonly coverage:
    | 'replayed-in-room-journal'
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
  const probeCandidates = [
    ...(process.env['UDG_PR14_RESULT'] === undefined ? [] : [resolve(process.cwd(), process.env['UDG_PR14_RESULT'])]),
    resolve(OUT_DIR, '../probes/PR-14.probe-result.json'),
    resolve(ROOT, 'artifacts/probes/PR-14.probe-result.json'),
  ];
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
  const scenarioVerdicts: ScenarioVerdict[] = [];
  const populationFile = existsSync(populationPath)
    ? (JSON.parse(readFileSync(populationPath, 'utf8')) as PopulationFile)
    : null;
  const populationResult = results.find((entry) => entry.source === 'journal-population.json');
  if (populationFile !== null) {
    for (const range of populationFile.scenarioRanges) {
      const rows = populationFile.rows.slice(range.rowStart, range.rowEnd);
      const inScope = dispositionsOf(rows).length;
      const coverage: ScenarioVerdict['coverage'] = populationResult?.replayed !== true
        ? 'room-not-replayable'
        : rows.length > 0
          ? 'replayed-in-room-journal'
          : range.surface === 'authority'
            // The scenario drove seats, but the watermark sample landed on the same row count: the frames it
            // sent were journalled in a neighbouring window (or never reached stage F at all, which is what
            // a same-tick closure does). Either way it is NOT a replayed case here, and it is not the same
            // thing as a scenario that decides nothing.
            ? 'authority-rows-in-an-adjacent-window'
            : range.surface === 'earlier-window'
              ? 'asserts-over-an-earlier-window'
              : 'no-authority-surface';
      scenarioVerdicts.push({
        scenario: range.scenario,
        source: 'abuse-population',
        replayed: coverage === 'replayed-in-room-journal',
        coverage,
        rowsInScope: rows.length,
        dispositionsInScope: inScope,
        roomReplayEqual: populationResult?.equal ?? false,
        pass: range.pass,
        reason:
          coverage === 'replayed-in-room-journal'
            ? 'its watermark range holds rows, and every one of them is in the compared whole-room sequence'
            : coverage === 'asserts-over-an-earlier-window'
              // The row watermark is sampled when the verdict is RECORDED, so a scenario that asserts over
              // seats that ran a moment earlier owns no rows of its own. Its claim is still checked; it
              // simply has no rows of its own to attribute, and saying so beats counting it as replayed.
              ? 'no rows in its own watermark range: the scenario asserts over an earlier window, and the row counter is sampled when the verdict is recorded'
              : coverage === 'authority-rows-in-an-adjacent-window'
                // Named separately because collapsing it into "no authority surface" would let a scenario that
                // drove seats and closed on the same tick look like one that never touched the authority.
                ? 'drove seats but owns no rows in its own watermark range: its arrivals were journalled in a neighbouring window, or the same-tick closure meant stage F never ran for them'
                : coverage === 'no-authority-surface'
                  ? 'no authority decisions at all: this scenario measures configuration loading, telemetry presence or disposal'
                : 'the room journal was not replayable — see missingInputs',
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
  const verdict = replayedRooms.length > 0 && failedRooms.length === 0 ? 'pass' : 'fail';

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
    scenariosReplayed: scenarioVerdicts.filter((entry) => entry.replayed).length,
    unreplayed: unreplayed.length,
    missingInputs: missingInputs.length,
  };
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
