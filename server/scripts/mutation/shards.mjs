/**
 * Shard definitions for the Critical Mutation Gate.
 *
 * Splits the mutate list into N independent slices so each slice can run on
 * its own runner in parallel. After all slices complete, their JSON reports
 * are merged by `merge-shard-reports.mjs` into the canonical report path that
 * `check-critical-mutation-gate.mjs` consumes.
 *
 * Shard balance was chosen to roughly equalize wallclock by file count and
 * known mutant density (addressDerivation has the largest mutant population
 * by far and gets its own shard).
 */

const SHARDS = {
  1: {
    label: 'addressDerivation',
    mutate: [
      'src/services/bitcoin/addressDerivation.ts',
      'src/services/bitcoin/addressDerivation/**/*.ts',
      '!src/**/*.d.ts',
    ],
  },
  2: {
    label: 'psbt-validation',
    mutate: [
      'src/services/bitcoin/psbtValidation.ts',
      'src/services/bitcoin/psbtInfo.ts',
      'src/services/bitcoin/validationEvidenceContracts.ts',
      '!src/**/*.d.ts',
    ],
  },
  3: {
    label: 'broadcast-auth-access',
    mutate: [
      'src/services/bitcoin/transactions/broadcastContracts.ts',
      'src/services/bitcoin/blockchain/broadcastPreflight.ts',
      'src/services/bitcoin/signingIntent/**/*.ts',
      'src/repositories/transactionSigningIntentRepository.ts',
      'src/services/bitcoin/transactions/broadcasting.ts',
      'src/api/transactions/broadcasting.ts',
      'src/middleware/auth.ts',
      'src/services/accessControl.ts',
      '!src/**/*.d.ts',
    ],
  },
};

const ALL_MUTATE = [
  'src/services/bitcoin/addressDerivation.ts',
  'src/services/bitcoin/addressDerivation/**/*.ts',
  'src/services/bitcoin/psbtValidation.ts',
  'src/services/bitcoin/psbtInfo.ts',
  'src/services/bitcoin/validationEvidenceContracts.ts',
  'src/services/bitcoin/transactions/broadcastContracts.ts',
  'src/services/bitcoin/blockchain/broadcastPreflight.ts',
  'src/services/bitcoin/signingIntent/**/*.ts',
  'src/repositories/transactionSigningIntentRepository.ts',
  'src/services/bitcoin/transactions/broadcasting.ts',
  'src/api/transactions/broadcasting.ts',
  'src/middleware/auth.ts',
  'src/services/accessControl.ts',
  '!src/**/*.d.ts',
];

/**
 * The critical test entries, relative to server/. The command-runner fallback
 * of stryker.critical.config.mjs runs exactly these, and
 * scripts/ci/check-critical-mutation-config.mjs walks their test-tree imports
 * so every file they load selects the critical lane.
 */
export const CRITICAL_TEST_FILES = [
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
  'tests/unit/services/bitcoin/signingIntent/intentSpend.test.ts',
  'tests/unit/services/bitcoin/signingIntent/broadcastLifecycle.test.ts',
  'tests/unit/services/bitcoin/transactionService.broadcast.test.ts',
  'tests/unit/repositories/transactionSigningIntentRepository.test.ts',
  'tests/unit/api/transactionsSigningIntentBroadcast.test.ts',
  'tests/unit/api/transactionsSigningIntentBroadcast.replacement.test.ts',
  'tests/unit/api/transactionsSigningIntentBroadcast.retry.test.ts',
  'tests/unit/api/transactions-http-routes.test.ts',
  'tests/unit/middleware/auth.test.ts',
  'tests/unit/services/accessControl.test.ts',
];

export const SHARD_IDS = Object.keys(SHARDS).map(Number);

export function resolveShard(shardEnv) {
  if (!shardEnv || shardEnv === 'all') {
    return { id: 'all', label: 'all', mutate: ALL_MUTATE };
  }
  const id = Number(shardEnv);
  const entry = SHARDS[id];
  if (!entry) {
    throw new Error(
      `Unknown MUTATION_SHARD value: ${shardEnv}. Valid values: ${SHARD_IDS.join(', ')} or 'all'.`,
    );
  }
  return { id, ...entry };
}

export function shardReportFileName(shardId) {
  if (shardId === 'all') {
    return 'reports/mutation/critical-mutation-report.json';
  }
  return `reports/mutation/critical-mutation-report.shard-${shardId}.json`;
}
