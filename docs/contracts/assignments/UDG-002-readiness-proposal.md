# UDG-002 readiness proposal

Prepared 2026-11-08 for integration-owner review, after UDG-001 was accepted and set Verified.

**What this document is.** A single consolidated proposal covering the decisions, assignment shape, tooling
changes and record-keeping needed before UDG-002 can be made Ready. It is non-normative: it records no
approval, adopts nothing, assigns nothing and authorises no implementation. Like the Appendix B1/B2 records
it sits under `docs/contracts/assignments/`, which the checksum manifest excludes by path
(`docs/contracts/checksums.json` → `excluded`), so it is not part of the edition-controlled contract set and
it pins its own commits.

**What this document is not.** It is not a questionnaire. Routine preparation choices are resolved with a
recommendation and a reason. Genuine owner decisions are collected in section 7 and nowhere else.

Repository state at authoring: `main` = `524658e1fb4c53a450cdf933886c7ad4b17c72e9` (acceptance commit), clean.
P01 Approved. **P02 to P10 Pending. UDG-002 Not Started and unassigned.** Gates A, B and C Not Run.

---

## 0. Gate mapping correction (owner-confirmed, repo text is correct)

Gate A is validated by **UDG-SPIKE-001**, which requires UDG-003 and UDG-004 Verified
([UDG-SPIKE-001.md](../UDG-SPIKE-001.md) "Gate A acceptance and evidence"; "Requires Verified 003 and 004").
**UDG-SPIKE-002** validates **Gate B** ("Gate A still valid" as a prerequisite, evidence `gate-b.md`), and
**UDG-SPIKE-003** validates **Gate C**. An earlier statement in the UDG-001 review conversation — "Gate A needs
UDG-SPIKE-001…003" — was wrong. No contract file says that, so no documentation correction is required; the
correction is recorded here so the wrong mapping cannot be inherited by a later record.

Consequence for this proposal: nothing in UDG-002 is gate-bound. Gate A depends on UDG-002 only transitively
(002 → 003/004 → SPIKE-001).

---

## 1. Proposed P02 — protocol surface, mapping, bounds, sentinels

Recommendation: **adopt P02 as drafted below** (it is the contract text of
[interfaces/protocol.md](../../interfaces/protocol.md) §4.2–4.4 with the four gaps closed), with no ADR, and
with the one P03 overlap in 1.4 acknowledged explicitly.

### 1.1 Wire envelope and validation bounds

| Field | Type | Bound / domain | Rejection |
| --- | --- | --- | --- |
| `sessionEpoch` | uint32 | server-issued, `1 … 4 294 967 295`; `0` reserved as "no epoch" | `EPOCH_MISMATCH` on unknown/stale/old-epoch |
| `generation` | uint32 | `0 … 4 294 967 294`; `0` legal only for the neutral initial frame | `INVALID_GENERATION` |
| `directIntent` | boolean | required, no default | `INVALID_PAYLOAD` when absent |
| `moveX`, `moveZ` | float64 | finite, `[-1, 1]`; normalise only when horizontal length > 1 | `INVALID_PAYLOAD`; raw sample → zero movement for that sample |
| `requestId` | string | 1–64 chars, `[A-Za-z0-9_-]+`, ASCII only | `INVALID_PAYLOAD`; same id + different payload → `REQUEST_ID_CONFLICT` |
| `x, y, z` (MoveTo) | float64 | finite; inside region bounds from validated config (see 1.5) | `INVALID_DESTINATION` / `OUT_OF_BOUNDS` |
| join `protocolVersion`, `configHash`, `manifestHash` | string | versions ≤ 32 chars; hashes 64 lowercase hex | `PROTOCOL_MISMATCH` / `CONFIG_MISMATCH` / `ASSET_MISMATCH` |

Closed rules that P02 fixes: non-finite and out-of-range inputs are **rejected or neutralised, never clamped**;
`directIntent: false` with non-zero axes is invalid and neutralised; rejected samples do not advance
generation; unknown fields in application messages are rejected; no client position, speed, elapsed time,
route, authoritative tick or client sequence counter is accepted; UDG epoch/generation stay distinct from SDK
sequence state.

