# PROPOSED-0003a (rev 3) — Dedupe observability and the terminal-dedup sub-assertion: a decision proposal for ADR-0003 GA-5b / GA-12

> **Status: PROPOSAL — NOT ACCEPTED, and deliberately NOT an edit of ADR-0003.**
> ADR-0003 remains the accepted text, unchanged. This revision exists because **rev 1 failed review**:
> its GA-5b narrative conflated the SDK's slot-ack layer with the room-owned resolved prefix and
> claimed a declined input was "covered by the same delivery". It was not, and the claim is
> RETRACTED below. The corrected evidence is the `ga5t` transcript scenario
> (`tests/e2e/netcode.spec.ts`, cell `ga-scenarios`), audited by
> `tools/load-test/src/ga5-transcript.ts` (unit-tested with forged red controls). Nothing here
> changes production code, test policy, thresholds, or the ADR. All spike evidence is DIAGNOSTIC
> and is not a Gate A verdict.

## 0. What rev 1 got wrong (retraction, kept on the record)

1. **The counters are independent.** `delivery.ack` is the SDK's slot/ack layer;
   `delivery.resolvedThrough` is the ROOM's resolved prefix, published from room state. The room
   advances that prefix ONLY when a real dequeued frame satisfies `seq === resolvedThrough + 1`
   (`apps/server/src/network/ColyseusInputAdapter.ts:190-193`). The accepted client guard requires
   `ack === inputResolvedThrough` for an ACCEPTED delivery and REFUSES otherwise
   (`apps/client/src/network/ColyseusPredictionAdapter.ts:339-340`) — the two surfaces are fused
   only as a **detection seam**: disagreement is a refusal, never an inference that something
   invisible was disposed.
2. **A pre-buffer decline has NO room-owned disposition at all.** A frame declined at
   `InputBuffer.accept` never enters the buffer, never dequeues, appears in no consumed record, no
   gap, no signal, no closure. It is **absent**, not covered. Any statement that a delivery's ack
   "covered" it is wrong as a matter of the accepted code.
3. **The rev-1 row was never domain-keyed.** The delivery row the earlier report cited
   (`ack: 1, resolvedThrough: 1`) cannot be a disposition of the fixture's twin stamp: a domain
   whose only real dequeue is stamp 40 cannot publish prefix 1 from that fact. Reconciling the
   archived runs (`dpa5f/dpa5g/dpa5h`, preserved), the row was either a foreign-domain/older-domain
   row or an unrelated healthy lifecycle row — the fixture itself was suspect: its sends followed a
   §3.2 REJOIN through a raw handle (cross-domain counter residue), and no wire receipt proved the
   bypass frames even left the client. Rev-1's "first-run disproof" then revised the STORY while
   keeping the same invalid join — the reviewer was right that the prose was self-contradictory.
   The whole Case-B fixture has been DELETED, not patched, and its refuted runs preserved.

## 1. The corrected evidence: `ga5t` — one indexed transcript, absence proven, coverage not claimed

`ga5t` runs on a FRESH isolated seat (its own room and pages; no rejoin, no cross-domain residue)
and assembles ONE `(roomId, sessionId, epoch)` transcript joined to the room's own tick records:

- **per-send**: ordinal, role (`pump`/`liveness`/`eaten`), staged stamp READ BACK from the wire
  object, handle slot counter before/after (`-2` = adapter-managed, never invented), ack return,
  epoch, sessionId, page-clock time, and the proxy **c2s wire receipt** observed in that send's
  window (a silent no-op bypass fails the fixture row loudly — the dpa5-era failure mode is now a
  RED condition, not an assumption);
- **room-side**: per-tick real dequeues (`seq`, tick, bridged time), refusals, signals, closures,
  leave records;
- **client-side**: immutable ledger rows (epoch, authorityTick, ack, resolvedThrough, gap, retired,
  accepted, reason) sliced from the quiet baseline — never a retrospective "last row"; plus
  pending-journal samples across the whole window.
- **full provenance**: the pre-window pump frames are transcript sends too (from the producer's own
  audit journal); the validator rejects ANY consumed stamp no staged send accounts for — an
  aliasing detector that fired on this slice's own drafts (a window-scoped prefix audit and missing
  pump provenance were BOTH caught by it before any claim was made).

The genuine terminal form the fixture can honestly build is the **equality replay**: a producer
ORIGINAL accepted and CONSUMED at stamp n, then a raw REPLAY re-stamping n — declined at the
pre-buffer boundary, TERMINAL (nothing follows). What `ga5t` then PROVES:

