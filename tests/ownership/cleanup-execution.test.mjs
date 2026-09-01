import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync, existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { canonicalSha256, parseStrictJson } from '../../scripts/ownership/canonical-json.mjs';
import { buildCleanupApproval } from '../../scripts/ownership/cleanup-approval.mjs';
import { verifySignedArtifact } from '../../scripts/ownership/cleanup-evidence.mjs';
import {
  readActiveCleanupPointer, readApprovalState, createCleanupLedger,
} from '../../scripts/ownership/cleanup-approval-ledger.mjs';
import { inspectDeploymentCleanupState } from '../../scripts/ownership/deployment-cleanup-gate.mjs';
import { applyCleanupExecution } from '../../scripts/ownership/cleanup-execution.mjs';
import { recoverCleanupExecution } from '../../scripts/ownership/cleanup-recovery.mjs';
import { verifyCleanupJournal } from '../../scripts/ownership/cleanup-journal.mjs';
import { buildCleanupPlan, buildPlanningReceipt } from '../../scripts/ownership/cleanup-planner.mjs';
import { publicKeyFingerprint } from '../../scripts/ownership/crypto.mjs';

const HASH = 'a'.repeat(64);
const ID = 'b'.repeat(64);
const AUTH_SIGNER = 'c'.repeat(64);

function keys(directory) {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPath = path.join(directory, 'private.pem');
  const publicKeyPath = path.join(directory, 'public.pem');
  writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
  writeFileSync(publicKeyPath, publicKey, { mode: 0o600 });
  return { privateKey, publicKey, privateKeyPath, publicKeyPath, signerKeyId: publicKeyFingerprint(publicKey) };
}

function ownership(identity = ID) {
  return {
    project: 'fixture', deploymentId: 'deploy-1', ownerId: 'owner-1',
    resourceClass: 'compose_network', lifecycle: 'obsolete', cleanupPolicy: 'exact_delete',
    createdAt: '2026-08-30T00:00:00.000Z', createdByRelease: 'unreleased',
    createdByCommit: 'd'.repeat(40), creationRunId: 'create-1', immutableIdentity: identity,
  };
}

function row(identity = ID) {
  const authority = ownership(identity);
  return {
    resourceClass: 'compose_network', locatorKind: 'engine_id', locator: identity,
    immutableIdentity: identity, ownership: authority, ownershipDigest: canonicalSha256(authority),
    observationDigest: HASH, disposition: 'eligible', failureClasses: [], references: [],
    contentDigests: [], active: false, protected: false, data: false,
    running: null,
  };
}

function inventory(resources, observedAt) {
  return {
    schemaVersion: '1.2.0', artifactType: 'inventory', deploymentId: 'deploy-1',
    operationRunId: 'cleanup-1', generation: 1, observedAt, complete: true,
    policyDigest: HASH, deploymentManifestDigest: HASH, runManifestDigest: HASH,
    contextFingerprint: HASH, resources, ambiguities: [],
  };
}

const contract = {
  resourceClasses: [{ classId: 'compose_network', dependsOn: [], cleanupPolicies: ['exact_delete'] }],
};

function fixture(nonce) {
  const checkoutRoot = mkdtempSync(path.join(os.tmpdir(), `cleanup-${nonce}-checkout-`));
  const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), `cleanup-${nonce}-runtime-`));
  chmodSync(checkoutRoot, 0o700);
  chmodSync(runtimeDirectory, 0o700);
  const signer = keys(runtimeDirectory);
  const before = inventory([row()], '2026-08-30T00:00:00.000Z');
  const plan = buildCleanupPlan(before, contract, { policyDigest: HASH });
  const dryRunReceipt = buildPlanningReceipt(before, plan, {
    signerKeyId: signer.signerKeyId, now: () => new Date('2026-08-30T00:00:01.000Z'),
  });
  const approval = buildCleanupApproval(plan, dryRunReceipt, {
    signerKeyId: AUTH_SIGNER, nonce, expiresAt: '2026-08-30T12:00:00.000Z',
    now: () => new Date('2026-08-30T00:00:02.000Z'),
  });
  return {
    checkoutRoot, runtimeDirectory, signer, before, inventoryBefore: before,
    plan, dryRunReceipt, approval,
  };
}

function fixtureWithResources(nonce, resources) {
  const values = fixture(nonce);
  const before = inventory(resources, '2026-08-30T00:00:00.000Z');
  const plan = buildCleanupPlan(before, contract, { policyDigest: HASH });
  const dryRunReceipt = buildPlanningReceipt(before, plan, {
    signerKeyId: values.signer.signerKeyId,
    now: () => new Date('2026-08-30T00:00:01.000Z'),
  });
  const approval = buildCleanupApproval(plan, dryRunReceipt, {
    signerKeyId: AUTH_SIGNER, nonce, expiresAt: '2026-08-30T12:00:00.000Z',
    now: () => new Date('2026-08-30T00:00:02.000Z'),
  });
  return { ...values, before, inventoryBefore: before, plan, dryRunReceipt, approval };
}

function executionCallbacks(afterBoundary, inventoryAfter = inventory([], '2026-08-30T00:00:08.000Z')) {
  return {
    reloadAuthority: async () => ({ state: 'eligible', row: row(), derivedFromResultDigest: null }),
    mutate: async () => ({ outcome: 'success' }),
    reconcile: async ({ action }) => ({
      state: 'absent', resourceClass: action.resourceClass,
      immutableIdentity: action.immutableIdentity, postconditionDigest: HASH, failureClass: 'none',
    }),
    buildInventoryAfter: async () => inventoryAfter,
    afterBoundary,
  };
}

function recoveryIdentity() {
  return {
    controllerRunId: 'recover-exact', projectLockObservationDigest: HASH,
    deploymentLockObservationDigest: HASH,
  };
}

test('apply durably orders terminal state, exact receipt sidecars, and pointer tombstone', async () => {
  const checkoutRoot = mkdtempSync(path.join(os.tmpdir(), 'cleanup-execution-checkout-'));
  const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), 'cleanup-execution-runtime-'));
  chmodSync(checkoutRoot, 0o700);
  chmodSync(runtimeDirectory, 0o700);
  const signer = keys(runtimeDirectory);
  const before = inventory([row()], '2026-08-30T00:00:00.000Z');
  const plan = buildCleanupPlan(before, contract, { policyDigest: HASH });
  const dryRunReceipt = buildPlanningReceipt(before, plan, {
    signerKeyId: signer.signerKeyId, now: () => new Date('2026-08-30T00:00:01.000Z'),
  });
  const approval = buildCleanupApproval(plan, dryRunReceipt, {
    signerKeyId: AUTH_SIGNER, nonce: 'approval-1', expiresAt: '2026-08-30T12:00:00.000Z',
    now: () => new Date('2026-08-30T00:00:02.000Z'),
  });
  let tick = 3;
  const boundaries = [];
  const result = await applyCleanupExecution({
    runtimeDirectory, checkoutRoot, inventoryBefore: before, plan, approval, dryRunReceipt,
    ...signer, now: () => new Date(`2026-08-30T00:00:${String(tick++).padStart(2, '0')}.000Z`),
    reloadAuthority: async () => ({ state: 'eligible', row: row(), derivedFromResultDigest: null }),
    mutate: async () => ({ outcome: 'success' }),
    reconcile: async ({ action }) => ({
      state: 'absent', resourceClass: action.resourceClass,
      immutableIdentity: action.immutableIdentity, postconditionDigest: HASH, failureClass: 'none',
    }),
    buildInventoryAfter: async () => inventory([], '2026-08-30T00:00:08.000Z'),
    afterBoundary: async (boundary) => boundaries.push(boundary),
  });
  assert.equal(result.state, 'cleaned');
  assert.deepEqual(boundaries, [
    'journal_created', 'pointer_published', 'approval_reserved',
    'checkpoint_intent', 'checkpoint_result', 'inventory_after_persisted',
    'terminal_appended', 'approval_finalized', 'receipt_prepared',
    'receipt_file_written', 'receipt_signature_written', 'receipt_checksum_written', 'receipt_written',
    'pointer_tombstoned',
  ]);
  const receipt = parseStrictJson(readFileSync(result.receiptOutputPath));
  const {
    receiptCoreDigest, approvalStateGeneration: _approvalStateGeneration, ...envelopeCore
  } = receipt;
  assert.equal(receiptCoreDigest, canonicalSha256({ ...envelopeCore, approvalStateDigest: null }));
  const ledger = createCleanupLedger({
    runtimeDirectory, deploymentId: 'deploy-1', approvalDigest: canonicalSha256(approval),
  });
  assert.equal(readApprovalState(ledger).value.state, 'finalized');
  assert.equal(inspectDeploymentCleanupState({ runtimeDirectory, deploymentId: 'deploy-1' }).state, 'clear');
  assert.equal(readFileSync(`${result.receiptOutputPath.slice(0, -5)}.sha256`, 'ascii'), result.receiptDigest);
});

