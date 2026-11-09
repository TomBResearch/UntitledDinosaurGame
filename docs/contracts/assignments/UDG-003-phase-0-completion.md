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

> **Superseded on one point — kept visible rather than deleted.** The clause "frames dropped by a full
> buffer are never acknowledged" is **wrong**. The corrected probe traces frame identities and shows the
> opposite: overflow eviction advances `consumedCount`, so the evicted frames *are* retired by the
> acknowledgement while never being represented in state. The original bundle
> (`ci-run-42678254682`) is retained unchanged in the durable store, and the probe result now carries the
> superseded reading explicitly under `S4_supersededFirstReading`. See
> [§9.2](#92-pr-8-corrected-the-first-s4-reading-was-wrong). Everything else in this section stands.

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

**PH0-B2 — no epoch concept in the pinned set.** *Reclassified in
[§9.5](#95-ph0-b2-reclassified-the-session-epoch-is-udg-owned): this is a design obligation on UDG, not a
blocker and not a library defect.* The only `epoch` declaration in core or sdk is
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

## 5b. CI runs on `main`

| Run | Head | Result | What it proves |
| --- | --- | --- | --- |
| [42676201677](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/42676201677) | `b32bf114` | **fail** — `drift detected: docs/contracts/checksums.json (59 file(s), 1 change(s))` | the checksum gate caught a real omission: the new api map had no manifest entry. Bundle `UDG-001-2026-11-09T18-42-24-484Z-b32bf114` verifies as internally consistent with `EVIDENCE-GATE-NOT-PASS`, which is the required behaviour for a failing gate |
| [42677043247](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/42677043247) | `e52a97c1` | **fail** — probe step only | `UDG_PROBE_OUT=artifacts/probes` is relative while each probe runs with `apps/server` as its working directory, so the suite looked in one directory and the probes wrote another. `pnpm test` in the same run passed, which is how the difference was isolated. UDG-001 and UDG-002 bundles from this run verify PASS |
| [42678254682](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/42678254682) | `673e2dd3` | **success**, 23 steps, 0 failed | the submitted state. The probe step reproduced the local numbers exactly: `PR-0` 39 checks, `PR-1` 43, `PR-2` 7, `PR-3` 10, `PR-8` 7, `PR-12` 6, all exit 0, and the probe-project typecheck exit 2 with the same 27 diagnostics pinned as PH0-B1 |

Evidence retained in the host store `/workspace/udg-evidence` as `ci-run-42676201677`,
`ci-run-42677043247` and `ci-run-42678254682`, each with its bundles, `probes/` result directory and
runner log. Both bundles of the successful run verify with zero issues. No release, tag or new storage
location was created for Phase 0, and **D4 remains open**.

This section is a documentation-only follow-up to `673e2dd3`. It changes only this file: the checksum
manifest covers the contract corpus, not `assignments/`, so `pnpm contracts:checksums` reports no drift
here. It reports the runs above rather than a new one.

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
2. **D-7** — from §2.4 as corrected by [§9.2](#92-pr-8-corrected-the-first-s4-reading-was-wrong).
3. **D4** — an independent evidence backup destination.
4. Whether Phase 1 proceeds on these pins once PH0-B1 is resolved, or on a re-pinned set.

## 9. Revision 2 — reviewer corrections (resubmission)

The owner reviewed the submission above on 2026-11-09 and **did not accept the candidate stack as
compatible** and **did not authorise Phase 1**. Five corrections were requested; all five are applied
here. Nothing was adopted that needed approval: no pin changed, no compiler flag changed, no shim or
package patch was added, no Phase 1 code exists, and no release, tag, archive or storage location was
touched. `apps/server/src/index.ts` is still `export {};`.

### 9.1 Compiler status is now stated separately

Strict probe typechecking exits non-zero, so **PR-0 is blocked, not successful**. A suite that reproduces
the compiler's errors is evidence *about* the failure. The status is now reported in three places and
asserted in the suite:

| Surface | What it now says |
| --- | --- |
| api map [§0](../../integration/colyseus-0.18-api-map.md) | three separate rows: strict typecheck (**BLOCKED**, exit 2, 27 diagnostics, 0 in repository code), `--noCheck` emission (diagnostic only), and `stackCompatibility: not-established` |
| `artifacts/probes/compatibility-verdict.json` | machine-readable: `stackCompatibility`, `pr0`, `strictTypecheckExitCode`, diagnostic split, `acceptedBuildPath`, `diagnosticEmission`, per-probe verdicts |
| `probe-run-index.json` and every `PR-*.probe-result.json` | a `verdict` field — `pass`, `fail` or **`blocked`** — plus `blockedReason`; `ok` stays `false` when blocked, so CI cannot read it as green |
| CI summary | the probe step names both purposes: `--noCheck` emission is "diagnostic emission only", the strict typecheck is "the accepted compiler gate" |

Supporting changes: `CheckList.block()` in `apps/server/probes/support.ts` records a blocked verdict **and**
a failing check, so a reader who only inspects checks still sees the failure; PR-0 receives the strict
typecheck report through `--typecheck-report` (it cannot observe the exit status of the command that built
it) and **fails closed** if the report is missing; and `--noCheck` has been removed from the package
`build` script, so the accepted build path is fully typechecked and unchecked probe JavaScript is produced
only by the harness for measurement.

Probe outcomes for this revision: `PR-0` **blocked** (43 checks, `ok: false`), `PR-1` 43, `PR-2` 7,
`PR-3` 10, `PR-8` 15, `PR-12` 6 — the five behaviour probes pass **on their own terms**, which is not a
compatibility claim.

### 9.2 PR-8 corrected: the first S4 reading was wrong

The old assertion was `clientLastProcessed + bufferSize < clientSent`, i.e. `4 + 2 < 6`. That is false
precisely because every frame was accounted for, and the declaration says overflow counts as consumed.
The probe now traces **identities**: each frame carries a distinct `generation`, each `send()` returns the
`seq` the acknowledgement retires, and the room logs every step it represented (`frame` / `neutral`).

| Scenario | Identity-level observation |
| --- | --- |
| S1 3 sent, none consumed | generations `1,2,3` at seqs `1,2,3` buffered; `consumedCount 0`; `lastProcessed 0`; no step |
| S2 consume 1, apply it | watermark `1` retires **exactly generation 1**; room logged `frame:1`; `2,3` pending |
| S3 consume 1, **refuse** it | `consumedCount 1`, `lastProcessed 1` — refusal invisible to the ack; room still stepped `neutral:1`, so **state advanced** |
| S4 `bufferMaxSize 2`, 6 sent, nothing consumed | holds `5,6`; `consumedCount 4`; `lastProcessed 4`; `pendingCount 2 = 6 − 4`; watermark retires `1,2,3,4`; those four are **dropped** (no step at all); `handle.at(seq)` is `undefined` for every `seq <= 4`, so the client prunes them **without knowing they were dropped** |
| S5 synthesised idle | `wasIdle true`; both counters stay `0` |

The acknowledgement is therefore **a sequence watermark over the send order**, equal to the server
buffer's `consumedCount`, retiring a prefix and carrying no per-frame disposition. New probes of the
mechanism itself: `S4-ack-is-a-sequence-watermark-not-a-per-frame-disposition`,
`S4-dropped-frames-ARE-retired-by-the-ack`, `S4-dropped-frames-are-never-represented-in-state`,
`S4-client-prunes-dropped-frames-without-knowing-they-were-dropped`, and
`S4-ack-value-is-not-observable-through-the-public-room-accessor` (`ackSeq` is declared only on the
internal `InputBuffer`, so a room cannot read the ack it is causing).

**Rejected vs dropped is now separated explicitly**, which the acknowledgement itself cannot do:

| | represented in state | retired by the ack | client can tell |
| --- | --- | --- | --- |
| applied | yes, with its intent | yes | no |
| refused | yes — an authoritative **neutral** step replaced the intent | yes | no |
| dropped (overflow) | **no step at all** | yes | no |

**An application journal is not proof of client reconciliation**, and the probe now says so: the journal
shows what the server stepped, while the client prunes on the watermark alone and is never told to stop
predicting from a retired frame. Convergence proof stays with UDG-SPIKE-001. **D-7 remains open**, and
`d7Answer` now answers "no, not by itself" with the identity evidence attached.

### 9.3 `client as never` removed, and the bypass is now banned

`apps/server/probes/rooms.ts` types the callbacks with the declared client type
(`import { type Client as ServerClient } from '@colyseus/core'`; `onLeave(client: ServerClient, code?)`,
`onJoin`, `onDrop`), and `allowReconnection(client, 10)` receives it uncast. PR-0's escape-hatch scan gained
a `never-cast` pattern (`as never` satisfies any parameter type and would hide exactly the signature
mismatch PR-0 exists to report) plus `as unknown` and a **code-aware** scan: comments and string literals
are stripped first, so quoting a declaration path or writing the words "as never" while banning them is no
longer reported as an offender. `tests/contracts/UDG-003.test.ts` mirrors the strip and asserts the typed
callback, the absence of the cast, and that PR-0 bans the pattern.

### 9.4 PH0-B1 remedy investigation (measured; nothing adopted)

Classification first — two type-environment mismatches and one upstream defect:

| Class | Count | Nature | Reachable by configuration |
| --- | --- | --- | --- |
| A — `HeadersInit` not found | 23 (`TS2304`) | declarations use the **DOM lib global**; `@types/node@24.19.2` exposes `Headers` globally but not `HeadersInit`; `undici-types@7.24.6` exports it as a module member and is not importable from `apps/server` (`TS2307`) | only via DOM globals or a hand-declared global |
| B — `Module '"http"' has no default export` | 2 (`TS1192`) | the libraries default-import a Node builtin in their own `.d.ts` files | only by relaxing the interop policy |
| C — `UnionToIntersection<MethodOptions<API, "DELETE">>` | 2 (`TS2344`) | **defect inside `@colyseus/sdk`'s own published types** | **no** — nothing but `skipLibCheck` |

Version investigation (registry metadata and published tarballs read in `/tmp`; nothing installed, no
lockfile change): `@colyseus/core@0.18.27`, `sdk@0.18.9`, `ws-transport@0.18.4`, `better-call@1.3.3` are
**all the latest published versions**, and the defects are present in every published candidate
(`core 0.18.20–0.18.27` all depend on `better-call@^1.3.1`; `sdk 0.18.6–0.18.9` all carry A and C;
`ws-transport 0.18.2–0.18.4` all default-import `http`; `better-call 1.2.1–1.3.3` all use `HeadersInit`).
TypeScript is not a route either: `5.8.3` reproduces all 27; `6.0.3`/`7.0.2` give 25 and **cannot read the
repository config** (`TS5107`/`TS5108`: `esModuleInterop=false` is deprecated in 6, removed in 7), so an
upgrade buys nothing except by surrendering a non-relaxable setting.

Measured variants (scratch configs outside the repository, one variable at a time, TS 5.9.3):

| Variant | Diagnostics | Cost |
| --- | --- | --- |
| as committed | 27 | — |
| `lib: ["ES2024","DOM"]` | 4 | DOM globals become legal in Node code — demonstrated: `window.innerWidth` and `fetch` compile clean with DOM, `window` errors as committed |
| `allowSyntheticDefaultImports: true` | 25 | permits default-importing modules with no default export |
| ambient `HeadersInit` global only | 4 | a hand-declared global; no DOM, no suppression, but still an assertion about someone else's emission |
| shim **+** synthetic defaults | **2** | **the floor short of `skipLibCheck`; class C survives** |
| `skipLibCheck: true` | 0 (exit 0) | hides every third-party type error, including the next one that matters to UDG |

**Recommendation: R0 — keep PH0-B1 open, change nothing**, hold `not-established`, leave Phase 1
unassigned, and open the three upstream items (DOM-independent declarations for a Node target; the
`@colyseus/sdk` constraint; default-importing `node:http`). The pinned inventory makes any upstream fix a
loud event. If the owner wants the noise reduced, **R1** (probe-project-only ambient `HeadersInit`, 27 → 4)
and **R2** (probe-project-only `allowSyntheticDefaultImports`, 27 → 25) are the narrow options and are
described precisely in api map §5.3–5.4; both are harmless to the runtime but **neither makes PR-0 pass**.
**Rejected:** `lib: DOM` (second global namespace in Node code), `skipLibCheck` (destroys the instrument),
and patching/vendoring a dependency's declarations (the register would describe a package that no longer
matches its pinned tarball). The decisive fact for the owner: **no configuration short of `skipLibCheck`
clears PH0-B1**, because class C is a defect in the library's own published types.

### 9.5 PH0-B2 reclassified: the session epoch is UDG-owned

`sessionEpoch` is a UDG protocol concept that the UDG server assigns, validates and renews. Colyseus 0.18
has no epoch concept and is not expected to have one, so recording its absence as a *blocker* or a
*defect* was wrong. The identifier stays for traceability with status **Reclassified — design obligation,
not a blocker**; it does not gate Phase 1. PR-12 now records the supported primitives it measured
(`create()` issues a fresh `sessionId`; `reconnect()` **preserves** it with `allowReconnection` consent and
`autoDispose = false`; `onLeave`/`onDrop` are the two rejoin paths; `InputHandle.reset()` is client-side
bookkeeping — now measured in the room whose handle is reset, with session identity unchanged), the renewal
procedure UDG still has to build (five steps, specified in api map §6 and **not implemented**), and what
remains unproved (token revocation before TTL, seat survival across restart, atomic publication of a new
epoch with the state patch, restart/loss/multi-process behaviour, and how a handle reset should interact
with an epoch change). The suite asserts the probe no longer says "BLOCKED".

### 9.6 Commands re-run for this revision (local)

| Command | Result |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 — `boundary check OK: 48 file(s), 0 violations, rule table 818c63d5b12f` |
| `pnpm test` | exit 0 — `Tests 362 passed (362)` (was 350 at the first submission) |
| `pnpm test:contract -- --task UDG-001` | exit 0 — 49 passed |
| `pnpm test:contract -- --task UDG-002` | exit 0 — 31 passed |
| `pnpm test:contract -- --task UDG-003` | exit 0 — **46 passed** (was 34), six probes executed from emitted JavaScript |
| `pnpm dependencies:verify` | `docs/integration/dependencies.json matches the installed dependency graph` |
| `pnpm contracts:checksums` | in sync — 59 files, 0 changes (api map re-hashed) |
| `pnpm --filter @udg/server typecheck:probes` | **non-zero** (tsc exit 2; pnpm surfaces 1) — 27 third-party diagnostics, reported not suppressed |
| probe index | `PR-0` 43 checks **blocked** exit 1; `PR-1` 43; `PR-2` 7; `PR-3` 10; `PR-8` 15; `PR-12` 6; `compatibility.stackCompatibility: "not-established"` |

### 9.7 CI for this revision

To be recorded by the follow-up commit once the run on `main` completes, with the same convention as §5b:
run id, head, result and what it proves. Retention stays as before — host store plus the per-run
`udg-evidence` workflow artefact, **no new release, tag or storage location**, and **D4 remains
undesignated**.

### 9.8 What this revision did not do

- No pin added, removed or changed; `pnpm-lock.yaml` untouched by this revision.
- No compiler flag, tsconfig change, ambient shim or dependency patch adopted — the R1/R2 variants are
  measured and described, not applied.
- No Phase 1 code; no epoch renewal implemented; no invented reset call.
- No acceptance, gate pass or spike gate recorded. UDG-003 stays **In Progress — Phase 0 resubmitted for
  review**; UDG-001 and UDG-002 remain **Verified**; Gates A/B/C remain **Not Run**.
- No release, tag, archive or storage created, replaced or deleted.

### 9.9 Decisions the owner still owes

1. **PH0-B1 remedy** — R0 (recommended: stay blocked, escalate upstream) or one of the narrow R1/R2
   variants, both of which leave PR-0 blocked. Phase 1 should not be assigned on the current evidence.
2. **D-7** — from §9.2: the pinned acknowledgement retires applied, refused **and** dropped frames
   identically, and no approved lever makes it truthful on its own.
3. **Whether Phase 1 may proceed on the current provisional pins** once PH0-B1 has a decided posture, or
   only after an upstream fix. There is no newer version to move to (§9.4).
4. **D4** — independent evidence backup destination, still undesignated.
