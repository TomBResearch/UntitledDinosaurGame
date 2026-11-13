export interface PinnedStack {
    core: Record<string, unknown>;
    sdk: Record<string, unknown>;
}
/** One joined seat, structurally: only the members the impairment layer touches. Named apart from the
 * harness's own `SdkRoom` so a runner can import both without one shadowing the other. */
export interface ImpairmentTarget<TState = unknown> {
    sessionId: string;
    roomId: string;
    state: TState;
    connection?: {
        transport?: {
            send(data: unknown): unknown;
            sendUnreliable?(data: unknown): unknown;
            isOpen?: boolean;
        };
        events?: Record<string, ((event?: unknown) => void) | undefined>;
    };
    onStateChange(callback: (state: TState) => void): void;
    leave(consented?: boolean): Promise<unknown>;
}
/** The delay-applied / arrival histograms the layer reports. */
export interface Histogram {
    count: number;
    min: number | null;
    p50: number | null;
    p95: number | null;
    p99: number | null;
    max: number | null;
    mean: number | null;
}
export interface ImpairmentCounters {
    armed: boolean;
    sentTotal: number;
    deliveredTotal: number;
    droppedTotal: number;
    droppedOutboundOrdinals: number[];
    inboundTotal: number;
    inboundDelivered: number;
    inboundQueuedPeak: number;
    reconnectEvents: number;
    socketOpenAtInstall: boolean;
    socketOpenNow: boolean;
    socketClosedDuring: number;
    crossCheckDeliveredWhileDropping: number;
    forwardDelayAppliedMs: Histogram;
    inboundDelayAppliedMs: Histogram;
    patchArrivalsMs: number[];
}
export interface ImpairmentDiscriminator {
    droppedDeliveries: number;
    laterDeliveriesAfterTheHole: number;
    outOfOrderHoleObserved: boolean;
    whyThatRulesTcpOut: string;
    unrelatedTrafficDuringTheDrop: number;
    socketClosedDuring: number;
    reconnectEvents: number;
    retransmissionObserved: boolean;
    whyRetransmissionIsImpossibleHere: string;
    dropModel: string;
    tcpLossModelled: boolean;
    networkLossRequires: string;
    runnerReason: string;
}
export interface ImpairmentController {
    arm(): void;
    disarm(): void;
    /** Withhold inbound deliveries for `ms`; returns the function that releases them. */
    withholdInbound(ms: number): () => void;
    counters(): ImpairmentCounters;
    discriminator(): ImpairmentDiscriminator;
    restore(): void;
}
export interface ImpairmentOptions {
    /** 1-based outbound ordinals to withhold. */
    dropOutboundAt?: readonly number[];
    forwardDelayMs?: number;
    jitterMs?: number;
    inboundDelayMs?: number;
    inboundJitterMs?: number;
    seed?: number;
}
export declare function installImpairment<TState>(
    room: ImpairmentTarget<TState>,
    options?: ImpairmentOptions,
): ImpairmentController;
export declare function impairmentHistogram(values: readonly number[]): Histogram;
