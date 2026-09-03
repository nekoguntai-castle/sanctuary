import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { canonicalSha256 } from './canonical-json.mjs';
import { publicKeyFingerprint } from './crypto.mjs';
import { deriveCleanupJournalPath, verifyCleanupJournal } from './cleanup-journal.mjs';
import { runCleanupCommand } from './cleanup-command.mjs';
import { resolveDockerDaemonContext } from './cleanup-execution-context.mjs';
import {
  providerCorrelationCore, revalidateForgejoProviderCorrelation,
  validateProviderCorrelationEvidence,
} from './operator-recovery-correlation.mjs';
import {
  signOperatorRecoveryArtifact, verifyOperatorRecoveryArtifact,
} from './operator-recovery-evidence.mjs';
import {
  acquireOperatorRecoveryLocks, acquireOperatorRecoveryRecoveryLocks,
  releaseOperatorRecoveryLocks,
} from './operator-recovery-locks.mjs';
import {
  buildOperatorRecoveryObservation, buildOperatorRecoverySurvivorObservation,
  observeOperatorRecoveryAction,
  verifyOperatorRecoveryClosed,
} from './operator-recovery-observer.mjs';
import { buildOperatorRecoveryActions, createOperatorRecoveryRuntime } from './operator-recovery-runtime.mjs';
import {
  buildOperatorRecoveryApproval, buildOperatorRecoveryAssertion,
  buildOperatorRecoveryScope, validateOperatorRecoveryApproval,
  validateOperatorRecoveryAssertion, validateOperatorRecoveryExecutionReceipt,
  validateOperatorRecoveryScope,
} from './operator-recovery-schema.mjs';
import { executeOperatorRecoverySession } from './operator-recovery-session.mjs';

export function operatorRecoverySurvivorProjection(journal, resources, actions) {
  if (!journal?.records || !Array.isArray(resources) || !Array.isArray(actions)) {
    throw new Error('operator recovery journal survivor projection is invalid');
  }
  const successful = journal.records
    .filter(({ checkpoint }) => checkpoint.checkpointType === 'result'
      && checkpoint.payload.failureClass === 'none'
      && ['cleaned', 'absent'].includes(checkpoint.payload.result)
      && ['satisfied', 'absent'].includes(checkpoint.payload.reconciliationState))
    .map(({ checkpoint }) => ({
      checkpoint, action: actions[checkpoint.payload.actionSequence - 1],
    }));
  if (successful.some(({ checkpoint, action }) => !action
      || action.resourceClass !== checkpoint.payload.resourceClass
      || action.immutableIdentity !== checkpoint.payload.immutableIdentity)) {
    throw new Error('operator recovery journal action projection is inconsistent');
  }
  const key = (value) => `${value.resourceClass}:${value.immutableIdentity}`;
  const removed = new Set(successful.filter(({ action, checkpoint }) => (
    action.action === 'remove' || checkpoint.payload.result === 'absent'
  ))
    .map(({ action }) => key(action)));
  const removedContainerIds = new Set(successful
    .filter(({ action, checkpoint }) => action.resourceClass === 'compose_container'
      && (action.action === 'remove' || checkpoint.payload.result === 'absent'))
    .map(({ action }) => action.immutableIdentity));
  const stoppedResourceKeys = successful.filter(({ action, checkpoint }) => (
    action.action === 'stop' && checkpoint.payload.result === 'cleaned'
  ))
    .map(({ action }) => key(action)).filter((entry) => !removed.has(entry));
  const lastIntent = journal.records.findLast(({ checkpoint }) => (
    checkpoint.checkpointType === 'intent'
  ));
  const resolved = lastIntent && journal.records.some(({ checkpoint }) => (
    checkpoint.checkpointType === 'result'
      && checkpoint.payload.intentCheckpointDigest === lastIntent.digest
  ));
  const allowedResources = resources.filter((entry) => !removed.has(key(entry))).map((entry) => ({
    ...entry,
    dependencyIdentities: entry.dependencyIdentities.filter((identity) => (
      !removedContainerIds.has(identity)
    )),
  }));
  const dependencyChangedResourceKeys = allowedResources.filter((entry) => (
    entry.dependencyIdentities.length !== resources.find((resource) => key(resource) === key(entry))
      .dependencyIdentities.length
  )).map(key);
  return Object.freeze({
    allowedResources,
    optionalResourceKey: lastIntent && !resolved ? key(lastIntent.checkpoint.payload) : null,
    relaxedResourceKeys: [
      ...stoppedResourceKeys,
      ...dependencyChangedResourceKeys,
      ...(lastIntent && !resolved && lastIntent.checkpoint.payload.action === 'stop'
        ? [key(lastIntent.checkpoint.payload)] : []),
    ],
    stoppedResourceKeys,
  });
}

