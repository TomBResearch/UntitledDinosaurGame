/**
 * UDG-SPIKE-001 — GA-11 STAGING CONNECT PROBE (test-only portable measurement seam).
 *
 * WHY THIS EXISTS: a future owner-NOMINATED private endpoint (plan §15B prerequisites 1–5) needs
 * a bounded, endpoint-redacting connect-phase measurement that can be built, unit-tested and
 * localhost-smoked HERE AND NOW, without provisioning anything, touching any external host, or
 * creating any secret. It is a SEAM, not a verdict: a WebSocket connect RTT to a nominated host
 * says NOTHING about gameplay-path topology — the full-session GA-11 rows still need the owner's
 * deployment, client machines on real networks, and demonstrated reachability (§15B). What this
 * seam makes possible the day an endpoint exists: N bounded connect samples (DNS+TCP+TLS+WS
 * handshake time), redacted evidence (the endpoint VALUE never enters the record — only
 * sha256(host:port)), and a finite, always-retired run.
 *
 * RULES (unit-pinned): ZERO dependencies (Node built-ins + the runtime's global WebSocket; its
 * absence is a NAMED failure, never a silent skip); the endpoint must be supplied EXPLICITLY
 (env UDG_STAGING_ENDPOINT for the CLI — there is no default and nothing is ever guessed); the
 record NEVER contains the host, port literal, or URL — only its irreversible digest; every
 connection is opened with the runtime's default TLS verification (wss) and closed or destroyed
 within the declared budget; samples and total time are CLAMPED, and the probe ALWAYS returns a
 finite record — failures are named entries, never thrown.
 *
 * `--self-serve` mode runs against an in-process 127.0.0.1 handshake server on an EPHEMERAL
 * port: it is the localhost smoke that records the seam's topology end to end without any
 * external contact of any kind.
 */

import { createHash } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';

export const PROBE_KIND = 'UDG-SPIKE-001-staging-connect-probe';
export const MAX_SAMPLES = 20;
export const DEFAULT_SAMPLES = 5;
export const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
export const MAX_CONNECT_TIMEOUT_MS = 10_000;

interface MinimalWebSocket {
  readonly READY_STATE_CONNECTING: number;
  readonly url: string;
  onopen: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  close(code?: number, reason?: string): void;
}
type WebSocketGlobal = new (url: string) => MinimalWebSocket;

const getWebSocketGlobal = (): WebSocketGlobal | null => {
  const candidate = (globalThis as { WebSocket?: unknown }).WebSocket;
  return typeof candidate === 'function' ? (candidate as WebSocketGlobal) : null;
};

/** Irreversible endpoint identity: sha256 over the lowercased host:port ONLY (never the path,
 * which could carry a room token, and never any userinfo). */
export const endpointDigest = (endpoint: string): { digest: string; scheme: 'ws' | 'wss' } | { error: string } => {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { error: 'endpoint is not a parseable URL' };
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return { error: 'endpoint scheme must be ws: or wss:' };
  if (url.username !== '' || url.password !== '') return { error: 'endpoint must carry no userinfo (no secrets in URLs)' };
  const host = url.hostname.toLowerCase();
  const port = url.port !== '' ? url.port : url.protocol === 'wss:' ? '443' : '80';
  return { digest: createHash('sha256').update(`${host}:${port}`).digest('hex'), scheme: url.protocol === 'wss:' ? 'wss' : 'ws' };
};

export interface ConnectSample {
  readonly ok: boolean;
  readonly stage: 'open' | 'error' | 'timeout' | 'no-runtime' | 'bad-endpoint';
  readonly rttMs?: number;
  readonly errorName?: string;
}