test('recovery regenerates the exact deterministic receipt after finalized-state interruption', async () => {
  const checkoutRoot = mkdtempSync(path.join(os.tmpdir(), 'cleanup-recovery-checkout-'));
  const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), 'cleanup-recovery-runtime-'));
  chmodSync(checkoutRoot, 0o700);
  chmodSync(runtimeDirectory, 0o700);
  const signer = keys(runtimeDirectory);
  const before = inventory([row()], '2026-08-30T00:00:00.000Z');
  const plan = buildCleanupPlan(before, contract, { policyDigest: HASH });
  const dryRunReceipt = buildPlanningReceipt(before, plan, {
    signerKeyId: signer.signerKeyId, now: () => new Date('2026-08-30T00:00:01.000Z'),
  });
  const approval = buildCleanupApproval(plan, dryRunReceipt, {
    signerKeyId: AUTH_SIGNER, nonce: 'approval-recovery',
    expiresAt: '2026-08-30T00:10:00.000Z',
    now: () => new Date('2026-08-30T00:00:02.000Z'),
  });
  let applyTick = 3;
  await assert.rejects(() => applyCleanupExecution({
    runtimeDirectory, checkoutRoot, inventoryBefore: before, plan, approval, dryRunReceipt,
    ...signer, now: () => new Date(`2026-08-30T00:00:${String(applyTick++).padStart(2, '0')}.000Z`),
    reloadAuthority: async () => ({ state: 'eligible', row: row(), derivedFromResultDigest: null }),
    mutate: async () => ({ outcome: 'success' }),
    reconcile: async ({ action }) => ({
      state: 'absent', resourceClass: action.resourceClass,
      immutableIdentity: action.immutableIdentity, postconditionDigest: HASH, failureClass: 'none',
    }),
    buildInventoryAfter: async () => inventory([], '2026-08-30T00:00:08.000Z'),
    afterBoundary: async (boundary) => {
      if (boundary === 'approval_finalized') throw Object.assign(new Error('simulated crash'), { code: 'SIMULATED_CRASH' });
    },
  }), /simulated crash/);
  assert.equal(inspectDeploymentCleanupState({ runtimeDirectory, deploymentId: 'deploy-1' }).state, 'active');

  let recoverTick = 20;
  const recovered = await recoverCleanupExecution({
    runtimeDirectory, checkoutRoot, inventoryBefore: before, plan, approval, dryRunReceipt,
    ...signer, controllerRunId: 'recover-1', projectLockObservationDigest: HASH,
    deploymentLockObservationDigest: HASH,
    reloadAuthority: async () => { throw new Error('terminal recovery cannot reload'); },
    mutate: async () => { throw new Error('terminal recovery cannot mutate'); },
    reconcile: async () => { throw new Error('terminal recovery cannot reconcile'); },
    buildInventoryAfter: async () => { throw new Error('terminal recovery must use persisted inventory'); },
    now: () => new Date(`2026-08-30T00:01:${String(recoverTick++).padStart(2, '0')}.000Z`),
  });
  assert.equal(recovered.state, 'cleaned');
  assert.equal(parseStrictJson(readFileSync(recovered.receiptOutputPath)).state, 'cleaned');
  assert.equal(inspectDeploymentCleanupState({ runtimeDirectory, deploymentId: 'deploy-1' }).state, 'clear');
});

test('recovery reconciles an open intent exactly once and never replays its mutation', async () => {
  const checkoutRoot = mkdtempSync(path.join(os.tmpdir(), 'cleanup-intent-checkout-'));
  const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), 'cleanup-intent-runtime-'));
  chmodSync(checkoutRoot, 0o700);
  chmodSync(runtimeDirectory, 0o700);
  const signer = keys(runtimeDirectory);
  const before = inventory([row()], '2026-08-30T00:00:00.000Z');
  const plan = buildCleanupPlan(before, contract, { policyDigest: HASH });
  const dryRunReceipt = buildPlanningReceipt(before, plan, {
    signerKeyId: signer.signerKeyId, now: () => new Date('2026-08-30T00:00:01.000Z'),
  });
  const approval = buildCleanupApproval(plan, dryRunReceipt, {
    signerKeyId: AUTH_SIGNER, nonce: 'approval-intent',
    expiresAt: '2026-08-30T00:10:00.000Z',
    now: () => new Date('2026-08-30T00:00:02.000Z'),
  });
  let applyMutations = 0;
  let applyTick = 3;
  await assert.rejects(() => applyCleanupExecution({
    runtimeDirectory, checkoutRoot, inventoryBefore: before, plan, approval, dryRunReceipt,
    ...signer, now: () => new Date(`2026-08-30T00:00:${String(applyTick++).padStart(2, '0')}.000Z`),
    reloadAuthority: async () => ({ state: 'eligible', row: row(), derivedFromResultDigest: null }),
    mutate: async () => { applyMutations += 1; return { outcome: 'success' }; },
    reconcile: async () => { throw new Error('not reached'); },
    buildInventoryAfter: async () => { throw new Error('not reached'); },
    afterBoundary: async (boundary) => {
      if (boundary === 'checkpoint_intent') throw new Error('simulated intent crash');
    },
  }), /journal is incomplete/);
  assert.equal(applyMutations, 0);

  const wrongKeyRoot = mkdtempSync(path.join(os.tmpdir(), 'cleanup-recovery-wrong-key-'));
  chmodSync(wrongKeyRoot, 0o700);
  const wrongSigner = keys(wrongKeyRoot);
  let wrongKeyRecoveryCalls = 0;
  await assert.rejects(() => recoverCleanupExecution({
    runtimeDirectory, checkoutRoot, inventoryBefore: before, plan, approval, dryRunReceipt,
    ...signer, publicKeyPath: wrongSigner.publicKeyPath, controllerRunId: 'recover-wrong-key',
    projectLockObservationDigest: HASH, deploymentLockObservationDigest: HASH,
    reloadAuthority: async () => { wrongKeyRecoveryCalls += 1; throw new Error('not reached'); },
    mutate: async () => { wrongKeyRecoveryCalls += 1; return { outcome: 'success' }; },
    reconcile: async () => { wrongKeyRecoveryCalls += 1; throw new Error('not reached'); },
    buildInventoryAfter: async () => { wrongKeyRecoveryCalls += 1; throw new Error('not reached'); },
  }), /key bytes changed/);
  assert.equal(wrongKeyRecoveryCalls, 0);

  let mismatchedMutations = 0;
  await assert.rejects(() => recoverCleanupExecution({
    runtimeDirectory, checkoutRoot,
    inventoryBefore: { ...before, observedAt: '2026-08-30T00:00:09.000Z' },
    plan, approval, dryRunReceipt, ...signer, controllerRunId: 'recover-wrong',
    projectLockObservationDigest: HASH, deploymentLockObservationDigest: HASH,
    reloadAuthority: async () => { throw new Error('not reached'); },
    mutate: async () => { mismatchedMutations += 1; return { outcome: 'success' }; },
    reconcile: async () => { throw new Error('not reached'); },
    buildInventoryAfter: async () => { throw new Error('not reached'); },
  }), /digest binding/);
  assert.equal(mismatchedMutations, 0);

  let recoveryMutations = 0;
  let recoverTick = 20;
  const recovered = await recoverCleanupExecution({
    runtimeDirectory, checkoutRoot, inventoryBefore: before, plan, approval, dryRunReceipt,
    ...signer, controllerRunId: 'recover-intent', projectLockObservationDigest: HASH,
    deploymentLockObservationDigest: HASH,
    reloadAuthority: async () => { throw new Error('completed recovery cannot reload'); },
    mutate: async () => { recoveryMutations += 1; return { outcome: 'success' }; },
    reconcile: async ({ action }) => ({
      state: 'absent', resourceClass: action.resourceClass,
      immutableIdentity: action.immutableIdentity, postconditionDigest: HASH, failureClass: 'none',
    }),
    buildInventoryAfter: async () => inventory([], '2026-08-30T00:01:22.000Z'),
    now: () => new Date(`2026-08-30T00:01:${String(recoverTick++).padStart(2, '0')}.000Z`),
  });
  assert.equal(recoveryMutations, 0);
  assert.equal(recovered.state, 'recovered');
});

