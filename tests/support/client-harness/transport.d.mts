/**
 * The test-only real-transport harness (UDG-003 Phase 2, §4.1 `tests/support/client-harness/**`).
 *
 * Two problems, both solved once here:
 *
 * 1. **Module resolution.** The pinned `@colyseus/core`/`@colyseus/sdk` are declared by
 *    `apps/server`, not by the repository root, and Node resolves bare specifiers from the
 *    *importing file*. A probe or integration test under `tests/**` therefore reaches the packages
 *    the same way the probe runner reaches the compiler: `createRequire` anchored at a file inside
 *    `apps/server`, then a dynamic import of the resolved file URL. Nothing here re-pins or
 *    version-detects anything — it loads exactly the workspace-installed packages.
 * 2. **The D-P2-1 boundary.** This harness is the *test-only* client. `apps/client` must never
 *    import it (there is a contract assertion for exactly that), and it carries no production
 *    behaviour: what lives here is connection plumbing plus the ADR-0003 §3.2 reconciliation state
 *    machine **as a reference implementation under test**, not a shipped client.
 *
 * Types are structural on purpose: naming the SDK classes by hand keeps this module importable
 * from contexts where the SDK declarations are not in the project (the probe entry runs on Node's
 * own type stripping), and a drift between the hand-written surface and the real packages shows up
 * as a runtime failure in the first scenario that touches the drifted member — which, for probes,
 * is the point.
 */
/** The pieces of the pinned stack this harness loads dynamically. */
export interface PinnedStack {
    core: CoreSurface;
    sdk: SdkSurface;
}
/** Minimal structural view of `@colyseus/core` — the members the harness actually calls. */
export interface CoreSurface {
    defineServer(options: {
        rooms: Record<string, RegisteredHandler>;
        transport: unknown;
    }): {
        serverless(): Promise<void>;
        gracefullyShutdown(closeConnections?: boolean): Promise<unknown>;
    };
    defineRoom(roomKlass: unknown, defaultOptions?: unknown): RegisteredHandler;
    WebSocketTransportCtor: new (options: {
        server: unknown;
    }) => unknown;
}
/** The registration token `defineRoom`/`defineServer` pass around opaquely. */
export type RegisteredHandler = {
    readonly __udgRegisteredHandler?: true;
} & Record<string, unknown>;
/** Minimal structural view of `@colyseus/sdk`. */
export interface SdkSurface {
    ClientCtor: new (endpoint: string) => SdkClient;
}
export interface SdkClient {
    create<S>(roomName: string, options: unknown, schemaCtor: unknown): Promise<SdkRoom<S>>;
    reconnect<S>(token: string, schemaCtor: unknown): Promise<SdkRoom<S>>;
    joinById<S>(roomId: string, options: unknown, schemaCtor: unknown): Promise<SdkRoom<S>>;
}
export interface SdkRoom<S> {
    readonly sessionId: string;
    readonly roomId: string;
    readonly state: S;
    readonly reconnectionToken: string;
    input<T>(): SdkInputHandle<T>;
    send(type: string, payload?: unknown): void;
    leave(consented?: boolean): Promise<unknown>;
    onStateChange(callback: (state: S) => void): void;
}
export interface SdkInputHandle<T> {
    readonly data: T;
    readonly sentCount: number;
    readonly pendingCount: number;
    readonly lastProcessed: number;
    readonly epoch: number;
    readonly replayBufferSize: number;
    send(): number;
    at(seq: number): T | undefined;
}
/** Load the pinned packages exactly as `apps/server` sees them. */
export declare const loadPinnedStack: (rootDir: string) => Promise<PinnedStack>;
export interface HarnessServer {
    readonly port: number;
    readonly endpoint: string;
    close(): Promise<void>;
}
/** Boot a loopback server over the pinned WebSocket transport, exactly as the Phase 0 runner does. */
export declare const startHarnessServer: (rootDir: string, rooms: Record<string, RegisteredHandler>) => Promise<HarnessServer>;
/** A connected client seat: room handle plus its input handle. */
export interface Seat<S = unknown> {
    readonly room: SdkRoom<S>;
    readonly handle: SdkInputHandle<Record<string, unknown>>;
    /** The SDK client owning this connection: reconnection is a client operation (D-P2-8 §3.2). */
    readonly client: SdkClient;
}
/** Connect one SDK client to `roomName` with the join options that satisfy the hash gate. */
export declare const connectSeat: <S = unknown>(stack: PinnedStack, endpoint: string, roomName: string, joinOptions: unknown, schemaCtor: unknown) => Promise<Seat<S>>;
/** Stamp and send one direct wire frame: `sentCount + 1`, the value the SDK will acknowledge (PR-15 S1). */
export declare const stampAndSend: (handle: SdkInputHandle<Record<string, unknown>>, frame: Record<string, unknown>) => number;
/**
 * The epoch the ROOM issued for this seat, read from its own replica row (F-1). A stream stamped with
 * any other epoch is refused by the screen while `inputResolvedThrough` still advances over the refusal,
 * so a compliant sender stamps this value and verifies consumption against the stamps it sent.
 */
export declare const issuedEpoch: (room: unknown) => number;
/** Convert the transport's `ws://` endpoint to the `http://` base the SDK client expects. */
export declare function connectSeatById<S = unknown>(stack: PinnedStack, endpoint: string, roomId: string, joinOptions: unknown, schemaCtor: unknown): Promise<Seat<S>>;
export declare const httpEndpoint: (wsEndpoint: string) => string;
export declare const sleep: (ms: number) => Promise<void>;
/** Poll `condition` until true or the budget runs out. */
export declare const until: (condition: () => boolean, budgetMs: number, stepMs?: number) => Promise<boolean>;
export interface ProbeCheck {
    readonly name: string;
    readonly ok: boolean;
    readonly detail: string;
}
export declare class ProbeRecorder {
    readonly checks: ProbeCheck[];
    readonly observations: Record<string, unknown>;
    readonly limitations: string[];
    readonly probeId: string;
    readonly subject: string;
    readonly invocationId: string | undefined;
    constructor(probeId: string, subject: string, invocationId: string | undefined);
    check(name: string, ok: boolean, detail: string): void;
    observe(name: string, value: unknown): void;
    limit(text: string): void;
    get passed(): boolean;
    write(outPath: string): void;
}
