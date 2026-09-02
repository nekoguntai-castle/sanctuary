import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';
import {
  buildHostRecoveryTrust,
  buildOperatorRecoveryAssertion,
  buildOperatorRecoveryApproval,
  buildOperatorRecoveryCloseout,
  buildOperatorRecoveryExecutionReceipt,
  buildOperatorRecoveryScope,
  validateHostRecoveryTrust,
  validateOperatorRecoveryAssertion,
  validateOperatorRecoveryApproval,
  validateOperatorRecoveryCloseout,
  validateOperatorRecoveryExecutionReceipt,
  validateOperatorRecoveryScope,
} from '../../scripts/ownership/operator-recovery-schema.mjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const COMMIT = 'd'.repeat(40);
const NOW = new Date('2026-09-02T10:00:00.000Z');

function trust(overrides = {}) {
  return buildHostRecoveryTrust({
    trustId: 'host-recovery-1', validFrom: '2026-09-02T09:00:00.000Z',
    validUntil: '2026-09-03T09:00:00.000Z',
    authorizationFingerprints: [A], evidenceFingerprints: [B], ...overrides,
  });
}

function ownership(resourceClass, immutableIdentity, overrides = {}) {
  return {
    project: 'ci-99604-1-fresh-install', deploymentId: 'ci-99604-1-fresh-install',
    ownerId: 'ci-install-tests', resourceClass, lifecycle: 'obsolete',
    cleanupPolicy: 'exact_delete', createdAt: '2026-08-31T01:00:00.000Z',
    createdByRelease: 'unreleased', createdByCommit: COMMIT,
    creationRunId: 'ci-99604-1-fresh-install', immutableIdentity, ...overrides,
  };
}

function recoveryAssertion(overrides = {}) {
  const hostTrust = trust();
  return buildOperatorRecoveryAssertion({
    trust: hostTrust, assertionId: 'recovery-assertion-1',
    project: 'ci-99604-1-fresh-install', deploymentId: 'ci-99604-1-fresh-install',
    ownerId: 'ci-install-tests', sourceCommit: COMMIT,
    sourceExecutionId: 'ci-99604-1-fresh-install', sourceState: 'terminal',
    historicalTerminalityAuthority: 'operator_assertion_only',
    issuedAt: '2026-09-02T09:45:00.000Z', expiresAt: '2026-09-02T10:45:00.000Z',
    trustDigest: canonicalSha256(hostTrust), providerCorrelationEvidenceDigest: C,
    queryResultCoreDigest: A, signerKeyId: A, ...overrides,
  });
}

function resource(resourceClass = 'compose_network', suffix = '1', overrides = {}) {
  const immutableIdentity = resourceClass === 'compose_volume' ? suffix.repeat(64) : suffix.repeat(64);
  const tuple = ownership(resourceClass, immutableIdentity);
  const value = {
    resourceClass,
    locatorKind: resourceClass === 'compose_volume' ? 'name' : 'engine_id',
    locator: resourceClass === 'compose_volume' ? `ci_fixture_volume_${suffix}` : immutableIdentity,
    immutableIdentity, ownership: tuple, ownershipDigest: canonicalSha256(tuple),
    observationDigest: A, dependencyIdentities: [], target: true, ...overrides,
  };
  if (resourceClass === 'compose_volume' && !Object.hasOwn(value, 'attestationNonce')) {
    value.attestationNonce = `recovery-volume-${suffix}`;
  }
  return value;
}

function scope(overrides = {}) {
  const hostTrust = trust();
  const assertion = recoveryAssertion({
    project: overrides.project ?? 'ci-99604-1-fresh-install',
    deploymentId: overrides.deploymentId ?? 'ci-99604-1-fresh-install',
    ownerId: overrides.ownerId ?? 'ci-install-tests',
    expiresAt: '2026-09-02T11:30:00.000Z',
  });
  return buildOperatorRecoveryScope({
    trust: hostTrust, assertion,
    scopeId: 'recovery-scope-1', deploymentId: 'ci-99604-1-fresh-install',
    operationRunId: 'operator-recovery-1', project: 'ci-99604-1-fresh-install',
    ownerId: 'ci-install-tests', observedAt: '2026-09-02T10:00:00.000Z',
    expiresAt: '2026-09-02T11:00:00.000Z', trustDigest: canonicalSha256(hostTrust),
    policyDigest: C, daemonContextFingerprint: A,
    operatorAssertionDigest: canonicalSha256(assertion),
    providerCorrelationEvidenceDigest: assertion.providerCorrelationEvidenceDigest,
    queryResultCoreDigest: assertion.queryResultCoreDigest,
    resources: [resource()], signerKeyId: A, ...overrides,
  });
}

