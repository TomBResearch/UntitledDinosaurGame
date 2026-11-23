/**
 * UDG-SPIKE-001 slice 30 — GA-11 ENDPOINT-INJECTION SESSION SEAM (test-only, pure + facsimile).
 *
 * This is the labelled endpoint-injection mode the GA-11 staging handoff §2 names as "the only
 * in-repo engineering gap" toward GA-11's representative-deployment measurement: the machinery to
 * run ONE bounded, two-seat, same-room business session against an EXPLICITLY NOMINATED origin
 * over that origin's own HTTPS/WSS path, behind the deployment's own Basic-auth ingress, with the
 * browser harness authenticating ONLY through context-scoped httpCredentials and a netrc read
 * from STDIN (never argv, never the environment, never a file this repo writes).
 *
 * What this file owns (all pure Node built-ins or an explicitly loopback-bound facsimile hop —
 * the package's ZERO-DEPENDENCY rule holds exactly as it does for staging-probe.ts):
 *   - the endpoint guard: https:/wss: explicit origin, no userinfo, no path; plain http:/ws:
 *     accepted ONLY for a literal-loopback facsimile with the named flag, exactly mirroring the
 *     staging-probe discipline (plain is labelled `plain-not-private`, never `private`);
 *   - the netrc parser: the existing host's `machine <host> login <l> password <p>` line format,
 *     scoped to the nominated host by EXACT match — no `default` entry is ever honoured, a second
 *     matching entry refuses, and no parse error can carry a password (parse errors name the line
 *     and the token, never the value);
 *   - the redactor: the credential strings and the endpoint host are removed from every string a
 *     run may persist or print — redaction, NOT access control (handoff §4 binds this seam);
 *   - the RTT eligibility rule for a first natural-path pass: ≥ 99 finite Room.ping samples of
 *     the declared fixed count (the 99-probe population shape of plan §15B-B), probe loss > 2 %
 *     or fewer than 99 finite samples makes the session INVALID-BY-ITS-OWN-FLOOR, named — never
 *     a quietly smaller N;
 *   - the fixed bounded first-path population constants (plan §15B-B session shape + the adopted
 *     warm-up; NO regime/profile is claimed — the natural path earns a regime only through the
 *     §15B(4) characterisation that is exactly what these sessions feed);
 *   - the loopback FACSIMILE hop: a TLS-TERMINATING Basic-auth reverse hop bound to 127.0.0.1
 *     (HTTPS parity with the actual vhost, on an ephemeral locally-owned untrusted test
 *     certificate), which lets the WHOLE authed-session path (2xx authenticated document + HTTP
 *     join + authenticated WSS upgrade + RTT seam + post-TLS byte counting) be validated against
 *     the local fixture room before anyone dials anything.
 *
 * What this file NEVER does: dials any endpoint itself (the browser cell composes the session;
 * this module only decides admission and honesty rules); records an endpoint value, a login or a
 * password (only sha256(lowercased host:port) travels — the same redaction, with the same
 * guessability caveat, as staging-probe); claims a regime, a provider, an ISP, a gate verdict, or
 * any relationship to the OFFICIAL 4×3 loopback-proxy matrix, which stays a separate evidence set
 * (handoff §6). Every record built with these helpers carries the nonformal labels verbatim.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect as netConnect, type Socket } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/* ------------------------------------------------------------------ fixed first-path population
 * PRE-REGISTERED constants (plan §15B-B session shape; the adopted 20 s warm-up from
 * run-spike.ts WARMUP_MS; the 99-probe RTT population shape; the §15B-B failure floors).
 * A run may not silently deviate: the record carries these values beside what was measured, and
 * `rttEligibility` decides eligibility against THEM, not against whatever arrived.
 */
export const GA11_FIXED_POPULATION = {
  /** Sequential two-seat sessions per dispatched run. Fixed, bounded, and small on purpose:
   * this is the first credible path, not the matrix. */
  sessions: 3,
  /** Warm-up before any sample counts — the adopted spike warm-up length. */
  warmupMs: 20_000,
  /** Measurement window per session (patch-interval / stall populations). */
  windowMs: 60_000,
  /** Fixed Room.ping sample count per session (mover seat, same gameplay socket). */
  rttSamplesPerSession: 120,
  /** Spacing between ping issues; 120 × 100 ms ≈ a 12 s window inside the session window. */
  rttCadenceMs: 100,
  /** One ping's reply budget; a timeout stays in the raw as a named non-finite sample. */
  rttProbeTimeoutMs: 4_000,
  /** The eligibility floor for a natural-path session population (§15B-B 99-probe shape). */
  minEligibleRttSamples: 99,
  /** §15B-B floor, carried unchanged: probe loss over 2 % invalidates the session population. */
  maxProbeLossFraction: 0.02,
} as const;

/** Hard clamps a caller may never exceed, whatever the dispatch asks for. */
export const GA11_CLAMPS = {
  maxRttSamples: 300,
  maxWindowMs: 120_000,
  maxRttProbeTimeoutMs: 10_000,
} as const;

/* ------------------------------------------------------------------ endpoint guard */

export interface Ga11EndpointOk {
  readonly ok: true;
  /** `https://host:port` (`http://` ONLY for the labelled loopback facsimile) — what httpCredentials.origin gets. */
  readonly webOrigin: string;
  /** `wss://host:port` — the same-origin socket URL the SDK joins (ws:// only for the facsimile). */
  readonly socketOrigin: string;
  readonly host: string;
  readonly port: number;
  /** sha256(lowercased host:port) — redaction only, never access control (handoff §4). */
  readonly digest: string;
  readonly loopback: boolean;
  readonly tls: 'runtime-default-verification' | 'plain-not-private' | 'loopback-test-cert-untrusted';
}

export interface Ga11EndpointFail {
  readonly ok: false;
  readonly error: string;
}

const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', '[::1]', '::1'];

/**
 * Guard the nominated endpoint EXACTLY as the staging probe guards its own: explicit value only,
 * nothing guessed, userinfo and paths refused before anything could use them. Private TLS is
 * the only accepted posture for a real endpoint; plain http:/ws: is admitted only for a
 * literal-loopback facsimile with the named flag, and then labelled `plain-not-private`.
 */
