import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerResource } from '../ownership/registration.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CREATED_AT = new Date().toISOString();

function identity() {
  const commit = process.env.SANCTUARY_COMMIT
    ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Replay ownership requires a full source commit');
  return {
    project: process.env.SANCTUARY_PROJECT ?? 'wallet-sync-replay',
    deployment: process.env.SANCTUARY_DEPLOYMENT_ID ?? `replay-${process.pid}`,
    owner: process.env.SANCTUARY_OWNER_ID ?? 'replay-controller',
    release: process.env.SANCTUARY_RELEASE ?? 'unreleased',
    commit,
    run: process.env.SANCTUARY_OPERATION_RUN_ID ?? `run-${process.pid}`,
  };
}

export function replayOwnershipLabels(resourceClass, cleanupPolicy = 'exact_delete') {
  const owner = identity();
  const labels = {
    'io.sanctuary.project': owner.project,
    'io.sanctuary.deployment-id': owner.deployment,
    'io.sanctuary.owner-id': owner.owner,
    'io.sanctuary.resource-class': resourceClass,
    'io.sanctuary.lifecycle': 'active',
    'io.sanctuary.cleanup-policy': cleanupPolicy,
    'io.sanctuary.created-at': CREATED_AT,
    'io.sanctuary.created-by-release': owner.release,
    'io.sanctuary.created-by-commit': owner.commit,
    'io.sanctuary.creation-run-id': owner.run,
  };
  return Object.entries(labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]);
}

export function registerReplayResource(resourceClass, name, immutableIdentity, cleanupPolicy = 'exact_delete') {
  const root = process.env.SANCTUARY_OWNERSHIP_ROOT;
  if (!root) return;
  const owner = identity();
  registerResource({
    deploymentId: owner.deployment, operationRunId: owner.run, ownerId: owner.owner,
    resourceClass, lifecycle: 'active', cleanupPolicy, createdAt: CREATED_AT,
    createdByRelease: owner.release, createdByCommit: owner.commit,
    locatorKind: 'name', locator: name, immutableIdentity,
    metadataDigest: createHash('sha256').update(`${resourceClass}\0${name}`).digest('hex'),
    referenceIds: [owner.run],
  }, { root: resolve(root), checkoutRoot: REPO_ROOT });
}

export function inspectOwnedId(kind, name, operation) {
  const args = kind === 'network'
    ? ['docker', 'network', 'inspect', '--format', '{{.Id}}', name]
    : ['docker', 'inspect', '--format', '{{.Id}}', name];
  return operation(args);
}
