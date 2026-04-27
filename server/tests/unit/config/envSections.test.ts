import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildMcpConfig,
  buildWorkerHealthConfig,
  parseIntegerEnv,
  parseStringEnv,
} from '../../../src/config/envSections';

describe('config env section builders', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads typed primitive env values with fallbacks', () => {
    expect(parseIntegerEnv('SANCTUARY_TEST_INTEGER', 7)).toBe(7);
    expect(parseStringEnv('SANCTUARY_TEST_STRING', 'fallback')).toBe('fallback');

    vi.stubEnv('SANCTUARY_TEST_INTEGER', '42');
    vi.stubEnv('SANCTUARY_TEST_STRING', 'configured');

    expect(parseIntegerEnv('SANCTUARY_TEST_INTEGER', 7)).toBe(42);
    expect(parseStringEnv('SANCTUARY_TEST_STRING', 'fallback')).toBe('configured');
  });

  it('prefers MCP_RATE_LIMIT_PER_MINUTE over the legacy MCP rate limit env', () => {
    vi.stubEnv('MCP_ENABLED', 'true');
    vi.stubEnv('MCP_HOST', '0.0.0.0');
    vi.stubEnv('MCP_PORT', '3999');
    vi.stubEnv('MCP_ALLOWED_HOSTS', 'localhost, lan.local, ');
    vi.stubEnv('MCP_RATE_LIMIT_PER_MINUTE', '42');
    vi.stubEnv('MCP_RATE_LIMIT', '24');
    vi.stubEnv('MCP_DEFAULT_PAGE_SIZE', '25');
    vi.stubEnv('MCP_MAX_PAGE_SIZE', '250');
    vi.stubEnv('MCP_MAX_DATE_RANGE_DAYS', '30');

    expect(buildMcpConfig()).toEqual({
      enabled: true,
      host: '0.0.0.0',
      port: 3999,
      allowedHosts: ['localhost', 'lan.local'],
      rateLimitPerMinute: 42,
      defaultPageSize: 25,
      maxPageSize: 250,
      maxDateRangeDays: 30,
    });
  });

  it('falls back to the legacy MCP rate limit env when the new env is empty', () => {
    vi.stubEnv('MCP_RATE_LIMIT_PER_MINUTE', '');
    vi.stubEnv('MCP_RATE_LIMIT', '33');

    expect(buildMcpConfig().rateLimitPerMinute).toBe(33);
  });

  it('uses the production worker host only for production worker health defaults', () => {
    expect(buildWorkerHealthConfig('production', 3002).healthUrl).toBe('http://worker:3002/health');
    expect(buildWorkerHealthConfig('test', 3002).healthUrl).toBe('http://localhost:3002/health');
  });
});
