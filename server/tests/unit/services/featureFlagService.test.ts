/**
 * Feature Flag Service Tests
 *
 * Tests for the feature flag service including:
 * - Service initialization
 * - Flag state checking (isEnabled)
 * - Flag updates with audit logging
 * - Cache behavior
 * - Bulk operations
 */

import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

// Hoist all mocks
const { mockPrisma, mockCache, mockConfig, mockEventBus, mockRedis, mockLogger, runtimeState } = vi.hoisted(() => {
  const runtimeState = { generation: '0' };
  const mockPrisma = {
    featureFlag: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
    },
    featureFlagAudit: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    systemSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn((arg: any) => {
      // Support both batched transactions (array) and interactive transactions (callback)
      if (typeof arg === 'function') {
        return arg(mockPrisma);
      }
      return Promise.all(arg);
    }),
  };

  const mockCache = {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  };

  const mockEventBus = {
    on: vi.fn(),
    emit: vi.fn(),
    emitAsync: vi.fn(),
  };

  const mockRedis = {
    set: vi.fn(),
    keys: vi.fn(),
    mget: vi.fn(),
  };

  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const mockConfig = {
    features: {
      hardwareWalletSigning: true,
      qrCodeSigning: true,
      multisigWallets: true,
      batchSync: false,
      payjoinSupport: false,
      batchTransactions: true,
      rbfTransactions: true,
      priceAlerts: false,
      aiAssistant: false,
      sanctuaryConsole: false,
      telegramNotifications: false,
      websocketV2Events: true,
      treasuryAutopilot: false,
      treasuryIntelligence: false,
      experimental: {
        taprootAddresses: false,
        silentPayments: false,
      },
    },
  };

  return {
    mockPrisma,
    mockCache,
    mockConfig,
    mockEventBus,
    mockRedis,
    mockLogger,
    runtimeState,
  };
});

// Mock dependencies
vi.mock('../../../src/models/prisma', () => ({
  default: mockPrisma,
}));

vi.mock('../../../src/infrastructure', () => ({
  getDistributedCache: () => mockCache,
  getDistributedEventBus: () => mockEventBus,
  getRedisClient: () => mockRedis,
}));