### 1.2 Complete replica mapping (bidirectional, `mapping/{to-replica,from-replica}.ts`)

| Replica field | Canonical source | Encoding | Note |
| --- | --- | --- | --- |
| `entityId` | server-assigned identity | string ≤ 64 ASCII | map key of the player map |
| `x`, `y`, `z` | `locomotion.kinematic.position` | float64 ×3 | no client-side write path |
| `yaw` | radians about Y | float64 | normalised to `[-π, π)` before encoding |
| `vx`, `vy`, `vz` | resolved displacement ÷ `dt` | float64 ×3 | *result* velocity, includes snap/step effects |
| `verticalVelocity` | integrator scalar carried into gravity integration | float64 | distinct from `vy`; **both** replicated and restored |
| `grounded` | contact after the completed step | boolean | |
| `movementMode` | `idle 0`, `direct 1`, `path 2` | uint8 | unknown enum value → reject at decode |
| `routeRevision` | active revision | uint32 | **`0` means no route** |
| `nextWaypointIndex` | active index | uint32 | **`0` when no route** |
| `intentGeneration` | highest admitted intention | uint32 | |
| `sessionEpoch` | current application epoch | uint32 | |
| `connected` | authoritative presence | boolean | |
| `lastAuthorityTick` | tick that produced player state | uint32 | |
| Region: `worldId`, `regionId` | fixed `world-001`, `region-greybox-001` | string ≤ 64 | |
| Region: `serverTick`, `protocolVersion`, `configVersion`, `configHash`, `manifestHash` | server-owned | uint32 / ≤32-char strings / 64-hex hashes | server-private session↔entity map is **not** replicated |

Recommendation: the mapping test asserts the set is **complete and closed** — a table-driven test that fails
when a replica field exists in the schema but not in the map, and vice versa, rather than only checking the
fields it knows about. Route points stay server-only and are never reconstructed from a replica in path mode.

### 1.3 Sentinels, zeros and canonicalisation

- **Null-to-zero route sentinel**: absence is encoded as `0` in `routeRevision`/`nextWaypointIndex`; the
  domain side decodes `0` back to "no route". `null` never crosses the wire.
- **Result contract**: `appliedTick` is `null` on rejection; `routeRevision` is `null` for cancel and
  rejection; `accepted: true` means the mode change committed at `appliedTick`, not that it was queued.
- **Signed zero (recommended, currently unspecified)**: validators normalise `-0` to `+0` for axes, positions
  and velocities, so `-0` cannot create a spurious "changed state" diff or a non-reproducible hash.
- **Non-finite values never enter the domain**: `NaN`/`±Infinity` are rejected at the boundary; fixtures may
  inject them via tagged objects (`{"number":"NaN"}`) and direct binary, and the wire-negative path must not
  be weakened because JSON cannot express them.
- **Hash canonicalisation** (UDG-002 contract): UTF-8, sorted object keys, array order preserved, finite JSON
  values only, SHA-256, lowercase hex.
- **Integer safety**: values must be integers within the declared width; `Number.MAX_SAFE_INTEGER` is not a
  substitute for `uint32` bounds; overflow of tick/revision stops and renews the room instead of wrapping.

### 1.4 The one governance overlap

The forward-gap rule (`admit a generation gap of at most 64`, otherwise `RESYNC_REQUIRED` without raising the
watermark) lives in P02's text but the number is also named by **P03** ("generation window", required before
UDG-003 Ready). Recommended handling: P02 adopts it as a **protocol-level constant and rejection code** —
`limits.maxGenerationForwardGap = 64` plus `RESYNC_REQUIRED` in the closed `RejectionCode` union — while the
**admission policy** (watermarks, gap behaviour, ordering) is exercised by UDG-003 under P03, which should
confirm `64` unchanged. UDG-002 must not implement admission logic.

### 1.5 Conflict analysis against baseline v0.2