export const ga11EndpointGuard = (
  raw: string,
  options: { allowLoopbackInsecure?: boolean; loopbackTlsUntrusted?: boolean } = {},
): Ga11EndpointOk | Ga11EndpointFail => {
  if (raw === '') return { ok: false, error: 'no endpoint supplied — the nominated origin is explicit env only, nothing is guessed or defaulted' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'endpoint is not a parseable URL' };
  }
  const scheme = url.protocol;
  if (scheme !== 'https:' && scheme !== 'wss:' && scheme !== 'http:' && scheme !== 'ws:') {
    return { ok: false, error: `endpoint scheme ${scheme} is not https:/wss: (or http:/ws: for the named loopback facsimile)` };
  }
  if (url.username !== '' || url.password !== '') return { ok: false, error: 'endpoint must carry no userinfo — credentials never ride URLs' };
  if (url.pathname !== '' && url.pathname !== '/') return { ok: false, error: 'endpoint must be an origin (no path) — a path could carry a room token' };
  if (url.search !== '' || url.hash !== '') return { ok: false, error: 'endpoint must be an origin (no query, no fragment)' };
  const host = url.hostname.toLowerCase();
  const loopback = LOOPBACK_HOSTS.includes(host);
  const secure = scheme === 'https:' || scheme === 'wss:';
  if (!secure && !(options.allowLoopbackInsecure === true && loopback)) {
    return { ok: false, error: 'a real nominated endpoint must be https:/wss: (TLS verified by the runtime defaults); plain http:/ws: is admitted ONLY for the literal-loopback facsimile with the named flag' };
  }
  const port = url.port !== '' ? Number(url.port) : secure ? 443 : 80;
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return { ok: false, error: 'endpoint port is out of range' };
  // A locally-owned facsimile may present an UNTRUSTED ephemeral test certificate. The label is
  // explicit, and ONLY the loopback facsimile can ever carry it — a real nominated endpoint is
  // always `runtime-default-verification` and no harness context is ever allowed to relax TLS
  // verification for it (ga11SeatContextTlsOptions pins that split).
  const untrustedTestTls = secure && loopback && options.loopbackTlsUntrusted === true;
  // CANONICAL ORIGINS (slice-30r3, root cause PROVEN live against the actual service by two
  // controlled document requests with identical credentials in verified Chromium): Chromium
  // matches httpCredentials.origin against the CANONICAL origin, so an explicit default port
  // (`https://host:443`) never matches the request origin (`https://host`) — the credential
  // silently never applies and the service correctly answers 401. webOrigin/socketOrigin are
  // therefore WHATWG-URL.origin-canonical (default ports omitted, IPv6 brackets preserved);
  // the DIGEST stays the explicit host:effective-port string, exactly as before.
  const httpLike = new URL(url);
  httpLike.protocol = secure ? 'https:' : 'http:';
  const wsLike = new URL(url);
  wsLike.protocol = secure ? 'wss:' : 'ws:';
  const hostPort = `${host}:${String(port)}`;
  return {
    ok: true,
    webOrigin: httpLike.origin,
    socketOrigin: wsLike.origin,
    host,
    port,
    digest: createHash('sha256').update(hostPort).digest('hex'),
    loopback,
    tls: !secure ? 'plain-not-private' : untrustedTestTls ? 'loopback-test-cert-untrusted' : 'runtime-default-verification',
  };
};

/* ------------------------------------------------------------------ netrc (stdin only) */

export interface Ga11Credentials {
  readonly ok: true;
  readonly login: string;
  readonly password: string;
  /** The netrc `machine` token that matched (a host value — redaction rules treat it as the endpoint host does). */
  readonly machineToken: string;
}

export interface Ga11NetrcFail {
  readonly ok: false;
  /** Names the line and the token at fault. Never contains a login or a password value. */
  readonly error: string;
}

/**
 * Parse the EXISTING host's netrc shape — one `machine <host> login <login> password <password>`
 * line per entry — from text the caller has already read (the CLI path reads fd 0; nothing here
 * opens a file, and no password ever crosses argv or the environment). Scoping rules, pinned by
 * unit test: the `machine` value must match the nominated host EXACTLY (case-insensitive); a
 * `default` entry is REFUSED by name (a scoped credential is the whole point); two entries for
 * the same host refuse; a missing entry names the machine token count, not the host.
 */
export const parseGa11Netrc = (text: string, host: string): Ga11Credentials | Ga11NetrcFail => {
  const want = host.toLowerCase();
  const lines = text.split(/\r?\n/);
  const matches: { line: number; machine: string; login: string | undefined; password: string | undefined }[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? '').trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('default')) return { ok: false, error: `netrc line ${String(index + 1)} uses a \`default\` entry — refused: a GA-11 session credential is scoped to the nominated machine, never to a default` };
    const tokens = line.split(/\s+/);
    if ((tokens[0] ?? '') !== 'machine') {
      // NO caller-supplied material is echoed — not the leading token, not a value: only the
      // line number and the shape that IS understood (slice-30r3 hardening).
      return { ok: false, error: `netrc line ${String(index + 1)} does not start with the machine keyword — only "machine <host> login <l> password <p>" entries are understood (the existing host format); the offending token is NOT echoed` };
    }
    const machine = tokens[1] ?? '';
    let login: string | undefined;
    let password: string | undefined;
    for (let t = 2; t < tokens.length; t += 2) {
      const key = tokens[t] ?? '';
      const value = tokens[t + 1] ?? '';
      if (key === 'login') login = value;
      else if (key === 'password') password = value;
      else return { ok: false, error: `netrc line ${String(index + 1)} carries an unknown token at position ${String(t)} (only login/password follow the machine entry); the token and its value are NOT echoed` };
    }
    if (machine.toLowerCase() === want) matches.push({ line: index + 1, machine, login, password });
  }
  if (matches.length === 0) return { ok: false, error: `netrc carries no "machine ${host}" entry (${String(lines.filter((l) => l.trim() !== '' && !l.startsWith('#')).length)} non-comment line(s) read; nothing matched the nominated host)` };
  if (matches.length > 1) return { ok: false, error: `netrc carries ${String(matches.length)} entries for the nominated host (lines ${matches.map((m) => String(m.line)).join(', ')}) — exactly one is required` };
  const entry = matches[0] as { line: number; machine: string; login: string | undefined; password: string | undefined };
  if (entry.login === undefined || entry.login === '') return { ok: false, error: `netrc line ${String(entry.line)} has no login token (or an empty one)` };
  if (entry.password === undefined || entry.password === '') return { ok: false, error: `netrc line ${String(entry.line)} has no password token (or an empty one)` };
  return { ok: true, login: entry.login, password: entry.password, machineToken: entry.machine };
};

/* ------------------------------------------------------------------ redaction */

/**
 * The redactor every persisted or printed string passes through. It removes the login, the
 * password and the endpoint host — a best-effort scrub of strings the seam itself produces; it
 * cannot reach shell history or anything outside this process (handoff §5 says exactly that about
 * deletion, and the same limit binds here).
 */
