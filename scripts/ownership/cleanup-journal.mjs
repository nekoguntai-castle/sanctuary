import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, writeSync,
} from 'node:fs';
import path from 'node:path';
import { canonicalJson, canonicalSha256, parseStrictJson } from './canonical-json.mjs';
import {
  publicKeyFingerprint, sha256, signDetached, verifyDetached,
} from './crypto.mjs';
import { assertLocalPrivateSafe } from './privacy.mjs';
import { validateCheckpointPayload, validateJournalProtocol } from './cleanup-journal-protocol.mjs';
import { MAX_CLEANUP_JOURNAL_BYTES } from './cleanup-schema-contract.mjs';

const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const CHECKPOINT_TYPES = new Set([
  'intent', 'result', 'reconciliation', 'cancellation', 'recovery', 'terminal',
]);
const MAX_RECORD_BYTES = 256 * 1024;
const MAX_RECORDS = 10_000;
const MAX_VALUE_DEPTH = 12;
const MAX_STRING_BYTES = 512;
const BOUNDED_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/@+~-]{0,511}$/;
const RAW_ERROR_KEY = /^(?:error|message|stack|stdout|stderr|command|commandOutput|rawError)$/i;

function assertDigest(value, label) {
  if (!DIGEST.test(value ?? '')) throw new Error(`${label} must be a SHA-256 digest`);
}

function assertId(value, label) {
  if (!ID.test(value ?? '')) throw new Error(`${label} has an invalid format`);
}

function assertTimestamp(value, label) {
  const parsed = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
}

function assertBoundedString(value, label) {
  if (Buffer.byteLength(value) > MAX_STRING_BYTES) throw new Error(`${label} contains an oversized string`);
  if (!BOUNDED_TOKEN.test(value)) throw new Error(`${label} must contain bounded identifiers or enums, not raw text`);
}

function assertBoundedArray(value, label, depth) {
  if (value.length > 1000) throw new Error(`${label} contains an oversized array`);
  value.forEach((child, index) => assertBoundedValue(child, `${label}[${index}]`, depth + 1));
}

