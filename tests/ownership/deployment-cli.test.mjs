import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { canonicalJson, canonicalSha256, parseStrictJson } from '../../scripts/ownership/canonical-json.mjs';
import { resolveDeploymentDefinition } from '../../scripts/ownership/deployment-definition.mjs';
import { acquireDeploymentLock, releaseDeploymentLock } from '../../scripts/ownership/deployment-lock.mjs';
import { DeploymentStore } from '../../scripts/ownership/deployment-store.mjs';

const cli = path.resolve('scripts/ownership/deployment-cli.mjs');

function run(command, request, options = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-cli-request-'));
  const requestPath = path.join(directory, 'request.json');
  writeFileSync(requestPath, canonicalJson(request));
  return spawnSync(process.execPath, [cli, command, requestPath], options);
}

function fixture() {
  const projectDirectory = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-cli-project-'));
  const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-cli-runtime-'));
  writeFileSync(path.join(projectDirectory, 'docker-compose.yml'), 'services:\n  app:\n    image: cli:test\n');
  writeFileSync(path.join(runtimeDirectory, 'sanctuary.env'), 'JWT_SECRET=private\n');
  const definitionOptions = {
    projectDirectory, runtimeDirectory, ownerId: 'operator-1', release: 'v1.0.0',
    commit: 'a'.repeat(40), policyDigest: 'b'.repeat(64), contextFingerprint: 'c'.repeat(64),
  };
  return { projectDirectory, runtimeDirectory, definitionOptions };
}

function advance(store, operationRunId, lockToken, prepared) {
  let current = prepared;
  for (const nextStage of ['build_started', 'build_completed', 'postgres_started', 'password_reconciled', 'stack_started', 'health_verified']) {
    current = store.transitionPending({
      operationRunId, lockToken, expectedPendingDigest: current.pendingDigest, nextStage,
    });
  }
  return current;
}

test('CLI emits canonical local definition JSON and rejects unknown request keys without stdout', () => {
  const state = fixture();
  const result = run('resolve', { definitionOptions: state.definitionOptions });
  assert.equal(result.status, 0, result.stderr.toString());
  const definition = parseStrictJson(result.stdout);
  assert.equal(definition.projectDirectory, state.projectDirectory);
  assert.equal(canonicalJson(definition).equals(result.stdout), true);
  const invalid = run('resolve', { definitionOptions: state.definitionOptions, unexpected: true });
  assert.equal(invalid.status, 2);
  assert.equal(invalid.stdout.length, 0);
});

test('CLI compose-args output is NUL-delimited and uses retained snapshots', () => {
  const state = fixture();
  const store = new DeploymentStore({ runtimeDirectory: state.runtimeDirectory, deploymentId: 'deployment-1' });
  store.initialize({ projectDirectory: state.projectDirectory, composeProjectName: path.basename(state.projectDirectory).toLowerCase() });
  const owner = acquireDeploymentLock(store.lockPath, { operationRunId: 'run-1' });
  store.prepareRevision({ bundle: resolveDeploymentDefinition(state.definitionOptions), expectedActiveDigest: null, operationRunId: 'run-1', lockToken: owner.token });
  releaseDeploymentLock(store.lockPath, owner.token, 'run-1');
  const result = run('compose-args', { runtimeDirectory: state.runtimeDirectory, deploymentId: 'deployment-1', generation: 1 });
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(result.stdout.at(-1), 0);
  const args = result.stdout.toString().slice(0, -1).split('\0');
  assert.deepEqual(args.slice(0, 6), ['--project-directory', state.projectDirectory, '--env-file', path.join(state.runtimeDirectory, 'sanctuary.env'), '-p', path.basename(state.projectDirectory).toLowerCase()]);
  assert.match(args[args.indexOf('-f') + 1], /revisions\/1\/compose\/00-/);
});

test('CLI lock acquisition binds the long-lived controller PID from the environment', () => {
  const state = fixture();
  const request = {
    runtimeDirectory: state.runtimeDirectory, deploymentId: 'deployment-1', operationRunId: 'run-shell',
    journalPath: null, generation: null,
  };
  const acquired = run('lock-acquire', request, { env: { ...process.env, SANCTUARY_LOCK_CONTROLLER_PID: String(process.pid) } });
  assert.equal(acquired.status, 0, acquired.stderr.toString());
  const owner = parseStrictJson(acquired.stdout);
  assert.equal(owner.pid, process.pid);
  const inspected = run('lock-inspect', { runtimeDirectory: state.runtimeDirectory, deploymentId: 'deployment-1' });
  assert.equal(parseStrictJson(inspected.stdout).processMatches, true);
  const released = run('lock-release', {
    runtimeDirectory: state.runtimeDirectory, deploymentId: 'deployment-1', operationRunId: 'run-shell', lockToken: owner.token,
  });
  assert.equal(released.status, 0, released.stderr.toString());
});