export const makeGa11Redactor = (secrets: readonly string[]): ((text: string) => string) => {
  const values = secrets.filter((s) => typeof s === 'string' && s !== '');
  return (text: string): string => {
    let out = text;
    for (const secret of values) out = out.split(secret).join('[REDACTED]');
    return out;
  };
};

/* ------------------------------------------------------------------ atomic evidence persistence
 * Slice-30r6 (the EE-attempt teardown lesson): the EE run lost its ENTIRE session record because
 * an unhandled async failure killed the worker before the single end-of-cell write, and the run
 * left only a run.log behind. Evidence therefore lands ATOMICALLY at every durable phase
 * (admission, window open, each completed session, final record): bytes go to a sibling temp
 * file, are fsynced, then renamed over the target, so a reader (or a dying worker) never sees a
 * half-written record and every retained file is parseable and checksum-able. The optional
 * redactor runs over the SERIALIZED text BEFORE anything touches disk; if redaction would
 * corrupt the JSON the file is NOT written — an unscrubbed record never reaches the bundle.
 * A PARTIAL progress document is labelled as such by its writer and is never a valid record.
 */

export interface Ga11EvidenceWriteReceipt {
  readonly ok: boolean;
  readonly path: string;
  readonly bytes: number;
  readonly error: string | null;
}

export const writeGa11EvidenceAtomic = (
  outDir: string,
  fileName: string,
  document: unknown,
  redact?: (text: string) => string,
): Ga11EvidenceWriteReceipt => {
  const target = join(outDir, fileName);
  const tmp = `${target}.tmp-${String(process.pid)}-${String(Date.now())}`;
  try {
    const raw = JSON.stringify(document, null, 2);
    if (typeof raw !== 'string') return { ok: false, path: target, bytes: 0, error: 'unserializable-document' };
    const serialized = redact === undefined ? raw : redact(raw);
    if (redact !== undefined) {
      // Redaction must not silently mangle the document: an exact-value replacement inside a
      // JSON string value is structure-preserving; anything else REFUSES the write rather than
      // persisting an unscrubbed or corrupt file.
      try { JSON.parse(serialized); }
      catch { return { ok: false, path: target, bytes: 0, error: 'redaction-invalidated-json — refused, nothing written' }; }
    }
    mkdirSync(outDir, { recursive: true });
    const fd = openSync(tmp, 'w', 0o600);
    try {
      writeSync(fd, `${serialized}\n`, 0, 'utf8');
      fsyncSync(fd);
    }
    finally { closeSync(fd); }
    renameSync(tmp, target);
    return { ok: true, path: target, bytes: Buffer.byteLength(serialized) + 1, error: null };
  }
  catch (error) {
    try { unlinkSync(tmp); } catch { /* the temp file may never have existed */ }
    return { ok: false, path: target, bytes: 0, error: String(error instanceof Error ? `${error.name}: ${error.message}` : error).slice(0, 240) };
  }
};

/* ------------------------------------------------------------------ RTT eligibility (natural path) */

export interface Ga11RttEligibility {
  readonly declaredSamples: number;
  readonly finiteSamples: number;
  readonly timeoutSamples: number;
  readonly probeLossFraction: number;
  readonly eligible: boolean;
  readonly invalidByOwnFloor: boolean;
  readonly reasons: readonly string[];
  /** Nearest-rank percentiles over the FINITE samples only (timeouts stay counted, never imputed). */
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  /** False when the collection itself was INTERRUPTED (target closed, budget expired): a partial
   * collection can never be a valid fixed population, whatever count it did reach (slice-30r6). */
  readonly collectionComplete: boolean;
  /** Named cause of an interrupted collection, preserved verbatim (truncated); null when complete. */
  readonly collectionCause: string | null;
}

/**
 * Eligibility for one natural-path session population. The declared fixed count is the promise;
 * a timeout is a named non-finite sample that REDUCES eligibility, never a row that disappears.
 * Floors come from GA11_FIXED_POPULATION and plan §15B-B (probe loss ≤ 2 %); the outcome is
 * labelled, never narrated around. `percentiles` from statistics.ts rejects non-finite input, so
 * the finite-only split here is the ONLY place a sample is set aside — and it is fully counted.
 * `collection` (slice-30r6): an INTERRUPTED collection is never valid even if the arrived samples
 * would otherwise satisfy the floors; the named cause travels with the verdict, and the arrived
 * count stays in the raw exactly as measured (partial data is labelled, never relabelled valid).
 */
export const rttEligibility = (
  rawSamples: readonly number[],
  nearestRankFn: (samples: readonly number[], p: number) => number,
  collection?: { readonly complete: boolean; readonly cause?: string | null },
): Ga11RttEligibility => {
  const declared = rawSamples.length;
  const finite = rawSamples.filter((v) => Number.isFinite(v));
  const timeouts = declared - finite.length;
  const loss = declared === 0 ? 1 : timeouts / declared;
  const reasons: string[] = [];
  const collectionComplete = collection === undefined || collection.complete === true;
  const collectionCause = collectionComplete ? null : String(collection?.cause ?? 'interrupted — cause not reported').slice(0, 300);
  if (declared !== GA11_FIXED_POPULATION.rttSamplesPerSession) reasons.push(`declared-count-deviation:${String(declared)}!=${String(GA11_FIXED_POPULATION.rttSamplesPerSession)}`);
  if (finite.length < GA11_FIXED_POPULATION.minEligibleRttSamples) reasons.push(`below-min-eligible:${String(finite.length)}<${String(GA11_FIXED_POPULATION.minEligibleRttSamples)}`);
  if (loss > GA11_FIXED_POPULATION.maxProbeLossFraction) reasons.push(`probe-loss-over-floor:${(loss * 100).toFixed(2)}%>${String(GA11_FIXED_POPULATION.maxProbeLossFraction * 100)}%`);
  if (!collectionComplete) reasons.push(`partial-collection-interrupted (${collectionCause ?? 'no cause reported'}) — a PARTIAL population is never a valid fixed population`);
  const eligible = reasons.length === 0;
  return {
    declaredSamples: declared,
    finiteSamples: finite.length,
    timeoutSamples: timeouts,
    probeLossFraction: loss,
    eligible,
    invalidByOwnFloor: !eligible,
    reasons,
    p50: finite.length > 0 ? nearestRankFn(finite, 0.5) : null,
    p95: finite.length > 0 ? nearestRankFn(finite, 0.95) : null,
    p99: finite.length > 0 ? nearestRankFn(finite, 0.99) : null,
    collectionComplete,
    collectionCause,
  };
};

