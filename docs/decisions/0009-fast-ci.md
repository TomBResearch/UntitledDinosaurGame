# 0009: A fast CI lane on every push; slow tests nightly

**Status:** Accepted (2026-11-23)

## Context

In the owner's previous attempts, each CI run took 5–7 minutes and agents waited on CI after almost every change, so most development time went on waiting. In the racing game, about 5 of those minutes are bot smoke tests that run in real time.

## Decision

- **Fast lane, on every push and PR, with a target under 2 minutes:**
  - Go: `go vet`, `staticcheck`, and `go test ./...` with the race detector on the region package only
  - `dataval` (content validation), and checks that protocol codecs and region exports are up to date
  - GDScript: parse and type-check the project, plus unit tests (GUT) for the client's networking, path playback and UI logic
  - gitleaks (secret scan)
- **Docs-only changes** (`docs/**`, `wiki/**`, `*.md`) skip the fast lane. They only run a link check.
- **Slow lane, nightly on `main` and on demand (`workflow_dispatch`):** web and server builds, end-to-end bot tests against a real world server, soak and load tests, and a deploy dry run.
- **Simulation is tick-stepped.** Server tests call `region.Step()` in a loop, so a 10-minute fight runs in milliseconds. A test that sleeps in real time is a bug.
- **`tools/check.sh` runs the same fast lane locally.** Agents run it before pushing and carry on working while CI runs. They don't block on CI after every commit.
- Caching: the Go module and build cache, plus the Godot binary and export templates.

## Consequences

- A nightly failure becomes a task the next morning. It can't block every push.
- Load tests (hundreds of bots) can run for minutes without slowing anyone down.

## Rejected

- **All tests on every push:** that's exactly the problem we're avoiding.
- **No CI, local checks only:** too easy to merge something broken.
