# Definition of done

> Source: UDG-CONTRACTS-M0-001 v1.0, section 20.2. Repository edition 1. Shared requirements are authoritative here; task files link to them.

### 20.2 Strict task definition of done

A task is Verified only when all of the following are true:

- It was explicitly assigned against this adopted revision and immutable prerequisite commits; dependencies are Verified and required proposals approved.
- All expected files exist in authorised paths; changes outside the assignment manifest have responsible-owner review; no synced reference file was edited.
- Public contracts, schema ownership, authority rules and package boundaries are preserved. No private SDK APIs, invented calls, unreviewed casts or duplicated controllers remain.
- Implementation is complete for the task's stated objective; no placeholder, mock or disabled branch substitutes for required real integration at a spike.
- The four root commands and every applicable task, browser, fixture and spike command pass on the final commit with nonzero test counts and no required skips or quarantines.
- All positive, negative, ordering and lifecycle fixtures pass; measured values meet adopted thresholds in every required seed/profile; raw samples support the statistics.
- Evidence bundle validates, reproduces the run and contains no secrets. Environment, versions, lock/WASM/config/asset hashes and prerequisite SHAs are recorded.
- Documentation and API maps match implementation; every provisional decision due at this gate is resolved or explicitly blocks acceptance.
- The completion report states remaining limitations and downstream exclusions without claiming later M0 gates passed.
- A reviewer accepts the task and the integration owner explicitly signs the relevant spike decision. An agent submission alone is In Review.

Task states are Not Started, Ready, In Progress, In Review, Verified and Blocked. Ready means prerequisite and adoption checks have passed. Blocked is a recorded task state, not permission to relax a requirement. A failed gate cannot be waived by relabelling an experiment successful. Scope completion means all eleven tasks are Verified and Gates A/B/C explicitly pass; it does not mean the game or M0 is finished.
