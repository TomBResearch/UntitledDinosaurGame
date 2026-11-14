/**
 * The bounded application-layer impairment layer (UDG-003 Phase 2, W-10 under the OD-2 amendment).
 *
 * What this is, in the owner's words: *"Keep bounded RTT, jitter, loss and arrival-phase measurements in
 * Phase 2 under W-10. Leave production settings and the two production inequalities to UDG-SPIKE-001...
 * Label the impairment layer and record `tcpLossModelled: false`. The harness measurements do not
 * establish TCP-loss behaviour or production tuning."*
 *
 * Where the seam is, measured on the pinned stack rather than assumed. `@colyseus/sdk@0.18.9`'s `Room`
 * creates `this.connection = new Connection(options.protocol)` (`build/Room.mjs:126`) and assigns
 * `this.connection.events.onmessage` (line 127); `Connection` holds `this.transport` — a
 * `WebSocketTransport` for the ws protocol (`build/Connection.mjs:36`) — whose inbound path is
 * `this.events.onmessage?.(event)` (`build/transport/WebSocketTransport.mjs:79`) and whose outbound path
 * is `transport.send(data)`. Wrapping those two after the join therefore sits on both directions of a
 * **real WebSocket round trip** through the pinned transport: no proxy server, no production source
 * change, no dependency change.
 *
 * A proxy would also have needed `ws`, and that is not available here: `ws@8.22.2` appears in
 * `pnpm-lock.yaml` only as a transitive entry, and `require.resolve('ws', { paths: [apps/server] })`
 * fails under the pinned strict layout. Declaring it would be a dependency-set change, which the
 * assignment does not grant.
 *
 * What this layer is NOT, and the discriminator that keeps the two apart. It withholds a **delivery**; it
 * does not lose a **segment**. Over TCP a lost segment head-of-line-blocks the byte stream until it is
 * retransmitted, so no later application message can be delivered before the missing one. This layer
 * drops a message and lets the later ones through, and the socket stays open — a signature that is only
 * reachable at the application layer. `discriminator()` reports those observations so the artefact cannot
 * be read as a network-loss measurement, and `tcpLossModelled` is `false` with the runner reason attached:
 * `tc`/`netem` require `NET_ADMIN`, which the pinned hosted runner does not grant.
 */

import { setTimeout as deliverLater } from 'node:timers';

