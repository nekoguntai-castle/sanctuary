#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
const DEFAULT_POLICY = resolve(SCRIPT_DIR, 'npm-install-script-policy.json');
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_REVIEW_DAYS = 90;
const ENTRY_KEYS = [
  'location', 'package', 'version', 'scripts', 'allowed', 'optional', 'owner',
  'rationale', 'reviewOn',
];
const LIFECYCLE_KEYS = ['preinstall', 'install', 'postinstall'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value);
  const missing = expected.filter((key) => !actual.includes(key));
  const unexpected = actual.filter((key) => !expected.includes(key));
  if (missing.length > 0) throw new Error(`${label} is missing fields: ${missing.join(', ')}`);
  if (unexpected.length > 0) throw new Error(`${label} has unsupported fields: ${unexpected.join(', ')}`);
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    throw new Error(`${label} must be a non-empty trimmed string`);
  }
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

function validateScripts(value, label) {
  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    throw new Error(`${label} must contain at least one lifecycle command`);
  }
  const unexpected = Object.keys(value).filter((key) => !LIFECYCLE_KEYS.includes(key));
  if (unexpected.length > 0) throw new Error(`${label} has unsupported lifecycle fields: ${unexpected.join(', ')}`);
  Object.entries(value).forEach(([key, command]) => requireString(command, `${label}.${key}`));
  return { ...value };
}

function validateEntry(entry, index, currentDateMs) {
  const label = `entries[${index}]`;
  if (!isPlainObject(entry)) throw new Error(`${label} must be an object`);
  assertExactKeys(entry, ENTRY_KEYS, label);
  for (const key of ['location', 'package', 'version', 'owner', 'rationale']) requireString(entry[key], `${label}.${key}`);
  if (!entry.location.startsWith('node_modules/') || entry.location.includes('..')) {
    throw new Error(`${label}.location must be a lockfile node_modules location`);
  }
  if (typeof entry.allowed !== 'boolean') throw new Error(`${label}.allowed must be a boolean`);
  if (typeof entry.optional !== 'boolean') throw new Error(`${label}.optional must be a boolean`);
  validateReviewDate(entry.reviewOn, `${label}.reviewOn`, currentDateMs);
  return { ...entry, scripts: validateScripts(entry.scripts, `${label}.scripts`) };
}

