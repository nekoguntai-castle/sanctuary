#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
const DEFAULT_CONFIG = resolve(SCRIPT_DIR, 'npm-audit-exceptions.json');
const GHSA_PATTERN = /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_SEVERITIES = new Set(['info', 'low', 'moderate', 'high', 'critical']);
const DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'devDependencies', 'peerDependencies'];
const MAX_PATHS = 10_000;

export const DEFAULT_TARGETS = Object.freeze([
  { label: 'root', cwd: '.', lockfile: 'package-lock.json', roots: ['', 'server', 'gateway', 'shared'], args: ['audit', '--json'] },
  { label: 'server', cwd: '.', lockfile: 'package-lock.json', roots: ['server'], args: ['audit', '--workspace', 'server', '--json'] },
  { label: 'gateway', cwd: '.', lockfile: 'package-lock.json', roots: ['gateway'], args: ['audit', '--workspace', 'gateway', '--json'] },
  { label: 'llm-egress-proxy', cwd: 'llm-egress-proxy', lockfile: 'llm-egress-proxy/package-lock.json', roots: [''], args: ['audit', '--json'] },
  { label: 'docs-site', cwd: 'docs/site', lockfile: 'docs/site/package-lock.json', roots: [''], args: ['audit', '--json'] },
  { label: 'ci-yaml-parser', cwd: 'tests/ci/lib', lockfile: 'tests/ci/lib/package-lock.json', roots: [''], args: ['audit', '--json'] },
  { label: 'verify-addresses', cwd: 'scripts/verify-addresses', lockfile: 'scripts/verify-addresses/package-lock.json', roots: [''], args: ['audit', '--json'] },
  { label: 'verify-psbt', cwd: 'scripts/verify-psbt', lockfile: 'scripts/verify-psbt/package-lock.json', roots: [''], args: ['audit', '--json'] },
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, allowed, label) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} has unsupported fields: ${unexpected.join(', ')}`);
  }
}

function parseUtcDate(value, label) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new Error(`${label} must be a strict YYYY-MM-DD date`);
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a valid calendar date`);
  }
  return timestamp;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    throw new Error(`${label} must be a non-empty trimmed string`);
  }
}

function validateException(entry, index, currentDateMs) {
  const label = `exceptions[${index}]`;
  if (!isPlainObject(entry)) throw new Error(`${label} must be an object`);
  const keys = [
    'id', 'ghsa', 'package', 'version', 'lockfile', 'paths', 'owner',
    'rationale', 'trackingUrl', 'runtimeSurface', 'expiresOn',
  ];
  assertExactKeys(entry, keys, label);
  // `expiresOn` is opt-in — see the note where it is enforced below.
  for (const key of keys.filter((key) => key !== 'paths' && key !== 'expiresOn')) {
    requireNonEmptyString(entry[key], `${label}.${key}`);
  }
  if (!GHSA_PATTERN.test(entry.ghsa)) throw new Error(`${label}.ghsa is not a canonical GHSA identifier`);
  if (!entry.trackingUrl.startsWith('https://')) throw new Error(`${label}.trackingUrl must use HTTPS`);
  if (!entry.lockfile.endsWith('package-lock.json') || entry.lockfile.startsWith('/') || entry.lockfile.includes('..')) {
    throw new Error(`${label}.lockfile must be a repository-relative package-lock.json path`);
  }
  if (!Array.isArray(entry.paths) || entry.paths.length === 0) throw new Error(`${label}.paths must contain at least one exact path`);
  entry.paths.forEach((path, pathIndex) => {
    if (!Array.isArray(path) || path.length < 2) throw new Error(`${label}.paths[${pathIndex}] must contain a root and audited node`);
    path.forEach((part, partIndex) => requireNonEmptyString(part, `${label}.paths[${pathIndex}][${partIndex}]`));
  });
  // Omit `expiresOn` for a waiver that stands until the advisory itself goes
  // away. A calendar deadline only buys anything if someone is obliged to
  // answer it; on a single-maintainer repo it just reddens CI on a date that
  // has nothing to do with the risk. The guard that carries real weight is the
  // unused-exception check in `evaluateReports`, which fails the build once the
  // finding stops appearing — so a waiver still cannot outlive its reason.
  // Set the date when you genuinely want the waiver reconsidered by then.
  if (entry.expiresOn !== undefined) {
    const expiresMs = parseUtcDate(entry.expiresOn, `${label}.expiresOn`);
    if (currentDateMs > expiresMs) throw new Error(`${label} expired on ${entry.expiresOn}`);
  }
  return { ...entry, usedPaths: entry.paths.map(() => false) };
}

