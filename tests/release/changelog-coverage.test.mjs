import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../..');
const changelog = readFileSync(resolve(repoRoot, 'docs/reference/changelog.md'), 'utf8');
const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
const baseline = [0, 8, 43];

function git(...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function parseVersion(value) {
  const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function stableTagsAfterBaseline() {
  return git('tag', '--list', 'v0.8.*')
    .split('\n')
    .filter(Boolean)
    .map(tag => ({ tag, version: parseVersion(tag) }))
    .filter(entry => entry.version && compareVersions(entry.version, baseline) > 0)
    .sort((left, right) => compareVersions(right.version, left.version));
}

function releaseHeadings() {
  return [...changelog.matchAll(/^## \[([^\]]+)](?: - (\d{4}-\d{2}-\d{2}))?$/gm)]
    .map(match => ({ version: match[1], date: match[2] }));
}

test('changelog covers every post-v0.8.43 stable tag exactly once in order', () => {
  const tags = stableTagsAfterBaseline();
  const expectedVersions = tags.map(({ tag }) => tag.slice(1));
  const headings = releaseHeadings();
  const covered = headings.filter(({ version }) => {
    const parsed = parseVersion(version);
    return parsed && compareVersions(parsed, baseline) > 0;
  });

  assert.equal(headings[0]?.version, 'Unreleased');
  assert.deepEqual(covered.map(({ version }) => version), expectedVersions);
  assert.equal(new Set(covered.map(({ version }) => version)).size, covered.length);
  assert.equal(expectedVersions.includes('0.8.51'), false, 'v0.8.51 was never a stable tag');

  for (const { tag } of tags) {
    const version = tag.slice(1);
    const expectedDate = git(
      'for-each-ref',
      '--format=%(creatordate:short)',
      `refs/tags/${tag}`,
    );
    assert.deepEqual(
      covered.filter(heading => heading.version === version),
      [{ version, date: expectedDate }],
      `${tag} must have exactly one heading dated from tag history`,
    );
    assert.match(
      changelog,
      new RegExp(`^\\[${version.replaceAll('.', '\\.')}]\\: .+${tag}$`, 'm'),
      `${tag} must have a comparison link`,
    );
  }
});

test('current package version is represented by a stable changelog heading', () => {
  assert.match(rootPackage.version, /^\d+\.\d+\.\d+$/);
  assert.equal(
    releaseHeadings().filter(({ version }) => version === rootPackage.version).length,
    1,
  );
});