/* ------------------------------------------------------------------ same-origin module assets
 * The seat documents are served by the NOMINATED origin itself (the navigation authenticates —
 * see the cell). The only cross-served things are the harness's own compiled client/netcode
 * modules and the pinned-SDK chunks the shipped Vite pipeline produces for them; the browser
 * asks for them at the page's own origin, so exactly those KNOWN local module-asset path shapes
 * are SERVED FROM THE LOCAL LOOPBACK VITE PIPELINE by the Node side of the harness: the route
 * handler runs a FRESH Node fetch against the loopback asset server and fulfils the browser from
 * the buffer. (The slice-30 `route.fallback({url})` rewrite is REMOVED: Playwright requires a
 * fallback URL to carry the SAME protocol as the intercepted request, so rewriting an
 * https://page-origin asset to the http://127.0.0.1 asset server throws on the real HTTPS path —
 * the HTTP-only facsimile could never see that. Serving via fetch+fulfil is protocol-independent
 * and strictly narrower: no request headers, cookies or Authorization ever leave the browser —
 * the asset fetch is a brand-new, headerless request to a loopback URL.)
 * The allowlist is a PREFIX LIST OF MODULE ASSETS ONLY: the SDK's matchmake routes
 * ('/matchmake/…' and anything else the pinned client really calls) and the WebSocket (never
 * interceptable by page.route in the first place) are NOT on the list and always travel the real
 * network. The fetch target is pinned to a LITERAL LOOPBACK http origin, so no asset request can
 * ever be forwarded toward the nominated (EC2) host by this path.
 */
export const GA11_MODULE_PATH_PREFIXES = [
  '/src/network/',       // the two entry modules the harness imports
  '/node_modules/',      // Vite's pre-bundled dependency chunks (incl. the pinned SDK)
  '/@fs/',               // Vite's file-system-served module URLs (workspace links)
  '/@id/',               // Vite's resolved-id module URLs
  '/@vite/',             // Vite client/env module URLs
] as const;

/** Bound every local asset fetch; a stuck Vite dev server ends the route call, never the run. */
export const GA11_ASSET_TIMEOUT_MS = 8_000;

/** Resolve ONLY a same-origin-as-nominated module-asset URL to the local loopback Vite fetch
 * target; anything else (matchmake, unknown paths, other origins) returns null and is NEVER
 * fetched or intercepted. A NON-loopback or non-http viteOrigin also returns null — this path
 * structurally cannot forward anything to a real host. */
export const ga11LocalAssetTarget = (rawUrl: string, webOrigin: string, viteOrigin: string): string | null => {
  let url: URL;
  let base: URL;
  let vite: URL;
  try {
    url = new URL(rawUrl);
    base = new URL(webOrigin);
    vite = new URL(viteOrigin);
  } catch {
    return null;
  }
  if (vite.protocol !== 'http:' || !LOOPBACK_HOSTS.includes(vite.hostname.toLowerCase())) return null;
  if (url.origin !== base.origin) return null;
  if (!GA11_MODULE_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return null;
  return `${viteOrigin}${url.pathname}${url.search}`;
};

export interface Ga11AssetFetched {
  readonly ok: true;
  readonly status: number;
  readonly body: Buffer;
  readonly contentType: string;
}

export interface Ga11AssetFailed {
  readonly ok: false;
  /** Named reason; never contains a credential (none was sent) and never a remote host value. */
  readonly reason: string;
}

const mimeForPath = (pathname: string): string => {
  if (/\.(js|mjs|ts|mts)$/.test(pathname)) return 'text/javascript; charset=utf-8';
  if (pathname.endsWith('.json')) return 'application/json';
  if (pathname.endsWith('.css')) return 'text/css';
  if (/\.(wasm|glb|png|jpg|jpeg|webp|bin)$/.test(pathname)) return 'application/octet-stream';
  return 'text/plain; charset=utf-8';
};

/**
 * Fetch ONE allowlisted local module asset for route fulfilment. A FRESH request with NO copied
 * headers (no cookies, no Authorization, nothing from the browser's request — `headers: {}`),
 * `redirect: 'error'` (a redirect away from the pinned loopback target is refused, not followed),
 * and a hard `AbortSignal.timeout` so a wedged dev server ends BOUNDED. 2xx only; a non-2xx or a
 * failure is a named refusal with no body carried.
 */
export const fetchGa11LocalAsset = async (
  rawUrl: string,
  webOrigin: string,
  viteOrigin: string,
  timeoutMs: number = GA11_ASSET_TIMEOUT_MS,
): Promise<Ga11AssetFetched | Ga11AssetFailed> => {
  const target = ga11LocalAssetTarget(rawUrl, webOrigin, viteOrigin);
  if (target === null) return { ok: false, reason: 'not an allowlisted local module-asset URL — never fetched (matchmake/document/other origins are never proxied by this path)' };
  try {
    const res = await fetch(target, { method: 'GET', redirect: 'error', headers: {}, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      try { await res.body?.cancel(); } catch { /* the refusal stands */ }
      return { ok: false, reason: `the local asset server answered ${String(res.status)} (only 2xx is fulfilled)` };
    }
    const body = Buffer.from(await res.arrayBuffer());
    const headerType = res.headers.get('content-type');
    const contentType = headerType !== null && headerType !== '' ? headerType : mimeForPath(new URL(target).pathname);
    return { ok: true, status: res.status, body, contentType };
  } catch (error) {
    const name = error instanceof Error ? error.name : 'fetch-failed';
    return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError'
      ? `the local asset fetch timed out in ${String(timeoutMs)} ms (bounded — no hang survives a wedged dev server)`
      : `the local asset fetch failed (${name}; redirects are refused by design)` };
  }
};

/* ------------------------------------------------------------------ TLS verification split
 * The ONLY place TLS relaxation may ever exist: the loopback facsimile's OWN context, against
 * the locally-owned untrusted test certificate, and ONLY when the guard itself labelled the
 * endpoint `loopback-test-cert-untrusted`. A real nominated endpoint always navigates under
 * runtime-default verification — the option is literally never passed for it.
 */
export const ga11SeatContextTlsOptions = (
  endpoint: Ga11EndpointOk,
  facsimile: boolean,
): { ignoreHTTPSErrors: boolean } => ({
  ignoreHTTPSErrors: facsimile === true && endpoint.loopback === true && endpoint.tls === 'loopback-test-cert-untrusted',
});

/* ------------------------------------------------------------------ WS payload-byte semantics */

/** The semantics label that MUST travel with every frame-length number (and with their absence). */
export const GA11_WS_FRAME_SEMANTICS =
  'client-visible WebSocket DATA frames via the Playwright page API (framesent/framereceived payload byte lengths only; TLS records, WS headers/framing and control frames are invisible to the page, and heartbeat-vs-patch classification is NOT identifiable at this seam, so NO patch-byte or heartbeat claim is made; lengths are payload-only)';

/** The SCOPE label that MUST travel with every frame count (slice-30r2 review): only the exact
 * gameplay socket counts, and only while the measurement window is open. A page lives before and
 * after the window, so the population is deliberately INCOMPLETE and labelled so. */
export const GA11_WS_FRAME_SCOPE =
  'window-only and gameplay-socket-only: frames are counted ONLY while the measurement window is open, and ONLY on sockets whose origin EXACTLY matches the nominated gameplay endpoint host:port (the Vite HMR ws and any other socket are excluded at discovery and counted as ignored); pages live before and after the window, so this population is deliberately incomplete — labelled, never silently partial';

/** EXACT gameplay-socket match against the CANONICAL socket origin (slice-30r3:
 * `url.origin === endpoint.socketOrigin` — both sides WHATWG-canonical, so an explicit default
 * port on either side (`wss://host:443`) matches the canonical form; the Vite HMR ws and any
 * other socket do not). Used to EXCLUDE every other socket a page may hold. */
export const ga11IsGameplaySocket = (rawUrl: string, endpoint: Ga11EndpointOk): boolean => {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'wss:' && u.protocol !== 'ws:') return false;
    return u.origin === endpoint.socketOrigin;
  } catch {
    return false;
  }
};

