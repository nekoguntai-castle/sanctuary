import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, readFileSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  forgejoJobsResult, forgejoRunsPaginationKey, paginateForgejoResponse,
  readOperatorRecoveryRequest,
  runOperatorRecoveryCli, readBoundedForgejoJsonResponse,
  validateOperatorRecoveryRuntimeDirectory,
} from '../../scripts/ownership/operator-recovery-cli.mjs';
import { validateHostRecoveryTrust } from '../../scripts/ownership/operator-recovery-schema.mjs';

test('provision creates one owner-only role-separated host trust root', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'operator-recovery-cli-'));
  const requestPath = path.join(root, 'request.json');
  const request = {
    keyRoot: path.join(root, 'keys'), trustPath: path.join(root, 'recovery-trust.json'),
    trustId: 'host-recovery-test', validUntil: new Date(Date.now() + 60_000).toISOString(),
  };
  writeFileSync(requestPath, JSON.stringify(request));
  const result = await runOperatorRecoveryCli(['provision', requestPath], process.cwd());
  assert.equal(result.state, 'provisioned');
  const trust = JSON.parse(readFileSync(request.trustPath));
  assert.equal(validateHostRecoveryTrust(trust, { now: new Date() }), trust);
  assert.notEqual(trust.authorizationFingerprints[0], trust.evidenceFingerprints[0]);
  await assert.rejects(runOperatorRecoveryCli(['provision', requestPath], process.cwd()), /already exists/);
});

test('CLI rejects unknown commands and extra request fields before side effects', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'operator-recovery-cli-invalid-'));
  const requestPath = path.join(root, 'request.json');
  writeFileSync(requestPath, JSON.stringify({ keyRoot: 'x', extra: true }));
  await assert.rejects(runOperatorRecoveryCli(['unknown', requestPath], process.cwd()), /usage/);
  await assert.rejects(runOperatorRecoveryCli(['provision', requestPath], process.cwd()), /fields are invalid/);
});

test('prepare rejects a tampered recovery contract before provider or Docker access', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'operator-recovery-cli-contract-'));
  const incident = JSON.parse(readFileSync('config/operator-recovery-incident.json'));
  const target = incident.targets[0];
  const contractPath = path.join(root, 'contract.json');
  writeFileSync(contractPath, JSON.stringify({
    schemaVersion: '1.0.0', authorityKind: 'operator_lost_authority_recovery',
    normalCleanupAuthorityUnchanged: false, resourceClasses: [],
  }));
  const request = {
    runtimeDirectory: path.join(root, 'runtime'), evidenceDirectory: path.join(root, 'evidence'),
    incidentEvidenceDirectory: path.join(root, 'incident-evidence'),
    keyRoot: path.join(root, 'missing-keys'), trustPath: path.join(root, 'missing-trust.json'),
    target: { project: target.project, deploymentId: target.deploymentId, ownerId: target.ownerId },
    expectedCounts: target.expectedCounts, sourceCommit: target.sourceCommit,
    sourceExecutionId: target.sourceExecutionId, recoveryContractPath: contractPath,
    incidentContractPath: path.resolve('config/operator-recovery-incident.json'),
    provider: {
      providerInstance: 'https://provider.invalid', repository: 'owner/repo',
      queries: [], taskSnapshot: [],
    },
    ttlMs: 60_000,
  };
  const requestPath = path.join(root, 'request.json');
  writeFileSync(requestPath, JSON.stringify(request));
  await assert.rejects(runOperatorRecoveryCli(['prepare', requestPath], process.cwd()), /unchanged/);
});

test('Forgejo adapter tracks cumulative pagination and stable totals', () => {
  const state = new Map();
  assert.deepEqual(paginateForgejoResponse(
    { workflow_runs: [{ id: 1 }], total_count: 3 }, 'workflow_runs', null, 2, state, 'runs',
  ), { items: [{ id: 1 }], nextCursor: '2', complete: false });
  assert.deepEqual(paginateForgejoResponse(
    { workflow_runs: [{ id: 2 }, { id: 3 }], total_count: 3 },
    'workflow_runs', '2', 2, state, 'runs',
  ), { items: [{ id: 2 }, { id: 3 }], nextCursor: null, complete: true });
  assert.throws(() => paginateForgejoResponse(
    { jobs: [{ id: 1 }], total_count: 2 }, 'jobs', null, 2, new Map(), 'jobs',
  ) && paginateForgejoResponse(
    { jobs: [{ id: 2 }], total_count: 3 }, 'jobs', '2', 2,
    new Map([['jobs', { nextPage: 2, seen: 1, total: 2 }]]), 'jobs',
  ), /changed/);
  assert.throws(() => paginateForgejoResponse(
    { jobs: [], total_count: 1 }, 'jobs', null, 2, new Map(), 'jobs-empty',
  ), /incomplete/);
});

test('Forgejo jobs adapter accepts the live bare-array shape exactly once', () => {
  assert.deepEqual(forgejoJobsResult([{ id: 1 }, { id: 2 }], null), {
    items: [{ id: 1 }, { id: 2 }], nextCursor: null, complete: true,
  });
  assert.throws(() => forgejoJobsResult({ jobs: [], total_count: 0 }, null), /malformed/);
  assert.throws(() => forgejoJobsResult([], '2'), /malformed/);
});

test('Forgejo run pagination state is isolated by the complete query identity', () => {
  assert.notEqual(
    forgejoRunsPaginationKey('a'.repeat(40), 'install-test.yml', 'Fresh Install E2E Test'),
    forgejoRunsPaginationKey('a'.repeat(40), 'install-test.yml', 'Install Script E2E Test'),
  );
});

test('request reader rejects symlinks and oversized files before parsing', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'operator-recovery-request-'));
  const valid = path.join(root, 'valid.json');
  const linked = path.join(root, 'linked.json');
  const oversized = path.join(root, 'oversized.json');
  writeFileSync(valid, '{}');
  symlinkSync(valid, linked);
  writeFileSync(oversized, Buffer.alloc(1025));
  assert.deepEqual(readOperatorRecoveryRequest(valid), {});
  assert.throws(() => readOperatorRecoveryRequest(linked), /regular non-symlink/);
  assert.throws(() => readOperatorRecoveryRequest(oversized, 1024), /bounded regular/);
});

test('runtime directory must be outside the checkout', () => {
  const checkout = mkdtempSync(path.join(tmpdir(), 'operator-recovery-checkout-'));
  assert.throws(() => validateOperatorRecoveryRuntimeDirectory(
    path.join(checkout, 'runtime'), checkout,
  ), /outside the checkout/);
  const external = mkdtempSync(path.join(tmpdir(), 'operator-recovery-runtime-'));
  assert.equal(validateOperatorRecoveryRuntimeDirectory(external, checkout), external);
});

test('Forgejo adapter stops reading chunked responses at the byte bound', async () => {
  const oversized = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(3 * 1024 * 1024));
      controller.enqueue(new Uint8Array(3 * 1024 * 1024));
      controller.close();
    },
  }));
  await assert.rejects(readBoundedForgejoJsonResponse(oversized), /oversized/);
  const valid = new Response(JSON.stringify({ total_count: 0, workflow_runs: [] }));
  assert.deepEqual(await readBoundedForgejoJsonResponse(valid), {
    total_count: 0, workflow_runs: [],
  });
});
