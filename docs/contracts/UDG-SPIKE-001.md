# UDG-SPIKE-001 Networking gate

> Source: UDG-CONTRACTS-M0-001 v1.0, section 12. Repository edition 1. Shared requirements are authoritative here; task files link to them.

## Assignment metadata

- Task: `UDG-SPIKE-001`
- Implementation status: **Ready — assigned, implementation not started** (2026-11-19, dated by commit)
- Gate: A — **Not Run**; its execution and decision belong to this task and the delegated approver, not to this metadata block
- Requires Verified: [UDG-003](UDG-003.md) `4f567ae4596b1a5b99e35a3b48d7d9b728c2863d`, [UDG-004](UDG-004.md) `76db480892fa4aa21bd79c1bf7e939b5ddb6315e` — both Verified
- Refinement adoption: P06 (deferred-freeze until Gate A), **P10 approved 2026-11-19 for the Gate A scope only** — [adoption](adoption.md#p10-adoption-for-gate-a-and-udg-spike-001-assignment-recorded-2026-11-19-dated-by-commit)
- Assignment, implementer, reviewer, prerequisite commits and evidence: **assigned 2026-11-19** — [assignment record](assignments/UDG-SPIKE-001.md). Implementer: Pi. Reviewer and integration approver: Codex, delegated by the project owner on 2026-11-19. Baseline `fc63b65edca55a439862b6e674dc2eb63ef80708` (routine CI 44415266083, success). Gate A evidence: **none yet**; store `/workspace/udg-evidence`; D4 open

## Read before this task

- [Repository instructions](../../AGENTS.md)
- [Adoption status](adoption.md)
- [Definition of done](definition-of-done.md)
- [Evidence requirements](../validation/evidence-requirements.md)
- [Protocol](../interfaces/protocol.md)
- [Configuration](../interfaces/configuration.md)
- [Colyseus](../integration/colyseus.md)
- [Measurement](../validation/measurement.md)
- [Acceptance Gates](../validation/acceptance-gates.md)

Read applicable ancestor and local `AGENTS.md` files before editing a path. Owned paths below are the proposed implementation scope, not permission to start the task. Use the linked assignment template and pin commits when it is separately assigned. All common requirements are incorporated by reference.

## Task contract

### Objective and prerequisites

Prove server authority, local direct prediction and remote interpolation without Rapier or Recast. Requires Verified 003 and 004, completed API probes and adopted Gate A P10 thresholds. Networking owner implements; integration owner decides Gate A. The flat shared step from tests/reference/flat-direct-step.ts is the sole movement function used by both sides of this experiment.

### Owned files and implementation

Create apps/client/src/network/{ColyseusPredictionAdapter,RemotePresentation}.ts; tests/probes/{colyseus-client,colyseus-roundtrip}.probe.ts; tests/spikes/spike-001.test.ts; tests/e2e/netcode.spec.ts; tests/fixtures/network/direct.json; tools/load-test/{package.json,tsconfig.json}; tools/load-test/src/{run-spike,ws-delay-proxy,trace-writer,statistics}.ts; docs/integration/gate-a.md; and docs/integration/colyseus-0.18-api-map.md updates.

Use two independent browser contexts joining the same room. One sends held, released and diagonal movement; the second observes smoothing. The local raw predicted state must respond within one fixed input step plus one rendered frame, measured under the declared browser schedule. Render reads are derived from the validated SDK controller; never mutate the received schema to fake prediction. Force a labelled server correction at ticks 40 and 120 and prove adoption followed by replay of remaining valid inputs exactly once.

Document each concrete server/client API and exact import in the API map. Freeze input/schema encoding, replica precision, framework bookkeeping, ack semantics and neutral idle behaviour at this gate. List any unused v0.2 state fields as encoded defaults; do not remove them because the flat spike does not yet use gravity or paths. Confirm remote smoothing never predicts unowned gameplay input and local prediction never causes a second authoritative movement step.

### Required commands and tests

Run root checks, pnpm test:contract -- --task UDG-SPIKE-001, pnpm test:e2e -- --suite netcode and pnpm test:spike -- --id UDG-SPIKE-001 --profile PROFILE --seed SEED for every profile/seed in [section 7.4](../validation/measurement.md). Include N01-N06, malformed axes, speed attempt, missing frame, queue burst/overflow, duplicate sender registration, forced correction, server restart, patch batching and missing advertised fixed rate. A missing required runtime field is an explicit failure.

### Gate A acceptance and evidence

Pass only if all required tests pass in all seeds, speed/step limits hold, elevated unobstructed p95 raw correction is below 0.15 m, forced correction converges to the matched acknowledged state within 0.000001 m in the pure flat replay check, and observer interpolation follows the accepted timeline without authoring it. Report remote interpolation delay and maximum discontinuity separately; exclude labelled correction teleports from smoothness statistics but include their raw correction in diagnostic reports.

Evidence is a complete common evidence bundle plus api-map.md, schema-freeze.json, raw-corrections.csv, matched-ack-trace.jsonl, remote-render.csv and a short annotated browser recording or screenshots identifying both clients and ticks. gate-a.md must contain PASS or FAIL, thresholds, actual values, unresolved limitations, prerequisite SHAs and integration-owner decision. Failure blocks 005, 006 and all later gates. A custom predictor requires an ADR; silently replacing Colyseus primitives is prohibited.


**UDG-003's carried-forward observations arrive with its evidence (recorded 2026-11-18).** UDG-003 is
**Verified** and passes nothing, and three of the four observations it leaves open land on criteria this spike
executes formally, so they are named here rather than left in a phase record: **CF-1** — `W-7`'s delivery count
(`deliveriesReachingTheSeatDuringTheEpisode` non-zero, one hosted sighting in retained junit bytes) touches GA-6c's
premise that no fresh snapshot reached the seat, which is what keeps the episode-deadline / allowance-exhausted /
deadline distinctions separable; **CF-3** — the post-close input observation touches the containment claim behind
GA-6c/GA-7's "the seat stayed stopped"; **CF-4** — `P-2b`'s refusal wording touches GA-7's attribution of the
rejoin to the token-expiry branch as opposed to the seat-reservation branch. All three are **unclassified**: no
cause was demonstrated, UDG-003's ten-pass streak records stability under a declared load and order and is not
evidence of cause for any of them, and none was waived. A Gate A run inherits each as an open limitation to be
resolved or to block, and must say which; the UDG-003 harness's numbers cannot close them, because the harness is a
harness and Gate A's envelope is the spike's own. Owners and byte-named reopening conditions:
[UDG-003 closeout §0](assignments/evidence/UDG-003-phase-3-defect-closeout.md). **Gate A remains Not Run.**

**GA-11 execution, and the deferred exactly-once rows.** Evaluate `B + J·λ + stall ≤ bufferMaxSize` and
`clientSnapshotDeadlineMs ≥ 4 × patch interval + 2 × measured p99 RTT` on the recorded populations, name the
production values beside the provisional ones, and record whether the runner provided network-layer impairment
(`tc`/`netem` requires `NET_ADMIN`); where it did not, the loss population is re-measured with the UDG-003
Phase 2 harness impairment layer, labelled `dropModel: "application-layer delivery loss"` with
`tcpLossModelled: false`, and that limitation travels with every GA-11 number. **GA-10a and GA-10b are
outstanding for any Gate A run that precedes UDG-007 verification** and are recorded as such with the owning
task named; they do not block Gate A at its own prerequisites (UDG-003, UDG-004), and no claim covering
successful navigation effects may be made from this gate without citing both.

