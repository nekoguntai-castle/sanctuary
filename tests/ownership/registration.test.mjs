import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';
import {
  effectiveRegistrationState, ensureRegistrationKeys, inspectRegisteredLocator, listRegistrations, registerResource,
} from '../../scripts/ownership/registration.mjs';

const checkoutRoot = path.resolve(import.meta.dirname, '../..');
const hash = (value) => canonicalSha256(value);

function input(overrides = {}) {
  return {
    deploymentId: 'deploy-1', operationRunId: 'run-1', ownerId: 'owner-1',
    resourceClass: 'oci_image', lifecycle: 'active', cleanupPolicy: 'exact_delete',
    createdAt: '2026-08-30T00:00:00.000Z', createdByRelease: 'v0.8.69',
    createdByCommit: 'a'.repeat(40), locatorKind: 'engine_id', locator: 'sha256:image-one',
    immutableIdentity: 'sha256:image-one', metadataDigest: hash({ image: 'one' }),
    referenceIds: ['run-1'], ...overrides,
  };
}

function tempAuthority(overrides = {}) {
  return {
    kind: 'linux_dirfd_v1',
    parent: { canonicalPath: '/tmp/sanctuary-owned', dev: '41', ino: '100', uid: '1000', mode: 448 },
    entry: { basename: 'artifact', dev: '41', ino: '101', type: 'directory' },
    creatorRunId: 'run-1',
    ...overrides,
  };
}

function collectorAuthority(overrides = {}) {
  return {
    kind: 'linux_pidfd_v1', pid: '4242', startTimeTicks: '9001',
    bootIdDigest: 'b'.repeat(64), argvDigest: 'c'.repeat(64),
    script: { canonicalPath: '/opt/sanctuary/collector.mjs', dev: '41', ino: '201', sha256: 'd'.repeat(64) },
    heartbeatPath: '/tmp/sanctuary-owned/collector.heartbeat',
    terminalPath: '/tmp/sanctuary-owned/collector.terminal',
    ...overrides,
  };
}

function worktreeAuthority(overrides = {}) {
  return {
    kind: 'linux_git_worktree_v1',
    parent: { canonicalPath: '/tmp/sanctuary-owned', dev: '41', ino: '100', uid: '1000', mode: 448 },
    entry: { basename: 'review', dev: '41', ino: '301', type: 'directory' },
    commonDir: { canonicalPath: '/srv/sanctuary/.git', dev: '42', ino: '302' },
    adminEntry: { basename: 'review', dev: '42', ino: '303', type: 'directory' },
    branch: 'feature/host-cleanup',
    headOid: 'e'.repeat(40), baseOid: 'f'.repeat(40), lifecycleEvidenceDigest: 'a'.repeat(64),
    ...overrides,
  };
}

test('registrations are immutable, signed, owner-only, and idempotent', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-'));
  const first = registerResource(input(), { root, checkoutRoot });
  const second = registerResource(input(), { root, checkoutRoot });
  assert.equal(first.path, second.path);
  assert.equal(statSync(first.path).mode & 0o777, 0o600);
  assert.equal(listRegistrations(root).length, 1);
  assert.equal(readFileSync(first.path).at(-1), 0x7d);
});

test('typed host execution authority emits digest-bound v1.1 registrations', () => {
  const fixtures = [
    input({
      resourceClass: 'collector_process', locatorKind: 'authority', locator: '4242',
      immutableIdentity: 'pid-start-4242-9001', executionAuthority: collectorAuthority(),
      metadataDigest: undefined,
    }),
    input({
      resourceClass: 'temporary_artifact', locatorKind: 'path',
      locator: '/tmp/sanctuary-owned/artifact', immutableIdentity: 'path-41-101',
      executionAuthority: tempAuthority(), metadataDigest: undefined,
    }),
    input({
      resourceClass: 'git_worktree', locatorKind: 'path',
      locator: '/tmp/sanctuary-owned/review', immutableIdentity: 'worktree-41-301',
      executionAuthority: worktreeAuthority(), metadataDigest: undefined,
    }),
  ];
  for (const fixture of fixtures) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-v11-'));
    const { registration } = registerResource(fixture, { root, checkoutRoot });
    assert.equal(registration.schemaVersion, '1.1.0');
    assert.equal(registration.metadataDigest, canonicalSha256(fixture.executionAuthority));
    assert.deepEqual(listRegistrations(root), [registration]);
  }
});

