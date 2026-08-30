import baseConfig from './stryker.critical.config.mjs';

/** Isolated proof for raw receive transaction and output authentication. */
export default {
  ...baseConfig,
  mutate: [
    'src/services/bitcoin/rawTransactionEvidence.ts',
  ],
  testFiles: [
    'tests/unit/services/bitcoin/rawTransactionEvidence.test.ts',
  ],
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'reports/mutation/receive-evidence.json' },
  thresholds: { high: 90, low: 85, break: 85 },
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
