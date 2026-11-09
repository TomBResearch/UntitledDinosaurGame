# Protocol edition `udg-m0-1.0.0`

> Owned by [UDG-002](UDG-002.md). Created by UDG-002 as required by its owned-file list.
> Normative background: [interfaces/protocol.md](../interfaces/protocol.md),
> [interfaces/domain.md](../interfaces/domain.md), [interfaces/configuration.md](../interfaces/configuration.md)
> and [ADR 0001](../adr/0001-replica-precision-policy.md). This document records what the M0 protocol
> edition actually contains, as built; where it disagrees with the interface document, the interface
> document is the requirement and this file is the implementation record that must be corrected.

Status markers used below:

- **Frozen** — implemented and tested in this edition; changing it is a protocol change and goes through
  the [ADR procedure](../adr/README.md).
- **Provisional** — implemented now, frozen later at a named gate. A provisional decision may not be
  treated as settled by a dependent task.
- **Deferred** — deliberately absent from this edition; the named task owns it.

## 1. Identity and compatibility

| Item | Value | Status |
| --- | --- | --- |
| Protocol version string | `udg-m0-1.0.0` (`PROTOCOL_VERSION`) | Frozen |
| Supported set | exactly `["udg-m0-1.0.0"]` (`SUPPORTED_PROTOCOL_VERSIONS`) | Frozen |
| Compatibility rule | exact match only; anything else is refused with `PROTOCOL_MISMATCH` | Frozen |
| Version string bound | ≤ 32 characters (`MAX_VERSION_LENGTH`) | Frozen |
| Contract edition | `UDG-CONTRACTS-M0-001 v1.0`, repository edition 1 | Frozen |
| Baseline specification | `UDG-SPEC-M0-002` v0.2 | Frozen |

There is deliberately no version-range logic. `validateJoin` refuses an unrecognised version rather
than parsing optimistically, because the wire validators accept a **closed** field set: an added
optional field is already a compatibility event, and protocol.md 4.1 requires an agreed rule before
one exists. When a compatibility rule is agreed it must be recorded in an ADR and this table changes
from one row to whatever the rule says.

## 2. Entry points

The package exports are the supported import surface. Anything under `src/` or `dist/` that is not
listed here is internal: a consumer that reaches around this table is depending on a private layout.

`tests/contracts/UDG-001.test.ts` reads the table below and fails if a package exports a subpath this
table does not declare, or if a workspace owned by a task that has not started exports anything but
itself.

<!-- entry-map:begin -->

| Package | Subpath | Module | Contents | Rule this entry exists for |
| --- | --- | --- | --- | --- |
| `@udg/protocol` | `.` | `dist/index.js` | version identity, wire validation, rejection vocabulary | Importable by server, client and tools without pulling in the schema runtime. |
| `@udg/protocol` | `./domain` | `dist/domain/index.js` | canonical domain declarations, `RejectionCode`, stamp projection helpers | Engine-free and schema-free consumption (locomotion, physics, navigation adapters). |
| `@udg/protocol` | `./schema` | `dist/schema/index.js` | pinned replica declarations and codec re-exports | The only place `@colyseus/schema` is imported. |
| `@udg/protocol` | `./mapping` | `dist/mapping/index.js` | canonical state ↔ replica projection | Server-side projection; refused on the engine-free path. |
| `@udg/config` | `.` | `dist/index.js` | configuration shapes, validation, canonical hashing | Server and client must compute the same `configHash`. |

<!-- entry-map:end -->

Two boundaries are enforced, not documented-and-hoped:

- `BOUNDARY-NO-SDK-LEAK` keeps `@colyseus/**` out of every workspace except `apps/server` and
  `apps/client`, and out of `packages/protocol/src/schema/**` is the *only* exception inside the
  protocol package (`packages/protocol/src/schema/**`).
- `BOUNDARY-DOMAIN-NO-SCHEMA` additionally forbids `packages/protocol/src/domain/**` from importing
  `@colyseus/**` **or** a relative path into `packages/protocol/src/schema/**`. Without it, the root
  and `./domain` entry points could acquire the schema runtime through a sibling import and the
  acceptance criterion "domain entry points import no schema runtime" would be unfalsifiable.
  `tests/fixtures/boundaries/domain-no-schema` (reject) and `domain-no-schema-allowed` (allow) prove
  the rule fires and does not over-fire.

## 3. Numeric domain

Adopted with P02 (decision D1) and pinned in `packages/protocol/src/version.ts`. `@udg/config`
re-exports these as `PROTOCOL_LIMITS` rather than copying them, so a wire-limit change moves every
`configHash`.

