# UDG-SPIKE-001 — proposed precision amendment to the GA-5b / GA-12 gate wording (ACCEPTED via [ADR-0005](../0005-stalled-ack-wait-first-design-and-gate-row-precision.md), 2026-11-21 — this file remains the proposal OF RECORD; the canonical rows live in ADR-0003 §5)

Status: **Accepted (2026-11-21)** for §§1–2 and §D as scoped in the disposition below — recorded by
the delegated integration approver on the owner's direct acceptance; see the disposition addendum at
the foot of this file and ADR-0005 for the canonical supersession. Before that date this file was,
and its history reads as, PROPOSED. Nothing it accepts reaches further than ADR-0005 §1 states.
The paragraph that follows is the ORIGINAL text, preserved as written history (per the history
rules, corrections are named, never deleted): where it says the accepted ADR “remains the accepted
text exactly as adopted”, read “as adopted through 2026-11-20” — from 2026-11-21 the §3.2 stalled-ack
criterion and the GA-5b/GA-12 rows carry ADR-0005's supersession, while every other clause,
threshold, budget and profile named below remains exactly as adopted.

Original (2026-11-20): **This file accepts nothing and changes nothing**: [ADR-0003](../0003-input-acknowledgement-overflow-and-resynchronisation-policy.md)
remains the accepted text exactly as adopted, `docs/contracts/**` thresholds, budgets and profiles
are untouched, and no gate verdict is implied. It **supersedes the wording** of the earlier draft
amendments (§15A of the [formalization plan](../assignments/UDG-SPIKE-001-gate-a-formalization-plan.md)
and the AR-flavoured phrasing around them) which a slice-16 review found inaccurate; the earlier
wording stays on the record, superseded rather than deleted, per the history rules.

### Adjudication 2026-11-21 — delegated reviewer / integration approver (Codex)

Signed **as the delegated reviewer/integration approver** under the owner's in-chat delegation of
2026-11-19 as recorded in [UDG-SPIKE-001.md "Delegation and roles"](../contracts/UDG-SPIKE-001.md)
— never as, and not impersonating, `TomBResearch`; the completion record separates the
implementation (Pi) from this acceptance decision, per `docs/contracts/ownership.md`.

- **§D (wait-first) — ADOPTED AS DESIGN.** The qualitative rule is adopted as the DESIGN direction
  (clause list below); this changes NO contract text: §3.2's accepted count-only rule remains the
  shipped product default until and unless an implementation adoption lands with its own evidence,
  and **no numeric is adopted anywhere** — the 400 ms W existed only as a harness-supplied LOCAL
  PROTOTYPE value (labelled as such in every ledger event and in plan §20/§20A). Design clauses as
  adopted: (i) the delivery COUNT alone is INSUFFICIENT — a trigger may be considered only on the
  PAIRED epoch/count/disposition condition AND the age of the OLDEST ACTUAL outstanding same-epoch
  input; (ii) the wait is a MEASURED CONSERVATIVE ENVELOPE — explicitly NEITHER a causal lower
  bound for every acknowledgement NOR a proof that any specific input is lost; (iii) healthy
  progress, epoch change or empty pending RESET the condition, and obsolete entries never hold it;
  (iv) the snapshot deadline, episode deadline and rolling rejoin cap remain INDEPENDENT timers
  owning truly-missing deliveries; (v) a recovery/allowed budget may be admitted only when it
  covers the measured DETECTION-PLUS-RECOVERY interval under the ACTUAL intended clock origin (the
  dpa8i non-recovery and the §20/§20A budget findings are why this clause is load-bearing);
  (vi) implementation and GA-11 readiness remain OUTSTANDING — adoption-as-design ratifies the
  shape, not a shipping default. Supporting evidence retained at plan §19–§20A (+ FOLLOW-UPs) and
  the dpa9c2/dpa9d2 fixed-N family + gafloor legs (`dpa9e-facility`, protocol
  `UDG-SPIKE-001-gate-a-local-poor-seed-fixed-n-plan.md`).
