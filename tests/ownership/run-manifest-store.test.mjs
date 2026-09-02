import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { canonicalSha256, parseStrictJson } from '../../scripts/ownership/canonical-json.mjs';
import { resolveDeploymentDefinition } from '../../scripts/ownership/deployment-definition.mjs';
import { acquireDeploymentLock, releaseDeploymentLock } from '../../scripts/ownership/deployment-lock.mjs';
import { DeploymentStore } from '../../scripts/ownership/deployment-store.mjs';
import {
  createRunManifest, heartbeatRunManifest, readRunManifest, terminalizeRunManifest,
} from '../../scripts/ownership/run-manifest-store.mjs';

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'run-manifest-store-'));
  const checkoutRoot = path.join(root, 'checkout');
  const runtimeDirectory = path.join(root, 'runtime');
  mkdirSync(checkoutRoot, { mode: 0o700 });
  mkdirSync(runtimeDirectory, { mode: 0o700 });
  chmodSync(root, 0o700);
  writeFileSync(path.join(checkoutRoot, 'docker-compose.yml'), 'services:\n  app:\n    image: test\n');
  writeFileSync(path.join(runtimeDirectory, 'sanctuary.env'), 'JWT_SECRET=private\n');
  const store = new DeploymentStore({ runtimeDirectory, deploymentId: 'ci-42-1-deploy' });
  store.initialize({ projectDirectory: checkoutRoot, composeProjectName: 'checkout' });
  const operationRunId = 'ci-42-1-cleanup';
  const lock = acquireDeploymentLock(store.lockPath, { operationRunId });
  store.prepareRevision({
    bundle: resolveDeploymentDefinition({
      projectDirectory: checkoutRoot, runtimeDirectory, ownerId: 'ci-42-1-owner',
      release: 'unreleased', commit: 'b'.repeat(40), policyDigest: 'a'.repeat(64),
      contextFingerprint: 'c'.repeat(64),
    }),
    expectedActiveDigest: null, operationRunId, lockToken: lock.token,
  });
  const deploymentManifest = store.readManifest(1, { verifySnapshots: true }).manifest;
  return { checkoutRoot, runtimeDirectory, store, operationRunId, lock, deploymentManifest };
}

test('run manifest lifecycle is canonical, digest-bound, and terminal', () => {
  const state = fixture();
  const created = createRunManifest({
    store: state.store, checkoutRoot: state.checkoutRoot,
    deploymentManifest: state.deploymentManifest, operationRunId: state.operationRunId,
    lockToken: state.lock.token,
    now: new Date('2026-08-31T00:00:01.000Z'),
  });
  assert.equal(created.manifest.deploymentDigest, canonicalSha256(state.deploymentManifest));
  assert.deepEqual(parseStrictJson(readFileSync(created.path)), created.manifest);

  const heartbeat = heartbeatRunManifest({
    store: state.store, checkoutRoot: state.checkoutRoot,
    operationRunId: state.operationRunId, lockToken: state.lock.token,
    expectedDigest: created.digest,
    now: new Date('2026-08-31T00:00:02.000Z'),
  });
  const terminal = terminalizeRunManifest({
    store: state.store, checkoutRoot: state.checkoutRoot,
    operationRunId: state.operationRunId, lockToken: state.lock.token,
    expectedDigest: heartbeat.digest,
    now: new Date('2026-08-31T00:00:03.000Z'),
  });
  assert.equal(terminal.manifest.terminalAt, '2026-08-31T00:00:03.000Z');
  assert.equal(readRunManifest(created.path, state).digest, terminal.digest);
  assert.throws(() => heartbeatRunManifest({
    store: state.store, checkoutRoot: state.checkoutRoot,
    operationRunId: state.operationRunId, lockToken: state.lock.token,
    expectedDigest: terminal.digest,
    now: new Date('2026-08-31T00:00:04.000Z'),
  }), /cannot be heartbeated/);
  releaseDeploymentLock(state.store.lockPath, state.lock.token, state.operationRunId);
});

test('run manifest lifecycle rejects stale writers and time reversal', () => {
  const state = fixture();
  const created = createRunManifest({
    store: state.store, checkoutRoot: state.checkoutRoot,
    deploymentManifest: state.deploymentManifest, operationRunId: state.operationRunId,
    lockToken: state.lock.token,
    now: new Date('2026-08-31T00:00:01.000Z'),
  });
  assert.throws(() => heartbeatRunManifest({
    store: state.store, checkoutRoot: state.checkoutRoot,
    operationRunId: state.operationRunId, lockToken: state.lock.token,
    expectedDigest: 'f'.repeat(64),
    now: new Date('2026-08-31T00:00:02.000Z'),
  }), /compare-and-swap/);
  assert.throws(() => heartbeatRunManifest({
    store: state.store, checkoutRoot: state.checkoutRoot,
    operationRunId: state.operationRunId, lockToken: state.lock.token,
    expectedDigest: created.digest,
    now: new Date('2026-08-30T23:59:59.000Z'),
  }), /backward/);
  releaseDeploymentLock(state.store.lockPath, state.lock.token, state.operationRunId);
});
