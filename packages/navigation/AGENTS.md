# Navigation instructions

Read [root instructions](../../AGENTS.md) and the currently assigned task first. This directory currently contains planning instructions only; implementation starts only when separately assigned.

## Applicable task contracts

- [UDG-007](../../docs/contracts/UDG-007.md)
- [UDG-SPIKE-003](../../docs/contracts/UDG-SPIKE-003.md)

## Shared contracts

- [Domain](../../docs/interfaces/domain.md)
- [Navigation](../../docs/interfaces/navigation.md)
- [Movement Authority](../../docs/interfaces/movement-authority.md)
- [Engines](../../docs/integration/engines.md)

## Local responsibilities

Own server path queries, bounded workers, complete-route validation and binary import. Keep the domain query synchronous inside the worker. Never import Babylon into server navigation, return accepted partial paths or let a stale completion overwrite current intent. Schema/asset hashes, reserved route revisions and epoch/generation commit guards are mandatory.

Changes outside this package require the relevant owner and assignment scope. These instructions do not assign neighbouring tasks or grant approval to change shared interfaces.
