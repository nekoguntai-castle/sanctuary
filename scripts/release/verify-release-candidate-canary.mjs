#!/usr/bin/env node

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CANARY_RECEIPT_SCHEMA_VERSION = 'sanctuary.release-candidate-canary.v1';
export const CANARY_RECEIPT_MAX_BYTES = 64 * 1024;

const METRIC_FAMILIES = [
  'abort_grace_exhausted',
  'budget_expiry',
  'candidates',
  'cleanup',
  'fallback',
  'lock_loss',
  'terminal',
];
const RC_TAG_PATTERN = /^v\d+\.\d+\.\d+-rc[1-9]\d*$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const OPERATOR_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function exactKeys(value, required, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value);
  if (actual.length !== required.length
    || actual.some((key) => !required.includes(key))) {
    throw new Error(`${label} has an invalid schema`);
  }
}

function requireSafeCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function requireTrue(value, label) {
  if (value !== true) throw new Error(`${label} must be true`);
}

function parseInstant(value, label) {
  if (typeof value !== 'string' || !ISO_INSTANT_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical UTC ISO instant`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} must be a canonical UTC ISO instant`);
  }
  return parsed;
}

function validateIdentity(receipt, expected) {
  if (receipt.schemaVersion !== CANARY_RECEIPT_SCHEMA_VERSION) {
    throw new Error('unsupported canary receipt schema version');
  }
  if (!RC_TAG_PATTERN.test(receipt.releaseCandidate.tag)) {
    throw new Error('release candidate tag is invalid');
  }
  if (!COMMIT_PATTERN.test(receipt.releaseCandidate.commit)) {
    throw new Error('release candidate commit is invalid');
  }
  if (!RC_TAG_PATTERN.test(expected.tag) || !COMMIT_PATTERN.test(expected.commit)) {
    throw new Error('expected release candidate identity is invalid');
  }
  if (receipt.releaseCandidate.tag !== expected.tag
    || receipt.releaseCandidate.commit !== expected.commit) {
    throw new Error('canary receipt is for a different release candidate');
  }
}

function validateWindow(receipt, now) {
  const startedAt = parseInstant(receipt.canaryWindow.startedAt, 'canary startedAt');
  const completedAt = parseInstant(receipt.canaryWindow.completedAt, 'canary completedAt');
  const signedAt = parseInstant(receipt.signoff.signedAt, 'canary signedAt');
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error('validation time is invalid');
  if (startedAt > completedAt) throw new Error('canary completed before it started');
  if (completedAt > signedAt) throw new Error('canary was signed before it completed');
  if (signedAt > nowMs) throw new Error('canary receipt timestamp is in the future');
}

function validateFleet(fleet) {
  requireSafeCount(fleet.total, 'fleet total');
  if (fleet.total < 12) throw new Error('canary fleet must contain at least 12 wallets');
  const outcomes = fleet.outcomes;
  requireSafeCount(outcomes.success, 'successful wallet count');
  requireSafeCount(outcomes.retrying, 'retrying wallet count');
  requireSafeCount(outcomes.actionRequired, 'action-required wallet count');
  if (outcomes.success + outcomes.retrying + outcomes.actionRequired !== fleet.total) {
    throw new Error('canary fleet outcomes do not reconcile to the fleet total');
  }
  requireSafeCount(
    fleet.actionRequiredWithExplicitReason,
    'action-required wallets with an explicit reason',
  );
  if (fleet.actionRequiredWithExplicitReason !== outcomes.actionRequired) {
    throw new Error('every action-required wallet must have an explicit reason');
  }
  if (!['success', 'retrying', 'action_required'].includes(fleet.previouslyStaleRepeat.outcome)) {
    throw new Error('previously stale repeat outcome is invalid');
  }
  if (fleet.previouslyStaleRepeat.stranded !== false) {
    throw new Error('previously stale wallet remained stranded');
  }
}

function validateProgress(progress) {
  requireTrue(progress.phaseObserved, 'phase evidence');
  requireTrue(progress.liveElapsedObserved, 'live elapsed evidence');
  requireTrue(progress.knownCountsObserved.addresses, 'known address-count evidence');
  requireTrue(progress.knownCountsObserved.candidates, 'known candidate-count evidence');
  requireTrue(progress.knownCountsObserved.batches, 'known batch-count evidence');
  requireTrue(progress.liveSyncLogObserved, 'live sync-log evidence');
}

