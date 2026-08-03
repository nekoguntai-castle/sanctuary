import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const PLAYWRIGHT_PORT = Number(process.env.PLAYWRIGHT_PORT ?? 5173);
const DEFAULT_BASE_URL = `http://localhost:${PLAYWRIGHT_PORT}`;
const BASE_URL = process.env.BASE_URL || DEFAULT_BASE_URL;

/**
 * Playwright E2E Test Configuration
 *
 * Run with: npm run test:e2e
 * Run in UI mode: npm run test:e2e:ui
 * Run headed: npm run test:e2e:headed
 */
export default defineConfig({
  testDir: path.join(repoRoot, 'tests/e2e'),
  outputDir: path.join(repoRoot, 'test-results'),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['line'],
    ['html', { outputFolder: path.join(repoRoot, 'playwright-report') }],
    ['junit', { outputFile: path.join(repoRoot, 'playwright-results.xml') }],
    [path.join(repoRoot, 'scripts/ci/playwright-timing-reporter.cjs')],
  ],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    // Mobile viewports
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 12'] },
    },
  ],

  // Run local dev server before starting tests
  // In CI, use preview mode (serves built assets) for reliability
  // Locally, use dev mode for faster iteration
  webServer: {
    command: process.env.CI
      ? `npm run preview -- --port ${PLAYWRIGHT_PORT}`
      : `npm run dev -- --port ${PLAYWRIGHT_PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    cwd: repoRoot,
  },
});
