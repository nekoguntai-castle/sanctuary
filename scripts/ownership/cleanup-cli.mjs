#!/usr/bin/env node
import {
  closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync,
} from 'node:fs';
import path from 'node:path';
import { canonicalJson, canonicalSha256, parseStrictJson } from './canonical-json.mjs';
import { buildCleanupApproval } from './cleanup-approval.mjs';
import { createCleanupDockerRuntime } from './cleanup-docker-runtime.mjs';
import { createDockerCleanupAdapter } from './cleanup-docker-adapter.mjs';
import { applyCleanupExecution } from './cleanup-execution.mjs';
import { writeSignedArtifact, verifySignedArtifact } from './cleanup-evidence.mjs';
import { inventoryCleanupResources } from './cleanup-inventory.mjs';
import { deriveCleanupJournalPath } from './cleanup-journal.mjs';
import {
  acquireCleanupApplyLocks, acquireCleanupRecoveryLocks, releaseCleanupLocks,
} from './cleanup-lock-controller.mjs';
import { buildCleanupPlan, buildPlanningReceipt } from './cleanup-planner.mjs';
import { recoverCleanupExecution } from './cleanup-recovery.mjs';
import { verifyCleanupTrust } from './cleanup-trust.mjs';
import { validateOwnershipContract } from './contracts.mjs';
import { publicKeyFingerprint, sha256 } from './crypto.mjs';
import { inspectDeploymentLock } from './deployment-lock.mjs';
import { DeploymentStore } from './deployment-store.mjs';
import { assertLocalPrivateSafe } from './privacy.mjs';
import { readRegistrations } from './registration.mjs';
import {
  descriptorReadIsStable, readExternalFile, readPrivateKeyFile, writeExternalFileAtomic,
} from './safe-file.mjs';
import { validateArtifact } from './schemas.mjs';

const EXIT = Object.freeze({ invalid: 2, conflict: 3, ambiguous: 4, partial: 5 });
const MAX_REQUEST_BYTES = 64 * 1024;

function usage() {
  throw Object.assign(new Error('usage: cleanup-cli.mjs inventory|plan|authorize|verify|apply|recover REQUEST.json'), { exitCode: EXIT.invalid });
}

function requestFile(args) {
  if (args.length !== 1) usage();
  const requestPath = path.resolve(args[0]);
  const before = lstatSync(requestPath);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error('request must be a regular non-symlink file');
  }
  if (before.size > MAX_REQUEST_BYTES) throw new Error('request exceeds byte limit');
  const descriptor = openSync(requestPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error('request identity changed while opening');
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const finalPath = lstatSync(requestPath);
    if (!descriptorReadIsStable(opened, after, bytes.length)
        || !finalPath.isFile() || finalPath.isSymbolicLink()
        || !descriptorReadIsStable(opened, finalPath, bytes.length)
        || bytes.length > MAX_REQUEST_BYTES) {
      throw new Error('request changed while reading or exceeds byte limit');
    }
    return parseStrictJson(bytes);
  } finally { closeSync(descriptor); }
}

function exactWithOptional(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('request must be an object');
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter((key) => !(key in value));
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(`request requires ${required.join(', ')}; optional: ${optional.join(', ')}`);
  }
}

function readCanonicalArtifact(filePath, checkoutRoot) {
  const bytes = readExternalFile(path.resolve(filePath), { checkoutRoot });
  const artifact = parseStrictJson(bytes);
  if (!canonicalJson(artifact).equals(bytes)) throw new Error(`artifact is not canonical JSON: ${filePath}`);
  validateArtifact(artifact);
  assertLocalPrivateSafe(artifact);
  return artifact;
}

function readContract(filePath, expectedDigest) {
  const bytes = readFileSync(path.resolve(filePath));
  const digest = sha256(bytes);
  if (digest !== expectedDigest) throw new Error('tracked ownership contract digest does not match bound policy');
  return { contract: validateOwnershipContract(parseStrictJson(bytes)), digest };
}

