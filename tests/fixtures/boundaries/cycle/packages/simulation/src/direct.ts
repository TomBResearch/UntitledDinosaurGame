import { startDirect } from './index.js';

export function stepDirect(depth) {
  return depth > 0 ? undefined : startDirect;
}
