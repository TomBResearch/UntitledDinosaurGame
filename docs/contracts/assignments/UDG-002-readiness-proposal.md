# UDG-002 readiness proposal

Prepared 2026-11-08 for integration-owner review, after UDG-001 was accepted and set Verified.
**Revision 2** responds to the owner's five review points on revision 1 (`101623e`): the UDG-001 suite
amendment schedule (§3.5), the completed evidence/dispatcher tooling grant (§4B), breaking the region-asset
dependency (§1.6), the route-pair and normalisation-order rules (§1.3, §3.4), and the corrected retention
claim (§6).

**What this document is.** A single consolidated proposal covering the decisions, assignment shape, tooling
changes and record-keeping needed before UDG-002 can be made Ready. It is non-normative: it records no
approval, adopts nothing, assigns nothing and authorises no implementation. Like the Appendix B1/B2 records it
sits under `docs/contracts/assignments/`, which the checksum manifest excludes by path
(`docs/contracts/checksums.json` → `excluded`), so it is not part of the edition-controlled contract set.

**What this document is not.** It is not a questionnaire. Routine preparation choices are resolved with a
recommendation and a reason. Genuine owner decisions are collected in section 7 and nowhere else.

Repository state at revision 2: `main` = `101623eaeaf9972fd62d96d7ff92703bdd63195d` (the revision-1 proposal
commit, CI [42518964644](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/42518964644)
success), clean tree. P01 Approved. **P02 to P10 Pending. UDG-002 Not Started and unassigned.** Gates A, B and
C Not Run.

---

## 0. Gate mapping correction (owner-confirmed; repository text is correct)

Gate A is validated by **UDG-SPIKE-001**, which requires UDG-003 and UDG-004 Verified
([UDG-SPIKE-001.md](../UDG-SPIKE-001.md): "Gate A acceptance and evidence", "Requires Verified 003 and 004").
**UDG-SPIKE-002** validates **Gate B** (it lists "Gate A still valid" as a prerequisite and emits `gate-b.md`),
and **UDG-SPIKE-003** validates **Gate C**. The earlier statement in the UDG-001 review conversation — "Gate A
needs UDG-SPIKE-001…003" — was wrong. No contract file says that, so no contract correction is required; the
correction is recorded here so the wrong mapping cannot be inherited by a later record.

Consequence for this proposal: nothing in UDG-002 is gate-bound. Gate A depends on UDG-002 only transitively
(002 → 003/004 → SPIKE-001).

---

## 1. Proposed P02 — protocol surface, mapping, bounds, sentinels

Recommendation: **adopt P02 as drafted below** (it is the contract text of
[interfaces/protocol.md](../../interfaces/protocol.md) §4.2–4.4 with the gaps closed), with no ADR, and with
the P03 overlap in 1.4 acknowledged explicitly.

### 1.1 Wire envelope and validation bounds

| Field | Type | Bound / domain | Rejection |
| --- | --- | --- | --- |
| `sessionEpoch` | uint32 | server-issued, `1 … 4294967295`; `0` reserved as "no epoch" | `EPOCH_MISMATCH` on unknown/stale/old-epoch |
| `generation` | uint32 | `0 … 4294967294`; `0` legal only for the neutral initial frame | `INVALID_GENERATION` |
| `directIntent` | boolean | required, no default | `INVALID_PAYLOAD` when absent |
| `moveX`, `moveZ` | float64 | finite, `[-1, 1]`; normalise only when horizontal length > 1 | `INVALID_PAYLOAD`; raw sample → zero movement for that sample |
| `requestId` | string | 1–64 chars, `[A-Za-z0-9_-]+`, ASCII only | `INVALID_PAYLOAD`; same id + different payload → `REQUEST_ID_CONFLICT` |
| `x, y, z` (MoveTo) | float64 | finite; inside the region bounds **supplied to the validator** (1.6) | `INVALID_DESTINATION` / `OUT_OF_BOUNDS` |
| join `protocolVersion`, `configHash`, `manifestHash` | string | versions ≤ 32 chars; hashes 64 lowercase hex | `PROTOCOL_MISMATCH` / `CONFIG_MISMATCH` / `ASSET_MISMATCH` |

Closed rules that P02 fixes: non-finite and out-of-range inputs are **rejected or neutralised, never clamped**;
`directIntent: false` with non-zero axes is invalid and neutralised; rejected samples do not advance generation;
unknown fields in application messages are rejected; no client position, speed, elapsed time, route,
authoritative tick or client sequence counter is accepted; UDG epoch/generation stay distinct from SDK sequence
state.

### 1.2 Complete replica mapping (bidirectional, `mapping/{to-replica,from-replica}.ts`)

| Replica field | Canonical source | Encoding | Note |
| --- | --- | --- | --- |
| `entityId` | server-assigned identity | string ≤ 64 ASCII | map key of the player map |
| `x`, `y`, `z` | `locomotion.kinematic.position` | float64 ×3 | no client-side write path |
| `yaw` | radians about Y | float64 | normalised to `[-π, π)` **before encoding** (1.3) |
| `vx`, `vy`, `vz` | resolved displacement ÷ `dt` | float64 ×3 | *result* velocity, includes snap/step effects |
| `verticalVelocity` | integrator scalar carried into gravity integration | float64 | distinct from `vy`; **both** replicated and restored |
| `grounded` | contact after the completed step | boolean | |
| `movementMode` | `idle 0`, `direct 1`, `path 2` | uint8 | unknown enum value → reject at decode |
| `routeRevision` | active revision | uint32 | **`0` means no route** |
| `nextWaypointIndex` | active index | uint32 | legal values constrained by `routeRevision` (1.3) |
| `intentGeneration` | highest admitted intention | uint32 | |
| `sessionEpoch` | current application epoch | uint32 | |
| `connected` | authoritative presence | boolean | |
| `lastAuthorityTick` | tick that produced player state | uint32 | |
| Region: `worldId`, `regionId` | fixed `world-001`, `region-greybox-001` | string ≤ 64 | |
| Region: `serverTick`, `protocolVersion`, `configVersion`, `configHash`, `manifestHash` | server-owned | uint32 / ≤32-char strings / 64-hex hashes | the server-private session↔entity map is **not** replicated |

