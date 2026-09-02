import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, canonicalSha256, parseStrictJson } from './canonical-json.mjs';
import { readExternalFile, writeExternalFileAtomic } from './safe-file.mjs';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const PHASES = Object.freeze([
  'initialized', 'revision_prepared', 'deployment_active', 'run_active',
  'trust_installed', 'subject_terminal', 'deployment_retired', 'planned',
  'authorized', 'executing', 'executed', 'projected',
  'subject_ready', 'deployment_bound',
]);
const FIELDS = Object.freeze([
  'stateVersion', 'phase', 'authority', 'authorityCoreDigest',
  'deploymentManifestPath', 'deploymentManifestDigest', 'generation',
  'resourceCreatedAt', 'legacyFixtureWitnessDigest', 'legacyFixtureWitnessState',
  'deploymentPointerDigest', 'activePointerDigest',
  'runManifestPath', 'runManifestDigest', 'authorizationFingerprint',
  'evidenceFingerprint', 'subjectExitStatus', 'cleanupSuppression', 'planningReceiptPath',
  'executionAttempt', 'authorizationRequestPath', 'approvalPath', 'approvalDigest',
  'executionRequestPath', 'recoveryControllerRunId', 'executionReceiptPath',
]);

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('\0') !== [...expected].sort().join('\0')) {
    throw new Error(`${label} fields are invalid`);
  }
}

function nullable(value, validator) { return value === null || validator(value); }
function id(value) { return ID.test(value ?? ''); }
function digest(value) { return DIGEST.test(value ?? ''); }
function absolute(value) { return typeof value === 'string' && path.isAbsolute(value); }
function timestamp(value) {
  const parsed = new Date(value);
  return typeof value === 'string' && !Number.isNaN(parsed.getTime())
    && parsed.toISOString() === value;
}

function validateAuthority(value) {
  exactKeys(value, [
    'provider', 'runId', 'runAttempt', 'lane', 'identityDigest', 'checkoutRoot',
    'runtimeDirectory', 'deploymentId', 'ownerId', 'operationRunId',
    'composeProjectName', 'checkoutCommit', 'policyDigest', 'authorityMode',
  ], 'cleanup coordinator authority');
  if (!['github', 'forgejo', 'local'].includes(value.provider)
      || !['coordinator_managed', 'deployment_managed_by_subject'].includes(value.authorityMode)
      || ![value.runId, value.runAttempt, value.lane, value.deploymentId, value.ownerId,
        value.operationRunId, value.composeProjectName].every(id)
      || ![value.identityDigest, value.policyDigest].every(digest)
      || ![value.checkoutRoot, value.runtimeDirectory].every(absolute)
      || !/^[a-f0-9]{40}$/.test(value.checkoutCommit ?? '')) {
    throw new Error('cleanup coordinator authority is invalid');
  }
}

export function validateCoordinatorState(value) {
  exactKeys(value, FIELDS, 'cleanup coordinator state');
  if (value.stateVersion !== 3 || !PHASES.includes(value.phase)) {
    throw new Error('cleanup coordinator state version or phase is invalid');
  }
  validateAuthority(value.authority);
  if (canonicalSha256(value.authority) !== value.authorityCoreDigest) {
    throw new Error('cleanup coordinator authority digest mismatch');
  }
  if (!evidenceFieldsValid(value)) {
    throw new Error('cleanup coordinator state evidence fields are invalid');
  }
  if (!['disabled', 'pending', 'witnessed'].includes(value.legacyFixtureWitnessState)
      || (value.legacyFixtureWitnessState === 'witnessed') !== (value.legacyFixtureWitnessDigest !== null)) {
    throw new Error('cleanup coordinator legacy fixture witness state is invalid');
  }
  if (value.phase !== 'initialized' && !timestamp(value.resourceCreatedAt)) {
    throw new Error('cleanup coordinator active lifecycle requires a creation timestamp');
  }
  return value;
}

function positiveInteger(value) { return Number.isSafeInteger(value) && value > 0; }
function exitStatus(value) { return Number.isSafeInteger(value) && value >= 0 && value <= 255; }
function suppression(value) {
  return ['subject_quiescence_failed', 'legacy_fixture_registration_failed'].includes(value);
}

function nullableFieldsValid(value, validators) {
  return validators.every(([field, validator]) => nullable(value[field], validator));
}

function evidencePathsValid(value) {
  return nullableFieldsValid(value, [
    ['deploymentManifestPath', absolute], ['runManifestPath', absolute],
    ['planningReceiptPath', absolute], ['authorizationRequestPath', absolute],
    ['approvalPath', absolute], ['executionRequestPath', absolute],
    ['executionReceiptPath', absolute],
  ]);
}

