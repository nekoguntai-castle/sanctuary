import { describe, expect, it, type Mock } from "vitest";
import {
  mockFetch,
  mockGetAIConfig,
  mockSyncConfigToLlmEgressProxy,
  validConfig,
} from "./analysisServiceTestHarness";
import { getIntelligenceStatus } from "../../../../../src/services/intelligence/analysisService";

export function registerIntelligenceStatusContracts(): void {
  describe("getIntelligenceStatus", () => {
    it("should return unavailable when AI is not configured", async () => {
      (mockGetAIConfig as Mock).mockResolvedValue({
        enabled: false,
        endpoint: null,
        model: null,
      });

      const result = await getIntelligenceStatus('user-1');

      expect(result).toEqual({
        available: false,
        ollamaConfigured: false,
        reason: "ai_not_configured",
      });
    });

    it("should report the proxy unavailable without probing stale config when sync fails", async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToLlmEgressProxy as Mock).mockResolvedValue(false);

      const result = await getIntelligenceStatus('user-1');

      expect(result).toEqual({
        available: false,
        ollamaConfigured: false,
        reason: "llm_egress_proxy_unreachable",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should return available when the configured provider is reachable", async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToLlmEgressProxy as Mock).mockResolvedValue(true);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true, endpointType: "host" }),
      });

      const result = await getIntelligenceStatus('user-1');

      expect(result).toEqual({
        available: true,
        ollamaConfigured: true,
        endpointType: "host",
      });
    });

    // Regression: the status call used the worker's rate-limit bucket. Enough
    // status loads from the UI made the worker's analysis calls answer 429,
    // which was reported as "unreachable" and skipped the run.
    it("checks the provider in the calling user's rate-limit bucket", async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToLlmEgressProxy as Mock).mockResolvedValue(true);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true, endpointType: "host" }),
      });

      await getIntelligenceStatus("user-1");

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers["X-LLM-Egress-Rate-Key"]).toBe("user:user-1");
    });

    it("reports a rate-limited provider check as rate limited, not unreachable", async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToLlmEgressProxy as Mock).mockResolvedValue(true);
      mockFetch.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });

      const result = await getIntelligenceStatus("user-1");

      expect(result).toEqual({
        available: false,
        ollamaConfigured: false,
        reason: "rate_limited",
      });
    });

    it("should return unavailable when provider check returns not compatible", async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToLlmEgressProxy as Mock).mockResolvedValue(true);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: false, reason: "provider_required" }),
      });

      const result = await getIntelligenceStatus('user-1');

      expect(result).toEqual({
        available: false,
        ollamaConfigured: false,
        reason: "provider_required",
      });
    });

    it("should return default reason when provider check is not compatible and reason is falsy", async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToLlmEgressProxy as Mock).mockResolvedValue(true);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: false }),
      });

      const result = await getIntelligenceStatus('user-1');

      expect(result).toEqual({
        available: false,
        ollamaConfigured: false,
        reason: "provider_required",
      });
    });

    it("should return unreachable when LLM egress proxy request fails", async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToLlmEgressProxy as Mock).mockResolvedValue(true);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

      const result = await getIntelligenceStatus('user-1');

      expect(result).toEqual({
        available: false,
        ollamaConfigured: false,
        reason: "llm_egress_proxy_unreachable",
      });
    });

    it("should return unreachable when fetch throws", async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToLlmEgressProxy as Mock).mockResolvedValue(true);

      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const result = await getIntelligenceStatus('user-1');

      expect(result).toEqual({
        available: false,
        ollamaConfigured: false,
        reason: "llm_egress_proxy_unreachable",
      });
    });
  });
}