No conflict for P02. Where it looks close:

| v0.2 clause | Relation to P02 |
| --- | --- |
| §4 input `generation` is "a per-session ordering hint, not a trusted authority claim. The server MUST enforce bounds, monotonicity and validity" | P02 supplies exactly those bounds. Elaboration, not change. |
| §5.2 held input does not increment generation every frame; higher generation is a newer intention the server may refuse | Consistent with flat `directIntent` semantics. |
| §5 "if two conflicting operations have the same generation the server MUST resolve them with a documented deterministic priority (direct cancels path)" | Ordering, owned by UDG-003/P03. UDG-002 only declares the codes (`SUPERSEDED`, `REQUEST_ID_CONFLICT`). |
| §7.2 "input epoch resets must follow the SDK's contract… the integration spike will establish" | P02 must state that epoch **renewal mechanism** is proven in UDG-003/SPIKE-001 and is not assumed here; P02 fixes only the numeric domain and the no-wraparound rule. |
| Region bounds for `OUT_OF_BOUNDS` | **Open, not conflicting**: neither v0.2 nor the contracts give numeric extents. Recommendation: `packages/config/src/region.ts` (owned by UDG-002) declares the extents derived from the `region-greybox-001` asset geometry, includes them in `configHash`, and the validator reads bounds from validated config — never a hardcoded constant. Recorded as owner decision D6. |

**ADR for P02: not needed.** No baseline clause moves, no timestep, collision owner or protocol *shape*
changes; the P01 precedent ("No ADR: the rulings change no baseline clause…") applies. Record that reasoning
in the adoption row so the absence of an ADR is deliberate rather than an oversight.

---

## 2. Proposed P06 — precision, derived velocities, tolerances

Recommendation: **adopt P06 now in a deferred-freeze form, together with one ADR.** P06's deadline in
scope.md §1.3 is "Gate A freeze", i.e. a latest date, so adopting early is permitted; the reason to adopt early
is that UDG-002 cannot write a lossless mapping test without knowing the precision policy.

### 2.1 Policy

- The canonical domain uses JavaScript **float64 end to end**; the mapping is required to be lossless for the
  1.2 field set, so no lossy intermediate is introduced in UDG-002.
- **Schema encoding widths remain provisional until Gate A.** v0.2 §7.2 states "Precise Colyseus field types,
  encoding widths and additional predictor bookkeeping fields MUST be frozen during Spike 001", and
  protocol.md §4.4 says concrete schema builders are "frozen at Gate A after encode/decode tests". So UDG-002
  declares the policy plus a `provisional: true` marker in `docs/contracts/protocol-v1.md` and
  `protocol-field-map.json`, and proves the chosen width with a compiled room-free round-trip probe against
  the pinned schema package. If the pinned schema cannot carry a 64-bit float for a field, the implementer
  records what it *does* carry and escalates per [docs/adr/README.md](../../adr/README.md) — no invented
  decorator, no silent float32 downgrade, no weakened assertion.
- **Derived velocities**: `vx, vy, vz` = resolved displacement ÷ `dt` (`dt = 0.05 s` exact, v0.2 default);
  `verticalVelocity` = the scalar carried into gravity integration. Both are replicated and both restored; the
  mapping test round-trips `verticalVelocity` explicitly, because omitting it is the known failure mode.

### 2.2 Tolerances (what UDG-002 may assert)

| Context | Tolerance | Basis |
| --- | --- | --- |
| Wire/mapping round trip of any replicated scalar | **exact equality** (`Object.is` on finite values, after `-0` → `+0`) | a copy is not an approximation; any drift is a defect |
| Pure-simulation derived quantities inside UDG-002 fixtures (velocity from displacement ÷ 0.05, axis normalisation, yaw wrap) | **1e-9** absolute per axis and per m/s | the only new number this document proposes: one multiply/divide by an exact power-of-ten-friend and one `sqrt` stay far below float64 noise at M0 magnitudes (≤ ~4 m, ≤ 4 m/s) |
| Anything physical, networked or interpolated | **none set here** | physics adoption `1e-5 m`, replay `1e-3 m`, flat travel `1e-6 m`, correction p95 `0.15 m`, penetration `0.02 m`, arrival `0.2 m` stay v0.2-owned or P10-owned ([acceptance-gates.md](../../validation/acceptance-gates.md)); P06 must not restate them as adopted |

