# UDG-SPIKE-001 — acceptance refinement DRAFT: what may never be accepted as GA-5b/GA-12 closure (DIAGNOSTIC-LANE INPUT — NOT Gate A criteria)

Contract lane artifact; a draft INPUT for the workflow lane's formal-text owner (I do not own
`docs/contracts/workflow.md` acceptance syntax and do not edit it here). Slice-8 evidence cited
inline; the branch is `codex/udg-spike-001-dpa2-impairment`.

## Why a refinement exists at all

The spike's whole honest-core finding is that two ADR-0003 sentences are unfalsifiable as written:
GA-5b's "a client expectation for the lost input… triggers recovery" (the terminal decline creates
NO client expectation and NO observable signature), and GA-12's PE-1 (the decline is silent on the
wire and in every room record). Left unrefined, those sentences age into exactly the pressure this
assignment fears: SOME row that looks like closure. This draft makes unproven closure permanently
undeniable-in-principle, in the narrow domain both rows actually live in.

## AR-1 — Permanent denial: what must NEVER be accepted as "the lost input recovered"

For any future claim of the form *"one distinct admitted input with no disposition was recovered"*,
closure is DENIED unless ALL of the following are evidenced about ONE named input (exact
identity `(connectionId, seq)` or its successor identity):

1. **Terminal non-delivery, evidenced at a named hop** with counters that prove the bytes were
   received-and-counted there and the application never received them (slice-8 `holdNext` is the
   model: `chunksReceived` grew, `chunksHeld` grew, `chunksDelivered` did not). TCP loss, host
   unreachability, or a stopped server NEVER substitute — different failure domains, different
   recovery machinery.
2. **A NAMED recovery trigger** from the §3.2 list, with its observables pinned at the fire
   instant (slice 8: streak exactly G with ack AND `inputResolvedThrough` frozen at every poll,
   epoch unchanged). A snapshot DEADLINE is not this: the deadline restarts on every accepted
   delivery and cannot see a loss while publications flow (proved, unit red-first).
3. **Bounded recovery with continuity**: bounded rejoin or equivalent, fresh snapshot, movement
   resumes, NOTHING reissued (send-audit delta over the whole episode), generation monotonic.
4. **Server-side assertedness quantified, not narrated**: the room's OWN ledgers (consumed stamps,
   disposition counts, gap, retired, refusals, effectCount) recorded for a window that INCLUDES
   the recovery, showing exactly zero dispositions for the named input — and the pre-declared
   possibility that the input is absent rather than declined is stated where the evidence is
   offered (slice-8 `ga5l` row shape).
5. **Red controls that fired FIRST, and stayed preserved**: a control where the same detector
   says NOTHING HAPPENED (benign in-flight under G; compliant idle), and a forged/contradictory
   record the detector REFUSED. First-attempt refutations of the measurement itself (dpa7a, dpa7b,
   dpa7o) are part of the claim, not embarrassing drafts.

## AR-2 — Proxy closures explicitly rejected

The following are NOT closure, permanently, no matter how many rows pass:

- deadline-only recovery offered as `INPUT_ACK_STALLED` (they are different rules; one restarts
  on every delivery);
- correlation-inference closures (a stale-input refusal "implies" a decline — dpa5g/dpa5h,
  retracted in `PROPOSED-0003a` rev 2 §0, remain the cautionary exemplar);
- synthetic-gap or retiredUnrepresented-based "identification" (GA-5b's own row says the server
  must NOT infer a gap from silence);
- effectCount or counter-movement claims whose population was not proven paired-and-distinct at
  the wire (the slice-6i `wireReceiptDelta` lesson);
- any GA-12 positive disposition whose only trigger evidence is client-local (PE-1 unmet — the
  terminal decline is byte-identical to a healthy connection in the pinned build).

## AR-3 — Threshold adoption denial (GA-11-shaped)

A measured number may not enter any contract/ADR/schema text unless: the producing population is
declared WITH its impairment source (host/transport named), achieved validity is asserted under
the accepted `networkValidity` rule against the leg's OWN declared profile, and — for anything
used as a threshold — a non-loopback representative population plus blind reconciliation exist.
Calibration-only records must say calibration-only in the row (slice-7/8 practice). Today this
denies: `recoveryBudgetMs ≤ 2s`, RTT-class bands, the §4.4 dual-threshold rule, and any closure
flag default.

## AR-4 — What WOULD close the two rows (kept in one place)

- **GA-5b client-recovery sub-leg**: the BLIND half is now evidenced (slice 8: rule fires at G,
  bounded blind recovery, server silent — see api-map §14.10). What remains is the half the
  substrate cannot give: recovery that KNOWS which input died — gated on PE-1 by definition.
- **GA-12 positive PE-1**: PE-1…PE-5 as written, plus a legitimate-producer fixture (one that a
  conforming producer could actually generate) reaching `inputDropped(duplicate-terminal)` or an
  equivalent NAMED terminal disposition — structurally impossible pre-buffer on the pinned core
  (`PROPOSED-0003a` §2), so this means a successor mechanism or an explicit ADR amendment, never
  a re-tagged artifact.
- Until then: `dedupeClosureEnabled` false, `terminalDedupe` absent, blocked rows labelled
  BLOCKED-WITH-PROOF with the missing observable named. That labelling IS the closure of the
  honesty obligation, and this refinement makes sure nobody later reads a passing neighbour row
  as closing the owed one.

## Status

Draft, contract lane, unadopted. The workflow owner decides whether any of it enters formal
acceptance text, and in what syntax; nothing here changes ADR-0003, the schema, or any Gate A
criterion by itself.
