# Rapier and Recast validation contract

> Source: UDG-CONTRACTS-M0-001 v1.0, section 6.3. Repository edition 1. Shared requirements are authoritative here; task files link to them.

### 6.3 Rapier and Recast evidence contract

Official Rapier guidance separates movement computation from applying translation and states that deterministic results depend on identical setup and creation order. This motivates the adapter and restoration probes; it does not prove scalar rollback for UDG. See V3 and V4. Freeze exact Rapier package, WASM binary hash, initialisation path, controller settings, query update order and collider construction order at Gate B. Test standalone collider first, then compare a kinematic-body alternative only if needed. Record why the selected representation wins.

The Recast JavaScript project documents offline generation and binary import/export in Node and browser environments; see V5. UDG-007 must prove its chosen package family and version actually builds and imports the same bytes, queries complete routes, reports partial paths and frees native allocations. Do not assume Babylon's navigation binary is compatible with an independently selected Recast build. Node must query without importing Babylon. Client import can be a compatibility probe without becoming predicted client navigation.
