import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTH_STATE_FILE, loadDemoCaptureEnv, repoRoot } from './demoEnv';

/**
 * Throwaway-style Playwright config for docs screenshots. It has no
 * `webServer` block on purpose: it drives the Docker-hosted stack that
 * ./start.sh runs (CLAUDE.md forbids `npm run dev` on the host).
 *
 *   npm run demo:capture                     # every shot, dark + light
 *   npm run demo:capture -- --grep dashboard # one shot
 */
const here = path.dirname(fileURLToPath(import.meta.url));

const desktop = {
  ...devices['Desktop Chrome'],
  viewport: { width: 1440, height: 900 },
  // 1x keeps committed PNGs near the old 100–300 KB; DEMO_SCREENSHOT_SCALE=2 for retina.
  deviceScaleFactor: Number(process.env.DEMO_SCREENSHOT_SCALE || 1),
  ignoreHTTPSErrors: true,
};

export default defineConfig({
  testDir: here,
  testMatch: 'capture.demo.ts',
  outputDir: path.join(repoRoot, 'test-results/demo-capture'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [['line']],
  globalSetup: path.join(here, 'globalSetup.ts'),
  use: {
    baseURL: loadDemoCaptureEnv().url,
    storageState: AUTH_STATE_FILE,
    screenshot: 'off',
    trace: 'off',
  },
  projects: [
    { name: 'dark', use: { ...desktop, colorScheme: 'dark' } },
    { name: 'light', use: { ...desktop, colorScheme: 'light' } },
  ],
});
