# ADR 0005 — the stalled-ack wait-first rule adopted as DESIGN, and the GA-5b / GA-12 row precision (superseding record)

Status: **Accepted** — decided by the **delegated integration approver (Codex)** on 2026-11-21,
recording the owner's explicit acceptance of the reviewed decisions. Basis and scope, transparently:
the owner's direct instruction of 2026-11-21 — *"You can make the decisions, use the tunnel to just
continue with the project without me"* — supersedes, **for the present reviewed design decisions
only**, the narrower earlier role boundary that had left these acceptances awaiting an owner-signed
disposition. This record is signed **as the delegated integration approver (Codex)**, never as, and
not impersonating, `TomBResearch`; the project owner remains `TomBResearch` (unchanged, per
[UDG-SPIKE-001.md §Delegation and roles](../contracts/assignments/UDG-SPIKE-001.md), where the
basis is also recorded). Implementation (Pi) and acceptance (this record) are separated per
`docs/contracts/ownership.md`. It follows ADR procedure §20.1: the proposal is retained with its
disposition; superseded text is preserved here VERBATIM with its digests; nothing is deleted.

## 1. What is decided (and what is explicitly NOT)

Decided:

- **D-1 — §D wait-first ADOPTED AS DESIGN** (qualitative, exactly as scoped in the reviewer's
  2026-11-21 decision): the delivery-count condition ALONE is insufficient; a stalled-ack trigger
  may be CONSIDERED only on the PAIRED epoch/count/disposition condition AND the age of the
  OLDEST ACTUAL outstanding same-epoch input past the declared acknowledgement-opportunity WAIT;
  the WAIT is a MEASURED CONSERVATIVE ENVELOPE — neither a causal lower bound for every
  acknowledgement nor a proof that anything is lost; healthy progress, epoch change or empty
  pending RESET the condition and obsolete entries never hold it; the snapshot deadline, episode
  deadline and rolling cap remain INDEPENDENT timers owning truly-missing deliveries; an allowed
  recovery budget may be admitted ONLY when it covers the measured detection-PLUS-recovery
  interval under the ACTUAL intended clock origin.
- **D-2 — GA-5b row precision ADOPTED**: the authoritative GA-5b row (ADR-0003 §5) is replaced by
  the cause-agnostic, evidence-shaped row of the proposal §1 (recovery without naming a cause —
  the requirement — plus the three absent-audits (i) false attribution, (ii) wrong-epoch
  acceptance, (iii) duplicate movement, and the phase-scoped well-formed/idle controls).
- **D-3 — GA-12 split ADOPTED**: the authoritative GA-12 row is replaced by the two rows of the
  proposal §2 — **GA-12-S** (unconditional safety, verifiable now: no closure on an unvalidated
  `STRAND_SUSPECTED` by any route; recovery ability demonstrably intact beside the diagnostic) and
  **GA-12-A** (optional activation, individually listed: PE-1…PE-5 untouched and cumulative,
  "deliberately" load-bearing, blocked-scoped positive proof, no-future-enabling reading).

Explicitly NOT decided (each would need its own separate decision):

- NO numeric adoption anywhere: the 400 ms W remains a harness-supplied LOCAL prototype value;
  every provisional setting in ADR-0003 §5's settings row keeps its status; **no threshold
  changed**.
- NO change to the SHIPPED DEFAULT rule: §3.2's implemented product default remains the count-only
  rule until an implementation adoption lands with its own evidence (the client opt-in path added
  by slice 28 makes the design CONFIGURABLE and fail-closed; it does not make it the default).
- NO positive activation claim: GA-12-A stays blocked-scoped; activation stays DISABLED
  (`dedupeClosureEnabled: false`); NO green rows were written anywhere; NO GA-11 waiver —
  representative-deployment obligations (§15B(1)–(5)) stand untouched.
- NO retrospective acceptance: prior run dispositions, retained reds and hosted rows are
  unaffected by this record.

## 2. Text superseded, preserved verbatim (with pre-supersession digests)

From [ADR-0003](0003-input-acknowledgement-overflow-and-resynchronisation-policy.md) §3.2 (sha256
of the file AS ACCEPTED, before this supersession:
`4ab67402d63af35fccd9c23787b24496e22b9771fc455b334be90351b41f62aa`):

> The stalled-acknowledgement signal that normally fires this path is `INPUT_ACK_STALLED`, defined
> solely from client-observable quantities: an outstanding input, with neither the SDK
> acknowledgement nor `inputResolvedThrough` advancing across `G` consecutive state deliveries,
> epoch unchanged. **No client-side condition may test server queue depth — no supported client API
> exposes it.**

Supersession reading: the count/disposition condition REMAINS A NECESSARY limb of the definition
(and the server-depth prohibition is untouched), but as of this record it is ALONE INSUFFICIENT as
the design criterion — D-1's paired wait limb joins it. An in-place pointer marks the original
sentence; this section is the verbatim preservation.

From ADR-0003 §5 (same digest): the GA-5b row ("**terminal dedupe** — … the server reports the
loss as **unidentifiable** rather than inventing a gap or a cause") and the GA-12 row
("**positive evidence for the dedupe closure signal** — PE-1…PE-5 all pass …") — both replaced
in-place by the canonical rows below; the originals stand quoted here and in git history.

## 3. Canonical rows as amended (authoritative text lives in ADR-0003 §5; this is the record)

- **GA-5b (as amended by ADR-0005)** — proposal §1's row verbatim (cause-agnostic recovery; the
  three audits; phase-scoped controls; diagnosis names the RULE, never a server cause).
- **GA-12-S (safety, unconditional)** — proposal §2 GA-12-S verbatim.
- **GA-12-A (activation, optional, individually listed)** — proposal §2 GA-12-A verbatim; blocked
  positive proof scoped to it alone.

Affected immutable references and checksum history (all moved in THIS commit, regenerated by the
normal process `pnpm contracts:checksums`; pre-change digests named so history is re-derivable):
`docs/adr/0003-…md` (pre: `4ab67402…62aa`), `docs/adr/proposals/UDG-SPIKE-001-ga5b-ga12-precision-amendment-proposal.md`
(pre: `046f3858…d7c8`, disposition Accepted recorded), `docs/adr/README.md` (pre: `05fd863c…c7c2`,
index row added), `docs/contracts/UDG-SPIKE-001.md` (pre: `5e30aa8b…435b`, owner-instruction basis
recorded), `docs/interfaces/movement-authority.md` (the clause-audit result: its stalled-ack clause
was the one remaining CONTRACT SURFACE defining the trigger count-only; a proviso naming this
record's insufficiency reading is appended in place — the D7-B limitation that the file stays
baseline text otherwise stands; no other clause moved). Post-change digests are whatever
`checksums.json` in this commit carries — the manifest is the live authority thereafter.

## 4. Reproduction / retests required and performed

Contract text changes require the records lane and the contract suites: `pnpm contracts:checksums`
in sync; `pnpm test:contract -- --task UDG-001` (50/50) and the unit suites re-run at this commit;
the client wait-first behaviour is unit-pinned by `stall-ack-floor.test.ts`,
`stall-ack-floor-config.test.ts` and the slice-28 predictor cases (fail-closed validation, honest
status, trigger/episode clock origins distinguished). Gate rows' live legs are UNAFFECTED today:
they run again unchanged when the formal matrix runs; nothing in this record makes any row pass.
