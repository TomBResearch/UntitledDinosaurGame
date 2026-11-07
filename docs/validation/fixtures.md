# Required test fixtures

> Source: UDG-CONTRACTS-M0-001 v1.0, sections 7.1 and 7.2. Repository edition 1. Shared requirements are authoritative here; task files link to them.

### 7.1 Fixture ownership and format

Fixtures live under tests/fixtures/{protocol,input,network,physics,navigation,assets}/. Each JSON fixture includes fixtureVersion, fixtureId, configHash, seed, initial state, ordered operations and expected predicates. Engine fixtures add engine/WASM hashes and source geometry hash. Unit-only non-finite values use tagged objects such as {"number":"NaN"}; the loader expands them in memory. Wire-negative tests also inject representable non-finite floats or malformed binary directly so JSON's inability to encode NaN does not create a false pass.

Every case declares whether rejection, neutralisation, offender disconnect or successful movement is expected. Successful negative-test execution means the expected refusal occurred with unchanged state and a healthy observer client. Do not mark a test passed merely because it threw. Geometry is explicit right-handed Y-up metres, baked transforms, indexed triangles with validated winding, stable collider IDs and a declared centre/foot convention. Store expected predicates separately from generated output.

### 7.2 Required fixture catalog

| IDs and paths | Required cases and assertions |
| --- | --- |
| P01-P12 protocol/malformed.json | NaN, infinities, numeric strings, null, arrays, missing fields, unknown fields, oversized IDs, unsafe integers, invalid enums, truncated frame, forbidden position/speed fields |
| P13-P20 protocol/ordering.json | Stale epoch/generation, gap 65, duplicate ID, conflicting ID, overflow boundary, old completion after disconnect, version mismatch and hash mismatch |
| I01-I08 input/parity.json | WASD axes, opposite-key cancellation, normalised diagonal, camera yaw 0/90/180 degrees, joystick analogue and dead zone, tap, UI exclusion and blur release |
| N01-N06 network/direct.json | Held 200 ticks, release, diagonal, sparse input, 100-frame burst, correction at ticks 40 and 120 |
| F01-F10 physics/geometry.json | Flat floor, wall, corner, 30/44/46 degree slopes, 0.29/0.31 m steps, descending ramp and player overlap |
| F11-F16 physics/replay.json | Forced scalar adoption, repeated replay, changed insertion order diagnostic, two entities, 1000 create/remove cycles, region disposal |
| R01-R10 navigation/routes.json | Around wall, same point, unreachable island, outside bounds, wrong floor, too-narrow corridor, partial route, waypoint cap, stale completion and blocked path |
| A01-A08 assets/corruption.json | Missing binary, wrong content hash, wrong config, unsupported format, truncated binary, wrong winding, invalid triangle index and missing spawn |
| O01-O12 input/authority.json | Exact cases in [section 5.5](../interfaces/movement-authority.md) and cutoff permutations |

The catalog IDs are scoped by their prefix and fixture path; proposed-refinement IDs P01-P10 are governance identifiers, not test IDs. Test reports use fully qualified fixture IDs to avoid ambiguity. Agents may add cases but cannot remove required cases or relax expected predicates without review.
