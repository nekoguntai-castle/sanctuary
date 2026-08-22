import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { checkCriticalMutationConfig } from '../../scripts/ci/check-critical-mutation-config.mjs';

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
