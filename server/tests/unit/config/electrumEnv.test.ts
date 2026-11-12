import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadElectrumPoolEnvConfig,
} from '../../../src/config/electrumEnv';

/**
 * Non-regression: the Electrum pool settings were read with
 * a bare parseInt outside the config module. A typo such as
 * ELECTRUM_POOL_MAX_CONNECTIONS=ten became NaN and was passed to the pool.
 */
const ELECTRUM_ENV = [
  'ELECTRUM_POOL_ENABLED',
  'ELECTRUM_POOL_MIN_CONNECTIONS',
  'ELECTRUM_POOL_MAX_CONNECTIONS',
  'ELECTRUM_POOL_IDLE_TIMEOUT_MS',
  'ELECTRUM_POOL_HEALTH_CHECK_INTERVAL_MS',
  'ELECTRUM_POOL_ACQUISITION_TIMEOUT_MS',
  'ELECTRUM_POOL_KEEPALIVE_INTERVAL_MS',
] as const;

describe('Electrum environment configuration', () => {
  beforeEach(() => {
    for (const name of ELECTRUM_ENV) vi.stubEnv(name, '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('pool settings', () => {
    it('uses the documented defaults when nothing is set', () => {
      expect(loadElectrumPoolEnvConfig()).toEqual({
        enabled: true,
        minConnections: 2,
        maxConnections: 10,
        idleTimeoutMs: 300000,
        healthCheckIntervalMs: 30000,
        acquisitionTimeoutMs: 5000,
        keepaliveIntervalMs: 15000,
      });
    });

    it('reads each setting from its environment variable', () => {
      vi.stubEnv('ELECTRUM_POOL_ENABLED', 'false');
      vi.stubEnv('ELECTRUM_POOL_MIN_CONNECTIONS', '1');
      vi.stubEnv('ELECTRUM_POOL_MAX_CONNECTIONS', '4');
      vi.stubEnv('ELECTRUM_POOL_IDLE_TIMEOUT_MS', '1000');
      vi.stubEnv('ELECTRUM_POOL_HEALTH_CHECK_INTERVAL_MS', '2000');
      vi.stubEnv('ELECTRUM_POOL_ACQUISITION_TIMEOUT_MS', '3000');
      vi.stubEnv('ELECTRUM_POOL_KEEPALIVE_INTERVAL_MS', '4000');

      expect(loadElectrumPoolEnvConfig()).toEqual({
        enabled: false,
        minConnections: 1,
        maxConnections: 4,
        idleTimeoutMs: 1000,
        healthCheckIntervalMs: 2000,
        acquisitionTimeoutMs: 3000,
        keepaliveIntervalMs: 4000,
      });
    });

    it('still accepts a connection count of 0, which the pool sizes from its server list', () => {
      vi.stubEnv('ELECTRUM_POOL_MAX_CONNECTIONS', '0');
      vi.stubEnv('ELECTRUM_POOL_MIN_CONNECTIONS', '0');

      expect(loadElectrumPoolEnvConfig()).toMatchObject({ minConnections: 0, maxConnections: 0 });
    });

    it.each([
      ['ELECTRUM_POOL_MAX_CONNECTIONS', 'ten', 'maxConnections'],
      ['ELECTRUM_POOL_MAX_CONNECTIONS', '-2', 'maxConnections'],
      ['ELECTRUM_POOL_HEALTH_CHECK_INTERVAL_MS', '0', 'healthCheckIntervalMs'],
      ['ELECTRUM_POOL_MIN_CONNECTIONS', '-1', 'minConnections'],
      ['ELECTRUM_POOL_ACQUISITION_TIMEOUT_MS', 'soon', 'acquisitionTimeoutMs'],
    ])('rejects %s=%s instead of passing NaN to the pool', (name, value, field) => {
      vi.stubEnv(name, value);

      expect(() => loadElectrumPoolEnvConfig()).toThrow(
        new RegExp(`Invalid Electrum pool configuration: ${field}`),
      );
    });
  });
});
