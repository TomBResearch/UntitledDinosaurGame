import { readFileSync } from 'node:fs';

export function probe(path) {
  return readFileSync(path).byteLength;
}
