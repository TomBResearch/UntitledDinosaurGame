/**
 * The real server entry the smoke run starts (UDG-003 Phase 2, W-11).
 *
 * Region-bound startup, in this exact order, because every later step depends on the one before it
 * having refused what it must refuse:
 *
 * 1. `loadServerConfig` — a validated `ServerConfig` or a non-zero exit.
 * 2. The `region` block must carry bounds. There is no production region asset yet (D5, UDG-007),
 *    so an M0 deployment that intends to accept players names bounds explicitly; starting without
 *    them is the mislabelled-deployment bug this entry exists to prevent.
 * 3. `defineServer` with the pinned WebSocket transport over a plain http server, the `region` room
 *    registered, loopback-bound by default. The room's own `onCreate` then re-validates and refuses
 *    a configuration the core will not run on.
 *
 * The process entry is guarded so importing this module (the smoke test does) starts nothing; the
 * exported `startRegionServer` is the whole boot, and `process.exitCode` carries configuration
 * refusal without stack-trace noise.
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { defineServer, type RegisteredHandler } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';

import { loadServerConfig, type LoadResult } from './server-config.js';
import { defineOperatorRegionRoom } from './rooms/RegionRoom.js';
import type { RegionRoomOptions } from './rooms/RegionRoom.js';

export interface StartedServer {
  readonly port: number;
  readonly endpoint: string;
  readonly configHash: string;
  close(): Promise<void>;
}

export type StartResult =
  | { readonly ok: true; readonly server: StartedServer }
  | { readonly ok: false; readonly reason: 'config'; readonly issues: readonly string[] }
  | { readonly ok: false; readonly reason: 'no-region-bounds'; readonly detail: string };

/** Boot the region server. The smoke run calls this; `node dist/main.js` calls it too. */
export const startRegionServer = async (options: {
  readonly documentPath?: string;
  readonly roomOptions?: RegionRoomOptions;
  readonly host?: string;
} = {}): Promise<StartResult> => {
  const load: LoadResult = loadServerConfig({
    ...(options.documentPath === undefined ? {} : { documentPath: options.documentPath }),
    ...(options.roomOptions?.config === undefined ? {} : { overrides: options.roomOptions.config }),
  });
  if (load.ok === false) return { ok: false, reason: 'config', issues: load.issues };
  if (load.loaded.config.region.bounds === null) {
    return {
      ok: false,
      reason: 'no-region-bounds',
      detail: 'the region block carries no bounds; there is no production region asset to fall back on (D5)',
    };
  }

  const rooms: Record<string, RegisteredHandler> = {
    // The operator channel is authenticated inside the room module (join-validation's rule
    // generalised: nothing a client can put in create options configures a room).
    region: defineOperatorRegionRoom(options.roomOptions ?? {}),
  };
  const httpServer = createServer();
  const transport = new WebSocketTransport({ server: httpServer });
  const server = defineServer({ rooms, transport });
  await server.serverless();
  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((listening, failure) => {
    httpServer.once('error', failure);
    httpServer.listen(0, host, () => {
      httpServer.off('error', failure);
      listening();
    });
  });
  const address = httpServer.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the region server did not bind a TCP port');
  }

  return {
    ok: true,
    server: {
      port: (address as AddressInfo).port,
      endpoint: `ws://${host}:${String((address as AddressInfo).port)}`,
      configHash: load.loaded.configHash,
      async close(): Promise<void> {
        await server.gracefullyShutdown(false);
        await new Promise<void>((closed) => {
          httpServer.close(() => {
            closed();
          });
        });
      },
    },
  };
};

/** Direct-execution boot. `import` of this module never runs it. */
async function main(): Promise<void> {
  const started = await startRegionServer({ roomOptions: {} });
  if (started.ok === false) {
    process.stderr.write(`region server refused: ${started.reason}\n`);
    if ('issues' in started) for (const issue of started.issues) process.stderr.write(`  ${issue}\n`);
    if ('detail' in started) process.stderr.write(`  ${started.detail}\n`);
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`region server listening ${started.server.endpoint} configHash ${started.server.configHash}\n`);
}

if (process.argv[1] !== undefined && (process.argv[1].endsWith('main.js') || process.argv[1].endsWith('main.ts'))) {
  void main();
}
