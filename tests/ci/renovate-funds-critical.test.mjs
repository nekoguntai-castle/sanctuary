import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const RENOVATE_PATH = path.join(ROOT, '.github/renovate.json');
const LOCK_CONFIG_PATH = path.join(ROOT, 'config/ci-toolchain-lock.json');

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function fundsCriticalRule(renovate) {
  return (renovate.packageRules ?? []).find((rule) =>
    Array.isArray(rule.matchPackageNames) && rule.dependencyDashboardApproval === true,
  );
}

test('renovate gates every funds-critical package behind dashboard approval', () => {
  const renovate = readJson(RENOVATE_PATH);
  const lockConfig = readJson(LOCK_CONFIG_PATH);
  const expectedNames = (lockConfig.fundsCriticalPackages ?? []).map((p) => p.name).sort();

  assert.ok(expectedNames.length > 0, 'ci-toolchain-lock.json must declare at least one funds-critical package');

  const rule = fundsCriticalRule(renovate);
  assert.ok(rule, 'renovate.json must have a packageRules entry with dependencyDashboardApproval: true');
  assert.deepEqual(
    [...rule.matchPackageNames].sort(),
    expectedNames,
    'renovate funds-critical matchPackageNames must exactly match config/ci-toolchain-lock.json fundsCriticalPackages names',
  );
  assert.equal(typeof rule.description, 'string');
  assert.match(rule.description, /bump-funds-critical\.sh/);
});

test('renovate.json has exactly one funds-critical dashboard-approval rule', () => {
  const renovate = readJson(RENOVATE_PATH);
  const matches = (renovate.packageRules ?? []).filter(
    (rule) => Array.isArray(rule.matchPackageNames) && rule.dependencyDashboardApproval === true,
  );
  assert.equal(matches.length, 1, 'expected exactly one dashboard-approval rule for funds-critical packages');
});

// A group branch inherits dashboard approval from any member, so one
// funds-critical package in a batch would hold every other update behind it.
// Each group must either negate every funds-critical name or only match
// patterns that cannot reach them.
function canMatch(pattern, name) {
  if (pattern.endsWith('/**')) return name.startsWith(pattern.slice(0, -2));
  return pattern === name;
}

test('renovate groups never batch a funds-critical package', () => {
  const renovate = readJson(RENOVATE_PATH);
  const lockConfig = readJson(LOCK_CONFIG_PATH);
  const fundsCritical = (lockConfig.fundsCriticalPackages ?? []).map((p) => p.name);
  const groups = (renovate.packageRules ?? []).filter((rule) => typeof rule.groupName === 'string');

  for (const rule of groups) {
    const patterns = rule.matchPackageNames ?? [];
    const positive = patterns.filter((p) => !p.startsWith('!'));
    const negated = new Set(patterns.filter((p) => p.startsWith('!')).map((p) => p.slice(1)));
    for (const name of fundsCritical) {
      const reachable = positive.length === 0 || positive.some((p) => canMatch(p, name));
      assert.ok(
        !reachable || negated.has(name),
        `group "${rule.groupName}" can batch funds-critical package ${name}; add "!${name}" to its matchPackageNames`,
      );
    }
  }
});

test('renovate never opens a PR for a root override pin', () => {
  const renovate = readJson(RENOVATE_PATH);
  const rule = (renovate.packageRules ?? []).find(
    (r) => Array.isArray(r.matchDepTypes) && r.matchDepTypes.includes('overrides'),
  );
  assert.ok(rule, 'renovate.json must route overrides depType updates through the dashboard');
  assert.equal(rule.dependencyDashboardApproval, true);
  assert.equal(rule.matchPackageNames, undefined, 'the overrides rule must cover every override, not a list');
});
