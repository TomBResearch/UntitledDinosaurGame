import { defineConfig, type Plugin } from 'vite';

/**
 * Vite configuration for the @udg/client browser application (UDG-004).
 *
 * ## Bind address is an opt-in, and the default is loopback
 *
 * `UDG_DEV_HOST` is the single variable that changes what this server binds to, and it is unset in the
 * repository (`.env.example` documents it and says what any other value means). Unset means `127.0.0.1`,
 * which is the container's own loopback: reachable inside the container, unreachable through a published
 * Docker port, and unreachable from anything else on the network. That is the safe default the repository
 * contract asks of a development server (docs/contracts/repository.md 3.2, and `.env.example` carries the
 * same rule for `UDG_HOST`).
 *
 * A developer on the Mac previews the scene through a host-loopback port mapping
 * (`-p 127.0.0.1:5173:5173`), and Docker's proxy connects to the container's *bridge* address, not to the
 * container's loopback. That is the only reason `UDG_DEV_HOST=0.0.0.0` exists, and it is why the preview
 * container is a deliberate choice rather than a default — so any value that is not loopback prints a
 * warning naming the interface it just exposed. docs/contracts/assignments/UDG-004.md §7 records the route,
 * including the host-side checks that confirm it.
 *
 * ## Port 5173 with strictPort
 *
 * 5173 is the repository contract (`.env.example`, README, and the accepted UDG-001 assertion over both
 * values). `strictPort: true` is what turns "the port is taken" into a refusal instead of a silent slide to
 * 5174, which would otherwise move the URL the reviewer was told to open and the address the browser suite
 * connects to. Measured: a second server against this config exits with
 * `Error: Port 5173 is already in use` rather than picking another port.
 *
 * ## Two outputs, and why the dev-only seam is in neither browser artefact twice
 *
 * `tsc -p tsconfig.json` emits the workspace's library-shaped `dist/` (which is what the package manifest's
 * `./dist/index.js` names) and excludes `src/dev/**`. `vite build` emits the served application to
 * `dist/app/`. Neither contains `apps/client/src/dev/lifecycleHarness.ts`, and
 * `tests/contracts/UDG-004.test.ts` byte-scans both trees for `__udgClientHarness` and `lifecycleHarness`
 * rather than trusting this comment.
 */

/** Binds that stay on this machine. Anything else is an exposure and says so. */
const LOOPBACK_BINDS: readonly string[] = ['127.0.0.1', 'localhost', '::1', '[::1]'];

const requestedHost = process.env['UDG_DEV_HOST'] ?? '127.0.0.1';
const requestedPort = process.env['UDG_CLIENT_PORT'] ?? '5173';
const port = Number(requestedPort);

if (!Number.isInteger(port) || port === undefined || port < 1 || port > 65_535) {
  throw new Error(
    `UDG_CLIENT_PORT must be an integer between 1 and 65535; received ${String(requestedPort)}. `
      + 'The repository contract for the client port is 5173.',
  );
}

const isLoopback = (LOOPBACK_BINDS as readonly string[]).includes(requestedHost);

if (!isLoopback) {
  // Deliberately loud: this is the line that tells the operator the dev server is reachable off this
  // machine, which is what the preview container's published port depends on.
  console.warn(
    `UDG-004 dev server: UDG_DEV_HOST=${requestedHost} binds beyond loopback, so the scene and its source maps `
      + 'are reachable from every interface this host exposes. Unset UDG_DEV_HOST to return to 127.0.0.1. '
      + 'docs/contracts/assignments/UDG-004.md §7 is the documented preview route.',
  );
}

/**
 * The ready signal the README and the acceptance checks read.
 *
 * Vite's own banner prints `Local:`/`Network:` lines whose shape is Vite's business; this line is ours, it
 * names the port the server actually bound, and it is printed after the listener exists so `curl` against it
 * cannot race the startup.
 */
const readySignal = (): Plugin => ({
  name: 'udg-client-ready',
  configureServer(server) {
    const httpServer = server.httpServer;
    if (httpServer === null) return;
    httpServer.once('listening', () => {
      const actual = server.config.server.port;
      const bound = httpServer.address();
      const detail = typeof bound === 'object' && bound !== null ? `${String(bound.address)}:${String(bound.port)}` : 'unknown';
      process.stdout.write(
        `UDG_CLIENT_READY port=${String(actual)} bind=${requestedHost} listening=${detail} `
          + `url=http://127.0.0.1:${String(actual)}/ loopback=${String(isLoopback)}\n`,
      );
    });
  },
  configurePreviewServer(server) {
    const httpServer = server.httpServer;
    if (httpServer === null) return;
    httpServer.once('listening', () => {
      process.stdout.write(`UDG_CLIENT_READY preview=true port=${String(server.config.preview.port)}\n`);
    });
  },
});

export default defineConfig({
  // Relative asset URLs, so the built application can be served from any prefix — including the
  // throwaway loopback server the browser suite starts to prove the development seam is absent.
  base: './',
  server: {
    host: requestedHost,
    port,
    strictPort: true,
  },
  preview: {
    host: requestedHost,
    port,
    strictPort: true,
  },
  build: {
    outDir: 'dist/app',
    emptyOutDir: true,
    target: 'es2022',
    // Production source maps would re-introduce the development seam as original source text: with
    // `sourcemap: true` the built bundle stayed clean while its `.map` still carried
    // `dev/lifecycleHarness.ts`, which makes "absent from the production build" a sentence about some of the
    // shipped bytes rather than all of them. The development server serves original modules and loses nothing.
    sourcemap: false,
  },
  plugins: [readySignal()],
});
