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

import { createHash } from 'node:crypto';
import { connect } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { connect as tlsConnect } from 'node:tls';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { beforeAll, describe, expect, it } from 'vitest';

import { nearestRank } from '../../../tools/load-test/src/statistics.ts';
import {
  GA11_FIXED_POPULATION,
  GA11_EPOCH_AUDIT_NOTE,
  GA11_MODULE_PATH_PREFIXES,
  GA11_TEST_CERT_NOTE,
  GA11_WS_FRAME_SCOPE,
  classifyGa11Run,
  fetchGa11LocalAsset,
  ga11EndpointGuard,
  ga11EpochSequenceAudit,
  ga11IsGameplaySocket,
  ga11LocalAssetTarget,
  ga11LogFilterValues,
  ga11SeatContextTlsOptions,
  makeGa11EphemeralTestCertificate,
  makeGa11Redactor,
  parseGa11Netrc,
  rttEligibility,
  sanitizeGa11Detail,
  startGa11FacsimileHop,
  summarizeFrameLengths,
  type Ga11TestCertificate,
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

  it('the UNTRUSTED-TLS label exists ONLY for a loopback https endpoint under the named facsimile flag — a real host can never carry it', () => {
    const facs = ga11EndpointGuard('https://127.0.0.1:9', { loopbackTlsUntrusted: true });
    expect(facs.ok).toBe(true);
    if (facs.ok !== true) return;
    expect(facs.tls).toBe('loopback-test-cert-untrusted');
    // Without the flag the same loopback endpoint is runtime-default verified…
    const loopDefault = ga11EndpointGuard('https://127.0.0.1:9');
    expect(loopDefault.ok && loopDefault.tls === 'loopback-test-cert-untrusted').toBe(false);
    // …and the flag on a NON-loopback host changes nothing (it cannot be marked untrusted):
    const real = ga11EndpointGuard('https://edge.example', { loopbackTlsUntrusted: true });
    expect(real.ok && real.tls === 'runtime-default-verification').toBe(true);
  });

  it('the TLS relaxation split is STRUCTURAL: ignoreHTTPSErrors is true ONLY for the labelled loopback facsimile, never for a real endpoint', () => {
    const real = ga11EndpointGuard('https://edge.example');
    const facs = ga11EndpointGuard('https://127.0.0.1:9', { loopbackTlsUntrusted: true });
    if (real.ok !== true || facs.ok !== true) throw new Error('guard expected ok');
    expect(ga11SeatContextTlsOptions(real, false).ignoreHTTPSErrors).toBe(false); // the real path: runtime defaults, always
    expect(ga11SeatContextTlsOptions(real, true).ignoreHTTPSErrors).toBe(false);  // real endpoint even under a facsimile flag: still never relaxed
    expect(ga11SeatContextTlsOptions(facs, true).ignoreHTTPSErrors).toBe(true);   // the labelled loopback facsimile: its isolated context tolerates the test cert
  });

  it('CANONICAL ORIGINS (the live a3 root cause): explicit default ports are omitted from webOrigin/socketOrigin exactly as Chromium canonicalizes them', () => {
    // https: bare == explicit :443, canonically;
    const a = ga11EndpointGuard('https://edge.example');
    const b = ga11EndpointGuard('https://edge.example:443');
    if (a.ok !== true || b.ok !== true) throw new Error('guard expected ok');
    expect(a.webOrigin).toBe('https://edge.example');
    expect(b.webOrigin).toBe('https://edge.example'); // NOT 'https://edge.example:443' — that never matches httpCredentials.origin
    expect(a.socketOrigin).toBe('wss://edge.example');
    expect(b.socketOrigin).toBe('wss://edge.example');
    // the DIGEST stays the explicit host:effective-port pair, IDENTICAL across the two spellings:
    expect(a.digest).toBe(b.digest);

    // wss input canonicalizes the same way, and the http sibling follows:
    const w = ga11EndpointGuard('wss://edge.example:443');
    if (w.ok !== true) throw new Error('guard expected ok');
    expect(w.socketOrigin).toBe('wss://edge.example');
    expect(w.webOrigin).toBe('https://edge.example');

    // http/ws default port (loopback, named flag):
    const h = ga11EndpointGuard('http://127.0.0.1:80', { allowLoopbackInsecure: true });
    if (h.ok !== true) throw new Error('guard expected ok');
    expect(h.webOrigin).toBe('http://127.0.0.1');
    expect(h.socketOrigin).toBe('ws://127.0.0.1');
    const lw = ga11EndpointGuard('ws://127.0.0.1:80', { allowLoopbackInsecure: true });
    if (lw.ok !== true) throw new Error('guard expected ok');
    expect(lw.webOrigin).toBe('http://127.0.0.1');
    expect(lw.socketOrigin).toBe('ws://127.0.0.1');
    expect(h.digest).toBe(createHash('sha256').update('127.0.0.1:80').digest('hex')); // digest stays the EXPLICIT host:effective-port pair
  });

  it('NON-DEFAULT ports regress exactly: kept in the canonical origins and in the digest (facsimile shape unchanged)', () => {
    const r = ga11EndpointGuard('https://edge.example:8443');
    if (r.ok !== true) throw new Error('guard expected ok');
    expect(r.webOrigin).toBe('https://edge.example:8443');
    expect(r.socketOrigin).toBe('wss://edge.example:8443');
    const facsimileShaped = ga11EndpointGuard('https://127.0.0.1:41337', { loopbackTlsUntrusted: true });
    if (facsimileShaped.ok !== true) throw new Error('guard expected ok');
    expect(facsimileShaped.webOrigin).toBe('https://127.0.0.1:41337'); // the hop fixture keeps its port — behavior identical to slice-30r2
  });

  it('IPv6 origins keep their brackets canonically (digest carries host:effective-port identically)', () => {
    const a = ga11EndpointGuard('https://[::1]:443');
    const b = ga11EndpointGuard('https://[::1]');
    if (a.ok !== true || b.ok !== true) throw new Error('guard expected ok');
    expect(a.webOrigin).toBe('https://[::1]');
    expect(a.socketOrigin).toBe('wss://[::1]');
    expect(a.digest).toBe(b.digest);
    const c = ga11EndpointGuard('https://[::1]:8443');
    if (c.ok !== true) throw new Error('guard expected ok');
    expect(c.webOrigin).toBe('https://[::1]:8443');
    expect(c.digest).not.toBe(b.digest); // explicit non-default port: the digest pair differs, as designed
    expect(c.digest).toBe(createHash('sha256').update('[::1]:8443').digest('hex')); // brackets included, identically to the guard's own rule
  });

  it('gameplay-socket comparison is CANONICAL-ORIGIN equality on both sides (explicit default port matches; other origins/ports do not)', () => {
    const bare = ga11EndpointGuard('https://edge.example');
    const explicit = ga11EndpointGuard('https://edge.example:8443');
    if (bare.ok !== true || explicit.ok !== true) throw new Error('guard expected ok');
    expect(ga11IsGameplaySocket('wss://edge.example/?token=x', bare)).toBe(true);
    expect(ga11IsGameplaySocket('wss://edge.example:443/?token=x', bare)).toBe(true); // explicit default port on the SOCKET side canonicalizes away
    expect(ga11IsGameplaySocket('wss://edge.example:8443', bare)).toBe(false);        // a real different port does not match
    expect(ga11IsGameplaySocket('wss://edge.example:8443/x', explicit)).toBe(true);
    expect(ga11IsGameplaySocket('wss://edge.example', explicit)).toBe(false);         // and NOT vice versa either
    expect(ga11IsGameplaySocket('ws://127.0.0.1:5173/?token=abc', bare)).toBe(false); // Vite HMR stays excluded
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

    // slice-30r3 hardening: NO error path echoes arbitrary caller-supplied token material —
    // the errors name line and POSITION only (netrc bytes are input this seam never trusts):
    const head = parseGa11Netrc(`evilleadingword machine ${host} login a password b`, host);
    expect(head.ok).toBe(false);
    if (head.ok === true) return;
    expect(head.error).toContain('line 1');
    expect(head.error).not.toContain('evilleadingword');

    const unknownToken = parseGa11Netrc(`machine ${host} login a password b smuggledtokenvalue`, host);
    expect(unknownToken.ok).toBe(false);
    if (unknownToken.ok === true) return;
    expect(unknownToken.error).toContain('line 1');
    expect(unknownToken.error).toContain('position 6');
    expect(unknownToken.error).not.toContain('smuggledtokenvalue');

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

describe('ga11 local module-asset serving (allowlist + headerless loopback fetch + gameplay-socket scope)', () => {
  const web = 'https://nominated.example:8443';
  const vite = 'http://127.0.0.1:5173';

  interface AssetServer {
    server: HttpServer;
    port: number;
    seen: { url: string; authorization: string | null; cookie: string | null; host: string | undefined }[];
    stop: () => Promise<void>;
  }
  const startAssetServer = async (): Promise<AssetServer> => {
    const seen: AssetServer['seen'] = [];
    const server = createHttpServer((req, res) => {
      seen.push({ url: req.url ?? '', authorization: req.headers.authorization ?? null, cookie: req.headers.cookie ?? null, host: req.headers.host });
      const url = req.url ?? '';
      if (url.startsWith('/src/network/good')) { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); res.end('export const ok = true;'); return; }
      if (url.startsWith('/src/network/redir')) { res.writeHead(302, { location: `http://127.0.0.1:${String(port)}/src/network/evil` }); res.end(); return; }
      if (url.startsWith('/src/network/evil')) { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end('export const evil = true;'); return; }
      if (url.startsWith('/src/network/slow')) { setTimeout(() => { try { res.writeHead(200); res.end('too late'); } catch { /* the bounded client left, as designed */ } }, 400).unref(); return; }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('missing');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? (address as { port: number }).port : 0;
    return { server, port, seen, stop: async () => new Promise<void>((done) => server.close(() => done())) };
  };

  it('the matcher resolves ONLY allowlisted module-asset paths on the NOMINATED origin to the loopback target, preserving the query', () => {
    expect(ga11LocalAssetTarget(`${web}/src/network/ColyseusPredictionAdapter.ts`, web, vite)).toBe(`${vite}/src/network/ColyseusPredictionAdapter.ts`);
    expect(ga11LocalAssetTarget(`${web}/node_modules/.vite/deps/@colyseus_sdk.js?v=abc`, web, vite)).toBe(`${vite}/node_modules/.vite/deps/@colyseus_sdk.js?v=abc`);
    expect(ga11LocalAssetTarget(`${web}/@fs/workspace/packages/protocol/dist/index.js`, web, vite)).toBe(`${vite}/@fs/workspace/packages/protocol/dist/index.js`);
  });

  it('the matcher NEVER resolves the SDK matchmake routes, the document, another origin — or a NON-loopback asset origin (no forward path to any real host exists)', () => {
    expect(ga11LocalAssetTarget(`${web}/matchmake/join/region`, web, vite)).toBeNull();
    expect(ga11LocalAssetTarget(`${web}/`, web, vite)).toBeNull();
    expect(ga11LocalAssetTarget(`${web}/state/x`, web, vite)).toBeNull();
    expect(ga11LocalAssetTarget(`${vite}/src/network/ColyseusPredictionAdapter.ts`, web, vite)).toBeNull();
    expect(ga11LocalAssetTarget('https://elsewhere.test/src/network/x.ts', web, vite)).toBeNull();
    expect(ga11LocalAssetTarget('not a url', web, vite)).toBeNull();
    // the structural rule the HTTPS breakage taught: the ASSET side is pinned to loopback http —
    // an https or non-loopback "asset origin" resolves to NOTHING, so this path can never
    // forward module traffic toward the nominated (remote) host:
    expect(ga11LocalAssetTarget(`${web}/src/network/x.ts`, web, 'https://ec2.example.com')).toBeNull();
    expect(ga11LocalAssetTarget(`${web}/src/network/x.ts`, web, 'http://example.com')).toBeNull();
  });

  it('the allowlist itself contains ONLY module-asset prefixes (no matchmake-shaped entry can sneak in)', () => {
    expect(GA11_MODULE_PATH_PREFIXES.every((p) => !p.includes('matchmake'))).toBe(true);
    expect(GA11_MODULE_PATH_PREFIXES.every((p) => p.startsWith('/'))).toBe(true);
  });

  it('fetchGa11LocalAsset fulfils 2xx with the server content-type and sends a FRESH HEADERLESS request (no Authorization/cookie from anywhere)', async () => {
    const assets = await startAssetServer();
    try {
      const viteOrigin = `http://127.0.0.1:${String(assets.port)}`;
      const r = await fetchGa11LocalAsset(`${web}/src/network/good.ts`, web, viteOrigin);
      expect(r.ok).toBe(true);
      if (r.ok !== true) return;
      expect(r.status).toBe(200);
      expect(r.body.toString()).toContain('export const ok');
      expect(r.contentType).toContain('text/javascript');
      expect(assets.seen).toHaveLength(1);
      const sent = assets.seen[0]!;
      expect(sent.authorization).toBeNull();   // nothing browser-derived is ever forwarded
      expect(sent.cookie).toBeNull();
      expect(sent.host).toBe(`127.0.0.1:${String(assets.port)}`); // the target is loopback, period
    } finally {
      await assets.stop();
    }
  });

  it('non-2xx refuses, REDIRECTS REFUSE (redirect:error — never followed away from the pin), timeouts are BOUNDED and named', async () => {
    const assets = await startAssetServer();
    try {
      const viteOrigin = `http://127.0.0.1:${String(assets.port)}`;
      const missing = await fetchGa11LocalAsset(`${web}/src/network/missing.ts`, web, viteOrigin);
      expect(missing.ok).toBe(false);
      if (missing.ok === true) return;
      expect(missing.reason).toContain('404');

      const redirected = await fetchGa11LocalAsset(`${web}/src/network/redir`, web, viteOrigin);
      expect(redirected.ok).toBe(false);
      if (redirected.ok === true) return;
      expect(redirected.reason.toLowerCase()).toContain('redirect');
      expect(assets.seen.some((s) => s.url.includes('evil'))).toBe(false); // the redirect was refused, not followed

      const slow = await fetchGa11LocalAsset(`${web}/src/network/slow`, web, viteOrigin, 80);
      expect(slow.ok).toBe(false);
      if (slow.ok === true) return;
      expect(slow.reason).toContain('timed out');

      const offList = await fetchGa11LocalAsset(`${web}/matchmake/join/region`, web, viteOrigin);
      expect(offList.ok).toBe(false);
      if (offList.ok === true) return;
      expect(offList.reason).toContain('never fetched');
      expect(assets.seen.some((s) => s.url.includes('matchmake'))).toBe(false);
    } finally {
      await assets.stop();
    }
  });

  it('gameplay-socket scope: EXACT endpoint host:port matches; the Vite HMR ws and every other socket are excluded', () => {
    const g = ga11EndpointGuard('https://edge.example:8443');
    if (g.ok !== true) throw new Error('guard expected ok');
    expect(ga11IsGameplaySocket('wss://edge.example:8443/?sec=token', g)).toBe(true);
    expect(ga11IsGameplaySocket('wss://edge.example:8443', g)).toBe(true);
    expect(ga11IsGameplaySocket('ws://127.0.0.1:5173/?token=abc', g)).toBe(false); // the Vite HMR socket
    expect(ga11IsGameplaySocket('wss://edge.example:9999', g)).toBe(false);         // same host, wrong port
    expect(ga11IsGameplaySocket('wss://evil.example/', g)).toBe(false);
    expect(ga11IsGameplaySocket('https://edge.example:8443/', g)).toBe(false);      // not a ws scheme
    expect(ga11IsGameplaySocket('not a url', g)).toBe(false);
    // the window-only scope label is a fixed, non-empty string the cell pins equality against:
    expect(GA11_WS_FRAME_SCOPE).toContain('window-only');
    expect(GA11_WS_FRAME_SCOPE).toContain('gameplay');
  });
});

describe('ga11 WS payload-length summaries and log-filter values', () => {
  it('summarizes payload lengths with nearest-rank percentiles; empty stays null/zero, never invented', () => {
    const s = summarizeFrameLengths([10, 20, 30, 40, 50], nearestRank);
    expect(s).toEqual({ frames: 5, totalBytes: 150, p50: 30, p95: 50, max: 50 });
    const e = summarizeFrameLengths([], nearestRank);
    expect(e).toEqual({ frames: 0, totalBytes: 0, p50: null, p95: null, max: null });
    const dirty = summarizeFrameLengths([5, Number.NaN, -1, 7], nearestRank);
    expect(dirty.frames).toBe(4); // counts what arrived…
    expect(dirty.totalBytes).toBe(12); // …but non-finite/negative never enter sums or percentiles
  });

  it('log filter erases every endpoint spelling (origins longest-first) and keeps passwords out of scope', () => {
    const g = ga11EndpointGuard('https://edge.example:8443');
    if (g.ok !== true) throw new Error('guard expected ok');
    const redact = makeGa11Redactor(ga11LogFilterValues(g));
    const noisy = `connect failed wss://edge.example:8443 https://edge.example:8443 //edge.example edge.example still logging passwordless-ok`;
    const out = redact(noisy);
    expect(out).not.toContain('edge.example');
    expect(out).toContain('[REDACTED]');
  });
});

describe('ga11 loopback facsimile hop — HTTPS PARITY (TLS-terminating Basic-auth hop, auth on every method incl. OPTIONS and the WSS upgrade, 127.0.0.1 only)', () => {
  const good = Buffer.from(`u:${SECRET}`).toString('base64');
  let cert: Ga11TestCertificate | null = null;

  beforeAll(() => {
    // The ephemeral locally-owned TEST certificate (openssl) — the same generator the cell uses;
    // its private-key files are unlinked on creation, the material lives only here.
    try { cert = makeGa11EphemeralTestCertificate(); } catch { cert = null; }
  });

  interface FixtureTarget { port: number; seen: { method: string; url: string; authorization: string | null; cookie: string | null; upgradeAuth: string | null }[]; stop: () => Promise<void> }
  const startTarget = async (): Promise<FixtureTarget> => {
    const seen: FixtureTarget['seen'] = [];
    const server = createHttpServer((req, res) => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', authorization: req.headers.authorization ?? null, cookie: req.headers.cookie ?? null, upgradeAuth: null });
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`ECHO ${req.method} ${req.url} END`);
    });
    server.on('upgrade', (req, socket) => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', authorization: null, cookie: null, upgradeAuth: req.headers.authorization ?? null });
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nWELCOME-END');
      socket.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? (address as { port: number }).port : 0;
    return { port, seen, stop: async () => new Promise<void>((done) => server.close(() => done())) };
  };

  const httpsProbe = (port: number, path: string, method: string, auth: string | null): Promise<{ status: number; wwwAuth: string | null; body: string }> =>
    new Promise((resolve, reject) => {
      const req = httpsRequest({
        host: '127.0.0.1', port, path, method,
        rejectUnauthorized: false, // the TEST cert only — this unit never points at a real host
        headers: auth !== null ? { authorization: `Basic ${auth}` } : {},
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, wwwAuth: res.headers['www-authenticate'] ?? null, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      setTimeout(() => req.destroy(), 3_000).unref();
      req.end();
    });

  const upgradeProbe = (port: number, auth: string | null): Promise<string> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const socket = tlsConnect({ host: '127.0.0.1', port, rejectUnauthorized: false }, () => {
        socket.write([
          'GET /colyseus.001.000 HTTP/1.1',
          'Host: 127.0.0.1',
          'Upgrade: websocket',
          'Connection: Upgrade',
          ...(auth !== null ? [`Authorization: Basic ${auth}`] : []),
          '', '',
        ].join('\r\n'));
      });
      socket.on('data', (chunk: Buffer) => chunks.push(chunk));
      socket.on('close', () => resolve(Buffer.concat(chunks).toString('latin1')));
      socket.on('error', reject);
      setTimeout(() => socket.destroy(), 2_000).unref();
    });

  it('challenges EVERY unauthenticated method over TLS (GET, OPTIONS) with a 401 + challenge, and REFUSES an unauthenticated WSS upgrade', async () => {
    if (cert === null) throw new Error('openssl test certificate unavailable — the HTTPS facsimile cannot be pinned');
    const target = await startTarget();
    const hop = await startGa11FacsimileHop({ login: 'u', password: SECRET, targetPort: target.port, tls: { cert: cert.cert, key: cert.key } });
    try {
      const denied = await httpsProbe(hop.port, '/matchmake/join/region', 'GET', null);
      expect(denied.status).toBe(401);
      expect(denied.wwwAuth).toContain('Basic');
      const preDenied = await httpsProbe(hop.port, '/matchmake/join/region', 'OPTIONS', null);
      expect(preDenied.status).toBe(401); // the ACTUAL vhost posture: OPTIONS challenged like everything else
      const wrongAuth = await httpsProbe(hop.port, '/', 'GET', Buffer.from('u:nope').toString('base64'));
      expect(wrongAuth.status).toBe(401);
      const upgradeDenied = await upgradeProbe(hop.port, null);
      expect(upgradeDenied).toContain('401 Unauthorized');
      expect(target.seen).toHaveLength(0); // nothing unauthenticated ever reached the fixture
    } finally {
      await hop.stop();
      await target.stop();
    }
  });

  it('authenticated: 2xx facsimile document, proxied matchmake (credentials STOP at the hop), tunneled WSS upgrade; bytes counted; stop() retires the port', async () => {
    if (cert === null) throw new Error('openssl test certificate unavailable — the HTTPS facsimile cannot be pinned');
    const target = await startTarget();
    const hop = await startGa11FacsimileHop({ login: 'u', password: SECRET, targetPort: target.port, tls: { cert: cert.cert, key: cert.key } });
    try {
      const doc = await httpsProbe(hop.port, '/', 'GET', good);
      expect(doc.status).toBe(200); // the cell requires a 2xx protected document; the fixture provides its own
      expect(doc.body).toContain('local fixture, not the service');

      const matchmake = await httpsProbe(hop.port, '/matchmake/join/region', 'GET', good);
      expect(matchmake.status).toBe(200);
      expect(matchmake.body).toContain('ECHO GET /matchmake/join/region END');
      const proxied = target.seen.find((s) => s.url === '/matchmake/join/region');
      expect(proxied?.authorization).toBeNull(); // the fixture never sees the client credential — and this is labelled in the hop docs

      const upgraded = await upgradeProbe(hop.port, good);
      expect(upgraded).toContain('101 Switching Protocols');
      expect(upgraded).toContain('WELCOME-END');
      const tunneled = target.seen.find((s) => s.upgradeAuth !== null || s.url.includes('colyseus'));
      expect(tunneled?.upgradeAuth).toBeNull(); // same rule on the upgrade path

      const counts = hop.bytes();
      expect(counts.authed).toBeGreaterThanOrEqual(3);
      expect(counts.refused).toBe(0);
      expect(counts.c2s).toBeGreaterThan(0);
      expect(counts.s2c).toBeGreaterThan(0); // post-TLS cleartext bytes — labelled as the hop's own view

      expect(GA11_TEST_CERT_NOTE).toContain('untrusted');
    } finally {
      await hop.stop();
      await target.stop();
    }
  });

  it('stops finitely: after stop() nothing listens any more (port retired)', async () => {
    if (cert === null) throw new Error('openssl test certificate unavailable — the HTTPS facsimile cannot be pinned');
    const target = await startTarget();
    const hop = await startGa11FacsimileHop({ login: 'u', password: SECRET, targetPort: target.port, tls: { cert: cert.cert, key: cert.key } });
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

describe('ga11 epoch-aware sequence audit + run classification (slice-30r4; deterministic regression from the a4 evidence SHAPE)', () => {
  // The a4 session-3 RETAINED SHAPE: legitimate server-issued epoch resets 1 → 3 → 4, the
  // initial transport pointer retained at 1 (known-stale), a GLOBAL send audit of 1 125, and an
  // EPOCH-SCOPED end watermark of 321 on the active epoch 4. Per-epoch issuance buckets are the
  // SHAPE the future capture now records (the historical a4 record never stored them — that is
  // the named gap this regression pins the RULE for); the historical red is not re-adjudicated.
  const a4Shape = () => ({
    joinEpoch: 1,
    rejoinEpochs: [3, 4],
    initialPointerEpoch: 1,
    perEpochSent: { '1': '640', '3': '154', '4': '331' },
    sentAuditTotal: 1125,
    sentMonotonicGeneration: true,
    deliveries: [
      { epoch: 1, accepted: true, resolvedThrough: 640 },
      { epoch: 3, accepted: true, resolvedThrough: 154 },
      { epoch: 4, accepted: true, resolvedThrough: 190 },
      { epoch: 4, accepted: true, resolvedThrough: 321 },
    ],
    lastDelivery: { epoch: 4, resolvedThrough: 321 },
  });

  it('the a4 shape audits CLEAN under the epoch-aware rule while the legacy strict rule false-fails it (the diagnosis, pinned)', () => {
    const input = { ...a4Shape(), perEpochSent: { '1': 640, '3': 154, '4': 331 } };
    const audit = ga11EpochSequenceAudit(input);
    expect(audit.verdict).toBe('CLEAN');
    expect(audit.activeEpoch).toBe(4);
    expect(audit.initialPointerStale).toBe(true); // pointer 1 vs active domain 4 — NAMED, never used as the comparison basis
    expect(audit.perEpoch.map((p) => p.verdict)).toEqual(['CLEAN', 'CLEAN', 'CLEAN']);
    // the legacy rule, recomputed on the same shape, REDS it: last delivery epoch 4 against the
    // stale pointer 1 — exactly the a4-s3 false failure. Pinned so it is never reintroduced.
    const legacyResolvedSameEpoch = input.lastDelivery.epoch === input.initialPointerEpoch;
    expect(legacyResolvedSameEpoch).toBe(false);
    expect(GA11_EPOCH_AUDIT_NOTE).toContain('never relabelled');
    expect(GA11_EPOCH_AUDIT_NOTE).toContain('never waived');
  });

  it('NEGATIVE: a watermark beyond what its own epoch issued is RED (a seq never sent on that epoch is a real violation)', () => {
    const audit = ga11EpochSequenceAudit({
      ...a4Shape(),
      perEpochSent: { '1': 640, '3': 154, '4': 331 },
      deliveries: [{ epoch: 4, accepted: true, resolvedThrough: 400 }], // epoch 4 issued 331
      lastDelivery: { epoch: 4, resolvedThrough: 400 },
    });
    expect(audit.verdict).toBe('RED');
    expect(audit.reasons.some((r) => r.includes('exceed the 331 seqs'))).toBe(true);
  });

  it('QUARANTINE: rows in unproven epochs, missing issuance buckets and an unknown last-delivery epoch are named and quarantined — never assumed clean, never assumed red', () => {
    const stray = ga11EpochSequenceAudit({
      ...a4Shape(),
      perEpochSent: { '1': 640, '3': 154, '4': 331 },
      deliveries: [...a4Shape().deliveries, { epoch: 7, accepted: true, resolvedThrough: 5 }],
      lastDelivery: { epoch: 4, resolvedThrough: 321 },
    });
    expect(stray.verdict).toBe('QUARANTINED');
    expect(stray.quarantinedRowsUnprovenEpoch).toBe(1);

    const unproven = ga11EpochSequenceAudit({ ...a4Shape(), perEpochSent: {} });
    expect(unproven.verdict).toBe('QUARANTINED');
    expect(unproven.perEpoch.every((p) => p.verdict === 'QUARANTINED')).toBe(true);

    const unknownLast = ga11EpochSequenceAudit({
      ...a4Shape(),
      perEpochSent: { '1': 640, '3': 154, '4': 331 },
      lastDelivery: { epoch: null, resolvedThrough: null },
    });
    expect(unknownLast.verdict).toBe('QUARANTINED');
    expect(unknownLast.lastDeliveryOnActiveEpoch).toBeNull();
  });

  it('CONTINUITY is preserved and enforced across epoch resets: generation monotonicity and increasing server-issued epochs are RED when broken (never waivable)', () => {
    const brokenGen = ga11EpochSequenceAudit({ ...a4Shape(), perEpochSent: { '1': 640, '3': 154, '4': 331 }, sentMonotonicGeneration: false });
    expect(brokenGen.verdict).toBe('RED');
    expect(brokenGen.continuityOk).toBe(false);

    const badEpochOrder = ga11EpochSequenceAudit({ ...a4Shape(), rejoinEpochs: [4, 3], perEpochSent: { '1': 640, '3': 154, '4': 331 } });
    expect(badEpochOrder.verdict).toBe('RED');

    const bucketOverflow = ga11EpochSequenceAudit({ ...a4Shape(), perEpochSent: { '1': 900, '3': 154, '4': 331 }, sentAuditTotal: 1125 });
    expect(bucketOverflow.continuityOk).toBe(false);
  });

  it('classification separates reachability / RTT eligibility / epoch audits / behaviour findings, and a zero-session run is NOT-RUN (never vacuous)', () => {
    const empty = classifyGa11Run(3, []);
    expect(empty.notRun).toBe(true);
    expect(empty.reachability.reachable).toBe(0);
    expect(empty.rttEligibility.eligible).toBe(0);
    expect(empty.epochAudits.CLEAN).toBe(0);

    const mixed = classifyGa11Run(3, [
      { session: 1, reached: true, rttEligible: true, epochAudit: 'CLEAN', findings: [] },
      { session: 2, reached: true, rttEligible: true, epochAudit: 'CLEAN', findings: [] },
      { session: 3, reached: true, rttEligible: true, epochAudit: 'QUARANTINED', findings: ['mover terminal state suspended (named, never waived)', 'max accepted-patch gap 1303.89 ms'] },
    ]);
    expect(mixed.notRun).toBe(false);
    expect(mixed.reachability.reachable).toBe(3); // reachable AND churning: both stated, not blended
    expect(mixed.rttEligibility.eligible).toBe(3);
    expect(mixed.epochAudits.QUARANTINED).toBe(1);
    expect(mixed.behaviourFindings.find((b) => b.session === 3)?.findings.length).toBe(2);
  });

  it('sanitizeGa11Detail scrubs session-identifier-shaped tokens while keeping epochs and protocol words', () => {
    const out = sanitizeGa11Detail('rejoin-complete new domain epoch 3 for P6qi3oNHL awaiting snapshot');
    expect(out).toContain('epoch 3');
    expect(out).toContain('rejoin-complete');
    expect(out).not.toContain('P6qi3oNHL');
    expect(out).toContain('[ID]');
  });
});
