import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeSync,
} from 'node:fs';
import path from 'node:path';
import { canonicalJson, canonicalSha256, parseStrictJson } from './canonical-json.mjs';

const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const TERMINAL_OUTCOMES = new Set([
  'no_op', 'cleaned', 'partial', 'cancelled', 'refused', 'ambiguous', 'recovered',
]);

function assertDigest(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return;
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

function assertOwnerDirectory(directory, { create = false } = {}) {
  const absolute = path.resolve(directory);
  if (create) mkdirSync(absolute, { mode: 0o700 });
  const info = lstatSync(absolute);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(absolute) !== absolute) {
    throw new Error('cleanup ledger storage must be a real non-symlink directory');
  }
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    throw new Error('cleanup ledger storage must be owned by the current user');
  }
  if ((info.mode & 0o077) !== 0) throw new Error('cleanup ledger storage must be owner-only');
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

function fsyncDirectory(directory) {
  const descriptor = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function writeAll(descriptor, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
    if (written === 0) throw new Error('cleanup ledger write made no progress');
    offset += written;
  }
}

function writeCreateOnly(filePath, bytes) {
  const descriptor = openSync(filePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeAll(descriptor, bytes); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  fsyncDirectory(path.dirname(filePath));
}

function stableRead(filePath) {
  const before = lstatSync(filePath);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('cleanup ledger file must be a regular non-symlink file');
  if ((typeof process.getuid === 'function' && before.uid !== process.getuid()) || (before.mode & 0o077) !== 0) {
    throw new Error('cleanup ledger file must be owner-only');
  }
  if (before.size > 256 * 1024) throw new Error('cleanup ledger file exceeds the byte limit');
  const descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const final = lstatSync(filePath);
    if (opened.dev !== before.dev || opened.ino !== before.ino || after.dev !== before.dev
      || after.ino !== before.ino || final.dev !== before.dev || final.ino !== before.ino
      || after.size !== bytes.length || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      throw new Error('cleanup ledger file changed while reading');
    }
    const value = parseStrictJson(bytes);
    if (!canonicalJson(value).equals(bytes)) throw new Error('cleanup ledger file is not canonical JSON');
    return { value, digest: canonicalSha256(value) };
  } finally { closeSync(descriptor); }
}

function readOptional(filePath) {
  try { return stableRead(filePath); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function atomicReplace(filePath, bytes) {
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeCreateOnly(temporary, bytes);
  try { renameSync(temporary, filePath); } catch (error) {
    try { unlinkSync(temporary); } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') throw cleanupError;
    }
    throw error;
  }
  fsyncDirectory(path.dirname(filePath));
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) {
    throw new Error(`${label} fields are invalid`);
  }
}

function validateApprovalState(value, approvalDigest) {
  const common = ['approvalDigest', 'generation', 'priorStateDigest', 'state', 'transitionedAt', 'version'];
  const stateKeys = {
    unused: common,
    reserved: [...common, 'journalGenesisDigest', 'operationRunId'],
    finalized: [
      ...common, 'finalJournalDigest', 'inventoryAfterDigest', 'journalGenesisDigest',
      'operationRunId', 'receiptCoreDigest', 'terminalOutcome',
    ],
  };
  exactKeys(value, stateKeys[value?.state] ?? [], 'approval state');
  if (value.version !== 1) throw new Error('approval state version is unsupported');
  assertDigest(value.approvalDigest, 'approval state approvalDigest');
  if (value.approvalDigest !== approvalDigest) throw new Error('approval state identity mismatch');
  if (!Number.isSafeInteger(value.generation) || value.generation < 1) throw new Error('approval state generation is invalid');
  assertTimestamp(value.transitionedAt, 'approval state transitionedAt');
  assertDigest(value.priorStateDigest, 'approval state priorStateDigest', { nullable: true });
  if (value.state === 'unused') {
    if (value.generation !== 1 || value.priorStateDigest !== null) throw new Error('unused approval state is not initial');
    return value;
  }
  assertId(value.operationRunId, 'approval state operationRunId');
  assertDigest(value.journalGenesisDigest, 'approval state journalGenesisDigest');
  if (value.state === 'finalized') {
    assertDigest(value.finalJournalDigest, 'approval state finalJournalDigest');
    assertDigest(value.inventoryAfterDigest, 'approval state inventoryAfterDigest');
    assertDigest(value.receiptCoreDigest, 'approval state receiptCoreDigest');
    if (!TERMINAL_OUTCOMES.has(value.terminalOutcome)) throw new Error('approval state terminalOutcome is invalid');
  }
  return value;
}