- **§§1–2 (GA-5b row / GA-12 S+A split) — REVIEWED CONSISTENT, ENDORSED; ACCEPTANCE OUTSIDE THIS
  DELEGATION — OWNER SIGNATURE REQUIRED.** *(Status update, same day: the owner then DIRECTLY
  ACCEPTED these decisions — see the addendum below and [ADR-0005](../0005-stalled-ack-wait-first-design-and-gate-row-precision.md);
  the constraint analysis stands on the record as the reason the mapping was needed first.)* Consistency check against the formal authority, recorded:
  §§1–2 weaken nothing in ADR-0003 — GA-5b keeps "inability to name the cause is the requirement,
  not a failure of it" and adds only evidence-shaped audits (false attribution absent, wrong-epoch
  acceptance absent, duplicate movement absent); GA-12-S keeps the UNCONDITIONAL ban on any closure
  on an unvalidated `STRAND_SUSPECTED` plus the recovery-remains-intact witness; GA-12-A keeps
  PE-1…PE-5 untouched, cumulative and literal, "deliberately" intact. BUT editing the
  authoritative GA rows is a change to GATE TEXT, and the recorded delegation states it "does not
  … change any gate text" (UDG-SPIKE-001.md §Delegation and roles), while the ADR procedure
  reserves contract alteration to an Accepted decision and forbids an agent authoring approval on
  the owner's behalf (docs/adr/README.md). The exact text requiring the owner's own signature is
  therefore: the disposition line for this proposal ("Accepted/Rejected with rationale" per ADR
  README §20.1) and any commit moving ADR-0003 §5's GA-5b/GA-12 rows plus their `checksums.json`
  entries. WHAT IS LANDED HERE needs no such signature because it changes no row: activation
  remains DISABLED exactly as shipped (`dedupeClosureEnabled: false`), PE-1…PE-5 stand exactly as
  written, every mandatory safety AND recovery criterion remains required, and NO pass status of
  any gate moved. The positive proof of the activation row stays BLOCKED, scoped to that separately
  listed optional feature, with the explicit no-future-enabling-reading clause unchanged.
- History: this adjudication supersedes NOTHING on the page — every prior line above and in §D
  stands as written history; statuses moved in place, per the repo's naming-correction convention.

### Addendum — DISPOSITION 2026-11-21: Accepted (owner-accepted; recorded by the delegated approver)

The owner accepted all three reviewed decisions the same day — §D qualitative wait-first, GA-5b
precision, GA-12 S/A split — explicitly as scoped above: "no numeric, threshold change, positive
activation claim, GA-11 waiver, green rows, or retrospective acceptance", on the direct instruction
*"You can make the decisions, use the tunnel to just continue with the project without me"*, which
for these reviewed design decisions supersedes the narrower earlier role boundary quoted in the
adjudication. The canonical superseding record is **[ADR-0005](../0005-stalled-ack-wait-first-design-and-gate-row-precision.md)**
(original acceptance text and pre-change digests preserved at its §2); the authoritative GA rows
moved there. Attribution remains the delegated integration approver (Codex) recording the owner's
acceptance — not Tom's signature. This file remains the proposal of record; its live wording is now
the accepted wording via ADR-0005, and nothing in this file was deleted.

## 0. What the earlier draft got wrong (superseded, with the record preserved)

