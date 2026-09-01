import { existsSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, canonicalSha256, parseStrictJson } from './canonical-json.mjs';
import { runCleanupActions } from './cleanup-action-runner.mjs';
import {
  createCleanupLedger, finalizeApproval, initializeApprovalState,
  publishActiveCleanupPointer, readActiveCleanupPointer, reserveApproval,
  tombstoneActiveCleanupPointer,
} from './cleanup-approval-ledger.mjs';
import { verifyUnusedCleanupApproval } from './cleanup-approval.mjs';
import {
  prepareSignedArtifact, verifySignedArtifact, writePreparedSignedArtifactEntry,
} from './cleanup-evidence.mjs';
import {
  buildExecutionReceiptCore, buildFinalExecutionReceipt,
} from './cleanup-execution-receipt.mjs';
import {
  appendCleanupCheckpoint, appendPreparedCleanupCheckpoint, createCleanupJournal,
  prepareCleanupCheckpoint,
} from './cleanup-journal.mjs';
import { assertKeyPair, publicKeyFingerprint, sha256 } from './crypto.mjs';
import { assertLocalPrivateSafe } from './privacy.mjs';
import {
  readExternalFile, readPrivateKeyFile, writeExternalFileAtomic,
} from './safe-file.mjs';
import { validateArtifact } from './schemas.mjs';

export function minimalExecutionResults(results) {
  return results.map(({ sequence, resourceClass, immutableIdentity, result, failureClass }) => ({
    sequence, resourceClass, immutableIdentity, result, failureClass,
  }));
}

export function executionPostconditions(results) {
  return results.map((entry) => ({
    sequence: entry.sequence,
    resourceClass: entry.resourceClass,
    immutableIdentity: entry.immutableIdentity,
    state: ['satisfied', 'absent'].includes(entry.reconciliationState) ? 'satisfied'
      : entry.reconciliationState === 'ambiguous' ? 'ambiguous'
        : entry.reconciliationState === 'not_started' ? 'not_run' : 'failed',
    failureClass: ['satisfied', 'absent'].includes(entry.reconciliationState)
      ? 'none' : entry.failureClass,
  }));
}

export function executionRefusalRows(results) {
  const rows = results.filter((entry) => ['refused', 'ambiguous'].includes(entry.result))
    .map(({ resourceClass, immutableIdentity, failureClass }) => ({
      resourceClass, immutableIdentity, failureClass,
    }));
  return [...new Map(rows.map((entry) => [
    `${entry.resourceClass}\0${entry.immutableIdentity}\0${entry.failureClass}`, entry,
  ])).values()].sort((left, right) => (
    left.resourceClass.localeCompare(right.resourceClass)
    || left.immutableIdentity.localeCompare(right.immutableIdentity)
    || left.failureClass.localeCompare(right.failureClass)
  ));
}

export function executionTerminalOutcome(results, recovered = false, cancelled = false) {
  if (results.length === 0) return cancelled ? 'cancelled' : (recovered ? 'recovered' : 'no_op');
  if (results.some((entry) => entry.result === 'ambiguous')) return 'ambiguous';
  if (cancelled || results.some((entry) => entry.failureClass === 'cancelled')) return 'cancelled';
  const successful = results.filter((entry) => ['cleaned', 'absent', 'retained'].includes(entry.result)).length;
  if (successful === results.length) return recovered ? 'recovered' : 'cleaned';
  if (successful > 0) return 'partial';
  if (results.every((entry) => entry.result === 'refused')) return 'refused';
  return 'partial';
}

export function assertExecutionBindings(inventory, plan, approval) {
  validateArtifact(inventory);
  validateArtifact(plan);
  validateArtifact(approval, { now: new Date(approval.issuedAt) });
  if (!inventory.complete || inventory.ambiguities.length > 0) {
    throw new Error('cleanup execution requires a complete authoritative inventory');
  }
  if (plan.inventoryDigest !== canonicalSha256(inventory)
      || approval.planDigest !== canonicalSha256(plan)) {
    throw new Error('cleanup execution evidence digest binding is invalid');
  }
}

function isSuccessfulResult(result) {
  return ['cleaned', 'absent'].includes(result?.result);
}