test('SIGKILL-before-remove recovery records an exact survivor refusal as ambiguous and halts', async () => {
  const values = fixture('sigkill-before-remove-survivor');
  const secondId = 'e'.repeat(64);
  const before = inventory([row(), row(secondId)], '2026-08-30T00:00:00.000Z');
  const plan = buildCleanupPlan(before, contract, { policyDigest: HASH });
  const dryRunReceipt = buildPlanningReceipt(before, plan, {
    signerKeyId: values.signer.signerKeyId,
    now: () => new Date('2026-08-30T00:00:01.000Z'),
  });
  const approval = buildCleanupApproval(plan, dryRunReceipt, {
    signerKeyId: AUTH_SIGNER, nonce: 'sigkill-before-remove-survivor',
    expiresAt: '2026-08-30T12:00:00.000Z',
    now: () => new Date('2026-08-30T00:00:02.000Z'),
  });
  const execution = { ...values, inventoryBefore: before, plan, dryRunReceipt, approval };
  let mutations = 0;
  await assert.rejects(() => applyCleanupExecution({
    ...execution, ...values.signer, now: () => new Date('2026-08-30T00:01:00.000Z'),
    reloadAuthority: async ({ action }) => ({
      state: 'eligible', row: row(action.immutableIdentity), derivedFromResultDigest: null,
    }),
    mutate: async () => { mutations += 1; return { outcome: 'success' }; },
    reconcile: async () => { throw new Error('SIGKILL occurs before reconciliation'); },
    buildInventoryAfter: async () => { throw new Error('SIGKILL occurs before final inventory'); },
    afterBoundary: async (boundary) => {
      if (boundary === 'checkpoint_intent') throw new Error('simulated SIGKILL before remove');
    },
  }), /journal is incomplete/);
  assert.equal(mutations, 0);

  let reconciliations = 0;
  let laterAuthorityReloads = 0;
  const recovered = await recoverCleanupExecution({
    ...execution, ...values.signer, ...recoveryIdentity(),
    reconcile: async ({ action }) => {
      reconciliations += 1;
      return {
        state: 'refused', resourceClass: action.resourceClass,
        immutableIdentity: action.immutableIdentity, postconditionDigest: null,
        failureClass: 'active',
      };
    },
    reloadAuthority: async () => {
      laterAuthorityReloads += 1;
      throw new Error('ambiguous recovery must halt later actions');
    },
    mutate: async () => { mutations += 1; return { outcome: 'success' }; },
    buildInventoryAfter: async () => inventory(
      [row(), row(secondId)], '2026-08-30T00:02:00.000Z',
    ),
    now: () => new Date('2026-08-30T00:03:00.000Z'),
  });
  assert.equal(mutations, 0);
  assert.equal(reconciliations, 1);
  assert.equal(laterAuthorityReloads, 0);
  assert.equal(recovered.state, 'ambiguous');
  assert.deepEqual(recovered.receipt.results.map(({ result, failureClass }) => ({
    result, failureClass,
  })), [
    { result: 'ambiguous', failureClass: 'active' },
    { result: 'refused', failureClass: 'active' },
  ]);
  const verified = verifySignedArtifact({
    inputPath: recovered.receiptOutputPath,
    publicKeyPath: values.signer.publicKeyPath,
    expectedFingerprint: values.signer.signerKeyId,
    checkoutRoot: values.checkoutRoot,
    now: new Date('2026-08-30T00:04:00.000Z'),
  });
  assert.equal(verified.artifact.state, 'ambiguous');
  const journal = verifyCleanupJournal({
    runtimeDirectory: values.runtimeDirectory,
    approvalDigest: canonicalSha256(approval), publicKey: values.signer.publicKey,
    expectedSignerKeyId: values.signer.signerKeyId,
  });
  assert.equal(journal.records.find((entry) => (
    entry.checkpoint.checkpointType === 'result'
  )).checkpoint.payload.result, 'ambiguous');
});

test('recovery reuses exact persisted inventory after the pre-terminal crash boundary', async () => {
  const checkoutRoot = mkdtempSync(path.join(os.tmpdir(), 'cleanup-inventory-crash-checkout-'));
  const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), 'cleanup-inventory-crash-runtime-'));
  chmodSync(checkoutRoot, 0o700);
  chmodSync(runtimeDirectory, 0o700);
  const signer = keys(runtimeDirectory);
  const before = inventory([row()], '2026-08-30T00:00:00.000Z');
  const plan = buildCleanupPlan(before, contract, { policyDigest: HASH });
  const dryRunReceipt = buildPlanningReceipt(before, plan, {
    signerKeyId: signer.signerKeyId, now: () => new Date('2026-08-30T00:00:01.000Z'),
  });
  const approval = buildCleanupApproval(plan, dryRunReceipt, {
    signerKeyId: AUTH_SIGNER, nonce: 'approval-inventory-crash',
    expiresAt: '2026-08-30T00:10:00.000Z',
    now: () => new Date('2026-08-30T00:00:02.000Z'),
  });
  let tick = 3;
  await assert.rejects(() => applyCleanupExecution({
    runtimeDirectory, checkoutRoot, inventoryBefore: before, plan, approval, dryRunReceipt,
    ...signer, now: () => new Date(`2026-08-30T00:00:${String(tick++).padStart(2, '0')}.000Z`),
    reloadAuthority: async () => ({ state: 'eligible', row: row(), derivedFromResultDigest: null }),
    mutate: async () => ({ outcome: 'success' }),
    reconcile: async ({ action }) => ({ state: 'absent', resourceClass: action.resourceClass,
      immutableIdentity: action.immutableIdentity, postconditionDigest: HASH, failureClass: 'none' }),
    buildInventoryAfter: async () => inventory([], '2026-08-30T00:00:08.000Z'),
    afterBoundary: async (boundary) => {
      if (boundary === 'inventory_after_persisted') throw new Error('simulated inventory crash');
    },
  }), /simulated inventory crash/);
  let regenerated = 0;
  const recovered = await recoverCleanupExecution({
    runtimeDirectory, checkoutRoot, inventoryBefore: before, plan, approval, dryRunReceipt,
    ...signer, controllerRunId: 'recover-inventory', projectLockObservationDigest: HASH,
    deploymentLockObservationDigest: HASH,
    reloadAuthority: async () => { throw new Error('not reached'); },
    mutate: async () => { throw new Error('not reached'); },
    reconcile: async () => { throw new Error('not reached'); },
    buildInventoryAfter: async () => {
      regenerated += 1;
      return inventory([], '2026-08-30T00:02:00.000Z');
    },
    now: () => new Date('2026-08-30T00:03:00.000Z'),
  });
  assert.equal(regenerated, 0);
  assert.equal(recovered.state, 'recovered');
});

test('incomplete final inventory cannot produce a terminal cleaned receipt', async () => {
  const checkoutRoot = mkdtempSync(path.join(os.tmpdir(), 'cleanup-final-gate-checkout-'));
  const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), 'cleanup-final-gate-runtime-'));
  chmodSync(checkoutRoot, 0o700);
  chmodSync(runtimeDirectory, 0o700);
  const signer = keys(runtimeDirectory);
  const before = inventory([row()], '2026-08-30T00:00:00.000Z');
  const plan = buildCleanupPlan(before, contract, { policyDigest: HASH });
  const dryRunReceipt = buildPlanningReceipt(before, plan, {
    signerKeyId: signer.signerKeyId, now: () => new Date('2026-08-30T00:00:01.000Z'),
  });
  const approval = buildCleanupApproval(plan, dryRunReceipt, {
    signerKeyId: AUTH_SIGNER, nonce: 'approval-final-gate',
    expiresAt: '2026-08-30T00:10:00.000Z',
    now: () => new Date('2026-08-30T00:00:02.000Z'),
  });
  let tick = 3;
  await assert.rejects(() => applyCleanupExecution({
    runtimeDirectory, checkoutRoot, inventoryBefore: before, plan, approval, dryRunReceipt,
    ...signer, now: () => new Date(`2026-08-30T00:00:${String(tick++).padStart(2, '0')}.000Z`),
    reloadAuthority: async () => ({ state: 'eligible', row: row(), derivedFromResultDigest: null }),
    mutate: async () => ({ outcome: 'success' }),
    reconcile: async ({ action }) => ({ state: 'absent', resourceClass: action.resourceClass,
      immutableIdentity: action.immutableIdentity, postconditionDigest: HASH, failureClass: 'none' }),
    buildInventoryAfter: async () => ({
      ...inventory([], '2026-08-30T00:00:08.000Z'), complete: false,
      ambiguities: [{
        adapter: 'docker', resourceClass: 'compose_network', failureClass: 'query_failed',
        scope: 'postcondition-query',
      }],
    }),
  }), /incomplete or ambiguous/);
});

