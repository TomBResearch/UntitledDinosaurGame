/**
 * PR-8 — what does the acknowledgement actually track: frames received, frames consumed, or frames
 * represented in state?
 *
 * [UDG-003.md](../../../docs/contracts/UDG-003.md) and
 * [movement-authority.md 5.1](../../../docs/interfaces/movement-authority.md) forbid acknowledging a
 * frame that was never represented in state, so this probe reads both sides of the same value against
 * **frame identities** rather than counts: every frame carries a distinct `generation`, every send
 * returns the client sequence number the library will later acknowledge, and the room logs what it
 * actually represented in state.
 *
 * The pinned declarations state the intended semantics, and the scenarios test them instead of quoting
 * them (`@colyseus/core/build/input/InputBuffer.d.ts`, `@colyseus/sdk/build/input/InputHandle.d.ts`):
 *
 * - `consumedCount` is "Cumulative count of inputs CONSUMED from this buffer (via any consume primitive
 *   … plus **clear and overflow**). Consumed = removed from the pending set, **whether applied to state
 *   or discarded**."
 * - `lastProcessed` is "Last input the server has acknowledged PROCESSING … (the server input-buffer's
 *   consumed count, echoed via the TIMED prefix) … prune your pending inputs against it
 *   (`seq <= lastProcessed`)".
 * - Reliable inputs are contiguous, "so their consumed-seq-value is always exactly `consumedCount`".
 *
 * So the question this probe answers is not *whether* the library acknowledges a refusal — the
 * declaration already says it does — but **which specific frames a given acknowledgement retires**, and
 * whether a retired frame can still be told apart from one that was applied.
 *
 * Revision note, kept deliberately: the first submission recorded S4 as `S4-droppedFramesAcked: false`
 * derived from `clientLastProcessed + bufferSize < clientSent`, and concluded that dropped frames are
 * never acknowledged. That reading was wrong: the same numbers (sent 6, buffered 2, consumed 4,
 * lastProcessed 4) say every frame was accounted for, and the two surplus frames were retired by the
 * eviction that overflowed them. The original observation is preserved under
 * `S4_supersededFirstReading`; the conclusion it fed is corrected in `acknowledgementSemantics`.
 */

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { defineRoom, type RegisteredHandler } from '@colyseus/core';
import { Client, type InputHandle, type Room as ClientRoom } from '@colyseus/sdk';
import { RegionSchema, type RegionSchema as RegionState } from '@udg/protocol/schema';

import { InputRoom, inputRooms, lastOf } from './rooms.js';
import { httpEndpoint, outputPath, runProbe, sleep, startProbeServer, until, type DirectInputFrame } from './support.js';

const EPOCH = 7;

interface Scenario {
  readonly room: ClientRoom;
  readonly handle: InputHandle<DirectInputFrame>;
  readonly instance: InputRoom;
  readonly sessionId: string;
}

/** One frame's identity as seen from both sides: the generation it carries and the seq that acks it. */
interface SentFrame {
  readonly seq: number;
  readonly generation: number;
}

function frame(index: number): DirectInputFrame {
  return { sessionEpoch: EPOCH, generation: index + 1, directIntent: true, moveX: 0.5, moveZ: 0 };
}

/**
 * Send `count` frames, each with a distinct generation, and return the identity table.
 *
 * `send()` returns the sequence number, which is what `lastProcessed` later compares against, so this
 * is the only table that can say *which* frames an acknowledgement retired.
 */
async function send(scenario: Scenario, count: number, from = 0): Promise<SentFrame[]> {
  const sent: SentFrame[] = [];
  for (let index = 0; index < count; index += 1) {
    Object.assign(scenario.handle.data, frame(from + index));
    sent.push({ seq: scenario.handle.send(), generation: from + index + 1 });
    await sleep(10);
  }
  return sent;
}