function hasLaterSuccessfulRemove(actions, results, actionIndex) {
  const stopped = actions[actionIndex];
  return actions.slice(actionIndex + 1).some((action, offset) => (
    action.action === 'remove'
    && action.resourceClass === stopped.resourceClass
    && action.immutableIdentity === stopped.immutableIdentity
    && isSuccessfulResult(results[actionIndex + offset + 1])
  ));
}

export function validateFinalExecutionInventory(inventoryAfter, inventoryBefore, actions, results) {
  validateArtifact(inventoryAfter);
  if (!inventoryAfter.complete || inventoryAfter.ambiguities.length > 0) {
    throw new Error('authoritative cleanup postcondition inventory is incomplete or ambiguous');
  }
  for (const key of [
    'deploymentId', 'operationRunId', 'generation', 'policyDigest',
    'deploymentManifestDigest', 'runManifestDigest', 'contextFingerprint',
  ]) if (inventoryAfter[key] !== inventoryBefore[key]) {
    throw new Error(`cleanup postcondition inventory ${key} changed`);
  }
  actions.forEach((action, index) => {
    const result = results[index];
    if (!isSuccessfulResult(result)) return;
    const survivor = inventoryAfter.resources.find((resource) => (
      resource.resourceClass === action.resourceClass
      && resource.immutableIdentity === action.immutableIdentity
    ));
    if (action.action === 'remove' && survivor) {
      throw new Error('authoritative cleanup postcondition still contains a removed identity');
    }
    const removedLater = !survivor && hasLaterSuccessfulRemove(actions, results, index);
    if (action.action === 'stop' && action.resourceClass === 'compose_container'
        && !removedLater && survivor?.running !== false) {
      throw new Error('authoritative cleanup postcondition does not corroborate a stopped container');
    }
  });
  return inventoryAfter;
}

