import { describe, expect, it } from 'vitest';
import {
  EXPECTED_JADE_TEST_CASES,
  verifyJadeJunit,
} from '../../scripts/ci/verify-jade-junit.mjs';

const suiteName = 'tests/integration/jadeEmulator.integration.test.ts';

function junit(options = {}) {
  const names = options.names ?? EXPECTED_JADE_TEST_CASES.map(testCase => testCase.name);
  const failures = options.failures ?? 0;
  const errors = options.errors ?? 0;
  const skipped = options.skipped ?? 0;
  const outcomes = options.outcome ? `<${options.outcome}/>` : '';
  const cases = names.map(name => (
    `<testcase classname="${suiteName}" name="${name.replaceAll('&', '&amp;').replaceAll('>', '&gt;')}">${outcomes}</testcase>`
  )).join('');
  return `<?xml version="1.0"?><testsuites tests="${names.length}" failures="${failures}" errors="${errors}"><testsuite name="${suiteName}" tests="${names.length}" failures="${failures}" errors="${errors}" skipped="${skipped}">${cases}</testsuite></testsuites>`;
}

describe('Jade JUnit proof verifier', () => {
  it('derives exact nonzero evidence counts from the intended passing JUnit', () => {
    expect(verifyJadeJunit(junit())).toEqual({
      testFileCount: 1,
      testCount: 3,
      failures: 0,
      errors: 0,
      skipped: 0,
      executedTests: EXPECTED_JADE_TEST_CASES.map(testCase => testCase.name),
      coverage: EXPECTED_JADE_TEST_CASES.map(testCase => testCase.coverage),
    });
  });

  it.each([
    ['zero tests', { names: [] }, /counts disagree or are zero/i],
    ['a missing intended test', { names: EXPECTED_JADE_TEST_CASES.slice(0, 2).map(test => test.name) }, /exact intended/i],
    ['a renamed test', { names: ['not the proof', ...EXPECTED_JADE_TEST_CASES.slice(1).map(test => test.name)] }, /exact intended/i],
    ['a failure', { failures: 1, outcome: 'failure' }, /nonzero root failures/i],
    ['an error', { errors: 1, outcome: 'error' }, /nonzero root errors/i],
    ['a skipped test', { skipped: 1, outcome: 'skipped' }, /nonzero suite skipped/i],
  ])('rejects %s', (_label, mutation, expected) => {
    expect(() => verifyJadeJunit(junit(mutation))).toThrow(expected);
  });

  it('rejects malformed, multi-suite, and entity-bearing XML', () => {
    expect(() => verifyJadeJunit('<testsuites>')).toThrow(/well-formed/i);
    expect(() => verifyJadeJunit(junit().replace('</testsuites>', '<testsuite/></testsuites>')))
      .toThrow(/exactly one/i);
    expect(() => verifyJadeJunit(`<!DOCTYPE testsuites [<!ENTITY x "proof">]>${junit()}`))
      .toThrow(/safe XML/i);
  });
});
