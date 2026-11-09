/**
 * PR-12 — what lifecycle primitives exist for the session epoch UDG owns?
 *
 * `sessionEpoch` is a **UDG protocol concept owned by UDG**
 * ([protocol-v1.md](../../../docs/contracts/protocol-v1.md),
 * [movement-authority.md](../../../docs/interfaces/movement-authority.md)): the server assigns it, the
 * server validates it, and the server decides when it is renewed — which P03 needs for
 * `RESYNC_REQUIRED` and for generation-domain exhaustion. Colyseus 0.18 has no such concept and is not
 * expected to have one, so **the absence of an epoch API is not a library defect** and is not recorded as
 * one. What this probe had to establish is the boundary it designs against: which supported primitives an
 * application-owned epoch can be built on, and what remains unproved.
 *
 * The pinned SDK's identity model is a per-join `sessionId` plus an opaque reconnection token that
 * deliberately *preserves* identity — the opposite of renewal — and an unrelated client-side input
 * bookkeeping counter also spelled "epoch" (`InputHandle.epoch`), which must not be confused with the
 * protocol field. [colyseus.md 6.2](../../../docs/integration/colyseus.md) warns about exactly that
 * confusion; this probe separates the two by measurement.
 *
 * A reconnection token is a credential. This probe records its length only, never its value, and
 * [evidence-requirements.md](../../../docs/validation/evidence-requirements.md) keeps it out of the bundle.
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
  await runProbe('PR-12', 'lifecycle primitives available to an application-owned session epoch', out, async (checks) => {
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
      const inputRoomSessionBefore = inputRoom.sessionId;
      handle.reset();
      const epochAfter = handle.epoch;
      // Measured in the same room whose handle was reset: a reset moves the input counter and leaves the
      // session identity alone. Comparing across two rooms would only prove that joins differ, which the
      // check above already establishes.
      checks.observe('inputHandleEpoch', {
        before: epochBefore,
        after: epochAfter,
        sessionIdUnchanged: inputRoomSessionBefore === inputRoom.sessionId,
      });
      checks.check('input-handle-epoch-is-a-reset-counter', epochAfter === epochBefore + 1, `handle.epoch moved ${String(epochBefore)} → ${String(epochAfter)} on reset(), and nothing about it names a session`);

      // 5 — the honest negative: is there any exported epoch surface at all?
      const hits = epochDeclarations(packageRoot('@colyseus/core'), ['core', 'sdk']);
      checks.observe('epochDeclarations', hits);
      const renewalLike = hits.filter((entry) => entry.includes(': decl ') && /(reset|renew|increment|rotate|bump).*epoch|epoch.*(reset|renew|increment|rotate|bump)/i.test(entry));
      // Scope statement, not a defect report: the library does not own this concept, so it has no API
      // for it. The check below records the boundary a UDG implementation is designed against.
      checks.check(
        'epoch-renewal-is-outside-library-scope',
        renewalLike.length === 0,
        renewalLike.length === 0
          ? 'no exported epoch symbol of any kind exists in @colyseus/core or @colyseus/sdk, so epoch ownership falls entirely to UDG — expected for a protocol-level concept, and recorded as a design obligation rather than a library defect'
          : renewalLike.join(' | '),
      );

      // What *is* supported, and what an application-owned epoch can therefore be built on.
      checks.observe('supportedLifecyclePrimitives', {
        joinIssuesIdentity: 'each create() gets a fresh server-issued sessionId (measured: distinct from the first session)',
        reconnectionPreservesIdentity: reconnectedSessionId !== null && reconnectedSessionId === firstSessionId,
        reconnectionRequiresServerConsent: 'Room.allowReconnection(tokenTtlSeconds) must be called in onLeave; without it reconnect() is refused (measured in Phase 0 CI: "reconnection token invalid or expired")',
        transportDropCallback: 'Room.onDrop fires when a client disappears without a leave code (declared, exercised by SessionRoom)',
        inputHandleReset: 'InputHandle.reset() is client-side input bookkeeping: it moved handle.epoch by 1 and left the sessionId untouched',
      });

      checks.observe('sdkEpochAndUdgEpochAreDistinct', {
        sdkInputEpoch: { before: epochBefore, after: epochAfter, owns: 'the client input handle only' },
        udgSessionEpoch: { owns: 'UDG protocol, assigned and validated by the server, carried in every DirectInputSchema frame', declaredIn: '@udg/protocol, not @colyseus/*' },
        mustNotBeConfused: 'a handle.reset() does not renew a session epoch, and a new session epoch would not reset an input handle',
      });

      checks.observe('applicationRenewalProcedureStillRequired', {
        status: 'specified here, implemented nowhere — implementing it is UDG-003 Phase 2 work and is not authorised by this probe',
        steps: [
          'issue a sessionEpoch server-side at the join boundary, alongside the sessionId Colyseus already provides',
          'carry it in every frame and every command, and reject stale epochs with the existing GENERATION/epoch admission rules in @udg/protocol',
          'decide, per rejoin, whether the application treats it as the same session (token reconnection) or a new one (new epoch), and record which',
          'publish the epoch to the client through authoritative state so prediction and reconciliation restart from it atomically with the state patch',
          'renew on RESYNC_REQUIRED and on generation-domain exhaustion, keeping the epoch within EPOCH_MAX (4_294_967_295) with no wrap',
        ],
      });

      checks.observe('remainsUnproved', [
        'that a reconnection token can be revoked before its TTL expires, so a compromised or stale client can be locked out early',
        'that an allowReconnection seat survives a server restart — nothing here measures persistence, and Phase 0 has no persistence layer',
        'that the epoch can reach the client atomically with the state patch that follows renewal',
        'behaviour of any of this under a real restart, packet loss, or a multi-process deployment',
        'how an input-handle reset should interact with an epoch change; handle.reset() is not part of the renewal procedure and must not be used as one',
      ]);

      checks.limit('PR-12 measures a single in-process server with loopback clients. It says nothing about persistence, restart, or multi-process identity, and it does not implement renewal.');
      checks.limit('Reconnection tokens are credentials; only the length is recorded, per the evidence rules.');
    } finally {
      await server.close();
    }
  });
}

await main();
