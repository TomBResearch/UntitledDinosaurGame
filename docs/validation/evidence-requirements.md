# Evidence requirements

> Source: UDG-CONTRACTS-M0-001 v1.0, section 19. Repository edition 1. Shared requirements are authoritative here; task files link to them.

### 19.1 Evidence bundle structure

Every run uses artifacts/RUN_ID/ where RUN_ID is task ID plus UTC timestamp plus short commit SHA. The evidence schema is owned by tools/checks/src/evidence.ts. No bearer/reconnect tokens, cookies, private machine paths or credentials may be emitted. Replace sensitive identifiers with stable per-run aliases where needed; preserve joinability between traces.

```text
artifacts/RUN_ID/
  report.json
  environment.json
  commands.json
  junit.xml
  checksums.sha256
  logs/                 process logs and stderr
  traces/               inputs, ticks, state and lifecycle JSONL
  metrics/              raw CSV samples and summary JSON
  browser/              screenshots or annotated recordings
  decisions/            gate decision and ADR references
```

report.json contains schemaVersion, taskId, contractId/version/hash, baselineSpecId/hash, implementation SHA, prerequisite SHAs, dependency-lock hash, fixture/config/asset hashes, run start/end, seeds, requested and achieved profiles, test counts, failure/skip counts, thresholds, measured values, status and evidence-relative file paths. status is PASS, FAIL, BLOCKED or INVALID; only PASS can support Verified. Gate decision adds integration owner identity, decision timestamp and approved ADR IDs. Agent-authored reports must not fabricate an owner signature.

commands.json records command arguments, working directory alias, start/end, exit code, stdout/stderr artifact paths and timeout outcome. junit.xml lists every test and fixture ID. checksums.sha256 covers evidence files except itself; report references must be resolvable and nonempty. Trace rows contain serverTick, cutoffOrdinal, entity alias, application epoch/generation, SDK acknowledgement identity where publicly observable, input source, before/after mode, route revision, desired/resolved displacement and rejection/result code. Record actual API visibility limits rather than reading SDK private fields for prettier evidence.

### 19.2 Review procedure

An agent submits the completion report in [assignment and completion templates](../contracts/templates/README.md) with code, tests and evidence from the exact submitted commit. The reviewer checks the prerequisite chain, schema/config changes, command exit codes, fixture coverage, thresholds and evidence integrity. Replay a failing or boundary trace when the result is uncertain. A green command summary without raw samples does not prove a numeric gate. A video without test logs does not prove deterministic behaviour.

Flaky tests block verification. A diagnostic rerun can identify a cause, but cannot erase the initial failure from the bundle. Fix the cause and rerun affected suites plus required regressions on the final commit. A machine performance limitation may invalidate timing results; correctness failures cannot be relabelled environment limitations without evidence. All threshold changes require prospective approval and a new run.

### 19.3 M0 release gates preserved for later work

v0.2's later release targets remain: 20 clients for ten minutes without duplicate entities/unexpected disconnects; at least 99.9% of ticks within one scheduled interval; p99 tick execution below 25 ms; unobstructed elevated p95 correction below 0.15 m; 0.02 m collision tolerance; restored same entity after reconnect within 30 seconds; desktop p95 frame time at most 16.7 ms and physical mid-range mobile at most 33.3 ms. These contracts establish instrumentation and smaller proofs, not satisfaction of these later workloads. Browser emulation does not establish hardware performance. Gate C completion must not be described as M0 release readiness.
