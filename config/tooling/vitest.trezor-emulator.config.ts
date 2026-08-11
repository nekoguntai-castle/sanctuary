import path from 'node:path';
import { defineConfig } from 'vitest/config';

const repoRoot = path.resolve(__dirname, '../..');
const junitPath =
  process.env.TREZOR_EMULATOR_JUNIT_PATH ??
  path.join(repoRoot, '.tmp/ci-evidence/trezor-emulator/unscoped-junit.xml');

export default defineConfig({
  root: repoRoot,
  resolve: {
    alias: {
      '@trezor/connect-web': path.join(repoRoot, 'node_modules/@trezor/connect/lib/index.js'),
      '@': path.join(repoRoot, 'src'),
      '@sanctuary/shared': path.join(repoRoot, 'shared'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/trezorEmulator.integration.test.ts'],
    reporters: ['default', 'junit'],
    outputFile: {
      junit: junitPath,
    },
  },
});