async function scenario(client: Client, name: string): Promise<Scenario> {
  const room = await client.create<RegionState>(name, {}, RegionSchema);
  const instance = lastOf(inputRooms);
  if (instance === undefined) throw new Error('the room instance was never constructed');
  return { room, handle: room.input<DirectInputFrame>(), instance, sessionId: room.sessionId };
}

/**
 * Wait for both halves of a consumption: the server buffer counter, and the client having actually
 * received the resulting acknowledgement.
 *
 * The two are not simultaneous — the ack rides out on the next state patch — and a probe that sampled
 * the client immediately after the server moved would report "not acknowledged" for a value that was
 * merely in flight. Both waits are timed, so a value that never arrives is still a measured negative.
 */
async function settled(
  scenario: Scenario,
  consumedTarget: number,
  ackTarget: number,
): Promise<{ serverSettled: boolean; ackSettled: boolean; elapsedMs: number }> {
  const started = Date.now();
  const serverSettled = await until(
    () => scenario.instance.pendingIdentities(scenario.sessionId).consumedCount >= consumedTarget,
    2_000,
  );
  const ackSettled = await until(() => scenario.handle.lastProcessed >= ackTarget, 2_000);
  return { serverSettled, ackSettled, elapsedMs: Date.now() - started };
}

/** The client's own view of which seqs are still replayable, which is how it decides what to prune. */
function replayable(handle: InputHandle<DirectInputFrame>, sent: readonly SentFrame[]): number[] {
  return sent.filter((entry) => handle.at(entry.seq) !== undefined).map((entry) => entry.generation);
}

