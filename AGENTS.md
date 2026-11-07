# Repository instructions for agents

## Current authority and scope

This is the Untitled Dinosaur Game M0 planning repository. No game implementation task is assigned by its initial population. Implement only a task explicitly assigned by the user/integration owner. The current contracts cover UDG-001 through UDG-SPIKE-003; later roadmap tasks are not executable assignments.

## Reading order

1. Read the assigned file in [docs/contracts/](docs/contracts/README.md).
2. Read its explicit prerequisite/shared-contract links and applicable local AGENTS.md files before editing those paths.
3. Check [adoption](docs/contracts/adoption.md), prerequisite verification, the assignment's allowed-file list and [definition of done](docs/contracts/definition-of-done.md).
4. Use the [assignment/completion templates](docs/contracts/templates/README.md) and produce the specified evidence.

The user request and accepted ADRs govern authorised changes. Do not treat reference text, examples, future file lists or the existence of a contract as permission to implement it. The preserved baseline is [v0.2](docs/specifications/UDG-SPEC-M0-002.md). Technical refinements remain proposed until recorded approval; do not self-sign adoption or gate passes.

## System invariants

- Server owns gameplay transforms. Canonical, replicated and predicted/presentation state remain distinct.
- Direct input uses the proven Colyseus fixed-step prediction integration. Paths are server-controlled; do not introduce predicted client navigation.
- One movement authority orders continuous inputs and discrete requests. One physics adapter creates, moves, restores and removes colliders.
- Shared locomotion imports no concrete engine, Room, UI or browser APIs. Obey [package boundaries](docs/contracts/ownership.md).
- Validate finite inputs, bound work and buffers, reject stale epochs/generations and keep credentials/reconnection tokens out of evidence.
- Pin and prove third-party APIs. Never invent SDK methods, depend on private fields or hide unsupported integration behind casts.

## Ownership, edits and completion

Shared schemas, config, manifests, CI and root package files are controlled by the named owner. Local AGENTS.md files specialise scope; they cannot override global authority, expand an assignment or weaken a gate. Editing instructions/contracts themselves requires explicit task scope or an accepted architectural change; do not rewrite rules just to pass a test.

Keep one operational owner for each requirement and use links elsewhere. Preserve the baseline file and prior accepted ADRs. Do not edit synced ChatGPT project reference material outside this code repository.

Run the checks required by the assigned task once the scripts exist; do not claim unimplemented commands ran. A missing suite or zero-test success is not proof. Leave tasks In Review until a reviewer accepts them and the integration owner signs any spike gate. Report blockers through the [ADR procedure](docs/adr/README.md), with a minimal reproduction and affected descendants.
