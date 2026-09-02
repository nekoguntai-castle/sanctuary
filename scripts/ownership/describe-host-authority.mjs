#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, canonicalSha256 } from './canonical-json.mjs';
import {
  readCleanupScriptIdentity, readLinuxProcessIdentity,
} from './cleanup-safe-helper.mjs';

function usage() {
  throw new Error('usage: describe-host-authority.mjs temporary PATH RUN_ID | collector PID SCRIPT HEARTBEAT TERMINAL | worktree PATH BASE_OID DEPLOYMENT_ID RUN_ID');
}

function canonicalDirectory(value, label) {
  const resolved = realpathSync(path.resolve(value));
  const info = lstatSync(resolved, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} must be a canonical directory`);
  return { resolved, info };
}

function ownerControlledDirectory(value, label) {
  const directory = canonicalDirectory(value, label);
  if ((typeof process.getuid === 'function' && directory.info.uid !== BigInt(process.getuid()))
      || (directory.info.mode & 0o022n) !== 0n) {
    throw new Error(`${label} must be owner-controlled and non-writable by group or other`);
  }
  return directory;
}

function controlledEntry(value) {
  const entry = canonicalDirectory(value, 'host artifact');
  const parent = canonicalDirectory(path.dirname(entry.resolved), 'host artifact parent');
  if ((parent.info.mode & 0o777n) !== 0o700n
      || (typeof process.getuid === 'function' && parent.info.uid !== BigInt(process.getuid()))
      || parent.info.dev !== entry.info.dev) {
    throw new Error('host artifact parent must be owner-only, owner-controlled, and on the entry device');
  }
  return {
    locator: entry.resolved,
    parent: {
      canonicalPath: parent.resolved, dev: parent.info.dev.toString(), ino: parent.info.ino.toString(),
      uid: parent.info.uid.toString(), mode: 448,
    },
    entry: {
      basename: path.basename(entry.resolved), dev: entry.info.dev.toString(),
      ino: entry.info.ino.toString(), type: 'directory',
    },
  };
}

function bundle(resourceClass, locatorKind, locator, immutableIdentity, executionAuthority) {
  return {
    resourceClass, locatorKind, locator, immutableIdentity, executionAuthority,
    metadataDigest: canonicalSha256(executionAuthority),
  };
}

function temporary(args) {
  if (args.length !== 2) usage();
  const [artifactPath, creatorRunId] = args;
  const entry = controlledEntry(artifactPath);
  const executionAuthority = {
    kind: 'linux_dirfd_v1', parent: entry.parent, entry: entry.entry, creatorRunId,
  };
  return bundle(
    'temporary_artifact', 'path', entry.locator,
    `path-${entry.entry.dev}-${entry.entry.ino}`, executionAuthority,
  );
}

function positivePid(value) {
  if (!/^[1-9][0-9]{0,9}$/.test(value) || Number(value) > 0x7fffffff) throw new Error('PID is invalid');
  return Number(value);
}

function collector(args) {
  if (args.length !== 4) usage();
  const [pidValue, scriptPath, heartbeatPath, terminalPath] = args;
  const identity = readLinuxProcessIdentity(positivePid(pidValue));
  const executionAuthority = {
    kind: 'linux_pidfd_v1', pid: String(identity.pid),
    startTimeTicks: identity.startTimeTicks, bootIdDigest: identity.bootIdDigest,
    argvDigest: identity.argvDigest, script: readCleanupScriptIdentity(realpathSync(scriptPath)),
    heartbeatPath: path.resolve(heartbeatPath), terminalPath: path.resolve(terminalPath),
  };
  return bundle(
    'collector_process', 'authority', executionAuthority.pid,
    `pid-start-${executionAuthority.pid}-${executionAuthority.startTimeTicks}`, executionAuthority,
  );
}

function git(root, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024, shell: false,
  });
  if (result.status !== 0) {
    if (allowFailure) return null;
    throw new Error('Git worktree authority query failed');
  }
  return result.stdout.trim();
}

function worktree(args) {
  if (args.length !== 4) usage();
  const [worktreePath, baseOid, deploymentId, operationRunId] = args;
  if (!/^[a-f0-9]{40}$/.test(baseOid)) throw new Error('worktree base OID must be a full commit');
  const entry = controlledEntry(worktreePath);
  const common = ownerControlledDirectory(
    git(entry.locator, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    'Git common directory',
  );
  const gitDirectory = realpathSync(git(entry.locator, ['rev-parse', '--path-format=absolute', '--git-dir']));
  if (path.dirname(gitDirectory) !== path.join(common.resolved, 'worktrees')) {
    throw new Error('registered checkout is not a linked Git worktree');
  }
  const branch = git(entry.locator, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true }) ?? 'DETACHED';
  const admin = ownerControlledDirectory(gitDirectory, 'Git worktree administrative entry');
  const headOid = git(entry.locator, ['rev-parse', 'HEAD']);
  if (git(entry.locator, ['status', '--porcelain=v2', '--untracked-files=all']) !== '') {
    throw new Error('worktree must be clean at registration');
  }
  const executionAuthority = {
    kind: 'linux_git_worktree_v1', parent: entry.parent, entry: entry.entry,
    commonDir: {
      canonicalPath: common.resolved, dev: common.info.dev.toString(), ino: common.info.ino.toString(),
    },
    adminEntry: {
      basename: path.basename(gitDirectory), dev: admin.info.dev.toString(),
      ino: admin.info.ino.toString(), type: 'directory',
    },
    branch, headOid, baseOid,
    lifecycleEvidenceDigest: canonicalSha256({ deploymentId, operationRunId }),
  };
  return bundle(
    'git_worktree', 'path', entry.locator,
    `worktree-${entry.entry.dev}-${entry.entry.ino}`, executionAuthority,
  );
}

export function describeHostAuthority([command, ...args]) {
  if (command === 'temporary') return temporary(args);
  if (command === 'collector') return collector(args);
  if (command === 'worktree') return worktree(args);
  return usage();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { process.stdout.write(canonicalJson(describeHostAuthority(process.argv.slice(2)))); }
  catch (error) {
    process.stderr.write(`describe-host-authority: ${error.message}\n`);
    process.exitCode = 1;
  }
}
