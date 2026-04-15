import { vi } from 'vitest';
/**
 * Sync Pipeline Tests
 *
 * Tests for the sync pipeline executor and phase composition.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../../../mocks/prisma';
import { mockElectrumClient, resetElectrumMocks } from '../../../../mocks/electrum';

const { isProxyEnabledMock, getBlockHeightMock } = vi.hoisted(() => ({
  isProxyEnabledMock: vi.fn().mockReturnValue(false),
  getBlockHeightMock: vi.fn().mockResolvedValue(800000),
}));

// Mock Prisma
vi.mock('../../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock node client
vi.mock('../../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue(mockElectrumClient),
}));

vi.mock('../../../../../src/services/bitcoin/electrumPool', () => ({
  getElectrumPool: vi.fn(() => ({
    isProxyEnabled: isProxyEnabledMock,
  })),
}));

vi.mock('../../../../../src/services/bitcoin/utils/blockHeight', () => ({
  getBlockHeight: getBlockHeightMock,
}));

// Mock notifications
vi.mock('../../../../../src/websocket/notifications', () => ({
  walletLog: vi.fn(),
  getNotificationService: vi.fn().mockReturnValue({
    broadcastTransactionNotification: vi.fn(),
  }),
}));

import {
  executeSyncPipeline,
  createPhase,
  createSyncContext,
  createTestContext,
  createSyncStats,
  type SyncContext,
  type SyncPhase,
} from '../../../../../src/services/bitcoin/sync';
import { getNodeClient } from '../../../../../src/services/bitcoin/nodeClient';
import { walletLog } from '../../../../../src/websocket/notifications';

describe('Sync Pipeline', () => {
  beforeEach(() => {
    resetPrismaMocks();
    resetElectrumMocks();
    isProxyEnabledMock.mockReset();
    isProxyEnabledMock.mockReturnValue(false);
    getBlockHeightMock.mockReset();
    getBlockHeightMock.mockResolvedValue(800000);
  });

  describe('createSyncStats', () => {
    it('should create stats with all counters at zero', () => {
      const stats = createSyncStats();

      expect(stats.historiesFetched).toBe(0);
      expect(stats.transactionsProcessed).toBe(0);
      expect(stats.newTransactionsCreated).toBe(0);
      expect(stats.utxosFetched).toBe(0);
      expect(stats.utxosCreated).toBe(0);
      expect(stats.utxosMarkedSpent).toBe(0);
      expect(stats.addressesUpdated).toBe(0);
      expect(stats.newAddressesGenerated).toBe(0);
      expect(stats.correctedConsolidations).toBe(0);
    });
  });

  describe('createTestContext', () => {
    it('should create context with default values', () => {
      const ctx = createTestContext({});

      expect(ctx.walletId).toBe('test-wallet-id');
      expect(ctx.network).toBe('mainnet');
      expect(ctx.addresses).toEqual([]);
      expect(ctx.historyResults).toBeInstanceOf(Map);
      expect(ctx.txDetailsCache).toBeInstanceOf(Map);
      expect(ctx.allUtxoKeys).toBeInstanceOf(Set);
    });

    it('should allow overriding default values', () => {
      const ctx = createTestContext({
        walletId: 'custom-wallet-id',
        network: 'testnet',
        currentBlockHeight: 900000,
      });

      expect(ctx.walletId).toBe('custom-wallet-id');
      expect(ctx.network).toBe('testnet');
      expect(ctx.currentBlockHeight).toBe(900000);
    });
  });

  describe('createPhase', () => {
    it('should create a phase with name and execute function', () => {
      const execute = vi.fn().mockImplementation((ctx) => Promise.resolve(ctx));
      const phase = createPhase('testPhase', execute);

      expect(phase.name).toBe('testPhase');
      expect(phase.execute).toBe(execute);
    });
  });

  describe('executeSyncPipeline', () => {
    const walletId = 'test-wallet-id';

    beforeEach(() => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: 'testnet',
        descriptor: "wpkh([12345678/84'/1'/0']tpub...)",
      });

      // Default to having at least one address so phases execute
      mockPrismaClient.address.findMany.mockResolvedValue([
        { id: 'addr-1', address: 'tb1qtest', derivationPath: "m/84'/1'/0'/0/0" },
      ]);
      mockElectrumClient.getBlockHeight.mockResolvedValue(800000);
    });

    it('should execute all phases in order', async () => {
      const executionOrder: string[] = [];

      const phases: SyncPhase[] = [
        createPhase('phase1', async (ctx) => {
          executionOrder.push('phase1');
          return ctx;
        }),
        createPhase('phase2', async (ctx) => {
          executionOrder.push('phase2');
          return ctx;
        }),
        createPhase('phase3', async (ctx) => {
          executionOrder.push('phase3');
          return ctx;
        }),
      ];

      await executeSyncPipeline(walletId, phases);

      expect(executionOrder).toEqual(['phase1', 'phase2', 'phase3']);
    });

    it('should pass context between phases', async () => {
      const phases: SyncPhase[] = [
        createPhase('phase1', async (ctx) => {
          ctx.stats.historiesFetched = 5;
          return ctx;
        }),
        createPhase('phase2', async (ctx) => {
          expect(ctx.stats.historiesFetched).toBe(5);
          ctx.stats.transactionsProcessed = 10;
          return ctx;
        }),
      ];

      const result = await executeSyncPipeline(walletId, phases);

      expect(result.stats.historiesFetched).toBe(5);
      expect(result.stats.transactionsProcessed).toBe(10);
    });

    it('should track completed phases', async () => {
      const phases: SyncPhase[] = [
        createPhase('phase1', async (ctx) => ctx),
        createPhase('phase2', async (ctx) => ctx),
      ];

      const result = await executeSyncPipeline(walletId, phases);

      expect(result.stats).toBeDefined();
    });

    it('should handle empty phases array', async () => {
      mockPrismaClient.address.findMany.mockResolvedValue([]);
      const result = await executeSyncPipeline(walletId, []);

      expect(result.addresses).toBe(0);
      expect(result.transactions).toBe(0);
      expect(result.utxos).toBe(0);
    });

    it('should throw error when wallet not found', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

      await expect(executeSyncPipeline('nonexistent', [])).rejects.toThrow();
    });

    it('should default to mainnet when wallet network is missing', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: null,
        descriptor: "wpkh([12345678/84'/0'/0']xpub...)",
      });

      await executeSyncPipeline(walletId, []);

      expect(getNodeClient).toHaveBeenCalledWith('mainnet');
    });

    it('should log Tor-specific start message when proxy is enabled', async () => {
      isProxyEnabledMock.mockReturnValueOnce(true);

      await executeSyncPipeline(walletId, []);

      expect(walletLog).toHaveBeenCalledWith(
        walletId,
        'info',
        'SYNC',
        'Starting wallet sync via Tor...'
      );
    });

    it('should propagate phase errors with context', async () => {
      const phases: SyncPhase[] = [
        createPhase('successPhase', async (ctx) => ctx),
        createPhase('failingPhase', async () => {
          throw new Error('Phase failed');
        }),
      ];

      await expect(executeSyncPipeline(walletId, phases)).rejects.toMatchObject({
        name: 'SyncPipelineError',
        message: expect.stringContaining('Phase failed'),
        failedPhase: 'failingPhase',
      });
    });

    it('should wrap non-Error phase failures in an Error cause', async () => {
      const phases: SyncPhase[] = [
        createPhase('stringFailure', async () => {
          throw 'string failure';
        }),
      ];

      await expect(executeSyncPipeline(walletId, phases)).rejects.toMatchObject({
        name: 'SyncPipelineError',
        failedPhase: 'stringFailure',
        cause: expect.objectContaining({
          message: 'string failure',
        }),
      });
    });

    it('should call onPhaseComplete callback after each phase', async () => {
      const completedPhases: string[] = [];

      const phases: SyncPhase[] = [
        createPhase('phase1', async (ctx) => ctx),
        createPhase('phase2', async (ctx) => ctx),
      ];

      await executeSyncPipeline(walletId, phases, {
        onPhaseComplete: (phaseName) => {
          completedPhases.push(phaseName);
        },
      });

      expect(completedPhases).toEqual(['phase1', 'phase2']);
    });

    it('should skip phases listed in skipPhases option', async () => {
      const executedPhases: string[] = [];

      const phases: SyncPhase[] = [
        createPhase('phase1', async (ctx) => {
          executedPhases.push('phase1');
          return ctx;
        }),
        createPhase('phase2', async (ctx) => {
          executedPhases.push('phase2');
          return ctx;
        }),
        createPhase('phase3', async (ctx) => {
          executedPhases.push('phase3');
          return ctx;
        }),
      ];

      await executeSyncPipeline(walletId, phases, {
        skipPhases: ['phase2'],
      });

      expect(executedPhases).toEqual(['phase1', 'phase3']);
    });

    it('should only run phases listed in onlyPhases option', async () => {
      const executedPhases: string[] = [];

      const phases: SyncPhase[] = [
        createPhase('phase1', async (ctx) => {
          executedPhases.push('phase1');
          return ctx;
        }),
        createPhase('phase2', async (ctx) => {
          executedPhases.push('phase2');
          return ctx;
        }),
        createPhase('phase3', async (ctx) => {
          executedPhases.push('phase3');
          return ctx;
        }),
      ];

      await executeSyncPipeline(walletId, phases, {
        onlyPhases: ['phase1', 'phase3'],
      });

      expect(executedPhases).toEqual(['phase1', 'phase3']);
    });

    it('should return result with correct structure', async () => {
      mockPrismaClient.address.findMany.mockResolvedValue([
        { id: 'addr-1', address: 'tb1test', derivationPath: "m/84'/1'/0'/0/0" },
      ]);

      const phases: SyncPhase[] = [
        createPhase('countPhase', async (ctx) => {
          ctx.stats.utxosCreated = 5;
          return ctx;
        }),
      ];

      const result = await executeSyncPipeline(walletId, phases);

      expect(typeof result.addresses).toBe('number');
      expect(typeof result.transactions).toBe('number');
      expect(typeof result.utxos).toBe('number');
      expect(typeof result.elapsedMs).toBe('number');
      expect(result.stats).toBeDefined();
      expect(result.stats.utxosCreated).toBe(5);
    });

    it('should measure elapsed time', async () => {
      let now = 5_000;
      const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
      const phases: SyncPhase[] = [
        createPhase('slowPhase', async (ctx) => {
          now += 50;
          return ctx;
        }),
      ];

      try {
        const result = await executeSyncPipeline(walletId, phases);

        expect(result.elapsedMs).toBe(50);
      } finally {
        dateNowSpy.mockRestore();
      }
    });
  });
});
