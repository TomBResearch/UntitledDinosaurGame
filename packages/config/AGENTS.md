# Shared configuration instructions

Read [root instructions](../../AGENTS.md) and the currently assigned task first. This directory contains implemented code, not planning instructions: `@udg/config` was written by [UDG-002](../../docs/contracts/UDG-002.md), which the owner accepted on 2026-11-09 (Verified). Writing it assigned no further work here — production region bounds, the pending P07 values and any later configuration still need their own task and assignment.

## Applicable task contracts

- [UDG-002](../../docs/contracts/UDG-002.md)

## Shared contracts

- [Configuration](../../docs/interfaces/configuration.md)

## Local responsibilities

Own versioned readonly movement, region, network and limit values plus canonical hashes. Define units and one shared source for client/server settings. Do not depend on applications or concrete engines. Changes to speed, timestep, dimensions, precision or asset compatibility need integration-owner review and affected gate reruns.

Changes outside this package require the relevant owner and assignment scope. These instructions do not assign neighbouring tasks or grant approval to change shared interfaces.
