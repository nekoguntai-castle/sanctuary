import path from 'node:path';
import { defineConfig } from 'vitest/config';

const repoRoot = path.resolve(__dirname, '../..');
const junitPath = process.env.LEDGER_EMULATOR_JUNIT_PATH
  ?? path.join(repoRoot, '.tmp/ci-evidence/ledger-emulator/unscoped-junit.xml');

export default defineConfig({
  root: repoRoot,
  resolve: {
    alias: {
      '@': path.join(repoRoot, 'src'),
      '@sanctuary/shared': path.join(repoRoot, 'shared'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/ledgerEmulator.integration.test.ts'],
    reporters: ['default', 'junit'],
    outputFile: { junit: junitPath },
    testTimeout: 120_000,
    hookTimeout: 30_000,
  },
});
