import { chmodSync, existsSync } from 'node:fs';
import { request, type APIRequestContext } from '@playwright/test';
import { AUTH_STATE_FILE, csrfHeader, loadDemoCaptureEnv } from './demoEnv';

/** Reuses the previous run's session (refreshing it if needed) when it is still valid. */
async function resumeSession(baseURL: string): Promise<APIRequestContext | null> {
  if (!existsSync(AUTH_STATE_FILE)) return null;
  const api = await request.newContext({ baseURL, ignoreHTTPSErrors: true, storageState: AUTH_STATE_FILE });
  if ((await api.get('/api/v1/auth/me')).ok()) return api;
  const refreshed = await api.post('/api/v1/auth/refresh', { headers: await csrfHeader(api) });
  if (refreshed.ok() && (await api.get('/api/v1/auth/me')).ok()) return api;
  await api.dispose();
  return null;
}

/**
 * At most one API login per capture run, and none while the previous run's
 * session is still valid: the login limiter allows 5 attempts per 15 minutes.
 */
export default async function globalSetup(): Promise<void> {
  const env = loadDemoCaptureEnv();
  let api = await resumeSession(env.url);
  if (!api) {
    api = await request.newContext({ baseURL: env.url, ignoreHTTPSErrors: true });
    const response = await api.post('/api/v1/auth/login', {
      data: { username: env.username, password: env.password },
    });
    if (!response.ok()) {
      throw new Error(`demo login failed (${response.status()}): ${await response.text()}`);
    }
  }
  await api.storageState({ path: AUTH_STATE_FILE });
  chmodSync(AUTH_STATE_FILE, 0o600);
  await api.dispose();
}
