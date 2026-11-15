/**
 * The visible connection status (UDG-004: "React renders status and debug controls", and the acceptance item
 * "visible connection failure").
 *
 * The component reads the status surface through `useSyncExternalStore`, so it re-renders when the status
 * changes and holds no private copy — a status component that caches the status is how a stale "connected"
 * ends up in a screenshot. The store callbacks are memoised on the connection object, because an inline arrow
 * would resubscribe on every render and every resubscription is a real listener in this application's ledger.
 *
 * `data-udg-ui` on the outer element is the load-bearing attribute: `OrbitCamera` consults it to refuse a
 * gesture that started on the UI, so the banner is a declared excluded region rather than an accident of the
 * compositor. `data-udg-connection-status` is what `tests/e2e/camera.spec.ts` reads, because red text is
 * evidence for a person and an attribute is evidence for a test.
 */

import { useCallback, useSyncExternalStore } from 'react';

import { statusLabel, type ClientConnection, type ConnectionStatus as Status } from '../network/ClientConnection.js';

export interface ConnectionStatusProps {
  readonly connection: ClientConnection;
}

const TONE: Readonly<Record<Status, string>> = {
  idle: 'neutral',
  connecting: 'neutral',
  connected: 'ok',
  failed: 'bad',
  closed: 'neutral',
};

export const ConnectionStatus = ({ connection }: ConnectionStatusProps) => {
  const subscribe = useCallback((listener: () => void) => connection.subscribe(listener), [connection]);
  const getSnapshot = useCallback(() => connection.status(), [connection]);
  const status = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const failure = connection.lastFailure();

  return (
    <div
      className="udg-status"
      data-udg-ui="connection"
      data-udg-connection-status={status}
      data-udg-tone={TONE[status]}
    >
      <span className="udg-status-dot" aria-hidden="true" />
      <span data-udg-connection-label={status}>{statusLabel(status)}</span>
      <span className="udg-status-url">{connection.url}</span>
      {status === 'failed' && failure !== undefined ? (
        <span className="udg-status-reason" data-udg-connection-reason={failure.reason}>
          {failure.reason} · attempt {String(connection.attempts())}
        </span>
      ) : null}
      {status === 'failed' ? (
        <span className="udg-status-note">
          No UDG-003 server is running, and no session exists: this task owns presentation only.
        </span>
      ) : null}
    </div>
  );
};
