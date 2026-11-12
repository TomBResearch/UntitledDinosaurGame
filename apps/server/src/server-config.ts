/**
 * The real server's configuration entry (UDG-003 Phase 2, W-11).
 *
 * One rule: the process runs a **validated** `ServerConfig` or it does not start. The document
 * source is deliberately boring (a JSON file path, or the shipped defaults with operator
 * overrides) because the interesting part is not parsing, it is that nothing unvalidated reaches
 * `RegionRoom`, and that the two hashes the join gate compares are computed from exactly the object
 * the room runs on — not from the document someone meant to deploy.
 */

import { readFileSync } from 'node:fs';

import {
  DEFAULT_SERVER_CONFIG,
  computeConfigHash,
  regionHash,
  validateServerConfig,
  withConfigOverrides,
} from '@udg/config';
import type { ServerConfig } from '@udg/config';

export interface LoadedConfig {
  readonly config: Readonly<ServerConfig>;
  readonly configHash: string;
  readonly manifestHash: string;
  readonly source: 'defaults' | 'document' | 'overrides';
}

export type LoadResult = { readonly ok: true; readonly loaded: LoadedConfig } | { readonly ok: false; readonly issues: readonly string[] };

/**
 * Load the configuration for this process.
 *
 * `documentPath` names a full configuration document (the shape `validateServerConfig` accepts;
 * `limits` is re-issued by the validator, never taken from the document). `overrides` is the
 * smaller operator knob — named partial blocks over the defaults. Both refuse loudly; neither
 * invents a value the schema does not already have.
 */
export const loadServerConfig = (options: {
  readonly documentPath?: string;
  readonly overrides?: Parameters<typeof withConfigOverrides>[1];
} = {}): LoadResult => {
  const report = (issues: readonly { path: string; message: string }[]): LoadResult => ({
    ok: false,
    issues: issues.map((issue) => `${issue.path}: ${issue.message}`),
  });

  let base: Readonly<ServerConfig> = DEFAULT_SERVER_CONFIG;
  let source: LoadedConfig['source'] = 'defaults';
  if (options.documentPath !== undefined) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(options.documentPath, 'utf8'));
    } catch (error) {
      return { ok: false, issues: [`config document unreadable: ${String(error)}`] };
    }
    const parsed = validateServerConfig(raw);
    if (parsed.ok === false) return report(parsed.issues);
    base = parsed.value;
    source = 'document';
  }

  const configured = options.overrides === undefined ? base : withConfigOverrides(base, options.overrides);
  const validated = validateServerConfig(JSON.parse(JSON.stringify(configured)));
  if (validated.ok === false) return report(validated.issues);

  return {
    ok: true,
    loaded: {
      config: validated.value,
      configHash: computeConfigHash(validated.value),
      manifestHash: regionHash(validated.value),
      source: options.overrides === undefined ? source : source === 'defaults' ? 'overrides' : 'document',
    },
  };
};
