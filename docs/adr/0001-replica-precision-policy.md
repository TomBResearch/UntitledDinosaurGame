# ADR 0001 — Replica precision policy

Status: **Accepted**

Decision ID and title: ADR-0001 — Float64 canonical replica precision with Gate-A encoding freeze
Owner and reviewers: Project owner (`TomBResearch`), acting as integration owner and project reviewer
Date: 2026-11-08
Affected task IDs and contract clauses: UDG-002 (adopting), UDG-SPIKE-001 (Gate A freeze),
[UDG-SPEC-M0-002](../specifications/UDG-SPEC-M0-002.md) §7.2,
[interfaces/protocol.md](../interfaces/protocol.md) §4.4,
[scope.md](../contracts/scope.md) §1.3 proposal P06

This record was created directly as an accepted decision from the owner's D2 ruling on the
[UDG-002 readiness proposal](../contracts/assignments/UDG-002-readiness-proposal.md) revision 2, section 2,
reviewed at `222a787fb61597fa60a6a465044893a9985dca8c`. There is no separate `docs/adr/proposals/` file for it:
that section is the proposal, and the D2 ruling is its disposition. An agent recorded the decision on the
owner's explicit instruction and authored no approval of its own.

## Trigger and reproduction

Expected behaviour: a refinement whose deadline is a gate may be adopted at any time before that gate, and a
task may not need it early. Actual behaviour: UDG-002 cannot write a lossless replica round-trip test without a
precision policy, while baseline §7.2 reserves the decision — "Precise Colyseus field types, encoding widths and
additional predictor bookkeeping fields MUST be frozen during Spike 001" — and the ADR table routes a
"Protocol/schema/timestep change" to an integration-owner ADR. The conflict is procedural, not numerical: adopting
a precision policy early reserves a decision the baseline assigns to Gate A.

Pinned versions at adoption: `@colyseus/schema` `5.0.45` (MIT), installed as an exact dependency of
`@udg/protocol`; its installed declaration `RawPrimitiveType` includes `float64`, `uint8` and `uint32`, so the
pinned schema line can carry the declared replica widths. This is a declaration observation recorded here as the
owner instructed; the encode/decode proof is UDG-002's round-trip suite and the Gate A probes, not this file.

Reproduction command (UDG-002 round trip, room-free, against the pinned package):

```bash
export PATH="$HOME/.local/bin:$PATH"
pnpm test:unit
pnpm test:contract -- --task UDG-002
```

Evidence: `roundtrip-results.json`, `protocol-field-map.json` and `rejection-results.json` inside the UDG-002
evidence bundle named in [assignments/UDG-002-completion.md](../contracts/assignments/UDG-002-completion.md).

## Alternatives and recommendation

| Option | Tradeoff | Outcome |
| --- | --- | --- |
| Defer all precision policy to Gate A | Strictly follows §7.2, but UDG-002 must then either write lossy mapping tests or assert nothing about scalars, and Gate A would inherit the rework of both the mapping and its fixtures | Rejected |
| Adopt float64 policy now **and** freeze encoding widths now | Removes all ambiguity, but pre-empts exactly what §7.2 reserves to Spike 001 and would let a schema-capability surprise land as a UDG-002 defect | Rejected |
| **Deferred freeze:** adopt the float64 canonical policy and the lossless-mapping requirement now; keep concrete encoding widths, schema constructors and predictor bookkeeping frozen at Gate A | UDG-002 becomes testable against a declared policy, and the decision §7.2 reserves stays where §7.2 put it | **Accepted (D2)** |

Compatibility and migration: the policy is additive for UDG-002, whose mapping is written against it from the
first commit. Any later narrowing to a smaller width is a precision change, so it requires a new ADR **and**
reruns of the correction and replay fixtures, which [protocol.md](../interfaces/protocol.md) §4.4 already demands.
No security or performance impact is claimed; bandwidth cost of float64 fields is a Gate A measurement, not an
assumption settled here.

## Decision and validation

Owner decision and rationale: **Accepted** on 2026-11-08 as decision D2.

1. The canonical domain uses JavaScript **float64 end to end**, and the replica mapping for the
   [protocol.md](../interfaces/protocol.md) §4.4 field set must be **lossless**: a round trip is compared by exact
   equality after yaw wrap and signed-zero normalisation, never by a tolerance.
2. **Schema encoding widths, concrete schema builders and SDK predictor bookkeeping fields remain Gate A
   candidates** per baseline §7.2 and [protocol.md](../interfaces/protocol.md) §4.4. UDG-002 marks the width
   declaration `provisional` in [docs/contracts/protocol-v1.md](../contracts/protocol-v1.md) and in
   `protocol-field-map.json`.
3. **Derived quantities** inside UDG-002 fixtures — velocity reconstructed from resolved displacement over
   `dt = 0.05 s`, axis normalisation and yaw-wrap arithmetic — may be asserted with an absolute tolerance of
   **1e-9** per axis and per metre per second. This is the only new number this ADR adopts.
4. `vy` and `verticalVelocity` are distinct values; both are replicated and both are restored, and the round trip
   asserts `verticalVelocity` explicitly.
5. **No physical, networked or interpolated tolerance is adopted here.** The physics adoption `1e-5 m`, replay
   `1e-3 m`, flat travel `1e-6 m`, correction p95 `0.15 m`, penetration `0.02 m` and arrival `0.2 m` thresholds
   stay owned by the baseline and by P10, and by
   [acceptance-gates.md](../validation/acceptance-gates.md).
6. If the pinned schema cannot carry a declared width, that is a failed probe: the implementer records what the
   installed declarations do provide and escalates through
   [docs/adr/README.md](README.md). No invented decorator, no silent float32 downgrade and no weakened assertion.

Required contract/protocol updates and affected gates to rerun: UDG-002 records the policy and the provisional
marker in `docs/contracts/protocol-v1.md`; P06 may be revisited at Gate B only, by ADR, as
[scope.md](../contracts/scope.md) §1.3 requires. Gate A (UDG-SPIKE-001) must confirm or replace the encoding
widths; a change then reruns the correction and replay fixtures. Gates A, B and C remain Not Run: this ADR passes
no gate.

Evidence links and follow-up work: the UDG-002 evidence bundle for the commit this ADR was adopted against;
`docs/integration/dependencies.json` for the pinned schema identity; UDG-003 and UDG-SPIKE-001 owe
`docs/integration/colyseus-0.18-api-map.md`, which records the declaration file and symbol behind every used API.

Supersedes or is superseded by: supersedes nothing. Expected to be superseded or confirmed by the Gate A
schema-freeze record for UDG-SPIKE-001.
