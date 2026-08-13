import baseConfig from './stryker.critical.config.mjs';

/** Isolated proof for raw receive transaction and output authentication. */
export default {
  ...baseConfig,
  mutate: [
    'src/services/bitcoin/rawTransactionEvidence.ts:63-123',
  ],
  testFiles: [
    'tests/unit/services/bitcoin/rawTransactionEvidence.test.ts',
  ],
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'reports/mutation/receive-evidence.json' },
  thresholds: { high: 90, low: 85, break: 85 },
  incremental: false,
  timeoutMS: 30000,
  concurrency: 4,
};
