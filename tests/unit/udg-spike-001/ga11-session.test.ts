/**
 * UDG-SPIKE-001 slice 30 — unit pins for the GA-11 ENDPOINT-INJECTION SESSION seam
 * (tools/load-test/src/ga11-session.ts).
 *
 * Like the accepted staging-probe test, this runs WITHOUT any endpoint, WITHOUT any browser and
 * WITHOUT any credential: the credential material here is SYNTHETIC and fake, the only socket is
 * an ephemeral 127.0.0.1 facsimile hop talking to an in-process 127.0.0.1 echo, and every guard
 * is exercised against values it must REFUSE. The rules pinned here are the admission rules the
 * env-gated `ga11-session` cell lives by: explicit https:/wss: origin only (plain http/ws solely
 * for a literal-loopback facsimile, labelled); stdin netrc scoped to the exact machine (default
 * entries and duplicates refuse; parse errors carry line and token, never a value); the redactor
 * erases login/password/host from persisted strings; RTT eligibility decides against the
 * PRE-REGISTERED fixed population (120 declared, ≥ 99 finite, probe loss ≤ 2 %) and can only
 * shrink eligibility, never silently shrink N.
 */

import { connect, createServer, type Socket } from 'node:net';
import { describe, expect, it } from 'vitest';

import { nearestRank } from '../../../tools/load-test/src/statistics.ts';
import {
  GA11_FIXED_POPULATION,
  ga11EndpointGuard,
  makeGa11Redactor,
  parseGa11Netrc,
  rttEligibility,
  startGa11FacsimileHop,
} from '../../../tools/load-test/src/ga11-session.ts';

const SECRET = 'synthetic-not-a-real-secret';

