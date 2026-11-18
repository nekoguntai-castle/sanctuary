/**
 * Shard definitions for the Critical Mutation Gate.
 *
 * Splits the mutate list into N independent slices so each slice can run on
 * its own runner in parallel. After all slices complete, their JSON reports
 * are merged by `merge-shard-reports.mjs` into the canonical report path that
 * `check-critical-mutation-gate.mjs` consumes.
 *
 * Shards are balanced by measured wall time, not by file, mutant or test
 * count. None of the three counts predicts time on its own: a surviving mutant
 * runs all of its covering tests, the address-derivation mutants are each
 * covered by thousands of vector tests, and the broadcast and signing-intent
 * files have seven times as many mutants with slower tests behind them. Before
 * this layout, shard 3 ran fewer test executions than shard 1 (151k against
 * 217k) and still took longer (27.5 against 22 minutes, run 24000).
 *
 * Slices timed on one host on 2026-11-17, Stryker start-up (40-80 s) included:
 *
 *   descriptorDerivation.ts alone                    429 s (753 s before its
 *                                                    surviving mutants were killed)
 *   the rest of address derivation                    313 s
 *   signingIntent/**                                  710 s
 *     of which artifactValidation.ts                  121 s
 *   broadcast, repository, auth and access control    494 s
 *   psbt validation and evidence contracts (CI)       168 s
 *
 * Local times understate CI unevenly. In run 24012 the mutant-heavy slices
 * ran about 1.9 times slower in CI than here and descriptorDerivation.ts about
 * 1.3 times, so check a new layout against a CI run, not only these numbers.
 * One CI run is not enough either: runs 24038 and 24046 differ by 3-5 minutes
 * on every shard with no change to the files in two of them.
 *
 * After the surviving mutants in the signing-intent schemas were killed,
 * signingIntent/** fell to 11-15 minutes in CI while address derivation stayed
 * at 18-23, so artifactValidation.ts, which shard 1 had borrowed, is back in
 * shard 3 and each shard is one directory or one list of files.
 * Re-time the slices before moving a file:
 *   MUTATION_SHARD=<n> npx stryker run stryker.critical.config.mjs --mutate <files>
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
      '!src/**/*.d.ts',
    ],
  },
  2: {
    label: 'psbt-broadcast-access',
    mutate: [
      'src/services/bitcoin/psbtValidation.ts',
      'src/services/bitcoin/psbtInfo.ts',
      'src/services/bitcoin/validationEvidenceContracts.ts',
      'src/services/bitcoin/transactions/broadcastContracts.ts',
      'src/services/bitcoin/blockchain/broadcastPreflight.ts',
      'src/repositories/transactionSigningIntentRepository.ts',
      'src/services/bitcoin/transactions/broadcasting.ts',
      'src/api/transactions/broadcasting.ts',
      'src/middleware/auth.ts',
      'src/services/accessControl.ts',
      '!src/**/*.d.ts',
    ],
  },
  3: {
    label: 'signing-intent',
    mutate: [
      'src/services/bitcoin/signingIntent/**/*.ts',
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
