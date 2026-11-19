# ADR 0004 — Declaration-checking exception for `apps/client`, and the `@colyseus/sdk` client dependency

Status: **Accepted** — decided by the **delegated integration approver (Codex)** on 2026-11-19 and carried into
this repository by the build instruction of the same date. The implementer (Pi) recorded this file and authors no
approval in it (root `AGENTS.md`, [ADR procedure](README.md)).

Decision ID and title: ADR-0004 — `skipLibCheck: true` confined to `apps/client/tsconfig.json` for the UDG-SPIKE-001
client seat, plus the registration of the already-pinned `@colyseus/sdk 0.18.9` as an `apps/client` dependency.

Owner and reviewers: Project owner (`TomBResearch`) remains owner of record. Reviewer and integration approver for
UDG-SPIKE-001 is **Codex**, acting under the owner's in-chat delegation of 2026-11-19
([assignment record](../contracts/assignments/UDG-SPIKE-001.md), "Delegation and roles").

Date: 2026-11-19

Affected task IDs and contract clauses: [UDG-SPIKE-001](../contracts/UDG-SPIKE-001.md) §5 (DPA-1),
[assignment §5 DPA-1](../contracts/assignments/UDG-SPIKE-001.md#5-first-implementation-slice-pinned-public-sdk-browser-importapi--paired-client-smoke-probe)
and grant [T-9](../contracts/assignments/UDG-SPIKE-001.md),
[ADR-0002](0002-server-declaration-checking-exception.md) (its shape is mirrored; its scope is **not** widened),
[api map §5, §12](../integration/colyseus-0.18-api-map.md).

**Not affected, explicitly:** ADR-0002's text and its two `apps/server` projects; `tsconfig.base.json`, which keeps
`skipLibCheck: false`; every shared package, tool and test project; `tsconfig.tools.json` (the client's dev-seam
project), which keeps full declaration checking because it imports no Colyseus module. No DOM library, no ambient
type, no suppression comment, no vendor patch, no shim and no `any`/cast route is introduced by this decision.

## Trigger and reproduction

UDG-SPIKE-001 §5 slice 1 puts the pinned public SDK behind a real browser client import. Expected behaviour under
repository policy: the client typechecks against the pinned declarations. Actual behaviour, measured twice — in the
scratch probes (retained slice-1 record `UDG-SPIKE-001-slice1-2026-11-19/diagnostics` in the evidence store named by
the assignment) and again on this branch against the real app import — is **three diagnostics, every one inside a third-party `.d.ts`, and zero in repository code**:

| Vendor file | Code | Message |
| --- | --- | --- |
| `@colyseus/core@0.18.27` `build/router/node.d.ts:10` | TS1192 | `Module '"http"' has no default export.` (the declaration default-imports `node:http`; this repository keeps `esModuleInterop: false`) |
| `@colyseus/sdk@0.18.9` `build/HTTP.d.ts:93` | TS2344 | `UnionToIntersection<MethodOptions<API, "DELETE">> …` does not satisfy its own constraint |
| `@colyseus/sdk@0.18.9` `build/HTTP.d.ts:94` | TS2344 | same defect, second occurrence |

Reproduction (the retained strict check, which is what the audit runs):

```bash
pnpm install --frozen-lockfile && pnpm build:libraries
pnpm --filter @udg/client typecheck:declarations   # exits 2: 3 vendor / 0 first-party
pnpm --filter @udg/client typecheck                # exits 0 under this exception
```

Measured alternatives, all rejected on measurement rather than on taste:

1. **A public subpath import that avoids the defective graph** — `@colyseus/sdk/Client` resolves under
   `NodeNext` (the package publishes a `"./*"` export), and is *worse*: it adds 6 `TS2591 Cannot find name
   'Buffer'` defects in `Connection.d.ts`/`ITransport.d.ts`/`msgpackr/index.d.ts` on top of the two `TS2344`s, and
   the only relief for those is `@types/node` in a browser project, which the ambient-type policy refuses. The
   documented root import (`exports "."`, one entry) is the cleanest public route, and the 3-diagnostic inventory is
   the client-shape floor.
2. **`@types/node` or a DOM/`HeadersInit` shim, a `declare module` override, a vendor patch, or a type-only
   re-export** — all prohibited mitigations (ADR-0002 §3, root `AGENTS.md`), and 1 does not work anyway.
3. **Waiting for an upstream fix** — no pin in `sdk 0.18.6–0.18.9` / `core 0.18.20–0.18.27` is free of these
   (ADR-0002 §Trigger), and Gate A cannot be scheduled on a vendor release nobody owns.

Runtime is unaffected by all three diagnostics, which slice 1 proved end to end and this slice re-proves with
committed code: the smoke in `tests/e2e/netcode.spec.ts` joins two browser contexts over the same import that the
compiler cannot fully check. **Strict vendor diagnostics and runtime behaviour are separate claims** and the api map
records them separately.

## Decision

The delegated integration approver approved, for UDG-SPIKE-001's client seat and no further:

1. **Registration, not a new pin.** `@colyseus/sdk` `0.18.9` — the version the workspace already installs for
   `@udg/server` — becomes a direct `apps/client` dependency, with `pnpm-lock.yaml` reconciled by pnpm and
   `docs/integration/dependencies.json` re-recorded. No version moves; no other package is added.
2. **A confined declaration-checking exception in exactly one more file:** `apps/client/tsconfig.json` sets
   `skipLibCheck: true` and names this ADR beside it. `apps/client/tsconfig.tools.json`, `tsconfig.base.json`, all
   shared packages, tools and test projects keep full declaration checking. The complete excepted set is therefore
   four projects under three authorities — the two `apps/server` projects (ADR-0002), the root tooling project
   (UDG-001 D1), and `apps/client/tsconfig.json` (this ADR) — and PR-0 plus `tests/contracts/UDG-SPIKE-001.test.ts`
   pin that set *with its authorities*, so a fifth project, or this project borrowing a different authority, fails.
3. **A retained strict check and a pinned inventory.** `pnpm --filter @udg/client typecheck:declarations` runs the
   same project with `--skipLibCheck false`; its 3-entry inventory is pinned in
   `docs/integration/colyseus-client-declaration-inventory.json`, and the UDG-SPIKE-001 suite compares live against
   pinned and **fails on any drift** — a new file, a new code, a changed count, or a vanished entry. A clean strict
   check is also a failure while this ADR stands unretired: it would mean the pins moved and the record did not.
4. **Controls that the exception does not blunt.** The same suite compiles throwaway misuse fixtures against the
   real SDK declarations *with the exception in force* and requires each unsupported call or invalid input to fail:
   a member that does not exist, a wrong-arity `joinById()`, an assignment to the readonly `snapshot()` view, an
   out-of-domain frame through `validateDirectFrame`'s types. The set of codes that must appear is pinned, so a
   control that silently stops erroring is a suite failure.
5. **First-party strictness is untouched.** `strict`, `noImplicitAny`, `exactOptionalPropertyTypes`,
   `noUncheckedIndexedAccess`, `esModuleInterop: false`, `verbatimModuleSyntax` and the rest of
   `tsconfig.base.json` stay as they are in the client; `noPropertyAccessFromIndexSignature`, `noUnusedLocals` and
   `noUnusedParameters` included. `pnpm lint`'s boundary rules are unchanged.

## Consequences, positive and negative

Positive: the client can carry the seat over the published API with zero first-party suppressions; the vendor defect
set becomes a tracked, drift-detected inventory; the compiler still refuses unsupported SDK use; the exception is
three files of visible policy plus one ADR rather than an undocumented habit.

Negative, accepted knowingly (the same three ADR-0002 accepted, restated for this project):

1. A future vendor type regression that degrades an exported type is invisible in `apps/client/tsconfig.json`; the
   retained strict check is the compensating control, and it is a command anyone can run and a suite can fail.
2. `apps/client` now carries a documented weaker policy than the shared packages. That asymmetry is asserted by
   tests rather than trusted, and the client's dev-seam project stays strict.
3. There are now three authorities for one compiler setting. A reader who assumes one policy per repository will be
   wrong; the audit names each project's authority so precedent cannot be borrowed silently.

## Scope of this decision, and what it does not do

It decides **DPA-1** for UDG-SPIKE-001 and nothing else: no Gate A claim (Gate A **Not Run**), no P06 freeze, no
protocol/precision/schema change, no WS-proxy dependency (DPA-2 stays open and unexercised), no new pin beyond the
registration above, no `@types/node` in a browser project, and no extension of ADR-0002. `stackCompatibility`
remains `not-established`. The exception retires when an upstream release clears the three diagnostics: the pinned
inventory's own disappearance is the trigger, and retiring it means deleting the flag and the inventory in one
change, with the audit suite proving both.
