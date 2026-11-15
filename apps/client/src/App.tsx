/**
 * The React tree of the UDG-004 client: the status banner and the development overlay, and nothing else.
 *
 * There is no game UI here by design. UDG-004 owns "React renders status and debug controls"
 * (docs/contracts/UDG-004.md); the HUD is UDG-008's, and a placeholder HUD in this file would be surface area
 * that a later task inherits instead of choosing.
 *
 * The component is presentational. It receives the runtime and the connection rather than creating them, which
 * is what lets `main.tsx` own the mount/unmount pair that both the overlay button and the development harness
 * drive — one implementation of "put a scene on screen and take it away again", exercised by a click, by ten
 * automated cycles and by the disposal audit alike.
 */

import type { ClientRuntime } from './game/ClientRuntime.js';
import type { ClientConnection } from './network/ClientConnection.js';
import { ConnectionStatus } from './ui/ConnectionStatus.js';
import { DevelopmentOverlay } from './ui/DevelopmentOverlay.js';

export interface AppProps {
  readonly runtime: ClientRuntime;
  readonly connection: ClientConnection;
  readonly mounted: boolean;
  readonly onToggleMount: () => void;
}

export const App = ({ runtime, connection, mounted, onToggleMount }: AppProps) => (
  <>
    <ConnectionStatus connection={connection} />
    <DevelopmentOverlay
      runtime={runtime}
      connection={connection}
      mounted={mounted}
      onToggleMount={onToggleMount}
    />
  </>
);
