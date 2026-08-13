import baseConfig from './stryker.config.mjs';

/** Mutation proof for the canonical account/branch/index contract. */
export default {
  ...baseConfig,
  mutate: ['shared/constants/walletPolicy.ts'],
  testFiles: ['tests/shared/walletPolicy.test.ts'],
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: {
    fileName: 'reports/mutation/wallet-policy.json',
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
