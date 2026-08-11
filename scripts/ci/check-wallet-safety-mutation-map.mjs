#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MAP_PATH = 'config/wallet-safety-mutation-map.json';
const KILLED_STATUSES = new Set(['Killed', 'Timeout']);
const COUNTED_STATUSES = new Set([
  'Killed',
  'Timeout',
  'Survived',
  'NoCoverage',
  'RuntimeError',
  'CompileError',
]);

const fail = message => {
  throw new Error(`wallet-safety mutation map: ${message}`);
};

function assertMapShape(map) {
  if (map?.schemaVersion !== 1 || !Array.isArray(map.profiles) || map.profiles.length === 0) {
    fail('unsupported or empty map');
  }
  const profileIds = map.profiles.map(profile => profile.id);
  if (new Set(profileIds).size !== profileIds.length) fail('profile IDs must be unique');
}

function assertProfileShape(profile) {
  if (typeof profile.id !== 'string' || typeof profile.reportPath !== 'string'
    || !Array.isArray(profile.files) || profile.files.length === 0
    || !Array.isArray(profile.invariants) || profile.invariants.length === 0) {
    fail('profile shape is incomplete');
  }
  const filePaths = profile.files.map(file => file.path);
  if (new Set(filePaths).size !== filePaths.length) fail(`profile ${profile.id} file paths must be unique`);
  for (const file of profile.files) {
    if (typeof file.path !== 'string' || !Number.isFinite(file.minScore)
      || file.minScore < 0 || file.minScore > 100) fail(`profile ${profile.id} has an invalid file gate`);
    if (!profile.invariants.some(invariant => invariant.productionFile === file.path)) {
      fail(`mapped file ${file.path} has no invariant canary`);
    }
  }
  const invariantIds = profile.invariants.map(invariant => invariant.id);
  if (new Set(invariantIds).size !== invariantIds.length) fail(`profile ${profile.id} invariant IDs must be unique`);
}

function testsByIdentity(report) {
  const tests = new Map();
  for (const [file, data] of Object.entries(report.testFiles ?? {})) {
    for (const test of data.tests ?? []) {
      const identity = `${file}\0${test.name}`;
      if (tests.has(identity)) fail(`duplicate test identity in report: ${file} :: ${test.name}`);
      tests.set(identity, test.id);
    }
  }
  return tests;
}

function scoreForMutants(mutants) {
  const counted = mutants.filter(mutant => COUNTED_STATUSES.has(mutant.status));
  if (counted.length === 0) fail('a mapped production file selected zero counted mutants');
  const killed = counted.filter(mutant => KILLED_STATUSES.has(mutant.status)).length;
  return (killed / counted.length) * 100;
}

function sameLocation(actual, expected) {
  return actual?.start?.line === expected.start.line
    && actual?.start?.column === expected.start.column
    && actual?.end?.line === expected.end.line
    && actual?.end?.column === expected.end.column;
}

function findCanary(mutants, canary) {
  const matches = mutants.filter(mutant => (
    sameLocation(mutant.location, canary.location)
    && mutant.mutatorName === canary.mutatorName
    && mutant.replacement === canary.replacement
  ));
  if (matches.length !== 1) {
    fail(`canary ${canary.id} resolved to ${matches.length} mutants instead of exactly one`);
  }
  return matches[0];
}

function requireNamedTest(testIndex, test) {
  const testId = testIndex.get(`${test.file}\0${test.name}`);
  if (testId === undefined) fail(`required test is absent: ${test.file} :: ${test.name}`);
  return testId;
}

function validateCanary(canary, mutants, testIndex, invariant) {
  const mutant = findCanary(mutants, canary);
  const line = mutant.location.start.line;
  if (line < invariant.lineStart || line > invariant.lineEnd) {
    fail(`canary ${canary.id} is outside invariant ${invariant.id}`);
  }
  const killingTestId = requireNamedTest(testIndex, canary.requiredKillingTest);
  if (mutant.status !== 'Killed') {
    fail(`canary ${canary.id} was ${mutant.status}; an attributable Killed result is required`);
  }
  if (!(mutant.killedBy ?? []).includes(killingTestId)) {
    fail(`canary ${canary.id} was not killed by its required named test`);
  }
}

function validateInvariant(invariant, fileMutants, testIndex) {
  const selected = fileMutants.filter(mutant => (
    mutant.location?.start?.line >= invariant.lineStart
    && mutant.location.start.line <= invariant.lineEnd
  ));
  if (selected.length === 0) fail(`invariant ${invariant.id} selected zero mutants`);
  for (const test of invariant.requiredTests ?? []) requireNamedTest(testIndex, test);
  if (!Array.isArray(invariant.canaries) || invariant.canaries.length === 0) {
    fail(`invariant ${invariant.id} has no executable canary`);
  }
  for (const canary of invariant.canaries) validateCanary(canary, fileMutants, testIndex, invariant);
}

function validateProfile(profile, report) {
  if (!report?.files || !report?.testFiles) fail(`profile ${profile.id} report is malformed`);
  const testIndex = testsByIdentity(report);
  if (testIndex.size === 0) fail(`profile ${profile.id} selected zero tests`);
  for (const file of profile.files) {
    const mutants = report.files[file.path]?.mutants;
    if (!Array.isArray(mutants) || mutants.length === 0) {
      fail(`profile ${profile.id} is missing mapped mutants for ${file.path}`);
    }
    const score = scoreForMutants(mutants);
    if (score < file.minScore) {
      fail(`${file.path} mutation score ${score.toFixed(2)} is below ${file.minScore}`);
    }
  }
  for (const invariant of profile.invariants) {
    const mutants = report.files[invariant.productionFile]?.mutants;
    if (!Array.isArray(mutants)) fail(`invariant ${invariant.id} production file is absent`);
    validateInvariant(invariant, mutants, testIndex);
  }
}

export function validateMutationEvidence(map, reportsByProfile) {
  assertMapShape(map);
  for (const profile of map.profiles) {
    assertProfileShape(profile);
    const report = reportsByProfile.get(profile.id);
    if (!report) fail(`missing report for profile ${profile.id}`);
    validateProfile(profile, report);
  }
}

export function checkWalletSafetyMutationMap(root = REPO_ROOT) {
  const map = JSON.parse(readFileSync(resolve(root, MAP_PATH), 'utf8'));
  const reports = new Map(map.profiles.map(profile => {
    const path = resolve(root, profile.reportPath);
    try {
      return [profile.id, JSON.parse(readFileSync(path, 'utf8'))];
    } catch (error) {
      fail(`cannot read report ${profile.reportPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }));
  validateMutationEvidence(map, reports);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  checkWalletSafetyMutationMap();
  process.stdout.write('wallet-safety mutation map is complete and non-vacuous\n');
}
