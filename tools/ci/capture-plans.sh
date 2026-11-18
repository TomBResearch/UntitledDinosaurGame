#!/usr/bin/env bash
#
# Attempt every capture plan, retain every bundle, fail at the end.
#
# Why this file exists. The capture step used to be a `set -e` loop, so the first plan whose bundle recorded a
# failure aborted the step and every plan after it never ran. On 2026-11-18 that cost three jobs their evidence:
# a records-only push died in `UDG-002`'s capture and `UDG-003`, `UDG-003-TASK` and `UDG-004` produced nothing at
# all, so the run that needed whole-task bytes was the run that had none. A failure inside one plan is that plan's
# verdict; it is not a licence to destroy the evidence of the plans that had not been attempted yet.
#
# The two rules this keeps:
#   1. every plan in `evidence.js plans` is attempted, whatever happened before it;
#   2. the job still fails if any capture failed — the exit status is collected and returned at the end, and the
#      verification step remains a separate gate that fails on any bundle recording a non-PASS gate.
#
# `--plans-cmd` and `--capture-cmd` exist so `tests/unit/udg-003/capture-loop.test.ts` can drive the loop with a
# stub in a temporary directory. The defaults are the production commands, and nothing in CI sets either flag.
set -uo pipefail  # deliberately no `-e`: one plan's non-zero exit must not skip the plans after it

plans_cmd='node tools/checks/dist/evidence.js plans'
capture_cmd='pnpm evidence:capture'
out_dir='artifacts'

while [ $# -gt 0 ]; do
  case "$1" in
    --plans-cmd)   plans_cmd="$2"; shift 2 ;;
    --capture-cmd) capture_cmd="$2"; shift 2 ;;
    --out)         out_dir="$2"; shift 2 ;;
    *) echo "::error::capture-plans: unknown argument $1"; exit 2 ;;
  esac
done

tasks="$(eval "$plans_cmd")"
if [ -z "$tasks" ]; then
  echo "::error::no task has a capture plan; evidence cannot be produced"
  exit 1
fi

failed=()
attempted=0
for task in $tasks; do
  attempted=$((attempted + 1))
  echo "capturing the evidence bundle for $task"
  # shellcheck disable=SC2086  # the capture command is a command line, not a single token
  if $capture_cmd -- --task "$task" --out "$out_dir" --keep-going; then
    echo "capture returned 0 for $task"
  else
    status=$?
    echo "::error::evidence capture failed for $task (exit $status). Its bundle stays on disk and every later plan is still attempted: an earlier failure cannot cost this job the evidence of a task that did not fail."
    failed+=("$task=$status")
  fi
done

if [ "${#failed[@]}" -gt 0 ]; then
  echo "::error::evidence capture failed for ${#failed[@]} of $attempted plans: ${failed[*]}. The job fails; the bundles it produced are still published and verified."
  exit 1
fi

echo "evidence capture complete: $attempted plan(s), none failing"
