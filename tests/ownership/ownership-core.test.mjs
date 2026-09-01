import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  mkdtempSync, statSync, symlinkSync, utimesSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalJson, canonicalSha256, parseStrictJson } from '../../scripts/ownership/canonical-json.mjs';
import { assertKeyPair, publicKeyFingerprint, signDetached, verifyDetached } from '../../scripts/ownership/crypto.mjs';
import { assertLocalPrivateSafe, assertUploadSafe } from '../../scripts/ownership/privacy.mjs';
import {
  descriptorReadIsStable, readExternalFile, writeExternalFileAtomic,
} from '../../scripts/ownership/safe-file.mjs';
import { validateArtifact } from '../../scripts/ownership/schemas.mjs';

const checkoutRoot = path.resolve(import.meta.dirname, '../..');

test('canonical JSON has stable RFC key order, escaping, Unicode, and digest', () => {
  const left = { z: 'é', a: ['line\n', true, null, 7], '\r': 1, '€': 2, '\ud834\udd1e': 3 };
  const right = { '\ud834\udd1e': 3, '€': 2, '\r': 1, a: ['line\n', true, null, 7], z: 'é' };
  assert.deepEqual(canonicalJson(left), canonicalJson(right));
  assert.equal(canonicalJson(left).toString(), '{"\\r":1,"a":["line\\n",true,null,7],"z":"é","€":2,"𝄞":3}');
  assert.equal(canonicalSha256(left), canonicalSha256(right));
  assert.equal(canonicalJson(left).at(-1), 0x7d);
});

test('strict JSON rejects duplicate semantic keys and unsupported numeric values', () => {
  assert.throws(() => parseStrictJson(Buffer.from('{"a":1,"\\u0061":2}')), /duplicate/);
  for (const value of ['1.5', '1e2', '-0', '9007199254740992']) {
    assert.throws(() => parseStrictJson(Buffer.from(value)), /integer-only|invalid JSON/);
  }
  assert.throws(() => canonicalJson({ value: Number.MAX_SAFE_INTEGER + 1 }), /safe integer/);
  assert.throws(() => canonicalJson({ value: '\ud800' }), /lone surrogate/);
  const sparse = [];
  sparse[1] = true;
  assert.throws(() => canonicalJson(sparse), /sparse/);
});

test('safe evidence IO is bounded, no-follow, external, immutable, and mode 0600', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-evidence-'));
  const target = path.join(root, 'evidence.json');
  writeExternalFileAtomic(target, Buffer.from('{}'), { checkoutRoot });
  assert.deepEqual(readExternalFile(target, { checkoutRoot, maxBytes: 2 }), Buffer.from('{}'));
  assert.equal(statSync(target).mode & 0o777, 0o600);
  assert.throws(() => writeExternalFileAtomic(target, Buffer.from('x'), { checkoutRoot }), /EEXIST/);
  const oversized = path.join(root, 'large');
  writeFileSync(oversized, '123');
  assert.throws(() => readExternalFile(oversized, { checkoutRoot, maxBytes: 2 }), /byte limit/);
  const link = path.join(root, 'link');
  symlinkSync(target, link);
  assert.throws(() => readExternalFile(link, { checkoutRoot }), /non-symlink/);
  assert.throws(() => readExternalFile(import.meta.filename, { checkoutRoot }), /outside the checkout/);
});

test('stable descriptor reads reject same-inode same-length in-place rewrites', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-stable-read-'));
  const target = path.join(root, 'evidence.json');
  writeFileSync(target, 'old');
  utimesSync(target, new Date('2026-08-30T00:00:00.000Z'), new Date('2026-08-30T00:00:00.000Z'));
  const opened = statSync(target);

  writeFileSync(target, 'new');
  utimesSync(target, new Date('2026-08-30T00:00:01.000Z'), new Date('2026-08-30T00:00:01.000Z'));
  const after = statSync(target);

  assert.equal(after.dev, opened.dev);
  assert.equal(after.ino, opened.ino);
  assert.equal(after.size, opened.size);
  assert.equal(descriptorReadIsStable(opened, after, after.size), false);
});

