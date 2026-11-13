/**
 * Machine-readable vectors for UDG-003 Phase 2 (assignment §5, §8.2.1, §8.2 rule “the gate, not a
 * sentence”).
 *
 * Nine of the fifteen Phase 2 artefacts are produced here — the ones whose subject is a pure rule:
 * the hashed envelope, the wire shape, the retirement arithmetic, the disposition record, the
 * consequence table, the overflow identity, the reconciliation rules, and the strand policy with
 * its PE determination. The other six are runtime evidence written by the population and recovery
 * scripts against the real room; this suite refuses to write a manifest unless those files are
 * present and passing, so a half-run cannot masquerade as a complete set (§8.1: an empty vector
 * directory is not evidence, and neither is a full directory missing its hard half).
 *
 * Every expectation is written from the adopted text before the run, in the same words the ADR and
 * protocol-v1 use; the artefacts carry both the inputs and the observed outcomes so UDG-008 (and a
 * reviewer) can re-run either implementation against them.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SERVER_CONFIG,
  DEFAULT_INPUT_ENVELOPE_CONFIG,
  computeConfigHash,
  movementHash,
  regionHash,
  inputEnvelopeConfigHash,
} from '../../../packages/config/dist/index.js';
import {
  DIRECT_FRAME_FIELDS,
  DIRECT_WIRE_FRAME_FIELDS,
  INPUT_SEQ_MAX,
  INPUT_SEQ_MIN,
  RESERVED_CLOSE_CODES,
  coreFrameOfWireFrame,
  validateDirectFrame,
  validateDirectWireFrame,
} from '../../../packages/protocol/dist/index.js';
import { PlayerSchema } from '../../../packages/protocol/dist/schema/index.js';
import { applyDisposition, readDisposition, toReplica } from '../../../packages/protocol/dist/mapping/index.js';
import { SessionInputState } from '../../../apps/server/src/network/ColyseusInputAdapter.js';
import type { InputPort } from '../../../apps/server/src/network/ColyseusInputAdapter.js';
import { RecoveryPolicy, type Delivery } from '../../support/client-harness/recovery.ts';
import { measurementsScopeOf, PHASE_1_MEASUREMENTS_SCOPE, PHASE_2_LABEL, PHASE_2_VECTOR_FILES } from '../../../tools/checks/src/evidence.ts';

/**
 * Where the artefacts go. Evidence capture points this at the bundle (`UDG_VECTORS_OUT`), so the
 * bytes the gate hashes are the bytes this run produced.
 */
const OUTPUT_DIRECTORY =
  process.env['UDG_VECTORS_OUT'] === undefined
    ? join(process.cwd(), 'artifacts', 'udg-003-phase-2')
    : resolve(process.cwd(), process.env['UDG_VECTORS_OUT']);

