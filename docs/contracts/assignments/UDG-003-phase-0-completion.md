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

| Run | Head | Result | What it proves |
| --- | --- | --- | --- |
| [42690547977](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/42690547977) | `af29668a` | **success**, 23 steps, 0 failed | GitHub reproduces the corrected posture, not just the local one: `PR-0` reports `verdict: "blocked"` with 43 checks and process exit 1, the probe-project typecheck exits 2 with the **same pinned 27-diagnostic PH0-B1 inventory and 0 repository diagnostics**, and `PR-1`/`PR-2`/`PR-3`/`PR-8`/`PR-12` pass 43/7/10/15/6 checks. `compatibility-verdict.json` in the artefact reads `stackCompatibility: "not-established"`, `pr0: "blocked"`, `diagnostics: { total: 27, inRepositoryCode: 0, inThirdPartyDeclarations: 27 }`. The index labels the two compiler purposes explicitly: `emit.purpose = "diagnostic emission only (--noCheck)"` and `typecheck.purpose = "the accepted compiler gate"`. `PR-8` CI evidence reproduces the identity trace: dropped generations `1,2,3,4` retired under watermark `4` |

A green workflow is **not** a compatibility claim: the run is green because the suite now asserts that
PR-0 is blocked and the stack is `not-established`. Both evidence bundles from this run
(`UDG-001-2026-11-09T20-13-02-455Z-af29668a`, `UDG-002-2026-11-09T20-13-55-141Z-af29668a`) verify with
**zero issues**.

Retention is unchanged in kind. The host store `/workspace/udg-evidence/ci-run-42690547977` holds both
bundles, the `probes/` result directory and the runner log, alongside the per-run `udg-evidence` workflow
artefact; both bundles verify with zero issues, as do those of the documentation-only follow-up run
[42691770887](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/42691770887) (`638898b`,
success — recorded here because a docs-only push still produces bundles, and it is retained as
`ci-run-42691770887`).

The durable inventory is a chain, and this record deliberately does not present itself as the tip of it:
each version hashes the previous file, so the current tip is whatever `inventory.json` says when the store
is read, and it is verified by walking `supersedes` rather than by trusting a record. Entries added while
preparing this revision:

| Version | Files | Supersedes | Added |
| --- | --- | --- | --- |
| v16 | 1 488 | v15 `72b1f873425529c630a2e8f88d13530d3e2fd95237f8ef84a303da2add985d5f` | the revision-2 head, the correction record, and the reclassified PH0-B2 posture |
| v17 | 1 624 | v16 `98db2f6d915940ab41ea31e6e1740a911402c1fa0620bbd6523d3f450d79194d` | the documentation-only follow-up run `42691770887` |
| v18 | 1 625 | v17 `84e82f19646ea5a7ed8a7e35828786abbb176098863ab6fe3d024d3726580a37` | the cancelled run `42692674417` and the final revision-2 head run `42692879425` |

Two things about that chain are recorded rather than smoothed over.

**A run with no evidence.** Run `42692674417` (head `538cb70`) was **cancelled** when the next push
landed, and GitHub produced no `udg-evidence` artefact for it — `gh run download` answers `no valid
artifacts found to download`. Its directory in the store contains a `NOTICE.txt` saying exactly that, so
the absence is explicit instead of implied.

**A generator mistake, self-reported.** v17 and v18 were minted twice. The first mint used an
append-style generator that re-inserted run entries the previous version already carried, so
`ciRuns` contained duplicates (`42679471471`, `42690547977`, `42691770887` each appeared twice). Nothing
cited those versions and no recorded digest outside the store depended on them, so both were rebuilt from
v16 — the last version whose `ciRuns` were sound — with de-duplication, and the chain re-verified
(v9 → v18, no duplicate run ids). The tip hashes of v17 and v18 therefore differ from the ones first
announced in chat (`3cefc552…` and `66484abe…`, both superseded by this rebuild); earlier versions v9 →
v16 were never rewritten, and no historical bundle byte or recorded digest changed at any point.

