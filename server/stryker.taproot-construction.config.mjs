import baseConfig from './stryker.critical.config.mjs';

/** Isolated proof for Taproot PSBT construction and its fail-closed policy. */
export default {
  ...baseConfig,
  mutate: [
    'src/services/bitcoin/transactions/psbtConstruction.ts:67-77',
    'src/services/bitcoin/transactions/psbtInputConstruction.ts:206-222',
  ],
  testFiles: [
    'tests/unit/services/bitcoin/psbtConstruction.signingInfo.test.ts',
    'tests/unit/services/bitcoin/psbtInputConstruction.branches.test.ts',
  ],
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: {
    fileName: 'reports/mutation/taproot-construction.json',
  },
  thresholds: {
    high: 90,
    low: 85,
    break: 85,
  },
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
