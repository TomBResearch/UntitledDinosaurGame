/**
 * UDG-SPIKE-001 slice 22 — SAME-FRAME observer render assessment (harness measurement rule).
 *
 * The hosted first attempt (lan-1002, run 44771876137) proved the OLD rule unsound as written:
 * a mover-page tick read followed by an observer-page tick read compares two MONOTONIC COUNTERS
 * sampled at different instants on different pages — a fast profile legitimately produced
 * observerRenderedTick 2966 against moverSelfTick 2964 (lagTicks −2), which is not an observer
 * rendering ahead of its authority; it is the point-sample protocol racing counters. The rule
 * here replaces that construction: every frame record is captured AT ONE OBSERVER FRAME
 * BOUNDARY, and the rendered pose is compared ONLY against the SAME page's latest VALIDATED
 * authority sample at that same boundary — never against another page's counter.
 *
 * Assessment (pure, deterministic; the unit tests pin the semantics):
 *  - NO EXTRAPOLATION: every frame's render target tick is ≤ the observer's own latest
 *    validated authority tick, and the blend alpha lies in [0, 1]. An observer that renders
 *    AHEAD of validated authority FAILS here — an intentionally-ahead series must be declined.
 *  - INTERPOLATION DELAY: `authorityTick − toTick` (≥ 0 whenever no frame is ahead) is the
 *    observed render delay in ticks; magnitude and distribution are RECORDED, never gated.
 *  - DISCONTINUITY: a render target tick that REGRESSES between consecutive frames inside one
 *    epoch is a discontinuity, reported SEPARATELY from delay (a delayed frame is fine; a
 *    backwards jump names itself).
 *  - IDENTITY/EPOCH: frames carry the peer sessionId and the epoch stamped on the peer track;
 *    a series mixing identities is refused outright.
 */

/** One render frame, read synchronously at a single observer frame boundary. */
export interface ObserverRenderFrame {
  readonly atMs: number;
  readonly sessionId: string;
  readonly epoch: number;
  /** The observer's LATEST VALIDATED authority sample tick for this peer at this boundary. */
  readonly authorityTick: number;
  /** The pose this frame renders: blend from fromTick toward toTick at alpha. */
  readonly fromTick: number;
  readonly toTick: number;
  readonly alpha: number;
  /** True when the render target is at/past the newest sample: the pose holds, never predicts. */
  readonly holding: boolean;
  readonly howOldMs: number;
}

export interface ObserverRenderAssessment {
  readonly frames: number;
  readonly identity: string;
  readonly epochs: readonly number[];
  /** Frames rendering AHEAD of validated authority (or alpha outside [0,1]) — must be 0. */
  readonly aheadFrames: number;
  /** The rule's own gate: no frame is ahead and alpha is everywhere in [0, 1]. */
  readonly noExtrapolation: boolean;
  /** min(authorityTick − toTick) over all frames; null with no frames. Expected ≥ 0. */
  readonly minLagTicks: number | null;
  readonly maxLagTicks: number | null;
  readonly meanLagTicks: number | null;
  /** Render-target tick regressions between consecutive same-epoch frames — reported apart. */
  readonly discontinuities: number;
  readonly holdingFrames: number;
  readonly maxHowOldMs: number | null;
}

/**
 * Assess a same-frame render series. Returns the assessment; the CALLER decides gating, but
 * `identityConsistent === false` series must be refused (throws here — a mixed-identity series
 * is a measurement defect, not a result).
 */
export function assessObserverRenderSeries(frames: readonly ObserverRenderFrame[]): ObserverRenderAssessment {
  if (frames.length === 0) {
    return {
      frames: 0, identity: '', epochs: [],
      aheadFrames: 0, noExtrapolation: false,
      minLagTicks: null, maxLagTicks: null, meanLagTicks: null,
      discontinuities: 0, holdingFrames: 0, maxHowOldMs: null,
    };
  }
  const identity = frames[0]!.sessionId;
  if (identity.length === 0 || frames.some((f) => f.sessionId !== identity)) {
    throw new Error('render series mixes peer identities — refused, never averaged');
  }
  const epochs = [...new Set(frames.map((f) => f.epoch))];
  let aheadFrames = 0;
  let discontinuities = 0;
  let holdingFrames = 0;
  let lagSum = 0;
  let minLag: number | null = null;
  let maxLag: number | null = null;
  let maxHowOld: number | null = null;
  for (let i = 0; i < frames.length; i += 1) {
    const f = frames[i]!;
    if (f.toTick > f.authorityTick || !(f.alpha >= 0 && f.alpha <= 1)) aheadFrames += 1;
    const lag = f.authorityTick - f.toTick;
    lagSum += lag;
    minLag = minLag === null ? lag : Math.min(minLag, lag);
    maxLag = maxLag === null ? lag : Math.max(maxLag, lag);
    maxHowOld = maxHowOld === null ? f.howOldMs : Math.max(maxHowOld, f.howOldMs);
    if (f.holding) holdingFrames += 1;
    if (i > 0) {
      const p = frames[i - 1]!;
      if (p.epoch === f.epoch && f.atMs > p.atMs && f.toTick < p.toTick) discontinuities += 1;
    }
  }
  return {
    frames: frames.length,
    identity,
    epochs,
    aheadFrames,
    noExtrapolation: aheadFrames === 0,
    minLagTicks: minLag,
    maxLagTicks: maxLag,
    meanLagTicks: Number((lagSum / frames.length).toFixed(3)),
    discontinuities,
    holdingFrames,
    maxHowOldMs: maxHowOld,
  };
}
