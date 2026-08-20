import baseConfig from './stryker.critical.config.mjs';

/** Isolated proof for exact fee authorization and final transaction enforcement. */
export default {
  ...baseConfig,
  mutate: [
    'src/services/bitcoin/signingIntent/feePolicy.ts',
    'src/services/bitcoin/transactionWeight.ts',
    'src/services/bitcoin/utxoSelection.ts:115-205',
    'src/services/bitcoin/transactions/outputBuilder.ts:113-137',
    'src/services/bitcoin/transactions/createBatchTransaction.ts:297-390',
    'src/services/bitcoin/advancedTx/batch.ts:90-140',
    'src/services/bitcoin/advancedTx/cpfp.ts:35-67',
    'src/services/bitcoin/advancedTx/rbf.ts:208-218',
  ],
  testFiles: [
    'tests/unit/services/bitcoin/signingIntent/feePolicy.test.ts',
    'tests/unit/services/bitcoin/transactionWeight.test.ts',
    'tests/unit/services/bitcoin/transactionSelection.boundaries.test.ts',
    'tests/unit/services/bitcoin/transactionService.create.test.ts',
    'tests/unit/services/bitcoin/canonicalChangeOutput.test.ts',
    'tests/unit/services/bitcoin/transactionService.batch.test.ts',
    'tests/unit/services/bitcoin/advancedTx.test.ts',
  ],
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'reports/mutation/fee-policy.json' },
  thresholds: { high: 85, low: 75, break: 75 },
  // The wallet-safety mutation map asserts that a *named* test kills each
  // canary. Stryker bails on the first failing test by default and credits only
  // that one, so with several tests covering a canary the attribution is decided
  // by execution order — the gate then fails at random on an unchanged tree
  // (#844). Running every covering test makes `killedBy` the complete set, which
  // is deterministic. Costs roughly a third more wall clock on these profiles.
  disableBail: true,
  incremental: false,
  timeoutMS: 30000,
  concurrency: 4,
};
