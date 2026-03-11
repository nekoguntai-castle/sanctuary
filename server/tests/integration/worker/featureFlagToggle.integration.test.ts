import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

function createMockEventBus() {
  const listeners = new Map<string, Array<(payload: any) => Promise<void> | void>>();

  return {
    on: vi.fn((event: string, handler: (payload: any) => Promise<void> | void) => {
      const current = listeners.get(event) ?? [];
      current.push(handler);
      listeners.set(event, current);
    }),
    emit: vi.fn(async (event: string, payload: any) => {
      const handlers = listeners.get(event) ?? [];
      for (const handler of handlers) {
        await handler(payload);
      }
    }),
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }

  throw new Error('Timed out waiting for expected condition');
}

describe('feature flag admin + worker integration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('toggles autopilot jobs via admin API without worker restart', async () => {
    const handlers: Record<string, Array<(...args: any[]) => any>> = {};
    const processOnSpy = vi
      .spyOn(process, 'on')
      .mockImplementation(((event: string, handler: (...args: any[]) => any) => {
        handlers[event] ??= [];
        handlers[event].push(handler);
        return process;
      }) as any);
    const processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as any);

    const eventBus = createMockEventBus();

    const state = {
      treasuryAutopilot: false,
      aiAssistant: false,
      modifiedBy: 'system',
      updatedAt: new Date(),
    };

    const jobQueueInstance = {
      initialize: vi.fn(async () => undefined),
      getRegisteredJobs: vi.fn(() => ['maintenance:autopilot:evaluate']),
      isHealthy: vi.fn(() => true),
      getHealth: vi.fn(async () => ({ queues: {} })),
      addJob: vi.fn(async () => undefined),
      scheduleRecurring: vi.fn(async () => undefined),
      removeRecurring: vi.fn(async () => undefined),
      shutdown: vi.fn(async () => undefined),
    };

    const electrumInstance = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      isConnected: vi.fn(() => true),
      getHealthMetrics: vi.fn(() => ({
        totalSubscribedAddresses: 0,
        networks: {},
      })),
      reconcileSubscriptions: vi.fn(async () => undefined),
    };

    const featureFlagService = {
      initialize: vi.fn(async () => undefined),
      isEnabled: vi.fn(async (key: string) => {
        if (key === 'treasuryAutopilot') return state.treasuryAutopilot;
        if (key === 'aiAssistant') return state.aiAssistant;
        return false;
      }),
      getAllFlags: vi.fn(async () => [
        {
          key: 'treasuryAutopilot',
          enabled: state.treasuryAutopilot,
          description: 'Enable Treasury Autopilot consolidation jobs',
          category: 'general',
          source: 'database' as const,
          modifiedBy: state.modifiedBy,
          updatedAt: state.updatedAt,
          hasSideEffects: true,
          sideEffectDescription: 'Toggling this starts or stops background consolidation jobs without requiring a restart.',
        },
        {
          key: 'aiAssistant',
          enabled: state.aiAssistant,
          description: 'Enable AI-powered transaction analysis',
          category: 'general',
          source: 'database' as const,
          modifiedBy: state.modifiedBy,
          updatedAt: state.updatedAt,
          hasSideEffects: undefined,
          sideEffectDescription: null,
        },
      ]),
      getAuditLog: vi.fn(async () => []),
      getFlag: vi.fn(async (key: string) => {
        if (key === 'treasuryAutopilot') {
          return {
            key: 'treasuryAutopilot',
            enabled: state.treasuryAutopilot,
            description: 'Enable Treasury Autopilot consolidation jobs',
            category: 'general',
            source: 'database' as const,
            modifiedBy: state.modifiedBy,
            updatedAt: state.updatedAt,
            hasSideEffects: true,
            sideEffectDescription: 'Toggling this starts or stops background consolidation jobs without requiring a restart.',
          };
        }

        return {
          key: 'aiAssistant',
          enabled: state.aiAssistant,
          description: 'Enable AI-powered transaction analysis',
          category: 'general',
          source: 'database' as const,
          modifiedBy: state.modifiedBy,
          updatedAt: state.updatedAt,
          hasSideEffects: undefined,
          sideEffectDescription: null,
        };
      }),
      setFlag: vi.fn(async (key: string, enabled: boolean, options: { userId: string }) => {
        if (key !== 'treasuryAutopilot' && key !== 'aiAssistant') {
          throw new Error(`Unsupported key in test: ${key}`);
        }

        const previousValue = key === 'treasuryAutopilot' ? state.treasuryAutopilot : state.aiAssistant;
        if (previousValue === enabled) return;

        if (key === 'treasuryAutopilot') {
          state.treasuryAutopilot = enabled;
        } else {
          state.aiAssistant = enabled;
        }
        state.modifiedBy = options.userId;
        state.updatedAt = new Date();

        await eventBus.emit('system:featureFlag.changed', {
          key,
          enabled,
          previousValue,
          changedBy: options.userId,
        });
      }),
      resetToDefault: vi.fn(async () => undefined),
    };

    vi.doMock('../../../src/utils/tracing/otel', () => ({
      initializeOpenTelemetry: vi.fn(async () => undefined),
    }));

    vi.doMock('../../../src/config', () => ({
      getConfig: () => ({
        bitcoin: { network: 'testnet' },
        sync: {
          intervalMs: 5 * 60 * 1000,
          confirmationUpdateIntervalMs: 2 * 60 * 1000,
        },
        maintenance: {
          auditLogRetentionDays: 30,
          priceDataRetentionDays: 30,
          feeEstimateRetentionDays: 7,
        },
        features: {
          treasuryAutopilot: false,
        },
      }),
    }));

    vi.doMock('../../../src/utils/logger', () => ({
      createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    }));

    vi.doMock('../../../src/utils/errors', () => ({
      getErrorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
    }));

    vi.doMock('../../../src/models/prisma', () => ({
      connectWithRetry: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
    }));

    vi.doMock('../../../src/infrastructure', () => ({
      initializeRedis: vi.fn(async () => undefined),
      shutdownRedis: vi.fn(async () => undefined),
      isRedisConnected: vi.fn(() => true),
      shutdownDistributedLock: vi.fn(),
      getDistributedEventBus: () => eventBus,
    }));

    vi.doMock('../../../src/services/featureFlagService', () => ({
      featureFlagService,
    }));

    vi.doMock('../../../src/worker/workerJobQueue', () => ({
      WorkerJobQueue: class {
        constructor() {
          return jobQueueInstance;
        }
      },
    }));

    vi.doMock('../../../src/worker/electrumManager', () => ({
      ElectrumSubscriptionManager: class {
        constructor() {
          return electrumInstance;
        }
      },
    }));

    const healthServerHandle = { close: vi.fn(async () => undefined) };
    vi.doMock('../../../src/worker/healthServer', () => ({
      startHealthServer: vi.fn(() => healthServerHandle),
    }));

    vi.doMock('../../../src/worker/jobs', () => ({
      registerWorkerJobs: vi.fn(),
    }));

    vi.doMock('../../../src/middleware/auth', () => ({
      authenticate: (req: any, _res: any, next: () => void) => {
        req.user = { userId: 'admin-1', username: 'admin', isAdmin: true };
        next();
      },
      requireAdmin: (_req: any, _res: any, next: () => void) => next(),
    }));

    try {
      await import('../../../src/worker');
      const { default: featuresRouter } = await import('../../../src/api/admin/features');
      await vi.dynamicImportSettled();

      await waitFor(() => jobQueueInstance.initialize.mock.calls.length > 0);

      const app = express();
      app.use(express.json());
      app.use('/api/v1/admin/features', featuresRouter);

      jobQueueInstance.scheduleRecurring.mockClear();
      jobQueueInstance.removeRecurring.mockClear();

      const enableResponse = await request(app)
        .patch('/api/v1/admin/features/treasuryAutopilot')
        .send({ enabled: true, reason: 'integration test' });

      expect(enableResponse.status).toBe(200);
      expect(enableResponse.body.enabled).toBe(true);

      expect(jobQueueInstance.scheduleRecurring).toHaveBeenCalledWith(
        'maintenance',
        'autopilot:record-fees',
        {},
        '*/10 * * * *'
      );
      expect(jobQueueInstance.scheduleRecurring).toHaveBeenCalledWith(
        'maintenance',
        'autopilot:evaluate',
        {},
        '5/10 * * * *'
      );
      expect(jobQueueInstance.removeRecurring).not.toHaveBeenCalled();

      jobQueueInstance.scheduleRecurring.mockClear();
      jobQueueInstance.removeRecurring.mockClear();

      const disableResponse = await request(app)
        .patch('/api/v1/admin/features/treasuryAutopilot')
        .send({ enabled: false, reason: 'integration test' });

      expect(disableResponse.status).toBe(200);
      expect(disableResponse.body.enabled).toBe(false);

      expect(jobQueueInstance.removeRecurring).toHaveBeenCalledWith(
        'maintenance',
        'autopilot:record-fees',
        { purgeQueued: true }
      );
      expect(jobQueueInstance.removeRecurring).toHaveBeenCalledWith(
        'maintenance',
        'autopilot:evaluate',
        { purgeQueued: true }
      );

      jobQueueInstance.scheduleRecurring.mockClear();
      jobQueueInstance.removeRecurring.mockClear();

      const nonAutopilotResponse = await request(app)
        .patch('/api/v1/admin/features/aiAssistant')
        .send({ enabled: true, reason: 'integration test' });

      expect(nonAutopilotResponse.status).toBe(200);
      expect(nonAutopilotResponse.body.enabled).toBe(true);
      expect(jobQueueInstance.scheduleRecurring).not.toHaveBeenCalled();
      expect(jobQueueInstance.removeRecurring).not.toHaveBeenCalled();

      jobQueueInstance.scheduleRecurring.mockClear();
      jobQueueInstance.removeRecurring.mockClear();

      const unknownFlagResponse = await request(app)
        .patch('/api/v1/admin/features/nonExistent')
        .send({ enabled: true, reason: 'integration test' });

      expect(unknownFlagResponse.status).toBe(404);
      expect(jobQueueInstance.scheduleRecurring).not.toHaveBeenCalled();
      expect(jobQueueInstance.removeRecurring).not.toHaveBeenCalled();

      // Startup happened once; runtime toggle should not require process restart.
      expect(jobQueueInstance.initialize).toHaveBeenCalledTimes(1);
      expect(featureFlagService.initialize).toHaveBeenCalledTimes(1);
    } finally {
      await handlers.SIGTERM?.[0]?.();
      processOnSpy.mockRestore();
      processExitSpy.mockRestore();
    }
  });
});