| Constant | Value | Notes |
| --- | --- | --- |
| `UINT32_MIN` / `UINT32_MAX` | `0` / `4294967295` | width reference, not a valid epoch |
| `EPOCH_MIN` / `EPOCH_MAX` | `1` / `4294967295` | epoch `0` means "no epoch" |
| `GENERATION_MIN` / `GENERATION_MAX` | `0` / `4294967294` | one below uint32 max so overflow is detectable; this is the bound applied to `intentGeneration` by the frame validators **and** by mapping in both directions |
| `MAX_GENERATION_FORWARD_GAP` | `64` | constant only; the admission **policy** is UDG-003 under P03 |
| `MIN_REQUEST_ID_LENGTH` / `MAX_REQUEST_ID_LENGTH` | `1` / `64` | `REQUEST_ID_PATTERN` = `[A-Za-z0-9_-]{1,64}` |
| `MAX_IDENTIFIER_LENGTH` | `64` | ASCII identifiers only: `[A-Za-z0-9_-]{1,64}` |
| `MAX_VERSION_LENGTH` | `32` | |
| `HASH_LENGTH` | `64` | lowercase hex SHA-256, `HASH_PATTERN` |
| `TERMINAL_REQUEST_CACHE_SIZE` / `_TTL_SECONDS` | `128` / `30` | bounds declared here; the cache is UDG-003 behaviour |
| `YAW_RANGE` | `[-π, π)` | half-open: `+π` normalises to `-π` |
| `ROUTE_ABSENT_REVISION` / `_INDEX` | `0` / `0` | null-to-zero route sentinel pair |

Identifiers reject Unicode on purpose. `"entity-✓"` is 8 characters on screen and 9 UTF-16 code
units, and the contract's identifier rule is ASCII; `INVALID_PAYLOAD` is the answer, not a
transliteration.

### 3.1 What `generation` 0 means

Generation `0` is a legal *neutral* value and an illegal *request* value:

- a direct frame at generation `0` with `directIntent === false` is the initial/neutral frame;
  `generation 0` with `directIntent === true` is refused (`INVALID_GENERATION`);
- a one-shot request (`UDG_MOVE_TO`, `UDG_CANCEL_PATH`) must carry `generation > 0`, so a request can
  never be confused with the unset default;
- `admitGeneration` refuses `generation > watermark + 64` with `STALE`-free `INVALID_GENERATION` and
  never advances the caller's watermark on refusal. `compareRequestIdentity` returns
  `{replay: true}` for an identical `(requestId, payloadHash)` pair and refuses a differing payload
  under a reused id with `REQUEST_ID_CONFLICT`.

Both are *validators*, not the admission mechanism: watermark storage, `RESYNC_REQUIRED` issuance and
supersede ordering stay in UDG-003 (decision U2-6).

## 4. Wire messages

Every message is validated against a **closed** field set: a missing field, an extra field and a
mis-typed field are all `INVALID_PAYLOAD` before any semantics are considered.

| Message | Fields (exact set) | Validator |
| --- | --- | --- |
| direct frame | `sessionEpoch`, `generation`, `directIntent`, `moveX`, `moveZ` | `validateDirectFrame` |
| `UDG_MOVE_TO` | `requestId`, `sessionEpoch`, `generation`, `x`, `y`, `z` | `validateMoveTo` |
| `UDG_CANCEL_PATH` | `requestId`, `sessionEpoch`, `generation` | `validateCancelPath` |
| join metadata | `protocolVersion`, `configHash`, `manifestHash` | `validateJoin` |
| `UDG_ROUTE_STATUS` | `entityId`, `sessionEpoch`, `generation`, `routeRevision`, `status`, `serverTick` | `validateRouteStatus` |
| `UDG_MOVEMENT_RESULT` | acknowledgement of an accepted request | projection only (`projectStamp`) |

`MovementIntentStamp` is flattened on the wire into `sessionEpoch` and `generation`
(`liftStamp` / `projectStamp`); the nested pair is a domain convenience and never travels.

Axis rules: `moveX`/`moveZ` ∈ `[-1, 1]`, normalised so a diagonal
(`1, 1`) becomes unit-length, and a both-zero pair is the neutral intent
(`directInputOf` maps it to `NEUTRAL_DIRECT_INPUT`). `directIntent === false` must carry zero axes,
which is what makes the neutral keepalive distinguishable from a released key.

