import path from 'path';
import { defineConfig } from 'vitest/config';

const repoRoot = path.resolve(__dirname, '..');

export default defineConfig({
  root: repoRoot,
  test: {
    environment: 'node',
    include: ['tests/ai-proxy/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      include: ['ai-proxy/src/**/*.ts'],
      exclude: [
        'ai-proxy/src/**/*.d.ts',
        'ai-proxy/src/**/index.ts',
        'ai-proxy/dist/**',
        'tests/**',
      ],
      reportsDirectory: path.resolve(__dirname, 'coverage'),
      thresholds: {
        // Baseline observed on 2026-05-09: 78.92 statements, 69.84 branches,
        // 90.45 functions, 81.19 lines. Raise as route/runtime coverage grows.
        branches: 69,
        functions: 90,
        lines: 81,
        statements: 78,
      },
    },
    reporters: ['default', 'junit'],
    outputFile: {
      junit: path.resolve(__dirname, 'junit.xml'),
    },
  },
});
