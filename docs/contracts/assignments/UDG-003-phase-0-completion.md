# UDG-003 Phase 0 — completion record (submitted for review)

- Task: [UDG-003](../UDG-003.md), Phase 0 only, assigned in
  [UDG-003-phase-0.md](UDG-003-phase-0.md) after owner decisions D-1…D-7 recorded in
  [adoption.md](../adoption.md).
- Implementation status submitted: **In Review**. Phases 1–3 remain unassigned and untouched. No gate
  moved: Gate A, B and C stay **Not Run**, and no spike gate is claimed.
- Basis reviewed by the owner: readiness proposal revision 3 at `df59e540fc880b41a599c33c97e34fab4d7d7fa9`;
  adoption and this assignment pinned at `1e9bd1b`.
- Head under review: recorded in the review commit range below; the CI run cited is the run of this
  record's commit.

## 1. What Phase 0 was, in one paragraph

Install the provisional pins, find out what the public API actually does, and report. Six probes
(`PR-0`, `PR-1`, `PR-2`, `PR-3`, `PR-8`, `PR-12`) run against a real server and a real SDK client on
loopback. Nothing in `apps/server/src` gained behaviour: it is still `export {};`. The deliverables are
the [api map](../../integration/colyseus-0.18-api-map.md), the resolved dependency graph, the probe
results, the two blockers, and the acknowledgement evidence the owner needs for **D-7**.

## 2. Return: API map, resolved graph, probe results

### 2.1 API map

[docs/integration/colyseus-0.18-api-map.md](../../integration/colyseus-0.18-api-map.md) — one row per
API with package/version, import path, declaration file and symbol, probe module, runtime test id,
recorded result and limitations, plus a probe index and the PH0-B1 inventory. Rows marked *not
exercised* say so; `validate` from core is the only such row.

### 2.2 Exact resolved dependency graph

Declared by `apps/server` (all exact): `@colyseus/core@0.18.27`, `@colyseus/sdk@0.18.9`,
`@colyseus/ws-transport@0.18.4`, `@udg/protocol` (workspace), plus dev `@types/express@5.0.4`,
`@types/debug@4.1.12` (added because core imports both untyped — a dependency decision, not a policy
change). `@colyseus/schema@5.0.45` stays declared by `packages/protocol`, which is the only workspace
that imports it.

| Fact | Recorded value |
| --- | --- |
| Lockfile SHA-256 | `bbfe68e33a072ecbd1974fe32f54e1a238d0f697737320ba554eceae8dd0777d` (was `899e6f4d18930cb2…` before Phase 0) |
| `@colyseus/schema` copies | one directory for `@udg/protocol`, core, sdk and ws-transport; lockfile lists `5.0.45` only |
| Transitive runtime packages | `express@5.3.0`, `ws@8.22.2`, `msgpackr@2.1.4`, `debug@4.4.3`, `@colyseus/shared-types@0.18.3`, `@colyseus/better-call@1.3.3`, `nanoid`, `@colyseus/timer`, `@standard-schema/spec`, `tslib`, `msgpackr-extract@3.0.7` |
| Peer shape | `@colyseus/schema` is a **required peer of core**; `express` is a **required peer of the transport** and optional for core |
| Visibility | `express`, `msgpackr` and `@colyseus/schema` do **not** resolve from `apps/server` with ambient module paths removed — the UDG-001 boundary rule holds mechanically |
| Licences | MIT for every third-party package in the graph; workspace packages stay `UNLICENSED` and are recorded as observations, not as pin gates |
| Build scripts | none allowed; `msgpackr-extract` denied by name (§4) |

The register was regenerated with `pnpm dependencies:record` (never hand-edited) and
`pnpm dependencies:verify` confirms it against the installed graph. `@colyseus/core`, `@colyseus/sdk`
and `@colyseus/ws-transport` are now `selected` under owner task UDG-003; `@colyseus/testing` remains
`not-selected` per D-3.

### 2.3 Probe results

Every row is a command that ran, with the exit status it produced. The suite
(`pnpm test:contract -- --task UDG-003`) emits, executes and then re-reads these files, so the numbers
below are reproduced in CI rather than quoted.

