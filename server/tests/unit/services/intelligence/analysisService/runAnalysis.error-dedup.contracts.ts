import { expect, it, type Mock } from 'vitest';
import {
  mockCreateInsight,
  mockFetch,
  mockGetAIConfig,
  mockGetEnabledIntelligenceWallets,
  mockGetRedisClient,
  mockGetUtxoHealthProfile,
  mockIsRedisConnected,
  mockLogger,
  mockNotificationChannelRegistry,
  mockSyncConfigToContainer,
  redis,
  validConfig,
} from './analysisServiceTestHarness';
import { runAnalysisPipelines } from '../../../../../src/services/intelligence/analysisService';

export function registerRunAnalysisErrorDedupContracts(): void {
    it('should skip when AI analysis returns non-ok response', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['utxo_health'] },
        },
      ]);

      (mockGetUtxoHealthProfile as Mock).mockResolvedValue({
        totalUtxos: 25,
        dustCount: 5,
        dustValue: BigInt(5000),
        totalValue: BigInt(500000),
        avgUtxoSize: BigInt(20000),
        consolidationCandidates: 3,
      });

      // AI analysis returns non-ok
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await runAnalysisPipelines();

      expect(mockCreateInsight).not.toHaveBeenCalled();
    });

    it('should skip when AI analysis returns invalid response (missing title)', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['utxo_health'] },
        },
      ]);

      (mockGetUtxoHealthProfile as Mock).mockResolvedValue({
        totalUtxos: 25,
        dustCount: 5,
        dustValue: BigInt(5000),
        totalValue: BigInt(500000),
        avgUtxoSize: BigInt(20000),
        consolidationCandidates: 3,
      });

      // AI returns response without title
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          summary: 'Some summary but no title',
          severity: 'info',
          analysis: 'Analysis',
        }),
      });

      await runAnalysisPipelines();

      expect(mockCreateInsight).not.toHaveBeenCalled();
    });

    it('should skip when AI analysis fetch throws an error', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['utxo_health'] },
        },
      ]);

      (mockGetUtxoHealthProfile as Mock).mockResolvedValue({
        totalUtxos: 25,
        dustCount: 5,
        dustValue: BigInt(5000),
        totalValue: BigInt(500000),
        avgUtxoSize: BigInt(20000),
        consolidationCandidates: 3,
      });

      // AI fetch throws
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await runAnalysisPipelines();

      expect(mockCreateInsight).not.toHaveBeenCalled();
    });

    it('should handle notification dispatch error gracefully', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['utxo_health'] },
        },
      ]);

      (mockGetUtxoHealthProfile as Mock).mockResolvedValue({
        totalUtxos: 25,
        dustCount: 5,
        dustValue: BigInt(5000),
        totalValue: BigInt(500000),
        avgUtxoSize: BigInt(20000),
        consolidationCandidates: 3,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'UTXO Health Alert',
          summary: 'Consider consolidating dust',
          severity: 'warning',
          analysis: 'Detailed analysis text',
        }),
      });

      (mockCreateInsight as Mock).mockResolvedValue({
        id: 'insight-notify-fail',
        walletId: 'wallet-1',
        type: 'utxo_health',
        severity: 'warning',
        title: 'UTXO Health Alert',
        summary: 'Consider consolidating dust',
      });

      // Notification throws
      (mockNotificationChannelRegistry.notifyInsight as Mock).mockRejectedValue(
        new Error('Notification failed')
      );

      // Should not throw; notification error is caught internally
      await expect(runAnalysisPipelines()).resolves.toBeUndefined();
      expect(mockCreateInsight).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to dispatch insight notification',
        expect.objectContaining({ insightId: 'insight-notify-fail' })
      );
    });

    it('should handle dedup check when Redis is not connected', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['utxo_health'] },
        },
      ]);

      // Redis not connected - isDeduplicated should return false, setDedup should be noop
      (mockIsRedisConnected as Mock).mockReturnValue(false);

      (mockGetUtxoHealthProfile as Mock).mockResolvedValue({
        totalUtxos: 25,
        dustCount: 5,
        dustValue: BigInt(5000),
        totalValue: BigInt(500000),
        avgUtxoSize: BigInt(20000),
        consolidationCandidates: 3,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'UTXO Health Alert',
          summary: 'Consider consolidating dust',
          severity: 'warning',
          analysis: 'Detailed analysis text',
        }),
      });

      (mockCreateInsight as Mock).mockResolvedValue({
        id: 'insight-no-redis',
        walletId: 'wallet-1',
        type: 'utxo_health',
        severity: 'warning',
        title: 'UTXO Health Alert',
        summary: 'Consider consolidating dust',
      });

      (mockNotificationChannelRegistry.notifyInsight as Mock).mockResolvedValue(undefined);

      await runAnalysisPipelines();

      // Should still create insight even without Redis
      expect(mockCreateInsight).toHaveBeenCalled();
      // Redis.set should not be called since redis is not connected
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('should handle dedup check when Redis client is null', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['utxo_health'] },
        },
      ]);

      // Redis client is null
      (mockGetRedisClient as Mock).mockReturnValue(null);

      (mockGetUtxoHealthProfile as Mock).mockResolvedValue({
        totalUtxos: 25,
        dustCount: 5,
        dustValue: BigInt(5000),
        totalValue: BigInt(500000),
        avgUtxoSize: BigInt(20000),
        consolidationCandidates: 3,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'UTXO Alert',
          summary: 'Consolidate',
          severity: 'info',
          analysis: 'Details',
        }),
      });

      (mockCreateInsight as Mock).mockResolvedValue({
        id: 'insight-null-redis',
        walletId: 'wallet-1',
        type: 'utxo_health',
        severity: 'info',
        title: 'UTXO Alert',
        summary: 'Consolidate',
      });

      (mockNotificationChannelRegistry.notifyInsight as Mock).mockResolvedValue(undefined);

      await runAnalysisPipelines();

      expect(mockCreateInsight).toHaveBeenCalled();
    });

    it('should catch and log error when createInsight throws in runPipeline', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['utxo_health'] },
        },
      ]);

      (mockGetUtxoHealthProfile as Mock).mockResolvedValue({
        totalUtxos: 25,
        dustCount: 5,
        dustValue: BigInt(5000),
        totalValue: BigInt(500000),
        avgUtxoSize: BigInt(20000),
        consolidationCandidates: 3,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'UTXO Health Alert',
          summary: 'Consider consolidating dust',
          severity: 'warning',
          analysis: 'Detailed analysis text',
        }),
      });

      // createInsight throws, which propagates to the wallet-level catch
      (mockCreateInsight as Mock).mockRejectedValue(new Error('DB write failed'));

      await expect(runAnalysisPipelines()).resolves.toBeUndefined();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error analyzing wallet',
        expect.objectContaining({ walletId: 'wallet-1', error: 'DB write failed' })
      );
    });

    it('should catch and log top-level error in runAnalysisPipelines', async () => {
      (mockGetAIConfig as Mock).mockRejectedValue(new Error('Config fetch failed'));

      await expect(runAnalysisPipelines()).resolves.toBeUndefined();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error in runAnalysisPipelines',
        expect.objectContaining({ error: 'Config fetch failed' })
      );
    });
}