- **GA-5t-audit**: every accepted delivery's published `resolvedThrough` equals the prefix REBUILT
  from the room's real same-domain dequeues OVER THE WHOLE DOMAIN, and carries
  `ack === resolvedThrough` (the guard's equality); no foreign-epoch row is selected; no pending
  prune happens except under a prefix-advancing delivery or a labelled discard; a FORGED control
  row (published prefix 99 with no dequeue chain) is demonstrably REJECTED by the same validator.
- **GA-5t-absence — DECLINE IS ABSENCE, NOT COVERAGE**: the replayed stamp's consumed count stays
  EXACTLY 1 (the original; the decline contributes ZERO consumptions), refusals 0, no gap, no
  `RETIRED_UNREPRESENTED`, no closure, plain leave (retired 0, queue 0), the replay's distinguishing
  z-content never reaches the observer (applied ZERO times), and the client records NO §3.2 episode.
  The honest statements are: applied zero times, recorded nowhere, and the client is NOT misled —
  nothing in the accepted stack lets it believe coverage.

## 2. The narrower invariant, and the actual excluded case

**Claim (scoped).** Under (a) the pinned accept rule (`accept(v) = v > _lastSeq`, evaluated before
the buffer; `@colyseus/core@0.18.27` `RoomInput.capture` → `InputBuffer.accept`) and (b) the
admissible producer invariant — *same domain; stamps strictly increasing; every send goes through
the producer's counter, so each accepted stamp raises the watermark contiguously* — pre-buffer
decline is UNREACHABLE: the next stamp is always `_lastSeq + 1`.

**Excluded case, stated exactly.** A decline requires a stamp `≤ _lastSeq` that was never the
contiguous frontier — i.e. a REPLAY, stale domain state, or an external re-stamp: the
**protocol-corrupted** classes, none of which an admissible producer can emit (measured control:
the healthy window's consumed stamps are contiguous from 1 with zero declines). Within that excluded
class, two observable families exist on the supported substrate:

- **non-terminal replay** (a later stamp arrives): the room NAMES the consumed-range jump and the
  client refuses delivery and resynchronises within budget — `GA-5a`, measured repeatedly;
- **terminal replay** (nothing follows): the decline is SILENT and ABSENT everywhere — `ga5t`,
  measured above. No honest observer sees a disposition, because there is none.

A fixture cannot manufacture a "unique lawful terminal loss with a surviving distinct twin" on the
pinned stack, for a structural reason: there is ONE watermark per domain. Whatever stamp the bypass
pushes `_lastSeq` to, the producer's next lawful stamp either exceeds it (accepted — no decline) or
is `≤` it, which is exactly the protocol-corrupted form. The only fixture-visible declined terminal
frame is therefore the equality replay (or a stale-domain/backward stamp), and it has NO surviving
distinct accepted twin at its own stamp — its stamp's accepted instance IS the earlier original.
(The pinned core snapshots each accepted frame at capture — `build/input/RoomInput.mjs:184`
`buf.push(this.options.snapshot(inst), …)` — so this is a property of the watermark order, not of
object sharing; the validator's aliasing detector, which caught two of this slice's own join
mistakes, additionally guarantees no consumed stamp ever enters the transcript unstaged.) We
report the excluded case as excluded rather than author a fixture whose outcome the substrate
cannot support.

## 3. Options for ADR-0003 (no production change in any of them)

**Option A — keep the letter; keep the blocked rows.** GA-5b's client-recovery sub-leg and GA-12's
positive PE-1 stay BLOCKED/Not-Run on the pinned stack. *Cost:* Gate A carries rows that cannot
close on this pin. *Risk:* blocked rows age into pressure to fake closure. *Compensating controls:*
`ga5t` (absence, applied-zero, wire receipts, whole-domain prefix audit), `GA-5a` recoverable
sibling, `GA-6a/b/c`, `GA-7T` with C1/C2, the invariant control, and the validator's forged-row red
controls.

**Option B′ — refine the requirement into TWO claims, and refuse to merge them.** (i) **Gate A
safety evidence** (what `ga5t` + friends actually prove): a declined pre-buffer frame is applied at
most zero times, leaves the server asserting NOTHING, is detectable when non-terminal and
recoverable under §3.2, never corrupts the resolved prefix (whole-domain rebuild audit), and cannot
arise from an admissible producer (invariant + control). (ii) **Closure of pre-buffer dedupe**
(a STRAND-driven closure policy) remains UNSUPPORTED and its enabling proof set — **PE-1…PE-5 —
stays a strict prerequisite for ever enabling it** (`dedupeClosureEnabled` stays false and hashed);
this proposal does NOT make PE-1 optional for closure, and no wording here may be read as doing
so. *Cost:* an ADR text amendment splitting GA-12 into "safety evidence (satisfied)" vs "closure
prerequisites (open)". *Risk:* readers may collapse the two; mitigated by keeping PE-1's failure
verbatim in the record and the config hash pinned false.

**Option C — upstream ask.** Request a public pre-buffer disposition counter (one integer per
declined stamp satisfies PE-1 and GA-5b's letter). *Cost:* upstream dependency, pin bump. *Risk:*
schedule only. Filing the request is compatible with choosing A or B′ now.

**Recommendation:** B′ + file C. The choice belongs to the directors; this document decides nothing.

## 4. What stays denied regardless of the option

- **PE-1 failing alone denies production dedupe CLOSURE.** It fails on the pinned core today; that
  denial stands under every option, including B′ (whose entire point is that safety evidence and
  closure are different claims). `dedupeClosureEnabled` false; `STRAND_SUSPECTED` diagnostic-only
  (W-6); closure policy unchanged.
- No slot-ack statement is ever coverage: coverage claims require a room-owned disposition, and the
  accepted guard's `ack === inputResolvedThrough` exists to make disagreement REFusable, not
  inferable.
- No production operator command; no SDK monkeypatches; all injections are harness-side (proxy
  withhold/sever/flush) or explicitly-labelled fixture bypasses with wire receipts.
- No threshold, target, window, or budget changed; INVALID stays INVALID; all attempts retained.

## 5. Evidence index

- `ga5t` rows `GA-5t fixture soundness`, `GA-5t TRANSCRIPT AUDIT`, `GA-5t DECLINE IS ABSENCE` +
  `GA-5b invariant control` (cell `ga-scenarios`, seed 1001; 17 rows, consecutive greens in
  `dpa6d`/`dpa6e`; first-run refutations of the row's OWN drafts `dpa6a`/`dpa6c` preserved). Validator: `tools/load-test/src/ga5-transcript.ts`; forged-red unit suite
  `tests/unit/udg-spike-001/spike-ga5-transcript.test.ts` (12 tests).
- Retired evidence, PRESERVED (not patched): `dpa5f` (first-run refutation), `dpa5g`/`dpa5h` (the
  rev-1 correlation row this document retracts). The retired Case-B fixture is deleted with a
  comment at its site in `netcode.spec.ts` pointing here.
- Rev 1 of this proposal is superseded by this rev 2; the retraction is §0, in-document.
- Rev 2 is superseded by rev 3 for ONE sub-claim, in-document (§6): the client-recovery half of
  GA-5b was worded on an assumption its own evidence refutes.
- Accepted-code anchors: `ColyseusInputAdapter.ts:190-193` (prefix rule),
  `ColyseusPredictionAdapter.ts:339-340` (guard equality), `@colyseus/core@0.18.27`
  `build/input/{RoomInput,InputBuffer}.mjs` (accept-before-buffer).
- GA-11 calibration (companion): cell `ga11-calibration` — see api-map §14.8 for the corrected
  leg naming and per-leg achieved validity; production-directed evaluation Not-Run.

## 6. Rev 3 (slice 8) — the mandated stalled-ack rule exists now, and one wording is corrected

Rev 2 (and the ga5t row it carried) stated that the raw-bypass terminal decline leaves the client
with NOTHING to recover from — "no pending entry for a raw bypass send". That wording was WRONG,
and the preserved evidence proves it locally: the granted adapter journals EVERY send through the
handle's `onSend` listener, so a bypass send leaves the measuring client's OWN journal holding the
slot it stamped — `pendingSamples` in the retained dpa6d/dpa6e transcripts show exactly that
(stamp 16 pending through the whole window). What made "no episode" true was not the absence of an
expectation but the absence of the rule: ADR-0003 §3.2 has always defined `INPUT_ACK_STALLED` over
precisely this observable (an outstanding input, NEITHER the ack watermark NOR `inputResolvedThrough`
moving across G consecutive deliveries, epoch unchanged), and slice 8 implemented it in the granted
adapter after a red-first unit proof (`predictor.test.ts`; the 500 ms deadline cannot substitute —
it restarts on every accepted delivery, so a live publication stream refreshes it forever).

Measured consequences, in `ga-scenarios` (`ga5t` extended, `ga5l` new, api-map §14.10):

- On the ga5t seat the decline shape now takes EXACTLY ONE recovery route — a blind
  `input-ack-stalled` episode (never a deadline/gap/retired route) ending in snapshot recovery.
  The client is no longer silently frozen; it recovers WITHOUT NAMING, which is what §3.2 mandates
  for a loss the server cannot identify. The ABSENCE proofs are unchanged: the decline still
  contributes zero consumptions, zero refusals, no gap, no closure, and its content never reaches
  an observer.
- A genuinely lost admitted input (test-only application-delivery suppression at the harness hop:
  bytes received and counted, application never receives them — never TCP loss, never dedupe)
  triggers the same rule at exactly G, recovers bounded, and the room reports the loss
  UNIDENTIFIABLE (retired 0, queue 0, no signal) — the GA-5b recovery half, measured.

What does NOT change: the invariant (an admissible producer cannot generate a terminal pre-buffer
decline), PE-1…PE-5 as the closure prerequisite (the decline remains SILENT on the wire and in
every room record — the stall rule is blind recovery, not a decline signal, and neither fixes nor
masks PE-1), and the exclusion of a legitimate-producer terminal fixture. The GA-5b client-recovery
sub-claim is therefore narrowed, not closed: BLIND recovery from the terminal shape is evidenced
for a client whose journal holds the bypass slot; recovery that KNOWS what happened remains
blocked on PE-1, and the server-side disposition gap this proposal exists to decide stays exactly
as §3 lays it out. No option's adoption status changed; this revision adds one correction and the
measurements beside it.
