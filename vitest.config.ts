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
        'components/animations/**',
        'src/types/**/*.ts',
        'shared/types/**/*.ts',
      ],
      reportsDirectory: './coverage',
      thresholds: {
        // Coverage baseline raised after second-pass + low-coverage batch hardening (2026-03-02)
        // Keep this aligned with CI to prevent silent branch regressions.
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
    reporters: ['default', 'junit'],
    outputFile: {
      junit: './junit.xml',
    },
  },
});