function approvalWindow(now, ttlMs) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 15 * 60_000) {
    throw new TypeError('operator recovery TTL must be between one second and fifteen minutes');
  }
  return { issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlMs).toISOString() };
}

function validateDryRun(value) {
  const keys = [
    'artifactType', 'schemaVersion', 'scopeDigest', 'planDigest', 'actionsDigest',
    'state', 'createdAt', 'signerKeyId',
  ];
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('\0') !== keys.sort().join('\0')
      || value.artifactType !== 'operator_recovery_dry_run' || value.schemaVersion !== '1.0.0'
      || value.state !== 'dry_run'
      || ![value.scopeDigest, value.planDigest, value.actionsDigest, value.signerKeyId]
        .every((entry) => /^[a-f0-9]{64}$/.test(entry))) {
    throw new Error('operator recovery dry-run receipt is invalid');
  }
  return value;
}

function sign(artifact, keys, acceptedFingerprint, validate) {
  return signOperatorRecoveryArtifact(artifact, {
    privateKey: keys.privateKey, publicKey: keys.publicKey,
    expectedFingerprint: acceptedFingerprint, validate,
  });
}

function authorizationSigner(trust, authorizationKeys) {
  const fingerprint = publicKeyFingerprint(authorizationKeys.publicKey);
  if (!trust.authorizationFingerprints.includes(fingerprint)) {
    throw new Error('operator recovery authorization key is not trusted');
  }
  return fingerprint;
}

function evidenceSigner(trust, evidenceKeys) {
  const fingerprint = publicKeyFingerprint(evidenceKeys.publicKey);
  if (!trust.evidenceFingerprints.includes(fingerprint)) {
    throw new Error('operator recovery evidence key is not trusted');
  }
  return fingerprint;
}

async function resolvePreparationCorrelation(correlationEvidence, observeCorrelation) {
  const hasEvidence = correlationEvidence !== undefined;
  const hasObserver = observeCorrelation !== undefined;
  if (hasEvidence === hasObserver || (hasObserver && typeof observeCorrelation !== 'function')) {
    throw new TypeError('operator recovery preparation requires exactly one correlation source');
  }
  return hasObserver ? observeCorrelation() : correlationEvidence;
}