function writeArtifact(artifact, outputPath, checkoutRoot) {
  validateArtifact(artifact);
  assertLocalPrivateSafe(artifact);
  const target = path.resolve(outputPath);
  const bytes = canonicalJson(artifact);
  if (existsSync(target)) {
    const existing = readExternalFile(target, { checkoutRoot });
    if (!existing.equals(bytes)) throw new Error(`artifact output collision: ${target}`);
    return;
  }
  writeExternalFileAtomic(target, bytes, { checkoutRoot });
}

function deploymentStateReader(request) {
  if (!request.runtimeDirectory) return () => null;
  const store = new DeploymentStore({
    runtimeDirectory: request.runtimeDirectory,
    deploymentId: request.deploymentId,
  });
  return () => ({ ...store.inspect(), mutationLock: inspectDeploymentLock(store.lockPath) });
}

async function inventoryCommand(request) {
  exactWithOptional(request, [
    'checkoutRoot', 'ownershipContractPath', 'deploymentManifestPath', 'runManifestPath',
    'outputPath', 'deploymentId', 'runtimeDirectory',
  ], [
    'engine',
    'sharedImmutableIdentities', 'protectedProjects', 'dataVolumeNames', 'timeoutMs',
    'maxOutputBytes', 'forcedAmbiguity', 'legacyFixtureWitnessDigest',
  ]);
  const deploymentManifest = readCanonicalArtifact(request.deploymentManifestPath, request.checkoutRoot);
  const runManifest = readCanonicalArtifact(request.runManifestPath, request.checkoutRoot);
  const ownership = readContract(request.ownershipContractPath, deploymentManifest.policyDigest);
  if (request.deploymentId !== deploymentManifest.deploymentId) throw new Error('request deploymentId does not match manifest');
  const inventory = await inventoryCleanupResources({
    deploymentManifest,
    runManifest,
    ownershipContract: ownership.contract,
    ownershipContractDigest: ownership.digest,
    dockerAdapter: createDockerCleanupAdapter(),
    dockerOptions: {
      engine: request.engine,
      sharedImmutableIdentities: request.sharedImmutableIdentities,
      protectedProjects: request.protectedProjects,
      dataVolumeNames: request.dataVolumeNames,
      legacyFixtureWitnessDigest: request.legacyFixtureWitnessDigest,
      commandOptions: { timeoutMs: request.timeoutMs, maxOutputBytes: request.maxOutputBytes },
    },
    registrationRoot: path.join(path.resolve(request.runtimeDirectory), 'ownership'),
    readDeploymentState: deploymentStateReader(request),
  });
  const outputInventory = request.forcedAmbiguity === undefined ? inventory : {
    ...inventory,
    complete: false,
    ambiguities: [...inventory.ambiguities, request.forcedAmbiguity].sort((left, right) => (
      left.adapter.localeCompare(right.adapter)
      || (left.resourceClass ?? '').localeCompare(right.resourceClass ?? '')
      || left.failureClass.localeCompare(right.failureClass)
      || left.scope.localeCompare(right.scope)
    )),
  };
  writeArtifact(outputInventory, request.outputPath, request.checkoutRoot);
  process.stdout.write(canonicalJson({
    outputPath: path.resolve(request.outputPath), complete: outputInventory.complete,
  }));
  if (!outputInventory.complete) process.exitCode = EXIT.ambiguous;
}

function signerFingerprint(publicKeyPath, checkoutRoot) {
  return publicKeyFingerprint(readExternalFile(path.resolve(publicKeyPath), { checkoutRoot, maxBytes: 64 * 1024 }));
}

