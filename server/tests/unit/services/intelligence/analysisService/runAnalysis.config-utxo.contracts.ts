import { expect, it, type Mock } from 'vitest';
import {
  mockCreateInsight,
  mockFetch,
  mockGetAIConfig,
  mockGetEnabledIntelligenceWallets,
  mockGetUtxoHealthProfile,
  mockNotificationChannelRegistry,
  mockSyncConfigToContainer,
  redis,
  validConfig,
} from './analysisServiceTestHarness';
import { runAnalysisPipelines } from '../../../../../src/services/intelligence/analysisService';

export function registerRunAnalysisConfigUtxoContracts(): void {
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

    it('should skip pipeline when insight is deduplicated', async () => {
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

      // Redis says key already exists (deduplicated)
      redis.exists.mockResolvedValue(1);

      await runAnalysisPipelines();

      // Should not call context gathering or AI
      expect(mockGetUtxoHealthProfile).not.toHaveBeenCalled();
      expect(mockCreateInsight).not.toHaveBeenCalled();
    });

    it('should skip when gatherContext returns null for utxo_health with 0 utxos', async () => {
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
        totalUtxos: 0,
        dustCount: 0,
        dustValue: BigInt(0),
        totalValue: BigInt(0),
        avgUtxoSize: BigInt(0),
        consolidationCandidates: 0,
      });

      await runAnalysisPipelines();

      expect(mockCreateInsight).not.toHaveBeenCalled();
    });
}
