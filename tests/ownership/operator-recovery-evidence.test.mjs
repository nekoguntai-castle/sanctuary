import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { publicKeyFingerprint } from '../../scripts/ownership/crypto.mjs';
import {
  signOperatorRecoveryArtifact,
  verifyOperatorRecoveryArtifact,
} from '../../scripts/ownership/operator-recovery-evidence.mjs';

function keys() {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { ...pair, fingerprint: publicKeyFingerprint(pair.publicKey) };
}

test('operator recovery evidence binds exact canonical artifact and trusted role', () => {
  const signer = keys();
  const artifact = { artifactType: 'operator_recovery_test', value: 'bounded' };
  const envelope = signOperatorRecoveryArtifact(artifact, {
    privateKey: signer.privateKey, publicKey: signer.publicKey,
    expectedFingerprint: signer.fingerprint,
  });
  assert.deepEqual(verifyOperatorRecoveryArtifact(envelope, {
    publicKey: signer.publicKey, acceptedFingerprints: [signer.fingerprint],
    validate: (value) => value,
  }), artifact);
  assert.throws(() => verifyOperatorRecoveryArtifact({
    ...envelope, artifact: { ...artifact, value: 'changed' },
  }, { publicKey: signer.publicKey, acceptedFingerprints: [signer.fingerprint] }), /digest/);
  assert.throws(() => verifyOperatorRecoveryArtifact(envelope, {
    publicKey: signer.publicKey, acceptedFingerprints: ['f'.repeat(64)],
  }), /trusted role/);
});

test('signing rejects mismatched keys and validation runs before signing', () => {
  const first = keys();
  const second = keys();
  assert.throws(() => signOperatorRecoveryArtifact({ value: 1 }, {
    privateKey: first.privateKey, publicKey: second.publicKey,
    expectedFingerprint: second.fingerprint,
  }), /keys do not match/);
  assert.throws(() => signOperatorRecoveryArtifact({ value: 1 }, {
    privateKey: first.privateKey, publicKey: first.publicKey,
    expectedFingerprint: first.fingerprint,
    validate: () => { throw new Error('invalid artifact'); },
  }), /invalid artifact/);
});
