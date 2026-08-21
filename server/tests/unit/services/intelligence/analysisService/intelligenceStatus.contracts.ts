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

      const result = await getIntelligenceStatus();

      expect(result).toEqual({
        available: false,
        ollamaConfigured: false,
        reason: "ai_not_configured",
      });
    });

    it("should report the proxy unavailable without probing stale config when sync fails", async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToLlmEgressProxy as Mock).mockResolvedValue(false);

      const result = await getIntelligenceStatus();

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

      const result = await getIntelligenceStatus();

      expect(result).toEqual({
        available: true,
        ollamaConfigured: true,
        endpointType: "host",
      });
    });

    it("should return unavailable when provider check returns not compatible", async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToLlmEgressProxy as Mock).mockResolvedValue(true);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: false, reason: "provider_required" }),
      });

      const result = await getIntelligenceStatus();

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

      const result = await getIntelligenceStatus();

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

      const result = await getIntelligenceStatus();

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

      const result = await getIntelligenceStatus();

      expect(result).toEqual({
        available: false,
        ollamaConfigured: false,
        reason: "llm_egress_proxy_unreachable",
      });
    });
  });
}