function action(entry = resource(), overrides = {}) {
  return {
    sequence: 1, resourceClass: entry.resourceClass,
    immutableIdentity: entry.immutableIdentity, action: 'remove',
    locatorKind: entry.locatorKind, locator: entry.locator,
    ownershipDigest: entry.ownershipDigest, observationDigest: entry.observationDigest,
    dependencyIdentities: entry.dependencyIdentities, ...overrides,
  };
}

function approval(recoveryScope = scope(), overrides = {}) {
  const actions = [action(recoveryScope.resources[0])];
  return buildOperatorRecoveryApproval({
    scope: recoveryScope, trust: trust(),
    scopeDigest: canonicalSha256(recoveryScope), trustDigest: recoveryScope.trustDigest,
    deploymentId: recoveryScope.deploymentId, operationRunId: recoveryScope.operationRunId,
    issuedAt: '2026-09-02T10:01:00.000Z', expiresAt: '2026-09-02T11:01:00.000Z',
    nonce: 'approval-1', planDigest: B, dryRunReceiptDigest: C,
    contextFingerprint: A, actions, signerKeyId: A, ...overrides,
  });
}

function receipt(recoveryScope = scope(), recoveryApproval = approval(recoveryScope), overrides = {}) {
  const actions = recoveryApproval.actions;
  return buildOperatorRecoveryExecutionReceipt({
    scope: recoveryScope, approval: recoveryApproval, trust: trust(),
    scopeDigest: canonicalSha256(recoveryScope), approvalDigest: canonicalSha256(recoveryApproval),
    trustDigest: recoveryScope.trustDigest, planDigest: recoveryApproval.planDigest,
    originalProviderCorrelationEvidenceDigest: recoveryScope.providerCorrelationEvidenceDigest,
    revalidatedProviderCorrelationEvidenceDigest: B,
    queryResultCoreDigest: recoveryScope.queryResultCoreDigest,
    finalObservationDigest: C, journalDigest: A,
    deploymentId: recoveryScope.deploymentId, operationRunId: recoveryScope.operationRunId,
    project: recoveryScope.project, state: 'cleaned',
    operationStartedAt: '2026-09-02T10:02:00.000Z',
    operationEndedAt: '2026-09-02T10:03:00.000Z', actions,
    results: actions.map((entry) => ({
      sequence: entry.sequence, resourceClass: entry.resourceClass,
      immutableIdentity: entry.immutableIdentity, result: 'cleaned', failureClass: 'none',
      postconditionState: 'satisfied', postconditionDigest: B,
    })), signerKeyId: B, ...overrides,
  });
}

test('host trust is exact, current, bounded, sorted, and role-separated', () => {
  const value = trust({ authorizationFingerprints: [C, A] });
  assert.deepEqual(value.authorizationFingerprints, [A, C]);
  assert.equal(validateHostRecoveryTrust(value, { now: NOW }), value);
  assert.throws(() => trust({ evidenceFingerprints: [A] }), /distinct/);
  assert.throws(() => validateHostRecoveryTrust({ ...value, extra: true }), /exactly/);
  assert.throws(() => validateHostRecoveryTrust(value, { now: new Date('2026-09-04T00:00:00.000Z') }), /currently valid/);
});

