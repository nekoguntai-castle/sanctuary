import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { canonicalJson, parseStrictJson } from '../../scripts/ownership/canonical-json.mjs';
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