### 2.3 Real conflict with v0.2, and the ADR recommendation

There **is** one genuine conflict, and it is procedural rather than numerical: adopting a float64 policy now
reserves a decision v0.2 explicitly reserves to Spike 001, and the ADR table lists "Protocol/schema/timestep
change → Integration-owner ADR and version plan".

Recommendation: accept **one ADR**, `docs/adr/0001-replica-precision-policy.md`, stating (a) the float64
canonical policy and lossless-mapping requirement are adopted early so UDG-002 is testable; (b) encoding
widths, schema constructors and predictor bookkeeping stay frozen at Gate A per v0.2 §7.2; (c) any later
precision change requires an ADR **and** reruns the correction and replay fixtures, which protocol.md §4.4
already demands; (d) P06 may only be revisited at Gate B by ADR, as scope.md §1.3 says. Adopting the ADR now
is cheaper than discovering at Gate A that the mapping tests were written against an unowned assumption.

---

## 3. Proposed UDG-002 assignment shape

### 3.1 Immutable prerequisite pins

```text
UDG-001 state                Verified (accepted 2026-11-08 by the project owner, TomBResearch)
Accepted implementation      1c735c2d845e399cc8b3cc33adac4ba7a6081387
Reviewed submission          0e586b619796597266f7ec4942d24231dfb5ce62
Acceptance commit            524658e1fb4c53a450cdf933886c7ad4b17c72e9   (CI 42513337055, 19/19 steps)
Prerequisite commit (B1)      the commit that records the owner's P02/P06 adoption; its full SHA must be
                              written into the assignment record at assignment time, together with this
                              proposal's commit as the reference document
Contract edition             UDG-CONTRACTS-M0-001 v1.0, repository edition 1 (unchanged)
Baseline spec                UDG-SPEC-M0-002 v0.2, sha256 b51e7afdd6810c377d2d2702d7673119521a59cd0d6b91686700bf9149b73fcf
Manifest at authoring        docs/contracts/checksums.json, 56 entries, file sha256
                              6ad6bdbb5540c38d6d142cc1e4f4bb78c76b36755803bb778c146a3c114474db
                              (unchanged by this proposal: docs/contracts/assignments/ is excluded)
```

### 3.2 Required commands (exact)

`pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` (the four root
commands per [repository.md](../repository.md) §3.2 plus the frozen install), then
`pnpm test:boundaries`, `pnpm test:fixtures`,
`pnpm test:contract -- --task UDG-002`, `pnpm contracts:checksums`, `pnpm dependencies:verify`, and
`pnpm evidence:capture -- --task UDG-002 --out artifacts --keep-going` followed by `pnpm evidence:verify`.
Unit suites, once they exist, run through `pnpm test` (see the `test:unit` grant in 3.3).

### 3.3 Additional controlled paths — grant list

Each grant authorises **the named edit only**. Granting a path does not authorise new behaviour, new commands,
new packages or new dependencies beyond the stated purpose; needing anything beyond it means Blocked plus an
ADR proposal, not a silent widening.

