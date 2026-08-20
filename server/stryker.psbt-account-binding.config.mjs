import baseConfig from './stryker.critical.config.mjs';

/**
 * Isolated server-side PSBT account-binding mutation proof.
 *
 * The dedicated per-file gate prevents the historical aggregate critical-path
 * score from masking regressions in these funds-controlling boundaries.
 */
export default {
  ...baseConfig,
  mutate: [
    'src/services/bitcoin/psbtAccountBinding.ts',
    'src/services/bitcoin/psbtSigningContextValidation.ts',
  ],
  testFiles: [
    'tests/unit/services/bitcoin/psbtAccountBinding.test.ts',
    'tests/unit/services/bitcoin/psbtAccountBinding.taproot.test.ts',
    'tests/unit/services/bitcoin/psbtSigningContextValidation.test.ts',
  ],
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: {
    fileName: 'reports/mutation/psbt-account-binding-server.json',
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