export interface Ga11FrameSummary {
  readonly frames: number;
  readonly totalBytes: number;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly max: number | null;
}

/** Distribution over collected payload lengths. Raw arrays live in memory only; the RECORD
 * carries these summaries (plus counts), never the arrays, never a URL. */
export const summarizeFrameLengths = (
  lengths: readonly number[],
  nearestRankFn: (samples: readonly number[], p: number) => number,
): Ga11FrameSummary => {
  const finite = lengths.filter((v) => Number.isFinite(v) && v >= 0);
  return {
    frames: lengths.length,
    totalBytes: finite.reduce((sum, v) => sum + v, 0),
    p50: finite.length > 0 ? nearestRankFn(finite, 0.5) : null,
    p95: finite.length > 0 ? nearestRankFn(finite, 0.95) : null,
    max: finite.length > 0 ? nearestRankFn(finite, 1) : null,
  };
};

/* ------------------------------------------------------------------ epoch-aware sequence audit
 * (slice-30r4; the a4 diagnosis expressed as a RULE, not a narration of one run.)
 * The resolved-prefix watermark is EPOCH-SCOPED: the shipped adapter's protocol restarts `seq`
 * with a new handle on a legitimate epoch reset while GENERATION continues. Two facts about the
 * client the harness reads:
 *   - `predictor.sentAudit()` is GLOBAL (one seq-audit across every epoch of the seat's life);
 *   - `transport.issuedEpoch()` is the INITIAL join's latched pointer — it does NOT advance when
 *     the adapter's own domain legitimately re-joins at a higher server-issued epoch.
 * The first full real-path run (a4, session 3) proved what the old rule got wrong: it compared
 * an epoch-scoped watermark (321) against the GLOBAL audit total (1 125) and the last delivery's
 * epoch against the STALE initial pointer (1) while the active domain had legitimately advanced
 * (server-issued epochs 1 → 3 → 4). A correct evaluation:
 *   - derives the PROVEN ISSUANCE EPOCHS from the join plus the server-issued rejoin epochs
 *     (never from the initial pointer — the pointer is known-stale after a reset);
 *   - evaluates each watermark WITHIN its own epoch against that epoch's proven issuance (the
 *     send audit grouped by its own epoch field — issuance not assumed, proven or quarantined);
 *   - PRESERVES cross-epoch continuity: generation monotonicity, strictly increasing
 *     server-issued epochs, per-epoch issuance buckets summing to no more than the global audit;
 *   - QUARANTINES what it cannot attribute (rows in unproven epochs, missing issuance buckets,
 *     unknown last-delivery epoch) — named, never assumed clean, never assumed red;
 *   - REDS only real violations (a resolved seq its epoch never issued, a continuity break);
 *   - NEVER relabels a historical red and NEVER waives a suspension — both stay named findings
 *     in the run classification; only FUTURE captures evaluate under this rule.
 */
export const GA11_EPOCH_AUDIT_NOTE =
  'epoch-scoped evaluation: resolved watermarks are checked against the proven issuance of THEIR OWN epoch (seq restarts per handle; generation carries cross-epoch continuity); the initial transport pointer is known-stale after a legitimate rejoin and is never the active domain; historical reds are never relabelled and suspensions are never waived';

export interface Ga11EpochAuditInput {
  readonly joinEpoch: number | null;
  readonly rejoinEpochs: readonly number[];
  readonly initialPointerEpoch: number | null;
  readonly perEpochSent: Readonly<Record<string, number>>;
  readonly sentAuditTotal: number;
  readonly sentMonotonicGeneration: boolean;
  readonly deliveries: readonly { readonly epoch: number; readonly accepted: boolean; readonly resolvedThrough: number | null }[];
  readonly lastDelivery: { readonly epoch: number | null; readonly resolvedThrough: number | null };
}

export interface Ga11EpochAuditEpochRow {
  readonly epoch: number;
  readonly issued: number | null;
  readonly deliveries: number;
  readonly accepted: number;
  readonly maxResolved: number | null;
  readonly verdict: 'CLEAN' | 'QUARANTINED' | 'RED' | 'NO-TRAFFIC';
  readonly reasons: readonly string[];
}

export interface Ga11EpochAudit {
  readonly provenIssuanceEpochs: readonly number[];
  readonly activeEpoch: number | null;
  readonly initialPointerStale: boolean;
  readonly perEpoch: readonly Ga11EpochAuditEpochRow[];
  readonly continuityOk: boolean;
  readonly continuityReasons: readonly string[];
  readonly quarantinedRowsUnprovenEpoch: number;
  readonly lastDeliveryOnActiveEpoch: boolean | null;
  readonly verdict: 'CLEAN' | 'QUARANTINED' | 'RED';
  readonly reasons: readonly string[];
  readonly note: string;
}