export function persistExactExecutionArtifact(filePath, artifact, checkoutRoot) {
  const bytes = canonicalJson(artifact);
  if (existsSync(filePath)) {
    const existing = readExternalFile(filePath, { checkoutRoot });
    if (!existing.equals(bytes)) throw new Error('cleanup execution evidence collision');
  } else writeExternalFileAtomic(filePath, bytes, { checkoutRoot });
  return canonicalSha256(artifact);
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertReceiptParent(outputPath, checkoutRoot) {
  const resolvedParent = realpathSync(path.dirname(outputPath));
  const resolvedCheckout = realpathSync(checkoutRoot);
  const parentInfo = lstatSync(resolvedParent);
  const unsafe = resolvedParent !== path.dirname(outputPath)
    || isWithin(outputPath, resolvedCheckout)
    || !parentInfo.isDirectory()
    || parentInfo.isSymbolicLink()
    || (typeof process.getuid === 'function' && parentInfo.uid !== process.getuid())
    || (parentInfo.mode & 0o077) !== 0;
  if (unsafe) {
    throw new Error('cleanup receipt output parent must be owner-only, non-symlink, and outside checkout');
  }
}

function assertSigningMaterial({
  checkoutRoot, signerKeyId, privateKey, publicKey, privateKeyPath, publicKeyPath,
}) {
  const diskPrivateKey = readPrivateKeyFile(path.resolve(privateKeyPath), { checkoutRoot });
  const diskPublicKey = readExternalFile(path.resolve(publicKeyPath), {
    checkoutRoot, maxBytes: 64 * 1024,
  });
  const suppliedPrivateKey = Buffer.isBuffer(privateKey) ? privateKey : Buffer.from(privateKey ?? '');
  const suppliedPublicKey = Buffer.isBuffer(publicKey) ? publicKey : Buffer.from(publicKey ?? '');
  if (!suppliedPrivateKey.equals(diskPrivateKey) || !suppliedPublicKey.equals(diskPublicKey)) {
    throw new Error('cleanup signing key bytes changed before execution');
  }
  assertKeyPair(privateKey, publicKey);
  if (publicKeyFingerprint(publicKey) !== signerKeyId) {
    throw new Error('cleanup evidence signer does not match the trusted fingerprint');
  }
}

/** Validate immutable receipt location and exact signing material before reservation/mutation. */
export function preflightExecutionEvidence({
  ledger, checkoutRoot, signerKeyId, privateKey, publicKey,
  privateKeyPath, publicKeyPath, receiptOutputPath, allowExisting = false,
}) {
  const expectedOutputPath = path.join(ledger.executionRoot, 'cleanup-receipt.json');
  const outputPath = path.resolve(receiptOutputPath ?? expectedOutputPath);
  if (outputPath !== expectedOutputPath) {
    throw new Error('cleanup receipt output path must be derived from the approval ledger');
  }
  assertReceiptParent(outputPath, checkoutRoot);
  assertSigningMaterial({
    checkoutRoot, signerKeyId, privateKey, publicKey, privateKeyPath, publicKeyPath,
  });
  const sidecars = [outputPath, `${outputPath}.sig`, `${outputPath.slice(0, -5)}.sha256`];
  if (!allowExisting && sidecars.some(existsSync)) {
    throw new Error('cleanup receipt output already exists before reservation');
  }
  return outputPath;
}

/** Re-read and verify all three durable receipt files immediately before tombstoning. */
export function verifyPersistedExecutionEvidence({
  receipt, outputPath, publicKeyPath, signerKeyId, checkoutRoot, now,
}) {
  const checksumPath = outputPath.endsWith('.json')
    ? `${outputPath.slice(0, -5)}.sha256` : `${outputPath}.sha256`;
  const signaturePath = `${outputPath}.sig`;
  const before = {
    receipt: readExternalFile(outputPath, { checkoutRoot }),
    signature: readExternalFile(signaturePath, { checkoutRoot }),
    checksum: readExternalFile(checksumPath, { checkoutRoot, maxBytes: 128 }),
  };
  const verified = verifySignedArtifact({
    inputPath: outputPath, signaturePath, checksumPath, publicKeyPath,
    expectedFingerprint: signerKeyId, checkoutRoot, now,
  });
  if (canonicalSha256(verified.artifact) !== canonicalSha256(receipt)) {
    throw new Error('persisted cleanup receipt does not match the finalized execution evidence');
  }
  const after = {
    receipt: readExternalFile(outputPath, { checkoutRoot }),
    signature: readExternalFile(signaturePath, { checkoutRoot }),
    checksum: readExternalFile(checksumPath, { checkoutRoot, maxBytes: 128 }),
  };
  if (!before.receipt.equals(after.receipt) || !before.signature.equals(after.signature)
      || !before.checksum.equals(after.checksum)
      || sha256(after.receipt) !== verified.digest
      || after.checksum.toString('ascii') !== verified.digest) {
    throw new Error('persisted cleanup receipt changed after verification');
  }
  return {
    receiptDigest: verified.digest,
    signatureDigest: sha256(after.signature),
    checksumDigest: sha256(after.checksum),
  };
}

export function executionTerminalPayload({ inventoryAfter, results, refusals, postconditions: checks,
  operationStartedAt, operationEndedAt, receiptCoreFinalizedAt, subjectExitStatus, state }) {
  return {
    terminalOutcome: state,
    inventoryAfterDigest: canonicalSha256(inventoryAfter),
    resultsDigest: canonicalSha256(results),
    refusalsDigest: canonicalSha256(refusals),
    postconditionsDigest: canonicalSha256(checks),
    operationStartedAt, operationEndedAt, receiptCoreFinalizedAt, subjectExitStatus,
  };
}

function appendCallback(options, state, afterBoundary) {
  return async ({ checkpointType, payload }) => {
    const appended = appendCleanupCheckpoint({
      ...options, expectedHeadDigest: state.headDigest, checkpointType, payload,
    });
    state.headDigest = appended.headDigest;
    await afterBoundary(`checkpoint_${checkpointType}`);
    return { checkpointDigest: appended.headDigest, signed: true, synced: true };
  };
}

export function boundedCancellationReason(signal) {
  const reason = typeof signal?.reason === 'string' ? signal.reason.toLowerCase() : '';
  if (['sigint', 'interrupt'].includes(reason)) return 'interrupt';
  if (['sigterm', 'termination'].includes(reason)) return 'termination';
  if (['sighup', 'hangup'].includes(reason)) return 'hangup';
  return 'abort';
}

async function appendCancellation({ signal, required = false, cancelled, appendCheckpoint, processedActionCount }) {
  if ((!signal?.aborted && !required) || cancelled) return cancelled;
  await appendCheckpoint({
    checkpointType: 'cancellation',
    payload: { processedActionCount, reason: boundedCancellationReason(signal) },
  });
  return true;
}

async function writeReceiptEntries(prepared, afterBoundary) {
  const boundaries = ['receipt_file_written', 'receipt_signature_written', 'receipt_checksum_written'];
  for (let index = 0; index < boundaries.length; index += 1) {
    writePreparedSignedArtifactEntry(prepared, index);
    await afterBoundary(boundaries[index]);
  }
}

/** Coordinate one already-verified approval through its durable terminal receipt. */
export async function applyCleanupExecution({
  runtimeDirectory, checkoutRoot, inventoryBefore, plan, approval, dryRunReceipt,
  signerKeyId, privateKey, publicKey, privateKeyPath, publicKeyPath,
  reloadAuthority, mutate, reconcile, buildInventoryAfter,
  receiptOutputPath, signal, subjectExitStatus = null,
  now = () => new Date(), afterBoundary = async () => {},
}) {
  assertExecutionBindings(inventoryBefore, plan, approval);
  verifyUnusedCleanupApproval(approval, plan, dryRunReceipt, {
    now: now(), expectedContextFingerprint: inventoryBefore.contextFingerprint,
  });
  for (const [name, callback] of Object.entries({ reloadAuthority, mutate, reconcile, buildInventoryAfter })) {
    if (typeof callback !== 'function') throw new TypeError(`${name} callback is required`);
  }
  if (typeof afterBoundary !== 'function') throw new TypeError('afterBoundary must be a function');
  const approvalDigest = canonicalSha256(approval);
  const ledger = createCleanupLedger({ runtimeDirectory, deploymentId: plan.deploymentId, approvalDigest });
  const outputPath = preflightExecutionEvidence({
    ledger, checkoutRoot, signerKeyId, privateKey, publicKey, privateKeyPath, publicKeyPath,
    receiptOutputPath,
  });
  const unused = initializeApprovalState(ledger);
  if (unused.value.state !== 'unused') throw new Error('cleanup approval is not unused');
  const requestedOperationStartedAt = now().toISOString();
  const actionDigests = plan.actions.map(canonicalSha256);
  const journal = createCleanupJournal({
    runtimeDirectory, approvalDigest, deploymentId: plan.deploymentId,
    operationRunId: plan.operationRunId, signerKeyId, privateKey,
    createdAt: requestedOperationStartedAt,
    payload: {
      actionCount: plan.actions.length, actionDigests,
      actionsDigest: canonicalSha256(actionDigests),
      contextFingerprint: plan.contextFingerprint,
      deploymentManifestDigest: plan.deploymentManifestDigest,
      inventoryBeforeDigest: canonicalSha256(inventoryBefore),
      planDigest: canonicalSha256(plan), runManifestDigest: plan.runManifestDigest,
      subjectExitStatus,
    },
  });
  const operationStartedAt = journal.checkpoint.recordedAt;
  await afterBoundary('journal_created');
  const priorPointer = readActiveCleanupPointer(ledger);
  const active = publishActiveCleanupPointer(ledger, {
    expectedPointerDigest: priorPointer?.digest ?? null,
    operationRunId: plan.operationRunId, journalGenesisDigest: journal.genesisDigest,
  });
  await afterBoundary('pointer_published');
  verifyUnusedCleanupApproval(approval, plan, dryRunReceipt, {
    now: now(), expectedContextFingerprint: inventoryBefore.contextFingerprint,
  });
  const reserved = reserveApproval(ledger, {
    expectedStateDigest: unused.digest, operationRunId: plan.operationRunId,
    journalGenesisDigest: journal.genesisDigest,
  });
  await afterBoundary('approval_reserved');
  const journalState = { headDigest: journal.headDigest };
  const journalOptions = {
    runtimeDirectory, approvalDigest, expectedGenesisDigest: journal.genesisDigest,
    signerKeyId, privateKey, publicKey,
  };
  const executed = await runCleanupActions({
    actions: plan.actions, reloadAuthority,
    appendCheckpoint: appendCallback(journalOptions, journalState, afterBoundary),
    mutate, reconcile, signal,
  });
  if (!executed.journalComplete) throw new Error('cleanup action journal is incomplete and requires recovery');
  const appendExecutionCheckpoint = appendCallback(journalOptions, journalState, afterBoundary);
  const resultCancelled = executed.results.some((entry) => entry.failureClass === 'cancelled');
  let cancelled = false;
  cancelled = await appendCancellation({
    signal, required: resultCancelled, cancelled, appendCheckpoint: appendExecutionCheckpoint,
    processedActionCount: executed.processedActionCount,
  });
  const inventoryAfter = await buildInventoryAfter();
  cancelled = await appendCancellation({
    signal, cancelled, appendCheckpoint: appendExecutionCheckpoint,
    processedActionCount: executed.processedActionCount,
  });
  validateFinalExecutionInventory(
    inventoryAfter, inventoryBefore, plan.actions, minimalExecutionResults(executed.results),
  );
  const inventoryAfterPath = path.join(ledger.executionRoot, 'inventory-after.json');
  persistExactExecutionArtifact(inventoryAfterPath, inventoryAfter, checkoutRoot);
  await afterBoundary('inventory_after_persisted');
  cancelled = await appendCancellation({
    signal, cancelled, appendCheckpoint: appendExecutionCheckpoint,
    processedActionCount: executed.processedActionCount,
  });
  const results = minimalExecutionResults(executed.results);
  const refusals = executionRefusalRows(executed.results);
  const checks = executionPostconditions(executed.results);
  const state = executionTerminalOutcome(results, false, cancelled);
  const operationEndedAt = now().toISOString();
  const receiptCoreFinalizedAt = now().toISOString();
  const preparedTerminal = prepareCleanupCheckpoint({
    ...journalOptions, expectedHeadDigest: journalState.headDigest,
    checkpointType: 'terminal', recordedAt: receiptCoreFinalizedAt,
    payload: executionTerminalPayload({
      inventoryAfter, results, refusals, postconditions: checks, state,
      operationStartedAt, operationEndedAt, receiptCoreFinalizedAt, subjectExitStatus,
    }),
  });
  const { receiptCore, receiptCoreDigest } = buildExecutionReceiptCore({
    inventoryBefore, inventoryAfter, plan, approval, journal: preparedTerminal,
    results, refusals, postconditions: checks, state,
    operationStartedAt, operationEndedAt, receiptCoreFinalizedAt,
    signerKeyId, journalPublicKey: publicKey, subjectExitStatus, now: now(),
  });
  assertLocalPrivateSafe(receiptCore);
  appendPreparedCleanupCheckpoint({
    runtimeDirectory, approvalDigest, expectedGenesisDigest: journal.genesisDigest,
    expectedHeadDigest: journalState.headDigest, prepared: preparedTerminal,
    signerKeyId, publicKey,
  });
  journalState.headDigest = preparedTerminal.headDigest;
  await afterBoundary('terminal_appended');
  const finalized = finalizeApproval(ledger, {
    expectedStateDigest: reserved.digest, operationRunId: plan.operationRunId,
    journalGenesisDigest: journal.genesisDigest,
    finalJournalDigest: preparedTerminal.headDigest,
    inventoryAfterDigest: canonicalSha256(inventoryAfter), receiptCoreDigest,
    terminalOutcome: state, transitionedAt: now().toISOString(),
  });
  await afterBoundary('approval_finalized');
  const receipt = buildFinalExecutionReceipt({
    receiptCore, receiptCoreDigest, finalizedApprovalState: finalized.value,
    approvalStateDigest: finalized.digest, now: now(),
  });
  const preparedReceipt = prepareSignedArtifact(receipt, {
    outputPath, privateKeyPath, publicKeyPath,
    expectedFingerprint: signerKeyId, checkoutRoot,
  });
  await afterBoundary('receipt_prepared');
  await writeReceiptEntries(preparedReceipt, afterBoundary);
  await afterBoundary('receipt_written');
  const verifiedSidecars = verifyPersistedExecutionEvidence({
    receipt, outputPath, publicKeyPath, signerKeyId, checkoutRoot, now: now(),
  });
  const tombstone = tombstoneActiveCleanupPointer(ledger, {
    expectedPointerDigest: active.digest, expectedStateDigest: finalized.digest,
    operationRunId: plan.operationRunId, journalGenesisDigest: journal.genesisDigest,
    ...verifiedSidecars, transitionedAt: now().toISOString(),
  });
  await afterBoundary('pointer_tombstoned');
  return Object.freeze({
    receipt, receiptDigest: preparedReceipt.digest, receiptOutputPath: outputPath,
    approvalStateDigest: finalized.digest, pointerDigest: tombstone.digest,
    journalDigest: preparedTerminal.headDigest, state,
  });
}