function planCommand(request) {
  exactWithOptional(request, [
    'checkoutRoot', 'ownershipContractPath', 'inventoryPath', 'planOutputPath',
    'receiptOutputPath', 'evidencePrivateKeyPath', 'evidencePublicKeyPath',
    'expectedEvidenceFingerprint',
  ], ['receiptFinalizedAt']);
  const inventory = readCanonicalArtifact(request.inventoryPath, request.checkoutRoot);
  const ownership = readContract(request.ownershipContractPath, inventory.policyDigest);
  const plan = buildCleanupPlan(inventory, ownership.contract, { policyDigest: ownership.digest });
  const receipt = buildPlanningReceipt(inventory, plan, {
    signerKeyId: request.expectedEvidenceFingerprint,
    now: request.receiptFinalizedAt === undefined
      ? () => new Date() : () => new Date(request.receiptFinalizedAt),
  });
  writeArtifact(plan, request.planOutputPath, request.checkoutRoot);
  writeSignedArtifact(receipt, {
    outputPath: request.receiptOutputPath,
    privateKeyPath: request.evidencePrivateKeyPath,
    publicKeyPath: request.evidencePublicKeyPath,
    expectedFingerprint: request.expectedEvidenceFingerprint,
    checkoutRoot: request.checkoutRoot,
  });
  process.stdout.write(canonicalJson({
    planOutputPath: path.resolve(request.planOutputPath),
    receiptOutputPath: path.resolve(request.receiptOutputPath),
    state: receipt.state,
  }));
  if (receipt.state === 'ambiguous') process.exitCode = EXIT.ambiguous;
}

function authorizeCommand(request) {
  exactWithOptional(request, [
    'checkoutRoot', 'planPath', 'dryRunReceiptPath', 'evidencePublicKeyPath',
    'expectedEvidenceFingerprint', 'approvalOutputPath', 'authorizationPrivateKeyPath',
    'authorizationPublicKeyPath', 'expectedAuthorizationFingerprint', 'nonce', 'expiresAt',
    'decommission',
  ], ['issuedAt']);
  const plan = readCanonicalArtifact(request.planPath, request.checkoutRoot);
  const { artifact: receipt } = verifySignedArtifact({
    inputPath: request.dryRunReceiptPath,
    publicKeyPath: request.evidencePublicKeyPath,
    expectedFingerprint: request.expectedEvidenceFingerprint,
    checkoutRoot: request.checkoutRoot,
  });
  if (request.expectedAuthorizationFingerprint === request.expectedEvidenceFingerprint) {
    throw new Error('authorization and evidence signing keys must be distinct');
  }
  const actualAuthorizationFingerprint = signerFingerprint(request.authorizationPublicKeyPath, request.checkoutRoot);
  if (actualAuthorizationFingerprint !== request.expectedAuthorizationFingerprint) {
    throw new Error('authorization public key does not match the trusted fingerprint');
  }
  const approval = buildCleanupApproval(plan, receipt, {
    signerKeyId: request.expectedAuthorizationFingerprint,
    nonce: request.nonce,
    expiresAt: request.expiresAt,
    decommission: request.decommission,
    ...(request.issuedAt ? { now: () => new Date(request.issuedAt) } : {}),
  });
  writeSignedArtifact(approval, {
    outputPath: request.approvalOutputPath,
    privateKeyPath: request.authorizationPrivateKeyPath,
    publicKeyPath: request.authorizationPublicKeyPath,
    expectedFingerprint: request.expectedAuthorizationFingerprint,
    checkoutRoot: request.checkoutRoot,
  });
  process.stdout.write(canonicalJson({ approvalOutputPath: path.resolve(request.approvalOutputPath) }));
}

function verifyCommand(request) {
  exactWithOptional(request, [
    'checkoutRoot', 'inputPath', 'publicKeyPath', 'expectedFingerprint',
  ], ['signaturePath', 'checksumPath']);
  const { artifact, digest } = verifySignedArtifact({ ...request });
  process.stdout.write(canonicalJson({ artifactType: artifact.artifactType, digest, verified: true }));
}

const EXECUTION_REQUIRED = Object.freeze([
  'checkoutRoot', 'runtimeDirectory', 'deploymentId', 'ownershipContractPath',
  'deploymentManifestPath', 'runManifestPath', 'inventoryPath', 'planPath',
  'dryRunReceiptPath', 'approvalPath', 'evidencePrivateKeyPath',
  'evidencePublicKeyPath', 'expectedEvidenceFingerprint',
  'authorizationPublicKeyPath', 'expectedAuthorizationFingerprint',
]);
const EXECUTION_OPTIONAL = Object.freeze([
  'receiptOutputPath', 'engine', 'sharedImmutableIdentities', 'protectedProjects',
  'dataVolumeNames', 'timeoutMs', 'maxOutputBytes', 'subjectExitStatus',
  'supervisorTimeoutMs', 'supervisorGraceMs', 'supervisorKillWaitMs',
  'cleanupAuthorityIdentityDigest', 'cancellationSignalPath',
  'legacyFixtureWitnessDigest',
]);

