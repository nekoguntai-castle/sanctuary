import { canonicalSha256 } from './canonical-json.mjs';
import { publicKeyFingerprint } from './crypto.mjs';
import { runCleanupActions } from './cleanup-action-runner.mjs';
import {
  appendCleanupCheckpoint, createCleanupJournal, deriveCleanupJournalPath,
  verifyCleanupJournal,
} from './cleanup-journal.mjs';
import {
  buildOperatorRecoveryExecutionReceipt, validateHostRecoveryTrust,
  validateOperatorRecoveryApproval, validateOperatorRecoveryScope,
} from './operator-recovery-schema.mjs';
import { existsSync } from 'node:fs';

function terminalState(result, recovered) {
  if (result.terminalState === 'completed') return recovered ? 'recovered' : 'cleaned';
  if (result.terminalState === 'ambiguous') return 'ambiguous';
  if (result.terminalState === 'refused') return 'refused';
  if (result.results.some((entry) => entry.failureClass === 'cancelled')) return 'cancelled';
  return 'partial';
}

function receiptResult(entry) {
  const successful = ['cleaned', 'absent'].includes(entry.result)
    && entry.failureClass === 'none'
    && ['satisfied', 'absent'].includes(entry.reconciliationState);
  return {
    sequence: entry.sequence,
    resourceClass: entry.resourceClass,
    immutableIdentity: entry.immutableIdentity,
    result: entry.result,
    failureClass: entry.failureClass,
    postconditionState: successful ? 'satisfied'
      : entry.reconciliationState === 'ambiguous' ? 'ambiguous'
        : entry.reconciliationState === 'not_started' ? 'not_run' : 'failed',
    postconditionDigest: successful ? entry.postconditionDigest : null,
  };
}

function genesisPayload(scope, approval) {
  const actionDigests = approval.actions.map(canonicalSha256);
  return {
    actionCount: approval.actions.length,
    actionDigests,
    actionsDigest: canonicalSha256(actionDigests),
    contextFingerprint: approval.contextFingerprint,
    deploymentManifestDigest: canonicalSha256(scope),
    inventoryBeforeDigest: canonicalSha256(scope.resources),
    planDigest: approval.planDigest,
    runManifestDigest: scope.operatorAssertionDigest,
    subjectExitStatus: null,
  };
}

function validateInputs({ trust, assertion, scope, approval, evidencePrivateKey, evidencePublicKey, now, recover }) {
  const instant = now();
  validateHostRecoveryTrust(trust, recover ? {} : { now: instant });
  validateOperatorRecoveryScope(scope, recover ? { trust, assertion } : { trust, assertion, now: instant });
  validateOperatorRecoveryApproval(approval, recover ? { scope, trust } : { scope, trust, now: instant });
  const signerKeyId = publicKeyFingerprint(evidencePublicKey);
  if (!trust.evidenceFingerprints.includes(signerKeyId)) {
    throw new Error('recovery evidence signer is not trusted');
  }
  if (publicKeyFingerprint(evidencePrivateKey) !== signerKeyId) {
    throw new Error('recovery evidence key pair does not match');
  }
  return { instant, signerKeyId };
}

function journalAppender({ runtimeDirectory, approvalDigest, journal, signerKeyId,
  evidencePrivateKey, evidencePublicKey, afterCheckpoint }) {
  const state = { headDigest: journal.headDigest };
  return {
    state,
    append: async ({ checkpointType, payload }) => {
      const record = appendCleanupCheckpoint({
        runtimeDirectory, approvalDigest,
        expectedGenesisDigest: journal.genesisDigest,
        expectedHeadDigest: state.headDigest,
        checkpointType, payload, signerKeyId,
        privateKey: evidencePrivateKey, publicKey: evidencePublicKey,
      });
      state.headDigest = record.headDigest;
      await afterCheckpoint(checkpointType);
      return { checkpointDigest: record.headDigest, signed: true, synced: true };
    },
  };
}

function terminalPayload(result, startedAt, endedAt, recovered, finalObservationDigest) {
  const results = result.results.map(receiptResult);
  const state = terminalState(result, recovered);
  return {
    state,
    results,
    payload: {
      inventoryAfterDigest: finalObservationDigest,
      operationStartedAt: startedAt,
      operationEndedAt: endedAt,
      receiptCoreFinalizedAt: endedAt,
      postconditionsDigest: canonicalSha256(results.map((entry) => ({
        sequence: entry.sequence, state: entry.postconditionState,
        postconditionDigest: entry.postconditionDigest,
      }))),
      refusalsDigest: canonicalSha256(results.filter((entry) => entry.failureClass !== 'none')),
      resultsDigest: canonicalSha256(results),
      subjectExitStatus: null,
      terminalOutcome: state,
    },
  };
}