test('a restarted container after successful stop and failed remove refuses finalization', async () => {
  const checkoutRoot = mkdtempSync(path.join(os.tmpdir(), 'cleanup-stop-postcondition-checkout-'));
  const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), 'cleanup-stop-postcondition-runtime-'));
  chmodSync(checkoutRoot, 0o700);
  chmodSync(runtimeDirectory, 0o700);
  const signer = keys(runtimeDirectory);
  const containerOwnership = {
    ...ownership(), resourceClass: 'compose_container', immutableIdentity: ID,
  };
  const containerRow = (running, observationDigest = HASH) => ({
    ...row(), resourceClass: 'compose_container', ownership: containerOwnership,
    ownershipDigest: canonicalSha256(containerOwnership), observationDigest, running,
  });
  const before = inventory([containerRow(true)], '2026-08-30T00:00:00.000Z');
  const containerContract = { resourceClasses: [{
    classId: 'compose_container', dependsOn: [], cleanupPolicies: ['exact_delete'],
  }] };
  const plan = buildCleanupPlan(before, containerContract, { policyDigest: HASH });
  const dryRunReceipt = buildPlanningReceipt(before, plan, {
    signerKeyId: signer.signerKeyId, now: () => new Date('2026-08-30T00:00:01.000Z'),
  });
  const approval = buildCleanupApproval(plan, dryRunReceipt, {
    signerKeyId: AUTH_SIGNER, nonce: 'approval-stop-restart',
    expiresAt: '2026-08-30T12:00:00.000Z',
    now: () => new Date('2026-08-30T00:00:02.000Z'),
  });
  await assert.rejects(() => applyCleanupExecution({
    runtimeDirectory, checkoutRoot, inventoryBefore: before, plan, approval, dryRunReceipt,
    ...signer, now: () => new Date('2026-08-30T00:01:00.000Z'),
    reloadAuthority: async ({ action, predecessorResultDigest }) => ({
      state: 'eligible', row: containerRow(action.action === 'stop'),
      derivedFromResultDigest: predecessorResultDigest,
    }),
    mutate: async ({ action }) => ({
      outcome: action.action === 'stop' ? 'success' : 'command_failed',
    }),
    reconcile: async ({ action }) => ({
      state: action.action === 'stop' ? 'satisfied' : 'absent',
      resourceClass: action.resourceClass, immutableIdentity: action.immutableIdentity,
      postconditionDigest: HASH, failureClass: 'none',
    }),
    buildInventoryAfter: async () => inventory(
      [containerRow(true)], '2026-08-30T00:00:08.000Z',
    ),
  }), /does not corroborate a stopped container/);
  const ledger = createCleanupLedger({
    runtimeDirectory, deploymentId: 'deploy-1', approvalDigest: canonicalSha256(approval),
  });
  assert.equal(readApprovalState(ledger).value.state, 'reserved');
});

test('a stopped container absent after its later successful remove passes final validation', async () => {
  const checkoutRoot = mkdtempSync(path.join(os.tmpdir(), 'cleanup-stop-remove-checkout-'));
  const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), 'cleanup-stop-remove-runtime-'));
  chmodSync(checkoutRoot, 0o700);
  chmodSync(runtimeDirectory, 0o700);
  const signer = keys(runtimeDirectory);
  const containerOwnership = {
    ...ownership(), resourceClass: 'compose_container', immutableIdentity: ID,
  };
  const containerRow = (running) => ({
    ...row(), resourceClass: 'compose_container', ownership: containerOwnership,
    ownershipDigest: canonicalSha256(containerOwnership), running,
  });
  const before = inventory([containerRow(true)], '2026-08-30T00:00:00.000Z');
  const containerContract = { resourceClasses: [{
    classId: 'compose_container', dependsOn: [], cleanupPolicies: ['exact_delete'],
  }] };
  const plan = buildCleanupPlan(before, containerContract, { policyDigest: HASH });
  const dryRunReceipt = buildPlanningReceipt(before, plan, {
    signerKeyId: signer.signerKeyId, now: () => new Date('2026-08-30T00:00:01.000Z'),
  });
  const approval = buildCleanupApproval(plan, dryRunReceipt, {
    signerKeyId: AUTH_SIGNER, nonce: 'approval-stop-remove',
    expiresAt: '2026-08-30T12:00:00.000Z',
    now: () => new Date('2026-08-30T00:00:02.000Z'),
  });
  const result = await applyCleanupExecution({
    runtimeDirectory, checkoutRoot, inventoryBefore: before, plan, approval, dryRunReceipt,
    ...signer, now: () => new Date('2026-08-30T00:01:00.000Z'),
    reloadAuthority: async ({ action, predecessorResultDigest }) => ({
      state: 'eligible', row: containerRow(action.action === 'stop'),
      derivedFromResultDigest: predecessorResultDigest,
    }),
    mutate: async () => ({ outcome: 'success' }),
    reconcile: async ({ action }) => ({
      state: action.action === 'stop' ? 'satisfied' : 'absent',
      resourceClass: action.resourceClass, immutableIdentity: action.immutableIdentity,
      postconditionDigest: HASH, failureClass: 'none',
    }),
    buildInventoryAfter: async () => inventory([], '2026-08-30T00:00:08.000Z'),
  });
  assert.equal(result.state, 'cleaned');
});

test('approval expiring exactly at reservation remains unused and recoverable without mutation', async () => {
  const values = fixture('reservation-expiry-boundary');
  const approval = buildCleanupApproval(values.plan, values.dryRunReceipt, {
    signerKeyId: AUTH_SIGNER, nonce: 'reservation-expiry-boundary',
    expiresAt: '2026-08-30T00:00:05.000Z',
    now: () => new Date('2026-08-30T00:00:02.000Z'),
  });
  const instants = [
    '2026-08-30T00:00:03.000Z',
    '2026-08-30T00:00:04.000Z',
    '2026-08-30T00:00:05.000Z',
  ];
  let mutationCalls = 0;
  await assert.rejects(() => applyCleanupExecution({
    ...values, approval, ...values.signer,
    now: () => new Date(instants.shift()),
    ...executionCallbacks(async () => {}),
    mutate: async () => { mutationCalls += 1; return { outcome: 'success' }; },
  }), /approval has expired/);
  assert.deepEqual(instants, []);
  assert.equal(mutationCalls, 0);

  const approvalDigest = canonicalSha256(approval);
  const ledger = createCleanupLedger({
    runtimeDirectory: values.runtimeDirectory, deploymentId: 'deploy-1', approvalDigest,
  });
  assert.equal(readApprovalState(ledger).value.state, 'unused');
  const pointer = readActiveCleanupPointer(ledger);
  assert.equal(pointer.value.state, 'active');
  assert.equal(pointer.value.approvalDigest, approvalDigest);
  const journal = verifyCleanupJournal({
    runtimeDirectory: values.runtimeDirectory, approvalDigest,
    publicKey: values.signer.publicKey,
    expectedSignerKeyId: values.signer.signerKeyId,
    expectedGenesisDigest: pointer.value.journalGenesisDigest,
  });
  assert.equal(journal.recordCount, 1);
  assert.equal(journal.records[0].checkpoint.checkpointType, 'genesis');

  const recovered = await recoverCleanupExecution({
    ...values, approval, ...values.signer, ...recoveryIdentity(),
    ...executionCallbacks(async () => {}),
    reloadAuthority: async () => { throw new Error('pre-reservation recovery cannot reload'); },
    mutate: async () => { throw new Error('pre-reservation recovery cannot mutate'); },
    reconcile: async () => { throw new Error('pre-reservation recovery cannot reconcile'); },
    buildInventoryAfter: async () => { throw new Error('pre-reservation recovery cannot observe'); },
    now: () => new Date('2026-08-30T00:00:06.000Z'),
  });
  assert.equal(recovered.state, 'cleared_pre_reservation');
  assert.equal(inspectDeploymentCleanupState({
    runtimeDirectory: values.runtimeDirectory, deploymentId: 'deploy-1',
  }).state, 'clear');
  assert.equal(readActiveCleanupPointer(ledger).value.disposition, 'pre_reservation');
});

