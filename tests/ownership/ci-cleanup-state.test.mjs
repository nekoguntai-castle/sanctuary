import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { canonicalJson } from '../../scripts/ownership/canonical-json.mjs';
import {
  coordinatorStatePath, createCoordinatorState, readCoordinatorState,
  transitionCoordinatorState,
} from '../../scripts/ownership/ci-cleanup-state.mjs';

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ci-cleanup-state-'));
  const checkoutRoot = path.join(root, 'checkout');
  const runtimeDirectory = path.join(root, 'runtime');
  mkdirSync(checkoutRoot, { mode: 0o700 });
  mkdirSync(runtimeDirectory, { mode: 0o700 });
  chmodSync(root, 0o700);
  return { checkoutRoot, runtimeDirectory };
}

function authority(state) {
  return {
    provider: 'github', runId: '42', runAttempt: '1', lane: 'install',
    identityDigest: 'a'.repeat(64), checkoutRoot: state.checkoutRoot,
    runtimeDirectory: state.runtimeDirectory, deploymentId: 'ci-42-1-install',
    ownerId: 'ci-42-1-owner', operationRunId: 'ci-42-1-cleanup',
    composeProjectName: 'ci-42-1-install', checkoutCommit: 'b'.repeat(40),
    policyDigest: 'c'.repeat(64), authorityMode: 'coordinator_managed',
  };
}

test('cleanup coordinator state is create-only, canonical, and CAS transitioned', () => {
  const state = fixture();
  const statePath = coordinatorStatePath(state.runtimeDirectory);
  const created = createCoordinatorState({
    statePath, checkoutRoot: state.checkoutRoot, authority: authority(state),
  });
  const prepared = transitionCoordinatorState({
    statePath, checkoutRoot: state.checkoutRoot, expectedDigest: created.digest,
    nextPhase: 'revision_prepared', updates: {
      deploymentManifestPath: path.join(state.runtimeDirectory, 'deployment.json'),
      deploymentManifestDigest: 'd'.repeat(64), generation: 1,
      resourceCreatedAt: '2026-08-31T00:00:00.000Z',
    },
  });
  assert.equal(readCoordinatorState(statePath, state).digest, prepared.digest);
  assert.throws(() => transitionCoordinatorState({
    statePath, checkoutRoot: state.checkoutRoot, expectedDigest: created.digest,
    nextPhase: 'deployment_active',
  }), /compare-and-swap/);
  assert.throws(() => transitionCoordinatorState({
    statePath, checkoutRoot: state.checkoutRoot, expectedDigest: prepared.digest,
    nextPhase: 'subject_terminal',
  }), /invalid cleanup coordinator transition/);
});

test('cleanup coordinator refuses any active phase without a creation timestamp', () => {
  const state = fixture();
  const statePath = coordinatorStatePath(state.runtimeDirectory);
  const subjectAuthority = {
    ...authority(state), authorityMode: 'deployment_managed_by_subject',
  };
  const created = createCoordinatorState({
    statePath, checkoutRoot: state.checkoutRoot, authority: subjectAuthority,
  });
  assert.throws(() => transitionCoordinatorState({
    statePath, checkoutRoot: state.checkoutRoot, expectedDigest: created.digest,
    nextPhase: 'subject_ready',
  }), /requires a creation timestamp/);
});

test('cleanup coordinator terminal projection cannot reopen subject authority', () => {
  const state = fixture();
  const statePath = coordinatorStatePath(state.runtimeDirectory);
  const created = createCoordinatorState({
    statePath, checkoutRoot: state.checkoutRoot,
    authority: { ...authority(state), authorityMode: 'deployment_managed_by_subject' },
  });
  const ready = transitionCoordinatorState({
    statePath, checkoutRoot: state.checkoutRoot, expectedDigest: created.digest,
    nextPhase: 'subject_ready',
    updates: { resourceCreatedAt: '2026-08-31T00:00:00.000Z' },
  });
  const projected = transitionCoordinatorState({
    statePath, checkoutRoot: state.checkoutRoot, expectedDigest: ready.digest,
    nextPhase: 'projected',
  });
  assert.throws(() => transitionCoordinatorState({
    statePath, checkoutRoot: state.checkoutRoot, expectedDigest: projected.digest,
    nextPhase: 'subject_ready',
  }), /invalid cleanup coordinator transition/);
});

test('cleanup coordinator preserves legacy fixture registration ambiguity', () => {
  const state = fixture();
  const statePath = coordinatorStatePath(state.runtimeDirectory);
  const created = createCoordinatorState({
    statePath, checkoutRoot: state.checkoutRoot,
    authority: { ...authority(state), authorityMode: 'deployment_managed_by_subject' },
  });
  const ready = transitionCoordinatorState({
    statePath, checkoutRoot: state.checkoutRoot, expectedDigest: created.digest,
    nextPhase: 'subject_ready', updates: {
      resourceCreatedAt: '2026-08-31T00:00:00.000Z',
      legacyFixtureWitnessDigest: 'e'.repeat(64),
      legacyFixtureWitnessState: 'witnessed',
      cleanupSuppression: 'legacy_fixture_registration_failed',
    },
  });
  assert.equal(ready.state.cleanupSuppression, 'legacy_fixture_registration_failed');
});

test('cleanup coordinator explicitly refuses obsolete v2 state instead of misreading it', () => {
  const state = fixture();
  const statePath = coordinatorStatePath(state.runtimeDirectory);
  createCoordinatorState({
    statePath, checkoutRoot: state.checkoutRoot, authority: authority(state),
  });
  const legacy = JSON.parse(readFileSync(statePath, 'utf8'));
  legacy.stateVersion = 2;
  delete legacy.legacyFixtureWitnessState;
  writeFileSync(statePath, canonicalJson(legacy), { mode: 0o600 });
  assert.throws(() => readCoordinatorState(statePath, state), /fields are invalid|version/);
});