The substantive head of this revision is `396672b2` (the commit recording this section is
documentation-only), whose run
[42692879425](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/42692879425) is
**success** with 0 failed steps and reproduces the same posture as `42690547977`: `PR-0` blocked (43
checks), `PR-1`/`PR-2`/`PR-3`/`PR-8`/`PR-12` passing 43/7/10/15/6 checks, the probe-project typecheck
exiting 2 with the pinned 27-diagnostic PH0-B1 inventory and zero repository diagnostics, and
`stackCompatibility: "not-established"`.

**No release, tag, archive or storage location was created, replaced or deleted for this revision**, and
**D4 — the independent backup destination — remains undesignated**; nothing in this revision provisions
storage, which the owner has not authorised.

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

---

## 10. Revision 3 — the two authorised remedy investigations

The owner acknowledged the revision 2 corrections, left **Phase 1 unassigned** and **D-7 undecided**, and
authorised two narrowly scoped investigations plus one decision document
([adoption I-1…I-3](adoption.md)). Revision 3 is those investigations. It changes no pin, no compiler setting and
no protocol rule, and it opens no upstream issue.

### 10.1 What was authorised, and what was not

Authorised: scratch compiler experiments, and minimal Phase 0 overflow probes against the current pins. Not
authorised: dependency changes, compiler-policy adoption, authority implementation, Phase 1 work. Preserved: all
historical evidence. Drafted for review only, not published: the two upstream reports. Untouched: releases, tags,
archives, storage; **D4 remains undesignated**.

### 10.2 Route 2 — PR-13: can a supported mechanism prevent unrepresented retirement?

`apps/server/probes/pr13-overflow-policy.probe.ts` (20 checks) and `OverflowRoom` in
`apps/server/probes/rooms.ts` measure nine postures against the pinned `core@0.18.27` / `sdk@0.18.9`, all with
public declarations only. Two identity sets decide every scenario: `ackedUnrepresented` (the client's
`lastProcessed` retires a frame whose values never entered a solver step — non-empty **is** the violation) and
`unackedUnrepresented` (frames that vanished without acknowledgement — the residue a reconnection must resolve).
The sets are computed from the send table rather than from what a tick happened to observe in `peek()`, so a frame
dropped before any tick saw it still counts.

| posture | peak backlog (bound 4) | `ackedUnrepresented` | disconnect | conclusion |
| --- | --- | --- | --- | --- |
| none, 5 ms sender | 4 | 8 of 14 acked | — | the finding reproduced; the bound held |
| `InputAccessor.clear()` at a threshold | 4 | 14 (`consumedCount` 10 → 14) | — | moves the same watermark: not a remedy |
| `Client.leave(4008)` at a threshold | 4 | 3 | yes (4008) | watermark froze at 3 of 8 sent; the 20 Hz tick acted too late for a 5 ms sender |
| `Room.maxMessagesPerSecond = 40` vs ~200/s | 4 | 29 | yes (4002) | cuts the offender off; a ceiling above the consume rate still permits growth |
| `defineInput(…, { seqField: 'generation' })` | 4 | 9 | — | the ack is still a send-order watermark |
| `Room.send(client, 'udg-backlog', …)` + obeying sender | **2** | **0** | none | prevention, 0 frames sent inside the signal window at loopback |
| `drain()` then step the newest | 3 | 13 (3 drained without a step) | — | rejected: the ack jump the declarations warn about, measured |
| `take(1)` per 20 Hz step vs 40/s | 4 | 8 | none | an under-sized budget makes eviction unavoidable |
| `take(3)` per 20 Hz step vs 40/s | **2** | **0** | none | prevention: all 24 sent frames entered a step |
| `defineInput(…, { sanitize })` | 4 | 9 | none | the only admission hook, `(input) => void`: rewrites, cannot refuse |

Findings, stated plainly:

1. **There is no rejection lever.** `sanitize` is the sole admission-time hook and returns `void`; no
   `InputAccessor` or `InputHandle` member withholds, retracts or qualifies an acknowledgement (§9.2). A room
   therefore cannot refuse an over-quota frame before it is buffered.