The mapping test asserts the set is **complete and closed**: a table-driven test fails when a replica field
exists in the schema but not in the map, and vice versa. Route points stay server-only and are never
reconstructed from a replica in path mode.

### 1.3 Sentinels, zeros, route pairs and canonicalisation

- **Route pair rule (clarified).** `routeRevision === 0` means *no route* and **requires**
  `nextWaypointIndex === 0`; `0 / non-zero` is an inconsistent replica and must be refused by `from-replica`,
  not silently mapped. `routeRevision > 0` with `nextWaypointIndex === 0` is **valid** and means an active
  route at its first waypoint. Negative, non-integer or over-width values in either field are rejected at
  decode. Whether `nextWaypointIndex` is within the actual waypoint count cannot be checked from the replica
  alone — that bound belongs to the server route store (UDG-003/UDG-007) and is documented as out of scope for
  the mapping layer, with the monotonic-revision rule asserted instead.
- **Null-to-zero route sentinel**: absence is encoded as `0` in both route fields; the domain side decodes
  `0 / 0` back to "no route". `null` never crosses the wire.
- **Result contract**: `appliedTick` is `null` on rejection; `routeRevision` is `null` in the *result* for
  cancel and rejection; `accepted: true` means the mode change committed at `appliedTick`, not that it was
  queued.
- **Signed zero**: validators normalise `-0` to `+0` for axes, positions and velocities, so `-0` cannot create a
  spurious state diff or a non-reproducible hash.
- **Normalisation order (clarified).** Yaw wrap and signed-zero normalisation happen at **validation time**, so
  the wire never carries an unnormalised value; the exact-copy round-trip assertions then compare
  *post-normalisation* domain values. `[-π, π)` is left-closed/right-open, so a `+π` input maps to `-π`, and the
  wrap is asserted deterministic and idempotent (normalising twice is identity). Fixture order per case: raw
  input → validator → assert normalised → encode → decode → assert exact equality with the normalised value.
- **Non-finite values never enter the domain**: `NaN`/`±Infinity` are rejected at the boundary; fixtures may
  inject them via tagged objects (`{"number":"NaN"}`) and direct binary, and the wire-negative path must not be
  weakened because JSON cannot express them.
- **Hash canonicalisation** (UDG-002 contract): UTF-8, sorted object keys, array order preserved, finite JSON
  values only, SHA-256, lowercase hex.
- **Integer safety**: values must be integers within the declared width; `Number.MAX_SAFE_INTEGER` is not a
  substitute for `uint32` bounds; overflow of tick/revision stops and renews the room instead of wrapping.

### 1.4 The one governance overlap

The forward-gap rule (admit a generation gap of at most 64, otherwise `RESYNC_REQUIRED` without raising the
watermark) lives in P02's text, but the number is also named by **P03** ("generation window", required before
UDG-003 Ready). Recommended handling: P02 adopts it as a **protocol-level constant and rejection code** —
`limits.maxGenerationForwardGap = 64` plus `RESYNC_REQUIRED` in the closed `RejectionCode` union — while the
**admission policy** (watermarks, gap behaviour, ordering) is exercised by UDG-003 under P03, which should
confirm `64` unchanged. UDG-002 must not implement admission logic.

### 1.5 Conflict analysis against baseline v0.2

No conflict for P02. Where it looks close:

| v0.2 clause | Relation to P02 |
| --- | --- |
| §4: input `generation` is "a per-session ordering hint, not a trusted authority claim. The server MUST enforce bounds, monotonicity and validity" | P02 supplies exactly those bounds. Elaboration, not change. |
| §5.2: held input does not increment generation every frame; a higher generation is a newer intention the server may refuse | Consistent with flat `directIntent` semantics. |
| §5: "if two conflicting operations have the same generation the server MUST resolve them with a documented deterministic priority (direct cancels path)" | Ordering, owned by UDG-003/P03. UDG-002 only declares the codes (`SUPERSEDED`, `REQUEST_ID_CONFLICT`). |
| §7.2: "input epoch resets must follow the SDK's contract… the integration spike will establish" | P02 fixes only the numeric domain and the no-wraparound rule, and states that the epoch **renewal mechanism** is proven in UDG-003/SPIKE-001 and not assumed here. |
| Region bounds behind `OUT_OF_BOUNDS` | Not a conflict but a dependency trap; resolved in 1.6. |

**ADR for P02: not needed.** No baseline clause moves, and no timestep, collision owner or protocol *shape*
changes; the P01 precedent applies ("No ADR: the rulings change no baseline clause…"). That reasoning is
recorded in the adoption row so the absence of an ADR is deliberate rather than an oversight.

### 1.6 Region bounds without depending on UDG-007 assets

Problem in revision 1: it allowed UDG-002 to "derive extents from the greybox region asset", which would have
made a types-and-validation task depend on the asset pipeline (UDG-007) that does not exist yet.

Recommended design — dependency-free and fail-closed:

- `packages/config/src/region.ts` (UDG-002) declares `RegionBounds` (`minX/maxX`, `minY/maxY`, `minZ/maxZ`; all
  finite; `min < max` on every axis; non-empty volume) and `validateRegionBounds()`. Bounds are included in
  `configHash`.
