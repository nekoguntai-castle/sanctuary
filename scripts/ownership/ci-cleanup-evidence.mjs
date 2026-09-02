import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, canonicalSha256, parseStrictJson } from './canonical-json.mjs';
import {
  readCoordinatorState, transitionCoordinatorState,
} from './ci-cleanup-state.mjs';
import { writeSignedArtifact, verifySignedArtifact } from './cleanup-evidence.mjs';
import { deriveCleanupJournalPath } from './cleanup-journal.mjs';
import {
  acquireCleanupRecoveryLocks, releaseCleanupLocks,
} from './cleanup-lock-controller.mjs';
import { buildCleanupUploadReceipt } from './cleanup-upload-receipt.mjs';
import { DeploymentStore } from './deployment-store.mjs';
import { assertUploadSafe } from './privacy.mjs';
import { readExternalFile, writeExternalFileAtomic } from './safe-file.mjs';
import { liveNodeExecutable } from './runtime-executable.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLEANUP_CLI = path.join(MODULE_DIR, 'cleanup-cli.mjs');

function ensurePrivateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const resolved = path.resolve(directory);
  const info = lstatSync(resolved);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(resolved) !== resolved
      || (typeof process.getuid === 'function' && info.uid !== process.getuid())
      || (info.mode & 0o077) !== 0) {
    throw new Error(`cleanup evidence directory must be owner-only and non-symlink: ${resolved}`);
  }
  return resolved;
}

function writeExact(filePath, bytes, checkoutRoot) {
  if (existsSync(filePath)) {
    if (!readExternalFile(filePath, { checkoutRoot }).equals(bytes)) {
      throw new Error(`cleanup evidence output collision: ${filePath}`);
    }
    return;
  }
  writeExternalFileAtomic(filePath, bytes, { checkoutRoot });
}

function writeRequest(filePath, request, checkoutRoot) {
  writeExact(filePath, canonicalJson(request), checkoutRoot);
  return filePath;
}

export function assertCleanupInvocationResult(result, command, acceptedStatuses = [0]) {
  if (result.error) {
    throw Object.assign(new Error(
      `cleanup ${command} could not execute: ${result.error.message}`,
    ), { cause: result.error, exitCode: result.status ?? 2 });
  }
  if (!acceptedStatuses.includes(result.status)) {
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    throw Object.assign(new Error(
      `cleanup ${command} failed (${result.status}): ${stderr}`,
    ), { exitCode: result.status });
  }
  return result;
}

function invoke(command, requestPath, acceptedStatuses = [0]) {
  const result = spawnSync(liveNodeExecutable(), [CLEANUP_CLI, command, requestPath], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024,
  });
  return assertCleanupInvocationResult(result, command, acceptedStatuses);
}

function invocationOutput(result) {
  if (!result.stdout.trim()) return null;
  return parseStrictJson(Buffer.from(result.stdout, 'utf8'));
}

function keyPaths(authority) {
  const root = path.join(authority.runtimeDirectory, 'coordinator', 'keys');
  return {
    evidencePrivate: path.join(root, 'evidence', 'private.pem'),
    evidencePublic: path.join(root, 'evidence', 'public.pem'),
    authorizationPrivate: path.join(root, 'authorization', 'private.pem'),
    authorizationPublic: path.join(root, 'authorization', 'public.pem'),
  };
}

function verifyPrivateReceipt(receiptPath, state, keys) {
  const requestPath = path.join(path.dirname(receiptPath), 'verify-planning-request.json');
  writeRequest(requestPath, {
    checkoutRoot: state.authority.checkoutRoot, inputPath: receiptPath,
    publicKeyPath: keys.evidencePublic,
    expectedFingerprint: state.evidenceFingerprint,
  }, state.authority.checkoutRoot);
  invoke('verify', requestPath);
  return verifySignedArtifact({
    inputPath: receiptPath, publicKeyPath: keys.evidencePublic,
    expectedFingerprint: state.evidenceFingerprint,
    checkoutRoot: state.authority.checkoutRoot,
  }).artifact;
}

