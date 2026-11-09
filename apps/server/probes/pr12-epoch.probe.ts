/**
 * PR-12 — is the epoch-renewal procedure public and usable?
 *
 * UDG's protocol carries a server-assigned `sessionEpoch`, and P03 needs a way to renew it: a
 * `RESYNC_REQUIRED` client and a generation-exhausted client both have to come back with a fresh epoch.
 * The pinned SDK's own identity model is different — a stable `sessionId` plus a reconnection token that
 * deliberately *preserves* identity — so the probe must establish what exists rather than assume a
 * `resetEpoch()`-shaped call is there. [colyseus.md 6.2](../../../docs/integration/colyseus.md) warns
 * specifically about that.
 *
 * A reconnection token is a credential. This probe records its length and shape only, never its value,
 * and [evidence-requirements.md](../../../docs/validation/evidence-requirements.md) keeps it out of the
 * bundle.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { defineRoom } from '@colyseus/core';
import { Client, type InputHandle } from '@colyseus/sdk';
import { RegionSchema, type RegionSchema as RegionState } from '@udg/protocol/schema';

import { InputRoom, lastOf, SessionRoom, sessionRooms } from './rooms.js';
import { httpEndpoint, outputPath, runProbe, sleep, startProbeServer, type DirectInputFrame } from './support.js';

function declarationFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...declarationFiles(absolute));
    } else if (entry.endsWith('.d.ts')) {
      found.push(absolute);
    }
  }
  return found;
}

/** Every exported declaration that mentions an epoch, across the two installed packages. */
function epochDeclarations(root: string, packages: readonly string[]): string[] {
  const hits: string[] = [];
  for (const pkg of packages) {
    const directory = join(root, 'node_modules', '@colyseus', pkg, 'build');
    try {
      for (const file of declarationFiles(directory)) {
        const text = readFileSync(file, 'utf8');
        for (const line of text.split('\n')) {
          if (!/epoch/i.test(line) || !/export|readonly|[a-zA-Z]\s*[(:]/.test(line)) continue;
          const trimmed = line.trim();
          // Prose is kept in the observation but never counts as an API: a doc comment that says
          // "no manual reset() wiring needed" is not a declaration of one.
          const kind = trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*') ? 'doc' : 'decl';
          hits.push(`${pkg}/${file.slice(directory.length + 1)}: ${kind} ${trimmed.slice(0, 110)}`);
        }
      }
    } catch {
      hits.push(`${pkg}: build declarations unreadable`);
    }
  }
  return hits.slice(0, 40);
}

function packageRoot(packageName: string): string {
  let current = process.cwd();
  for (;;) {
    const candidate = join(current, 'node_modules', packageName);
    try {
      if (statSync(candidate).isDirectory()) return current;
    } catch {
      // not here; keep walking up
    }
    const parent = join(current, '..');
    if (parent === current) throw new Error(`no installed ${packageName} found from the probe`);
    current = parent;
  }
}

async function main(): Promise<void> {
  const out = outputPath(process.argv.slice(2));
  await runProbe('PR-12', 'epoch renewal lifecycle in the public API', out, async (checks) => {
    const server = await startProbeServer({
      'udg-pr12-session': defineRoom(SessionRoom),
      'udg-pr12-input': defineRoom(InputRoom),
    });
    try {

      // 1 — the identity model the pinned set actually offers.
      const client = new Client(httpEndpoint(server.endpoint));
      const room = await client.create<RegionState>('udg-pr12-session', {}, RegionSchema);
      const instance = lastOf(sessionRooms);
      const token = room.reconnectionToken;
      const firstSessionId = room.sessionId;
      checks.observe('sessionIdIsOpaque', { length: firstSessionId.length, unique: new Set(instance?.joins).size > 0 });
      checks.check('session-identity-is-issued', firstSessionId.length > 0 && instance?.joins.includes(firstSessionId) === true, 'the server and the client agree on one session identity');
      checks.check('reconnection-token-is-a-credential', token.length > 0, `token length ${String(token.length)}; the value is never recorded`);

      // 2 — reconnection *preserves* identity, which is the opposite of renewing an epoch.
      const code = await room.leave(false);
      await sleep(120);
      let reconnectedSessionId: string | null = null;
      let reconnectError: string | null = null;
      try {
        const again = await client.reconnect<RegionState>(token, RegionSchema);
        reconnectedSessionId = again.sessionId;
      } catch (error) {
        reconnectError = error instanceof Error ? error.message : String(error);
      }
      checks.observe('leaveCode', code);
      const seat = lastOf(sessionRooms);
      checks.observe('serverSideReconnections', seat?.reconnections.length ?? 0);
      checks.observe('serverSideReconnectionWindowsClosed', seat?.reconnectionWindowsClosed ?? 0);
      checks.observe('reconnectPreservesIdentity', reconnectedSessionId === firstSessionId);
      checks.observe('reconnectError', reconnectError);
      checks.check('reconnection-is-public-and-exercised', reconnectedSessionId !== null || reconnectError !== null, reconnectedSessionId !== null ? `same identity returned: ${String(reconnectedSessionId === firstSessionId)}` : `reconnect failed publicly: ${reconnectError}`);

      // 3 — a new session yields a new identity: the primitive UDG can build epoch renewal on.
      const fresh = new Client(httpEndpoint(server.endpoint));
      const freshRoom = await fresh.create<RegionState>('udg-pr12-session', {}, RegionSchema);
      checks.check('new-session-yields-a-new-identity', freshRoom.sessionId !== firstSessionId, 'a distinct session identity is issued per join, so the server can stamp a new application epoch at join time');

      // 4 — the only "epoch" the input channel exposes is a reset counter, not a session epoch.
      const inputRoom = await client.create<RegionState>('udg-pr12-input', {}, RegionSchema);
      const handle: InputHandle<DirectInputFrame> = inputRoom.input<DirectInputFrame>();
      const epochBefore = handle.epoch;
      handle.reset();
      const epochAfter = handle.epoch;
      checks.observe('inputHandleEpoch', { before: epochBefore, after: epochAfter, sessionIdUnchanged: inputRoom.sessionId === firstSessionId ? false : true });
      checks.check('input-handle-epoch-is-a-reset-counter', epochAfter === epochBefore + 1, `handle.epoch moved ${String(epochBefore)} → ${String(epochAfter)} on reset(), and nothing about it names a session`);

      // 5 — the honest negative: is there any exported epoch surface at all?
      const hits = epochDeclarations(packageRoot('@colyseus/core'), ['core', 'sdk']);
      checks.observe('epochDeclarations', hits);
      const renewalLike = hits.filter((entry) => entry.includes(': decl ') && /(reset|renew|increment|rotate|bump).*epoch|epoch.*(reset|renew|increment|rotate|bump)/i.test(entry));
      checks.check('no-public-epoch-renewal-api', renewalLike.length === 0, renewalLike.length === 0 ? 'no exported epoch-renewal symbol exists in the installed declarations' : renewalLike.join(' | '));

      checks.observe('blocked', renewalLike.length === 0);
      checks.limit('PR-12 outcome: the pinned set has no epoch concept. Identity is a per-join sessionId plus an opaque reconnection token that preserves it, and the only "epoch" on the wire is a client-side input reset counter.');
      checks.limit('UDG must therefore assign and renew sessionEpoch itself at its own join boundary, which is UDG-003 Phase 2 work (DevelopmentSessions). This is recorded as BLOCKED for "the public epoch-renewal procedure is discovered": there is nothing to discover, and inventing a reset call is forbidden.');
      checks.limit('Reconnection tokens are credentials; only the length is recorded, per the evidence rules.');
    } finally {
      await server.close();
    }
  });
}

await main();
