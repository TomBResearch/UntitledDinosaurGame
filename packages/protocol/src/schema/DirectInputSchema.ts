/**
 * Fixed-step input schema declaration.
 *
 * This directory is the only schema declaration location (interfaces/protocol.md 4.4), and it is the
 * only place in the repository that may import a schema runtime. The declarations are written with
 * the pinned package's non-decorator builder API, validated against the installed declarations of
 * @colyseus/schema 5.0.45 and recorded in docs/contracts/protocol-v1.md: `defineTypes` exists but
 * announces itself deprecated, so the `schema()` plus `t.*` form is used and no decorator, private
 * field or invented option appears anywhere.
 *
 * Widths are Gate A candidates under ADR 0001. They are declared `float64` deliberately: the probe
 * in tests/unit/udg-002/schema-roundtrip.test.ts shows this pinned package carries float64 exactly,
 * and a quantized or float32 field would break the lossless-mapping requirement that the same ADR
 * adopts. Choosing a narrower wire width is a Gate A decision with an ADR and a fixture rerun.
 */

import { schema, t } from '@colyseus/schema';

/**
 * Flat input declaration for the fixed-step channel.
 *
 * The input codec accepts flat primitive fields only and throws at construction for a nested Schema,
 * which is why this declaration carries no route, position or identifier field. Every field has an
 * explicit default so a decoded-but-absent field cannot be mistaken for a validated value, and
 * because the input encoder delta-encodes: a field that was never assigned is simply not sent.
 *
 * Values arriving here come from an untrusted client. The codec coerces silently — an out-of-range
 * integer wraps and a fractional value truncates — so nothing may be trusted until it has passed
 * `validateDirectFrame`, and the domain validator, not the schema, is the boundary of trust.
 */
export const DirectInputSchema = schema(
  {
    sessionEpoch: t.uint32().default(0),
    generation: t.uint32().default(0),
    directIntent: t.boolean().default(false),
    moveX: t.float64().default(0),
    moveZ: t.float64().default(0),
    /**
     * The per-frame client send sequence (ADR-0003 §4; W-2). Declared as the room's input
     * `seqField`, it is the identity the authoritative disposition record resolves against and the
     * value `defineInput({ seqField })` orders and dedupes by. `0` is the *unstamped* default: a
     * frame arriving without a stamp in `[INPUT_SEQ_MIN, INPUT_SEQ_MAX]` is refused by
     * `validateDirectWireFrame` before anything consumes it.
     */
    seq: t.uint32().default(0),
  },
  'DirectInputSchema',
);

export type DirectInputSchema = InstanceType<typeof DirectInputSchema>;

/** Field order as declared, used by the completeness test. */
export const DIRECT_INPUT_FIELDS = ['sessionEpoch', 'generation', 'directIntent', 'moveX', 'moveZ', 'seq'] as const;
