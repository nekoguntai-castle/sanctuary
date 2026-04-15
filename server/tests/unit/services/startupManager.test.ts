import { vi } from 'vitest';
/**
 * Startup Manager Tests
 *
 * Tests for the service startup orchestration including
 * dependency ordering, retry logic, and graceful degradation.
 */

import {
  startAllServices,
  getStartupStatus,
  isServiceRunning,
  isSystemDegraded,
  getDegradedServices,
  type ServiceDefinition,
} from '../../../src/services/startupManager';

// Mock the logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('StartupManager', () => {
  // Helper to create a service definition
  const createService = (
    name: string,
    options: Partial<ServiceDefinition> = {}
  ): ServiceDefinition => ({
    name,
    start: options.start ?? (async () => {}),
    critical: options.critical ?? false,
    maxRetries: options.maxRetries,
    backoffMs: options.backoffMs,
    dependsOn: options.dependsOn,
  });

  describe('startAllServices', () => {
    it('should start all services successfully', async () => {
      const services: ServiceDefinition[] = [
        createService('service-a'),
        createService('service-b'),
        createService('service-c'),
      ];

      const results = await startAllServices(services);

      expect(results).toHaveLength(3);
      expect(results.every(r => r.started)).toBe(true);
      expect(results.every(r => r.attempts === 1)).toBe(true);
    });

    it('should track startup duration', async () => {
      let now = 1_000;
      const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
      const services: ServiceDefinition[] = [
        createService('service-a', {
          start: async () => {
            now += 50;
          },
        }),
      ];

      try {
        const results = await startAllServices(services);

        expect(results[0].duration).toBe(50);
      } finally {
        dateNowSpy.mockRestore();
      }
    });

    it('should handle non-critical service failures gracefully', async () => {
      const services: ServiceDefinition[] = [
        createService('service-a'),
        createService('service-b', {
          critical: false,
          maxRetries: 1,
          backoffMs: [10],
          start: async () => {
            throw new Error('Service B failed');
          },
        }),
        createService('service-c'),
      ];

      const results = await startAllServices(services);

      expect(results).toHaveLength(3);
      expect(results[0].started).toBe(true);
      expect(results[1].started).toBe(false);
      expect(results[1].degraded).toBe(true);
      expect(results[1].error).toBe('Service B failed');
      expect(results[2].started).toBe(true);
    });

    it('should throw for critical service failures', async () => {
      const services: ServiceDefinition[] = [
        createService('service-a'),
        createService('service-b', {
          critical: true,
          maxRetries: 1,
          backoffMs: [10],
          start: async () => {
            throw new Error('Critical service failed');
          },
        }),
        createService('service-c'),
      ];

      await expect(startAllServices(services)).rejects.toThrow(
        'Critical service service-b failed to start'
      );
    });

    it('should retry failed services with backoff', async () => {
      let attempts = 0;
      const services: ServiceDefinition[] = [
        createService('retry-service', {
          critical: false,
          maxRetries: 3,
          backoffMs: [10, 20, 30],
          start: async () => {
            attempts++;
            if (attempts < 3) {
              throw new Error('Transient failure');
            }
          },
        }),
      ];

      const results = await startAllServices(services);

      expect(results[0].started).toBe(true);
      expect(results[0].attempts).toBe(3);
      expect(attempts).toBe(3);
    });

    it('should report number of attempts on failure', async () => {
      const services: ServiceDefinition[] = [
        createService('failing-service', {
          critical: false,
          maxRetries: 2,
          backoffMs: [10, 10],
          start: async () => {
            throw new Error('Always fails');
          },
        }),
      ];

      const results = await startAllServices(services);

      expect(results[0].started).toBe(false);
      expect(results[0].attempts).toBe(3); // Initial + 2 retries
    });
  });

  describe('dependency ordering', () => {
    it('should start services in dependency order', async () => {
      const startOrder: string[] = [];

      const services: ServiceDefinition[] = [
        createService('service-c', {
          dependsOn: ['service-a', 'service-b'],
          start: async () => { startOrder.push('service-c'); },
        }),
        createService('service-a', {
          start: async () => { startOrder.push('service-a'); },
        }),
        createService('service-b', {
          dependsOn: ['service-a'],
          start: async () => { startOrder.push('service-b'); },
        }),
      ];

      await startAllServices(services);

      expect(startOrder).toEqual(['service-a', 'service-b', 'service-c']);
    });

    it('should detect circular dependencies', async () => {
      const services: ServiceDefinition[] = [
        createService('service-a', { dependsOn: ['service-b'] }),
        createService('service-b', { dependsOn: ['service-a'] }),
      ];

      await expect(startAllServices(services)).rejects.toThrow(
        'Circular dependency detected'
      );
    });

    it('should throw when dependency references a missing service', async () => {
      const services: ServiceDefinition[] = [
        createService('service-a', { dependsOn: ['missing-service'] }),
      ];

      await expect(startAllServices(services)).rejects.toThrow(
        'Service service-a depends on missing service missing-service'
      );
    });

    it('should clear stale completion state when dependency validation fails', async () => {
      await startAllServices([createService('service-a')]);

      await expect(startAllServices([
        createService('service-b', { dependsOn: ['missing-service'] }),
      ])).rejects.toThrow('Service service-b depends on missing service missing-service');

      const status = getStartupStatus();

      expect(status.started).toBe(true);
      expect(status.completedAt).toBeNull();
      expect(status.overallSuccess).toBe(false);
      expect(status.services).toEqual([]);
    });

    it('should skip service when dependency fails', async () => {
      const services: ServiceDefinition[] = [
        createService('service-a', {
          critical: false,
          maxRetries: 1,
          backoffMs: [10],
          start: async () => { throw new Error('A failed'); },
        }),
        createService('service-b', {
          dependsOn: ['service-a'],
        }),
      ];

      const results = await startAllServices(services);

      expect(results[0].started).toBe(false);
      expect(results[1].started).toBe(false);
      expect(results[1].error).toContain('Dependencies failed');
    });
  });

  describe('getStartupStatus', () => {
    it('should return null timestamps before startup begins', async () => {
      vi.resetModules();
      const mod = await import('../../../src/services/startupManager');

      const status = mod.getStartupStatus();
      expect(status.started).toBe(false);
      expect(status.startedAt).toBeNull();
      expect(status.completedAt).toBeNull();
      expect(status.duration).toBeNull();
      expect(status.services).toEqual([]);
    });

    it('should return startup status after services started', async () => {
      const services: ServiceDefinition[] = [
        createService('service-a'),
        createService('service-b'),
      ];

      await startAllServices(services);
      const status = getStartupStatus();

      expect(status.started).toBe(true);
      expect(status.startedAt).toBeDefined();
      expect(status.completedAt).toBeDefined();
      expect(status.duration).toBeGreaterThanOrEqual(0);
      expect(status.overallSuccess).toBe(true);
      expect(status.services).toHaveLength(2);
    });

    it('should reflect partial success when non-critical services fail', async () => {
      const services: ServiceDefinition[] = [
        createService('service-a'),
        createService('service-b', {
          critical: false,
          maxRetries: 1,
          backoffMs: [10],
          start: async () => { throw new Error('Failed'); },
        }),
      ];

      await startAllServices(services);
      const status = getStartupStatus();

      expect(status.overallSuccess).toBe(true); // Overall success because non-critical failure is acceptable
      expect(status.services[1].degraded).toBe(true);
    });
  });

  describe('isServiceRunning', () => {
    it('should return true for running services', async () => {
      const services: ServiceDefinition[] = [
        createService('running-service'),
      ];

      await startAllServices(services);

      expect(isServiceRunning('running-service')).toBe(true);
    });

    it('should return false for failed services', async () => {
      const services: ServiceDefinition[] = [
        createService('failed-service', {
          critical: false,
          maxRetries: 1,
          backoffMs: [10],
          start: async () => { throw new Error('Failed'); },
        }),
      ];

      await startAllServices(services);

      expect(isServiceRunning('failed-service')).toBe(false);
    });

    it('should return false for unknown services', async () => {
      await startAllServices([createService('known-service')]);

      expect(isServiceRunning('unknown-service')).toBe(false);
    });
  });

  describe('isSystemDegraded', () => {
    it('should return false when all services are healthy', async () => {
      const services: ServiceDefinition[] = [
        createService('service-a'),
        createService('service-b'),
      ];

      await startAllServices(services);

      expect(isSystemDegraded()).toBe(false);
    });

    it('should return true when non-critical services fail', async () => {
      const services: ServiceDefinition[] = [
        createService('service-a'),
        createService('service-b', {
          critical: false,
          maxRetries: 1,
          backoffMs: [10],
          start: async () => { throw new Error('Failed'); },
        }),
      ];

      await startAllServices(services);

      expect(isSystemDegraded()).toBe(true);
    });
  });

  describe('getDegradedServices', () => {
    it('should return empty array when no services are degraded', async () => {
      const services: ServiceDefinition[] = [
        createService('service-a'),
        createService('service-b'),
      ];

      await startAllServices(services);

      expect(getDegradedServices()).toEqual([]);
    });

    it('should return names of degraded services', async () => {
      const services: ServiceDefinition[] = [
        createService('service-a'),
        createService('service-b', {
          critical: false,
          maxRetries: 1,
          backoffMs: [10],
          start: async () => { throw new Error('Failed'); },
        }),
        createService('service-c', {
          critical: false,
          maxRetries: 1,
          backoffMs: [10],
          start: async () => { throw new Error('Failed'); },
        }),
      ];

      await startAllServices(services);

      expect(getDegradedServices()).toEqual(['service-b', 'service-c']);
    });
  });

  describe('service startup result', () => {
    it('should include all expected fields', async () => {
      const services: ServiceDefinition[] = [
        createService('test-service'),
      ];

      const results = await startAllServices(services);
      const result = results[0];

      expect(result).toHaveProperty('name', 'test-service');
      expect(result).toHaveProperty('started', true);
      expect(result).toHaveProperty('attempts', 1);
      expect(result).toHaveProperty('duration');
      expect(typeof result.duration).toBe('number');
    });

    it('should include error message on failure', async () => {
      const services: ServiceDefinition[] = [
        createService('failing-service', {
          critical: false,
          maxRetries: 1,
          backoffMs: [10],
          start: async () => { throw new Error('Specific error message'); },
        }),
      ];

      const results = await startAllServices(services);

      expect(results[0].error).toBe('Specific error message');
    });
  });
});
