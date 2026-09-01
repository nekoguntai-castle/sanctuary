import { lstatSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, parseStrictJson } from './canonical-json.mjs';
import { readExternalFile } from './safe-file.mjs';

const FINGERPRINT = /^[a-f0-9]{64}$/;
const DEPLOYMENT_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const MAX_TRUST_BYTES = 16 * 1024;
const MAX_ROLE_KEYS = 2;
const MAX_VALIDITY_MS = 90 * 24 * 60 * 60 * 1000;

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('\0') !== [...expected].sort().join('\0')) {
    throw new Error('cleanup trust configuration fields are invalid');
  }
}

function timestamp(value, label) {
  const parsed = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`cleanup trust ${label} must be a canonical ISO timestamp`);
  }
  return parsed;
}

function roleFingerprints(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ROLE_KEYS
      || value.some((entry) => !FINGERPRINT.test(entry ?? ''))
      || new Set(value).size !== value.length) {
    throw new Error(`cleanup trust ${label} fingerprints are invalid or exceed rotation overlap`);
  }
  return value;
}

export function cleanupTrustPath(runtimeDirectory, deploymentId) {
  if (!DEPLOYMENT_ID.test(deploymentId ?? '')) throw new Error('cleanup trust deploymentId is invalid');
  return path.join(path.resolve(runtimeDirectory), 'ownership', 'deployments', deploymentId, 'cleanup-trust.json');
}

export function validateCleanupTrust(value, { deploymentId, now = new Date() } = {}) {
  exactKeys(value, [
    'trustVersion', 'deploymentId', 'validFrom', 'validUntil',
    'authorizationFingerprints', 'evidenceFingerprints',
  ]);
  if (value.trustVersion !== 1 || value.deploymentId !== deploymentId) {
    throw new Error('cleanup trust identity or version is invalid');
  }
  const validFrom = timestamp(value.validFrom, 'validFrom');
  const validUntil = timestamp(value.validUntil, 'validUntil');
  if (validUntil <= validFrom || validUntil - validFrom > MAX_VALIDITY_MS) {
    throw new Error('cleanup trust validity window is invalid or exceeds 90 days');
  }
  const authorization = roleFingerprints(value.authorizationFingerprints, 'authorization');
  const evidence = roleFingerprints(value.evidenceFingerprints, 'evidence');
  if (authorization.some((fingerprint) => evidence.includes(fingerprint))) {
    throw new Error('cleanup trust authorization and evidence keys must be distinct');
  }
  const instant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(instant.getTime()) || instant < validFrom || instant > validUntil) {
    throw new Error('cleanup trust configuration is not currently valid');
  }
  return value;
}

function assertOwnerOnly(filePath) {
  const parent = lstatSync(path.dirname(filePath));
  const info = lstatSync(filePath);
  if (!parent.isDirectory() || parent.isSymbolicLink()
      || (typeof process.getuid === 'function' && parent.uid !== process.getuid())
      || (parent.mode & 0o077) !== 0
      || !info.isFile() || info.isSymbolicLink()
      || (typeof process.getuid === 'function' && info.uid !== process.getuid())
      || (info.mode & 0o077) !== 0) {
    throw new Error('cleanup trust configuration and parent must be owner-only and non-symlink');
  }
}

export function verifyCleanupTrust({
  runtimeDirectory, checkoutRoot, deploymentId,
  authorizationFingerprint, evidenceFingerprint, now = new Date(),
}) {
  const filePath = cleanupTrustPath(runtimeDirectory, deploymentId);
  assertOwnerOnly(filePath);
  const bytes = readExternalFile(filePath, { checkoutRoot, maxBytes: MAX_TRUST_BYTES });
  const trust = parseStrictJson(bytes);
  if (!canonicalJson(trust).equals(bytes)) throw new Error('cleanup trust configuration must be canonical JSON');
  validateCleanupTrust(trust, { deploymentId, now });
  if (!trust.authorizationFingerprints.includes(authorizationFingerprint)
      || !trust.evidenceFingerprints.includes(evidenceFingerprint)) {
    throw new Error('cleanup signing fingerprints are not accepted by deployment trust');
  }
  return Object.freeze({ filePath, trust });
}
