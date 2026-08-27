import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import { nextRcTag, parseArgs } from '../../scripts/release/verify-prepared-release.mjs';

const verifier = resolve('scripts/release/verify-prepared-release.mjs');
const version = '1.2.3';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function commitAll(repo, message) {
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']);
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'sanctuary-prepared-release-'));
  const origin = join(root, 'origin.git');
  const repo = join(root, 'repo');
  git(root, ['init', '--bare', '--quiet', origin]);
  git(root, ['init', '--quiet', '-b', 'main', repo]);
  git(repo, ['config', 'user.name', 'Release Test']);
  git(repo, ['config', 'user.email', 'release-test@example.invalid']);
  git(repo, ['remote', 'add', 'origin', origin]);
  write(join(repo, 'package.json'), `${JSON.stringify({ name: 'fixture', version }, null, 2)}\n`);
  write(join(repo, 'docs/reference/changelog.md'), `# Changelog\n\n## [${version}] - 2026-08-27\n`);
  const bump = join(repo, 'scripts/bump-version.sh');
  write(bump, '#!/usr/bin/env bash\n[[ "$1" == --check ]] || exit 2\n[[ "${STUB_BUMP_FAIL:-0}" == 0 ]] || exit 23\n[[ "${STUB_BUMP_DIRTY:-0}" == 0 ]] || printf dirty > post-check.txt\n');
  chmodSync(bump, 0o755);
  const commit = commitAll(repo, 'prepared release');
  git(repo, ['push', '--quiet', '-u', 'origin', 'main']);
  return { root, origin, repo, commit };
}

function run(fixture, args = ['--prepared-version', version, '--commit', fixture.commit], env = {}) {
  return spawnSync(process.execPath, [verifier, ...args], {
    cwd: fixture.repo,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function updateMain(fixture, path, contents, message) {
  write(join(fixture.repo, path), contents);
  fixture.commit = commitAll(fixture.repo, message);
  git(fixture.repo, ['push', '--quiet', 'origin', 'main']);
}

test('parses only the exact prepared-version CLI', () => {
  const commit = 'a'.repeat(40);
  assert.deepEqual(parseArgs(['--prepared-version', version, '--commit', commit]), { version, commit });
  for (const args of [
    [],
    ['--commit', commit, '--prepared-version', version],
    ['--prepared-version', version],
    ['--prepared-version', version, '--commit', commit, 'patch'],
    ['--prepared-version', version, '--prepared-version', commit],
    ['--prepared-version', '01.2.3', '--commit', commit],
    ['--prepared-version', version, '--commit', 'A'.repeat(40)],
  ]) assert.throws(() => parseArgs(args), /Usage:/);
});

test('selects the first unused RC across current and legacy tag forms', () => {
  assert.equal(nextRcTag(version, []), 'v1.2.3-rc1');
  assert.equal(nextRcTag(version, ['v1.2.3-rc1', 'v1.2.3-rc.2', 'v1.2.3-rc4']), 'v1.2.3-rc3');
  assert.equal(nextRcTag(version, ['v9.9.9-rc1', 'v1.2.3-rc0']), 'v1.2.3-rc1');
});

test('verifies a landed prepared commit and reports the next unused RC', () => {
  const fixture = createFixture();
  try {
    git(fixture.repo, ['tag', 'v1.2.3-rc1']);
    git(fixture.repo, ['tag', 'v1.2.3-rc.2']);
    git(fixture.repo, ['push', '--quiet', 'origin', '--tags']);
    const result = run(fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `Prepared release verified: v${version} at ${fixture.commit}; next RC: v1.2.3-rc3\n`);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test('rejects a prepared commit that is not on origin/main', () => {
  const fixture = createFixture();
  try {
    write(join(fixture.repo, 'branch-only.txt'), 'not landed\n');
    fixture.commit = commitAll(fixture.repo, 'branch-only change');
    const result = run(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not an ancestor of origin\/main/);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test('rejects when HEAD does not equal the supplied commit', () => {
  const fixture = createFixture();
  try {
    const supplied = fixture.commit;
    write(join(fixture.repo, 'later.txt'), 'later\n');
    commitAll(fixture.repo, 'later commit');
    const result = run(fixture, ['--prepared-version', version, '--commit', supplied]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /HEAD .* does not match prepared commit/);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test('rejects a mismatched prepared package version', () => {
  const fixture = createFixture();
  try {
    updateMain(fixture, 'package.json', `${JSON.stringify({ name: 'fixture', version: '1.2.4' }, null, 2)}\n`, 'wrong version');
    const result = run(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package\.json version 1\.2\.4 does not match 1\.2\.3/);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test('rejects missing or duplicate dated changelog evidence', async (t) => {
  for (const [name, changelog] of [
    ['missing', '# Changelog\n'],
    ['duplicate', `# Changelog\n\n## [${version}] - 2026-08-27\n\n## [${version}] - 2026-08-26\n`],
  ]) await t.test(name, () => {
    const fixture = createFixture();
    try {
      updateMain(fixture, 'docs/reference/changelog.md', changelog, `changelog ${name}`);
      const result = run(fixture);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /exactly one dated heading/);
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  });
});

test('fails closed when release evidence validation fails', () => {
  const fixture = createFixture();
  try {
    const result = run(fixture, undefined, { STUB_BUMP_FAIL: '1' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /prepared release evidence check failed/);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test('rejects a dirty prepared worktree', () => {
  const fixture = createFixture();
  try {
    write(join(fixture.repo, 'untracked.txt'), 'dirty\n');
    const result = run(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /worktree is not clean/);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test('rejects evidence validation that dirties the prepared worktree', () => {
  const fixture = createFixture();
  try {
    const result = run(fixture, undefined, { STUB_BUMP_DIRTY: '1' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /worktree is not clean/);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});
