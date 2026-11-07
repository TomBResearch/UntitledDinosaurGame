# Protocol instructions

Read [root instructions](../../AGENTS.md) and the currently assigned task first. This directory currently contains planning instructions only; implementation starts only when separately assigned.

## Applicable task contracts

- [UDG-002](../../docs/contracts/UDG-002.md)

## Shared contracts

- [Domain](../../docs/interfaces/domain.md)
- [Protocol](../../docs/interfaces/protocol.md)

## Local responsibilities

Own domain declarations, flat fixed-input encoding, replicated schemas, validation, results and mapping. Keep domain exports free of schema runtime imports. Do not duplicate types in app code or trust a client entity ID/position. Networking spikes may refine encoding only through owner-reviewed changes and passing protocol regressions.

Changes outside this package require the relevant owner and assignment scope. These instructions do not assign neighbouring tasks or grant approval to change shared interfaces.
