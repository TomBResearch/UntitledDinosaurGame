/**
 * The test-only real-transport harness (UDG-003 Phase 2, §4.1 `tests/support/client-harness/**`).
 *
 * Two problems, both solved once here:
 *
 * 1. **Module resolution.** The pinned `@colyseus/core`/`@colyseus/sdk` are declared by
 *    `apps/server`, not by the repository root, and Node resolves bare specifiers from the
 *    *importing file*. A probe or integration test under `tests/**` therefore reaches the packages
 *    the same way the probe runner reaches the compiler: `createRequire` anchored at a file inside
 *    `apps/server`, then a dynamic import of the resolved file URL. Nothing here re-pins or
 *    version-detects anything — it loads exactly the workspace-installed packages.
 * 2. **The D-P2-1 boundary.** This harness is the *test-only* client. `apps/client` must never
 *    import it (there is a contract assertion for exactly that), and it carries no production
 *    behaviour: what lives here is connection plumbing plus the ADR-0003 §3.2 reconciliation state
 *    machine **as a reference implementation under test**, not a shipped client.
 *
 * Types are structural on purpose: naming the SDK classes by hand keeps this module importable
 * from contexts where the SDK declarations are not in the project (the probe entry runs on Node's
 * own type stripping), and a drift between the hand-written surface and the real packages shows up
 * as a runtime failure in the first scenario that touches the drifted member — which, for probes,
 * is the point.
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
/** Load the pinned packages exactly as `apps/server` sees them. */
export const loadPinnedStack = async (rootDir) => {
    const requireFromServer = createRequire(join(resolve(rootDir), 'apps', 'server', 'index.js'));
    const coreEntry = requireFromServer.resolve('@colyseus/core');
    const sdkEntry = requireFromServer.resolve('@colyseus/sdk');
    const wsEntry = requireFromServer.resolve('@colyseus/ws-transport');
    const core = (await import(pathToFileURL(coreEntry).href));
    const sdk = (await import(pathToFileURL(sdkEntry).href));
    const transport = (await import(pathToFileURL(wsEntry).href));
    const defineServer = core['defineServer'];
    const defineRoom = core['defineRoom'];
    const WebSocketTransportCtor = transport['WebSocketTransport'];
    const ClientCtor = sdk['Client'];
    if (typeof defineServer !== 'function' || typeof defineRoom !== 'function'
        || typeof WebSocketTransportCtor !== 'function' || typeof ClientCtor !== 'function') {
        throw new Error('the pinned stack did not expose defineServer/defineRoom/WebSocketTransport/Client');
    }
    return {
        core: {
            defineServer: defineServer,
            defineRoom: defineRoom,
            WebSocketTransportCtor: WebSocketTransportCtor,
        },
        sdk: { ClientCtor: ClientCtor },
    };
};
/** Boot a loopback server over the pinned WebSocket transport, exactly as the Phase 0 runner does. */
export const startHarnessServer = async (rootDir, rooms) => {
    const stack = await loadPinnedStack(rootDir);
    const httpServer = createServer();
    const transport = new stack.core.WebSocketTransportCtor({ server: httpServer });
    const server = stack.core.defineServer({ rooms, transport });
    await server.serverless();
    await new Promise((listening, failure) => {
        httpServer.once('error', failure);
        httpServer.listen(0, '127.0.0.1', () => {
            httpServer.off('error', failure);
            listening();
        });
    });
    const address = httpServer.address();
    if (address === null || typeof address === 'string')
        throw new Error('harness server bound no port');
    return {
        port: address.port,
        endpoint: `http://127.0.0.1:${String(address.port)}`,
        async close() {
            await server.gracefullyShutdown(false);
            await new Promise((closed) => {
                httpServer.close(() => {
                    closed();
                });
            });
        },
    };
};
/** Connect one SDK client to `roomName` with the join options that satisfy the hash gate. */
export const connectSeat = async (stack, endpoint, roomName, joinOptions, schemaCtor) => {
    const client = new stack.sdk.ClientCtor(endpoint);
    const room = await client.create(roomName, joinOptions, schemaCtor);
    return { room, handle: room.input() };
};
/** Stamp and send one direct wire frame: `sentCount + 1`, the value the SDK will acknowledge (PR-15 S1). */
export const stampAndSend = (handle, frame) => {
    Object.assign(handle.data, frame, { seq: handle.sentCount + 1 });
    return handle.send();
};
/** Convert the transport's `ws://` endpoint to the `http://` base the SDK client expects. */
export async function connectSeatById(stack, endpoint, roomId, joinOptions, schemaCtor) {
  const client = new stack.sdk.ClientCtor(endpoint);
  const room = await client.joinById(roomId, joinOptions, schemaCtor);
  return { room, handle: room.input() };
}
export const httpEndpoint = (wsEndpoint) => wsEndpoint.startsWith('wss://') ? `https://${wsEndpoint.slice(6)}` : `http://${wsEndpoint.slice(5)}`;
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
/** Poll `condition` until true or the budget runs out. */
export const until = async (condition, budgetMs, stepMs = 5) => {
    const deadline = Date.now() + budgetMs;
    while (!condition()) {
        if (Date.now() > deadline)
            return false;
        await sleep(stepMs);
    }
    return true;
};
export class ProbeRecorder {
    checks = [];
    observations = {};
    limitations = [];
    probeId;
    subject;
    invocationId;
    #startedAt = new Date().toISOString();
    constructor(probeId, subject, invocationId) {
        this.probeId = probeId;
        this.subject = subject;
        this.invocationId = invocationId;
    }
    check(name, ok, detail) {
        this.checks.push({ name, ok, detail });
    }
    observe(name, value) {
        this.observations[name] = value;
    }
    limit(text) {
        this.limitations.push(text);
    }
    get passed() {
        return this.checks.every((record) => record.ok);
    }
    write(outPath) {
        const body = {
            probeId: this.probeId,
            subject: this.subject,
            startedAt: this.#startedAt,
            finishedAt: new Date().toISOString(),
            ...(this.invocationId === undefined ? {} : { invocationId: this.invocationId }),
            ok: this.passed,
            verdict: this.passed ? 'pass' : 'fail',
            checks: this.checks,
            observations: this.observations,
            limitations: this.limitations,
        };
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, `${JSON.stringify(body, null, 2)}\n`);
    }
}
