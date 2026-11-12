/**
 * The input envelope and client recovery budget (ADR-0003; UDG-003 Phase 2 W-3).
 *
 * These are the numbers ADR-0003 says must be *declared rather than ambient*: the admitted-rate
 * envelope the compliant sender stays inside, the closure bounds that make an offender consequence
 * finite, and the client-side recovery budget the amended §3.2 resolves. They live in configuration
 * — and therefore inside `configHash` — because a client and a server that disagree about the
 * envelope cannot honestly reconcile a retirement: the same byte is compliant under one digest and
 * an offender under another.
 *
 * **Every value here is a provisional test setting** (owner decision D7-G, confirmed by D-P2-4 and
 * D-P2-8): production values are a Gate A measurement (GA-11), and UDG-SPIKE-001 runs that gate.
 * Nothing in this module is tuned; the numbers are the ones ADR-0003 §2 and the amended §3.2 name,
 * and the two the ADR leaves to measurement (the jitter allowance `J` and the stall window `G`)
 * carry the reasons for their provisional choices next to them.
 *
 * What is deliberately **not** here: the abuse limits Phase 1 keeps outside `configHash` under its
 * D-4 (payload byte bounds, discrete queue ceilings, the fps abuse envelope). Those decide what the
 * server *refuses*; the values below declare what the *protocol promises*, and only that half is
 * hashed. The owner's D-P2-4 approval names exactly these entries.
 */

import { RESERVED_CLOSE_CODES } from '@udg/protocol';
import { canonicalHash } from './hash.js';
import {
  buildBlock,
  checkPositive,
  checkRange,
  configError,
  configFail,
  deepFreeze,
  emptyBooleans,
  isRecord,
  checkKnownKeys,
  readNumericFields,
  type ConfigIssue,
  type ConfigResult,
} from './validation.js';
import { CONFIG_BOUNDS } from './limits.js';