export interface StagingProbeRecord {
  readonly kind: typeof PROBE_KIND;
  readonly redaction: string;
  readonly endpointDigest: string | null;
  readonly scheme: 'ws' | 'wss' | null;
  readonly runtime: { readonly node: string; readonly webSocketGlobal: 'present' | 'absent' };
  readonly limits: { readonly samples: number; readonly connectTimeoutMs: number; readonly tls: 'runtime-default-verification' | 'plain-ws-not-private' };
  readonly connects: readonly ConnectSample[];
  readonly summary: { readonly opens: number; readonly failures: number; readonly p50RttMs?: number; readonly p95RttMs?: number; readonly note?: string };
  readonly retired: { readonly closedWithinBudget: boolean; readonly totalMs: number };
}

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** ONE connect attempt, fully bounded. Never throws; every outcome is a named sample. */
const probeConnect = async (endpoint: string, timeoutMs: number): Promise<ConnectSample> => {
  const Ctor = getWebSocketGlobal();
  if (Ctor === null) return { ok: false, stage: 'no-runtime', errorName: 'global WebSocket absent on this Node runtime' };
  return await new Promise<ConnectSample>((resolve) => {
    let settled = false;
    const finish = (sample: ConnectSample): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close(1000, 'probe-complete'); // ORDERLY close; undici destroys if never opened
      } catch {
        /* retirement is best-effort; the budget below is the hard bound */
      }
      resolve(sample);
    };
    const started = performance.now();
    let ws: MinimalWebSocket;
    try {
      ws = new Ctor(endpoint);
    } catch (error) {
      resolve({ ok: false, stage: 'bad-endpoint', errorName: error instanceof Error ? error.name : 'unknown' });
      return;
    }
    const timer = setTimeout(() => finish({ ok: false, stage: 'timeout', errorName: `connect exceeded ${String(timeoutMs)} ms budget` }), timeoutMs);
    ws.onopen = (): void => finish({ ok: true, stage: 'open', rttMs: performance.now() - started });
    ws.onerror = (event): void => {
      const candidates = [(event as { error?: { code?: string } } | null)?.error?.code, (event as { message?: string } | null)?.message];
      const name = candidates.find((v) => typeof v === 'string' && v !== '') ?? 'ws-error'; // an ErrorEvent may carry an EMPTY message — the failure must still be NAMED
      finish({ ok: false, stage: 'error', errorName: String(name) });
    };
  });
};

/** The probe: N bounded samples against the EXPLICIT endpoint, digest-only evidence, finite by
 * construction. */
export const runStagingConnectProbe = async (
  endpoint: string,
  options: { samples?: number; connectTimeoutMs?: number } = {},
): Promise<StagingProbeRecord> => {
  const totalStarted = performance.now();
  const identity = endpointDigest(endpoint);
  const samples = Math.min(MAX_SAMPLES, Math.max(1, Math.floor(options.samples ?? DEFAULT_SAMPLES)));
  const connectTimeoutMs = Math.min(MAX_CONNECT_TIMEOUT_MS, Math.max(100, Math.floor(options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS)));
  const base: Pick<StagingProbeRecord, 'kind' | 'redaction' | 'runtime'> = {
    kind: PROBE_KIND,
    redaction: 'the endpoint value is NEVER recorded; endpointDigest = sha256(lowercased host:port) only; no path, no userinfo, nothing reversible',
    runtime: { node: process.version, webSocketGlobal: getWebSocketGlobal() === null ? ('absent' as const) : ('present' as const) },
  };
  if ('error' in identity) {
    return {
      ...base,
      endpointDigest: null,
      scheme: null,
      limits: { samples, connectTimeoutMs, tls: 'plain-ws-not-private' },
      connects: [{ ok: false, stage: 'bad-endpoint', errorName: identity.error }],
      summary: { opens: 0, failures: 1, note: 'endpoint rejected before any socket was opened — the rejection reason is named, the value is not' },
      retired: { closedWithinBudget: true, totalMs: performance.now() - totalStarted },
    };
  }
  const connects: ConnectSample[] = [];
  for (let i = 0; i < samples; i += 1) {
    connects.push(await probeConnect(endpoint, connectTimeoutMs));
    if (i < samples - 1) await settle(25); // small spacing so samples are independent handshakes, not one warm path
  }
  const opens = connects.filter((c) => c.ok && c.rttMs !== undefined);
  const summary = opens.length === 0
    ? { opens: 0, failures: connects.length, note: 'no successful opens — every attempt is a named failure entry' }
    : (() => {
        const sorted = opens.map((c) => c.rttMs as number).sort((a, b) => a - b);
        const rank = (p: number): number => {
          const v = sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
          return v ?? Number.NaN;
        };
        return { opens: opens.length, failures: connects.length - opens.length, p50RttMs: rank(50), p95RttMs: rank(95) };
      })();
  return {
    ...base,
    endpointDigest: identity.digest,
    scheme: identity.scheme,
    limits: { samples, connectTimeoutMs, tls: identity.scheme === 'wss' ? 'runtime-default-verification' : 'plain-ws-not-private' },
    connects,
    summary,
    retired: { closedWithinBudget: true, totalMs: performance.now() - totalStarted },
  };
};

