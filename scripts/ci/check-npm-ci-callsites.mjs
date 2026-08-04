#!/usr/bin/env node

/**
 * Guards the install-script policy at its call sites.
 *
 * `package.json` `allowScripts` plus `--strict-allow-scripts` only fail closed
 * where the flag is actually passed. An `npm ci` added to a *new* file silently
 * escapes that protection, so this check tracks which files may contain an
 * `npm ci` at all.
 *
 * Two failure modes, both deliberate:
 *
 *  1. A file containing `npm ci` that is absent from the policy -> fail. A new
 *     install site must be reviewed and classified, not discovered later.
 *  2. A policy entry marked `executable` whose `npm ci` lines lack either
 *     `--strict-allow-scripts` or `--ignore-scripts` -> fail.
 *
 * Prose mentions (comments, YAML descriptions, error strings) are classified
 * `executable: false` and exempt from the flag rule, because pattern-matching
 * prose against commands is unreliable — `use as their `npm ci --cache` target`
 * looks exactly like a command to a regex.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
const DEFAULT_POLICY = resolve(SCRIPT_DIR, 'npm-ci-callsite-policy.json');
const SAFE_FLAGS = ['--strict-allow-scripts', '--ignore-scripts'];
const NPM_CI = /npm(\s+--prefix\s+(?:"[^"]+"|'[^']+'|\S+))?\s+ci\b/;

export function parsePolicy(source) {
  const raw = typeof source === 'string' ? JSON.parse(source) : source;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('policy must be an object');
  }
  if (raw.schemaVersion !== 1) throw new Error('unsupported policy schemaVersion');
  if (!Array.isArray(raw.callsites)) throw new Error('policy.callsites must be an array');

  const seen = new Set();
  return raw.callsites.map((entry, index) => {
    const label = `callsites[${index}]`;
    if (entry === null || typeof entry !== 'object') throw new Error(`${label} must be an object`);
    if (typeof entry.file !== 'string' || entry.file.length === 0) {
      throw new Error(`${label}.file must be a non-empty string`);
    }
    if (typeof entry.executable !== 'boolean') throw new Error(`${label}.executable must be a boolean`);
    if (typeof entry.rationale !== 'string' || entry.rationale.length === 0) {
      throw new Error(`${label}.rationale must be a non-empty string`);
    }
    // Non-executable entries are exempt from the flag rule, so they need drift
    // detection instead: if a real command is added to a prose-only file, the
    // match count changes and forces a re-review.
    if (!entry.executable && !Number.isInteger(entry.expectedMatches)) {
      throw new Error(`${label}.expectedMatches must be an integer when executable is false`);
    }
    if (seen.has(entry.file)) throw new Error(`${label}.file is a duplicate: ${entry.file}`);
    seen.add(entry.file);
    return entry;
  });
}

/**
 * Paths excluded from discovery. Markdown cannot execute, and prose about
 * `npm ci` churns constantly in docs, changelogs, and task notes — tracking it
 * would bury the signal without protecting anything.
 */
const EXCLUDED_PATHSPECS = [':!*.md', ':!docs/**', ':!tasks/**'];

/** Tracked, executable-capable files containing the literal `npm ci`. */
export function discoverCallsiteFiles(repoRoot = REPO_ROOT) {
  let output;
  try {
    // Working tree, not HEAD: a call site added in this change must be caught
    // now, not after it lands.
    output = execFileSync(
      'git',
      ['grep', '-l', '--fixed-strings', 'npm ci', '--', ...EXCLUDED_PATHSPECS],
      { cwd: repoRoot, encoding: 'utf8' },
    );
  } catch (error) {
    // git grep exits 1 when there are no matches at all.
    if (error.status === 1) return [];
    throw error;
  }
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => line)
    .sort();
}

/** Strips quoted segments so log labels like "npm ci (quick)" are not read as commands. */
function stripQuoted(line) {
  return line.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''").replace(/`[^`]*`/g, '``');
}

/** Every non-comment line whose unquoted text reads as an `npm ci` invocation. */
export function findCandidateLines(content) {
  const candidates = [];
  content.split('\n').forEach((line, index) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('#')) return;
    if (!NPM_CI.test(stripQuoted(line))) return;
    candidates.push({
      line: index + 1,
      text: trimmed.slice(0, 120),
      protected: SAFE_FLAGS.some((flag) => line.includes(flag)),
    });
  });
  return candidates;
}

export function findUnprotectedLines(content) {
  return findCandidateLines(content).filter((candidate) => !candidate.protected);
}

export function evaluate(entries, discovered, readFile) {
  const problems = [];
  const byFile = new Map(entries.map((entry) => [entry.file, entry]));

  discovered.forEach((file) => {
    if (!byFile.has(file)) {
      problems.push(`unreviewed npm ci call site: ${file} — add it to npm-ci-callsite-policy.json with a rationale`);
    }
  });

  entries.forEach((entry) => {
    if (!discovered.includes(entry.file)) {
      problems.push(`stale policy entry: ${entry.file} no longer contains "npm ci" — remove it`);
      return;
    }
    const content = readFile(entry.file);
    if (!entry.executable) {
      const actual = findCandidateLines(content).length;
      if (actual !== entry.expectedMatches) {
        problems.push(
          `prose-only call site drifted: ${entry.file} now has ${actual} "npm ci" line(s), policy expects ${entry.expectedMatches} — re-review and reclassify if a real command was added`,
        );
      }
      return;
    }
    findUnprotectedLines(content).forEach((offender) => {
      problems.push(`unprotected npm ci: ${entry.file}:${offender.line}: ${offender.text}`);
    });
  });

  return problems;
}

export function runGate({ repoRoot = REPO_ROOT, policyPath = DEFAULT_POLICY } = {}) {
  const entries = parsePolicy(readFileSync(policyPath, 'utf8'));
  const discovered = discoverCallsiteFiles(repoRoot);
  const problems = evaluate(entries, discovered, (file) => readFileSync(resolve(repoRoot, file), 'utf8'));
  if (problems.length > 0) throw new Error(problems.join('\n  '));
  return {
    fileCount: discovered.length,
    executableCount: entries.filter((entry) => entry.executable).length,
  };
}

function isMainModule() {
  return process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
  try {
    const result = runGate();
    const rootLabel = relative(process.cwd(), REPO_ROOT).split(sep).join('/') || '.';
    console.log(`npm ci call-site policy passed for ${rootLabel}: ${result.fileCount} files tracked, ${result.executableCount} executable`);
  } catch (error) {
    console.error(`npm ci call-site policy failed:\n  ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
