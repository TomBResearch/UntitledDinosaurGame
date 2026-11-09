/**
 * `@udg/protocol/domain` entry point.
 *
 * Type-only surface: canonical declarations with no schema runtime, no Room, no Node builtin and no
 * browser global. Simulation and later tasks consume this entry point. The declaration modules are
 * the owned files listed in docs/contracts/UDG-002.md; this barrel is a declared addition because an
 * export subpath needs one module to resolve to.
 */

// `primitives.js` also carries the runtime rejection-code list, so it is exported as values
// and types; every other module here is types only.
export * from './primitives.js';
export type * from './state.js';
export type * from './movement.js';
// `commands.js` also carries the runtime route-status vocabulary, so it is exported as values
// and types like `primitives.js`.
export * from './commands.js';
export type * from './physics.js';
export type * from './navigation.js';
export * from './wire.js';