function validateDiagnostics(diagnostics) {
  if (!Array.isArray(diagnostics.versionsObserved)
    || diagnostics.versionsObserved.length === 0
    || diagnostics.versionsObserved.some((version) => version !== 1 && version !== 2)
    || new Set(diagnostics.versionsObserved).size !== diagnostics.versionsObserved.length
    || !diagnostics.versionsObserved.includes(2)) {
    throw new Error('diagnostics versions evidence is incomplete');
  }
  requireTrue(diagnostics.preflightActiveObserved, 'preflight diagnostics evidence');
  requireTrue(diagnostics.addressHistoryActiveObserved, 'address-history diagnostics evidence');
  requireTrue(diagnostics.redisLockAgreementObserved, 'Redis lock agreement evidence');
  if (diagnostics.terminalActiveTotal !== 0) {
    throw new Error('diagnostics did not return to zero after completion');
  }
}

function validateMetrics(metrics) {
  requireTrue(metrics.activeStageAgeObserved, 'active-stage age metric evidence');
  const families = metrics.counterFamiliesObserved;
  if (!Array.isArray(families)
    || families.length !== METRIC_FAMILIES.length
    || new Set(families).size !== families.length
    || METRIC_FAMILIES.some((family) => !families.includes(family))) {
    throw new Error('wallet-sync counter-family evidence is incomplete');
  }
}

function validateBoundedError(evidence) {
  const batch = evidence.candidateBatch;
  requireSafeCount(batch.startCompleted, 'candidate batch start');
  requireSafeCount(batch.endCompleted, 'candidate batch end');
  requireSafeCount(batch.total, 'candidate batch total');
  if (batch.total !== 100
    || batch.startCompleted < 1
    || batch.startCompleted > 25
    || batch.endCompleted < batch.startCompleted
    || batch.endCompleted > 25) {
    throw new Error('candidate batch evidence is outside the required 1-25/100 range');
  }
  if (!['advanced', 'retryable', 'fatal'].includes(evidence.outcome)) {
    throw new Error('bounded-error outcome is invalid');
  }
  if (evidence.outcome === 'advanced' && batch.endCompleted <= batch.startCompleted) {
    throw new Error('advanced candidate evidence did not advance');
  }
  requireTrue(evidence.withinBudgetAndGrace, 'bounded budget/grace evidence');
  if (evidence.silentHang !== false) throw new Error('canary observed a silent hang');
}

function validateSignoff(signoff) {
  if (signoff.decision !== 'accepted') throw new Error('canary signoff is not accepted');
  if (typeof signoff.operatorId !== 'string' || !OPERATOR_PATTERN.test(signoff.operatorId)) {
    throw new Error('canary operator identifier is invalid');
  }
}

function validateShape(receipt) {
  exactKeys(receipt, [
    'schemaVersion', 'releaseCandidate', 'canaryWindow', 'fleet',
    'progressEvidence', 'diagnosticsEvidence', 'metricEvidence',
    'boundedErrorEvidence', 'signoff',
  ], 'canary receipt');
  exactKeys(receipt.releaseCandidate, ['tag', 'commit'], 'release candidate identity');
  exactKeys(receipt.canaryWindow, ['startedAt', 'completedAt'], 'canary window');
  exactKeys(receipt.fleet, [
    'total', 'outcomes', 'actionRequiredWithExplicitReason', 'previouslyStaleRepeat',
  ], 'fleet evidence');
  exactKeys(receipt.fleet.outcomes, ['success', 'retrying', 'actionRequired'], 'fleet outcomes');
  exactKeys(receipt.fleet.previouslyStaleRepeat, ['outcome', 'stranded'], 'stale-wallet repeat');
  exactKeys(receipt.progressEvidence, [
    'phaseObserved', 'liveElapsedObserved', 'knownCountsObserved', 'liveSyncLogObserved',
  ], 'progress evidence');
  exactKeys(receipt.progressEvidence.knownCountsObserved, [
    'addresses', 'candidates', 'batches',
  ], 'known-count evidence');
  exactKeys(receipt.diagnosticsEvidence, [
    'versionsObserved', 'preflightActiveObserved', 'addressHistoryActiveObserved',
    'redisLockAgreementObserved', 'terminalActiveTotal',
  ], 'diagnostics evidence');
  exactKeys(receipt.metricEvidence, [
    'activeStageAgeObserved', 'counterFamiliesObserved',
  ], 'metric evidence');
  exactKeys(receipt.boundedErrorEvidence, [
    'candidateBatch', 'outcome', 'withinBudgetAndGrace', 'silentHang',
  ], 'bounded-error evidence');
  exactKeys(receipt.boundedErrorEvidence.candidateBatch, [
    'startCompleted', 'endCompleted', 'total',
  ], 'candidate batch evidence');
  exactKeys(receipt.signoff, ['decision', 'signedAt', 'operatorId'], 'canary signoff');
}

