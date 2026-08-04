#!/usr/bin/env node

/**
 * Read-only indicator-of-compromise sweep for npm supply-chain incidents.
 *
 * Surfaces covered: committed lockfiles, installed dependency trees, the npm
 * cache index, dependency install hooks, Claude/VS Code hook configuration, and
 * declared network/file indicators.
 *
 * This script never writes, deletes, quarantines, or remediates. It reports and
 * exits non-zero so a human decides what happens next.
 *
 * Indicators live in ioc-indicators.json — add entries there, never here.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildPackageIndex, isPlainObject, parseManifest } from './ioc-manifest.mjs';

export { buildPackageIndex, parseManifest } from './ioc-manifest.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
const DEFAULT_MANIFEST = resolve(SCRIPT_DIR, 'ioc-indicators.json');
const LIFECYCLE_KEYS = ['preinstall', 'install', 'postinstall'];
const LOCKFILES = [
  'package-lock.json',
  'server/package-lock.json',
  'gateway/package-lock.json',
  'llm-egress-proxy/package-lock.json',
  'ai-proxy/package-lock.json',
];
/**
 * Every tree that can hold installed dependencies. The root tree is often empty
 * in this repo because dependencies are installed inside Docker, so sweeping
 * only the root would silently scan nothing.
 */
const INSTALLED_TREES = [
  'node_modules',
  'shared/node_modules',
  'server/node_modules',
  'gateway/node_modules',
  'llm-egress-proxy/node_modules',
  'ai-proxy/node_modules',
];
/** Bounds the installed-tree walk so a pathological tree cannot hang CI. */
const MAX_TREE_ENTRIES = 200_000;

export function packageNameFromLocation(location) {
  const marker = 'node_modules/';
  const at = location.lastIndexOf(marker);
  return at === -1 ? location : location.slice(at + marker.length);
}

/** Yields `{ name, version, location }` for every entry in an npm lockfile (v1-v3). */
export function collectLockfilePackages(lock) {
  const records = [];
  if (isPlainObject(lock.packages)) {
    Object.entries(lock.packages).forEach(([location, meta]) => {
      if (!location || !isPlainObject(meta) || typeof meta.version !== 'string') return;
      records.push({
        name: meta.name ?? packageNameFromLocation(location),
        version: meta.version,
        location,
      });
    });
  }
  const walkLegacy = (deps, prefix) => {
    if (!isPlainObject(deps)) return;
    Object.entries(deps).forEach(([name, meta]) => {
      if (!isPlainObject(meta)) return;
      const location = `${prefix}node_modules/${name}`;
      if (typeof meta.version === 'string') records.push({ name, version: meta.version, location });
      walkLegacy(meta.dependencies, `${location}/`);
    });
  };
  walkLegacy(lock.dependencies, '');
  return records;
}

function findingsForPackages(records, index, surface, source) {
  const findings = [];
  records.forEach((record) => {
    const hit = index.get(`${record.name}@${record.version}`);
    if (!hit) return;
    findings.push({
      surface,
      indicator: `${record.name}@${record.version}`,
      incident: hit.incident,
      reference: hit.reference,
      detail: `${source} declares ${record.name}@${record.version} at ${record.location}`,
    });
  });
  return findings;
}

/** @returns {{ findings: object[], packagesScanned: number, filesScanned: string[] }} */
export function sweepLockfiles(repoRoot, index, lockfiles = LOCKFILES) {
  const findings = [];
  const filesScanned = [];
  let packagesScanned = 0;
  lockfiles.forEach((relPath) => {
    const absolute = resolve(repoRoot, relPath);
    if (!existsSync(absolute)) return;
    let lock;
    try {
      lock = JSON.parse(readFileSync(absolute, 'utf8'));
    } catch (error) {
      findings.push({
        surface: 'lockfile',
        indicator: 'unreadable-lockfile',
        detail: `${relPath} could not be parsed: ${error.message}`,
      });
      return;
    }
    const records = collectLockfilePackages(lock);
    packagesScanned += records.length;
    filesScanned.push(relPath);
    findings.push(...findingsForPackages(records, index, 'lockfile', relPath));
  });
  return { findings, packagesScanned, filesScanned };
}