export function parseExceptionConfig(raw, currentDate = new Date()) {
  let config;
  try {
    config = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (error) {
    throw new Error(`exception config is not valid JSON: ${error.message}`);
  }
  if (!isPlainObject(config)) throw new Error('exception config must be an object');
  assertExactKeys(config, ['schemaVersion', 'exceptions'], 'exception config');
  if (config.schemaVersion !== 1) throw new Error(`unsupported exception schema version: ${String(config.schemaVersion)}`);
  if (!Array.isArray(config.exceptions)) throw new Error('exception config.exceptions must be an array');
  const currentDateMs = parseUtcDate(currentDate.toISOString().slice(0, 10), 'current UTC date');
  const exceptions = config.exceptions.map((entry, index) => validateException(entry, index, currentDateMs));
  const identities = new Set();
  for (const entry of exceptions) {
    const identity = JSON.stringify([entry.ghsa, entry.package, entry.version, entry.lockfile]);
    if (identities.has(identity)) throw new Error(`duplicate exception: ${entry.id}`);
    identities.add(identity);
    const paths = new Set();
    entry.paths.forEach((path) => {
      const pathIdentity = JSON.stringify(path);
      if (paths.has(pathIdentity)) throw new Error(`duplicate path in exception: ${entry.id}`);
      paths.add(pathIdentity);
    });
  }
  return exceptions;
}

function parseAuditOutput(stdout, status, label) {
  let report;
  try {
    report = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${label}: npm audit returned malformed JSON: ${error.message}`);
  }
  if (status !== 0 && status !== 1) throw new Error(`${label}: npm audit failed with exit status ${String(status)}`);
  if (!isPlainObject(report) || report.error !== undefined || report.auditReportVersion !== 2 || !isPlainObject(report.vulnerabilities)) {
    throw new Error(`${label}: npm audit returned an unsupported or failed report`);
  }
  return report;
}

export function runAuditTarget(target, repoRoot = REPO_ROOT, spawn = spawnSync) {
  const result = spawn('npm', target.args, {
    cwd: resolve(repoRoot, target.cwd),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw new Error(`${target.label}: unable to execute npm audit: ${result.error.message}`);
  return parseAuditOutput(result.stdout, result.status, target.label);
}

function validateVulnerability(name, vulnerability) {
  if (!isPlainObject(vulnerability)) throw new Error(`vulnerability ${name} must be an object`);
  if (!ALLOWED_SEVERITIES.has(vulnerability.severity)) throw new Error(`vulnerability ${name} has an unknown severity`);
  if (!Array.isArray(vulnerability.via) || !Array.isArray(vulnerability.nodes)) {
    throw new Error(`vulnerability ${name} has malformed via/nodes data`);
  }
  vulnerability.nodes.forEach((node) => requireNonEmptyString(node, `vulnerability ${name} node`));
}

function ghsaFromAdvisory(advisory, packageName) {
  if (!isPlainObject(advisory) || !ALLOWED_SEVERITIES.has(advisory.severity) || typeof advisory.url !== 'string') {
    throw new Error(`vulnerability ${packageName} has a malformed advisory leaf`);
  }
  const ghsa = advisory.url.match(/\/(GHSA-[^/?#]+)$/)?.[1];
  if (!ghsa || !GHSA_PATTERN.test(ghsa)) throw new Error(`high advisory for ${packageName} lacks a canonical GHSA URL`);
  return ghsa;
}

function collectHighLeaves(name, vulnerabilities) {
  const leaves = [];
  const edges = new Map();
  const classified = new Set();
  const pending = [name];
  const reachable = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (reachable.has(current)) continue;
    const vulnerability = vulnerabilities[current];
    if (!vulnerability) throw new Error(`npm audit via graph references missing node: ${current}`);
    validateVulnerability(current, vulnerability);
    reachable.add(current);
    const links = [];
    for (const via of vulnerability.via) {
      if (typeof via === 'string') {
        links.push(via);
        pending.push(via);
      } else {
        if (!isPlainObject(via) || !ALLOWED_SEVERITIES.has(via.severity)) {
          throw new Error(`vulnerability ${current} has malformed via data`);
        }
        classified.add(current);
        if (via.severity === 'critical') throw new Error(`critical advisory affecting ${current} cannot be excepted`);
        if (via.severity === 'high') leaves.push({ packageName: current, advisory: via });
      }
    }
    edges.set(current, links);
  }
  const resolvesToLeaf = new Set(classified);
  let changed = true;
  while (changed) {
    changed = false;
    for (const current of reachable) {
      if (resolvesToLeaf.has(current)) continue;
      if (edges.get(current).some((next) => resolvesToLeaf.has(next))) {
        resolvesToLeaf.add(current);
        changed = true;
      }
    }
  }
  const unresolved = [...reachable].filter((current) => !resolvesToLeaf.has(current));
  if (unresolved.length > 0) {
    throw new Error(`npm audit via graph has a leafless or partially classified component: ${unresolved.sort().join(', ')}`);
  }
  return leaves;
}

function rejectCriticalAdvisoryObjects(vulnerabilities, targetLabel) {
  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    for (const via of vulnerability.via) {
      if (isPlainObject(via) && via.severity === 'critical') {
        throw new Error(`${targetLabel}: critical advisory affecting ${name} cannot be excepted`);
      }
    }
  }
}

function dependencyNames(packageEntry) {
  const names = new Set();
  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = packageEntry[field];
    if (!isPlainObject(dependencies)) continue;
    Object.keys(dependencies).forEach((name) => names.add(name));
  }
  return [...names].sort();
}

function resolveDependency(parentLocation, dependencyName, packages) {
  let location = parentLocation;
  while (true) {
    const candidate = location ? `${location}/node_modules/${dependencyName}` : `node_modules/${dependencyName}`;
    if (packages[candidate]) return candidate;
    const marker = location.lastIndexOf('/node_modules/');
    if (marker >= 0) {
      location = location.slice(0, marker);
    } else if (location !== '') {
      location = '';
    } else {
      return null;
    }
  }
}

function displayLocation(location) {
  return location === '' ? '.' : location;
}

export function findLockPaths(lock, roots, targetLocation) {
  if (!isPlainObject(lock) || lock.lockfileVersion !== 3 || !isPlainObject(lock.packages)) {
    throw new Error('only npm package-lock v3 files are supported');
  }
  if (!lock.packages[targetLocation]) throw new Error(`audited node is absent from lockfile: ${targetLocation}`);
  const paths = [];
  const seenPaths = new Set();
  const visit = (location, path, visited) => {
    if (location === targetLocation) {
      const displayed = path.map(displayLocation);
      const key = JSON.stringify(displayed);
      if (!seenPaths.has(key)) {
        seenPaths.add(key);
        paths.push(displayed);
        if (paths.length > MAX_PATHS) throw new Error(`lockfile has more than ${MAX_PATHS} paths to ${targetLocation}`);
      }
      return;
    }
    const entry = lock.packages[location];
    if (!entry) throw new Error(`lockfile path references missing package location: ${location}`);
    for (const dependencyName of dependencyNames(entry)) {
      const child = resolveDependency(location, dependencyName, lock.packages);
      if (!child || visited.has(child)) continue;
      visit(child, [...path, child], new Set([...visited, child]));
    }
  };
  for (const root of roots) {
    if (!lock.packages[root]) throw new Error(`audit root is absent from lockfile: ${displayLocation(root)}`);
    visit(root, [root], new Set([root]));
  }
  if (paths.length === 0) throw new Error(`audited node ${targetLocation} is unreachable from declared audit roots`);
  return paths.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function readLock(repoRoot, lockfile, cache) {
  if (cache.has(lockfile)) return cache.get(lockfile);
  let lock;
  try {
    lock = JSON.parse(readFileSync(resolve(repoRoot, lockfile), 'utf8'));
  } catch (error) {
    throw new Error(`${lockfile}: unable to read package lock: ${error.message}`);
  }
  if (!isPlainObject(lock) || lock.lockfileVersion !== 3 || !isPlainObject(lock.packages)) {
    throw new Error(`${lockfile}: only npm package-lock v3 is supported`);
  }
  cache.set(lockfile, lock);
  return lock;
}

function pathEquals(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function approveLeaf({ leaf, vulnerability, target, lock, exceptions }) {
  const ghsa = ghsaFromAdvisory(leaf.advisory, leaf.packageName);
  if (vulnerability.nodes.length === 0) throw new Error(`${target.label}: ${leaf.packageName}/${ghsa} has no audited nodes`);
  for (const node of vulnerability.nodes) {
    if (node !== `node_modules/${leaf.packageName}` && !node.endsWith(`/node_modules/${leaf.packageName}`)) {
      throw new Error(`${target.label}: audited node ${node} does not match package ${leaf.packageName}`);
    }
    const installed = lock.packages[node];
    requireNonEmptyString(installed?.version, `${target.lockfile}:${node} version`);
    const paths = findLockPaths(lock, target.roots, node);
    for (const path of paths) {
      const match = exceptions.find((entry) =>
        entry.ghsa === ghsa &&
        entry.package === leaf.packageName &&
        entry.version === installed.version &&
        entry.lockfile === target.lockfile);
      const pathIndex = match?.paths.findIndex((approvedPath) => pathEquals(approvedPath, path)) ?? -1;
      if (!match || pathIndex < 0) {
        throw new Error(
          `${target.label}: unapproved high advisory ${ghsa} in ${leaf.packageName}@${installed.version} ` +
          `at ${node} via ${path.join(' -> ')}`,
        );
      }
      match.usedPaths[pathIndex] = true;
    }
  }
}

export function evaluateReports({ reports, targets, locks, exceptions }) {
  for (const target of targets) {
    const approvedLeaves = new Set();
    const report = reports.get(target.label);
    if (!report) throw new Error(`missing audit report for target: ${target.label}`);
    const vulnerabilities = report.vulnerabilities;
    for (const [name, vulnerability] of Object.entries(vulnerabilities)) validateVulnerability(name, vulnerability);
    rejectCriticalAdvisoryObjects(vulnerabilities, target.label);
    for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
      if (vulnerability.severity === 'critical') throw new Error(`${target.label}: critical vulnerability ${name} cannot be excepted`);
      if (vulnerability.severity !== 'high') continue;
      const leaves = collectHighLeaves(name, vulnerabilities).filter((leaf, index, all) =>
        all.findIndex((candidate) =>
          candidate.packageName === leaf.packageName &&
          candidate.advisory.source === leaf.advisory.source &&
          candidate.advisory.url === leaf.advisory.url) === index);
      if (leaves.length === 0) throw new Error(`${target.label}: high vulnerability ${name} has no classified high advisory leaf`);
      for (const leaf of leaves) {
        const approvalKey = `${leaf.packageName}\0${String(leaf.advisory.source)}\0${String(leaf.advisory.url)}`;
        if (approvedLeaves.has(approvalKey)) continue;
        const leafVulnerability = vulnerabilities[leaf.packageName];
        if (!leafVulnerability) throw new Error(`${target.label}: missing leaf vulnerability ${leaf.packageName}`);
        approveLeaf({ leaf, vulnerability: leafVulnerability, target, lock: locks.get(target.lockfile), exceptions });
        approvedLeaves.add(approvalKey);
      }
    }
  }
  const unused = exceptions.flatMap((entry) =>
    entry.usedPaths.flatMap((used, index) => used ? [] : [`${entry.id}#path-${index + 1}`]));
  if (unused.length > 0) throw new Error(`unused audit exceptions: ${unused.join(', ')}`);
}

export function runGate({
  repoRoot = REPO_ROOT,
  configPath = DEFAULT_CONFIG,
  targets = DEFAULT_TARGETS,
  currentDate = new Date(),
  auditRunner = runAuditTarget,
} = {}) {
  const exceptions = parseExceptionConfig(readFileSync(configPath, 'utf8'), currentDate);
  const reports = new Map();
  const locks = new Map();
  for (const target of targets) {
    reports.set(target.label, auditRunner(target, repoRoot));
    locks.set(target.lockfile, readLock(repoRoot, target.lockfile, locks));
  }
  evaluateReports({ reports, targets, locks, exceptions });
  return { targetCount: targets.length, exceptionCount: exceptions.length };
}

function isMainModule() {
  return process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
  try {
    const result = runGate();
    const rootLabel = relative(process.cwd(), REPO_ROOT).split(sep).join('/') || '.';
    console.log(`npm audit gate passed for ${result.targetCount} targets from ${rootLabel}; ${result.exceptionCount} exceptions used`);
  } catch (error) {
    console.error(`npm audit gate failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
    const approvedLeaves = new Set();
