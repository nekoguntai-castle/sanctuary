import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, canonicalSha256, parseStrictJson } from '../../scripts/ownership/canonical-json.mjs';
import { publicKeyFingerprint, sha256 } from '../../scripts/ownership/crypto.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(ROOT, 'scripts/ownership/cleanup-cli.mjs');
const HASH = 'a'.repeat(64);
const POLICY_DIGEST = sha256(readFileSync(path.join(ROOT, 'config/resource-ownership-contract.json')));

function writeCanonical(file, value, mode = 0o600) {
  writeFileSync(file, canonicalJson(value), { mode });
}

function deployment() {
  const snapshot = Buffer.from('services: {}\n');
  const definition = {
    definitionVersion: 1, ownerId: 'owner-1', release: 'v0.8.69', commit: 'b'.repeat(40),
    projectDirectory: '/private/project', projectDirectoryIdentity: 'device:inode',
    composeProjectName: 'sanctuary-ci-1', envFile: '/private/sanctuary.env',
    envFileIdentity: 'env:inode', installMode: 'online', profiles: [],
    overlays: [{ sourcePath: '/private/compose.yml', sourceIdentity: 'overlay:inode',
      snapshotPath: 'compose/00-compose.yml', sha256: sha256(snapshot), kind: 'tracked' }],
    policyDigest: POLICY_DIGEST, contextFingerprint: 'c'.repeat(64),
  };
  return {
    schemaVersion: '1.0.0', artifactType: 'deployment_manifest', deploymentId: 'deploy-1',
    generation: 1, createdAt: '2026-08-30T00:00:00.000Z', priorActiveDigest: null,
    ...definition, definitionDigest: canonicalSha256(definition), legacyResources: [], snapshot,
  };
}

function keys(root) {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPath = path.join(root, 'evidence-private.pem');
  const publicKeyPath = path.join(root, 'evidence-public.pem');
  writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
  writeFileSync(publicKeyPath, publicKey, { mode: 0o600 });
  return { privateKeyPath, publicKeyPath, fingerprint: publicKeyFingerprint(publicKey) };
}

function invoke(command, requestPath) {
  return spawnSync(process.execPath, [CLI, command, requestPath], { encoding: 'utf8', cwd: ROOT });
}

test('cleanup CLI produces and verifies an immutable signed no-op dry-run without Docker mutation', () => {
  const evidenceRoot = mkdtempSync(path.join(os.tmpdir(), 'cleanup-cli-'));
  chmodSync(evidenceRoot, 0o700);
  const { snapshot, ...manifest } = deployment();
  const evidenceKeys = keys(evidenceRoot);
  const run = {
    schemaVersion: '1.0.0', artifactType: 'run_manifest', deploymentId: manifest.deploymentId,
    operationRunId: 'cleanup-1', ownerId: manifest.ownerId, generation: manifest.generation,
    startedAt: '2026-08-30T00:00:01.000Z', heartbeatAt: '2026-08-30T00:00:02.000Z',
    terminalAt: '2026-08-30T00:00:03.000Z', controllerIdentity: 'controller-1',
    deploymentDigest: canonicalSha256(manifest),
  };
  const deploymentPath = path.join(evidenceRoot, 'deployment.json');
  const runPath = path.join(evidenceRoot, 'run.json');
  const inventoryPath = path.join(evidenceRoot, 'inventory.json');
  const runtimeDirectory = path.join(evidenceRoot, 'runtime');
  const revisionRoot = path.join(runtimeDirectory, 'ownership/deployments/deploy-1/revisions/1');
  mkdirSync(path.join(revisionRoot, 'compose'), { recursive: true, mode: 0o700 });
  writeCanonical(path.join(revisionRoot, 'deployment-manifest.json'), manifest);
  writeFileSync(path.join(revisionRoot, 'compose/00-compose.yml'), snapshot, { mode: 0o600 });
  writeCanonical(path.join(runtimeDirectory, 'ownership/deployments/deploy-1/active-revision.json'), {
    pointerVersion: 1, deploymentId: manifest.deploymentId, generation: manifest.generation,
    manifestDigest: canonicalSha256(manifest), activatedAt: '2026-08-30T00:00:04.000Z',
  });
  const registrationKeys = path.join(runtimeDirectory, 'ownership/keys');
  mkdirSync(registrationKeys, { recursive: true, mode: 0o700 });
  chmodSync(path.join(runtimeDirectory, 'ownership'), 0o700);
  chmodSync(registrationKeys, 0o700);
  writeFileSync(path.join(registrationKeys, 'public.pem'), readFileSync(evidenceKeys.publicKeyPath), { mode: 0o600 });
  const engine = path.join(evidenceRoot, 'read-only-engine');
  const engineLog = path.join(evidenceRoot, 'engine.log');
  writeFileSync(engine, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(engineLog)}\n`, { mode: 0o700 });
  writeCanonical(deploymentPath, manifest);
  writeCanonical(runPath, run);
  const inventoryRequest = path.join(evidenceRoot, 'inventory-request.json');
  writeCanonical(inventoryRequest, {
    checkoutRoot: ROOT,
    ownershipContractPath: path.join(ROOT, 'config/resource-ownership-contract.json'),
    deploymentManifestPath: deploymentPath,
    runManifestPath: runPath,
    outputPath: inventoryPath,
    deploymentId: manifest.deploymentId,
    runtimeDirectory,
    engine,
  });
  const inventoried = invoke('inventory', inventoryRequest);
  assert.equal(inventoried.status, 0, inventoried.stderr);
  assert.equal(parseStrictJson(readFileSync(inventoryPath)).complete, true);
  const engineCalls = readFileSync(engineLog, 'utf8');
  assert.match(engineCalls, /container ls/);
  assert.match(engineCalls, /network ls/);
  assert.match(engineCalls, /volume ls/);
  assert.match(engineCalls, /image ls/);
  assert.doesNotMatch(engineCalls, /\brm\b|\bstop\b|\bremove\b/);

  const planPath = path.join(evidenceRoot, 'cleanup-plan.json');
  const receiptPath = path.join(evidenceRoot, 'cleanup-receipt.json');
  const planRequest = path.join(evidenceRoot, 'plan-request.json');
  writeCanonical(planRequest, {
    checkoutRoot: ROOT,
    ownershipContractPath: path.join(ROOT, 'config/resource-ownership-contract.json'),
    inventoryPath,
    planOutputPath: planPath,
    receiptOutputPath: receiptPath,
    evidencePrivateKeyPath: evidenceKeys.privateKeyPath,
    evidencePublicKeyPath: evidenceKeys.publicKeyPath,
    expectedEvidenceFingerprint: evidenceKeys.fingerprint,
  });
  const planned = invoke('plan', planRequest);
  assert.equal(planned.status, 0, planned.stderr);
  assert.equal(parseStrictJson(Buffer.from(planned.stdout)).state, 'no_op');

  const verifyRequest = path.join(evidenceRoot, 'verify-request.json');
  writeCanonical(verifyRequest, {
    checkoutRoot: ROOT, inputPath: receiptPath, publicKeyPath: evidenceKeys.publicKeyPath,
    expectedFingerprint: evidenceKeys.fingerprint,
  });
  const verified = invoke('verify', verifyRequest);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(parseStrictJson(Buffer.from(verified.stdout)).verified, true);

  const disabled = invoke('apply', path.join(evidenceRoot, 'missing-request.json'));
  assert.equal(disabled.status, 6);
  assert.match(disabled.stderr, /apply is disabled/);
});