function evidenceDigestsValid(value) {
  return nullableFieldsValid(value, [
    ['deploymentManifestDigest', digest], ['deploymentPointerDigest', digest],
    ['activePointerDigest', digest], ['runManifestDigest', digest],
    ['authorizationFingerprint', digest], ['evidenceFingerprint', digest],
    ['approvalDigest', digest], ['legacyFixtureWitnessDigest', digest],
  ]);
}

function evidenceFieldsValid(value) {
  const scalarFieldsValid = nullableFieldsValid(value, [
    ['generation', positiveInteger], ['resourceCreatedAt', timestamp],
    ['subjectExitStatus', exitStatus], ['cleanupSuppression', suppression],
    ['recoveryControllerRunId', id],
  ]);
  return scalarFieldsValid && evidencePathsValid(value) && evidenceDigestsValid(value)
    && Number.isSafeInteger(value.executionAttempt) && value.executionAttempt >= 0;
}

function ensureStateParent(statePath) {
  const parent = path.dirname(path.resolve(statePath));
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const info = lstatSync(parent);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(parent) !== parent
      || (typeof process.getuid === 'function' && info.uid !== process.getuid())
      || (info.mode & 0o077) !== 0) {
    throw new Error('cleanup coordinator state parent must be owner-only and non-symlink');
  }
  return parent;
}

export function coordinatorStatePath(runtimeDirectory) {
  return path.join(path.resolve(runtimeDirectory), 'coordinator-state.json');
}

export function readCoordinatorState(statePath, { checkoutRoot }) {
  const bytes = readExternalFile(path.resolve(statePath), { checkoutRoot, maxBytes: 64 * 1024 });
  const state = parseStrictJson(bytes);
  if (!canonicalJson(state).equals(bytes)) throw new Error('cleanup coordinator state is not canonical JSON');
  validateCoordinatorState(state);
  return Object.freeze({ state, digest: canonicalSha256(state), path: path.resolve(statePath) });
}

export function createCoordinatorState({
  statePath, checkoutRoot, authority, legacyFixtureCreationWitness = false,
}) {
  const resolvedPath = path.resolve(statePath);
  ensureStateParent(resolvedPath);
  const state = {
    stateVersion: 3, phase: 'initialized', authority,
    authorityCoreDigest: canonicalSha256(authority),
    deploymentManifestPath: null, deploymentManifestDigest: null, generation: null,
    resourceCreatedAt: null, legacyFixtureWitnessDigest: null,
    legacyFixtureWitnessState: legacyFixtureCreationWitness ? 'pending' : 'disabled',
    deploymentPointerDigest: null, activePointerDigest: null,
    runManifestPath: null, runManifestDigest: null,
    authorizationFingerprint: null, evidenceFingerprint: null,
    subjectExitStatus: null, cleanupSuppression: null,
    planningReceiptPath: null, executionAttempt: 0,
    authorizationRequestPath: null, approvalPath: null, approvalDigest: null,
    executionRequestPath: null, recoveryControllerRunId: null, executionReceiptPath: null,
  };
  validateCoordinatorState(state);
  writeExternalFileAtomic(resolvedPath, canonicalJson(state), { checkoutRoot });
  return Object.freeze({ state, digest: canonicalSha256(state), path: resolvedPath });
}

function transitionAllowed(current, next) {
  if (current === next) return true;
  const successors = {
    initialized: ['revision_prepared', 'subject_ready'],
    revision_prepared: ['deployment_active'],
    deployment_active: ['run_active'],
    subject_ready: ['deployment_bound', 'revision_prepared', 'projected'],
    deployment_bound: ['run_active'],
    run_active: ['trust_installed'],
    trust_installed: ['subject_terminal'],
    subject_terminal: ['deployment_retired'],
    deployment_retired: ['planned'],
    planned: ['authorized', 'projected'],
    authorized: ['executing'],
    executing: ['executed', 'planned'],
    executed: ['projected'],
    projected: [],
  };
  return successors[current]?.includes(next) ?? false;
}

export function transitionCoordinatorState({
  statePath, checkoutRoot, expectedDigest, nextPhase, updates = {},
}) {
  const current = readCoordinatorState(statePath, { checkoutRoot });
  if (current.digest !== expectedDigest) throw new Error('cleanup coordinator state compare-and-swap failed');
  if (!transitionAllowed(current.state.phase, nextPhase)) {
    throw new Error(`invalid cleanup coordinator transition: ${current.state.phase} -> ${nextPhase}`);
  }
  const state = { ...current.state, ...updates, phase: nextPhase };
  validateCoordinatorState(state);
  writeExternalFileAtomic(path.resolve(statePath), canonicalJson(state), {
    checkoutRoot, replace: true,
  });
  return Object.freeze({ state, digest: canonicalSha256(state), path: path.resolve(statePath) });
}
