# Repository checks instructions

Read [root instructions](../../AGENTS.md) and the currently assigned task first. This directory currently contains planning instructions only; implementation starts only when separately assigned.

## Applicable task contracts

- [UDG-001](../../docs/contracts/UDG-001.md)

## Shared contracts

- [Repository](../../docs/contracts/repository.md)
- [Ownership](../../docs/contracts/ownership.md)

## Local responsibilities

Own dependency, fixture, evidence and task-dispatch checks. Fail explicitly for unavailable suites, zero required tests, invalid dependency edges/cycles and corrupt evidence. Do not create success placeholders for future tasks. Later suites are added only by their owning implementation tasks.

Changes outside this package require the relevant owner and assignment scope. These instructions do not assign neighbouring tasks or grant approval to change shared interfaces.
