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
 *   - the loopback FACSIMILE hop: a Basic-auth-gated raw byte relay bound to 127.0.0.1 that lets
 *     the WHOLE authed-session path (HTTP join + authenticated WebSocket upgrade + RTT seam +
 *     byte counting) be validated against the local fixture room before anyone dials anything.
 *
 * What this file NEVER does: dials any endpoint itself (the browser cell composes the session;
 * this module only decides admission and honesty rules); records an endpoint value, a login or a
 * password (only sha256(lowercased host:port) travels — the same redaction, with the same
 * guessability caveat, as staging-probe); claims a regime, a provider, an ISP, a gate verdict, or
 * any relationship to the OFFICIAL 4×3 loopback-proxy matrix, which stays a separate evidence set
 * (handoff §6). Every record built with these helpers carries the nonformal labels verbatim.
 */

import { createHash } from 'node:crypto';
import { connect as netConnect, createServer, type Server, type Socket } from 'node:net';

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
  readonly tls: 'runtime-default-verification' | 'plain-not-private';
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
  options: { allowLoopbackInsecure?: boolean } = {},
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
  const hostPort = `${host}:${String(port)}`;
  return {
    ok: true,
    webOrigin: `${secure ? 'https' : 'http'}://${hostPort}`,
    socketOrigin: `${secure ? 'wss' : 'ws'}://${hostPort}`,
    host,
    port,
    digest: createHash('sha256').update(hostPort).digest('hex'),
    loopback,
    tls: secure ? 'runtime-default-verification' : 'plain-not-private',
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
      return { ok: false, error: `netrc line ${String(index + 1)} starts with "${tokens[0]}" — only "machine <host> login <l> password <p>" entries are understood (the existing host format)` };
    }
    const machine = tokens[1] ?? '';
    let login: string | undefined;
    let password: string | undefined;
    for (let t = 2; t < tokens.length; t += 2) {
      const key = tokens[t] ?? '';
      const value = tokens[t + 1] ?? '';
      if (key === 'login') login = value;
      else if (key === 'password') password = value;
      else return { ok: false, error: `netrc line ${String(index + 1)} carries unknown token "${key}" at position ${String(t)} (line truncated; value not echoed)` };
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
}

/**
 * Eligibility for one natural-path session population. The declared fixed count is the promise;
 * a timeout is a named non-finite sample that REDUCES eligibility, never a row that disappears.
 * Floors come from GA11_FIXED_POPULATION and plan §15B-B (probe loss ≤ 2 %); the outcome is
 * labelled, never narrated around. `percentiles` from statistics.ts rejects non-finite input, so
 * the finite-only split here is the ONLY place a sample is set aside — and it is fully counted.
 */
export const rttEligibility = (rawSamples: readonly number[], nearestRankFn: (samples: readonly number[], p: number) => number): Ga11RttEligibility => {
  const declared = rawSamples.length;
  const finite = rawSamples.filter((v) => Number.isFinite(v));
  const timeouts = declared - finite.length;
  const loss = declared === 0 ? 1 : timeouts / declared;
  const reasons: string[] = [];
  if (declared !== GA11_FIXED_POPULATION.rttSamplesPerSession) reasons.push(`declared-count-deviation:${String(declared)}!=${String(GA11_FIXED_POPULATION.rttSamplesPerSession)}`);
  if (finite.length < GA11_FIXED_POPULATION.minEligibleRttSamples) reasons.push(`below-min-eligible:${String(finite.length)}<${String(GA11_FIXED_POPULATION.minEligibleRttSamples)}`);
  if (loss > GA11_FIXED_POPULATION.maxProbeLossFraction) reasons.push(`probe-loss-over-floor:${(loss * 100).toFixed(2)}%>${String(GA11_FIXED_POPULATION.maxProbeLossFraction * 100)}%`);
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
  };
};

/* ------------------------------------------------------------------ same-origin module assets
 * The seat documents are served by the NOMINATED origin itself (the navigation authenticates —
 * see the cell). The only cross-served things are the harness's own compiled client/netcode
 * modules and the pinned-SDK chunks the shipped Vite pipeline produces for them; the browser
 * asks for them at the page's own origin, so exactly those KNOWN local module-asset path shapes
 * are rewritten to the loopback Vite server. The allowlist is a PREFIX LIST OF MODULE ASSETS
 * ONLY: the SDK's matchmake routes ('/matchmake/…' and anything else the pinned client really
 * calls) and the WebSocket (never interceptable by page.route in the first place) are NOT on
 * the list and always travel the real network. Nothing is proxied; no secret can cross this
 * rewrite — its target is a localhost dev-asset server.
 */
