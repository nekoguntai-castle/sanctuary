import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, parseStrictJson } from './canonical-json.mjs';
import { readExternalFile, writeExternalFileAtomic } from './safe-file.mjs';

const PREPARED_KEYS = Object.freeze([
  'correlationEnvelope', 'assertionEnvelope', 'scopeEnvelope',
  'dryRunEnvelope', 'approvalEnvelope',
]);

function safeRoot(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const root = path.resolve(directory);
  const info = lstatSync(root);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(root) !== root
      || (typeof process.getuid === 'function' && info.uid !== process.getuid())
      || (info.mode & 0o077) !== 0) {
    throw new Error('operator recovery store must be owner-only and non-symlink');
  }
  return root;
}

function writeExact(filePath, value, checkoutRoot) {
  const bytes = canonicalJson(value);
  if (existsSync(filePath)) {
    if (!readExternalFile(filePath, { checkoutRoot }).equals(bytes)) {
      throw new Error(`operator recovery store collision: ${path.basename(filePath)}`);
    }
    return;
  }
  writeExternalFileAtomic(filePath, bytes, { checkoutRoot });
}

export function persistPreparedOperatorRecovery(directory, prepared, checkoutRoot) {
  const root = safeRoot(directory);
  for (const key of PREPARED_KEYS) {
    if (!prepared?.[key]) throw new Error(`prepared recovery is missing ${key}`);
  }
  writeExact(path.join(root, 'prepared-bundle.json'), Object.fromEntries(
    PREPARED_KEYS.map((key) => [key, prepared[key]]),
  ), checkoutRoot);
  return root;
}

export function loadPreparedOperatorRecovery(directory, checkoutRoot) {
  const root = safeRoot(directory);
  const prepared = parseStrictJson(readExternalFile(
    path.join(root, 'prepared-bundle.json'), { checkoutRoot },
  ));
  if (!prepared || typeof prepared !== 'object' || Array.isArray(prepared)
      || Object.keys(prepared).sort().join('\0') !== [...PREPARED_KEYS].sort().join('\0')) {
    throw new Error('operator recovery prepared bundle fields are invalid');
  }
  return Object.freeze(prepared);
}

export function persistExecutedOperatorRecovery(directory, executed, checkoutRoot) {
  const root = safeRoot(directory);
  writeExact(path.join(root, 'execution-bundle.json'), {
    freshCorrelationEnvelope: executed.freshCorrelationEnvelope,
    receiptEnvelope: executed.receiptEnvelope,
  }, checkoutRoot);
  return root;
}

export function loadExecutedOperatorRecovery(directory, checkoutRoot) {
  const prepared = loadPreparedOperatorRecovery(directory, checkoutRoot);
  const root = safeRoot(directory);
  const executed = parseStrictJson(readExternalFile(
    path.join(root, 'execution-bundle.json'), { checkoutRoot },
  ));
  if (!executed || typeof executed !== 'object' || Array.isArray(executed)
      || Object.keys(executed).sort().join('\0')
        !== ['freshCorrelationEnvelope', 'receiptEnvelope'].sort().join('\0')) {
    throw new Error('operator recovery execution bundle fields are invalid');
  }
  return Object.freeze({
    scopeEnvelope: prepared.scopeEnvelope,
    approvalEnvelope: prepared.approvalEnvelope,
    receiptEnvelope: executed.receiptEnvelope,
    freshCorrelationEnvelope: executed.freshCorrelationEnvelope,
  });
}

export function persistOperatorRecoveryIncidentArtifact(directory, filename, envelope, checkoutRoot) {
  if (!['sentinel-before.json', 'sentinel-after.json', 'closeout.json'].includes(filename)) {
    throw new Error('operator recovery incident artifact filename is invalid');
  }
  const root = safeRoot(directory);
  writeExact(path.join(root, filename), envelope, checkoutRoot);
  return root;
}

export function loadOperatorRecoveryIncidentArtifact(directory, filename, checkoutRoot) {
  if (!['sentinel-before.json', 'sentinel-after.json', 'closeout.json'].includes(filename)) {
    throw new Error('operator recovery incident artifact filename is invalid');
  }
  return parseStrictJson(readExternalFile(
    path.join(safeRoot(directory), filename), { checkoutRoot },
  ));
}