test('signing key and immutable receipt collision fail before reservation or mutation', async () => {
  const checkoutRoot = mkdtempSync(path.join(os.tmpdir(), 'cleanup-preflight-checkout-'));
  chmodSync(checkoutRoot, 0o700);
  const before = inventory([row()], '2026-08-30T00:00:00.000Z');
  const plan = buildCleanupPlan(before, contract, { policyDigest: HASH });

  async function attempt(runtimeDirectory, signer, approval, overrides = {}) {
    let mutations = 0;
    await assert.rejects(() => applyCleanupExecution({
      runtimeDirectory, checkoutRoot, inventoryBefore: before, plan, approval,
      dryRunReceipt: buildPlanningReceipt(before, plan, {
        signerKeyId: signer.signerKeyId, now: () => new Date('2026-08-30T00:00:01.000Z'),
      }),
      ...signer, now: () => new Date('2026-08-30T00:00:03.000Z'),
      reloadAuthority: async () => ({ state: 'eligible', row: row(), derivedFromResultDigest: null }),
      mutate: async () => { mutations += 1; return { outcome: 'success' }; },
      reconcile: async () => { throw new Error('not reached'); },
      buildInventoryAfter: async () => { throw new Error('not reached'); },
      ...overrides,
    }));
    const ledger = createCleanupLedger({
      runtimeDirectory, deploymentId: 'deploy-1', approvalDigest: canonicalSha256(approval),
    });
    assert.equal(readApprovalState(ledger), null);
    assert.equal(mutations, 0);
  }

  const wrongRuntime = mkdtempSync(path.join(os.tmpdir(), 'cleanup-preflight-key-'));
  chmodSync(wrongRuntime, 0o700);
  const signer = keys(wrongRuntime);
  const different = keys(wrongRuntime);
  const wrongReceipt = buildPlanningReceipt(before, plan, {
    signerKeyId: signer.signerKeyId, now: () => new Date('2026-08-30T00:00:01.000Z'),
  });
  const wrongApproval = buildCleanupApproval(plan, wrongReceipt, {
    signerKeyId: AUTH_SIGNER, nonce: 'preflight-wrong-key', expiresAt: '2026-08-30T12:00:00.000Z',
    now: () => new Date('2026-08-30T00:00:02.000Z'),
  });
  await attempt(wrongRuntime, signer, wrongApproval, { publicKeyPath: different.publicKeyPath });

  const permissiveRuntime = mkdtempSync(path.join(os.tmpdir(), 'cleanup-preflight-mode-'));
  chmodSync(permissiveRuntime, 0o700);
  const permissiveSigner = keys(permissiveRuntime);
  const permissiveReceipt = buildPlanningReceipt(before, plan, {
    signerKeyId: permissiveSigner.signerKeyId, now: () => new Date('2026-08-30T00:00:01.000Z'),
  });
  const permissiveApproval = buildCleanupApproval(plan, permissiveReceipt, {
    signerKeyId: AUTH_SIGNER, nonce: 'preflight-permissive-key',
    expiresAt: '2026-08-30T12:00:00.000Z',
    now: () => new Date('2026-08-30T00:00:02.000Z'),
  });
  chmodSync(permissiveSigner.privateKeyPath, 0o644);
  await attempt(permissiveRuntime, permissiveSigner, permissiveApproval);

  const collisionRuntime = mkdtempSync(path.join(os.tmpdir(), 'cleanup-preflight-collision-'));
  chmodSync(collisionRuntime, 0o700);
  const collisionSigner = keys(collisionRuntime);
  const collisionReceipt = buildPlanningReceipt(before, plan, {
    signerKeyId: collisionSigner.signerKeyId, now: () => new Date('2026-08-30T00:00:01.000Z'),
  });
  const collisionApproval = buildCleanupApproval(plan, collisionReceipt, {
    signerKeyId: AUTH_SIGNER, nonce: 'preflight-collision', expiresAt: '2026-08-30T12:00:00.000Z',
    now: () => new Date('2026-08-30T00:00:02.000Z'),
  });
  const collisionLedger = createCleanupLedger({
    runtimeDirectory: collisionRuntime, deploymentId: 'deploy-1',
    approvalDigest: canonicalSha256(collisionApproval),
  });
  writeFileSync(path.join(collisionLedger.executionRoot, 'cleanup-receipt.json'), Buffer.from('{}'), { mode: 0o600 });
  await attempt(collisionRuntime, collisionSigner, collisionApproval);
});

test('recovery validates a fresh final inventory before persisting and can retry transient bad evidence', async () => {
  const values = fixture('transient-final-inventory');
  await assert.rejects(() => applyCleanupExecution({
    ...values, ...values.signer, now: () => new Date('2026-08-30T00:00:03.000Z'),
    ...executionCallbacks(async () => {}, {
      ...inventory([], '2026-08-30T00:00:08.000Z'), complete: false,
      ambiguities: [{ adapter: 'docker', resourceClass: 'compose_network',
        failureClass: 'query_failed', scope: 'transient' }],
    }),
  }), /incomplete or ambiguous/);
  const ledger = createCleanupLedger({
    runtimeDirectory: values.runtimeDirectory, deploymentId: 'deploy-1',
    approvalDigest: canonicalSha256(values.approval),
  });
  const inventoryPath = path.join(ledger.executionRoot, 'inventory-after.json');
  let attempts = 0;
  const recovery = (good) => recoverCleanupExecution({
    ...values, ...values.signer, ...recoveryIdentity(),
    reloadAuthority: async () => { throw new Error('completed actions cannot reload'); },
    mutate: async () => { throw new Error('completed actions cannot mutate'); },
    reconcile: async () => { throw new Error('completed actions cannot reconcile'); },
    buildInventoryAfter: async () => {
      attempts += 1;
      return good ? inventory([], '2026-08-30T00:02:00.000Z') : {
        ...inventory([], '2026-08-30T00:01:00.000Z'), complete: false,
        ambiguities: [{ adapter: 'docker', resourceClass: 'compose_network',
          failureClass: 'query_failed', scope: 'transient-recovery' }],
      };
    },
    now: () => new Date('2026-08-30T00:03:00.000Z'),
  });
  await assert.rejects(() => recovery(false), /incomplete or ambiguous/);
  assert.equal(existsSync(inventoryPath), false);
  const recovered = await recovery(true);
  assert.equal(attempts, 2);
  assert.equal(recovered.state, 'recovered');
});

for (const failureClass of ['identity_changed', 'malformed', 'unsupported']) {
  test(`a ${failureClass} authority refusal produces a consistent refused receipt`, async () => {
    const values = fixture(`refused-${failureClass}`);
    const result = await applyCleanupExecution({
      ...values, ...values.signer, now: () => new Date('2026-08-30T00:00:20.000Z'),
      reloadAuthority: async () => ({ state: 'refused', failureClass }),
      mutate: async () => { throw new Error('refusal cannot mutate'); },
      reconcile: async () => { throw new Error('refusal cannot reconcile'); },
      buildInventoryAfter: async () => inventory([row()], '2026-08-30T00:00:08.000Z'),
    });
    const receipt = parseStrictJson(readFileSync(result.receiptOutputPath));
    assert.equal(result.state, 'refused');
    assert.equal(receipt.state, 'refused');
    assert.equal(receipt.results[0].result, 'refused');
    assert.equal(receipt.refusals[0].failureClass, failureClass);
  });
}

test('one-action clean mutation failure produces a signed partial receipt', async () => {
  const values = fixture('signed-partial-mutation-failure');
  const result = await applyCleanupExecution({
    ...values, ...values.signer, now: () => new Date('2026-08-30T00:01:00.000Z'),
    reloadAuthority: async () => ({
      state: 'eligible', row: row(), derivedFromResultDigest: null,
    }),
    mutate: async () => ({ outcome: 'command_failed' }),
    reconcile: async ({ action }) => ({
      state: 'absent', resourceClass: action.resourceClass,
      immutableIdentity: action.immutableIdentity, postconditionDigest: HASH,
      failureClass: 'none',
    }),
    buildInventoryAfter: async () => inventory([], '2026-08-30T00:00:08.000Z'),
  });
  const verified = verifySignedArtifact({
    inputPath: result.receiptOutputPath, publicKeyPath: values.signer.publicKeyPath,
    expectedFingerprint: values.signer.signerKeyId, checkoutRoot: values.checkoutRoot,
    now: new Date('2026-08-30T00:02:00.000Z'),
  });
  assert.equal(result.state, 'partial');
  assert.equal(verified.digest, result.receiptDigest);
  assert.equal(verified.artifact.state, 'partial');
  assert.deepEqual(verified.artifact.results, [{
    sequence: 1, resourceClass: 'compose_network', immutableIdentity: ID,
    result: 'failed', failureClass: 'mutation_failed',
  }]);
  assert.deepEqual(verified.artifact.postconditions, [{
    sequence: 1, resourceClass: 'compose_network', immutableIdentity: ID,
    state: 'satisfied', failureClass: 'none',
  }]);
});

test('receipt privacy rejection after reservation leaves no terminal evidence or receipt sidecar', async () => {
  const values = fixture('receipt-core-private-identifier');
  const privateDeploymentId = `bc1${'q'.repeat(40)}`;
  const privateOwnership = { ...ownership(), deploymentId: privateDeploymentId };
  const privateRow = {
    ...row(), ownership: privateOwnership,
    ownershipDigest: canonicalSha256(privateOwnership),
  };
  const before = {
    ...inventory([privateRow], '2026-08-30T00:00:00.000Z'),
    deploymentId: privateDeploymentId,
  };
  const plan = buildCleanupPlan(before, contract, { policyDigest: HASH });
  const dryRunReceipt = buildPlanningReceipt(before, plan, {
    signerKeyId: values.signer.signerKeyId,
    now: () => new Date('2026-08-30T00:00:01.000Z'),
  });
  const approval = buildCleanupApproval(plan, dryRunReceipt, {
    signerKeyId: AUTH_SIGNER, nonce: 'receipt-core-private-identifier',
    expiresAt: '2026-08-30T12:00:00.000Z',
    now: () => new Date('2026-08-30T00:00:02.000Z'),
  });
  const boundaries = [];
  let mutations = 0;
  await assert.rejects(() => applyCleanupExecution({
    ...values, inventoryBefore: before, plan, dryRunReceipt, approval,
    ...values.signer, now: () => new Date('2026-08-30T00:01:00.000Z'),
    reloadAuthority: async () => ({
      state: 'eligible', row: privateRow, derivedFromResultDigest: null,
    }),
    mutate: async () => { mutations += 1; return { outcome: 'success' }; },
    reconcile: async ({ action }) => ({
      state: 'absent', resourceClass: action.resourceClass,
      immutableIdentity: action.immutableIdentity, postconditionDigest: HASH,
      failureClass: 'none',
    }),
    buildInventoryAfter: async () => ({
      ...inventory([], '2026-08-30T00:00:08.000Z'), deploymentId: privateDeploymentId,
    }),
    afterBoundary: async (boundary) => boundaries.push(boundary),
  }), /private material/);
  assert.equal(mutations, 1);
  assert.equal(boundaries.includes('approval_reserved'), true);
  assert.equal(boundaries.includes('inventory_after_persisted'), true);
  assert.equal(boundaries.includes('terminal_appended'), false);

  const approvalDigest = canonicalSha256(approval);
  const ledger = createCleanupLedger({
    runtimeDirectory: values.runtimeDirectory,
    deploymentId: privateDeploymentId,
    approvalDigest,
  });
  assert.equal(readApprovalState(ledger).value.state, 'reserved');
  const journal = verifyCleanupJournal({
    runtimeDirectory: values.runtimeDirectory, approvalDigest,
    publicKey: values.signer.publicKey,
    expectedSignerKeyId: values.signer.signerKeyId,
  });
  assert.equal(journal.records.some((entry) => (
    entry.checkpoint.checkpointType === 'terminal'
  )), false);
  const receiptPath = path.join(ledger.executionRoot, 'cleanup-receipt.json');
  for (const sidecar of [receiptPath, `${receiptPath}.sig`, `${receiptPath.slice(0, -5)}.sha256`]) {
    assert.equal(existsSync(sidecar), false);
  }
});

