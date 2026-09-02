import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';
import { publicKeyFingerprint } from '../../scripts/ownership/crypto.mjs';
import {
  buildHostRecoveryTrust, buildOperatorRecoveryApproval, buildOperatorRecoveryAssertion,
  buildOperatorRecoveryScope,
} from '../../scripts/ownership/operator-recovery-schema.mjs';
import { executeOperatorRecoverySession } from '../../scripts/ownership/operator-recovery-session.mjs';

const D = (value) => value.repeat(64);
const NOW = new Date('2026-09-02T10:00:00.000Z');

function fixture() {
  const authorization = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const evidence = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const authorizationId = publicKeyFingerprint(authorization.publicKey);
  const evidenceId = publicKeyFingerprint(evidence.publicKey);
  const trust = buildHostRecoveryTrust({
    trustId: 'host-recovery', validFrom: '2026-09-02T09:00:00.000Z',
    validUntil: '2026-09-03T09:00:00.000Z',
    authorizationFingerprints: [authorizationId], evidenceFingerprints: [evidenceId],
  });
  const ownership = {
    project: 'ci-1-fresh-install', deploymentId: 'ci-1-deploy', ownerId: 'ci-1-owner',
    resourceClass: 'compose_network', lifecycle: 'obsolete', cleanupPolicy: 'exact_delete',
    createdAt: '2026-09-02T00:00:00.000Z', createdByRelease: 'unreleased',
    createdByCommit: 'a'.repeat(40), creationRunId: 'ci-1-run', immutableIdentity: D('b'),
  };
  const resource = {
    resourceClass: 'compose_network', locatorKind: 'engine_id', locator: D('b'),
    immutableIdentity: D('b'), ownership, ownershipDigest: canonicalSha256(ownership),
    observationDigest: D('c'), dependencyIdentities: [], target: true,
  };
  const assertion = buildOperatorRecoveryAssertion({
    trust, assertionId: 'assertion-1', project: ownership.project,
    deploymentId: ownership.deploymentId, ownerId: ownership.ownerId,
    sourceCommit: ownership.createdByCommit, sourceExecutionId: ownership.creationRunId,
    sourceState: 'terminal', historicalTerminalityAuthority: 'operator_assertion_only',
    issuedAt: NOW.toISOString(), expiresAt: '2026-09-02T11:00:00.000Z',
    trustDigest: canonicalSha256(trust), providerCorrelationEvidenceDigest: D('1'),
    queryResultCoreDigest: D('2'), signerKeyId: authorizationId,
  });
  const scope = buildOperatorRecoveryScope({
    trust, assertion, scopeId: 'scope-1', deploymentId: ownership.deploymentId,
    operationRunId: 'operator-run-1', project: ownership.project, ownerId: ownership.ownerId,
    observedAt: NOW.toISOString(), expiresAt: '2026-09-02T11:00:00.000Z',
    trustDigest: canonicalSha256(trust), policyDigest: D('d'),
    daemonContextFingerprint: D('e'), operatorAssertionDigest: canonicalSha256(assertion),
    providerCorrelationEvidenceDigest: D('1'), queryResultCoreDigest: D('2'),
    resources: [resource], signerKeyId: authorizationId,
  });
  const actions = [{
    sequence: 1, resourceClass: resource.resourceClass,
    immutableIdentity: resource.immutableIdentity, action: 'remove',
    locatorKind: resource.locatorKind, locator: resource.locator,
    ownershipDigest: resource.ownershipDigest, observationDigest: resource.observationDigest,
    dependencyIdentities: [],
  }];
  const approval = buildOperatorRecoveryApproval({
    scope, trust, scopeDigest: canonicalSha256(scope), trustDigest: scope.trustDigest,
    deploymentId: scope.deploymentId, operationRunId: scope.operationRunId,
    issuedAt: NOW.toISOString(), expiresAt: '2026-09-02T10:30:00.000Z', nonce: 'approval-1',
    planDigest: canonicalSha256(actions), dryRunReceiptDigest: D('3'),
    contextFingerprint: D('4'), actions, signerKeyId: authorizationId,
  });
  const runtimeDirectory = mkdtempSync(path.join(tmpdir(), 'operator-recovery-session-'));
  mkdirSync(path.join(runtimeDirectory, 'ownership'), { mode: 0o700 });
  return { evidence, evidenceId, trust, assertion, scope, approval, runtimeDirectory };
}

function successfulRuntime(action, resource) {
  const row = {
    resourceClass: action.resourceClass, locatorKind: action.locatorKind,
    locator: action.locator, immutableIdentity: action.immutableIdentity,
    ownership: resource.ownership, ownershipDigest: action.ownershipDigest,
    observationDigest: action.observationDigest, disposition: 'eligible', failureClasses: [],
    references: [], contentDigests: [], dependencyIdentities: [], running: null,
    active: false, protected: false, data: false,
  };
  return {
    reloadAuthority: async ({ predecessorResultDigest }) => ({ state: 'eligible', row, derivedFromResultDigest: predecessorResultDigest }),
    mutate: async () => ({ outcome: 'success' }),
    reconcile: async () => ({ state: 'absent', resourceClass: action.resourceClass,
      immutableIdentity: action.immutableIdentity, postconditionDigest: D('9'), failureClass: 'none' }),
  };
}

