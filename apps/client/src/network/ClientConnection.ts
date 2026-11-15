/**
 * The connection status surface — deliberately not a session, and deliberately not the Colyseus SDK.
 *
 * ## Why there is no `@colyseus/sdk` import here
 *
 * ADR-0002 keeps the Colyseus SDK out of the repository's shared type surface, and the UDG-004 assignment
 * keeps it out of this file for a second reason: a client that imports the SDK has already decided to own a
 * session, and UDG-004 must not pretend to have one. The camera task needs exactly one thing from the
 * networking story — an honest, visible answer to "am I joined to a server?" — and that is a small status
 * machine over the browser's own `WebSocket`, not a room, not a schema, not a reconnection token.
 * docs/contracts/UDG-004.md says the task "must not … assume production networking", and the accepted
 * boundary rules (`tools/checks/src/boundaries.ts`) keep `@colyseus/` out of `@udg/client` anyway.
 *
 * ## What a failure looks like, and why it is normal here
 *
 * With no UDG-003 server running, `connect()` fails. That is the state the acceptance list asks to see
 * ("visible connection failure"), so it is rendered rather than hidden: the status lands on `failed`, the
 * reason is kept for the overlay, and nothing throws, retries forever or opens a second socket. `attempts()`
 * says how many times it was tried and `connect()` on a socket that is already open or open-ing is a no-op, so
 * the overlay's retry control cannot grow a socket leak.
 *
 * Credentials are never part of this surface: no token, no reconnection id, no handshake bytes, and therefore
 * nothing for evidence sanitisation to hunt for (docs/validation/evidence-requirements.md 19.1).
 */

/** The five states this surface can report. `reconnecting` is a later task's decision, not this one's. */
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'failed' | 'closed';

export interface ConnectionFailure {
  readonly reason: string;
  /** `Date.now()` from the injected clock, so a test can pin the timestamp. */
  readonly at: number;
}

/**
 * The part of a socket this file uses.
 *
 * `WebSocket` satisfies it structurally. Naming only these three members is what lets
 * `tests/contracts/UDG-004.test.ts` drive a successful open and a refusal without a server, and it keeps this
 * module free of anything that has to be mocked at the network layer.
 */
export interface ConnectionTransport {
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'error' | 'close', listener: (event: TransportCloseEvent) => void): void;
  close(): void;
}

export interface TransportCloseEvent {
  readonly code?: number;
  readonly reason?: string;
}

export type TransportFactory = (url: string) => ConnectionTransport;

export interface ClientConnectionOptions {
  readonly url: string;
  readonly transport?: TransportFactory;
  readonly now?: () => number;
}

export interface ClientConnection {
  readonly url: string;
  status(): ConnectionStatus;
  /** React's `useSyncExternalStore` pair. The returned function unsubscribes. */
  subscribe(listener: () => void): () => void;
  connect(): void;
  close(): void;
  lastFailure(): ConnectionFailure | undefined;
  attempts(): number;
  dispose(): void;
}

const defaultTransport: TransportFactory = (url) => new WebSocket(url);

const statusReason = (status: ConnectionStatus): string => {
  switch (status) {
    case 'idle':
      return 'not attempted yet';
    case 'connecting':
      return 'opening a development socket';
    case 'connected':
      return 'development socket open';
    case 'failed':
      return 'development socket refused';
    case 'closed':
      return 'development socket closed';
  }
};

/**
 * A one-attempt, no-session connection status surface over `WebSocket`.
 *
 * `connect()` is idempotent while a socket is open or opening, and after a failure it starts a fresh attempt —
 * which is all the overlay's retry button needs.
 */
export const createClientConnection = (options: ClientConnectionOptions): ClientConnection => {
  const makeTransport = options.transport ?? defaultTransport;
  const now = options.now ?? ((): number => Date.now());
  const listeners = new Set<() => void>();

  let current: ConnectionStatus = 'idle';
  let failure: ConnectionFailure | undefined;
  let attempts = 0;
  let socket: ConnectionTransport | undefined;
  let disposed = false;

  const publish = (next: ConnectionStatus): void => {
    current = next;
    for (const listener of [...listeners]) listener();
  };

  const detach = (): void => {
    if (socket === undefined) return;
    try {
      socket.close();
    } catch {
      // A socket that refuses to close is not this surface's problem, and it must not become an uncaught
      // error in the page: the transport is dropped either way.
    }
    socket = undefined;
  };

  const connect = (): void => {
    if (disposed) return;
    if (current === 'connecting' || current === 'connected') return;
    attempts += 1;
    failure = undefined;
    publish('connecting');
    let opened: ConnectionTransport;
    try {
      opened = makeTransport(options.url);
    } catch (error) {
      // A malformed URL throws synchronously out of `new WebSocket`, and a browser that refuses the socket
      // must still leave the UI intact with a reason attached.
      failure = { reason: error instanceof Error ? error.message : String(error), at: now() };
      publish('failed');
      return;
    }
    // Did this socket ever reach `open`? The answer decides what a following `close` means, and it is the
    // difference between the two states a reviewer can actually distinguish: "nothing is listening" and
    // "something dropped us". Chromium reports a refused development server as `error` then `close` with code
    // 1006 and an empty reason, so a blanket `closed` would erase the failure the acceptance list asks to see.
    let reachedOpen = false;
    socket = opened;
    opened.addEventListener('open', () => {
      if (socket !== opened) return;
      reachedOpen = true;
      publish('connected');
    });
    opened.addEventListener('error', (event) => {
      if (socket !== opened) return;
      failure = { reason: describeClose('socket error', event), at: now() };
      publish('failed');
    });
    opened.addEventListener('close', (event) => {
      if (socket !== opened) return;
      socket = undefined;
      if (!reachedOpen) {
        // Never opened: this is the failure, not a clean shutdown. The reason from `error` is kept when there
        // is one, because "socket error" is the accurate phrase and the code adds nothing a reviewer needs.
        if (failure === undefined) failure = { reason: describeClose('socket refused before opening', event), at: now() };
        publish('failed');
        return;
      }
      failure = { reason: describeClose('socket closed', event), at: now() };
      publish('closed');
    });
  };

  return {
    url: options.url,
    status: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    connect,
    close: () => {
      detach();
      publish('closed');
    },
    lastFailure: () => failure,
    attempts: () => attempts,
    dispose: () => {
      disposed = true;
      detach();
      listeners.clear();
    },
  };
};

const describeClose = (prefix: string, event: TransportCloseEvent): string => {
  const code = typeof event.code === 'number' ? ` code=${String(event.code)}` : '';
  const reason = typeof event.reason === 'string' && event.reason.length > 0 ? ` reason=${event.reason}` : '';
  return `${prefix}${code}${reason}`.trim();
};

/** Human-readable status text for the status component. Exported so both sides show the same words. */
export const statusLabel = (status: ConnectionStatus): string => `${status} — ${statusReason(status)}`;
