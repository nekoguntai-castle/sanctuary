import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { checkCriticalMutationConfig } from '../../scripts/ci/check-critical-mutation-config.mjs';
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
