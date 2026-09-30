import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext } from '@playwright/test';
import { DEFAULT_ENV_FILE, readDemoConfig } from '../lib/env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../../..');
/**
 * Saved session, reused across runs to stay under the login limiter. Kept out of
 * Playwright's outputDir, which is wiped at the start of every run. Gitignored.
 */
export const AUTH_STATE_FILE = path.join(repoRoot, 'config/demo/demo.session.local.json');

export interface DemoCaptureEnv {
  username: string;
  password: string;
  url: string;
  outputDir: string;
}

/** Same credentials file `npm run demo:seed` writes (gitignored). */
export function loadDemoCaptureEnv(): DemoCaptureEnv {
  const config = readDemoConfig(process.env.DEMO_ENV_FILE || DEFAULT_ENV_FILE);
  return {
    username: config.username,
    password: config.password,
    url: process.env.SANCTUARY_DEMO_URL || config.url,
    outputDir: path.resolve(repoRoot, process.env.DEMO_SCREENSHOT_DIR || 'docs/assets/screenshots'),
  };
}

/**
 * Double-submit CSRF header for mutations. Names mirror CSRF_COOKIE_NAME /
 * CSRF_HEADER_NAME in src/api/authPolicy.ts (not imported: it depends on the
 * @sanctuary/shared path alias, which this config's loader does not resolve).
 */
export async function csrfHeader(api: APIRequestContext): Promise<Record<string, string>> {
  const { cookies } = await api.storageState();
  const csrf = cookies.find((c) => c.name === 'sanctuary_csrf')?.value;
  return csrf ? { 'X-CSRF-Token': csrf } : {};
}