function validateActivePointer(value, deploymentId) {
  const common = [
    'approvalDigest', 'deploymentId', 'generation', 'journalGenesisDigest',
    'operationRunId', 'priorPointerDigest', 'state', 'transitionedAt', 'version',
  ];
  const keys = value?.state === 'tombstoned'
    ? [...common, 'checksumDigest', 'disposition', 'receiptDigest', 'signatureDigest'] : common;
  exactKeys(value, keys, 'active cleanup pointer');
  if (value.version !== 1 || !['active', 'tombstoned'].includes(value.state)) {
    throw new Error('active cleanup pointer version or state is invalid');
  }
  assertId(value.deploymentId, 'active cleanup pointer deploymentId');
  if (value.deploymentId !== deploymentId) throw new Error('active cleanup pointer deployment identity mismatch');
  assertDigest(value.approvalDigest, 'active cleanup pointer approvalDigest');
  assertDigest(value.journalGenesisDigest, 'active cleanup pointer journalGenesisDigest');
  assertId(value.operationRunId, 'active cleanup pointer operationRunId');
  assertDigest(value.priorPointerDigest, 'active cleanup pointer priorPointerDigest', { nullable: true });
  if (!Number.isSafeInteger(value.generation) || value.generation < 1) throw new Error('active cleanup pointer generation is invalid');
  assertTimestamp(value.transitionedAt, 'active cleanup pointer transitionedAt');
  if (value.state === 'tombstoned') {
    if (!['pre_reservation', 'receipt_verified'].includes(value.disposition)) {
      throw new Error('active cleanup pointer tombstone disposition is invalid');
    }
    const nullable = value.disposition === 'pre_reservation';
    assertDigest(value.receiptDigest, 'active cleanup pointer receiptDigest', { nullable });
    assertDigest(value.signatureDigest, 'active cleanup pointer signatureDigest', { nullable });
    assertDigest(value.checksumDigest, 'active cleanup pointer checksumDigest', { nullable });
    if (nullable && [value.receiptDigest, value.signatureDigest, value.checksumDigest].some((digest) => digest !== null)) {
      throw new Error('pre-reservation pointer tombstone cannot bind receipt sidecars');
    }
  }
  return value;
}

function currentRecord(filePath, validator) {
  const record = readOptional(filePath);
  if (!record) return null;
  validator(record.value);
  return record;
}

function assertExpected(current, expectedDigest, label) {
  if ((current?.digest ?? null) !== expectedDigest) throw new Error(`${label} compare-and-swap failed`);
}

function sameTransitionIntent(left, right) {
  if (!left || !right) return false;
  const { transitionedAt: _leftTime, ...leftIntent } = left;
  const { transitionedAt: _rightTime, ...rightIntent } = right;
  return canonicalSha256(leftIntent) === canonicalSha256(rightIntent);
}

function commitTransition({ currentPath, transitionPath, record, expectedDigest, validator, label }) {
  const current = currentRecord(currentPath, validator);
  validator(record);
  if ((current?.digest ?? null) !== expectedDigest && sameTransitionIntent(current?.value, record)) {
    return current;
  }
  assertExpected(current, expectedDigest, label);
  let durableRecord = record;
  const existing = readOptional(transitionPath);
  if (existing) {
    validator(existing.value);
    if (!sameTransitionIntent(existing.value, record)) {
      throw new Error(`${label} immutable transition collision`);
    }
    durableRecord = existing.value;
  } else writeCreateOnly(transitionPath, canonicalJson(record));
  const beforeReplace = currentRecord(currentPath, validator);
  assertExpected(beforeReplace, expectedDigest, label);
  atomicReplace(currentPath, canonicalJson(durableRecord));
  return { value: durableRecord, digest: canonicalSha256(durableRecord) };
}

