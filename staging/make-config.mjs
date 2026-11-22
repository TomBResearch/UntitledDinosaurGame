#!/usr/bin/env node
/**
 * Regenerate staging/config/region-config.json from THE BUILD's own defaults (staging
 * integration file, build-time only — the service never runs this).
 *
 * The document is `DEFAULT_SERVER_CONFIG` with one deliberate change demanded by owner decision
 * D5: an explicit, named region `bounds` block, because no production region asset exists and the
 * real server entry refuses to boot without bounds. The greybox extents mirror the ones the
 * accepted UDG-003 contract suite runs the emitted artifact with (x/z −50..50, y −5..20). Nothing
 * else moves: the document is then round-tripped through `validateServerConfig` so what ships is
 * provably the shape the deployed validator accepts, and the resulting configHash/manifestHash are
 * printed for the release record.
 *
 * Run from the repository root with built packages:
 *   node staging/make-config.mjs [--out staging/config/region-config.json]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { DEFAULT_SERVER_CONFIG, computeConfigHash, regionHash, validateServerConfig, withConfigOverrides } from '../packages/config/dist/index.js';

const outArgIndex = process.argv.indexOf('--out');
const outPath = resolve(outArgIndex >= 0 && process.argv[outArgIndex + 1] !== undefined ? process.argv[outArgIndex + 1] : 'staging/config/region-config.json');

const configured = withConfigOverrides(DEFAULT_SERVER_CONFIG, {
  region: {
    // Greybox staging extents — the same envelope the UDG-003 emitted-artifact run uses. This is
    // a staging placeholder, NOT a production region asset (UDG-007 owns that).
    bounds: {
      x: { min: -50, max: 50 },
      y: { min: -5, max: 20 },
      z: { min: -50, max: 50 },
    },
  },
});

// `limits` is re-issued by the validator, never taken from the document; a document that carries
// it must carry it EXACTLY, so we serialize the validator's own output, not the draft.
const validated = validateServerConfig(JSON.parse(JSON.stringify(configured)));
if (validated.ok === false) {
  for (const issue of validated.issues) process.stderr.write(`  ${issue.path}: ${issue.message}\n`);
  process.exit(1);
}

const json = `${JSON.stringify(validated.value, null, 2)}\n`;
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, json, 'utf8');

process.stdout.write(
  `wrote ${outPath}\nconfigHash ${computeConfigHash(validated.value)}\nmanifestHash ${regionHash(validated.value)}\n`,
);
