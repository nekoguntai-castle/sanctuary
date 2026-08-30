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
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CANARY_RECEIPT_SCHEMA_VERSION = 'sanctuary.release-candidate-canary.v1';
export const CANARY_RECEIPT_V2_SCHEMA_VERSION = 'sanctuary.release-candidate-canary.v2';
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
// Mirrors the externally emitted sync-progress count ceiling without requiring
// this standalone Node release tool to load TypeScript sources.
const SYNC_PROGRESS_MAX_COUNT = 1_000_000;
const RC_TAG_PATTERN = /^v\d+\.\d+\.\d+-rc[1-9]\d*$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const IMAGE_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;
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
  if (![CANARY_RECEIPT_SCHEMA_VERSION, CANARY_RECEIPT_V2_SCHEMA_VERSION]
    .includes(receipt.schemaVersion)) {
    throw new Error('unsupported canary receipt schema version');
  }
  if (receipt.schemaVersion === CANARY_RECEIPT_SCHEMA_VERSION
    && requiresV2Receipt(receipt.releaseCandidate.tag)) {
    throw new Error('v0.8.69 requires a v2 canary receipt');
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

function requiresV2Receipt(tag) {
  const match = /^v(\d+)\.(\d+)\.(\d+)-rc/.exec(tag);
  if (!match) return false;
  const version = match.slice(1).map(Number);
  const baseline = [0, 8, 69];
  return version.some((part, index) => (
    part > baseline[index]
    && version.slice(0, index).every((prior, priorIndex) => prior === baseline[priorIndex])
  )) || version.every((part, index) => part === baseline[index]);
}

function validateProbeWindows(evidence) {
  requireSafeCount(evidence.probeWindowMs, 'probe window');
  requireSafeCount(evidence.postTerminalWindowMs, 'post-terminal window');
  if (evidence.postTerminalWindowMs < 300_000
    || evidence.probeWindowMs < evidence.postTerminalWindowMs + 60_000) {
    throw new Error('probe window does not contain the required pre/post-terminal periods');
  }
}

function validateEndpointSummary(endpoint, summary) {
  requireSafeCount(summary.samples, `${endpoint} samples`);
  requireSafeCount(summary.postTerminalSamples, `${endpoint} post-terminal samples`);
  requireSafeCount(summary.failures, `${endpoint} failures`);
  if (summary.samples < summary.postTerminalSamples + 60
    || summary.postTerminalSamples < 300 || summary.failures !== 0
    || !Number.isFinite(summary.p99Ms) || summary.p99Ms < 0 || summary.p99Ms > 250
    || !Number.isFinite(summary.maxMs) || summary.maxMs < 0 || summary.maxMs > 1000) {
    throw new Error(`${endpoint} probe evidence failed`);
  }
}

function validateRuntimeEvidence(runtime) {
  for (const key of ['peakBytes', 'memoryLimitBytes', 'restartCount', 'exitCode', 'fallbackCount']) {
    requireSafeCount(runtime[key], `runtime ${key}`);
  }
  if (runtime.peakBytes === 0 || runtime.memoryLimitBytes === 0
    || runtime.peakBytes > runtime.memoryLimitBytes || runtime.oomKilled !== false
    || runtime.restartCount !== 0 || runtime.exitCode !== 0 || runtime.fallbackCount !== 0) {
    throw new Error('remote runtime evidence failed');
  }
}

function validateRemoteEvidence(evidence) {
  validateProbeWindows(evidence);
  for (const endpoint of ['live', 'ready', 'metricsPrometheus']) {
    validateEndpointSummary(endpoint, evidence.endpoints[endpoint]);
  }
  validateRuntimeEvidence(evidence.runtime);
  for (const [key, value] of Object.entries(evidence.lifecycle)) requireTrue(value, key);
  if (!SHA256_PATTERN.test(evidence.rawEvidence.sha256)) {
    throw new Error('raw evidence SHA-256 is invalid');
  }
  requireSafeCount(evidence.rawEvidence.bytes, 'raw evidence bytes');
  if (evidence.rawEvidence.bytes === 0) throw new Error('raw evidence is empty');
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
  if (receipt.schemaVersion === CANARY_RECEIPT_V2_SCHEMA_VERSION
    && completedAt - startedAt < receipt.remoteEvidence.probeWindowMs) {
    throw new Error('canary window is shorter than the claimed probe window');
  }
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

function validateProgress(progress, v2) {
  requireTrue(progress.phaseObserved, 'phase evidence');
  requireTrue(progress.liveElapsedObserved, 'live elapsed evidence');
  requireTrue(progress.knownCountsObserved.addresses, 'known address-count evidence');
  requireTrue(progress.knownCountsObserved.candidates, 'known candidate-count evidence');
  requireTrue(progress.knownCountsObserved.batches, 'known batch-count evidence');
  requireTrue(progress.liveSyncLogObserved, 'live sync-log evidence');
  if (v2) requireTrue(progress.preflightObserved, 'preflight progress evidence');
}

function validateDiagnostics(diagnostics, v2) {
  if (!Array.isArray(diagnostics.versionsObserved)
    || diagnostics.versionsObserved.length === 0
    || diagnostics.versionsObserved.some((version) => version !== 1 && version !== 2)
    || new Set(diagnostics.versionsObserved).size !== diagnostics.versionsObserved.length
    || !diagnostics.versionsObserved.includes(2)) {
    throw new Error('diagnostics versions evidence is incomplete');
  }
  if (!v2) requireTrue(diagnostics.preflightActiveObserved, 'preflight diagnostics evidence');
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

function validateLegacyCandidateBatch(batch) {
  if (batch.total !== 100
    || batch.startCompleted < 1
    || batch.startCompleted > 25
    || batch.endCompleted < batch.startCompleted
    || batch.endCompleted > 25) {
    throw new Error('candidate batch evidence is outside the required 1-25/100 range');
  }
}

function validateV2CandidateBatch(batch) {
  const boundedFirstBatchEnd = Math.min(25, batch.total);
  if (batch.total < 1
    || batch.total > SYNC_PROGRESS_MAX_COUNT
    || batch.startCompleted !== 1
    || batch.endCompleted < batch.startCompleted
    || batch.endCompleted > boundedFirstBatchEnd) {
    throw new Error('candidate batch evidence is outside the required bounded first batch');
  }
}

function validateCandidateBatch(batch, v2) {
  requireSafeCount(batch.startCompleted, 'candidate batch start');
  requireSafeCount(batch.endCompleted, 'candidate batch end');
  requireSafeCount(batch.total, 'candidate batch total');
  if (v2) validateV2CandidateBatch(batch);
  else validateLegacyCandidateBatch(batch);
}

function validateBoundedError(evidence, v2) {
  const batch = evidence.candidateBatch;
  validateCandidateBatch(batch, v2);
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
  const v2 = receipt.schemaVersion === CANARY_RECEIPT_V2_SCHEMA_VERSION;
  exactKeys(receipt, [
    'schemaVersion', 'releaseCandidate', 'canaryWindow', 'fleet',
    'progressEvidence', 'diagnosticsEvidence', 'metricEvidence',
    'boundedErrorEvidence', 'signoff', ...(v2 ? ['remoteEvidence'] : []),
  ], 'canary receipt');
  exactKeys(receipt.releaseCandidate, [
    'tag', 'commit', ...(v2 ? ['imageIds'] : []),
  ], 'release candidate identity');
  if (v2 && (!Array.isArray(receipt.releaseCandidate.imageIds)
    || receipt.releaseCandidate.imageIds.length === 0
    || receipt.releaseCandidate.imageIds.some(id => !IMAGE_ID_PATTERN.test(id))
    || new Set(receipt.releaseCandidate.imageIds).size !== receipt.releaseCandidate.imageIds.length)) {
    throw new Error('release candidate image IDs are invalid');
  }
  exactKeys(receipt.canaryWindow, ['startedAt', 'completedAt'], 'canary window');
  exactKeys(receipt.fleet, [
    'total', 'outcomes', 'actionRequiredWithExplicitReason', 'previouslyStaleRepeat',
  ], 'fleet evidence');
  exactKeys(receipt.fleet.outcomes, ['success', 'retrying', 'actionRequired'], 'fleet outcomes');
  exactKeys(receipt.fleet.previouslyStaleRepeat, ['outcome', 'stranded'], 'stale-wallet repeat');
  exactKeys(receipt.progressEvidence, [
    'phaseObserved', 'liveElapsedObserved', 'knownCountsObserved', 'liveSyncLogObserved',
    ...(v2 ? ['preflightObserved'] : []),
  ], 'progress evidence');
  exactKeys(receipt.progressEvidence.knownCountsObserved, [
    'addresses', 'candidates', 'batches',
  ], 'known-count evidence');
  exactKeys(receipt.diagnosticsEvidence, [
    'versionsObserved', ...(!v2 ? ['preflightActiveObserved'] : []),
    'addressHistoryActiveObserved',
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
  if (v2) {
    exactKeys(receipt.remoteEvidence, [
      'probeWindowMs', 'postTerminalWindowMs', 'endpoints', 'runtime',
      'lifecycle', 'rawEvidence',
    ], 'remote evidence');
    exactKeys(receipt.remoteEvidence.endpoints, [
      'live', 'ready', 'metricsPrometheus',
    ], 'remote endpoints');
    for (const endpoint of Object.values(receipt.remoteEvidence.endpoints)) {
      exactKeys(endpoint, [
        'samples', 'postTerminalSamples', 'failures', 'p99Ms', 'maxMs',
      ], 'remote endpoint summary');
    }
    exactKeys(receipt.remoteEvidence.runtime, [
      'peakBytes', 'memoryLimitBytes', 'oomKilled', 'restartCount', 'exitCode',
      'fallbackCount',
    ], 'remote runtime summary');
    exactKeys(receipt.remoteEvidence.lifecycle, [
      'leaseLockAgreement', 'leasesAndLocksCleared', 'generationsConverged',
      'formerlyStaleRepeatConverged', 'uiHealthyThroughoutPostTerminal',
    ], 'remote lifecycle summary');
    exactKeys(receipt.remoteEvidence.rawEvidence, ['sha256', 'bytes'], 'raw evidence identity');
  }
}

export function validateCanaryReceipt(receipt, options) {
  const v2 = receipt.schemaVersion === CANARY_RECEIPT_V2_SCHEMA_VERSION;
  validateShape(receipt);
  validateIdentity(receipt, options);
  validateFleet(receipt.fleet);
  validateProgress(receipt.progressEvidence, v2);
  validateDiagnostics(receipt.diagnosticsEvidence, v2);
  validateMetrics(receipt.metricEvidence);
  validateBoundedError(receipt.boundedErrorEvidence, v2);
  if (v2) {
    validateRemoteEvidence(receipt.remoteEvidence);
  }
  validateSignoff(receipt.signoff);
  validateWindow(receipt, options.now ?? new Date());
  return receipt;
}

function hashExternalEvidence(repo, evidencePath) {
  if (typeof evidencePath !== 'string' || !path.isAbsolute(evidencePath)) {
    throw new Error('canary evidence path must be absolute');
  }
  const realRepo = realpathSync(repo);
  const metadata = lstatSync(evidencePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('canary evidence must be a regular non-symlink file');
  }
  const realEvidence = realpathSync(evidencePath);
  if (isInside(realRepo, realEvidence)) throw new Error('canary evidence must be outside the release checkout');
  const descriptor = openSync(evidencePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor);
    const openedEvidence = realpathSync(`/proc/self/fd/${descriptor}`);
    if (!opened.isFile() || openedEvidence !== realEvidence || isInside(realRepo, openedEvidence)) {
      throw new Error('canary evidence changed during safe open');
    }
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let bytes = 0;
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
      bytes += count;
    }
    return { sha256: hash.digest('hex'), bytes };
  } finally {
    closeSync(descriptor);
  }
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
  const validated = validateCanaryReceipt(receipt, {
    tag: options.tag,
    commit: options.commit,
    now: options.now ?? new Date(),
  });
  if (validated.schemaVersion === CANARY_RECEIPT_V2_SCHEMA_VERSION) {
    let identity;
    try {
      identity = hashExternalEvidence(options.repo, options.evidence);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('canary evidence')) throw error;
      throw new Error('canary evidence could not be read safely');
    }
    if (identity.sha256 !== validated.remoteEvidence.rawEvidence.sha256
      || identity.bytes !== validated.remoteEvidence.rawEvidence.bytes) {
      throw new Error('canary raw evidence identity mismatch');
    }
  }
  return validated;
}

function parseArguments(argv) {
  const required = new Set(['--repo', '--receipt', '--tag', '--commit']);
  const permitted = new Set([...required, '--evidence']);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!permitted.has(key) || value === undefined || values.has(key)) {
      throw new Error('invalid arguments');
    }
    values.set(key, value);
  }
  if ([...required].some(key => !values.has(key))) throw new Error('invalid arguments');
  return {
    repo: values.get('--repo'),
    receipt: values.get('--receipt'),
    tag: values.get('--tag'),
    commit: values.get('--commit'),
    evidence: values.get('--evidence'),
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
