# Acceptance gates

> Source: UDG-CONTRACTS-M0-001 v1.0, section 7.3. Repository edition 1. Shared requirements are authoritative here; task files link to them.

### 7.3 Proposed numerical gates

| Measurement | Proposed spike pass condition |
| --- | --- |
| Flat direct travel | 200 unobstructed ticks at 4 m/s produce 40 m horizontal travel within 0.000001 m in pure simulation |
| Speed abuse | Every tick's horizontal desired distance is at most 0.2 m plus 0.000001 m; burst cannot increase count of steps |
| Direct correction | At 100 ms RTT and 20 ms jitter, p95 raw horizontal correction below 0.15 m on unobstructed movement |
| Collision | Maximum solid-world penetration at most 0.02 m; crossing to forbidden wall side is always failure |
| Physics adoption | Canonical/collider discrepancy at most 0.00001 m after completed step |
| Physics replay | Maximum same-input Node/browser horizontal divergence at most 0.001 m; no growth over the final 200 of 1000 replay ticks |
| Route traversal | Every expected reachable route arrives within horizontal and vertical 0.2 m; no obstacle violation |
| Route responsiveness | Pending query terminates within 1000 ms or rejects NAVIGATION_BUSY; no unbounded queue |
| Route query CPU | On declared reference runner, p95 query CPU below 20 ms over 1000 warmed queries |
| Safety on transition | Stale route activations, duplicate movement commits and old-epoch accepted frames each equal zero |
| Input parity | Equivalent sampled world-space intents agree within 0.000001 per axis in pure input fixtures |

All newly supplied tolerances and sample sizes are P10 proposals. The 0.15 m direct correction and 0.02 m penetration limits come from v0.2. Threshold changes require recorded approval and rerunning affected fixtures. At Gate A, the flat-room reference may use a bounded floor or safe fixture reset between trace segments; resets are labelled and excluded from direct-travel calculations. At Gate B/C, gravity, contact and mode-transition corrections are reported in separate populations and do not silently inherit the unobstructed 0.15 m gate.
