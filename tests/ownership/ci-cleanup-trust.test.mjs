import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';
import {
  ciCleanupProviderContext, installEphemeralCiCleanupTrust,
} from '../../scripts/ownership/ci-cleanup-trust.mjs';
import { createEphemeralCleanupSigners } from '../../scripts/ownership/cleanup-ephemeral-signers.mjs';
import { verifyCleanupTrust } from '../../scripts/ownership/cleanup-trust.mjs';
import { sha256 } from '../../scripts/ownership/crypto.mjs';
import { resolveDeploymentDefinition } from '../../scripts/ownership/deployment-definition.mjs';
import { acquireDeploymentLock, releaseDeploymentLock } from '../../scripts/ownership/deployment-lock.mjs';
import { DeploymentStore } from '../../scripts/ownership/deployment-store.mjs';

const CHECKOUT = path.resolve('.');

test('local ephemeral authority is explicit and cannot downgrade CI', () => {
  const local = ciCleanupProviderContext({
    SANCTUARY_LOCAL_CLEANUP_AUTHORITY: '1',
    SANCTUARY_LOCAL_CLEANUP_RUN_ID: 'local-42', RUNNER_TEMP: '/tmp/local-authority',
  });
  assert.equal(local.provider, 'local');
  assert.equal(local.runId, 'local-42');
  assert.equal(local.runAttempt, '1');
  assert.throws(() => ciCleanupProviderContext({
    CI: 'true', SANCTUARY_LOCAL_CLEANUP_AUTHORITY: '1',
    SANCTUARY_LOCAL_CLEANUP_RUN_ID: 'local-42', RUNNER_TEMP: '/tmp/local-authority',
  }), /exact provider or local-ephemeral context/);
  assert.deepEqual(ciCleanupProviderContext({
    CI: 'true', FORGEJO_ACTIONS: 'true', GITHUB_RUN_ID: 'real-99',
    GITHUB_RUN_ATTEMPT: '3', RUNNER_TEMP: '/real/runner/temp',
    SANCTUARY_CI_PROVIDER_OVERRIDE: 'local',
    SANCTUARY_LOCAL_CLEANUP_AUTHORITY: '1',
    SANCTUARY_LOCAL_CLEANUP_RUN_ID: 'local-spoof',
    SANCTUARY_CI_RUN_ID_OVERRIDE: 'override-spoof',
    SANCTUARY_CI_RUN_ATTEMPT_OVERRIDE: '9',
    SANCTUARY_CI_TEMP_DIR_OVERRIDE: '/tmp/spoof',
  }), {
    provider: 'forgejo', runId: 'real-99', runAttempt: '3',
    identityDigest: canonicalSha256({ provider: 'forgejo', runId: 'real-99', runAttempt: '3' }),
  });
});

function withCiEnvironment(callback) {
  const keys = [
    'GITHUB_ACTIONS', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'RUNNER_TEMP',
    'FORGEJO_ACTIONS', 'FORGEJO_SERVER_URL',
  ];
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), 'ci-cleanup-trust-'));
  chmodSync(runnerTemp, 0o700);
  Object.assign(process.env, {
    GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1', RUNNER_TEMP: runnerTemp,
    FORGEJO_ACTIONS: 'false', FORGEJO_SERVER_URL: '',
  });
  try { return callback(runnerTemp); } finally {
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
}

function fixture(runnerTemp) {
  const runtimeDirectory = path.join(runnerTemp, 'runtime');
  mkdirSync(runtimeDirectory, { mode: 0o700 });
  writeFileSync(path.join(runtimeDirectory, 'sanctuary.env'), 'JWT_SECRET=private\n', { mode: 0o600 });
  const operationRunId = 'ci-42-1-cleanup';
  const deploymentId = 'ci-42-1-deploy';
  const composeProjectName = 'ci-42-1-project';
  const ciRunIdentityDigest = canonicalSha256({ provider: 'github', runId: '42', runAttempt: '1' });
  const store = new DeploymentStore({ runtimeDirectory, deploymentId });
  store.initialize({
    projectDirectory: CHECKOUT, composeProjectName,
    deploymentScope: 'ci_ephemeral', ciRunIdentityDigest,
  });
  const lock = acquireDeploymentLock(store.lockPath, { operationRunId });
  store.prepareRevision({
    bundle: resolveDeploymentDefinition({
      projectDirectory: CHECKOUT, runtimeDirectory, composeProjectName,
      ownerId: 'ci-42-1-owner', release: 'unreleased',
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: CHECKOUT, encoding: 'utf8' }).trim(),
      policyDigest: sha256(readFileSync(path.join(CHECKOUT, 'config/resource-ownership-contract.json'))),
      contextFingerprint: 'c'.repeat(64),
    }),
    expectedActiveDigest: null, operationRunId, lockToken: lock.token,
  });
  const deploymentManifest = store.readManifest(1, { verifySnapshots: true }).manifest;
  const keyRoot = path.join(runtimeDirectory, 'coordinator', 'keys');
  mkdirSync(path.dirname(keyRoot), { mode: 0o700 });
  const signers = createEphemeralCleanupSigners({ keyRoot, checkoutRoot: CHECKOUT });
  return {
    runtimeDirectory, operationRunId, deploymentManifest, keyRoot,
    signers, store, lock, ciRunIdentityDigest,
  };
}

test('bounded CI trust binds runner identity, deployment, coordinator, and distinct roles', () => {
  withCiEnvironment((runnerTemp) => {
    const state = fixture(runnerTemp);
    const coordinatorStateDigest = 'd'.repeat(64);
    const installed = installEphemeralCiCleanupTrust({
      runtimeDirectory: state.runtimeDirectory, checkoutRoot: CHECKOUT,
      keyRoot: state.keyRoot, deploymentManifest: state.deploymentManifest,
      operationRunId: state.operationRunId,
      authorizationFingerprint: state.signers.authorization.fingerprint,
      evidenceFingerprint: state.signers.evidence.fingerprint,
      coordinatorStateDigest, now: new Date('2026-08-31T00:00:00.000Z'),
    });
    assert.equal(installed.trust.trustVersion, 2);
    assert.equal(installed.trust.authority.identityDigest, state.ciRunIdentityDigest);
    assert.deepEqual(installEphemeralCiCleanupTrust({
      runtimeDirectory: state.runtimeDirectory, checkoutRoot: CHECKOUT,
      keyRoot: state.keyRoot, deploymentManifest: state.deploymentManifest,
      operationRunId: state.operationRunId,
      authorizationFingerprint: state.signers.authorization.fingerprint,
      evidenceFingerprint: state.signers.evidence.fingerprint,
      coordinatorStateDigest, now: new Date('2026-08-31T00:01:00.000Z'),
    }), installed);
    assert.equal(verifyCleanupTrust({
      runtimeDirectory: state.runtimeDirectory, checkoutRoot: CHECKOUT,
      deploymentId: state.deploymentManifest.deploymentId,
      authorizationFingerprint: state.signers.authorization.fingerprint,
      evidenceFingerprint: state.signers.evidence.fingerprint,
      expectedAuthorityIdentityDigest: state.ciRunIdentityDigest,
      operationRunId: state.operationRunId,
      deploymentManifestDigest: canonicalSha256(state.deploymentManifest),
      now: new Date('2026-08-31T00:01:00.000Z'),
    }).trust.trustVersion, 2);
    releaseDeploymentLock(state.store.lockPath, state.lock.token, state.operationRunId);
  });
});
