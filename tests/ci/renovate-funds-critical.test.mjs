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
