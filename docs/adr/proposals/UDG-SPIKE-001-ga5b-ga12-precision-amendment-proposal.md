# UDG-SPIKE-001 — proposed precision amendment to the GA-5b / GA-12 gate wording (PROPOSED, NOT ACCEPTED)

Status: **PROPOSED.** Written 2026-11-20 for the delegated reviewer. **This file accepts nothing and
changes nothing**: [ADR-0003](../0003-input-acknowledgement-overflow-and-resynchronisation-policy.md)
remains the accepted text exactly as adopted, `docs/contracts/**` thresholds, budgets and profiles
are untouched, and no gate verdict is implied. It **supersedes the wording** of the earlier draft
amendments (§15A of the [formalization plan](../assignments/UDG-SPIKE-001-gate-a-formalization-plan.md)
and the AR-flavoured phrasing around them) which a slice-16 review found inaccurate; the earlier
wording stays on the record, superseded rather than deleted, per the history rules.

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
