# Physics adapter instructions

Read [root instructions](../../AGENTS.md) and the currently assigned task first. This directory currently contains planning instructions only; implementation starts only when separately assigned.

## Applicable task contracts

- [UDG-006](../../docs/contracts/UDG-006.md)
- [UDG-SPIKE-002](../../docs/contracts/UDG-SPIKE-002.md)

## Shared contracts

- [Domain](../../docs/interfaces/domain.md)
- [Configuration](../../docs/interfaces/configuration.md)
- [Engines](../../docs/integration/engines.md)

## Local responsibilities

CharacterPhysics exclusively owns character colliders, controllers and lifecycle. Synchronise canonical pose before resolving and fully adopt scalar state before replay. Include static-world collision and exclude player locomotion collision. Test standalone capsules first; representation and reconciler/sim choice are Gate B decisions. No dynamic pushing or moving platforms.

Changes outside this package require the relevant owner and assignment scope. These instructions do not assign neighbouring tasks or grant approval to change shared interfaces.