/** Create signed, nonmutating authority and approval artifacts for one exact stack. */
export async function prepareOperatorRecoverySession({
  trust, target, expectedCounts, policyDigest, sourceCommit, sourceExecutionId,
  correlationEvidence, observeCorrelation, authorizationKeys, evidenceKeys,
  observe, observationOptions = {}, operationRunId = `operator-${randomUUID()}`,
  now = () => new Date(), ttlMs = 5 * 60_000,
} = {}) {
  const authorizationKeyId = authorizationSigner(trust, authorizationKeys);
  const evidenceKeyId = evidenceSigner(trust, evidenceKeys);
  const observed = await buildOperatorRecoveryObservation({
    target, expectedCounts, observe, observationOptions,
  });
  const resolvedCorrelation = await resolvePreparationCorrelation(
    correlationEvidence, observeCorrelation,
  );
  const instant = now();
  validateProviderCorrelationEvidence(resolvedCorrelation, { now: instant });
  const window = approvalWindow(instant, ttlMs);
  const correlationEnvelope = sign(
    resolvedCorrelation, authorizationKeys, authorizationKeyId,
    (value) => validateProviderCorrelationEvidence(value, { now: instant }),
  );
  const assertion = buildOperatorRecoveryAssertion({
    trust, assertionId: `assertion-${randomUUID()}`, ...target,
    sourceCommit, sourceExecutionId, sourceState: 'terminal',
    historicalTerminalityAuthority: 'operator_assertion_only',
    ...window, trustDigest: canonicalSha256(trust),
    providerCorrelationEvidenceDigest: correlationEnvelope.artifactDigest,
    queryResultCoreDigest: resolvedCorrelation.queryResultCoreDigest,
    signerKeyId: authorizationKeyId,
  });
  const assertionEnvelope = sign(
    assertion, authorizationKeys, authorizationKeyId,
    (value) => validateOperatorRecoveryAssertion(value, { trust, now: instant }),
  );
  const scope = buildOperatorRecoveryScope({
    trust, assertion, scopeId: `scope-${randomUUID()}`, ...target, operationRunId,
    observedAt: window.issuedAt, expiresAt: window.expiresAt,
    trustDigest: canonicalSha256(trust), policyDigest,
    daemonContextFingerprint: observed.daemonContextFingerprint,
    operatorAssertionDigest: assertionEnvelope.artifactDigest,
    providerCorrelationEvidenceDigest: correlationEnvelope.artifactDigest,
    queryResultCoreDigest: resolvedCorrelation.queryResultCoreDigest,
    resources: observed.resources, signerKeyId: authorizationKeyId,
  });
  const scopeEnvelope = sign(
    scope, authorizationKeys, authorizationKeyId,
    (value) => validateOperatorRecoveryScope(value, { trust, assertion, now: instant }),
  );
  const actions = buildOperatorRecoveryActions(scope);
  const planDigest = canonicalSha256(actions);
  const dryRun = validateDryRun({
    schemaVersion: '1.0.0', artifactType: 'operator_recovery_dry_run',
    scopeDigest: scopeEnvelope.artifactDigest, planDigest,
    actionsDigest: planDigest, state: 'dry_run', createdAt: window.issuedAt,
    signerKeyId: evidenceKeyId,
  });
  const dryRunEnvelope = sign(dryRun, evidenceKeys, evidenceKeyId, validateDryRun);
  const approval = buildOperatorRecoveryApproval({
    scope, trust, scopeDigest: scopeEnvelope.artifactDigest,
    trustDigest: scope.trustDigest, deploymentId: scope.deploymentId,
    operationRunId: scope.operationRunId, ...window,
    nonce: `approval-${randomUUID()}`, planDigest,
    dryRunReceiptDigest: dryRunEnvelope.artifactDigest,
    contextFingerprint: canonicalSha256({
      authorityKind: scope.authorityKind, daemonContextFingerprint: scope.daemonContextFingerprint,
      queryResultCoreDigest: scope.queryResultCoreDigest, trustDigest: scope.trustDigest,
    }),
    actions, signerKeyId: authorizationKeyId,
  });
  const approvalEnvelope = sign(
    approval, authorizationKeys, authorizationKeyId,
    (value) => validateOperatorRecoveryApproval(value, { scope, trust, now: instant }),
  );
  return Object.freeze({
    correlationEnvelope, assertionEnvelope, scopeEnvelope, dryRunEnvelope, approvalEnvelope,
  });
}