test('apply verifies receipt bytes, signature, and checksum from disk before tombstoning', async () => {
  const values = fixture('apply-receipt-corruption');
  await assert.rejects(() => applyCleanupExecution({
    ...values, ...values.signer, now: () => new Date('2026-08-30T00:00:20.000Z'),
    ...executionCallbacks(async (boundary) => {
      if (boundary === 'receipt_written') {
        const ledger = createCleanupLedger({
          runtimeDirectory: values.runtimeDirectory, deploymentId: 'deploy-1',
          approvalDigest: canonicalSha256(values.approval),
        });
        writeFileSync(path.join(ledger.executionRoot, 'cleanup-receipt.json'), Buffer.from('{}'));
      }
    }),
  }), /checksum verification|artifactType|fields are invalid/);
  assert.equal(inspectDeploymentCleanupState({
    runtimeDirectory: values.runtimeDirectory, deploymentId: 'deploy-1',
  }).state, 'active');
});

test('recovery refuses a missing receipt sidecar at receipt_written and leaves the pointer active', async () => {
  const values = fixture('recovery-receipt-removal');
  await assert.rejects(() => applyCleanupExecution({
    ...values, ...values.signer, now: () => new Date('2026-08-30T00:00:20.000Z'),
    ...executionCallbacks(async (boundary) => {
      if (boundary === 'approval_finalized') throw new Error('finalized crash');
    }),
  }), /finalized crash/);
  await assert.rejects(() => recoverCleanupExecution({
    ...values, ...values.signer, ...recoveryIdentity(),
    reloadAuthority: async () => { throw new Error('not reached'); },
    mutate: async () => { throw new Error('not reached'); },
    reconcile: async () => { throw new Error('not reached'); },
    buildInventoryAfter: async () => { throw new Error('not reached'); },
    now: () => new Date('2026-08-30T00:01:00.000Z'),
    afterBoundary: async (boundary) => {
      if (boundary === 'receipt_written') {
        const ledger = createCleanupLedger({
          runtimeDirectory: values.runtimeDirectory, deploymentId: 'deploy-1',
          approvalDigest: canonicalSha256(values.approval),
        });
        unlinkSync(path.join(ledger.executionRoot, 'cleanup-receipt.json.sig'));
      }
    },
  }), /ENOENT/);
  assert.equal(inspectDeploymentCleanupState({
    runtimeDirectory: values.runtimeDirectory, deploymentId: 'deploy-1',
  }).state, 'active');
});

test('unused pre-reservation cleanup verifies its signed journal before clearing the pointer', async () => {
  const values = fixture('corrupt-pre-reservation-journal');
  await assert.rejects(() => applyCleanupExecution({
    ...values, ...values.signer, now: () => new Date('2026-08-30T00:00:20.000Z'),
    ...executionCallbacks(async (boundary) => {
      if (boundary === 'pointer_published') throw new Error('pointer crash');
    }),
  }), /pointer crash/);
  const ledger = createCleanupLedger({
    runtimeDirectory: values.runtimeDirectory, deploymentId: 'deploy-1',
    approvalDigest: canonicalSha256(values.approval),
  });
  writeFileSync(path.join(ledger.executionRoot, 'action-journal.jsonl'), Buffer.from('{}\n'));
  await assert.rejects(() => recoverCleanupExecution({
    ...values, ...values.signer, ...recoveryIdentity(),
    ...executionCallbacks(async () => {}),
  }), /journal|checkpoint|envelope/);
  assert.equal(inspectDeploymentCleanupState({
    runtimeDirectory: values.runtimeDirectory, deploymentId: 'deploy-1',
  }).state, 'active');
});

test('recovery adopts an active pointer transition fsynced before its current pointer replacement', async () => {
  const values = fixture('orphan-pointer-transition');
  await assert.rejects(() => applyCleanupExecution({
    ...values, ...values.signer, now: () => new Date('2026-08-30T00:00:20.000Z'),
    ...executionCallbacks(async (boundary) => {
      if (boundary === 'pointer_published') throw new Error('pointer replacement crash');
    }),
  }), /pointer replacement crash/);
  const ledger = createCleanupLedger({
    runtimeDirectory: values.runtimeDirectory, deploymentId: 'deploy-1',
    approvalDigest: canonicalSha256(values.approval),
  });
  unlinkSync(ledger.activePointerPath);
  const recovered = await recoverCleanupExecution({
    ...values, ...values.signer, ...recoveryIdentity(),
    ...executionCallbacks(async () => {}),
    now: () => new Date('2026-08-30T00:01:00.000Z'),
  });
  assert.equal(recovered.state, 'cleared_pre_reservation');
  assert.equal(inspectDeploymentCleanupState({
    runtimeDirectory: values.runtimeDirectory, deploymentId: 'deploy-1',
  }).state, 'clear');
});

test('a later unused approval adopts its orphan active transition over the prior approval tombstone', async () => {
  const values = fixture('later-orphan-pointer-transition');
  await applyCleanupExecution({
    ...values, ...values.signer, now: () => new Date('2026-08-30T00:00:20.000Z'),
    ...executionCallbacks(async () => {}),
  });
  const laterApproval = buildCleanupApproval(values.plan, values.dryRunReceipt, {
    signerKeyId: AUTH_SIGNER, nonce: 'later-orphan-pointer-transition-2',
    expiresAt: '2026-08-30T12:00:00.000Z',
    now: () => new Date('2026-08-30T00:01:00.000Z'),
  });
  await assert.rejects(() => applyCleanupExecution({
    ...values, approval: laterApproval, ...values.signer,
    now: () => new Date('2026-08-30T00:02:00.000Z'),
    ...executionCallbacks(async (boundary) => {
      if (boundary === 'pointer_published') throw new Error('later pointer replacement crash');
    }),
  }), /later pointer replacement crash/);
  const laterLedger = createCleanupLedger({
    runtimeDirectory: values.runtimeDirectory, deploymentId: 'deploy-1',
    approvalDigest: canonicalSha256(laterApproval),
  });
  writeFileSync(laterLedger.activePointerPath, readFileSync(path.join(
    laterLedger.pointerTransitions, '000002.json',
  )));
  const recovered = await recoverCleanupExecution({
    ...values, approval: laterApproval, ...values.signer, ...recoveryIdentity(),
    ...executionCallbacks(async () => {}),
    now: () => new Date('2026-08-30T00:03:00.000Z'),
  });
  assert.equal(recovered.state, 'cleared_pre_reservation');
  const state = inspectDeploymentCleanupState({
    runtimeDirectory: values.runtimeDirectory, deploymentId: 'deploy-1',
  });
  assert.equal(state.state, 'clear');
  const pointer = readActiveCleanupPointer(laterLedger);
  assert.equal(pointer.value.generation, 4);
  assert.equal(pointer.value.approvalDigest, canonicalSha256(laterApproval));
});

test('recovery adopts a reserved approval transition fsynced before its current replacement', async () => {
  const values = fixture('orphan-approval-transition');
  await assert.rejects(() => applyCleanupExecution({
    ...values, ...values.signer, now: () => new Date('2026-08-30T00:00:20.000Z'),
    ...executionCallbacks(async (boundary) => {
      if (boundary === 'approval_reserved') throw new Error('approval replacement crash');
    }),
  }), /approval replacement crash/);
  const ledger = createCleanupLedger({
    runtimeDirectory: values.runtimeDirectory, deploymentId: 'deploy-1',
    approvalDigest: canonicalSha256(values.approval),
  });
  writeFileSync(ledger.approvalCurrentPath, readFileSync(path.join(
    ledger.approvalTransitions, '000001.json',
  )));
  const recovered = await recoverCleanupExecution({
    ...values, ...values.signer, ...recoveryIdentity(),
    ...executionCallbacks(async () => {}),
    now: () => new Date('2026-08-30T00:01:00.000Z'),
  });
  assert.equal(recovered.state, 'recovered');
  assert.equal(readApprovalState(ledger).value.state, 'finalized');
});

