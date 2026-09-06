import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { canonicalJson } from '../../scripts/ownership/canonical-json.mjs';
import {
  coordinatorStatePath, createCoordinatorState,
} from '../../scripts/ownership/ci-cleanup-state.mjs';
import {
  authorityBinding, boundTo, readUpgradeTarget, upgradeTargetPath, writeUpgradeTarget,
} from '../../scripts/ownership/ci-cleanup-upgrade-target.mjs';

function fixture(authorityMode = 'deployment_managed_by_subject') {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ci-cleanup-upgrade-target-'));
  chmodSync(root, 0o700);
  const checkoutRoot = path.join(root, 'checkout');
  const runtimeDirectory = path.join(root, 'runtime');
  mkdirSync(checkoutRoot, { mode: 0o700 });
  mkdirSync(runtimeDirectory, { mode: 0o700 });
  const authority = {
    provider: 'github', runId: '42', runAttempt: '1', lane: 'upgrade-15',
    identityDigest: 'a'.repeat(64), checkoutRoot, runtimeDirectory,
    deploymentId: 'ci-42-1-upgrade-15-deploy', ownerId: 'ci-42-1-upgrade-15-owner',
    operationRunId: 'ci-42-1-upgrade-15-cleanup', composeProjectName: 'ci-42-1-upgrade-15',
    checkoutCommit: 'b'.repeat(40), policyDigest: 'c'.repeat(64), authorityMode,
  };
  const created = createCoordinatorState({
    statePath: coordinatorStatePath(runtimeDirectory), checkoutRoot, authority,
  });
  return { checkoutRoot, runtimeDirectory, state: created.state };
}

const TARGET = Object.freeze({ commit: 'd'.repeat(40), policyDigest: 'e'.repeat(64) });

test('upgrade target is declared beside the coordinator state and bound to its authority digest', () => {
  const { checkoutRoot, runtimeDirectory, state } = fixture();
  assert.equal(readUpgradeTarget(state, checkoutRoot), null);
  writeUpgradeTarget({
    runtimeDirectory, checkoutRoot, authorityCoreDigest: state.authorityCoreDigest, target: TARGET,
  });
  assert.deepEqual(readUpgradeTarget(state, checkoutRoot), TARGET);
  // The coordinator state itself is untouched, so a source release validating
  // it against its own exact field list still accepts it (issue #1028).
  assert.equal('upgradeTargetCommit' in state, false);
  assert.throws(
    () => readUpgradeTarget({ ...state, authorityCoreDigest: 'f'.repeat(64) }, checkoutRoot),
    /does not match its authority/,
  );
  const sameCommit = { ...state, authority: { ...state.authority, checkoutCommit: TARGET.commit } };
  assert.throws(() => readUpgradeTarget(sameCommit, checkoutRoot), /does not match its authority/);
  const record = JSON.parse(readFileSync(upgradeTargetPath(runtimeDirectory), 'utf8'));
  writeFileSync(upgradeTargetPath(runtimeDirectory), canonicalJson({ ...record, commit: 'not-a-commit' }));
  assert.throws(() => readUpgradeTarget(state, checkoutRoot), /upgrade target is invalid/);
});

test('upgrade target refuses a coordinator-managed authority', () => {
  const { checkoutRoot, runtimeDirectory, state } = fixture('coordinator_managed');
  writeUpgradeTarget({
    runtimeDirectory, checkoutRoot, authorityCoreDigest: state.authorityCoreDigest, target: TARGET,
  });
  assert.throws(() => readUpgradeTarget(state, checkoutRoot), /does not match its authority/);
});

test('revision bindings compare commit and policy digest exactly', () => {
  const { state } = fixture();
  const binding = authorityBinding(state.authority);
  assert.deepEqual(binding, { commit: 'b'.repeat(40), policyDigest: 'c'.repeat(64) });
  assert.equal(boundTo(binding, { commit: 'b'.repeat(40), policyDigest: 'c'.repeat(64) }), true);
  assert.equal(boundTo(binding, { commit: 'b'.repeat(40), policyDigest: 'e'.repeat(64) }), false);
  assert.equal(boundTo(null, { commit: 'b'.repeat(40), policyDigest: 'c'.repeat(64) }), false);
});
