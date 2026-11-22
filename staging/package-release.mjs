#!/usr/bin/env node
/**
 * Off-host release packager for the private staging transfer (staging integration file,
 * build-time only — nothing in the archive runs this).
 *
 * Produces ONE self-contained, production-dependency-only tar.gz of the real region-room service:
 *
 *   udg-room/
 *     dist/ node_modules/ package.json pnpm-lock.yaml   <- `pnpm deploy --prod` of @udg/server
 *                                                        (workspace deps @udg/config and
 *                                                        @udg/protocol inlined as real packages;
 *                                                        ZERO dev dependencies)
 *     staging/launch.mjs staging/launch.sh              <- loopback-bound boot via the repo's own
 *     staging/config/region-config.json                    supported boot modules + D5 bounds doc
 *     staging/smoke.mjs  staging/smoke.sh               <- server-local CLI smoke (observation only)
 *     runtime/bin/node                                  <- pinned Node v24.22.2 linux-arm64
 *                                                         (verified against nodejs.org SHASUMS256)
 *     RELEASE.json SHA256SUMS README.md NOTICE
 *
 * Provenance: the release record binds the git commit, the pnpm lockfile sha256, the deployed
 * @colyseus pins, the config/manifest hashes of the shipped document, and the sha256 of every file
 * inside the stage — plus the sha256 of the final tar.gz written next to it. No workspace paths,
 * no secrets, no evidence bundles are copied: the stage is assembled exclusively from the listed
 * sources and is verified by extracting and running it offline in a clean directory (see README).
 *
 * usage: node staging/package-release.mjs [--out /workspace/udg-staging-transfer]
 *                                         [--name udg-room.tar.gz]
 *                                         [--node-tarball <cached .tar.xz>] [--offline]
 * prerequisites on THIS machine only: corepack pnpm (repo pin 12.18.0) and a built workspace.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] !== undefined ? process.argv[at + 1] : fallback;
};

const OUT = resolve(arg('out', '/workspace/udg-staging-transfer'));
const NAME = arg('name', 'udg-room.tar.gz');
const NODE_VERSION = 'v24.22.2'; // the repo's engines pin
const NODE_TARBALL = `node-${NODE_VERSION}-linux-arm64.tar.xz`;
const NODE_URL = `https://nodejs.org/dist/${NODE_VERSION}/${NODE_TARBALL}`;
const NODE_CACHE = resolve(arg('node-tarball', `/workspace/udg-scratch-tools/node-cache/${NODE_TARBALL}`));

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: ROOT, ...options });
  if (result.status !== 0) throw new Error(`command failed (${command} ${args.join(' ')}): exit ${String(result.status)}`);
};
const capture = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', cwd: ROOT });
  if (result.status !== 0) throw new Error(`command failed (${command}): ${result.stderr.slice(0, 400)}`);
  return result.stdout.trim();
};
const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
function walkSync(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walkSync(join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
    else if (entry.isSymbolicLink()) out.push({ symlink: rel, target: readlinkSync(join(dir, entry.name)) });
    else throw new Error(`unexpected non-regular entry in stage: ${rel}`);
  }
  return out;
}
// pnpm's deployed node_modules is a RELATIVE symlink farm (verified per-build below: zero
// absolute targets, zero broken links, none escaping the stage). tar preserves it; the digest
// manifest covers REGULAR files, and every link is recorded verbatim in SHA256SYMLINKS so the
// extracted tree is reconstructible and auditable.
const flatten = (entries) => entries.filter((e) => typeof e === 'string');
const symlinksOf = (entries) => entries.filter((e) => typeof e === 'object');

// Final leak guard helper: no shipped text file may name the build workspace or store.
const LEAK_MARKERS = ['file:///workspace', '/workspace/udg-', '/workspace/.pnpm-store'];
const leakScan = (regularFiles) => {
  const offenders = [];
  for (const rel of regularFiles) {
    const buf = readFileSync(join(STAGE, rel));
    if (buf.length > (4 << 20)) continue; // the node binary; markers are text-side anyway
    const text = buf.toString('latin1');
    if (LEAK_MARKERS.some((marker) => text.includes(marker))) offenders.push(rel);
  }
  if (offenders.length > 0) throw new Error(`build-machine paths found in stage: ${offenders.join(', ')}`);
};

const COMMIT = capture('git', ['rev-parse', '92ce2e6c5fbd119ba2e31a5c75a30264eb18349f^{commit}']);
const BUILD_ROOT = resolve('/workspace/udg-scratch-tools/package-build');
const STAGE = join(BUILD_ROOT, 'udg-room');
const versionOf = (pkg) => {
  // Nested packages (`@colyseus/schema` lives under .pnpm only) are read from the virtual store.
  const direct = join(STAGE, 'node_modules', pkg, 'package.json');
  const candidates = [direct];
  if (!existsSync(direct)) {
    const vStore = join(STAGE, 'node_modules', '.pnpm');
    const needle = `${pkg.replace('/', '+')}@`;
    for (const entry of readdirSync(vStore)) {
      if (entry.startsWith(needle)) candidates.push(join(vStore, entry, 'node_modules', pkg, 'package.json'));
    }
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, 'utf8')).version;
  }
  throw new Error(`cannot locate deployed package ${pkg} for the provenance record`);
};

process.stderr.write(`[package] build root ${BUILD_ROOT}\n`);
rmSync(BUILD_ROOT, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

// 1. Production-dependency-only deployment of the real server package.
process.stderr.write('[package] pnpm --filter @udg/server deploy --prod\n');
run('pnpm', ['--reporter', 'silent', '--filter', '@udg/server', 'deploy', '--prod', STAGE], { env: { ...process.env } });
rmSync(join(STAGE, 'pnpm-workspace.yaml'), { force: true });
// The archive must carry NO dependency on workspace paths: pnpm deploy leaves build-machine
// metadata behind (workspace-state cache, file:/ specifiers rewritten into the root manifest).
// None of it is read at runtime; strip the state file and pin the inline @udg versions so the
// shipped manifest is self-describing and path-free.
rmSync(join(STAGE, 'node_modules', '.pnpm-workspace-state-v1.json'), { force: true });
rmSync(join(STAGE, 'node_modules', '.pnpm', 'lock.yaml'), { force: true });
{
  const manifestPath = join(STAGE, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    if (name.startsWith('@udg/')) manifest.dependencies[name] = versionOf(name);
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const text = readFileSync(manifestPath, 'utf8');
  if (text.includes('file://') || text.includes('/workspace')) {
    throw new Error('shipped manifest still references build-machine paths — refusing to package');
  }
}
// The deployed lockfile and .modules.yaml are derived install state carrying BUILD-MACHINE paths.
// The provenance lockfile is the REPOSITORY's own, at the recorded commit — ship that instead and
// drop the install-time metadata (Node never reads either at runtime).
rmSync(join(STAGE, 'node_modules', '.modules.yaml'), { force: true });
copyFileSync(join(ROOT, 'pnpm-lock.yaml'), join(STAGE, 'pnpm-lock.yaml'));

// 2. Staging integration files (loopback boot entry, doc, smoke CLI, wrappers, docs).
const copyInto = (srcRel, destRel, executable = false) => {
  const dest = join(STAGE, destRel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(resolve(ROOT, srcRel), dest);
  if (executable) chmodSync(dest, 0o755);
};
copyInto('staging/launch.mjs', 'staging/launch.mjs');
copyInto('staging/smoke.mjs', 'staging/smoke.mjs');
copyInto('staging/launch.sh', 'staging/launch.sh', true);
copyInto('staging/smoke.sh', 'staging/smoke.sh', true);
copyInto('staging/config/region-config.json', 'staging/config/region-config.json');
copyInto('staging/README-STAGING.md', 'README.md');
copyInto('staging/NOTICE', 'NOTICE');

// 3. Pinned runtime: verified against the published SHASUMS256, binary only.
const cacheShaPath = `${NODE_CACHE}.sha256`;
if (!existsSync(NODE_CACHE) || !existsSync(cacheShaPath)) {
  throw new Error(`pinned node runtime not prepared: need ${NODE_CACHE} and ${cacheShaPath} (see README-STAGING §runtime)`);
}
const expectedSha = readFileSync(cacheShaPath, 'utf8').trim().split(/\s+/)[0];
const actualSha = sha256File(NODE_CACHE);
if (actualSha !== expectedSha) throw new Error(`node tarball sha256 mismatch: ${actualSha} != ${expectedSha}`);
mkdirSync(join(STAGE, 'runtime'), { recursive: true });
// strip-components=1 over the member path turns `node-vX/bin/node` into `bin/node` under -C runtime.
run('tar', ['-xJf', NODE_CACHE, '-C', join(STAGE, 'runtime'), '--strip-components=1', `node-${NODE_VERSION}-linux-arm64/bin/node`]);
chmodSync(join(STAGE, 'runtime', 'bin', 'node'), 0o755);

// 4. What the shipped document hashes to, as the DEPLOYED code computes it.
const deployed = await import(`file://${join(STAGE, 'node_modules', '@udg', 'config', 'dist', 'index.js')}`);
const document = JSON.parse(readFileSync(join(STAGE, 'staging', 'config', 'region-config.json'), 'utf8'));
const validated = deployed.validateServerConfig(document);
if (validated.ok === false) {
  throw new Error(`shipped config document does not validate with the deployed validator: ${JSON.stringify(validated.issues)}`);
}
const hashes = {
  configHash: deployed.computeConfigHash(validated.value),
  manifestHash: deployed.regionHash(validated.value),
  tickRateHz: validated.value.network.tickRate,
  statePatchIntervalMs: validated.value.network.statePatchIntervalMs,
};

const deployedManifest = JSON.parse(readFileSync(join(STAGE, 'package.json'), 'utf8'));

// Final leak guard runs once the stage inventory is known (see below, before the manifests).
// 5. RELEASE.json + SHA256SUMS (regular files) + SHA256SYMLINKS (recorded link farm).
const entries = walkSync(STAGE);
const regularFiles = flatten(entries).sort();
const symlinks = symlinksOf(entries);
for (const link of symlinks) {
  const abs = join(STAGE, link.symlink);
  if (link.target.startsWith('/')) throw new Error(`absolute symlink in stage: ${link.symlink}`);
  if (!existsSync(abs)) throw new Error(`broken symlink in stage: ${link.symlink}`);
  if (!resolve(abs).startsWith(resolve(STAGE) + '/')) throw new Error(`escaping symlink in stage: ${link.symlink}`);
}
leakScan(regularFiles);
const release = {
  kind: 'udg-staging-release',
  generatedAt: new Date().toISOString(),
  sourceCommit: COMMIT,
  package: { name: deployedManifest.name, dependencies: deployedManifest.dependencies },
  pins: {
    node: NODE_VERSION,
    nodeRuntime: { file: NODE_TARBALL, sha256: actualSha, url: NODE_URL, arch: 'linux-arm64', glibcRequired: '>=2.28 (AL2023 ships 2.34)' },
    pnpm: capture('pnpm', ['--version']),
    lockfileSha256: sha256File(join(ROOT, 'pnpm-lock.yaml')), // the repository lockfile at sourceCommit
    colyseus: {
      core: versionOf(join('@colyseus', 'core')),
      sdk: versionOf(join('@colyseus', 'sdk')),
      wsTransport: versionOf(join('@colyseus', 'ws-transport')),
      schema: versionOf(join('@colyseus', 'schema')),
    },
    udg: { config: versionOf(join('@udg', 'config')), protocol: versionOf(join('@udg', 'protocol')) },
  },
  shippedConfig: hashes,
  posture: {
    bindDefault: '127.0.0.1:18673 (loopback enforced by staging/launch.mjs)',
    heapCeilingDefaultMB: 512,
    devDependencies: 'none (pnpm deploy --prod)',
    extraListeners: 'none — the single WebSocketTransport http server is the only socket',
  },
  files: regularFiles.length + 1, // + this RELEASE.json record (manifested immediately below)
  fileCountNote: 'per-file digests in SHA256SUMS (regular files, RELEASE.json included); every symlink in SHA256SYMLINKS (relative farm, verified in-stage)',
};
writeFileSync(join(STAGE, 'RELEASE.json'), `${JSON.stringify(release, null, 2)}\n`, 'utf8');

const sums = [...regularFiles, 'RELEASE.json']
  .sort()
  .map((rel) => `${sha256File(join(STAGE, rel))}  ${rel}\n`)
  .join('');
writeFileSync(join(STAGE, 'SHA256SUMS'), sums, 'utf8');
writeFileSync(join(STAGE, 'SHA256SYMLINKS'), symlinks.map((link) => `${link.symlink} -> ${link.target}\n`).join(''), 'utf8');

// 6. Archive + checksum beside it.
mkdirSync(OUT, { recursive: true });
const tarPath = join(OUT, NAME);
rmSync(tarPath, { force: true });
run('tar', ['-czf', tarPath, '-C', BUILD_ROOT, 'udg-room']);
const tarSha = sha256File(tarPath);
writeFileSync(`${tarPath}.sha256`, `${tarSha}  ${NAME}\n`, 'utf8');

process.stdout.write(
  `${JSON.stringify({ archive: tarPath, sha256: tarSha, bytes: statSync(tarPath).size, regularFiles: regularFiles.length + 1, symlinks: symlinks.length, release }, null, 2)}\n`,
);