export const ga11EpochSequenceAudit = (input: Ga11EpochAuditInput): Ga11EpochAudit => {
  const proven: number[] = [];
  if (input.joinEpoch !== null) proven.push(input.joinEpoch);
  for (const e of input.rejoinEpochs) if (!proven.includes(e)) proven.push(e);
  const activeEpoch = proven.length > 0 ? Math.max(...proven) : null;
  const continuityReasons: string[] = [];
  if (!input.sentMonotonicGeneration) continuityReasons.push('generation-continuity-broken: sends must carry one monotonic generation across epoch resets (protocol rule; never waivable)');
  for (let i = 1; i < proven.length; i += 1) {
    if ((proven[i] as number) <= (proven[i - 1] as number)) continuityReasons.push(`server-issued epochs not strictly increasing (${proven.join(', ')})`);
  }
  const bucketSum = Object.values(input.perEpochSent).reduce((sum, v) => sum + v, 0);
  if (bucketSum > input.sentAuditTotal) continuityReasons.push(`per-epoch issuance buckets (${String(bucketSum)}) exceed the global send audit (${String(input.sentAuditTotal)}) — the two cannot both be true`);
  const perEpoch: Ga11EpochAuditEpochRow[] = proven.map((epoch) => {
    const rows = input.deliveries.filter((d) => d.epoch === epoch);
    const issued = Object.prototype.hasOwnProperty.call(input.perEpochSent, String(epoch)) ? (input.perEpochSent[String(epoch)] as number) : null;
    const acceptedRows = rows.filter((d) => d.accepted);
    const resolved = acceptedRows.map((d) => d.resolvedThrough).filter((v): v is number => typeof v === 'number');
    const maxResolved = resolved.length > 0 ? Math.max(...resolved) : null;
    const reasons: string[] = [];
    let verdict: Ga11EpochAuditEpochRow['verdict'] = 'CLEAN';
    if (rows.length === 0) verdict = 'NO-TRAFFIC';
    else if (issued === null) {
      verdict = 'QUARANTINED';
      reasons.push(`epoch ${String(epoch)}: issuance not proven (no send-audit bucket for it) — evaluation quarantined, never assumed`);
    } else {
      const beyondIssued = resolved.filter((v) => v > issued).length;
      if (beyondIssued > 0) {
        verdict = 'RED';
        reasons.push(`epoch ${String(epoch)}: ${String(beyondIssued)} resolved watermark(s) exceed the ${String(issued)} seqs that epoch issued — the room resolved an input this seat never sent on that epoch`);
      }
      if (maxResolved !== null && maxResolved <= 0) reasons.push(`epoch ${String(epoch)}: resolved watermark non-positive (a zero watermark resolves nothing)`);
    }
    return { epoch, issued, deliveries: rows.length, accepted: acceptedRows.length, maxResolved, verdict, reasons };
  });
  const quarantinedRowsUnprovenEpoch = input.deliveries.filter((d) => !proven.includes(d.epoch)).length;
  const lastDeliveryOnActiveEpoch = input.lastDelivery.epoch === null ? null : input.lastDelivery.epoch === activeEpoch;
  const initialPointerStale = input.initialPointerEpoch !== null && activeEpoch !== null && input.initialPointerEpoch !== activeEpoch;
  const reasons: string[] = [...continuityReasons, ...perEpoch.flatMap((p) => p.reasons)];
  if (quarantinedRowsUnprovenEpoch > 0) reasons.push(`${String(quarantinedRowsUnprovenEpoch)} delivery row(s) carry an epoch OUTSIDE the proven issuance set — quarantined, not attributed`);
  if (lastDeliveryOnActiveEpoch === false) reasons.push(`the last delivery carries epoch ${String(input.lastDelivery.epoch)}, not the active proven epoch ${String(activeEpoch)} — a watermark from a domain that is no longer active`);
  if (lastDeliveryOnActiveEpoch === null) reasons.push('last-delivery epoch unknown — the end-of-window watermark cannot be attributed (quarantined, not assumed clean)');
  const verdict: Ga11EpochAudit['verdict']
    = continuityReasons.length > 0 || perEpoch.some((p) => p.verdict === 'RED') ? 'RED'
      : perEpoch.some((p) => p.verdict === 'QUARANTINED') || quarantinedRowsUnprovenEpoch > 0 || lastDeliveryOnActiveEpoch !== true ? 'QUARANTINED'
        : 'CLEAN';
  return {
    provenIssuanceEpochs: proven,
    activeEpoch,
    initialPointerStale,
    perEpoch,
    continuityOk: continuityReasons.length === 0,
    continuityReasons,
    quarantinedRowsUnprovenEpoch,
    lastDeliveryOnActiveEpoch,
    verdict,
    reasons,
    note: GA11_EPOCH_AUDIT_NOTE,
  };
};

/* ------------------------------------------------------------------ run-outcome classification
 * The a4 review requirement: RTT eligibility, REACHABILITY and BEHAVIOUR findings are three
 * different questions and must be classified separately — a session may be RTT-eligible AND
 * reachable AND carry behaviour findings (an epoch reset, a 1.3 s delivery gap, a terminal
 * suspension) at once; folding them into one boolean hid exactly that in a4. A zero-session
 * run classifies every aggregate as NOT-RUN — `every()` over an empty list must never read as
 * a pass.
 */
/* ------------------------------------------------------------------ MEASUREMENT GRADE (slice-30r7)
 * The EE capture proved the two questions can DISAGREE: every diagnostic check was GREEN and the
 * harness exited 0 while only 2 of 3 promised sessions were eligible (session 3 died on a
 * harness bug). A run is therefore GRADED separately from its checks:
 *   COMPLETE    — every declared session reached the gameplay path, carries its promised fixed
 *                 populations, and is eligible under the DECLARED floors (thresholds unchanged,
 *                 §15B-B: 120 declared / ≥ 99 finite / probe loss ≤ 2 %);
 *   PARTIAL     — something ran and carries usable recorded populations, but the fixed-N promise
 *                 was not met (named failures, ineligible sessions, missing promised samples,
 *                 or populations labelled partial/truncated);
 *   INCOMPLETE  — sessions were dispatched but none reached the gameplay path with a recorded
 *                 promised population;
 *   NOT-RUN     — nothing ran (zero dispatched or zero recorded sessions — a zero-session run is
 *                 NEVER success, and a session whose promised samples are missing from the
 *                 record is never counted as an arrival).
 * The grade NEVER re-scores eligibility and NEVER relabels history: it reads what the record
 * says and names every reason. Old records (without a grade) stay exactly as recorded.
 */

export interface Ga11GradeSessionInput {
  readonly session: number;
  /** Both seats joined and the document path authenticated (the gameplay path actually ran). */
  readonly joined: boolean;
  /** The promised fixed RTT population is PRESENT in the record (eligible or not). */
  readonly promisedSamplesPresent: boolean;
  readonly rttEligible: boolean;
  readonly namedFailure: boolean;
  /** No partial/interrupted collection and no ledger truncation on this session. */
  readonly populationComplete: boolean;
}

