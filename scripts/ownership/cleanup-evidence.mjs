import { existsSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, parseStrictJson } from './canonical-json.mjs';
import {
  assertKeyPair, publicKeyFingerprint, sha256, signDetached, verifyDetached,
} from './crypto.mjs';
import { assertLocalPrivateSafe } from './privacy.mjs';
import { readExternalFile, writeExternalFileAtomic } from './safe-file.mjs';
import { validateArtifact } from './schemas.mjs';

function sidecarPaths(outputPath) {
  const checksumPath = outputPath.endsWith('.json')
    ? `${outputPath.slice(0, -'.json'.length)}.sha256` : `${outputPath}.sha256`;
  return { signaturePath: `${outputPath}.sig`, checksumPath };
}

function readKey(filePath, checkoutRoot) {
  return readExternalFile(path.resolve(filePath), { checkoutRoot, maxBytes: 64 * 1024 });
}

function assertSigner(artifact, publicKey, expectedFingerprint) {
  const fingerprint = publicKeyFingerprint(publicKey);
  if (fingerprint !== expectedFingerprint) throw new Error('public key fingerprint does not match trusted fingerprint');
  if (artifact.signerKeyId !== fingerprint) throw new Error('artifact signerKeyId does not match trusted key');
}

export function writeSignedArtifact(artifact, {
  outputPath,
  privateKeyPath,
  publicKeyPath,
  expectedFingerprint,
  checkoutRoot,
} = {}) {
  validateArtifact(artifact);
  assertLocalPrivateSafe(artifact);
  const privateKey = readKey(privateKeyPath, checkoutRoot);
  const publicKey = readKey(publicKeyPath, checkoutRoot);
  assertKeyPair(privateKey, publicKey);
  assertSigner(artifact, publicKey, expectedFingerprint);
  const bytes = canonicalJson(artifact);
  const signature = signDetached(bytes, privateKey);
  const checksum = Buffer.from(sha256(bytes), 'ascii');
  const target = path.resolve(outputPath);
  const sidecars = sidecarPaths(target);
  for (const candidate of [target, sidecars.signaturePath, sidecars.checksumPath]) {
    if (existsSync(candidate)) throw new Error(`signed artifact output already exists: ${candidate}`);
  }
  writeExternalFileAtomic(target, bytes, { checkoutRoot });
  writeExternalFileAtomic(sidecars.signaturePath, signature, { checkoutRoot });
  writeExternalFileAtomic(sidecars.checksumPath, checksum, { checkoutRoot });
  return { outputPath: target, ...sidecars, digest: checksum.toString('ascii') };
}

export function verifySignedArtifact({
  inputPath,
  signaturePath = `${inputPath}.sig`,
  checksumPath,
  publicKeyPath,
  expectedFingerprint,
  checkoutRoot,
  now = new Date(),
} = {}) {
  const resolvedChecksumPath = checksumPath ?? sidecarPaths(inputPath).checksumPath;
  const bytes = readExternalFile(path.resolve(inputPath), { checkoutRoot });
  const signature = readExternalFile(path.resolve(signaturePath), { checkoutRoot });
  const expectedChecksum = readExternalFile(path.resolve(resolvedChecksumPath), { checkoutRoot, maxBytes: 128 }).toString('ascii');
  if (!/^[a-f0-9]{64}$/.test(expectedChecksum) || sha256(bytes) !== expectedChecksum) {
    throw new Error('artifact checksum verification failed');
  }
  const publicKey = readKey(publicKeyPath, checkoutRoot);
  const artifact = parseStrictJson(bytes);
  validateArtifact(artifact, { now });
  assertLocalPrivateSafe(artifact);
  assertSigner(artifact, publicKey, expectedFingerprint);
  verifyDetached(bytes, signature, publicKey, expectedFingerprint);
  return { artifact, digest: expectedChecksum };
}
