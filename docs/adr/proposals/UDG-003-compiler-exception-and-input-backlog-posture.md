# ADR proposal — Colyseus declaration checking, and the input-backlog posture that replaces silent retirement

Status: **Part A Accepted as [ADR-0002](../0002-server-declaration-checking-exception.md), confined to the two
`apps/server` projects on the owner's instruction of 2026-11-10. Part B is Not approved**: the owner returned it
with five corrections (§0 below), and the replacement recommendation is
[UDG-003-input-consumption-rule.md](UDG-003-input-consumption-rule.md). Disposition of this document:

| part | owner disposition | what that means now |
| --- | --- | --- |
| A (compiler policy) | **Accepted — option A4, `apps/server/tsconfig.json` and `apps/server/tsconfig.probes.json` only** | Applied with the owner's conditions: everything else keeps `skipLibCheck: false`; the full declaration check is retained as a separate pinned diagnostic; UDG's own emitted declarations keep a strict check of their own; PR-0 is restated. Extending the exception to `apps/client` or anything else needs that project's own review |
| B (input backlog) | **Not approved as the backlog solution** | §4 and §4.3 are corrected in place under §0 and are not a solution record; Phase 1 stays unassigned and no baseline clause has been amended |

Nothing in this document establishes runtime compatibility, and no gate has been run. The measurements below stand;
several of the conclusions drawn from them on 2026-11-09 did not, and are corrected rather than deleted.

## 0. Corrections applied on owner review, 2026-11-10

Each correction names the sentence it supersedes. The original text is kept in place under a `SUPERSEDED by C-n`
marker so a reader can see what was claimed before and why it was wrong.

| id | Correction | Where |
| --- | --- | --- |
| C-1 | `take(n)` **changes the adopted one-input-per-entity-per-tick requirement**. Consuming more than one continuous frame for an entity in a tick is an amendment to [movement-authority.md §5.1 and §5.2](../../interfaces/movement-authority.md) and to the v0.2 §7.1 anti-cheat constraint, so it is a baseline/P03 amendment requiring an accepted ADR — not "configuration of declared options". §4.3 item 1 is superseded | §4.2, §4.3 |
| C-2 | PR-13's `simulated`/`applied` arrays are **probe bookkeeping, not an executed movement solver**. No locomotion step, integrator, collision query or authority code ran and no state field was advanced from an input value. What was measured is which frame identities a room read through a consume primitive inside a fixed-step callback, and what the client's watermark then retired. "Represented" in this document means *read in a step and logged*, which is a proxy for representation, not evidence of movement | §4 header, §4.1, §9 of the api map |
| C-3 | The sizing formula is a **necessary capacity consideration, not a sufficient guarantee**. It bounds mean arrival against mean consumption; it says nothing about bursts inside a sampling interval, jitter, a stalled tick, or a sender that is deliberately over-rate, and the library's ceiling is a per-second average that arrives after over-rate frames are already buffered | §4.2 "measured sizing rule" |
| C-4 | An obedient loopback sender (N6) and a disconnect that lands after eviction (N3, N4) **do not establish the required protection**. The first assumes the behaviour that needs enforcing; the second shows the violation occurring and then stopping. Neither demonstrates protection against a sender that does not comply | §4.1 N3/N4/N6 conclusions |
| C-5 | The claim that a larger budget is "exactly the work the current design already does when it drains on catch-up" is **removed**. The accepted contract forbids draining a burst and simulating only its last frame, and forbids moving a character repeatedly to empty a queue, so no such catch-up draining exists in the design to be continuous with | §5 impact, §4.2 N8 note |
| C-6 | Recorded during the Part A application, not by the owner: §3.3/§3.4 said the root test project "needs nothing", which is true of the Colyseus stack and misleading about repository policy, because that project has carried `skipLibCheck: true` since UDG-001 decision D1. Corrected in place; the confinement assertion in PR-0 names all three projects and their separate authorities | §3.3, §3.4, ADR-0002 |

The verdict of the measurements themselves is unchanged: no public mechanism refuses an over-quota frame, and
`clear()`, `seqField`, `sanitize()` and `drain()`-then-apply-latest all fail the prohibition. What changed is that
`take(n)` is presented as a **proposal to amend the rule**, with the amendment cost named, rather than as a
configuration choice available to a room.

Decision ID and title: ADR-P-0002 — confine `skipLibCheck` to the network-facing projects as an explicit declared
exception (Part A), and prevent unrepresented acknowledgement by sizing consumption to the admitted input rate
rather than by rejecting frames (Part B)

Owner and reviewers: Project owner (`TomBResearch`), as integration owner. The assistant investigated, measured and
recommends; it authors no approval.

Date: 2026-11-09

Affected task IDs and contract clauses:
[UDG-003](../../contracts/UDG-003.md) (Phase 0 blocker PH0-B1, Phase 1 authorisation),
[UDG-SPIKE-001](../../contracts/UDG-003.md),
[adoption D-8…D-13](../../contracts/adoption.md),
[movement-authority.md §5.1](../../interfaces/movement-authority.md),
[colyseus.md](../../integration/colyseus.md),
[api map](../../integration/colyseus-0.18-api-map.md) §0, §4, §5, §9,
[UDG-SPEC-M0-002 §7.2](../../specifications/UDG-SPEC-M0-002.md) (frozen widths, unaffected),
evidence record [UDG-003 Phase 0 completion](../../contracts/assignments/UDG-003-phase-0-completion.md) §9–§10.

