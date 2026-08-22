#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SHARD_IDS,
  resolveShard,
  shardIncrementalFileName,
  shardReportFileName,
} from '../../server/scripts/mutation/shards.mjs';

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

export function checkCriticalMutationConfig(root = REPO_ROOT) {
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  checkCriticalMutationConfig();
  process.stdout.write('critical mutation configuration is complete and non-vacuous\n');
}
