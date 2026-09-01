import { existsSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, parseStrictJson } from './canonical-json.mjs';
import {
  assertKeyPair, publicKeyFingerprint, sha256, signDetached, verifyDetached,
} from './crypto.mjs';
import { assertLocalPrivateSafe } from './privacy.mjs';
import {
  readExternalFile, readPrivateKeyFile, writeExternalFileAtomic,
} from './safe-file.mjs';
import { validateArtifact } from './schemas.mjs';

function sidecarPaths(outputPath) {
  const checksumPath = outputPath.endsWith('.json')
    ? `${outputPath.slice(0, -'.json'.length)}.sha256` : `${outputPath}.sha256`;
  return { signaturePath: `${outputPath}.sig`, checksumPath };
}

function readKey(filePath, checkoutRoot) {
  return readExternalFile(path.resolve(filePath), { checkoutRoot, maxBytes: 64 * 1024 });
}

function readPrivateKey(filePath, checkoutRoot) {
  return readPrivateKeyFile(path.resolve(filePath), { checkoutRoot });
}

function assertSigner(artifact, publicKey, expectedFingerprint) {
  const fingerprint = publicKeyFingerprint(publicKey);
  if (fingerprint !== expectedFingerprint) throw new Error('public key fingerprint does not match trusted fingerprint');
  if (artifact.signerKeyId !== fingerprint) throw new Error('artifact signerKeyId does not match trusted key');
}

function exactExisting(filePath, expected, checkoutRoot) {
  if (!existsSync(filePath)) return false;
  const actual = readExternalFile(filePath, { checkoutRoot });
  if (!actual.equals(expected)) throw new Error(`signed artifact output collision: ${filePath}`);
  return true;
}

export function prepareSignedArtifact(artifact, {
  outputPath,
  privateKeyPath,
  publicKeyPath,
  expectedFingerprint,
  checkoutRoot,
} = {}) {
  validateArtifact(artifact);
  assertLocalPrivateSafe(artifact);
  const privateKey = readPrivateKey(privateKeyPath, checkoutRoot);
  const publicKey = readKey(publicKeyPath, checkoutRoot);
  assertKeyPair(privateKey, publicKey);
  assertSigner(artifact, publicKey, expectedFingerprint);
  const bytes = canonicalJson(artifact);
  const signature = signDetached(bytes, privateKey);
  const checksum = Buffer.from(sha256(bytes), 'ascii');
  const target = path.resolve(outputPath);
  const sidecars = sidecarPaths(target);
  const entries = [
    [target, bytes], [sidecars.signaturePath, signature], [sidecars.checksumPath, checksum],
  ];
  entries.forEach(([filePath, expected]) => exactExisting(filePath, expected, checkoutRoot));
  return {
    outputPath: target, ...sidecars, digest: checksum.toString('ascii'), entries, checkoutRoot,
  };
}

export function writePreparedSignedArtifact(prepared) {
  for (let index = 0; index < prepared.entries.length; index += 1) {
    writePreparedSignedArtifactEntry(prepared, index);
  }
  const { entries: _entries, checkoutRoot: _checkoutRoot, ...result } = prepared;
  return result;
}

export function writePreparedSignedArtifactEntry(prepared, index) {
  if (!prepared || !Array.isArray(prepared.entries)
      || !Number.isSafeInteger(index) || index < 0 || index >= prepared.entries.length) {
    throw new TypeError('prepared signed artifact entry index is invalid');
  }
  const [filePath, expected] = prepared.entries[index];
  if (!exactExisting(filePath, expected, prepared.checkoutRoot)) {
    writeExternalFileAtomic(filePath, expected, { checkoutRoot: prepared.checkoutRoot });
  }
  return filePath;
}

export function writeSignedArtifact(artifact, options = {}) {
  return writePreparedSignedArtifact(prepareSignedArtifact(artifact, options));
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
