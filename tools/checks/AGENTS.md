# Repository checks instructions

Read [root instructions](../../AGENTS.md) and the currently assigned task first. This directory contains implemented code, not planning instructions: `@udg/checks` was written by [UDG-001](../../docs/contracts/UDG-001.md) and extended by [UDG-002](../../docs/contracts/UDG-002.md) under the controlled-path grant in that task's assignment record, which authorised the fixture layout, the per-task capture plan and the report-derived artefact rule and nothing else. Extending this package further needs its own task and assignment; no suite, asset pipeline or load-test harness is implied by its existence here.

## Applicable task contracts

- [UDG-001](../../docs/contracts/UDG-001.md) — created this package
- [UDG-002](../../docs/contracts/UDG-002.md) — extended it under an assignment-scoped grant

## Shared contracts

- [Repository](../../docs/contracts/repository.md)
- [Ownership](../../docs/contracts/ownership.md)

## Local responsibilities

Own dependency, fixture, evidence and task-dispatch checks. Fail explicitly for unavailable suites, zero required tests, invalid dependency edges/cycles and corrupt evidence. Do not create success placeholders for future tasks. Later suites are added only by their owning implementation tasks.

Changes outside this package require the relevant owner and assignment scope. These instructions do not assign neighbouring tasks or grant approval to change shared interfaces.