function verifiedArtifacts(prepared, trust, authorizationKeys, evidenceKeys, now, recover) {
  const auth = { publicKey: authorizationKeys.publicKey, acceptedFingerprints: trust.authorizationFingerprints };
  const evidence = { publicKey: evidenceKeys.publicKey, acceptedFingerprints: trust.evidenceFingerprints };
  const correlation = verifyOperatorRecoveryArtifact(prepared.correlationEnvelope, {
    ...auth, validate: (value) => validateProviderCorrelationEvidence(value, recover ? {} : { now }),
  });
  const assertion = verifyOperatorRecoveryArtifact(prepared.assertionEnvelope, {
    ...auth, validate: (value) => validateOperatorRecoveryAssertion(value, recover ? { trust } : { trust, now }),
  });
  const scope = verifyOperatorRecoveryArtifact(prepared.scopeEnvelope, {
    ...auth, validate: (value) => validateOperatorRecoveryScope(value, recover ? { trust, assertion } : { trust, assertion, now }),
  });
  const dryRun = verifyOperatorRecoveryArtifact(prepared.dryRunEnvelope, {
    ...evidence, validate: validateDryRun,
  });
  const approval = verifyOperatorRecoveryArtifact(prepared.approvalEnvelope, {
    ...auth, validate: (value) => validateOperatorRecoveryApproval(value, recover ? { scope, trust } : { scope, trust, now }),
  });
  if (prepared.dryRunEnvelope.artifactDigest !== approval.dryRunReceiptDigest
      || dryRun.scopeDigest !== prepared.scopeEnvelope.artifactDigest
      || dryRun.planDigest !== approval.planDigest
      || dryRun.actionsDigest !== canonicalSha256(approval.actions)) {
    throw new Error('operator recovery dry-run does not bind the approved scope and actions');
  }
  return { correlation, assertion, scope, approval };
}

