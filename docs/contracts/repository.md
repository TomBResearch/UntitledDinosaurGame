# Repository and command contract

> Source: UDG-CONTRACTS-M0-001 v1.0, section 3. Repository edition 1. Shared requirements are authoritative here; task files link to them.

### 3.1 Root layout

Root files owned by UDG-001 are package.json, pnpm-workspace.yaml, pnpm-lock.yaml, tsconfig.base.json, eslint.config.mjs, vitest.config.ts, playwright.config.ts, .node-version, .npmrc, .gitignore, .env.example, README.md and .github/workflows/ci.yml. Shared tools are tools/checks/src/{boundaries,fixtures,evidence}.ts and tools/checks/package.json. Documentation lives in docs/contracts/, docs/adr/ and docs/integration/. Generated evidence lives under artifacts/ and is excluded from source commits except immutable summaries explicitly approved for retention.

Each workspace uses an @udg/ name matching its leaf directory, owns package.json and tsconfig.json, and exports src/index.ts through its build. ESM is the proposed module baseline. Apps are @udg/server and @udg/client; packages are @udg/protocol, @udg/config, @udg/simulation, @udg/physics and @udg/navigation. Tool workspaces are @udg/checks, @udg/asset-pipeline and @udg/load-test. Empty future workspaces must not pretend to implement functionality.

Use a repository-pinned supported Node LTS release and exact pnpm version. UDG-001 resolves and records actual versions; no placeholder version may remain when Verified. Pin direct dependencies exactly without ^, ~ or latest, retain integrity information in the lockfile, and record the Colyseus server, SDK, schema and testing versions as a tested compatibility set. Matching major/minor strings alone do not prove compatibility. Rapier and Recast versions and WASM hashes are added at their tasks. Runtime installation begins with separately assigned UDG-001; this planning bundle contains no package installation or game implementation.

### 3.2 Commands to be implemented by assigned tasks

The following commands are proposed repository scripts, not commands claimed to exist today. Run them from this repository root after the owning task has created them. UDG-001 creates a dispatcher that fails clearly for unavailable suites; it must never treat a missing suite or zero discovered tests as success. Later tasks populate their suites.

| Command | Required meaning |
| --- | --- |
| pnpm install --frozen-lockfile | Install the committed dependency graph without mutation |
| pnpm typecheck | Strict no-emit checks for every populated workspace and compile probe |
| pnpm lint | Source lint plus forbidden import and cycle checks |
| pnpm test | All populated unit and Node integration suites, no zero-test pass |
| pnpm build | Build shared libraries, tools and both apps from a clean output directory |
| pnpm test:boundaries | Positive and deliberately invalid dependency fixtures |
| pnpm test:fixtures | Validate all currently owned fixture schemas and manifest hashes |
| pnpm test:contract -- --task UDG-002 | Task-specific suite; accepts every task ID in this contracts edition |
| pnpm test:e2e -- --suite camera | Browser suite; camera, netcode, physics, input or hybrid |
| pnpm test:spike -- --id UDG-SPIKE-001 --profile elevated --seed 1001 | Reproducible spike runner and evidence capture |
| pnpm assets:build -- --region region-greybox-001 | Offline deterministic asset generation |
| pnpm assets:verify -- --region region-greybox-001 | Validate format, all content hashes and compatibility |
| pnpm evidence:verify -- --run artifacts/RUN_ID | Verify report schema, nonempty results and referenced artifact hashes |

Root pnpm typecheck, pnpm lint, pnpm test and pnpm build are required for every task. Task-specific commands supplement them. README.md must state supported OS prerequisites, exact install/run commands, ports, shutdown and expected ready signals. CI runs these same scripts with a locked installation and publishes logs and machine-readable results even on failure. Evidence verification must fail if a required suite is skipped, absent, quarantined, flaky on rerun or silently excluded.

### 3.3 Test and script implementation paths

tools/checks/src/run-contract.ts dispatches to tests/contracts/TASK_ID.test.ts. tools/load-test/src/run-spike.ts dispatches to tests/spikes/spike-001.test.ts, spike-002.test.ts and spike-003.test.ts. Browser suites live in tests/e2e/{camera,netcode,physics,input,hybrid}.spec.ts. tasks add exact pnpm scripts to the root manifest through maintainer-reviewed edits. Gate A introduces the minimum load-test harness; this does not claim UDG-011 complete.
