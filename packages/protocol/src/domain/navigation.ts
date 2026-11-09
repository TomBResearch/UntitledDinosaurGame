/**
 * Navigation declarations (interfaces/domain.md A3).
 *
 * `findPath` stays synchronous at the domain boundary; the worker wrapper that schedules the query
 * away from the room loop is UDG-007 (P08 pending), and `NavigationScope`/`RouteWorker` live in
 * packages/navigation/src/contracts.ts, which this task does not own.
 */

import type { Vec3 } from './primitives.js';

export interface NavigationQuery {
  readonly start: Vec3;
  readonly destination: Vec3;
  readonly agentRadius: number;
}

/**
 * A route is immutable once published. Revisions may have gaps after rejected work but must strictly
 * increase on allocation within an epoch (interfaces/domain.md 4.1).
 */
export interface NavigationRoute {
  readonly revision: number;
  readonly navmeshHash: string;
  readonly waypoints: readonly Vec3[];
  readonly destination: Vec3;
}

export type NavigationResult =
  | { readonly ok: true; readonly route: NavigationRoute }
  | {
      readonly ok: false;
      readonly reason:
        | 'INVALID_DESTINATION'
        | 'OUT_OF_BOUNDS'
        | 'UNREACHABLE'
        | 'RATE_LIMITED'
        | 'SUPERSEDED'
        | 'NAVIGATION_BUSY';
    };

export interface NavigationService {
  findPath(query: NavigationQuery): NavigationResult;
}

/** Read side of the route store. Writer methods are held only by authority (UDG-005). */
export interface RouteStore {
  get(revision: number): NavigationRoute | null;
}