test('operator assertion is short-lived, exact-source, sole-authority, and authorization-role bound', () => {
  const value = recoveryAssertion();
  assert.equal(validateOperatorRecoveryAssertion(value, { trust: trust(), now: NOW }), value);
  assert.throws(() => recoveryAssertion({ sourceState: 'running' }), /sourceState/);
  assert.throws(() => recoveryAssertion({
    historicalTerminalityAuthority: 'provider_evidence',
  }), /historicalTerminalityAuthority/);
  assert.throws(() => recoveryAssertion({ signerKeyId: B }), /assertion signer/);
  assert.throws(() => recoveryAssertion({ sourceCommit: 'not-a-commit' }), /sourceCommit/);
  assert.throws(() => recoveryAssertion({ expiresAt: '2026-09-04T09:45:00.000Z' }), /86400000ms/);
  assert.throws(() => validateOperatorRecoveryAssertion({ ...value, extra: true }), /exactly/);
});

test('per-stack scope binds operator and negative-provider evidence digests and exact sorted resources', () => {
  const volume = resource('compose_volume', '2');
  const network = resource('compose_network', '1');
  const value = scope({ resources: [volume, network] });
  assert.deepEqual(value.resources.map((entry) => entry.resourceClass), ['compose_network', 'compose_volume']);
  assert.equal(validateOperatorRecoveryScope(value, { now: NOW }), value);
  assert.throws(() => validateOperatorRecoveryScope(value, {
    trust: trust(), assertion: recoveryAssertion({ sourceExecutionId: 'different-local-run' }),
  }), /does not bind the operator assertion/);
  assert.throws(() => scope({ operatorAssertionDigest: 'not-a-digest' }), /operatorAssertionDigest/);
  assert.throws(() => scope({ queryResultCoreDigest: 'not-a-digest' }), /queryResultCoreDigest/);
  assert.throws(() => scope({ signerKeyId: B }), /scope signer/);
  assert.throws(() => scope({ resources: [network, network] }), /duplicate/);
  assert.throws(() => scope({ resources: [resource('oci_image')] }), /resourceClass/);
  assert.throws(() => scope({ resources: [{ ...network, ownershipDigest: B }] }), /ownershipDigest/);
  const wrongRunOwnership = { ...network.ownership, creationRunId: 'other-run' };
  assert.throws(() => scope({ resources: [{
    ...network, ownership: wrongRunOwnership,
    ownershipDigest: canonicalSha256(wrongRunOwnership),
  }] }), /operator assertion/);
  assert.throws(() => scope({ resources: [resource('compose_volume', '2', { attestationNonce: '' })] }), /attestationNonce/);
  assert.throws(() => validateOperatorRecoveryScope({ ...value, unexpected: null }), /exactly/);
});

test('approval exactly binds scope, action set, classes, expiry, and signer role', () => {
  const recoveryScope = scope();
  const value = approval(recoveryScope);
  const approvalNow = new Date('2026-09-02T10:02:00.000Z');
  assert.equal(validateOperatorRecoveryApproval(value, { scope: recoveryScope, now: approvalNow }), value);
  assert.throws(() => validateOperatorRecoveryApproval({ ...value, scopeDigest: B }, { scope: recoveryScope, now: approvalNow }), /scopeDigest/);
  assert.throws(() => approval(recoveryScope, { signerKeyId: B }), /authorization signer/);
  assert.throws(() => approval(recoveryScope, { permittedActionCount: 2 }), /permittedActionCount/);
  assert.throws(() => approval(recoveryScope, { expiresAt: '2026-09-04T10:01:00.000Z' }), /86400000ms/);
});

test('execution receipts preserve failure evidence but only success shapes qualify for closeout', () => {
  const recoveryScope = scope();
  const recoveryApproval = approval(recoveryScope);
  const success = receipt(recoveryScope, recoveryApproval);
  assert.equal(validateOperatorRecoveryExecutionReceipt(success, {
    scope: recoveryScope, approval: recoveryApproval, trust: trust(),
    now: new Date('2026-09-02T10:04:00.000Z'),
  }), success);
  const failed = receipt(recoveryScope, recoveryApproval, {
    state: 'partial', results: [{ ...receipt(recoveryScope, recoveryApproval).results[0],
      result: 'failed', failureClass: 'mutation_failed',
      postconditionState: 'failed', postconditionDigest: null }],
  });
  assert.equal(validateOperatorRecoveryExecutionReceipt(failed).state, 'partial');
  assert.throws(() => receipt(recoveryScope, recoveryApproval, { signerKeyId: A }), /receipt signer/);
  assert.throws(() => receipt(recoveryScope, recoveryApproval, {
    queryResultCoreDigest: B,
  }), /receipt does not bind scope/);
  assert.throws(() => receipt(recoveryScope, recoveryApproval, {
    revalidatedProviderCorrelationEvidenceDigest: recoveryScope.providerCorrelationEvidenceDigest,
  }), /fresh provider correlation revalidation/);
  assert.throws(() => receipt(recoveryScope, recoveryApproval, {
    finalObservationDigest: 'not-a-digest',
  }), /finalObservationDigest/);
  assert.throws(() => receipt(recoveryScope, recoveryApproval, { state: 'cleaned', results: failed.results }), /successful results/);
});