export function createCleanupLedger({ runtimeDirectory, deploymentId, approvalDigest }) {
  assertId(deploymentId, 'deploymentId');
  assertDigest(approvalDigest, 'approvalDigest');
  const runtime = assertOwnerDirectory(runtimeDirectory);
  const ownership = ensureChildDirectory(runtime, 'ownership');
  const executions = ensureChildDirectory(ownership, 'cleanup-executions');
  const executionRoot = ensureChildDirectory(executions, approvalDigest);
  const approvalTransitions = ensureChildDirectory(executionRoot, 'approval-state');
  const deployments = ensureChildDirectory(ownership, 'deployments');
  const deploymentRoot = ensureChildDirectory(deployments, deploymentId);
  const pointerTransitions = ensureChildDirectory(deploymentRoot, 'cleanup-pointer-transitions');
  return Object.freeze({
    runtimeDirectory: runtime, deploymentId, approvalDigest, executionRoot,
    approvalTransitions, approvalCurrentPath: path.join(executionRoot, 'approval-state-current.json'),
    deploymentRoot, pointerTransitions, activePointerPath: path.join(deploymentRoot, 'active-cleanup.json'),
  });
}

export function readApprovalState(ledger) {
  const validator = (value) => validateApprovalState(value, ledger.approvalDigest);
  const current = currentRecord(ledger.approvalCurrentPath, validator);
  if (!current) return null;
  let priorDigest = null;
  const expectedStates = ['unused', 'reserved', 'finalized'];
  for (let generation = 1; generation <= current.value.generation; generation += 1) {
    const transition = stableRead(path.join(ledger.approvalTransitions, `${String(generation).padStart(6, '0')}.json`));
    validator(transition.value);
    if (transition.value.generation !== generation
      || transition.value.state !== expectedStates[generation - 1]
      || transition.value.priorStateDigest !== priorDigest) {
      throw new Error('approval state transition chain is invalid');
    }
    priorDigest = transition.digest;
  }
  if (priorDigest !== current.digest) throw new Error('approval state current pointer does not match its immutable transition');
  return current;
}

export function initializeApprovalState(ledger, { transitionedAt = new Date().toISOString() } = {}) {
  const record = {
    version: 1, approvalDigest: ledger.approvalDigest, generation: 1,
    state: 'unused', priorStateDigest: null, transitionedAt,
  };
  return commitTransition({
    currentPath: ledger.approvalCurrentPath,
    transitionPath: path.join(ledger.approvalTransitions, '000001.json'),
    record, expectedDigest: null,
    validator: (value) => validateApprovalState(value, ledger.approvalDigest),
    label: 'approval state',
  });
}

export function readActiveCleanupPointer(ledger) {
  const validator = (value) => validateActivePointer(value, ledger.deploymentId);
  const current = currentRecord(ledger.activePointerPath, validator);
  if (!current) return null;
  let priorDigest = null;
  for (let generation = 1; generation <= current.value.generation; generation += 1) {
    const transition = stableRead(path.join(ledger.pointerTransitions, `${String(generation).padStart(6, '0')}.json`));
    validator(transition.value);
    const expectedState = generation % 2 === 1 ? 'active' : 'tombstoned';
    if (transition.value.generation !== generation || transition.value.state !== expectedState
      || transition.value.priorPointerDigest !== priorDigest) {
      throw new Error('active cleanup pointer transition chain is invalid');
    }
    priorDigest = transition.digest;
  }
  if (priorDigest !== current.digest) throw new Error('active cleanup current pointer does not match its immutable transition');
  return current;
}

export function inspectCleanupTransitions(ledger, kind) {
  const directory = kind === 'approval' ? ledger.approvalTransitions : ledger.pointerTransitions;
  const names = readdirSync(directory).sort();
  if (!['approval', 'pointer'].includes(kind)
      || names.some((name) => !/^\d{6}\.json$/.test(name))) {
    throw new Error('cleanup transition directory contains an unexpected entry');
  }
  return names.map((name) => stableRead(path.join(directory, name)));
}

export function adoptCleanupCurrent(ledger, kind, expectedDigest, transition) {
  const approval = kind === 'approval';
  const currentPath = approval ? ledger.approvalCurrentPath : ledger.activePointerPath;
  const validator = approval
    ? (value) => validateApprovalState(value, ledger.approvalDigest)
    : (value) => validateActivePointer(value, ledger.deploymentId);
  validator(transition.value);
  assertExpected(currentRecord(currentPath, validator), expectedDigest, `${kind} state`);
  atomicReplace(currentPath, canonicalJson(transition.value));
  return transition;
}

