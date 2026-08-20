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