function priorResults(journal) {
  return journal.records.filter((entry) => entry.checkpoint.checkpointType === 'result')
    .map((entry) => ({
      sequence: entry.checkpoint.payload.actionSequence,
      resourceClass: entry.checkpoint.payload.resourceClass,
      immutableIdentity: entry.checkpoint.payload.immutableIdentity,
      result: entry.checkpoint.payload.result,
      failureClass: entry.checkpoint.payload.failureClass,
      mutationOutcome: entry.checkpoint.payload.mutationOutcome,
      reconciliationState: entry.checkpoint.payload.reconciliationState,
      intentCheckpointDigest: entry.checkpoint.payload.intentCheckpointDigest,
      resultCheckpointDigest: entry.digest,
      postconditionDigest: entry.checkpoint.payload.postconditionDigest,
    }));
}

function openIntent(journal) {
  const intent = journal.records.findLast((entry) => entry.checkpoint.checkpointType === 'intent');
  if (!intent) return null;
  const resolved = journal.records.some((entry) => entry.checkpoint.checkpointType === 'result'
    && entry.checkpoint.payload.intentCheckpointDigest === intent.digest);
  return resolved ? null : intent;
}

function recoveredResult(action, intent, observed) {
  const exact = observed?.resourceClass === action.resourceClass
    && observed?.immutableIdentity === action.immutableIdentity
    && ['satisfied', 'absent'].includes(observed.state)
    && observed.failureClass === 'none';
  return exact ? {
    actionSequence: action.sequence, resourceClass: action.resourceClass,
    immutableIdentity: action.immutableIdentity,
    result: observed.state === 'absent' ? 'absent' : 'cleaned', failureClass: 'none',
    mutationOutcome: 'unknown', reconciliationState: observed.state,
    intentCheckpointDigest: intent.digest, postconditionDigest: observed.postconditionDigest,
  } : {
    actionSequence: action.sequence, resourceClass: action.resourceClass,
    immutableIdentity: action.immutableIdentity, result: 'ambiguous',
    failureClass: 'query_failed', mutationOutcome: 'unknown', reconciliationState: 'ambiguous',
    intentCheckpointDigest: intent.digest, postconditionDigest: null,
  };
}

async function freshFinalObservation(buildFinalObservation) {
  const observation = await buildFinalObservation();
  if (observation?.closed !== true
      || !/^[a-f0-9]{64}$/.test(observation.observationDigest ?? '')) {
    throw new Error('operator recovery final closed-set observation failed');
  }
  return observation;
}

function buildBoundReceipt({
  scope, approval, trust, signerKeyId, state, startedAt, endedAt, results,
  finalObservationDigest, journalDigest, revalidatedProviderCorrelationEvidenceDigest,
}) {
  return buildOperatorRecoveryExecutionReceipt({
    scope, approval, trust,
    scopeDigest: canonicalSha256(scope), approvalDigest: canonicalSha256(approval),
    trustDigest: scope.trustDigest, planDigest: approval.planDigest,
    deploymentId: scope.deploymentId, operationRunId: scope.operationRunId,
    project: scope.project, state, operationStartedAt: startedAt, operationEndedAt: endedAt,
    actions: approval.actions, results, signerKeyId,
    originalProviderCorrelationEvidenceDigest: scope.providerCorrelationEvidenceDigest,
    revalidatedProviderCorrelationEvidenceDigest,
    queryResultCoreDigest: scope.queryResultCoreDigest,
    finalObservationDigest, journalDigest,
  });
}

async function recoverTerminalReceipt(options) {
  const { journal } = options;
  const terminal = journal.records.at(-1)?.checkpoint;
  if (terminal?.checkpointType !== 'terminal') {
    throw new Error('operator recovery terminal journal is malformed');
  }
  const finalObservation = await freshFinalObservation(options.buildFinalObservation);
  const results = priorResults(journal).map(receiptResult);
  const receipt = buildBoundReceipt({
    ...options, state: terminal.payload.terminalOutcome,
    startedAt: journal.records[0].checkpoint.recordedAt,
    endedAt: terminal.payload.operationEndedAt, results,
    finalObservationDigest: finalObservation.observationDigest,
    journalDigest: journal.headDigest,
  });
  return Object.freeze({ receipt, journalDigest: journal.headDigest });
}