export function validateCanaryReceipt(receipt, options) {
  validateShape(receipt);
  validateIdentity(receipt, options);
  validateFleet(receipt.fleet);
  validateProgress(receipt.progressEvidence);
  validateDiagnostics(receipt.diagnosticsEvidence);
  validateMetrics(receipt.metricEvidence);
  validateBoundedError(receipt.boundedErrorEvidence);
  validateSignoff(receipt.signoff);
  validateWindow(receipt, options.now ?? new Date());
  return receipt;
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function readExternalReceipt(repo, receiptPath) {
  if (typeof receiptPath !== 'string' || !path.isAbsolute(receiptPath)) {
    throw new Error('canary receipt path must be absolute');
  }
  const realRepo = realpathSync(repo);
  const metadata = lstatSync(receiptPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('canary receipt must be a regular non-symlink file');
  }
  const realReceipt = realpathSync(receiptPath);
  if (isInside(realRepo, realReceipt)) {
    throw new Error('canary receipt must be outside the release checkout');
  }
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const descriptor = openSync(receiptPath, constants.O_RDONLY | noFollow);
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile()) throw new Error('canary receipt must be a regular file');
    const openedReceipt = realpathSync(`/proc/self/fd/${descriptor}`);
    if (openedReceipt !== realReceipt || isInside(realRepo, openedReceipt)) {
      throw new Error('canary receipt changed during safe open');
    }
    if (opened.size > CANARY_RECEIPT_MAX_BYTES) throw new Error('canary receipt is too large');
    const buffer = Buffer.alloc(CANARY_RECEIPT_MAX_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = readSync(descriptor, buffer, bytesRead, buffer.length - bytesRead, null);
      if (count === 0) break;
      bytesRead += count;
    }
    if (bytesRead > CANARY_RECEIPT_MAX_BYTES) throw new Error('canary receipt is too large');
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    closeSync(descriptor);
  }
}

export function verifyReleaseCandidateCanary(options) {
  let serialized;
  try {
    serialized = readExternalReceipt(options.repo, options.receipt);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('canary receipt')) throw error;
    throw new Error('canary receipt could not be read safely');
  }
  let receipt;
  try {
    receipt = JSON.parse(serialized);
  } catch {
    throw new Error('canary receipt is invalid JSON');
  }
  return validateCanaryReceipt(receipt, {
    tag: options.tag,
    commit: options.commit,
    now: options.now ?? new Date(),
  });
}

function parseArguments(argv) {
  const permitted = new Set(['--repo', '--receipt', '--tag', '--commit']);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!permitted.has(key) || value === undefined || values.has(key)) {
      throw new Error('invalid arguments');
    }
    values.set(key, value);
  }
  if (values.size !== permitted.size) throw new Error('invalid arguments');
  return {
    repo: values.get('--repo'),
    receipt: values.get('--receipt'),
    tag: values.get('--tag'),
    commit: values.get('--commit'),
  };
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    verifyReleaseCandidateCanary(options);
    process.stdout.write('Release-candidate canary receipt: accepted.\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown validation error';
    process.stderr.write(`Release-candidate canary gate failed: ${message}.\n`);
    process.exitCode = 1;
    return;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