Destination rules: `x`, `y`, `z` must be finite float64 and inside the explicitly supplied
`RegionBounds` (`OUT_OF_BOUNDS`). Bounds are a *parameter* of validation. No default extent exists
anywhere in this edition (owner decision D5): a caller that cannot supply bounds has not loaded a
region, and inventing one would validate a destination against a volume nobody authored.

## 5. Rejection vocabulary

`REJECTION_CODES` is the closed set; `Validation<T>` is `{ ok: true, value } | { ok: false, code,
message }`. A refusal carries no partial value, so nothing downstream can accidentally adopt a
half-validated payload.

| Code | Raised when |
| --- | --- |
| `INVALID_PAYLOAD` | field set, type, finiteness, identifier or integer-width rule fails |
| `INVALID_DESTINATION` | destination is not a valid place to path to (semantics, not geometry) |
| `OUT_OF_BOUNDS` | destination outside the supplied region bounds |
| `UNREACHABLE` | no route exists (UDG-007 owns the decision; the code exists now) |
| `RATE_LIMITED` | request rate exceeded (UDG-003 owns the policy) |
| `SUPERSEDED` | an earlier request was replaced by a later one |
| `NAVIGATION_BUSY` | navigation cannot accept work now (UDG-007 owns the condition) |
| `EPOCH_MISMATCH` | session epoch is not the current one |
| `INVALID_GENERATION` | generation outside its width, or the `0` rules above |
| `RESYNC_REQUIRED` | the client must resynchronise (UDG-003 owns issuance) |
| `REQUEST_ID_CONFLICT` | a reused `requestId` with a different `payloadHash` |
| `PROTOCOL_MISMATCH` | version not in the supported set |
| `CONFIG_MISMATCH` | `configHash` differs from the server's |
| `ASSET_MISMATCH` | `manifestHash` differs from the loaded asset manifest |

Configuration problems are **not** expressed with these codes. `@udg/config` reports
`ConfigIssueCode` (`MISSING`, `WRONG_TYPE`, `NOT_FINITE`, `OUT_OF_RANGE`, `NOT_POSITIVE`, `EMPTY`,
`TOO_LONG`, `INVALID_HASH`, `INCONSISTENT`, `UNKNOWN_KEY`) because a bad configuration file describes
this process's startup data, not a peer's misbehaviour, and a rejection code would imply a peer to
blame.

## 6. Replica field map

`PlayerSchema` is the prediction-relevant scalar set. Declaration order is index-significant;
`PLAYER_FIELDS` pins it, and `tests/contracts/UDG-002.test.ts` asserts the table below matches the
declaration field-for-field, name-for-name and width-for-width.

| Index | Replica field | Width | Canonical state path | Notes |
| --- | --- | --- | --- | --- |
| 0 | `entityId` | `string<=64` | `entityId` | ASCII identifier |
| 1 | `x` | `float64` | `locomotion.kinematic.position.x` | |
| 2 | `y` | `float64` | `locomotion.kinematic.position.y` | at rest on level ground `0.9 m` plus validated controller separation |
| 3 | `z` | `float64` | `locomotion.kinematic.position.z` | |
| 4 | `yaw` | `float64` | `locomotion.kinematic.yaw` | normalised to `[-π, π)` |
| 5 | `vx` | `float64` | `locomotion.kinematic.velocity.x` | replica name differs from the domain key `velocity.x` |
| 6 | `vy` | `float64` | `locomotion.kinematic.velocity.y` | present for ADR 0001 completeness; not a second authority |
| 7 | `vz` | `float64` | `locomotion.kinematic.velocity.z` | |
| 8 | `grounded` | `boolean` | `locomotion.kinematic.grounded` | |
| 9 | `verticalVelocity` | `float64` | `locomotion.kinematic.verticalVelocity` | the scalar the camera and animation states consume |
| 10 | `movementMode` | `uint8` | `locomotion.mode` | enum table below; an unlisted value is refused |
| 11 | `routeRevision` | `uint32` | `locomotion.route.revision` | `0` means no route |
| 12 | `nextWaypointIndex` | `uint32` | `locomotion.route.nextWaypointIndex` | legal `0` while a route is active |
| 13 | `intentGeneration` | `uint32` | `locomotion.intentGeneration` | width `uint32`, domain range `0 … GENERATION_MAX`; `4294967295` is refused by `toReplica` and by `readReplicaIssues`, so no state validates on one side and fails on the other |
| 14 | `sessionEpoch` | `uint32` | `sessionEpoch` | must be ≥ `EPOCH_MIN`, which is also the truncation tripwire |
| 15 | `connected` | `boolean` | `connected` | |
| 16 | `lastAuthorityTick` | `uint32` | `locomotion.lastAuthorityTick` | |

