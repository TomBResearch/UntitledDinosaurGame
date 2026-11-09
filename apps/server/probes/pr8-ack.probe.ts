/**
 * PR-8 — what does the acknowledgement actually track: frames received, or frames applied?
 *
 * [UDG-003.md](../../../docs/contracts/UDG-003.md) and [movement-authority.md 5.1](../../../docs/interfaces/movement-authority.md)
 * forbid acknowledging a frame that was never represented in state, and counting a refusal is not
 * evidence that an acknowledgement is truthful. So this probe runs five scenarios against a real room
 * and a real client and reads both sides of the same counter: the server's
 * `inputs.get(sessionId).consumedCount` and the client's `input.lastProcessed`.
 *
 * The scenarios are chosen so the answer cannot be inferred from a docstring: a frame that is buffered
 * but unconsumed, a frame that is consumed and applied, a frame that is **consumed and refused**, a
 * buffer that overflows, and a synthesised idle frame. Whatever the numbers say is what goes to the
 * owner for decision D-7 — this probe never claims the acknowledgement is truthful, and it never
 * treats a counter as the proof.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
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

function frame(index: number): DirectInputFrame {
  return { sessionEpoch: EPOCH, generation: index + 1, directIntent: true, moveX: 0.5, moveZ: 0 };
}

/** Send `count` distinct frames; distinctness matters because the client delta-encodes. */
async function send(scenario: Scenario, count: number, from = 0): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    Object.assign(scenario.handle.data, frame(from + index));
    scenario.handle.send();
    await sleep(10);
  }
  const arrived = await until(() => {
    scenario.instance.observeBuffer(scenario.sessionId);
    return scenario.instance.peeked >= Math.min(count, scenario.instance.bufferMaxSize);
  }, 2_000);
  if (!arrived) throw new Error(`only ${String(scenario.instance.peeked)} of ${String(count)} frames reached the room`);
}

async function scenario(client: Client, name: string): Promise<Scenario> {
  const room = await client.create<RegionState>(name, {}, RegionSchema);
  const instance = lastOf(inputRooms);
  if (instance === undefined) throw new Error('the room instance was never constructed');
  return { room, handle: room.input<DirectInputFrame>(), instance, sessionId: room.sessionId };
}

