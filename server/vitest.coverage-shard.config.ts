import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

const base = baseConfig as {
  test?: {
    coverage?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

const baseTest = base.test ?? {};
const baseCoverage =
  typeof baseTest.coverage === 'object' && baseTest.coverage !== null
    ? baseTest.coverage
    : {};
const reportsDirectory =
  process.env.SANCTUARY_BACKEND_COVERAGE_REPORTS_DIR ??
  './coverage-shards/shard-local';

// Shard-mode config: each shard writes a blob report instead of running the
// per-shard coverage threshold (which would always fail because each shard
// only sees a slice of the source). The merge step in
// scripts/ci/backend-coverage-merge.sh runs `vitest --mergeReports` to combine
// the blobs into one canonical coverage report that the threshold then checks.
export default defineConfig({
  ...base,
  test: {
    ...baseTest,
    coverage: {
      ...baseCoverage,
      reporter: ['json-summary'],
      reportsDirectory,
      thresholds: {
        branches: 0,
        functions: 0,
        lines: 0,
        statements: 0,
      },
    },
    outputFile: {},
    reporters: ['dot', 'blob'],
    teardownTimeout: 60_000,
  },
});
