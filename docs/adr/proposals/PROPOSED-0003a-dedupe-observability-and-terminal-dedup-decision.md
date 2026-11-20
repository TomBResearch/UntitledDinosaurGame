# PROPOSED-0003a — Dedupe observability and the terminal-dedup sub-assertion: a decision proposal for ADR-0003 GA-5b / GA-12

> **Status: PROPOSAL — NOT ACCEPTED, and deliberately NOT an edit of ADR-0003.**
> ADR-0003 (`0003-input-acknowledgement-overflow-and-resynchronisation-policy.md`) remains the accepted
> text, unchanged by this document. This is a decision RECORD for the directors, brought by the evidence
> of UDG-SPIKE-001 slices 6h/6i: on the PINNED substrate, two ADR sub-assertions (GA-5b's client-recovery
> leg and GA-12's positive PE-1 proof) are unsatisfiable **by construction of the pinned implementation**,
> not by lack of harness effort. The proposal states the measured facts, the identity analysis, the scoped
> unreachability proof, one anti-alias control, and three decision options with cost/risk. Nothing here
> changes production code, test policy, thresholds, or the ADR. All spike evidence cited is labelled
> DIAGNOSTIC and is not a Gate A verdict.

## 1. The triggering facts (measured, reproducible)

The pinned input path is `@colyseus/core@0.18.27`, `build/input/RoomInput.mjs` `capture()` →
`build/input/InputBuffer.accept(value)`: **`value <= this._lastSeq` returns `false` and the input is
discarded BEFORE the buffer** — silently: no room-visible trace, no signal, no counter.

Measured in `tests/e2e/netcode.spec.ts` (cell `ga-scenarios`, runs `dpa4i` → revision `dpa5g`/`dpa5h`
on branch `codex/udg-spike-001-dpa2-impairment`, evidence under `artifacts/.local/spike-001/`):

1. **GA-5a (mid-stream dedupe) passes**: a replayed stamp equals an accepted one and is eaten
   pre-buffer (wire receipts prove arrival); the send-counter slot consumption makes the next
   contiguous stamp jump; the room NAMES the resulting range; the client's guard REFUSES delivery
   (`gap-named`), runs a complete §3.2 episode and resynchronises within budget; retired 0, no closure.
2. **GA-5b (terminal dedupe) server-side passes; its client-recovery sub-leg is BLOCKED with proof**:
   a raw handle send (a deliberate fixture BYPASS of the producer) pushes the server watermark to the
   twin stamp; the producer's own next stamp — its domain-local `sentCount + 1`, never sent before —
   is `<=` that pushed watermark and is eaten pre-buffer, TERMINALLY (no later stamp exists).
   The client records NO episode: its pending entry for the eaten stamp is pruned by the ack that
   covers its own ack slot, and the §3.2 deadline arms only while pending is non-empty (measured
   arming condition). There is no well-formed client expectation left to time out.
3. **GA-12 PE-1 fails on the pinned core**: a deliberate pre-buffer discard produces NO strand
   signature (silent by construction). "STRAND_SUSPECTED appears when and only when a replayed stamp
   is observed" is unsatisfiable while the discard is invisible at the room boundary.
4. **The server records the terminal loss honestly as UNIDENTIFIABLE**: plain leave, retired 0,
   queue 0, no gap invented, no strand, no closure. It asserts neither a cause nor a missing range.

## 2. Counter identity: what actually correlates with what

Three counters exist, and conflating them is where "alias" arguments go wrong:

| Counter | Owner | Semantics |
|---|---|---|
| producer stamp | client predictor, **domain-local** | `sentCount + 1` at send time; strictly increasing per domain |
| send/ack slot | SDK `RoomInput` handle | slot of THIS socket's send; the raw fixture bypass consumes slots without the producer's knowledge |
| `_lastSeq` / `resolvedThrough` | server watermark → echoed in the delivery record | the highest stamp **contiguously disposed**; the client's `resolvedThrough` never advances past a hole |

**Documented traces (same delivery, before/after; run `dpa5h/ga-scenarios`):**

- GA-5b trace (`deliveryTraceB`): sample N shows `pending [1]` (the eaten frame's entry outstanding);
  the next delivery row is `{ack: 1, resolvedThrough: 1, gap: [0,0], pending: []}` — the prune of the
  eaten frame's pending entry happens **on the same delivery** whose row carries the ack covering its
  slot and `resolvedThrough` at exactly that slot, with NO gap named. The consumed set in that domain
  is exactly the twin (the jump stamp 40): the eaten frame was applied zero times.
- GA-5a contrast trace: when a stamp is skipped ENTIRELY (a genuine hole — nothing was disposed at
  that stamp), `resolvedThrough` **stalls before the hole**, the record NAMES the range
  (`gapStart..gapEnd`), the client refuses delivery and resynchronises. That is the §3.2/§3.1 rule
  working, measured.

**Reconciliation of "twin coverage" with "resolvedThrough never advances past a genuine hole":**
there is no contradiction because there is no hole. In GA-5b the producer's stamp K was **disposed** —
declined at the pre-buffer boundary, which is a disposition, not a loss-in-transit — and the client's
ack slot for that send is legitimately covered by the watermark that the twin raised. `resolvedThrough`
advances to the watermark's honest value (measured: to 1, i.e. the ack slot; it does NOT pretend the
twin's 40 or anything beyond it) and, under the invariant of §3, an ack slot is covered exactly when
the corresponding stamp has been disposed. A GENUINE hole has no disposition: the watermark stops,
the gap is named, the deadline (which arms only with outstanding, undisposed inputs) fires. Both
behaviours are evidenced in the same run, side by side.

**First-run disproof preserved:** this slice's first run (`dpa5f`) asserted that the eaten stamp
EQUALS the twin stamp and that the prune row's `ack`/`resolvedThrough` equal that shared stamp. The
delivery trace refuted it — the predictor's stamps are domain-local and the equality holds only for
the GA-5a replay form. The expectation was REVISED to the measured watermark-pushed form above, with
the refuted assertion recorded in `dpa5f` and the revision reason inside the row message itself. The
GA-5b row has passed on the revised, measured statement in `dpa5g` and again in `dpa5h`.

## 3. Unreachability under the admissible invariant — stated with its scope

**Claim (scoped).** Under (a) the pinned accept rule (`accept(v) = v > _lastSeq`, evaluated before the
buffer) and (b) the admissible healthy-producer invariant — *same domain, stamp = sentCount + 1,
strictly increasing, and every accepted send raises `_lastSeq` contiguously* — a pre-buffer discard
is **unreachable**, terminal form included.

**Proof.** Inductively, under (b) after send *i*: `_lastSeq = stamp_i = sentCount_i`. The next stamp
is `sentCount_i + 1 = _lastSeq + 1 > _lastSeq`, so `accept()` returns true for every send. A decline
requires `stamp ≤ _lastSeq`, i.e. the watermark strictly ahead of the producer frontier — which under
(b) only arises if some send did NOT go through the producer's counter (the raw handle bypass), the
domain was re-stamped (excluded by "same domain"), or the implementation itself misbehaves (which is
exactly what a positive observability requirement like PE-1 is supposed to catch — see §5). ∎

**Anti-alias control (one, targeted, in the same cell):** the row
`GA-5b invariant control` measures the HEALTHY window before any fixture interference — consumed
stamps contiguous from 1 (zero declines), `resolvedThrough` tracking sends, no gap ever named, zero
recovery events. The dedupe **never fires** in the invariant-obeying population; the GA-5b alias was
reached ONLY through the fixture's deliberate raw re-stamp, and the consumed-slot jump is that
bypass's own fingerprint. An alias cannot be manufactured by an invariant-obeying producer; the
"alias" critique of GA-5b therefore attacks the fixture's bypass, not the protocol.

**Scope caveat.** The claim is about the PINNED implementation plus the invariant. It does not
generalise to future cores, other transports, or to implementations where the accept boundary is
observable — deliberately, because that is the point of contention: the same silence that makes the
dedupe correct also makes its violations unobservable.

## 4. Options for ADR-0003 (no production change in any of them)

**Option A — keep the letter; keep the blocked rows.** GA-5b's client sub-leg and GA-12's positive
PE-1 stay BLOCKED/Not-Run on the pinned stack until an upstream disposition hook exists.
*Cost:* Gate A carries permanently blocked rows on the current pin; re-derivation effort at every
SDK bump. *Risk:* reviewers read BLOCKED-with-proof as untested; conversely, the rows can never
close even if the substrate is provably safe. *Compensating controls already shipped:* the invariant
control, GA-5a's genuine equality-replay with named-gap recovery, GA-6a/6b/6c deadline recoveries,
GA-7T inside the exact §3.3 window with C1/C2 sever/no-withhold controls, the discrete-effect
(GA-10) ledger showing zero duplicate movement, and `serverAssertedNothing` (the server never invents
a cause or a range).

**Option B — refine the requirement to observable safety + causal correlation (recommended).**
Restate GA-5b's client sub-leg and GA-12's PE-1 for the supported substrate as the conjunction:
(a) **applied-at-most-once** (consumed unique, refusals zero, distinctive-content absence);
(b) **disposition causally correlated on the delivery** by ack + `resolvedThrough`, evidenced by the
same-delivery trace of §2 — safely, not by faith: the watermark only counts disposed stamps;
(c) **producer invariant + invariant control** (§3) making silent loss unreachable without a bypass;
(d) **unidentifiable loss recorded as unidentified** (no invented cause/range/closure).
PE-1's positive direction is then re-expressed as the DENIAL that a signature can exist on the
pinned core, with the positive proof deferred to PE-2…PE-5 and to any future observable-disposition
hook. *Cost:* an ADR text amendment (directors' call); GA-12's closure claim narrows. *Risk:* if a
future pinned core corrupts a stream silently at the pre-buffer boundary, (a)+(b)+(c) detect the
consequences and the invariant break, but not the corruption itself — accepted, disclosed, and
bounded by keeping dedupe CLOSURE (`dedupeClosureEnabled`) false, which the config hash already pins.

**Option C — upstream ask.** Request a public pre-buffer disposition counter/ledger from the SDK
maintainers (one integer per declined stamp is enough to satisfy PE-1 and GA-5b's letter).
*Cost:* upstream dependency and a pin bump; schedule not ours. *Risk:* none technical; if granted,
Option B collapses back to A's letter with real evidence. A request may be filed regardless of which
option is chosen now.

**Recommendation:** adopt **B** for Gate A purposes, file **C** in parallel, and keep every spike
artefact labelled DIAGNOSTIC. This proposal does not itself adopt anything.

## 5. What stays denied regardless of the option

- **PE-1 failing alone denies production dedupe CLOSURE.** Today PE-1 fails on the pinned core;
  `dedupeClosureEnabled` is false and hashed; the closure signal stays DIAGNOSTIC (W-6 unchanged).
  Option B re-expresses the PE statement but does not close dedupe — closure needs a positive
  signal that does not exist on any admissible pin, or a new policy decision by the directors.
- No production operator command exists or is proposed (`injectInputGap`/`replayInput` remain
  unapproved); all injections here are harness-side (proxy withhold/sever/flush) or raw-handle
  fixture bypasses explicitly labelled as BYPASS evidence.
- No threshold, target, window, or budget changed; INVALID stays INVALID; all attempts retained.

## 6. Evidence index

- `tests/e2e/netcode.spec.ts` rows `GA-5a`, `GA-5b`, `GA-5b invariant control`, `GA-6a/b/c`,
  `GA-7T`, C1/C2, `GA-12` (cell `ga-scenarios`, seed 1001; 16/16 in `dpa5g`, `dpa5h`).
- Refuted first-run record: `artifacts/.local/spike-001/dpa5f/spike-cell-ga-scenarios.json`
  (preserved; the revision is annotated inside the row message, per the predeclared-expectations rule).
- Pinned implementation: `node_modules/.pnpm/@colyseus+core@0.18.27…/build/input/{RoomInput,InputBuffer}.mjs`.
- GA-11 calibration batch (companion slice-6i deliverable): cell `ga11-calibration`,
  `spike-cell-ga11-calibration.json` in `dpa5d`/`dpa5h` — both inequalities EVALUATED on measured,
  source-labelled loopback populations; production-directed evaluation explicitly Not-Run with the
  missing representative conditions named.
- `docs/contracts/api-map.md` §14.8 (harness seams used by this proposal's evidence).
