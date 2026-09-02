import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalSha256 } from './canonical-json.mjs';
import { ciCleanupProviderContext } from './ci-cleanup-trust.mjs';
import { sha256 } from './crypto.mjs';

const LANE = /^[a-z0-9][a-z0-9-]{0,31}$/;

function gitHead(checkoutRoot) {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: checkoutRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function composeProjectName(runId, runAttempt, lane) {
  const name = `ci-${runId}-${runAttempt}-${lane}`.toLowerCase();
  if (name.length <= 63) return name;
  const suffix = canonicalSha256({ name }).slice(0, 10);
  return `${name.slice(0, 52)}-${suffix}`;
}

export function ciCleanupAuthority({
  checkoutRoot, runtimeDirectory, lane, authorityMode = 'coordinator_managed',
}) {
  if (!LANE.test(lane ?? '')) throw new Error('cleanup lane has an invalid format');
  if (!['coordinator_managed', 'deployment_managed_by_subject'].includes(authorityMode)) {
    throw new Error('cleanup authority mode is invalid');
  }
  const context = ciCleanupProviderContext();
  const project = composeProjectName(context.runId, context.runAttempt, lane);
  const scope = `ci-${context.runId}-${context.runAttempt}-${lane}`;
  const policyDigest = sha256(readFileSync(
    path.join(checkoutRoot, 'config/resource-ownership-contract.json'),
  ));
  return {
    ...context, lane, checkoutRoot: path.resolve(checkoutRoot),
    runtimeDirectory: path.resolve(runtimeDirectory),
    deploymentId: `${scope}-deploy`, ownerId: `${scope}-owner`,
    operationRunId: `${scope}-cleanup`, composeProjectName: project,
    checkoutCommit: gitHead(checkoutRoot), policyDigest, authorityMode,
  };
}

export function assertCiCleanupAuthority(state, checkoutRoot) {
  const expected = ciCleanupAuthority({
    checkoutRoot, runtimeDirectory: state.authority.runtimeDirectory,
    lane: state.authority.lane, authorityMode: state.authority.authorityMode,
  });
  if (canonicalSha256(expected) !== state.authorityCoreDigest) {
    throw new Error('cleanup coordinator authority changed before resume');
  }
}
