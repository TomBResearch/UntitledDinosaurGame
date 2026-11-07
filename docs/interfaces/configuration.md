# Shared configuration

> Source: UDG-CONTRACTS-M0-001 v1.0, section 4.5. Repository edition 1. Shared requirements are authoritative here; task files link to them.

### 4.5 Configuration ownership

packages/config/src/{movement,network,limits,region}.ts owns readonly configuration and hashing. Preserve v0.2 defaults: world-001, region-greybox-001, 20 Hz, dt 0.05 seconds, one physics substep, patch interval 100 ms, speed 4 m/s, capsule radius 0.35 m, total height 1.8 m, maximum slope pi/4 radians, step 0.3 m, arrival tolerance 0.2 m and reconnect window 30 seconds. A client may read these values but cannot override them.

Proposed test settings P07 are gravity -9.81 m/s squared, controller offset 0.01 m, ground snap 0.10 m, minimum step-top width 0.35 m, static-only autostep and no dynamic impulses. Proposed slope-slide angle equals the climb limit initially. Capsule position denotes its centre, so level-ground centre Y is 0.9 m plus the validated controller separation. Record the actual grounded resting height in fixtures rather than assuming visual feet coincide with collision skin. Missing, non-finite or internally inconsistent configuration fails startup. Include all movement/controller values in configHash and movementConfigHash.
