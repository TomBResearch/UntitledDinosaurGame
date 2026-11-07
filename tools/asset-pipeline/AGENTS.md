# Asset pipeline instructions

Read [root instructions](../../AGENTS.md) and the currently assigned task first. This directory currently contains planning instructions only; implementation starts only when separately assigned.

## Applicable task contracts

- [UDG-007](../../docs/contracts/UDG-007.md)

## Shared contracts

- [Navigation](../../docs/interfaces/navigation.md)
- [Configuration](../../docs/interfaces/configuration.md)
- [Engines](../../docs/integration/engines.md)

## Local responsibilities

Build visual, collision and navmesh assets offline from one versioned source geometry. Bake transforms once, preserve RH Y-up metre conventions and verify all manifest hashes. Deterministic rebuilds must match byte-for-byte. Do not introduce a runtime server dependency on rendering or silently mix binary formats.

Changes outside this package require the relevant owner and assignment scope. These instructions do not assign neighbouring tasks or grant approval to change shared interfaces.
