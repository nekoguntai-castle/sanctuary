import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertShardFilePartition,
  checkCriticalMutationConfig,
} from '../../scripts/ci/check-critical-mutation-config.mjs';
import { criticalMutationReporters } from '../../server/stryker.critical.config.mjs';

function fixtureRoot(baseline) {
  const root = mkdtempSync(join(tmpdir(), 'critical-mutation-config-'));
  mkdirSync(join(root, '.github'));
  writeFileSync(join(root, '.github/mutation-baseline.json'), JSON.stringify(baseline));
  return root;
}

test('accepts the repository mutation baseline and shard contract', () => {
  const root = fixtureRoot({
    serverCritical: { rawScoreMin: 80, weightedScoreMin: 85 },
  });

  assert.doesNotThrow(() => checkCriticalMutationConfig(root));
});

test('retains HTML for local full runs but not numbered shards', () => {
  assert.deepEqual(criticalMutationReporters('all'), ['clear-text', 'progress', 'json', 'html']);
  for (const shard of ['1', '2', '3']) {
    assert.deepEqual(criticalMutationReporters(shard), ['clear-text', 'progress', 'json']);
  }
});

test('wires the resolved shard into the reporter policy', () => {
  const script = [
    "import config from './server/stryker.critical.config.mjs';",
    'process.stdout.write(JSON.stringify(config.reporters));',
  ].join(' ');

  for (const [shard, expected] of [
    ['all', ['clear-text', 'progress', 'json', 'html']],
    ['1', ['clear-text', 'progress', 'json']],
    ['2', ['clear-text', 'progress', 'json']],
    ['3', ['clear-text', 'progress', 'json']],
  ]) {
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: join(import.meta.dirname, '../..'),
      encoding: 'utf8',
      env: { ...process.env, MUTATION_SHARD: shard },
    });
    assert.deepEqual(JSON.parse(output), expected);
  }
});

test('rejects a missing server critical baseline', () => {
  const root = fixtureRoot({});

  assert.throws(
    () => checkCriticalMutationConfig(root),
    /serverCritical baseline thresholds are missing or invalid/,
  );
});

test('rejects a null mutation baseline document', () => {
  const root = fixtureRoot(null);

  assert.throws(
    () => checkCriticalMutationConfig(root),
    /serverCritical baseline thresholds are missing or invalid/,
  );
});

test('rejects non-numeric server critical thresholds', () => {
  const root = fixtureRoot({
    serverCritical: { rawScoreMin: '80', weightedScoreMin: 85 },
  });

  assert.throws(
    () => checkCriticalMutationConfig(root),
    /serverCritical baseline thresholds are missing or invalid/,
  );
});

test('rejects server critical thresholds outside the score domain', () => {
  const root = fixtureRoot({
    serverCritical: { rawScoreMin: -1, weightedScoreMin: 101 },
  });

  assert.throws(
    () => checkCriticalMutationConfig(root),
    /serverCritical baseline thresholds are missing or invalid/,
  );
});

function sourceFixture() {
  const root = mkdtempSync(join(tmpdir(), 'critical-mutation-sources-'));
  for (const file of ['src/a.ts', 'src/b.ts', 'src/dir/x.ts', 'src/dir/y.ts', 'src/dir/z.d.ts']) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), '');
  }
  return root;
}

const ALL = ['src/a.ts', 'src/b.ts', 'src/dir/**/*.ts', 'src/dir/x.ts', '!src/**/*.d.ts'];

test('accepts shards that split a glob with a negation', () => {
  assert.doesNotThrow(() => assertShardFilePartition(sourceFixture(), {
    1: ['src/dir/x.ts', 'src/a.ts'],
    2: ['src/dir/**/*.ts', '!src/dir/x.ts', 'src/b.ts', '!src/**/*.d.ts'],
  }, ALL));
});

test('rejects a file mutated by two shards', () => {
  assert.throws(() => assertShardFilePartition(sourceFixture(), {
    1: ['src/dir/x.ts', 'src/a.ts'],
    2: ['src/dir/**/*.ts', 'src/b.ts', '!src/**/*.d.ts'],
  }, ALL), /src\/dir\/x\.ts is mutated by shards 1 and 2/);
});

test('rejects a file the full run mutates but no shard does', () => {
  assert.throws(() => assertShardFilePartition(sourceFixture(), {
    1: ['src/dir/x.ts', 'src/a.ts'],
    2: ['src/dir/**/*.ts', '!src/dir/x.ts', '!src/**/*.d.ts'],
  }, ALL), /src\/b\.ts is in the full mutate set but in no shard/);
});

test('rejects a shard file outside the full run and an empty shard', () => {
  assert.throws(() => assertShardFilePartition(sourceFixture(), {
    1: ['src/dir/x.ts', 'src/a.ts', 'src/dir/z.d.ts'],
    2: ['src/dir/**/*.ts', '!src/dir/x.ts', 'src/b.ts', '!src/**/*.d.ts'],
  }, ALL), /src\/dir\/z\.d\.ts is mutated by a shard but not by the full run/);
  assert.throws(() => assertShardFilePartition(sourceFixture(), {
    1: ['src/missing/*.ts'],
  }, ALL), /shard 1 resolves to no files/);
});

test('applies mutate patterns in order, as Stryker does', () => {
  // A positive after a negation re-adds the file, so shard 2 overlaps shard 1.
  assert.throws(() => assertShardFilePartition(sourceFixture(), {
    1: ['src/dir/x.ts', 'src/a.ts'],
    2: ['src/dir/**/*.ts', '!src/dir/x.ts', 'src/dir/*.ts', 'src/b.ts', '!src/**/*.d.ts'],
  }, ALL), /src\/dir\/x\.ts is mutated by shards 1 and 2/);
});