/* ------------------------------------------------------------------ self-serve localhost smoke
 * A MINIMAL handshake-only server (RFC 6455 §1.3 accept, no frames — the probe never sends any)
 * bound to 127.0.0.1 on an EPHEMERAL port. It exists so the whole seam — open event, RTT,
 * redaction, retirement — is verifiable with zero external contact. It is NOT a game room and
 * proves nothing about gameplay paths; the record labels exactly that.
 */
const WS_ACCEPT_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export const startHandshakeOnlyServer = (): Promise<{ server: Server; port: number; stop(): Promise<void> }> =>
  new Promise((resolve) => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk.toString('latin1');
        const match = /Sec-WebSocket-Key:\s*(\S+)/i.exec(buffer);
        if (match !== null) {
          const accept = createHash('sha1').update(match[1] + WS_ACCEPT_GUID).digest('base64');
          socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
        }
      });
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => sockets.delete(socket));
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        server,
        port,
        stop: async () => {
          for (const s of sockets) s.destroy();
          sockets.clear();
          await new Promise<void>((done) => server.close(() => done()));
        },
      });
    });
  });

export const runSelfServeProbe = async (samples = DEFAULT_SAMPLES): Promise<{ record: StagingProbeRecord; note: string }> => {
  const hop = await startHandshakeOnlyServer();
  try {
    const record = await runStagingConnectProbe(`ws://127.0.0.1:${String(hop.port)}`, { samples, connectTimeoutMs: 2_000 });
    return {
      record,
      note: 'SELF-SERVE localhost smoke: the endpoint is an in-process handshake-only server on 127.0.0.1 with an EPHEMERAL port — it records the seam topology (open event, RTT, digest-only redaction, finite retirement) and asserts NOTHING about any real deployment',
    };
  } finally {
    await hop.stop();
  }
};

/* ------------------------------------------------------------------ CLI (explicit only) */
const main = async (argv: readonly string[]): Promise<number> => {
  if (argv.includes('--self-serve')) {
    const { record, note } = await runSelfServeProbe();
    process.stdout.write(`${JSON.stringify({ ...record, selfServe: note }, null, 2)}\n`);
    return 0;
  }
  const endpoint = process.env['UDG_STAGING_ENDPOINT'] ?? '';
  if (endpoint === '') {
    process.stderr.write('staging-probe: no endpoint. Set UDG_STAGING_ENDPOINT explicitly (owner-nominated private endpoint) or pass --self-serve for the localhost smoke. Nothing is guessed, nothing is defaulted.\n');
    return 2;
  }
  const samplesArg = Number(process.env['UDG_STAGING_SAMPLES'] ?? DEFAULT_SAMPLES);
  const record = await runStagingConnectProbe(endpoint, { samples: Number.isFinite(samplesArg) ? samplesArg : DEFAULT_SAMPLES });
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  return 0;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main(process.argv.slice(2));
}
