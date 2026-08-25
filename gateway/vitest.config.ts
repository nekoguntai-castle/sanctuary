import { defineConfig } from 'vitest/config';
import path from 'path';
import { coverageReporters } from '../config/tooling/coverageReporters';

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
    reporters: ['default', 'junit'],
    outputFile: {
      junit: './junit.xml',
    },
    coverage: {
      provider: 'v8',
      reporter: coverageReporters(Boolean(process.env.CI)),
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.d.ts',
        '**/index.ts',
        // Re-export shims preserving backward-compatible import paths (zero logic)
        'src/utils/fatalProcessHandlers.ts',
        'src/utils/processExit.ts',
      ],
      thresholds: {
        branches: 100,
        functions: 98,
        lines: 100,
        statements: 100,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@sanctuary/shared': path.resolve(__dirname, '../shared/dist'),
    },
  },
});