- Validators receive bounds **as an explicit, already-validated argument** —
  `validateMoveTo(frame, context: { bounds: RegionBounds; … })` — so nothing in `packages/protocol` or
  `packages/config` reads an asset, a file or a global default. **Recommended: UDG-002 ships no default extents
  at all** (owner decision D6); absence of bounds is a configuration error, never a permissive pass.
- **Fixtures use synthetic bounds, explicitly labelled.** Every protocol fixture carries
  `"boundsProvenance": "test-only-synthetic"` plus the extents it used — for example `x, z ∈ [-100, 100]`,
  `y ∈ [-10, 50]` with a spawn at `(0, 0.9, 0)`; that `0.9` is v0.2's capsule-centre rest height
  ([configuration.md](../../interfaces/configuration.md) §4.5), not an invented world size. Cases: strictly
  inside, exactly on each min/max plane, one step outside per axis, non-finite `y`, and a bounds set that is
  itself invalid (`min ≥ max`) to prove the config validator refuses.
- **How real bounds arrive later, outside UDG-002.** [UDG-007](../UDG-007.md) already owns
  `assets/regions/region-greybox-001/region.json`, whose contents its contract fixes as "world/region IDs, axis
  convention, bounds and at least one validated spawn", bound to `sourceGeometryHash`, `collisionHash`,
  `movementConfigHash` and `manifestHash`. [UDG-003](../UDG-003.md) owns `apps/server/src/server-config.ts` and
  `join-validation.ts`: it loads those asset bounds at startup, re-validates them with `validateRegionBounds`,
  checks `configHash`/`manifestHash` agreement, and fails startup on absence, non-finite values or mismatch;
  join keeps rejecting a stale `manifestHash` with `ASSET_MISMATCH`. UDG-002 supplies only the type, the
  validator, the injection point and a `boundsProvenance: "explicit-until-udg-007"` note in
  `docs/contracts/protocol-v1.md`. No UDG-007 asset is needed to complete UDG-002, and no invented world size is
  ever encoded.

---

## 2. Proposed P06 — precision, derived velocities, tolerances

Recommendation: **adopt P06 now in a deferred-freeze form, together with one ADR.** P06's deadline in scope.md
§1.3 is "Gate A freeze", i.e. a latest date, so adopting early is permitted; the reason to adopt early is that
UDG-002 cannot write a lossless mapping test without knowing the precision policy.

### 2.1 Policy

- The canonical domain uses JavaScript **float64 end to end**, and the mapping is required to be lossless for the
  1.2 field set, so UDG-002 introduces no lossy intermediate.
- **Schema encoding widths remain provisional until Gate A.** v0.2 §7.2 states "Precise Colyseus field types,
  encoding widths and additional predictor bookkeeping fields MUST be frozen during Spike 001", and
  protocol.md §4.4 freezes concrete schema builders "at Gate A after encode/decode tests". UDG-002 therefore
  marks the policy `provisional: true` in `docs/contracts/protocol-v1.md` and `protocol-field-map.json`, and
  proves the chosen width with a compiled room-free round-trip probe against the pinned schema package. If the
  pinned schema cannot carry a 64-bit float for a field, the implementer records what it *does* carry and
  escalates per [docs/adr/README.md](../../adr/README.md) — no invented decorator, no silent float32 downgrade,
  no weakened assertion.
- **Derived velocities**: `vx, vy, vz` = resolved displacement ÷ `dt` (`dt = 0.05 s` exact, the v0.2 default);
  `verticalVelocity` = the scalar carried into gravity integration. Both are replicated and both restored; the
  round trip asserts `verticalVelocity` explicitly, because omitting it is the known failure mode.

### 2.2 Tolerances (what UDG-002 may assert)

| Context | Tolerance | Basis |
| --- | --- | --- |
| Wire/mapping round trip of any replicated scalar, **after** yaw and signed-zero normalisation | **exact equality** (`Object.is` on finite values) | a copy is not an approximation; any drift is a defect |
| Pure-simulation derived quantities inside UDG-002 fixtures (velocity from displacement ÷ 0.05, axis normalisation, yaw-wrap arithmetic) | **1e-9** absolute, per axis and per m/s | the only new number this document proposes: one multiply/divide and one `sqrt` stay far below float64 noise at M0 magnitudes (≤ ~4 m, ≤ ~4 m/s) |
| Anything physical, networked or interpolated | **none set here** | physics adoption `1e-5 m`, replay `1e-3 m`, flat travel `1e-6 m`, correction p95 `0.15 m`, penetration `0.02 m`, arrival `0.2 m` stay v0.2-owned or P10-owned ([acceptance-gates.md](../../validation/acceptance-gates.md)); P06 must not restate them as adopted |

### 2.3 The real conflict with v0.2, and the ADR recommendation

There **is** one genuine conflict, and it is procedural rather than numerical: adopting a float64 policy now
reserves a decision v0.2 explicitly reserves to Spike 001, and the ADR table lists "Protocol/schema/timestep
change → Integration-owner ADR and version plan".

Recommendation: accept **one ADR**, `docs/adr/0001-replica-precision-policy.md`, stating (a) the float64
canonical policy and the lossless-mapping requirement are adopted early so UDG-002 is testable; (b) encoding
widths, schema constructors and predictor bookkeeping stay frozen at Gate A per v0.2 §7.2; (c) any later
precision change requires an ADR **and** reruns the correction and replay fixtures, which protocol.md §4.4
already demands; (d) P06 may only be revisited at Gate B, by ADR, as scope.md §1.3 says. Adopting the ADR now is
cheaper than discovering at Gate A that the mapping tests were written against an unowned assumption.

---

## 3. Proposed UDG-002 assignment shape

### 3.1 Immutable prerequisite pins

