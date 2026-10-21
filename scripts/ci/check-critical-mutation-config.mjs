#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, globSync, readFileSync, statSync } from 'node:fs';
import { dirname, matchesGlob, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CRITICAL_TEST_FILES,
  SHARD_IDS,
  resolveShard,
  shardReportFileName,
} from '../../server/scripts/mutation/shards.mjs';
import criticalConfig from '../../server/stryker.critical.config.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// The critical test inputs: the entries, the Vitest setup file
// (server/vitest.config.ts setupFiles) and every server/tests/ file they import.
const TEST_TREE = 'server/tests/';
const TEST_SETUP_FILE = 'server/tests/setup.ts';
const VITEST_CONFIG = 'server/vitest.config.ts';
// The @fixtures alias of server/vitest.config.ts.
const FIXTURES_ALIAS = '@fixtures/';
const FIXTURES_DIR = 'server/tests/fixtures/';
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts'];
// The specifier pattern of tests/ci/renderHarnessInputsClassified.test.ts,
// extended to the @fixtures/ alias.
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"`])((?:\.{1,2}|@fixtures)\/[^'"`]*?)\1/g;

function fail(message) {
  throw new Error(`critical mutation configuration: ${message}`);
}

function positivePatterns(patterns) {
  return patterns.filter(pattern => !pattern.startsWith('!'));
}

function assertUnique(values, description) {
  if (new Set(values).size !== values.length) {
    fail(`${description} must be unique`);
  }
}

function assertSameMembers(actual, expected, description) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    fail(`${description} does not match the canonical all-shards configuration`);
  }
}

function readBaseline(root) {
  const path = resolve(root, '.github/mutation-baseline.json');
  return JSON.parse(readFileSync(path, 'utf8'));
}

function isScore(value) {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

// Resolve mutate patterns the way Stryker 10 applies them (project-reader's
// resolveFileDescriptions): patterns apply in order, a positive glob marks a
// file for mutation and a later `!` glob clears it, so a positive after a
// negation re-adds the file.
function resolveMutateFiles(serverRoot, patterns) {
  const candidates = new Set(
    positivePatterns(patterns).flatMap(pattern => globSync(pattern, { cwd: serverRoot })),
  );
  return [...candidates].filter(file => patterns.reduce(
    (mutated, pattern) => (pattern.startsWith('!')
      ? mutated && !matchesGlob(file, pattern.slice(1))
      : mutated || matchesGlob(file, pattern)),
    false,
  )).sort();
}

// Pattern strings alone cannot show that shards split real files cleanly once
// a shard excludes part of another shard's glob. Every file the full run would
// mutate must be mutated by exactly one shard, and no shard may be empty.
export function assertShardFilePartition(serverRoot, shardMutates, allMutate) {
  const owners = new Map();
  for (const [id, patterns] of Object.entries(shardMutates)) {
    const files = resolveMutateFiles(serverRoot, patterns);
    if (files.length === 0) fail(`shard ${id} resolves to no files`);
    for (const file of files) {
      if (owners.has(file)) fail(`${file} is mutated by shards ${owners.get(file)} and ${id}`);
      owners.set(file, id);
    }
  }
  const allFiles = new Set(resolveMutateFiles(serverRoot, allMutate));
  for (const file of allFiles) {
    if (!owners.has(file)) fail(`${file} is in the full mutate set but in no shard`);
  }
  for (const file of owners.keys()) {
    if (!allFiles.has(file)) fail(`${file} is mutated by a shard but not by the full run`);
  }
}

export function assertNonIncrementalCriticalConfig(config) {
  if (config.incremental !== false || 'incrementalFile' in config) {
    fail('the critical gate must not reuse incremental results');
  }
}

function isFile(relative) {
  const absolute = resolve(REPO_ROOT, relative);
  return existsSync(absolute) && statSync(absolute).isFile();
}

// Repository-relative target of a specifier, before resolution.
function specifierTarget(fromFile, specifier) {
  if (specifier.startsWith(FIXTURES_ALIAS)) {
    return `${FIXTURES_DIR}${specifier.slice(FIXTURES_ALIAS.length)}`;
  }
  return posix.join(posix.dirname(fromFile), specifier);
}

// Only test-tree targets are followed. Anything else (server/src, including the
// untracked generated Prisma client neither CI lane generates) is dropped
// before resolution; an unresolvable test-tree target is an error.
function testTreeImports(file) {
  const source = readFileSync(resolve(REPO_ROOT, file), 'utf8');
  const targets = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const target = specifierTarget(file, match[2]);
    if (!target.startsWith(TEST_TREE)) continue;
    const resolved = RESOLVE_SUFFIXES.map(suffix => `${target}${suffix}`).find(isFile);
    if (resolved === undefined) fail(`unresolved import ${match[2]} in ${file}`);
    targets.push(resolved);
  }
  return targets;
}

export function criticalTestInputs() {
  const seen = new Set();
  const queue = [...CRITICAL_TEST_FILES.map(file => `server/${file}`), TEST_SETUP_FILE];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...testTreeImports(file));
  }
  return [...seen, VITEST_CONFIG].sort();
}

const CLASSIFY_SCRIPT = `. scripts/ci/classify-files-lib.sh
while IFS= read -r p; do
  is_critical_mutation_file "$p" || printf '%s\\n' "$p"
done
`;

/** One bash call that sources the classifier library and prints the inputs `is_critical_mutation_file` rejects. */
export function unclassifiedCriticalTestInputs() {
  const output = execFileSync('bash', ['-c', CLASSIFY_SCRIPT], {
    cwd: REPO_ROOT,
    input: `${criticalTestInputs().join('\n')}\n`,
    encoding: 'utf8',
  });
  return output.split('\n').filter(Boolean);
}

export function checkCriticalMutationConfig(
  root = REPO_ROOT,
  config = criticalConfig,
  listUnclassified = unclassifiedCriticalTestInputs,
) {
  assertNonIncrementalCriticalConfig(config);
  const unclassified = listUnclassified();
  if (unclassified.length > 0) {
    fail(`critical test inputs do not select the critical lane (is_critical_mutation_file in scripts/ci/classify-files-lib.sh):\n  ${unclassified.join('\n  ')}`);
  }

  const sourceRoot = resolve(REPO_ROOT, 'server');
  if (SHARD_IDS.length === 0) fail('no shards are configured');
  assertUnique(SHARD_IDS, 'shard IDs');

  const shards = SHARD_IDS.map(id => resolveShard(String(id)));
  assertUnique(shards.map(shard => shard.label), 'shard labels');

  const shardPatterns = shards.flatMap(shard => positivePatterns(shard.mutate));
  assertUnique(shardPatterns, 'positive mutation patterns across shards');
  assertSameMembers(
    shardPatterns,
    positivePatterns(resolveShard('all').mutate),
    'combined shard mutation patterns',
  );
  assertShardFilePartition(
    sourceRoot,
    Object.fromEntries(shards.map(shard => [shard.id, shard.mutate])),
    resolveShard('all').mutate,
  );

  for (const id of SHARD_IDS) {
    if (shardReportFileName(id) !== `reports/mutation/critical-mutation-report.shard-${id}.json`) {
      fail(`shard ${id} report path is not canonical`);
    }
  }

  const baseline = readBaseline(root)?.serverCritical;
  if (!baseline || !isScore(baseline.rawScoreMin)
    || !isScore(baseline.weightedScoreMin)) {
    fail('serverCritical baseline thresholds are missing or invalid');
  }
}

if (isMainModule(import.meta.url)) {
  checkCriticalMutationConfig();
  process.stdout.write('critical mutation configuration is complete and non-vacuous\n');
}
