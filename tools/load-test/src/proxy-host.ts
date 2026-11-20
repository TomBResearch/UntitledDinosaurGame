/**
 * UDG-SPIKE-001 — standalone proxy host (measurement contamination control).
 *
 * WHY THIS FILE EXISTS. The first paired-browser elevated calibration recorded achieved jitter of
 * ~39.8 ms against a 20 ms budget — INVALID — and the raw diagnostics say why: the proxy was
 * running INSIDE the Playwright worker process, whose event loop also serves the room (authority
 * ticks, patch batching, the test-only tick gate) and the browser CDP traffic. A `setTimeout`
 * stall scheduled on a saturated loop FIRES LATE, and the achieved sample (honestly) counts that
 * overshoot. That is harness contamination — capacity contention in the measuring instrument —
 * not the impairment profile, and the fix belongs in the harness: the impairment clock gets its
 * OWN process with nothing on the loop but the proxies. No threshold moves; no sample is
 * adjusted; the accepted metric still measures everything the bytes experienced, including any
 * lag the diagnostics then name.
 *
 * Protocol (NDJSON over stdin/stdout; stderr is logs only):
 *   -> {"ch":"cmd","id":n,"op":"start","profile":{name,oneWayMs,jitterBudgetMs,seed},"targetHost","targetPort"}
 *   <- {"ch":"reply","id":n,"ok":true,"port":p,"profile":...}
 *   -> {"ch":"cmd","id":n,"op":"stats","handle":h}    <- full ProxyStats of that proxy
 *   -> {"ch":"cmd","id":n,"op":"close","handle":h}    <- CLOSED stats (drained) of that proxy
 *   -> {"ch":"cmd","id":n,"op":"shutdown"}            <- drains every proxy, replies, then the
 *                                                        process prints ONE receipt line and exits
 * <- {"ch":"hello"} at startup; <- {"ch":"receipt","exitCode":0,"proxiesClosed":k,
 *      "activeResourcesAfterClose":[],"shutdownMs":ms} on shutdown (the finite-teardown receipt).
 *
 * Finite by construction: a master watchdog exits the process if the control channel goes idle
 * past `idleCapMs` (default 20 min) — a host that is never told to stop still stops. The shutdown
 * path bounds each proxy close and reports any handle left behind rather than hanging.
 */

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

import { createWsDelayProxy, type ProxyStats, type WsDelayProxy } from './ws-delay-proxy.js';

interface StartCmd {
  readonly ch: 'cmd';
  readonly id: number;
  readonly op: 'start';
  readonly profile: { readonly name: string; readonly oneWayMs: number; readonly jitterBudgetMs: number; readonly seed: number };
  readonly targetHost: string;
  readonly targetPort: number;
  /** Harness-only A/B knob forwarded to the proxy (see ws-delay-proxy.ts); default true. */
  readonly tcpNoDelay?: boolean;
}

interface HandleCmd {
  readonly ch: 'cmd';
  readonly id: number;
  readonly op: 'stats' | 'close';
  readonly handle: number;
}

interface ShutdownCmd {
  readonly ch: 'cmd';
  readonly id: number;
  readonly op: 'shutdown';
}

type Cmd = StartCmd | HandleCmd | ShutdownCmd;

