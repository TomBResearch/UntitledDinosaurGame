# Spike and measurement harness instructions

Read [root instructions](../../AGENTS.md) and the currently assigned task first. This directory currently contains planning instructions only; implementation starts only when separately assigned.

## Applicable task contracts

- [UDG-SPIKE-001](../../docs/contracts/UDG-SPIKE-001.md)
- [UDG-SPIKE-002](../../docs/contracts/UDG-SPIKE-002.md)
- [UDG-SPIKE-003](../../docs/contracts/UDG-SPIKE-003.md)

## Shared contracts

- [Measurement](../../docs/validation/measurement.md)
- [Fixtures](../../docs/validation/fixtures.md)
- [Acceptance Gates](../../docs/validation/acceptance-gates.md)

## Local responsibilities

Implement only the minimum harness required by the assigned spike. Record achieved network conditions, raw matched-boundary corrections, seeds and hashes. Preserve WebSocket byte ordering; do not label application-message loss as datagram packet loss. A two-client spike does not complete UDG-011 or certify 20-player/hardware release performance.

Changes outside this package require the relevant owner and assignment scope. These instructions do not assign neighbouring tasks or grant approval to change shared interfaces.
