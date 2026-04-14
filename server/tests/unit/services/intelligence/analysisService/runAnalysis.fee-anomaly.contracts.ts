import { expect, it, type Mock } from 'vitest';
import {
  mockCreateInsight,
  mockFetch,
  mockGetAIConfig,
  mockGetEnabledIntelligenceWallets,
  mockGetLatestFeeSnapshot,
  mockGetRecentFees,
  mockGetTransactionVelocity,
  mockNotificationChannelRegistry,
  mockSyncConfigToContainer,
  validConfig,
} from './analysisServiceTestHarness';
import { runAnalysisPipelines } from '../../../../../src/services/intelligence/analysisService';

export function registerRunAnalysisFeeAnomalyContracts(): void {
    it('should run fee_timing pipeline and create insight', async () => {
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
          settings: { enabled: true, typeFilter: ['fee_timing'] },
        },
      ]);

      const snapshots = Array.from({ length: 10 }, (_, i) => ({
        economy: 5 + i,
        fastest: 20 + i,
      }));

      (mockGetRecentFees as Mock).mockResolvedValue(snapshots);
      (mockGetLatestFeeSnapshot as Mock).mockResolvedValue({
        economy: 8,
        fastest: 25,
      });

      // AI analysis call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'Fee Timing Alert',
          summary: 'Fees are low',
          severity: 'info',
          analysis: 'Detailed fee analysis',
        }),
      });

      (mockCreateInsight as Mock).mockResolvedValue({
        id: 'insight-fee',
        walletId: 'wallet-1',
        type: 'fee_timing',
        severity: 'info',
        title: 'Fee Timing Alert',
        summary: 'Fees are low',
      });

      (mockNotificationChannelRegistry.notifyInsight as Mock).mockResolvedValue(undefined);

      await runAnalysisPipelines();

      expect(mockCreateInsight).toHaveBeenCalledWith(
        expect.objectContaining({
          walletId: 'wallet-1',
          type: 'fee_timing',
          severity: 'info',
          title: 'Fee Timing Alert',
        })
      );
    });

    it('should return null context for fee_timing when latest snapshot is missing', async () => {
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
          settings: { enabled: true, typeFilter: ['fee_timing'] },
        },
      ]);

      (mockGetRecentFees as Mock).mockResolvedValue(Array.from({ length: 10 }, () => ({ economy: 5, fastest: 20 })));
      (mockGetLatestFeeSnapshot as Mock).mockResolvedValue(null);

      await runAnalysisPipelines();

      expect(mockCreateInsight).not.toHaveBeenCalled();
    });

    it('should return null context for fee_timing when too few snapshots', async () => {
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
          settings: { enabled: true, typeFilter: ['fee_timing'] },
        },
      ]);

      (mockGetRecentFees as Mock).mockResolvedValue([{ economy: 5, fastest: 20 }]);
      (mockGetLatestFeeSnapshot as Mock).mockResolvedValue({ economy: 5, fastest: 20 });

      await runAnalysisPipelines();

      expect(mockCreateInsight).not.toHaveBeenCalled();
    });

    it('should run anomaly pipeline and create insight', async () => {
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
          settings: { enabled: true, typeFilter: ['anomaly'] },
        },
      ]);

      (mockGetTransactionVelocity as Mock)
        .mockResolvedValueOnce([{ count: 90, totalSats: BigInt(9000000) }]) // 90-day
        .mockResolvedValueOnce([{ count: 5, totalSats: BigInt(500000) }]); // 1-day

      // AI analysis call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'Anomaly Detected',
          summary: 'Unusual spending pattern',
          severity: 'warning',
          analysis: 'Detailed anomaly analysis',
        }),
      });

      (mockCreateInsight as Mock).mockResolvedValue({
        id: 'insight-anomaly',
        walletId: 'wallet-1',
        type: 'anomaly',
        severity: 'warning',
        title: 'Anomaly Detected',
        summary: 'Unusual spending pattern',
      });

      (mockNotificationChannelRegistry.notifyInsight as Mock).mockResolvedValue(undefined);

      await runAnalysisPipelines();

      expect(mockCreateInsight).toHaveBeenCalledWith(
        expect.objectContaining({
          walletId: 'wallet-1',
          type: 'anomaly',
          severity: 'warning',
        })
      );
    });

    it('should return null context for anomaly when velocity is empty', async () => {
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
          settings: { enabled: true, typeFilter: ['anomaly'] },
        },
      ]);

      (mockGetTransactionVelocity as Mock)
        .mockResolvedValueOnce([]) // 90-day empty
        .mockResolvedValueOnce([]); // 1-day empty

      await runAnalysisPipelines();

      expect(mockCreateInsight).not.toHaveBeenCalled();
    });

    it('should handle anomaly when velocity objects have undefined count/totalSats', async () => {
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
          settings: { enabled: true, typeFilter: ['anomaly'] },
        },
      ]);

      // 90-day returns object with undefined fields (triggers ?? 0 defaults on lines 185-187)
      (mockGetTransactionVelocity as Mock)
        .mockResolvedValueOnce([{ count: undefined, totalSats: undefined }]) // 90-day with nullish fields
        .mockResolvedValueOnce([{ count: undefined, totalSats: undefined }]); // 1-day with nullish fields

      // AI analysis
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'Anomaly Check',
          summary: 'Low activity',
          severity: 'info',
          analysis: 'Analysis details',
        }),
      });

      (mockCreateInsight as Mock).mockResolvedValue({
        id: 'insight-anomaly-2',
        walletId: 'wallet-1',
        type: 'anomaly',
        severity: 'info',
        title: 'Anomaly Check',
        summary: 'Low activity',
      });

      (mockNotificationChannelRegistry.notifyInsight as Mock).mockResolvedValue(undefined);

      await runAnalysisPipelines();

      expect(mockCreateInsight).toHaveBeenCalled();
    });
}
