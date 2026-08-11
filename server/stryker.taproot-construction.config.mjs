import baseConfig from './stryker.critical.config.mjs';

/** Isolated proof for Taproot PSBT construction and its fail-closed policy. */
export default {
  ...baseConfig,
  mutate: [
    'src/services/bitcoin/transactions/psbtConstruction.ts:67-77',
    'src/services/bitcoin/transactions/psbtInputConstruction.ts:206-228',
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
  incremental: false,
  timeoutMS: 30000,
  concurrency: 4,
};