/** The hashed input-envelope block. Field meanings are the clauses in the comments. */
export interface InputEnvelopeConfig {
  /**
   * `λ` — the admitted continuous-input rate: at most one frame per entity per authority tick
   * (ADR-0003 §2 commitment 1). Whole frames per tick; a larger value would break the one-input
   * rule (P03 stage Q) that this whole phase is built on.
   */
  readonly inputRatePerTick: number;
  /**
   * `B` — the pressure margin: `INPUT_QUEUE_PRESSURE` is observed at
   * `accessor.size >= bufferMaxSize − B` (ADR-0003 §3.3). Pressure throttles; it never closes.
   */
  readonly bufferPressureMargin: number;
  /**
   * `J` — the jitter allowance in frames, the term that makes the envelope inequality
   * `B + J·λ + stall ≤ bufferMaxSize` evaluable at GA-11. **Provisional test value**: ADR-0003
   * names `J` as a measured quantity; 2 frames (100 ms at the default 20 Hz tick) is the smallest
   * allowance that survives the accepted 100 ms patch interval, and it is *a setting*, not a
   * measurement. GA-11 re-derives it from the jitter population.
   */
  readonly jitterAllowanceFrames: number;
  /**
   * The buffer bound the envelope is expressed against: 32 frames per client, the same value the
   * accepted authority core declares for its continuous queue (`CONTINUOUS_QUEUE_CAPACITY`).
   * Declared here so the envelope inequality is checkable against one hashed number rather than a
   * comment pointing at a constant in another package.
   */
  readonly bufferMaxSize: number;
  /**
   * `closureWindowMs` — how long the bounded closure window stays open after the confirming step
   * (ADR-0003 §3.3): the window ends at the earliest of (final publication sent **and** this elapsed),
   * `closureMaxMs`, or the client leaving. Provisional test setting, ADR-0003 §2.
   */
  readonly closureWindowMs: number;
  /**
   * `closureMaxMs` — the hard cap on the closure window. Provisional test setting; note the
   * relationship §3.2 relies on: `clientSnapshotDeadlineMs` (500) is *below* this value, so a
   * stalled client recovers while the server is still inside its window (GA-7).
   */
  readonly closureMaxMs: number;
  /**
   * `G` — the stall window: `INPUT_ACK_STALLED` needs neither the acknowledgement nor
   * `inputResolvedThrough` to advance across this many **consecutive state deliveries** with the
   * epoch unchanged (§3.2). **Provisional test value**: 3 deliveries is three patch intervals at
   * the default cadence, wider than any skew PR-15 measured between ack and state (they arrive in
   * one delivery), and narrower than the client deadline at the default cadence. GA-6 re-derives
   * the tolerable window from the delivery population.
   */
  readonly stallDetectionDeliveries: number;
  /**
   * `clientSnapshotDeadlineMs` — the client-local deadline that runs from the last **accepted state
   * delivery** and expires whether or not any delivery arrives (§3.2; PR-15 is why it exists).
   * Provisional test setting.
   */
  readonly clientSnapshotDeadlineMs: number;
  /**
   * `clientRecoveryDeadlineMs` — the recovery-**episode** deadline, measured from the start of the
   * episode (§3.2 as amended 2026-11-11, owner decision D-P2-8). The name is the operative one the
   * amendment mandates: it bounds one episode rather than budgeting attempts.
   */
  readonly clientRecoveryDeadlineMs: number;
  /**
   * The rolling rejoin allowance (§3.2 as amended): at most `rejoinWindowAllowance` **actual**
   * rejoins counted in any trailing `rejoinWindowSeconds` window, per entity across episodes. The
   * amendment resolved the old attempt-budget contradiction in favour of this cap.
   */
  readonly rejoinWindowSeconds: number;
  readonly rejoinWindowAllowance: number;
  /**
   * The backoff ladder — a **schedule, not an entitlement**: an attempt is made at the next ladder
   * step only if the rolling allowance has room and the episode deadline has not expired. With the
   * amended cap of two rejoins, the third rung exists so the schedule is defined for a client that
   * re-entered the window, not so a third rejoin becomes reachable inside one episode.
   */
  readonly rejoinBackoffMs: readonly [number, number, number];
  /**
   * The close codes this deployment may terminate a seat under. Declared, hashed, and checked
   * against the protocol's reserved set at validation: configuration cannot invent a close code the
   * protocol has not reserved, and a client that hashes the same config knows the three it must be
   * able to interpret.
   */
  readonly closeCodes: {
    readonly INPUT_RETIRED_UNREPRESENTED: number;
    readonly INPUT_RATE_CEILING: number;
    readonly INPUT_RECOVERY: number;
  };
  /**
   * `INPUT_RATE_CEILING` observation bound, messages per second per session, above which the seat
   * closes directly (§3.3). Provisional test setting: λ × `tickRate` admits 20 Hz at one frame per
   * tick; 40/s is double the admitted rate, so the ceiling cannot fire on the envelope's normal
   * edge and a sustained breach is unambiguous. GA-11 re-derives it from the offender population.
   */
  readonly rateCeilingMessagesPerSecond: number;
  /**
   * Whether a dedupe signature may terminate a seat. **Disabled, and the only honest value until
   * PE-1…PE-5 pass with their retained evidence (GA-12; owner decision D-P2-6).** The signal stays
   * diagnostic — record, attribute, may throttle, never close — and this flag makes the "never" a
   * configuration fact a reviewer can check rather than a promise in a comment.
   */
  readonly dedupeClosureEnabled: boolean;
}

export const INPUT_ENVELOPE_KEYS = [
  'inputRatePerTick',
  'bufferPressureMargin',
  'jitterAllowanceFrames',
  'bufferMaxSize',
  'closureWindowMs',
  'closureMaxMs',
  'stallDetectionDeliveries',
  'clientSnapshotDeadlineMs',
  'clientRecoveryDeadlineMs',
  'rejoinWindowSeconds',
  'rejoinWindowAllowance',
  'rejoinBackoffMs',
  'closeCodes',
  'rateCeilingMessagesPerSecond',
  'dedupeClosureEnabled',
] as const;