function executionInputs(request) {
  const deploymentManifest = readCanonicalArtifact(request.deploymentManifestPath, request.checkoutRoot);
  const runManifest = readCanonicalArtifact(request.runManifestPath, request.checkoutRoot);
  const inventoryBefore = readCanonicalArtifact(request.inventoryPath, request.checkoutRoot);
  const plan = readCanonicalArtifact(request.planPath, request.checkoutRoot);
  const { artifact: dryRunReceipt } = verifySignedArtifact({
    inputPath: request.dryRunReceiptPath, publicKeyPath: request.evidencePublicKeyPath,
    expectedFingerprint: request.expectedEvidenceFingerprint, checkoutRoot: request.checkoutRoot,
  });
  const { artifact: approval } = verifySignedArtifact({
    inputPath: request.approvalPath, publicKeyPath: request.authorizationPublicKeyPath,
    expectedFingerprint: request.expectedAuthorizationFingerprint, checkoutRoot: request.checkoutRoot,
  });
  const ownership = readContract(request.ownershipContractPath, deploymentManifest.policyDigest);
  if (request.deploymentId !== deploymentManifest.deploymentId
      || runManifest.deploymentId !== request.deploymentId
      || inventoryBefore.deploymentId !== request.deploymentId
      || plan.deploymentId !== request.deploymentId
      || approval.deploymentId !== request.deploymentId) {
    throw new Error('execution evidence deployment identity mismatch');
  }
  verifyCleanupTrust({
    runtimeDirectory: request.runtimeDirectory, checkoutRoot: request.checkoutRoot,
    deploymentId: request.deploymentId,
    authorizationFingerprint: request.expectedAuthorizationFingerprint,
    evidenceFingerprint: request.expectedEvidenceFingerprint,
    expectedAuthorityIdentityDigest: request.cleanupAuthorityIdentityDigest ?? null,
    operationRunId: plan.operationRunId,
    deploymentManifestDigest: canonicalSha256(deploymentManifest),
  });
  const privateKey = readPrivateKeyFile(path.resolve(request.evidencePrivateKeyPath), {
    checkoutRoot: request.checkoutRoot,
  });
  const publicKey = readExternalFile(path.resolve(request.evidencePublicKeyPath), {
    checkoutRoot: request.checkoutRoot, maxBytes: 64 * 1024,
  });
  return {
    deploymentManifest, runManifest, inventoryBefore, plan, approval, dryRunReceipt,
    ownershipContract: ownership.contract, ownershipContractDigest: ownership.digest,
    privateKey, publicKey,
  };
}

function inventoryLoader(request, inputs, lockOwnerDigest) {
  const store = new DeploymentStore({
    runtimeDirectory: request.runtimeDirectory, deploymentId: request.deploymentId,
  });
  return (inventoryRequest = {}) => inventoryCleanupResources({
    deploymentManifest: inputs.deploymentManifest, runManifest: inputs.runManifest,
    ownershipContract: inputs.ownershipContract,
    ownershipContractDigest: inputs.ownershipContractDigest,
    dockerAdapter: createDockerCleanupAdapter(),
    dockerOptions: {
      engine: request.engine, sharedImmutableIdentities: request.sharedImmutableIdentities,
      protectedProjects: request.protectedProjects, dataVolumeNames: request.dataVolumeNames,
      legacyFixtureWitnessDigest: request.legacyFixtureWitnessDigest,
      daemonAuthority: inventoryRequest.daemonAuthority,
      commandOptions: { timeoutMs: request.timeoutMs, maxOutputBytes: request.maxOutputBytes },
    },
    registrationRoot: path.join(path.resolve(request.runtimeDirectory), 'ownership'),
    readDeploymentState: () => ({
      ...store.inspect(), mutationLock: inspectDeploymentLock(store.lockPath),
    }),
    expectedMutationLockOwnerDigest: lockOwnerDigest,
  });
}