test('RSA signatures bind exact bytes, explicit key, and DER-SPKI fingerprint', () => {
  const first = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const second = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const bytes = Buffer.from('canonical evidence');
  const signature = signDetached(bytes, first.privateKey);
  const fingerprint = publicKeyFingerprint(first.publicKey);
  assert.doesNotThrow(() => assertKeyPair(first.privateKey, first.publicKey));
  assert.doesNotThrow(() => verifyDetached(bytes, signature, first.publicKey, fingerprint));
  assert.throws(() => assertKeyPair(first.privateKey, second.publicKey), /do not match/);
  assert.throws(() => verifyDetached(bytes, signature, first.publicKey, publicKeyFingerprint(second.publicKey)), /fingerprint/);
  assert.throws(() => verifyDetached(Buffer.from('tampered'), signature, first.publicKey, fingerprint), /verification failed/);
  assert.throws(() => verifyDetached(bytes, signature, second.publicKey, publicKeyFingerprint(second.publicKey)), /verification failed/);
});

test('upload privacy scan rejects credentials, keys, addresses, and sensitive fields', () => {
  assert.doesNotThrow(() => assertUploadSafe({ state: 'refused', digest: 'a'.repeat(64) }));
  for (const value of [
    { privateKey: 'hidden' },
    { note: '-----BEGIN PRIVATE KEY-----' },
    { endpoint: 'https://user:password@example.test' },
    { walletId: 'opaque' },
  ]) assert.throws(() => assertUploadSafe(value), /private material|upload-safe/);
  assert.doesNotThrow(() => assertLocalPrivateSafe({ evidencePath: '/var/lib/sanctuary/evidence' }));
  assert.throws(() => assertUploadSafe({ evidencePath: '/var/lib/sanctuary/evidence' }), /upload-safe|local locator/);
});

function validReceipt() {
  const hash = 'a'.repeat(64);
  return {
    schemaVersion: '1.0.0', artifactType: 'cleanup_receipt', deploymentId: 'deploy-1', operationRunId: 'run-1', state: 'no_op',
    operationStartedAt: '2026-08-30T00:00:00.000Z', operationEndedAt: '2026-08-30T00:00:01.000Z', receiptCoreFinalizedAt: '2026-08-30T00:00:02.000Z',
    policyDigest: hash, deploymentManifestDigest: hash, runManifestDigest: hash, planDigest: hash, approvalDigest: hash,
    approvalStateDigest: hash, inventoryBeforeDigest: hash, inventoryAfterDigest: hash, journalDigest: hash,
    journalBytes: 0, journalRecords: 0, actions: [], results: [], refusals: [], signerKeyId: hash,
  };
}

test('receipt schema rejects unknown fields and ill-ordered or future timestamps', () => {
  assert.doesNotThrow(() => validateArtifact(validReceipt(), { now: new Date('2026-08-30T00:00:03.000Z') }));
  assert.throws(() => validateArtifact({ ...validReceipt(), secret: 'x' }), /exactly/);
  assert.throws(() => validateArtifact({ ...validReceipt(), operationEndedAt: '2026-08-29T23:59:59.000Z' }), /out of order/);
  assert.throws(() => validateArtifact(validReceipt(), { now: new Date('2026-08-30T00:00:01.000Z') }), /future/);
});

test('upload receipt schema admits only bounded aggregate evidence', () => {
  const hash = 'b'.repeat(64);
  const counts = { total: 1, cleaned: 0, retained: 1, refused: 0, ambiguous: 0 };
  const receipt = { schemaVersion: '1.0.0', artifactType: 'cleanup_receipt_upload', privateReceiptDigest: hash, state: 'no_op', resourceCounts: counts, resultCounts: counts, failureClasses: [], policyDigest: hash, signerKeyId: hash };
  assert.doesNotThrow(() => validateArtifact(receipt));
  assert.doesNotThrow(() => assertUploadSafe(receipt));
  assert.throws(() => validateArtifact({ ...receipt, evidencePath: '/tmp/private' }), /exactly/);
});
