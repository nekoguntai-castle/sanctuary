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

export default defineConfig({
  ...base,
  test: {
    ...baseTest,
    coverage: {
      ...baseCoverage,
      reporter: ['json-summary'],
      reportsDirectory: './coverage-shards',
      thresholds: {
        branches: 0,
        functions: 0,
        lines: 0,
        statements: 0,
      },
    },
    outputFile: {},
    reporters: ['blob'],
  },
});
