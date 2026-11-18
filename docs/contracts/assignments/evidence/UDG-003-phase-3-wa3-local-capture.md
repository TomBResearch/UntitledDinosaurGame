# W-A-3 — the retained case artefacts, demonstrated locally before submission

Reviewed decision **W-A-3** required that the bytes an accepted red case read survive the rest of the capture,
are bound to the invocation that read them, and cannot be replaced or masked by a later passing reproduction.
This file records the local demonstration of all three, and of the verifier refusals that enforce them, on the
implementation commit before it was pushed. Hosted evidence for the same behaviour is named in
`UDG-003-phase-3-submission.md`.

Captured on `44557349eeeefa957114247cd286d33458d4b41e`, container Node `v24.22.3` (not the pinned `24.22.2`,
which is why the bundle records reds of its own — see §4).

## 1. The capture ran and retained the case's own bytes

```
pnpm evidence:capture -- --task UDG-003-TASK --out artifacts --keep-going
→ artifacts/UDG-003-TASK-2026-11-18T08-51-43-708Z-44557349
```

`commands.json`, in order, with the two new steps and the reproduction that follows them:

```
  1 test                      106s     ← the invocation whose artefacts are retained; red on this container
  0 test-case-artefacts         0s     ← the retention step
  0 test-case-audit             0s     ← the report-only audit of the retained bytes
  0 build
  0 phase-1-vectors
  …
  0 phase-2-impairment-population      ← the capture's OWN reproduction, after the retention
  0 phase-2-stage-sequence
  0 phase-2-vectors
  0 phase-3-task-vectors
  0 phase-3-vectors-verify
```

`vectors-phase-2-case/` contains all four artefacts the accepted case reads, plus its manifest and the audit.
The manifest's binding fields, as written:

```
captureSelector    UDG-003-TASK
readByCommand      test
writtenByCommand   test-case-artefacts
reproduction       false
distinctFrom       vectors-phase-2 (the capture's own later production of the same producers)
implementationSha  44557349eeeefa957114247cd286d33458d4b41e
```

## 2. The retained bytes are the invocation's, not the reproduction's

Same producer, same filenames, two generations, both in this bundle:

| file | `vectors-phase-2-case` (retained) | `vectors-phase-2` (reproduction) | |
| --- | --- | --- | --- |
| `transport-impairment.json` | `2eac681513f6` | `f062d502cdae` | DIFFERENT |
| `abuse-results.json` | `9a5f349782ec` | `695e154ce6a6` | DIFFERENT |
| `room-lifecycle.json` | `5fa6748e37a2` | `d4ccc017b8c3` | DIFFERENT |
| `buffer-depth.csv` | `d820bfb54081` | `8f90dbea0942` | DIFFERENT |

(first 12 hex of sha256). The two directories are separate paths, and the plan order puts the retention before
every Phase 2 producer, so there is no path by which the reproduction's bytes land in the case directory.

## 3. The verifier refuses each way the claim could be quietly lost

Against the bundle above, verification raised **no** `EVIDENCE-CASE-ARTEFACT-*` issue. Three copies were then
tampered with, each tamper being something a later passing run could plausibly produce:

```
# drop one retained file
rm /tmp/tamperA/vectors-phase-2-case/transport-impairment.json
EVIDENCE-CASE-ARTEFACT-MISSING vectors-phase-2-case/transport-impairment.json is named by
  vectors-phase-2-case/case-artefacts-manifest.json but is absent from the bundle

# replace it with a clean production of the same producer — the masking case W-A-3 exists for
cp tests/support/udg-003/wa-audit-clean-artefact.json /tmp/tamperB/vectors-phase-2-case/transport-impairment.json
EVIDENCE-CASE-ARTEFACT-HASH vectors-phase-2-case/transport-impairment.json does not hash to what
  vectors-phase-2-case/case-artefacts-manifest.json recorded for the "test" invocation: a later production
  cannot stand in for the artefact the case read

# rebind the manifest to a commit that did not run this capture
implementationSha := 0000…0000
EVIDENCE-CASE-ARTEFACT-SHA … binds the artefacts to 0000000000000000000000000000000000000000 but this bundle
  ran 44557349eeeefa957114247cd286d33458d4b41e: the bytes cannot be attributed to this commit
```

The capture-side equivalent is `CASE-ARTEFACTS-DRIFT`: once a claim exists, re-running the step over
divergent bytes is refused, and only a byte-identical re-invocation is accepted as confirmation. Both paths
are asserted in `tests/unit/udg-003/task-case-artefacts.test.ts`, including the case where the *source*
directory is overwritten with a clean production and the retained copy still audits red.

## 4. What this run did and did not show

- The report-only audit of the retained bytes: **84/84 checks pass, `failing: []`**. `W-7` did not fire in this
  local capture, so the retained bytes here are clean ones. What is demonstrated locally is the *machinery* —
  retention, binding, refusal of replacement — and the machinery is what was missing.
- The bundle records `status FAIL` for local reasons unrelated to W-A-3: this container runs Node `v24.22.3`
  against a pin of `24.22.2`, the dependency register is a foreign host's, and the UDG-004 browser artefact is
  stale here. Those are the five known container reds, not a new defect.
- Whether a real hosted `W-7` is now diagnosable from the bundle without a second red production is a hosted
  question, and it is answered only when an accepted case actually goes red in a hosted run that carries a
  `UDG-003-TASK` bundle. That has not happened yet; `44191978254` predates W-A-3.

## 5. Preservation

`tools/checks/dist/evidence.js verify` was run over **every bundle currently visible in the evidence store**
(222 directories matched by `find /workspace/udg-evidence -maxdepth 2 -mindepth 2 -type d -name "UDG-*"`) with
HEAD's verifier and with this branch's verifier, in the same working tree at the same time:

- retained listing: `UDG-003-phase-3-verify-preservation-head-vs-wa3.txt` — one line per bundle,
  `<bundle-dir> <head-verifier-outcome> <this-branch-outcome>`
- **0 differences**. 187 PASS, 35 FAIL, the 35 being the pre-existing failures.

The case-artefact directory is deliberately **not** added to any plan's `requiredFiles`: a bundle may only be
judged against the requirements that existed when it was captured, and requirement lists are read by the
verifier of today. The obligation instead follows the command — a `commands.json` containing
`test-case-artefacts` without the claim is refused — so no historical bundle, including a whole-task bundle
captured before W-A-3, changes outcome. The capture step itself cannot complete without the claim, because the
step refuses to skip.