function writeUploadProjection({ privateReceipt, outputPath, state, keys }) {
  const projection = buildCleanupUploadReceipt(privateReceipt);
  const signed = writeSignedArtifact(projection, {
    outputPath, privateKeyPath: keys.evidencePrivate,
    publicKeyPath: keys.evidencePublic,
    expectedFingerprint: state.evidenceFingerprint,
    checkoutRoot: state.authority.checkoutRoot,
  });
  const verified = verifySignedArtifact({
    inputPath: signed.outputPath, signaturePath: signed.signaturePath,
    checksumPath: signed.checksumPath, publicKeyPath: keys.evidencePublic,
    expectedFingerprint: state.evidenceFingerprint,
    checkoutRoot: state.authority.checkoutRoot,
  });
  assertUploadSafe(verified.artifact);
  return signed;
}

export function planCiCleanupEvidence({
  statePath, checkoutRoot, artifactDirectory, engine = 'docker',
}) {
  let current = readCoordinatorState(statePath, { checkoutRoot });
  if (current.state.phase !== 'deployment_retired') {
    throw new Error('cleanup evidence planning requires a retired deployment');
  }
  const state = current.state;
  const authority = state.authority;
  const privateDirectory = ensurePrivateDirectory(
    path.join(authority.runtimeDirectory, 'coordinator', 'private-evidence'),
  );
  const uploadDirectory = ensurePrivateDirectory(artifactDirectory);
  const requestDirectory = ensurePrivateDirectory(path.join(privateDirectory, 'requests'));
  const keys = keyPaths(authority);
  const inventoryPath = path.join(privateDirectory, 'inventory.json');
  const planPath = path.join(privateDirectory, 'plan.json');
  const planningReceiptPath = path.join(privateDirectory, 'planning-receipt.json');
  const ownershipContractPath = path.join(checkoutRoot, 'config/resource-ownership-contract.json');
  const forcedAmbiguity = state.cleanupSuppression === null ? {} : {
    forcedAmbiguity: {
      adapter: 'subject-supervision', resourceClass: null, failureClass: 'query_failed',
      scope: canonicalSha256({ cleanupSuppression: state.cleanupSuppression }).slice(0, 32),
    },
  };
  const inventoryRequest = writeRequest(path.join(requestDirectory, 'inventory.json'), {
    checkoutRoot, ownershipContractPath,
    deploymentManifestPath: state.deploymentManifestPath,
    runManifestPath: state.runManifestPath, outputPath: inventoryPath,
    deploymentId: authority.deploymentId, runtimeDirectory: authority.runtimeDirectory,
    engine, legacyFixtureWitnessDigest: state.legacyFixtureWitnessDigest, ...forcedAmbiguity,
  }, checkoutRoot);
  if (!existsSync(inventoryPath)) invoke('inventory', inventoryRequest, [0, 4]);
  const planRequestPath = path.join(requestDirectory, 'plan.json');
  const receiptFinalizedAt = existsSync(planRequestPath)
    ? parseStrictJson(readExternalFile(planRequestPath, { checkoutRoot })).receiptFinalizedAt
    : new Date().toISOString();
  const planRequest = writeRequest(planRequestPath, {
    checkoutRoot, ownershipContractPath, inventoryPath, planOutputPath: planPath,
    receiptOutputPath: planningReceiptPath,
    evidencePrivateKeyPath: keys.evidencePrivate,
    evidencePublicKeyPath: keys.evidencePublic,
    expectedEvidenceFingerprint: state.evidenceFingerprint,
    receiptFinalizedAt,
  }, checkoutRoot);
  if (!existsSync(planningReceiptPath)
      || !existsSync(`${planningReceiptPath}.sig`)
      || !existsSync(`${planningReceiptPath.slice(0, -5)}.sha256`)) {
    invoke('plan', planRequest, [0, 4]);
  }
  const privateReceipt = verifyPrivateReceipt(planningReceiptPath, state, keys);
  writeUploadProjection({
    privateReceipt, outputPath: path.join(uploadDirectory, 'planning-upload.json'),
    state, keys,
  });
  writeExact(
    path.join(uploadDirectory, 'evidence-public.pem'),
    readExternalFile(keys.evidencePublic, { checkoutRoot, maxBytes: 64 * 1024 }), checkoutRoot,
  );
  writeExact(
    path.join(uploadDirectory, 'authorization-public.pem'),
    readExternalFile(keys.authorizationPublic, { checkoutRoot, maxBytes: 64 * 1024 }), checkoutRoot,
  );
  current = transitionCoordinatorState({
    statePath, checkoutRoot, expectedDigest: current.digest, nextPhase: 'planned',
    updates: { planningReceiptPath },
  });
  if (privateReceipt.state !== 'dry_run') {
    writeUploadProjection({
      privateReceipt, outputPath: path.join(uploadDirectory, 'final-upload.json'),
      state, keys,
    });
    current = transitionCoordinatorState({
      statePath, checkoutRoot, expectedDigest: current.digest, nextPhase: 'projected',
    });
  }
  return Object.freeze({
    ...current, privateReceipt, inventoryPath, planPath, planningReceiptPath,
    uploadDirectory, keys,
  });
}