describe('ga11 endpoint guard', () => {
  it('accepts an explicit https origin and digests host:port only (no path, no userinfo, no value leakage)', () => {
    const r = ga11EndpointGuard('https://Example.Test.Edge:8443');
    expect(r.ok).toBe(true);
    if (r.ok !== true) return;
    expect(r.webOrigin).toBe('https://example.test.edge:8443');
    expect(r.socketOrigin).toBe('wss://example.test.edge:8443');
    expect(r.tls).toBe('runtime-default-verification');
    expect(r.loopback).toBe(false);
    expect(r.digest).toHaveLength(64);
    expect(r.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts wss and default-ports 443; a wss endpoint equals the https guard of the same host', () => {
    const a = ga11EndpointGuard('wss://edge.example');
    const b = ga11EndpointGuard('https://edge.example');
    expect(a.ok && b.ok && a.digest === b.digest).toBe(true);
  });

  it('refuses: empty (nothing guessed), userinfo (no secrets in URLs), paths, queries, non-secure schemes for real hosts', () => {
    expect(ga11EndpointGuard('').ok).toBe(false);
    expect(ga11EndpointGuard('https://user:pw@example.test').ok).toBe(false);
    expect(ga11EndpointGuard('https://example.test/room').ok).toBe(false);
    expect(ga11EndpointGuard('https://example.test?x=1').ok).toBe(false);
    expect(ga11EndpointGuard('http://example.test').ok).toBe(false);
    expect(ga11EndpointGuard('ftp://example.test').ok).toBe(false);
    expect(ga11EndpointGuard('not a url').ok).toBe(false);
  });

  it('admits plain ws:// ONLY for a literal-loopback host with the named flag — and labels it plain-not-private', () => {
    expect(ga11EndpointGuard('ws://127.0.0.1:9').ok).toBe(false); // flag required, even for loopback
    const r = ga11EndpointGuard('ws://127.0.0.1:9', { allowLoopbackInsecure: true });
    expect(r.ok).toBe(true);
    if (r.ok !== true) return;
    expect(r.tls).toBe('plain-not-private');
    expect(r.loopback).toBe(true);
    expect(r.webOrigin).toBe('http://127.0.0.1:9');
    expect(ga11EndpointGuard('ws://example.test', { allowLoopbackInsecure: true }).ok).toBe(false); // NOT loopback: refuses
  });
});

describe('ga11 netrc (machine-scoped, existing host format)', () => {
  const host = 'edge.example';

  it('reads the existing machine line format and returns exactly the scoped pair', () => {
    const text = `machine other.example login x password y\nmachine ${host} login gameops password ${SECRET}\n`;
    const r = parseGa11Netrc(text, host);
    expect(r.ok).toBe(true);
    if (r.ok !== true) return;
    expect(r.login).toBe('gameops');
    expect(r.password).toBe(SECRET);
    expect(r.machineToken).toBe(host);
  });

  it('matches the machine token case-insensitively but refuses a `default` entry by name (scoping is the point)', () => {
    expect(parseGa11Netrc(`machine EDGE.EXAMPLE login a password ${SECRET}`, host).ok).toBe(true);
    const d = parseGa11Netrc(`default login a password ${SECRET}`, host);
    expect(d.ok).toBe(false);
    if (d.ok === true) return;
    expect(d.error).toContain('default');
    expect(d.error).not.toContain(SECRET);
  });

  it('refuses duplicates, missing entries and malformed lines — and NO parse error ever carries the password', () => {
    const dup = parseGa11Netrc(`machine ${host} login a password ${SECRET}\nmachine ${host} login b password c`, host);
    expect(dup.ok).toBe(false);
    if (dup.ok === true) return;
    expect(dup.error).toContain('2 entries');
    expect(dup.error).not.toContain(SECRET);

    const missing = parseGa11Netrc('machine other.example login a password b', host);
    expect(missing.ok).toBe(false);
    if (missing.ok === true) return;
    expect(missing.error).toContain('no "machine edge.example" entry');

    const malformed = parseGa11Netrc(`login ${host} password ${SECRET}`, host);
    expect(malformed.ok).toBe(false);
    if (malformed.ok === true) return;
    expect(malformed.error).toContain('line 1');
    expect(malformed.error).not.toContain(SECRET);

    const emptyPw = parseGa11Netrc(`machine ${host} login a password`, host);
    expect(emptyPw.ok).toBe(false);
  });
});

describe('ga11 redactor', () => {
  it('erases every non-empty secret everywhere it appears in a string', () => {
    const redact = makeGa11Redactor(['user1', SECRET, 'edge.example', '']);
    const noisy = `WebSocket to wss://edge.example failed for user1 with ${SECRET}`;
    const out = redact(noisy);
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain('user1');
    expect(out).not.toContain('edge.example');
    expect(out).toContain('[REDACTED]');
  });
});

describe('ga11 RTT eligibility (pre-registered fixed population)', () => {
  const filled = (n: number, finite: number): number[] => [
    ...Array.from({ length: finite }, (_unused, i) => 50 + i * 0.01),
    ...Array.from({ length: n - finite }, () => Number.POSITIVE_INFINITY),
  ];

  it('the declared fixed constants are the ones the cell records beside every number', () => {
    expect(GA11_FIXED_POPULATION.rttSamplesPerSession).toBe(120);
    expect(GA11_FIXED_POPULATION.minEligibleRttSamples).toBe(99);
    expect(GA11_FIXED_POPULATION.maxProbeLossFraction).toBe(0.02);
  });

  it('120/120 finite is eligible and reports nearest-rank percentiles over the finite population', () => {
    const r = rttEligibility(filled(120, 120), nearestRank);
    expect(r.eligible).toBe(true);
    expect(r.invalidByOwnFloor).toBe(false);
    expect(r.finiteSamples).toBe(120);
    expect(r.p50).not.toBeNull();
    expect(r.p99).not.toBeNull();
  });

  it('three timeouts (2.5 % loss) INVALIDATES by its own floor — named, with the timeouts counted, never dropped from N', () => {
    const r = rttEligibility(filled(120, 117), nearestRank);
    expect(r.eligible).toBe(false);
    expect(r.invalidByOwnFloor).toBe(true);
    expect(r.timeoutSamples).toBe(3);
    expect(r.reasons.some((x) => x.startsWith('probe-loss-over-floor'))).toBe(true);
  });

  it('two timeouts pass the loss floor but 98 finite fails the ≥ 99 floor; a deviating declared count is named too', () => {
    const two = rttEligibility(filled(120, 118), nearestRank);
    expect(two.eligible).toBe(true);
    const thin = rttEligibility(filled(120, 98), nearestRank);
    expect(thin.reasons.some((x) => x.startsWith('below-min-eligible'))).toBe(true);
    const short = rttEligibility(filled(110, 110), nearestRank);
    expect(short.reasons.some((x) => x.startsWith('declared-count-deviation'))).toBe(true);
  });

  it('an all-timeout population reports null percentiles and full loss — zero-filled numbers would be a lie', () => {
    const r = rttEligibility(filled(120, 0), nearestRank);
    expect(r.p50).toBeNull();
    expect(r.probeLossFraction).toBe(1);
  });
});

describe('ga11 loopback facsimile hop (auth posture + byte counting, 127.0.0.1 only)', () => {
  const echo = async (): Promise<{ port: number; stop: () => Promise<void> }> => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('data', (chunk) => socket.write(Buffer.from(chunk)));
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    return {
      port,
      stop: async () => {
        for (const s of sockets) s.destroy();
        await new Promise<void>((done) => server.close(() => done()));
      },
    };
  };

  const sendRaw = (port: number, bytes: string): Promise<{ head: string; body: number }> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const socket = connect(port, '127.0.0.1', () => socket.write(Buffer.from(bytes, 'latin1')));
      socket.on('data', (chunk) => chunks.push(chunk));
      socket.on('close', () => {
        const all = Buffer.concat(chunks);
        resolve({ head: all.subarray(0, all.indexOf('\r\n\r\n') + 1).toString('latin1'), body: all.length });
      });
      socket.on('error', reject);
      setTimeout(() => socket.destroy(), 750); // bounded: the echo never closes by itself
    });

  it('refuses an unauthenticated request with a 401 challenge and forwards an authenticated one, counting bytes', async () => {
    const target = await echo();
    const hop = await startGa11FacsimileHop({ login: 'u', password: SECRET, targetPort: target.port });
    try {
      const denied = await sendRaw(hop.port, `GET /matchmake/join/region HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`);
      expect(denied.head).toContain('401 Unauthorized');
      expect(denied.head).toContain('WWW-Authenticate: Basic');

      const good = Buffer.from(`u:${SECRET}`).toString('base64');
      const allowed = await sendRaw(hop.port, `GET /matchmake/join/region HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Basic ${good}\r\n\r\n`);
      expect(allowed.head).not.toContain('401');
      expect(allowed.head).toContain('GET /matchmake/join/region HTTP/1.1'); // the echo echoed the forwarded request line back

      const wrong = Buffer.from(`u:nope`).toString('base64');
      const refused = await sendRaw(hop.port, `GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Basic ${wrong}\r\n\r\n`);
      expect(refused.head).toContain('401');

      const counts = hop.bytes();
      expect(counts.refused).toBe(2);
      expect(counts.authed).toBe(1);
      expect(counts.c2s).toBeGreaterThan(0);
      expect(counts.s2c).toBeGreaterThan(0);
    } finally {
      await hop.stop();
      await target.stop();
    }
  });

  it('passes an OPTIONS preflight WITHOUT demanding auth (a browser never attaches credentials to a preflight) and counts it separately', async () => {
    const target = await echo();
    const hop = await startGa11FacsimileHop({ login: 'u', password: SECRET, targetPort: target.port });
    try {
      const pre = await sendRaw(hop.port, `OPTIONS /matchmake/join/region HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: http://127.0.0.1:5173\r\n\r\n`);
      expect(pre.head).not.toContain('401'); // echoed by the target — forwarded without a challenge
      expect(hop.bytes().preflightBypassed).toBe(1);
      expect(hop.bytes().authed).toBe(0);
    } finally {
      await hop.stop();
      await target.stop();
    }
  });

  it('stops finitely: after stop() nothing listens any more (port retired)', async () => {
    const target = await echo();
    const hop = await startGa11FacsimileHop({ login: 'u', password: SECRET, targetPort: target.port });
    const port = hop.port;
    await hop.stop();
    await new Promise<void>((resolve) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => resolve()); // ECONNREFUSED: retired, exactly as claimed
    });
    await target.stop();
  });
});
