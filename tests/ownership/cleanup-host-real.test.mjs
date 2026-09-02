import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalJson, canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';
import { resolveCleanupHostAuthority } from '../../scripts/ownership/cleanup-host-authority.mjs';
import { createCleanupHostInspectors } from '../../scripts/ownership/cleanup-host-observation.mjs';
import { createCleanupHostOperations } from '../../scripts/ownership/cleanup-host-operations.mjs';
import { describeHostAuthority } from '../../scripts/ownership/describe-host-authority.mjs';
import { inventoryCleanupResources } from '../../scripts/ownership/cleanup-inventory.mjs';
import { buildCleanupPlan } from '../../scripts/ownership/cleanup-planner.mjs';
import { sha256 } from '../../scripts/ownership/crypto.mjs';
import { registerResource } from '../../scripts/ownership/registration.mjs';

const checkoutRoot = path.resolve(import.meta.dirname, '../..');

function privateDirectory(prefix) {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  chmodSync(directory, 0o700);
  return directory;
}

function registration(bundle, overrides = {}) {
  return {
    schemaVersion: '1.1.0', artifactType: 'resource_registration',
    registrationId: 'a'.repeat(64), deploymentId: 'deploy-1', operationRunId: 'run-1',
    ownerId: 'owner-1', lifecycle: 'active', cleanupPolicy: 'exact_delete',
    createdAt: '2026-09-01T00:00:00.000Z', createdByRelease: 'v0.8.69',
    createdByCommit: 'b'.repeat(40), referenceIds: ['run-1'], signerKeyId: 'c'.repeat(64),
    ...bundle, ...overrides,
  };
}

function terminalRun() {
  return {
    schemaVersion: '1.0.0', artifactType: 'run_manifest', deploymentId: 'deploy-1',
    operationRunId: 'run-1', ownerId: 'owner-1', generation: 1,
    startedAt: '2026-09-01T00:00:00.000Z', heartbeatAt: '2026-09-01T00:00:01.000Z',
    terminalAt: '2026-09-01T00:00:02.000Z', controllerIdentity: 'controller-1',
    deploymentDigest: 'd'.repeat(64),
  };
}

function helperFor(runtimeDirectory, record) {
  return resolveCleanupHostAuthority({
    runtimeDirectory, checkoutRoot, registrations: [record],
  });
}

test('real registered temp tree is quarantined exactly and external symlink target survives', async () => {
  const runtime = privateDirectory('sanctuary-host-runtime-');
  const parent = privateDirectory('sanctuary-host-parent-');
  const artifact = path.join(parent, 'artifact');
  const sentinelParent = privateDirectory('sanctuary-host-sentinel-');
  const sentinel = path.join(sentinelParent, 'sentinel.txt');
  mkdirSync(path.join(artifact, 'nested'), { recursive: true });
  writeFileSync(path.join(artifact, 'nested', 'data.txt'), 'owned');
  writeFileSync(sentinel, 'foreign');
  symlinkSync(sentinel, path.join(artifact, 'external-link'));
  const record = registration(describeHostAuthority(['temporary', artifact, 'run-1']));
  const authority = helperFor(runtime, record);
  assert.equal(authority.available, true);
  const observed = createCleanupHostInspectors({
    helperAuthority: authority, runManifest: terminalRun(),
  }).temporary_artifact(record);
  assert.deepEqual(observed, {
    state: 'current', immutableIdentity: record.immutableIdentity, active: false, executable: true,
  });
  const operations = createCleanupHostOperations({ helperAuthority: authority });
  assert.deepEqual(await operations.mutate({
    registration: record, intentCheckpointDigest: 'e'.repeat(64),
  }), { outcome: 'success' });
  assert.equal(existsSync(artifact), false);
  assert.equal(readFileSync(sentinel, 'utf8'), 'foreign');
  assert.equal((await operations.reconcile({
    registration: record, mutationOutcome: 'success', intentCheckpointDigest: 'e'.repeat(64),
  })).state, 'absent');
  rmSync(runtime, { recursive: true });
  rmSync(parent, { recursive: true });
  rmSync(sentinelParent, { recursive: true });
});