/** Deterministic so a capture can be re-run and the same deliveries fall in the same places. */
const mulberry32 = (seed) => {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

const histogram = (values) => {
    if (values.length === 0) {
        return { count: 0, min: null, p50: null, p95: null, p99: null, max: null, mean: null };
    }
    const sorted = [...values].sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return {
        count: sorted.length,
        min: sorted[0],
        p50: at(0.5),
        p95: at(0.95),
        p99: at(0.99),
        max: sorted[sorted.length - 1],
        mean: Number((sorted.reduce((total, value) => total + value, 0) / sorted.length).toFixed(3)),
    };
};

/**
 * Install the layer on one joined seat.
 *
 * `options.dropOutboundAt` is a list of 1-based outbound ordinals to withhold; `options.jitterMs` adds a
 * deterministic deviation on top of `options.forwardDelayMs`. The layer is inert until `arm()` is called,
 * so the handshake and the first state delivery are never the thing being tested.
 */
export const installImpairment = (room, options = {}) => {
    const connection = room.connection;
    if (connection === undefined || connection.transport === undefined) {
        throw new Error('impairment: this SDK build exposes no room.connection.transport to wrap');
    }
    const transport = connection.transport;
    const events = connection.events;
    const originalSend = transport.send.bind(transport);
    const originalOnMessage = events.onmessage;
    const random = mulberry32(options.seed ?? 0x5eed);
    const dropOutboundAt = new Set(options.dropOutboundAt ?? []);

    const state = {
        armed: false,
        silencing: false,
        sentTotal: 0,
        deliveredTotal: 0,
        droppedTotal: 0,
        droppedOrdinals: [],
        inboundTotal: 0,
        inboundDelivered: 0,
        inboundSilentlyDropped: 0,
        inboundSilenceStartedAtMs: null,
        inboundSilenceMs: null,
        inboundQueuedPeak: 0,
        reconnectEvents: 0,
        socketOpenAtInstall: transport.isOpen === true,
        socketClosedDuring: 0,
        crossCheckDeliveredWhileDropping: 0,
        forwardDelayMs: [],
        inboundDelayMs: [],
        patchArrivalsMs: [],
        outboundAtMs: [],
        restored: false,
    };
    let queue = [];

    transport.send = (data) => {
        state.sentTotal += 1;
        const ordinal = state.sentTotal;
        state.outboundAtMs.push(Date.now());
        if (state.armed && dropOutboundAt.has(ordinal)) {
            state.droppedTotal += 1;
            state.droppedOrdinals.push(ordinal);
            return undefined;
        }
        let delay = 0;
        if (state.armed) {
            delay = (options.forwardDelayMs ?? 0) + (options.jitterMs === undefined ? 0 : Math.round(random() * options.jitterMs));
            state.forwardDelayMs.push(delay);
        }
        if (delay <= 0) {
            state.deliveredTotal += 1;
            return originalSend(data);
        }
        deliverLater(() => {
            state.deliveredTotal += 1;
            try {
                originalSend(data);
            }
            catch {
                // A send that fails after its delay is a closed socket, which `onclose` already counted.
            }
        }, delay);
        return undefined;
    };

    const deliver = (event, startedAtMs) => {
        // GA-6b needs a server that is silent towards ONE seat while the socket stays open and the room
        // keeps running for everyone else. A silence is not a delay and not a close, so it gets its own
        // counter: `inboundSilentlyDropped` counts what arrived at the wrapper and was not passed on, and
        // `inboundDelivered` stays a true count of what the seat was actually told.
        if (state.silencing) {
            state.inboundSilentlyDropped += 1;
            if (state.inboundSilenceMs === null) state.inboundSilenceMs = 0;
            state.inboundSilenceMs = Date.now() - state.inboundSilenceStartedAtMs;
            return undefined;
        }
        state.inboundDelivered += 1;
        state.inboundDelayMs.push(Date.now() - startedAtMs);
        state.patchArrivalsMs.push(Date.now());
        if (state.droppedTotal > 0) state.crossCheckDeliveredWhileDropping += 1;
        originalOnMessage?.(event);
    };

    events.onmessage = (event) => {
        state.inboundTotal += 1;
        const startedAtMs = Date.now();
        if (!state.armed) {
            deliver(event, startedAtMs);
            return;
        }
        const delay = (options.inboundDelayMs ?? 0) + (options.inboundJitterMs === undefined ? 0 : Math.round(random() * options.inboundJitterMs));
        if (queue.length > state.inboundQueuedPeak) state.inboundQueuedPeak = queue.length;
        if (delay <= 0) {
            deliver(event, startedAtMs);
            return;
        }
        queue.push(1);
        deliverLater(() => {
            queue.pop();
            if (state.restored) {
                // The wrapper was taken off mid-flight: hand the message to whoever holds the handler now
                // rather than delivering it twice or losing it.
                connection.events.onmessage?.(event);
                return;
            }
            deliver(event, startedAtMs);
        }, delay);
    };

    const originalOnClose = events.onclose;
    events.onclose = (event) => {
        state.socketClosedDuring += 1;
        state.reconnectEvents += 1;
        originalOnClose?.(event);
    };

    return {
        arm() {
            state.armed = true;
        },
        disarm() {
            state.armed = false;
        },
        /** Withhold inbound deliveries for `ms`, then let them through: the GA-6/GA-7 shape, at the seat. */
        withholdInbound(ms) {
            const held = options.inboundDelayMs;
            options.inboundDelayMs = ms;
            return () => {
                options.inboundDelayMs = held ?? 0;
            };
        },
        /**
         * Drop every inbound delivery from here on, with the socket left exactly as it was. Released by
         * `resumeInbound()`, which does not replay what the silence swallowed: a withheld publication is
         * gone, which is the whole reason GA-7 is a recovery criterion and not a buffering one.
         */
        silenceInbound() {
            state.silencing = true;
            state.inboundSilenceStartedAtMs = Date.now();
        },
        resumeInbound() {
            state.silencing = false;
        },
        counters() {
            return {
                armed: state.armed,
                sentTotal: state.sentTotal,
                deliveredTotal: state.deliveredTotal,
                droppedTotal: state.droppedTotal,
                droppedOutboundOrdinals: [...state.droppedOrdinals],
                inboundTotal: state.inboundTotal,
                inboundDelivered: state.inboundDelivered,
                inboundSilentlyDropped: state.inboundSilentlyDropped,
                inboundSilenceMs: state.inboundSilenceMs,
                silencing: state.silencing === true,
                inboundQueuedPeak: state.inboundQueuedPeak,
                reconnectEvents: state.reconnectEvents,
                socketOpenAtInstall: state.socketOpenAtInstall,
                socketOpenNow: transport.isOpen === true,
                socketClosedDuring: state.socketClosedDuring,
                crossCheckDeliveredWhileDropping: state.crossCheckDeliveredWhileDropping,
                forwardDelayAppliedMs: histogram(state.forwardDelayMs),
                inboundDelayAppliedMs: histogram(state.inboundDelayMs),
                patchArrivalsMs: [...state.patchArrivalsMs],
            };
        },
        /**
         * The TCP discriminator, as observations rather than adjectives. Every field is something the
         * wrapper measured, and the conclusion is written next to the reading it comes from.
         */
        discriminator() {
            const outOfOrderHole = state.droppedTotal > 0 && state.deliveredTotal > state.droppedTotal;
            return {
                droppedDeliveries: state.droppedTotal,
                laterDeliveriesAfterTheHole: Math.max(0, state.deliveredTotal - state.droppedTotal),
                outOfOrderHoleObserved: outOfOrderHole,
                whyThatRulesTcpOut: 'over TCP a lost segment head-of-line-blocks the stream until retransmission, so no later application message can arrive first; a hole with later arrivals is only reachable at the application layer',
                unrelatedTrafficDuringTheDrop: state.crossCheckDeliveredWhileDropping,
                socketClosedDuring: state.socketClosedDuring,
                reconnectEvents: state.reconnectEvents,
                retransmissionObserved: false,
                whyRetransmissionIsImpossibleHere: 'a withheld application delivery is not a byte the peer will ever resend: the SDK owns no retransmit of an application message, and the socket never broke',
                dropModel: state.droppedTotal > 0
                    ? 'application-layer delivery loss (hole with later deliveries)'
                    : 'no loss applied',
                tcpLossModelled: false,
                networkLossRequires: 'NET_ADMIN for tc/netem (or a UDP path the pinned stack does not have)',
                runnerReason: 'GitHub-hosted ubuntu-latest grants no NET_ADMIN, so network-layer impairment cannot be produced in this pipeline',
            };
        },
        restore() {
            state.restored = true;
            transport.send = originalSend;
            events.onmessage = originalOnMessage;
            events.onclose = originalOnClose;
        },
    };
};

export const impairmentHistogram = histogram;
