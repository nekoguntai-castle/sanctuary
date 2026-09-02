import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';
import { describeHostAuthority } from '../../scripts/ownership/describe-host-authority.mjs';

function privateFixture(label) {
  const root = mkdtempSync(path.join(os.tmpdir(), `sanctuary-authority-${label}-`));
  chmodSync(root, 0o700);
  return root;
}

test('temporary authority binds one directory beneath its exact 0700 parent', () => {
  const parent = privateFixture('temp');
  const artifact = path.join(parent, 'artifact');
  mkdirSync(artifact);
  const described = describeHostAuthority(['temporary', artifact, 'run-1']);
  assert.equal(described.locator, artifact);
  assert.equal(described.executionAuthority.parent.mode, 448);
  assert.equal(described.executionAuthority.entry.basename, 'artifact');
  assert.equal(described.executionAuthority.entry.dev, described.executionAuthority.parent.dev);
  assert.equal(described.metadataDigest, canonicalSha256(described.executionAuthority));

  chmodSync(parent, 0o755);
  assert.throws(() => describeHostAuthority(['temporary', artifact, 'run-1']), /owner-only/);
  rmSync(parent, { recursive: true });
});

test('collector authority binds proc start, boot, argv, and exact script bytes', async () => {
  const parent = privateFixture('collector');
  const script = path.join(parent, 'collector.mjs');
  writeFileSync(script, 'setInterval(() => {}, 1000);\n');
  const child = spawn(process.execPath, [script], { stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  try {
    const described = describeHostAuthority([
      'collector', String(child.pid), script,
      path.join(parent, 'heartbeat.json'), path.join(parent, 'terminal.json'),
    ]);
    assert.equal(described.executionAuthority.pid, String(child.pid));
    assert.match(described.executionAuthority.startTimeTicks, /^[0-9]+$/);
    assert.equal(described.executionAuthority.script.ino, String(statSync(script).ino));
    assert.equal(described.metadataDigest, canonicalSha256(described.executionAuthority));
  } finally {
    child.kill('SIGKILL');
    await new Promise((resolve) => child.once('exit', resolve));
    rmSync(parent, { recursive: true });
  }
});

test('worktree authority distinguishes a linked clean checkout from an ordinary clone', async () => {
  const { spawnSync } = await import('node:child_process');
  const fixture = privateFixture('worktree');
  const repository = path.join(fixture, 'repository');
  const parent = path.join(fixture, 'worktrees');
  mkdirSync(repository);
  mkdirSync(parent, { mode: 0o700 });
  const run = (cwd, args) => {
    const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  run(repository, ['init', '--quiet']);
  run(repository, ['config', 'user.name', 'Sanctuary Test']);
  run(repository, ['config', 'user.email', 'test@example.invalid']);
  writeFileSync(path.join(repository, 'README.md'), 'fixture\n');
  run(repository, ['add', 'README.md']);
  run(repository, ['commit', '--quiet', '-m', 'fixture']);
  const head = run(repository, ['rev-parse', 'HEAD']);
  const linked = path.join(parent, 'linked');
  run(repository, ['worktree', 'add', '--quiet', '--detach', linked, head]);
  chmodSync(path.join(repository, '.git'), 0o755);
  chmodSync(path.join(repository, '.git', 'worktrees'), 0o755);
  chmodSync(run(linked, ['rev-parse', '--path-format=absolute', '--git-dir']), 0o755);
  try {
    const described = describeHostAuthority(['worktree', linked, head, 'deploy-1', 'run-1']);
    assert.equal(described.executionAuthority.branch, 'DETACHED');
    assert.equal(described.executionAuthority.headOid, head);
    assert.equal(described.executionAuthority.entry.basename, 'linked');
    assert.equal(described.metadataDigest, canonicalSha256(described.executionAuthority));
    chmodSync(path.join(repository, '.git'), 0o775);
    assert.throws(() => describeHostAuthority([
      'worktree', linked, head, 'deploy-1', 'run-1',
    ]), /owner-controlled/);
    chmodSync(path.join(repository, '.git'), 0o755);
    assert.throws(() => describeHostAuthority([
      'worktree', repository, head, 'deploy-1', 'run-1',
    ]), /not a linked Git worktree/);
  } finally {
    run(repository, ['worktree', 'remove', '--force', linked]);
    rmSync(fixture, { recursive: true });
  }
});
