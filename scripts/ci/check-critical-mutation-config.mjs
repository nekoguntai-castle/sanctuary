#!/usr/bin/env node

import { globSync, readFileSync } from 'node:fs';
import { dirname, matchesGlob, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SHARD_IDS,
  resolveShard,
  shardIncrementalFileName,
  shardReportFileName,
} from '../../server/scripts/mutation/shards.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

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

export function checkCriticalMutationConfig(root = REPO_ROOT) {
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
    if (shardIncrementalFileName(id) !== `.stryker-cache/critical-incremental.shard-${id}.json`) {
      fail(`shard ${id} incremental cache path is not canonical`);
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
