/**
 * Stryker Mutation Testing Configuration - Backend
 *
 * Run with: npm run test:mutation (from server directory)
 *
 * Focus on critical service files for mutation testing.
 */
export default {
  packageManager: 'npm',
  reporters: ['html', 'clear-text', 'progress'],
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.ts',
  },
  coverageAnalysis: 'perTest',

  // Focus on critical security and business logic files
  mutate: [
    'src/services/authService.ts',
    'src/services/encryption.ts',
    'src/services/twoFactorAuth.ts',
    'src/services/accessControl.ts',
    'src/services/tokenRevocation.ts',
    'src/services/walletService.ts',
    'src/utils/errors.ts',
    'src/utils/safeJson.ts',
    '!**/*.test.ts',
    '!**/*.d.ts',
  ],

  // Higher thresholds for security-critical code (tightened from 85/70/60)
  thresholds: {
    high: 90,
    low: 75,
    break: 65,
  },

  timeoutMS: 15000,

  ignorePatterns: [
    'node_modules',
    'dist',
    'coverage',
    '.git',
    'tests',
  ],
};
