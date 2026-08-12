#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const EXPECTED_SUITE = 'tests/integration/jadeEmulator.integration.test.ts';
export const EXPECTED_JADE_TEST_CASES = Object.freeze([
  {
    name: 'pinned Jade QEMU conformance > exports and production-validates exact BIP44/49/84/86 account identities',
    coverage: 'account-xpubs',
  },
  {
    name: 'pinned Jade QEMU conformance > device-displays exact receive and change addresses for every single-signature policy',
    coverage: 'displayed-receive-change-addresses',
  },
  {
    name: 'pinned Jade QEMU conformance > returns a binary signed PSBT accepted by the production request and response validators',
    coverage: 'signed-psbt-validation',
  },
]);

const arrayOf = value => value === undefined ? [] : Array.isArray(value) ? value : [value];

function countAttribute(value, label) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error(`Jade JUnit ${label} is missing or invalid`);
  }
  return Number(value);
}

function assertZero(value, label) {
  if (countAttribute(value, label) !== 0) {
    throw new Error(`Jade JUnit reports a nonzero ${label}`);
  }
}

function parseJunit(xml) {
  if (XMLValidator.validate(xml) !== true || /<!DOCTYPE/i.test(xml)) {
    throw new Error('Jade JUnit is not well-formed safe XML');
  }
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: false,
  }).parse(xml);
}

export function verifyJadeJunit(xml) {
  const parsed = parseJunit(xml);
  const root = parsed?.testsuites;
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error('Jade JUnit is missing its testsuites root');
  }
  const suites = arrayOf(root.testsuite);
  if (suites.length !== 1) throw new Error('Jade JUnit must contain exactly one test file');
  const suite = suites[0];
  if (!suite || typeof suite !== 'object' || Array.isArray(suite) || suite.name !== EXPECTED_SUITE) {
    throw new Error('Jade JUnit test file differs from the intended integration proof');
  }

  const cases = arrayOf(suite.testcase);
  const rootTests = countAttribute(root.tests, 'root test count');
  const suiteTests = countAttribute(suite.tests, 'suite test count');
  if (rootTests !== cases.length || suiteTests !== cases.length || cases.length === 0) {
    throw new Error('Jade JUnit test counts disagree or are zero');
  }
  assertZero(root.failures, 'root failures');
  assertZero(root.errors, 'root errors');
  assertZero(suite.failures, 'suite failures');
  assertZero(suite.errors, 'suite errors');
  assertZero(suite.skipped, 'suite skipped tests');

  const observedNames = cases.map((testCase, index) => {
    if (!testCase || typeof testCase !== 'object' || Array.isArray(testCase)) {
      throw new Error(`Jade JUnit testcase ${index} is malformed`);
    }
    if (testCase.classname !== EXPECTED_SUITE) {
      throw new Error(`Jade JUnit testcase ${index} belongs to an unexpected file`);
    }
    for (const outcome of ['failure', 'error', 'skipped']) {
      if (Object.hasOwn(testCase, outcome)) {
        throw new Error(`Jade JUnit testcase ${index} contains ${outcome}`);
      }
    }
    if (typeof testCase.name !== 'string' || testCase.name.length === 0) {
      throw new Error(`Jade JUnit testcase ${index} has no name`);
    }
    return testCase.name;
  });
  const expectedNames = EXPECTED_JADE_TEST_CASES.map(testCase => testCase.name);
  if (new Set(observedNames).size !== observedNames.length
    || observedNames.length !== expectedNames.length
    || observedNames.some((name, index) => name !== expectedNames[index])) {
    throw new Error('Jade JUnit did not execute the exact intended test cases');
  }

  return {
    testFileCount: suites.length,
    testCount: cases.length,
    failures: 0,
    errors: 0,
    skipped: 0,
    executedTests: observedNames,
    coverage: EXPECTED_JADE_TEST_CASES.map(testCase => testCase.coverage),
  };
}

function main() {
  const junitPath = process.argv[2];
  if (!junitPath || process.argv.length !== 3) {
    throw new Error('Usage: verify-jade-junit.mjs <junit.xml>');
  }
  process.stdout.write(`${JSON.stringify(verifyJadeJunit(readFileSync(junitPath, 'utf8')))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
