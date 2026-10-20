import baseConfig from './stryker.critical.config.mjs';

/** Isolated proof for signed Taproot artifact validation and finalization. */
export default {
  ...baseConfig,
  mutate: [
    'src/services/bitcoin/signingIntent/artifactValidation.ts:325-331',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:338-339',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:345-345',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:357-358',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:369-384',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:424-427',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:444-447',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:455-462',
    'src/services/bitcoin/signingIntent/artifactValidation.ts:466-470',
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