function abandonPreReservationAttempt(current, { statePath, checkoutRoot }) {
  return transitionCoordinatorState({
    statePath, checkoutRoot, expectedDigest: current.digest, nextPhase: 'planned',
    updates: {
      authorizationRequestPath: null, approvalPath: null, approvalDigest: null,
      executionRequestPath: null, recoveryControllerRunId: null, executionReceiptPath: null,
    },
  });
}

function authorizeExecution(current, { statePath, checkoutRoot, requestDirectory, keys, now }) {
  const attempt = current.state.executionAttempt + 1;
  if (attempt > 3) throw new Error('cleanup execution exceeded pre-reservation retry limit');
  const attemptDirectory = ensurePrivateDirectory(
    path.join(requestDirectory, `execution-${String(attempt).padStart(2, '0')}`),
  );
  const approvalPath = path.join(attemptDirectory, 'approval.json');
  const requestPath = path.join(attemptDirectory, 'authorize.json');
  let timing;
  if (existsSync(requestPath)) {
    const saved = parseStrictJson(readExternalFile(requestPath, { checkoutRoot }));
    const savedExpiration = new Date(saved.expiresAt);
    if (Number.isNaN(savedExpiration.getTime())) {
      throw new Error('persisted cleanup authorization expiration is invalid');
    }
    if (savedExpiration <= now) {
      const advanced = transitionCoordinatorState({
        statePath, checkoutRoot, expectedDigest: current.digest, nextPhase: 'planned',
        updates: { executionAttempt: attempt },
      });
      return authorizeExecution(advanced, {
        statePath, checkoutRoot, requestDirectory, keys, now,
      });
    }
    timing = { issuedAt: saved.issuedAt, expiresAt: saved.expiresAt, nonce: saved.nonce };
  } else {
    timing = {
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
      nonce: randomUUID(),
    };
  }
  const state = current.state;
  writeRequest(requestPath, {
    checkoutRoot, planPath: path.join(path.dirname(requestDirectory), 'plan.json'),
    dryRunReceiptPath: state.planningReceiptPath,
    evidencePublicKeyPath: keys.evidencePublic,
    expectedEvidenceFingerprint: state.evidenceFingerprint,
    approvalOutputPath: approvalPath,
    authorizationPrivateKeyPath: keys.authorizationPrivate,
    authorizationPublicKeyPath: keys.authorizationPublic,
    expectedAuthorizationFingerprint: state.authorizationFingerprint,
    ...timing, decommission: true,
  }, checkoutRoot);
  invoke('authorize', requestPath);
  const approval = verifySignedArtifact({
    inputPath: approvalPath, publicKeyPath: keys.authorizationPublic,
    expectedFingerprint: state.authorizationFingerprint, checkoutRoot, now,
  }).artifact;
  return transitionCoordinatorState({
    statePath, checkoutRoot, expectedDigest: current.digest, nextPhase: 'authorized',
    updates: {
      executionAttempt: attempt, authorizationRequestPath: requestPath,
      approvalPath, approvalDigest: canonicalSha256(approval),
    },
  });
}

