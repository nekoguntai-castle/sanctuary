/**
 * Critical-path mutation testing configuration.
 *
 * Uses Stryker's built-in "command" test runner to avoid current
 * vitest-runner compatibility issues while still mutation-testing
 * high-risk money/auth paths.
 */

const CRITICAL_TEST_COMMAND = [
  'npm run test:run --',
  'tests/unit/services/bitcoin/addressDerivation.verified.test.ts',
  'tests/unit/services/bitcoin/psbt.verified.test.ts',
  'tests/unit/services/bitcoin/psbtValidation.test.ts',
  'tests/unit/services/bitcoin/psbtInfo.test.ts',
  'tests/unit/middleware/auth.test.ts',
  'tests/unit/services/accessControl.test.ts',
].join(' ');

/** @type {import('@stryker-mutator/api').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  testRunner: 'command',
  commandRunner: {
    command: CRITICAL_TEST_COMMAND,
  },
  coverageAnalysis: 'off',
  checkers: [],

  mutate: [
    'src/services/bitcoin/addressDerivation.ts',
    'src/services/bitcoin/addressDerivation/**/*.ts',
    'src/services/bitcoin/psbtValidation.ts',
    'src/services/bitcoin/psbtInfo.ts',
    'src/middleware/auth.ts',
    'src/services/accessControl.ts',
    '!src/**/*.d.ts',
  ],

  reporters: ['clear-text', 'progress', 'json', 'html'],
  jsonReporter: {
    fileName: 'reports/mutation/critical-mutation-report.json',
  },
  htmlReporter: {
    fileName: 'reports/mutation/critical-mutation-report.html',
  },

  thresholds: {
    high: 85,
    low: 70,
    // Break threshold is enforced via custom weighted gate script.
    break: 0,
  },

  incremental: true,
  incrementalFile: '.stryker-cache/critical-incremental.json',
  concurrency: 2,
  timeoutMS: 30000,
  timeoutFactor: 2,
};