---

## 1. Trigger and reproduction

### 1.1 What was asked

The owner's Phase 0 reviewer corrections left two narrowly scoped routes open, and asked for "concrete measured
options and a recommendation, not a request for the user to choose among untested remedies":

- **Route 1 — compiler-policy ADR candidate.** Evaluate `skipLibCheck: true` confined to the Colyseus
  integration projects as a *proposed* exception, while preserving strict first-party checking, `noImplicitAny`,
  the boundary rules, the DOM-globals prohibition, and the bans on dependency patches and suppression comments;
  keep the full declaration-error inventory as a separate diagnostic; demonstrate the five properties listed in
  §3.3; identify exactly which projects would need it; explain the residual risk accurately.
- **Route 2 — overflow/acknowledgement remedy.** With the current pins, determine by minimal Phase 0 probes
  whether a public, supported mechanism can prevent overflow retirement; prove bounded buffering; identify exactly
  which frames are consumed, neutralised, dropped and acknowledged; if no compliant mechanism exists, say so and
  propose the smallest required architectural decision. Forbidden as workarounds: an unbounded queue, private SDK
  state, fabricated acknowledgements, a custom prediction/input transport.

Authorised: scratch compiler experiments and minimal Phase 0 overflow probes. Not authorised: dependency changes,
compiler-policy adoption, authority implementation, Phase 1 work. Historical evidence preserved; upstream reports
drafted for review only (§7); no releases, tags or storage changes; D4 backup still open.

### 1.2 Pinned versions used for every measurement in this document

| package | version | note |
| --- | --- | --- |
| `@colyseus/core` | `0.18.27` | provisional pin under D-2 |
| `@colyseus/sdk` | `0.18.9` | provisional pin under D-2 |
| `@colyseus/ws-transport` | `0.18.4` | provisional pin under D-2 |
| `@colyseus/better-call` | `1.3.3` | transitive, carries 22 of the 27 declaration diagnostics |
| `@colyseus/schema` | `5.0.45` | ADR-0001 widths |
| `typescript` | `5.9.3` | the repository compiler; `5.8.3`, `6.0.3`, `7.0.2` measured in the api map §5.2 |
| `@types/node` | `24.19.2` | no global `HeadersInit` |
| Node / pnpm | `24.22.2` / `12.18.0` | runner |

Probe and CI evidence for Part B is the Phase 0 artefact of the run that includes
`apps/server/probes/pr13-overflow-policy.probe.ts` (20 checks). Compiler measurements in Part A are scratch
measurements (appendix A) and are deliberately **not** part of the repository build.

### 1.3 Reproduction

```bash
export PATH="$HOME/.local/bin:$PATH"
pnpm install --frozen-lockfile

# Part B: the overflow postures, as one probe of the Phase 0 suite
pnpm --filter @udg/server build:probes
node apps/server/probes/dist/probes/pr13-overflow-policy.probe.js --out /tmp/pr13.json
pnpm test:contract -- --task UDG-003

# The committed compiler gate, unchanged by this proposal
pnpm --filter @udg/server typecheck:probes   # exits 2: 27 third-party diagnostics, 0 first-party

# Part A: recreate the scratch configurations from appendix A, then
cd apps/server && npx tsc -p tsconfig.adr-strict.json    # 27 diagnostics, all third-party
npx tsc -p tsconfig.adr-skiplib.json                     # 0
npx tsc -p tsconfig.adr-misc-strict.json                 # 47: 27 third-party + 20 first-party
npx tsc -p tsconfig.adr-misc-skiplib.json                # 20: the same 20 first-party, 0 third-party
```

Exact PH0-B1 inventory (unchanged from the api map §5.1): 23 × `TS2304 Cannot find name 'HeadersInit'`,
2 × `TS2344 UnionToIntersection<MethodOptions<API, "DELETE">> …`, 2 × `TS1192 Module '"http"' has no default
export` — 27 diagnostics across six declaration files in four packages, **0 in repository code**.

---

## 2. The distinction this whole document turns on

`skipLibCheck` controls whether the compiler checks the **inside** of declaration files (`.d.ts`): whether a
declaration references names that exist, whether its own type algebra is well-formed. It does **not** control
whether the compiler checks **application calls against those declarations** — argument types, arity, property
names, assignability of results. Those are two different activities, and the difference is measurable:

| | defect inside a declaration | exported signature changed | call site misuses a declaration |
| --- | --- | --- | --- |
| committed policy | reported | reported | reported |
| `skipLibCheck: true` | **hidden** | reported | reported |
| consequence | a maintainer loses the only signal that the declaration is broken | nothing lost | nothing lost |

The one case where the difference bites is a declaration whose **exported** type names something unresolvable. The
type then degrades at the call site — and that degradation is already invisible today; `skipLibCheck` removes the
remaining warning. Appendix A.3 measures all three shapes.

---

## 3. Part A — the compiler-policy exception candidate

### 3.1 What the committed policy reports today

