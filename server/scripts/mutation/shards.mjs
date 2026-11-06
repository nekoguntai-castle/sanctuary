/**
 * Shard definitions for the Critical Mutation Gate.
 *
 * Splits the mutate list into N independent slices so each slice can run on
 * its own runner in parallel. After all slices complete, their JSON reports
 * are merged by `merge-shard-reports.mjs` into the canonical report path that
 * `check-critical-mutation-gate.mjs` consumes.
 *
 * Shards are balanced by measured cost, not file or mutant count. A mutant's
 * cost is the tests it runs (`testsCompleted` in the shard report), and every
 * surviving mutant runs all of its covering tests. The address-derivation
 * mutants are covered by thousands of vector tests each, so 542 of them cost
 * more than shard 3's ~3,900 mutants. In the November 2026 reports,
 * xpubConversion.ts alone was 52-58% of the address-derivation test
 * executions (223k-301k of 433k-515k). With it in shard 1, that shard ran
 * 38-59 minutes and hit its 60-minute deadline on busy hosts, while shard 2
 * finished in about 75 seconds. xpubConversion.ts therefore runs in shard 2.
 *
 * A shard may carve a file out of another shard's glob. When it does, that
 * file must also be listed explicitly in ALL_MUTATE, because
 * scripts/ci/check-critical-mutation-config.mjs requires the shards' positive
 * patterns to match ALL_MUTATE's and every file to belong to exactly one shard.
 */

const SHARDS = {
  1: {
    label: 'address-derivation',
    mutate: [
      'src/services/bitcoin/addressDerivation.ts',
      'src/services/bitcoin/addressDerivation/**/*.ts',
      '!src/services/bitcoin/addressDerivation/xpubConversion.ts',
      '!src/**/*.d.ts',
    ],
  },
  2: {
    label: 'psbt-validation-xpub-conversion',
    mutate: [
      'src/services/bitcoin/addressDerivation/xpubConversion.ts',
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
  // Already matched by the glob above; listed so shard 2 can own it.
  'src/services/bitcoin/addressDerivation/xpubConversion.ts',
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
