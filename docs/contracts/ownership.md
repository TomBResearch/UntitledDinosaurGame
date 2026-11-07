# Ownership and dependencies

> Source: UDG-CONTRACTS-M0-001 v1.0, sections 2.2 and 2.3. Repository edition 1. Shared requirements are authoritative here; task files link to them.

The [task index](README.md#task-sequence) is the dependency navigation view. Each task owns its prerequisite metadata.

### 2.2 Roles and shared file control

The integration owner controls architecture, contract adoption, schema compatibility, simulation rate, input ordering and final gate decisions. The networking owner controls SDK adapters; physics and navigation owners control their adapters and assets. A task implementer may propose changes but cannot self-approve an architectural exception. One person may hold several roles, but the completion record must distinguish implementation and acceptance decisions.

Each assignment records prerequisite commit SHAs and the exact allowed-file manifest. The individual task contracts list the expected files. Descendant directories are not a blanket licence to change neighbouring systems. Root manifests, pnpm-lock.yaml, CI, protocol schemas and shared configuration are controlled files: changes require the responsible maintainer's review and must be listed in the completion report. Package entry points export only documented public interfaces.

Parallel work must begin from compatible prerequisites, avoid simultaneous edits to shared files and hand off changes through reviewed commits. The integration owner resolves ownership collisions before merge. Do not repair another package by importing its private modules.

### 2.3 Package dependency rules

| Package or app | Permitted dependencies | Prohibited dependencies |
| --- | --- | --- |
| protocol/domain | TypeScript domain declarations only | Runtime schema, UI and engines |
| protocol/schema | protocol/domain and pinned schema library | Room, browser, physics and navigation engines |
| config | protocol/domain types and validation utilities | Apps, rendering and engine adapters |
| simulation | protocol/domain and config types | Browser APIs, Room, concrete Rapier or Recast |
| physics | protocol/domain and Rapier | Apps, Babylon.js and Recast |
| navigation | protocol/domain, config types and Recast | Apps and Babylon.js |
| server | Shared packages and Colyseus server stack | Client and browser UI |
| client | Shared packages, SDK, Babylon.js and React | Server, filesystem and database modules |
| asset pipeline | Domain, config, generators and file utilities | Server room or browser runtime |

Use package export maps to prevent accidental schema imports into pure domain consumers. The dependency checker must inspect value imports, type imports, dynamic imports and cross-package relative paths. There must be no cycles, including cycles hidden by barrels. Test-only dependencies are explicitly allowlisted and cannot enter runtime bundles.
