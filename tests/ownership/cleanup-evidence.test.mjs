import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeSignedArtifact, verifySignedArtifact } from '../../scripts/ownership/cleanup-evidence.mjs';
import { publicKeyFingerprint } from '../../scripts/ownership/crypto.mjs';

const HASH = 'a'.repeat(64);

function keyFiles(root) {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPath = path.join(root, 'private.pem');
  const publicKeyPath = path.join(root, 'public.pem');
  writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
  writeFileSync(publicKeyPath, publicKey, { mode: 0o600 });
  return { privateKeyPath, publicKeyPath, fingerprint: publicKeyFingerprint(publicKey) };
}

function receipt(signerKeyId) {
  return {
    schemaVersion: '1.1.0', artifactType: 'cleanup_receipt', phase: 'planning',
    deploymentId: 'deploy-1', operationRunId: 'cleanup-1', state: 'no_op',
    operationStartedAt: '2026-08-30T00:00:00.000Z', operationEndedAt: '2026-08-30T00:00:01.000Z',
    receiptCoreFinalizedAt: '2026-08-30T00:00:02.000Z', policyDigest: HASH,
    deploymentManifestDigest: HASH, runManifestDigest: HASH, planDigest: HASH,
    approvalDigest: null, approvalStateDigest: null, inventoryBeforeDigest: HASH,
    inventoryAfterDigest: null, journalDigest: null, journalBytes: 0, journalRecords: 0,
    actions: [], results: [], refusals: [], signerKeyId,
  };
}

test('signed cleanup evidence uses canonical bytes, raw detached signatures, and exact trust pins', () => {
  const checkoutRoot = mkdtempSync(path.join(os.tmpdir(), 'cleanup-checkout-'));
  const evidenceRoot = mkdtempSync(path.join(os.tmpdir(), 'cleanup-evidence-'));
  chmodSync(checkoutRoot, 0o700);
  chmodSync(evidenceRoot, 0o700);
  const keys = keyFiles(evidenceRoot);
  const outputPath = path.join(evidenceRoot, 'cleanup-receipt.json');
  const written = writeSignedArtifact(receipt(keys.fingerprint), {
    outputPath, ...keys, expectedFingerprint: keys.fingerprint, checkoutRoot,
  });
  assert.equal(readFileSync(written.checksumPath, 'ascii'), written.digest);
  assert.equal(readFileSync(written.signaturePath).length, 256);
  const verified = verifySignedArtifact({
    inputPath: outputPath, publicKeyPath: keys.publicKeyPath,
    expectedFingerprint: keys.fingerprint, checkoutRoot,
    now: new Date('2026-08-30T00:00:03.000Z'),
  });
  assert.equal(verified.artifact.state, 'no_op');
  assert.throws(() => verifySignedArtifact({
    inputPath: outputPath, publicKeyPath: keys.publicKeyPath,
    expectedFingerprint: 'f'.repeat(64), checkoutRoot,
  }), /fingerprint/);
});