test('real registered collector stops only after exact terminal marker policy', async () => {
  const runtime = privateDirectory('sanctuary-host-process-runtime-');
  const parent = privateDirectory('sanctuary-host-process-');
  const script = path.join(parent, 'collector.mjs');
  const heartbeat = path.join(parent, 'heartbeat.json');
  const terminal = path.join(parent, 'terminal.json');
  writeFileSync(script, 'setInterval(() => {}, 1000);\n');
  writeFileSync(heartbeat, canonicalJson({ operationRunId: 'run-1', state: 'heartbeat' }));
  const child = spawn(process.execPath, [script], { stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  try {
    const record = registration(describeHostAuthority([
      'collector', String(child.pid), script, heartbeat, terminal,
    ]));
    const authority = helperFor(runtime, record);
    const inspectors = createCleanupHostInspectors({
      helperAuthority: authority, runManifest: terminalRun(),
    });
    assert.equal(inspectors.collector_process(record).executable, false);
    writeFileSync(terminal, canonicalJson({ operationRunId: 'run-1', state: 'terminal' }));
    assert.equal(inspectors.collector_process(record).executable, true);
    const operations = createCleanupHostOperations({ helperAuthority: authority });
    assert.deepEqual(await operations.mutate({
      registration: record, intentCheckpointDigest: 'e'.repeat(64),
    }), { outcome: 'success' });
    await new Promise((resolve) => child.once('exit', resolve));
    assert.equal((await operations.reconcile({
      registration: record, mutationOutcome: 'success', intentCheckpointDigest: 'e'.repeat(64),
    })).state, 'absent');
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    rmSync(runtime, { recursive: true });
    rmSync(parent, { recursive: true });
  }
});

test('real v1.1 host registration becomes one canonical eligible plan action', async () => {
  const root = privateDirectory('sanctuary-host-inventory-');
  const runtime = path.join(root, 'runtime');
  const parent = path.join(root, 'artifacts');
  const artifact = path.join(parent, 'owned');
  mkdirSync(runtime, { mode: 0o700 });
  mkdirSync(parent, { mode: 0o700 });
  mkdirSync(artifact, { mode: 0o700 });
  writeFileSync(path.join(artifact, 'payload'), 'owned');
  const contractBytes = readFileSync(path.join(checkoutRoot, 'config/resource-ownership-contract.json'));
  const ownershipContract = JSON.parse(contractBytes);
  const policyDigest = sha256(contractBytes);
  const definition = {
    definitionVersion: 1,
    ownerId: 'owner-1', release: 'v0.8.69', commit: 'b'.repeat(40),
    projectDirectory: '/private/project', projectDirectoryIdentity: 'device:inode',
    composeProjectName: 'sanctuary-host-fixture', envFile: '/private/sanctuary.env',
    envFileIdentity: 'env:inode', installMode: 'online', profiles: [],
    overlays: [{
      sourcePath: '/private/compose.yml', sourceIdentity: 'overlay:inode',
      snapshotPath: 'compose/00-compose.yml', sha256: 'e'.repeat(64), kind: 'tracked',
    }],
    policyDigest, contextFingerprint: 'c'.repeat(64),
  };
  const deploymentManifest = {
    schemaVersion: '1.0.0', artifactType: 'deployment_manifest', deploymentId: 'deploy-1',
    generation: 1, createdAt: '2026-09-01T00:00:00.000Z', priorActiveDigest: null,
    ...definition, definitionDigest: canonicalSha256(definition), legacyResources: [],
  };
  const runManifest = {
    ...terminalRun(), deploymentDigest: canonicalSha256(deploymentManifest),
  };
  const bundle = describeHostAuthority(['temporary', artifact, runManifest.operationRunId]);
  registerResource({
    deploymentId: deploymentManifest.deploymentId, operationRunId: runManifest.operationRunId,
    ownerId: deploymentManifest.ownerId, lifecycle: 'obsolete', cleanupPolicy: 'exact_delete',
    createdAt: deploymentManifest.createdAt, createdByRelease: deploymentManifest.release,
    createdByCommit: deploymentManifest.commit, referenceIds: [runManifest.operationRunId],
    ...bundle,
  }, { root: path.join(runtime, 'ownership'), checkoutRoot });
  const inventory = await inventoryCleanupResources({
    deploymentManifest, runManifest, ownershipContract, ownershipContractDigest: policyDigest,
    dockerAdapter: {
      id: 'empty-test-double',
      inventory: async () => ({
        resources: [], ambiguities: [], engine: 'docker',
        daemonContextFingerprint: canonicalSha256({ fixture: 'empty-docker' }),
      }),
    },
    registrationRoot: path.join(runtime, 'ownership'),
    hostOptions: { runtimeDirectory: runtime, checkoutRoot },
  });
  assert.equal(inventory.complete, true);
  assert.equal(inventory.resources.length, 1);
  assert.equal(inventory.resources[0].disposition, 'eligible');
  assert.equal(inventory.resources[0].immutableIdentity, bundle.immutableIdentity);
  const plan = buildCleanupPlan(inventory, ownershipContract, { policyDigest });
  assert.deepEqual(plan.actions.map(({ resourceClass, action, immutableIdentity }) => ({
    resourceClass, action, immutableIdentity,
  })), [{
    resourceClass: 'temporary_artifact', action: 'remove',
    immutableIdentity: bundle.immutableIdentity,
  }]);
  rmSync(root, { recursive: true });
});

test('registered Git worktree runtime removes exact checkout and admin metadata', async () => {
  const root = privateDirectory('sanctuary-host-worktree-');
  const runtime = path.join(root, 'runtime');
  const parent = path.join(root, 'worktrees');
  const repository = path.join(root, 'repository');
  const worktree = path.join(parent, 'owned');
  mkdirSync(runtime, { mode: 0o700 });
  mkdirSync(parent, { mode: 0o700 });
  mkdirSync(repository, { mode: 0o700 });
  const git = (args) => execFileSync('git', ['-C', repository, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git(['init']);
  git(['config', 'user.email', 'cleanup-fixture@example.invalid']);
  git(['config', 'user.name', 'Cleanup Fixture']);
  writeFileSync(path.join(repository, 'tracked.txt'), 'owned\n');
  git(['add', 'tracked.txt']);
  git(['commit', '-m', 'fixture']);
  const baseOid = git(['rev-parse', 'HEAD']);
  git(['worktree', 'add', '-b', 'cleanup-fixture', worktree, baseOid]);
  chmodSync(path.join(repository, '.git'), 0o755);
  chmodSync(path.join(repository, '.git', 'worktrees'), 0o755);
  chmodSync(execFileSync('git', [
    '-C', worktree, 'rev-parse', '--path-format=absolute', '--git-dir',
  ], { encoding: 'utf8' }).trim(), 0o755);
  const bundle = describeHostAuthority([
    'worktree', worktree, baseOid, 'deploy-1', 'run-1',
  ]);
  const record = registration(bundle, { lifecycle: 'obsolete' });
  const authority = helperFor(runtime, record);
  const operations = createCleanupHostOperations({ helperAuthority: authority });
  assert.deepEqual(await operations.mutate({
    registration: record, intentCheckpointDigest: 'e'.repeat(64),
  }), { outcome: 'success' });
  assert.equal(existsSync(worktree), false);
  assert.equal(existsSync(path.join(
    bundle.executionAuthority.commonDir.canonicalPath, 'worktrees',
    bundle.executionAuthority.adminEntry.basename,
  )), false);
  assert.equal((await operations.reconcile({
    registration: record, mutationOutcome: 'success', intentCheckpointDigest: 'e'.repeat(64),
  })).state, 'absent');
  rmSync(parent, { recursive: true });
  assert.equal(existsSync(parent), false);
  assert.deepEqual(createCleanupHostInspectors({
    helperAuthority: authority, runManifest: terminalRun(),
  }).git_worktree(record), { state: 'missing' });
  assert.equal(git(['rev-parse', 'HEAD']), baseOid);
  rmSync(root, { recursive: true });
});