async function main(): Promise<void> {
  const out = outputPath(process.argv.slice(2));

  await runProbe('PR-8', 'what the acknowledgement retires, traced by frame identity', out, async (checks) => {
    const rooms: Record<string, RegisteredHandler> = {
      'udg-pr8-default': defineRoom(InputRoom),
      'udg-pr8-small': defineRoom(InputRoom, { bufferMaxSize: 2 }),
      'udg-pr8-idle': defineRoom(InputRoom, { declareIdle: true }),
    };
    const server = await startProbeServer(rooms);
    try {
      const client = new Client(httpEndpoint(server.endpoint));

      // S1 — three frames delivered, none consumed. Receipt must not move the ack.
      const buffered = await scenario(client, 'udg-pr8-default');
      const s1sent = await send(buffered, 3);
      await sleep(600); // longer than the default 100 ms patch interval, so any ack has had time to ride out
      const s1identities = buffered.instance.pendingIdentities(buffered.sessionId);
      const s1 = {
        sent: s1sent,
        pendingGenerations: s1identities.generations,
        serverConsumedCount: s1identities.consumedCount,
        clientLastProcessed: buffered.handle.lastProcessed,
        clientSent: buffered.handle.sentCount,
        clientPending: buffered.handle.pendingCount,
        appliedKinds: buffered.instance.applied.map((entry) => entry.kind),
      };
      checks.observe('S1_bufferedNotConsumed', s1);
      checks.check('S1-buffered', s1.pendingGenerations.length >= 1, `room buffer holds generations ${s1.pendingGenerations.join(', ')}`);
      checks.check(
        'S1-ack-does-not-follow-receipt',
        s1.clientLastProcessed === 0 && s1.serverConsumedCount === 0,
        `client lastProcessed ${String(s1.clientLastProcessed)}, server consumedCount ${String(s1.serverConsumedCount)} after ${String(s1sent.length)} received frames`,
      );

      // S2 — consume exactly one and apply it. The ack must name that frame's seq, not merely grow.
      buffered.instance.consumeOne(buffered.sessionId, false);
      const s2wait = await settled(buffered, 1, s1sent[0]!.seq);
      const s2identities = buffered.instance.pendingIdentities(buffered.sessionId);
      const s2 = {
        serverConsumedCount: s2identities.consumedCount,
        clientLastProcessed: buffered.handle.lastProcessed,
        appliedLog: buffered.instance.applied,
        retiredGenerations: s1sent.filter((entry) => entry.seq <= buffered.handle.lastProcessed).map((entry) => entry.generation),
        stillPendingGenerations: s2identities.generations,
        waited: s2wait,
      };
      checks.observe('S2_consumedAndApplied', s2);
      checks.check(
        'S2-ack-names-the-applied-frame',
        s2.waited.serverSettled && s2.waited.ackSettled
          && s2.clientLastProcessed === s1sent[0]!.seq && s2.retiredGenerations.join(',') === '1',
        `lastProcessed ${String(s2.clientLastProcessed)} against the applied frame's seq ${String(s1sent[0]?.seq)}; retired generations ${s2.retiredGenerations.join(', ') || 'none'}`,
      );
      checks.check(
        'S2-applied-frame-is-represented-in-state',
        s2.appliedLog.at(-1)?.kind === 'frame' && s2.appliedLog.at(-1)?.generation === 1,
        `the room logged ${JSON.stringify(s2.appliedLog.at(-1))}`,
      );

      // S3 — the decisive case for D-7: consume a frame, refuse it, and represent an authoritative
      // neutral step in its place.
      const refused = await scenario(client, 'udg-pr8-default');
      const s3sent = await send(refused, 2);
      refused.instance.consumeOne(refused.sessionId, true);
      const s3wait = await settled(refused, 1, s3sent[0]!.seq);
      const s3identities = refused.instance.pendingIdentities(refused.sessionId);
      const s3 = {
        sent: s3sent,
        serverConsumedCount: s3identities.consumedCount,
        clientLastProcessed: refused.handle.lastProcessed,
        refusedWasRecorded: refused.instance.consumed.at(-1)?.refused === true,
        refusedGeneration: refused.instance.consumed.at(-1)?.values.generation ?? -1,
        appliedLog: refused.instance.applied,
        waited: s3wait,
      };
      checks.observe('S3_consumedThenRefused', s3);
      checks.check(
        'S3-refusal-is-invisible-to-the-ack',
        s3.refusedWasRecorded && s3.waited.serverSettled && s3.waited.ackSettled
          && s3.clientLastProcessed === s3sent[0]!.seq,
        `the frame was refused yet server consumedCount=${String(s3.serverConsumedCount)} and client lastProcessed=${String(s3.clientLastProcessed)} (seq ${String(s3sent[0]?.seq)})`,
      );
      checks.check(
        'S3-refusal-is-still-represented-by-an-authoritative-neutral-step',
        s3.appliedLog.at(-1)?.kind === 'neutral' && s3.appliedLog.at(-1)?.generation === s3.refusedGeneration,
        `the room stepped ${JSON.stringify(s3.appliedLog.at(-1))} — state advanced on neutral input while the refused intent did not`,
      );

      // Is there any public surface that could withhold or retract an acknowledgement?
      let searchFrom = process.cwd();
      let sdkRoot = '';
      for (;;) {
        const candidate = join(searchFrom, 'node_modules', '@colyseus', 'sdk');
        if (existsSync(candidate)) {
          sdkRoot = realpathSync(candidate);
          break;
        }
        const parent = join(searchFrom, '..');
        if (parent === searchFrom) throw new Error('no installed @colyseus/sdk found from the probe');
        searchFrom = parent;
      }
      const handleDeclaration = readFileSync(join(sdkRoot, 'build', 'input', 'InputHandle.d.ts'), 'utf8');
      const members = [...handleDeclaration.matchAll(/^\s{4}(?:readonly )?([a-zA-Z_][\w]*)\s*[(:<]/gm)].map((match) => match[1] ?? '');
      const ackRelated = members.filter((member) => /ack|nack|retract|withhold|reject|confirm/i.test(member));
      checks.observe('inputHandleAckRelatedMembers', ackRelated);
      checks.observe('inputHandleMemberCount', members.length);
      checks.check(
        'S3-no-public-way-to-withhold-or-retract-an-ack',
        ackRelated.length === 0,
        ackRelated.length === 0
          ? `InputHandle exposes ${String(members.length)} members and none of them controls an acknowledgement`
          : `InputHandle exposes ${ackRelated.join(', ')} — evaluate whether any of them can express a refusal`,
      );

      // S4 — overflow, traced by identity. The declaration says eviction counts as consumed; the first
      // submission read these same numbers the other way round.
      const overflowing = await scenario(client, 'udg-pr8-small');
      const s4sent = await send(overflowing, 6);
      const s4wait = await settled(overflowing, 4, 4);
      await sleep(600);
      const s4identities = overflowing.instance.pendingIdentities(overflowing.sessionId);
      const s4lastProcessed = overflowing.handle.lastProcessed;
      const s4 = {
        bufferMaxSize: overflowing.instance.bufferMaxSize,
        sent: s4sent,
        pendingGenerations: s4identities.generations,
        size: s4identities.size,
        serverConsumedCount: s4identities.consumedCount,
        serverAckVisibleToTheRoom: false,
        clientLastProcessed: s4lastProcessed,
        clientSent: overflowing.handle.sentCount,
        clientPendingCount: overflowing.handle.pendingCount,
        applicationConsumeCalls: overflowing.instance.applied.length,
        waited: s4wait,
        retiredByWatermark: s4sent.filter((entry) => entry.seq <= s4lastProcessed).map((entry) => entry.generation),
        stillUnacked: s4sent.filter((entry) => entry.seq > s4lastProcessed).map((entry) => entry.generation),
        clientReplayableGenerations: replayable(overflowing.handle, s4sent),
        appliedLog: overflowing.instance.applied,
      };
      const dropped = s4.retiredByWatermark.filter((generation) => !s4.appliedLog.some((entry) => entry.generation === generation));

      checks.observe('S4_overflowIdentityTrace', s4);
      checks.observe('S4_droppedByOverflow', dropped);
      checks.check('S4-buffer-is-bounded', s4.size <= s4.bufferMaxSize, `buffer holds ${String(s4.size)} against a declared maximum of ${String(s4.bufferMaxSize)}`);
      checks.check(
        'S4-overflow-evicts-the-oldest-frames',
        s4.pendingGenerations.join(',') === '5,6',
        `after sending generations 1-6 into a maximum of ${String(s4.bufferMaxSize)} the buffer holds ${s4.pendingGenerations.join(', ') || 'nothing'}`,
      );
      checks.check(
        'S4-ack-is-a-sequence-watermark-not-a-per-frame-disposition',
        s4.clientLastProcessed === s4.serverConsumedCount
          && s4.clientPendingCount === s4.clientSent - s4.clientLastProcessed,
        `client lastProcessed ${String(s4.clientLastProcessed)} equals the server consumedCount ${String(s4.serverConsumedCount)}, and pendingCount ${String(s4.clientPendingCount)} is exactly sent ${String(s4.clientSent)} minus that watermark — one integer over the send order, with no per-frame disposition`,
      );
      // Where is the acknowledged value actually declared? Reading the declaration files as text is how
      // PR-1 checks visibility elsewhere: the point is to see whether an application room can read the
      // acknowledgement it is causing, which a cast could only pretend to prove.
      let coreSearchFrom = process.cwd();
      let coreRoot = '';
      for (;;) {
        const candidate = join(coreSearchFrom, 'node_modules', '@colyseus', 'core');
        if (existsSync(candidate)) {
          coreRoot = realpathSync(candidate);
          break;
        }
        const parent = join(coreSearchFrom, '..');
        if (parent === coreSearchFrom) throw new Error('no installed @colyseus/core found from the probe');
        coreSearchFrom = parent;
      }
      const inputDeclarationDirectory = join(coreRoot, 'build', 'input');
      const declarationsDeclaringAck = readdirSync(inputDeclarationDirectory)
        .filter((name) => name.endsWith('.d.ts'))
        .filter((name) => readFileSync(join(inputDeclarationDirectory, name), 'utf8').includes('ackSeq'));
      checks.observe('ackValueDeclaredIn', declarationsDeclaringAck);
      checks.observe('inputDeclarationFiles', readdirSync(inputDeclarationDirectory).filter((name) => name.endsWith('.d.ts')));
      checks.check(
        'S4-ack-value-is-not-observable-through-the-public-room-accessor',
        declarationsDeclaringAck.length > 0 && declarationsDeclaringAck.every((name) => name === 'InputBuffer.d.ts'),
        `ackSeq is declared only in ${declarationsDeclaringAck.join(', ') || 'nowhere'}; the room-facing accessor exposes consumedCount but not the acknowledgement value, so a room cannot read the ack it is causing`,
      );
      checks.check(
        'S4-dropped-frames-ARE-retired-by-the-ack',
        s4wait.serverSettled && s4wait.ackSettled
          && dropped.length === 4 && s4.appliedLog.length === 0
          && dropped.every((generation) => s4.retiredByWatermark.includes(generation)),
        `the room consumed nothing (${String(s4.appliedLog.length)} steps logged) yet consumedCount reached ${String(s4.serverConsumedCount)}: overflow retired generations ${dropped.join(', ') || 'none'} and the watermark ${String(s4lastProcessed)} covers all of them — the corrected reading of the first submission's numbers`,
      );
      checks.check(
        'S4-dropped-frames-are-never-represented-in-state',
        dropped.length > 0 && s4.appliedLog.every((entry) => !dropped.includes(entry.generation)),
        `the room represented ${s4.appliedLog.map((entry) => `${entry.kind}:${String(entry.generation)}`).join(', ') || 'nothing'}; dropped generations ${dropped.join(', ')} appear in no step`,
      );
      checks.check(
        'S4-client-prunes-dropped-frames-without-knowing-they-were-dropped',
        s4.clientReplayableGenerations.every((generation) => s4.stillUnacked.includes(generation))
          && s4sent.slice(0, s4.clientLastProcessed).every((entry) => overflowing.handle.at(entry.seq) === undefined),
        `replayable seqs after the watermark hold generations ${s4.clientReplayableGenerations.join(', ') || 'none'}; every seq at or below ${String(s4lastProcessed)} returns undefined from handle.at()`,
      );
      checks.observe('S4_supersededFirstReading', {
        previousObservation: { clientSent: 6, bufferSize: 2, serverConsumed: 4, clientLastProcessed: 4 },
        previousExpression: 'clientLastProcessed + bufferSize < clientSent',
        previousConclusion: 'S4-droppedFramesAcked = false, recorded as "frames the buffer dropped are never acknowledged"',
        whyThatWasWrong:
          'the expression is false exactly because every frame was accounted for — four retired and two still pending (4 + 2 = 6). Overflow eviction advances consumedCount by declaration, so the four surplus frames were retired, and lastProcessed 4 covers their seqs. A boolean built from totals cannot distinguish "nothing was dropped" from "dropped and acked".',
        correctedConclusion: 'overflow retires the evicted frames and the acknowledgement covers them, with no signal to the client that they were dropped',
        preservedEvidence: 'the original bundle from CI run 42678254682 is retained unchanged in the durable store; this file records the correction, not a rewrite',
      });

      // S5 — a synthesised idle frame is not a client input and must not move either counter.
      const idling = await scenario(client, 'udg-pr8-idle');
      const before = { server: idling.instance.pendingIdentities(idling.sessionId).consumedCount, client: idling.handle.lastProcessed };
      idling.instance.consumeOne(idling.sessionId, false);
      await sleep(600);
      const s5identities = idling.instance.pendingIdentities(idling.sessionId);
      const s5 = {
        nextResult: idling.instance.nextResult,
        wasIdle: idling.instance.consumed.at(-1)?.wasIdle === true,
        serverBefore: before.server,
        serverAfter: s5identities.consumedCount,
        clientBefore: before.client,
        clientAfter: idling.handle.lastProcessed,
        appliedLog: idling.instance.applied,
      };
      checks.observe('S5_idleSynthesis', s5);
      checks.check(
        'S5-idle-frame-is-not-acknowledged',
        s5.wasIdle && s5.serverAfter === s5.serverBefore && s5.clientAfter === s5.clientBefore,
        `idle synthesis moved the server counter from ${String(s5.serverBefore)} to ${String(s5.serverAfter)} and the client counter from ${String(s5.clientBefore)} to ${String(s5.clientAfter)}`,
      );

      // The synthesis: what one acknowledgement means, and what it cannot say.
      checks.observe('acknowledgementSemantics', {
        kind: 'sequence watermark over the client send order, not a per-frame disposition',
        valueEquivalences: {
          clientLastProcessedEqualsConsumedCount: s4.clientLastProcessed === s4.serverConsumedCount,
          pendingIsSentMinusAcked: s4.clientPendingCount === s4.clientSent - s4.clientLastProcessed,
        },
        retirementRuleObserved: `seq <= ${String(s4.clientLastProcessed)} is pruned by the client and unreadable via handle.at(); seq > ${String(s4.clientLastProcessed)} remains replayable`,
        countedAsConsumed: ['next() applied to state', 'next() consumed then refused by the application', 'overflow eviction'],
        refusedFrameRetired: s3.clientLastProcessed >= s3sent[0]!.seq,
        droppedFrameRetired: dropped.length > 0,
        synthesisedIdleAdvancesNeither: s5.serverAfter === s5.serverBefore && s5.clientAfter === s5.clientBefore,
        distinguishesAppliedFromRefused: false,
        distinguishesAppliedFromDropped: false,
        declarationBasis: [
          '@colyseus/core InputBuffer.d.ts: consumedCount counts consumption "via any consume primitive … plus clear and overflow … whether applied to state or discarded"',
          '@colyseus/sdk InputHandle.d.ts: lastProcessed is the server buffer consumed count echoed via the TIMED prefix; prune with seq <= lastProcessed',
        ],
      });

      checks.observe('d7Answer', {
        question: 'can the pinned acknowledgement satisfy "never acknowledge a frame that was never represented in state"?',
        answer: 'no, not by itself',
        evidence: [
          'a consumed-then-refused frame is acked exactly like an applied one (S3), though an authoritative neutral step did advance state',
          `frames dropped by overflow are acked too (S4: generations ${dropped.join(', ')} retired with no state step at all)`,
          'no InputHandle member withholds, retracts or qualifies an acknowledgement',
        ],
        distinctionTheAckCannotMake: 'applied vs refused vs dropped — all three retire the same seq',
        distinctionTheApplicationCanMake: 'the room logged which generations it represented and with which intent (S2 applied, S3 neutral-on-refusal, S4 no step at all); that record is per-frame and lives outside the library',
        whatThatRecordDoesNotProve:
          'an application journal shows what the server did. It does not make the client\'s reconciliation truthful: the client prunes on the watermark alone, so a client that kept predicting from a dropped or refused frame is not told to stop by this channel. Proving client-side convergence is UDG-SPIKE-001 work, not something this probe can claim.',
        decision: 'D-7 stays the owner\'s. Nothing here waives the prohibition or restates it as satisfied.',
      });

      checks.limit('PR-8 measures one room, one client and loopback latency. It does not measure behaviour under packet loss, reconnection, or an unreliable input mode (the room declares reliable input, where the ack value coincides with consumedCount by declaration).');
      checks.limit('The applied-state log is written by the probe room to model what the application represents; it is not a Colyseus facility, and it proves what the server stepped, not what the client rendered.');
      checks.limit('D-7 is the owner’s decision on that finding.');
    } finally {
      await server.close();
    }
  });
}

await main();
