import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalSha256 } from './canonical-json.mjs';
import { ciCleanupProviderContext } from './ci-cleanup-trust.mjs';
import { readUpgradeTarget } from './ci-cleanup-upgrade-target.mjs';
import { sha256 } from './crypto.mjs';

const LANE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const OWNERSHIP_CONTRACT = 'config/resource-ownership-contract.json';

export function gitHead(checkoutRoot) {
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

/**
 * Resolve the one candidate commit a lane may move its checkout to after the
 * source revision the authority binds is installed (issue #1028). The commit
 * must exist in the checkout and differ from the bound commit; its ownership
 * contract digest is recorded so the successor's policy binding is
 * provider-verified rather than taken from the subject.
 */
export function resolveUpgradeTarget(checkoutRoot, checkoutCommit, commit) {
  if (!COMMIT.test(commit ?? '')) throw new Error('upgrade target commit must be a full commit');
  if (commit === checkoutCommit) throw new Error('upgrade target commit must differ from the checkout commit');
  let contract;
  try {
    contract = execFileSync('git', ['show', `${commit}:${OWNERSHIP_CONTRACT}`], {
      cwd: checkoutRoot, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1024 * 1024,
    });
  } catch {
    throw new Error('upgrade target commit is not present in the checkout');
  }
  return Object.freeze({ commit, policyDigest: sha256(contract) });
}

export function assertCiCleanupAuthority(state, checkoutRoot) {
  let expected = ciCleanupAuthority({
    checkoutRoot, runtimeDirectory: state.authority.runtimeDirectory,
    lane: state.authority.lane, authorityMode: state.authority.authorityMode,
  });
  // A declared upgrade lane's checkout moves to the candidate commit once the
  // bound source revision is installed; the authority stays bound to the
  // source. Any other drift of the checkout is still a changed authority.
  const target = readUpgradeTarget(state, checkoutRoot);
  if (target !== null && expected.checkoutCommit === target.commit
      && expected.policyDigest === target.policyDigest) {
    expected = {
      ...expected, checkoutCommit: state.authority.checkoutCommit,
      policyDigest: state.authority.policyDigest,
    };
  }
  if (canonicalSha256(expected) !== state.authorityCoreDigest) {
    throw new Error('cleanup coordinator authority changed before resume');
  }
}
