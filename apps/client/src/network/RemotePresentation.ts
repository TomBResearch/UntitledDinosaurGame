/**
 * Remote presentation — reading **other** seats' authoritative rows, and nothing else.
 *
 * ## The claim this module is allowed to make
 *
 * UDG-SPIKE-001 has to show that a seat observes *another* seat's movement, not merely its own. This module is
 * the observation half of that proof: it is fed the snapshots the adapter reads off the authority's deliveries
 * and it derives, per peer, the timeline the server actually published — epochs, authority ticks, positions.
 * It holds no client, no room, no input handle and no SDK import of any kind, which is the structural reason
 * it cannot author a movement: remote presentation follows the accepted timeline and never writes one
 * (`docs/interfaces/movement-authority.md` §5.1, and the contract's "observer interpolation follows the
 * accepted timeline without authoring it").
 *
 * ## What it refuses to do
 *
 * - **No prediction, no extrapolation.** A peer position this module has not been given does not exist for it;
 *   it never advances a peer between deliveries. Smoothing is a later slice's rendering decision and will read
 *   these tracks, not replace them.
 * - **No silent repair.** A tick that goes backwards, an epoch that changes mid-observation, a row that
 *   disappears and comes back: each becomes a named issue and a counter on the track, because the spike's
 *   evidence is about what the authority published, including when that is unpleasant.
 * - **No tokens.** It receives checked `SeatObservation` values, so a reconnection token could not pass through
 *   this module even if the adapter read one (it does not).
 */

import type { RegionSnapshot, SeatObservation } from './ColyseusPredictionAdapter.js';

/** A peer's published position at one observed authority tick. */
export interface PeerSample {
  readonly tick: number;
  readonly x: number;
  readonly z: number;
  readonly movementMode: number;
}

/** One observed peer, as a timeline. `samples` is bounded: the spike needs the run's story, not a log. */
export interface PeerTrack {
  readonly sessionId: string;
  /** Every distinct epoch seen for this peer, in first-seen order. A stable seat has exactly one. */
  readonly epochs: readonly number[];
  /** The latest epoch observed, which is what a frame must be stamped with to be this peer's epoch. */
  readonly epoch: number;
  readonly firstSample: PeerSample;
  readonly lastSample: PeerSample;
  readonly samples: readonly PeerSample[];
  /** `lastSample − firstSample` on each horizontal axis. */
  readonly delta: { readonly x: number; readonly z: number };
  /** Distinct authority ticks observed, so "it moved" is a tick statement before it is a position one. */
  readonly distinctTicks: number;
  readonly tickRegressions: number;
  readonly duplicateSamples: number;
  readonly epochChanges: number;
  /** Deliveries in which a previously-seen peer's row was absent. */
  readonly absences: number;
  /** Rows whose entityId disagreed with the map key. Named, not merged. */
  readonly identityMismatches: number;
}

export interface RemotePresentation {
  /** Fold one authoritative snapshot in. Idempotent per tick: a repeat delivery of the same tick is counted,
   * never averaged. */
  observe(snapshot: RegionSnapshot): void;
  /** Session ids currently or previously observed, in first-seen order. */
  peers(): readonly string[];
  trackOf(sessionId: string): PeerTrack | undefined;
  /** Every anomaly observed so far, each naming the peer and the field. */
  issues(): readonly string[];
  /** Snapshots folded in. */
  observations(): number;
  /** Samples retained per peer. Same validation rule as the `createRemotePresentation` argument. */
  sampleLimit(limit: number): void;
  /**
   * The read-only interpolated render pose of one peer at `nowMs`, rendered `delayMs` behind the
   * published timeline. Between the last two ARRIVED samples the pose is the linear blend of them;
   * BEFORE the first it is the first; AFTER the latest it HOLDS the latest — this module never
   * extrapolates, so a stalled peer freezes rather than drifts. The pose is a fresh object: no
   * received schema and no track is mutated, and nothing here can reach the authority — the same
   * structural guarantee as the rest of this file (no SDK, no handle, no write path).
   */
  renderPose(sessionId: string, nowMs: number, delayMs: number): PeerRenderPose | undefined;
  /** Per-peer render telemetry: renders served, the largest pose jump between consecutive renders
   * (the discontinuity metric, reported separately from delay), and the longest hold. */
  renderStats(sessionId: string): PeerRenderStats | undefined;
}

const DEFAULT_SAMPLE_LIMIT = 256;

/** One interpolated render read. Fresh object; nothing received is aliased or mutated. */
export interface PeerRenderPose {
  readonly sessionId: string;
  readonly x: number;
  readonly z: number;
  /** The two published samples the pose was taken from (the same tick pair when holding). */
  readonly fromTick: number;
  readonly toTick: number;
  /** Blend weight toward `toTick`, always in [0, 1] — never > 1, because that would be extrapolation. */
  readonly alpha: number;
  /** True when the render target is at or past the newest sample: the pose holds, it does not predict. */
  readonly holding: boolean;
  /** Age of the newest published sample at render time — the visible lag of the followed timeline. */
  readonly howOldMs: number;
}

