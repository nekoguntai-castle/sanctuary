import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ApiError, createApiClient } from './api-client.mjs';

/**
 * Reuses the previous run's session cookies (gitignored, 0600) while they are
 * still valid: the login limiter allows 5 attempts per 15 minutes, successes included.
 */
export async function login(config, sessionFile) {
  if (existsSync(sessionFile)) {
    const api = createApiClient(config.url, JSON.parse(readFileSync(sessionFile, 'utf8')));
    try {
      const me = await api.get('/auth/me');
      if (me?.username === config.username) return api;
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    }
  }
  const api = createApiClient(config.url);
  await api.post('/auth/login', { username: config.username, password: config.password });
  writeFileSync(sessionFile, JSON.stringify(api.cookies()), { mode: 0o600 });
  return api;
}