```text
UDG-001 state             Verified (accepted 2026-11-08 by the project owner, TomBResearch)
Accepted implementation   1c735c2d845e399cc8b3cc33adac4ba7a6081387
Reviewed submission       0e586b619796597266f7ec4942d24231dfb5ce62
Acceptance commit         524658e1fb4c53a450cdf933886c7ad4b17c72e9   (CI 42513337055, 19/19 steps)
Readiness proposal        this file, revision 2; its commit is recorded in the assignment as reference
Prerequisite commit (B1)  the commit recording the owner's P02/P06 adoption; its full SHA is written into
                          the assignment record at assignment time, not before
Contract edition          UDG-CONTRACTS-M0-001 v1.0, repository edition 1 (unchanged)
Baseline spec             UDG-SPEC-M0-002 v0.2, sha256 b51e7afdd6810c377d2d2702d7673119521a59cd0d6b91686700bf9149b73fcf
Manifest at authoring     docs/contracts/checksums.json, 56 entries, file sha256
                          6ad6bdbb5540c38d6d142cc1e4f4bb78c76b36755803bb778c146a3c114474db
                          (unchanged by this proposal: docs/contracts/assignments/ is excluded)
```

### 3.2 Required commands (exact)

`pnpm install --frozen-lockfile`, then the four root commands `pnpm typecheck`, `pnpm lint`, `pnpm test`,
`pnpm build` ([repository.md](../repository.md) §3.2), then `pnpm test:boundaries`, `pnpm test:fixtures`,
`pnpm test:unit` (once UDG-002 wires it, §3.3), `pnpm test:contract -- --task UDG-002`,
`pnpm contracts:checksums`, `pnpm dependencies:verify`, then
`pnpm evidence:capture -- --task UDG-002 --out artifacts --keep-going` followed by `pnpm evidence:verify` and
`pnpm evidence:summary`.

Two of these are idempotence checks rather than builds and must be run and reported: `pnpm dependencies:record`
and `pnpm contracts:checksums` (with `pnpm test:fixtures -- --write`) must each leave the working tree
**unchanged** — the recorded register, manifest and fixture hashes must already equal what the tools derive.

### 3.3 Additional controlled paths — grant list

Each grant authorises **the named edit only**. Granting a path does not authorise new behaviour, new commands,
new packages or new dependencies beyond the stated purpose; needing anything beyond it means Blocked plus an ADR
proposal, not a silent widening.

| Path | Purpose | Explicit limit |
| --- | --- | --- |
| `pnpm-lock.yaml` | record the schema dependency UDG-002 selects under C-02 | only that dependency tree; no engine, transport SDK, test or navigation packages |
| `docs/integration/dependencies.json` | register the selection (`@colyseus/schema` group → `selected`, exact version + licence) | `pnpm dependencies:record` output only; every other group stays `not-selected` with its owner; provenance exclusions and CI-action records unchanged |
| `package.json` (root) | wire `pnpm test:unit` at `tests/unit/` (UDG-001 completion limitation 4) | no new capability scripts; the still-unowned guarded commands keep refusing (§4B EC-8) |
| `vitest.config.ts` | include `tests/unit/**` and `tests/checks/**` | keep `passWithNoTests: false`, serial execution and the junit-under-evidence wiring |
| `.github/workflows/ci.yml` | add the UDG-002 contract/fixture steps; make the artefact assertion task-aware (EC-9) | keep zero `continue-on-error`, pinned actions, `if-no-files-found: error` and `if: !cancelled()` on the evidence steps |
| `tools/checks/src/fixtures.ts` | fixture-layout extension (§4A TC-1…TC-8) | validation stays a gate; no existing rejection weakened |
| `tools/checks/src/boundaries.ts`, `tools/checks/src/support.ts` | `BOUNDARY-DOMAIN-NO-SCHEMA` (TC-9) and the schema-location rule it needs | new rule ids plus their fixtures only; existing rule semantics unchanged |
| `tools/checks/src/evidence.ts`, `tools/checks/src/run-contract.ts`, `tools/checks/src/dispatch.ts`, `tools/checks/src/index.ts` | UDG-002 capture plan and removal of hardcoded UDG-001 assumptions (§4B EC-1…EC-9) | verification strictly not weakened; UDG-001's committed summary must regenerate byte-identically (EC-6) |
| `tests/checks/*.test.ts` (new files) | coverage for the tooling extensions | new files only; any UDG-001 invariant moved here keeps its assertions (§3.5 S-4) |
| `tests/contracts/UDG-001.test.ts` | **only** the amendments in §3.5 | no `it.skip`, no deletion, no threshold relaxation; each amendment states the invariant preserved |
| `docs/contracts/checksums.json` | regeneration as record maintenance | never hand-edited |
| `.env.example` | only if a documented config key needs a sample | recommend: not needed |

**Refused by the assignment** (so the boundary is unambiguous): `docs/interfaces/**`, other
`docs/contracts/*.md` except UDG-002's own `docs/contracts/protocol-v1.md`, `docs/specifications/**`,
`docs/validation/**`, `@colyseus/core`/`@colyseus/sdk`/`@colyseus/testing`/engine packages, `apps/**`,
`assets/**`, `tools/asset-pipeline/**`, and any Room, movement-execution, physics, navigation, input or asset
behaviour.

### 3.4 Acceptance criteria (measurable; contract text plus the additions above)

1. Every public export compiles from its supported package entry point, and domain entry points import no schema
   runtime — enforced by `BOUNDARY-DOMAIN-NO-SCHEMA`, not by review.
2. Fixtures P01–P12 (`protocol/malformed.json`) and P13–P20 (`protocol/ordering.json`) each carry an expected
   rejection code; a passing negative test means the expected refusal with unchanged state, never "it threw".
