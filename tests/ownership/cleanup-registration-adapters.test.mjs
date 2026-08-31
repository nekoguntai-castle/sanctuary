import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  classifyCleanupRegistration,
  readCleanupRegistrationAdapters,
  READ_ONLY_REGISTRATION_CLASSES,
} from '../../scripts/ownership/cleanup-registration-adapters.mjs';
import { canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';
import { listRegistrations, readRegistrations, registerResource } from '../../scripts/ownership/registration.mjs';

const checkoutRoot = path.resolve(import.meta.dirname, '../..');
const hash = (value) => canonicalSha256(value);

function registrationInput(resourceClass, locator, immutableIdentity, overrides = {}) {
  return {
    deploymentId: 'deploy-1', operationRunId: 'run-1', ownerId: 'owner-1',
    resourceClass, lifecycle: 'active', cleanupPolicy: 'exact_delete',
    createdAt: '2026-08-30T00:00:00.000Z', createdByRelease: 'v0.8.69',
    createdByCommit: 'a'.repeat(40), locatorKind: 'path', locator,
    immutableIdentity, metadataDigest: hash({ resourceClass, locator }),
    referenceIds: ['run-1'], ...overrides,
  };
}

function pathIdentity(file) {
  const stats = statSync(file);
  return `path-${stats.dev}-${stats.ino}`;
}

function treeSnapshot(root) {
  const visit = (entry) => {
    const stats = statSync(entry);
    const relative = path.relative(root, entry) || '.';
    const record = [relative, stats.mode, stats.dev, stats.ino, stats.size, stats.mtimeMs];
    if (!stats.isDirectory()) return [record];
    return [record, ...readdirSync(entry).sort().flatMap((name) => visit(path.join(entry, name)))];
  };
  return visit(root);
}

test('readRegistrations verifies signed registrations without changing storage', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-readonly-'));
  const artifact = path.join(mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-artifact-')), 'item');
  writeFileSync(artifact, 'registered');
  registerResource(registrationInput('temporary_artifact', artifact, pathIdentity(artifact)), { root, checkoutRoot });
  const before = treeSnapshot(root);

  assert.equal(readRegistrations(root).length, 1);
  assert.deepEqual(treeSnapshot(root), before);
  assert.equal(listRegistrations(root).length, 1);
});

test('readRegistrations never creates or repairs ownership storage', () => {
  const missing = path.join(os.tmpdir(), `sanctuary-registration-missing-${process.pid}-${Date.now()}`);
  assert.throws(() => readRegistrations(missing), /ENOENT/);
  assert.equal(existsSync(missing), false);

  const root = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-mode-'));
  const artifact = path.join(mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-mode-artifact-')), 'item');
  writeFileSync(artifact, 'registered');
  registerResource(registrationInput('temporary_artifact', artifact, pathIdentity(artifact)), { root, checkoutRoot });
  chmodSync(root, 0o755);
  assert.throws(() => readRegistrations(root), /permissions are too broad/);
  assert.equal(statSync(root).mode & 0o777, 0o755);
});

test('readRegistrations rejects missing signatures and tampered payloads', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-signature-'));
  const artifact = path.join(mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-signature-artifact-')), 'item');
  writeFileSync(artifact, 'registered');
  const result = registerResource(registrationInput('temporary_artifact', artifact, pathIdentity(artifact)), { root, checkoutRoot });
  writeFileSync(result.path, Buffer.from(readFileSync(result.path).toString().replace('active', 'retired')));
  assert.throws(() => readRegistrations(root), /signature verification failed/);

  const incompleteRoot = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-incomplete-'));
  const incomplete = registerResource(
    registrationInput('temporary_artifact', artifact, pathIdentity(artifact)),
    { root: incompleteRoot, checkoutRoot },
  );
  rmSync(incomplete.path.replace(/\.json$/, '.sig'));
  assert.throws(() => readRegistrations(incompleteRoot), /incomplete signed pair/);
});

test('read-only adapters classify current, missing, and drifted path identities', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-adapters-'));
  const current = path.join(mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-current-')), 'item');
  const missing = path.join(os.tmpdir(), `sanctuary-registration-absent-${process.pid}-${Date.now()}`);
  const evidence = path.join(mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-evidence-')), 'receipt.json');
  writeFileSync(current, 'current');
  writeFileSync(evidence, 'receipt');
  const evidenceDigest = createHash('sha256').update('receipt').digest('hex');

  registerResource(registrationInput('temporary_artifact', current, pathIdentity(current)), { root, checkoutRoot });
  registerResource(registrationInput('temporary_artifact', missing, 'path-1-2', {
    operationRunId: 'run-2', metadataDigest: hash({ missing }), referenceIds: ['run-2'],
  }), { root, checkoutRoot });
  registerResource(registrationInput('cleanup_evidence', evidence, `sha256:${evidenceDigest}`, {
    lifecycle: 'retained', cleanupPolicy: 'retain',
  }), { root, checkoutRoot });

  let rows = readCleanupRegistrationAdapters(root);
  const temporaryRows = rows.filter((row) => row.registration.resourceClass === 'temporary_artifact');
  assert.equal(temporaryRows.find((row) => row.registration.locator === current).disposition, 'refused');
  assert.equal(temporaryRows.find((row) => row.registration.locator === missing).disposition, 'absent');
  assert.equal(rows.find((row) => row.registration.resourceClass === 'cleanup_evidence').disposition, 'retain');
  assert.ok(rows.every((row) => row.executable === false));

  writeFileSync(evidence, 'drifted');
  rows = readCleanupRegistrationAdapters(root);
  const drifted = rows.find((row) => row.registration.resourceClass === 'cleanup_evidence');
  assert.equal(drifted.observation.state, 'identity_changed');
  assert.equal(drifted.disposition, 'refused');
});

test('processes and worktrees remain refused after exact identity observation', () => {
  const base = registrationInput('collector_process', '1234', 'pid-start-1234-99', {
    locatorKind: 'authority',
  });
  const processRow = classifyCleanupRegistration(base, {
    inspectors: { collector_process: () => ({ state: 'current', immutableIdentity: 'pid-start-1234-99' }) },
  });
  assert.equal(processRow.observation.state, 'current');
  assert.equal(processRow.disposition, 'refused');
  assert.equal(processRow.executable, false);
  assert.equal(classifyCleanupRegistration(base).disposition, 'refused');

  const worktree = registrationInput('git_worktree', '/tmp/worktree', 'git-worktree-identity');
  const worktreeRow = classifyCleanupRegistration(worktree, {
    inspectors: { git_worktree: () => ({ state: 'current', immutableIdentity: 'git-worktree-identity' }) },
  });
  assert.equal(worktreeRow.disposition, 'refused');
  assert.equal(worktreeRow.executable, false);
  const driftedWorktree = classifyCleanupRegistration(worktree, {
    inspectors: { git_worktree: () => ({ state: 'current', immutableIdentity: 'git-worktree-replaced' }) },
  });
  assert.equal(driftedWorktree.observation.state, 'identity_changed');
  assert.equal(driftedWorktree.disposition, 'refused');
});

test('publication observations retain exact identity and refuse drift', () => {
  const publication = registrationInput('provider_publication', 'release-123', 'provider-object-123', {
    locatorKind: 'provider_id', lifecycle: 'retained', cleanupPolicy: 'retain_reconcile',
  });
  const current = classifyCleanupRegistration(publication, {
    inspectors: { provider_publication: () => ({ state: 'current', immutableIdentity: 'provider-object-123' }) },
  });
  assert.equal(current.disposition, 'retain');
  const drifted = classifyCleanupRegistration(publication, {
    inspectors: { provider_publication: () => ({ state: 'current', immutableIdentity: 'provider-object-other' }) },
  });
  assert.equal(drifted.observation.state, 'identity_changed');
  assert.equal(drifted.disposition, 'refused');
  assert.deepEqual(READ_ONLY_REGISTRATION_CLASSES, [
    'collector_process', 'git_worktree', 'temporary_artifact', 'cleanup_evidence', 'provider_publication',
  ]);
});