export function publishActiveCleanupPointer(ledger, {
  expectedPointerDigest, operationRunId, journalGenesisDigest,
  transitionedAt = new Date().toISOString(),
}) {
  const approval = readApprovalState(ledger);
  if (!approval || approval.value.state !== 'unused') throw new Error('active cleanup publication requires an unused approval');
  const current = readActiveCleanupPointer(ledger);
  if (current?.value.state === 'active'
      && current.value.approvalDigest === ledger.approvalDigest
      && current.value.operationRunId === operationRunId
      && current.value.journalGenesisDigest === journalGenesisDigest) return current;
  assertExpected(current, expectedPointerDigest, 'active cleanup pointer');
  if (current && current.value.state !== 'tombstoned') throw new Error('another cleanup pointer is active');
  const generation = (current?.value.generation ?? 0) + 1;
  const record = {
    version: 1, deploymentId: ledger.deploymentId, generation, state: 'active',
    priorPointerDigest: current?.digest ?? null, approvalDigest: ledger.approvalDigest,
    operationRunId, journalGenesisDigest, transitionedAt,
  };
  return commitTransition({
    currentPath: ledger.activePointerPath,
    transitionPath: path.join(ledger.pointerTransitions, `${String(generation).padStart(6, '0')}.json`),
    record, expectedDigest: expectedPointerDigest,
    validator: (value) => validateActivePointer(value, ledger.deploymentId),
    label: 'active cleanup pointer',
  });
}

function assertPointerBinding(ledger, operationRunId, journalGenesisDigest) {
  const pointer = readActiveCleanupPointer(ledger);
  if (!pointer || pointer.value.state !== 'active'
    || pointer.value.approvalDigest !== ledger.approvalDigest
    || pointer.value.operationRunId !== operationRunId
    || pointer.value.journalGenesisDigest !== journalGenesisDigest) {
    throw new Error('active cleanup pointer does not bind this approval and journal');
  }
  return pointer;
}

export function reserveApproval(ledger, {
  expectedStateDigest, operationRunId, journalGenesisDigest,
  transitionedAt = new Date().toISOString(),
}) {
  const current = readApprovalState(ledger);
  if (current?.value.state === 'reserved'
      && current.value.operationRunId === operationRunId
      && current.value.journalGenesisDigest === journalGenesisDigest) {
    assertPointerBinding(ledger, operationRunId, journalGenesisDigest);
    return current;
  }
  assertExpected(current, expectedStateDigest, 'approval state');
  if (!current || current.value.state !== 'unused') throw new Error('only an unused approval can be reserved');
  assertPointerBinding(ledger, operationRunId, journalGenesisDigest);
  const record = {
    version: 1, approvalDigest: ledger.approvalDigest, generation: 2,
    state: 'reserved', priorStateDigest: current.digest, operationRunId,
    journalGenesisDigest, transitionedAt,
  };
  return commitTransition({
    currentPath: ledger.approvalCurrentPath,
    transitionPath: path.join(ledger.approvalTransitions, '000002.json'),
    record, expectedDigest: expectedStateDigest,
    validator: (value) => validateApprovalState(value, ledger.approvalDigest),
    label: 'approval state',
  });
}

export function finalizeApproval(ledger, {
  expectedStateDigest, operationRunId, journalGenesisDigest, finalJournalDigest,
  inventoryAfterDigest, receiptCoreDigest, terminalOutcome,
  transitionedAt = new Date().toISOString(),
}) {
  const current = readApprovalState(ledger);
  if (current?.value.state === 'finalized'
      && current.value.operationRunId === operationRunId
      && current.value.journalGenesisDigest === journalGenesisDigest
      && current.value.finalJournalDigest === finalJournalDigest
      && current.value.inventoryAfterDigest === inventoryAfterDigest
      && current.value.receiptCoreDigest === receiptCoreDigest
      && current.value.terminalOutcome === terminalOutcome) return current;
  assertExpected(current, expectedStateDigest, 'approval state');
  if (!current || current.value.state !== 'reserved') throw new Error('only a reserved approval can be finalized');
  if (current.value.operationRunId !== operationRunId || current.value.journalGenesisDigest !== journalGenesisDigest) {
    throw new Error('reserved approval identity mismatch');
  }
  assertPointerBinding(ledger, operationRunId, journalGenesisDigest);
  const record = {
    version: 1, approvalDigest: ledger.approvalDigest, generation: 3,
    state: 'finalized', priorStateDigest: current.digest, operationRunId,
    journalGenesisDigest, finalJournalDigest, inventoryAfterDigest,
    receiptCoreDigest, terminalOutcome, transitionedAt,
  };
  return commitTransition({
    currentPath: ledger.approvalCurrentPath,
    transitionPath: path.join(ledger.approvalTransitions, '000003.json'),
    record, expectedDigest: expectedStateDigest,
    validator: (value) => validateApprovalState(value, ledger.approvalDigest),
    label: 'approval state',
  });
}

