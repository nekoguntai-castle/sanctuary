import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writeCiCleanupRequest } from '../../scripts/ownership/write-ci-cleanup-request.mjs';

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ci-cleanup-request-'));
  chmodSync(root, 0o700);
  const checkoutRoot = path.join(root, 'checkout');
  mkdirSync(checkoutRoot, { mode: 0o700 });
  return {
    mode: 'run', output: path.join(root, 'runtime', 'run-request.json'),
    'checkout-root': checkoutRoot, runtime: path.join(root, 'runtime'),
    lane: 'upgrade-15', 'artifact-dir': path.join(root, 'artifacts'),
    'authority-mode': 'deployment_managed_by_subject',
  };
}

test('cleanup request carries a declared upgrade target only for subject-managed runs', () => {
  const commit = 'a'.repeat(40);
  const request = JSON.parse(readFileSync(
    writeCiCleanupRequest({ ...fixture(), 'upgrade-target-commit': commit }), 'utf8',
  ));
  assert.equal(request.upgradeTargetCommit, commit);
  assert.equal(JSON.parse(readFileSync(writeCiCleanupRequest(fixture()), 'utf8')).upgradeTargetCommit, undefined);
  for (const invalid of [
    { 'upgrade-target-commit': 'abc' },
    { 'upgrade-target-commit': commit, 'authority-mode': 'coordinator_managed' },
    { 'upgrade-target-commit': commit, mode: 'prepare' },
  ]) {
    assert.throws(
      () => writeCiCleanupRequest({ ...fixture(), ...invalid }),
      /--upgrade-target-commit requires subject-managed run mode and a full commit/,
    );
  }
});
