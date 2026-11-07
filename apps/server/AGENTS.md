# Server integration instructions

Read [root instructions](../../AGENTS.md) and the currently assigned task first. This directory currently contains planning instructions only; implementation starts only when separately assigned.

## Applicable task contracts

- [UDG-003](../../docs/contracts/UDG-003.md)
- [UDG-SPIKE-001](../../docs/contracts/UDG-SPIKE-001.md)
- [UDG-SPIKE-003](../../docs/contracts/UDG-SPIKE-003.md)

## Shared contracts

- [Protocol](../../docs/interfaces/protocol.md)
- [Movement Authority](../../docs/interfaces/movement-authority.md)
- [Configuration](../../docs/interfaces/configuration.md)
- [Colyseus](../../docs/integration/colyseus.md)

## Local responsibilities

Own room lifecycle, input admission, authoritative ticking and replication. Map server-owned identity to one entity and application epoch. Handlers queue observations; only the fixed-step authority moves entities. Do not import the client or browser UI, drain bursts into extra movement steps, or author colliders outside CharacterPhysics.

Changes outside this package require the relevant owner and assignment scope. These instructions do not assign neighbouring tasks or grant approval to change shared interfaces.