/**
 * The default M0 test settings: the ADR-0003 §2 numbers verbatim, the amended §3.2 budget verbatim,
 * and the two measured quantities (`J`, `G`) at the disclosed provisional values above.
 * GA-11 replaces them with measured production values; until it does, these are what every
 * scenario — including the compliance ones — runs on, and the records say so.
 */
export const INPUT_ENVELOPE_DEFAULTS = {
  inputRatePerTick: 1,
  bufferPressureMargin: 8,
  jitterAllowanceFrames: 2,
  bufferMaxSize: 32,
  closureWindowMs: 250,
  closureMaxMs: 1000,
  stallDetectionDeliveries: 3,
  clientSnapshotDeadlineMs: 500,
  clientRecoveryDeadlineMs: 4000,
  rejoinWindowSeconds: 60,
  rejoinWindowAllowance: 2,
  rejoinBackoffMs: [250, 500, 1000],
  closeCodes: {
    INPUT_RETIRED_UNREPRESENTED: RESERVED_CLOSE_CODES.INPUT_RETIRED_UNREPRESENTED,
    INPUT_RATE_CEILING: RESERVED_CLOSE_CODES.INPUT_RATE_CEILING,
    INPUT_RECOVERY: RESERVED_CLOSE_CODES.INPUT_RECOVERY,
  },
  rateCeilingMessagesPerSecond: 40,
  dedupeClosureEnabled: false,
} as const satisfies InputEnvelopeConfig;

/**
 * Validate the envelope block.
 *
 * Beyond the per-field ranges, the checks that matter are the *relational* ones — the numbers form
 * one policy, and a block that satisfies every range yet breaks a relation is incoherent:
 * - the envelope inequality (`B + J·λ + stall ≤ bufferMaxSize`, GA-11's left side) must hold with
 *   the stall term at one tick's worth of frames, or the declared pressure margin can never be
 *   observed before the buffer itself overflows;
 * - `clientSnapshotDeadlineMs < closureMaxMs` is the §3.2 relationship GA-7 tests from both sides;
 * - the episode deadline must outlast the snapshot deadline and the first two backoff rungs, or the
 *   amended budget can expire before its own first rejoin is due;
 * - the close codes must be exactly the protocol's reserved set.
 */