| Path | Purpose | Explicit limit |
| --- | --- | --- |
| `pnpm-lock.yaml` | record the schema dependency UDG-002 selects under clarification C-02 | only that dependency tree; no engine/SDK/transport/test packages |
| `docs/integration/dependencies.json` | register regeneration after the pin | provenance-exclusion behaviour and the seven `not-selected` groups for other owners stay intact |
| `package.json` (root) | wire `pnpm test:unit` at `tests/unit/` (UDG-001 completion limitation 4) | no new capability scripts; the five guarded later-task commands keep refusing |
| `vitest.config.ts` | include `tests/unit/**` | keep `passWithNoTests: false`, serial execution, junit-under-evidence wiring |
| `.github/workflows/ci.yml` | add the UDG-002 contract/fixture steps and include its evidence artefacts | keep the no-`continue-on-error` policy, pinned actions, `if-no-files-found: error` |
| `tools/checks/src/fixtures.ts`, `…/boundaries.ts`, `…/support.ts`, `…/index.ts` | fixture-layout extension (section 4) and the domain-no-schema boundary rule | verification stays a gate; no loosening of any existing rejection; UDG-001's own suite is not rewritten |
| `tests/checks/*.test.ts` (new) | tests for the tooling extension | new files only; `tests/contracts/UDG-001.test.ts` remains byte-stable as a Verified artefact |
| `docs/contracts/checksums.json` | regeneration as record maintenance | never hand-edited |
| `.env.example` | only if a documented config key needs a sample | recommend: not needed |

**Refuse in the assignment** (so the boundary is unambiguous): `docs/interfaces/**`, `docs/contracts/*.md`
except its own `docs/contracts/protocol-v1.md`, `docs/specifications/**`, any `@colyseus/core`/`@colyseus/sdk`
/`@colyseus/testing`/engine package, `apps/**`, and any Room, movement-execution, physics, navigation, input or
asset behaviour.

### 3.4 Acceptance criteria (measurable, contract text plus the additions above)

1. Every public export compiles from its supported package entry point; domain entry points import no schema
   runtime (enforced by the new `BOUNDARY-DOMAIN-NO-SCHEMA` rule, not by review).
2. Fixtures P01–P12 (`protocol/malformed.json`) and P13–P20 (`protocol/ordering.json`) each carry an expected
   rejection code; a passing negative test means the expected refusal with unchanged state, and never "it threw".
3. Boundary cases asserted: `±1` axes, diagonal normalisation, `0` / `4 294 967 294` / `4 294 967 295` and
   non-integer/unsafe-integer epochs and generations, 64- and 65-character ids, unicode ids, unknown/missing
   keys, malformed vectors, NaN/±Infinity via tag object **and** raw binary, sentinel `0` behaviour,
   `-0` normalisation.
4. Round trip preserves every 1.2 scalar exactly (including `verticalVelocity`) and rejects an incomplete map
   (schema field without a mapping entry fails).
5. Config: `configHash` changes on a single parameter change and is stable across repeated runs; a validated
   result is readonly and a source-fixture mutation cannot alter it; missing/non-finite/inconsistent config
   fails startup.
6. Tooling extension: `pnpm test:fixtures` validates both layouts and fails on an unrecognised layout (section
   4); boundary rule-table hash change is recorded in UDG-002 evidence, with the UDG-001 recorded hash left as
   history.
7. Evidence: `protocol-field-map.json`, `roundtrip-results.json`, `rejection-results.json`,
   `config-hashes.json`, the precision `provisional` marker, and root check logs, captured in a UDG-002 bundle
   that `pnpm evidence:verify` accepts.
8. Schema-constructor uncertainty is escalated to the networking owner as an ADR proposal; no fabricated API
   and no weakened validation to make a sample compile.

Reviewer and integration owner: project owner `TomBResearch`. Gate: Foundation, no gate pass claimed. Evidence
destination: `artifacts/UDG-002-<UTC>-<sha>/` plus the durable store of section 6; committed sanitised summary
`docs/contracts/assignments/UDG-002-evidence.json`.

---

## 4. Fixture layout: recommendation and required tooling changes

**Fact.** [fixtures.md](../../validation/fixtures.md) §7.1–7.2 names **standalone JSON files**
(`protocol/malformed.json`, `protocol/ordering.json`, `input/parity.json`, …), and UDG-002's owned list matches
that. **Today's checker cannot see them.** `validateFixtures` (`tools/checks/src/fixtures.ts`) walks
`tests/fixtures/<group>/<directory>/fixture.json` and silently skips anything else, so contract-named
fixtures would go unvalidated while `pnpm test:fixtures` prints success. That is the same class of silent-pass
defect the UDG-001 CI correction removed, and it must not be closed by moving the contract's fixtures into a
shape the tool happens to like.

