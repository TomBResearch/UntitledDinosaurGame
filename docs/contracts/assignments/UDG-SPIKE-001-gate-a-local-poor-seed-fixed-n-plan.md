# UDG-SPIKE-001 — Gate A local poor-seed FIXED-N plan + trigger-time observation (dpa9c/dpa9d + local floor legs)

Status: LOCAL spike protocol, written and committed BEFORE any dispatch in the family.
Prototype wording/values only. The adopted §D rule
(`UDG-SPIKE-001-recovery-notice-adr.md`) is unchanged; GA-11 (§19) remains the sole nomination
authority for every provisional value; nothing here adopts a threshold, a wait, a status or a
gate. This document records a PRE-REGISTERED local fixed-N protocol plus the observation design
that closes the dpa9b evidence gap, and it keeps every prior first attempt intact.

## 0. The question, and what this plan may and may not say

Hosted dpa8r poor-1002 stopped at `input-ack-stalled at 4`; local dpa9b poor-1002 reproduced a
stop (`at 4` at +252.4 ms) with no episode; dpa9a poor-1001 ran clean. The open questions the
reviewer listed (§20A FOLLOW-UP 2 limitation 4): the AGE of the oldest outstanding input AT the
stop (dpa9b could not see it — the default rule discards pending synchronously with the trigger
and the 250 ms ledger sampled nothing outstanding), the room-side receipts/resolution by identity,
and the client-decoded prefix correlated before/after the stop.

This plan may say: how often the stop occurs in a PRE-REGISTERED bounded local family, what the
trigger's own age-at-fire was, what the client and the room each held by identity, and whether a
floor-aware control behaves as derived. It may NOT say: any production threshold, any adoption,
any gate, and it re-bases nothing — hosted dpa8r/dpa8v rows stand untouched.

## 1. What is ALREADY registered (read this before counting anything)

- **§18A / dpa8q–dpa8v**: the formal hosted matrix ran **N = 2 per seed** ({20260714, 20260721}
  × {good, poor} = 4 runs), as one pre-declared attempt per coordinate, results kept as first
  attempts. That N=2 is an EXPLORATORY coordinate matrix, and it stays registered exactly as is.
- **dpa9a / dpa9b** (this lineage): DEFAULT full-window baselines, one first attempt each —
  retained as **attempt 0 of each seed, PRE-INSTRUMENTATION** (they ran before the trigger-age
  and room-side watchers existed, so dpa9b's stop has no age-at-trigger and no room-side capture;
  that is the gap this plan closes). They are NOT merged into the fixed-N population below,
  because the instrumented coordinate is not byte-identical to them; they are named here as the
  prior attempts of the same coordinate shape.
- **dpa8y / dpa8z**: the W=400 injected-terminal-loss local diagnostics (labelled NON-canonical
  loss injection; W locally injected). They are a different coordinate and are NOT part of any
  count here.

## 2. The new pre-registered fixed-N sample (the only new counts)

Coordinate: `--cell full-window --profile poor --seed S`, the DEFAULT path — **no W, no injected
loss, no rejoin hook** (`rejoinConfigured: false` stays), `UDG_SPIKE_OUT` per run. The only
difference from dpa9a/dpa9b is the READ-ONLY instrumentation (§3); no disposition, rescue or
timing changed.

- Seed **1001**: attempts **dpa9c-a1, dpa9c-a2, dpa9c-a3** — N = 3.
- Seed **1002**: attempts **dpa9d-a1, dpa9d-a2, dpa9d-a3** — N = 3.

Rules, fixed BEFORE the first dispatch:

1. **N is fixed at 3 per seed (6 dispatches total). No extension. No stopping at a green.**
2. One first attempt per declared run id, executed sequentially; a run that dies for a
   fixture-class reason is recorded AS its own first attempt with its recorded bytes, and the
   NEXT declared attempt id is a NEW attempt — never a re-hash of the failed id, never a
   replacement of retained evidence. Recording/transcription corrections are named in place
   (§17/§20A convention), never silently.