`apps/server/tsconfig.probes.json` under the committed policy: exit `2`, 27 diagnostics, **all** inside six
third-party declaration files, **zero** in repository code. `pnpm --filter @udg/server typecheck` (the accepted
`build` project) is clean, because it does not import the packages that carry the defects. PR-0 therefore reports
`blocked`, and `compatibility-verdict.json` keeps `stackCompatibility: "not-established"`. That posture is correct
and is not being relaxed by this document.

### 3.2 Measured effect of the candidate exception

| measurement (appendix A) | committed policy | with `skipLibCheck: true` |
| --- | --- | --- |
| probe project — third-party declaration diagnostics | 27 | **0** |
| probe project — first-party diagnostics | 0 | 0 |
| probe project + 19 negative fixtures — total | 47 | 20 |
| — of which first-party | 20 | **20, the identical set** |
| — of which third-party | 27 | 0 |
| `window.innerWidth`, `document.body`, `HTMLElement` | 3 errors | **3 errors** (no DOM globals appear) |
| invalid calls to the public API UDG actually uses (13 fixtures) | 13 errors | **13 errors** |
| first-party mistakes (bad return type, arity, undefined name, bad property) | 4 errors | 4 errors |
| resolved signatures over 752 first-party call expressions | baseline | **identical**; no first-party expression resolves to a type originating in any of the six defective declaration files; the count of `any`-typed first-party expressions is the same (48, all pre-existing, e.g. `JSON.parse`) |
| `@udg/protocol`, `@udg/protocol/schema`, no-Colyseus entries | 0 diagnostics | 0 diagnostics — **no exception needed** |