export const GA11_MODULE_PATH_PREFIXES = [
  '/src/network/',       // the two entry modules the harness imports
  '/node_modules/',      // Vite's pre-bundled dependency chunks (incl. the pinned SDK)
  '/@fs/',               // Vite's file-system-served module URLs (workspace links)
  '/@id/',               // Vite's resolved-id module URLs
  '/@vite/',             // Vite client/env module URLs
] as const;

/** Rewrite ONLY a same-origin-as-nominated module-asset URL to the local Vite origin; anything
 * else (matchmake, unknown paths, other origins) returns null and is NEVER intercepted. */
export const ga11ModuleUrlRewrite = (rawUrl: string, webOrigin: string, viteOrigin: string): string | null => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  let base: URL;
  try {
    base = new URL(webOrigin);
  } catch {
    return null;
  }
  if (url.origin !== base.origin) return null;
  if (!GA11_MODULE_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return null;
  return `${viteOrigin}${url.pathname}${url.search}`;
};

/* ------------------------------------------------------------------ WS payload-byte semantics */

/** The semantics label that MUST travel with every frame-length number (and with their absence). */
export const GA11_WS_FRAME_SEMANTICS =
  'client-visible WebSocket DATA frames via the Playwright page API (framesent/framereceived payload byte lengths only; TLS records, WS headers/framing and control frames are invisible to the page, and heartbeat-vs-patch classification is NOT identifiable at this seam, so NO patch-byte or heartbeat claim is made; lengths are payload-only)';

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

/* ------------------------------------------------------------------ loopback facsimile hop */

export interface Ga11FacsimileHop {
  readonly port: number;
  bytes(): { c2s: number; s2c: number; connections: number; authed: number; refused: number };
  stop(): Promise<void>;
}

/**
 * A Basic-auth-gated RAW relay bound to 127.0.0.1 on an ephemeral port, for the loopback
 * facsimile ONLY. It inspects the first request header block of each connection and requires the
 * exact `Basic base64(login:password)` the run was given for EVERY method — OPTIONS included —
 * answering 401 with a challenge otherwise. (The slice-30 review corrected this seam to match the
 * ACTUAL vhost, which challenges every method including preflights; the earlier OPTIONS bypass
 * was exactly the fiction the harness must not breed.) A cross-origin page therefore CANNOT join
 * such a host — which is why the session pages navigate the protected origin itself (same-origin:
 * no preflight exists at all, and the credentials the context was given answer the document's own
 * 401). On success the relay pipes bytes both ways to the fixture room while counting them
 * (hop-level byte totals exist ONLY in the facsimile; the real path measures WS payload lengths
 * client-side instead). It models ingress auth posture only — no delay, no loss, no regime — and
 * it never binds outside 127.0.0.1.
 */
export const startGa11FacsimileHop = async (options: {
  login: string;
  password: string;
  targetPort: number;
}): Promise<Ga11FacsimileHop> => {
  const expected = `Basic ${Buffer.from(`${options.login}:${options.password}`).toString('base64')}`;
  const counts = { c2s: 0, s2c: 0, connections: 0, authed: 0, refused: 0 };
  const sockets = new Set<Socket>();
  const server: Server = createServer();
  server.on('connection', (client) => {
    counts.connections += 1;
    sockets.add(client);
    client.on('error', () => sockets.delete(client));
    client.on('close', () => sockets.delete(client));
    const head: Buffer[] = [];
    let seen = 0;
    const onData = (chunk: Buffer): void => {
      head.push(chunk);
      seen += chunk.length;
      const text = Buffer.concat(head).subarray(0, Math.min(seen, 65_536)).toString('latin1');
      const end = text.indexOf('\r\n\r\n');
      if (end === -1) {
        if (seen > 65_536) { client.destroy(); sockets.delete(client); }
        return; // keep buffering until the header block completes
      }
      const headerBlock = text.slice(0, end);
      const auth = /^authorization:\s*(.+)$/im.exec(headerBlock)?.[1]?.trim();
      client.removeListener('data', onData);
      if (auth !== expected) {
        // EVERY method demands auth — OPTIONS included: the actual vhost's posture (see above).
        counts.refused += 1;
        client.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="udg-ga11-facsimile"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
        client.destroy();
        sockets.delete(client);
        return;
      }
      counts.authed += 1;
      const upstream = netConnect(options.targetPort, '127.0.0.1');
      sockets.add(upstream);
      upstream.on('error', () => { sockets.delete(upstream); client.destroy(); });
      upstream.on('close', () => sockets.delete(upstream));
      for (const buf of head) counts.c2s += buf.length;
      upstream.write(Buffer.concat(head));
      client.pipe(upstream);
      upstream.pipe(client);
      client.on('data', (b: Buffer) => { counts.c2s += b.length; });
      upstream.on('data', (b: Buffer) => { counts.s2c += b.length; });
    };
    client.on('data', onData);
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

