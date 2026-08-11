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
  incremental: false,
  timeoutMS: 30000,
  concurrency: 4,
};
