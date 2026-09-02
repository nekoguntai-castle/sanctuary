import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { canonicalJson, canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';
import { publicKeyFingerprint, sha256, signDetached } from '../../scripts/ownership/crypto.mjs';
import {
  buildExecutionReceiptCore, buildFinalExecutionReceipt, validateExecutionReceiptCore,
} from '../../scripts/ownership/cleanup-execution-receipt.mjs';
import { MAX_CLEANUP_JOURNAL_BYTES } from '../../scripts/ownership/cleanup-schema-contract.mjs';
import { validateArtifact } from '../../scripts/ownership/schemas.mjs';

const HASH = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const ID = 'c'.repeat(64);
const JOURNAL_KEYS = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JOURNAL_SIGNER = publicKeyFingerprint(JOURNAL_KEYS.publicKey);

function cleanupAction(overrides = {}) {
  return {
    sequence: 1, resourceClass: 'compose_container', immutableIdentity: ID,
    action: 'remove', locatorKind: 'engine_id', locator: ID,
    ownershipDigest: HASH, observationDigest: OTHER,
    dependencyIdentities: [], ...overrides,
  };
}

function inventory(overrides = {}) {
  return {
    schemaVersion: '1.2.0', artifactType: 'inventory', deploymentId: 'deploy-1',
    operationRunId: 'cleanup-1', generation: 3,
    observedAt: '2026-08-30T00:00:00.000Z', complete: true,
    policyDigest: HASH, deploymentManifestDigest: HASH,
    runManifestDigest: HASH, contextFingerprint: HASH,
    resources: [], ambiguities: [], ...overrides,
  };
}

function plan(before, overrides = {}) {
  return {
    schemaVersion: '1.1.0', artifactType: 'cleanup_plan', deploymentId: 'deploy-1',
    operationRunId: 'cleanup-1', createdAt: '2026-08-30T00:00:01.000Z',
    inventoryDigest: canonicalSha256(before), policyDigest: HASH,
    deploymentManifestDigest: HASH, runManifestDigest: HASH,
    contextFingerprint: HASH, actions: [cleanupAction()], ...overrides,
  };
}

function approval(cleanupPlan, overrides = {}) {
  return {
    schemaVersion: '1.1.0', artifactType: 'cleanup_approval', deploymentId: 'deploy-1',
    operationRunId: 'cleanup-1', issuedAt: '2026-08-30T00:00:02.000Z',
    expiresAt: '2026-08-30T01:00:02.000Z', nonce: 'approval-1',
    dryRunReceiptDigest: HASH, planDigest: canonicalSha256(cleanupPlan),
    policyDigest: HASH, deploymentManifestDigest: HASH, runManifestDigest: HASH,
    contextFingerprint: HASH, actions: cleanupPlan.actions,
    permittedClasses: ['compose_container'], permittedActionCount: 1,
    decommission: false, signerKeyId: HASH, ...overrides,
  };
}

function terminalJournal({ approval: cleanupApproval, inventoryAfter, results, refusals,
  postconditions, state, operationStartedAt, operationEndedAt,
  receiptCoreFinalizedAt, subjectExitStatus }) {
  const checkpoint = {
    version: 1, sequence: 3, checkpointType: 'terminal', previousDigest: HASH,
    approvalDigest: canonicalSha256(cleanupApproval), deploymentId: 'deploy-1',
    operationRunId: 'cleanup-1', signerKeyId: JOURNAL_SIGNER,
    recordedAt: receiptCoreFinalizedAt,
    payload: {
      terminalOutcome: state, inventoryAfterDigest: canonicalSha256(inventoryAfter),
      resultsDigest: canonicalSha256(results), refusalsDigest: canonicalSha256(refusals),
      postconditionsDigest: canonicalSha256(postconditions), receiptCoreFinalizedAt,
      operationStartedAt, operationEndedAt, subjectExitStatus,
    },
  };
  const envelope = {
    checkpoint,
    signature: signDetached(canonicalJson(checkpoint), JOURNAL_KEYS.privateKey).toString('base64'),
  };
  const envelopeBytes = canonicalJson(envelope);
  return {
    journalPath: '/private/action-journal.jsonl', genesisDigest: OTHER,
    expectedHeadDigest: HASH, headDigest: sha256(envelopeBytes), priorRecordCount: 3,
    priorBytes: 100, recordCount: 4, bytes: 100 + envelopeBytes.length + 1,
    checkpoint, envelope,
  };
}

function inputs(overrides = {}) {
  const inventoryBefore = inventory();
  const inventoryAfter = inventory({ observedAt: '2026-08-30T00:00:06.000Z' });
  const cleanupPlan = plan(inventoryBefore);
  const cleanupApproval = approval(cleanupPlan);
  const results = [{ sequence: 1, resourceClass: 'compose_container', immutableIdentity: ID, result: 'cleaned', failureClass: 'none' }];
  const refusals = [];
  const postconditions = [{ sequence: 1, resourceClass: 'compose_container', immutableIdentity: ID, state: 'satisfied', failureClass: 'none' }];
  const receiptCoreFinalizedAt = '2026-08-30T00:00:08.000Z';
  const terminal = {
    approval: cleanupApproval, inventoryAfter, results, refusals, postconditions,
    state: 'cleaned', operationStartedAt: '2026-08-30T00:00:03.000Z',
    operationEndedAt: '2026-08-30T00:00:07.000Z', receiptCoreFinalizedAt,
    subjectExitStatus: 17,
  };
  return {
    inventoryBefore, inventoryAfter, plan: cleanupPlan, approval: cleanupApproval,
    journal: terminalJournal(terminal),
    journalPublicKey: JOURNAL_KEYS.publicKey,
    results, refusals, postconditions,
    state: 'cleaned', operationStartedAt: '2026-08-30T00:00:03.000Z',
    operationEndedAt: '2026-08-30T00:00:07.000Z',
    receiptCoreFinalizedAt, signerKeyId: JOURNAL_SIGNER,
    subjectExitStatus: 17, now: new Date('2026-08-30T00:00:09.000Z'),
    ...overrides,
  };
}

function finalizedState(receiptCore, receiptCoreDigest, overrides = {}) {
  return {
    version: 1, approvalDigest: receiptCore.approvalDigest, generation: 3,
    state: 'finalized', priorStateDigest: HASH,
    operationRunId: receiptCore.operationRunId,
    journalGenesisDigest: receiptCore.journalGenesisDigest,
    finalJournalDigest: receiptCore.journalDigest,
    inventoryAfterDigest: receiptCore.inventoryAfterDigest,
    receiptCoreDigest, terminalOutcome: receiptCore.state,
    transitionedAt: '2026-08-30T00:00:08.500Z', ...overrides,
  };
}

function withJournalBytes(receipt, journalBytes) {
  const candidate = { ...receipt, journalBytes };
  const {
    receiptCoreDigest: _receiptCoreDigest,
    approvalStateGeneration: _approvalStateGeneration,
    ...envelopeCore
  } = candidate;
  return {
    ...candidate,
    receiptCoreDigest: canonicalSha256({ ...envelopeCore, approvalStateDigest: null }),
  };
}

test('execution core deterministically binds all evidence with a null approval-state digest', () => {
  const first = buildExecutionReceiptCore(inputs());
  const second = buildExecutionReceiptCore(inputs());
  assert.deepEqual(first, second);
  assert.equal(first.receiptCoreDigest, canonicalSha256(first.receiptCore));
  assert.equal(first.receiptCore.schemaVersion, '1.2.0');
  assert.equal(first.receiptCore.approvalStateDigest, null);
  assert.equal(first.receiptCore.contextFingerprint, HASH);
  assert.equal(first.receiptCore.inventoryBeforeDigest, canonicalSha256(inputs().inventoryBefore));
  assert.equal(first.receiptCore.inventoryAfterDigest, canonicalSha256(inputs().inventoryAfter));
  assert.equal(first.receiptCore.journalGenesisDigest, inputs().journal.genesisDigest);
  assert.equal(first.receiptCore.journalDigest, inputs().journal.headDigest);
  assert.equal(first.receiptCore.subjectExitStatus, 17);
  assert.equal(Object.isFrozen(first.receiptCore.actions), true);
});

test('final envelope binds the exact finalized transition without changing core fields', () => {
  const built = buildExecutionReceiptCore(inputs());
  const state = finalizedState(built.receiptCore, built.receiptCoreDigest);
  const stateDigest = canonicalSha256(state);
  const receipt = buildFinalExecutionReceipt({
    ...built, finalizedApprovalState: state, approvalStateDigest: stateDigest,
    now: new Date('2026-08-30T00:00:09.000Z'),
  });
  for (const [key, value] of Object.entries(built.receiptCore)) {
    if (key !== 'approvalStateDigest') assert.deepEqual(receipt[key], value);
  }
  assert.equal(receipt.approvalStateDigest, stateDigest);
  assert.equal(receipt.approvalStateGeneration, 3);
  assert.equal(receipt.receiptCoreDigest, built.receiptCoreDigest);
  assert.equal(Object.isFrozen(receipt), true);
  assert.doesNotThrow(() => validateArtifact(receipt, {
    now: new Date('2026-08-30T00:00:09.000Z'),
  }));
});

test('public receipt validation enforces the shared 16 MiB journal bound', () => {
  assert.equal(MAX_CLEANUP_JOURNAL_BYTES, 16 * 1024 * 1024);
  const built = buildExecutionReceiptCore(inputs());
  const state = finalizedState(built.receiptCore, built.receiptCoreDigest);
  const receipt = buildFinalExecutionReceipt({
    ...built, finalizedApprovalState: state, approvalStateDigest: canonicalSha256(state),
    now: new Date('2026-08-30T00:00:09.000Z'),
  });
  assert.doesNotThrow(() => validateArtifact(
    withJournalBytes(receipt, MAX_CLEANUP_JOURNAL_BYTES),
    { now: new Date('2026-08-30T00:00:09.000Z') },
  ));
  assert.throws(() => validateArtifact(
    withJournalBytes(receipt, MAX_CLEANUP_JOURNAL_BYTES + 1),
    { now: new Date('2026-08-30T00:00:09.000Z') },
  ), /journalBytes.*16777216/);
});

test('artifact digest and identity drift is rejected before core construction', () => {
  const base = inputs();
  assert.throws(() => buildExecutionReceiptCore({
    ...base, plan: { ...base.plan, inventoryDigest: OTHER },
  }), /inventoryBefore/);
  assert.throws(() => buildExecutionReceiptCore({
    ...base, approval: { ...base.approval, planDigest: OTHER },
  }), /bind the plan/);
  assert.throws(() => buildExecutionReceiptCore({
    ...base, inventoryAfter: inventory({ contextFingerprint: OTHER }),
  }), /contextFingerprint/);
  assert.throws(() => buildExecutionReceiptCore({
    ...base, inventoryAfter: inventory({ generation: 4 }),
  }), /generation changed/);
});

test('results, postconditions, refusals, journal bounds, and subject status are strict', () => {
  const base = inputs();
  const emptyResults = [];
  assert.throws(() => buildExecutionReceiptCore({
    ...base, results: emptyResults,
    journal: terminalJournal({ ...base, results: emptyResults }),
  }), /one-to-one/);
  const mismatchedResults = [{ ...base.results[0], immutableIdentity: OTHER }];
  assert.throws(() => buildExecutionReceiptCore({
    ...base, results: mismatchedResults,
    journal: terminalJournal({ ...base, results: mismatchedResults }),
  }), /ordered action/);
  const badPostconditions = [{ ...base.postconditions[0], state: 'satisfied', failureClass: 'query_failed' }];
  assert.throws(() => buildExecutionReceiptCore({
    ...base, postconditions: badPostconditions,
    journal: terminalJournal({ ...base, postconditions: badPostconditions }),
  }), /inconsistent/);
  assert.throws(() => buildExecutionReceiptCore({
    ...base, journal: { ...base.journal, bytes: 0 },
  }), /journal bytes/);
  const terminalAppendBytes = base.journal.bytes - base.journal.priorBytes;
  const maximumJournal = {
    ...base.journal,
    priorBytes: MAX_CLEANUP_JOURNAL_BYTES - terminalAppendBytes,
    bytes: MAX_CLEANUP_JOURNAL_BYTES,
  };
  assert.doesNotThrow(() => buildExecutionReceiptCore({ ...base, journal: maximumJournal }));
  assert.throws(() => buildExecutionReceiptCore({
    ...base,
    journal: {
      ...maximumJournal,
      priorBytes: maximumJournal.priorBytes + 1,
      bytes: MAX_CLEANUP_JOURNAL_BYTES + 1,
    },
  }), /journal bytes/);
  assert.throws(() => buildExecutionReceiptCore({ ...base, subjectExitStatus: 256 }), /subjectExitStatus/);
  const unsortedRefusals = [
      { resourceClass: 'compose_network', immutableIdentity: ID, failureClass: 'shared' },
      { resourceClass: 'compose_container', immutableIdentity: ID, failureClass: 'active' },
    ];
  assert.throws(() => buildExecutionReceiptCore({
    ...base, refusals: unsortedRefusals,
    journal: terminalJournal({ ...base, refusals: unsortedRefusals }),
  }), /sorted/);
});

test('receipt content is privacy scanned and raw secrets are rejected', () => {
  const base = inputs();
  const refusals = [{
      resourceClass: 'compose_container',
      immutableIdentity: `bc1${'q'.repeat(40)}`,
      failureClass: 'active',
    }];
  assert.throws(() => buildExecutionReceiptCore({
    ...base, state: 'partial', refusals,
    journal: terminalJournal({ ...base, state: 'partial', refusals }),
  }), /private material/);
});

test('finalization rejects stale core and every mismatched approval-state binding', () => {
  const built = buildExecutionReceiptCore(inputs());
  const original = finalizedState(built.receiptCore, built.receiptCoreDigest);
  const cases = [
    ['receiptCoreDigest', OTHER],
    ['approvalDigest', OTHER],
    ['operationRunId', 'other-run'],
    ['journalGenesisDigest', HASH],
    ['finalJournalDigest', HASH],
    ['inventoryAfterDigest', HASH],
    ['terminalOutcome', 'partial'],
  ];
  for (const [key, value] of cases) {
    const state = finalizedState(built.receiptCore, built.receiptCoreDigest, { [key]: value });
    assert.throws(() => buildFinalExecutionReceipt({
      ...built, finalizedApprovalState: state,
      approvalStateDigest: canonicalSha256(state),
      now: new Date('2026-08-30T00:00:09.000Z'),
    }), /does not match/);
  }
  assert.throws(() => buildFinalExecutionReceipt({
    ...built, receiptCoreDigest: OTHER, finalizedApprovalState: original,
    approvalStateDigest: canonicalSha256(original),
    now: new Date('2026-08-30T00:00:09.000Z'),
  }), /receiptCoreDigest/);
  assert.throws(() => buildFinalExecutionReceipt({
    ...built, finalizedApprovalState: original, approvalStateDigest: OTHER,
    now: new Date('2026-08-30T00:00:09.000Z'),
  }), /exact bytes/);
  const early = finalizedState(built.receiptCore, built.receiptCoreDigest, {
    transitionedAt: '2026-08-30T00:00:07.000Z',
  });
  assert.throws(() => buildFinalExecutionReceipt({
    ...built, finalizedApprovalState: early, approvalStateDigest: canonicalSha256(early),
    now: new Date('2026-08-30T00:00:09.000Z'),
  }), /timestamp is out of order/);
});

test('core validation rejects noncanonical timestamps and non-null transition digests', () => {
  const { receiptCore } = buildExecutionReceiptCore(inputs());
  assert.throws(() => validateExecutionReceiptCore({
    ...receiptCore, approvalStateDigest: HASH,
  }, { now: new Date('2026-08-30T00:00:09.000Z') }), /must be null/);
  assert.throws(() => validateExecutionReceiptCore({
    ...receiptCore, receiptCoreFinalizedAt: '2026-08-30T00:00:10.000Z',
  }, { now: new Date('2026-08-30T00:00:09.000Z') }), /out of order/);
});

test('terminal evidence fixes every runtime-only core field and schema generation', () => {
  const base = inputs();
  for (const [key, value] of [
    ['operationStartedAt', '2026-08-30T00:00:03.001Z'],
    ['operationEndedAt', '2026-08-30T00:00:07.001Z'],
    ['subjectExitStatus', 18],
  ]) assert.throws(() => buildExecutionReceiptCore({ ...base, [key]: value }), /terminal journal/);
  const built = buildExecutionReceiptCore(base);
  const state = finalizedState(built.receiptCore, built.receiptCoreDigest);
  const receipt = buildFinalExecutionReceipt({
    ...built, finalizedApprovalState: state, approvalStateDigest: canonicalSha256(state),
    now: new Date('2026-08-30T00:00:09.000Z'),
  });
  assert.throws(() => validateArtifact({ ...receipt, approvalStateGeneration: 2 }, {
    now: new Date('2026-08-30T00:00:09.000Z'),
  }), /from 3 to 3/);
});
