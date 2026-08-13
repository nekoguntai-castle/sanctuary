import assert from 'node:assert/strict';
import test from 'node:test';

import { validateMutationEvidence } from '../../scripts/ci/check-wallet-safety-mutation-map.mjs';

const TEST_FILE = 'tests/example.test.ts';
const TEST_NAME = 'rejects account drift';
const SOURCE_FILE = 'src/example.ts';
const LOCATION = {
  start: { line: 10, column: 2 },
  end: { line: 10, column: 12 },
};

function fixture() {
  const map = {
    schemaVersion: 1,
    profiles: [{
      id: 'example',
      reportPath: 'reports/example.json',
      files: [{ path: SOURCE_FILE, minScore: 85 }],
      invariants: [{
        id: 'account-selection',
        productionFile: SOURCE_FILE,
        lineStart: 8,
        lineEnd: 12,
        requiredTests: [{ file: TEST_FILE, name: TEST_NAME }],
        canaries: [{
          id: 'reject-account-drift',
          location: LOCATION,
          mutatorName: 'ConditionalExpression',
          replacement: 'false',
          requiredKillingTest: { file: TEST_FILE, name: TEST_NAME },
        }],
      }],
    }],
  };
  const report = {
    files: {
      [SOURCE_FILE]: {
        mutants: [
          {
            location: LOCATION,
            mutatorName: 'ConditionalExpression',
            replacement: 'false',
            status: 'Killed',
            killedBy: ['test-1'],
          },
          {
            location: { start: { line: 11, column: 1 }, end: { line: 11, column: 4 } },
            mutatorName: 'BooleanLiteral',
            replacement: 'true',
            status: 'Killed',
            killedBy: ['test-1'],
          },
        ],
      },
    },
    testFiles: {
      [TEST_FILE]: { tests: [{ id: 'test-1', name: TEST_NAME }] },
    },
  };
  return { map, reports: new Map([['example', report]]) };
}

function rejectsAfter(mutate, pattern) {
  const value = fixture();
  mutate(value);
  assert.throws(() => validateMutationEvidence(value.map, value.reports), pattern);
}

test('accepts a mapped per-file score and attributable named-test canary kill', () => {
  const { map, reports } = fixture();
  assert.doesNotThrow(() => validateMutationEvidence(map, reports));
});

test('accepts any explicitly named deterministic killer for a shared canary', () => {
  const { map, reports } = fixture();
  const alternate = { file: 'tests/alternate.test.ts', name: 'rejects the same drift directly' };
  reports.get('example').testFiles[alternate.file] = {
    tests: [{ id: 'test-2', name: alternate.name }],
  };
  reports.get('example').files[SOURCE_FILE].mutants[0].killedBy = ['test-2'];
  const canary = map.profiles[0].invariants[0].canaries[0];
  canary.requiredKillingTests = [canary.requiredKillingTest, alternate];
  delete canary.requiredKillingTest;

  assert.doesNotThrow(() => validateMutationEvidence(map, reports));
});

test('rejects a missing mutation report', () => {
  rejectsAfter(value => value.reports.clear(), /missing report/);
});

test('rejects a missing mapped source file and an empty mutant list', () => {
  rejectsAfter(value => delete value.reports.get('example').files[SOURCE_FILE], /missing mapped mutants/);
  rejectsAfter(value => { value.reports.get('example').files[SOURCE_FILE].mutants = []; }, /missing mapped mutants/);
});

test('rejects an invariant range that selects zero mutants', () => {
  rejectsAfter(value => {
    value.map.profiles[0].invariants[0].lineStart = 50;
    value.map.profiles[0].invariants[0].lineEnd = 60;
  }, /selected zero mutants/);
});

test('rejects zero selected tests and a missing required named test', () => {
  rejectsAfter(value => { value.reports.get('example').testFiles = {}; }, /selected zero tests/);
  rejectsAfter(value => {
    value.reports.get('example').testFiles[TEST_FILE].tests[0].name = 'another test';
  }, /required test is absent/);
});

test('rejects an absent or ambiguous exact canary', () => {
  rejectsAfter(value => {
    value.map.profiles[0].invariants[0].canaries[0].replacement = 'true';
  }, /resolved to 0 mutants/);
  rejectsAfter(value => {
    const mutants = value.reports.get('example').files[SOURCE_FILE].mutants;
    mutants.push(structuredClone(mutants[0]));
  }, /resolved to 2 mutants/);
});

test('rejects a surviving or timeout-only semantic canary', () => {
  rejectsAfter(value => {
    value.map.profiles[0].files[0].minScore = 0;
    value.reports.get('example').files[SOURCE_FILE].mutants[0].status = 'Survived';
  }, /was Survived/);
  rejectsAfter(value => {
    value.reports.get('example').files[SOURCE_FILE].mutants[0].status = 'Timeout';
  }, /was Timeout/);
});

test('rejects a canary killed by a different test', () => {
  rejectsAfter(value => {
    value.reports.get('example').files[SOURCE_FILE].mutants[0].killedBy = ['other-test'];
  }, /not killed by any required named test/);
});

test('rejects a below-threshold file score and a zero-counted report', () => {
  rejectsAfter(value => {
    value.reports.get('example').files[SOURCE_FILE].mutants[1].status = 'Survived';
  }, /mutation score 50.00 is below 85/);
  rejectsAfter(value => {
    for (const mutant of value.reports.get('example').files[SOURCE_FILE].mutants) {
      mutant.status = 'Ignored';
    }
  }, /selected zero counted mutants/);
});

test('rejects a map without an executable canary', () => {
  rejectsAfter(value => { value.map.profiles[0].invariants[0].canaries = []; }, /has no executable canary/);
});

test('rejects a mapped production file without an invariant canary', () => {
  rejectsAfter(value => {
    value.map.profiles[0].files.push({ path: 'src/unmapped.ts', minScore: 85 });
  }, /has no invariant canary/);
});

test('rejects duplicate report test identities', () => {
  rejectsAfter(value => {
    const tests = value.reports.get('example').testFiles[TEST_FILE].tests;
    tests.push({ ...tests[0], id: 'test-2' });
  }, /duplicate test identity/);
});
