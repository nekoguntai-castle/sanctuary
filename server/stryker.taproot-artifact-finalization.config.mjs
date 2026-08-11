import baseConfig from './stryker.critical.config.mjs';

/** Isolated proof for signed Taproot artifact validation and finalization. */
export default {
  ...baseConfig,
  mutate: [
    'src/services/bitcoin/signingIntent/artifactValidation.ts:174-180',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:187-188',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:194-194',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:206-207',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:218-233',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:267-270',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:286-289',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:297-300',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:304-308',
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