test('legacy v1.0 Docker and host registrations remain readable without execution authority', () => {
  for (const fixture of [input(), input({
    resourceClass: 'temporary_artifact', locatorKind: 'path', locator: '/tmp/legacy-artifact',
    immutableIdentity: 'path-41-401', metadataDigest: hash({ legacy: true }),
  })]) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-v10-'));
    const { registration } = registerResource(fixture, { root, checkoutRoot });
    assert.equal(registration.schemaVersion, '1.0.0');
    assert.equal('executionAuthority' in registration, false);
    assert.deepEqual(listRegistrations(root), [registration]);
  }
});

test('host execution authority rejects unbound, cross-class, and malformed metadata', () => {
  const root = () => mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-invalid-v11-'));
  const valid = input({
    resourceClass: 'temporary_artifact', locatorKind: 'path',
    locator: '/tmp/sanctuary-owned/artifact', immutableIdentity: 'path-41-101',
    executionAuthority: tempAuthority(), metadataDigest: undefined,
  });
  assert.throws(() => registerResource({
    ...valid, metadataDigest: '9'.repeat(64),
  }, { root: root(), checkoutRoot }), /metadataDigest/);
  assert.throws(() => registerResource({
    ...input(), executionAuthority: tempAuthority(), metadataDigest: undefined,
  }, { root: root(), checkoutRoot }), /only for executable host/);
  assert.throws(() => registerResource({
    ...valid, locator: '/tmp/sanctuary-owned/replacement',
  }, { root: root(), checkoutRoot }), /locator must equal/);
  assert.throws(() => registerResource({
    ...valid, executionAuthority: tempAuthority({
      entry: { basename: '../artifact', dev: '41', ino: '101', type: 'directory' },
    }),
  }, { root: root(), checkoutRoot }), /basename/);
  assert.throws(() => registerResource({
    ...valid, executionAuthority: tempAuthority({
      entry: { basename: 'artifact', dev: '42', ino: '101', type: 'directory' },
    }),
  }, { root: root(), checkoutRoot }), /share one device/);
  assert.throws(() => registerResource({
    ...valid, executionAuthority: { ...tempAuthority(), unexpected: true },
  }, { root: root(), checkoutRoot }), /exactly/);
  assert.throws(() => registerResource({
    ...valid, operationRunId: 'run-other',
  }, { root: root(), checkoutRoot }), /creatorRunId/);

  const collector = input({
    resourceClass: 'collector_process', locatorKind: 'authority', locator: '4242',
    immutableIdentity: 'pid-start-4242-9001', executionAuthority: collectorAuthority(),
    metadataDigest: undefined,
  });
  assert.throws(() => registerResource({
    ...collector, locator: '4243',
  }, { root: root(), checkoutRoot }), /locator must equal/);
  assert.throws(() => registerResource({
    ...collector, executionAuthority: collectorAuthority({ pid: '04242' }),
  }, { root: root(), checkoutRoot }), /invalid format/);
  assert.throws(() => registerResource({
    ...collector, executionAuthority: collectorAuthority({ pid: '2147483648' }),
  }, { root: root(), checkoutRoot }), /numeric bound/);
  assert.throws(() => registerResource({
    ...collector, executionAuthority: collectorAuthority({
      terminalPath: '/tmp/sanctuary-owned/collector.heartbeat',
    }),
  }, { root: root(), checkoutRoot }), /must differ/);

  const worktree = input({
    resourceClass: 'git_worktree', locatorKind: 'path',
    locator: '/tmp/sanctuary-owned/review', immutableIdentity: 'worktree-41-301',
    executionAuthority: worktreeAuthority(), metadataDigest: undefined,
  });
  assert.throws(() => registerResource({
    ...worktree, executionAuthority: worktreeAuthority({ branch: 'feature//unsafe' }),
  }, { root: root(), checkoutRoot }), /canonical branch/);
  assert.throws(() => registerResource({
    ...worktree, executionAuthority: worktreeAuthority({
      parent: { canonicalPath: '/tmp/sanctuary-owned', dev: '41', ino: '100', uid: '1000', mode: 493 },
    }),
  }, { root: root(), checkoutRoot }), /mode must equal 448/);
});