const write = (line: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify(line)}\n`);
};

const idleCapMs = Number(process.env['UDG_PROXY_HOST_IDLE_CAP_MS'] ?? 20 * 60_000);
let watchdog: ReturnType<typeof setTimeout> | undefined;
const armWatchdog = (): void => {
  if (watchdog !== undefined) clearTimeout(watchdog);
  watchdog = setTimeout(() => {
    process.stderr.write('proxy-host: idle cap reached — finite self-teardown\n');
    void shutdownAndExit('idle-cap');
  }, idleCapMs);
  watchdog.unref();
};

interface ProxyEntry {
  readonly handle: number;
  readonly proxy: WsDelayProxy;
}

const proxies = new Map<number, ProxyEntry>();
let nextHandle = 1;
let shuttingDown = false;
let proxiesOpened = 0;
let proxiesDrained = 0;

/** stdio handles are inherited, not owned: the leak audit counts what THIS process opened. */
const STDIO_KINDS = new Set(['PipeWrap', 'TTY', 'FDSStreamWrap']);
const activeResources = (): string[] => process.getActiveResourcesInfo().filter((kind) => !STDIO_KINDS.has(kind));

const shutdownAndExit = async (trigger: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  const started = Number(process.hrtime.bigint()) / 1e6;
  if (watchdog !== undefined) clearTimeout(watchdog);
  const entries = [...proxies.values()];
  proxies.clear();
  let closed = 0;
  for (const entry of entries) {
    // Bound each proxy close: a straggler is reported, never waited on forever.
    const closedNow = await Promise.race([
      entry.proxy.close().then(() => true),
      new Promise<boolean>((resolve) => {
        const t = setTimeout(() => {
          resolve(false);
        }, 5_000);
        t.unref();
      }),
    ]);
    if (closedNow) closed += 1;
  }
  // Give uv a beat to retire close requests, then state what is genuinely still live.
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
  const leaked = activeResources();
  const shutdownMs = Number(process.hrtime.bigint()) / 1e6 - started;
  const healthy = leaked.length === 0 && closed === entries.length && proxiesDrained === proxiesOpened;
  write({
    ch: 'receipt',
    trigger,
    exitCode: healthy ? 0 : 3,
    proxiesClosed: closed + proxiesDrained,
    proxiesOpened,
    activeResourcesAfterClose: leaked,
    shutdownMs,
  });
  process.exitCode = healthy ? 0 : 3;
  setTimeout(() => process.exit(process.exitCode ?? 0), 10).unref();
};

const handle = (cmd: Cmd): void => {
  if (cmd.op === 'shutdown') {
    write({ ch: 'reply', id: cmd.id, ok: true, acknowledged: 'shutdown' });
    void shutdownAndExit('shutdown');
    return;
  }
  if (cmd.op === 'start') {
    void createWsDelayProxy({
      tcpNoDelay: cmd.tcpNoDelay ?? true,
      listenPort: 0,
      targetHost: cmd.targetHost,
      targetPort: cmd.targetPort,
      profile: cmd.profile,
    }).then((proxy) => {
      const entry: ProxyEntry = { handle: nextHandle, proxy };
      proxies.set(nextHandle, entry);
      proxiesOpened += 1;
      write({ ch: 'reply', id: cmd.id, ok: true, handle: nextHandle, port: proxy.port, profile: proxy.profile });
      nextHandle += 1;
    }).catch((error: unknown) => {
      write({ ch: 'reply', id: cmd.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    });
    return;
  }
  const entry = proxies.get(cmd.handle);
  if (entry === undefined) {
    write({ ch: 'reply', id: cmd.id, ok: false, error: `no proxy handle ${String(cmd.handle)}` });
    return;
  }
  if (cmd.op === 'stats') {
    write({
      ch: 'reply', id: cmd.id, ok: true,
      stats: entry.proxy.stats() satisfies ProxyStats,
      throttle: { worstThrottleDeltaUsec, worstThrottleDeltaEvents },
    });
    return;
  }
  void entry.proxy.close().then(() => {
    proxies.delete(cmd.handle);
    proxiesDrained += 1;
    write({ ch: 'reply', id: cmd.id, ok: true, stats: entry.proxy.stats() });
  });
};

/* CPU-quota throttling is the contamination this host isolates AGAINST: under a cgroup CPU
 * quota, CFS throttling stalls the event loop even though the process is idle, and a stalled
 * loop overshoots every stall timer. The host therefore SAMPLES its own throttle counters
 * around a 1 s period and reports the worst delta beside every stats reply — the achieved
 * jitter's cause becomes a receipt, stated next to the metric it explains. (cgroup v2 best
 * effort: absent counters simply report zero.) */
const readThrottle = (): { throttledUsec: number; nrThrottled: number } => {
  try {
    const stat = readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8');
    const usec = /throttled_usec (\d+)/.exec(stat);
    const nr = /nr_throttled (\d+)/.exec(stat);
    return { throttledUsec: Number(usec?.[1] ?? 0), nrThrottled: Number(nr?.[1] ?? 0) };
  } catch {
    return { throttledUsec: 0, nrThrottled: 0 };
  }
};
let lastThrottle = readThrottle();
let worstThrottleDeltaUsec = 0;
let worstThrottleDeltaEvents = 0;
const throttleSampler = setInterval(() => {
  const now = readThrottle();
  worstThrottleDeltaUsec = Math.max(worstThrottleDeltaUsec, now.throttledUsec - lastThrottle.throttledUsec);
  worstThrottleDeltaEvents = Math.max(worstThrottleDeltaEvents, now.nrThrottled - lastThrottle.nrThrottled);
  lastThrottle = now;
}, 1_000);
throttleSampler.unref();

const lines = createInterface({ input: process.stdin, terminal: false });
process.stdout.on('error', () => {
  // The controller hung up: the host is a servant, it goes away quietly.
  void shutdownAndExit('stdout-closed');
});
lines.on('line', (line) => {
  armWatchdog();
  if (line.trim().length === 0) return;
  let cmd: Cmd;
  try {
    cmd = JSON.parse(line) as Cmd;
  } catch (error) {
    write({ ch: 'reply', id: -1, ok: false, error: `unparseable command: ${String(error instanceof Error ? error.message : error)}` });
    return;
  }
  if (cmd.ch !== 'cmd') {
    write({ ch: 'reply', id: -1, ok: false, error: 'missing ch:"cmd"' });
    return;
  }
  handle(cmd);
});
lines.on('close', () => {
  void shutdownAndExit('stdin-closed');
});

write({ ch: 'hello', pid: process.pid, idleCapMs });
armWatchdog();
