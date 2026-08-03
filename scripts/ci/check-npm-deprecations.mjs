#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { DEFAULT_TARGETS } from './npm-audit-gate.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
const DEFAULT_CONFIG = resolve(SCRIPT_DIR, 'npm-deprecation-allowlist.json');
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_REVIEW_DAYS = 90;
const ENTRY_KEYS = [
  'id', 'package', 'version', 'lockfile', 'locations', 'message', 'owner',
  'directOwners', 'dependencyPaths', 'rationale', 'upstreamIssue', 'reviewOn',
];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, allowed, label) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) throw new Error(`${label} has unsupported fields: ${unexpected.join(', ')}`);
  const missing = allowed.filter((key) => !(key in value));
  if (missing.length > 0) throw new Error(`${label} is missing fields: ${missing.join(', ')}`);
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    throw new Error(`${label} must be a non-empty trimmed string`);
  }
}

function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must contain at least one string`);
  value.forEach((item, index) => requireString(item, `${label}[${index}]`));
  if (new Set(value).size !== value.length) throw new Error(`${label} contains duplicates`);
}

function parseUtcDate(value, label) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) throw new Error(`${label} must be a strict YYYY-MM-DD date`);
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a valid calendar date`);
  }
  return timestamp;
}

function validateReviewDate(value, label, currentDateMs) {
  const reviewMs = parseUtcDate(value, label);
  const dayMs = 86_400_000;
  if (currentDateMs > reviewMs) throw new Error(`${label} expired on ${value}`);
  if (reviewMs - currentDateMs > MAX_REVIEW_DAYS * dayMs) {
    throw new Error(`${label} is more than ${MAX_REVIEW_DAYS} days from the current UTC date`);
  }
}

function validateEntry(entry, index, currentDateMs) {
  const label = `entries[${index}]`;
  if (!isPlainObject(entry)) throw new Error(`${label} must be an object`);
  assertExactKeys(entry, ENTRY_KEYS, label);
  for (const key of ['id', 'package', 'version', 'lockfile', 'message', 'owner', 'rationale', 'upstreamIssue']) {
    requireString(entry[key], `${label}.${key}`);
  }
  for (const key of ['locations', 'directOwners', 'dependencyPaths']) requireStringArray(entry[key], `${label}.${key}`);
  if (entry.lockfile.startsWith('/') || entry.lockfile.includes('..') || !entry.lockfile.endsWith('package-lock.json')) {
    throw new Error(`${label}.lockfile must be a repository-relative package-lock.json path`);
  }
  if (!entry.upstreamIssue.startsWith('https://')) throw new Error(`${label}.upstreamIssue must use HTTPS`);
  entry.locations.forEach((location) => {
    if (!location.startsWith('node_modules/')) throw new Error(`${label}.locations must be lockfile node_modules locations`);
  });
  validateReviewDate(entry.reviewOn, `${label}.reviewOn`, currentDateMs);
  return { ...entry, usedLocations: entry.locations.map(() => false) };
}

export function parseAllowlist(raw, currentDate = new Date()) {
  let config;
  try {
    config = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (error) {
    throw new Error(`allowlist is not valid JSON: ${error.message}`);
  }
  if (!isPlainObject(config)) throw new Error('allowlist must be an object');
  assertExactKeys(config, ['schemaVersion', 'entries'], 'allowlist');
  if (config.schemaVersion !== 1) throw new Error(`unsupported allowlist schema version: ${String(config.schemaVersion)}`);
  if (!Array.isArray(config.entries)) throw new Error('allowlist.entries must be an array');
  const todayMs = parseUtcDate(currentDate.toISOString().slice(0, 10), 'current UTC date');
  const entries = config.entries.map((entry, index) => validateEntry(entry, index, todayMs));
  const ids = new Set();
  const identities = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`duplicate allowlist id: ${entry.id}`);
    ids.add(entry.id);
    entry.locations.forEach((location) => {
      const identity = JSON.stringify([entry.lockfile, location]);
      if (identities.has(identity)) throw new Error(`duplicate allowlist location: ${entry.lockfile}:${location}`);
      identities.add(identity);
    });
  }
  return entries;
}