3. A stop, a no-stop, an episode and a no-episode are ALL legitimate outcomes; the population's
   job is to report the mix, not to reach a verdict.
4. Every attempt publishes its own `spike-cell.json` + `run.log` + README under
   `artifacts/.local/spike-001/<id>/` (local, gitignored), with full commit SHA, dirty state,
   Node/pnpm/Playwright versions, seed, and the coordinate as dispatched.

## 3. Trigger-time observation (the dpa9b gap closer — pure reads)

The default rule discards pending SYNCHRONOUSLY with the trigger, so an external poll can never
see the outstanding set at the stop. The instrumentation therefore AGES THE TRIGGER AGAINST ITS
OWN CAUSE and correlates identity, all from published ledgers (no observe-and-act anywhere):

- **Trigger-age watch (page, 25 ms)**: at the FIRST `input-ack-stalled` trigger event, record the
  event's own `detail`/`atMs`, the client-decoded delivery identity and prefix AT the stop
  (epoch, authorityTick, ack, resolvedThrough, deliveries count), and the AGE: `trigger.atMs −`
  the send stamp of the oldest UNACKED input of the trigger's epoch from the retained sent audit
  (frozen at the stop; same page clock). Also: detected-within (watcher latency), pending at
  detect, the discard event detail, and the delivery identity + state AT THE END (after any
  episode). When no trigger fires the record is EXPLICIT (`triggered: false` + note) — a
  non-event, not missing data.
- **Room-side watch (node, 200 ms)**: the room's OWN `evidence().seats` for this seat's authority
  entity (`entityId === sessionId.slice(0, 64)`, RegionRoom.ts:291 / MovementAuthorityAdapter
  .ts:181 — identity, NOT proxy byte-counter inference): `resolvedThrough`/`epoch`/`closing`
  samples plus a final scan of `tickRecords` for CONSUMED seq per entity (server receipts by
  `(epoch, seq)` identity), refused ticks, closures, and join refusals. Sample gaps are named.
- **In-flight fate closure**: for a stop, the fate of the oldest unacknowledged seq is stated from
  (a) its client send stamp vs the trigger, (b) whether the room's `resolvedThrough`/consumed-seq
  EVER advanced past the frozen prefix (before the stop and at the end), and (c) the discard
  event's own detail. What remains unreachable (the room's per-input receipt of a byte the hop
  discarded) is stated as such, not guessed.

## 4. Per-attempt and per-seed reporting (fields fixed now)

Per attempt: seed; coordinate; outcome (complete / stop-no-episode / stop-episode / fixture
failure); stop detail + trigger `atMs` + detected-within; **age-at-trigger** (oldest unacked seq,
send stamp, age ms, or explicit non-event); delivery identity before/after (epoch : authorityTick
: ack : resolvedThrough, deliveries count); room-side (resolvedThrough/epoch around the stop,
consumed-to-tail seq, refused ticks, closures); episode classification
(none / resync / closed) and recovery latency on the SAME page clock; thresholds untouched note.
Per seed (N=3): stop occurrences k/3 (a POPULATION FACT of this local family — localhost,
fixture-class loss; NOT an incidence estimate), age-at-trigger range (min/median/max), prefix
behaviour, anything unreachable. No mean over seed 1001 is claimed for 1002 or vice versa; seeds
are reported separately.

## 5. Floor-aware LOCAL controls (GA-5l/GA-12 family; opt-in; adopting nothing)

`UDG_GA_FLOOR=1` with an explicit harness-supplied `UDG_GA_FLOOR_MS` arms, for ONE scenario
family inside `UDG-SPIKE-001-ga-scenarios`, the harness-supplied `stallFloorMs` already plumbed
through `joinGaSeat` (the product default remains the adopted count-only rule; unset = the
tracked cell byte-shape is unchanged, which a default re-run proves in the same family).
Declared here: **W = 400 ms for this local family, supplied at dispatch, a declared constant of
the experiment — explicitly NOT a production numeric and NOT a GA-11 nomination**. Timestamp
provenance for the age is the declared page-clock basis of the seat itself (the same declared
clock the §20B synthetic-timeline legs reason under; the malformed trio below is the stamp-shape
control).

