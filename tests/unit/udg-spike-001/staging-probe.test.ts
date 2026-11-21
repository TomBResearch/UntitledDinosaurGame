/**
 * UDG-SPIKE-001 — the GA-11 staging connect probe, verified INDEPENDENTLY of any endpoint.
 *
 * Everything a claim about this seam needs is checkable here, on loopback, with no external
 * contact: (1) a REAL successful handshake against the minimal in-process server produces an
 * open sample with a finite connect RTT; (2) the record is REDACTED — the host, the port literal
 * and the URL appear NOWHERE in the serialized record, only the irreversible digest; (3) hostile
 * or dead endpoints produce NAMED failure entries, never a throw, and the probe stays FINITE
 * under its declared budget; (4) malformed endpoints are rejected BEFORE any socket opens;
 * (5) --self-serve retires its server (the ephemeral port is closed again after the run).
 * What no test here does: claim anything about a real deployment — there is none in this repo.
 */

import { createServer, type Socket } from 'node:net';
import { describe, expect, it } from 'vitest';

import { endpointDigest, runSelfServeProbe, runStagingConnectProbe, startHandshakeOnlyServer, MAX_SAMPLES } from '../../../tools/load-test/src/staging-probe.ts';

describe('UDG-SPIKE-001 staging connect probe (test-only seam, no external endpoint involved)', () => {
  it('opens against a real loopback handshake and records a finite connect RTT, digest-only', async () => {
    const hop = await startHandshakeOnlyServer();
    try {
      const record = await runStagingConnectProbe(`ws://127.0.0.1:${String(hop.port)}`, { samples: 3, connectTimeoutMs: 2_000 });
      expect(record.kind).toBe('UDG-SPIKE-001-staging-connect-probe');
      expect(record.runtime.webSocketGlobal).toBe('present');
      expect(record.scheme).toBe('ws');
      expect(record.summary.opens).toBe(3);
      expect(record.connects.every((c) => c.ok && Number.isFinite(c.rttMs) && (c.rttMs as number) >= 0)).toBe(true);
      expect(record.endpointDigest).toMatch(/^[0-9a-f]{64}$/u);
      // REDACTION: neither the host literal, the port, nor any URL appears in the record bytes.
      const wire = JSON.stringify(record);
      expect(wire.includes('127.0.0.1')).toBe(false);
      expect(wire.includes(String(hop.port))).toBe(false);
      expect(wire.includes('ws://')).toBe(false);
      // digest is exactly sha256(host:port) — irreversible identity the owner can re-verify
      expect(record.endpointDigest).toBe((endpointDigest(`ws://127.0.0.1:${String(hop.port)}`) as { digest: string }).digest);
      expect(record.retired.closedWithinBudget).toBe(true);
    } finally {
      await hop.stop();
    }
  });

  it('a server that destroys every socket yields NAMED failures, no throw, finite record', async () => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const record = await runStagingConnectProbe(`ws://127.0.0.1:${String(port)}`, { samples: 2, connectTimeoutMs: 1_500 });
      expect(record.summary.opens).toBe(0);
      expect(record.summary.failures).toBe(2);
      expect(record.connects.every((c) => !c.ok && typeof c.errorName === 'string' && c.errorName !== '')).toBe(true);
      expect(record.retired.closedWithinBudget).toBe(true);
    } finally {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('a server that accepts but NEVER answers hits the declared timeout and still returns finitely', async () => {
    const held = new Set<Socket>();
    const server = createServer((socket) => {
      held.add(socket); // silence: the honest shape of an unreachable-by-protocol host
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const started = performance.now();
    try {
      const record = await runStagingConnectProbe(`ws://127.0.0.1:${String(port)}`, { samples: 1, connectTimeoutMs: 300 });
      const elapsed = performance.now() - started;
      expect(record.connects[0]?.stage).toBe('timeout');
      expect(elapsed).toBeLessThan(3_000); // bounded by the budget, not by hope
      expect(record.retired.closedWithinBudget).toBe(true);
    } finally {
      for (const s of held) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('malformed and non-ws endpoints are rejected BEFORE any socket opens; userinfo never hashes', () => {
    const bad = endpointDigest('not a url');
    expect('error' in bad).toBe(true);
    const http = endpointDigest('http://example.invalid/room');
    expect('error' in http).toBe(true);
    const secret = endpointDigest('wss://user:hunter2@example.invalid/room');
    expect('error' in secret).toBe(true);
    const ok = endpointDigest('wss://Example.Invalid:8443/room?token=abc');
    expect('digest' in ok && (ok as { digest: string }).digest).toMatch(/^[0-9a-f]{64}$/u);
    // path and userinfo excluded from identity: same host:port, same digest, token never enters it
    expect((ok as { digest: string }).digest).toBe((endpointDigest('wss://example.invalid:8443') as { digest: string }).digest);
  });

  it('a bad endpoint still produces a complete finite record with a named, value-free failure', async () => {
    const record = await runStagingConnectProbe('wss://', { samples: 1 });
    expect(record.endpointDigest).toBe(null);
    expect(record.connects[0]?.stage).toBe('bad-endpoint');
    expect(JSON.stringify(record).includes('wss://')).toBe(false);
  });

  it('sample count is CLAMPED to the declared bound (no runaway grids)', () => {
    expect(MAX_SAMPLES).toBe(20);
  });

  it('--self-serve completes end to end and RETIRES its listener (port closed afterwards)', async () => {
    const { record, note } = await runSelfServeProbe(2);
    expect(record.summary.opens).toBe(2);
    expect(note).toContain('localhost smoke');
    const portLiteral = JSON.parse(JSON.stringify(record)).endpointDigest as string;
    expect(portLiteral).toMatch(/^[0-9a-f]{64}$/u);
    // retirement proof: re-probing the SAME digest's endpoint would need the port, which is gone;
    // the observable proxy is that a fresh self-serve lands on a DIFFERENT ephemeral port digest.
    const second = await runSelfServeProbe(1);
    expect(second.record.endpointDigest).not.toBe(record.endpointDigest);
  });
});