/** Render telemetry per peer, reported separately from the pose itself. */
export interface PeerRenderStats {
  readonly renders: number;
  /** Largest distance between two consecutive render poses (the discontinuity metric). */
  readonly maxRenderJump: number;
  /** Longest stretch spent holding the newest sample instead of blending between two. */
  readonly maxHoldMs: number;
  /** How many renders held (a stalled publisher is visible as a rising count, never as drift). */
  readonly holds: number;
}

/**
 * The one limit rule, shared by the constructor argument and the setter: a positive integer.
 *
 * The trim loop in `fold` (`while samples.length > limit, shift`) only terminates for `limit ≥ 1`, and a
 * track with no retained samples has no `firstSample`/`lastSample` to read — so a zero or negative limit is
 * refused here, at the boundary, exactly like the setter already refused it. Without this, a bad value at
 * construction was a hang (negative) or a throwing `trackOf` (zero), not a named error.
 */
const checkedSampleLimit = (candidate: number): number => {
  if (!Number.isInteger(candidate) || candidate < 1) throw new Error('sampleLimit must be a positive integer');
  return candidate;
};

interface MutableTrack {
  readonly sessionId: string;
  readonly epochs: number[];
  readonly samples: PeerSample[];
  /** Arrival instant (from the presentation's clock) paired with each retained sample, in lockstep. */
  readonly arrivals: number[];
  /** The latest epoch observed for this peer; it follows the authority's rows, never a client guess. */
  epoch: number;
  tickRegressions: number;
  duplicateSamples: number;
  epochChanges: number;
  absences: number;
  identityMismatches: number;
  renders: number;
  maxRenderJump: number;
  maxHoldMs: number;
  holds: number;
  lastRender: { readonly x: number; readonly z: number } | null;
}

const toTrack = (track: MutableTrack): PeerTrack => {
  const first = track.samples[0];
  const last = track.samples[track.samples.length - 1];
  if (first === undefined || last === undefined) {
    // `observe` only creates a track when it has a sample, so this is a bug in this file, not a runtime case.
    throw new Error(`track ${track.sessionId} has no samples`);
  }
  return {
    sessionId: track.sessionId,
    epochs: [...track.epochs],
    epoch: track.epoch,
    firstSample: first,
    lastSample: last,
    samples: [...track.samples],
    delta: { x: last.x - first.x, z: last.z - first.z },
    distinctTicks: new Set(track.samples.map((sample) => sample.tick)).size,
    tickRegressions: track.tickRegressions,
    duplicateSamples: track.duplicateSamples,
    epochChanges: track.epochChanges,
    absences: track.absences,
    identityMismatches: track.identityMismatches,
  };
};

/**
 * A read-only observer over the peers in a room.
 *
 * The instance keeps no state that could be mistaken for authority: every value on a `PeerTrack` is a value
 * the server published, in the order the deliveries arrived.
 *
 * `limit` is validated with the same rule the `sampleLimit` setter enforces: a positive integer, or the
 * constructor throws before any track exists.
 *
 * `clock` stamps sample arrivals for the render-delay path; it defaults to `performance.now` and is
 * injectable so the interpolation is unit-testable without wall-clock races.
 */
