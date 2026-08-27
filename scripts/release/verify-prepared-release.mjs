#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const USAGE = 'Usage: verify-prepared-release.mjs --prepared-version X.Y.Z --commit <40-lowercase-hex-sha>';

export function parseArgs(args) {
  if (args.length !== 4 || args[0] !== '--prepared-version' || args[2] !== '--commit') {
    throw new Error(USAGE);
  }
  const version = args[1];
  const commit = args[3];
  if (!VERSION_PATTERN.test(version) || !COMMIT_PATTERN.test(commit)) {
    throw new Error(USAGE);
  }
  return { version, commit };
}

export function nextRcTag(version, tags) {
  const escaped = version.replaceAll('.', '\\.');
  const pattern = new RegExp(`^v${escaped}-rc\\.?([1-9]\\d*)$`);
  const used = new Set(tags.flatMap((tag) => {
    const match = tag.match(pattern);
    return match ? [Number(match[1])] : [];
  }));
  let number = 1;
  while (used.has(number)) number += 1;
  return `v${version}-rc${number}`;
}

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', ...options }).trim();
}

function fetchReleaseRefs() {
  git([
    'fetch',
    'origin',
    'refs/heads/main:refs/remotes/origin/main',
    '--tags',
    '--prune',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function assertCleanWorktree() {
  const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
  if (status) throw new Error('prepared release worktree is not clean');
}

function assertCommit(commit) {
  const head = git(['rev-parse', 'HEAD']);
  if (head !== commit) throw new Error(`HEAD ${head} does not match prepared commit ${commit}`);
  try {
    git(['merge-base', '--is-ancestor', commit, 'origin/main']);
  } catch {
    throw new Error(`prepared commit ${commit} is not an ancestor of origin/main`);
  }
}

function assertPackageVersion(version) {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  if (manifest.version !== version) {
    throw new Error(`package.json version ${String(manifest.version)} does not match ${version}`);
  }
}

function assertDatedChangelog(version) {
  const changelog = readFileSync('docs/reference/changelog.md', 'utf8');
  const escaped = version.replaceAll('.', '\\.');
  const headings = changelog.match(new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'gm')) ?? [];
  if (headings.length !== 1) {
    throw new Error(`changelog must contain exactly one dated heading for ${version}`);
  }
}

function assertReleaseEvidence() {
  try {
    execFileSync('./scripts/bump-version.sh', ['--check'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error('prepared release evidence check failed');
  }
}

function releaseTags() {
  const output = git(['tag', '--list']);
  return output ? output.split('\n') : [];
}

export function verifyPreparedRelease({ version, commit }) {
  fetchReleaseRefs();
  assertCleanWorktree();
  assertCommit(commit);
  assertPackageVersion(version);
  assertDatedChangelog(version);
  assertReleaseEvidence();
  assertCleanWorktree();
  return nextRcTag(version, releaseTags());
}

function main() {
  try {
    const prepared = parseArgs(process.argv.slice(2));
    const nextTag = verifyPreparedRelease(prepared);
    process.stdout.write(`Prepared release verified: v${prepared.version} at ${prepared.commit}; next RC: ${nextTag}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
