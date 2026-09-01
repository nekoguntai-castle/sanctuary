import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { readActiveCleanupPointer } from './cleanup-approval-ledger.mjs';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

function ownerDirectory(directory, { ownerOnly = true } = {}) {
  const absolute = path.resolve(directory);
  const info = lstatSync(absolute);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(absolute) !== absolute) {
    throw new Error('cleanup pointer storage must be a real non-symlink directory');
  }
  const unsafeMode = ownerOnly ? (info.mode & 0o077) !== 0 : (info.mode & 0o022) !== 0;
  if ((typeof process.getuid === 'function' && info.uid !== process.getuid()) || unsafeMode) {
    throw new Error('cleanup pointer storage must be safely owned by the current user');
  }
  return absolute;
}

function optionalOwnerDirectory(directory) {
  try { return ownerDirectory(directory); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function inspectionLedger(runtimeDirectory, deploymentId) {
  if (!ID.test(deploymentId ?? '')) throw new Error('deploymentId has an invalid format');
  const runtime = ownerDirectory(runtimeDirectory, { ownerOnly: false });
  const ownership = optionalOwnerDirectory(path.join(runtime, 'ownership'));
  const deployments = ownership && optionalOwnerDirectory(path.join(ownership, 'deployments'));
  const deploymentRoot = deployments && optionalOwnerDirectory(path.join(deployments, deploymentId));
  if (!deploymentRoot) return null;
  return {
    deploymentId,
    pointerTransitions: optionalOwnerDirectory(path.join(deploymentRoot, 'cleanup-pointer-transitions')),
    activePointerPath: path.join(deploymentRoot, 'active-cleanup.json'),
  };
}

function transitionNames(directory) {
  if (!directory) return [];
  const names = readdirSync(directory);
  if (names.some((name) => !/^\d{6}\.json$/.test(name))) {
    throw new Error('cleanup pointer transition directory contains an unexpected entry');
  }
  return names.sort();
}

export function inspectDeploymentCleanupState({ runtimeDirectory, deploymentId }) {
  const ledger = inspectionLedger(runtimeDirectory, deploymentId);
  if (!ledger) return Object.freeze({ state: 'clear', pointerDigest: null });
  const transitions = transitionNames(ledger.pointerTransitions);
  const pointer = readActiveCleanupPointer(ledger);
  if (!pointer) {
    return Object.freeze({
      state: transitions.length > 0 ? 'incomplete' : 'clear', pointerDigest: null,
    });
  }
  if (transitions.length !== pointer.value.generation) {
    throw new Error('cleanup pointer transition count does not match the current pointer');
  }
  return Object.freeze({
    state: pointer.value.state === 'active' ? 'active' : 'clear',
    pointerDigest: pointer.digest,
  });
}

export function assertNoActiveCleanup(request) {
  const observed = inspectDeploymentCleanupState(request);
  if (observed.state !== 'clear') {
    const error = new Error(`deployment mutation is refused while cleanup state is ${observed.state}`);
    error.code = 'DEPLOYMENT_LOCK_CONFLICT';
    throw error;
  }
  return observed;
}
