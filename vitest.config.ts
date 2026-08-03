import path from 'path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { nodePolyfillsWithoutDeprecatedEsbuild } from './vite.nodePolyfills';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfillsWithoutDeprecatedEsbuild({
      include: ['buffer', 'process', 'stream', 'util'],
      globals: {
        Buffer: true,
        process: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Frontend: alias the workspace package at SOURCE (not dist) so vitest
      // instruments shared/**/*.ts files for coverage. Server/gateway aliases
      // point at dist for runtime parity; frontend prioritizes coverage.
      '@sanctuary/shared': path.resolve(__dirname, './shared'),
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
      include: ['src/**/*.{ts,tsx}', 'shared/**/*.ts'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/tests/**',
        '**/__tests__/**',
        '**/*.d.ts',
        '**/coverage/**',
        '**/dist/**',
        '**/node_modules/**',
        // LLM egress proxy internals are package-owned and covered by the LLM egress proxy
        // build/test gates; root tests import them only for integration contracts.
        'llm-egress-proxy/src/**',
        // Canvas animation internals are covered indirectly through AnimatedBackground
        // registry/dispatch tests and guarded by tests/config/coveragePolicy.test.ts.
        'src/components/animations/**',
        'src/types/ui.ts',
        'src/types/user.ts',
        'shared/types/**/*.ts',
        // Server/gateway contract helpers are covered by their package-level tests,
        // not by the frontend coverage gate.
        'shared/schemas/mobileApiRequests.ts',
        'shared/utils/gatewayAuth.ts',
        // Type-only and barrel-export files with no executable logic
        'src/components/**/types.ts',
        'src/components/**/index.ts',
        'src/components/**/index.tsx',
        'src/contexts/**/index.ts',
        'src/hooks/**/types.ts',
        'src/hooks/**/index.ts',
        // React Query hook definitions are factory-generated closures with no custom logic
        'src/hooks/queries/useWalletLabels.ts',
        'src/services/**/types.ts',
        'src/services/**/index.ts',
        'src/themes/types.ts',
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