test('registration CLI parses typed authority and derives its metadata digest', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-cli-v11-'));
  const cli = path.join(checkoutRoot, 'scripts/ownership/register-resource.mjs');
  const authority = tempAuthority();
  const result = spawnSync(process.execPath, [cli,
    '--root', root, '--checkout-root', checkoutRoot,
    '--deployment-id', 'deploy-1', '--run-id', 'run-1', '--owner-id', 'owner-1',
    '--class', 'temporary_artifact', '--lifecycle', 'active', '--policy', 'exact_delete',
    '--release', 'v0.8.69', '--commit', 'a'.repeat(40),
    '--created-at', '2026-08-30T00:00:00.000Z', '--locator-kind', 'path',
    '--locator', '/tmp/sanctuary-owned/artifact', '--identity', 'path-41-101',
    '--execution-authority', JSON.stringify(authority), '--reference', 'run-1',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const [registration] = listRegistrations(root);
  assert.equal(registration.schemaVersion, '1.1.0');
  assert.equal(registration.metadataDigest, canonicalSha256(authority));
});

test('signature-first registration recovers publication loss without trusting unsigned data', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-repair-'));
  const first = registerResource(input(), { root, checkoutRoot });
  const signature = first.path.replace(/\.json$/, '.sig');
  writeFileSync(`${signature}.tmp-123-456`, readFileSync(signature), { mode: 0o600 });
  writeFileSync(`${first.path}.tmp-123-457`, readFileSync(first.path), { mode: 0o600 });
  assert.equal(listRegistrations(root).length, 1);
  rmSync(first.path);
  assert.equal(listRegistrations(root).length, 0);
  const repaired = registerResource(input(), { root, checkoutRoot });
  assert.equal(repaired.path, first.path);
  assert.equal(existsSync(signature), true);
  assert.equal(listRegistrations(root).length, 1);

  rmSync(signature);
  assert.throws(() => listRegistrations(root), /incomplete signed pair/);
  assert.throws(
    () => registerResource(input(), { root, checkoutRoot }),
    /incomplete signed pair|existing registration pair conflicts/,
  );
});

test('shared image registrations retain every independent consumer', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-shared-'));
  const first = registerResource(input(), { root, checkoutRoot });
  const second = registerResource(input({ operationRunId: 'run-2', ownerId: 'owner-2', referenceIds: ['run-2'] }), { root, checkoutRoot });
  assert.equal(second.registration.lifecycle, 'shared');
  assert.equal(second.registration.cleanupPolicy, 'retain');
  assert.deepEqual(second.registration.referenceIds, ['run-1', 'run-2']);
  let registrations = listRegistrations(root, { resourceClass: 'oci_image', immutableIdentity: 'sha256:image-one' });
  assert.equal(registrations.length, 3);
  assert.deepEqual(effectiveRegistrationState(registrations), {
    lifecycle: 'shared', cleanupPolicy: 'retain', referenceIds: ['run-1', 'run-2'],
  });
  rmSync(first.path);
  rmSync(first.path.replace(/\.json$/, '.sig'));
  registrations = listRegistrations(root, { resourceClass: 'oci_image', immutableIdentity: 'sha256:image-one' });
  assert.equal(registrations.length, 2);
  assert.equal(effectiveRegistrationState(registrations).cleanupPolicy, 'retain');

  const otherRoot = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-shared-second-'));
  registerResource(input(), { root: otherRoot, checkoutRoot });
  const otherSecond = registerResource(input({ operationRunId: 'run-2', ownerId: 'owner-2', referenceIds: ['run-2'] }), { root: otherRoot, checkoutRoot });
  rmSync(otherSecond.path);
  rmSync(otherSecond.path.replace(/\.json$/, '.sig'));
  const afterSecondRemoval = listRegistrations(otherRoot, { resourceClass: 'oci_image', immutableIdentity: 'sha256:image-one' });
  assert.equal(effectiveRegistrationState(afterSecondRemoval).cleanupPolicy, 'retain');
});

test('concurrent image producers serialize shared-retain convergence', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-race-'));
  ensureRegistrationKeys(root);
  const cli = path.join(checkoutRoot, 'scripts/ownership/register-resource.mjs');
  const run = (runId, ownerId) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli,
      '--root', root, '--checkout-root', checkoutRoot, '--deployment-id', 'deploy-1',
      '--run-id', runId, '--owner-id', ownerId, '--class', 'oci_image', '--lifecycle', 'active',
      '--policy', 'exact_delete', '--release', 'v0.8.69', '--commit', 'a'.repeat(40),
      '--created-at', '2026-08-30T00:00:00.000Z', '--locator-kind', 'engine_id',
      '--locator', 'image:race', '--identity', 'sha256:image-race', '--reference', runId,
    ]);
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr)));
  });
  await Promise.all([run('run-1', 'owner-1'), run('run-2', 'owner-2')]);
  const registrations = listRegistrations(root, { resourceClass: 'oci_image', immutableIdentity: 'sha256:image-race' });
  for (const removable of registrations.filter((entry) => entry.referenceIds.length === 1)) {
    // The effective set contains a shared-retain superseder independent of
    // either single-consumer record.
    const remaining = registrations.filter((entry) => entry.registrationId !== removable.registrationId);
    assert.equal(effectiveRegistrationState(remaining).cleanupPolicy, 'retain');
  }
});

