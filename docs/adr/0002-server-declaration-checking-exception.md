# ADR 0002 — Declaration-checking exception for the `apps/server` projects

Status: **Accepted**

Decision ID and title: ADR-0002 — `skipLibCheck: true` confined to `apps/server/tsconfig.json` and
`apps/server/tsconfig.probes.json` as a documented compiler-policy exception (option A4 of ADR-P-0002 Part A)

Owner and reviewers: Project owner (`TomBResearch`), acting as integration owner and project reviewer. The
implementer investigated, measured and recommended; it authored no approval and records none of its own.

Date: 2026-11-10

Affected task IDs and contract clauses:
[UDG-003](../contracts/UDG-003.md) (Phase 0 blocker PH0-B1, Phase 1 authorisation),
[adoption I-1/D-16](../contracts/adoption.md),
[compiler-policy proposal ADR-P-0002 Part A](proposals/UDG-003-compiler-exception-and-input-backlog-posture.md),
[api map §0, §5, §10](../integration/colyseus-0.18-api-map.md),
[Phase 0 completion §9.4, §10.3](../contracts/assignments/UDG-003-phase-0-completion.md),
[definition of done](../contracts/definition-of-done.md),
[package boundaries](../contracts/ownership.md).

**Not affected, explicitly:** `apps/client` and every other workspace, package and tool. The owner's approval covers
the two named files only. Extending it to `apps/client` — which carries 3 declaration diagnostics of its own once it
imports `@colyseus/sdk` (proposal §3.4) — is a decision for the task that owns that project, reviewed on its own
evidence.

**One relaxation already existed, and this ADR does not absorb it.** The root tooling project
[`tsconfig.json`](../../tsconfig.json) has carried `skipLibCheck: true` since UDG-001 decision **D1**
([assignment §D1](../contracts/assignments/UDG-001.md), recorded in the
[completion record](../contracts/assignments/UDG-001-completion.md)), for a different reason: `playwright-core`'s
declaration bundle references `SVGElement`/`HTMLElement`/`HTMLElementTagNameMap` and `vitest`'s default-imports
`node:path`, neither checkable under a non-DOM `lib`. That project imports no Colyseus package, gains nothing from
this ADR, and is retained unchanged. The consequence is that "declaration checking is excepted" is not a single
repository-wide property with one owner: three projects carry the setting under two separate authorities, and PR-0
asserts the exact set and which authority each one cites, so a fourth project acquiring the flag fails the build.

## Trigger and reproduction

Expected behaviour: the repository compiler policy checks third-party declarations, so a mismatch between a pinned
declaration and UDG's code is a compile error rather than a runtime surprise. Actual behaviour: with the pins in
[api map §1](../integration/colyseus-0.18-api-map.md), the probe project exits 2 with **27 diagnostics, every one
inside a third-party declaration and none in repository code** (PH0-B1). Class A is 23 × `TS2304 Cannot find name
'HeadersInit'` (the pinned declarations assume the DOM lib, which a Node-only server does not load); class B is
2 × `TS1192 Module '"http"' has no default export`; class C is 2 × `TS2344 UnionToIntersection<MethodOptions<API,
"DELETE">>`, a defect inside `@colyseus/sdk`'s own published types. No published pin in `core 0.18.20–0.18.27`,
`sdk 0.18.6–0.18.9`, `ws-transport 0.18.2–0.18.4` or `better-call 1.2.1–1.3.3` is free of them, and TypeScript
5.8/6/7 does not clear them (6/7 cannot even read `esModuleInterop: false`). Full classification: api map §5.1–§5.2;
measured candidate remedies: proposal §3.2–§3.5.

Reproduction:

```bash
export PATH="$HOME/.local/bin:$PATH"
pnpm install --frozen-lockfile
pnpm --filter @udg/server typecheck:probes          # accepted gate: exits 0 under this exception
# the retained full check, which still reports the vendor defects:
cd apps/server && npx tsc -p tsconfig.probes.json --noEmit --skipLibCheck false
# strict check of UDG-owned emitted declarations, without the server/SDK stack:
cd /workspace/UntitledDinosaurGame && pnpm run build:libraries && npx tsc -p tsconfig.declarations.json --noEmit
```

