# UDG-002 completion record

Appendix B2 submission record. Reviewer and integration-owner decision fields are left pending: the
implementer does not record them (root [AGENTS.md](../../AGENTS.md), "do not self-sign adoption,
reviewer acceptance, or gate passes").

```text
Task ID and final implementation SHA:
  UDG-002 Protocol and validation.
  Final implementation  a2a2318e31d38b731fed543e0eb49dce5474de55 (pushed to main)
  Submission set        8aebbd15 feat(protocol) · 1284b423 feat(config) · cf35a133 chore(checks)
                        e6be6aa9 docs(readme) · 830a326a test(UDG-002) · 2321bb4e fix(gate)
                        a2a2318e fix(test)
  The gate commands below were run at this head, which is what CI verifies. Per-commit CI is not
  configured, and the intermediate commits of one submission set are not individually green by
  construction: the UDG-002 suites, the amended UDG-001 assertions and the tooling that supports them
  depend on each other, so they were landed as one set.

Contract revision and prerequisite SHAs:
  Contract edition      UDG-CONTRACTS-M0-001 v1.0, repository edition 1
  Contracts index       docs/contracts/README.md, the file report.json `contractHash` hashes:
                        255e7b2cb8fd64c41e2e5beb2a56b03bb62b08e0ca11089299d81a2e540a5943
                        Unchanged since the reviewed edition: the same digest at a2a2318e and today.
  Task contract         docs/contracts/UDG-002.md, the file report.json `configHashes.taskContract`
                        hashes at the revision a run read. Both reviewed bundles and the committed
                        summary pin
                        d78ec67820faa4179a0141f4beb48a96dc20e33766bc724d629ffda8280d7c4b,
                        which is that file from the adoption commit 74ffdaab through implementation
                        a2a2318e. The later record commits move the file, so a later bundle pins the
                        value its own report names; no retained bundle is edited to match a record.
                        The correction bundles below pin the task-file revision they ran against, and
                        `pnpm test:contract -- --task UDG-002` asserts that these two fields stay
                        distinct rather than trusting this sentence.
  Baseline              docs/specifications/UDG-SPEC-M0-002.md v0.2,
                        b51e7afdd6810c377d2d2702d7673119521a59cd0d6b91686700bf9149b73fcf
  Prerequisite (UDG-001 Verified, recorded in docs/contracts/assignments/UDG-002.md)
                        74ffdaaba1bc3617999c99e73c7f197ebd01a570  P02/P06 adoption + ADR 0001
                        45051f6391dc9862dd92e514dddb6d51ea50c746  this assignment record
  Governing decisions   D1 to D5 and clarifications U2-1 to U2-6 as recorded in
                        docs/contracts/adoption.md; readiness proposal revision 2 at 222a787f.

Files added or changed and scope deviations:
  Added, packages/protocol/src: version.ts; domain/{primitives,state,movement,commands,physics,
    navigation,wire,index}.ts; validation/{common,direct,commands,join}.ts;
    schema/{DirectInputSchema,PlayerSchema,RegionSchema,index}.ts;
    mapping/{to-replica,from-replica,index}.ts
  Added, packages/config/src: hash.ts, validation.ts, movement.ts, network.ts, limits.ts, region.ts,
    index.ts (index.ts replaced the empty skeleton)
  Added: docs/contracts/protocol-v1.md; tests/fixtures/protocol/{valid,malformed,ordering}.json;
    tests/fixtures/catalog.json; tests/fixtures/boundaries/domain-no-schema{,-allowed}/;
    tests/unit/udg-002/{validation,mapping,schema-roundtrip,config,fixtures}.test.ts;
    tests/checks/fixture-layout.test.ts; tests/contracts/UDG-002.test.ts;
    docs/adr/0001-replica-precision-policy.md (committed with the adoption record)
  Changed: packages/protocol/{package.json,src/index.ts}; packages/config/{package.json,src/index.ts};
    pnpm-lock.yaml; docs/integration/dependencies.json; package.json (root manifest: build:libraries,
    test:unit, and the build-before-assert ordering); .github/workflows/ci.yml;
    tools/checks/src/{fixtures,boundaries,evidence,support}.ts;
    tests/fixtures/boundaries/*/fixture.json (re-pinned configuration hash);
    tests/contracts/UDG-001.test.ts (amendments S-1 to S-5 only); README.md;
    docs/contracts/{UDG-002.md,checksums.json}; docs/contracts/assignments/UDG-002*.
  Scope deviations, declared rather than smoothed over:
  1. tools/checks/**, .github/workflows/ci.yml, the root package.json, pnpm-lock.yaml,
     docs/integration/dependencies.json and tests/checks/** are UDG-001-owned surfaces. They were
     changed under the controlled-path grants in the assignment record, each for its stated purpose:
     the fixture layout, the per-task capture plan, the report-derived artefact rule, the
     build-before-assert ordering, and the derived dependency status. No grant was used to broaden
     function: none of these edits implements admission, ordering, movement, physics, navigation,
     input, room or SDK behaviour.
  2. tests/contracts/UDG-001.test.ts was amended, not relaxed. No it.skip, no deletion, no lowered
     threshold; each change states the invariant it protects. The committed UDG-001 evidence summary
     still regenerates byte-identically and the four retained UDG-001 acceptance bundles verify with
     zero issues, which is U2-1 tested rather than promised.
  3. Region bounds are supplied to the validators as an argument and never defaulted (D5, U2-4). The
     fixture bounds are labelled test-only-synthetic and nothing reads a UDG-007 asset.

Public interface/schema/config changes:
  @udg/protocol        exports ., ./domain, ./schema, ./mapping — the entry map in
                       docs/contracts/protocol-v1.md is the authority and the contract suite refuses a
                       subpath that the table does not declare as well as a table entry with no
                       manifest behind it. The root entry point imports neither the schema runtime nor
                       the mapping layer.
  @udg/config          exports the movement, controller, network, limits and region-bounds vocabulary,
                       validateServerConfig, computeConfigHash, movementHash, regionHash and
                       CONFIG_PROVENANCE. It depends on @udg/protocol; the protocol depends on nothing.
  Replica declarations PlayerSchema (17 documented fields), RegionSchema (region-level fields plus the
                       player map) and DirectInputSchema (5 flat fields). Widths are Gate A provisional
                       candidates under ADR 0001; the schema is not a transport.
  Configuration        canonical JSON (UTF-8, lexicographically sorted object keys, array order
                       significant, finite numbers only, -0 normalised to 0) hashed with SHA-256 in
                       pure TypeScript so a browser client reproduces the same digest.
  Explicitly unchanged docs/interfaces/**, docs/specifications/**, docs/validation/** and every other
                       task contract. No later task's behaviour was implemented.

Actual package and WASM versions/hashes:
  @colyseus/schema     5.0.45, licence MIT, declared as the exact specifier "5.0.45" in
                       packages/protocol/package.json; the register and the installed copy agree, and
                       the suite refuses a range.
  Lockfile             pnpm-lock.yaml sha256
                       899e6f4d18930cb23fc32438dfe5d7b11d4d16741ebf2cf03f54a5c8585517e5
  Toolchain            Node v24.22.2, pnpm 12.18.0 (corepack packageManager), TypeScript 5.9.3,
                       ESLint 10.14.0, typescript-eslint 8.72.1, Vitest 5.1.0, Playwright 1.65.0,
                       @types/node 24.19.2
  WASM                 none. No engine, physics or navigation package was selected:
                       @colyseus/schema is the only game-library entry marked selected in
                       docs/integration/dependencies.json, and every other deferred group reads
                       not-selected because the install says so rather than because a hand-maintained
                       field claims it.
  Configuration hashes configHash (default server config)
                       948f8c10fc404e2ebdb015abc8e30b8e66caf357347db3a2636ace96687a208a
                       movementHash
                       c80f61d451eaf9ee7dc2804ba04f1794e2e0149ac33647932dd14852edf522ce
                       boundary rule table 818c63d5b12f984b17172688be6fd82ed103d9e18473e0978e307225e8194b82

Commands with exit codes and test counts:
  Run from a tree with every dist directory deleted, in the CI order, and again with FORCE_COLOR=3 to
  match the runner's coloured output. Every command exits 0.
    pnpm install --frozen-lockfile  0
    pnpm typecheck                  0
    pnpm lint                       0   (eslint clean; boundary check OK, 40 files, 0 violations)
    pnpm test                       0   8 files, 302 tests, 0 failures, 0 skipped
    pnpm build                      0
    pnpm test:unit                  0   203 tests (validation 47, config 40, mapping 31,
                                            schema round trip 13, fixtures 72)
    pnpm test:boundaries            0   positive and negative fixtures, including the new
                                        domain-no-schema pair
    pnpm test:fixtures              0   24 fixtures discovered: boundary manifests plus the standalone
                                        protocol fixtures, all digest-pinned
    pnpm test:contract -- --task UDG-001   0   49 tests
    pnpm test:contract -- --task UDG-002   0   30 tests
    pnpm contracts:checksums        0   in sync, 58 entries
    pnpm dependencies:verify        0   register matches the installed graph; re-recording is idempotent
  CI, GitHub-hosted ubuntu-24.04 linux-x64: run 42611762215 on a2a2318e, conclusion success, 23 steps,
  zero failed steps, artefact udg-evidence carrying both task bundles and both summaries.
  Two earlier runs on this submission were red and are reported rather than buried:
    42609613962 (830a326a) failed `pnpm typecheck` with TS2307 for every built-module import. The
      suites assert against packages/*/dist and a developer machine always has one; a fresh checkout
      does not. Fixed by the named build:libraries step running before typecheck, test and test:unit,
      with a suite assertion so the ordering cannot silently regress.
    42610528502 (2321bb4e) failed the UDG-002 suite's child-run count: the runner forces colour, so
      the nested vitest summary wrapped the count in its own escape codes and the parser read 0 out of
      203 passing tests. Fixed by stripping SGR sequences before parsing, and by replacing
      `not.toMatch(/skipped\s+[1-9]/)` — which could never match vitest's `1 skipped` word order, so
      it proved nothing — with counts read from the runner's own report.
  Both red bundles are retained; both record status FAIL honestly, and verification refuses each with
  EVIDENCE-GATE-NOT-PASS. The gate worked: the runs could not be mistaken for passes.

Positive, negative, lifecycle and race coverage:
  Positive   66 fixture cases across valid.json, malformed.json and ordering.json; every P-numbered id
             the contract names exists and executes (P01 to P12, P13 to P20, P21 to P34); ±1 axis
             corners; the diagonal normalisation; yaw wrap to [-π, π); the route pair rule in both
             directions; region-level round trip; player map read through its own reader; a map key
             that disagrees with its embedded entityId is reported rather than silently re-keyed.
  Negative   46 rejecting cases, each asserting the specific documented rejection code it must return
             and receiving it: 46 of 46 matched. Unknown and missing keys, out-of-range axes,
             non-finite scalars, oversized identifiers, out-of-width and fractional integers, epoch
             mismatch, generation-gap overflow, an unlisted movement mode, the 0/non-zero route pair,
             signed zero into the codec, an absent replica, a truncated binary frame. Three of the
             negative cases are binary-encoded, because a JSON-only fixture set would never exercise
             the codec. Nothing throws where it should refuse, and no result escapes the closed
             rejection vocabulary. Four live refusal probes are re-run in the contract suite so the
             recorded codes are not a fixture's self-report.
  Lifecycle  Schema round trips per declared kind (player, direct input, region) with float64 vectors
             0.1 + 0.2, -π, 5e-324, ±Number.MAX_VALUE carried exactly; -0 documented as the codec's
             one exception and refused by mapping before it can be sent; deep-frozen accepted values,
             with a test that mutating the source fixture cannot tamper with an already-validated
             result.
  Race       Not applicable to this task and not simulated: there is no ordering, admission or
             timestamp watermark behaviour here. Generation and epoch *shape* is validated and the
             forward-gap constant is bounded, but the ordering rule itself is UDG-003's, and the
             race tests that exercise it belong to UDG-003 and UDG-SPIKE-001. Claiming race coverage
             from a types task would be a false positive.

Requested versus achieved network profiles:
  Not applicable. UDG-002 transmits nothing and simulates no link; there is no Room and no transport.
  The evidence report records this as notApplicable with the reason, and the LAN, moderate, elevated
  and poor profile columns stay empty rather than being filled with a placeholder.

Acceptance thresholds and measured results:
  Every threshold the capture plan states is answered by a measured value, and verification now fails
  a bundle whose threshold has no measurement (EVIDENCE-THRESHOLD-UNMEASURED).
    toolchain.node                     v24.22.2                    pinned, matches
    toolchain.pnpmCli                  12.18.0                     pinned, matches
    schema.pin                         @colyseus/schema@5.0.45     exact, licence MIT
    schema.roundTrips                  3 (player, direct input, region)   ≥ 1 each
    schema.losslessFloat64             true                        exact for every vector tried
    protocol.requiredIds               true                        P01-P12, P13-P20, P21-P34 present
    protocol.executed                  203 unit assertions run     > 0, none skipped
    protocol.binaryNegative            3                           ≥ 1 binary rejecting case
    validation.noNonFiniteEscape       true                        no non-finite value survives
    config.hashStable                  true                        same input, same digest; four
                                                                   single-parameter changes move it
    config.regionDefaults              0                           no production default extents
    boundaries.domainImportsSchema     0                           domain imports no schema runtime
    capture.commandsRun                recorded by the capture     every planned command
  Also measured and reported: 28 owned files, 17 documented replica fields mapped in both directions,
  4 player round-trip cases, 5 evidence artefacts, 5 unit suites, 167 exports across the documented
  entry points, and the UDG-001 suite green as a child run.

Raw evidence directory and integrity result:
  Local bundle    artifacts/UDG-002-2026-11-09T11-46-13-890Z-a2a2318e — PASS, 31 hashed files,
                  report.json sha256 b23b63d673b187772f5af053a9c183d966d251b02f77c73c5418f748c79b8460,
                  302 tests, 0 failures, 0 errors, 0 skipped, clean working tree
  CI bundle       UDG-002-2026-11-09T11-49-54-974Z-a2a2318e — PASS, report.json sha256
                  ca1c6f44e3ce6f34fec9c4be5c0b9a6e64985db6966bada698239abb660072d9; verified on the
                  runner and again after download, with configuration hashes identical to the local
                  bundle, which is the cross-machine reproduction that matters
  Foundation      UDG-001-2026-11-09T11-46-42-432Z-a2a2318e (local) and
                  UDG-001-2026-11-09T11-48-52-798Z-a2a2318e (CI) both PASS at this head
  Retention       /workspace/udg-evidence, versioned inventory. v3 (418 files, sha256 ef5feeb647b2850435f77f0d67eed03fdf3fbb32665d7e465f13abccbebe3964)
                  supersedes v2 (d4aa0bc1c24f4ef07d5056adb1ff8c33722483d333a8a3116ed1e5a617fd4240);
                  v4 (476 files, sha256 e6b1345a8b5b3ae2acad6455301a1482db6e0b9e57c683941317a0d9645fad6c) adds the submission-record run 42613223227, whose
                  bundles also verify PASS. Each append writes the next version with its predecessor's
                  hash embedded, so this record cites the chain rather than a terminal inventory
                  digest — the version that documents this record's own CI run can only be written
                  after it. Runner logs are retained gzipped in the store only: they contain runner
                  filesystem paths, so they are never committed. Only the sanitised summary
                  docs/contracts/assignments/UDG-002-evidence.json and its hashes enter Git (C-03).
  OPEN residual   The store is one copy on one host. It guards against Actions artefact expiry (30
                  days from the run date) and against losing the artifacts directory, not against
                  host loss. Independent backup designation is owner decision D4 and remains
                  unprovisioned and unclaimed.

ADRs accepted, rejected or still proposed:
  Accepted   docs/adr/0001-replica-precision-policy.md — float64 canonical end to end, lossless
             mapping, exact equality after normalisation, encoding widths frozen only at Gate A.
             Recorded with the adoption commit; P06 was adopted in its deferred-freeze form.
  Proposed   none outstanding from this task.
  Not raised No architecture, protocol, timestep, collision-ownership or acceptance-threshold change
             required escalation: the two CI failures above were implementation and tooling defects
             inside the authorised scope, fixed inside it, not contract conflicts.

Limitations and remaining downstream work:
  - Encoding widths, and any SDK bookkeeping field, are provisional under ADR 0001 until Gate A.
    Nothing outside @udg/protocol/schema may depend on a width.
  - No admission, ordering or timestamp watermark policy exists; @udg/protocol validates the shape of
    generations and epochs and bounds the forward gap, and UDG-003 owns the rule that uses them.
  - Region bounds arrive as an argument. The production extents, region.json and its manifest hashes
    belong to UDG-007; UDG-003 loads and re-validates them at startup and rejects a stale
    manifestHash with ASSET_MISMATCH.
  - @colyseus/core, @colyseus/sdk, @colyseus/ws-transport and every engine package remain unselected.
    The schema codec was exercised room-free, which is what UDG-002 could prove without inventing an
    integration; the fixed-step prediction path remains UDG-SPIKE-001's mandatory proof.
  - P03, P04, P05 and P07 to P10 are still pending, so the controller and gravity values in
    PROVISIONAL_P07_FIELDS are named as provisional in the hash inputs rather than adopted.
  - Gates A, B and C remain Not Run. Gate A is validated by UDG-SPIKE-001 after UDG-003 and UDG-004;
    Gate B by UDG-SPIKE-002; Gate C by UDG-SPIKE-003.

Implementer recommendation: In Review
Reviewer decision and date:
  Pending. The owner reviewer has not accepted this submission; nothing here records acceptance.
Integration owner gate decision and date:
  Not applicable to UDG-002 and deliberately left blank. This task validates no gate: Gates A, B and C
  remain Not Run, and their validation belongs to the spike tasks named above.
```