export interface Ga11MeasurementGrade {
  readonly grade: 'COMPLETE' | 'PARTIAL' | 'INCOMPLETE' | 'NOT-RUN';
  readonly reasons: readonly string[];
  readonly declaredSessions: number;
  readonly ranSessions: number;
  readonly eligibleSessions: number;
  readonly note: string;
}

export const ga11MeasurementGrade = (
  declaredSessions: number,
  sessions: readonly Ga11GradeSessionInput[],
): Ga11MeasurementGrade => {
  const note = 'measurement grade is INDEPENDENT of the diagnostic-check outcome: all checks may pass on a PARTIAL or INCOMPLETE measurement (a named failure is an honest outcome, never a success); COMPLETE means the pre-registered fixed-N population promise was met under the UNCHANGED declared floors (§15B-B); nothing here re-scores eligibility or relabels any historical record';
  const eligible = sessions.filter((s) => s.rttEligible).length;
  if (declaredSessions <= 0 || sessions.length === 0) {
    return { grade: 'NOT-RUN', reasons: [`zero-sessions: declared=${String(declaredSessions)} recorded=${String(sessions.length)} — a zero-session run is never success`], declaredSessions, ranSessions: sessions.length, eligibleSessions: 0, note };
  }
  const reasons: string[] = [];
  if (sessions.length < declaredSessions) reasons.push(`dispatched-shortfall:${String(sessions.length)}<${String(declaredSessions)} recorded sessions`);
  for (const s of sessions) {
    if (!s.joined) reasons.push(`session-${String(s.session)}: never reached the gameplay path (join refused or unevidenced)`);
    if (!s.promisedSamplesPresent) reasons.push(`session-${String(s.session)}: promised fixed RTT population MISSING from the record — missing promised samples are never counted as an arrival`);
    else if (!s.rttEligible) reasons.push(`session-${String(s.session)}: ran but NOT eligible under the declared floors`);
    if (s.namedFailure) reasons.push(`session-${String(s.session)}: carries a named failure`);
    if (!s.populationComplete) reasons.push(`session-${String(s.session)}: populations labelled partial/interrupted/truncated`);
  }
  if (sessions.length === declaredSessions && sessions.every((s) => s.joined && s.promisedSamplesPresent && s.rttEligible && !s.namedFailure && s.populationComplete)) {
    return { grade: 'COMPLETE', reasons: [], declaredSessions, ranSessions: sessions.length, eligibleSessions: eligible, note };
  }
  const anyGameplayEvidence = sessions.some((s) => s.joined && s.promisedSamplesPresent);
  const grade = anyGameplayEvidence ? 'PARTIAL' : 'INCOMPLETE';
  return { grade, reasons, declaredSessions, ranSessions: sessions.length, eligibleSessions: eligible, note };
};

export interface Ga11RunClassification {
  readonly declaredSessions: number;
  readonly ranSessions: number;
  readonly notRun: boolean;
  readonly reachability: { readonly reachable: number; readonly unreachable: number };
  readonly rttEligibility: { readonly eligible: number; readonly ineligible: number };
  readonly epochAudits: { readonly CLEAN: number; readonly QUARANTINED: number; readonly RED: number; readonly absent: number };
  readonly behaviourFindings: readonly { readonly session: number; readonly findings: readonly string[] }[];
  readonly note: string;
}

export const classifyGa11Run = (
  declared: number,
  sessions: readonly { readonly session: number; readonly reached: boolean; readonly rttEligible: boolean; readonly epochAudit: 'CLEAN' | 'QUARANTINED' | 'RED' | null; readonly findings: readonly string[] }[],
): Ga11RunClassification => {
  const notRun = sessions.length === 0;
  return {
    declaredSessions: declared,
    ranSessions: sessions.length,
    notRun,
    reachability: {
      reachable: sessions.filter((s) => s.reached).length,
      unreachable: sessions.filter((s) => !s.reached).length,
    },
    rttEligibility: {
      eligible: sessions.filter((s) => s.rttEligible).length,
      ineligible: sessions.filter((s) => !s.rttEligible).length,
    },
    epochAudits: {
      CLEAN: sessions.filter((s) => s.epochAudit === 'CLEAN').length,
      QUARANTINED: sessions.filter((s) => s.epochAudit === 'QUARANTINED').length,
      RED: sessions.filter((s) => s.epochAudit === 'RED').length,
      absent: sessions.filter((s) => s.epochAudit === null).length,
    },
    behaviourFindings: sessions.filter((s) => s.findings.length > 0).map((s) => ({ session: s.session, findings: s.findings })),
    note: 'classification only: reachability, RTT eligibility and behaviour findings are separate questions; a zero-session run is NOT-RUN for every aggregate (never a vacuous pass); findings are named, never waived',
  };
};

/** Scrub session-identifier-shaped tokens (mixed case + digit, length ≥ 8) out of free-text
 * evidence (e.g. the predictor's recovery-ledger detail lines) before a record stores it.
 * Epoch numbers and ordinary words survive; opaque ids do not. */
export const sanitizeGa11Detail = (raw: string): string =>
  raw.split(/(\s+)/).map((token) =>
    token.length >= 8 && token.length <= 24 && /[a-z]/.test(token) && /[A-Z]/.test(token) && /[0-9]/.test(token) ? '[ID]' : token,
  ).join('');

/* ------------------------------------------------------------------ run.log host redaction */

/** The strings a run's stdout may innocently echo (SDK console noise names the socket URL) and
 * which the log filter MUST erase. Ordered longest-first so origins are replaced before bare
 * hostnames; passwords never enter stdout at all, so they are not this filter's job. */
export const ga11LogFilterValues = (endpoint: Ga11EndpointOk): readonly string[] => [
  endpoint.socketOrigin,
  endpoint.webOrigin,
  `${endpoint.host}:${String(endpoint.port)}`,
  `//${endpoint.host}`,
  endpoint.host,
];

/* ------------------------------------------------------------------ locally-owned test certificate
 * The facsimile reproduces the ACTUAL ingress over TLS, which needs a certificate. It is an
 * EPHEMERAL, locally-owned, explicitly-UNTRUSTED test certificate generated by the harness on
 * every hop start (1 day, CN/SAN 127.0.0.1) — it authenticates NOTHING outside the facsimile and
 * proves no trust to anyone. The private key files are unlinked the instant they are read into
 * memory (no secret at rest); the material dies with the process. Real-path TLS verification is
 * untouched: relaxation exists only where ga11SeatContextTlsOptions admits this exact label.
 */