Measured evidence for this decision (proposal appendix A, all scratch, nothing applied at the time): probe project
27 third-party / 0 first-party → 0 / 0 under the exception; with 19 negative fixtures 47 (27 + 20) → 20, **the
identical 20 first-party diagnostics**; `window.innerWidth`, `document.body` and `HTMLElement` still error; 13 of 15
invalid calls against the public API UDG uses still error, and the two that escape (`client.create(999)`,
`server.listen('not-a-port')`) escape under **both** policies; 752 first-party call expressions keep identical
resolved signatures with 0 expressions acquiring a type from the six defective declaration files.

## Decision

The owner approved **A4 as an explicit, documented exception for the current `apps/server` projects only**:

1. `apps/server/tsconfig.json` and `apps/server/tsconfig.probes.json` set `skipLibCheck: true`, each with a comment
   naming this ADR. No other compiler option is relaxed by it, and no other project receives it — so the complete set
   of projects where declaration checking is excepted is exactly those two plus the pre-existing UDG-001 D1 tooling
   project. Anything beyond those three requires the owner.
2. What must remain unchanged: `strict`, `noImplicitAny`, `exactOptionalPropertyTypes`,
   `noUncheckedIndexedAccess`, `esModuleInterop: false`, `verbatimModuleSyntax`, and every other setting inherited
   from `tsconfig.base.json`, which keeps `skipLibCheck: false`. All boundary rules stay as they are, and the
   boundary check remains part of `pnpm lint`.
3. Prohibited as mitigations, before and after this exception: DOM globals (`lib` must not gain `DOM` or
   `DOM.Iterable` in the two projects), error-suppression comments (`@ts-ignore`, `@ts-expect-error`,
   `@ts-nocheck`), dependency patches or vendored declarations, and ambient shims (`declare global`,
   `declare module`, ambient `HeadersInit`).
4. **The full check is retained as a separate diagnostic.** A check that runs the same probe project with
   `skipLibCheck: false` keeps producing the complete third-party declaration-error inventory, and that inventory
   is pinned in `docs/integration/colyseus-declaration-inventory.json`. The probe suite compares the live inventory
   against the pinned one and **fails on any difference** — an added file, a new diagnostic code, a changed count or
   a vanished entry — so a new vendor diagnostic becomes a review event instead of a silent improvement in the
   compiler output. Updating the pinned inventory requires the pin change and a record of why.
5. **First-party declarations keep a strict check of their own.** `tsconfig.declarations.json` typechecks the
   emitted declarations of `@udg/protocol` and `@udg/config` with `skipLibCheck: false`, without importing
   `@colyseus/core`, `@colyseus/sdk` or `@colyseus/ws-transport`. `@colyseus/schema` is the only third-party
   declaration it sees, and it is measured clean. Without this, the exception would have silenced errors in UDG's
   own published declaration surface as well.
6. **PR-0's claim is restated** (§"PR-0 after this decision"). PH0-B1 is closed *by this exception*, not by a fix:
   the 27 vendor diagnostics remain, are still listed, and are still the reason the exception exists.
7. **Compatibility and Phase 1 are unchanged by this decision.** `stackCompatibility` stays `not-established`;
   Phase 1 remains unassigned; Gate A stays Not Run; ADR-P-0002 Part B is not approved (§Part B below).

## PR-0 after this decision

PR-0's compiler half now asserts, in this order and with the reports the harness supplies:

- **what it claims:** *first-party code typechecks against the pinned declarations under the documented ADR-0002
  exception* — the accepted project typecheck exits 0 with zero diagnostics, and zero diagnostics in repository
  code;
- **what confines it:** `skipLibCheck: true` appears in exactly the two approved files, each naming this ADR, while
  `tsconfig.base.json` and every other project keep `false` or set nothing; neither approved project loads a DOM
  lib;
- **what it preserves:** the retained full check still reports the pinned vendor inventory, byte-for-byte as a
  file × code × count set, and no suppression comment, ambient shim or internal-package import exists in the tree;
- **what it does not claim:** that the vendor declaration defects are fixed; that runtime behaviour,
  reconciliation or transport compatibility follows from compilation; that `apps/client` or any other project is
  covered; that the `--noCheck` emit is a build path (it is not, and remains excluded from `build`).