test('registration recovers a lock whose owning producer was killed', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-stale-lock-'));
  ensureRegistrationKeys(root);
  const lock = path.join(root, '.registration-lock');
  const lockModule = pathToFileURL(path.join(checkoutRoot, 'scripts/ownership/deployment-lock.mjs')).href;
  const childSource = `
    const { acquireDeploymentLock } = await import(${JSON.stringify(lockModule)});
    acquireDeploymentLock(${JSON.stringify(lock)}, { operationRunId: 'registration-killed-child' });
    process.stdout.write('locked\\n');
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', childSource], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('child did not acquire registration lock')), 5000);
    child.once('error', reject);
    child.once('close', (code) => reject(new Error(`child exited before kill with ${code}`)));
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('locked\n')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  child.kill('SIGKILL');
  await new Promise((resolve) => child.once('close', resolve));

  const result = registerResource(input(), { root, checkoutRoot });
  assert.ok(existsSync(result.path));
  assert.equal(existsSync(lock), false);
});

test('content-addressed path registration verifies current bytes', () => {
  const resource = path.join(mkdtempSync(path.join(os.tmpdir(), 'sanctuary-content-path-')), 'evidence.json');
  writeFileSync(resource, 'retained evidence');
  const digest = createHash('sha256').update('retained evidence').digest('hex');
  const registration = registerResource(input({
    resourceClass: 'cleanup_evidence', lifecycle: 'retained', cleanupPolicy: 'retain',
    locatorKind: 'path', locator: resource, immutableIdentity: `sha256:${digest}`,
  }), { root: mkdtempSync(path.join(os.tmpdir(), 'sanctuary-content-registration-')), checkoutRoot }).registration;
  assert.equal(inspectRegisteredLocator(registration).state, 'current');
  writeFileSync(resource, 'replacement evidence');
  assert.equal(inspectRegisteredLocator(registration).state, 'identity_changed');
});

test('registration verification rejects payload tampering and detects locator replacement', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-tamper-'));
  const resource = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registered-path-'));
  const identity = `path-${statSync(resource).dev}-${statSync(resource).ino}`;
  const result = registerResource(input({
    resourceClass: 'temporary_artifact', locatorKind: 'path', locator: resource, immutableIdentity: identity,
  }), { root, checkoutRoot });
  assert.equal(inspectRegisteredLocator(result.registration).state, 'current');
  const replaced = `${resource}-original`;
  renameSync(resource, replaced);
  writeFileSync(resource, 'replacement');
  assert.equal(inspectRegisteredLocator(result.registration).state, 'identity_changed');
  const bytes = readFileSync(result.path);
  const tampered = Buffer.from(bytes.toString().replace('temporary_artifact', 'cleanup_evidence'));
  assert.notDeepEqual(bytes, tampered);
  writeFileSync(result.path, tampered);
  assert.throws(() => listRegistrations(root), /signature verification failed/);
});

test('registration key storage rejects symlink roots and key directories', () => {
  const target = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-target-'));
  const linkedRoot = `${target}-link`;
  symlinkSync(target, linkedRoot, 'dir');
  assert.throws(() => registerResource(input(), { root: linkedRoot, checkoutRoot }), /must not be a symlink/);

  const ancestor = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-ancestor-'));
  const ancestorTarget = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-ancestor-target-'));
  symlinkSync(ancestorTarget, path.join(ancestor, 'linked'), 'dir');
  assert.throws(() => registerResource(input(), {
    root: path.join(ancestor, 'linked', 'ownership'), checkoutRoot,
  }), /must not traverse a symlink/);

  const root = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-registration-keys-'));
  registerResource(input(), { root, checkoutRoot });
  const externalKeys = `${root}-external-keys`;
  renameSync(path.join(root, 'keys'), externalKeys);
  symlinkSync(externalKeys, path.join(root, 'keys'), 'dir');
  assert.throws(() => registerResource(input({ operationRunId: 'run-2' }), { root, checkoutRoot }), /must not be a symlink/);
});
