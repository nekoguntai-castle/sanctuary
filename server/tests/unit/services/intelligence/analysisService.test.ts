/**
 * Analysis Service Tests
 *
 * Tests for the Treasury Intelligence analysis pipeline orchestration.
 */

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const {
  mockGetRedisClient,
  mockIsRedisConnected,
  mockGetAIConfig,
  mockSyncConfigToContainer,
  mockGetContainerUrl,
  mockGetEnabledIntelligenceWallets,
  mockNotificationChannelRegistry,
  mockCreateInsight,
  mockGetTransactionVelocity,
  mockGetUtxoAgeDistribution,
  mockGetUtxoHealthProfile,
  mockGetRecentFees,
  mockGetLatestFeeSnapshot,
  mockLogger,
  redis,
} = vi.hoisted(() => {
  const redis = {
    exists: vi.fn(),
    set: vi.fn(),
  };

  return {
    mockGetRedisClient: vi.fn(() => redis),
    mockIsRedisConnected: vi.fn(() => true),
    mockGetAIConfig: vi.fn(),
    mockSyncConfigToContainer: vi.fn(),
    mockGetContainerUrl: vi.fn(() => 'http://ai:3100'),
    mockGetEnabledIntelligenceWallets: vi.fn(),
    mockNotificationChannelRegistry: {
      notifyInsight: vi.fn(),
    },
    mockCreateInsight: vi.fn(),
    mockGetTransactionVelocity: vi.fn(),
    mockGetUtxoAgeDistribution: vi.fn(),
    mockGetUtxoHealthProfile: vi.fn(),
    mockGetRecentFees: vi.fn(),
    mockGetLatestFeeSnapshot: vi.fn(),
    mockLogger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    redis,
  };
});

vi.mock('../../../../src/infrastructure', () => ({
  getRedisClient: mockGetRedisClient,
  isRedisConnected: mockIsRedisConnected,
}));

vi.mock('../../../../src/services/ai/config', () => ({
  getAIConfig: mockGetAIConfig,
  syncConfigToContainer: mockSyncConfigToContainer,
  getContainerUrl: mockGetContainerUrl,
}));

vi.mock('../../../../src/repositories/intelligenceRepository', () => ({
  intelligenceRepository: {
    createInsight: mockCreateInsight,
    getTransactionVelocity: mockGetTransactionVelocity,
    getUtxoAgeDistribution: mockGetUtxoAgeDistribution,
  },
}));

vi.mock('../../../../src/services/intelligence/settings', () => ({
  getEnabledIntelligenceWallets: mockGetEnabledIntelligenceWallets,
}));

vi.mock('../../../../src/services/notifications/channels', () => ({
  notificationChannelRegistry: mockNotificationChannelRegistry,
}));

vi.mock('../../../../src/services/autopilot/utxoHealth', () => ({
  getUtxoHealthProfile: mockGetUtxoHealthProfile,
}));