Two negative cases produce no diagnostic under **either** policy — `client.create(999)` and
`server.listen('not-a-port')` — because the pinned declarations accept them (`Client` is generic over an
unspecified server type, so `create`'s room name is unconstrained; `listen()` is rest-argument typed). This is
looseness in the upstream types that exists today and that the exception neither creates nor cures. It is one
reason the recommendation in §3.5 does not treat the compiler as the primary defence anywhere.

### 3.3 The five properties the owner asked to be demonstrated

| required demonstration | result |
| --- | --- |
| first-party type errors still fail | **yes** — 20 first-party diagnostics identical under both policies |
| invalid calls to actual public APIs used by UDG still fail | **yes** — 13 of 15 misuse fixtures error identically; the 2 that pass, pass under both policies (§3.2) |
| `window` / `document` remain unavailable | **yes** — `lib` is untouched by this candidate; `window`, `document`, `HTMLElement` all error under the exception |
| repository code does not acquire unchecked types through the affected declarations | **yes for the current probe tree** — 0 of 752 call expressions resolve to a type originating in the six defective files; origins are `Room.d.ts`, `Server.d.ts`, `input/types.d.ts`, `matchmaker/RegisteredHandler.d.ts`, `utils/Utils.d.ts`, `sdk/input/InputHandle.d.ts`, none of which is defective |
| protocol/config and unrelated workspaces retain current policy | **yes** — they need nothing: `@udg/protocol` and `@udg/protocol/schema` compile with 0 diagnostics under both option sets, so no exception is required in `packages/*`, `tools/*` or the root test project |

### 3.4 Exactly which projects would need the exception

Measured by compiling minimal entries under each project's own compiler options (appendix A.2). Counts are
third-party declaration diagnostics:

| entry (minimal real usage) | under server options (`lib ES2024`, `types: node`) | under client options (`lib ES2024 + DOM + DOM.Iterable`, `types: []`) |
| --- | --- | --- |
| no Colyseus import | 0 | 0 |
| `@udg/protocol` only | 0 | 0 |
| `@udg/protocol/schema` only (`@colyseus/schema` transitively) | 0 | 0 |
| `Room` + `defineRoom` + `setFixedTimestep` | 23 (22 `TS2304`, 1 `TS1192`) | 1 (`TS1192`) |
| `WebSocketTransport` | 24 | 2 |
| `defineServer` + transport (the real server entry) | 24 | 2 |
| `new Client(...)` from `@colyseus/sdk` | 26 (23 `TS2304`, 2 `TS2344`, 1 `TS1192`) | **3** (2 `TS2344`, 1 `TS1192`) |

Two consequences that matter more than the totals:

- the class-A `HeadersInit` diagnostics are an artefact of the **Node** lib choice, not of the client code: with
  the client's own `lib` (which already includes `DOM`), 22 of the 23 disappear. Only `apps/server` carries them
  in full;
- the class-C `TS2344` defect in `@colyseus/sdk/build/HTTP.d.ts` appears wherever `@colyseus/sdk` is imported,
  **in either option set**. So `apps/client`, once UDG-SPIKE-001 adds the prediction adapter, would need the
  exception for 3 diagnostics of its own.

So "confined to the Colyseus integration projects" is honest only if it means: **`apps/server` (both
`tsconfig.json` and `tsconfig.probes.json`) and `apps/client`, from the moment each imports the pinned network
stack** — that is, every project that talks to the network, which is most of the interesting code. It is not a
narrow exception; the accurate description is "declaration checking is off for the network-facing workspaces".

**Corrected on owner review (C-6), 2026-11-10:** the sentence above counts only projects that would acquire the
setting *from this candidate*. The repository already had one: the root tooling project `tsconfig.json` has carried
`skipLibCheck: true` since **UDG-001 decision D1**, because `playwright-core`'s declarations reference DOM types and
`vitest`'s default-imports `node:path`. So the accurate statement of the repository's policy after Part A is three
projects under two authorities — the two server projects under ADR-0002 and the root tooling project under UDG-001
D1 — and PR-0 asserts that exact set together with which authority each project cites.

### 3.5 Residual risk, stated accurately

1. **Upstream type regressions become invisible in the affected projects.** Measured directly: with
   `skipLibCheck: true`, an unresolvable exported type in a declaration produces no diagnostic at all, and the
   consuming first-party line reports nothing either — misuse of that API becomes silent (appendix A.3, case 2).
   Today the same defect is at least reported once per build, in the declaration.
2. **The repository's own emitted declarations are skipped too.** `skipLibCheck` applies to every `.d.ts`,
   including `packages/*/dist/*.d.ts`. Measured: an unresolvable name in a declaration file shaped like a
   first-party emitted declaration is reported under the committed policy and hidden under the exception
   (appendix A.3, case 3). Cross-package declaration mistakes in `@udg/protocol` would therefore also go
   unreported in the projects that consume them.
3. **PR-0's claim changes meaning.** Today PR-0 asserts "the pinned stack typechecks under the repository policy".
   Under the exception it can only assert "first-party code typechecks against the pinned declarations, and the
   declaration-error inventory is produced separately". That is a weaker claim, and adopting the exception without
   restating PR-0 would be exactly the category error D-9 corrected.
4. **Nothing is fixed.** The 27 diagnostics are upstream defects (api map §5.1, §5.2: every published pin in the
   range `core 0.18.20–0.18.27`, `sdk 0.18.6–0.18.9`, `ws-transport 0.18.2–0.18.4`, `better-call 1.2.1–1.3.3`
   carries them). The exception routes around them; it does not make the stack verified.
5. **Looseness in the pinned types remains** (§3.2), so some misuse is uncatchable by the compiler under either
   policy. UDG's typed wrappers plus contract tests, not the compiler, are the defence there.

Mitigations that must accompany any adoption: the declaration-error inventory stays a required, separately
reported diagnostic; the inventory diff (files × codes × counts) becomes a tracked artefact so a *new* upstream
error class is visible at review; `skipLibCheck` is permitted only in the two named project configs with a comment
naming this ADR; and it stays banned in `tsconfig.base.json`, `packages/*`, `tools/*` and the root test project.

### 3.6 Part A options and recommendation

| id | option | measured effect | verdict |
| --- | --- | --- | --- |
| A0 | keep the current posture: PH0-B1 stays blocked, escalate upstream | PR-0 stays `blocked`, `not-established`; Phase 1 stays unauthorised | **recommended** |
| A1 | ambient `HeadersInit` declaration shipped by UDG | 27 → 4 | does not clear PH0-B1; adds a UDG-owned global shim; only worth revisiting if upstream confirms the DOM-global dependency |
| A2 | `allowSyntheticDefaultImports` for the two `TS1192` | 27 → 25 | negligible, and it weakens module semantics for no gain |
| A3 | `lib: DOM` in the server projects | 27 → 4 | **rejected** — demonstrated to leak `window.innerWidth` and `fetch`; violates the DOM prohibition |
| A4 | `skipLibCheck: true` in `apps/server` + `apps/client` only | 27 → 0 there; 26 first-party diagnostics elsewhere unaffected | **available, not recommended now** — it is the only configuration short of a dependency patch that clears it, it demonstrably keeps checking first-party code and calls, and it carries residual risks 1–3. If adopted it must be adopted with the §3.5 mitigations, a restated PR-0, and this ADR Accepted by the owner. |
| A5 | dependency patch, vendored `.d.ts`, or pin change | none available | **rejected** — unauthorised, and no unaffected version exists (§1.2, api map §5.2) |
| A6 | TypeScript version change | `5.8.3` → 27; `6.0.3`/`7.0.2` → 25 and cannot read the config (`TS5107`, `TS5108`) | **rejected** |

**Recommendation: A0.** The exception works as measured — but adopting it now buys a green compiler gate for a
stack whose behavioural blockers (D-7, and the input-backlog posture in Part B) are unresolved and unaffected by
it. The honest sequence is: escalate upstream (§7), decide Part B, authorise Phase 1 on the recorded
`not-established` posture with the inventory diagnostic in place, and adopt A4 only when it stops being a way to
make a gate look better — for example when an upstream fix lands partially and only one defect class remains.

---

## 4. Part B — PR-13: can a supported mechanism prevent unrepresented retirement?

> **Not approved as the backlog solution (owner, 2026-11-10).** The measurements in this part stand; four of the
> conclusions drawn from them did not. `SUPERSEDED by C-n` markers are placed on the sentences concerned, and §0
> carries the corrections. The replacement recommendation is
> [UDG-003-input-consumption-rule.md](UDG-003-input-consumption-rule.md). Nothing in this part is adopted, and no
> baseline clause has been amended.

### 4.1 The question, restated after PR-8

PR-8 proved that overflow eviction counts as consumption, so an evicted frame is acknowledged exactly like an
applied one, and that the acknowledgement is a send-order watermark with no per-frame disposition. The remaining
question is preventive: with the pins, using public API only, can a room keep the buffer from ever retiring a
frame it did not represent?

PR-13 (`apps/server/probes/pr13-overflow-policy.probe.ts`, 20 checks, all passing, plus
`OverflowRoom` in `apps/server/probes/rooms.ts`) measures nine postures. Two identity sets decide it, computed the
same way in every scenario:

- `ackedUnrepresented` — sent frames whose sequence the client's `lastProcessed` retires although their values
  never entered a solver step. Non-empty **is** the violation.

> **SUPERSEDED by C-2 (vocabulary).** "Entered a step" and "simulated" in this part mean **read by the probe room
> inside its fixed-step callback, and logged**. No locomotion step, integrator, collision query or authority code ran,
> and no state field was advanced from an input value. The results therefore decide which mechanisms exist and what
> they do to frame identities; they do not decide state correctness, and the phrase "solver step" overstates what was
> observed. See [the recommendation's §1.3](UDG-003-input-consumption-rule.md) and its §4.1 for the real-state probe
> that would be required.
- `unackedUnrepresented` — frames that vanished without acknowledgement: the honest residue a reconnection has to
  resolve.

Local run used for the numbers below (`/tmp/pr13.json`; CI artefact is authoritative; counts of individual
generations shift slightly with timing, the direction does not):

| scenario | posture | peak backlog (bound 4) | `ackedUnrepresented` | `unackedUnrepresented` | disconnect | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| N1 | none, sender every 5 ms | 4 | 8 of 14 acknowledged | 0 | — | the failure, reproduced; the bound held |
| N2 | `InputAccessor.clear()` at threshold 3 | 4 | 14 (`consumedCount` 10 → 14) | 0 | — | **not a remedy**: it moves the same watermark |
| N3 | `Client.leave(4008)` at threshold 3 | 4 | 3 | 5 | yes, code 4008 | watermark froze at 3 of 8 sent, but the 20 Hz tick acted **too late** for a 5 ms sender — **C-4**: this is the violation happening and then stopping, not protection |
| N4 | `Room.maxMessagesPerSecond = 40` vs a ~200/s sender | 4 | 29 | — | yes, code 4002 | cuts the offender off; a ceiling above the consume rate still permits growth |
| N5 | `defineInput(…, { seqField: 'generation' })` | 4 | 9 | 0 | — | acknowledgement is still a send-order watermark |
| N6 | `Room.send(client, 'udg-backlog', …)` + sender stops on signal | **2** | **0** | **0** | none | ~~**prevention**, with 0 frames sent inside the signal window at loopback~~ **SUPERSEDED by C-4**: an obedient loopback sender assumes the behaviour to be enforced, at zero round trip |
| N7 | `drain()` then step the newest frame | 3 | 13 (3 drained without a step) | 0 | — | **rejected**: this is precisely the ack jump the pinned declarations warn about |
| N8 budget 1 | `take(1)` per 20 Hz step vs a 40/s sender | 4 | 8 | 0 | none | under-sized budget makes eviction unavoidable |
| N8 budget 3 | `take(3)` per 20 Hz step vs the same 40/s sender | **2** | **0** | **0** | none | ~~**prevention**: every acknowledged frame entered a step, all 24 sent frames simulated~~ **SUPERSEDED by C-1/C-2**: 0 unrepresented at this rate, achieved by consuming more than one frame per entity per tick, which amends the adopted one-input rule; and "simulated" means read-and-logged |
| N9 | `defineInput(…, { sanitize })` | 4 | 9 | 0 | none | the only admission-time hook: `(input) => void` can rewrite, cannot refuse; the overflow path still dropped frames |

### 4.2 What the table says

1. **No in-buffer or in-declaration mechanism prevents the violation.** `clear()`, `seqField` and `sanitize()` do
   not touch the eviction path, and no `InputAccessor` or `InputHandle` member withholds, retracts or qualifies an
   acknowledgement (PR-8).
2. **Rejection before retirement is not available.** The only admission-time hook is `sanitize`, and its type is
   `(input: I) => void`: it can neutralise a frame's values but cannot refuse it. There is no "return false" to
   return. A room therefore cannot refuse an over-quota frame at admission.
3. **A per-tick threshold is enforcement, not prevention.** Arrivals between two 20 Hz steps overran the whole
   buffer before the tick could sample it (N3, N4): the disconnect correctly freezes the watermark and leaves an
   explicitly unacknowledged residue, but frames were already acknowledged without a step.
4. ~~**Prevention comes from matching consumption to the admitted rate.**~~ **SUPERSEDED by C-1.** With `take(n)`
   and `n ≥ ceil(arrivalRate / stepRate)` nothing is retired — but `take(n)` with `n > 1` **changes the adopted
   one-input-per-entity-per-tick rule** ([movement-authority §5.1](../../interfaces/movement-authority.md), v0.2 §7.1
   anti-cheat constraint), so this is a price list for a baseline amendment and not a posture a room may adopt. The
   baseline-preserving route is the other direction: match **admission** to consumption by admitting no more continuous
   frames per entity than there are ticks, which makes the adopted rule self-draining. The library's own declaration comment says the same thing for a shared world: *"`next()`
   exactly one input per entity per tick (or `take` a bounded few and sub-step the solver per input). The ack then
   === inputs actually simulated; `drain()`-then-apply-latest would silently jump the ack past inputs the server
   never simulated."* N7 measures that warning rather than quoting it.
5. **Buffering stayed bounded in every scenario** — the declared bound never overflowed — so the problem was never
   buffer growth; it is what becomes of what the bound drops.

**Capacity condition — necessary, not sufficient (C-3)** (from N8's two points, N4 and N3; not a rate sweep, and
no claim about bursts inside a sampling interval, jitter, a step that overruns `dt`, or a deliberately over-rate
sender):

```
minimumBudget  n ≥ ceil(admittedArrivalRate / stepRate)
bufferMaxSize  ≥ n + jitter headroom + signal round-trip headroom
maxMessagesPerSecond ≤ n × stepRate        // so an offender is cut off, not accommodated
```

### 4.3 The smallest architectural decision this implies

Four items, none of which requires a library change, an unbounded queue, private state, a fabricated
acknowledgement or a custom transport:

1. ~~**An admitted input rate per session**, held server-side, with the per-step consume budget derived from it
   (`take(n)`). This is the change that actually prevents the violation.~~ **SUPERSEDED by C-1**: the admitted-rate half
   stands; the derived `take(n)` budget does not, because it amends the one-input rule. The corrected item is: declare
   an admitted arrival rate per entity **equal to the step rate**, and keep the budget at one.
2. **`bufferMaxSize` derived** from the declared rate plus measured jitter and overrun headroom, so a compliant sender
   cannot reach eviction. Then an overflowing buffer *means* an offender, which is what makes item 3 legible. **C-3**:
   the headroom numbers are not measured yet, so this item is a formula without values until the jitter and
   overrun tests exist.
3. **One deterministic consequence for an offender** — either `Room.maxMessagesPerSecond` plus a reserved close
   code, or an explicit server backlog signal the client is required to obey (N6). The owner chooses. Whichever is
   chosen, the consequence must be recorded in the protocol as "frames were sent that the server will never
   represent", because a cut-off still arrives after some frames have been acknowledged without a step (N3, N4).
4. **An explicit client state for that consequence**: resynchronise from authoritative state; never replay the
   unacknowledged frames as though they had been represented.

~~Items 1–2 are configuration of declared options plus one consume primitive~~ **SUPERSEDED by C-1**: with the
budget fixed at one, items 1–2 are configuration only, and no consume-primitive change is involved. Items 3–4 are
protocol and client-state additions and therefore belong to the Phase 1/2 design, not to a room-local hack.

### 4.4 What the SDK proves, and what UDG-SPIKE-001 must still prove

**The pinned SDK proves** (server-side, public API, loopback):

- that a consume budget matched to the admitted rate leaves no frame both acknowledged and unrepresented, with
  buffering bounded (N8);
- that `clear()`, `seqField`, `sanitize()` and `drain()`-then-apply-latest do **not** satisfy the prohibition
  (N2, N5, N9, N7);
- that a rate ceiling or a threshold disconnect stops the watermark from lying after the cut and leaves an
  explicitly unacknowledged residue (N3, N4).

**UDG-SPIKE-001 must still prove** (nothing in PR-13 observes client reconciliation, and no journal or room log is
evidence of it):

- that a client which had been predicting from a cut-off session converges to authoritative state after reconnect;
- client behaviour under loss and reconnection, where pending frames outlive the seat (the `unackedUnrepresented`
  identities) and must not be replayed as though acknowledged;
- that the admitted rate and budget hold with real latency, jitter and multiple sessions, and that a modified
  client cannot exceed the admitted rate without the ceiling or threshold reacting;
- that the signal posture still holds when the round trip consumes headroom (N6 measured a loopback window of
  0 frames; a real window is non-zero).

**D-7 is unchanged by Part B.** The acknowledgement itself still cannot distinguish applied from refused from
drained; the remedy measured here is not a better acknowledgement but a posture in which the acknowledgement is
never asked to make that distinction. D-7 remains the owner's decision, with §9.2 of the completion record and
PR-13 as its evidence.

---

## 5. Impact if Part B is accepted

- **Compatibility/migration.** No dependency change; no wire-format change in items 1–2; item 3 adds either a
  reserved close code or one server→client message, and item 4 adds one client state; both are additive to
  `PROTOCOL_VERSION` only if the owner chooses the signal variant. The frozen widths of ADR-0001 are untouched.
- **Performance.** Under the corrected recommendation the budget stays at one frame per step, so work per step is
  unchanged and no sub-stepping is introduced. ~~with `n = 2…3` at 20 Hz this is bounded work per step and is exactly
  the work the current design already does when it drains on catch-up~~ **removed by C-5**: the accepted contract
  forbids draining a burst and simulating only its last frame, and forbids moving a character repeatedly to empty a
  queue, so there is no catch-up draining in the design for a larger budget to be continuous with. A multi-input
  posture would add work that the baseline does not currently do, and would have to price it.
- **Security/abuse.** The rate ceiling and the backlog threshold become explicit, testable limits rather than an
  emergent eviction behaviour. No credential or token is involved; disconnect codes are not secrets.
- **Determinism/server authority.** Unchanged: the server still owns transforms, and inputs are still consumed
  inside the fixed step.

## 6. Decision requested, and what happens next

Owner decisions requested, in order:

1. **Part A**: ~~accept **A0** (keep PH0-B1 blocked, escalate upstream, keep `not-established`) — or accept **A4**
   with the §3.5 mitigations and a restated PR-0. A3, A5, A6 are recommended for rejection.~~ **Decided 2026-11-10: A4,
   for `apps/server/tsconfig.json` and `apps/server/tsconfig.probes.json` only**, recorded as
   [ADR-0002](../0002-server-declaration-checking-exception.md). `apps/client` was expressly excluded.
2. **Part B**: ~~accept items 1–2 (admitted rate + derived `take(n)` budget + derived `bufferMaxSize`) as the UDG
   posture, and choose between the two offender consequences in item 3.~~ **Not approved (owner, 2026-11-10)**, with
   five corrections in §0. The focused replacement — whether the one-input rule survives, which clauses a multi-input
   rule would amend, what it must conserve, and the real-state and adversarial evidence required first — is
   [UDG-003-input-consumption-rule.md](UDG-003-input-consumption-rule.md), which is also unapproved and assigns no work.
3. **Phase 1 authorisation** on that basis, still carrying `stackCompatibility: "not-established"` and the
   declaration-error inventory. No newer pins exist (api map §5.2), so "wait for upstream" and "authorise on the
   provisional pins with the inventory diagnostic" are the only real alternatives. **Still requested: Phase 1 remains
   unassigned**, and ADR-0002 did not authorise it — it changed a compiler policy, not the compatibility finding.
4. **D-7** — unchanged, still open; and **D4** (backup destination), still undesignated.

Required updates if accepted: restate PR-0 only if A4 is accepted (its claim surface changes); record the accepted
posture in [movement-authority.md](../../interfaces/movement-authority.md) and [colyseus.md](../../integration/colyseus.md); a new
pinned Phase 1 assignment record **before any code**; Gate A stays Not Run. Neither part affects the boundary rule
table, the protocol widths, or Gates B and C.

Evidence links: PR-13 in the Phase 0 probe artefact (`probes/PR-13.json`, `probes/PR-13.result.json`,
`runner/probe-run-index.json`) and the UDG-003 contract suite (`PR-13` describe block); api map §9 (PR-13 findings)
and §10 (compiler candidate); completion record §10.

Supersedes or is superseded by: Part A is **Accepted** as [ADR-0002](../0002-server-declaration-checking-exception.md)
for two named projects and Part B is **Not approved**; the Part B recommendation is superseded by
[UDG-003-input-consumption-rule.md](UDG-003-input-consumption-rule.md). The measurements, appendix A and the unpublished
upstream report drafts in appendix B are retained and are not rewritten.

---

## Appendix A — scratch compiler measurements (not part of the repository build)

All scratch files live outside the committed tree and are deleted after measurement; the scratch `tsconfig` files
extend `../../tsconfig.base.json` and must therefore sit inside `apps/server`. `tsc -p` with a config outside
`apps/server` fails with `TS2688`/`TS6059`, which is why they were never moved to `/tmp`.

### A.1 The four configurations

```jsonc
// tsconfig.adr-strict.json — the committed policy, probe tree
{ "//": "scratch: probe project under the committed policy",
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": ".adr-scratch/dist-strict", "rootDir": ".", "lib": ["ES2024"], "types": ["node"] },
  "include": ["probes/**/*.ts"], "exclude": ["probes/dist", "node_modules", "dist"] }
// tsconfig.adr-skiplib.json — identical plus "skipLibCheck": true
// tsconfig.adr-misc-strict.json / -skiplib.json — identical, "include": [".adr-scratch/**/*.ts"]
```

### A.2 The negative fixtures (19 numbered cases, three files)

`first-party-error.ts` — a `number` returned where `string` is declared; a two-parameter call with one argument;
an undeclared name; a property access on the wrong object.

`dom-probe.ts` — `window.innerWidth` and `document.body` typed as `HTMLElement`.

`calls-colyseus.ts` — fifteen wrong calls against the API surface the api map records, with the misused values
arriving as parameters so that no cast is needed:

```ts
this.setFixedTimestep('50', () => {});              // 1   rate must be numeric        ✗ caught
const accessor = this.inputs?.get(42);               // 2   sessionId must be string    ✗ caught
this.defineInput(new DirectInputSchema());           // 3   wants a constructor         ✗ caught
void this.allowReconnection('not-a-client', 10);     // 4   wants a Client              ✗ caught
this.autoDispose = 'yes';                            // 5   wants a boolean             ✗ caught
this.state.players.set('k', 'not-a-player');         // 6   wrong value type            ✗ caught
void defineRoom(new ProbeRoom());                    // 7   wants a class               ✗ caught
void new Client(42);                                 // 8   wants a URL                 ✗ caught
void client.create(999);                             // 9   wants a room name           ○ caught by NEITHER policy
void registerSerializer(SchemaSerializer);           // 10  wants (id, serializer)      ✗ caught
void new WebSocketTransport('fast');                 // 11  wants options               ✗ caught
void server.listen('not-a-port');                    // 12  wants a numeric port        ○ caught by NEITHER policy
void defineServer({ rooms: 'nope' });                // 13  wants a handler list        ✗ caught
handle.data.generation = 'one';                      // 14  field is numeric            ✗ caught
room.setState('nope');                               // 15  wrong state type            ✗ caught
```

`✗ caught` means it errors under **both** policies, which is the property the owner asked to be preserved.

### A.3 Mutation experiments (isolated `/tmp` projects, no repository dependency touched)

1. **Defect inside a declaration, exported signature sound** — a package whose `index.d.ts` exports
   `step(intervalMs: number, cb: (ctx: { dt: number }) => void)` plus an internal `internal.d.ts` using an
   unresolvable `HeadersInit`. Committed policy: 3 diagnostics (1 declaration + 2 call-site mistakes). With the
   exception: 2 — exactly the call-site mistakes. *The exception hides the declaration's own error and keeps
   checking calls.*
2. **Defect on the exported type** — `export declare function readInput(): Bufferish;` where `Bufferish` is never
   declared. Committed policy: 2 declaration diagnostics, and the misusing lines
   (`const asNumber: number = readInput()`) already report nothing, because the type has degraded. With the
   exception: 0 diagnostics, exit 0. *This is the residual risk in one measurement.*
3. **A repository-shaped emitted declaration** — `src/emitted.d.ts` declaring
   `export declare const region: Regionish;` consumed by a first-party file. Committed policy: 1 diagnostic.
   With the exception: 0, and the consuming line still reports nothing. *First-party emitted declarations are
   skipped too.*
4. **Per-import entry table** — appendix A.1 configurations re-pointed at minimal single-purpose entries
   (no import, `@udg/protocol`, `@udg/protocol/schema`, `Room` + `defineRoom`, `WebSocketTransport`,
   `defineServer` + transport, `new Client`, `client.create(...).input()`), compiled under the server option set
   and the client option set. Results in §3.4.
5. **Type-fidelity comparison** — the TypeScript compiler API over the probe project under both policies,
   recording every call expression in first-party probe code with its resolved signature and the declaration files
   its symbol originates from: 752 call expressions, identical signature sets, 0 expressions resolving to a type
   originating in the six defective files, identical `any`-expression count (48, all pre-existing `JSON.parse` and
   library-`any` sites). The API program also pulls previously emitted `probes/dist/**/*.d.ts` into the program, so
   its diagnostic totals are not the gate numbers in §3.1; the comparison, not the totals, is the result.

## Appendix B — upstream report drafts (for review only; **not published**)

Two reports, one per defect class that UDG cannot work around. No issue has been opened against any repository;
nothing below has been sent. Titles and bodies are drafts for the owner's review, and the reproduction is a
single `tsc` invocation against the published tarball, not a UDG checkout.

**Draft B-1 — `@colyseus/better-call`, `@colyseus/core`, `@colyseus/ws-transport`: declarations reference
DOM/node globals that are not available to a Node-only consumer (23 × `TS2304`, 2 × `TS1192`).**

> Publishing `@colyseus/better-call@1.3.3` `dist/context.d.mts`, `dist/endpoint.d.mts` and `dist/error.d.mts`,
> `@colyseus/core@0.18.27` `build/router/node.d.ts` and `@colyseus/ws-transport@0.18.4`
> `build/WebSocketTransport.d.ts` produce 23 `TS2304 Cannot find name 'HeadersInit'` and 2
> `TS1192 Module '"http"' has no default export` in a consumer that compiles with
> `lib: ["ES2024"], types: ["node"]` — which is the normal configuration for a headless multiplayer server.
> `HeadersInit` is a DOM global; `@types/node` does not declare it globally and `undici-types` exports it only as
> a module member. `import http from 'http'` needs `esModuleInterop`/`allowSyntheticDefaultImports`, which a
> declaration file cannot require of its consumers. Reproduce: install the three packages, add one file containing
> `import { Room } from '@colyseus/core'`, run `tsc --noEmit` with the options above. Requested fix: reference the
> types explicitly (`globalThis.Headers` or an imported type) and use `import * as http from 'node:http'` in
> emitted declarations, or document the `lib`/`esModuleInterop` requirement. Impact: any strict Node-only consumer
> cannot typecheck; this is the reason UDG-003 Phase 0 keeps `stackCompatibility: "not-established"`.

**Draft B-2 — `@colyseus/sdk@0.18.9` `build/HTTP.d.ts`: `TS2344` inside the package's own exported types.**

> `build/HTTP.d.ts` reports 2 × `TS2344: Type 'UnionToIntersection<MethodOptions<API, "DELETE">>' does not satisfy
> the constraint …` when the package is typechecked as published — the defect is internal to the shipped
> declaration and appears for any consumer, in both a DOM and a Node `lib` configuration. Reproduce: install
> `@colyseus/sdk@0.18.9`, one file containing `import { Client } from '@colyseus/sdk'`, `tsc --noEmit` under the
> repository's strict options. Requested fix: constrain the mapped type for the `DELETE` method options.
> Impact: this defect is what makes the count non-zero even for a DOM-lib client, so it is the one that determines
> whether `apps/client` needs an exemption.

Both drafts omit credentials, internal paths and any UDG gameplay detail; they carry the version table from §1.2.
