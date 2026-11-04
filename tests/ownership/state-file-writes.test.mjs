import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectCleanupTransitions } from '../../scripts/ownership/cleanup-approval-ledger.mjs';
import {
  acquireDeploymentLock, inspectDeploymentLock, recoverStaleDeploymentLock, releaseDeploymentLock,
} from '../../scripts/ownership/deployment-lock.mjs';
import { DeploymentStore } from '../../scripts/ownership/deployment-store.mjs';
import { writeAtomic, writeCreateOnly } from '../../scripts/ownership/deployment-store-io.mjs';

function stateDirectory() {
  return mkdtempSync(path.join(os.tmpdir(), 'state-file-writes-'));
}

test('writeCreateOnly links complete bytes into place and leaves no temporary', () => {
  const directory = stateDirectory();
  const target = path.join(directory, 'identity.json');
  writeCreateOnly(target, Buffer.from('{"a":1}'));
  assert.equal(readFileSync(target, 'utf8'), '{"a":1}');
  assert.equal(statSync(target).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(directory), ['identity.json']);
});

test('writeCreateOnly refuses an existing file without touching it or leaking a temporary', () => {
  const directory = stateDirectory();
  const target = path.join(directory, 'pending-revision.json');
  writeCreateOnly(target, Buffer.from('first'));
  assert.throws(() => writeCreateOnly(target, Buffer.from('second')), { code: 'EEXIST' });
  assert.equal(readFileSync(target, 'utf8'), 'first');
  assert.deepEqual(readdirSync(directory), ['pending-revision.json']);
});

test('writeAtomic replaces in place and leaves no temporary', () => {
  const directory = stateDirectory();
  const target = path.join(directory, 'active.json');
  writeAtomic(target, Buffer.from('one'));
  writeAtomic(target, Buffer.from('two'));
  assert.equal(readFileSync(target, 'utf8'), 'two');
  assert.deepEqual(readdirSync(directory), ['active.json']);
});

test('a temporary left by a crashed write does not make the transition directory ambiguous', () => {
  const directory = stateDirectory();
  const approvalTransitions = path.join(directory, 'approval');
  mkdirSync(approvalTransitions, { mode: 0o700 });
  // The crash happened before the link: only the unlinked temporary exists.
  writeFileSync(path.join(approvalTransitions, '000001.json.tmp-123-456'), '{"torn":', { mode: 0o600 });
  assert.deepEqual(inspectCleanupTransitions({ approvalTransitions }, 'approval'), []);

  writeFileSync(path.join(approvalTransitions, 'unexpected.json'), '{}', { mode: 0o600 });
  assert.throws(() => inspectCleanupTransitions({ approvalTransitions }, 'approval'), /unexpected entry/);
});

test('a write that fails before the link removes its temporary and creates nothing', () => {
  const directory = stateDirectory();
  const target = path.join(directory, 'identity.json');
  // Stands in for ENOSPC/EIO mid-write: the byte source fails after the temp is open.
  const failing = { get length() { throw Object.assign(new Error('no space left'), { code: 'ENOSPC' }); } };
  assert.throws(() => writeCreateOnly(target, failing), { code: 'ENOSPC' });
  assert.throws(() => writeAtomic(target, failing), { code: 'ENOSPC' });
  assert.deepEqual(readdirSync(directory), []);
});

test('releasing or recovering a lock clears an owner temporary a crash left behind', () => {
  const directory = stateDirectory();
  const lockPath = path.join(directory, 'deployment.lock');
  const lock = acquireDeploymentLock(lockPath, { operationRunId: 'ci-1-1-test' });
  writeFileSync(path.join(lockPath, `owner.json.tmp-${process.pid}-${randomUUID()}`), '{"tor', { mode: 0o600 });
  releaseDeploymentLock(lockPath, lock.token, 'ci-1-1-test');
  assert.deepEqual(readdirSync(directory), []);

  // A crash between the owner temp write and its link: no owner.json, one temp.
  mkdirSync(lockPath, { mode: 0o700 });
  writeFileSync(path.join(lockPath, `owner.json.tmp-${process.pid}-${randomUUID()}`), '{"tor', { mode: 0o600 });
  const inspection = inspectDeploymentLock(lockPath);
  assert.equal(inspection.reason, 'owner record is missing');
  recoverStaleDeploymentLock(lockPath, inspection.ownerDigest);
  assert.deepEqual(readdirSync(directory), []);
});

test('a temporary left in the retired-revision directory is not an ambiguous record', () => {
  const runtimeDirectory = stateDirectory();
  const store = new DeploymentStore({ runtimeDirectory, deploymentId: 'ci-42-1-deploy' });
  mkdirSync(store.retiredRevisions, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(store.retiredRevisions, `1.json.tmp-${process.pid}-${randomUUID()}`), '{"gen', { mode: 0o600 });
  assert.deepEqual(store.readRetired(), []);
});