vi.mock('../../../../src/services/autopilot/feeMonitor', () => ({
  getRecentFees: mockGetRecentFees,
  getLatestFeeSnapshot: mockGetLatestFeeSnapshot,
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('../../../../src/utils/errors', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import {
  runAnalysisPipelines,
  getIntelligenceStatus,
} from '../../../../src/services/intelligence/analysisService';

describe('Analysis Service', () => {
  const validConfig = {
    enabled: true,
    endpoint: 'http://ollama:11434',
    model: 'llama3',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    redis.exists.mockResolvedValue(0);
    redis.set.mockResolvedValue('OK');
    (mockIsRedisConnected as Mock).mockReturnValue(true);
    (mockGetRedisClient as Mock).mockReturnValue(redis);
  });

  // ========================================
  // runAnalysisPipelines
  // ========================================

  describe('runAnalysisPipelines', () => {
    it('should skip when AI is not configured (not enabled)', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue({ enabled: false, endpoint: null, model: null });

      await runAnalysisPipelines();

      expect(mockSyncConfigToContainer).not.toHaveBeenCalled();
      expect(mockGetEnabledIntelligenceWallets).not.toHaveBeenCalled();
    });

    it('should skip when AI has no endpoint', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue({ enabled: true, endpoint: '', model: 'llama3' });

      await runAnalysisPipelines();

      expect(mockSyncConfigToContainer).not.toHaveBeenCalled();
    });

    it('should skip when AI has no model', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue({ enabled: true, endpoint: 'http://ollama:11434', model: '' });

      await runAnalysisPipelines();

      expect(mockSyncConfigToContainer).not.toHaveBeenCalled();
    });

    it('should skip when Ollama check fails', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await runAnalysisPipelines();

      expect(mockGetEnabledIntelligenceWallets).not.toHaveBeenCalled();
    });

    it('should skip when Ollama check returns not compatible', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: false }),
      });

      await runAnalysisPipelines();

      expect(mockGetEnabledIntelligenceWallets).not.toHaveBeenCalled();
    });

    it('should skip when no wallets have intelligence enabled', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });
      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([]);

      await runAnalysisPipelines();

      expect(mockCreateInsight).not.toHaveBeenCalled();
    });

    it('should run analysis for enabled wallets and create insights', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      // Ollama check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: {
            enabled: true,
            notifyTelegram: true,
            notifyPush: true,
            severityFilter: 'info',
            typeFilter: ['utxo_health'],
          },
        },
      ]);

      // Context gathering: utxo_health
      (mockGetUtxoHealthProfile as Mock).mockResolvedValue({
        totalUtxos: 25,
        dustCount: 5,
        dustValue: BigInt(5000),
        totalValue: BigInt(500000),
        avgUtxoSize: BigInt(20000),
        consolidationCandidates: 3,
      });

      // Dedup check (not deduplicated)
      redis.exists.mockResolvedValue(0);

      // AI analysis call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'UTXO Health Alert',
          summary: 'Consider consolidating dust',
          severity: 'warning',
          analysis: 'Detailed analysis text',
        }),
      });

      // Create insight
      (mockCreateInsight as Mock).mockResolvedValue({
        id: 'insight-new',
        walletId: 'wallet-1',
        type: 'utxo_health',
        severity: 'warning',
        title: 'UTXO Health Alert',
        summary: 'Consider consolidating dust',
      });

      // Notification
      (mockNotificationChannelRegistry.notifyInsight as Mock).mockResolvedValue(undefined);

      await runAnalysisPipelines();

      expect(mockCreateInsight).toHaveBeenCalledWith(
        expect.objectContaining({
          walletId: 'wallet-1',
          type: 'utxo_health',
          severity: 'warning',
          title: 'UTXO Health Alert',
        })
      );
      expect(redis.set).toHaveBeenCalled();
      expect(mockNotificationChannelRegistry.notifyInsight).toHaveBeenCalled();
    });

    it('should handle errors in individual wallet analysis gracefully', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      // Ollama check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: {
            enabled: true,
            typeFilter: ['utxo_health'],
          },
        },
      ]);

      // Context gathering throws
      (mockGetUtxoHealthProfile as Mock).mockRejectedValue(new Error('DB timeout'));

      // Should not throw; error is caught internally
      await expect(runAnalysisPipelines()).resolves.toBeUndefined();
    });
  });

  // ========================================
  // getIntelligenceStatus
  // ========================================

  describe('getIntelligenceStatus', () => {
    it('should return unavailable when AI is not configured', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue({ enabled: false, endpoint: null, model: null });

      const result = await getIntelligenceStatus();

      expect(result).toEqual({
        available: false,
        ollamaConfigured: false,
        reason: 'ai_not_configured',
      });
    });

    it('should return available when Ollama is compatible', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true, endpointType: 'bundled' }),
      });

      const result = await getIntelligenceStatus();

      expect(result).toEqual({
        available: true,
        ollamaConfigured: true,
        endpointType: 'bundled',
      });
    });

    it('should return unavailable when Ollama check returns not compatible', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: false, reason: 'ollama_required' }),
      });

      const result = await getIntelligenceStatus();

      expect(result).toEqual({
        available: false,
        ollamaConfigured: false,
        reason: 'ollama_required',
      });
    });

    it('should return unreachable when AI container request fails', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

      const result = await getIntelligenceStatus();

      expect(result).toEqual({
        available: false,
        ollamaConfigured: false,
        reason: 'ai_container_unreachable',
      });
    });

    it('should return unreachable when fetch throws', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await getIntelligenceStatus();

      expect(result).toEqual({
        available: false,
        ollamaConfigured: false,
        reason: 'ai_container_unreachable',
      });
    });
  });
});