3. Boundary cases asserted: `±1` axes, diagonal normalisation, `0` / `4294967294` / `4294967295` and
   non-integer/unsafe-integer epochs and generations, 64- and 65-character ids, unicode ids, unknown and missing
   keys, malformed vectors, NaN/±Infinity via tag object **and** raw binary, `-0` normalisation, `+π → -π` yaw
   wrap, and yaw-normalisation idempotence.
4. **Route pair coverage**: round trips for the valid combinations `revision 0 / index 0`,
   `revision 5 / index 0` (active route at its first waypoint) and `revision 5 / index 3`; refusal of the invalid
   pair `revision 0 / index 3` (and `0 / 1`) by `from-replica`; negative, non-integer and over-width values in
   both fields.
5. Mapping completeness: the table-driven test fails on an unmapped schema field or an unmapped table row;
   exact-copy equality is asserted **after** yaw and signed-zero normalisation; `verticalVelocity` round-trips.
6. Region bounds: validators take explicit validated bounds; **no default extents exist in the repository**;
   every protocol fixture declares `boundsProvenance: "test-only-synthetic"` and the tooling or suite fails if a
   fixture omits it; a `min ≥ max` bounds set is refused by `validateRegionBounds`.
7. Config: `configHash` changes on a single parameter change and is stable across repeated runs; a validated
   result is readonly and a source-fixture mutation cannot alter it; missing, non-finite or inconsistent config
   fails startup validation.
8. Evidence tooling: `pnpm evidence:capture -- --task UDG-002` produces a bundle whose plan-required artefacts
   (`protocol-field-map.json`, `roundtrip-results.json`, `rejection-results.json`, `config-hashes.json`) exist,
   are non-empty, parse, carry the run's `taskId`, and are hash- and checksum-covered, and
   `pnpm evidence:verify` reports zero issues; capture for an unknown task id still refuses.
9. UDG-001 suite amendments comply with §3.5, and the committed UDG-001 summary regenerates byte-identically
   from the retained bundle (EC-6).
10. Schema-constructor uncertainty is escalated to the networking owner as an ADR proposal; no fabricated API and
    no weakened validation to make a sample compile.

Reviewer and integration owner: project owner `TomBResearch`. Gate: Foundation, no gate pass claimed. Evidence
destination: `artifacts/UDG-002-<UTC>-<sha>/` plus the durable store of section 6, with the committed sanitised
summary `docs/contracts/assignments/UDG-002-evidence.json`.

### 3.5 UDG-001 suite amendment schedule (replaces revision 1's "byte-stable" rule)

Revision 1 required `tests/contracts/UDG-001.test.ts` to stay byte-stable. That is withdrawn: several of its
assertions encode *the state of the empty repository*, so legitimate progression breaks them. The foundation
**invariants** they were written to protect must survive, restated so they cannot rot.

| ID | Current assertion | Amendment | Invariant preserved |
| --- | --- | --- | --- |
| S-1 | "exports a single empty module per game workspace and the documented entry map" — every workspace exports exactly one empty `"."` entry and `@udg/protocol` has no `./schema` entry | Read each owning contract's `- Implementation status:` line. Workspaces whose owner task is **Not Started** must still export only `"."`; `packages/protocol` and `packages/config` may export only the entry points that `docs/contracts/protocol-v1.md` lists, and any export owned by a later Not-Started task fails | No task can ship surface it does not own; the empty-skeleton guarantee still bites for the workspaces that remain unowned |
| S-2 | "records the dependency register and keeps game libraries unselected (C-02)" — asserts every `pendingGameLibraries` entry has `status: not-selected`, and that the lockfile and `node_modules` contain none of `@colyseus/`, `@dimforge/`, `recast-navigation`, `@babylonjs/`. It also asserts `register.runtime.node.version === process.version` | Drive assertions from register **status** instead of a fixed prefix list: every `not-selected` group must be absent from lockfile and `node_modules` and keep its owning task; every `selected` group must be present at exactly the recorded version and licence with an exact (non-range) specifier; **no group owned by a Not-Started task may appear as selected**. Replace the `process.version` comparison with a comparison against the pinned runtime (`.node-version`, `packageManager`, `engines`), so the register is required to record the *pinned* toolchain rather than whichever patch version happens to execute the suite | C-02's deferral rule is enforced more strongly than a prefix list, a legitimate `@colyseus/schema` selection no longer breaks the suite, and the register stops being coupled to the executing host's exact patch version |
| S-3 | "validates every manifest, pinned file hash and configuration hash" — asserts the literal string `fixture validation OK: 7 fixture(s)` | Assert the discovered fixture **id set** contains each boundary-fixture id (by id, not by count) and that the tool's reported count equals the discovered set; keep the tamper and undeclared-file rejections; keep zero-discovered-fixtures failing | Fixture coverage is still asserted; legitimate fixture growth no longer needs an edit |
| S-4 | "plans the existing UDG-001 suite and refuses every suite that does not exist yet" (`expect(plans).toEqual(['UDG-001'])`, refusals derived as `CONTRACT_TASK_IDS.length - 1` = 10 today), "refuses an unpopulated task suite through the real command line" (`run-contract.js --task UDG-002` must exit 2), and the hardcoded guarded-command list `['test:e2e', 'test:spike', 'test:unit', 'assets:build', 'assets:verify']` | Replace fixed membership with the complement invariant: `plans` must equal exactly the task ids that have a suite on disk; `plans ∪ refusals` must equal the contract task ids; every refusal exits 2 and names the task and its contract path. Move the **live refusal demonstration** into a disposable tree built in a temp directory (a scratch root containing `docs/contracts/UDG-003.md` and no `tests/contracts/UDG-003.test.ts`, with the CLI spawned at that cwd) so a real refusal is proven on every run regardless of progress. Keep the unknown-id and missing-`--task` refusals, and derive the guarded-command count from `UNAVAILABLE_SUITES` instead of a literal | "An absent task suite fails rather than passes" stays permanently covered and stops being a snapshot of today's unpopulated tasks |
| S-5 | Evidence, README, checksum and CI-policy tests | Keep as written, and add: regenerating the committed UDG-001 summary from the retained bundle reproduces the committed bytes (EC-6). The CI-policy tests change only in step with EC-9 and must still forbid `continue-on-error` and require `if-no-files-found: error` and `if: !cancelled()` | UDG-001's Verified evidence and the red-run policy stay provable after the tooling changes |

