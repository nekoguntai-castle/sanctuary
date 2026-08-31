#!/usr/bin/env node
import path from 'node:path';
import { canonicalJson, parseStrictJson } from './canonical-json.mjs';
import { publicKeyFingerprint, sha256, verifyDetached } from './crypto.mjs';
import { assertUploadSafe } from './privacy.mjs';
import { readExternalFile } from './safe-file.mjs';
import { validateArtifact } from './schemas.mjs';

const FLAGS = new Set(['--repo', '--input', '--signature', '--public-key', '--expected-fingerprint', '--expected-sha256', '--upload-safe', '--now']);

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!FLAGS.has(flag) || value === undefined || values.has(flag)) throw new Error('invalid, duplicate, or incomplete argument');
    values.set(flag, value);
  }
  for (const required of ['--repo', '--input']) if (!values.has(required)) throw new Error(`missing ${required}`);
  const cryptoFlags = ['--signature', '--public-key', '--expected-fingerprint'];
  const cryptoCount = cryptoFlags.filter((flag) => values.has(flag)).length;
  if (cryptoCount !== 0 && cryptoCount !== cryptoFlags.length) throw new Error('signature verification arguments must be supplied together');
  return values;
}

function verifyArtifact(argumentsMap) {
  const root = path.resolve(argumentsMap.get('--repo'));
  const input = readExternalFile(argumentsMap.get('--input'), { checkoutRoot: root });
  const artifact = validateArtifact(parseStrictJson(input), {
    now: argumentsMap.has('--now') ? new Date(argumentsMap.get('--now')) : new Date(),
  });
  const canonical = canonicalJson(artifact);
  if (!input.equals(canonical)) throw new Error('artifact bytes are not canonical');
  const payloadDigest = sha256(canonical);
  if (argumentsMap.has('--expected-sha256') && argumentsMap.get('--expected-sha256') !== payloadDigest) throw new Error('artifact digest mismatch');
  if (argumentsMap.get('--upload-safe') === 'true') assertUploadSafe(artifact);
  if (argumentsMap.has('--signature')) {
    const signature = readExternalFile(argumentsMap.get('--signature'), { checkoutRoot: root, maxBytes: 16 * 1024 });
    const publicKeyPath = argumentsMap.get('--public-key');
    const publicKey = readExternalFile(publicKeyPath, { checkoutRoot: root, maxBytes: 16 * 1024 });
    verifyDetached(canonical, signature, publicKey, argumentsMap.get('--expected-fingerprint'));
    return { artifactType: artifact.artifactType, payloadDigest, keyId: publicKeyFingerprint(publicKey) };
  }
  return { artifactType: artifact.artifactType, payloadDigest };
}

try {
  const result = verifyArtifact(parseArguments(process.argv.slice(2)));
  console.log(`valid ${result.artifactType} sha256=${result.payloadDigest}${result.keyId ? ` keyId=${result.keyId}` : ''}`);
} catch (error) {
  console.error(`ownership artifact verification failed: ${error.message}`);
  process.exitCode = 1;
}
