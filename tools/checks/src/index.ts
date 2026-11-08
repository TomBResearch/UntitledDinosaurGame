/**
 * @udg/checks public surface (UDG-001).
 *
 * The root package.json scripts call the compiled CLIs directly. This module exposes the same
 * behaviour as a library so the contract suite can assert decisions without scraping stdout.
 * Nothing here imports a game workspace: the checker has to keep working when a game package is
 * deliberately broken.
 */

export * from './support.js';
export * from './boundaries.js';
export * from './fixtures.js';
export * from './run-contract.js';
export * from './dispatch.js';
export * from './evidence.js';