async function main(): Promise<void> {
  const out = outputPath(process.argv.slice(2));

  await runProbe('PR-8', 'what the acknowledgement tracks: received, consumed or applied', out, async (checks) => {
    const rooms: Record<string, RegisteredHandler> = {
      'udg-pr8-default': defineRoom(InputRoom),
      'udg-pr8-small': defineRoom(InputRoom, { bufferMaxSize: 2 }),
      'udg-pr8-idle': defineRoom(InputRoom, { declareIdle: true }),
    };
    const server = await startProbeServer(rooms);
    try {
      const client = new Client(httpEndpoint(server.endpoint));

      // S1 — three frames delivered, none consumed.
      const buffered = await scenario(client, 'udg-pr8-default');
      await send(buffered, 3);
      await sleep(600); // longer than the default 100 ms patch interval, so any ack has had time to ride out
      const s1 = {
        serverConsumed: buffered.instance.consumedCounts.at(-1) ?? -1,
        clientLastProcessed: buffered.handle.lastProcessed,
        clientSent: buffered.handle.sentCount,
        pending: buffered.handle.pendingCount,
        bufferSize: buffered.instance.accessorSize.at(-1) ?? -1,
      };
      checks.observe('S1_bufferedNotConsumed', s1);
      checks.check('S1-buffered', s1.bufferSize >= 1, `room buffer holds ${String(s1.bufferSize)}`);
      checks.check('S1-ack-does-not-follow-receipt', s1.clientLastProcessed === 0 && s1.serverConsumed === 0, `client lastProcessed ${String(s1.clientLastProcessed)}, server consumedCount ${String(s1.serverConsumed)} after 3 received frames`);

      // S2 — consume exactly one, and apply it.
      buffered.instance.consumeOne(buffered.sessionId, false);
      const applied = await until(() => buffered.handle.lastProcessed >= 1, 2_000);
      const s2 = {
        serverConsumed: buffered.instance.consumedCounts.at(-1) ?? -1,
        clientLastProcessed: buffered.handle.lastProcessed,
        appliedArrived: applied,
      };
      checks.observe('S2_consumedAndApplied', s2);
      checks.check('S2-ack-advances-by-one', applied && s2.serverConsumed === 1 && s2.clientLastProcessed === 1, `server ${String(s2.serverConsumed)}, client ${String(s2.clientLastProcessed)}`);

      // S3 — the decisive case: consume a frame and refuse it. Nothing about it is ever applied.
      const refused = await scenario(client, 'udg-pr8-default');
      await send(refused, 2);
      refused.instance.consumeOne(refused.sessionId, true);
      const refusedAck = await until(() => refused.handle.lastProcessed >= 1, 2_000);
      const s3 = {
        serverConsumed: refused.instance.consumedCounts.at(-1) ?? -1,
        clientLastProcessed: refused.handle.lastProcessed,
        refusedWasRecorded: refused.instance.consumed.at(-1)?.refused === true,
        ackArrived: refusedAck,
      };
      checks.observe('S3_consumedThenRefused', s3);
      checks.check('S3-refusal-is-invisible-to-the-ack', s3.refusedWasRecorded && s3.serverConsumed === 1 && s3.clientLastProcessed === 1, `the frame was refused by the application yet server=${String(s3.serverConsumed)} and client lastProcessed=${String(s3.clientLastProcessed)}`);
      // Is there any public surface that could withhold or retract an acknowledgement? Read the
      // installed declarations rather than asserting it from memory.
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

      // S4 — overflow, where the declaration says a dropped frame advances the ack.
      const overflowing = await scenario(client, 'udg-pr8-small');
      await send(overflowing, 6);
      await sleep(600);
      const s4 = {
        bufferMaxSize: overflowing.instance.bufferMaxSize,
        bufferSize: overflowing.instance.accessorSize.at(-1) ?? -1,
        serverConsumed: overflowing.instance.consumedCounts.at(-1) ?? -1,
        clientLastProcessed: overflowing.handle.lastProcessed,
        clientSent: overflowing.handle.sentCount,
      };
      checks.observe('S4_overflow', s4);
      checks.check('S4-buffer-is-bounded', s4.bufferSize <= s4.bufferMaxSize, `buffer ${String(s4.bufferSize)} against a declared maximum of ${String(s4.bufferMaxSize)}`);
      checks.observe('S4-droppedFramesAcked', s4.clientLastProcessed + s4.bufferSize < s4.clientSent);

      // S5 — a synthesised idle frame must not move the ack.
      const idling = await scenario(client, 'udg-pr8-idle');
      const before = { server: idling.instance.consumedCounts.at(-1) ?? 0, client: idling.handle.lastProcessed };
      idling.instance.consumeOne(idling.sessionId, false);
      await sleep(600);
      const s5 = {
        nextResult: idling.instance.nextResult,
        wasIdle: idling.instance.consumed.at(-1)?.wasIdle === true,
        serverBefore: before.server,
        serverAfter: idling.instance.consumedCounts.at(-1) ?? -1,
        clientBefore: before.client,
        clientAfter: idling.handle.lastProcessed,
      };
      checks.observe('S5_idleSynthesis', s5);
      checks.check('S5-idle-frame-is-not-acknowledged', s5.wasIdle && s5.serverAfter === s5.serverBefore && s5.clientAfter === s5.clientBefore, `idle synthesis moved the server counter from ${String(s5.serverBefore)} to ${String(s5.serverAfter)} and the client counter from ${String(s5.clientBefore)} to ${String(s5.clientAfter)}`);

      const tracks = s1.clientLastProcessed === 0 && s2.clientLastProcessed === 1 && s3.clientLastProcessed === 1
        ? 'consumed'
        : s1.clientLastProcessed > 0
          ? 'received'
          : 'indeterminate';
      checks.observe('acknowledgementTracks', tracks);
      checks.observe('d7Answer', {
        tracksConsumed: tracks === 'consumed',
        distinguishesAppliedFromConsumed: false,
        publicApiToWithholdOrRetract: 'none found in the installed declarations',
        consequence: 'A frame the application consumes and then refuses is still acknowledged to the client, so the pinned acknowledgement cannot by itself satisfy "never acknowledge a frame that was never represented in state". The application journal, not this counter, is the only record that distinguishes them.',
      });

      checks.limit('PR-8 measures one room, one client and loopback latency. It does not measure behaviour under packet loss or reconnection.');
      checks.limit('D-7 is the owner’s decision on that finding. Nothing here waives the prohibition or restates it as satisfied.');
    } finally {
      await server.close();
    }
  });
}

await main();