/** Walks an installed node_modules tree, returning each package.json it finds. */
export function collectInstalledPackages(treeRoot, limit = MAX_TREE_ENTRIES) {
  const packages = [];
  if (!existsSync(treeRoot)) return packages;
  const queue = [treeRoot];
  let visited = 0;
  while (queue.length > 0 && visited < limit) {
    const current = queue.shift();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of entries) {
      visited += 1;
      if (!dirent.isDirectory()) continue;
      const child = join(current, dirent.name);
      const manifestPath = join(child, 'package.json');
      if (existsSync(manifestPath)) {
        try {
          const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
          if (typeof parsed.name === 'string' && typeof parsed.version === 'string') {
            packages.push({ name: parsed.name, version: parsed.version, path: child, manifest: parsed });
          }
        } catch {
          /* An unparseable manifest is reported by the lockfile surface, not here. */
        }
      }
      if (dirent.name.startsWith('@') || dirent.name === 'node_modules' || existsSync(join(child, 'node_modules'))) {
        queue.push(dirent.name.startsWith('@') ? child : join(child, 'node_modules'));
      }
    }
  }
  return packages;
}

function matchText(text, patterns, networkIndicators) {
  const hits = [];
  patterns.forEach((pattern) => {
    if (new RegExp(pattern.pattern, 'i').test(text)) {
      hits.push({ id: pattern.id, description: pattern.description });
    }
  });
  networkIndicators.forEach((net) => {
    if (text.includes(net.value)) hits.push({ id: net.id, description: net.description });
  });
  return hits;
}

export function sweepInstalledTree(treeRoot, index, manifest, label) {
  const findings = [];
  collectInstalledPackages(treeRoot).forEach((pkg) => {
    const hit = index.get(`${pkg.name}@${pkg.version}`);
    if (hit) {
      findings.push({
        surface: 'installed-tree',
        indicator: `${pkg.name}@${pkg.version}`,
        incident: hit.incident,
        reference: hit.reference,
        detail: `${label} contains ${pkg.name}@${pkg.version} at ${pkg.path}`,
      });
    }
    const scripts = pkg.manifest.scripts;
    if (!isPlainObject(scripts)) return;
    LIFECYCLE_KEYS.forEach((key) => {
      const command = scripts[key];
      if (typeof command !== 'string') return;
      matchText(command, manifest.scriptPatterns, manifest.networkIndicators).forEach((hitPattern) => {
        findings.push({
          surface: 'install-hook',
          indicator: hitPattern.id,
          detail: `${pkg.name}@${pkg.version} ${key}: ${command}`,
          description: hitPattern.description,
        });
      });
    });
  });
  return findings;
}

/** Scans the npm cache index for compromised name@version pairs. */
export function sweepPackageCache(cacheRoot, index) {
  const findings = [];
  const indexRoot = join(cacheRoot, 'index-v5');
  if (!existsSync(indexRoot)) return findings;
  const queue = [indexRoot];
  const wanted = [...index.keys()];
  while (queue.length > 0) {
    const current = queue.shift();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of entries) {
      const child = join(current, dirent.name);
      if (dirent.isDirectory()) {
        queue.push(child);
        continue;
      }
      let content;
      try {
        content = readFileSync(child, 'utf8');
      } catch {
        continue;
      }
      wanted.forEach((key) => {
        const [name, version] = [key.slice(0, key.lastIndexOf('@')), key.slice(key.lastIndexOf('@') + 1)];
        if (content.includes(`${name}/-/`) && content.includes(`-${version}.tgz`)) {
          const hit = index.get(key);
          findings.push({
            surface: 'package-cache',
            indicator: key,
            incident: hit.incident,
            reference: hit.reference,
            detail: `npm cache index references ${key} (${child})`,
          });
        }
      });
    }
  }
  return findings;
}