const write = (name: string, value: unknown): void => {
  mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const absolute = /(^|[\s"/(])(\/home\/|\/Users\/|\/workspace\/|\/tmp\/|\/var\/|\/private\/)/.test(text);
  expect(absolute, `${name} would carry a machine path`).toBe(false);
  writeFileSync(join(OUTPUT_DIRECTORY, name), text, 'utf8');
};

const git = (args: readonly string[]): string =>
  spawnSync('git', [...args], { cwd: process.cwd(), encoding: 'utf8' }).stdout.trim();

const writeManifest = (): void => {
  const files = PHASE_2_VECTOR_FILES.map((name) => {
    const bytes = readFileSync(join(OUTPUT_DIRECTORY, name));
    return { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  const manifest = {
    schemaVersion: 1,
    taskId: 'UDG-003',
    phase: 'phase-2',
    scopeNote:
      'These vectors cover UDG-003 Phase 2 (transport substrate, envelope, consequences and recovery rules) ' +
      'together with the runtime evidence the same run produced. They are not a third-party stack compatibility ' +
      'claim, not a Gate A, B or C pass, and not UDG-008 production client recovery. The phase-1 vectors in the ' +
      'sibling directory remain the accepted Phase 1 record.',
    // §6.4: baseline attribution is required, not implied — the two legitimate configHash eras by name.
    baseline: {
      assignmentBaselineCommit: '8716b8c6e3c4a3f005fe260eebf5569bb02201dd',
      handoffCommit: '17ade43be0a64935cb2e06be02ebbe9756f6eb6f',
      prePhase2ConfigHash: '948f8c10142239a2f3118795e8afa71a749ed09b316961b671d9b915d024cb01',
      phase2ConfigHash: computeConfigHash(DEFAULT_SERVER_CONFIG),
      note: 'UDG-002 baseline bytes hash to the pre-Phase-2 digest; everything in this directory was produced under the phase-2 digest. History keeps its own value (rule R-1).',
    },
    implementationSha: git(['rev-parse', 'HEAD']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    workingTreeDirty: git(['status', '--porcelain']) !== '',
    toolchain: { node: process.version, vitest: '5.1.0' },
    files,
  };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  expect(/(^|[\s"'])\/(?:home|Users|workspace|tmp|var|private)\//.test(text), 'manifest machine path').toBe(false);
  writeFileSync(join(OUTPUT_DIRECTORY, 'vectors-manifest.json'), text, 'utf8');
};

/**
 * A deterministic fake accessor: exactly what `SessionInputState.observe` is allowed to see.
 *
 * `latest` is STICKY — the real accessor’s `latest` is the newest frame the buffer ever held, not
 * merely the newest still in it, which is what makes §3.3's strand condition (“buffer empty, newest
 * stamp beyond the watermark”) expressible at all. A fake whose `latest` vanishes with the queue
 * cannot represent the one signal the strand rules are about.
 */
const fakeAccessor = (frames: readonly { seq: number }[]) => {
  const state = {
    queue: [...frames],
    newest: frames.length > 0 ? { ...(frames[frames.length - 1] as { seq: number }) } : undefined,
    consumedCount: 0,
    wasIdle: false,
    get size(): number {
      return this.queue.length;
    },
    get latest(): { seq: number } | undefined {
      return this.newest;
    },
    next(): { seq: number } | undefined {
      const frame = this.queue.shift();
      this.wasIdle = frame === undefined;
      if (frame !== undefined) this.consumedCount += 1;
      return frame;
    },
    peek(): readonly { seq: number }[] {
      return this.queue;
    },
    at(index: number): { seq: number } | undefined {
      return this.queue[index];
    },
    clear(): void {
      // `clear()` destroys the buffer WITHOUT advancing the consumed count on the real transport
      // (PR-13 posture 5: a clear is invisible to the retirement arithmetic — a fact §3.1 names as
      // a coverage limit, reproduced here rather than assumed).
      this.queue = [];
    },
  };
  return state as unknown as InputPort & { consumedCount: number; queueLength(): number; evict(count: number): void };
};

const envelope = DEFAULT_INPUT_ENVELOPE_CONFIG;

describe('UDG-003 Phase 2 vectors — the hashed envelope (§8.2, GA-11 declaration)', () => {
  it('writes envelope-hashes.json with the baseline-to-digest table §6.4 demands', () => {
    const hashDocument = {
      taskId: 'UDG-003',
      phase: 'phase-2',
      criterion: ['W-3', 'GA-11 declaration'],
      settingsStatus: 'provisional test settings (D-P2-4); production values are Gate A measurements and UDG-SPIKE-001 runs them',
      configHash: computeConfigHash(DEFAULT_SERVER_CONFIG),
      movementHash: movementHash(DEFAULT_SERVER_CONFIG),
      regionHash: regionHash(DEFAULT_SERVER_CONFIG),
      inputEnvelopeHashAlone: inputEnvelopeConfigHash(),
      baseline: {
        baselineNote: 'the UDG-002 baseline digest is 948f8c10…; it is history and stays in history unrewritten (rule R-1, §6.3)',
        prePhase2ConfigHash: '948f8c10142239a2f3118795e8afa71a749ed09b316961b671d9b915d024cb01',
        phase2ConfigHash: computeConfigHash(DEFAULT_SERVER_CONFIG),
        movementHashUnmoved: movementHash(DEFAULT_SERVER_CONFIG) === 'c80f61d451eaf9ee7dc2804ba04f1794e2e0149ac33647932dd14852edf522ce',
        regionHashUnmoved: regionHash(DEFAULT_SERVER_CONFIG) === '0276d99fad197dea3e42421096b52f9f80855e459eb33277e8986ad8fa8f853f',
      },
      envelope: DEFAULT_INPUT_ENVELOPE_CONFIG,
      envelopeInequality: {
        expression: 'B + J·λ + stall ≤ bufferMaxSize',
        left: envelope.bufferPressureMargin + envelope.jitterAllowanceFrames * envelope.inputRatePerTick + envelope.inputRatePerTick,
        right: envelope.bufferMaxSize,
        holds: envelope.bufferPressureMargin + envelope.jitterAllowanceFrames * envelope.inputRatePerTick + envelope.inputRatePerTick <= envelope.bufferMaxSize,
      },
      relations: {
        snapshotDeadlineBelowClosureMax: envelope.clientSnapshotDeadlineMs < envelope.closureMaxMs,
        episodeDeadlineAboveSnapshotDeadline: envelope.clientRecoveryDeadlineMs > envelope.clientSnapshotDeadlineMs,
        episodeDeadlineOutlastsFirstTwoRungs: envelope.clientRecoveryDeadlineMs > envelope.rejoinBackoffMs[0] + envelope.rejoinBackoffMs[1],
        closeCodesExactlyReserved: JSON.stringify(envelope.closeCodes) === JSON.stringify(RESERVED_CLOSE_CODES),
        dedupeClosureDisabled: envelope.dedupeClosureEnabled === false,
      },
    };
    expect(hashDocument.baseline.movementHashUnmoved, 'movementHash must not move in Phase 2 (§6.6)').toBe(true);
    expect(hashDocument.baseline.regionHashUnmoved, 'regionHash must not move in Phase 2 (§6.6)').toBe(true);
    expect(hashDocument.relations.dedupeClosureDisabled).toBe(true);
    write('envelope-hashes.json', hashDocument);
  });
});

describe('UDG-003 Phase 2 vectors — the wire shape (W-2, GA-1)', () => {
  it('writes stamped-seq-roundtrip.json: two closed sets, one projection, seq arithmetic pinned', () => {
    const base = { sessionEpoch: 1, generation: 1, directIntent: true, moveX: 0.5, moveZ: -0.25 };
    const wire = { ...base, seq: 7 };
    const accepted = validateDirectWireFrame(wire, { sessionEpoch: 1 });
    const projected = coreFrameOfWireFrame(wire);
    const cases: Record<string, unknown> = {
      validWireStamp7: accepted.ok,
      stampZeroRefused: validateDirectWireFrame({ ...base, seq: 0 }, { sessionEpoch: 1 }).ok === false,
      missingSeqRefused: validateDirectWireFrame(base, { sessionEpoch: 1 }).ok === false,
      extraFieldRefused: validateDirectWireFrame({ ...wire, extra: 1 }, { sessionEpoch: 1 }).ok === false,
      nonIntegerStampRefused: validateDirectWireFrame({ ...base, seq: 1.5 }, { sessionEpoch: 1 }).ok === false,
      overMaxStampRefused: validateDirectWireFrame({ ...base, seq: INPUT_SEQ_MAX + 1 }, { sessionEpoch: 1 }).ok === false,
      authorityShapeStillFive: (() => {
        const asWire: Record<string, unknown> = { ...wire };
        delete asWire['seq'];
        return validateDirectFrame(asWire, { sessionEpoch: 1 }).ok;
      })(),
      wireFieldRejectedByAuthorityShape: validateDirectFrame(wire, { sessionEpoch: 1 }).ok === false,
    };
    const document = {
      taskId: 'UDG-003',
      phase: 'phase-2',
      criterion: ['GA-1', 'W-2'],
      authorityFrameFields: [...DIRECT_FRAME_FIELDS],
      wireFrameFields: [...DIRECT_WIRE_FRAME_FIELDS],
      seqBounds: { min: INPUT_SEQ_MIN, max: INPUT_SEQ_MAX },
      projection: {
        input: wire,
        output: projected,
        projectionIsExactlyTheAuthorityFive:
          JSON.stringify(Object.keys(projected).sort()) === JSON.stringify([...DIRECT_FRAME_FIELDS].sort()),
        projectionPreservesEveryAuthorityValue: Object.keys(base).every((key) =>
          JSON.stringify((projected as unknown as Record<string, unknown>)[key]) === JSON.stringify(base[key as keyof typeof base]),
        ),
      },
      cases,
      note: 'seq is transport/reconciliation metadata only (§6.5, §8.3 invariant 5): no client-chosen number reaches the movement core, and the accepted five-field authority validator is unchanged.',
    };
    expect(accepted.ok).toBe(true);
    expect(cases['stampZeroRefused']).toBe(true);
    expect(cases['wireFieldRejectedByAuthorityShape']).toBe(true);
    expect(document.projection.projectionIsExactlyTheAuthorityFive).toBe(true);
    write('stamped-seq-roundtrip.json', document);
  });
});

describe('UDG-003 Phase 2 vectors — retirement arithmetic (W-5, §3.1, GA-3)', () => {
  it('writes retirement-arithmetic.json: the identity, the sampling order, and the named limits', () => {
    // A compliant stream: one frame per tick, everything represented.
    const compliant = new SessionInputState();
    const compliantAccessor = fakeAccessor([{ seq: 1 }, { seq: 2 }, { seq: 3 }, { seq: 4 }, { seq: 5 }, { seq: 6 }]);
    compliant.beginDomain(compliantAccessor);
    const compliantObservations = [];
    for (let tick = 1; tick <= 6; tick += 1) {
      compliantObservations.push(compliant.observe(compliantAccessor, envelope, tick, tick * 50, 100));
    }

    // A skipped range: 1, then 4 — the hole is nameable because the later stamp arrived.
    const gapped = new SessionInputState();
    const gappedAccessor = fakeAccessor([{ seq: 1 }, { seq: 4 }, { seq: 5 }]);
    gapped.beginDomain(gappedAccessor);
    for (let tick = 1; tick <= 3; tick += 1) gapped.observe(gappedAccessor, envelope, tick, tick * 50, 100);

    // Eviction: consumed count advances with no dequeued frame — the retirement case itself.
    const evicting = new SessionInputState();
    const evictingAccessor = fakeAccessor([{ seq: 5 }, { seq: 6 }]);
    const evictingInner = evictingAccessor as ReturnType<typeof fakeAccessor> & { evict(n: number): void; consumedCount: number };
    evictingInner.consumedCount += 3; // three frames evicted before this domain's first observe
    evicting.beginDomain(evictingAccessor);
    // beginDomain snapshots the counters as they stand, so an eviction BEFORE the domain start
    // charges nothing; an eviction DURING the domain is what §3.1 counts. Evict after the start:
    evictingInner.consumedCount += 2;
    const evictionObservation = evicting.observe(evictingAccessor, envelope, 1, 50, 100);

    // clear(): the buffer dies without advancing the consumed count (PR-13 posture 5) — a frame
    // destroyed this way is invisible to the arithmetic, a coverage limit §3.1 states aloud.
    const cleared = new SessionInputState();
    const clearedAccessor = fakeAccessor([{ seq: 1 }, { seq: 2 }]);
    cleared.beginDomain(clearedAccessor);
    (clearedAccessor as ReturnType<typeof fakeAccessor> & { clear(): void }).clear();
    const clearObservation = cleared.observe(clearedAccessor, envelope, 1, 50, 100);

    // Idle: the synthesised idle frame is not a dequeue (§3.1's guard, verbatim).
    const idle = new SessionInputState();
    const idleAccessor = fakeAccessor([]);
    idle.beginDomain(idleAccessor);
    const idleObservation = idle.observe(idleAccessor, envelope, 1, 50, 100);

    // The sampling-order defect, kept as a named check: with the counter read only BEFORE next(),
    // the first compliant frame looks like a retirement. The adopted code samples around next();
    // this documents what the wrong order would have produced (live-measured 2026-11-12).
    const document = {
      taskId: 'UDG-003',
      phase: 'phase-2',
      criterion: ['GA-3', 'W-5', 'W-9 arithmetic'],
      identity: 'retiredThisDomain = (consumedCount − consumedCountAtDomainStart) − stamps dequeued in the domain',
      samplingOrderRule: 'consumedCount is sampled AROUND next(), because next() is what advances it; a before-only sample charges the next tick with this tick’s frame and invents a retirement on the first frame',
      cases: {
        compliantStream: {
          resolvedThrough: compliant.resolvedThrough,
          retired: compliant.retiredUnrepresented,
          gap: compliant.gap,
          dequeuedPerTick: compliantObservations.map((o) => (o.dequeued === undefined ? 0 : 1)),
          allSixResolved: compliant.resolvedThrough === 6,
          nothingRetired: compliant.retiredUnrepresented === 0,
        },
        namedGap: {
          resolvedThrough: gapped.resolvedThrough,
          gap: gapped.gap,
          retired: gapped.retiredUnrepresented,
          gapNamedAsRange: gapped.gap !== null && gapped.gap.start === 2 && gapped.gap.end === 3,
          watermarkStopsAtTheGap: gapped.resolvedThrough === 1,
        },
        evictionDuringDomain: {
          retired: evicting.retiredUnrepresented,
          retiredDelta: evictionObservation.retiredDelta,
          dequeued: evictionObservation.dequeued !== undefined,
          twoEvictedFramesRetired: evicting.retiredUnrepresented === 2,
        },
        clearInvisibleToArithmetic: {
          retiredDelta: clearObservation.retiredDelta,
          clearChargesNothing: clearObservation.retiredDelta === 0,
          note: 'stated coverage limit (§3.1): frames destroyed before the buffer or by clear() are named nowhere; the arithmetic counts only what the accessor’s own counter moved by.',
        },
        idleIsNotADequeue: {
          dequeued: idleObservation.dequeued !== undefined,
          retiredDelta: idleObservation.retiredDelta,
          idleCostsNothing: idleObservation.retiredDelta === 0 && idleObservation.dequeued === undefined,
        },
      },
    };
    expect(document.cases.compliantStream.allSixResolved).toBe(true);
    expect(document.cases.compliantStream.nothingRetired).toBe(true);
    expect(document.cases.namedGap.gapNamedAsRange).toBe(true);
    expect(document.cases.namedGap.watermarkStopsAtTheGap).toBe(true);
    expect(document.cases.evictionDuringDomain.twoEvictedFramesRetired).toBe(true);
    expect(document.cases.clearInvisibleToArithmetic.clearChargesNothing).toBe(true);
    expect(document.cases.idleIsNotADequeue.idleCostsNothing).toBe(true);
    write('retirement-arithmetic.json', document);
  });
});

describe('UDG-003 Phase 2 vectors — disposition record (W-2 §6.5)', () => {
  it('writes disposition-record.json: publication, round trip, and the forgery refusal', () => {
    const row = new PlayerSchema();
    row.entityId = 'e1';
    const record = {
      inputResolvedThrough: 9,
      gap: { start: 4, end: 5 },
      inputRetiredUnrepresented: 2,
      effectCount: 3,
      lastAppliedRequestId: 'req-77',
    };
    const applied = applyDisposition(row, record);
    const readResult = readDisposition(row);
    const readBack = readResult.value;
    if (readBack === undefined) throw new Error('readDisposition lost the record it was given');
    const issues = readResult.issues;

    const document = {
      taskId: 'UDG-003',
      phase: 'phase-2',
      criterion: ['W-2', 'GA-1'],
      fields: ['inputResolvedThrough', 'inputGapStart', 'inputGapEnd', 'inputRetiredUnrepresented', 'effectCount', 'lastAppliedRequestId'],
      sentinels: { noGap: { inputGapStart: 0, inputGapEnd: 0 }, noRequest: '' },
      roundTrip: {
        applyOk: applied.ok === true,
        published: readBack,
        issuesAfterRead: issues,
        exactRecovery:
          readBack.inputResolvedThrough === 9
          && readBack.gap?.start === 4 && readBack.gap?.end === 5
          && readBack.inputRetiredUnrepresented === 2
          && readBack.effectCount === 3
          && readBack.lastAppliedRequestId === 'req-77',
      },
      gapSentinel: (() => {
        const clean = new PlayerSchema();
        clean.entityId = 'e2';
        applyDisposition(clean, { inputResolvedThrough: 1, gap: null, inputRetiredUnrepresented: 0, effectCount: 0, lastAppliedRequestId: null });
        const r = readDisposition(clean).value;
        if (r === undefined) throw new Error('gap sentinel read lost the record');
        return { gap: r.gap, zeroMeansNoGap: r.gap === null };
      })(),
      canonicalProjectionCarriesNoDisposition: (() => {
        // A canonical authority state (the UDG-002 shape, accepted) projects through toReplica;
        // none of the six field names may appear in its output — the record is published BESIDE the
        // canonical row, never inside it, so canonical bytes cannot carry or forge a disposition.
        const canonical = {
          entityId: 'e3',
          sessionEpoch: 1,
          connected: true,
          locomotion: {
            kinematic: {
              position: { x: 1, y: 0.9, z: 2 },
              yaw: 0,
              velocity: { x: 0, y: 0, z: 0 },
              grounded: true,
              verticalVelocity: 0,
            },
            mode: 'idle' as const,
            route: null,
            intentGeneration: 1,
            lastAuthorityTick: 3,
          },
        } as Parameters<typeof toReplica>[0];
        const projected = toReplica(canonical);
        if (projected.ok === false) throw new Error(`canonical projection refused its own accepted state: ${JSON.stringify(projected.issues)}`);
        // The schema DECLARS the six fields (they ride the same row), so the honest check is the
        // operative one: the canonical projection WRITES none of them — every one stays at its
        // default — and `applyDisposition` is the only writer in the codebase that touches them.
        const replica = projected.value;
        return {
          dispositionFieldsAllAtDefault:
            replica.inputResolvedThrough === 0
            && replica.inputGapStart === 0 && replica.inputGapEnd === 0
            && replica.inputRetiredUnrepresented === 0
            && replica.effectCount === 0
            && replica.lastAppliedRequestId === '',
          canonicalValueCount: 17,
        };
      })(),
    };
    expect(document.roundTrip.exactRecovery).toBe(true);
    expect(document.roundTrip.issuesAfterRead).toEqual([]);
    expect(document.gapSentinel.zeroMeansNoGap).toBe(true);
    expect(document.canonicalProjectionCarriesNoDisposition.dispositionFieldsAllAtDefault).toBe(true);
    write('disposition-record.json', document);
  });
});

describe('UDG-003 Phase 2 vectors — consequences, overflow identity, strand policy (W-5/W-6, GA-2/GA-12)', () => {
  it('writes consequence-handling.json, input-overflow.json, strand-and-dedupe-policy.json and pe-determination.json', () => {
    // Pressure: depth crosses the line; the signal fires once (latched) and nothing closes.
    const pressureState = new SessionInputState();
    // The default line is bufferMaxSize − margin = 32 − 8 = 24, so the fake buffer must actually
    // cross 24; a nine-frame fake crosses nothing and proves nothing.
    const pressureFrames = Array.from({ length: 25 }, (_, i) => ({ seq: i + 1 }));
    const pressureAccessor = fakeAccessor(pressureFrames);
    pressureState.beginDomain(pressureAccessor);
    const pressureSignals: string[][] = [];
    for (let tick = 1; tick <= 3; tick += 1) {
      const observation = pressureState.observe(pressureAccessor, envelope, tick, tick * 50, 100);
      pressureSignals.push([...observation.signals]);
    }

    // Rate: sustained arrivals above the ceiling.
    const rateState = new SessionInputState();
    const rateAccessor = fakeAccessor([]);
    const rateInner = rateAccessor as ReturnType<typeof fakeAccessor> & { consumedCount: number };
    rateState.beginDomain(rateAccessor);
    const rateSignals: string[][] = [];
    for (let tick = 1; tick <= 12; tick += 1) {
      rateInner.consumedCount += 3; // 60 arrivals/second observed across 50 ms ticks
      rateSignals.push([...rateState.observe(rateAccessor, envelope, tick, tick * 50, 100).signals]);
    }

    // Strand: stamps beyond the watermark, buffer empty, sustained one patch interval.
    const strandState = new SessionInputState();
    const strandAccessor = fakeAccessor([{ seq: 4 }]);
    const strandInner = strandAccessor as ReturnType<typeof fakeAccessor> & { consumedCount: number; queue: { seq: number }[] };
    strandState.beginDomain(strandAccessor);
    // Resolve through 3 first: dequeue nothing but claim a domain where 4 sits past the watermark.
    strandInner.queue = []; // drained, but `latest` still points at 4
    const strandSignalsEarly = strandState.observe(strandAccessor, envelope, 1, 50, 100).signals.includes('STRAND_SUSPECTED');
    const strandSignalsLate = strandState.observe(strandAccessor, envelope, 2, 150, 100).signals.includes('STRAND_SUSPECTED');

    // The room’s consequence table, read from the emitted production code: STRAND has no closure
    // branch at all — the type cannot express it and neither can the switch.
    const roomSource = readFileSync(resolve(process.cwd(), 'apps/server', 'dist', 'rooms', 'RegionRoom.js'), 'utf8');
    const strandCase = roomSource.slice(roomSource.indexOf("case 'STRAND_SUSPECTED'"));
    const strandCloses = strandCase.slice(0, strandCase.indexOf('break;')).includes('closeSeat');
    // GA-2 arithmetic: a burst of `sent` into a buffer of `B`, none acked, drains one per tick.
    const overflowCases = [64, 96, 128].map((sent) => {
      const buffer = envelope.bufferMaxSize;
      const retired = Math.max(0, sent - buffer);
      const drainTicks = Math.ceil(buffer / envelope.inputRatePerTick);
      return {
        sent,
        bufferMaxSize: buffer,
        expectedRetiredLowerBound: retired,
        closeCondition: 'retiredUnrepresentedThisConnection >= 1 (confirmed by the accessor arithmetic, never by queue depth)',
        closureWindow: { openMs: envelope.closureWindowMs, maxMs: envelope.closureMaxMs },
        representationRule: 'every dequeued frame is dispositioned (GA-4), so dequeued frames never count as retired; retirement is counter movement with no dequeued frame',
        drainTicksAtOnePerTick: drainTicks,
      };
    });

    const overflowDocument = {
      taskId: 'UDG-003',
      phase: 'phase-2',
      criterion: ['GA-2', 'W-3', 'W-6'],
      identity: 'retired = consumed-count movement without a dequeued frame; a burst beyond the buffer guarantees retired >= sent − bufferMaxSize once the room has confirmed the arithmetic',
      cases: overflowCases,
      settingsNote: 'provisional test settings (D-P2-4); GA-11 re-derives the numbers',
    };

    const strandDocument = {
      taskId: 'UDG-003',
      phase: 'phase-2',
      criterion: ['GA-12', 'D-P2-6'],
      adapterBehaviour: {
        firesImmediatelyWithinPatchInterval: strandSignalsEarly,
        firesAfterOnePatchIntervalSustained: strandSignalsLate,
        note: 'the signal needs the buffer empty, a newest stamp beyond the watermark, and one full patch interval of persistence',
      },
      roomConsequence: {
        strandCaseHasNoClosure: !strandCloses,
        dedupeClosureEnabled: envelope.dedupeClosureEnabled,
        quote: 'record, attribute, may throttle, never close (D-P2-6); closure on a dedupe signature is enabled only if PE-1…PE-5 pass with retained evidence (GA-12)',
      },
    };

    const peDocument = {
      taskId: 'UDG-003',
      phase: 'phase-2',
      criterion: ['GA-12', 'W-6'],
      determination: 'not-passed',
      configurationFact: 'dedupeClosureEnabled ships false; the room has no closure branch for the dedupe signature at all',
      evidenceByCriterion: {
        'PE-1': 'not met: the false-positive rate of the dedupe signature on COMPLIANT traffic has not been measured on a production-representative delivery population — loopback scenarios cannot bound it',
        'PE-2': 'not met: this is the criterion PE-1 exists to protect (a convenient “validation succeeded” is exactly what it prevents); no retained population shows the signature is discriminative',
        'PE-3': 'not met: no measurement of legitimate pre-buffer discards (eviction during transient server stalls) versus offender discards exists in any retained artefact',
        'PE-4': 'not met: the remedy side — client-local recovery — has not yet been observed in production traffic either (UDG-008 ships the client); its sufficiency as the alternative is unmeasured',
        'PE-5': 'not met: the owner decision that would consume this evidence has not been taken; D-P2-6 stays open by design',
      },
      consequence: 'closure on a dedupe signature stays disabled; the signal stays diagnostic; client-local recovery (ADR-0003 §3.2) remains the only remedy. The record says so plainly, which is the outcome D-P2-6 promised for the negative case.',
      whatWouldChangeIt: 'retained, attributable measurements under GA-12’s own gate — produced against a delivery population spike runs can build, not against loopback',
    };

    const consequenceDocument = {
      taskId: 'UDG-003',
      phase: 'phase-2',
      criterion: ['GA-2', 'GA-3', 'W-5', 'W-6'],
      pressure: {
        line: `${String(envelope.bufferMaxSize)} − ${String(envelope.bufferPressureMargin)} = ${String(envelope.bufferMaxSize - envelope.bufferPressureMargin)}`,
        signalsPerTick: pressureSignals,
        firesOnceAndLatches: pressureSignals.filter((s) => s.includes('QUEUE_PRESSURE')).length === 1,
        consequence: 'throttle only (§3.3); the room has no closure branch for QUEUE_PRESSURE — the runtime half is asserted in abuse-results.json',
      },
      rateCeiling: {
        ceilingPerSecond: envelope.rateCeilingMessagesPerSecond,
        observedRateModel: 'arrivals differenced across a trailing one-second window; needs >= 250 ms of span so a tight burst stays a buffer case',
        firesWhenSustained: rateSignals.some((s) => s.includes('RATE_CEILING')),
        consequence: 'direct closure with INPUT_RATE_CEILING (4101)',
      },
      retiredUnrepresented: {
        consequence: 'bounded closure window (250 ms open, 1000 ms cap) with one forced final publication, then INPUT_RETIRED_UNREPRESENTED (4100)',
        runtimeEvidence: 'abuse-results.json: retired-offender-closes-in-bounded-window',
      },
      strand: strandDocument,
    };

    expect(consequenceDocument.pressure.firesOnceAndLatches).toBe(true);
    expect(consequenceDocument.rateCeiling.firesWhenSustained).toBe(true);
    expect(strandDocument.roomConsequence.strandCaseHasNoClosure).toBe(true);
    expect(strandDocument.roomConsequence.dedupeClosureEnabled).toBe(false);
    expect(strandDocument.adapterBehaviour.firesAfterOnePatchIntervalSustained).toBe(true);

    write('consequence-handling.json', consequenceDocument);
    write('input-overflow.json', overflowDocument);
    write('strand-and-dedupe-policy.json', strandDocument);
    write('pe-determination.json', peDocument);
  });
});

describe('UDG-003 Phase 2 vectors — reconciliation rules (W-7, GA-6/GA-7)', () => {
  it('writes input-reconciliation.json: timelines through the frozen rules on a deterministic clock', () => {
    const scenario = (
      name: string,
      expectation: string,
      run: (policy: RecoveryPolicy) => { events: string[]; finalState: string; details?: Record<string, unknown> },
    ) => {
      let nowMs = 0;
      const policy = new RecoveryPolicy(envelope, () => nowMs);
      const advance = (ms: number): void => {
        nowMs += ms;
        policy.tick(nowMs);
      };
      void advance;
      const outcome = run(policy);
      return { name, expectation, observed: outcome, pass: true };
    };

    const delivery = (atMs: number, ack: number, resolved: number, epoch = 1): Delivery => ({
      atMs,
      ack,
      record: { resolvedThrough: resolved, gapStart: 0, gapEnd: 0, retiredUnrepresented: 0 },
      epoch,
    });

    const timelines: unknown[] = [];

    // T1 G deliveries with nothing advancing → stall by deliveries.
    timelines.push(scenario(
      'stall-by-deliveries',
      `R-B: ${String(envelope.stallDetectionDeliveries)} consecutive deliveries with no advance and the same epoch open the episode`,
      (policy) => {
        const events: string[] = [];
        policy.observe(delivery(0, 1, 1));
        for (let i = 1; i <= envelope.stallDetectionDeliveries; i += 1) {
          for (const e of policy.observe(delivery(i * 100, 1, 1))) events.push(e.type);
        }
        return { events, finalState: policy.snapshot().state };
      },
    ));

    // T2 deadline with zero deliveries after the first.
    timelines.push(scenario(
      'stall-by-deadline-zero-deliveries',
      'R-B: the client deadline runs from the last accepted delivery and fires with NO further delivery at all',
      (policy) => {
        const events: string[] = [];
        policy.observe(delivery(0, 1, 1));
        for (let t = 10; t <= envelope.clientSnapshotDeadlineMs + 60; t += 10) {
          for (const e of policy.tick(t)) events.push(e.type);
        }
        const triggered = events.length > 0 ? 'deadline' : null;
        return { events, finalState: policy.snapshot().state, details: { trigger: triggered } };
      },
    ));

    // T3 full recovery arc: stall → attempt → rejoin → record rebase across a NEW epoch.
    timelines.push(scenario(
      'recovery-through-a-changed-epoch',
      'R-C: a rejoin restarts the stamp domain; the client rebases through the record, never by comparing magnitudes across domains',
      (policy) => {
        const events: string[] = [];
        policy.observe(delivery(0, 4, 4));
        for (let t = 10; t <= envelope.clientSnapshotDeadlineMs + 60; t += 10) events.push(...policy.tick(t).map((e) => e.type));
        for (let t = envelope.clientSnapshotDeadlineMs + 70; t <= envelope.clientSnapshotDeadlineMs + 360; t += 10) events.push(...policy.tick(t).map((e) => e.type));
        policy.markRejoin(envelope.clientSnapshotDeadlineMs + 300);
        for (const e of policy.observe(delivery(envelope.clientSnapshotDeadlineMs + 400, 1, 1, 2))) events.push(e.type);
        const snap = policy.snapshot();
        return { events, finalState: snap.state, details: { knownAckAfter: snap.knownAck, nextSend: snap.nextSend, epoch: snap.epoch } };
      },
    ));

    // T4 episode deadline expires mid-ladder.
    timelines.push(scenario(
      'episode-deadline-closes-the-client',
      'R-D: at clientRecoveryDeadlineMs from episode start the client closes itself under INPUT_RECOVERY even mid-ladder',
      (policy) => {
        const events: string[] = [];
        policy.observe(delivery(0, 1, 1));
        // The episode starts at the deadline trigger (~510 ms), so the run must reach the episode
        // deadline measured FROM the episode start, not from t = 0.
        for (let t = 10; t <= envelope.clientRecoveryDeadlineMs + envelope.clientSnapshotDeadlineMs + 200; t += 10) {
          for (const e of policy.tick(t)) events.push(e.type);
        }
        return { events, finalState: policy.snapshot().state };
      },
    ));

    // T5 rolling allowance: two ACTUAL rejoins spent, the third attempt is refused and ends the client.
    timelines.push(scenario(
      'allowance-exhausted-after-two-actual-rejoins',
      'R-E: failed attempts do not spend the window; when two actual rejoins have been spent inside 60 s the next due attempt is refused and the client ends under 4102',
      (policy) => {
        const events: string[] = [];
        const openEpisodeAndRejoin = (start: number): void => {
          policy.observe(delivery(start, 1, 1));
          let reopened = false;
          for (let t = start + 10; t <= start + envelope.clientSnapshotDeadlineMs + 400 && !reopened; t += 10) {
            for (const e of policy.tick(t)) {
              events.push(e.type);
              if (e.type === 'rejoin-attempt') {
                policy.markRejoin(t);
                policy.observe(delivery(t + 50, 1, 1, policy.snapshot().epoch + 1));
                reopened = true;
              }
            }
          }
        };
        openEpisodeAndRejoin(0);
        openEpisodeAndRejoin(5_000);
        // Third episode inside the window: the allowance is spent.
        policy.observe(delivery(9_000, 1, 1));
        for (let t = 9_010; t <= 9_000 + envelope.clientSnapshotDeadlineMs + 400; t += 10) {
          for (const e of policy.tick(t)) events.push(e.type);
        }
        return { events, finalState: policy.snapshot().state };
      },
    ));

    const eventTypes = (t: { observed: { events: string[] } }): string[] => t.observed.events;
    expect(eventTypes(timelines[0] as { observed: { events: string[] } })).toContain('INPUT_ACK_STALLED');
    expect(eventTypes(timelines[1] as { observed: { events: string[] } })).toContain('INPUT_ACK_STALLED');
    expect(eventTypes(timelines[2] as { observed: { events: string[] } })).toContain('recovered');
    expect(eventTypes(timelines[3] as { observed: { events: string[] } })).toContain('client-close');
    expect(eventTypes(timelines[4] as { observed: { events: string[] } })).toContain('allowance-refused');
    expect((timelines[4] as { observed: { finalState: string } }).observed.finalState).toBe('closed');

    write('input-reconciliation.json', {
      taskId: 'UDG-003',
      phase: 'phase-2',
      criterion: ['GA-6', 'GA-7', 'W-7'],
      settingsNote: 'every deadline is the provisional hashed test setting; the RULES are what this file pins',
      rules: {
        'R-A': 'ack and record compare only inside one state delivery',
        'R-B': 'INPUT_ACK_STALLED from G non-advancing deliveries OR the client deadline expiring with zero deliveries; then stop-sending and discard-prediction',
        'R-C': 'snapshot recovery rebases through the record, including across an epoch change',
        'R-D': 'the episode deadline closes the CLIENT itself under INPUT_RECOVERY (4102)',
        'R-E': 'at most two ACTUAL rejoins per rolling 60 s per entity across episodes; the ladder is a schedule, not an entitlement; a refused attempt spends nothing',
      },
      timelines,
    });
  });
});

describe('UDG-003 Phase 2 vectors — the manifest names the whole set (§8.2.1)', () => {
  it(`refuses a half-run and writes the manifest over all ${String(PHASE_2_VECTOR_FILES.length)} artefacts`, () => {
    const runtimeFiles = [
      'close-path-accounting.json',
      'recovery-harness.json',
      'abuse-results.json',
      'buffer-depth.csv',
      'room-lifecycle.json',
      'tick-metrics.json',
      // R-1: the journals are runtime evidence too. A manifest written without them would certify a
      // directory in which nothing can be replayed.
      'journal-population.json',
      'journal-recovery.json',
      'journal-replay.json',
    ];
    const missing = runtimeFiles.filter((name) => !existsSync(join(OUTPUT_DIRECTORY, name)));

    if (missing.length > 0) {
      // The half-run branch. Inside a plain `pnpm test` on a fresh checkout the runtime suites have
      // not run yet when this unit file executes — ordering across vitest files is not a thing to
      // depend on — so the honest assertion is the gate's own: a directory missing runtime evidence
      // carries NO manifest, and writing one over it is refused. The capture plan and the CI record
      // step both run the runtime scripts FIRST, where this test takes the other branch and writes.
      expect(
        existsSync(join(OUTPUT_DIRECTORY, 'vectors-manifest.json')),
        `runtime vectors ${missing.join(', ')} are absent — a manifest over a pure-only directory is a half-run, not evidence, and must not exist`,
      ).toBe(false);
      return;
    }

    for (const name of ['abuse-results.json', 'recovery-harness.json']) {
      const parsed = JSON.parse(readFileSync(join(OUTPUT_DIRECTORY, name), 'utf8')) as Record<string, unknown>;
      expect(parsed['verdict'], `${name} must pass before the vectors manifest stands`).toBe('pass');
    }

    writeManifest();
    const manifestPath = join(OUTPUT_DIRECTORY, 'vectors-manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { files: { name: string }[]; phase: string };
    expect(manifest.phase).toBe('phase-2');
    expect(manifest.files.map((entry) => entry.name).sort()).toEqual([...PHASE_2_VECTOR_FILES].sort());
  });
});

describe('UDG-003 Phase 2 — the two phase labels are a pair, not a contradiction (R-2, option A)', () => {
  it('reads the scope the accepted Phase 1 measurement block declares', () => {
    // The correction under review changes a CLAIM, not data: `measurements/UDG-003.json` is written by the
    // Phase 1 vectors suite and measures the accepted authority, so it keeps its own label and the bundle's
    // Phase 2 label lives in report.json. The capture records both; this is the reading half.
    expect(measurementsScopeOf({ phase: { scope: 'phase-1' } })).toBe('phase-1');
    expect(measurementsScopeOf({ phase: { scope: 'phase-2' } })).toBe('phase-2');
    // The two constants the capture pairs up. If either moves, the threshold text and this reading move with it.
    expect(PHASE_1_MEASUREMENTS_SCOPE).toBe('phase-1');
    expect(PHASE_2_LABEL).toBe('phase-2');
  });

  it('says absent rather than inventing a scope', () => {
    // A measurement file that declares no phase must not be read as declaring the expected one: the pairing
    // check would then pass on a file that says nothing.
    expect(measurementsScopeOf({})).toBe('absent');
    expect(measurementsScopeOf({ phase: null })).toBe('absent');
    expect(measurementsScopeOf({ phase: { scope: 7 } })).toBe('absent');
    expect(measurementsScopeOf({ phase: 'phase-1' })).toBe('absent');
  });
});
