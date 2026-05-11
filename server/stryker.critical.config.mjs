import fs from 'node:fs';
import path from 'node:path';

import {
  resolveShard,
  shardIncrementalFileName,
  shardReportFileName,
} from './scripts/mutation/shards.mjs';

/**
 * Critical-path mutation testing configuration.
 *
 * Uses Stryker's built-in "command" test runner to avoid current
 * vitest-runner compatibility issues while still mutation-testing
 * high-risk money/auth paths.
 *
 * Set MUTATION_SHARD=1|2|3 to mutate only one slice (used by CI to
 * parallelize). Default ('all') mutates the full list — preserves the
 * pre-shard behavior for local runs and the merge-script smoke test.
 */
const SHARD = resolveShard(process.env.MUTATION_SHARD);

const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

const NODE_MODULES_PATH = fs.realpathSync(path.resolve('node_modules'));
const GENERATED_PRISMA_PATH = fs.realpathSync(path.resolve('src/generated'));
const SHARED_PATH = fs.realpathSync(path.resolve('../shared'));
const symlinkSandboxPath = (sourcePath, sandboxPath) => [
  `test -e ${shellQuote(sandboxPath)}`,
  `ln -s ${shellQuote(sourcePath)} ${shellQuote(sandboxPath)}`,
  `test -e ${shellQuote(sandboxPath)}`,
].join(' || ');
// Sandbox runtime symlinks: stryker copies the source tree to a sandbox dir
// but doesn't pull node_modules / generated / shared. Phase B's workspace
// install puts @sanctuary/shared at ROOT node_modules, not server's, so the
// sandbox still needs the explicit `../shared` symlink — server/node_modules
// alone doesn't surface the workspace package.
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

  mutate: SHARD.mutate,

  ignorePatterns: [
    'src/generated',
    'src/generated/**',
    'coverage',
    'reports',
    '.stryker-tmp',
  ],

  reporters: ['clear-text', 'progress', 'json', 'html'],
  jsonReporter: {
    fileName: shardReportFileName(SHARD.id),
  },
  htmlReporter: {
    fileName: shardReportFileName(SHARD.id).replace(/\.json$/, '.html'),
  },

  thresholds: {
    high: 85,
    low: 70,
    // Break threshold is enforced via custom weighted gate script.
    break: 0,
  },

  incremental: true,
  incrementalFile: shardIncrementalFileName(SHARD.id),
  // Saturate the 4-vCPU ubuntu-latest runner used by the mutation jobs.
  // The default `cpus/2` was leaving half the runner idle.
  concurrency: 4,
  timeoutMS: 30000,
  timeoutFactor: 2,
};
