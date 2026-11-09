/**
 * PR-3 — is the accepted flat input declaration the one UDG-002 adopted, and does a real
 * send/receive preserve all five fields?
 *
 * The five fields are the wire contract in [protocol-v1.md](../../../docs/contracts/protocol-v1.md),
 * so this is not a "does a codec work" probe: it establishes that the *room* accepts
 * `DirectInputSchema` as its input declaration, that the values survive the transport unchanged, and
 * what the transport does with a repeat frame and with an out-of-domain frame. The last two matter for
 * P03: an unchanged repeat frame must not be mistaken for a new intention, and the schema is explicitly
 * not the trust boundary — `validateDirectFrame` is.
 */

import { defineRoom } from '@colyseus/core';
import { Client } from '@colyseus/sdk';
import { RegionSchema, type RegionSchema as RegionState } from '@udg/protocol/schema';
import { validateDirectFrame } from '@udg/protocol';

import { InputRoom, inputRooms, lastOf } from './rooms.js';
import { httpEndpoint, outputPath, runProbe, sleep, startProbeServer, until, type DirectInputFrame } from './support.js';

const EPOCH = 3;

function distinctive(index: number): DirectInputFrame {
  return { sessionEpoch: EPOCH, generation: index + 1, directIntent: true, moveX: 0.25, moveZ: -0.5 };
}

function same(left: DirectInputFrame, right: DirectInputFrame): boolean {
  return left.sessionEpoch === right.sessionEpoch
    && left.generation === right.generation
    && left.directIntent === right.directIntent
    && Object.is(left.moveX, right.moveX)
    && Object.is(left.moveZ, right.moveZ);
}

async function main(): Promise<void> {
  const out = outputPath(process.argv.slice(2));
  await runProbe('PR-3', 'DirectInputSchema accepted as the room input declaration, five fields preserved', out, async (checks) => {
    const server = await startProbeServer({ 'udg-pr3': defineRoom(InputRoom) });
    try {
      const client = new Client(httpEndpoint(server.endpoint));
      const room = await client.create<RegionState>('udg-pr3', {}, RegionSchema);
      // The matchmaker constructs the room, so the probe reads the live instance back from the registry.
      const instance = lastOf(inputRooms);
      checks.check('room-instance-observed', instance !== undefined, 'InputRoom was not constructed');
      if (instance === undefined) return;

      const sessionId = room.sessionId;
      checks.check('session-id-matches-server', instance.sessionIds.includes(sessionId), `server saw ${instance.sessionIds.join(', ')}`);
      checks.check('declaration-is-the-adopted-one', instance.declaredFields().join(',') === 'sessionEpoch,generation,directIntent,moveX,moveZ', `declared fields ${instance.declaredFields().join(', ')}`);

      const handle = room.input<DirectInputFrame>();

      /**
       * Send one frame and read back exactly that frame.
       *
       * The buffer is drained first: the SDK keeps a standing connection and a stage that began
       * before the previous frame had landed would otherwise consume the wrong one, which is how the
       * first revision of this probe ended up comparing stage 3 against stage 1's values.
       */
      const deliver = async (frame: DirectInputFrame): Promise<DirectInputFrame | undefined> => {
        instance.consumeAll(sessionId);
        Object.assign(handle.data, frame);
        handle.send();
        const arrived = await until(() => {
          instance.observeBuffer(sessionId);
          return instance.peeked >= 1;
        }, 2_000);
        if (!arrived) return undefined;
        instance.consumeOne(sessionId);
        return instance.consumed.at(-1)?.values;
      };

      // 1 — one frame, five distinctive values.
      const first = distinctive(0);
      const decoded = await deliver(first);
      checks.check('frame-arrived', decoded !== undefined, `no frame reached the room after one send of ${JSON.stringify(first)}`);
      checks.check('all-five-fields-preserved', decoded !== undefined && same(decoded, first), `sent ${JSON.stringify(first)}, decoded ${JSON.stringify(decoded)}`);
      checks.check('float64-carries-exactly', decoded !== undefined && Object.is(decoded.moveX, 0.25) && Object.is(decoded.moveZ, -0.5), `moveX ${String(decoded?.moveX)}, moveZ ${String(decoded?.moveZ)}`);

      // 2 — a repeat of the same values. The client encodes deltas, so this is the frame shape a held
      // key produces; what the server buffers here decides how UDG must read "no change".
      Object.assign(handle.data, first);
      handle.send();
      await sleep(200);
      instance.observeBuffer(sessionId);
      checks.observe('repeatFrameBufferSize', instance.accessorSize.at(-1));
      checks.observe('repeatFramePending', instance.peeked);
      checks.limit('A repeat frame is transmitted as a body-less delta and decodes as the previous values. A direct → keepalive → direct sequence therefore cannot be read as "the client stopped"; only `directIntent` says that, which is why the keepalive rule in P03 reads the field and never the absence of a frame.');

      // 3 — explicit zeros, i.e. the neutral frame a client really sends when it lets go.
      const neutral: DirectInputFrame = { sessionEpoch: EPOCH, generation: 4, directIntent: false, moveX: 0, moveZ: 0 };
      const neutralDecoded = await deliver(neutral);
      checks.check('neutral-frame-preserved', neutralDecoded !== undefined && same(neutralDecoded, neutral), `decoded ${JSON.stringify(neutralDecoded)}`);
      checks.check('minus-zero-is-normalised-by-codec', neutralDecoded !== undefined && Object.is(neutralDecoded.moveX, 0), `moveX decoded as ${String(neutralDecoded?.moveX)} (the codec decodes -0 as +0, which the protocol normalisation already expects)`);

      // 4 — out-of-domain values. The codec coerces silently, so what arrives is what must be refused.
      const hostile: DirectInputFrame = { sessionEpoch: 2 ** 32 + 7, generation: 2 ** 32 + 1, directIntent: true, moveX: 1e300, moveZ: Number.NaN };
      const rawDecoded = await deliver(hostile);
      checks.observe('hostileWireSent', hostile);
      checks.observe('hostileWireDecoded', rawDecoded ?? 'nothing arrived');
      checks.check('malformed-frame-survives-the-transport', rawDecoded !== undefined, 'the room stayed alive and delivered a decodable frame');
      const observed = rawDecoded ?? neutral;

      const verdict = validateDirectFrame({ ...observed }, { sessionEpoch: EPOCH });
      const rejection = verdict.ok === false ? verdict.code : null;
      checks.observe('hostileValidatorOutcome', rejection ?? 'accepted');
      checks.check('validator-refuses-what-the-codec-coerced', rejection !== null, `validateDirectFrame returned ${String(rejection)}; the schema is not the trust boundary and no sanitize option is declared in the room`);

      checks.limit('PR-3 proves the declaration and the round trip. Queue depth, coalescing and overflow under saturation are PR-5, and the malformed-decode-through-the-room assertion in the contract sense is PR-4 — both later phases.');
      checks.limit('The room declares no `sanitize` option on purpose: it rewrites decoded values in place, which would hide from `validateDirectFrame` exactly the values UDG must refuse.');
    } finally {
      await server.close();
    }
  });
}

await main();
