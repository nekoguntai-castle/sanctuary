import { existsSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, canonicalSha256, parseStrictJson } from './canonical-json.mjs';
import { runCleanupActions } from './cleanup-action-runner.mjs';
import {
  clearPreReservationCleanupPointer, createCleanupLedger, finalizeApproval,
  readActiveCleanupPointer, readApprovalState, tombstoneActiveCleanupPointer,
} from './cleanup-approval-ledger.mjs';
import { adoptPendingCleanupTransitions } from './cleanup-transition-adoption.mjs';
import { verifyReservedCleanupApproval } from './cleanup-approval.mjs';
import { prepareSignedArtifact, writePreparedSignedArtifactEntry } from './cleanup-evidence.mjs';
import {
  executionPostconditions, executionRefusalRows, executionTerminalOutcome,
  executionTerminalPayload, minimalExecutionResults, persistExactExecutionArtifact,
  assertExecutionBindings, validateFinalExecutionInventory,
  boundedCancellationReason, preflightExecutionEvidence, verifyPersistedExecutionEvidence,
} from './cleanup-execution.mjs';
import {
  buildExecutionReceiptCore, buildFinalExecutionReceipt,
} from './cleanup-execution-receipt.mjs';
import {
  appendCleanupCheckpoint, appendPreparedCleanupCheckpoint, prepareCleanupCheckpoint,
  verifyCleanupJournal,
} from './cleanup-journal.mjs';
import { readExternalFile } from './safe-file.mjs';
import { CLEANUP_FAILURE_CLASSES, validateArtifact } from './schemas.mjs';

function exactRecoveryCallbacks(values) {
  for (const [name, callback] of Object.entries(values)) {
    if (typeof callback !== 'function') throw new TypeError(`${name} callback is required`);
  }
}

function priorResults(journal, actions) {
  return journal.records.filter((record) => record.checkpoint.checkpointType === 'result')
    .map((record, index) => {
      const payload = record.checkpoint.payload;
      const action = actions[index];
      if (!action || payload.actionSequence !== action.sequence
          || payload.resourceClass !== action.resourceClass
          || payload.immutableIdentity !== action.immutableIdentity) {
        throw new Error('cleanup recovery result history does not match the approved plan');
      }
      return {
        sequence: payload.actionSequence, resourceClass: payload.resourceClass,
        immutableIdentity: payload.immutableIdentity, result: payload.result,
        failureClass: payload.failureClass, mutationOutcome: payload.mutationOutcome,
        reconciliationState: payload.reconciliationState,
        intentCheckpointDigest: payload.intentCheckpointDigest,
        resultCheckpointDigest: record.digest, postconditionDigest: payload.postconditionDigest,
      };
    });
}

function openIntent(journal) {
  let open = null;
  for (const record of journal.records) {
    if (record.checkpoint.checkpointType === 'intent') open = record;
    if (record.checkpoint.checkpointType === 'result') open = null;
  }
  return open;
}

function sameReconciliationIdentity(action, value) {
  return value?.resourceClass === action.resourceClass
    && value?.immutableIdentity === action.immutableIdentity;
}

function recoveryFailureClass(value, exactRefusal) {
  return exactRefusal && CLEANUP_FAILURE_CLASSES.includes(value.failureClass)
    && value.failureClass !== 'none' ? value.failureClass : 'query_failed';
}

function reconciliationResult(action, intent, value) {
  const exactIdentity = sameReconciliationIdentity(action, value);
  const exact = exactIdentity
    && ['satisfied', 'absent'].includes(value?.state)
    && /^[a-f0-9]{64}$/.test(value?.postconditionDigest ?? '')
    && value?.failureClass === 'none';
  if (exact) return {
    result: value.state === 'absent' ? 'absent' : 'cleaned', failureClass: 'none',
    mutationOutcome: 'unknown', reconciliationState: value.state,
    intentCheckpointDigest: intent.digest, postconditionDigest: value.postconditionDigest,
  };
  const refused = exactIdentity && value?.state === 'refused'
    && value?.postconditionDigest === null;
  return {
    result: 'ambiguous', failureClass: recoveryFailureClass(value, refused),
    mutationOutcome: 'unknown', reconciliationState: refused ? 'refused' : 'ambiguous',
    intentCheckpointDigest: intent.digest, postconditionDigest: null,
  };
}