Absent by design: route point lists, transport session maps, per-client scratch state, and any
authoritative transform setter. Route points remain server-only; a client learns a route through
`routeRevision`/`nextWaypointIndex` and its own server-supplied path store.

`RegionSchema` carries `worldId`, `regionId`, `serverTick`, `protocolVersion`, `configVersion`,
`configHash`, `manifestHash` and a `players` map keyed by `playerMapKey` (`entityId`). The map key is
an ASCII identifier, so the same key rule applies.

`DirectInputSchema` mirrors the direct-frame field set for the SDK's fixed-step input layer, so the
input sequence is encoded by the pinned schema rather than by a hand-rolled frame.

### 6.1 Enum encoding

`movementMode`: `idle = 0`, `direct = 1`, `path = 2`. There is no default branch. `toReplica` refuses
an unlisted mode before encoding and `fromReplica` refuses an unlisted code after decoding, so a
future mode cannot silently read as `idle`.

### 6.2 Route sentinel

One sentinel crosses the wire; the domain spells absence as `null`. The rule (owner decision D1) is
applied on each side and **has no option, flag or alternate entry point**: `checkPlayerState` and
`toReplica` take the state alone. A caller that could switch the rule off could project a replica that
decodes to a different canonical state than the one it was built from, which is the only reason the
rule exists.

Canonical `LocomotionState.route`, checked by `checkPlayerState` before `toReplica` writes anything:

| Canonical value | Meaning | Accepted |
| --- | --- | --- |
| `null` | no route | yes — projected as the `0 / 0` sentinel |
| `{ revision: > 0, nextWaypointIndex: any uint32 }` | active route; index `0` is its first waypoint | yes |
| `{ revision: 0, nextWaypointIndex: 0 }` | nothing the domain can mean: absence is `null` | no, issue on `routeRevision` |
| `{ revision: 0, nextWaypointIndex: > 0 }` | no route with a waypoint pointer | no, issues on `routeRevision` and `nextWaypointIndex` |
| `< 0`, fractional, `> uint32` in either field | not representable | no |

The `revision: 0` rows are the round-trip rule, not tidiness. Projected, `{ 0, 0 }` would travel as the
absence sentinel and return as `null`, so the caller would receive a different canonical value than the
one it passed in; `{ 0, > 0 }` would travel as a pair no reader may reconstruct. Refusing both is what
makes "every accepted canonical state round trips exactly" true rather than nearly true.

Decoded wire pair, checked by `readReplicaIssues` (widths) and then by `readPlayerReplica`,
`fromReplica` and `readPlayerMap` (the pair rule, which the field-level checker deliberately leaves to
the reader):

| `routeRevision` | `nextWaypointIndex` | Meaning | Accepted |
| --- | --- | --- | --- |
| `0` | `0` | no route | yes, reconstructed as `null` |
| `> 0` | `0` | active route, at its first waypoint | yes |
| `> 0` | `> 0` | active route, at a later waypoint | yes |
| `0` | `> 0` | no route with a waypoint pointer | no, `INVALID_PAYLOAD` |
| `< 0`, fractional, `> uint32` | any | not representable | no, `INVALID_PAYLOAD` |

`null` never crosses the wire: an absent route becomes the `0 / 0` sentinel on the way out and the
`null` route on the way back. Waypoint-count bounds belong to the server route store (UDG-003 and
UDG-007), not to the projection layer, which cannot know a path's length. Proof: `tests/unit/udg-002/mapping.test.ts`
round-trips every accepted canonical route and every accepted wire pair in both directions, re-projects
each reconstruction onto the same wire pair, and refuses each malformed shape at every supported entry
point.

### 6.3 Normalisation order

Exact-copy assertions are only meaningful after normalisation, so the order is fixed:

1. validate;
2. normalise yaw into `[-π, π)` (`+π` becomes `-π`) and rewrite signed zero `-0` to `+0`;
3. project;
4. encode, decode;
5. assert equality against the **normalised** value.

Mapping refuses unnormalised input rather than quietly wrapping it: `toReplica` rejects `yaw = +π` and
rejects any signed-zero scalar, because the codec turns `-0` into `+0` and a "round trip is exact"
claim made before normalisation would be false in a way nobody would notice.

### 6.4 Codec facts this edition relies on (pinned `@colyseus/schema@5.0.45`, MIT)

- `float64` preserves `0.1 + 0.2`, `-Math.PI`, `5e-324`, `Number.MAX_VALUE`, `NaN`, `Infinity` and
  `-Infinity` — which is why finiteness must be refused *before* the codec, not trusted after it.
