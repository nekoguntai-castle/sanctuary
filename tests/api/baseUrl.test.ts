import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApiBaseUrl, joinApiBaseUrl } from '../../src/api/baseUrl';

describe('API base URL helpers', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to the proxied API base path', () => {
    expect(getApiBaseUrl()).toBe('/api/v1');
  });

  it('honors VITE_API_URL when configured', () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test/v1');

    expect(getApiBaseUrl()).toBe('https://api.example.test/v1');
  });

  it.each([
    ['/api/v1', '/health', '/api/v1/health'],
    ['/api/v1/', '/health', '/api/v1/health'],
    ['/api/v1', 'health', '/api/v1/health'],
    ['https://api.example.test/v1/', '/auth/refresh', 'https://api.example.test/v1/auth/refresh'],
  ])('joins %s and %s as %s', (baseUrl, endpoint, expected) => {
    expect(joinApiBaseUrl(baseUrl, endpoint)).toBe(expected);
  });
});