export const createRemotePresentation = (limit: number = DEFAULT_SAMPLE_LIMIT, clock: () => number = () => performance.now()): RemotePresentation => {
  const tracks = new Map<string, MutableTrack>();
  const anomalies: string[] = [];
  let observations = 0;
  let sampleLimit = checkedSampleLimit(limit);

  const note = (detail: string): void => {
    anomalies.push(detail);
  };

  const fold = (track: MutableTrack, peer: SeatObservation): void => {
    if (peer.key !== peer.entityId) {
      track.identityMismatches += 1;
      note(`peer ${peer.key}: replica key and entityId disagree (${peer.key} / ${peer.entityId})`);
    }
    if (!track.epochs.includes(peer.sessionEpoch)) {
      track.epochs.push(peer.sessionEpoch);
      if (track.epochs.length > 1) {
        track.epochChanges += 1;
        note(`peer ${peer.key}: epoch changed to ${String(peer.sessionEpoch)} (now ${track.epochs.join(', ')})`);
      }
    }
    const previous = track.samples[track.samples.length - 1];
    if (previous !== undefined) {
      if (peer.lastAuthorityTick < previous.tick) {
        track.tickRegressions += 1;
        note(`peer ${peer.key}: authority tick went backwards ${String(previous.tick)} -> ${String(peer.lastAuthorityTick)}`);
      } else if (peer.lastAuthorityTick === previous.tick) {
        track.duplicateSamples += 1;
      }
    }
    track.samples.push({ tick: peer.lastAuthorityTick, x: peer.x, z: peer.z, movementMode: peer.movementMode });
    track.arrivals.push(clock());
    while (track.samples.length > sampleLimit) {
      track.samples.shift();
      track.arrivals.shift();
    }
  };

  return {
    observe: (snapshot) => {
      observations += 1;
      const seenNow = new Set<string>();
      for (const peer of snapshot.peers) {
        seenNow.add(peer.key);
        const existing = tracks.get(peer.key);
        if (existing === undefined) {
          const created: MutableTrack = {
            sessionId: peer.key,
            epochs: [peer.sessionEpoch],
            samples: [],
            arrivals: [],
            epoch: peer.sessionEpoch,
            tickRegressions: 0,
            duplicateSamples: 0,
            epochChanges: 0,
            absences: 0,
            identityMismatches: 0,
            renders: 0,
            maxRenderJump: 0,
            maxHoldMs: 0,
            holds: 0,
            lastRender: null,
          };
          tracks.set(peer.key, created);
          fold(created, peer);
          continue;
        }
        // The epoch a peer holds is the server's; the track's `epoch` follows the latest observation.
        fold(existing, peer);
        existing.epoch = peer.sessionEpoch;
      }
      for (const [key, track] of tracks) {
        if (!seenNow.has(key) && track.absences < 1) {
          track.absences += 1;
          note(`peer ${key}: row absent from a delivery that carried other rows`);
        }
      }
    },
    peers: () => [...tracks.keys()],
    trackOf: (sessionId) => {
      const track = tracks.get(sessionId);
      return track === undefined ? undefined : toTrack(track);
    },
    issues: () => [...anomalies],
    observations: () => observations,
    sampleLimit: (next) => {
      sampleLimit = checkedSampleLimit(next);
    },
    renderPose: (sessionId, nowMs, delayMs) => {
      const track = tracks.get(sessionId);
      if (track === undefined) return undefined;
      const count = track.samples.length;
      if (count === 0) return undefined;
      const newest = track.samples[count - 1];
      if (newest === undefined) return undefined;
      // The pair is the last two DISTINCT-TICK samples, measured from the moment each pose FIRST
      // arrived: fold echoes of the same tick are re-observations, not new published poses, and
      // blending between an echo and its original would invent motion between identical points.
      let indexB = count - 1;
      while (indexB > 0 && (track.samples[indexB - 1]?.tick ?? -1) === newest.tick) indexB -= 1;
      const newestAt = track.arrivals[indexB];
      let indexA = indexB - 1;
      while (indexA > 0 && (track.samples[indexA - 1]?.tick ?? -1) === (track.samples[indexA]?.tick ?? -2)) indexA -= 1;
      if (newestAt === undefined) return undefined;
      const target = nowMs - delayMs;
      let pose = { x: newest.x, z: newest.z };
      let fromTick = newest.tick;
      let toTick = newest.tick;
      let alpha = 1;
      let holding = true;
      const previous = indexA >= 0 ? track.samples[indexA] : undefined;
      const previousAt = indexA >= 0 ? track.arrivals[indexA] : undefined;
      if (previous !== undefined && previousAt !== undefined && target < newestAt) {
        const span = newestAt - previousAt;
        alpha = span <= 0 ? 1 : Math.min(1, Math.max(0, (target - previousAt) / span));
        pose = {
          x: previous.x + (newest.x - previous.x) * alpha,
          z: previous.z + (newest.z - previous.z) * alpha,
        };
        fromTick = previous.tick;
        toTick = newest.tick;
        holding = false;
      }
      const result: PeerRenderPose = {
        sessionId,
        x: pose.x,
        z: pose.z,
        fromTick,
        toTick,
        alpha: holding ? 1 : alpha,
        holding,
        howOldMs: Math.max(0, nowMs - newestAt),
      };
      // Telemetry only; the pose object itself is never stored by reference anywhere.
      track.renders += 1;
      if (track.lastRender !== null) {
        const jump = Math.hypot(pose.x - track.lastRender.x, pose.z - track.lastRender.z);
        if (jump > track.maxRenderJump) track.maxRenderJump = jump;
      }
      if (holding) {
        track.holds += 1;
        const held = Math.max(0, nowMs - newestAt);
        if (held > track.maxHoldMs) track.maxHoldMs = held;
      }
      track.lastRender = pose;
      return result;
    },
    renderStats: (sessionId) => {
      const track = tracks.get(sessionId);
      if (track === undefined) return undefined;
      return { renders: track.renders, maxRenderJump: track.maxRenderJump, maxHoldMs: track.maxHoldMs, holds: track.holds };
    },
  };
};