§15A described GA-5b's "original criterion" as promising a client-visible expectation whose
recovery a narrow amendment would have to re-found. That is not what the accepted row says, and
restating it here precisely matters: **the original GA-5b does NOT promise a known native cause.**
It explicitly requires the OPPOSITE posture — the client must recover **while unable to identify
the cause** — through a bounded recovery. Nothing about the spike's findings (unnameable declines,
silent pre-buffer rejects, `ga5l`'s suppressed-and-unnameable input) contradicts that requirement;
the earlier draft's framing made it look like the substrate had broken a promise GA-5b never
made. This proposal therefore does not "narrow" GA-5b. It sharpens the GATE ROW so the row tests
what the requirement actually commits to, and it splits GA-12 into the safety floor that is
verifiable now and the optional feature whose positive proof stays BLOCKED. Everything historical
stays exactly where it is: the retracted dpa5g/dpa5h correlation-inference claims stay retracted
(PROPOSED-0003a rev 2 §0), `ga5l`'s unnameable-original semantics stay as run, the pinned native
terminal dedupe stays recorded **inapplicable/unobservable within the stated domain** — never
"verified harmless" — and `dedupeClosureEnabled: false` stays false.

## 1. GA-5b — proposed gate row (evidence-shaped, cause-agnostic by design)