test('closeout accepts exactly four unique successful scope and receipt pairs', () => {
  const pairs = [];
  for (let index = 4; index > 0; index -= 1) {
    const project = `ci-9960${index}-1-fresh-install`;
    const deploymentId = `deploy-${index}`;
    const target = resource();
    const tuple = { ...target.ownership, project, deploymentId };
    const recoveryScope = scope({
      scopeId: `scope-${index}`, deploymentId,
      operationRunId: `recover-${index}`, project,
      resources: [{ ...target, ownership: tuple, ownershipDigest: canonicalSha256(tuple) }],
    });
    const recoveryApproval = approval(recoveryScope, {
      deploymentId: recoveryScope.deploymentId, operationRunId: recoveryScope.operationRunId,
      nonce: `approval-${index}`,
    });
    pairs.push({ scope: recoveryScope, receipt: receipt(recoveryScope, recoveryApproval, {
      deploymentId: recoveryScope.deploymentId, operationRunId: recoveryScope.operationRunId,
      project: recoveryScope.project,
    }) });
  }
  const value = buildOperatorRecoveryCloseout({
    trust: trust(),
    incidentId: 'lost-authority-fresh-install-2026-09-02', trustDigest: pairs[0].scope.trustDigest,
    finalizedAt: '2026-09-02T10:10:00.000Z', pairs,
    exclusionSentinelBeforeDigest: A, exclusionSentinelAfterDigest: A,
    outOfScopeObservationDigest: C, signerKeyId: B,
  });
  assert.deepEqual(value.pairs.map((entry) => entry.project), [...value.pairs.map((entry) => entry.project)].sort());
  assert.equal(validateOperatorRecoveryCloseout(value, { now: new Date('2026-09-02T10:11:00.000Z') }), value);
  assert.throws(() => buildOperatorRecoveryCloseout({
    trust: trust(),
    incidentId: 'bad', trustDigest: A, finalizedAt: '2026-09-02T10:10:00.000Z',
    pairs: pairs.slice(0, 3), exclusionSentinelBeforeDigest: A,
    exclusionSentinelAfterDigest: A, outOfScopeObservationDigest: C, signerKeyId: B,
  }), /4-4/);
  assert.throws(() => validateOperatorRecoveryCloseout({
    ...value, exclusionSentinelAfterDigest: B,
  }), /sentinels changed/);
  assert.throws(() => validateOperatorRecoveryCloseout({
    ...value, signerKeyId: A,
  }, { trust: trust() }), /closeout signer/);
  assert.throws(() => buildOperatorRecoveryCloseout({
    trust: trust(),
    incidentId: 'bad-state', trustDigest: value.trustDigest,
    finalizedAt: value.finalizedAt,
    pairs: pairs.map((entry, index) => index === 0 ? {
      ...entry, receipt: receipt(entry.scope, approval(entry.scope, {
        deploymentId: entry.scope.deploymentId, operationRunId: entry.scope.operationRunId,
      }), { state: 'refused', results: [{
        ...receipt(entry.scope, approval(entry.scope, {
          deploymentId: entry.scope.deploymentId, operationRunId: entry.scope.operationRunId,
        })).results[0], result: 'refused', failureClass: 'identity_changed',
        postconditionState: 'not_run', postconditionDigest: null,
      }] }),
    } : entry),
    exclusionSentinelBeforeDigest: A, exclusionSentinelAfterDigest: A,
    outOfScopeObservationDigest: C, signerKeyId: B,
  }), /successful receipt/);
});