function terminalSummary(journal) {
  const terminal = journal.records.at(-1);
  if (terminal?.checkpoint.checkpointType !== 'terminal') return null;
  const envelope = { checkpoint: terminal.checkpoint, signature: terminal.signature };
  const envelopeBytes = canonicalJson(envelope);
  return {
    journalPath: journal.journalPath, genesisDigest: journal.genesisDigest,
    expectedHeadDigest: terminal.checkpoint.previousDigest, headDigest: terminal.digest,
    priorRecordCount: journal.recordCount - 1,
    priorBytes: journal.bytes - envelopeBytes.length - 1,
    recordCount: journal.recordCount, bytes: journal.bytes,
    checkpoint: terminal.checkpoint, envelope,
  };
}

function readInventoryAfter(ledger, checkoutRoot) {
  const bytes = readExternalFile(path.join(ledger.executionRoot, 'inventory-after.json'), { checkoutRoot });
  const artifact = parseStrictJson(bytes);
  if (!canonicalJson(artifact).equals(bytes)) throw new Error('persisted cleanup inventory is not canonical');
  validateArtifact(artifact);
  return artifact;
}

function assertRecoveryGenesis(journal, inventoryBefore, plan) {
  const genesis = journal.records[0]?.checkpoint;
  const payload = genesis?.payload;
  const actionDigests = plan.actions.map(canonicalSha256);
  if (journal.identity.deploymentId !== plan.deploymentId
      || journal.identity.operationRunId !== plan.operationRunId
      || payload?.inventoryBeforeDigest !== canonicalSha256(inventoryBefore)
      || payload?.planDigest !== canonicalSha256(plan)
      || payload?.contextFingerprint !== plan.contextFingerprint
      || payload?.deploymentManifestDigest !== plan.deploymentManifestDigest
      || payload?.runManifestDigest !== plan.runManifestDigest
      || payload?.actionCount !== plan.actions.length
      || canonicalSha256(payload?.actionDigests ?? null) !== canonicalSha256(actionDigests)
      || payload?.actionsDigest !== canonicalSha256(actionDigests)) {
    throw new Error('cleanup recovery journal genesis does not bind the supplied execution evidence');
  }
}

function recoveredSubjectExitStatus(journal, supplied) {
  const durable = journal.records[0].checkpoint.payload.subjectExitStatus;
  if (supplied !== undefined && supplied !== durable) {
    throw new Error('cleanup recovery subjectExitStatus conflicts with the durable journal genesis');
  }
  return durable;
}

async function appendRecoveryCancellation(options) {
  const { journal, signal } = options;
  if (!signal?.aborted || journal.protocol.cancellationSeen || journal.protocol.terminal) return journal;
  appendCleanupCheckpoint({
    ...options, expectedGenesisDigest: journal.genesisDigest,
    expectedHeadDigest: journal.headDigest, checkpointType: 'cancellation',
    payload: {
      processedActionCount: journal.protocol.processedActionCount,
      reason: boundedCancellationReason(signal),
    },
  });
  return verifyCleanupJournal({
    runtimeDirectory: options.runtimeDirectory, approvalDigest: options.approvalDigest,
    publicKey: options.publicKey, expectedSignerKeyId: options.signerKeyId,
    expectedGenesisDigest: journal.genesisDigest,
  });
}

async function writeRecoveryReceipt(prepared, afterBoundary) {
  const boundaries = ['receipt_file_written', 'receipt_signature_written', 'receipt_checksum_written'];
  for (let index = 0; index < boundaries.length; index += 1) {
    writePreparedSignedArtifactEntry(prepared, index);
    await afterBoundary(boundaries[index]);
  }
}

