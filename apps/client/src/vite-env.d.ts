/// <reference types="vite/client" />

/**
 * Why this file exists, and why it is the only ambient reference in the workspace.
 *
 * `main.tsx` asks `import.meta.env.DEV` whether it is running in a development build, which is the switch that
 * keeps the local test poses and the mount/unmount seam out of the served bundle. Under `types: []` — the
 * accepted ambient-type policy, which `tests/contracts/UDG-001.test.ts` 'compiler.ambientTypePolicy' enforces
 * on every workspace's `tsconfig.json` — TypeScript has no declaration for `import.meta.env` at all, so the
 * two uses in `main.tsx` fail with `TS2339: Property 'env' does not exist on type 'ImportMeta'`.
 *
 * Two ways out, measured rather than guessed:
 *
 * - this line, Vite's own client-type reference;
 * - a hand-written `interface ImportMeta { readonly env: … }` in this file.
 *
 * The reference wins, for the same reason the pin list refuses `@webgpu/types`: a hand-written lookalike of a
 * vendor's declarations is a claim about that vendor that nothing checks. `skipLibCheck: false` is inherited
 * unchanged from `tsconfig.base.json`, and `vite/client` was measured against this workspace's own compiler
 * settings — DOM library, `types: []`, strict, 8.56.2 Babylon and React 19.3.1 in the same program — at
 * **0 diagnostics**, so the vendor's declarations are being read here rather than waved past. What this file
 * does *not* do is edit `tsconfig.json`: the accepted policy is about configuration, and a per-file reference
 * keeps the surface exactly one file wide.
 *
 * Both client projects include this file: `tsconfig.json` for the emitted library, `tsconfig.tools.json` for
 * `main.tsx` and `src/dev/**`, which are typechecked but never emitted.
 */

/**
 * The one environment variable this client reads, declared rather than reached through the index signature.
 *
 * This declaration is load-bearing for a reason that is invisible until you diff the built output. Vite's
 * `envPrefix` handling gives `import.meta.env` an index signature for `VITE_*` keys, and the repository
 * compiler policy (`noPropertyAccessFromIndexSignature`) therefore pushes a reader into
 * `import.meta.env['VITE_UDG_SERVER_URL']`. Bracket access on that object makes the whole `import.meta.env`
 * record a *runtime* value in the bundle, and a runtime record defeats the constant folding that
 * `import.meta.env.DEV` depends on: measured on this workspace with vite 8.3.6, a production build with the
 * bracket form still emitted `assets/lifecycleHarness-<hash>.js`, development seam and all, while the same
 * build with the member form emitted neither the chunk nor the `DEV` test at all.
 *
 * So the variable is declared here, the read in `main.tsx` is a member access, and
 * `tests/contracts/UDG-004.test.ts` byte-scans every file under `apps/client/dist` for the seam tokens to keep
 * it that way. The compiler policy is not relaxed, the vendor's declarations are not replaced, and the seam's
 * absence is a checked fact rather than a property of a bundler's mood.
 */
interface ImportMetaEnv {
  readonly VITE_UDG_SERVER_URL?: string;
}