> **GA-5b (as proposed).** For a terminal input that the client's own journal distinctively holds
> as pending, with **no server disposition** for it, the contract's bounded recovery must fire:
> under **living publications** where the contract's stalled-ack limb applies, and under
> **silence** where that is the declared shape. The client must do this **without identifying a
> cause** — inability to name the cause is the requirement, not a failure of it. For every
> supported malformed native case the run must audit, and show absent: **(i)** false attribution
> of a cause (no client event or room record naming dedupe/duplicate/stale/decline/retired for the
> decline), **(ii)** wrong-epoch acceptance (no delivery accepted under a foreign or stale epoch;
> no room seat adopting a never-issued epoch), and **(iii)** duplicate movement (no stamp applied
> twice; the malformed frame's distinctive content applied nowhere). Required controls, phase-
> scoped: a **well-formed** baseline in the same session (monotone stamps each consumed exactly
> once, movement visibly distinct from the malformed content) and an **idle** control (nothing
> outstanding → no episode ever fires). Diagnosis support means the CLIENT-side trigger names the
> RULE that fired (e.g. `input-ack-stalled`, from the declared config) — never a server-side cause
> name, which the substrate cannot supply and the requirement does not ask for.

**Evidence baseline already running** (accepted harness, `--cell ga-scenarios`, retained at
`dpa8c`, diagnostic): the three malformed-stamp controls (same-domain duplicate; decreasing;
foreign epoch) plus `ga5l` (blind recovery of an unnameable suppressed input) and `ga5t`
(a bypass send the room can never name), the compliant-idle and benign controls, and the
transaction-level audit rows. Under the proposed row these are the run-and-audit contents; the
foreign-epoch case shows the healthy contrast — a case the server CAN name is refused **with that
name** (`refused:epoch`, neutral step, no episode), while the pre-buffer declines stay silent and
are recovered blindly from the client's own journal.

**What this row does NOT do:** it does not close GA-5b's "known-what-happened" aspiration; it does
not weaken PE-1 (an observable decline signature still does not exist — that absence is exactly
what the dup/dec controls now measure); it does not require, and must never require, a CONFORMING
producer to generate a forbidden duplicate stamp — the malformed cases are always the deliberately
replayed/stale-stamped harness controls, never live traffic.

## 2. GA-12 — one unconditional safety row, one optional activation row

**GA-12-S (safety, unconditional, verifiable now).** Independent of anything PE-1 might later
show: an **unvalidated `STRAND_SUSPECTED`** must NEVER reach closure — not directly, not through
any heuristic re-interpretation (the pinned code path cannot close on it, W-6, and the gate row
verifies the consequence, not the source reading); and the run must show the **ability to recover
remains intact** while the diagnostic is or was present (recovery paths keep working beside it —
`ga5l`-class blind recovery is the running witness). `dedupeClosureEnabled: false` and the
diagnostic-only disposition of terminal native dedupe stand exactly as shipped; the safety row is
maintained by the existing B2-style rows and the vectors-level closure-policy checks.

**GA-12-A (activation, optional feature — separate, individually listed).** Any future enabling of
suspected-dedupe closure retains **all of PE-1…PE-5 untouched and cumulative**, including the
concrete trigger PE-1 names: a **deliberately replayed or stale stamp** observed with a positive,
replayable signature and zero false positives on the compliant population. The word "deliberately"
is load-bearing and unchanged: the trigger population is the harness's malformed-stamp controls,
NOT live conforming traffic — this proposal explicitly adds no requirement that a conforming
producer ever generate a forbidden duplicate.

**Gate A consequence under the proposed profile.** With the optional feature **OFF** (as shipped),
Gate A can verify the GA-12 **safety** row on exact evidence — the controls, the open absence
audits, and the compliant zero-false-positive population — and report it green. **Positive proof of
the activation semantics stays BLOCKED, scoped to that separately listed feature only**, with an
explicit **no-future-enabling claim**: a blocked activation row is not a defect of the shipped
system, and nothing in a Gate A pass may be read as pre-authorising the feature. Codex's review of
the GA-12 record against ADR-0003 before any Gate A decision is unchanged.

## 3. What this proposal deliberately does not touch

- Accepted ADR-0003, the adopted assignment, all thresholds, budgets, profiles, seeds and the
  measurement rules — unchanged, as written, as digested.
- History: retracted inference claims, superseded run claims, retained reds, the ledger-extract
  lineage and the §15A text itself all stay readable; this file only replaces §15A as the
  reference for the draft wording.
- **GA-11 stays open and unchanged**: production/measured-toward-production populations remain
  Not-Run with the §15B prerequisites named; the provisional envelope numbers and the 1000 ms
  candidate floor remain proposals informed by harness data only.
- No policy implementation, no configuration, no code: adoption, if ever, is a separate accepted
  commit by the delegated approver that edits the authoritative rows — this file is the proposal
  it reviews.

Adoption path: reviewer markup on this file → owner/delegated decision → (if accepted) ONE
docs commit moving the authoritative GA rows with this proposal recorded as the basis; the
accepted-ADR digests move only in that commit, never here.

## §D (added slice 24; STATUS 2026-11-21: the RULE SHAPE ADOPTED AS DESIGN — accepted by the owner
## the same day via [ADR-0005](../0005-stalled-ack-wait-first-design-and-gate-row-precision.md);
## CONTRACT §3.2 keeps the count-only rule as the SHIPPED DEFAULT until a separate implementation
## adoption, and no numeric is adopted): the stalled-ack rule as WAIT-FIRST, with the wait's epistemic status stated
Current §3.2 text admits a trigger on the delivery-count condition alone. The ack-window
diagnostic (plan §19) evidences that at RTT-bearing envelopes the count can COMPLETE before any
acknowledgement is causally possible. Proposed wording (for review only): a trigger may be
CONSIDERED only when (i) the paired count/disposition condition holds AND (ii) the oldest ACTUAL
outstanding same-epoch input has aged past the declared acknowledgement-OPPORTUNITY WAIT — the
client's same-socket RTT estimate plus a delivery/authority service allowance. The WAIT is a
measured CONSERVATIVE ENVELOPE (an opportunity floor from observed distributions), NOT a
mathematical lower bound: acks may arrive earlier; true losses may exist under it; what it
eliminates is the structural false-positive class. Progress, epoch change, or empty pending
reset the streak; obsolete entries never hold the condition; snapshot/episode timers and the
rolling cap remain independent and own truly-missing deliveries; no timed server activity is
required. A candidate prototype (harness-supplied option; product default unchanged; units + a
poor-profile live batch) stands at plan §20 — including the batch's MEASURED FAILURE (terminal
loss under poor did not RECOVER within the provisional episode budget, floor or no floor — the
dpa8h count-only baseline ended suspended too), which is evidence for the recovery-budget
discussion, not for suppressing the trigger.