export function parsePolicy(raw, currentDate = new Date()) {
  let policy;
  try {
    policy = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (error) {
    throw new Error(`policy is not valid JSON: ${error.message}`);
  }
  if (!isPlainObject(policy)) throw new Error('policy must be an object');
  assertExactKeys(policy, ['schemaVersion', 'entries'], 'policy');
  if (policy.schemaVersion !== 1) throw new Error(`unsupported policy schema version: ${String(policy.schemaVersion)}`);
  if (!Array.isArray(policy.entries)) throw new Error('policy.entries must be an array');
  const todayMs = parseUtcDate(currentDate.toISOString().slice(0, 10), 'current UTC date');
  const entries = policy.entries.map((entry, index) => validateEntry(entry, index, todayMs));
  const locations = new Set();
  for (const entry of entries) {
    if (locations.has(entry.location)) throw new Error(`duplicate policy location: ${entry.location}`);
    locations.add(entry.location);
  }
  return entries;
}

export function packageNameFromLocation(location) {
  const marker = '/node_modules/';
  const nestedIndex = location.lastIndexOf(marker);
  const tail = nestedIndex >= 0 ? location.slice(nestedIndex + marker.length) : location.slice('node_modules/'.length);
  const parts = tail.split('/');
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1] ?? ''}` : parts[0];
}

export function collectInstallScripts(lock) {
  if (!isPlainObject(lock) || lock.lockfileVersion !== 3 || !isPlainObject(lock.packages)) {
    throw new Error('package-lock.json must be an npm package-lock v3 file');
  }
  const records = [];
  for (const [location, metadata] of Object.entries(lock.packages)) {
    if (!location.startsWith('node_modules/') || !isPlainObject(metadata) || metadata.hasInstallScript !== true) continue;
    requireString(metadata.version, `package-lock.json:${location}.version`);
    records.push({
      location,
      package: packageNameFromLocation(location),
      version: metadata.version,
      optional: metadata.optional === true,
    });
  }
  return records.sort((a, b) => a.location.localeCompare(b.location));
}

export function evaluateInventory(records, entries) {
  const policyByLocation = new Map(entries.map((entry) => [entry.location, entry]));
  for (const record of records) {
    const entry = policyByLocation.get(record.location);
    if (!entry) throw new Error(`unapproved npm install script: ${record.location} ${record.package}@${record.version}`);
    for (const field of ['package', 'version', 'optional']) {
      if (entry[field] !== record[field]) throw new Error(`npm install-script ${field} drift at ${record.location}`);
    }
    policyByLocation.delete(record.location);
  }
  if (policyByLocation.size > 0) {
    throw new Error(`stale npm install-script policy locations: ${[...policyByLocation.keys()].join(', ')}`);
  }
}

export function expectedAllowScripts(entries) {
  const expected = {};
  for (const entry of entries) {
    const key = entry.allowed ? `${entry.package}@${entry.version}` : entry.package;
    if (key in expected && expected[key] !== entry.allowed) throw new Error(`conflicting allowScripts policy for ${key}`);
    expected[key] = entry.allowed;
  }
  return Object.fromEntries(Object.entries(expected).sort(([left], [right]) => left.localeCompare(right)));
}

export function evaluateAllowScripts(actual, entries) {
  if (!isPlainObject(actual)) throw new Error('package.json.allowScripts must be an object');
  const expected = expectedAllowScripts(entries);
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected);
  const missing = expectedKeys.filter((key) => !(key in actual));
  const unexpected = actualKeys.filter((key) => !(key in expected));
  if (missing.length > 0) throw new Error(`package.json.allowScripts is missing entries: ${missing.join(', ')}`);
  if (unexpected.length > 0) throw new Error(`package.json.allowScripts has unapproved entries: ${unexpected.join(', ')}`);
  for (const key of expectedKeys) {
    if (actual[key] !== expected[key]) throw new Error(`package.json.allowScripts value drift for ${key}`);
  }
}

function readInstalledPackage(repoRoot, entry) {
  const packagePath = resolve(repoRoot, entry.location, 'package.json');
  try {
    return JSON.parse(readFileSync(packagePath, 'utf8'));
  } catch (error) {
    if (entry.optional && error.code === 'ENOENT') return undefined;
    throw new Error(`unable to read installed ${entry.location}/package.json: ${error.message}`);
  }
}

export function verifyInstalledPackages(entries, repoRoot = REPO_ROOT) {
  for (const entry of entries) {
    const installed = readInstalledPackage(repoRoot, entry);
    if (!installed) continue;
    if (installed.name !== entry.package) throw new Error(`installed package name drift at ${entry.location}`);
    if (installed.version !== entry.version) throw new Error(`installed package version drift at ${entry.location}`);
    const actualScripts = Object.fromEntries(LIFECYCLE_KEYS.flatMap((key) =>
      installed.scripts?.[key] === undefined ? [] : [[key, installed.scripts[key]]]));
    const expectedKeys = Object.keys(entry.scripts);
    const actualKeys = Object.keys(actualScripts);
    if (expectedKeys.length !== actualKeys.length || expectedKeys.some((key) => actualScripts[key] !== entry.scripts[key])) {
      throw new Error(`installed lifecycle command drift at ${entry.location}`);
    }
  }
}

export function runGate({
  repoRoot = REPO_ROOT,
  policyPath = DEFAULT_POLICY,
  currentDate = new Date(),
  verifyInstalled = false,
} = {}) {
  const entries = parsePolicy(readFileSync(policyPath, 'utf8'), currentDate);
  const lock = JSON.parse(readFileSync(resolve(repoRoot, 'package-lock.json'), 'utf8'));
  const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
  const records = collectInstallScripts(lock);
  evaluateInventory(records, entries);
  evaluateAllowScripts(packageJson.allowScripts, entries);
  if (verifyInstalled) verifyInstalledPackages(entries, repoRoot);
  return { packageCount: records.length, allowedCount: entries.filter((entry) => entry.allowed).length };
}

function isMainModule() {
  return process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
  try {
    const unknownArgs = process.argv.slice(2).filter((argument) => argument !== '--verify-installed');
    if (unknownArgs.length > 0) throw new Error(`unsupported arguments: ${unknownArgs.join(', ')}`);
    const result = runGate({ verifyInstalled: process.argv.includes('--verify-installed') });
    const rootLabel = relative(process.cwd(), REPO_ROOT).split(sep).join('/') || '.';
    console.log(`npm install-script policy passed for ${result.packageCount} packages from ${rootLabel}; ${result.allowedCount} version-pinned scripts allowed`);
  } catch (error) {
    console.error(`npm install-script policy failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