function beginExecution(current, {
  statePath, checkoutRoot, engine, keys, inventoryPath, planPath, cancellationPath,
}) {
  const state = current.state;
  const authority = state.authority;
  const approval = verifySignedArtifact({
    inputPath: state.approvalPath, publicKeyPath: keys.authorizationPublic,
    expectedFingerprint: state.authorizationFingerprint, checkoutRoot,
  }).artifact;
  const approvalDigest = canonicalSha256(approval);
  if (approvalDigest !== state.approvalDigest) {
    throw new Error('cleanup coordinator approval digest mismatch');
  }
  const executionReceiptPath = path.join(
    authority.runtimeDirectory, 'ownership', 'cleanup-executions',
    approvalDigest, 'cleanup-receipt.json',
  );
  const executionRequestPath = path.join(
    path.dirname(state.authorizationRequestPath), 'apply.json',
  );
  writeRequest(executionRequestPath, {
    checkoutRoot, runtimeDirectory: authority.runtimeDirectory,
    deploymentId: authority.deploymentId,
    ownershipContractPath: path.join(checkoutRoot, 'config/resource-ownership-contract.json'),
    deploymentManifestPath: state.deploymentManifestPath,
    runManifestPath: state.runManifestPath, inventoryPath, planPath,
    dryRunReceiptPath: state.planningReceiptPath, approvalPath: state.approvalPath,
    evidencePrivateKeyPath: keys.evidencePrivate,
    evidencePublicKeyPath: keys.evidencePublic,
    expectedEvidenceFingerprint: state.evidenceFingerprint,
    authorizationPublicKeyPath: keys.authorizationPublic,
    expectedAuthorizationFingerprint: state.authorizationFingerprint,
    receiptOutputPath: executionReceiptPath, engine,
    subjectExitStatus: state.subjectExitStatus,
    cleanupAuthorityIdentityDigest: authority.identityDigest,
    legacyFixtureWitnessDigest: state.legacyFixtureWitnessDigest,
    ...(cancellationPath ? { cancellationSignalPath: cancellationPath } : {}),
  }, checkoutRoot);
  return transitionCoordinatorState({
    statePath, checkoutRoot, expectedDigest: current.digest, nextPhase: 'executing',
    updates: {
      executionRequestPath, recoveryControllerRunId: `recover-${randomUUID()}`,
      executionReceiptPath,
    },
  });
}

function invokeDurableExecution(current, { checkoutRoot }) {
  const state = current.state;
  const executionRoot = path.dirname(state.executionReceiptPath);
  if (!existsSync(executionRoot)) {
    recoverPreReservationLocks(state);
    return invoke('apply', state.executionRequestPath, [0, 4, 5]);
  }
  if (!existsSync(path.join(executionRoot, 'approval-state-current.json'))
      || !existsSync(path.join(executionRoot, 'action-journal.jsonl'))) {
    recoverPreReservationLocks(state);
    return null;
  }
  const recoveryRequestPath = path.join(path.dirname(state.executionRequestPath), 'recover.json');
  writeRequest(recoveryRequestPath, {
    ...parseStrictJson(readExternalFile(state.executionRequestPath, { checkoutRoot })),
    controllerRunId: state.recoveryControllerRunId,
  }, checkoutRoot);
  return invoke('recover', recoveryRequestPath, [0, 4, 5]);
}

function recoverPreReservationLocks(state) {
  const authority = state.authority;
  const store = new DeploymentStore({
    runtimeDirectory: authority.runtimeDirectory, deploymentId: authority.deploymentId,
  });
  const held = acquireCleanupRecoveryLocks({
    runtimeDirectory: authority.runtimeDirectory, deploymentId: authority.deploymentId,
    deploymentLockPath: store.lockPath, composeProjectName: authority.composeProjectName,
    originalOperationRunId: authority.operationRunId,
    controllerRunId: state.recoveryControllerRunId,
    journalPath: deriveCleanupJournalPath({
      runtimeDirectory: authority.runtimeDirectory, approvalDigest: state.approvalDigest,
    }),
    generation: state.generation,
  });
  releaseCleanupLocks(held.held);
}