async function finishRecovery({
  runtimeDirectory, checkoutRoot, ledger, approvalDigest, inventoryBefore, plan, approval,
  journal, executedResults, buildInventoryAfter, signerKeyId, privateKey, publicKey,
  privateKeyPath, publicKeyPath, receiptOutputPath, subjectExitStatus, now, afterBoundary,
  reusePersistedInventory, signal,
}) {
  let summary = terminalSummary(journal);
  let inventoryAfter;
  let results = minimalExecutionResults(executedResults);
  let refusals = executionRefusalRows(executedResults);
  let checks = executionPostconditions(executedResults);
  let state = executionTerminalOutcome(results, true, journal.protocol.cancellationSeen);
  let operationStartedAt = journal.records[0].checkpoint.recordedAt;
  let operationEndedAt;
  let receiptCoreFinalizedAt;
  if (summary) {
    inventoryAfter = readInventoryAfter(ledger, checkoutRoot);
    const terminal = summary.checkpoint.payload;
    operationStartedAt = terminal.operationStartedAt;
    operationEndedAt = terminal.operationEndedAt;
    receiptCoreFinalizedAt = terminal.receiptCoreFinalizedAt;
    if (terminal.subjectExitStatus !== subjectExitStatus) {
      throw new Error('terminal cleanup subjectExitStatus conflicts with journal genesis');
    }
    state = terminal.terminalOutcome;
    validateFinalExecutionInventory(inventoryAfter, inventoryBefore, plan.actions, results);
    for (const [actual, expected, label] of [
      [canonicalSha256(inventoryAfter), terminal.inventoryAfterDigest, 'inventory'],
      [canonicalSha256(results), terminal.resultsDigest, 'results'],
      [canonicalSha256(refusals), terminal.refusalsDigest, 'refusals'],
      [canonicalSha256(checks), terminal.postconditionsDigest, 'postconditions'],
    ]) if (actual !== expected) throw new Error(`terminal cleanup ${label} digest mismatch`);
  } else {
    const inventoryPath = path.join(ledger.executionRoot, 'inventory-after.json');
    const inventoryPersisted = reusePersistedInventory && existsSync(inventoryPath);
    if (inventoryPersisted) {
      inventoryAfter = readInventoryAfter(ledger, checkoutRoot);
    } else {
      inventoryAfter = await buildInventoryAfter();
    }
    validateFinalExecutionInventory(inventoryAfter, inventoryBefore, plan.actions, results);
    journal = await appendRecoveryCancellation({
      journal, signal, runtimeDirectory, approvalDigest, signerKeyId, privateKey, publicKey,
    });
    state = executionTerminalOutcome(results, true, journal.protocol.cancellationSeen);
    if (!inventoryPersisted) {
      persistExactExecutionArtifact(inventoryPath, inventoryAfter, checkoutRoot);
    }
    await afterBoundary('inventory_after_persisted');
    journal = await appendRecoveryCancellation({
      journal, signal, runtimeDirectory, approvalDigest, signerKeyId, privateKey, publicKey,
    });
    state = executionTerminalOutcome(results, true, journal.protocol.cancellationSeen);
    operationEndedAt = now().toISOString();
    receiptCoreFinalizedAt = now().toISOString();
    summary = prepareCleanupCheckpoint({
      runtimeDirectory, approvalDigest, expectedGenesisDigest: journal.genesisDigest,
      expectedHeadDigest: journal.headDigest, checkpointType: 'terminal',
      signerKeyId, privateKey, publicKey, recordedAt: receiptCoreFinalizedAt,
      payload: executionTerminalPayload({
        inventoryAfter, results, refusals, postconditions: checks, state,
        operationStartedAt, operationEndedAt, receiptCoreFinalizedAt, subjectExitStatus,
      }),
    });
  }
  const built = buildExecutionReceiptCore({
    inventoryBefore, inventoryAfter, plan, approval, journal: summary,
    results, refusals, postconditions: checks, state,
    operationStartedAt, operationEndedAt, receiptCoreFinalizedAt,
    signerKeyId, journalPublicKey: publicKey, subjectExitStatus, now: now(),
  });
  if (!terminalSummary(journal)) {
    appendPreparedCleanupCheckpoint({
      runtimeDirectory, approvalDigest, expectedGenesisDigest: journal.genesisDigest,
      expectedHeadDigest: journal.headDigest, prepared: summary, signerKeyId, publicKey,
    });
    await afterBoundary('terminal_appended');
  }
  let finalized = readApprovalState(ledger);
  if (finalized.value.state === 'reserved') {
    finalized = finalizeApproval(ledger, {
      expectedStateDigest: finalized.digest, operationRunId: plan.operationRunId,
      journalGenesisDigest: journal.genesisDigest, finalJournalDigest: summary.headDigest,
      inventoryAfterDigest: canonicalSha256(inventoryAfter), receiptCoreDigest: built.receiptCoreDigest,
      terminalOutcome: state, transitionedAt: now().toISOString(),
    });
    await afterBoundary('approval_finalized');
  }
  const receipt = buildFinalExecutionReceipt({
    ...built, finalizedApprovalState: finalized.value,
    approvalStateDigest: finalized.digest, now: now(),
  });
  const outputPath = path.resolve(receiptOutputPath ?? path.join(ledger.executionRoot, 'cleanup-receipt.json'));
  const prepared = prepareSignedArtifact(receipt, {
    outputPath, privateKeyPath, publicKeyPath,
    expectedFingerprint: signerKeyId, checkoutRoot,
  });
  await writeRecoveryReceipt(prepared, afterBoundary);
  await afterBoundary('receipt_written');
  const verifiedSidecars = verifyPersistedExecutionEvidence({
    receipt, outputPath, publicKeyPath, signerKeyId, checkoutRoot, now: now(),
  });
  const pointer = readActiveCleanupPointer(ledger);
  const tombstone = tombstoneActiveCleanupPointer(ledger, {
    expectedPointerDigest: pointer.digest, expectedStateDigest: finalized.digest,
    operationRunId: plan.operationRunId, journalGenesisDigest: journal.genesisDigest,
    ...verifiedSidecars, transitionedAt: now().toISOString(),
  });
  await afterBoundary('pointer_tombstoned');
  return { receipt, receiptDigest: prepared.digest, receiptOutputPath: outputPath,
    approvalStateDigest: finalized.digest, pointerDigest: tombstone.digest,
    journalDigest: summary.headDigest, state };
}