| Probe | Command (from `artifacts/probes/probe-run-index.json`) | Exit | Checks | Outcome |
| --- | --- | --- | --- | --- |
| `PR-0` | `node apps/server/probes/dist/probes/pr0-compile.probe.js --out artifacts/probes/PR-0.probe-result.json` | 0 | 39 | passes its own assertions; the **compile** of the probe project fails with 27 third-party diagnostics → **PH0-B1** |
| `PR-1` | `node apps/server/probes/dist/probes/pr1-graph.probe.js --out artifacts/probes/PR-1.probe-result.json` | 0 | 43 | passes |
| `PR-2` | `node apps/server/probes/dist/probes/pr2-fixed-step.probe.js --out artifacts/probes/PR-2.probe-result.json` | 0 | 7 | passes |
| `PR-3` | `node apps/server/probes/dist/probes/pr3-input-schema.probe.js --out artifacts/probes/PR-3.probe-result.json` | 0 | 10 | passes |
| `PR-8` | `node apps/server/probes/dist/probes/pr8-ack.probe.js --out artifacts/probes/PR-8.probe-result.json` | 0 | 7 | passes |
| `PR-12` | `node apps/server/probes/dist/probes/pr12-epoch.probe.js --out artifacts/probes/PR-12.probe-result.json` | 0 | 6 | passes |

Emit and typecheck commands, recorded verbatim because the difference matters:

```text
emit      node <typescript>/bin/tsc -p tsconfig.probes.json --noCheck    exit 0
typecheck node <typescript>/bin/tsc -p tsconfig.probes.json --noEmit     exit 2, 27 diagnostics
```

Substance worth reading in the api map rather than here: the fixed step is exact (`dt` is `0.05` in
every step, 19.65 Hz observed, and the step context offers **no** measured wall-clock delta); the
adopted five-field input declaration is the one the room uses; the wire codec silently truncates
out-of-domain integers (`2³²+7` → `7`) and turns `NaN` into `null`, and `validateDirectFrame` refuses
the result with `INVALID_PAYLOAD`; reconnection works and **preserves** identity, which is the opposite
of epoch renewal.

### 2.4 PR-8 and D-7

The acknowledgement tracks **consumption**, not application: three frames received leave it at 0; one
consumed frame moves it to 1; a frame that is consumed and then **refused** by the application also
moves it to 1; frames dropped by a full buffer are never acknowledged; a synthesised idle frame never
moves either counter. No member of `InputHandle` (13 members recorded) can withhold or retract an
acknowledgement.

That is the complete answer PR-8 can give. **D-7 remains the owner's decision** and nothing here waives
the prohibition that a frame never represented in state must not be acknowledged; if the owner wants
that guarantee honoured literally, the application journal — not this counter — has to carry it, which
is what readiness §2.4 anticipated.

## 3. Blockers

**PH0-B1 — the pinned declarations do not typecheck (blocks Phase 1).** 27 diagnostics, none in
repository code: 22 × `TS2304 Cannot find name 'HeadersInit'` in `@colyseus/better-call@1.3.3`
(`context.d.mts`, `endpoint.d.mts`, `error.d.mts`) and `@colyseus/sdk@0.18.9` (`HTTP.d.ts`);
2 × `TS2344` in the same `HTTP.d.ts` (a generic constraint its own declaration does not satisfy under
TypeScript 5.9.3); 2 × `TS1192 Module '"http"' has no default export` in `@colyseus/core`
(`build/router/node.d.ts`) and `@colyseus/ws-transport` (`build/WebSocketTransport.d.ts`). Three causes,
three owner remedies, all recorded in the api map §5: load the DOM library (forbidden for a Node
workspace by UDG-001), enable `allowSyntheticDefaultImports` (a policy widening), or change pins; the
`TS2344` class is not addressable by any flag except the forbidden `skipLibCheck`. The UDG-003 suite
**pins the inventory in both directions** and asserts that `skipLibCheck`,
`allowSyntheticDefaultImports`, `noImplicitAny`, `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess` and `esModuleInterop` are unset in the probe project, so this cannot be
quietly widened away and cannot silently change shape when the pins move.

**PH0-B2 — no epoch concept in the pinned set.** The only `epoch` declaration in core or sdk is
`InputHandle.epoch`, a client-side reset counter that has nothing to do with a session; reconnection
deliberately preserves the session identity. UDG must own epoch renewal at join time, which the
readiness proposal already assumed but PR-12 now proves rather than assumes.

**D-7 — open**, decided from §2.4. **D4 (independent evidence backup) remains undesignated**; the
retention incident `RETENTION-2026-11-09-01` still stands and this Phase 0 created no new release, tag
or storage location.

## 4. Supply-chain decision taken during install

