import { constants, createHash, createPrivateKey, createPublicKey, sign, timingSafeEqual, verify } from 'node:crypto';

export const SIGNATURE_ALGORITHM = 'RSA-SHA256';

function publicKeyObject(key) {
  return key?.type === 'public' ? key : createPublicKey(key);
}

function privateKeyObject(key) {
  return key?.type === 'private' ? key : createPrivateKey(key);
}

export function publicKeyFingerprint(key) {
  const der = publicKeyObject(key).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex');
}

export function assertRsaKey(key, role) {
  const details = key.asymmetricKeyDetails;
  if (key.asymmetricKeyType !== 'rsa' || !details || details.modulusLength < 2048) {
    throw new Error(`${role} key must be RSA with at least 2048 bits`);
  }
}

export function assertKeyPair(privateKey, publicKey) {
  const privateObject = privateKeyObject(privateKey);
  const publicObject = publicKeyObject(publicKey);
  assertRsaKey(privateObject, 'private');
  assertRsaKey(publicObject, 'public');
  const derived = createPublicKey(privateObject).export({ type: 'spki', format: 'der' });
  const supplied = publicObject.export({ type: 'spki', format: 'der' });
  if (derived.length !== supplied.length || !timingSafeEqual(derived, supplied)) throw new Error('private and public keys do not match');
}

export function signDetached(bytes, privateKey) {
  const key = privateKeyObject(privateKey);
  assertRsaKey(key, 'private');
  return sign(SIGNATURE_ALGORITHM, bytes, { key, padding: constants.RSA_PKCS1_PADDING });
}

export function verifyDetached(bytes, signature, publicKey, expectedFingerprint) {
  const key = publicKeyObject(publicKey);
  assertRsaKey(key, 'public');
  if (publicKeyFingerprint(key) !== expectedFingerprint) throw new Error('public key fingerprint mismatch');
  if (!verify(SIGNATURE_ALGORITHM, bytes, { key, padding: constants.RSA_PKCS1_PADDING }, signature)) throw new Error('detached signature verification failed');
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