Rules for every amendment: it lands in the same commit as the change that necessitates it, and its message names
the invariant preserved; **no `it.skip`, no deletion, no relaxed threshold**; a test moved to `tests/checks/`
keeps its assertions verbatim. Historical state is preserved by pinned commits — the original suite and UDG-001
bundle at `1c735c2`, the submission `0e586b6`, the acceptance commit `524658e` and revision 1 `101623e` — and
UDG-001's captured bundle, committed summary and manifest entries are never rewritten.

---

## 4. Tooling: fixture layout (§4A) and evidence/dispatcher (§4B)

**Fact.** [fixtures.md](../../validation/fixtures.md) §7.1–7.2 names **standalone JSON files**
(`protocol/malformed.json`, `protocol/ordering.json`, `input/parity.json`, …) and UDG-002's owned list matches
that. **Today's checker cannot see them**: `validateFixtures` (`tools/checks/src/fixtures.ts`) walks
`tests/fixtures/<group>/<directory>/fixture.json` and silently skips everything else, so contract-named fixtures
would go unvalidated while `pnpm test:fixtures` prints success — the same class of silent-pass defect that the
UDG-001 CI correction removed. Two alternatives rejected: moving the contract's fixtures into a shape the tool
happens to like; and letting UDG-002 validate fixtures only inside its own suite, which would leave
`pnpm test:fixtures` reporting success over unvalidated fixtures.

### 4A Fixture-layout changes (fail closed)

| ID | Change | Behaviour |
| --- | --- | --- |
| TC-1 | `validateFixtures` discovers two layouts | manifest directories (existing) **and** standalone `tests/fixtures/<group>/<name>.json` for the supported groups `protocol, input, network, physics, navigation, assets` |
| TC-2 | New committed catalog `tests/fixtures/catalog.json` | declares required fixture files/directories and case ids (P01–P12 and P13–P20 first; other groups as their owning tasks add them). A missing required file is `FIXTURE-CATALOG-MISSING` |
| TC-3 | Envelope validation for standalone files | `fixtureVersion`, `fixtureId`, `configHash`, `seed`, `boundsProvenance`, `cases[]` with per-case `expect: rejection \| neutralisation \| disconnect \| movement`, `encoding: json \| binary`, and `errorCodes[]` for negatives. Unknown keys → `FIXTURE-ENVELOPE-UNKNOWN-KEY`, mirroring the protocol's own unknown-field rule |
| TC-4 | Hash pinning for both layouts | `catalog.json` carries `path` + `sha256` per entry; `pnpm test:fixtures -- --write` re-pins; a byte change is `FIXTURE-FILE-HASH` |
| TC-5 | Unrecognised layout is an error | a directory in a supported group without `fixture.json`, a `.json` at the fixtures root, or a file in an unknown group → `FIXTURE-LAYOUT-UNKNOWN`, listing the path. Nothing is skipped silently |
| TC-6 | Non-finite representation stays honest | a `movement`-expected case containing tagged `{"number":"NaN"}` fails as inconsistent; each protocol negative group needs at least one `encoding: binary` case |
| TC-7 | New tests in `tests/checks/fixture-layout.test.ts` | a valid standalone protocol fixture passes; a missing required case id fails; an unknown envelope key fails; a tampered hash fails; an unknown layout fails; the existing manifest-directory layout still passes; zero discovered fixtures still fails |
| TC-8 | Docs | the README fixtures line and `docs/contracts/protocol-v1.md` describe both layouts; `docs/validation/fixtures.md` is edition-controlled and is **not** edited by the implementer |
| TC-9 | Boundary rule `BOUNDARY-DOMAIN-NO-SCHEMA` | `packages/protocol/src/domain/**` must not import `@colyseus/*` or `../schema/**`; one allow and one reject fixture; the rule-table hash change is recorded in UDG-002 evidence, and UDG-001's recorded hash is left as history |

### 4B Evidence and dispatcher changes (remove hardcoded UDG-001 assumptions without weakening validation)