`pnpm install` aborted with `ERR_PNPM_IGNORED_BUILDS` for `msgpackr-extract@3.0.7`: pnpm 12 denies
dependency build scripts by default and the previous `onlyBuiltDependencies` list in
`pnpm-workspace.yaml` is silently ignored by that version. The workspace now records an explicit denial
(`allowBuilds: msgpackr-extract: false`), so **no dependency build script runs**, and the pure-JavaScript
`msgpackr` decoder is what the probes exercised. PR-1 asserts the denial by name. Allowing the native
addon is a separate owner decision (amendment A-11 of the assignment) and would need its own evidence.

## 5. Commands run locally, with results

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | exit 0, no lockfile mutation |
| `pnpm typecheck` | exit 0 — all populated workspaces; the probe project is checked by `pnpm --filter @udg/server typecheck:probes`, which exits 2 with the PH0-B1 inventory the suite pins |
| `pnpm lint` | exit 0 — `boundary check OK: 48 file(s), 0 violations, rule table 818c63d5b12f` |
| `pnpm test` | exit 0 — `Tests 350 passed (350)` (was 316 before Phase 0) |
| `pnpm test:contract -- --task UDG-001` | exit 0 — 49 passed |
| `pnpm test:contract -- --task UDG-002` | exit 0 — 31 passed |
| `pnpm test:contract -- --task UDG-003` | exit 0 — 34 passed, six probes executed from emitted JavaScript |
| `pnpm test:boundaries` | exit 0 — 48 files, 0 violations, rule-table digest unchanged |
| `pnpm test:fixtures` | exit 0 |
| `pnpm contracts:checksums` | in sync after this record was added |
| `pnpm dependencies:verify` | `docs/integration/dependencies.json matches the installed dependency graph` |
| `pnpm --filter @udg/server typecheck:probes` | **exit 2** — the PH0-B1 inventory; reported, not suppressed |

## 6. Deviations and amendments actually applied

Every one of these stays inside the paths the assignment allowed; none widens functional scope, and
`@udg/server` still exports nothing.

| id | File | Change and reason |
| --- | --- | --- |
| A-1 | `tests/contracts/UDG-001.test.ts` | deferred-library absence is now derived from the register's not-selected groups instead of a hard-coded list that named core/sdk as forbidden, and the "one owner per selected group" count became "every selected group has one owner that is a started task" — UDG-003 legitimately owns three packages |
| A-2 | `tools/checks/src/evidence.ts` | deferred-group ownership and reasons updated for D-2/D-3, plus a `@colyseus/ws-transport` group so the transport is owned rather than implicit |
| A-3 | `apps/server/package.json` | `typecheck` covers first-party source; `typecheck:probes` is the raw strict check that currently fails with PH0-B1; `build:probes` and `build` emit with `--noCheck`. The split keeps the failure visible on a named command instead of hiding it, and `--noCheck` never appears in a tsconfig — the suite asserts that |
| A-4 | `.github/workflows/ci.yml` | one probe step with `UDG_PROBE_OUT=artifacts/probes`, and `artifacts/probes` added to the uploaded paths; evidence-step invariants untouched, and the UDG-001 suite still validates this file |
| A-5 | `pnpm-workspace.yaml` | explicit `allowBuilds: msgpackr-extract: false` (§4) |
| A-6 | `apps/server/package.json`, `pnpm-lock.yaml` | `@types/express@5.0.4`, `@types/debug@4.1.12` added as dev dependencies because core imports both untyped |
| A-7 | `docs/integration/README.md` | index entry for the api map |

## 7. What Phase 0 did not do

- No Phase 1: no room, authority, admission, queue or journal code; `apps/server/src/index.ts` is still
  `export {};`.
- No prediction, rollback or reconciliation claim; `@colyseus/sdk` is present only as the D-3 transport
  smoke client, and UDG-SPIKE-001 still owns prediction validation.
- No pins promoted from *provisional candidate*; `@colyseus/testing` still unselected.
- No gate: Gate A/B/C **Not Run**, ADR 0001 widths still provisional, no spike gate claimed.
- No release, tag, archive or storage location created, deleted or replaced (retention clarification).
- Nothing self-accepted: this record submits Phase 0 for review.

## 8. Decisions the owner still owes

1. **PH0-B1 remedy** — DOM library, `allowSyntheticDefaultImports`, a pin change, or an upstream fix.
   Phase 1 should not be assigned before this, because the probe project is the compiler's proof of the
   room's API usage.
2. **D-7** — from §2.4.
3. **D4** — an independent evidence backup destination.
4. Whether Phase 1 proceeds on these pins once PH0-B1 is resolved, or on a re-pinned set.
