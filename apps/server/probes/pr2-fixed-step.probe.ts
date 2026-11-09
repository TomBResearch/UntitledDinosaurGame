/**
 * PR-2 — does the pinned set provide a public fixed-step facility at the advertised rate?
 *
 * This is the Gate A dependency: [UDG-003.md](../../../docs/contracts/UDG-003.md) says an absent
 * required public fixed-step facility blocks Gate A and does not authorise an alternative loop. So the
 * probe measures the real thing — a room created by the matchmaker, ticking on a real transport — and
 * reports the observed rate, the `dt` the callback received, and whether the step index is monotonic.
 *
 * It also records what the step is *not* coupled to: the patch schedule. PR-10 (a later phase) counts
 * patches over a long run; here we only record the declared default so the two rates are visibly
 * separate numbers.
 */

import { defineRoom } from '@colyseus/core';
import { Client } from '@colyseus/sdk';
import { RegionSchema } from '@udg/protocol/schema';

import { lastOf, tickRooms, TickRoom } from './rooms.js';
import { httpEndpoint, outputPath, runProbe, sleep, startProbeServer, until } from './support.js';

const TICK_RATE = 20;
const WINDOW_MS = 3_000;

async function main(): Promise<void> {
  const out = outputPath(process.argv.slice(2));
  await runProbe('PR-2', 'public fixed-step facility at the advertised dt', out, async (checks) => {
    const server = await startProbeServer({ 'udg-pr2': defineRoom(TickRoom, { tickRate: TICK_RATE }) });
    try {
      const client = new Client(httpEndpoint(server.endpoint));
      const room = await client.create('udg-pr2', {}, RegionSchema);
      checks.check('room-created', room.roomId.length > 0, `room ${room.roomId}, session ${room.sessionId.length > 0 ? 'issued' : 'missing'}`);

      // The registry is module-level because the matchmaker constructs the room, not the probe.
      // Reading the live instance back is the point: the measurement must not come from a stand-in.
      const instance = lastOf(tickRooms);
      checks.check('room-instance-observed', instance !== undefined, instance === undefined ? 'no TickRoom was constructed' : 'TickRoom observed from the same process');
      if (instance === undefined) return;

      const before = instance.stamps.length;
      const startedAt = Date.now();
      const ticking = await until(() => instance.stamps.length - before >= 20, 4_000);
      await sleep(Math.max(0, WINDOW_MS - (Date.now() - startedAt)));

      const elapsedMs = Date.now() - startedAt;
      const steps = instance.stamps.length - before;
      const observedRate = (steps / elapsedMs) * 1_000;
      checks.observe('windowMs', elapsedMs);
      checks.observe('stepsInWindow', steps);
      checks.observe('observedRateHz', Number(observedRate.toFixed(3)));
      checks.check('facility-runs', ticking && steps >= 20, `${String(steps)} steps observed in ${String(elapsedMs)} ms`);
      checks.check('rate-is-20hz', Math.abs(observedRate - TICK_RATE) / TICK_RATE <= 0.1, `observed ${observedRate.toFixed(2)} Hz against a declared ${String(TICK_RATE)} Hz`);

      const contexts = instance.contexts.slice(-steps);
      const dtValues = [...new Set(contexts.map((entry) => entry.dt))];
      const tickIndexes = contexts.map((entry) => entry.tick);
      const contiguous = tickIndexes.every((value, index) => index === 0 || value === (tickIndexes[index - 1] ?? value) + 1);
      checks.observe('distinctDtValues', dtValues);
      checks.observe('firstContexts', contexts.slice(0, 3));
      checks.observe('subSteps', [...new Set(contexts.map((entry) => entry.subSteps))]);
      checks.check('dt-is-the-fixed-step', dtValues.length === 1 && dtValues[0] === 1 / TICK_RATE, `dt values ${dtValues.join(', ')}, expected exactly ${String(1 / TICK_RATE)}`);
      checks.check('tick-index-is-monotonic', contiguous, `tick indexes from ${String(tickIndexes[0])} to ${String(tickIndexes[tickIndexes.length - 1])}`);
      checks.check('no-wall-clock-delta-is-offered', instance.contexts.every((entry) => entry.dtMs === entry.dt * 1_000), 'the context carries dtMs derived from the fixed dt, never a measured interval');

      checks.observe('patchRateMs', instance.patchRate);
      checks.observe('unreliablePatchRateMs', instance.unreliablePatchRate);
      checks.limit('The probe measures a single room on one loopback socket. Tick regularity under load is a later measurement, not this one.');
      checks.limit(`Patch scheduling is only recorded here (${String(instance.patchRate)} ms default). The patch-versus-tick count comparison is PR-10 and is not claimed.`);
    } finally {
      await server.close();
    }
  });
}

await main();
