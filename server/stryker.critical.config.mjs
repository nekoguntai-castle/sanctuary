import fs from 'node:fs';
import path from 'node:path';

/**
 * Critical-path mutation testing configuration.
 *
 * Uses Stryker's built-in "command" test runner to avoid current
 * vitest-runner compatibility issues while still mutation-testing
 * high-risk money/auth paths.
 */

const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

const NODE_MODULES_PATH = fs.realpathSync(path.resolve('node_modules'));
const GENERATED_PRISMA_PATH = fs.realpathSync(path.resolve('src/generated'));
const SHARED_PATH = fs.realpathSync(path.resolve('../shared'));
const symlinkSandboxPath = (sourcePath, sandboxPath) => [
  `test -e ${shellQuote(sandboxPath)}`,
  `ln -s ${shellQuote(sourcePath)} ${shellQuote(sandboxPath)}`,
  `test -e ${shellQuote(sandboxPath)}`,
].join(' || ');
const ENSURE_SANDBOX_RUNTIME_LINKS = [
  symlinkSandboxPath(NODE_MODULES_PATH, 'node_modules'),
  symlinkSandboxPath(GENERATED_PRISMA_PATH, 'src/generated'),
  symlinkSandboxPath(SHARED_PATH, '../shared'),
].join(' && ');

const CRITICAL_TEST_COMMAND = [
  `${ENSURE_SANDBOX_RUNTIME_LINKS} && npm run test:run --`,
  'tests/unit/services/bitcoin/addressDerivation.verified.test.ts',
  'tests/unit/services/bitcoin/psbt.verified.test.ts',
  'tests/unit/services/bitcoin/psbtValidation.test.ts',
  'tests/unit/services/bitcoin/psbtInfo.test.ts',
  'tests/unit/services/bitcoin/validationEvidenceContracts.test.ts',
  'tests/unit/services/bitcoin/transactionServiceBroadcast/broadcastContracts.test.ts',
  'tests/unit/services/bitcoin/blockchain/broadcastPreflight.test.ts',
  'tests/unit/services/bitcoin/industry/broadcastSafety.test.ts',
  'tests/unit/api/transactionsBroadcastIntent.test.ts',
  'tests/unit/api/transactions-http-routes.test.ts',
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
    'src/services/bitcoin/validationEvidenceContracts.ts',
    'src/services/bitcoin/transactions/broadcastContracts.ts',
    'src/services/bitcoin/blockchain/broadcastPreflight.ts',
    'src/api/transactions/broadcastIntent.ts',
    'src/middleware/auth.ts',
    'src/services/accessControl.ts',
    '!src/**/*.d.ts',
  ],

  ignorePatterns: [
    'src/generated',
    'src/generated/**',
    'coverage',
    'reports',
    '.stryker-tmp',
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
  // Saturate the 4-vCPU ubuntu-latest runner used by the mutation jobs.
  // The default `cpus/2` was leaving half the runner idle.
  concurrency: 4,
  timeoutMS: 30000,
  timeoutFactor: 2,
};
