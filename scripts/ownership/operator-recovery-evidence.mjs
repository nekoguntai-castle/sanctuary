import { canonicalJson, canonicalSha256 } from './canonical-json.mjs';
import {
  assertKeyPair, publicKeyFingerprint, signDetached, verifyDetached,
} from './crypto.mjs';

const DIGEST = /^[a-f0-9]{64}$/;

function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
      || Object.keys(envelope).sort().join('\0')
        !== ['artifact', 'artifactDigest', 'signature', 'signerKeyId'].sort().join('\0')) {
    throw new TypeError('operator recovery evidence envelope fields are invalid');
  }
  if (!DIGEST.test(envelope.artifactDigest ?? '') || !DIGEST.test(envelope.signerKeyId ?? '')
      || typeof envelope.signature !== 'string' || envelope.signature.length === 0) {
    throw new TypeError('operator recovery evidence envelope is invalid');
  }
}

export function signOperatorRecoveryArtifact(artifact, {
  privateKey, publicKey, expectedFingerprint, validate = (value) => value,
} = {}) {
  validate(artifact);
  assertKeyPair(privateKey, publicKey);
  const signerKeyId = publicKeyFingerprint(publicKey);
  if (signerKeyId !== expectedFingerprint) {
    throw new Error('operator recovery signer does not match the trusted fingerprint');
  }
  const bytes = canonicalJson(artifact);
  return Object.freeze({
    artifact,
    artifactDigest: canonicalSha256(artifact),
    signerKeyId,
    signature: signDetached(bytes, privateKey).toString('base64'),
  });
}

export function verifyOperatorRecoveryArtifact(envelope, {
  publicKey, acceptedFingerprints, validate = (value) => value,
} = {}) {
  validateEnvelope(envelope);
  if (!Array.isArray(acceptedFingerprints)
      || !acceptedFingerprints.includes(envelope.signerKeyId)) {
    throw new Error('operator recovery signer is not accepted by the trusted role');
  }
  if (publicKeyFingerprint(publicKey) !== envelope.signerKeyId) {
    throw new Error('operator recovery public key does not match signer identity');
  }
  validate(envelope.artifact);
  const bytes = canonicalJson(envelope.artifact);
  if (canonicalSha256(envelope.artifact) !== envelope.artifactDigest) {
    throw new Error('operator recovery artifact digest mismatch');
  }
  let signature;
  try { signature = Buffer.from(envelope.signature, 'base64'); } catch {
    throw new Error('operator recovery evidence signature is malformed');
  }
  if (signature.length === 0 || signature.toString('base64') !== envelope.signature) {
    throw new Error('operator recovery evidence signature is malformed');
  }
  verifyDetached(bytes, signature, publicKey, envelope.signerKeyId);
  return envelope.artifact;
}