vi.mock('../../../src/config', () => ({
  getConfig: () => mockConfig,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

// Import after mocks
import { featureFlagService } from '../../../src/services/featureFlagService';
import { FEATURE_RUNTIME_POLL_INTERVAL_MS } from '../../../src/services/featureFlagRuntime';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createEventSnapshot(generation: string, enabled: boolean) {
  return (featureFlagService as any).createSnapshot({
    generation,
    flags: [{ key: 'aiAssistant', enabled }],
  });
}

function makeSnapshotEvent(snapshot: any) {
  return {
    key: 'aiAssistant',
    enabled: snapshot.flags.aiAssistant,
    previousValue: !snapshot.flags.aiAssistant,
    changedBy: 'concurrent-admin',
    generation: snapshot.generation,
    digest: snapshot.digest,
    snapshot: snapshot.flags,
  };
}

function getFeatureFlagEventHandler() {
  return mockEventBus.on.mock.calls.find(
    (call: any) => call[0] === 'system:featureFlag.changed',
  )?.[1];
}

async function initializeWorker(reconcile = vi.fn(async () => {})) {
  featureFlagService.configureRuntime('worker', reconcile);
  mockPrisma.featureFlag.findMany.mockResolvedValue([]);
  await featureFlagService.initialize();
  reconcile.mockClear();

  const acknowledgements: string[] = [];
  const participant = {
    heartbeat: vi.fn(async () => {}),
    acknowledge: vi.fn(async (snapshot: { generation: string }) => {
      acknowledgements.push(snapshot.generation);
    }),
  };
  (featureFlagService as any).runtimeParticipant = participant;
  return { acknowledgements, participant, reconcile };
}

describe('Feature Flag Service', () => {
  afterEach(() => {
    featureFlagService.shutdownRuntime();
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset service state by clearing local cache and event listener flag
    (featureFlagService as any).localCache = new Map();
    (featureFlagService as any).initialized = false;
    (featureFlagService as any).eventListenerRegistered = false;
    (featureFlagService as any).snapshot = null;
    (featureFlagService as any).runtimeParticipant = null;
    (featureFlagService as any).runtimeRole = 'backend';
    (featureFlagService as any).reconcileAfterInstall = null;
    featureFlagService.shutdownRuntime();
    mockPrisma.featureFlag.createMany.mockResolvedValue({ count: 0 });
    runtimeState.generation = '0';
    mockPrisma.systemSetting.findUnique.mockImplementation(async () => ({
      value: runtimeState.generation,
    }));
    mockPrisma.systemSetting.upsert.mockResolvedValue(undefined);
    mockPrisma.systemSetting.update.mockImplementation(async ({ data }: any) => {
      runtimeState.generation = data.value;
    });
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.keys.mockResolvedValue([]);
    mockRedis.mget.mockResolvedValue([]);
    mockEventBus.emitAsync.mockResolvedValue(undefined);
    mockCache.get.mockResolvedValue(null);
    mockCache.set.mockResolvedValue(undefined);
    mockCache.delete.mockResolvedValue(undefined);
  });

  describe('initialize', () => {
    it('should sync environment flags to database', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      mockPrisma.featureFlag.create.mockResolvedValue({ id: '1', key: 'test', enabled: true });
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);

      await featureFlagService.initialize();

      expect(mockPrisma.featureFlag.findMany).toHaveBeenCalled();
      expect(mockPrisma.featureFlag.createMany).toHaveBeenCalled();
    });

    it('should not recreate existing flags', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue({
        id: '1',
        key: 'hardwareWalletSigning',
        enabled: true,
      });
      mockPrisma.featureFlag.findMany.mockResolvedValue([
        { key: 'hardwareWalletSigning', enabled: true },
      ]);

      await featureFlagService.initialize();

      // Should not create since flag exists
      const createCalls = mockPrisma.featureFlag.create.mock.calls.filter(
        (call: any) => call[0]?.data?.key === 'hardwareWalletSigning'
      );
      expect(createCalls.length).toBe(0);
    });

    it('should load flags into local cache after init', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      mockPrisma.featureFlag.create.mockResolvedValue({ id: '1', key: 'test', enabled: true });
      mockPrisma.featureFlag.findMany.mockResolvedValue([
        { key: 'hardwareWalletSigning', enabled: true },
        { key: 'aiAssistant', enabled: false },
      ]);

      await featureFlagService.initialize();

      // Local cache should be populated
      expect((featureFlagService as any).localCache.get('hardwareWalletSigning')).toBe(true);
      expect((featureFlagService as any).localCache.get('aiAssistant')).toBe(false);
    });

    it('should only initialize once', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);

      await featureFlagService.initialize();
      const firstCallCount = mockPrisma.featureFlag.findMany.mock.calls.length;

      await featureFlagService.initialize();
      const secondCallCount = mockPrisma.featureFlag.findMany.mock.calls.length;

      expect(secondCallCount).toBe(firstCallCount); // No additional calls
    });

    it('should fail readiness when durable initialization fails', async () => {
      mockPrisma.featureFlag.findMany.mockRejectedValue(new Error('DB error'));

      await expect(featureFlagService.initialize()).rejects.toThrow('DB error');
      expect((featureFlagService as any).initialized).toBe(false);
    });

    it('should reject initialization when the versioned cache cannot be installed', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValue([
        { key: 'aiAssistant', enabled: true },
      ]);
      mockCache.set.mockRejectedValue(new Error('cache unavailable'));

      await expect(featureFlagService.initialize()).rejects.toThrow('cache unavailable');
    });

    it('should include treasuryAutopilot in env sync', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      mockPrisma.featureFlag.create.mockResolvedValue({ id: '1', key: 'test', enabled: false });
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);

      await featureFlagService.initialize();

      const defaults = mockPrisma.featureFlag.createMany.mock.calls[0][0].data;
      const treasury = defaults.find((item: any) => item.key === 'treasuryAutopilot');
      expect(treasury?.description).toBe('Enable Treasury Autopilot consolidation jobs');
    });

    it('should subscribe to featureFlag.changed event during initialization', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);

      await featureFlagService.initialize();

      expect(mockEventBus.on).toHaveBeenCalledWith(
        'system:featureFlag.changed',
        expect.any(Function)
      );
    });

    it('should register event listener only once (idempotent)', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);

      await featureFlagService.initialize();
      (featureFlagService as any).initialized = false; // Allow re-init
      await featureFlagService.initialize();

      // on() should only have been called once for featureFlag.changed
      const featureFlagCalls = mockEventBus.on.mock.calls.filter(
        (call: any) => call[0] === 'system:featureFlag.changed'
      );
      expect(featureFlagCalls).toHaveLength(1);
    });

    it('should update local cache when receiving featureFlag.changed event', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);

      await featureFlagService.initialize();

      // Get the event handler that was registered
      const handler = mockEventBus.on.mock.calls.find(
        (call: any) => call[0] === 'system:featureFlag.changed'
      )?.[1];
      expect(handler).toBeDefined();

      // Simulate receiving an event
      const flags = { aiAssistant: true };
      await handler({
        key: 'aiAssistant',
        enabled: true,
        previousValue: false,
        changedBy: 'other-admin',
        generation: '2',
        digest: createHash('sha256').update(JSON.stringify(flags)).digest('hex'),
        snapshot: flags,
      });

      expect((featureFlagService as any).localCache.get('aiAssistant')).toBe(true);
    });

    it('uses generic metadata when initializing unknown flag keys', async () => {
      const getEnvironmentFlagsSpy = vi
        .spyOn(featureFlagService as any, 'getEnvironmentFlags')
        .mockReturnValueOnce({ 'custom.experimentalFlag': true });
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      mockPrisma.featureFlag.create.mockResolvedValue({});
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);

      await featureFlagService.initialize();

      expect(mockPrisma.featureFlag.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({
          key: 'custom.experimentalFlag',
          description: null,
          category: 'general',
        })],
        skipDuplicates: true,
      });
      getEnvironmentFlagsSpy.mockRestore();
    });

    it('acknowledges a worker snapshot only after schedule reconciliation', async () => {
      const order: string[] = [];
      featureFlagService.configureRuntime('worker', async () => {
        order.push('schedules-reconciled');
      });
      mockRedis.set.mockImplementation(async (key: string) => {
        if (key.startsWith('feature-runtime:ack:')) order.push('acknowledged');
        return 'OK';
      });
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);

      await featureFlagService.initialize();

      expect(order).toEqual(['schedules-reconciled', 'acknowledged']);
    });

    it('does not acknowledge a worker snapshot when schedule reconciliation fails', async () => {
      featureFlagService.configureRuntime('worker', async () => {
        throw new Error('required schedule unavailable');
      });
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);

      await expect(featureFlagService.initialize()).rejects.toThrow(
        'required schedule unavailable',
      );

      const acknowledged = mockRedis.set.mock.calls.some(([key]) =>
        String(key).startsWith('feature-runtime:ack:'),
      );
      expect(acknowledged).toBe(false);
      expect((featureFlagService as any).initialized).toBe(false);
    });

    it('polling installs a newer durable generation after a missed event', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);
      await featureFlagService.initialize();
      runtimeState.generation = '2';
      mockPrisma.featureFlag.findMany.mockResolvedValue([
        { key: 'aiAssistant', enabled: true },
      ]);

      await (featureFlagService as any).pollRuntimeState();

      expect((featureFlagService as any).localCache.get('aiAssistant')).toBe(true);
      expect((featureFlagService as any).snapshot.generation).toBe('2');
    });
  });

  describe('runtime state convergence', () => {
    const state = {
      generation: '3',
      flags: [{ key: 'aiAssistant', enabled: true }],
    } as any;

    it('does not let a delayed older event overwrite a newer in-flight install', async () => {
      const { acknowledgements, reconcile } = await initializeWorker();
      const cacheStarted = createDeferred<void>();
      const releaseCache = createDeferred<void>();
      mockCache.set.mockClear();
      mockCache.set.mockImplementation(async (_key: string, snapshot: any) => {
        if (snapshot.generation === '2') {
          cacheStarted.resolve(undefined);
          await releaseCache.promise;
        }
      });
      const handler = getFeatureFlagEventHandler();

      handler(makeSnapshotEvent(createEventSnapshot('2', false)));
      await cacheStarted.promise;
      handler(makeSnapshotEvent(createEventSnapshot('1', true)));
      await Promise.resolve();

      expect(mockCache.set).toHaveBeenCalledTimes(1);
      expect((featureFlagService as any).localCache.get('aiAssistant')).toBe(false);

      releaseCache.resolve(undefined);
      await vi.waitFor(() => expect(acknowledgements).toHaveLength(2));

      expect((featureFlagService as any).snapshot.generation).toBe('2');
      expect((featureFlagService as any).localCache.get('aiAssistant')).toBe(false);
      expect(reconcile).toHaveBeenCalledOnce();
      expect(acknowledgements).not.toContain('1');
    });

    it('does not reinstall or reconcile a matching generation queued behind its first install', async () => {
      const { acknowledgements, reconcile } = await initializeWorker();
      const cacheStarted = createDeferred<void>();
      const releaseCache = createDeferred<void>();
      let firstGenerationTwo = true;
      mockCache.set.mockClear();
      mockCache.set.mockImplementation(async (_key: string, snapshot: any) => {
        if (snapshot.generation === '2' && firstGenerationTwo) {
          firstGenerationTwo = false;
          cacheStarted.resolve(undefined);
          await releaseCache.promise;
        }
      });
      const handler = getFeatureFlagEventHandler();
      const event = makeSnapshotEvent(createEventSnapshot('2', true));

      handler(event);
      await cacheStarted.promise;
      handler(event);
      await Promise.resolve();
      expect(mockCache.set).toHaveBeenCalledTimes(1);

      releaseCache.resolve(undefined);
      await vi.waitFor(() => expect(acknowledgements).toHaveLength(2));

      expect(mockCache.set).toHaveBeenCalledTimes(1);
      expect(reconcile).toHaveBeenCalledOnce();
      expect(acknowledgements).toEqual(['2', '2']);
    });

    it('applies multiple queued newer snapshots in order when the oldest starts first', async () => {
      const { acknowledgements, reconcile } = await initializeWorker();
      const cacheStarted = createDeferred<void>();
      const releaseCache = createDeferred<void>();
      mockCache.set.mockClear();
      mockCache.set.mockImplementation(async (_key: string, snapshot: any) => {
        if (snapshot.generation === '2') {
          cacheStarted.resolve(undefined);
          await releaseCache.promise;
        }
      });
      const handler = getFeatureFlagEventHandler();

      handler(makeSnapshotEvent(createEventSnapshot('2', true)));
      await cacheStarted.promise;
      handler(makeSnapshotEvent(createEventSnapshot('3', false)));
      handler(makeSnapshotEvent(createEventSnapshot('4', true)));
      await Promise.resolve();
      expect(mockCache.set).toHaveBeenCalledTimes(1);

      releaseCache.resolve(undefined);
      await vi.waitFor(() => expect(acknowledgements).toHaveLength(3));

      expect(acknowledgements).toEqual(['2', '3', '4']);
      expect((featureFlagService as any).snapshot.generation).toBe('4');
      expect((featureFlagService as any).localCache.get('aiAssistant')).toBe(true);
      expect(reconcile).toHaveBeenCalledTimes(3);
    });

    it('rejects a conflicting same-generation event after the prior queued install commits', async () => {
      const { acknowledgements, reconcile } = await initializeWorker();
      const cacheStarted = createDeferred<void>();
      const releaseCache = createDeferred<void>();
      let firstGenerationTwo = true;
      mockCache.set.mockClear();
      mockCache.set.mockImplementation(async (_key: string, snapshot: any) => {
        if (snapshot.generation === '2' && firstGenerationTwo) {
          firstGenerationTwo = false;
          cacheStarted.resolve(undefined);
          await releaseCache.promise;
        }
      });
      const handler = getFeatureFlagEventHandler();

      handler(makeSnapshotEvent(createEventSnapshot('2', false)));
      await cacheStarted.promise;
      handler(makeSnapshotEvent(createEventSnapshot('2', true)));
      await Promise.resolve();
      expect(mockCache.set).toHaveBeenCalledTimes(1);

      releaseCache.resolve(undefined);
      await vi.waitFor(() => {
        expect(mockLogger.error).toHaveBeenCalledWith(
          'Failed to install feature runtime event snapshot',
          { error: 'Feature runtime digest mismatch at generation 2' },
        );
      });

      expect((featureFlagService as any).snapshot.flags.aiAssistant).toBe(false);
      expect(reconcile).toHaveBeenCalledOnce();
      expect(acknowledgements).toEqual(['2']);
    });

    it('restores the previous local snapshot after reconciliation fails and the next poll recovers', async () => {
      const { acknowledgements } = await initializeWorker();
      const reconcile = vi.fn()
        .mockRejectedValueOnce(new Error('schedule reconcile failed'))
        .mockResolvedValue(undefined);
      (featureFlagService as any).reconcileAfterInstall = reconcile;
      const previousGeneration = (featureFlagService as any).snapshot.generation;
      runtimeState.generation = '2';
      mockPrisma.featureFlag.findMany.mockResolvedValue([
        { key: 'aiAssistant', enabled: true },
      ]);

      await expect((featureFlagService as any).pollRuntimeState())
        .rejects.toThrow('schedule reconcile failed');

      expect((featureFlagService as any).snapshot.generation).toBe(previousGeneration);
      expect((featureFlagService as any).localCache.get('aiAssistant')).toBe(false);
      expect(acknowledgements).not.toContain('2');

      await (featureFlagService as any).pollRuntimeState();

      expect((featureFlagService as any).snapshot.generation).toBe('2');
      expect((featureFlagService as any).localCache.get('aiAssistant')).toBe(true);
      expect(acknowledgements).toEqual(['2']);
      expect(reconcile).toHaveBeenCalledTimes(2);
    });

    it('keeps the queue usable after cache publication fails', async () => {
      const { acknowledgements } = await initializeWorker();
      const previousGeneration = (featureFlagService as any).snapshot.generation;
      runtimeState.generation = '2';
      mockPrisma.featureFlag.findMany.mockResolvedValue([
        { key: 'aiAssistant', enabled: true },
      ]);
      mockCache.set.mockRejectedValueOnce(new Error('cache publication failed'));

      await expect((featureFlagService as any).pollRuntimeState())
        .rejects.toThrow('cache publication failed');

      expect((featureFlagService as any).snapshot.generation).toBe(previousGeneration);
      expect((featureFlagService as any).localCache.get('aiAssistant')).toBe(false);
      expect(acknowledgements).not.toContain('2');

      await (featureFlagService as any).pollRuntimeState();

      expect((featureFlagService as any).snapshot.generation).toBe('2');
      expect((featureFlagService as any).localCache.get('aiAssistant')).toBe(true);
      expect(acknowledgements).toEqual(['2']);
    });

    it('skips timer polls during a held install and reads the latest state next tick', async () => {
      vi.useFakeTimers();
      const reconcileStarted = createDeferred<void>();
      const releaseReconcile = createDeferred<void>();
      let shouldHoldReconcile = false;
      const reconcile = vi.fn(async () => {
        if (!shouldHoldReconcile) return;
        shouldHoldReconcile = false;
        reconcileStarted.resolve(undefined);
        await releaseReconcile.promise;
      });
      const { participant } = await initializeWorker(reconcile);
      const generationTwoAcknowledged = createDeferred<void>();
      participant.acknowledge.mockImplementation(async (snapshot) => {
        if (snapshot.generation === '2') generationTwoAcknowledged.resolve(undefined);
      });
      mockPrisma.featureFlag.findMany.mockClear();
      mockPrisma.featureFlag.findMany.mockResolvedValue([
        { key: 'aiAssistant', enabled: true },
      ]);
      runtimeState.generation = '2';
      shouldHoldReconcile = true;

      try {
        await vi.advanceTimersByTimeAsync(FEATURE_RUNTIME_POLL_INTERVAL_MS);
        await reconcileStarted.promise;
        await vi.advanceTimersByTimeAsync(FEATURE_RUNTIME_POLL_INTERVAL_MS * 3);

        expect(mockPrisma.featureFlag.findMany).toHaveBeenCalledTimes(1);

        runtimeState.generation = '3';
        mockPrisma.featureFlag.findMany.mockResolvedValue([
          { key: 'aiAssistant', enabled: false },
        ]);
        releaseReconcile.resolve(undefined);
        await generationTwoAcknowledged.promise;
        await vi.advanceTimersByTimeAsync(FEATURE_RUNTIME_POLL_INTERVAL_MS);

        expect(mockPrisma.featureFlag.findMany).toHaveBeenCalledTimes(2);
        expect((featureFlagService as any).snapshot).toEqual(expect.objectContaining({
          generation: '3',
          flags: expect.objectContaining({ aiAssistant: false }),
        }));
      } finally {
        featureFlagService.shutdownRuntime();
        releaseReconcile.resolve(undefined);
      }
    });

    it('releases timer poll admission after a rejected install so the next tick recovers', async () => {
      vi.useFakeTimers();
      const reconcileStarted = createDeferred<void>();
      const rejectReconcile = createDeferred<void>();
      const pollFailureLogged = createDeferred<void>();
      let shouldRejectReconcile = false;
      const reconcile = vi.fn(async () => {
        if (!shouldRejectReconcile) return;
        shouldRejectReconcile = false;
        reconcileStarted.resolve(undefined);
        await rejectReconcile.promise;
        throw new Error('schedule reconcile failed');
      });
      const { participant } = await initializeWorker(reconcile);
      const initialGeneration = (featureFlagService as any).snapshot.generation;
      const generationThreeAcknowledged = createDeferred<void>();
      participant.acknowledge.mockImplementation(async (snapshot) => {
        if (snapshot.generation === '3') generationThreeAcknowledged.resolve(undefined);
      });
      mockLogger.error.mockImplementation((message: string) => {
        if (message === 'Feature runtime polling failed') pollFailureLogged.resolve(undefined);
      });
      mockPrisma.featureFlag.findMany.mockClear();
      mockPrisma.featureFlag.findMany.mockResolvedValue([
        { key: 'aiAssistant', enabled: true },
      ]);
      runtimeState.generation = '2';
      shouldRejectReconcile = true;

      try {
        await vi.advanceTimersByTimeAsync(FEATURE_RUNTIME_POLL_INTERVAL_MS);
        await reconcileStarted.promise;
        await vi.advanceTimersByTimeAsync(FEATURE_RUNTIME_POLL_INTERVAL_MS * 3);

        expect(mockPrisma.featureFlag.findMany).toHaveBeenCalledTimes(1);

        runtimeState.generation = '3';
        mockPrisma.featureFlag.findMany.mockResolvedValue([
          { key: 'aiAssistant', enabled: false },
        ]);
        rejectReconcile.resolve(undefined);
        await pollFailureLogged.promise;
        expect((featureFlagService as any).snapshot.generation).toBe(initialGeneration);
        expect((featureFlagService as any).localCache.get('aiAssistant')).toBe(false);

        await vi.advanceTimersByTimeAsync(FEATURE_RUNTIME_POLL_INTERVAL_MS);
        await generationThreeAcknowledged.promise;

        expect(mockPrisma.featureFlag.findMany).toHaveBeenCalledTimes(2);
        expect((featureFlagService as any).snapshot).toEqual(expect.objectContaining({
          generation: '3',
          flags: expect.objectContaining({ aiAssistant: false }),
        }));
        expect(participant.acknowledge.mock.calls.map(([snapshot]) => snapshot.generation))
          .not.toContain('2');
      } finally {
        featureFlagService.shutdownRuntime();
        rejectReconcile.resolve(undefined);
      }
    });

    it('lets worker reconciliation synchronously read the candidate flags', async () => {
      await initializeWorker();
      const observed: boolean[] = [];
      (featureFlagService as any).reconcileAfterInstall = async () => {
        observed.push(await featureFlagService.isEnabled('aiAssistant'));
      };
      runtimeState.generation = '2';
      mockPrisma.featureFlag.findMany.mockResolvedValue([
        { key: 'aiAssistant', enabled: true },
      ]);

      await (featureFlagService as any).pollRuntimeState();

      expect(observed).toEqual([true]);
      expect((featureFlagService as any).snapshot.generation).toBe('2');
    });

    it('routes unchanged poll snapshots through serialized admission', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);
      await featureFlagService.initialize();
      const currentGeneration = (featureFlagService as any).snapshot.generation;
      runtimeState.generation = currentGeneration;
      const install = vi.spyOn(featureFlagService as any, 'installStateStrict');

      await (featureFlagService as any).pollRuntimeState();

      expect(install).toHaveBeenCalledOnce();
      expect((install.mock.calls[0] as any)[0].generation).toBe(currentGeneration);
    });

    it('does not let an unchanged poll acknowledgement land after a newer event acknowledgement', async () => {
      const { participant } = await initializeWorker();
      const handler = getFeatureFlagEventHandler();
      const generationTwo = createEventSnapshot('2', true);
      handler(makeSnapshotEvent(generationTwo));
      await vi.waitFor(() => expect(participant.acknowledge).toHaveBeenCalledWith(
        expect.objectContaining({ generation: '2' }),
      ));

      runtimeState.generation = '2';
      mockPrisma.featureFlag.findMany.mockResolvedValue([
        { key: 'aiAssistant', enabled: true },
      ]);
      const acknowledgements: string[] = [];
      const ackStarted = createDeferred<void>();
      const releaseAck = createDeferred<void>();
      let blockNextAck = true;
      participant.acknowledge.mockImplementation(async (snapshot: { generation: string }) => {
        if (snapshot.generation === '2' && blockNextAck) {
          blockNextAck = false;
          ackStarted.resolve(undefined);
          await releaseAck.promise;
        }
        acknowledgements.push(snapshot.generation);
      });
      const poll = (featureFlagService as any).pollRuntimeState();
      await ackStarted.promise;

      handler(makeSnapshotEvent(createEventSnapshot('3', false)));
      await Promise.resolve();
      expect(acknowledgements).toEqual([]);
      expect((featureFlagService as any).snapshot.generation).toBe('2');

      releaseAck.resolve(undefined);
      await poll;
      await vi.waitFor(() => expect(acknowledgements).toHaveLength(2));

      expect(acknowledgements).toEqual(['2', '3']);
      expect((featureFlagService as any).snapshot.generation).toBe('3');
    });

    it('defaults omitted runtime reconciliation to no callback', () => {
      featureFlagService.configureRuntime('backend');

      expect((featureFlagService as any).reconcileAfterInstall).toBeNull();
    });

    it('rejects runtime reconfiguration after initialization', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);
      await featureFlagService.initialize();

      expect(() => featureFlagService.configureRuntime('worker'))
        .toThrow('Feature runtime must be configured before initialization');
    });

    it('retains a newer local snapshot instead of applying a stale durable state', async () => {
      const newer = {
        generation: '4',
        digest: 'newer-snapshot',
        flags: { aiAssistant: false },
      };
      (featureFlagService as any).snapshot = newer;

      await expect((featureFlagService as any).installStateStrict(state)).resolves.toBe(newer);
      expect(mockCache.set).not.toHaveBeenCalled();
    });

    it('rejects conflicting or duplicate payloads for an already installed generation', async () => {
      const snapshot = (featureFlagService as any).createSnapshot(state);
      (featureFlagService as any).snapshot = { ...snapshot, digest: 'conflicting-digest' };

      await expect((featureFlagService as any).installStateStrict(state))
        .rejects.toThrow('Feature runtime digest mismatch at generation 3');

      (featureFlagService as any).snapshot = snapshot;
      await expect((featureFlagService as any).installStateStrict(state)).resolves.toBe(snapshot);
      expect(mockCache.set).not.toHaveBeenCalled();
    });

    it('requires initialization before restore reconciliation', async () => {
      await expect(featureFlagService.reconcileAfterRestore(state))
        .rejects.toThrow('Feature runtime is not initialized');
    });

    it('installs, broadcasts, and confirms a restored snapshot against the frozen roster', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);
      mockRedis.keys.mockResolvedValue([]);
      await featureFlagService.initialize();

      await featureFlagService.reconcileAfterRestore(state);

      expect((featureFlagService as any).snapshot).toEqual(expect.objectContaining({
        generation: '3',
        flags: expect.objectContaining({ aiAssistant: true }),
      }));
      expect(mockEventBus.emitAsync).toHaveBeenLastCalledWith(
        'system:featureFlag.changed',
        expect.objectContaining({
          key: '*',
          changedBy: 'backup-restore',
          generation: '3',
        }),
      );
    });

    it('ignores snapshot-free events and logs malformed event snapshots', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);
      await featureFlagService.initialize();
      const handler = mockEventBus.on.mock.calls.find(
        (call: any) => call[0] === 'system:featureFlag.changed',
      )?.[1];

      handler({});
      handler({
        generation: '9',
        digest: 'invalid-digest',
        snapshot: { aiAssistant: true },
      });

      await vi.waitFor(() => {
        expect(mockLogger.error).toHaveBeenCalledWith(
          'Failed to install feature runtime event snapshot',
          { error: 'Feature runtime snapshot digest is invalid' },
        );
      });
    });

    it('logs heartbeat and polling failures raised from the runtime timers', async () => {
      vi.useFakeTimers();
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);
      await featureFlagService.initialize();
      (featureFlagService as any).runtimeParticipant = {
        heartbeat: vi.fn().mockRejectedValue(new Error('heartbeat unavailable')),
        acknowledge: vi.fn(),
      };
      mockPrisma.featureFlag.findMany.mockRejectedValue(new Error('poll unavailable'));

      await vi.advanceTimersByTimeAsync(5_000);

      expect(mockLogger.error).toHaveBeenCalledWith('Feature runtime heartbeat failed', {
        error: 'heartbeat unavailable',
      });
      expect(mockLogger.error).toHaveBeenCalledWith('Feature runtime polling failed', {
        error: 'poll unavailable',
      });
    });

    it('polls and installs a newer snapshot even without a received event', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);
      await featureFlagService.initialize();
      runtimeState.generation = '7';
      mockPrisma.featureFlag.findMany.mockResolvedValue([{ key: 'aiAssistant', enabled: true }]);

      await (featureFlagService as any).pollRuntimeState();

      expect((featureFlagService as any).snapshot).toEqual(expect.objectContaining({
        generation: '7',
        flags: expect.objectContaining({ aiAssistant: true }),
      }));
    });

    it('installs a poll result when no snapshot has been received yet', async () => {
      runtimeState.generation = '5';
      mockPrisma.featureFlag.findMany.mockResolvedValue([{ key: 'aiAssistant', enabled: true }]);

      await (featureFlagService as any).pollRuntimeState();

      expect((featureFlagService as any).snapshot).toEqual(expect.objectContaining({
        generation: '5',
      }));
    });

    it('acknowledges an unchanged snapshot without reinstalling it during polling', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);
      await featureFlagService.initialize();
      const participant = {
        heartbeat: vi.fn().mockResolvedValue(undefined),
        acknowledge: vi.fn().mockResolvedValue(undefined),
      };
      (featureFlagService as any).runtimeParticipant = participant;
      const writesBeforePoll = mockCache.set.mock.calls.length;

      await (featureFlagService as any).pollRuntimeState();

      expect(mockCache.set).toHaveBeenCalledTimes(writesBeforePoll);
      expect(participant.heartbeat).toHaveBeenCalledOnce();
      expect(participant.acknowledge).toHaveBeenCalledWith((featureFlagService as any).snapshot);
    });
  });

  describe('isEnabled', () => {
    beforeEach(async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);
      await featureFlagService.initialize();
    });

    it('should return value from local cache if available', async () => {
      (featureFlagService as any).localCache.set('hardwareWalletSigning', true);

      const result = await featureFlagService.isEnabled('hardwareWalletSigning');

      expect(result).toBe(true);
      expect(mockCache.get).not.toHaveBeenCalled(); // Didn't need distributed cache
    });

    it('should check distributed cache if local cache misses', async () => {
      (featureFlagService as any).localCache.delete('hardwareWalletSigning');
      const flags = { hardwareWalletSigning: true };
      mockCache.get.mockResolvedValue({
        generation: '2',
        digest: createHash('sha256').update(JSON.stringify(flags)).digest('hex'),
        flags,
      });

      const result = await featureFlagService.isEnabled('hardwareWalletSigning');

      expect(result).toBe(true);
      expect(mockCache.get).toHaveBeenCalled();
    });

    it('should query database if cache misses', async () => {
      (featureFlagService as any).localCache.delete('aiAssistant');
      mockCache.get.mockResolvedValue(null);
      mockPrisma.featureFlag.findUnique.mockResolvedValue({
        key: 'aiAssistant',
        enabled: true,
      });

      const result = await featureFlagService.isEnabled('aiAssistant');

      expect(result).toBe(true);
      expect(mockPrisma.featureFlag.findUnique).toHaveBeenCalledWith({
        where: { key: 'aiAssistant' },
      });
    });

    it('should fall back to environment config if database misses', async () => {
      mockCache.get.mockResolvedValue(null);
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);

      const result = await featureFlagService.isEnabled('hardwareWalletSigning');

      // Should return env default
      expect(result).toBe(true);
    });

    it('should handle experimental flags in environment fallback', async () => {
      mockCache.get.mockResolvedValue(null);
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);

      const result = await featureFlagService.isEnabled('experimental.taprootAddresses');

      expect(result).toBe(false); // From mockConfig
    });

    it('returns false for unknown experimental key during environment fallback', async () => {
      mockCache.get.mockResolvedValue(null);
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);

      const result = await featureFlagService.isEnabled('experimental.unknownFlag' as any);

      expect(result).toBe(false);
    });

    it('returns false for unknown top-level key during environment fallback', async () => {
      mockCache.get.mockResolvedValue(null);
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);

      const result = await featureFlagService.isEnabled('unknownTopLevelFlag' as any);

      expect(result).toBe(false);
    });

    it('falls back to environment config when distributed cache and database lookups fail', async () => {
      (featureFlagService as any).localCache.delete('hardwareWalletSigning');
      mockCache.get.mockRejectedValueOnce(new Error('cache unavailable'));
      mockPrisma.featureFlag.findUnique.mockRejectedValueOnce(new Error('database unavailable'));

      const result = await featureFlagService.isEnabled('hardwareWalletSigning');

      expect(result).toBe(true);
      expect(mockPrisma.featureFlag.findUnique).toHaveBeenCalledWith({
        where: { key: 'hardwareWalletSigning' },
      });
    });
  });

  describe('setFlag', () => {
    const mockExistingFlag = {
      id: 'flag-1',
      key: 'aiAssistant',
      enabled: false,
      description: 'AI assistant feature',
      category: 'general',
      modifiedBy: 'system',
      updatedAt: new Date(),
    };

    beforeEach(async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);
      await featureFlagService.initialize();
    });

    it('should update flag and create audit entry', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(mockExistingFlag);
      mockPrisma.featureFlag.update.mockResolvedValue({ ...mockExistingFlag, enabled: true });
      mockPrisma.featureFlagAudit.create.mockResolvedValue({});
      mockPrisma.featureFlag.findMany.mockResolvedValue([{ ...mockExistingFlag, enabled: true }]);

      await featureFlagService.setFlag('aiAssistant', true, {
        userId: 'admin-123',
        reason: 'Enable for testing',
        ipAddress: '192.168.1.1',
      });

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should throw error if flag does not exist', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);

      await expect(
        featureFlagService.setFlag('nonExistent' as any, true, {
          userId: 'admin-123',
        })
      ).rejects.toThrow("Feature flag 'nonExistent' does not exist");
    });

    it('should skip update if value unchanged', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue({
        ...mockExistingFlag,
        enabled: true, // Already true
      });

      await featureFlagService.setFlag('aiAssistant', true, {
        userId: 'admin-123',
      });

      // Transaction is called (for the read) but update/audit should not be called
      expect(mockPrisma.featureFlag.update).not.toHaveBeenCalled();
      expect(mockPrisma.featureFlagAudit.create).not.toHaveBeenCalled();
    });

    it('should invalidate cache after update', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(mockExistingFlag);
      mockPrisma.featureFlag.update.mockResolvedValue({ ...mockExistingFlag, enabled: true });
      mockPrisma.featureFlagAudit.create.mockResolvedValue({});
      mockPrisma.featureFlag.findMany.mockResolvedValue([{ ...mockExistingFlag, enabled: true }]);

      await featureFlagService.setFlag('aiAssistant', true, {
        userId: 'admin-123',
      });

      expect(mockCache.set).toHaveBeenCalled();
      expect((featureFlagService as any).localCache.get('aiAssistant')).toBe(true);
    });

    it('should emit system:featureFlag.changed event on update', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(mockExistingFlag);
      mockPrisma.featureFlag.update.mockResolvedValue({ ...mockExistingFlag, enabled: true });
      mockPrisma.featureFlagAudit.create.mockResolvedValue({});
      mockPrisma.featureFlag.findMany.mockResolvedValue([{ ...mockExistingFlag, enabled: true }]);

      await featureFlagService.setFlag('aiAssistant', true, {
        userId: 'admin-123',
      });

      expect(mockEventBus.emitAsync).toHaveBeenCalledWith('system:featureFlag.changed', expect.objectContaining({
        key: 'aiAssistant',
        enabled: true,
        previousValue: false,
        changedBy: 'admin-123',
        generation: '2',
        digest: expect.any(String),
        snapshot: expect.objectContaining({ aiAssistant: true }),
      }));
    });

    it('should not emit event when value is unchanged', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue({
        ...mockExistingFlag,
        enabled: true,
      });

      await featureFlagService.setFlag('aiAssistant', true, {
        userId: 'admin-123',
      });

      expect(mockEventBus.emitAsync).not.toHaveBeenCalled();
    });
  });

  describe('getAllFlags', () => {
    it('should return all flags with metadata', async () => {
      const mockFlags = [
        {
          key: 'hardwareWalletSigning',
          enabled: true,
          description: 'Hardware wallet support',
          category: 'general',
          modifiedBy: 'admin',
          updatedAt: new Date(),
        },
        {
          key: 'aiAssistant',
          enabled: false,
          description: 'AI assistant',
          category: 'general',
          modifiedBy: 'system',
          updatedAt: new Date(),
        },
      ];
      mockPrisma.featureFlag.findMany.mockResolvedValue(mockFlags);

      const result = await featureFlagService.getAllFlags();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({
          key: 'hardwareWalletSigning',
          enabled: true,
          source: 'database',
        })
      );
    });

    it('should order flags by category and key', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);

      await featureFlagService.getAllFlags();

      expect(mockPrisma.featureFlag.findMany).toHaveBeenCalledWith({
        orderBy: [{ category: 'asc' }, { key: 'asc' }],
      });
    });

    it('includes side-effect metadata for flags that have runtime effects', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValue([
        {
          key: 'treasuryAutopilot',
          enabled: true,
          description: 'Enable Treasury Autopilot consolidation jobs',
          category: 'general',
          modifiedBy: 'admin',
          updatedAt: new Date(),
        },
      ]);

      const [flag] = await featureFlagService.getAllFlags();

      expect(flag).toEqual(
        expect.objectContaining({
          key: 'treasuryAutopilot',
          hasSideEffects: true,
          sideEffectDescription: expect.stringContaining('starts or stops background consolidation jobs'),
        })
      );
    });

    it('keeps side-effect metadata empty for normal flags', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValue([
        {
          key: 'aiAssistant',
          enabled: true,
          description: 'Enable AI-powered transaction analysis',
          category: 'general',
          modifiedBy: 'admin',
          updatedAt: new Date(),
        },
      ]);

      const [flag] = await featureFlagService.getAllFlags();

      expect(flag).toEqual(
        expect.objectContaining({
          key: 'aiAssistant',
          hasSideEffects: undefined,
          sideEffectDescription: null,
        })
      );
    });
  });

  describe('getAuditLog', () => {
    it('should return audit entries for specific flag', async () => {
      const mockAuditEntries = [
        {
          id: 'audit-1',
          key: 'aiAssistant',
          previousValue: false,
          newValue: true,
          changedBy: 'admin-123',
          reason: 'Enable for testing',
          ipAddress: '192.168.1.1',
          createdAt: new Date(),
        },
      ];
      mockPrisma.featureFlagAudit.findMany.mockResolvedValue(mockAuditEntries);

      const result = await featureFlagService.getAuditLog('aiAssistant');

      expect(mockPrisma.featureFlagAudit.findMany).toHaveBeenCalledWith({
        where: { key: 'aiAssistant' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('aiAssistant');
    });

    it('should return all audit entries when no key specified', async () => {
      mockPrisma.featureFlagAudit.findMany.mockResolvedValue([]);

      await featureFlagService.getAuditLog();

      expect(mockPrisma.featureFlagAudit.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('should respect limit parameter', async () => {
      mockPrisma.featureFlagAudit.findMany.mockResolvedValue([]);

      await featureFlagService.getAuditLog('aiAssistant', 10);

      expect(mockPrisma.featureFlagAudit.findMany).toHaveBeenCalledWith({
        where: { key: 'aiAssistant' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        skip: 0,
      });
    });
  });

  describe('getFlag', () => {
    it('should return flag info by key', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue({
        key: 'aiAssistant',
        enabled: true,
        description: 'AI assistant feature',
        category: 'general',
        modifiedBy: 'admin',
        updatedAt: new Date(),
      });

      const result = await featureFlagService.getFlag('aiAssistant');

      expect(result).toEqual(
        expect.objectContaining({
          key: 'aiAssistant',
          enabled: true,
          source: 'database',
        })
      );
    });

    it('should return null for non-existent flag', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);

      const result = await featureFlagService.getFlag('nonExistent' as any);

      expect(result).toBeNull();
    });

    it('includes side-effect metadata for treasuryAutopilot', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue({
        key: 'treasuryAutopilot',
        enabled: true,
        description: 'Enable Treasury Autopilot consolidation jobs',
        category: 'general',
        modifiedBy: 'admin',
        updatedAt: new Date(),
      });

      const result = await featureFlagService.getFlag('treasuryAutopilot');

      expect(result).toEqual(
        expect.objectContaining({
          hasSideEffects: true,
          sideEffectDescription: expect.stringContaining('starts or stops background consolidation jobs'),
        })
      );
    });
  });

  describe('resetToDefault', () => {
    beforeEach(async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);
      await featureFlagService.initialize();
    });

    it('should reset flag to environment default', async () => {
      const mockFlag = {
        id: 'flag-1',
        key: 'hardwareWalletSigning',
        enabled: false, // Changed from true default
        description: 'Hardware wallet support',
        category: 'general',
        modifiedBy: 'admin',
        updatedAt: new Date(),
      };
      mockPrisma.featureFlag.findUnique.mockResolvedValue(mockFlag);
      mockPrisma.featureFlag.update.mockResolvedValue({ ...mockFlag, enabled: true });
      mockPrisma.featureFlagAudit.create.mockResolvedValue({});

      await featureFlagService.resetToDefault('hardwareWalletSigning', {
        userId: 'admin-123',
      });

      // Should be called with the env default (true)
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should handle experimental flags', async () => {
      const mockFlag = {
        id: 'flag-1',
        key: 'experimental.taprootAddresses',
        enabled: true, // Changed from false default
        description: 'Taproot support',
        category: 'experimental',
        modifiedBy: 'admin',
        updatedAt: new Date(),
      };
      mockPrisma.featureFlag.findUnique.mockResolvedValue(mockFlag);
      mockPrisma.featureFlag.update.mockResolvedValue({ ...mockFlag, enabled: false });
      mockPrisma.featureFlagAudit.create.mockResolvedValue({});

      await featureFlagService.resetToDefault('experimental.taprootAddresses', {
        userId: 'admin-123',
      });

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('uses false default for unknown experimental keys', async () => {
      const mockFlag = {
        id: 'flag-unknown-exp',
        key: 'experimental.unknownFlag',
        enabled: true,
        description: null,
        category: 'experimental',
        modifiedBy: 'admin',
        updatedAt: new Date(),
      };
      mockPrisma.featureFlag.findUnique.mockResolvedValue(mockFlag);
      mockPrisma.featureFlag.update.mockResolvedValue({ ...mockFlag, enabled: false });
      mockPrisma.featureFlagAudit.create.mockResolvedValue({});

      await featureFlagService.resetToDefault('experimental.unknownFlag' as any, {
        userId: 'admin-123',
      });

      expect(mockPrisma.featureFlag.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ enabled: false }),
        })
      );
    });

    it('uses false default for unknown top-level keys', async () => {
      const mockFlag = {
        id: 'flag-unknown-top',
        key: 'unknownTopLevelFlag',
        enabled: true,
        description: null,
        category: 'general',
        modifiedBy: 'admin',
        updatedAt: new Date(),
      };
      mockPrisma.featureFlag.findUnique.mockResolvedValue(mockFlag);
      mockPrisma.featureFlag.update.mockResolvedValue({ ...mockFlag, enabled: false });
      mockPrisma.featureFlagAudit.create.mockResolvedValue({});

      await featureFlagService.resetToDefault('unknownTopLevelFlag' as any, {
        userId: 'admin-123',
      });

      expect(mockPrisma.featureFlag.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ enabled: false }),
        })
      );
    });
  });

  describe('bulkUpdate', () => {
    beforeEach(async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);
      await featureFlagService.initialize();
    });

    it('should update multiple flags', async () => {
      const mockFlags = [
        { id: 'flag-1', key: 'aiAssistant', enabled: false },
        { id: 'flag-2', key: 'priceAlerts', enabled: false },
      ];

      let callIndex = 0;
      mockPrisma.featureFlag.findUnique.mockImplementation(() => {
        const flag = mockFlags[callIndex];
        callIndex = (callIndex + 1) % mockFlags.length;
        return Promise.resolve(flag);
      });
      mockPrisma.featureFlag.update.mockResolvedValue({});
      mockPrisma.featureFlagAudit.create.mockResolvedValue({});

      await featureFlagService.bulkUpdate(
        [
          { key: 'aiAssistant', enabled: true },
          { key: 'priceAlerts', enabled: true },
        ],
        { userId: 'admin-123' }
      );

      // Should be called for each update
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(3);
    });
  });
});