| ID | Location | Change | Non-weakening guard |
| --- | --- | --- | --- |
| EC-1 | `CAPTURE_PLANS` | add a `UDG-002` plan: the root four commands plus boundaries, fixtures, unit, contract `UDG-002`, checksums and dependency verify; `requiredFiles` = the six universal artefacts **plus** `protocol-field-map.json`, `roundtrip-results.json`, `rejection-results.json`, `config-hashes.json`; per-task `thresholds` text; junit via `UDG_EVIDENCE_JUNIT`, measurements via `MEAS/UDG-002.json`, artefacts via `BUNDLE/…` env aliases | an unknown task id still refuses; no default plan exists |
| EC-2 | `prerequisiteShas()` | currently hardcoded to `assignments/UDG-001.md`; parameterise by task id (`assignments/<taskId>.md`) so each task's captured `prerequisiteCommits` come from **its own** assignment record | plans that require prerequisites (both) must fail verification with a new code `EVIDENCE-PREREQUISITE-MISSING` when the list is empty — today an empty list passes silently |
| EC-3 | report prose | `notApplicable` reasons and the profile `note` currently assert UDG-001 facts ("No gameplay trace exists for a foundation run", "No browser suite exists yet; UDG-004 creates …"); move them into the plan, with UDG-001's exact strings preserved in the UDG-001 plan | UDG-001 report semantics unchanged; UDG-002 states its own reasons |
| EC-4 | measurements gate | replace `report.taskId === 'UDG-001'` with `plan.requiresMeasurements` | UDG-002 sets it true (fixture counts, rejection-code coverage, mapping completeness), so a measured-less UDG-002 bundle is still refused |
| EC-5 | `verifyBundle` | every plan-required `.json` artefact must parse and carry `schemaVersion` and the run's `taskId` → new codes `EVIDENCE-ARTEFACT-UNPARSEABLE`, `EVIDENCE-ARTEFACT-TASK-MISMATCH`; presence, non-emptiness, content hash and `checksums.sha256` coverage are already enforced | turns "a file exists" into "the artefact is the run's own artefact"; a `{}` placeholder cannot pass |
| EC-6 | summary | the `ci.note` strings assert UDG-001/C-05 text; make them plan-aware | UDG-001's note text is preserved verbatim in its plan, and acceptance criterion 9 requires regenerating UDG-001's committed summary from the retained bundle to produce byte-identical output |
| EC-7 | `captureEvidence` | keep refusing for a task with no plan (non-zero exit, attributed message) — no silent generic capture | UDG-002's plan is mandatory, so a UDG-002 bundle cannot be produced by a generic path |
| EC-8 | `UNAVAILABLE_SUITES` | remove `test:unit` **only** in the commit that wires `pnpm test:unit` to `tests/unit/`; `test:e2e`, `test:spike`, `assets:build` and `assets:verify` keep their attributed refusals | S-4 derives the expected guarded-command count from the table, so the refusal test cannot silently lose coverage |
| EC-9 | `.github/workflows/ci.yml` assertion step | the required-artefact list is hardcoded to UDG-001's seven files; assert the universal files plus every `report.json` entry marked `required`, then let `pnpm evidence:verify` decide | the step still fails on a missing or empty artefact, and keeps `if: !cancelled()`, zero `continue-on-error` and `if-no-files-found: error` |

`run-contract.ts` needs no functional change for UDG-002 (suite discovery and refusal wording are already
task-generic); it is granted so the S-4 complement invariant can live in one place if the plan shape has to move,
and any change there must preserve exit code 2 plus the named contract path.

---

## 5. Deterministic manifest-digest procedure

**Problem.** The reviewed edition carries a recorded digest
`1b33cc20128ab75c59591448496164e30039018691e2a7d85ab21d7372926257` whose canonicalisation was never written down,
so it cannot be reproduced. Historical values keep their provenance; they are not rewritten.

**Procedure D-1 (adopt by convention; needs no code).** Every adoption or record commit that touches the manifest
records three values together:

1. **Commit** — the full SHA of the commit containing `docs/contracts/checksums.json`.
2. **File SHA-256** — `sha256sum docs/contracts/checksums.json`: byte-exact, the primary pin.
3. **Content digest** — SHA-256 of the UTF-8 bytes of
   `{"algorithm":"sha256","fileCount":N,"files":[["<path>","<hash>"], …]}` where entries are sorted ascending by
   repository-relative POSIX path (byte order of the UTF-8 path bytes), serialised with `JSON.stringify` and no
   whitespace, excluding `docs/contracts/checksums.json` itself. Reproduce with:

```bash
node --input-type=module -e '
import {readFileSync} from "node:fs"; import {createHash} from "node:crypto";
const m = JSON.parse(readFileSync("docs/contracts/checksums.json","utf8"));
const files = Object.entries(m.files).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
console.log(createHash("sha256").update(JSON.stringify({algorithm:m.algorithm,fileCount:files.length,files})).digest("hex"));'
```

The file hash answers "is this the exact manifest I reviewed"; the content digest answers "did the covered
content move, independent of formatting or key order". A formatting-only edit changes (2) and leaves (3) equal.

| Edition | Commit | File SHA-256 | Content digest (D-1) |
| --- | --- | --- | --- |
| Reviewed P01 edition | `555735b6b3b2b72ec23fb99f2db26cbe3cef67a2` | `4431462fd4787350d8040ba0fe8014aefb88b170f7a20b708ab05801ba8e200b` | `718fc395818db259eec3d210e87881cf97f348482e041ea5776f76c820abf0d5`; **legacy recorded digest** `1b33cc20128ab75c59591448496164e30039018691e2a7d85ab21d7372926257` — formula unrecorded, not reproducible by D-1, preserved as-is |
| Acceptance edition (UDG-001 Verified) | `524658e1fb4c53a450cdf933886c7ad4b17c72e9` | `6ad6bdbb5540c38d6d142cc1e4f4bb78c76b36755803bb778c146a3c114474db` | `9b9177c0b57d3b3ee298794761f30fe77b52aa8a71eeef72401e8b86a665ac79` (56 entries; unchanged by this proposal) |

Rule for records: quote all three, and label a legacy digest as legacy with this provenance note. Optional
follow-up (folded into D3): implement `pnpm contracts:checksums -- --digest`; until then D-1 is authoritative.

---

## 6. Evidence retention — what has and has not been achieved

All three commits that matter for the UDG-001 acceptance are captured and verified.