export const validateInputEnvelopeConfig = (raw: unknown): ConfigResult<Readonly<InputEnvelopeConfig>> => {
  const issues: ConfigIssue[] = [];
  if (!isRecord(raw)) {
    return configError([configFail('input', 'WRONG_TYPE', 'must be an object')]);
  }
  issues.push(...checkKnownKeys('input', raw, INPUT_ENVELOPE_KEYS));

  const numeric = readNumericFields(raw, 'input', [
    { key: 'inputRatePerTick', check: (v) => checkRange('input.inputRatePerTick', v, CONFIG_BOUNDS.inputRatePerTick.min, CONFIG_BOUNDS.inputRatePerTick.max) },
    { key: 'bufferPressureMargin', check: (v) => checkRange('input.bufferPressureMargin', v, CONFIG_BOUNDS.bufferPressureMargin.min, CONFIG_BOUNDS.bufferPressureMargin.max) },
    { key: 'jitterAllowanceFrames', check: (v) => checkRange('input.jitterAllowanceFrames', v, CONFIG_BOUNDS.jitterAllowanceFrames.min, CONFIG_BOUNDS.jitterAllowanceFrames.max) },
    { key: 'bufferMaxSize', check: (v) => checkRange('input.bufferMaxSize', v, CONFIG_BOUNDS.bufferMaxSize.min, CONFIG_BOUNDS.bufferMaxSize.max) },
    { key: 'closureWindowMs', check: (v) => checkPositive('input.closureWindowMs', v) },
    { key: 'closureMaxMs', check: (v) => checkPositive('input.closureMaxMs', v) },
    { key: 'stallDetectionDeliveries', check: (v) => checkRange('input.stallDetectionDeliveries', v, CONFIG_BOUNDS.stallDetectionDeliveries.min, CONFIG_BOUNDS.stallDetectionDeliveries.max) },
    { key: 'clientSnapshotDeadlineMs', check: (v) => checkPositive('input.clientSnapshotDeadlineMs', v) },
    { key: 'clientRecoveryDeadlineMs', check: (v) => checkPositive('input.clientRecoveryDeadlineMs', v) },
    { key: 'rejoinWindowSeconds', check: (v) => checkRange('input.rejoinWindowSeconds', v, CONFIG_BOUNDS.rejoinWindowSeconds.min, CONFIG_BOUNDS.rejoinWindowSeconds.max) },
    { key: 'rejoinWindowAllowance', check: (v) => checkRange('input.rejoinWindowAllowance', v, CONFIG_BOUNDS.rejoinWindowAllowance.min, CONFIG_BOUNDS.rejoinWindowAllowance.max) },
    { key: 'rateCeilingMessagesPerSecond', check: (v) => checkPositive('input.rateCeilingMessagesPerSecond', v) },
  ]);
  issues.push(...numeric.issues);

  for (const key of ['inputRatePerTick', 'bufferPressureMargin', 'jitterAllowanceFrames', 'bufferMaxSize', 'stallDetectionDeliveries', 'rejoinWindowSeconds', 'rejoinWindowAllowance', 'rateCeilingMessagesPerSecond'] as const) {
    const value = numeric.values[key];
    if (value !== undefined && !Number.isInteger(value)) {
      issues.push(configFail(`input.${key}`, 'OUT_OF_RANGE', 'must be a whole number'));
    }
  }

  // The ladder: three whole positive milliseconds, strictly increasing (250/500/1000 is a schedule;
  // an unordered triple is a schedule nobody can follow).
  const ladderRaw = raw['rejoinBackoffMs'];
  let ladder: readonly number[] = [];
  if (!Array.isArray(ladderRaw) || ladderRaw.length !== 3) {
    issues.push(configFail('input.rejoinBackoffMs', 'WRONG_TYPE', 'must be exactly three backoff steps in milliseconds'));
  } else {
    ladder = ladderRaw;
    ladder.forEach((step, index) => {
      if (typeof step !== 'number' || !Number.isFinite(step) || !Number.isInteger(step) || step <= 0) {
        issues.push(configFail(`input.rejoinBackoffMs[${String(index)}]`, 'OUT_OF_RANGE', 'must be a positive whole number of milliseconds'));
      }
    });
    if (ladder.every((step) => typeof step === 'number' && Number.isFinite(step)) && !(ladder[0]! < ladder[1]! && ladder[1]! < ladder[2]!)) {
      issues.push(configFail('input.rejoinBackoffMs', 'INCONSISTENT', 'the ladder must be strictly increasing'));
    }
  }

  // Close codes: exactly the protocol's reserved set — same three names, same three numbers.
  const codes = raw['closeCodes'];
  if (!isRecord(codes)) {
    issues.push(configFail('input.closeCodes', 'WRONG_TYPE', 'must declare the three reserved close codes'));
  } else {
    const declared = canonicalHash({
      INPUT_RETIRED_UNREPRESENTED: codes['INPUT_RETIRED_UNREPRESENTED'],
      INPUT_RATE_CEILING: codes['INPUT_RATE_CEILING'],
      INPUT_RECOVERY: codes['INPUT_RECOVERY'],
    });
    if (declared !== canonicalHash(RESERVED_CLOSE_CODES)) {
      issues.push(
        configFail('input.closeCodes', 'INCONSISTENT', 'close codes are single-sourced from the protocol build and may not be overridden'),
      );
    }
  }

  // The boolean must be a boolean; `dedupeClosureEnabled: false` is the only value the D-P2-6
  // evidence position allows today, but the *type* rule is what a validator can enforce — the
  // evidence rule is GA-12's gate, and the flag's value is asserted there, not here.
  const dedupe = raw['dedupeClosureEnabled'];
  if (typeof dedupe !== 'boolean') {
    issues.push(configFail('input.dedupeClosureEnabled', 'WRONG_TYPE', 'must be a boolean'));
  }

  // Relational checks, run only over the values that survived their own range check.
  const n = numeric.values;
  const rate = n['inputRatePerTick'];
  const margin = n['bufferPressureMargin'];
  const jitter = n['jitterAllowanceFrames'];
  const buffer = n['bufferMaxSize'];
  if (rate !== undefined && margin !== undefined && jitter !== undefined && buffer !== undefined) {
    // GA-11's inequality with the stall term at one tick of frames (λ). A margin the buffer cannot
    // hold is not a margin; it is an overflow waiting for the first busy round trip.
    if (margin + jitter * rate + rate > buffer) {
      issues.push(
        configFail('input.bufferPressureMargin', 'INCONSISTENT', `the declared envelope B + J·λ + stall = ${String(margin + jitter * rate + rate)} exceeds bufferMaxSize ${String(buffer)}; GA-11's inequality cannot hold`),
      );
    }
  }
  const snapshot = n['clientSnapshotDeadlineMs'];
  const episode = n['clientRecoveryDeadlineMs'];
  const closureMax = n['closureMaxMs'];
  if (snapshot !== undefined && closureMax !== undefined && snapshot >= closureMax) {
    issues.push(
      configFail('input.clientSnapshotDeadlineMs', 'INCONSISTENT', `the client deadline (${String(snapshot)} ms) must be below closureMaxMs (${String(closureMax)} ms) or GA-7's expected recovery order is impossible`),
    );
  }
  if (episode !== undefined && snapshot !== undefined && episode <= snapshot) {
    issues.push(
      configFail('input.clientRecoveryDeadlineMs', 'INCONSISTENT', 'the episode deadline must outlast one snapshot deadline or recovery cannot complete a single deadline cycle'),
    );
  }
  if (episode !== undefined && ladder.length === 3 && typeof ladder[0] === 'number' && typeof ladder[1] === 'number') {
    if (episode <= ladder[0] + ladder[1]) {
      issues.push(
        configFail('input.clientRecoveryDeadlineMs', 'INCONSISTENT', 'the episode deadline must outlast the first two backoff rungs or the second rejoin of the amended allowance is unreachable'),
      );
    }
  }

  // `buildBlock` is the only place numbers become typed fields, and it is reached only with zero
  // issues, so the getters below cannot substitute a default for a value nobody checked.
  return buildBlock('input', numeric, emptyBooleans, issues, (number) =>
    deepFreeze({
      inputRatePerTick: number('inputRatePerTick'),
      bufferPressureMargin: number('bufferPressureMargin'),
      jitterAllowanceFrames: number('jitterAllowanceFrames'),
      bufferMaxSize: number('bufferMaxSize'),
      closureWindowMs: number('closureWindowMs'),
      closureMaxMs: number('closureMaxMs'),
      stallDetectionDeliveries: number('stallDetectionDeliveries'),
      clientSnapshotDeadlineMs: number('clientSnapshotDeadlineMs'),
      clientRecoveryDeadlineMs: number('clientRecoveryDeadlineMs'),
      rejoinWindowSeconds: number('rejoinWindowSeconds'),
      rejoinWindowAllowance: number('rejoinWindowAllowance'),
      rejoinBackoffMs: deepFreeze([ladder[0] as number, ladder[1] as number, ladder[2] as number]) as Readonly<[number, number, number]>,
      closeCodes: deepFreeze({ ...RESERVED_CLOSE_CODES }),
      rateCeilingMessagesPerSecond: number('rateCeilingMessagesPerSecond'),
      dedupeClosureEnabled: dedupe as boolean,
    }),
  );
};

export const DEFAULT_INPUT_ENVELOPE_CONFIG: Readonly<InputEnvelopeConfig> = deepFreeze(INPUT_ENVELOPE_DEFAULTS);

/** Hash input for the envelope block alone. */
export const inputEnvelopeConfigHash = (
  config: Readonly<InputEnvelopeConfig> = DEFAULT_INPUT_ENVELOPE_CONFIG,
): string => canonicalHash({ kind: 'udg-input-envelope', input: config });