**Recommendation: extend the checker, fail closed.**

| ID | Change | Behaviour |
| --- | --- | --- |
| TC-1 | `validateFixtures` discovers two layouts | manifest directories (existing) **and** standalone `tests/fixtures/<group>/<name>.json` for the supported groups `protocol, input, network, physics, navigation, assets` |
| TC-2 | New committed catalog `tests/fixtures/catalog.json` | declares required fixture files/directories and their case ids (P01–P12, P13–P20, I01–I08, O01–O12, N01–N06, F01–F16, R01–R10, A01–A08 as their owning tasks add them). Missing required file → `FIXTURE-CATALOG-MISSING` |
| TC-3 | Envelope validation for standalone files | `fixtureVersion`, `fixtureId`, `configHash`, `seed`, `cases[]` with per-case `expect: rejection \| neutralisation \| disconnect \| movement`, `encoding: json \| binary`, `errorCodes[]` for negative cases. Unknown keys → `FIXTURE-ENVELOPE-UNKNOWN-KEY`, mirroring the protocol's own unknown-field rule |
| TC-4 | Hash pinning for both layouts | `catalog.json` carries `path` + `sha256` per entry; `pnpm test:fixtures -- --write` re-pins; a byte change → `FIXTURE-FILE-HASH` |
| TC-5 | Unrecognised layout is an error | directory inside a supported group without `fixture.json`, a `.json` at the fixtures root, or a file in an unknown group → `FIXTURE-LAYOUT-UNKNOWN`, listing the path. Nothing is skipped silently |
| TC-6 | Non-finite representation stays honest | a `movement`-expected case containing tagged `{"number":"NaN"}` fails as inconsistent; wire-negative coverage requires at least one `encoding: binary` case per protocol negative group |
| TC-7 | New tests in `tests/checks/fixture-layout.test.ts` | valid standalone protocol fixture passes; missing required case id fails; unknown envelope key fails; tampered hash fails; unknown layout fails; existing manifest-directory layout still passes; zero discovered fixtures still fails |
| TC-8 | Docs | README fixtures line and `docs/contracts/protocol-v1.md` describe both layouts. `docs/validation/fixtures.md` is edition-controlled and is **not** edited by the implementer |
| TC-9 | Boundary rule `BOUNDARY-DOMAIN-NO-SCHEMA` | `packages/protocol/src/domain/**` must not import `@colyseus/*` or `../schema/**`; one allow fixture plus one reject fixture; rule-table hash change recorded in UDG-002 evidence |

Scope note: TC-1…TC-9 are checker and fixture-record work, granted by the `tools/checks/**` and
`tests/checks/**` rows of 3.3; they add no runtime behaviour and no new root capability. Alternative
considered and rejected: making UDG-002 restructure its fixtures into manifest directories — it contradicts the
contract's named paths and hides the silent-skip defect. Alternative rejected: letting UDG-002 validate fixtures
only inside its own contract suite — then `pnpm test:fixtures` would keep reporting success over unvalidated
fixtures.

---

## 5. Deterministic manifest-digest procedure

**Problem.** The reviewed edition carries a recorded digest
`1b33cc20128ab75c59591448496164e30039018691e2a7d85ab21d7372926257` whose canonicalisation was never written
down, so it cannot be reproduced. Historical values must keep their provenance; they are not to be rewritten.

**Procedure D-1 (adopt by convention; needs no code).** Every adoption or record commit that changes the
manifest records three values together:

1. **Commit**: the full SHA of the commit containing `docs/contracts/checksums.json`.
2. **File SHA-256**: `sha256sum docs/contracts/checksums.json` — unambiguous, byte-exact, primary pin.
3. **Content digest**: SHA-256 of the UTF-8 bytes of
   `{"algorithm":"sha256","fileCount":N,"files":[["<path>","<hash>"], …]}` where entries are sorted ascending by
   repository-relative POSIX path (byte order of the UTF-8 path bytes), `JSON.stringify` with no whitespace, and
   `docs/contracts/checksums.json` itself excluded. Reproduce with:

```bash
node --input-type=module -e '
import {readFileSync} from "node:fs"; import {createHash} from "node:crypto";
const m = JSON.parse(readFileSync("docs/contracts/checksums.json","utf8"));
const files = Object.entries(m.files).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
console.log(createHash("sha256").update(JSON.stringify({algorithm:m.algorithm,fileCount:files.length,files})).digest("hex"));'
```

The file hash answers "is this the exact manifest I reviewed"; the content digest answers "did the covered
content move, independent of formatting or key order". A formatting-only edit changes (2) and leaves (3) equal,
which is the intended signal.

**Pinned values (recorded verbatim, not recomputed into history)**

| Edition | Commit | File SHA-256 | Content digest (D-1) |
| --- | --- | --- | --- |
| Reviewed P01 edition | `555735b6b3b2b72ec23fb99f2db26cbe3cef67a2` | `4431462fd4787350d8040ba0fe8014aefb88b170f7a20b708ab05801ba8e200b` | `718fc395818db259eec3d210e87881cf97f348482e041ea5776f76c820abf0d5`; **legacy recorded digest** `1b33cc20128ab75c59591448496164e30039018691e2a7d85ab21d7372926257` — formula unrecorded, not reproducible by D-1, preserved as-is |
| Acceptance edition (UDG-001 Verified) | `524658e1fb4c53a450cdf933886c7ad4b17c72e9` | `6ad6bdbb5540c38d6d142cc1e4f4bb78c76b36755803bb778c146a3c114474db` | `9b9177c0b57d3b3ee298794761f30fe77b52aa8a71eeef72401e8b86a665ac79` (56 entries; unchanged by this proposal) |

Rule for records: quote all three, and where a legacy digest is cited, label it legacy with this provenance
note. Optional follow-up (owner decision D3): implement `pnpm contracts:checksums -- --digest` printing both
values so the recipe cannot drift; until then D-1 is authoritative and the documented snippet is the reference
implementation.

---

## 6. Evidence retention plan

All three commits that matter for the UDG-001 acceptance are captured and verified. Bundles are small (~20 KB),
so retention cost is nil; the only hard deadline is the 30-day CI artefact expiry
(2026-11-08 → **2026-12-08**), which is why they are mirrored now rather than on request.

| Commit | Bundle | Where | report.json SHA-256 | Verify |
| --- | --- | --- | --- | --- |
| `1c735c2` accepted implementation (local, linux/arm64) | `UDG-001-2026-11-08T18-31-49-723Z-1c735c2d` | `/workspace/udg-evidence/` | `e07293e74db3a43edcd19c2bc48a47d075a707a9e2e29b3cf1308d08e7e7e2c8` | PASS, 0 issues |
| `1c735c2` CI (run 42510445695) | `UDG-001-2026-11-08T18-32-23-165Z-1c735c2d` | `ci-run-42510445695/` | `5c435eebdba91b46c0da691bc344979faa781af0eb6b17c214c6aca3444b8c4f` | PASS, 0 issues |
| `0e586b6` reviewed submission (run 42511785889) | `UDG-001-2026-11-08T18-48-35-734Z-0e586b61` | `ci-run-42511785889/` | `3b0379ae013925e38d520d5c9100238f68d6ac29324df4b16a2c1bd933ede859` | PASS, 0 issues (mirrored by this proposal) |
| `524658e` acceptance commit (run 42513337055) | `UDG-001-2026-11-08T19-07-22-787Z-524658e1` | `ci-run-42513337055/` | `b1d444edad0eea382b074adfc2cc43b954b6cccbbd222a517ceccec21669da9b` | PASS, 0 issues (mirrored by this proposal) |

