import {
  existsSync, lstatSync, mkdirSync, realpathSync,
} from 'node:fs';
import path from 'node:path';
import { canonicalJson, parseStrictJson } from './canonical-json.mjs';
import { readCoordinatorState, transitionCoordinatorState } from './ci-cleanup-state.mjs';
import { writeSignedArtifact, verifySignedArtifact } from './cleanup-evidence.mjs';
import { buildCleanupUploadReceipt } from './cleanup-upload-receipt.mjs';
import { readExternalFile, writeExternalFileAtomic } from './safe-file.mjs';

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

function keyPaths(authority) {
  const root = path.join(authority.runtimeDirectory, 'coordinator', 'keys');
  return {
    evidencePrivate: path.join(root, 'evidence', 'private.pem'),
    evidencePublic: path.join(root, 'evidence', 'public.pem'),
    authorizationPublic: path.join(root, 'authorization', 'public.pem'),
  };
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

function signedOptions(outputPath, state, keys) {
  return {
    outputPath, privateKeyPath: keys.evidencePrivate,
    publicKeyPath: keys.evidencePublic,
    expectedFingerprint: state.evidenceFingerprint,
    checkoutRoot: state.authority.checkoutRoot,
  };
}

function buildReceipt(state, subjectExitStatus, cleanupSuppression, now) {
  const finalizedAt = now.toISOString();
  const ambiguous = cleanupSuppression !== null;
  return {
    schemaVersion: '1.3.0', artifactType: 'cleanup_receipt', phase: 'coordination',
    deploymentId: state.authority.deploymentId,
    operationRunId: state.authority.operationRunId,
    state: ambiguous ? 'ambiguous' : 'refused',
    operationStartedAt: state.resourceCreatedAt,
    operationEndedAt: finalizedAt, receiptCoreFinalizedAt: finalizedAt,
    policyDigest: state.authority.policyDigest,
    authorityCoreDigest: state.authorityCoreDigest,
    ownershipAuthorityEstablished: false,
    deploymentManifestDigest: null, runManifestDigest: null,
    actions: [], results: [], refusals: [],
    failureClass: ambiguous ? 'query_failed' : 'unregistered',
    subjectExitStatus, signerKeyId: state.evidenceFingerprint,
  };
}

function privateReceipt(receiptPath, state, keys, subjectExitStatus, cleanupSuppression, now) {
  const receipt = existsSync(receiptPath)
    ? parseStrictJson(readExternalFile(receiptPath, {
      checkoutRoot: state.authority.checkoutRoot,
    }))
    : buildReceipt(state, subjectExitStatus, cleanupSuppression, now);
  writeSignedArtifact(receipt, signedOptions(receiptPath, state, keys));
  const verified = verifySignedArtifact({
    inputPath: receiptPath, publicKeyPath: keys.evidencePublic,
    expectedFingerprint: state.evidenceFingerprint,
    checkoutRoot: state.authority.checkoutRoot,
  }).artifact;
  if (verified.phase !== 'coordination'
      || verified.authorityCoreDigest !== state.authorityCoreDigest
      || verified.subjectExitStatus !== subjectExitStatus
      || (cleanupSuppression !== null
        && verified.state !== (cleanupSuppression ? 'ambiguous' : 'refused'))) {
    throw new Error('pre-bind cleanup receipt conflicts with coordinator state');
  }
  return verified;
}

function publishReceipt(receipt, state, keys, artifactDirectory) {
  const uploadDirectory = ensurePrivateDirectory(artifactDirectory);
  const projection = buildCleanupUploadReceipt(receipt);
  for (const name of ['planning-upload.json', 'final-upload.json']) {
    writeSignedArtifact(projection, signedOptions(path.join(uploadDirectory, name), state, keys));
  }
  writeExact(
    path.join(uploadDirectory, 'evidence-public.pem'),
    readExternalFile(keys.evidencePublic, {
      checkoutRoot: state.authority.checkoutRoot, maxBytes: 64 * 1024,
    }), state.authority.checkoutRoot,
  );
  writeExact(
    path.join(uploadDirectory, 'authorization-public.pem'),
    readExternalFile(keys.authorizationPublic, {
      checkoutRoot: state.authority.checkoutRoot, maxBytes: 64 * 1024,
    }), state.authority.checkoutRoot,
  );
  return uploadDirectory;
}

export function projectUnboundCiCleanupEvidence({
  statePath, checkoutRoot, artifactDirectory, subjectExitStatus,
  cleanupSuppression = null, now = new Date(),
}) {
  let current = readCoordinatorState(statePath, { checkoutRoot });
  const state = current.state;
  const isUnbound = state.authority.authorityMode === 'deployment_managed_by_subject'
    && state.deploymentManifestPath === null && state.deploymentManifestDigest === null
    && state.runManifestPath === null && state.runManifestDigest === null;
  if (!isUnbound || !['subject_ready', 'projected'].includes(state.phase)) {
    throw new Error('pre-bind cleanup evidence requires an unbound subject-managed lifecycle');
  }
  if (state.subjectExitStatus !== null && state.subjectExitStatus !== subjectExitStatus) {
    throw new Error('subjectExitStatus conflicts with pre-bind cleanup evidence');
  }
  if (cleanupSuppression !== null && state.cleanupSuppression !== null
      && state.cleanupSuppression !== cleanupSuppression) {
    throw new Error('cleanupSuppression conflicts with pre-bind cleanup evidence');
  }
  const durableSuppression = state.cleanupSuppression ?? cleanupSuppression;
  const keys = keyPaths(state.authority);
  const privateDirectory = ensurePrivateDirectory(
    path.join(state.authority.runtimeDirectory, 'coordinator', 'private-evidence'),
  );
  const receiptPath = path.join(privateDirectory, 'prebind-receipt.json');
  const receipt = privateReceipt(
    receiptPath, state, keys, subjectExitStatus, durableSuppression, now,
  );
  const receiptSuppression = receipt.state === 'ambiguous' ? durableSuppression : null;
  if (state.cleanupSuppression !== null && state.cleanupSuppression !== receiptSuppression) {
    throw new Error('pre-bind cleanup receipt suppression conflicts with coordinator state');
  }
  const uploadDirectory = publishReceipt(receipt, state, keys, artifactDirectory);
  if (state.phase === 'subject_ready') {
    current = transitionCoordinatorState({
      statePath, checkoutRoot, expectedDigest: current.digest, nextPhase: 'projected',
      updates: {
        subjectExitStatus, cleanupSuppression: receiptSuppression, planningReceiptPath: receiptPath,
      },
    });
  }
  return Object.freeze({ ...current, privateReceipt: receipt, uploadDirectory });
}
