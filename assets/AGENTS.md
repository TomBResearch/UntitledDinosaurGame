# Source and generated assets instructions

Read [root instructions](../AGENTS.md) and the currently assigned task first. This directory currently contains planning instructions only; implementation starts only when separately assigned.

## Applicable task contracts

- [UDG-007](../docs/contracts/UDG-007.md)

## Shared contracts

- [Navigation](../docs/interfaces/navigation.md)
- [Configuration](../docs/interfaces/configuration.md)

## Local responsibilities

Source geometry is versioned under assets/source; generated region files are derived by the assigned offline pipeline. Do not hand-edit generated files or build unrelated art. Preserve stable geometry identity and manifest hashes; incompatible assets must fail before player admission.

Changes outside this package require the relevant owner and assignment scope. These instructions do not assign neighbouring tasks or grant approval to change shared interfaces.
