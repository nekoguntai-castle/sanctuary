import { expect, it, type Mock } from 'vitest';
import {
  mockCreateInsight,
  mockFetch,
  mockGetAIConfig,
  mockGetEnabledIntelligenceWallets,
  mockGetLatestFeeSnapshot,
  mockGetRecentFees,
  mockGetUtxoAgeDistribution,
  mockGetUtxoHealthProfile,
  mockNotificationChannelRegistry,
  mockSyncConfigToContainer,
  validConfig,
} from './analysisServiceTestHarness';
import { runAnalysisPipelines } from '../../../../../src/services/intelligence/analysisService';

export function registerRunAnalysisTaxConsolidationContracts(): void {
    it('should run tax pipeline and create insight', async () => {
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
          settings: { enabled: true, typeFilter: ['tax'] },
        },
      ]);

      (mockGetUtxoAgeDistribution as Mock).mockResolvedValue({
        shortTerm: { count: 5, totalSats: BigInt(50000) },
        longTerm: { count: 10, totalSats: BigInt(500000) },
      });

      // AI analysis call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'Tax Optimization',
          summary: 'Consider holding for long-term gains',
          severity: 'info',
          analysis: 'Detailed tax analysis',
        }),
      });

      (mockCreateInsight as Mock).mockResolvedValue({
        id: 'insight-tax',
        walletId: 'wallet-1',
        type: 'tax',
        severity: 'info',
        title: 'Tax Optimization',
        summary: 'Consider holding for long-term gains',
      });

      (mockNotificationChannelRegistry.notifyInsight as Mock).mockResolvedValue(undefined);

      await runAnalysisPipelines();

      expect(mockCreateInsight).toHaveBeenCalledWith(
        expect.objectContaining({
          walletId: 'wallet-1',
          type: 'tax',
        })
      );
    });

    it('should return null context for tax when both short and long term counts are zero', async () => {
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
          settings: { enabled: true, typeFilter: ['tax'] },
        },
      ]);

      (mockGetUtxoAgeDistribution as Mock).mockResolvedValue({
        shortTerm: { count: 0, totalSats: BigInt(0) },
        longTerm: { count: 0, totalSats: BigInt(0) },
      });

      await runAnalysisPipelines();

      expect(mockCreateInsight).not.toHaveBeenCalled();
    });

    it('should run consolidation pipeline and create insight', async () => {
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
          settings: { enabled: true, typeFilter: ['consolidation'] },
        },
      ]);

      (mockGetUtxoHealthProfile as Mock).mockResolvedValue({
        totalUtxos: 25,
        dustCount: 5,
        consolidationCandidates: 3,
        totalValue: BigInt(500000),
        dustValue: BigInt(5000),
        avgUtxoSize: BigInt(20000),
      });

      (mockGetLatestFeeSnapshot as Mock).mockResolvedValue({
        economy: 8,
        fastest: 25,
      });

      (mockGetRecentFees as Mock).mockResolvedValue([
        { economy: 5, fastest: 20 },
        { economy: 8, fastest: 25 },
      ]);

      // AI analysis call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'Consolidation Opportunity',
          summary: 'Low fees make consolidation favorable',
          severity: 'info',
          analysis: 'Detailed consolidation analysis',
        }),
      });

      (mockCreateInsight as Mock).mockResolvedValue({
        id: 'insight-consolidation',
        walletId: 'wallet-1',
        type: 'consolidation',
        severity: 'info',
        title: 'Consolidation Opportunity',
        summary: 'Low fees make consolidation favorable',
      });

      (mockNotificationChannelRegistry.notifyInsight as Mock).mockResolvedValue(undefined);

      await runAnalysisPipelines();

      expect(mockCreateInsight).toHaveBeenCalledWith(
        expect.objectContaining({
          walletId: 'wallet-1',
          type: 'consolidation',
        })
      );
    });

    it('should return null context for consolidation when fewer than 5 utxos', async () => {
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
          settings: { enabled: true, typeFilter: ['consolidation'] },
        },
      ]);

      (mockGetUtxoHealthProfile as Mock).mockResolvedValue({
        totalUtxos: 3,
        dustCount: 0,
        consolidationCandidates: 0,
        totalValue: BigInt(300000),
        dustValue: BigInt(0),
        avgUtxoSize: BigInt(100000),
      });

      (mockGetLatestFeeSnapshot as Mock).mockResolvedValue(null);
      (mockGetRecentFees as Mock).mockResolvedValue([]);

      await runAnalysisPipelines();

      expect(mockCreateInsight).not.toHaveBeenCalled();
    });

    it('should handle consolidation with null latest fee snapshot and empty snapshots', async () => {
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
          settings: { enabled: true, typeFilter: ['consolidation'] },
        },
      ]);

      (mockGetUtxoHealthProfile as Mock).mockResolvedValue({
        totalUtxos: 10,
        dustCount: 2,
        consolidationCandidates: 2,
        totalValue: BigInt(100000),
        dustValue: BigInt(2000),
        avgUtxoSize: BigInt(10000),
      });

      (mockGetLatestFeeSnapshot as Mock).mockResolvedValue(null);
      (mockGetRecentFees as Mock).mockResolvedValue([]);

      // AI analysis call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'Consolidation Note',
          summary: 'Consider consolidating',
          severity: 'info',
          analysis: 'Analysis',
        }),
      });

      (mockCreateInsight as Mock).mockResolvedValue({
        id: 'insight-c2',
        walletId: 'wallet-1',
        type: 'consolidation',
        severity: 'info',
        title: 'Consolidation Note',
        summary: 'Consider consolidating',
      });

      (mockNotificationChannelRegistry.notifyInsight as Mock).mockResolvedValue(undefined);

      await runAnalysisPipelines();

      expect(mockCreateInsight).toHaveBeenCalled();
    });
}