PR-0 therefore reports `verdict: "pass"` instead of `"blocked"`. That is a weaker claim than the pre-exception
one, and it is labelled as such in its own result file under `explicitlyNotClaimed`.

## Consequences, positive and negative

Positive: the accepted compiler gate becomes usable for the code UDG is going to write, so a real signature
mismatch in first-party code fails the build again; PH0-B1 stops blocking progress while upstream is unresolved; the
vendor defect set becomes a tracked inventory that turns a regression into a loud event.

Negative, and accepted knowingly:

1. Errors **inside** third-party declarations are no longer reported in the two projects. A future vendor type
   regression whose exported type degrades is invisible there — measured in proposal appendix A.3 case 2, where the
   misusing call site stops reporting anything under the exception. The retained full check is the compensating
   control, and it runs in CI and in the probe suite rather than only on request.
2. Two of the misuse classes the compiler used to be relied on for were never caught in the first place (the two
   escaping fixtures). UDG's own typed wrappers plus contract tests remain the defence, not the compiler.
3. `apps/server` now has a documented weaker policy than the rest of the repository. That asymmetry is a
   reviewer-visible property, asserted by PR-0 and the contract suite rather than trusted.
4. There are now two authorities for the same compiler setting (this ADR for the server projects, UDG-001 D1 for the
   root tooling project). A reader who assumes one policy per repository will be wrong, and a future relaxation could
   hide behind the precedent. PR-0 therefore pins the exact project set **and** which authority each project cites, so
   borrowing the precedent without saying so fails.

## Correction to the Route 1 measurement

Proposal §3.4 measured which projects *would* need the exception for the Colyseus stack and reported that the root
test project "needs nothing". That is true of Colyseus and misleading as written: the root tooling project already had
the setting under UDG-001 D1. The statement is corrected here rather than edited away, because the per-project
measurement itself is still what it was.

## Validation required and performed

| check | where |
| --- | --- |
| the accepted gate exits 0 with 0 diagnostics | `pnpm --filter @udg/server typecheck`, `typecheck:probes`, PR-0 check 1 |
| the exception is confined to the two files, each citing this ADR, and no third project acquires it beyond the pre-existing UDG-001 D1 tooling project | PR-0 config scan (`exception-confined-to-the-approved-projects`, `adr-0002-tags-exactly-its-two-projects`), UDG-003 contract suite, `pnpm lint` boundaries unchanged |
| no DOM globals, no suppression comments, no ambient shims, no internal imports | PR-0 escape-hatch and policy scans |
| full declaration inventory matches the pinned inventory exactly | PR-0 inventory check; artefact `declaration-inventory.json` |
| UDG-owned emitted declarations typecheck strictly without the server/SDK stack | `pnpm run declarations:strict`, CI step, contract suite |
| nothing about runtime compatibility is claimed | PR-0 `explicitlyNotClaimed`, `compatibility-verdict.json` reading, contract suite assertions |

## Part B of ADR-P-0002

**Not approved as the backlog solution.** The owner returned it with five corrections, applied in
[the proposal](proposals/UDG-003-compiler-exception-and-input-backlog-posture.md) and recorded in
[adoption](../contracts/adoption.md): `take(n)` is an amendment to the adopted one-input rule rather than
configuration; PR-13's step arrays are probe bookkeeping and not an executed movement solver; the average-rate
formula is a necessary capacity consideration and not a sufficient guarantee against bursts, jitter or an
adversarial sender; an obedient loopback sender and a post-eviction disconnect do not establish the required
protection; and the claim that catch-up draining is already part of the accepted design is removed, because
[movement-authority.md §5.1](../interfaces/movement-authority.md) forbids draining a burst and simulating only its
last frame. The replacement recommendation is
[UDG-003-input-consumption-rule.md](proposals/UDG-003-input-consumption-rule.md), which is a proposal and assigns no
work.

Supersedes or is superseded by: supersedes the R4 rejection in api map §5.4 **only** as to the two named projects,
on the owner's authority and with the retained full check as a condition; the R0/A0 recommendation stands as the
recommendation, and the owner chose otherwise for these two projects. It disposes of ADR-P-0002 Part A as Accepted
and Part B as Not approved. It does not supersede ADR-0001, does not alter ADR-0001 widths, and does not change any
contract clause: Part B's baseline amendments remain unadopted and unassigned.