- **GA-Floor truth** (`gafloor-truth`, one attempt): stage one input terminally lost; the rule
  must STILL FIRE and ONLY after the wait. Derived expectations: ≥1 `stall-floor-held` event
  precedes the trigger; trigger detail is the labelled PROTOTYPE floor rule; the trigger AGED
  against the suppressed input's own send stamp is STRICTLY older than W; exactly one input
  crossed the hop and nothing was re-issued; ack AND prefix frozen at every pre-trigger poll; the
  discard follows the trigger; the episode SETTLES bounded (snapshot-recovered, new epoch, same
  page clock, within 4000 + 300 ms) — the wait may add delay, it may never strand.
- **GA-5b malformed with the floor armed** (`ga5b-ms{dup,dec,epoch}-floor`, one attempt each):
  the same staged-stamp controls re-run with the wait armed. Derived expectation: the floor adds
  a WAIT to a rule that must not fire here and can add NO episode (nothing stays outstanding
  after a journalled disposition) — every original conjunct stands unchanged.
- First-attempt rule and red-kept rules as §2.

## 5a. Addendum — corrections named DURING execution (all prior runs retained, nothing re-hashed)

- **Fix A — watcher placement (harness defect, mine).** The first three declared seed-1001
  attempts (`dpa9c-trigger-1001-a1..a3`) died in teardown at `readTriggerAgeWatch` because the
  watcher reads sat AFTER `pageM.close()` — a deterministic fixture bug in `69a9b59`, zero
  population signal, all three bytes retained (`dpa9c-trigger-1001-defect/README.md`). The
  fixed-instrumentation population continues as **dpa9c2-trigger-1001-a{1,2,3}** and
  **dpa9d2-trigger-1002-a{1,2,3}**, same N=3-per-seed pre-registration, same rules; the ids are
  renamed ONLY because a1..a3 are occupied by their honest first-attempt records.
- **Fix B — gafloor settles conjunct (field bug, mine).** The first floor-enabled run read
  `GaSnapshot.transportEpoch` (a client-transport value that never moves on rejoin) instead of
  the recovered DOMAIN epoch; the attempt stands red (`dpa9e-facility/ga-floor.*` — it in fact
  recorded recovery in 303.1 ms), the correction is named in its commit message, and the retry
  `ga-floor-retry` is separately labelled, not a replacement.
- **Local GA-5l timing lines are FLAKY IN THIS CONTAINER, proven pre-diff.** `GA-5l suppression`
  (mover-wire quiet-window breach) and `GA-5l CONTROL benign-in-flight` (release/poll race) went
  red in local runs of the CURRENT code AND of the PRE-INSTRUMENTATION spec (`7af95d4` file
  swapped in as a named control, `dpa9e-facility/ga-prediff-spec.*`) — so they are an
  environment/fixture pacing issue of this headless box, not an effect of this family's diff, and
  the pinned CI (green on the same pre-diff code) remains the green authority for that cell. All
  local runs retained; no local green was substituted for any of them.

## 6. Limits (always attached)

64-core headless localhost; fixture-class loss (a real hop discarding a slot, not the hosted
lineage's network); W harness-supplied and labelled; N=3 per seed is a SMALL pre-registered
population — it supports statements like "stopped in k of 3 first attempts HERE", never incidence
claims beyond this fixture; the room-side watch cannot see what the hop never forwarded (stated,
not guessed); the hosted dpa8r/dpa8v rows are NOT re-hashed or replaced; no production default,
numeric, status, or gate changes; no merge; §20A items 1–2 (representative deployment; wait-first
wording ADR) remain open and dominate any wording inference from anything here.
