# M0 agent task contracts

Document ID: `UDG-CONTRACTS-M0-001`  
Version: 1.0, repository edition 1  
Scope: UDG-001 through UDG-SPIKE-003 only  
Planning content is available. Game implementation has not begun and no validation gate has run.

## Start an agent assignment

1. Read the root [AGENTS.md](../../AGENTS.md).
2. Open the one task contract assigned to you below.
3. Read its explicit shared-contract list and applicable local instructions.
4. Check [adoption status](adoption.md), prerequisite verification and [definition of done](definition-of-done.md).
5. Record an [assignment](templates/assignment.md) with immutable prerequisite commits before code work begins. Implement only that authorised scope.

The per-task metadata is the implementation status record. All tasks initially say Not Started. An index entry or file's existence is not a passed task. Gate decisions and evidence belong in the future gate records linked below.

## Task sequence

| Task | Deliverable | Requires Verified | Gate |
| --- | --- | --- | --- |
| [UDG-001](UDG-001.md) | Workspace and CI | None | Foundation |
| [UDG-002](UDG-002.md) | Protocol and validation | [UDG-001](UDG-001.md) | Foundation |
| [UDG-003](UDG-003.md) | Fixed step room | [UDG-002](UDG-002.md) | A |
| [UDG-004](UDG-004.md) | Browser client and camera | [UDG-001](UDG-001.md) | A |
| [UDG-SPIKE-001](UDG-SPIKE-001.md) | Networking gate | [UDG-003](UDG-003.md), [UDG-004](UDG-004.md) | A |
| [UDG-005](UDG-005.md) | Shared locomotion | [UDG-SPIKE-001](UDG-SPIKE-001.md) | B |
| [UDG-006](UDG-006.md) | Rapier adapter | [UDG-005](UDG-005.md) | B |
| [UDG-SPIKE-002](UDG-SPIKE-002.md) | Physics gate | [UDG-006](UDG-006.md) | B |
| [UDG-007](UDG-007.md) | Asset pipeline and navigation | [UDG-SPIKE-002](UDG-SPIKE-002.md) | C |
| [UDG-008](UDG-008.md) | Input adapters | [UDG-004](UDG-004.md), [UDG-005](UDG-005.md) | C |
| [UDG-SPIKE-003](UDG-SPIKE-003.md) | Hybrid movement gate | [UDG-007](UDG-007.md), [UDG-008](UDG-008.md) | C |

UDG-004 may run alongside UDG-002/003 after UDG-001. UDG-008 may run alongside UDG-006 and Gate B work after UDG-005. This is a dependency schedule, not a request to spawn agents. No descendant may bypass an unpassed spike. [Ownership rules](ownership.md) control concurrent changes and shared files.

## Common contracts

- [Scope and proposed refinements](scope.md)
- [Ownership and dependency boundaries](ownership.md)
- [Repository layout and planned commands](repository.md)
- [Public interfaces](../interfaces/README.md)
- [Third-party validation](../integration/README.md)
- [Fixtures, measurements and gates](../validation/README.md)
- [Evidence requirements](../validation/evidence-requirements.md)
- [Definition of done](definition-of-done.md)
- [Architecture decisions](../adr/README.md)
- [Review-finding traceability](traceability.md)
- [Assignment and completion templates](templates/README.md)

## Later milestones

UDG-009 through UDG-012 are baseline roadmap context, not assignable contracts in this edition. Gate C is not an M0 release decision. No implementation task is assigned by publishing these files.
