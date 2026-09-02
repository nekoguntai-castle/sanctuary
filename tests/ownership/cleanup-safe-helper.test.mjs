import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, symlinkSync,
  realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import {
  CLEANUP_SAFE_HELPER_ABI,
  buildCleanupSafeHelper,
  cleanupQuarantineName,
  inspectCleanupEntry,
  inspectCleanupProcess,
  inspectCleanupSafeHelper,
  inspectCleanupWorktree,
  readCleanupScriptIdentity,
  readLinuxProcessIdentity,
  removeCleanupEntry,
  removeCleanupWorktree,
  stopCleanupProcess,
} from '../../scripts/ownership/cleanup-safe-helper.mjs';

const ROOT = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-safe-helper-'));
const HELPER = path.join(ROOT, 'cleanup-safe-helper');
const INVALID_HELPER_SOURCE = fileURLToPath(new URL('./fixtures/cleanup-helper-invalid-output.mjs', import.meta.url));
const INVALID_HELPER = path.join(ROOT, 'cleanup-helper-invalid-output.mjs');
const PROCESS_FIXTURE = fileURLToPath(new URL('./fixtures/cleanup-helper-process.mjs', import.meta.url));
const ZOMBIE_SOURCE = fileURLToPath(new URL('./fixtures/cleanup-helper-zombie.c', import.meta.url));
const ZOMBIE_FIXTURE = path.join(ROOT, 'cleanup-helper-zombie');
const LINUX = process.platform === 'linux';
let features;

function decimal(value) { return value.toString(); }

function entryAuthority(parent, basename, type) {
  const parentInfo = lstatSync(parent, { bigint: true });
  const entryInfo = lstatSync(path.join(parent, basename), { bigint: true });
  return {
    parent: {
      canonicalPath: parent, dev: decimal(parentInfo.dev), ino: decimal(parentInfo.ino),
      uid: decimal(parentInfo.uid), mode: 0o700,
    },
    entry: {
      basename, dev: decimal(entryInfo.dev), ino: decimal(entryInfo.ino), type,
    },
  };
}

function controlledParent(name) {
  const parent = path.join(ROOT, name);
  mkdirSync(parent, { mode: 0o700 });
  return parent;
}

function git(...args) {
  return execFileSync('git', args, {
    encoding: 'utf8', maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function worktreeAdminName(worktree) {
  const value = readFileSync(path.join(worktree, '.git'), 'utf8').trim();
  assert.match(value, /^gitdir: /);
  return path.basename(value.slice('gitdir: '.length));
}

function gitWorktreeFixture(name) {
  const repoParent = controlledParent(`${name}-repo-parent`);
  const artifactParent = controlledParent(`${name}-artifact-parent`);
  const repo = path.join(repoParent, 'repo');
  const target = path.join(artifactParent, 'target');
  const peer = path.join(artifactParent, 'peer');
  git('init', '-q', '-b', 'main', repo);
  git('-C', repo, 'config', 'user.email', 'cleanup@example.invalid');
  git('-C', repo, 'config', 'user.name', 'Cleanup Test');
  writeFileSync(path.join(repo, 'tracked'), 'preserve');
  git('-C', repo, 'add', 'tracked');
  git('-C', repo, 'commit', '-m', 'fixture');
  git('-C', repo, 'worktree', 'add', '-b', `${name}-target`, target, 'HEAD');
  git('-C', repo, 'worktree', 'add', '-b', `${name}-peer`, peer, 'HEAD');
  const commonDir = realpathSync(path.join(repo, '.git'));
  chmodSync(commonDir, 0o755);
  chmodSync(path.join(commonDir, 'worktrees'), 0o755);
  const adminEntryName = worktreeAdminName(target);
  const commonInfo = lstatSync(commonDir, { bigint: true });
  const adminInfo = lstatSync(path.join(commonDir, 'worktrees', adminEntryName), { bigint: true });
  return {
    repo, target, peer, commonDir, adminEntryName,
    authority: {
      kind: 'linux_git_worktree_v1',
      ...entryAuthority(artifactParent, 'target', 'directory'),
      commonDir: {
        canonicalPath: commonDir, dev: decimal(commonInfo.dev), ino: decimal(commonInfo.ino),
      },
      adminEntry: {
        basename: adminEntryName, dev: decimal(adminInfo.dev), ino: decimal(adminInfo.ino),
        type: 'directory',
      },
      branch: `${name}-target`, headOid: git('-C', target, 'rev-parse', 'HEAD'),
      baseOid: git('-C', repo, 'rev-parse', 'HEAD'), lifecycleEvidenceDigest: 'a'.repeat(64),
    },
  };
}

async function childIdentity(child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { return readLinuxProcessIdentity(child.pid); } catch {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw new Error('child did not publish a Linux process identity');
}

function waitForExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', resolve);
  });
}

function linuxProcessState(pid) {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3);
}

