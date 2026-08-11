import baseConfig from './stryker.config.mjs';

/**
 * Isolated browser-side PSBT account-binding mutation proof.
 *
 * Keep this scope independent from the broad frontend mutation baseline so a
 * regression in funds-safety validation cannot be hidden by unrelated files.
 */
export default {
  ...baseConfig,
  mutate: ['src/services/hardwareWallet/psbtAccountBinding.ts'],
  testFiles: ['tests/services/hardwareWallet.psbtAccountBinding.test.ts'],
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: {
    fileName: 'reports/mutation/psbt-account-binding-browser.json',
  },
  thresholds: {
    high: 90,
    low: 85,
    break: 85,
  },
  incremental: false,
  timeoutMS: 30000,
  concurrency: 4,
  ignorePatterns: [...baseConfig.ignorePatterns, '.tmp'],
};
