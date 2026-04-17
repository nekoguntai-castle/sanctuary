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
      reporter: ['text', 'lcov', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.d.ts',
        '**/index.ts',
        '**/types.ts',
        // Prisma client/model output is generated code; app behavior is covered through repositories/services.
        'src/generated/**',
        // Side-effect-only daemon entrypoint; behavior is covered through MCP transport/auth modules.
        'src/mcp-entry.ts',
        // Side-effect-only worker daemon entrypoint; behavior is covered through worker job modules.
        'src/worker.ts',
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
        // Route aggregator with no domain logic; subroutes are covered by route tests.
        'src/api/transactions.ts',
        // BullMQ queue producer — requires live Redis, covered by integration tests
        'src/services/workerSyncQueue.ts',
      ],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
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