export const GA11_TEST_CERT_NOTE =
  'locally-owned ephemeral self-signed TEST certificate (openssl, 1 day, CN/SAN 127.0.0.1); untrusted by design — the private key file was unlinked immediately after read and never left this process; it authenticates nothing outside the loopback facsimile and real-path TLS verification is unchanged (runtime default)';

export interface Ga11TestCertificate {
  readonly cert: Buffer;
  readonly key: Buffer;
  readonly note: string;
}

export const makeGa11EphemeralTestCertificate = (): Ga11TestCertificate => {
  const dir = mkdtempSync(join(tmpdir(), 'ga11-test-cert-'));
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
      '-keyout', keyPath, '-out', certPath,
    ], { stdio: 'pipe' });
    return { cert: readFileSync(certPath), key: readFileSync(keyPath), note: GA11_TEST_CERT_NOTE };
  } finally {
    try { unlinkSync(keyPath); } catch { /* already gone */ }
    try { unlinkSync(certPath); } catch { /* already gone */ }
    try { rmdirSync(dir); } catch { /* already gone */ }
  }
};

/* ------------------------------------------------------------------ loopback facsimile hop */

export interface Ga11FacsimileHop {
  readonly port: number;
  /** POST-TLS cleartext byte totals as the hop sees them after terminating the (test) TLS — the
   * facsimile's own view, labelled as such; wire-level bytes are a different quantity. */
  bytes(): { c2s: number; s2c: number; connections: number; authed: number; refused: number };
  stop(): Promise<void>;
}

/**
 * A TLS-TERMINATING, Basic-auth-gated reverse hop bound to 127.0.0.1 on an ephemeral port, for
 * the loopback facsimile ONLY — the HTTPS parity the HTTP-only relay could never exercise.
 * Behaviour mirrors the ACTUAL vhost: Basic auth is required on EVERY method including OPTIONS
 * (401 + challenge otherwise), the WSS upgrade carries the same rule, and authenticated traffic
 * is forwarded to the loopback fixture (HTTP proxy + raw upgrade tunnel). It serves ONE
 * facsimile-owned same-origin document at `/` with 200 — the cell requires a 2xx protected page,
 * and on the real path the service's OWN document must satisfy that (a named failure otherwise);
 * every other path proxies to the fixture. Byte counters tally post-TLS cleartext bytes, which
 * exist only in the facsimile. No delay, no loss, no regime — auth posture and TLS shape only —
 * and it never binds outside 127.0.0.1.
 */
export const startGa11FacsimileHop = async (options: {
  login: string;
  password: string;
  targetPort: number;
  tls: { cert: Buffer; key: Buffer };
}): Promise<Ga11FacsimileHop> => {
  const expected = `Basic ${Buffer.from(`${options.login}:${options.password}`).toString('base64')}`;
  const counts = { c2s: 0, s2c: 0, connections: 0, authed: 0, refused: 0 };
  const sockets = new Set<Socket>();
  const track = (s: Socket): void => {
    sockets.add(s);
    s.on('error', () => sockets.delete(s));
    s.on('close', () => sockets.delete(s));
  };
  const forwardedHeaders = (headers: IncomingHttpHeaders): Record<string, string | string[]> => {
    const out: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined) continue;
      const k = key.toLowerCase();
      // The fixture is unauthenticated loopback: the client's credentials STOP at the hop —
      // exactly what the real vhost does not do, and the honest difference is labelled here.
      if (k === 'authorization' || k === 'host' || k === 'cookie' || k === 'proxy-authorization' || k === 'connection') continue;
      out[key] = value;
    }
    out['host'] = `127.0.0.1:${String(options.targetPort)}`;
    return out;
  };
  const server = createHttpsServer({ cert: options.tls.cert, key: options.tls.key }, (req, res: ServerResponse) => {
    counts.connections += 1;
    track(req.socket);
    if (req.headers.authorization !== expected) {
      // EVERY method demands auth — OPTIONS included: the actual vhost's posture.
      counts.refused += 1;
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="udg-ga11-facsimile"', 'Content-Length': '0' });
      res.end();
      return;
    }
    counts.authed += 1;
    const url = req.url ?? '/';
    if ((req.method === 'GET' || req.method === 'HEAD') && (url === '/' || url === '/index.html')) {
      // The facsimile's OWN same-origin document (the real path serves the service's own page;
      // the cell enforces 2xx either way — a 404 document is a named admission failure).
      const body = Buffer.from('<!doctype html><html><head><title>udg ga11 facsimile (local fixture, not the service)</title></head><body></body></html>');
      counts.s2c += body.length;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': String(body.length) });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    const upstream = httpRequest({ host: '127.0.0.1', port: options.targetPort, method: req.method, path: url, headers: forwardedHeaders(req.headers) }, (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers);
      upRes.on('data', (chunk: Buffer) => { counts.s2c += chunk.length; });
      upRes.pipe(res);
      upRes.on('error', () => res.destroy());
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Length': '0' });
      res.end();
    });
    req.pipe(upstream);
  });
  // INBOUND counting is at the DECRYPTED socket level (every byte the hop actually received in
  // cleartext, headers included); OUTBOUND is application payload level (bodies/tunnel chunks,
  // headers and TLS overhead excluded) — both are the hop's own post-TLS view, never wire bytes.
  server.on('secureConnection', (tlsSocket) => {
    track(tlsSocket);
    tlsSocket.on('data', (chunk: Buffer) => { counts.c2s += chunk.length; });
  });
  server.on('upgrade', (req, rawSocket, head) => {
    counts.connections += 1;
    const socket = rawSocket as Socket;
    if (req.headers.authorization !== expected) {
      counts.refused += 1;
      socket.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="udg-ga11-facsimile"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    counts.authed += 1;
    const upstream = netConnect(options.targetPort, '127.0.0.1');
    track(socket);
    track(upstream);
    const lines = [`${req.method} ${req.url ?? '/'} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const key = req.rawHeaders[i] ?? '';
      const value = req.rawHeaders[i + 1] ?? '';
      const k = key.toLowerCase();
      if (k === 'authorization' || k === 'host' || k === 'proxy-authorization') continue;
      lines.push(`${key}: ${value}`);
    }
    lines.push(`Host: 127.0.0.1:${String(options.targetPort)}`);
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head.length > 0) upstream.write(head); // already counted as inbound at the socket level
    upstream.on('data', (chunk: Buffer) => { counts.s2c += chunk.length; });
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    port,
    bytes: () => ({ ...counts }),
    stop: async () => {
      for (const s of sockets) s.destroy();
      sockets.clear();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
};