/** Execute one already-authorized recovery session through the canonical action runner and journal. */
export async function executeOperatorRecoverySession({
  runtimeDirectory, trust, assertion, scope, approval,
  evidencePrivateKey, evidencePublicKey, runtime, signal,
  now = () => new Date(), recover = false,
  controllerRunId = 'operator-recovery-controller',
  lockObservationDigests = { project: canonicalSha256({ state: 'held' }), deployment: canonicalSha256({ state: 'held' }) },
  afterCheckpoint = async () => {},
  buildFinalObservation,
  revalidatedProviderCorrelationEvidenceDigest,
} = {}) {
  if (!runtime || ['reloadAuthority', 'mutate', 'reconcile']
    .some((key) => typeof runtime[key] !== 'function')) {
    throw new TypeError('complete operator recovery runtime is required');
  }
  if (typeof buildFinalObservation !== 'function'
      || !/^[a-f0-9]{64}$/.test(revalidatedProviderCorrelationEvidenceDigest ?? '')) {
    throw new TypeError('final observation and provider revalidation evidence are required');
  }
  const { instant, signerKeyId } = validateInputs({
    trust, assertion, scope, approval, evidencePrivateKey, evidencePublicKey, now, recover,
  });
  const approvalDigest = canonicalSha256(approval);
  const journalExists = existsSync(deriveCleanupJournalPath({ runtimeDirectory, approvalDigest }));
  if (journalExists && !recover) {
    throw new Error('operator recovery approval journal already exists or is finalized');
  }
  if (!journalExists && recover) throw new Error('operator recovery journal is missing');
  let journal = journalExists ? verifyCleanupJournal({
    runtimeDirectory, approvalDigest, publicKey: evidencePublicKey,
    expectedSignerKeyId: signerKeyId,
  }) : createCleanupJournal({
    runtimeDirectory, approvalDigest, deploymentId: scope.deploymentId,
    operationRunId: scope.operationRunId, signerKeyId,
    privateKey: evidencePrivateKey, createdAt: instant.toISOString(), payload: genesisPayload(scope, approval),
  });
  if (journal.protocol?.terminal) {
    if (!recover) throw new Error('operator recovery journal is already finalized');
    return recoverTerminalReceipt({
      journal, scope, approval, trust, signerKeyId, buildFinalObservation,
      revalidatedProviderCorrelationEvidenceDigest,
    });
  }
  const checkpoint = journalAppender({
    runtimeDirectory, approvalDigest, journal, signerKeyId,
    evidencePrivateKey, evidencePublicKey, afterCheckpoint,
  });
  if (recover) {
    await checkpoint.append({ checkpointType: 'recovery', payload: {
      controllerRunId, originalOperationRunId: scope.operationRunId,
      priorJournalHeadDigest: journal.headDigest,
      projectLockObservationDigest: lockObservationDigests.project,
      deploymentLockObservationDigest: lockObservationDigests.deployment,
    } });
    const intent = openIntent(journal);
    if (intent) {
      const action = approval.actions[intent.checkpoint.payload.actionSequence - 1];
      let observed;
      try { observed = await runtime.reconcile({ action, mutationOutcome: 'unknown', intentCheckpointDigest: intent.digest, signal }); }
      catch { observed = null; }
      await checkpoint.append({ checkpointType: 'result', payload: recoveredResult(action, intent, observed) });
    }
    journal = verifyCleanupJournal({
      runtimeDirectory, approvalDigest, publicKey: evidencePublicKey,
      expectedSignerKeyId: signerKeyId, expectedGenesisDigest: journal.genesisDigest,
    });
  }
  const executed = await runCleanupActions({
    actions: approval.actions, reloadAuthority: runtime.reloadAuthority,
    appendCheckpoint: checkpoint.append, mutate: runtime.mutate,
    reconcile: runtime.reconcile, signal, priorResults: recover ? priorResults(journal) : [],
  });
  const finalObservation = await freshFinalObservation(buildFinalObservation);
  const endedAt = now().toISOString();
  const startedAt = journal.records?.[0]?.checkpoint.recordedAt ?? instant.toISOString();
  const terminal = terminalPayload(
    executed, startedAt, endedAt, recover, finalObservation.observationDigest,
  );
  await checkpoint.append({ checkpointType: 'terminal', payload: terminal.payload });
  const receipt = buildBoundReceipt({
    scope, approval, trust, signerKeyId, state: terminal.state, startedAt, endedAt,
    results: terminal.results, finalObservationDigest: finalObservation.observationDigest,
    journalDigest: checkpoint.state.headDigest,
    revalidatedProviderCorrelationEvidenceDigest,
  });
  return Object.freeze({ receipt, journalDigest: checkpoint.state.headDigest });
}