for (const [abortReason, journalReason] of [
  ['SIGINT', 'interrupt'], ['SIGTERM', 'termination'], ['SIGHUP', 'hangup'],
]) {
  for (const timing of ['checkpoint_result', 'buildInventoryAfter', 'inventory_after_persisted']) {
    test(`${abortReason} after ${timing} produces a signed categorical cancelled receipt`, async () => {
      const values = fixture(`cancel-${abortReason}-${timing}`.toLowerCase());
      const controller = new AbortController();
      const result = await applyCleanupExecution({
        ...values, ...values.signer, signal: controller.signal,
        now: () => new Date('2026-08-30T00:10:00.000Z'),
        reloadAuthority: async () => ({
          state: 'eligible', row: row(), derivedFromResultDigest: null,
        }),
        mutate: async () => ({ outcome: 'success' }),
        reconcile: async ({ action }) => ({
          state: 'absent', resourceClass: action.resourceClass,
          immutableIdentity: action.immutableIdentity, postconditionDigest: HASH,
          failureClass: 'none',
        }),
        buildInventoryAfter: async () => {
          if (timing === 'buildInventoryAfter') controller.abort(abortReason);
          return inventory([], '2026-08-30T00:09:00.000Z');
        },
        afterBoundary: async (boundary) => {
          if (timing !== 'buildInventoryAfter' && boundary === timing) controller.abort(abortReason);
        },
      });
      assert.equal(result.state, 'cancelled');
      const receipt = parseStrictJson(readFileSync(result.receiptOutputPath));
      assert.equal(receipt.state, 'cancelled');
      const journal = verifyCleanupJournal({
        runtimeDirectory: values.runtimeDirectory,
        approvalDigest: canonicalSha256(values.approval), publicKey: values.signer.publicKey,
        expectedSignerKeyId: values.signer.signerKeyId,
      });
      const cancellation = journal.records.find((entry) => (
        entry.checkpoint.checkpointType === 'cancellation'
      ));
      assert.equal(cancellation.checkpoint.payload.reason, journalReason);
      assert.equal(journal.protocol.cancellationSeen, true);
    });
  }
}

for (const [abortReason, journalReason] of [
  ['SIGINT', 'interrupt'], ['SIGTERM', 'termination'], ['SIGHUP', 'hangup'],
]) {
  for (const timing of ['before', 'between', 'after']) {
    test(`${abortReason} ${timing} actions stops at the exact action boundary`, async () => {
      const secondId = 'e'.repeat(64);
      const values = fixtureWithResources(
        `cancel-boundary-${abortReason}-${timing}`.toLowerCase(),
        [row(), row(secondId)],
      );
      const controller = new AbortController();
      const mutations = [];
      if (timing === 'before') controller.abort(abortReason);
      const result = await applyCleanupExecution({
        ...values, ...values.signer, signal: controller.signal,
        now: () => new Date('2026-08-30T00:10:00.000Z'),
        reloadAuthority: async ({ action }) => ({
          state: 'eligible', row: row(action.immutableIdentity), derivedFromResultDigest: null,
        }),
        mutate: async ({ action }) => {
          mutations.push(action.immutableIdentity);
          return { outcome: 'success' };
        },
        reconcile: async ({ action }) => {
          if (timing === 'between' && mutations.length === 1) controller.abort(abortReason);
          if (timing === 'after' && mutations.length === 2) controller.abort(abortReason);
          return {
            state: 'absent', resourceClass: action.resourceClass,
            immutableIdentity: action.immutableIdentity, postconditionDigest: HASH,
            failureClass: 'none',
          };
        },
        buildInventoryAfter: async () => inventory(
          [row(), row(secondId)].slice(mutations.length),
          '2026-08-30T00:09:00.000Z',
        ),
      });
      const expectedMutationCount = { before: 0, between: 1, after: 2 }[timing];
      assert.equal(mutations.length, expectedMutationCount);
      assert.equal(result.state, 'cancelled');
      const receipt = parseStrictJson(readFileSync(result.receiptOutputPath));
      assert.equal(receipt.state, 'cancelled');
      const journal = verifyCleanupJournal({
        runtimeDirectory: values.runtimeDirectory,
        approvalDigest: canonicalSha256(values.approval), publicKey: values.signer.publicKey,
        expectedSignerKeyId: values.signer.signerKeyId,
      });
      const cancellation = journal.records.find((entry) => (
        entry.checkpoint.checkpointType === 'cancellation'
      ));
      assert.equal(cancellation.checkpoint.payload.reason, journalReason);
      assert.equal(
        cancellation.checkpoint.payload.processedActionCount,
        Math.min(expectedMutationCount + 1, 2),
      );
    });
  }
}

test('recovery cancellation after a result prevents every later mutation and signs cancelled state', async () => {
  const values = fixture('recovery-cancelled-result');
  const secondId = 'e'.repeat(64);
  const before = inventory([row(), row(secondId)], '2026-08-30T00:00:00.000Z');
  const plan = buildCleanupPlan(before, contract, { policyDigest: HASH });
  const dryRunReceipt = buildPlanningReceipt(before, plan, {
    signerKeyId: values.signer.signerKeyId,
    now: () => new Date('2026-08-30T00:00:01.000Z'),
  });
  const approval = buildCleanupApproval(plan, dryRunReceipt, {
    signerKeyId: AUTH_SIGNER, nonce: 'recovery-cancelled-result',
    expiresAt: '2026-08-30T12:00:00.000Z',
    now: () => new Date('2026-08-30T00:00:02.000Z'),
  });
  const execution = { ...values, inventoryBefore: before, plan, dryRunReceipt, approval };
  await assert.rejects(() => applyCleanupExecution({
    ...execution, ...values.signer, now: () => new Date('2026-08-30T00:01:00.000Z'),
    ...executionCallbacks(async (boundary) => {
      if (boundary === 'approval_reserved') throw new Error('recover cancellation');
    }),
  }), /recover cancellation/);
  const controller = new AbortController();
  const mutations = [];
  const recovered = await recoverCleanupExecution({
    ...execution, ...values.signer, ...recoveryIdentity(), signal: controller.signal,
    reloadAuthority: async ({ action }) => ({
      state: 'eligible', row: row(action.immutableIdentity), derivedFromResultDigest: null,
    }),
    mutate: async ({ action }) => {
      mutations.push(action.immutableIdentity);
      return { outcome: 'success' };
    },
    reconcile: async ({ action }) => {
      controller.abort('SIGTERM');
      return { state: 'absent', resourceClass: action.resourceClass,
        immutableIdentity: action.immutableIdentity, postconditionDigest: HASH, failureClass: 'none' };
    },
    buildInventoryAfter: async () => inventory([row(secondId)], '2026-08-30T00:02:00.000Z'),
    now: () => new Date('2026-08-30T00:03:00.000Z'),
  });
  assert.deepEqual(mutations, [ID]);
  assert.equal(recovered.state, 'cancelled');
  assert.equal(recovered.receipt.subjectExitStatus, null);
});

test('recovery records hangup cancellation raised while rebuilding postcondition inventory', async () => {
  const values = fixture('recovery-build-cancellation');
  await assert.rejects(() => applyCleanupExecution({
    ...values, ...values.signer, now: () => new Date('2026-08-30T00:01:00.000Z'),
    ...executionCallbacks(async () => {}),
    buildInventoryAfter: async () => { throw new Error('inventory observer interrupted'); },
  }), /inventory observer interrupted/);
  const controller = new AbortController();
  const recovered = await recoverCleanupExecution({
    ...values, ...values.signer, ...recoveryIdentity(), signal: controller.signal,
    reloadAuthority: async () => { throw new Error('completed actions cannot reload'); },
    mutate: async () => { throw new Error('completed actions cannot mutate'); },
    reconcile: async () => { throw new Error('completed actions cannot reconcile'); },
    buildInventoryAfter: async () => {
      controller.abort('SIGHUP');
      return inventory([], '2026-08-30T00:02:00.000Z');
    },
    now: () => new Date('2026-08-30T00:03:00.000Z'),
  });
  assert.equal(recovered.state, 'cancelled');
  const journal = verifyCleanupJournal({
    runtimeDirectory: values.runtimeDirectory,
    approvalDigest: canonicalSha256(values.approval), publicKey: values.signer.publicKey,
    expectedSignerKeyId: values.signer.signerKeyId,
  });
  const cancellation = journal.records.find((entry) => (
    entry.checkpoint.checkpointType === 'cancellation'
  ));
  assert.equal(cancellation.checkpoint.payload.reason, 'hangup');
});