export function tombstoneActiveCleanupPointer(ledger, {
  expectedPointerDigest, expectedStateDigest, operationRunId, journalGenesisDigest,
  receiptDigest, signatureDigest, checksumDigest,
  transitionedAt = new Date().toISOString(),
}) {
  const state = readApprovalState(ledger);
  assertExpected(state, expectedStateDigest, 'approval state');
  if (!state || state.value.state !== 'finalized'
    || state.value.operationRunId !== operationRunId
    || state.value.journalGenesisDigest !== journalGenesisDigest) {
    throw new Error('pointer tombstone requires the exact finalized approval');
  }
  const observedPointer = readActiveCleanupPointer(ledger);
  if (observedPointer?.value.state === 'tombstoned'
      && observedPointer.value.disposition === 'receipt_verified'
      && observedPointer.value.approvalDigest === ledger.approvalDigest
      && observedPointer.value.operationRunId === operationRunId
      && observedPointer.value.journalGenesisDigest === journalGenesisDigest
      && observedPointer.value.receiptDigest === receiptDigest
      && observedPointer.value.signatureDigest === signatureDigest
      && observedPointer.value.checksumDigest === checksumDigest) return observedPointer;
  const current = assertPointerBinding(ledger, operationRunId, journalGenesisDigest);
  assertExpected(current, expectedPointerDigest, 'active cleanup pointer');
  const generation = current.value.generation + 1;
  const record = {
    ...current.value, generation, state: 'tombstoned', priorPointerDigest: current.digest,
    disposition: 'receipt_verified', receiptDigest, signatureDigest, checksumDigest, transitionedAt,
  };
  return commitTransition({
    currentPath: ledger.activePointerPath,
    transitionPath: path.join(ledger.pointerTransitions, `${String(generation).padStart(6, '0')}.json`),
    record, expectedDigest: expectedPointerDigest,
    validator: (value) => validateActivePointer(value, ledger.deploymentId),
    label: 'active cleanup pointer',
  });
}

export function clearPreReservationCleanupPointer(ledger, {
  expectedPointerDigest, operationRunId, journalGenesisDigest,
  transitionedAt = new Date().toISOString(),
}) {
  const state = readApprovalState(ledger);
  if (!state || state.value.state !== 'unused') {
    throw new Error('only a pre-reservation cleanup pointer can be cleared');
  }
  const observedPointer = readActiveCleanupPointer(ledger);
  if (observedPointer?.value.state === 'tombstoned'
      && observedPointer.value.disposition === 'pre_reservation'
      && observedPointer.value.approvalDigest === ledger.approvalDigest
      && observedPointer.value.operationRunId === operationRunId
      && observedPointer.value.journalGenesisDigest === journalGenesisDigest) return observedPointer;
  const current = assertPointerBinding(ledger, operationRunId, journalGenesisDigest);
  assertExpected(current, expectedPointerDigest, 'active cleanup pointer');
  const generation = current.value.generation + 1;
  const record = {
    ...current.value, generation, state: 'tombstoned', priorPointerDigest: current.digest,
    disposition: 'pre_reservation', receiptDigest: null, signatureDigest: null,
    checksumDigest: null, transitionedAt,
  };
  return commitTransition({
    currentPath: ledger.activePointerPath,
    transitionPath: path.join(ledger.pointerTransitions, `${String(generation).padStart(6, '0')}.json`),
    record, expectedDigest: expectedPointerDigest,
    validator: (value) => validateActivePointer(value, ledger.deploymentId),
    label: 'active cleanup pointer',
  });
}