export function packageNameFromLocation(location) {
  const marker = '/node_modules/';
  const nestedIndex = location.lastIndexOf(marker);
  const tail = nestedIndex >= 0
    ? location.slice(nestedIndex + marker.length)
    : location.slice('node_modules/'.length);
  const parts = tail.split('/');
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1] ?? ''}` : parts[0];
}

export function collectDeprecations(lock, lockfile) {
  if (!isPlainObject(lock) || lock.lockfileVersion !== 3 || !isPlainObject(lock.packages)) {
    throw new Error(`${lockfile} must be an npm package-lock v3 file`);
  }
  const records = [];
  for (const [location, metadata] of Object.entries(lock.packages)) {
    if (!isPlainObject(metadata) || metadata.deprecated === undefined) continue;
    requireString(metadata.version, `${lockfile}:${location}.version`);
    requireString(metadata.deprecated, `${lockfile}:${location}.deprecated`);
    records.push({
      lockfile,
      location,
      package: packageNameFromLocation(location),
      version: metadata.version,
      message: metadata.deprecated,
    });
  }
  return records.sort((a, b) => `${a.lockfile}:${a.location}`.localeCompare(`${b.lockfile}:${b.location}`));
}

export function evaluateInventory(records, entries) {
  for (const record of records) {
    const entry = entries.find((candidate) => candidate.lockfile === record.lockfile && candidate.locations.includes(record.location));
    if (!entry) throw new Error(`unapproved npm deprecation: ${record.lockfile}:${record.location} ${record.package}@${record.version}`);
    for (const field of ['package', 'version', 'message']) {
      if (entry[field] !== record[field]) {
        throw new Error(`npm deprecation ${field} drift at ${record.lockfile}:${record.location}`);
      }
    }
    entry.usedLocations[entry.locations.indexOf(record.location)] = true;
  }
  const unused = entries.flatMap((entry) => entry.usedLocations.flatMap((used, index) =>
    used ? [] : [`${entry.id}:${entry.locations[index]}`]));
  if (unused.length > 0) throw new Error(`unused npm deprecation allowlist entries: ${unused.join(', ')}`);
}

function warningIdentity(record) {
  return JSON.stringify([record.package, record.version, record.message]);
}

function countByIdentity(records) {
  const counts = new Map();
  records.forEach((record) => counts.set(warningIdentity(record), (counts.get(warningIdentity(record)) ?? 0) + 1));
  return counts;
}

export function parseNpmInstallLog(output) {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^npm warn deprecated (.+)@([^:]+): (.+)$/);
    return match ? [{ package: match[1], version: match[2], message: match[3] }] : [];
  });
}

export function evaluateInstallLog(records, output) {
  const expected = countByIdentity(records.filter((record) => record.lockfile === 'package-lock.json'));
  const actual = countByIdentity(parseNpmInstallLog(output));
  const identities = new Set([...expected.keys(), ...actual.keys()]);
  for (const identity of identities) {
    if ((expected.get(identity) ?? 0) !== (actual.get(identity) ?? 0)) {
      throw new Error(`clean npm install deprecation drift for ${identity}: expected ${expected.get(identity) ?? 0}, found ${actual.get(identity) ?? 0}`);
    }
  }
}

function canonicalLockfiles(targets) {
  return [...new Set(targets.map((target) => target.lockfile))];
}

export function runGate({
  repoRoot = REPO_ROOT,
  configPath = DEFAULT_CONFIG,
  targets = DEFAULT_TARGETS,
  currentDate = new Date(),
  installLogPath,
} = {}) {
  const entries = parseAllowlist(readFileSync(configPath, 'utf8'), currentDate);
  const lockfiles = canonicalLockfiles(targets);
  const records = lockfiles.flatMap((lockfile) => {
    let lock;
    try {
      lock = JSON.parse(readFileSync(resolve(repoRoot, lockfile), 'utf8'));
    } catch (error) {
      throw new Error(`unable to read ${lockfile}: ${error.message}`);
    }
    return collectDeprecations(lock, lockfile);
  });
  evaluateInventory(records, entries);
  if (installLogPath) evaluateInstallLog(records, readFileSync(installLogPath, 'utf8'));
  return { lockfileCount: lockfiles.length, deprecationCount: records.length };
}

function isMainModule() {
  return process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
  try {
    const installLogFlag = process.argv.indexOf('--install-log');
    if (installLogFlag >= 0 && !process.argv[installLogFlag + 1]) throw new Error('--install-log requires a path');
    const result = runGate({ installLogPath: installLogFlag >= 0 ? process.argv[installLogFlag + 1] : undefined });
    const rootLabel = relative(process.cwd(), REPO_ROOT).split(sep).join('/') || '.';
    console.log(`npm deprecation inventory passed for ${result.lockfileCount} lockfiles from ${rootLabel}; ${result.deprecationCount} exact records approved`);
  } catch (error) {
    console.error(`npm deprecation inventory failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
