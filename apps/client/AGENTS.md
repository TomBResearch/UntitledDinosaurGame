# Browser client instructions

Read [root instructions](../../AGENTS.md) and the currently assigned task first. This directory currently contains planning instructions only; implementation starts only when separately assigned.

## Applicable task contracts

- [UDG-004](../../docs/contracts/UDG-004.md)
- [UDG-SPIKE-001](../../docs/contracts/UDG-SPIKE-001.md)
- [UDG-008](../../docs/contracts/UDG-008.md)
- [UDG-SPIKE-003](../../docs/contracts/UDG-SPIKE-003.md)

## Shared contracts

- [Protocol](../../docs/interfaces/protocol.md)
- [Movement Authority](../../docs/interfaces/movement-authority.md)
- [Configuration](../../docs/interfaces/configuration.md)
- [Colyseus](../../docs/integration/colyseus.md)

## Local responsibilities

Own Babylon/React presentation, camera, input adapters and the SDK prediction wrapper. One fixed-step sender and one local pose owner. Input adapters produce intentions, not authoritative positions. Do not import server internals, databases or filesystem APIs; do not predict navigation paths.

Changes outside this package require the relevant owner and assignment scope. These instructions do not assign neighbouring tasks or grant approval to change shared interfaces.
