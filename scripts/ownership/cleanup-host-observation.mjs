import { spawnSync } from 'node:child_process';
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync,
} from 'node:fs';
import path from 'node:path';
import { canonicalJson, canonicalSha256, parseStrictJson } from './canonical-json.mjs';
import {
  inspectCleanupEntry, inspectCleanupProcess, inspectCleanupWorktree,
} from './cleanup-safe-helper.mjs';
import { verifyCleanupHostAuthority } from './cleanup-host-authority.mjs';

function stableMarker(markerPath) {
  let descriptor;
  try {
    const before = lstatSync(markerPath);
    if (!before.isFile() || before.isSymbolicLink() || before.size > 4096) return null;
    descriptor = openSync(markerPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (opened.dev !== before.dev || opened.ino !== before.ino || !opened.isFile()) return null;
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== bytes.length) return null;
    const marker = parseStrictJson(bytes);
    return canonicalJson(marker).equals(bytes) ? marker : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function runTerminal(registration, runManifest) {
  return runManifest?.operationRunId === registration.operationRunId
    && runManifest?.deploymentId === registration.deploymentId
    && runManifest?.terminalAt !== null;
}

function markerMatches(marker, registration, state) {
  return marker?.operationRunId === registration.operationRunId && marker?.state === state;
}

function helperObservation(result, registration, { active = false, executable = false } = {}) {
  if (['absent', 'exited', 'removed'].includes(result.state)) return { state: 'missing' };
  if (result.state === 'current') return {
    state: 'current', immutableIdentity: registration.immutableIdentity, active, executable,
  };
  if (result.state === 'identity_changed') return {
    state: 'identity_changed', immutableIdentity: 'changed-host-identity',
  };
  return { state: result.state === 'unsupported' ? 'unverified' : 'ambiguous', error: result.reason ?? result.state };
}

function helperOptions(helper) {
  return { expectedHelperDigest: helper.helperDigest };
}

function inspectCollector(registration, helper, runManifest) {
  const authority = registration.executionAuthority;
  const result = inspectCleanupProcess(helper.helperPath, authority, helperOptions(helper));
  if (result.state !== 'current') return helperObservation(result, registration);
  const heartbeat = stableMarker(authority.heartbeatPath);
  const terminal = stableMarker(authority.terminalPath);
  const terminalPolicy = runTerminal(registration, runManifest)
    && markerMatches(terminal, registration, 'terminal');
  const heartbeatActive = markerMatches(heartbeat, registration, 'heartbeat') && !terminalPolicy;
  return helperObservation(result, registration, {
    active: !terminalPolicy || heartbeatActive, executable: terminalPolicy && !heartbeatActive,
  });
}

function git(root, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024, shell: false,
  });
  if (result.status !== 0) {
    if (allowFailure) return null;
    throw new Error('registered worktree Git observation failed');
  }
  return result.stdout.trim();
}

function exactCommonDirectory(root, authority) {
  const common = realpathSync(git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  const info = lstatSync(common);
  return common === authority.commonDir.canonicalPath
    && String(info.dev) === authority.commonDir.dev && String(info.ino) === authority.commonDir.ino
    && (typeof process.getuid !== 'function' || info.uid === process.getuid())
    && (info.mode & 0o022) === 0;
}

function exactAdminBacklinks(root, authority) {
  const admin = path.join(authority.commonDir.canonicalPath, 'worktrees', authority.adminEntry.basename);
  const info = lstatSync(admin);
  if (String(info.dev) !== authority.adminEntry.dev || String(info.ino) !== authority.adminEntry.ino
      || (typeof process.getuid === 'function' && info.uid !== process.getuid())
      || (info.mode & 0o022) !== 0) return false;
  const dotGit = readFileSync(path.join(root, '.git'), 'utf8').trim();
  const gitDir = readFileSync(path.join(admin, 'gitdir'), 'utf8').trim();
  return dotGit === `gitdir: ${admin}` && realpathSync(path.dirname(gitDir)) === realpathSync(root);
}

function exactWorktreeGit(authority) {
  const root = path.join(authority.parent.canonicalPath, authority.entry.basename);
  if (!exactCommonDirectory(root, authority) || !exactAdminBacklinks(root, authority)) return false;
  const branch = git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true }) ?? 'DETACHED';
  return branch === authority.branch
    && git(root, ['rev-parse', 'HEAD']) === authority.headOid
    && git(root, ['cat-file', '-e', `${authority.baseOid}^{commit}`]) === ''
    && git(root, ['status', '--porcelain=v2', '--untracked-files=all']) === '';
}

function inspectPath(registration, helper, runManifest) {
  const inspect = registration.resourceClass === 'git_worktree'
    ? inspectCleanupWorktree : inspectCleanupEntry;
  const result = inspect(helper.helperPath, registration.executionAuthority, helperOptions(helper));
  if (result.state !== 'current') return helperObservation(result, registration);
  const terminal = runTerminal(registration, runManifest);
  const lifecycleDigest = canonicalSha256({
    deploymentId: registration.deploymentId, operationRunId: registration.operationRunId,
  });
  const gitExact = registration.resourceClass !== 'git_worktree'
    || (registration.executionAuthority.lifecycleEvidenceDigest === lifecycleDigest
      && exactWorktreeGit(registration.executionAuthority));
  return helperObservation(result, registration, {
    active: !terminal, executable: terminal && gitExact,
  });
}

/** Build exact synchronous inspectors consumed by signed registration inventory. */
export function createCleanupHostInspectors({ helperAuthority, runManifest }) {
  const inspect = (registration) => {
    if (!helperAuthority?.available) return {
      state: 'unverified', error: helperAuthority?.failureClass ?? 'unsupported',
    };
    const helper = verifyCleanupHostAuthority(helperAuthority);
    try {
      return registration.resourceClass === 'collector_process'
        ? inspectCollector(registration, helper, runManifest)
        : inspectPath(registration, helper, runManifest);
    } catch (error) {
      return { state: 'ambiguous', error: error?.code ?? error?.name ?? 'query_failed' };
    }
  };
  return Object.freeze({
    collector_process: inspect, git_worktree: inspect, temporary_artifact: inspect,
  });
}