function assertBoundedObject(value, label, depth) {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} contains an unsupported value`);
  }
  const entries = Object.entries(value);
  if (entries.length > 1000) throw new Error(`${label} contains an oversized object`);
  for (const [key, child] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key)) throw new Error(`${label} contains an invalid field name`);
    if (RAW_ERROR_KEY.test(key)) throw new Error(`${label} must use bounded failure classes, not raw errors`);
    assertBoundedValue(child, `${label}.${key}`, depth + 1);
  }
}

function assertBoundedValue(value, label = 'checkpoint payload', depth = 0) {
  if (depth > MAX_VALUE_DEPTH) throw new Error(`${label} exceeds the nesting limit`);
  if (typeof value === 'string') return assertBoundedString(value, label);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`${label} contains an invalid number`);
    return;
  }
  if (Array.isArray(value)) return assertBoundedArray(value, label, depth);
  assertBoundedObject(value, label, depth);
}

function assertOwnerDirectory(directory, { create = false } = {}) {
  const absolute = path.resolve(directory);
  if (create) mkdirSync(absolute, { mode: 0o700 });
  const info = lstatSync(absolute);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(absolute) !== absolute) {
    throw new Error('cleanup storage must be a real non-symlink directory');
  }
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    throw new Error('cleanup storage must be owned by the current user');
  }
  if ((info.mode & 0o077) !== 0) throw new Error('cleanup storage must be owner-only');
  return absolute;
}

function ensureChildDirectory(parent, name) {
  const safeParent = assertOwnerDirectory(parent);
  const child = path.join(safeParent, name);
  let created = false;
  try { mkdirSync(child, { mode: 0o700 }); created = true; } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const safeChild = assertOwnerDirectory(child);
  if (created) fsyncDirectory(safeParent);
  return safeChild;
}

function executionDirectory(runtimeDirectory, approvalDigest, { create = false } = {}) {
  assertDigest(approvalDigest, 'approvalDigest');
  const runtime = assertOwnerDirectory(runtimeDirectory);
  const ownership = create ? ensureChildDirectory(runtime, 'ownership') : assertOwnerDirectory(path.join(runtime, 'ownership'));
  const executions = create ? ensureChildDirectory(ownership, 'cleanup-executions') : assertOwnerDirectory(path.join(ownership, 'cleanup-executions'));
  return create ? ensureChildDirectory(executions, approvalDigest) : assertOwnerDirectory(path.join(executions, approvalDigest));
}

export function deriveCleanupJournalPath({ runtimeDirectory, approvalDigest }) {
  assertDigest(approvalDigest, 'approvalDigest');
  return path.join(path.resolve(runtimeDirectory), 'ownership', 'cleanup-executions', approvalDigest, 'action-journal.jsonl');
}

function fsyncDirectory(directory) {
  const descriptor = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function writeAll(descriptor, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
    if (written === 0) throw new Error('cleanup journal write made no progress');
    offset += written;
  }
}

function stableRead(filePath) {
  const before = lstatSync(filePath);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('cleanup journal must be a regular non-symlink file');
  if ((typeof process.getuid === 'function' && before.uid !== process.getuid()) || (before.mode & 0o077) !== 0) {
    throw new Error('cleanup journal must be owner-only');
  }
  if (before.size > MAX_CLEANUP_JOURNAL_BYTES) throw new Error('cleanup journal exceeds the byte limit');
  const descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const final = lstatSync(filePath);
    if (opened.dev !== before.dev || opened.ino !== before.ino || after.dev !== before.dev
      || after.ino !== before.ino || final.dev !== before.dev || final.ino !== before.ino
      || after.size !== bytes.length || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      throw new Error('cleanup journal changed while reading');
    }
    return { bytes, identity: { dev: opened.dev, ino: opened.ino } };
  } finally { closeSync(descriptor); }
}

function recordBytes(checkpoint, privateKey) {
  const checkpointBytes = canonicalJson(checkpoint);
  const envelope = {
    checkpoint,
    signature: signDetached(checkpointBytes, privateKey).toString('base64'),
  };
  const bytes = canonicalJson(envelope);
  if (bytes.length > MAX_RECORD_BYTES) throw new Error('cleanup journal record exceeds the byte limit');
  return { envelope, bytes, digest: sha256(bytes) };
}

function assertCheckpoint(checkpoint, { expectedSequence, expectedPreviousDigest }) {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) throw new Error('cleanup journal checkpoint is malformed');
  const expectedKeys = [
    'approvalDigest', 'checkpointType', 'deploymentId', 'operationRunId', 'payload',
    'previousDigest', 'recordedAt', 'sequence', 'signerKeyId', 'version',
  ];
  if (Object.keys(checkpoint).sort().join('\0') !== expectedKeys.sort().join('\0')) {
    throw new Error('cleanup journal checkpoint fields are invalid');
  }
  if (checkpoint.version !== 1) throw new Error('cleanup journal checkpoint version is unsupported');
  if (checkpoint.sequence !== expectedSequence) throw new Error('cleanup journal sequence is invalid');
  if (checkpoint.previousDigest !== expectedPreviousDigest) throw new Error('cleanup journal hash chain is broken');
  assertDigest(checkpoint.approvalDigest, 'checkpoint approvalDigest');
  assertDigest(checkpoint.signerKeyId, 'checkpoint signerKeyId');
  assertId(checkpoint.deploymentId, 'checkpoint deploymentId');
  assertId(checkpoint.operationRunId, 'checkpoint operationRunId');
  assertTimestamp(checkpoint.recordedAt, 'checkpoint recordedAt');
  if (expectedSequence === 0 ? checkpoint.checkpointType !== 'genesis' : !CHECKPOINT_TYPES.has(checkpoint.checkpointType)) {
    throw new Error('cleanup journal checkpoint type is invalid');
  }
  assertBoundedValue(checkpoint.payload);
  assertLocalPrivateSafe(checkpoint.payload);
  validateCheckpointPayload(checkpoint.checkpointType, checkpoint.payload);
}

function parseLines(bytes) {
  if (bytes.length === 0 || bytes[bytes.length - 1] !== 0x0a) throw new Error('cleanup journal is empty or torn');
  const lines = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0x0a) continue;
    lines.push(bytes.subarray(start, index));
    start = index + 1;
  }
  if (lines.length > MAX_RECORDS) throw new Error('cleanup journal exceeds the record limit');
  return lines.map((lineBytes) => {
    if (lineBytes.length === 0 || lineBytes.length > MAX_RECORD_BYTES) throw new Error('cleanup journal contains an invalid record length');
    const envelope = parseStrictJson(lineBytes);
    if (!canonicalJson(envelope).equals(lineBytes)) throw new Error('cleanup journal record is not canonical JSON');
    return { envelope, bytes: lineBytes, digest: sha256(lineBytes) };
  });
}

export function verifyCleanupJournal({
  runtimeDirectory, approvalDigest, publicKey, expectedSignerKeyId,
  expectedGenesisDigest,
}) {
  assertDigest(approvalDigest, 'approvalDigest');
  assertDigest(expectedSignerKeyId, 'expectedSignerKeyId');
  if (expectedGenesisDigest !== undefined) assertDigest(expectedGenesisDigest, 'expectedGenesisDigest');
  if (publicKeyFingerprint(publicKey) !== expectedSignerKeyId) throw new Error('cleanup journal signer key mismatch');
  const directory = executionDirectory(runtimeDirectory, approvalDigest);
  const journalPath = path.join(directory, 'action-journal.jsonl');
  const stable = stableRead(journalPath);
  const records = parseLines(stable.bytes);
  let previousDigest = null;
  let identity;
  records.forEach((record, sequence) => {
    const { envelope } = record;
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
      || Object.keys(envelope).sort().join('\0') !== 'checkpoint\0signature') {
      throw new Error('cleanup journal envelope is malformed');
    }
    assertCheckpoint(envelope.checkpoint, { expectedSequence: sequence, expectedPreviousDigest: previousDigest });
    if (envelope.checkpoint.approvalDigest !== approvalDigest) throw new Error('cleanup journal approval identity mismatch');
    if (envelope.checkpoint.signerKeyId !== expectedSignerKeyId) throw new Error('cleanup journal checkpoint signer mismatch');
    let signature;
    try { signature = Buffer.from(envelope.signature, 'base64'); } catch { throw new Error('cleanup journal signature encoding is invalid'); }
    if (signature.length === 0 || signature.toString('base64') !== envelope.signature) throw new Error('cleanup journal signature encoding is invalid');
    verifyDetached(canonicalJson(envelope.checkpoint), signature, publicKey, expectedSignerKeyId);
    if (sequence === 0) identity = {
      approvalDigest: envelope.checkpoint.approvalDigest,
      deploymentId: envelope.checkpoint.deploymentId,
      operationRunId: envelope.checkpoint.operationRunId,
      signerKeyId: envelope.checkpoint.signerKeyId,
    };
    for (const key of ['deploymentId', 'operationRunId', 'signerKeyId']) {
      if (envelope.checkpoint[key] !== identity[key]) throw new Error(`cleanup journal ${key} changed`);
    }
    previousDigest = record.digest;
  });
  const genesisDigest = records[0].digest;
  if (expectedGenesisDigest !== undefined && genesisDigest !== expectedGenesisDigest) {
    throw new Error('cleanup journal genesis identity mismatch');
  }
  const verifiedRecords = records.map(({ envelope, digest }) => ({ ...envelope, digest }));
  const protocol = validateJournalProtocol(verifiedRecords);
  return {
    journalPath, identity, genesisDigest, headDigest: previousDigest,
    recordCount: records.length, bytes: stable.bytes.length, records: verifiedRecords,
    protocol,
    fileIdentity: stable.identity,
  };
}

export function createCleanupJournal({
  runtimeDirectory, approvalDigest, deploymentId, operationRunId, signerKeyId,
  privateKey, createdAt = new Date().toISOString(), payload = {},
}) {
  assertDigest(approvalDigest, 'approvalDigest');
  assertDigest(signerKeyId, 'signerKeyId');
  assertId(deploymentId, 'deploymentId');
  assertId(operationRunId, 'operationRunId');
  assertTimestamp(createdAt, 'createdAt');
  if (publicKeyFingerprint(privateKey) !== signerKeyId) throw new Error('cleanup journal private key does not match signerKeyId');
  assertBoundedValue(payload);
  assertLocalPrivateSafe(payload);
  const directory = executionDirectory(runtimeDirectory, approvalDigest, { create: true });
  const journalPath = path.join(directory, 'action-journal.jsonl');
  const checkpoint = {
    version: 1, sequence: 0, checkpointType: 'genesis', previousDigest: null,
    approvalDigest, deploymentId, operationRunId, signerKeyId, recordedAt: createdAt, payload,
  };
  assertCheckpoint(checkpoint, { expectedSequence: 0, expectedPreviousDigest: null });
  const record = recordBytes(checkpoint, privateKey);
  let descriptor;
  try {
    descriptor = openSync(journalPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = verifyCleanupJournal({
      runtimeDirectory, approvalDigest, publicKey: privateKey,
      expectedSignerKeyId: signerKeyId,
    });
    const { recordedAt: _existingTime, ...existingIntent } = existing.records[0].checkpoint;
    const { recordedAt: _requestedTime, ...requestedIntent } = checkpoint;
    if (existing.recordCount !== 1 || canonicalSha256(existingIntent) !== canonicalSha256(requestedIntent)) {
      throw new Error('cleanup journal genesis collision');
    }
    return {
      journalPath, genesisDigest: existing.genesisDigest, headDigest: existing.headDigest,
      recordCount: existing.recordCount, bytes: existing.bytes,
      checkpoint: existing.records[0].checkpoint,
    };
  }
  try { writeAll(descriptor, Buffer.concat([record.bytes, Buffer.from('\n')])); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  fsyncDirectory(directory);
  return {
    journalPath, genesisDigest: record.digest, headDigest: record.digest,
    recordCount: 1, bytes: record.bytes.length + 1, checkpoint,
  };
}

export function prepareCleanupCheckpoint({
  runtimeDirectory, approvalDigest, expectedGenesisDigest, expectedHeadDigest,
  checkpointType, payload = {}, signerKeyId, privateKey,
  recordedAt = new Date().toISOString(), publicKey,
}) {
  assertDigest(expectedGenesisDigest, 'expectedGenesisDigest');
  assertDigest(expectedHeadDigest, 'expectedHeadDigest');
  assertDigest(signerKeyId, 'signerKeyId');
  assertTimestamp(recordedAt, 'recordedAt');
  if (publicKeyFingerprint(privateKey) !== signerKeyId) throw new Error('cleanup journal private key does not match signerKeyId');
  const verificationKey = publicKey ?? privateKey;
  const current = verifyCleanupJournal({
    runtimeDirectory, approvalDigest, publicKey: verificationKey,
    expectedSignerKeyId: signerKeyId, expectedGenesisDigest,
  });
  if (current.headDigest !== expectedHeadDigest) throw new Error('cleanup journal head compare-and-swap failed');
  if (current.recordCount >= MAX_RECORDS) throw new Error('cleanup journal exceeds the record limit');
  const checkpoint = {
    version: 1, sequence: current.recordCount, checkpointType,
    previousDigest: current.headDigest, approvalDigest,
    deploymentId: current.identity.deploymentId,
    operationRunId: current.identity.operationRunId,
    signerKeyId, recordedAt, payload,
  };
  assertCheckpoint(checkpoint, { expectedSequence: current.recordCount, expectedPreviousDigest: current.headDigest });
  const record = recordBytes(checkpoint, privateKey);
  if (current.bytes + record.bytes.length + 1 > MAX_CLEANUP_JOURNAL_BYTES) throw new Error('cleanup journal exceeds the byte limit');
  validateJournalProtocol([...current.records, { ...record.envelope, digest: record.digest }]);
  return {
    journalPath: current.journalPath,
    genesisDigest: current.genesisDigest,
    expectedHeadDigest: current.headDigest,
    headDigest: record.digest,
    priorRecordCount: current.recordCount,
    priorBytes: current.bytes,
    recordCount: current.recordCount + 1,
    bytes: current.bytes + record.bytes.length + 1,
    checkpoint,
    envelope: record.envelope,
  };
}

export function appendPreparedCleanupCheckpoint({
  runtimeDirectory, approvalDigest, expectedGenesisDigest, expectedHeadDigest,
  prepared, signerKeyId, publicKey,
}) {
  assertDigest(expectedGenesisDigest, 'expectedGenesisDigest');
  assertDigest(expectedHeadDigest, 'expectedHeadDigest');
  assertDigest(signerKeyId, 'signerKeyId');
  if (!prepared || typeof prepared !== 'object' || Array.isArray(prepared)) {
    throw new Error('prepared cleanup checkpoint is invalid');
  }
  const current = verifyCleanupJournal({
    runtimeDirectory, approvalDigest, publicKey,
    expectedSignerKeyId: signerKeyId, expectedGenesisDigest,
  });
  if (current.headDigest !== expectedHeadDigest || prepared.expectedHeadDigest !== expectedHeadDigest) {
    throw new Error('cleanup journal head compare-and-swap failed');
  }
  assertCheckpoint(prepared.checkpoint, {
    expectedSequence: current.recordCount, expectedPreviousDigest: current.headDigest,
  });
  if (prepared.checkpoint.approvalDigest !== approvalDigest
      || prepared.checkpoint.deploymentId !== current.identity.deploymentId
      || prepared.checkpoint.operationRunId !== current.identity.operationRunId
      || prepared.checkpoint.signerKeyId !== signerKeyId) {
    throw new Error('prepared cleanup checkpoint identity mismatch');
  }
  const bytes = canonicalJson(prepared.envelope);
  if (!prepared.envelope || !canonicalJson(prepared.envelope.checkpoint).equals(canonicalJson(prepared.checkpoint))) {
    throw new Error('prepared cleanup checkpoint envelope mismatch');
  }
  let signature;
  try { signature = Buffer.from(prepared.envelope.signature, 'base64'); } catch {
    throw new Error('prepared cleanup checkpoint signature encoding is invalid');
  }
  if (signature.length === 0 || signature.toString('base64') !== prepared.envelope.signature) {
    throw new Error('prepared cleanup checkpoint signature encoding is invalid');
  }
  verifyDetached(canonicalJson(prepared.checkpoint), signature, publicKey, signerKeyId);
  const recordDigest = sha256(bytes);
  if (recordDigest !== prepared.headDigest
      || prepared.priorRecordCount !== current.recordCount
      || prepared.priorBytes !== current.bytes
      || prepared.recordCount !== current.recordCount + 1
      || prepared.bytes !== current.bytes + bytes.length + 1) {
    throw new Error('prepared cleanup checkpoint metadata mismatch');
  }
  validateJournalProtocol([...current.records, {
    checkpoint: prepared.checkpoint, signature: prepared.envelope.signature, digest: recordDigest,
  }]);
  if (prepared.recordCount > MAX_RECORDS) throw new Error('cleanup journal exceeds the record limit');
  if (prepared.bytes > MAX_CLEANUP_JOURNAL_BYTES || bytes.length > MAX_RECORD_BYTES) {
    throw new Error('cleanup journal exceeds the byte limit');
  }
  const descriptor = openSync(current.journalPath, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    if (opened.dev !== current.fileIdentity.dev || opened.ino !== current.fileIdentity.ino || opened.size !== current.bytes) {
      throw new Error('cleanup journal changed before append');
    }
    writeAll(descriptor, Buffer.concat([bytes, Buffer.from('\n')]));
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
  fsyncDirectory(path.dirname(current.journalPath));
  return {
    journalPath: current.journalPath, genesisDigest: current.genesisDigest,
    headDigest: recordDigest, recordCount: current.recordCount + 1,
    bytes: current.bytes + bytes.length + 1, checkpoint: prepared.checkpoint,
  };
}

export function appendCleanupCheckpoint(options) {
  const prepared = prepareCleanupCheckpoint(options);
  return appendPreparedCleanupCheckpoint({
    runtimeDirectory: options.runtimeDirectory,
    approvalDigest: options.approvalDigest,
    expectedGenesisDigest: options.expectedGenesisDigest,
    expectedHeadDigest: options.expectedHeadDigest,
    prepared,
    signerKeyId: options.signerKeyId,
    publicKey: options.publicKey ?? options.privateKey,
  });
}