export function executeCiCleanupEvidence({
  statePath, checkoutRoot, artifactDirectory, engine = 'docker', now = new Date(),
  cancellationPath = null,
}) {
  let current = readCoordinatorState(statePath, { checkoutRoot });
  if (!['planned', 'authorized', 'executing'].includes(current.state.phase)) {
    throw new Error('cleanup execution requires an actionable signed plan or durable execution intent');
  }
  const authority = current.state.authority;
  const privateDirectory = ensurePrivateDirectory(
    path.join(authority.runtimeDirectory, 'coordinator', 'private-evidence'),
  );
  const uploadDirectory = ensurePrivateDirectory(artifactDirectory);
  const requestDirectory = ensurePrivateDirectory(path.join(privateDirectory, 'requests'));
  const keys = keyPaths(authority);
  const planPath = path.join(privateDirectory, 'plan.json');
  const inventoryPath = path.join(privateDirectory, 'inventory.json');
  if (current.state.phase === 'planned') {
    current = authorizeExecution(current, {
      statePath, checkoutRoot, requestDirectory, keys, now,
    });
  }
  if (current.state.phase === 'authorized') {
    current = beginExecution(current, {
      statePath, checkoutRoot, engine, keys, inventoryPath, planPath, cancellationPath,
    });
  }
  const execution = invokeDurableExecution(current, { checkoutRoot });
  if (!execution || invocationOutput(execution)?.state === 'cleared_pre_reservation') {
    current = abandonPreReservationAttempt(current, { statePath, checkoutRoot });
    return executeCiCleanupEvidence({
      statePath, checkoutRoot, artifactDirectory, engine, now, cancellationPath,
    });
  }
  const verifyRequest = writeRequest(
    path.join(path.dirname(current.state.executionRequestPath), 'verify-execution.json'),
    {
      checkoutRoot, inputPath: current.state.executionReceiptPath,
      publicKeyPath: keys.evidencePublic,
      expectedFingerprint: current.state.evidenceFingerprint,
    }, checkoutRoot,
  );
  invoke('verify', verifyRequest);
  const privateReceipt = verifySignedArtifact({
    inputPath: current.state.executionReceiptPath, publicKeyPath: keys.evidencePublic,
    expectedFingerprint: current.state.evidenceFingerprint, checkoutRoot,
  }).artifact;
  current = transitionCoordinatorState({
    statePath, checkoutRoot, expectedDigest: current.digest, nextPhase: 'executed',
  });
  writeUploadProjection({
    privateReceipt, outputPath: path.join(uploadDirectory, 'final-upload.json'),
    state: current.state, keys,
  });
  current = transitionCoordinatorState({
    statePath, checkoutRoot, expectedDigest: current.digest, nextPhase: 'projected',
  });
  return Object.freeze({ ...current, privateReceipt, uploadDirectory });
}

export function resumeCiCleanupEvidence({
  statePath, checkoutRoot, artifactDirectory, engine = 'docker', cancellationPath = null,
}) {
  let current = readCoordinatorState(statePath, { checkoutRoot });
  if (current.state.phase === 'deployment_retired') {
    const planned = planCiCleanupEvidence({
      statePath, checkoutRoot, artifactDirectory, engine,
    });
    if (planned.privateReceipt.state !== 'dry_run') return planned;
    current = planned;
  }
  if (['planned', 'authorized', 'executing'].includes(current.state.phase)) {
    const keys = keyPaths(current.state.authority);
    const privateReceipt = verifyPrivateReceipt(
      current.state.planningReceiptPath, current.state, keys,
    );
    if (privateReceipt.state === 'dry_run') {
      return executeCiCleanupEvidence({
        statePath, checkoutRoot, artifactDirectory, engine, cancellationPath,
      });
    }
    const uploadDirectory = ensurePrivateDirectory(artifactDirectory);
    writeUploadProjection({
      privateReceipt, outputPath: path.join(uploadDirectory, 'final-upload.json'),
      state: current.state, keys,
    });
    current = transitionCoordinatorState({
      statePath, checkoutRoot, expectedDigest: current.digest, nextPhase: 'projected',
    });
    return Object.freeze({ ...current, privateReceipt, uploadDirectory });
  }
  if (current.state.phase === 'executed') {
    const keys = keyPaths(current.state.authority);
    const privateReceipt = verifySignedArtifact({
      inputPath: current.state.executionReceiptPath, publicKeyPath: keys.evidencePublic,
      expectedFingerprint: current.state.evidenceFingerprint, checkoutRoot,
    }).artifact;
    const uploadDirectory = ensurePrivateDirectory(artifactDirectory);
    writeUploadProjection({
      privateReceipt, outputPath: path.join(uploadDirectory, 'final-upload.json'),
      state: current.state, keys,
    });
    current = transitionCoordinatorState({
      statePath, checkoutRoot, expectedDigest: current.digest, nextPhase: 'projected',
    });
    return Object.freeze({ ...current, privateReceipt, uploadDirectory });
  }
  if (current.state.phase !== 'projected') {
    throw new Error(`cleanup evidence cannot resume from phase ${current.state.phase}`);
  }
  const keys = keyPaths(current.state.authority);
  const final = verifySignedArtifact({
    inputPath: path.join(artifactDirectory, 'final-upload.json'),
    publicKeyPath: keys.evidencePublic,
    expectedFingerprint: current.state.evidenceFingerprint, checkoutRoot,
  });
  assertUploadSafe(final.artifact);
  return Object.freeze({
    ...current, privateReceipt: final.artifact,
    uploadDirectory: path.resolve(artifactDirectory),
  });
}
