import baseConfig from './stryker.critical.config.mjs';

/** Isolated proof for signed Taproot artifact validation and finalization. */
export default {
  ...baseConfig,
  mutate: [
    'src/services/bitcoin/signingIntent/artifactValidation.ts:323-329',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:336-337',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:343-343',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:355-356',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:367-382',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:416-419',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:435-438',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:446-449',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:453-457',
  ],
  testFiles: ['tests/unit/services/bitcoin/signingIntent/artifactValidation.test.ts'],
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: {
    fileName: 'reports/mutation/taproot-artifact-finalization.json',
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