test('recovery records cancellation raised after final inventory persistence before terminal preparation', async () => {
  const values = fixture('recovery-persisted-inventory-cancellation');
  await assert.rejects(() => applyCleanupExecution({
    ...values, ...values.signer, now: () => new Date('2026-08-30T00:01:00.000Z'),
    ...executionCallbacks(async (boundary) => {
      if (boundary === 'approval_reserved') throw new Error('recover after reservation');
    }),
  }), /recover after reservation/);
  const controller = new AbortController();
  const recovered = await recoverCleanupExecution({
    ...values, ...values.signer, ...recoveryIdentity(), signal: controller.signal,
    ...executionCallbacks(async (boundary) => {
      if (boundary === 'inventory_after_persisted') controller.abort('SIGTERM');
    }),
    now: () => new Date('2026-08-30T00:03:00.000Z'),
  });
  assert.equal(recovered.state, 'cancelled');
  const journal = verifyCleanupJournal({
    runtimeDirectory: values.runtimeDirectory,
    approvalDigest: canonicalSha256(values.approval), publicKey: values.signer.publicKey,
    expectedSignerKeyId: values.signer.signerKeyId,
  });
  assert.deepEqual(journal.records.slice(-2).map((entry) => entry.checkpoint.checkpointType), [
    'cancellation', 'terminal',
  ]);
  assert.equal(journal.records.at(-2).checkpoint.payload.reason, 'termination');
});

test('recovery preserves genesis subject status and rejects a conflicting supplied status before mutation', async () => {
  const values = fixture('durable-subject-status');
  await assert.rejects(() => applyCleanupExecution({
    ...values, ...values.signer, subjectExitStatus: 17,
    now: () => new Date('2026-08-30T00:01:00.000Z'),
    ...executionCallbacks(async (boundary) => {
      if (boundary === 'approval_reserved') throw new Error('status recovery');
    }),
  }), /status recovery/);
  let mutations = 0;
  await assert.rejects(() => recoverCleanupExecution({
    ...values, ...values.signer, ...recoveryIdentity(), subjectExitStatus: 18,
    ...executionCallbacks(async () => {}),
    mutate: async () => { mutations += 1; return { outcome: 'success' }; },
  }), /subjectExitStatus conflicts/);
  assert.equal(mutations, 0);
  const recovered = await recoverCleanupExecution({
    ...values, ...values.signer, ...recoveryIdentity(),
    ...executionCallbacks(async () => {}),
    now: () => new Date('2026-08-30T00:03:00.000Z'),
  });
  assert.equal(recovered.receipt.subjectExitStatus, 17);
});

test('reapply after journal_created reuses the exact genesis and mutates only once', async () => {
  const values = fixture('journal-created-reapply');
  await assert.rejects(() => applyCleanupExecution({
    ...values, ...values.signer, now: () => new Date('2026-08-30T00:01:00.000Z'),
    ...executionCallbacks(async (boundary) => {
      if (boundary === 'journal_created') throw new Error('genesis crash');
    }),
  }), /genesis crash/);
  let mutations = 0;
  const result = await applyCleanupExecution({
    ...values, ...values.signer, now: () => new Date('2026-08-30T00:02:00.000Z'),
    ...executionCallbacks(async () => {}),
    mutate: async () => { mutations += 1; return { outcome: 'success' }; },
  });
  assert.equal(mutations, 1);
  assert.equal(result.receipt.operationStartedAt, '2026-08-30T00:01:00.000Z');
});

for (const boundary of [
  'receipt_file_written', 'receipt_signature_written', 'receipt_checksum_written',
]) {
  test(`recovery completes exact signed evidence after ${boundary} interruption`, async () => {
    const values = fixture(`sidecar-${boundary}`);
    let mutations = 0;
    await assert.rejects(() => applyCleanupExecution({
      ...values, ...values.signer, now: () => new Date('2026-08-30T00:01:00.000Z'),
      ...executionCallbacks(async (observed) => {
        if (observed === boundary) throw new Error(`crash ${boundary}`);
      }),
      mutate: async () => { mutations += 1; return { outcome: 'success' }; },
    }), new RegExp(`crash ${boundary}`));
    const recovered = await recoverCleanupExecution({
      ...values, ...values.signer, ...recoveryIdentity(),
      reloadAuthority: async () => { throw new Error('terminal recovery cannot reload'); },
      mutate: async () => { throw new Error('terminal recovery cannot mutate'); },
      reconcile: async () => { throw new Error('terminal recovery cannot reconcile'); },
      buildInventoryAfter: async () => { throw new Error('terminal recovery uses persisted inventory'); },
      now: () => new Date('2026-08-30T00:03:00.000Z'),
    });
    assert.equal(mutations, 1);
    assert.equal(recovered.state, 'cleaned');
    assert.equal(inspectDeploymentCleanupState({
      runtimeDirectory: values.runtimeDirectory, deploymentId: 'deploy-1',
    }).state, 'clear');
  });
}

for (const boundary of [
  'terminal_appended', 'approval_finalized', 'receipt_prepared', 'pointer_tombstoned',
]) {
  test(`terminal recovery is mutation-free and receipt-idempotent after ${boundary}`, async () => {
    const values = fixture(`terminal-barrier-${boundary}`);
    let mutations = 0;
    await assert.rejects(() => applyCleanupExecution({
      ...values, ...values.signer, now: () => new Date('2026-08-30T00:01:00.000Z'),
      ...executionCallbacks(async (observed) => {
        if (observed === boundary) throw new Error(`crash ${boundary}`);
      }),
      mutate: async () => { mutations += 1; return { outcome: 'success' }; },
    }), new RegExp(`crash ${boundary}`));
    assert.equal(mutations, 1);

    const ledger = createCleanupLedger({
      runtimeDirectory: values.runtimeDirectory, deploymentId: 'deploy-1',
      approvalDigest: canonicalSha256(values.approval),
    });
    const receiptPath = path.join(ledger.executionRoot, 'cleanup-receipt.json');
    const receiptBeforeRecovery = existsSync(receiptPath) ? readFileSync(receiptPath) : null;
    const recover = () => recoverCleanupExecution({
      ...values, ...values.signer,
      ...recoveryIdentity(), controllerRunId: `recover-${boundary}`,
      reloadAuthority: async () => { throw new Error('terminal recovery cannot reload'); },
      mutate: async () => { throw new Error('terminal recovery cannot mutate'); },
      reconcile: async () => { throw new Error('terminal recovery cannot reconcile'); },
      buildInventoryAfter: async () => { throw new Error('terminal recovery uses persisted inventory'); },
      now: () => new Date('2026-08-30T00:03:00.000Z'),
    });
    const first = await recover();
    const receiptAfterFirst = readFileSync(receiptPath);
    const second = await recover();
    const receiptAfterSecond = readFileSync(receiptPath);

    assert.equal(mutations, 1);
    assert.equal(first.state, 'cleaned');
    assert.deepEqual(second.receipt, first.receipt);
    assert.equal(second.receiptDigest, first.receiptDigest);
    assert.equal(second.approvalStateDigest, first.approvalStateDigest);
    assert.equal(second.pointerDigest, first.pointerDigest);
    assert.deepEqual(receiptAfterSecond, receiptAfterFirst);
    if (receiptBeforeRecovery !== null) assert.deepEqual(receiptAfterFirst, receiptBeforeRecovery);
    const verified = verifySignedArtifact({
      inputPath: receiptPath, publicKeyPath: values.signer.publicKeyPath,
      expectedFingerprint: values.signer.signerKeyId, checkoutRoot: values.checkoutRoot,
      now: new Date('2026-08-30T00:04:00.000Z'),
    });
    assert.equal(verified.digest, first.receiptDigest);
    assert.deepEqual(verified.artifact, first.receipt);
    assert.equal(inspectDeploymentCleanupState({
      runtimeDirectory: values.runtimeDirectory, deploymentId: 'deploy-1',
    }).state, 'clear');
  });
}

test('a conflicting partial receipt blocks recovery without mutation or pointer tombstone', async () => {
  const values = fixture('sidecar-conflict');
  let receiptPath;
  await assert.rejects(() => applyCleanupExecution({
    ...values, ...values.signer, now: () => new Date('2026-08-30T00:01:00.000Z'),
    ...executionCallbacks(async (boundary) => {
      if (boundary === 'receipt_file_written') throw new Error('partial receipt crash');
    }),
  }), /partial receipt crash/);
  const ledger = createCleanupLedger({
    runtimeDirectory: values.runtimeDirectory, deploymentId: 'deploy-1',
    approvalDigest: canonicalSha256(values.approval),
  });
  receiptPath = path.join(ledger.executionRoot, 'cleanup-receipt.json');
  writeFileSync(receiptPath, Buffer.from('{}'));
  let mutations = 0;
  await assert.rejects(() => recoverCleanupExecution({
    ...values, ...values.signer, ...recoveryIdentity(),
    ...executionCallbacks(async () => {}),
    mutate: async () => { mutations += 1; return { outcome: 'success' }; },
  }), /collision/);
  assert.equal(mutations, 0);
  assert.equal(inspectDeploymentCleanupState({
    runtimeDirectory: values.runtimeDirectory, deploymentId: 'deploy-1',
  }).state, 'active');
});
