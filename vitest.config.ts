import path from 'path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'process', 'stream', 'util'],
      globals: {
        Buffer: true,
        process: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      include: [
        'App.tsx',
        'index.tsx',
        'hooks/**/*.{ts,tsx}',
        'components/**/*.{ts,tsx}',
        'utils/**/*.ts',
        'contexts/**/*.{ts,tsx}',
        'src/**/*.ts',
        'services/**/*.ts',
        'shared/**/*.ts',
        'providers/**/*.{ts,tsx}',
        'themes/**/*.ts',
      ],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/tests/**',
        '**/__tests__/**',
        '**/*.d.ts',
        '**/coverage/**',
        '**/dist/**',
        '**/node_modules/**',
        // Canvas animation internals are covered indirectly through AnimatedBackground
        // registry/dispatch tests and guarded by tests/config/coveragePolicy.test.ts.
        'components/animations/**',
        'src/types/**/*.ts',
        'shared/types/**/*.ts',
        // Server/gateway contract helpers are covered by their package-level tests,
        // not by the frontend coverage gate.
        'shared/schemas/mobileApiRequests.ts',
        'shared/utils/gatewayAuth.ts',
        // Type-only and barrel-export files with no executable logic
        'components/**/types.ts',
        'components/**/index.ts',
        'components/**/index.tsx',
        'contexts/**/index.ts',
        'hooks/**/types.ts',
        'hooks/**/index.ts',
        // React Query hook definitions are factory-generated closures with no custom logic
        'hooks/queries/useWalletLabels.ts',
        'services/**/types.ts',
        'services/**/index.ts',
        'themes/types.ts',
        'src/api/**/types.ts',
        'src/api/**/index.ts',
      ],
      reportsDirectory: './coverage',
      thresholds: {
        // Coverage baseline locked to current observed total coverage (2026-03-02).
        // Keep this aligned with CI to prevent silent regressions.
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
    reporters: ['default', 'junit'],
    outputFile: {
      junit: './junit.xml',
    },
  },
});
