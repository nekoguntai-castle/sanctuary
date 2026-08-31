#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, parseStrictJson } from './canonical-json.mjs';
import { buildCleanupApproval } from './cleanup-approval.mjs';
import { createDockerCleanupAdapter } from './cleanup-docker-adapter.mjs';
import { writeSignedArtifact, verifySignedArtifact } from './cleanup-evidence.mjs';
import { inventoryCleanupResources } from './cleanup-inventory.mjs';
import { buildCleanupPlan, buildPlanningReceipt } from './cleanup-planner.mjs';
import { validateOwnershipContract } from './contracts.mjs';
import { publicKeyFingerprint, sha256 } from './crypto.mjs';
import { inspectDeploymentLock } from './deployment-lock.mjs';
import { DeploymentStore } from './deployment-store.mjs';
import { assertLocalPrivateSafe } from './privacy.mjs';
import { readExternalFile, writeExternalFileAtomic } from './safe-file.mjs';
import { validateArtifact } from './schemas.mjs';

const EXIT = Object.freeze({ invalid: 2, ambiguous: 4, disabled: 6 });

function usage() {
  throw Object.assign(new Error('usage: cleanup-cli.mjs inventory|plan|authorize|verify|apply REQUEST.json'), { exitCode: EXIT.invalid });
}

function requestFile(args) {
  if (args.length !== 1) usage();
  return parseStrictJson(readFileSync(path.resolve(args[0])));
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
  writeExternalFileAtomic(path.resolve(outputPath), canonicalJson(artifact), { checkoutRoot });
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
    'sharedImmutableIdentities', 'protectedProjects', 'dataVolumeNames', 'timeoutMs', 'maxOutputBytes',
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
      commandOptions: { timeoutMs: request.timeoutMs, maxOutputBytes: request.maxOutputBytes },
    },
    registrationRoot: path.join(path.resolve(request.runtimeDirectory), 'ownership'),
    readDeploymentState: deploymentStateReader(request),
  });
  writeArtifact(inventory, request.outputPath, request.checkoutRoot);
  process.stdout.write(canonicalJson({ outputPath: path.resolve(request.outputPath), complete: inventory.complete }));
  if (!inventory.complete) process.exitCode = EXIT.ambiguous;
}

function signerFingerprint(publicKeyPath, checkoutRoot) {
  return publicKeyFingerprint(readExternalFile(path.resolve(publicKeyPath), { checkoutRoot, maxBytes: 64 * 1024 }));
}

function planCommand(request) {
  exactWithOptional(request, [
    'checkoutRoot', 'ownershipContractPath', 'inventoryPath', 'planOutputPath',
    'receiptOutputPath', 'evidencePrivateKeyPath', 'evidencePublicKeyPath',
    'expectedEvidenceFingerprint',
  ]);
  const inventory = readCanonicalArtifact(request.inventoryPath, request.checkoutRoot);
  const ownership = readContract(request.ownershipContractPath, inventory.policyDigest);
  const plan = buildCleanupPlan(inventory, ownership.contract, { policyDigest: ownership.digest });
  const receipt = buildPlanningReceipt(inventory, plan, { signerKeyId: request.expectedEvidenceFingerprint });
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
  ]);
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

export async function run([command, ...args]) {
  if (command === 'apply') {
    throw Object.assign(new Error('apply is disabled until exact execution and recovery are proven in Phase 4'), { exitCode: EXIT.disabled });
  }
  const request = requestFile(args);
  if (command === 'inventory') await inventoryCommand(request);
  else if (command === 'plan') planCommand(request);
  else if (command === 'authorize') authorizeCommand(request);
  else if (command === 'verify') verifyCommand(request);
  else usage();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`cleanup-cli: ${error.message}\n`);
    process.exitCode = error.exitCode ?? EXIT.invalid;
  });
}
