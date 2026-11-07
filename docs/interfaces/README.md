# Public interface owners

| File | Authoritative subject |
| --- | --- |
| [Domain](domain.md) | Canonical TypeScript declarations and entity/route binding factories |
| [Protocol](protocol.md) | Flat input envelope, validation, results, replica projection and encoding |
| [Configuration](configuration.md) | Central values, units, precision and shared config hashes |
| [Movement authority](movement-authority.md) | Input cutoff/order, generations, transitions, pending routes and arbitration fixtures |
| [Navigation](navigation.md) | Navigation and asset contract entry points; ownership map |

These are proposed UDG contracts. They are not vendor SDK method declarations. Concrete Colyseus/Rapier/Recast signatures must be validated in the pinned-package probes. The preserved [v0.2 baseline](../specifications/UDG-SPEC-M0-002.md) remains historical design authority; operational refinements are tracked in [adoption](../contracts/adoption.md).

Each requirement has a single operational owner. Link to it when writing task/local instructions. Do not maintain copied versions in applications or package READMEs.