test('CLI rollback completion refuses changed or retroactively claimed legacy resources', () => {
  const state = fixture();
  const store = new DeploymentStore({ runtimeDirectory: state.runtimeDirectory, deploymentId: 'deployment-1' });
  store.initialize({ projectDirectory: state.projectDirectory, composeProjectName: 'sanctuary' });
  const volume = {
    Name: 'sanctuary_data', Driver: 'local', Scope: 'local', Mountpoint: '/legacy/data',
    CreatedAt: '2026-08-30T00:00:00Z', Options: {},
  };
  const legacyResources = [{
    resourceClass: 'compose_volume', locator: 'sanctuary_data', composeResource: 'data',
    immutableIdentity: canonicalSha256(volume), cleanupPolicy: 'preserve_ambiguous', ownershipState: 'unlabeled',
  }];
  const bundle = resolveDeploymentDefinition({ ...state.definitionOptions, composeProjectName: 'sanctuary' });

  let owner = acquireDeploymentLock(store.lockPath, { operationRunId: 'run-1' });
  let pending = store.prepareRevision({
    bundle, legacyResources, expectedActiveDigest: null, operationRunId: 'run-1', lockToken: owner.token,
  });
  pending = advance(store, 'run-1', owner.token, pending);
  store.activateRevision({ operationRunId: 'run-1', lockToken: owner.token, expectedPendingDigest: pending.pendingDigest });
  releaseDeploymentLock(store.lockPath, owner.token, 'run-1');

  owner = acquireDeploymentLock(store.lockPath, { operationRunId: 'run-2' });
  pending = store.prepareRevision({
    bundle, legacyResources, expectedActiveDigest: store.inspect().active.value.manifestDigest,
    operationRunId: 'run-2', lockToken: owner.token,
  });
  pending = advance(store, 'run-2', owner.token, pending);
  store.activateRevision({ operationRunId: 'run-2', lockToken: owner.token, expectedPendingDigest: pending.pendingDigest });
  releaseDeploymentLock(store.lockPath, owner.token, 'run-2');

  owner = acquireDeploymentLock(store.lockPath, { operationRunId: 'run-rollback' });
  let rollback = store.beginRollback({
    targetGeneration: 1, expectedActiveDigest: store.inspect().active.value.manifestDigest,
    operationRunId: 'run-rollback', lockToken: owner.token,
  });
  for (const nextStage of ['rollback_stack_started', 'rollback_health_verified']) {
    rollback = store.transitionPending({
      operationRunId: 'run-rollback', lockToken: owner.token,
      expectedPendingDigest: rollback.pendingDigest, nextStage,
    });
  }

  const fakeDirectory = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-rollback-docker-'));
  const fakeDocker = path.join(fakeDirectory, 'docker');
  writeFileSync(fakeDocker, `#!/bin/sh
case " $* " in
  *" compose "*" config --format json "*) printf '%s\\n' '{"services":{},"networks":{},"volumes":{}}' ;;
  " container ls "*) ;;
  " volume inspect sanctuary_data ")
    mount=/legacy/data
    labels='{"com.docker.compose.project":"sanctuary","com.docker.compose.volume":"data"}'
    [ "$FAKE_ROLLBACK_RESOURCE" = changed ] && mount=/replacement/data
    [ "$FAKE_ROLLBACK_RESOURCE" = claimed ] && labels='{"com.docker.compose.project":"sanctuary","com.docker.compose.volume":"data","io.sanctuary.project":"sanctuary"}'
    printf '[{"Name":"sanctuary_data","Driver":"local","Scope":"local","Mountpoint":"%s","CreatedAt":"2026-08-30T00:00:00Z","Options":{},"Labels":%s}]\\n' "$mount" "$labels" ;;
  *) exit 64 ;;
esac
`);
  chmodSync(fakeDocker, 0o755);
  const request = {
    runtimeDirectory: state.runtimeDirectory, deploymentId: 'deployment-1', operationRunId: 'run-rollback',
    lockToken: owner.token, expectedPendingDigest: rollback.pendingDigest,
  };
  const baseEnv = { ...process.env, PATH: `${fakeDirectory}:${process.env.PATH}` };
  const changed = run('complete-rollback', request, { env: { ...baseEnv, FAKE_ROLLBACK_RESOURCE: 'changed' } });
  assert.equal(changed.status, 5);
  assert.match(changed.stderr.toString(), /immutable identity changed/);
  assert.equal(store.inspect().active.value.generation, 2);
  const claimed = run('complete-rollback', request, { env: { ...baseEnv, FAKE_ROLLBACK_RESOURCE: 'claimed' } });
  assert.equal(claimed.status, 5);
  assert.match(claimed.stderr.toString(), /retroactively claimed/);
  assert.equal(store.inspect().active.value.generation, 2);
  const completed = run('complete-rollback', request, { env: { ...baseEnv, FAKE_ROLLBACK_RESOURCE: 'preserved' } });
  assert.equal(completed.status, 0, completed.stderr.toString());
  assert.equal(store.inspect().active.value.generation, 1);
  releaseDeploymentLock(store.lockPath, owner.token, 'run-rollback');
});
