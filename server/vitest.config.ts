import { defineConfig } from 'vitest/config';
import path from 'path';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: __dirname,
    include: ['tests/**/*.test.ts'],
    setupFiles: [path.resolve(__dirname, 'tests/setup.ts')],
    testTimeout: 10000,
    clearMocks: true,
    restoreMocks: true,
    // JUnit reporter for CI
    reporters: ['default', 'junit'],
    outputFile: {
      junit: './junit.xml',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.d.ts',
        '**/index.ts',
        '**/types.ts',
        // Re-export shims preserving backward-compatible import paths (zero logic)
        'src/services/aiService.ts',
        'src/services/eventService.ts',
        'src/services/maintenanceService.ts',
        'src/services/payjoinService.ts',
        'src/services/syncService.ts',
        'src/services/bitcoin/addressDerivation.ts',
        'src/services/bitcoin/sync/confirmations.ts',
        'src/services/bitcoin/sync/phases/processTransactions.ts',
        'src/services/telegram/telegramService.ts',
        // BullMQ queue producer — requires live Redis, covered by integration tests
        'src/services/workerSyncQueue.ts',
      ],
      thresholds: {
        // Coverage baseline locked to current observed total coverage.
        // Remaining gaps are v8 arrow-function artifacts in delegate methods.
        branches: 98,
        functions: 99,
        lines: 99,
        statements: 99,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@fixtures': path.resolve(__dirname, './tests/fixtures'),
    },
  },
});