/** Revalidate provider correlation under locks, execute exact actions, and sign the receipt. */
export async function executePreparedOperatorRecovery({
  prepared, trust, authorizationKeys, evidenceKeys,
  correlationOptions, observe, observationOptions = {}, supervisor,
  supervisorOptions, sessionOptions = {}, runtimeDirectory, recover = false,
  resolveDaemonAuthority = (options) => resolveDockerDaemonContext(options),
  now = () => new Date(),
} = {}) {
  const instant = now();
  let values = verifiedArtifacts(prepared, trust, authorizationKeys, evidenceKeys, instant, recover);
  const approvalDigest = canonicalSha256(values.approval);
  const journalPath = deriveCleanupJournalPath({ runtimeDirectory, approvalDigest });
  const journalRecovery = recover && existsSync(journalPath);
  if (recover && !journalRecovery) {
    values = verifiedArtifacts(prepared, trust, authorizationKeys, evidenceKeys, instant, false);
  }
  const controllerRunId = recover ? `operator-recovery-${randomUUID()}` : values.scope.operationRunId;
  const acquired = recover
    ? acquireOperatorRecoveryRecoveryLocks({
      runtimeDirectory, deploymentId: values.scope.deploymentId,
      composeProjectName: values.scope.project,
      originalOperationRunId: values.scope.operationRunId, controllerRunId, journalPath,
    })
    : { held: acquireOperatorRecoveryLocks({
      runtimeDirectory, deploymentId: values.scope.deploymentId,
      composeProjectName: values.scope.project,
      operationRunId: values.scope.operationRunId, journalPath,
    }) };
  const { held } = acquired;
  try {
    if (recover && !journalRecovery
        && acquired.observations.project.state === 'absent'
        && acquired.observations.deployment.state === 'absent') {
      throw new Error('operator recovery journal is missing and no stale execution lock exists');
    }
    const freshCorrelation = await revalidateForgejoProviderCorrelation(
      values.correlation, { ...correlationOptions, now, allowExpiredPrior: journalRecovery },
    );
    if (canonicalSha256(providerCorrelationCore(freshCorrelation)) !== values.scope.queryResultCoreDigest) {
      throw new Error('operator recovery provider correlation core changed');
    }
    const authorizationKeyId = authorizationSigner(trust, authorizationKeys);
    const freshCorrelationEnvelope = sign(
      freshCorrelation, authorizationKeys, authorizationKeyId,
      (value) => validateProviderCorrelationEvidence(value, { now: now() }),
    );
    const actions = values.approval.actions;
    const target = {
      project: values.scope.project, deploymentId: values.scope.deploymentId,
      ownerId: values.scope.ownerId,
    };
    const runCommand = observationOptions.runCommand
      ?? ((executable, args, options) => runCleanupCommand(executable, args, options));
    const daemonAuthority = resolveDaemonAuthority({ engine: 'docker', runCommand });
    if (daemonAuthority.fingerprint !== values.scope.daemonContextFingerprint) {
      throw new Error('operator recovery Docker daemon authority changed');
    }
    const pinnedObservationOptions = { ...observationOptions, daemonAuthority, runCommand };
    if (!journalRecovery) {
      const volumeNonces = [...new Set(values.scope.resources
        .filter((entry) => entry.resourceClass === 'compose_volume')
        .map((entry) => entry.attestationNonce))];
      if (volumeNonces.length > 1) throw new Error('operator recovery scope has inconsistent volume attestations');
      const lockedObservation = await buildOperatorRecoveryObservation({
        target, expectedCounts: Object.fromEntries(
          ['compose_container', 'compose_network', 'compose_volume'].map((resourceClass) => [
            resourceClass, values.scope.resources
              .filter((entry) => entry.resourceClass === resourceClass).length,
          ]),
        ),
        observe, observationOptions: pinnedObservationOptions,
        ...(volumeNonces[0] ? { attestationNonce: volumeNonces[0] } : {}),
      });
      if (lockedObservation.daemonContextFingerprint !== values.scope.daemonContextFingerprint
          || canonicalSha256(lockedObservation.resources) !== canonicalSha256(values.scope.resources)) {
        throw new Error('operator recovery target changed after approval');
      }
    } else {
      const journal = verifyCleanupJournal({
        runtimeDirectory, approvalDigest, publicKey: evidenceKeys.publicKey,
        expectedSignerKeyId: publicKeyFingerprint(evidenceKeys.publicKey),
      });
      const projection = operatorRecoverySurvivorProjection(
        journal, values.scope.resources, values.approval.actions,
      );
      const lockedObservation = await buildOperatorRecoverySurvivorObservation({
        target, ...projection, observe, observationOptions: pinnedObservationOptions,
      });
      if (lockedObservation.daemonContextFingerprint !== values.scope.daemonContextFingerprint) {
        throw new Error('operator recovery Docker daemon authority changed during recovery');
      }
    }
    const observeAction = ({ action }) => {
      const scopeResource = values.scope.resources.find((entry) => (
        entry.resourceClass === action.resourceClass && entry.locator === action.locator
      ));
      return observeOperatorRecoveryAction({
        action, target, scopeResource,
        daemonContextFingerprint: values.scope.daemonContextFingerprint,
        observe, observationOptions: pinnedObservationOptions,
      });
    };
    const runtime = createOperatorRecoveryRuntime({
      scope: values.scope, actions, observeAction,
      engineGlobalArgs: daemonAuthority.engineGlobalArgs,
      supervisor, supervisorOptions,
    });
    const executed = await executeOperatorRecoverySession({
      runtimeDirectory, trust, assertion: values.assertion, scope: values.scope,
      approval: values.approval, evidencePrivateKey: evidenceKeys.privateKey,
      evidencePublicKey: evidenceKeys.publicKey, runtime, recover: journalRecovery, now,
      controllerRunId,
      revalidatedProviderCorrelationEvidenceDigest: freshCorrelationEnvelope.artifactDigest,
      buildFinalObservation: () => verifyOperatorRecoveryClosed({
        target, daemonContextFingerprint: values.scope.daemonContextFingerprint,
        observe, observationOptions: pinnedObservationOptions,
      }),
      ...(recover ? { lockObservationDigests: {
        project: acquired.observations.projectDigest,
        deployment: acquired.observations.deploymentDigest,
      } } : {}),
      ...(typeof sessionOptions.afterCheckpoint === 'function'
        ? { afterCheckpoint: sessionOptions.afterCheckpoint } : {}),
    });
    const evidenceKeyId = evidenceSigner(trust, evidenceKeys);
    const receiptEnvelope = sign(
      executed.receipt, evidenceKeys, evidenceKeyId,
      (value) => validateOperatorRecoveryExecutionReceipt(value, {
        scope: values.scope, approval: values.approval, trust, now: now(),
      }),
    );
    return Object.freeze({ ...executed, freshCorrelationEnvelope, receiptEnvelope });
  } finally { releaseOperatorRecoveryLocks(held); }
}