| Commit | Bundle | Where | `report.json` SHA-256 | Verify |
| --- | --- | --- | --- | --- |
| `1c735c2` accepted implementation (local, linux/arm64) | `UDG-001-2026-11-08T18-31-49-723Z-1c735c2d` | `/workspace/udg-evidence/` | `e07293e74db3a43edcd19c2bc48a47d075a707a9e2e29b3cf1308d08e7e7e2c8` | PASS, 0 issues |
| `1c735c2` CI (run 42510445695) | `UDG-001-2026-11-08T18-32-23-165Z-1c735c2d` | `ci-run-42510445695/` | `5c435eebdba91b46c0da691bc344979faa781af0eb6b17c214c6aca3444b8c4f` | PASS, 0 issues |
| `0e586b6` reviewed submission (run 42511785889) | `UDG-001-2026-11-08T18-48-35-734Z-0e586b61` | `ci-run-42511785889/` | `3b0379ae013925e38d520d5c9100238f68d6ac29324df4b16a2c1bd933ede859` | PASS, 0 issues |
| `524658e` acceptance commit (run 42513337055) | `UDG-001-2026-11-08T19-07-22-787Z-524658e1` | `ci-run-42513337055/` | `b1d444edad0eea382b074adfc2cc43b954b6cccbbd222a517ceccec21669da9b` | PASS, 0 issues |

Runner logs retained alongside the last two: `run-42511785889-full.log`
`337192e968f451530c15331a525a5c6450f8cbf77e9168c989f4f5d81eca9fe8` and `run-42513337055-full.log`
`6d36cde948983f33c0d4b96aa363b257444d770e1df3abfd3944bc7dc4f1e292`. They contain GitHub runner filesystem paths,
so they stay in the durable store and are never committed.

**Inventory versioning (applied).** Inventory v1 (`aa0293d2fa613271d7f7e067b690747322f0af32dede325d825d7a7da205edc6`,
210 files, through run 42511404907) is superseded by **v2**: `d4aa0bc1c24f4ef07d5056adb1ff8c33722483d333a8a3116ed1e5a617fd4240`,
258 files, through run 42513337055, with the v1 hash embedded as `supersedes` and a snapshot copy
`inventory-v2.json`. The UDG-001 completion record's citation of the v1 hash is history and stays as written.
Going forward: each mirror regenerates `inventory.json` plus a numbered snapshot, records the predecessor hash
inside it, and the next record cites both.

**Correction to revision 1's claim.** Mirroring here protects against exactly one failure — GitHub Actions
artefact expiry, 30 days from 2026-11-08, i.e. **2026-12-08** — and nothing more. `/workspace/udg-evidence` sits
on the same host and storage as the working checkout, so it is a **working copy, not a backup**: host loss,
filesystem corruption or an accidental `rm -rf` destroys every retained bundle at once. Git preserves the
*documents and hashes* — so tampering after such a loss would be detectable — but deliberately never contained the
bundles, so verification of the retained bytes would be impossible, not merely failed.

**Residual risk — OPEN.** Until a backup location is designated (owner decision D4) the evidence set has no
independent copy. Proposed and still unadopted: a host backup at `/var/backups/udg-evidence/udg-001/` plus an
off-host private archive (`TomBResearch/udg-evidence-archive`, or an object-store bucket with the same layout)
holding bundles and the inventory and **excluding** raw runner logs, which stay host-side. Verification routine
after every mirror and quarterly thereafter: `pnpm evidence:verify -- --run <dir>` over every directory
containing `report.json`, then confirm the inventory file hash; a bundle that fails to verify is quarantined, not
deleted, and reported. Retention: bundles and inventories until M0 close-out; runner logs until Gate A close-out,
since they are the only step-level CI record. Records-only CI runs after `524658e` (including this proposal's) are
not mirrored; if the owner wants them, D4 plus one mirror covers them under the same rule.

---

## 7. Genuine owner decisions

| ID | Decision | Recommendation |
| --- | --- | --- |
| D1 | Adopt **P02** as section 1 drafts — including the statement that it elaborates v0.2 §4–§5 rather than changing it, the route-pair and normalisation-order rules, and the P03 gap-of-64 acknowledgement | Approve; no ADR |
| D2 | Adopt **P06** in the deferred-freeze form of section 2 (float64 canonical + lossless mapping now; encoding widths frozen at Gate A per v0.2 §7.2) | Approve **with** ADR `0001-replica-precision-policy.md` |
| D3 | Approve the grant list in 3.3 — including §3.5's UDG-001 suite amendments and the §4A/§4B tooling — inside the UDG-002 assignment rather than as separate micro-tasks | Approve; each grant carries its own limit, and the suite amendments replace snapshot assertions with invariants plus a permanent live refusal demonstration |
| D4 | Designate the **backup** locations in section 6, closing the residual risk that every retained bundle exists on one host | Adopt `/var/backups/udg-evidence/udg-001/` plus a private off-host archive of bundles and inventory only. **Until then the risk stays open and should be recorded as open in any assignment** |
| D5 | Set the UDG-002 prerequisite commit to the adoption commit (full SHA recorded at assignment), with this proposal as its reference document | Approve |
| D6 | Region bounds: should UDG-002 ship **no** default extents (bounds must be supplied; absence is a configuration error), or ship labelled development bounds so a room can start without assets? | Recommend **no default** (fail closed); UDG-003 supplies UDG-007's validated `region.json` bounds at startup |

Resolved here without needing a decision, for the record: the fixture-layout strategy (extend the checker and fail
closed, TC-1…TC-9); the evidence/dispatcher changes EC-1…EC-9 including task-specific prerequisite SHAs and
artefact verification; the UDG-001 amendment schedule and its disposable live-refusal fixture; the route-pair rule
and normalisation ordering; the dependency-free region-bounds design, with real bounds owned by UDG-007 and
UDG-003 as their contracts already state; digest procedure D-1 with legacy provenance preserved; inventory
v1 → v2; and the corrected retention statement.

**Still not authorised by this document:** P02–P10 remain Pending until the owner records adoption; UDG-002
remains Not Started and unassigned; no protocol, schema, config or tooling file may be created; Gates A, B and C
remain Not Run; UDG-003 onward and all three spikes remain out of scope.
