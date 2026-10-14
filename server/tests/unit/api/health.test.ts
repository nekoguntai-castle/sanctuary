import { vi, Mock } from 'vitest';
/**
 * Health API Tests
 *
 * Tests for the health check endpoints including liveness, readiness,
 * and comprehensive health checks.
 */

import request from 'supertest';
import express, { Express } from 'express';

// Mock dependencies
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock('../../../src/services/circuitBreaker', () => ({
  circuitBreakerRegistry: {
    getAllHealth: vi.fn(),
    getOverallStatus: vi.fn(),
  },
}));

vi.mock('../../../src/services/syncService', () => ({
  getSyncService: vi.fn(),
}));

vi.mock('../../../src/websocket/server', () => ({
  getWebSocketServer: vi.fn(),
}));

vi.mock('../../../src/infrastructure/redis', () => ({
  checkRedisHealth: vi.fn(),
}));

vi.mock('../../../src/jobs', () => ({
  jobQueue: {
    isAvailable: vi.fn().mockReturnValue(true),
    getHealth: vi.fn(),
  },
}));

vi.mock('../../../src/services/cacheInvalidation', () => ({
  getCacheInvalidationStatus: vi.fn(),
}));

vi.mock('../../../src/services/startupManager', () => ({
  getStartupStatus: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  statfs: vi.fn(),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import mocked modules
import prisma from '../../../src/models/prisma';
import { circuitBreakerRegistry } from '../../../src/services/circuitBreaker';
import { getSyncService } from '../../../src/services/syncService';
import { getWebSocketServer } from '../../../src/websocket/server';
import { checkRedisHealth } from '../../../src/infrastructure/redis';
import { jobQueue } from '../../../src/jobs';
import { getCacheInvalidationStatus } from '../../../src/services/cacheInvalidation';
import { getStartupStatus } from '../../../src/services/startupManager';
import { statfs } from 'node:fs/promises';

// Import the router after mocks
import healthRouter from '../../../src/api/health';

describe('Health API', () => {
  let app: Express;
  const originalMemoryUsage = process.memoryUsage;

  beforeAll(() => {
    app = express();
    app.use('/api/v1/health', healthRouter);
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock process.memoryUsage to return low memory values (under 500MB threshold)
    process.memoryUsage = vi.fn().mockReturnValue({
      heapUsed: 100 * 1024 * 1024,   // 100MB
      heapTotal: 200 * 1024 * 1024,  // 200MB
      rss: 300 * 1024 * 1024,        // 300MB
      external: 10 * 1024 * 1024,    // 10MB
      arrayBuffers: 5 * 1024 * 1024, // 5MB
    }) as unknown as typeof process.memoryUsage;

    // Default healthy mocks
    (prisma.$queryRaw as Mock).mockResolvedValue([{ 1: 1 }]);
    (circuitBreakerRegistry.getAllHealth as Mock).mockReturnValue([]);
    (circuitBreakerRegistry.getOverallStatus as Mock).mockReturnValue('healthy');
    (getSyncService as Mock).mockReturnValue({
      getHealthMetrics: () => ({
        isRunning: true,
        queueLength: 0,
        activeSyncs: 0,
        subscribedAddresses: 100,
        subscriptionsEnabled: true,
        subscriptionOwnership: 'self',
        pollingMode: 'in-process',
      }),
    });
    (getWebSocketServer as Mock).mockReturnValue({
      getStats: () => ({
        clients: 5,
        maxClients: 100,
        subscriptions: 20,
        uniqueUsers: 3,
      }),
    });
    (checkRedisHealth as Mock).mockResolvedValue({
      status: 'healthy',
      latencyMs: 1,
    });
    (jobQueue.isAvailable as Mock).mockReturnValue(true);
    (jobQueue.getHealth as Mock).mockResolvedValue({
      healthy: true,
      queueName: 'test-queue',
      waiting: 0,
      active: 0,
      completed: 100,
      failed: 0,
      delayed: 0,
      paused: false,
    });
    (getCacheInvalidationStatus as Mock).mockReturnValue({
      initialized: true,
      listenerCount: 3,
    });
    (getStartupStatus as Mock).mockReturnValue({
      started: true,
      overallSuccess: true,
      services: [],
    });
    (statfs as Mock).mockResolvedValue({
      blocks: 1000,
      bavail: 400,
      bsize: 1024 * 1024,
    });
  });

  afterEach(() => {
    process.memoryUsage = originalMemoryUsage;
  });

  describe('GET /api/v1/health', () => {
    it('should return healthy status when all components are healthy', async () => {
      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.uptime).toBeDefined();
      expect(response.body.components).toBeDefined();
      expect(response.body.components.database.status).toBe('healthy');
      expect(response.body.components.memory.status).toBe('healthy');
      expect(response.body.components.sync.details.pollingMode).toBe('in-process');
    });

    it('should return degraded status when database is unhealthy', async () => {
      (prisma.$queryRaw as Mock).mockRejectedValue(new Error('Connection refused'));

      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('unhealthy');
      expect(response.body.components.database.status).toBe('unhealthy');
      expect(response.body.components.database.message).toBe('Connection refused');
    });

    it('should return degraded when sync service is not running', async () => {
      (getSyncService as Mock).mockReturnValue({
        getHealthMetrics: () => ({
          isRunning: false,
          queueLength: 0,
          activeSyncs: 0,
          subscribedAddresses: 0,
          subscriptionsEnabled: true,
          subscriptionOwnership: 'external',
          pollingMode: 'in-process',
        }),
      });

      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('degraded');
      expect(response.body.components.sync.status).toBe('degraded');
      expect(response.body.components.sync.message).toBe('Sync service not running');
    });

    it('should return degraded when sync queue appears stalled', async () => {
      (getSyncService as Mock).mockReturnValue({
        getHealthMetrics: () => ({
          isRunning: true,
          queueLength: 15,
          activeSyncs: 0,
          subscribedAddresses: 100,
          subscriptionsEnabled: true,
          subscriptionOwnership: 'self',
          pollingMode: 'in-process',
        }),
      });

      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body.components.sync.status).toBe('degraded');
      expect(response.body.components.sync.message).toBe('Sync queue appears stalled');
    });

    it('should return degraded when WebSocket server is not initialized', async () => {
      (getWebSocketServer as Mock).mockReturnValue(null);

      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('degraded');
      expect(response.body.components.websocket.status).toBe('degraded');
      expect(response.body.components.websocket.message).toBe('WebSocket server not initialized');
    });

    it('should include WebSocket stats when available', async () => {
      const response = await request(app).get('/api/v1/health');

      expect(response.body.components.websocket.status).toBe('healthy');
      expect(response.body.components.websocket.details).toEqual({
        connections: 5,
        maxConnections: 100,
        subscriptions: 20,
        uniqueUsers: 3,
      });
    });

    it('should handle WebSocket stats error gracefully', async () => {
      (getWebSocketServer as Mock).mockReturnValue({
        getStats: () => {
          throw new Error('Stats unavailable');
        },
      });

      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body.components.websocket.status).toBe('degraded');
      expect(response.body.components.websocket.message).toBe('WebSocket stats unavailable');
    });

    it('should include memory usage in response', async () => {
      const response = await request(app).get('/api/v1/health');

      expect(response.body.components.memory.status).toBe('healthy');
      expect(response.body.components.memory.details).toBeDefined();
      expect(response.body.components.memory.details.heapUsed).toBeDefined();
      expect(response.body.components.memory.details.heapTotal).toBeDefined();
      expect(response.body.components.memory.details.rss).toBeDefined();
    });

    it('should fall back to default version when package version is unset', async () => {
      const originalVersion = process.env.npm_package_version;
      process.env.npm_package_version = '';

      const response = await request(app).get('/api/v1/health');

      process.env.npm_package_version = originalVersion;

      expect(response.status).toBe(200);
      expect(response.body.version).toBe('0.0.0');
    });

    it('should include database latency in response', async () => {
      const response = await request(app).get('/api/v1/health');

      expect(response.body.components.database.latency).toBeDefined();
      expect(typeof response.body.components.database.latency).toBe('number');
    });

    it('should map degraded Redis status from infrastructure check', async () => {
      (checkRedisHealth as Mock).mockResolvedValue({
        status: 'degraded',
        error: 'Redis latency high',
        latencyMs: 50,
      });

      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body.components.redis.status).toBe('degraded');
      expect(response.body.components.redis.message).toBe('Redis latency high');
    });

    it('should return unhealthy overall status when Redis is unhealthy', async () => {
      (checkRedisHealth as Mock).mockResolvedValue({
        status: 'unhealthy',
        error: 'Redis unavailable',
        latencyMs: 0,
      });

      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('unhealthy');
      expect(response.body.components.redis.status).toBe('unhealthy');
    });

    it('should report worker-owned job queue when local queue is unavailable', async () => {
      (jobQueue.isAvailable as Mock).mockReturnValue(false);

      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body.components.jobQueue.status).toBe('healthy');
      expect(response.body.components.jobQueue.message).toContain('worker process');
    });

    it('should treat missing job queue availability probe as worker-owned queue', async () => {
      const originalIsAvailable = (jobQueue as any).isAvailable;
      (jobQueue as any).isAvailable = undefined;

      const response = await request(app).get('/api/v1/health');

      (jobQueue as any).isAvailable = originalIsAvailable;

      expect(response.status).toBe(200);
      expect(response.body.components.jobQueue.status).toBe('healthy');
      expect(response.body.components.jobQueue.message).toContain('worker process');
    });

    it('should report degraded when local queue health method is unavailable', async () => {
      const originalGetHealth = (jobQueue as any).getHealth;
      (jobQueue as any).getHealth = undefined;

      const response = await request(app).get('/api/v1/health');

      (jobQueue as any).getHealth = originalGetHealth;

      expect(response.status).toBe(200);
      expect(response.body.components.jobQueue.status).toBe('degraded');
      expect(response.body.components.jobQueue.message).toBe('Job queue health unavailable');
    });

    it('should report unhealthy when local queue health reports unhealthy', async () => {
      (jobQueue.getHealth as Mock).mockResolvedValue({
        healthy: false,
        queueName: 'test-queue',
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 3,
        delayed: 1,
        paused: false,
      });

      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body.components.jobQueue.status).toBe('unhealthy');
    });

    it('should degrade gracefully when job queue health throws', async () => {
      (jobQueue.getHealth as Mock).mockRejectedValue(new Error('Queue health unavailable'));

      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body.components.jobQueue.status).toBe('degraded');
      expect(response.body.components.jobQueue.message).toBe('Job queue health check unavailable');
    });

    it('should degrade when cache invalidation is not initialized', async () => {
      (getCacheInvalidationStatus as Mock).mockReturnValue({
        initialized: false,
        listenerCount: 0,
      });

      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body.components.cacheInvalidation.status).toBe('degraded');
      expect(response.body.components.cacheInvalidation.message).toBe('Cache invalidation not initialized');
    });

    it('should report startup as degraded when not started', async () => {
      (getStartupStatus as Mock).mockReturnValue({
        started: false,
        overallSuccess: false,
        services: [],
      });

      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body.components.startup.status).toBe('degraded');
      expect(response.body.components.startup.message).toBe('Startup not initiated');
    });

    it('should report startup as unhealthy when startup failed', async () => {
      (getStartupStatus as Mock).mockReturnValue({
        started: true,
        overallSuccess: false,
        services: [{ name: 'sync', degraded: false, success: false }],
      });

      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body.components.startup.status).toBe('unhealthy');
      expect(response.body.components.startup.message).toContain('Startup failed');
    });

    it('should report startup as degraded when services are degraded', async () => {
      (getStartupStatus as Mock).mockReturnValue({
        started: true,
        overallSuccess: true,
        services: [{ name: 'electrum', degraded: true, success: true }],
      });

      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body.components.startup.status).toBe('degraded');
      expect(response.body.components.startup.message).toContain('degraded mode');
    });

    it('should mark disk as unhealthy when critical threshold is reached', async () => {
      (statfs as Mock).mockResolvedValue({
        blocks: 100,
        bavail: 2, // 98% used
        bsize: 1024,
      });

      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body.components.disk.status).toBe('unhealthy');
      expect(response.body.components.disk.message).toContain('critical');
    });

    it('should mark disk as degraded when warning threshold is reached', async () => {
      (statfs as Mock).mockResolvedValue({
        blocks: 100,
        bavail: 10, // 90% used
        bsize: 1024,
      });

      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body.components.disk.status).toBe('degraded');
      expect(response.body.components.disk.message).toContain('elevated');
    });

    it('should handle disk check failures gracefully', async () => {
      (statfs as Mock).mockRejectedValue(new Error('statfs not available'));

      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body.components.disk.status).toBe('healthy');
      expect(response.body.components.disk.message).toBe('Disk space check unavailable');
    });

    it('should mark memory as unhealthy when usage is very high', async () => {
      process.memoryUsage = vi.fn().mockReturnValue({
        heapUsed: 1100 * 1024 * 1024,
        heapTotal: 1200 * 1024 * 1024,
        rss: 1300 * 1024 * 1024,
        external: 20 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      }) as unknown as typeof process.memoryUsage;

      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body.components.memory.status).toBe('unhealthy');
      expect(response.body.components.memory.message).toContain('High memory usage');
    });

    it('should mark memory as degraded when usage is elevated', async () => {
      process.memoryUsage = vi.fn().mockReturnValue({
        heapUsed: 600 * 1024 * 1024,
        heapTotal: 900 * 1024 * 1024,
        rss: 1000 * 1024 * 1024,
        external: 20 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      }) as unknown as typeof process.memoryUsage;

      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body.components.memory.status).toBe('degraded');
      expect(response.body.components.memory.message).toContain('Elevated memory usage');
    });
  });

  describe('GET /api/v1/health/live', () => {
    it('should return alive status', async () => {
      const response = await request(app).get('/api/v1/health/live');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('alive');
    });

    it('should respond even when other components are unhealthy', async () => {
      (prisma.$queryRaw as Mock).mockRejectedValue(new Error('Database down'));

      const response = await request(app).get('/api/v1/health/live');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('alive');
    });
  });

  describe('GET /api/v1/health/ready', () => {
    it('should return ready when database is healthy', async () => {
      const response = await request(app).get('/api/v1/health/ready');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ready');
    });

    it('should return not ready when database is unhealthy', async () => {
      (prisma.$queryRaw as Mock).mockRejectedValue(new Error('Connection timeout'));

      const response = await request(app).get('/api/v1/health/ready');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('not ready');
      expect(response.body.reason).toBe('Database unavailable');
    });
  });

  describe('GET /api/v1/health/circuits', () => {
    it('should return empty circuits when none registered', async () => {
      (circuitBreakerRegistry.getAllHealth as Mock).mockReturnValue([]);
      (circuitBreakerRegistry.getOverallStatus as Mock).mockReturnValue('healthy');

      const response = await request(app).get('/api/v1/health/circuits');

      expect(response.status).toBe(200);
      expect(response.body.overall).toBe('healthy');
      expect(response.body.circuits).toEqual([]);
    });

    it('should return circuit breaker statuses', async () => {
      const mockCircuits = [
        { name: 'electrum', state: 'closed', failures: 0, successes: 10 },
        { name: 'mempool-api', state: 'open', failures: 5, successes: 0 },
      ];

      (circuitBreakerRegistry.getAllHealth as Mock).mockReturnValue(mockCircuits);
      (circuitBreakerRegistry.getOverallStatus as Mock).mockReturnValue('degraded');

      const response = await request(app).get('/api/v1/health/circuits');

      expect(response.status).toBe(200);
      expect(response.body.overall).toBe('degraded');
      expect(response.body.circuits).toHaveLength(2);
      expect(response.body.circuits[0].name).toBe('electrum');
      expect(response.body.circuits[1].state).toBe('open');
    });
  });

  describe('Electrum Health Check', () => {
    it('should return healthy when no electrum circuit breaker exists', async () => {
      (circuitBreakerRegistry.getAllHealth as Mock).mockReturnValue([]);

      const response = await request(app).get('/api/v1/health');

      expect(response.body.components.electrum.status).toBe('healthy');
      expect(response.body.components.electrum.message).toBe('No circuit breaker registered');
    });

    it('should return unhealthy when electrum circuit is open', async () => {
      (circuitBreakerRegistry.getAllHealth as Mock).mockReturnValue([
        {
          name: 'electrum-mainnet',
          state: 'open',
          failures: 5,
          lastFailure: '2025-01-01T00:00:00Z',
          totalRequests: 100,
        },
      ]);

      const response = await request(app).get('/api/v1/health');

      expect(response.body.components.electrum.status).toBe('unhealthy');
      expect(response.body.components.electrum.message).toBe('Circuit open - service unavailable');
      expect(response.body.components.electrum.details.failures).toBe(5);
    });

    it('should return degraded when electrum circuit is half-open', async () => {
      (circuitBreakerRegistry.getAllHealth as Mock).mockReturnValue([
        {
          name: 'electrum-testnet',
          state: 'half-open',
          successes: 2,
          totalRequests: 50,
        },
      ]);

      const response = await request(app).get('/api/v1/health');

      expect(response.body.components.electrum.status).toBe('degraded');
      expect(response.body.components.electrum.message).toBe('Circuit half-open - recovering');
    });

    it('reports the worst electrum breaker regardless of registration order', async () => {
      (circuitBreakerRegistry.getAllHealth as Mock).mockReturnValue([
        { name: 'electrum-pool:1', state: 'closed', failures: 0, totalRequests: 10 },
        { name: 'electrum-pool:2', state: 'open', failures: 8, lastFailure: '2025-01-01T00:00:00Z' },
      ]);

      const response = await request(app).get('/api/v1/health');

      expect(response.body.components.electrum.status).toBe('unhealthy');
      expect(response.body.components.electrum.details.failures).toBe(8);
      expect(response.body.components.electrum.details.breakers).toEqual([
        { name: 'electrum-pool:1', state: 'closed', failures: 0 },
        { name: 'electrum-pool:2', state: 'open', failures: 8 },
      ]);
    });

    it('prefers half-open over closed and open over half-open', async () => {
      (circuitBreakerRegistry.getAllHealth as Mock).mockReturnValueOnce([
        { name: 'electrum-pool:1', state: 'closed', failures: 0 },
        { name: 'electrum-pool:2', state: 'half-open', failures: 3, successes: 1 },
      ]);
      const degraded = await request(app).get('/api/v1/health');
      expect(degraded.body.components.electrum.status).toBe('degraded');

      (circuitBreakerRegistry.getAllHealth as Mock).mockReturnValueOnce([
        { name: 'electrum-pool:1', state: 'half-open', failures: 3, successes: 1 },
        { name: 'electrum-pool:2', state: 'open', failures: 8 },
      ]);
      const unhealthy = await request(app).get('/api/v1/health');
      expect(unhealthy.body.components.electrum.status).toBe('unhealthy');
    });

    it('should return healthy when electrum circuit is closed', async () => {
      (circuitBreakerRegistry.getAllHealth as Mock).mockReturnValue([
        {
          name: 'electrum-signet',
          state: 'closed',
          totalRequests: 200,
          lastSuccess: '2025-01-01T12:00:00Z',
        },
      ]);

      const response = await request(app).get('/api/v1/health');

      expect(response.body.components.electrum.status).toBe('healthy');
      expect(response.body.components.electrum.details.totalRequests).toBe(200);
    });
  });

  describe('Circuit Breaker Health Check', () => {
    it('should return healthy when no circuit breakers registered', async () => {
      (circuitBreakerRegistry.getAllHealth as Mock).mockReturnValue([]);

      const response = await request(app).get('/api/v1/health');

      expect(response.body.components.circuitBreakers.status).toBe('healthy');
      expect(response.body.components.circuitBreakers.message).toBe('No circuit breakers registered');
    });

    it('should return unhealthy when all circuits are open', async () => {
      (circuitBreakerRegistry.getAllHealth as Mock).mockReturnValue([
        { name: 'service-a', state: 'open' },
        { name: 'service-b', state: 'open' },
      ]);

      const response = await request(app).get('/api/v1/health');

      expect(response.body.components.circuitBreakers.status).toBe('unhealthy');
      expect(response.body.components.circuitBreakers.message).toBe('All 2 circuits open');
    });

    it('should return degraded when some circuits are open', async () => {
      (circuitBreakerRegistry.getAllHealth as Mock).mockReturnValue([
        { name: 'service-a', state: 'open' },
        { name: 'service-b', state: 'closed' },
      ]);

      const response = await request(app).get('/api/v1/health');

      expect(response.body.components.circuitBreakers.status).toBe('degraded');
      expect(response.body.components.circuitBreakers.message).toBe('1/2 circuits open');
    });

    it('should return degraded when some circuits are half-open', async () => {
      (circuitBreakerRegistry.getAllHealth as Mock).mockReturnValue([
        { name: 'service-a', state: 'half-open' },
        { name: 'service-b', state: 'closed' },
      ]);

      const response = await request(app).get('/api/v1/health');

      expect(response.body.components.circuitBreakers.status).toBe('degraded');
      expect(response.body.components.circuitBreakers.message).toBe('1/2 circuits recovering');
    });

    it('should return healthy when all circuits are closed', async () => {
      (circuitBreakerRegistry.getAllHealth as Mock).mockReturnValue([
        { name: 'service-a', state: 'closed' },
        { name: 'service-b', state: 'closed' },
        { name: 'service-c', state: 'closed' },
      ]);

      const response = await request(app).get('/api/v1/health');

      expect(response.body.components.circuitBreakers.status).toBe('healthy');
      expect(response.body.components.circuitBreakers.details.total).toBe(3);
      expect(response.body.components.circuitBreakers.details.healthy).toBe(3);
    });
  });

  describe('Overall Status Determination', () => {
    it('should return unhealthy when database is unhealthy', async () => {
      (prisma.$queryRaw as Mock).mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/v1/health');

      expect(response.body.status).toBe('unhealthy');
    });

    it('should return degraded when non-database component is unhealthy', async () => {
      (circuitBreakerRegistry.getAllHealth as Mock).mockReturnValue([
        { name: 'electrum', state: 'open', failures: 10, lastFailure: '2025-01-01' },
      ]);

      const response = await request(app).get('/api/v1/health');

      // Electrum open = unhealthy, but not database, so overall = degraded
      expect(response.body.status).toBe('degraded');
    });

    it('should return degraded when any component is degraded', async () => {
      (getSyncService as Mock).mockReturnValue({
        getHealthMetrics: () => ({
          isRunning: false,
          queueLength: 0,
          activeSyncs: 0,
          subscribedAddresses: 0,
          subscriptionsEnabled: true,
          subscriptionOwnership: 'external',
          pollingMode: 'in-process',
        }),
      });

      const response = await request(app).get('/api/v1/health');

      expect(response.body.status).toBe('degraded');
    });

    it('should return healthy when all components are healthy', async () => {
      const response = await request(app).get('/api/v1/health');

      expect(response.body.status).toBe('healthy');
    });
  });

  describe('Error Handling', () => {
    it('should handle sync service errors gracefully', async () => {
      (getSyncService as Mock).mockImplementation(() => {
        throw new Error('Sync service not available');
      });

      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body.components.sync.status).toBe('degraded');
      expect(response.body.components.sync.message).toBe('Sync stats unavailable');
    });

    it('should handle non-Error exceptions in database check', async () => {
      (prisma.$queryRaw as Mock).mockRejectedValue('String error');

      const response = await request(app).get('/api/v1/health');

      expect(response.body.components.database.status).toBe('unhealthy');
      expect(response.body.components.database.message).toBe('String error');
    });
  });
});