function assertFreshPreflight(before, fresh) {
  const rebound = { ...fresh, observedAt: before.observedAt };
  if (canonicalSha256(rebound) !== canonicalSha256(before)) {
    throw Object.assign(
      new Error('cleanup inventory changed after approval and before reservation'),
      { code: 'CLEANUP_AUTHORITY_AMBIGUOUS' },
    );
  }
}

function dockerRuntime(request, inputs, loadInventory) {
  const registrationRoot = path.join(path.resolve(request.runtimeDirectory), 'ownership');
  return createCleanupDockerRuntime({
    plan: inputs.plan, deploymentManifest: inputs.deploymentManifest,
    engine: request.engine ?? 'docker', loadInventory,
    loadRegistrations: () => readRegistrations(registrationRoot),
    registrationRoot,
    observationOptions: {
      protectedProjects: request.protectedProjects,
      dataVolumeNames: request.dataVolumeNames,
      sharedImmutableIdentities: request.sharedImmutableIdentities,
      legacyFixtureWitnessDigest: request.legacyFixtureWitnessDigest,
      commandOptions: { timeoutMs: request.timeoutMs, maxOutputBytes: request.maxOutputBytes },
    },
    supervisorOptions: {
      timeoutMs: request.supervisorTimeoutMs, graceMs: request.supervisorGraceMs,
      killWaitMs: request.supervisorKillWaitMs, maxOutputBytes: request.maxOutputBytes,
    },
  });
}

function exactCancellationPath(request) {
  if (!request.cancellationSignalPath) return null;
  const expected = path.join(path.resolve(request.runtimeDirectory), 'coordinator', 'cancellation-signal');
  if (path.resolve(request.cancellationSignalPath) !== expected) {
    throw new Error('cleanup cancellation signal path is outside coordinator runtime');
  }
  return expected;
}

async function withCancellation(request, callback) {
  const controller = new AbortController();
  const cancellationPath = exactCancellationPath(request);
  const pollCancellation = () => {
    if (!cancellationPath || controller.signal.aborted || !existsSync(cancellationPath)) return;
    const reason = readFileSync(cancellationPath, 'utf8').trim().toLowerCase();
    controller.abort(['sigint', 'sigterm', 'sighup'].includes(reason) ? reason : 'abort');
  };
  const handlers = new Map(['SIGINT', 'SIGTERM', 'SIGHUP'].map((name) => [
    name, () => {
      if (!controller.signal.aborted) controller.abort(name);
    },
  ]));
  for (const [name, handler] of handlers) process.on(name, handler);
  pollCancellation();
  const timer = setInterval(pollCancellation, 10);
  try { return await callback(controller.signal); } finally {
    clearInterval(timer);
    for (const [name, handler] of handlers) process.removeListener(name, handler);
  }
}

function executionOutput(result) {
  process.stdout.write(canonicalJson({
    state: result.state, receiptOutputPath: result.receiptOutputPath ?? null,
    receiptDigest: result.receiptDigest ?? null, journalDigest: result.journalDigest ?? null,
  }));
  if (['ambiguous', 'cancelled'].includes(result.state)) process.exitCode = EXIT.ambiguous;
  else if (['partial', 'refused'].includes(result.state)) process.exitCode = EXIT.partial;
}

async function applyCommand(request) {
  return withCancellation(request, async (signal) => {
    exactWithOptional(request, EXECUTION_REQUIRED, EXECUTION_OPTIONAL);
    const inputs = executionInputs(request);
    const store = new DeploymentStore({
      runtimeDirectory: request.runtimeDirectory, deploymentId: request.deploymentId,
    });
    const approvalDigest = canonicalSha256(inputs.approval);
    const journalPath = deriveCleanupJournalPath({
      runtimeDirectory: request.runtimeDirectory, approvalDigest,
    });
    const held = acquireCleanupApplyLocks({
      runtimeDirectory: request.runtimeDirectory, deploymentId: request.deploymentId,
      deploymentLockPath: store.lockPath,
      composeProjectName: inputs.deploymentManifest.composeProjectName,
      operationRunId: inputs.plan.operationRunId, journalPath,
      generation: inputs.deploymentManifest.generation,
    });
    try {
      const loadInventory = inventoryLoader(request, inputs, held.ownerDigest);
      assertFreshPreflight(inputs.inventoryBefore, await loadInventory());
      const runtime = dockerRuntime(request, inputs, loadInventory);
      const result = await applyCleanupExecution({
        runtimeDirectory: request.runtimeDirectory, checkoutRoot: request.checkoutRoot,
        ...inputs, signerKeyId: request.expectedEvidenceFingerprint,
        privateKeyPath: request.evidencePrivateKeyPath, publicKeyPath: request.evidencePublicKeyPath,
        reloadAuthority: runtime.reloadAuthority, mutate: runtime.mutate,
        reconcile: runtime.reconcile, buildInventoryAfter: loadInventory,
        receiptOutputPath: request.receiptOutputPath, signal,
        subjectExitStatus: request.subjectExitStatus ?? null,
      });
      executionOutput(result);
    } finally { releaseCleanupLocks(held); }
  });
}

