import baseConfig from './stryker.critical.config.mjs';

/** Isolated proof for signed Taproot artifact validation and finalization. */
export default {
  ...baseConfig,
  mutate: [
    'src/services/bitcoin/signingIntent/artifactValidation.ts:175-181',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:188-189',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:195-195',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:207-208',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:219-234',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:268-271',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:287-290',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:298-301',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:305-309',
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