test('session uses signed synced journal and returns a successful bound receipt', async () => {
  const f = fixture();
  const result = await executeOperatorRecoverySession({
    ...f, evidencePrivateKey: f.evidence.privateKey, evidencePublicKey: f.evidence.publicKey,
    runtime: successfulRuntime(f.approval.actions[0], f.scope.resources[0]), now: () => NOW,
    buildFinalObservation: async () => ({ closed: true, observationDigest: D('8') }),
    revalidatedProviderCorrelationEvidenceDigest: D('7'),
  });
  assert.equal(result.receipt.state, 'cleaned');
  assert.equal(result.receipt.scopeDigest, canonicalSha256(f.scope));
  assert.match(result.journalDigest, /^[a-f0-9]{64}$/);
  await assert.rejects(() => executeOperatorRecoverySession({
    ...f, evidencePrivateKey: f.evidence.privateKey, evidencePublicKey: f.evidence.publicKey,
    runtime: successfulRuntime(f.approval.actions[0], f.scope.resources[0]), now: () => NOW,
    buildFinalObservation: async () => ({ closed: true, observationDigest: D('8') }),
    revalidatedProviderCorrelationEvidenceDigest: D('7'),
  }), /already exists|finalized/);
});

test('reserved journal recovery survives scope and approval expiry and never replays an open intent', async () => {
  const f = fixture();
  let crashed = false;
  await assert.rejects(() => executeOperatorRecoverySession({
    ...f, evidencePrivateKey: f.evidence.privateKey, evidencePublicKey: f.evidence.publicKey,
    runtime: successfulRuntime(f.approval.actions[0], f.scope.resources[0]), now: () => NOW,
    buildFinalObservation: async () => ({ closed: true, observationDigest: D('8') }),
    revalidatedProviderCorrelationEvidenceDigest: D('7'),
    afterCheckpoint: async (type) => {
      if (type === 'intent' && !crashed) { crashed = true; throw new Error('simulated crash'); }
    },
  }));
  const recovered = await executeOperatorRecoverySession({
    ...f, evidencePrivateKey: f.evidence.privateKey, evidencePublicKey: f.evidence.publicKey,
    runtime: successfulRuntime(f.approval.actions[0], f.scope.resources[0]),
    now: () => new Date('2026-09-02T12:00:00.000Z'), recover: true,
    controllerRunId: 'recovery-controller-2',
    buildFinalObservation: async () => ({ closed: true, observationDigest: D('8') }),
    revalidatedProviderCorrelationEvidenceDigest: D('7'),
  });
  assert.equal(recovered.receipt.state, 'recovered');
  assert.equal(recovered.receipt.results[0].result, 'absent');
});

test('a second recovery still reconciles an intent hidden behind a prior recovery checkpoint', async () => {
  const f = fixture();
  let mutationCalls = 0;
  const runtime = successfulRuntime(f.approval.actions[0], f.scope.resources[0]);
  runtime.mutate = async () => { mutationCalls += 1; return { outcome: 'success' }; };
  await assert.rejects(() => executeOperatorRecoverySession({
    ...f, evidencePrivateKey: f.evidence.privateKey, evidencePublicKey: f.evidence.publicKey,
    runtime, now: () => NOW,
    buildFinalObservation: async () => ({ closed: true, observationDigest: D('8') }),
    revalidatedProviderCorrelationEvidenceDigest: D('7'),
    afterCheckpoint: async (type) => { if (type === 'intent') throw new Error('first crash'); },
  }));
  await assert.rejects(() => executeOperatorRecoverySession({
    ...f, evidencePrivateKey: f.evidence.privateKey, evidencePublicKey: f.evidence.publicKey,
    runtime, now: () => NOW, recover: true, controllerRunId: 'recovery-controller-1',
    buildFinalObservation: async () => ({ closed: true, observationDigest: D('8') }),
    revalidatedProviderCorrelationEvidenceDigest: D('7'),
    afterCheckpoint: async (type) => { if (type === 'recovery') throw new Error('second crash'); },
  }));
  const recovered = await executeOperatorRecoverySession({
    ...f, evidencePrivateKey: f.evidence.privateKey, evidencePublicKey: f.evidence.publicKey,
    runtime, now: () => NOW, recover: true, controllerRunId: 'recovery-controller-2',
    buildFinalObservation: async () => ({ closed: true, observationDigest: D('8') }),
    revalidatedProviderCorrelationEvidenceDigest: D('7'),
  });
  assert.equal(recovered.receipt.state, 'recovered');
  assert.equal(mutationCalls, 0);
});

test('terminal journal recovery reconstructs a receipt without replay and preserves start time', async () => {
  const f = fixture();
  let mutationCalls = 0;
  const runtime = successfulRuntime(f.approval.actions[0], f.scope.resources[0]);
  runtime.mutate = async () => { mutationCalls += 1; return { outcome: 'success' }; };
  await assert.rejects(() => executeOperatorRecoverySession({
    ...f, evidencePrivateKey: f.evidence.privateKey, evidencePublicKey: f.evidence.publicKey,
    runtime, now: () => NOW,
    buildFinalObservation: async () => ({ closed: true, observationDigest: D('8') }),
    revalidatedProviderCorrelationEvidenceDigest: D('7'),
    afterCheckpoint: async (type) => { if (type === 'terminal') throw new Error('terminal crash'); },
  }));
  assert.equal(mutationCalls, 1);
  const recovered = await executeOperatorRecoverySession({
    ...f, evidencePrivateKey: f.evidence.privateKey, evidencePublicKey: f.evidence.publicKey,
    runtime, now: () => new Date('2026-09-02T12:00:00.000Z'), recover: true,
    controllerRunId: 'recovery-controller-2',
    buildFinalObservation: async () => ({ closed: true, observationDigest: D('6') }),
    revalidatedProviderCorrelationEvidenceDigest: D('5'),
  });
  assert.equal(mutationCalls, 1);
  assert.equal(recovered.receipt.state, 'cleaned');
  assert.equal(recovered.receipt.operationStartedAt, NOW.toISOString());
  assert.equal(recovered.receipt.finalObservationDigest, D('6'));
});