- `-0` decodes as `+0`.
- integer fields **silently wrap or truncate** out-of-range input, and a definition mismatch may
  continue with only a warning. Every integer is width-checked by mapping before encoding and again
  after decoding.
- A truncated buffer may decode partially instead of throwing. The tripwire is `sessionEpoch`: a
  replica that never carried an epoch decodes to `0`, which is below `EPOCH_MIN`, so mapping refuses
  it with `INVALID_PAYLOAD` rather than adopting a zero-filled player. This is a mapping-boundary
  guarantee only; framing validation on the transport belongs to UDG-003 and the Gate A probes, and
  `docs/contracts/UDG-002.md` must not be read as claiming otherwise.
- Room-free full snapshots use `new Encoder(state).encodeAll()` with `new Decoder(target).decode(bytes)`.
- `InputEncoder` rejects nested schema fields, so the direct-input declaration stays flat.

## 7. Configuration canonicalisation and hashing

`@udg/config` defines the digest both server and client must reproduce:

- canonical form: UTF-8, object keys sorted lexicographically, array order preserved, finite JSON
  values only, `-0` written as `0`;
- `canonicalHash(value)` is `sha256(canonicalJson({ kind, ...value }))`;
- kinds in use: `udg-config` (whole `ServerConfig`, including `limits`), `udg-movement-config`
  (movement plus controller), `udg-region-config`;
- a region with no bounds hashes `bounds: null` rather than omitting the key, so "absent" is a hashed
  fact rather than an absence that silently matches a different document;
- the implementation is pure TypeScript SHA-256 with no `node:crypto`, because the client computes
  the same hash; `tests/unit/udg-002/config.test.ts` cross-checks every digest against
  `node:crypto`.

`ServerConfig` blocks are `protocolVersion`, `region`, `movement`, `controller`, `network` and
`limits`. `limits` is not accepted from a configuration document: it is re-issued from the protocol
build, and an overriding or unknown `limits` block is `UNKNOWN_KEY`/`INCONSISTENT`. Values whose
authority is still pending (the P07 controller and gravity numbers) are named in
`PROVISIONAL_P07_FIELDS` so no consumer can mistake them for adopted defaults.

## 8. Explicitly absent from this edition

| Absent | Owner | Why it is not a gap here |
| --- | --- | --- |
| Admission, watermarks, `RESYNC_REQUIRED` issuance, supersede ordering | UDG-003 | decision U2-6 |
| Movement, locomotion and physics behaviour | UDG-005, UDG-006 | UDG-002 defines declarations only |
| Route computation and waypoint bounds | UDG-007 | server route store |
| Room, SDK, fixed-step prediction and transport framing | UDG-003, UDG-SPIKE-001 | Gate A probes |
| Real region bounds and `region.json` | UDG-007, loaded by UDG-003 | decision D5; fixture bounds are labelled `test-only-synthetic` |
| Frozen encoding widths | Gate A (`UDG-SPIKE-001`) | ADR 0001 |
| Browser, load and spike suites | UDG-004, UDG-SPIKE-001..003 | guarded commands still refuse |

## 9. Where each claim is proved

| Section | Proof |
| --- | --- |
| 1, 3, 4, 5 | `tests/unit/udg-002/validation.test.ts`, `tests/fixtures/protocol/malformed.json` |
| 2 | `tests/contracts/UDG-001.test.ts` entry-map test, `BOUNDARY-DOMAIN-NO-SCHEMA` fixtures |
| 6, 6.1–6.4 | `tests/unit/udg-002/schema-roundtrip.test.ts`, `mapping.test.ts`, `tests/fixtures/protocol/valid.json` |
| 6.2 | `tests/unit/udg-002/mapping.test.ts` (both directions, exact round trip, no-bypass regression), `tests/fixtures/protocol/valid.json` V08/V09, `ordering.json` |
| 7 | `tests/unit/udg-002/config.test.ts` |
| P01–P20 fixture coverage | `tests/unit/udg-002/fixtures.test.ts` |
| Task acceptance list | `tests/contracts/UDG-002.test.ts` |

## 10. Change control

Changing anything marked **Frozen** requires an accepted ADR and a new protocol version string, and
`SUPPORTED_PROTOCOL_VERSIONS` then states the compatibility rule that ADR agreed. Changing a
**Provisional** item is expected at its named gate and must be recorded against that gate's evidence,
not slipped into an unrelated commit. `pnpm contracts:checksums` covers this file, so an edit here is
visible as contract drift rather than a quiet documentation change.
