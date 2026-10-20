import { expect, it, type Mock } from "vitest";
import {
  mockCreateInsight,
  mockFetch,
  mockGetAIConfig,
  mockGetEnabledIntelligenceWallets,
  mockGetUtxoHealthProfile,
  mockLogger,
  mockMarkInsightNotified,
  mockNotificationChannelRegistry,
  mockSyncConfigToLlmEgressProxy,
  redis,
  validConfig,
} from "./analysisServiceTestHarness";
import { runAnalysisPipelines } from "../../../../../src/services/intelligence/analysisService";

/** Run one utxo_health analysis whose notification dispatch resolves to `notifyResult`. */
async function runWithNotifyResult(notifyResult: unknown): Promise<void> {
  (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
  (mockSyncConfigToLlmEgressProxy as Mock).mockResolvedValue(true);
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ compatible: true }) });
  (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
    {
      walletId: "wallet-1",
      walletName: "Main Wallet",
      userId: "user-1",
      settings: {
        enabled: true,
        notifyTelegram: true,
        notifyPush: true,
        severityFilter: "info",
        typeFilter: ["utxo_health"],
      },
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
  redis.exists.mockResolvedValue(0);
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      title: "UTXO Health Alert",
      summary: "Consider consolidating dust",
      severity: "warning",
      analysis: "Detailed analysis text",
    }),
  });
  (mockCreateInsight as Mock).mockResolvedValue({ id: "insight-new" });
  (mockNotificationChannelRegistry.notifyInsight as Mock).mockResolvedValue(notifyResult);

  await runAnalysisPipelines();
}

export function registerRunAnalysisNotifiedContracts(): void {
  it("marks the insight notified when a channel delivered to a user", async () => {
    await runWithNotifyResult([
      { success: true, channelId: "ai-insights", usersNotified: 0 },
      { success: true, channelId: "push", usersNotified: 1 },
    ]);

    expect(mockMarkInsightNotified).toHaveBeenCalledWith("insight-new");
  });

  it("does not mark the insight notified when nobody was notified", async () => {
    await runWithNotifyResult([
      { success: true, channelId: "push", usersNotified: 0 },
      { success: false, channelId: "ai-insights", usersNotified: 1 },
    ]);

    expect(mockMarkInsightNotified).not.toHaveBeenCalled();
  });

  it("tolerates a non-array dispatch result", async () => {
    await runWithNotifyResult(undefined);

    expect(mockMarkInsightNotified).not.toHaveBeenCalled();
  });

  it("logs and continues when marking the insight notified fails", async () => {
    (mockMarkInsightNotified as Mock).mockRejectedValueOnce(new Error("db down"));

    await runWithNotifyResult([{ success: true, channelId: "push", usersNotified: 1 }]);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("notified"),
      expect.objectContaining({ insightId: "insight-new", error: "db down" }),
    );
  });
}
