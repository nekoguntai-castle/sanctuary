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

function expectedChangelogVersions(tags, packageVersionValue) {
  const taggedVersions = tags.map(({ tag }) => tag.slice(1));
  const packageVersion = parseVersion(packageVersionValue);
  assert(packageVersion, 'package version must be stable semver');
  if (taggedVersions.includes(packageVersionValue)) return taggedVersions;
  assert(
    tags.length === 0 || compareVersions(packageVersion, tags[0].version) > 0,
    'an untagged prepared package version must be newer than every stable tag',
  );
  return [packageVersionValue, ...taggedVersions];
}

function assertPreparedHeadingDate(headings, tags, packageVersionValue) {
  if (tags.some(({ tag }) => tag === `v${packageVersionValue}`)) return;
  const date = headings.find(({ version }) => version === packageVersionValue)?.date ?? '';
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/, 'the prepared release heading must be dated');
  assert.equal(
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10),
    date,
    'the prepared release heading date must be a real calendar date',
  );
}

test('changelog covers every post-v0.8.43 stable tag and the prepared version in order', () => {
  const tags = stableTagsAfterBaseline();
  const expectedVersions = expectedChangelogVersions(tags, rootPackage.version);
  const headings = releaseHeadings();
  const covered = headings.filter(({ version }) => {
    const parsed = parseVersion(version);
    return parsed && compareVersions(parsed, baseline) > 0;
  });

  assert.equal(headings[0]?.version, 'Unreleased');
  assert.deepEqual(covered.map(({ version }) => version), expectedVersions);
  assertPreparedHeadingDate(covered, tags, rootPackage.version);
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

test('an untagged next release is permitted but stale untagged versions fail closed', () => {
  const tags = [
    { tag: 'v0.8.68', version: [0, 8, 68] },
    { tag: 'v0.8.67', version: [0, 8, 67] },
  ];
  assert.deepEqual(expectedChangelogVersions(tags, '0.8.69'), ['0.8.69', '0.8.68', '0.8.67']);
  assert.throws(
    () => expectedChangelogVersions(tags, '0.8.66'),
    /untagged prepared package version must be newer/,
  );
  assertPreparedHeadingDate([{ version: '0.8.69', date: '2026-08-27' }], tags, '0.8.69');
  assert.throws(
    () => assertPreparedHeadingDate([{ version: '0.8.69' }], tags, '0.8.69'),
    /prepared release heading must be dated/,
  );
  assert.throws(
    () => assertPreparedHeadingDate([{ version: '0.8.69', date: '2026-02-30' }], tags, '0.8.69'),
    /real calendar date/,
  );
});

test('current package version is represented by a stable changelog heading', () => {
  assert.match(rootPackage.version, /^\d+\.\d+\.\d+$/);
  assert.equal(
    releaseHeadings().filter(({ version }) => version === rootPackage.version).length,
    1,
  );
});