Runner logs retained alongside the last two: `run-42511785889-full.log`
`337192e968f451530c15331a525a5c6450f8cbf77e9168c989f4f5d81eca9fe8`, `run-42513337055-full.log`
`6d36cde948983f33c0d4b96aa363b257444d770e1df3abfd3944bc7dc4f1e292`. They contain GitHub runner filesystem
paths, so they live only in the durable store and are never committed.

**Inventory versioning (applied by this proposal).** Inventory v1 (`sha256
aa0293d2fa613271d7f7e067b690747322f0af32dede325d825d7a7da205edc6`, 210 files, coverage through run
42511404907) is superseded by **v2**: `sha256
d4aa0bc1c24f4ef07d5056adb1ff8c33722483d333a8a3116ed1e5a617fd4240`, 258 files, coverage through run 42513337055,
embedded `supersedes` block carrying the v1 hash, and a named snapshot `inventory-v2.json`. The UDG-001
completion record's citation of the v1 hash is history and stays as written; this section is the pointer that
explains it. Going forward: each mirror regenerates `inventory.json` plus a numbered snapshot, records the
predecessor hash inside it, and the next record cites both.

**Backup topology (proposed until designated — owner decision D4).**

- Primary host backup: `/var/backups/udg-evidence/udg-001/` on this host (path proposed only; `/workspace/udg-evidence`
  is the working checkout-side store, not a backup).
- Off-host copy: a private owner-controlled archive (`TomBResearch/udg-evidence-archive` as a private repo, or
  an object-store bucket with the same layout) containing bundles plus the inventory **and excluding raw runner
  logs**, which stay host-side only.
- Verification routine after every mirror and quarterly: run `pnpm evidence:verify -- --run <dir>` over every
  directory containing `report.json`, then confirm the inventory file hash; a bundle that fails to verify is
  quarantined, not deleted, and reported.
- Retention: foundation bundles and inventories until M0 close-out; runner logs until Gate A close-out (they
  are the only step-level CI record). CI artefacts expire 2026-12-08; everything above is already mirrored, so
  expiry no longer risks loss.

---

## 7. Genuine owner decisions

| ID | Decision | Recommendation |
| --- | --- | --- |
| D1 | Adopt **P02** as drafted in section 1, including the statement that it is elaboration of v0.2 §4–§5 rather than a change, and acknowledging that the forward-gap `64` is protocol-level in P02 while P03 owns the admission window | Approve; no ADR |
| D2 | Adopt **P06** in the deferred-freeze form of section 2 (float64 canonical + lossless mapping now; encoding widths frozen at Gate A) | Approve **with** ADR `0001-replica-precision-policy.md` |
| D3 | Grant the tooling/record paths in 3.3 (fixture-layout fail-closed extension, `BOUNDARY-DOMAIN-NO-SCHEMA`, optional `--digest`) inside the UDG-002 assignment rather than as a separate micro-task | Approve; the work exists only to make UDG-002's own gates real |
| D4 | Designate the durable and backup locations in section 6 | Adopt `/var/backups/udg-evidence/udg-001/` plus a private off-host archive; bundles and inventory off-host, runner logs host-only |
| D5 | Set the UDG-002 prerequisite commit to the adoption commit (recorded as a full SHA at assignment) and this proposal as its reference document | Approve |
| D6 | Confirm the region-extent source for `OUT_OF_BOUNDS`: `packages/config/src/region.ts` declares extents derived from the `region-greybox-001` asset geometry, hashed into `configHash`, with validators reading config | Approve; no number is invented in the contract |

Resolved here without needing a decision, for the record: fixture layout strategy (extend the checker, TC-1…TC-9),
digest procedure D-1 and its historical provenance note, inventory versioning v1 → v2, mirroring of the
submission and acceptance bundles, the tolerance table in 2.2, and the grant-limit wording that a path never
widens functional scope.

**Still not authorised by this document:** P02–P10 remain Pending until the owner records adoption; UDG-002
remains Not Started and unassigned; no protocol, schema, config or tooling file may be created; Gates A, B and
C remain Not Run; UDG-003 onward and all three spikes remain out of scope.
