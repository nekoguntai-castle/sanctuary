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
 * Defaults to Stryker's Vitest runner with per-test coverage so mutants run
 * against only the tests that covered them during the dry run. Set
 * STRYKER_TEST_RUNNER=command to use the older full-command fallback if the
 * Vitest runner regresses.
 *
 * Set MUTATION_SHARD=1|2|3 to mutate only one slice (used by CI to
 * parallelize). Default ('all') mutates the full list — preserves the
 * pre-shard behavior for local runs and the merge-script smoke test.
 */
const SHARD = resolveShard(process.env.MUTATION_SHARD);
const STRYKER_TEST_RUNNER =
  process.env.STRYKER_TEST_RUNNER ?? process.env.STRYKER_RUNNER ?? 'vitest';
const SHARED_DIST_PATH = path.resolve('../shared/dist');

if (!['vitest', 'command'].includes(STRYKER_TEST_RUNNER)) {
  throw new Error(
    `Unsupported STRYKER_TEST_RUNNER value: ${STRYKER_TEST_RUNNER}. Expected 'vitest' or 'command'.`,
  );
}

if (!process.env.SANCTUARY_SHARED_DIST) {
  process.env.SANCTUARY_SHARED_DIST = SHARED_DIST_PATH;
}

const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

const symlinkSandboxPath = (sourcePath, sandboxPath) => [
  `test -e ${shellQuote(sandboxPath)}`,
  `ln -s ${shellQuote(sourcePath)} ${shellQuote(sandboxPath)}`,
  `test -e ${shellQuote(sandboxPath)}`,
].join(' || ');

function buildCriticalTestCommand() {
  const nodeModulesPath = fs.realpathSync(path.resolve('node_modules'));
  const generatedPrismaPath = fs.realpathSync(path.resolve('src/generated'));
  const sharedPath = fs.realpathSync(path.resolve('../shared'));

  // Sandbox runtime symlinks: Stryker copies the source tree to a sandbox dir
  // but doesn't pull node_modules / generated / shared. The command fallback
  // uses these links before invoking Vitest through npm.
  const ensureSandboxRuntimeLinks = [
    symlinkSandboxPath(nodeModulesPath, 'node_modules'),
    symlinkSandboxPath(generatedPrismaPath, 'src/generated'),
    symlinkSandboxPath(sharedPath, '../shared'),
  ].join(' && ');

  // The command fallback uses Vitest's threads pool because forks previously
  // hung during shutdown for broadcastContracts.test.ts.
  return [
    `${ensureSandboxRuntimeLinks} && npm run test:run -- --pool=threads --no-file-parallelism`,
    'tests/unit/services/bitcoin/addressDerivation.verified.test.ts',
    'tests/unit/services/bitcoin/psbt.verified.test.ts',
    'tests/unit/services/bitcoin/psbtValidation.test.ts',
    'tests/unit/services/bitcoin/psbtInfo.test.ts',
    'tests/unit/services/bitcoin/validationEvidenceContracts.test.ts',
    'tests/unit/services/bitcoin/transactionServiceBroadcast/broadcastContracts.test.ts',
    'tests/unit/services/bitcoin/blockchain/broadcastPreflight.test.ts',
    'tests/unit/services/bitcoin/industry/broadcastSafety.test.ts',
    'tests/unit/services/bitcoin/signingIntent/canonical.test.ts',
    'tests/unit/services/bitcoin/signingIntent/artifactValidation.test.ts',
    'tests/unit/services/bitcoin/signingIntent/prevoutValidation.test.ts',
    'tests/unit/services/bitcoin/signingIntent/service.test.ts',
    'tests/unit/services/bitcoin/signingIntent/networkBoundary.test.ts',
    'tests/unit/services/bitcoin/signingIntent/ingressRegistry.test.ts',
    'tests/unit/repositories/transactionSigningIntentRepository.test.ts',
    'tests/unit/api/transactionsSigningIntentBroadcast.test.ts',
    'tests/unit/api/transactions-http-routes.test.ts',
    'tests/unit/middleware/auth.test.ts',
    'tests/unit/services/accessControl.test.ts',
  ].join(' ');
}

const COMMON_IGNORE_PATTERNS = ['coverage', 'reports', '.stryker-tmp'];

const RUNNER_CONFIG =
  STRYKER_TEST_RUNNER === 'vitest'
    ? {
        testRunner: 'vitest',
        vitest: {
          configFile: 'vitest.config.ts',
        },
        coverageAnalysis: 'perTest',
        // Do not ignore src/generated on the Vitest path. Source files import
        // generated Prisma modules, and the sandbox needs those files for
        // module resolution even though the mutate list excludes them.
        ignorePatterns: COMMON_IGNORE_PATTERNS,
      }
    : {
        testRunner: 'command',
        commandRunner: {
          command: buildCriticalTestCommand(),
        },
        coverageAnalysis: 'off',
        ignorePatterns: [
          'src/generated',
          'src/generated/**',
          ...COMMON_IGNORE_PATTERNS,
        ],
      };

export function criticalMutationReporters(shardId) {
  return [
    'clear-text',
    'progress',
    'json',
    ...(shardId === 'all' ? ['html'] : []),
  ];
}

/** @type {import('@stryker-mutator/api').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  ...RUNNER_CONFIG,
  checkers: [],

  mutate: SHARD.mutate,

  reporters: criticalMutationReporters(SHARD.id),
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
