/**
 * Shared harness for the UDG-003 Phase 0 server/SDK probes.
 *
 * Phase 0 exists to find out what the pinned Colyseus set actually does, so these probes run against
 * a real server and a real client — never a stand-in. Everything here is public API from the installed
 * declarations (docs/integration/colyseus.md 6.1); no private path, no cast through `unknown`, no
 * directive-free source, and the probe project compiles with `skipLibCheck: false` so a wrong signature is a
 * compile error rather than a runtime surprise.
 *
 * The server binds 127.0.0.1 on an ephemeral port and prints exactly one ready line. A probe writes
 * one JSON result and exits deliberately: the transport keeps timers alive, and a probe that hangs
 * would make CI meaningless.
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { defineServer, type RegisteredHandler, type Room, type Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';

/** The five wire fields of the fixed-step input channel, as decoded on either side. */
export interface DirectInputFrame {
  sessionEpoch: number;
  generation: number;
  directIntent: boolean;
  moveX: number;
  moveZ: number;
}

export interface ProbeCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface ProbeResult {
  readonly schemaVersion: 1;
  readonly probeId: string;
  readonly subject: string;
  readonly ok: boolean;
  readonly checks: readonly ProbeCheck[];
  readonly observations: Readonly<Record<string, unknown>>;
  readonly limitations: readonly string[];
  readonly startedAt: string;
  readonly finishedAt: string;
}

export class CheckList {
  readonly #checks: ProbeCheck[] = [];
  readonly #observations: Record<string, unknown> = {};
  readonly #limitations: string[] = [];

  check(name: string, ok: boolean, detail: string): boolean {
    this.#checks.push({ name, ok, detail });
    return ok;
  }

  observe(key: string, value: unknown): void {
    this.#observations[key] = value;
  }

  limit(text: string): void {
    this.#limitations.push(text);
  }

  get failed(): boolean {
    return this.#checks.some((entry) => !entry.ok);
  }

  build(probeId: string, subject: string, startedAt: string): ProbeResult {
    return {
      schemaVersion: 1,
      probeId,
      subject,
      ok: !this.failed,
      checks: this.#checks,
      observations: this.#observations,
      limitations: this.#limitations,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }
}

/** The `--out` destination every probe writes, defaulting to a sibling of the compiled probe. */
export function outputPath(argv: readonly string[]): string {
  const index = argv.indexOf('--out');
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (value === undefined || value === '') {
    throw new Error('a Phase 0 probe requires --out <file>');
  }
  return resolve(value);
}

export function writeResult(path: string, result: ProbeResult): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

/**
 * Run one probe body: write the result whatever happens, and turn a thrown error into a failed probe
 * rather than an unhelpful stack trace with no record.
 */
export async function runProbe(
  probeId: string,
  subject: string,
  out: string,
  body: (checks: CheckList) => Promise<void>,
): Promise<ProbeResult> {
  const startedAt = new Date().toISOString();
  const checks = new CheckList();
  try {
    await body(checks);
  } catch (error) {
    checks.check('probe-completed', false, `probe threw: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  }
  const result = checks.build(probeId, subject, startedAt);
  writeResult(out, result);
  // A transport keeps sockets and timers alive, and a probe that never exits makes CI meaningless.
  // The result file is already on disk, so leaving by exit is honest rather than a swallow.
  process.exitCode = result.ok ? 0 : 1;
  return result;
}

/**
 * A listening server for one probe.
 *
 * `Server` exposes neither `endpoint` nor `getPort()` in 0.18.27 — `listen()` resolves to `undefined`
 * — so the address is read back from the http server we supplied and the `ws://` form is composed
 * here. `new Client()` wants the http(s) form, which `httpEndpoint` derives.
 */
export interface ProbeServer {
  readonly port: number;
  readonly endpoint: string;
  readonly server: Server;
  close(): Promise<void>;
}

/**
 * Boot the pinned server on loopback without owning a port number: `serverless()` binds the transport
 * and the matchmaking routes to the http server we supply, then we listen on port 0 and read back
 * whatever the operating system gave us. Public API only, and nothing is ever bound beyond 127.0.0.1.
 */
export async function startProbeServer(rooms: Record<string, RegisteredHandler>): Promise<ProbeServer> {
  const httpServer = createServer();
  const transport = new WebSocketTransport({ server: httpServer });
  const server = defineServer({ rooms, transport });

  await server.serverless();
  await new Promise<void>((listening, failure) => {
    httpServer.once('error', failure);
    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.off('error', failure);
      listening();
    });
  });

  const address = httpServer.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the probe server did not bind a TCP port');
  }
  const port = (address as AddressInfo).port;
  process.stdout.write(`ready 127.0.0.1:${String(port)}\n`);

  return {
    port,
    endpoint: `ws://127.0.0.1:${String(port)}`,
    server,
    async close(): Promise<void> {
      await server.gracefullyShutdown(false);
      await new Promise<void>((closed) => {
        httpServer.close(() => {
          closed();
        });
      });
    },
  };
}

/**
 * The endpoint a transport reports is a `ws://` URL, while `new Client()` expects an `http(s)://`
 * base and derives the socket address itself. Handing the ws URL to the client throws
 * `TypeError: Invalid URL`, so the conversion lives in the harness rather than in each probe.
 */
export function httpEndpoint(endpoint: string): string {
  if (endpoint.startsWith('wss://')) return 'https://' + endpoint.slice('wss://'.length);
  if (endpoint.startsWith('ws://')) return 'http://' + endpoint.slice('ws://'.length);
  return endpoint;
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((settled) => {
    setTimeout(settled, milliseconds);
  });
}

/** Poll a condition with a deadline, so a probe reports what actually happened rather than hanging. */
export async function until(condition: () => boolean, timeoutMs: number, intervalMs = 20): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (condition()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(intervalMs);
  }
}

/** Read the room instance a probe created, from inside the same process. */
export function lastInstance<T>(registry: readonly T[]): T | undefined {
  return registry[registry.length - 1];
}

/** The room base class, re-exported so each probe file imports third-party names from one place. */
export type RoomBase = Room;