2. **A per-tick threshold is enforcement, not prevention.** Between two 20 Hz steps a 5 ms sender overran the whole
   buffer, so frames were acknowledged without a step before the tick could disconnect anyone (N3), and the same
   happens before a rate cut lands (N4). What those postures do achieve is real: the watermark stops lying once the
   seat ends, and the residue is explicitly unacknowledged rather than silently represented.
3. **Prevention is consumption matched to the admitted rate.** `take(n)` with `n ≥ ceil(admittedRate / stepRate)`
   retired nothing and simulated every sent frame (N8 budget 3, minimum 2), and a `Room.send()` backlog signal with
   an obeying sender did the same without a disconnect (N6). The pinned declarations recommend exactly this for a
   shared world and warn that `drain()`-then-apply-latest "would silently jump the ack past inputs the server never
   simulated"; N7 measures that warning instead of quoting it.
4. **Bounded buffering is proved**: the declared bound was never exceeded in any posture. The problem was never
   growth; it is what becomes of what the bound drops.
5. **Smallest required architectural decision** (no library change, no unbounded queue, no private state, no
   fabricated ack, no custom transport): an admitted input rate per session with a derived `take(n)` budget;
   `bufferMaxSize` derived from that budget plus jitter headroom so an overflowing buffer means an offender; one
   deterministic offender consequence (rate ceiling plus reserved close code, or a mandatory throttle signal — the
   owner's choice); and one explicit client state that resynchronises from authoritative state instead of replaying
   unacknowledged frames.

**SDK proof versus UDG-SPIKE-001 proof.** PR-13 observes server-side accounting only. It does not observe client
reconciliation, and the room's own step log is not evidence that a client stops predicting from a retired frame.
Convergence after a cut-off, behaviour under loss and reconnect, and the non-zero signal round trip of a real
network stay with UDG-SPIKE-001. **D-7 is unchanged and still open** (§9.2 remains its evidence).

### 10.3 Route 1 — the `skipLibCheck` candidate, measured and not applied

Scratch configurations and 19 negative fixtures were created under `apps/server/.adr-scratch`, measured, and
deleted; no repository tsconfig changed, and PR-0 still reports **BLOCKED** with 27 third-party diagnostics and 0
first-party ones.

| measurement | committed policy | with the candidate exception |
| --- | --- | --- |
| probe project — third-party declaration diagnostics | 27 | 0 |
| probe project — first-party diagnostics | 0 | 0 |
| probe project + 19 negative fixtures | 47 (27 + 20) | 20 — **the identical 20 first-party diagnostics** |
| `window.innerWidth`, `document.body`, `HTMLElement` | 3 errors | 3 errors |
| invalid calls to the public APIs UDG uses | 13 of 15 error | the same 13 error |
| type fidelity over 752 first-party call expressions | baseline | identical resolved signatures; 0 expressions acquiring a type from the six defective declaration files; identical `any`-expression count (48, all pre-existing) |
| `@udg/protocol`, `@udg/protocol/schema`, no-Colyseus entries | 0 diagnostics | 0 — no exception needed |

Two negative cases escape under **both** policies (`client.create(999)`, `server.listen('not-a-port')`), which is
looseness in the pinned upstream types rather than an effect of the flag. Measured per minimal import: `apps/server`
needs the exception (23–26 diagnostics by entry), `apps/client` needs it for 3 of its own once it imports
`@colyseus/sdk` (22 of the 23 `HeadersInit` diagnostics are an artefact of the server's Node `lib` and vanish under
the client's existing DOM `lib`), and `packages/*`, `tools/*` and the root test project need nothing. Residual risk
was measured rather than asserted: with the exception, an unresolvable **exported** type in a dependency reports
nothing and its call sites stop being checked, and an error inside a declaration file the repository itself emits
is silenced too.

Recommendation is unchanged from §9.4: **R0/A0 — keep PH0-B1 blocked and escalate upstream.** The exception works as
measured, but it clears a compiler gate for a stack whose behavioural blockers are still open, and it would require
restating PR-0's claim. Recorded in api map §10 (with a supersession note on the §5.4 R4 rejection, whose text
stands as written) and in the decision document below.

### 10.4 The decision document

[docs/adr/proposals/UDG-003-compiler-exception-and-input-backlog-posture.md](../adr/proposals/UDG-003-compiler-exception-and-input-backlog-posture.md),
status **Proposed** (ADR-P-0002): Part A compiler options A0–A6 with the measurements and the exact project list;
Part B the posture options, the measured sizing rule and the four-item decision; impact; the decisions requested in
order; appendix A the reproducible scratch measurements; appendix B two upstream report drafts **for review only —
not published, no issue opened**. It is a proposal: only the owner can accept it, and acceptance would still not be
a gate pass.

### 10.5 Commands re-run for this revision (local)

| command | result |
| --- | --- |
| `pnpm --filter @udg/server build:probes` | 0 — emits the probe project (`--noCheck`, diagnostic emission only) |
| `node apps/server/probes/dist/probes/pr13-overflow-policy.probe.js --out …` | 0 — 20 checks, all passing, twice in a row |
| `pnpm --filter @udg/server typecheck:probes` | **non-zero** — 27 third-party diagnostics, 0 first-party (PH0-B1 unchanged) |
| `pnpm typecheck` | 0 |
| `pnpm lint` | 0 — `boundary check OK: 49 file(s), 0 violations, rule table 818c63d5b12f` |
| `pnpm test` | 0 — **`Tests 372 passed (372)`**; UDG-001 49, UDG-002 31, **UDG-003 56**, unit 216, fixture-layout 20 |
| `pnpm contracts:checksums -- --write` | 60 entries, one addition (`docs/adr/proposals/UDG-003-compiler-exception-and-input-backlog-posture.md`, which `docs/**` makes edition-controlled) and no other change; CI's "Verify the contract checksum manifest is in sync" step passes on the head |
| scratch compiler measurements | appendix A of the decision document; scratch tree deleted afterwards, `git status` clean of scratch files |

### 10.5b CI on `main`, and the evidence retained

| run | head | result | what the artefact says |
| --- | --- | --- | --- |
| `42719371983` | `21079545` | **success**, 23 steps + post steps, 0 failed | probe index reads `PR-0=blocked(43)`, `PR-1/2/3/8/12=pass`, **`PR-13=pass(20 checks, 0 failed)`**; `compatibility-verdict.json` keeps `stackCompatibility: "not-established"`, `pr0: "blocked"`, `strictTypecheckExitCode: 2`, `diagnostics: { total: 27, inRepositoryCode: 0, inThirdPartyDeclarations: 27 }` |
| `42720409890` | `05678637` | **success**, 0 failed | the same artefact surface after the record commit above: `PR-0=blocked`, five passing probes unchanged, `PR-13=pass` with 20 checks, `stackCompatibility: "not-established"`; both bundles verify with 0 issues and the runner log is retained |

Convention adopted here so the table cannot fall behind its own head: a **records-only** commit whose content is
the transcription of a CI run records the runs that preceded it, and the run that covers the records-only head is
retained in the durable store and named in the inventory chain rather than transcribed into a further commit.
Without that rule a run would have to record itself.

CI-measured PR-13 values, which the recommendation quotes (they differ from the local run only in generation
counts, never in direction): N1 9 of 14 acknowledged frames never entered a step, peak backlog 4 of 4; N2
`clear()` still retiring frames; N3 `Client.leave(4008)` freezing the watermark at 5 of 10 sent with 5 frames
unacknowledged and unrepresented, yet still 5 acknowledged without a step and the backlog touching the bound; N4
rate ceiling 40/s disconnecting with code 4002 after 30 acknowledgements without a step; N5 `seqField` no help; N6
signal posture peak 2 of 4, nothing acknowledged without a step, 0 frames inside the signal window; N7 `drain()`
retiring 6 frames without a step and 12 acknowledgements without a step; N8 budget 1 → 9 acknowledged without a
step, budget 3 → none, peak 2 of 4, minimum budget 2; N9 `sanitize` running 14 times, 5 frames stepped after
rewriting, 9 acknowledgements without a step.

Retained in the durable host store as `ci-run-42719371983` and `ci-run-42720409890`: in each, both evidence bundles
(each `PASS evidence verify … (0 issue(s))`), the `probes/` artefact including `PR-13.probe-result.json`, and
`runner/runner-log.txt.gz`. This revision appends an entry for each run named in the table — chain version 20 for
`42719371983` (1 762 files, superseding version 19) and version 21 for `42720409890` — and the chain was re-verified
end to end with matching `supersedes` digests and no duplicate `ciRuns`. Per the convention above, the store's
newest version also covers the run that carries this record, and `inventory.json` mirrors that newest version.
Records cite the chain entry, never a tip hash asserted from a record.

**No release, tag, archive or storage location was created, replaced or deleted for this revision, and D4 remains
undesignated.**

### 10.6 What this revision did not do

- No pin added, removed or changed; `pnpm-lock.yaml` untouched.
- No compiler flag, tsconfig, ambient shim or dependency patch applied to the repository; the scratch configs were
  deleted and `git status` carries no scratch path.
- No Phase 1 code, no authority implementation, no room behaviour beyond the probe-only `OverflowRoom`.
- No upstream issue opened and no report published.
- No acceptance, gate pass or spike gate recorded. UDG-003 stays **In Progress — Phase 0 revision 3 submitted for
  review**; UDG-001 and UDG-002 remain **Verified**; Gates A/B/C remain **Not Run**.
- No release, tag, archive or storage created, replaced or deleted; **D4** still undesignated.

### 10.7 Decisions the owner still owes

1. **Part A** — accept A0 (recommended: stay blocked, escalate upstream) or accept A4 with the recorded mitigations
   and a restated PR-0.
2. **Part B** — accept the admitted-rate + `take(n)` budget + derived `bufferMaxSize` posture, and choose the
   offender consequence (rate ceiling plus close code, or a mandatory throttle signal).
3. **Phase 1 authorisation** on that basis, still carrying `not-established` and the declaration-error inventory, or
   a decision to wait for upstream (no newer pins exist).
4. **D-7** — unchanged and open; PR-13 supplies a posture in which the acknowledgement is never asked to make the
   distinction, which is not the same as making the acknowledgement truthful.
5. **D4** — independent evidence backup destination, still undesignated.

## 11. Revision 4 — Part A applied as ADR-0002, Part B returned with corrections

The owner decided Part A of [ADR-P-0002](../../adr/proposals/UDG-003-compiler-exception-and-input-backlog-posture.md)
(**A4 accepted**, confined to `apps/server/tsconfig.json` and `apps/server/tsconfig.probes.json`), **refused Part B as
the backlog solution** with five corrections, and left **Phase 1 unassigned**, **D-7 open**, **Gates A/B/C Not Run** and
**D4 undesignated**. No release, tag, archive or storage location was created or altered, and nothing was published.
Recorded in [adoption D-16/D-17](../adoption.md) and
[ADR-0002](../../adr/0002-server-declaration-checking-exception.md).

Commit order carries the owner's requirement that the accepted record precede the change: `cd9b7f5` records ADR-0002
and the dispositions and touches no configuration; `cad8a42` applies the exception; `bfd0c55` returns Part B with the
corrections and the replacement recommendation.

### 11.1 Each owner condition, and the assertion that holds it

| condition | implementation | asserted by |
| --- | --- | --- |
| strict first-party checking preserved | only `skipLibCheck` is set in the two files; `strict`, `noImplicitAny`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `esModuleInterop: false`, `verbatimModuleSyntax` still come from `tsconfig.base.json`, which keeps `skipLibCheck: false` | PR-0 `policy:*`, `probe-project-does-not-relax:*`; UDG-003 suite |
| boundary rules unchanged | no boundary configuration touched; `pnpm lint` still runs the same rule table (`818c63d5b12f…`) | `pnpm lint`, boundary fixture suite |
| no DOM globals | neither project's `lib` gains `DOM`/`DOM.Iterable`; PR-0 rejects DOM lib entries in any project carrying the flag | PR-0 `exception-projects-name-the-adr-and-load-no-dom-lib` |
| no suppression comments, dependency patches or ambient shims | escape-hatch scan extended with `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `declare global`, `declare module` (patterns assembled at runtime so the probe cannot match its own scan; comments and literals stripped first so prose neither offends nor conceals) | PR-0 `no-escape-hatches`, `exception-projects-use-no-suppression-or-shims` |
| the full-check declaration diagnostic retained, **new diagnostic changes visible to review** | `pnpm --filter @udg/server typecheck:probes:full` re-runs the same project with `--skipLibCheck false`; the runner normalises output to `package@version::declaration-file` × code × count (peer-hash suffix stripped, so an unrelated pin reshuffle is not mistaken for a new defect), writes `declaration-inventory.json`, and PR-0 compares it against the committed [colyseus-declaration-inventory.json](../../integration/colyseus-declaration-inventory.json) | PR-0 `vendor-declaration-inventory-matches-the-pinned-inventory`, `retained-full-declaration-check-ran`, `the-exception-hides-no-repository-diagnostics`; the suite pins the same inventory independently |
| separate strict check of UDG-owned package declarations, without the problematic stack | new root `tsconfig.declarations.json` over `packages/protocol/dist` and `packages/config/dist` with `skipLibCheck: false`, `types: []`; `pnpm run declarations:strict`; a CI step of its own. `--listFiles` confirms 28 declaration files in the program and **zero** from `@colyseus/core`, `@colyseus/sdk` or `@colyseus/ws-transport` | PR-0 `udg-emitted-declarations-typecheck-with-skiplibcheck-false`, CI step, suite |
| PR-0 restated | claim, scope, preserved properties and refusals are all in the probe's own result file (`claim`, `explicitlyNotClaimed`, `compilerPolicy`) | PR-0 result file; suite asserts the wording and that the superseded check names are gone |

### 11.2 PR-0's posture changed, and the change is a narrowing

| | revision 3 | revision 4 |
| --- | --- | --- |
| accepted gate | `tsc -p tsconfig.probes.json --noEmit`, exits 2 with 27 diagnostics | same command, exits **0** with **0** diagnostics |
| PR-0 verdict | **blocked** (`ok: false`, failing `compatibility-blocked`) | **pass** on the restated claim, 49 checks, all ok |
| what PR-0 claimed | "the pinned stack compiles under this repository's policy" — and blocked because it did not | "first-party code typechecks against the pinned declarations under the documented ADR-0002 exception", and explicitly not: vendor defects fixed, runtime compatibility, other projects, `build:probes` as a build path |
| vendor defects | reported by the accepted gate | reported by the retained full check and pinned as a compared inventory |
| `stackCompatibility` | `not-established`, **derived** from the gate failing | `not-established`, **no longer derived** from compilation |

The derivation was removed rather than left in place. Written as `accepted gate clean ⇒ established`, the formula
would have flipped the compatibility field on the strength of a compiler flag the moment the exception landed. Whether
the stack is compatible is a question for Phase 1 behaviour plus the UDG-SPIKE-001 gate and an owner decision, and the
artefact now says so independently of what the compiler prints.

### 11.3 Measurements on the committed configuration

Everything below was run against the committed files, and every mutation was reverted and hash-verified afterwards.

| # | measurement | result |
| --- | --- | --- |
| M-1 | accepted gates clean | `pnpm --filter @udg/server typecheck` and `typecheck:probes` exit 0 with 0 diagnostics; `pnpm run declarations:strict` exits 0 |
| M-2 | first-party errors still fail under the exception | a temporary probe module with five deliberate mistakes (wrong return type, wrong assignment type, undefined name, wrong arity, unknown property) → exit 1 with exactly `TS2322`, `TS2322`, `TS2304`, `TS2554`, `TS2339`; removed → exit 0 again |
| M-3 | DOM globals remain unavailable | `window.innerWidth`, `document.body`, `HTMLElement` in a temporary probe module → `TS2304`, `TS2584` ("Do you need to change your target library?"), `TS2304`; removed → clean |
| M-4 | the retained full check still sees the vendor defects | exit 2, 27 diagnostics in 7 groups, `inRepositoryCode: 0`, matching the pinned inventory exactly |
| M-5 | **an inventory change is a review event** | the pinned document was edited to simulate three deltas at once (count 18→17, a new `@colyseus/other` group, and removal of a real group): PR-0 fails with exit 1 and reports `added [...] removed [...] changed [...] live 18 vs pinned 17`. Restored byte-identically (`sha256sum -c` OK) |
| M-6 | **the exception cannot spread** | `"skipLibCheck": true` added to `packages/protocol/tsconfig.json`: PR-0 fails with exit 1, `outside approval: [packages/protocol/tsconfig.json]`. Restored, `git status` clean |
| M-7 | the UDG-declaration check is not vacuous | `export declare const deliberateBreak: UdgMissingName;` appended to `packages/protocol/dist/index.d.ts` → `TS2304`, non-zero exit; restored → exit 0. (First attempt produced no error because the appended line landed after the file's trailing `//# sourceMappingURL` comment and became part of it — recorded because a demonstration that cannot fail proves nothing.) |

### 11.4 Disclosed inaccuracy: C-6, the root tooling project

Route 1's blast-radius table said the root test project "needs nothing". That is true of the Colyseus stack and
misleading about repository policy: `tsconfig.json` has carried `skipLibCheck: true` since **UDG-001 decision D1**, for
`playwright-core`'s DOM-referencing declarations and `vitest`'s default import of `node:path`. PR-0's first run caught
this — its confinement check failed against the claim as written — and the claim was corrected rather than the check.

Consequences recorded: repository policy is now three projects under **two** authorities, so "declaration checking is
excepted" is not one repository-wide property with one owner. PR-0 pins the exact set **and** which authority each
project cites, so the pre-existing relaxation must not borrow ADR-0002's name and a fourth project cannot arrive under
its precedent. The correction is recorded as C-6 in the proposal, in ADR-0002 ("Correction to the Route 1
measurement"), in [adoption D-16](../adoption.md), and in api map §0 — the original sentence stays visible.

### 11.5 Part B, returned

The five corrections are applied to the proposal in place, each superseded sentence keeping its wording under a
`SUPERSEDED by C-n` marker (§0 lists them), and mirrored in [api map §9](../../integration/colyseus-0.18-api-map.md) so
a reader of the measurements sees them beside the numbers. The replacement recommendation is
[UDG-003-input-consumption-rule.md](../../adr/proposals/UDG-003-input-consumption-rule.md): **Proposed**, assigning no
work. Its answer to the owner's question is that the simulation rule survives because one step per entity per tick is
UDG's own decision, while the no-unrepresented-retirement property survives only if admitted arrival does not exceed
the step rate — which nothing in the SDK enforces for a sender that does not comply — and that no public mechanism
refuses an over-quota frame at admission. It names the eight baseline clauses a multi-input rule would have to amend,
the five conservation requirements (tick clock, displacement, ordering, reconciliation against state and generation
rather than frame counts, anti-cheat and determinism), the real-state probe and burst/adversarial set that must pass
first, and what stays with UDG-SPIKE-001. Its recommendation is to keep the rule and treat the backlog as an admission
and scope problem, stating the scope of the guarantee plainly: prevention for a compliant sender, detection and
termination for one that is not, with a bounded unrepresented residue confined to the offending session.

### 11.6 Local checks at revision 4

| command | result |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 — `boundary check OK: 49 file(s), 0 violations`, rule table `818c63d5b12f…` |
| `pnpm test` | exit 0 — `Tests 372 passed (372)` across 9 test files; UDG-001 49, UDG-002 31, UDG-003 56 |
| `pnpm run declarations:strict` | exit 0 (UDG-owned declarations, `skipLibCheck: false`, no Colyseus server/SDK/transport in the program) |
| `pnpm --filter @udg/server typecheck` / `typecheck:probes` | exit 0, 0 diagnostics (the accepted gates) |
| `pnpm --filter @udg/server typecheck:probes:full` | exit 2, 27 third-party diagnostics, 0 in repository code (intended: the retained check must keep failing) |
| `pnpm contracts:checksums` | in sync — 63 tracked planning files, 0 changes |
| `pnpm dependencies:verify` | matches the committed register; no dependency changed by this revision |

### 11.7 Evidence

Probe artefacts for the revision-4 runs are retained in the durable host store (`/workspace/udg-evidence/ci-run-…`)
with the runner logs, and the inventory chain is extended rather than rewritten; records cite the chain, never a tip
hash asserted from a record. Raw bundles stay out of Git. No release, tag, archive or storage location was created or
altered, and **D4 remains undesignated**: no retention provisioning was authorised by this decision.

### 11.8 CI reproduction

Run **`42792412198`** on head `ee15f92a` — **success**, 22 steps, none failed. It is the first CI run of the applied
exception, and the retained artefacts read:

| surface | CI value |
| --- | --- |
| probe verdicts | `PR-0=pass(49) PR-1=pass(43) PR-2=pass(7) PR-3=pass(10) PR-8=pass(15) PR-12=pass(6) PR-13=pass(20)` |
| accepted compiler gate | exit **0**, 0 diagnostics — purpose recorded in the index as "the accepted compiler gate under the ADR-0002 exception: first-party code against the pinned declarations" |
| retained full declaration check | exit **2**, **27** diagnostics in **7** groups, **0** in repository code |
| UDG-owned emitted declarations | exit **0**, 0 diagnostics, under `skipLibCheck: false` with no server/SDK/transport in the program |
| `compatibility-verdict.json` | `stackCompatibility: "not-established"`, `pr0: "pass"`, `compilerPolicy.approvedProjects` = the two `apps/server` configs, four `notClaimed` entries |
| new CI step | "Typecheck UDG-owned emitted declarations strictly (ADR-0002)" ran and passed |

Both per-task bundles in the retained artefact verify with `PASS evidence verify … (0 issue(s))`, and the runner log
is retained. A green run here means the suite's assertions hold — including that the vendor inventory still matches
its pinned document and that the exception has not spread — and it does **not** mean the stack is compatible, which
the artefact states in its own `reading` field.

Under the recording convention adopted in §10, the run that covers *this* records-only commit is named in the
inventory chain rather than transcribed into a further commit, because a run cannot record itself.

### 11.9 Disclosed incident in the evidence store (not a repository or contract issue)

While extending the inventory chain after run `42792412198`, a **stale copy** of the chain generator — an older
revision whose constants still named version 19 — was executed instead of the current one. It overwrote
`/workspace/udg-evidence/inventory-v19.json` with a same-day snapshot, so that file is no longer the historical
snapshot it was, and `inventory-v20.json`'s `supersedes` digest no longer matches it; the original v19 bytes are
unrecoverable.

Nothing else was touched: no evidence directory, CI artefact, bundle, `report.json`, `checksums.sha256`, runner log,
probe artefact, or repository file. v20–v22 are byte-identical to before. v19 was **not** re-minted (it cannot be) and
v20–v22 were deliberately **not** rebuilt to repair the single digest link, because doing so would replace three sound
historical snapshots with today's data to make one link verify. Chain verification from v9 forward therefore reports
exactly one expected discontinuity, `v19 → v20`, and the incident is recorded both as
`INTEGRITY-2026-11-10.md` beside the store and as an `integrityIncidents` entry carried forward inside the inventory
itself, so a reader of any later version sees it without having been told. The generator now refuses to run unless
its version constants are consecutive and refuses to overwrite an existing `inventory-vN.json`, and the stale copy was
replaced with a pointer to the guarded one.