async function recoverCommand(request) {
  return withCancellation(request, async (signal) => {
    exactWithOptional(request, [...EXECUTION_REQUIRED, 'controllerRunId'], EXECUTION_OPTIONAL);
    const inputs = executionInputs(request);
    const store = new DeploymentStore({
      runtimeDirectory: request.runtimeDirectory, deploymentId: request.deploymentId,
    });
    const approvalDigest = canonicalSha256(inputs.approval);
    const journalPath = deriveCleanupJournalPath({
      runtimeDirectory: request.runtimeDirectory, approvalDigest,
    });
    const acquired = acquireCleanupRecoveryLocks({
      runtimeDirectory: request.runtimeDirectory, deploymentId: request.deploymentId,
      deploymentLockPath: store.lockPath,
      composeProjectName: inputs.deploymentManifest.composeProjectName,
      originalOperationRunId: inputs.plan.operationRunId,
      controllerRunId: request.controllerRunId, journalPath,
      generation: inputs.deploymentManifest.generation,
    });
    try {
      const loadInventory = inventoryLoader(request, inputs, acquired.held.ownerDigest);
      const runtime = dockerRuntime(request, inputs, loadInventory);
      const result = await recoverCleanupExecution({
        runtimeDirectory: request.runtimeDirectory, checkoutRoot: request.checkoutRoot,
        ...inputs, signerKeyId: request.expectedEvidenceFingerprint,
        privateKeyPath: request.evidencePrivateKeyPath, publicKeyPath: request.evidencePublicKeyPath,
        controllerRunId: request.controllerRunId,
        projectLockObservationDigest: acquired.observations.projectDigest,
        deploymentLockObservationDigest: acquired.observations.deploymentDigest,
        reloadAuthority: runtime.reloadAuthority, mutate: runtime.mutate,
        reconcile: runtime.reconcile, buildInventoryAfter: loadInventory,
        receiptOutputPath: request.receiptOutputPath, signal,
        subjectExitStatus: request.subjectExitStatus,
      });
      executionOutput(result);
    } finally { releaseCleanupLocks(acquired.held); }
  });
}

export async function run([command, ...args]) {
  const request = requestFile(args);
  if (command === 'inventory') await inventoryCommand(request);
  else if (command === 'plan') planCommand(request);
  else if (command === 'authorize') authorizeCommand(request);
  else if (command === 'verify') verifyCommand(request);
  else if (command === 'apply') await applyCommand(request);
  else if (command === 'recover') await recoverCommand(request);
  else usage();
}

export function cleanupExitCode(error) {
  if (Number.isInteger(error?.exitCode)) return error.exitCode;
  if (error?.code === 'DEPLOYMENT_LOCK_CONFLICT'
      || /compare-and-swap|\bcollision\b|already (?:active|pending)|\bconflict\b/.test(error?.message ?? '')) {
    return EXIT.conflict;
  }
  if (error?.code === 'CLEANUP_AUTHORITY_AMBIGUOUS'
      || /\bambiguous\b|\bliveness\b/.test(error?.message ?? '')) return EXIT.ambiguous;
  return EXIT.invalid;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`cleanup-cli: ${error.message}\n`);
    process.exitCode = cleanupExitCode(error);
  });
}
