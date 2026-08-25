import path from 'path';
import { defineConfig } from 'vitest/config';
import { coverageReporters } from '../config/tooling/coverageReporters';

const repoRoot = path.resolve(__dirname, '..');

export default defineConfig({
  root: repoRoot,
  test: {
    environment: 'node',
    include: ['tests/llm-egress-proxy/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: coverageReporters(Boolean(process.env.CI)),
      include: ['llm-egress-proxy/src/**/*.ts'],
      exclude: [
        'llm-egress-proxy/src/**/*.d.ts',
        'llm-egress-proxy/src/**/index.ts',
        'llm-egress-proxy/dist/**',
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