function holdCommonDirectoryLock(commonDir) {
  const holder = spawn('flock', [
    '--exclusive', commonDir, process.execPath, '-e',
    'process.stdout.write("locked\\n"); setTimeout(() => {}, 250)',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const ready = new Promise((resolve, reject) => {
    holder.once('error', reject);
    holder.once('exit', (code) => reject(new Error(`flock holder exited before readiness: ${code}`)));
    holder.stdout.once('data', resolve);
  });
  return { holder, ready };
}

before(() => {
  if (!LINUX) return;
  buildCleanupSafeHelper({ outputPath: HELPER });
  execFileSync('cc', [
    '-std=c17', '-O2', '-Wall', '-Wextra', '-Werror', ZOMBIE_SOURCE, '-o', ZOMBIE_FIXTURE,
  ]);
  writeFileSync(INVALID_HELPER, readFileSync(INVALID_HELPER_SOURCE), { mode: 0o700 });
  features = inspectCleanupSafeHelper(HELPER);
});

after(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

test('reports the exact bounded Linux ABI and syscall capabilities', { skip: !LINUX }, () => {
  assert.equal(features.abiVersion, CLEANUP_SAFE_HELPER_ABI);
  assert.equal(features.platform, 'linux');
  assert.match(features.helperDigest, /^[a-f0-9]{64}$/);
  for (const key of ['pidfd', 'openat2', 'renameat2']) assert.equal(typeof features[key], 'boolean');
  assert.throws(() => inspectCleanupSafeHelper(HELPER, {
    expectedHelperDigest: '0'.repeat(64),
  }), /digest changed before execution/);
});

test('pins process identity before inspection and bounded pidfd stop', { skip: !LINUX }, async (context) => {
  if (!features.pidfd) { context.skip('pidfd syscalls are unavailable'); return; }
  const child = spawn(process.execPath, [PROCESS_FIXTURE], {
    stdio: 'ignore', detached: false,
  });
  try {
    const identity = {
      ...await childIdentity(child), script: readCleanupScriptIdentity(PROCESS_FIXTURE),
      heartbeatPath: '/tmp/sanctuary-helper-heartbeat', terminalPath: '/tmp/sanctuary-helper-terminal',
    };
    assert.match(identity.pid, /^[1-9][0-9]*$/);
    assert.deepEqual(inspectCleanupProcess(HELPER, identity), { state: 'current' });
    assert.equal(inspectCleanupProcess(HELPER, {
      ...identity, startTimeTicks: (BigInt(identity.startTimeTicks) + 1n).toString(),
    }).state, 'identity_changed');
    assert.equal(inspectCleanupProcess(HELPER, {
      ...identity, argvDigest: '0'.repeat(64),
    }).state, 'identity_changed');
    assert.equal(inspectCleanupProcess(HELPER, {
      ...identity, script: { ...identity.script, sha256: '0'.repeat(64) },
    }).state, 'identity_changed');
    assert.deepEqual(stopCleanupProcess(HELPER, { ...identity, timeoutMs: 2_000 }), { state: 'exited' });
    await waitForExit(child);
    assert.deepEqual(inspectCleanupProcess(HELPER, identity), { state: 'absent' });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});

test('treats an exact unreaped Linux collector as exited', { skip: !LINUX }, async (context) => {
  if (!features.pidfd) { context.skip('pidfd syscalls are unavailable'); return; }
  const parent = spawn(ZOMBIE_FIXTURE, [], { stdio: ['ignore', 'pipe', 'pipe'] });
  let zombiePid;
  try {
    zombiePid = await new Promise((resolve, reject) => {
      parent.once('error', reject);
      parent.stdout.once('data', (chunk) => resolve(Number(chunk.toString().trim())));
    });
    const identity = {
      ...readLinuxProcessIdentity(zombiePid), script: readCleanupScriptIdentity(ZOMBIE_FIXTURE),
      heartbeatPath: '/tmp/sanctuary-helper-heartbeat', terminalPath: '/tmp/sanctuary-helper-terminal',
    };
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if (linuxProcessState(zombiePid) === 'Z') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(linuxProcessState(zombiePid), 'Z');
    assert.deepEqual(inspectCleanupProcess(HELPER, identity), { state: 'exited' });
    assert.throws(() => readLinuxProcessIdentity(zombiePid), /not runnable/);
  } finally {
    if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL');
    await waitForExit(parent);
  }
});

test('reports a bounded stop timeout without escalating to a PID signal fallback', { skip: !LINUX }, async (context) => {
  if (!features.pidfd) { context.skip('pidfd syscalls are unavailable'); return; }
  const child = spawn(process.execPath, [PROCESS_FIXTURE], {
    stdio: 'ignore', detached: false, env: { ...process.env, SANCTUARY_TEST_IGNORE_TERM: '1' },
  });
  try {
    const identity = {
      ...await childIdentity(child), script: readCleanupScriptIdentity(PROCESS_FIXTURE),
      heartbeatPath: '/tmp/sanctuary-helper-heartbeat', terminalPath: '/tmp/sanctuary-helper-terminal',
    };
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(stopCleanupProcess(HELPER, { ...identity, timeoutMs: 20 }), { state: 'timeout' });
    assert.equal(child.exitCode, null);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await waitForExit(child);
  }
});

test('inspects and removes only an exact entry beneath an unchanged 0700 parent', { skip: !LINUX }, (context) => {
  if (!features.openat2 || !features.renameat2) { context.skip('required descriptor syscalls are unavailable'); return; }
  const parent = controlledParent('exact-parent');
  const target = path.join(parent, 'target');
  mkdirSync(target, { mode: 0o700 });
  writeFileSync(path.join(target, 'payload'), 'owned');
  const authority = entryAuthority(parent, 'target', 'directory');
  assert.deepEqual(inspectCleanupEntry(HELPER, authority), { state: 'current' });
  assert.deepEqual(removeCleanupEntry(HELPER, authority, '1'.repeat(64)), { state: 'removed' });
  assert.equal(existsSync(target), false);
  assert.deepEqual(removeCleanupEntry(HELPER, authority, '1'.repeat(64)), { state: 'absent' });
});

test('refuses a mutable parent and an entry replaced after registration', { skip: !LINUX }, () => {
  const mutable = controlledParent('mutable-parent');
  writeFileSync(path.join(mutable, 'target'), 'owned');
  const mutableAuthority = entryAuthority(mutable, 'target', 'file');
  chmodSync(mutable, 0o755);
  assert.equal(inspectCleanupEntry(HELPER, mutableAuthority).state, 'refused');
  assert.equal(removeCleanupEntry(HELPER, mutableAuthority, '2'.repeat(64)).state, 'refused');
  assert.equal(existsSync(path.join(mutable, 'target')), true);
  assert.throws(() => inspectCleanupEntry(HELPER, {
    ...mutableAuthority, parent: { ...mutableAuthority.parent, uid: '99999999' },
  }), /uid does not match/);

  const replaced = controlledParent('replacement-parent');
  writeFileSync(path.join(replaced, 'target'), 'first');
  const replacementAuthority = entryAuthority(replaced, 'target', 'file');
  renameSync(path.join(replaced, 'target'), path.join(replaced, 'old'));
  writeFileSync(path.join(replaced, 'target'), 'replacement');
  assert.equal(removeCleanupEntry(HELPER, replacementAuthority, '3'.repeat(64)).state, 'identity_changed');
  assert.equal(existsSync(path.join(replaced, 'target')), true);

  const canonical = controlledParent('canonical-parent');
  writeFileSync(path.join(canonical, 'target'), 'owned');
  const alias = path.join(ROOT, 'canonical-parent-alias');
  symlinkSync(canonical, alias);
  const aliasAuthority = {
    ...entryAuthority(canonical, 'target', 'file'),
    parent: { ...entryAuthority(canonical, 'target', 'file').parent, canonicalPath: alias },
  };
  assert.equal(inspectCleanupEntry(HELPER, aliasAuthority).state, 'refused');
});

test('never follows a replacement symlink', { skip: !LINUX }, () => {
  const parent = controlledParent('symlink-parent');
  const outside = path.join(ROOT, 'outside-evidence');
  writeFileSync(outside, 'preserve');
  writeFileSync(path.join(parent, 'target'), 'owned');
  const authority = entryAuthority(parent, 'target', 'file');
  renameSync(path.join(parent, 'target'), path.join(parent, 'old'));
  symlinkSync(outside, path.join(parent, 'target'));
  assert.equal(removeCleanupEntry(HELPER, authority, '4'.repeat(64)).state, 'identity_changed');
  assert.equal(existsSync(outside), true);
});

test('resumes an exact deterministic quarantine after interruption', { skip: !LINUX }, (context) => {
  if (!features.openat2) { context.skip('openat2 is unavailable'); return; }
  const parent = controlledParent('recovery-parent');
  const target = path.join(parent, 'target');
  mkdirSync(target, { mode: 0o700 });
  writeFileSync(path.join(target, 'already-removed'), 'first');
  writeFileSync(path.join(target, 'remaining'), 'second');
  const authority = entryAuthority(parent, 'target', 'directory');
  const intent = '5'.repeat(64);
  const quarantine = path.join(parent, cleanupQuarantineName(intent));
  renameSync(target, quarantine);
  renameSync(path.join(quarantine, 'already-removed'), path.join(parent, 'removed-before-crash'));
  assert.deepEqual(removeCleanupEntry(HELPER, authority, intent), { state: 'removed' });
  assert.equal(existsSync(quarantine), false);
  assert.equal(existsSync(path.join(parent, 'removed-before-crash')), true);
});

test('removes one exact Git worktree and admin entry while preserving its peer and common repository', {
  skip: !LINUX || spawnSync('git', ['--version'], { stdio: 'ignore' }).status !== 0,
}, (context) => {
  if (!features.openat2 || !features.renameat2) { context.skip('required descriptor syscalls are unavailable'); return; }
  const fixture = gitWorktreeFixture('exact-worktree');
  const peerAdmin = worktreeAdminName(fixture.peer);
  assert.deepEqual(removeCleanupWorktree(
    HELPER, fixture.authority, '6'.repeat(64),
  ), { state: 'removed' });
  assert.deepEqual(removeCleanupWorktree(
    HELPER, fixture.authority, '6'.repeat(64),
  ), { state: 'absent' });
  assert.equal(existsSync(fixture.target), false);
  assert.equal(existsSync(path.join(fixture.commonDir, 'worktrees', fixture.adminEntryName)), false);
  assert.equal(existsSync(fixture.peer), true);
  assert.equal(existsSync(path.join(fixture.commonDir, 'worktrees', peerAdmin)), true);
  assert.equal(git('-C', fixture.repo, 'rev-parse', '--is-inside-work-tree'), 'true');
  assert.equal(git('-C', fixture.peer, 'status', '--porcelain'), '');
});

test('worktree inspection requires both checkout and admin metadata to be absent', {
  skip: !LINUX || spawnSync('git', ['--version'], { stdio: 'ignore' }).status !== 0,
}, (context) => {
  if (!features.openat2 || !features.renameat2) { context.skip('required descriptor syscalls are unavailable'); return; }
  const orphaned = gitWorktreeFixture('orphaned-worktree');
  rmSync(path.dirname(orphaned.target), { recursive: true });
  assert.equal(existsSync(path.dirname(orphaned.target)), false);
  assert.deepEqual(inspectCleanupWorktree(HELPER, orphaned.authority), {
    state: 'ambiguous', reason: 'worktree_state_conflict',
  });

  const removed = gitWorktreeFixture('removed-worktree');
  assert.deepEqual(removeCleanupWorktree(
    HELPER, removed.authority, '9'.repeat(64),
  ), { state: 'removed' });
  rmSync(path.dirname(removed.target), { recursive: true });
  rmSync(path.join(removed.commonDir, 'worktrees'), { recursive: true });
  assert.equal(existsSync(path.dirname(removed.target)), false);
  assert.deepEqual(inspectCleanupWorktree(HELPER, removed.authority), { state: 'absent' });
});

test('recovers exact Git quarantines after a concurrent common-dir lock releases', {
  skip: !LINUX || spawnSync('git', ['--version'], { stdio: 'ignore' }).status !== 0,
}, async (context) => {
  if (!features.openat2 || !features.renameat2) { context.skip('required descriptor syscalls are unavailable'); return; }
  if (spawnSync('flock', ['--version'], { stdio: 'ignore' }).status !== 0) {
    context.skip('flock command is unavailable for the concurrency fixture'); return;
  }
  const fixture = gitWorktreeFixture('recover-worktree');
  const intent = '7'.repeat(64);
  const quarantine = path.join(path.dirname(fixture.target), cleanupQuarantineName(intent));
  const adminQuarantine = path.join(
    fixture.commonDir, 'worktrees', cleanupQuarantineName(intent),
  );
  renameSync(fixture.target, quarantine);
  renameSync(
    path.join(fixture.commonDir, 'worktrees', fixture.adminEntryName), adminQuarantine,
  );
  const { holder, ready } = holdCommonDirectoryLock(fixture.commonDir);
  await ready;
  assert.deepEqual(removeCleanupWorktree(HELPER, fixture.authority, intent), {
    state: 'refused', reason: 'worktree_common_dir_locked',
  });
  assert.equal(existsSync(quarantine), true);
  assert.equal(existsSync(adminQuarantine), true);
  await waitForExit(holder);
  assert.deepEqual(removeCleanupWorktree(HELPER, fixture.authority, intent), { state: 'removed' });
  assert.equal(existsSync(quarantine), false);
  assert.equal(existsSync(adminQuarantine), false);
  assert.equal(existsSync(path.join(fixture.commonDir, 'worktrees', fixture.adminEntryName)), false);
  assert.equal(existsSync(fixture.peer), true);
  assert.equal(git('-C', fixture.repo, 'show', '--format=%H', '--no-patch'), fixture.authority.headOid);
});

test('refuses writable Git authority and backlink drift without moving either exact entry', {
  skip: !LINUX || spawnSync('git', ['--version'], { stdio: 'ignore' }).status !== 0,
}, (context) => {
  if (!features.openat2 || !features.renameat2) { context.skip('required descriptor syscalls are unavailable'); return; }
  const fixture = gitWorktreeFixture('refuse-worktree');
  const admin = path.join(fixture.commonDir, 'worktrees', fixture.adminEntryName);
  chmodSync(fixture.commonDir, 0o775);
  assert.equal(removeCleanupWorktree(
    HELPER, fixture.authority, '8'.repeat(64),
  ).state, 'refused');
  chmodSync(fixture.commonDir, 0o755);
  writeFileSync(path.join(admin, 'gitdir'), '/tmp/replaced/.git\n');
  assert.equal(removeCleanupWorktree(
    HELPER, fixture.authority, '8'.repeat(64),
  ).state, 'identity_changed');
  assert.equal(existsSync(fixture.target), true);
  assert.equal(existsSync(admin), true);
  assert.equal(existsSync(fixture.peer), true);
});

test('rejects unsafe basenames and output beyond the protocol bound', { skip: !LINUX }, () => {
  const parent = controlledParent('validation-parent');
  writeFileSync(path.join(parent, 'target'), 'owned');
  const authority = entryAuthority(parent, 'target', 'file');
  assert.throws(() => inspectCleanupEntry(HELPER, {
    ...authority, entry: { ...authority.entry, basename: '../target' },
  }), /basename is unsafe/);
  assert.throws(() => inspectCleanupSafeHelper(INVALID_HELPER, { maxOutputBytes: 1024 }), /output_limit/);
});
