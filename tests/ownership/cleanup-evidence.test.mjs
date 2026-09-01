import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  prepareSignedArtifact, writePreparedSignedArtifact, writeSignedArtifact, verifySignedArtifact,
} from '../../scripts/ownership/cleanup-evidence.mjs';
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
  chmodSync(keys.publicKeyPath, 0o644);
  assert.deepEqual(writeSignedArtifact(receipt(keys.fingerprint), {
    outputPath, ...keys, expectedFingerprint: keys.fingerprint, checkoutRoot,
  }), written);
  assert.throws(() => verifySignedArtifact({
    inputPath: outputPath, publicKeyPath: keys.publicKeyPath,
    expectedFingerprint: 'f'.repeat(64), checkoutRoot,
  }), /fingerprint/);
});

test('prepared signed evidence resumes exact missing sidecars but refuses collisions', () => {
  const checkoutRoot = mkdtempSync(path.join(os.tmpdir(), 'cleanup-checkout-'));
  const evidenceRoot = mkdtempSync(path.join(os.tmpdir(), 'cleanup-evidence-'));
  chmodSync(checkoutRoot, 0o700);
  chmodSync(evidenceRoot, 0o700);
  const keys = keyFiles(evidenceRoot);
  const outputPath = path.join(evidenceRoot, 'terminal-receipt.json');
  const prepared = prepareSignedArtifact(receipt(keys.fingerprint), {
    outputPath, ...keys, expectedFingerprint: keys.fingerprint, checkoutRoot,
  });
  writeFileSync(outputPath, prepared.entries[0][1], { mode: 0o600 });
  const written = writePreparedSignedArtifact(prepared);
  assert.equal(readFileSync(written.checksumPath, 'ascii'), written.digest);
  writeFileSync(written.signaturePath, 'wrong', { mode: 0o600 });
  assert.throws(() => writePreparedSignedArtifact(prepared), /collision/);
});

test('signing rejects permissive private keys and unsafe or symlinked parents', () => {
  const checkoutRoot = mkdtempSync(path.join(os.tmpdir(), 'cleanup-checkout-'));
  const evidenceRoot = mkdtempSync(path.join(os.tmpdir(), 'cleanup-private-key-'));
  chmodSync(checkoutRoot, 0o700);
  chmodSync(evidenceRoot, 0o700);
  const keys = keyFiles(evidenceRoot);
  const options = {
    outputPath: path.join(evidenceRoot, 'receipt.json'), ...keys,
    expectedFingerprint: keys.fingerprint, checkoutRoot,
  };

  chmodSync(keys.privateKeyPath, 0o644);
  assert.throws(() => prepareSignedArtifact(receipt(keys.fingerprint), options), /exact mode 0600/);
  chmodSync(keys.privateKeyPath, 0o600);
  chmodSync(evidenceRoot, 0o750);
  assert.throws(() => prepareSignedArtifact(receipt(keys.fingerprint), options), /parent.*owner-only/);
  chmodSync(evidenceRoot, 0o700);

  const linkRoot = mkdtempSync(path.join(os.tmpdir(), 'cleanup-private-link-'));
  chmodSync(linkRoot, 0o700);
  const realParent = path.join(linkRoot, 'real');
  const linkedParent = path.join(linkRoot, 'linked');
  mkdirSync(realParent, { mode: 0o700 });
  symlinkSync(realParent, linkedParent);
  const linkedKeys = keyFiles(realParent);
  assert.throws(() => prepareSignedArtifact(receipt(linkedKeys.fingerprint), {
    outputPath: path.join(realParent, 'receipt.json'),
    privateKeyPath: path.join(linkedParent, 'private.pem'),
    publicKeyPath: linkedKeys.publicKeyPath,
    expectedFingerprint: linkedKeys.fingerprint, checkoutRoot,
  }), /parent.*non-symlink/);
});
