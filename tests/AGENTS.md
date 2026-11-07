# Test fixtures and suites instructions

Read [root instructions](../AGENTS.md) and the currently assigned task first. This directory currently contains planning instructions only; implementation starts only when separately assigned.

## Applicable task contracts

The assigned task determines the permitted test scope; use the task index in the root instructions.

## Shared contracts

- [Fixtures](../docs/validation/fixtures.md)
- [Measurement](../docs/validation/measurement.md)
- [Acceptance Gates](../docs/validation/acceptance-gates.md)

## Local responsibilities

Create fixtures/suites only under the assigned task. Preserve required IDs, expected refusals, ordering permutations and raw evidence. A negative test passes only when the expected safe outcome occurs; an exception alone is insufficient. Test-only engine/app dependencies must not enter runtime bundles. Do not weaken thresholds or skip required cases to obtain green results.

Changes outside this package require the relevant owner and assignment scope. These instructions do not assign neighbouring tasks or grant approval to change shared interfaces.
