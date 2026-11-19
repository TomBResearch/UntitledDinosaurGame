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
  /** Samples retained per peer. */
  sampleLimit(limit: number): void;
}

const DEFAULT_SAMPLE_LIMIT = 256;

interface MutableTrack {
  readonly sessionId: string;
  readonly epochs: number[];
  readonly samples: PeerSample[];
  /** The latest epoch observed for this peer; it follows the authority's rows, never a client guess. */
  epoch: number;
  tickRegressions: number;
  duplicateSamples: number;
  epochChanges: number;
  absences: number;
  identityMismatches: number;
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
 */
export const createRemotePresentation = (limit: number = DEFAULT_SAMPLE_LIMIT): RemotePresentation => {
  const tracks = new Map<string, MutableTrack>();
  const anomalies: string[] = [];
  let observations = 0;
  let sampleLimit = limit;

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
    while (track.samples.length > sampleLimit) track.samples.shift();
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
            epoch: peer.sessionEpoch,
            tickRegressions: 0,
            duplicateSamples: 0,
            epochChanges: 0,
            absences: 0,
            identityMismatches: 0,
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
      if (!Number.isInteger(next) || next < 1) throw new Error('sampleLimit must be a positive integer');
      sampleLimit = next;
    },
  };
};
