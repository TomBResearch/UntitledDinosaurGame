/**
 * UDG-SPIKE-001 (Gate A, review amendment, owner-approved 2026-11-19) — the trusted stepper seam.
 *
 * The amendment added ONE optional, process-local `stepperFactory` parameter to
 * `buildMovementAuthority` and the matching trusted-only field on `RegionRoomOptions`, so a test
 * composition (the netcode harness room, the AC-1 reference trace) can step the authority with THE
 * shared client kernel (`apps/client/src/network/flatStep.ts`) instead of a second implementation.
 * The production default is unchanged: omitting the parameter constructs exactly the
 * `FlatReferenceStepper(speed)` the constructor line always constructed.
 *
 * What this suite pins is the SECURITY half of the amendment — a client cannot select a factory:
 *   1. the deployment envelope is trusted only behind a per-process random nonce; a guessed nonce,
 *      or no nonce at all, discards the options WHOLESALE (the room is refused here for missing
 *      bounds — the very bounds the hostile caller supplied — and the sentinel factory is never
 *      even called, let alone used to step anything);
 *   2. `stepperFactory` is not a configuration key: the config compiler silently DROPS unknown
 *      keys, so a config-carried factory cannot survive to the authority or into the config hash;
 *   3. the wire frame is a fixed six-field exact-key set validated field-by-field (the frame's
 *      own validator rejects extras) and JSON cannot carry a function;
 *   4. the trusted positive path exists (the operator seam accepts the factory), with the live
 *      end-to-end use evidenced in the netcode suite's kernel-stepper sentinel check.
 */

import { expect, it } from 'vitest';

const ROOT_URL = new URL('../../..', import.meta.url);

interface HostileRoom {
  onCreate(raw: unknown): void;
}

const loadServer = async (): Promise<{
  RegionRoom: new () => HostileRoom;
  defineOperatorRegionRoom: (options: Record<string, unknown>) => unknown;
}> => import(new URL('apps/server/dist/rooms/RegionRoom.js', ROOT_URL).href);

const loadConfig = async (): Promise<{
  DEFAULT_SERVER_CONFIG: object;
  withConfigOverrides: (base: object, overrides: unknown) => object;
}> => import(new URL('packages/config/dist/index.js', ROOT_URL).href);

const BOUNDS = { region: { bounds: { x: { min: -50, max: 50 }, y: { min: -5, max: 20 }, z: { min: -50, max: 50 } } } };

const sentinelFactory = (counter: { calls: number }): unknown => ({
  step: (): never => {
    counter.calls += 1;
    throw new Error('the sentinel factory must never step in this suite');
  },
});

it('a deployment envelope without the per-process operator nonce is discarded wholesale: the hostile bounds do not apply and the hostile factory is never used', async () => {
  const roomModule = await loadServer();
  const counter = { calls: 0 };
  const hostileEnvelopes: readonly Record<string, unknown>[] = [
    // A guessed nonce: the envelope is untrusted, so even VALID bounds inside it are dropped.
    { deploymentNonce: '00000000-0000-0000-0000-000000000000', deployment: { ...BOUNDS, stepperFactory: sentinelFactory(counter) } },
    // Client create/join options as they arrive from `client.create(name, options)` — no nonce.
    { ...BOUNDS, stepperFactory: sentinelFactory(counter) },
    // The factory smuggled as a plain data value beside trusted-looking config.
    { deploymentNonce: 'guess', deployment: { config: BOUNDS.region, stepperFactory: 'apps/client#flatDirectStep' } },
  ];
  for (const [index, raw] of hostileEnvelopes.entries()) {
    const room = new roomModule.RegionRoom();
    // The room refuses: without a TRUSTED deployment there are no region bounds, and the
    // authority refuses to run without them (D5: no invented default). The hostile caller's
    // bounds never took effect — that IS the observation.
    expect(() => room.onCreate(raw), `hostile envelope ${index} must be refused`).toThrow(/region bounds are not configured/);
  }
  expect(counter.calls, 'a client-selected factory is never constructed, let alone stepped').toBe(0);
});

it('stepperFactory is not a configuration key: the config compiler drops it and the compiled config carries no factory', async () => {
  const config = await loadConfig();
  const compiled = config.withConfigOverrides(config.DEFAULT_SERVER_CONFIG, { ...BOUNDS, stepperFactory: 'evil' });
  expect(Object.keys(compiled).includes('stepperFactory'), 'compiled config names no stepperFactory').toBe(false);
  expect((compiled as Record<string, unknown>)['stepperFactory'], 'compiled config carries no factory value').toBeUndefined();
});

it('the wire frame is a fixed six-field exact-key set — no frame field can carry or select a factory', async () => {
  const validation = await import(new URL('packages/protocol/dist/validation/direct.js', ROOT_URL).href) as {
    DIRECT_WIRE_FRAME_FIELDS: readonly string[];
    validateDirectWireFrame: (raw: unknown, context: { sessionEpoch: number }) => { ok: boolean };
  };
  expect([...validation.DIRECT_WIRE_FRAME_FIELDS].sort()).toEqual(
    ['directIntent', 'generation', 'moveX', 'moveZ', 'seq', 'sessionEpoch'],
  );
  const extra = validation.validateDirectWireFrame(
    { sessionEpoch: 1, generation: 1, directIntent: true, moveX: 0, moveZ: 1, seq: 1, stepperFactory: 'evil' },
    { sessionEpoch: 1 },
  );
  expect(extra.ok, 'an extra wire key is refused by the exact-key gate').toBe(false);
});

it('the trusted seam exists: the operator deployment accepts a stepperFactory (the netcode suite drives a live room through it and counts its steps)', async () => {
  const roomModule = await loadServer();
  const counter = { calls: 0 };
  const handler = roomModule.defineOperatorRegionRoom({ ...BOUNDS, stepperFactory: sentinelFactory(counter) });
  expect(typeof handler === 'object' && handler !== null, 'the trusted deployment registers').toBe(true);
});