/** Resume only the exact durable approval/journal identity; never replay an open intent. */
export async function recoverCleanupExecution({
  runtimeDirectory, checkoutRoot, inventoryBefore, plan, approval, dryRunReceipt,
  signerKeyId, privateKey, publicKey, privateKeyPath, publicKeyPath,
  controllerRunId, projectLockObservationDigest, deploymentLockObservationDigest,
  reloadAuthority, mutate, reconcile, buildInventoryAfter,
  receiptOutputPath, subjectExitStatus, signal,
  now = () => new Date(), afterBoundary = async () => {},
}) {
  exactRecoveryCallbacks({ reloadAuthority, mutate, reconcile, buildInventoryAfter, afterBoundary });
  verifyReservedCleanupApproval(approval, plan, dryRunReceipt, {
    expectedContextFingerprint: inventoryBefore.contextFingerprint,
  });
  assertExecutionBindings(inventoryBefore, plan, approval);
  const approvalDigest = canonicalSha256(approval);
  const ledger = createCleanupLedger({ runtimeDirectory, deploymentId: plan.deploymentId, approvalDigest });
  let approvalState = readApprovalState(ledger);
  if (!approvalState) throw new Error('cleanup recovery approval state is missing');
  const outputPath = preflightExecutionEvidence({
    ledger, checkoutRoot, signerKeyId, privateKey, publicKey, privateKeyPath, publicKeyPath,
    receiptOutputPath, allowExisting: approvalState.value.state === 'finalized',
  });
  let pointer = readActiveCleanupPointer(ledger);
  const pointerBindsApproval = pointer?.value.approvalDigest === approvalDigest;
  const expectedGenesisDigest = approvalState.value.state === 'unused'
    ? (pointerBindsApproval ? pointer.value.journalGenesisDigest : undefined)
    : approvalState.value.journalGenesisDigest;
  let journal = verifyCleanupJournal({
    runtimeDirectory, approvalDigest, publicKey, expectedSignerKeyId: signerKeyId,
    ...(expectedGenesisDigest ? { expectedGenesisDigest } : {}),
  });
  assertRecoveryGenesis(journal, inventoryBefore, plan);
  subjectExitStatus = recoveredSubjectExitStatus(journal, subjectExitStatus);
  ({ approvalState, pointer } = adoptPendingCleanupTransitions(ledger, {
    operationRunId: plan.operationRunId, journalGenesisDigest: journal.genesisDigest,
  }));
  if (!pointer || pointer.value.approvalDigest !== approvalDigest
      || pointer.value.operationRunId !== plan.operationRunId
      || pointer.value.journalGenesisDigest !== journal.genesisDigest) {
    throw new Error('cleanup recovery identity is incomplete or mismatched');
  }
  if (approvalState.value.state === 'unused') {
    const cleared = clearPreReservationCleanupPointer(ledger, {
      expectedPointerDigest: pointer.digest, operationRunId: plan.operationRunId,
      journalGenesisDigest: pointer.value.journalGenesisDigest,
      transitionedAt: now().toISOString(),
    });
    return { state: 'cleared_pre_reservation', pointerDigest: cleared.digest };
  }
  if (approvalState.value.journalGenesisDigest !== journal.genesisDigest) {
    throw new Error('cleanup recovery approval state does not bind the verified journal');
  }
  const reusePersistedInventory = journal.protocol.processedActionCount === journal.protocol.actionCount
    && !openIntent(journal);
  if (!journal.protocol.terminal && approvalState.value.state === 'finalized') {
    throw new Error('finalized approval is missing its terminal journal checkpoint');
  }
  if (!journal.protocol.terminal) {
    const recovery = appendCleanupCheckpoint({
      runtimeDirectory, approvalDigest, expectedGenesisDigest: journal.genesisDigest,
      expectedHeadDigest: journal.headDigest, checkpointType: 'recovery', signerKeyId,
      privateKey, publicKey, payload: {
        controllerRunId, originalOperationRunId: plan.operationRunId,
        priorJournalHeadDigest: journal.headDigest,
        projectLockObservationDigest, deploymentLockObservationDigest,
      },
    });
    await afterBoundary('recovery_checkpoint');
    journal = verifyCleanupJournal({
      runtimeDirectory, approvalDigest, publicKey, expectedSignerKeyId: signerKeyId,
      expectedGenesisDigest: journal.genesisDigest,
    });
    const intent = openIntent(journal);
    if (intent) {
      const action = plan.actions[intent.checkpoint.payload.actionSequence - 1];
      let observed;
      try {
        observed = await reconcile({
          action, mutationOutcome: 'unknown', intentCheckpointDigest: intent.digest, signal,
        });
      } catch { observed = null; }
      const classified = reconciliationResult(action, intent, observed);
      appendCleanupCheckpoint({
        runtimeDirectory, approvalDigest, expectedGenesisDigest: journal.genesisDigest,
        expectedHeadDigest: journal.headDigest, checkpointType: 'result', signerKeyId,
        privateKey, publicKey, payload: {
          actionSequence: action.sequence, resourceClass: action.resourceClass,
          immutableIdentity: action.immutableIdentity, ...classified,
        },
      });
      journal = verifyCleanupJournal({
        runtimeDirectory, approvalDigest, publicKey, expectedSignerKeyId: signerKeyId,
        expectedGenesisDigest: journal.genesisDigest,
      });
    }
    const state = { headDigest: journal.headDigest };
    const appended = async ({ checkpointType, payload }) => {
      const record = appendCleanupCheckpoint({
        runtimeDirectory, approvalDigest, expectedGenesisDigest: journal.genesisDigest,
        expectedHeadDigest: state.headDigest, checkpointType, payload,
        signerKeyId, privateKey, publicKey,
      });
      state.headDigest = record.headDigest;
      return { checkpointDigest: record.headDigest, signed: true, synced: true };
    };
    const executed = await runCleanupActions({
      actions: plan.actions, priorResults: priorResults(journal, plan.actions),
      reloadAuthority, appendCheckpoint: appended, mutate, reconcile, signal,
    });
    if (!executed.journalComplete) throw new Error('cleanup recovery journal is incomplete');
    journal = verifyCleanupJournal({
      runtimeDirectory, approvalDigest, publicKey, expectedSignerKeyId: signerKeyId,
      expectedGenesisDigest: journal.genesisDigest,
    });
    journal = await appendRecoveryCancellation({
      journal, signal, runtimeDirectory, approvalDigest, signerKeyId, privateKey, publicKey,
    });
  }
  return finishRecovery({
    runtimeDirectory, checkoutRoot, ledger, approvalDigest, inventoryBefore, plan, approval,
    journal, executedResults: priorResults(journal, plan.actions), buildInventoryAfter,
    signerKeyId, privateKey, publicKey, privateKeyPath, publicKeyPath,
    receiptOutputPath: outputPath, subjectExitStatus, now, afterBoundary, reusePersistedInventory,
    signal,
  });
}