/** Flags declared file indicators that exist, and hook configs containing indicators. */
export function sweepFilesAndHooks(roots, manifest) {
  const findings = [];
  roots.forEach(({ root, label }) => {
    manifest.fileIndicators.forEach((indicator) => {
      const absolute = resolve(root, indicator.path);
      if (!existsSync(absolute)) return;
      findings.push({
        surface: 'file-indicator',
        indicator: indicator.id,
        detail: `${label}: ${indicator.path} is present`,
        description: indicator.description,
      });
    });
    manifest.hookIndicators.forEach((indicator) => {
      const absolute = resolve(root, indicator.path);
      if (!existsSync(absolute) || !statSync(absolute).isFile()) return;
      let content;
      try {
        content = readFileSync(absolute, 'utf8');
      } catch {
        return;
      }
      matchText(content, manifest.scriptPatterns, manifest.networkIndicators).forEach((hit) => {
        findings.push({
          surface: 'hook-config',
          indicator: hit.id,
          detail: `${label}: ${indicator.path} matches ${hit.id}`,
          description: hit.description,
        });
      });
    });
  });
  return findings;
}

/** Sweeps every workspace dependency tree. @returns {{ findings, packagesScanned, treesScanned }} */
export function sweepInstalledTrees(repoRoot, index, manifest, trees = INSTALLED_TREES) {
  const findings = [];
  const treesScanned = [];
  let packagesScanned = 0;
  trees.forEach((relPath) => {
    const absolute = resolve(repoRoot, relPath);
    if (!existsSync(absolute)) return;
    const count = collectInstalledPackages(absolute).length;
    if (count === 0) return;
    packagesScanned += count;
    treesScanned.push(relPath);
    findings.push(...sweepInstalledTree(absolute, index, manifest, relPath));
  });
  return { findings, packagesScanned, treesScanned };
}

export function runSweep({
  repoRoot = REPO_ROOT,
  manifestPath = DEFAULT_MANIFEST,
  home = homedir(),
  includeCache = true,
} = {}) {
  const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
  const index = buildPackageIndex(manifest.packages);

  const locks = sweepLockfiles(repoRoot, index);
  const trees = sweepInstalledTrees(repoRoot, index, manifest);
  const findings = [
    ...locks.findings,
    ...trees.findings,
    ...sweepFilesAndHooks(
      [{ root: repoRoot, label: 'repo' }, { root: home, label: 'home' }],
      manifest,
    ),
  ];
  if (includeCache) findings.push(...sweepPackageCache(join(home, '.npm', '_cacache'), index));

  return {
    findings,
    indicatorCount: index.size,
    lockPackagesScanned: locks.packagesScanned,
    lockfilesScanned: locks.filesScanned,
    installedPackagesScanned: trees.packagesScanned,
    treesScanned: trees.treesScanned,
  };
}

function formatFinding(finding) {
  const suffix = finding.reference ? ` (${finding.reference})` : '';
  return `  [${finding.surface}] ${finding.indicator}: ${finding.detail}${suffix}`;
}

function isMainModule() {
  return process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
  try {
    const unknown = process.argv.slice(2).filter((argument) => argument !== '--skip-cache');
    if (unknown.length > 0) throw new Error(`unsupported arguments: ${unknown.join(', ')}`);
    const result = runSweep({ includeCache: !process.argv.includes('--skip-cache') });
    const rootLabel = relative(process.cwd(), REPO_ROOT).split(sep).join('/') || '.';
    // Report coverage explicitly: a clean result is only meaningful if it
    // scanned something. A sweep that selected nothing is a defect, not a pass.
    const coverage = [
      `${result.indicatorCount} package indicators`,
      `${result.lockPackagesScanned} locked packages across ${result.lockfilesScanned.length} lockfile(s)`,
      `${result.installedPackagesScanned} installed packages across ${result.treesScanned.length} tree(s)`,
    ].join('; ');

    if (result.findings.length > 0) {
      console.error(`IOC sweep FAILED for ${rootLabel}: ${result.findings.length} indicator(s) matched`);
      result.findings.forEach((finding) => console.error(formatFinding(finding)));
      console.error('This sweep is read-only. Nothing was modified or removed.');
      process.exitCode = 1;
    } else if (result.lockPackagesScanned === 0) {
      console.error(`IOC sweep INCONCLUSIVE for ${rootLabel}: no lockfile packages were scanned (${coverage})`);
      process.exitCode = 1;
    } else {
      console.log(`IOC sweep clean for ${rootLabel}: ${coverage}`);
      if (result.installedPackagesScanned === 0) {
        console.log('note: no installed dependency tree was present; lockfile coverage only');
      }
    }
  } catch (error) {
    console.error(`IOC sweep errored: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
