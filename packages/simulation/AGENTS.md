# Shared locomotion instructions

Read [root instructions](../../AGENTS.md) and the currently assigned task first. This directory currently contains planning instructions only; implementation starts only when separately assigned.

## Applicable task contracts

- [UDG-005](../../docs/contracts/UDG-005.md)

## Shared contracts

- [Domain](../../docs/interfaces/domain.md)
- [Movement Authority](../../docs/interfaces/movement-authority.md)
- [Configuration](../../docs/interfaces/configuration.md)

## Local responsibilities

Implement entity-bound locomotion, authority transitions and scoped route storage. Consume interfaces and fixed state/input/config only. Do not import Babylon, React, DOM, Room, Rapier or Recast implementations. Do not query routes, send messages, read wall clocks or emit replayed presentation effects inside step.

Changes outside this package require the relevant owner and assignment scope. These instructions do not assign neighbouring tasks or grant approval to change shared interfaces.
