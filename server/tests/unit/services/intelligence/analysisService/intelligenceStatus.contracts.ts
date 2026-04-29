import { describe, expect, it, type Mock } from "vitest";
import {
  mockFetch,
  mockGetAIConfig,
  mockSyncConfigToContainer,
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

    it("should return available when the configured provider is reachable", async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true, endpointType: "container" }),
      });

      const result = await getIntelligenceStatus();

      expect(result).toEqual({
        available: true,
        ollamaConfigured: true,
        endpointType: "container",
      });
    });

    it("should return unavailable when provider check returns not compatible", async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

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
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

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

    it("should return unreachable when AI container request fails", async () => {
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
        reason: "ai_container_unreachable",
      });
    });

    it("should return unreachable when fetch throws", async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const result = await getIntelligenceStatus();

      expect(result).toEqual({
        available: false,
        ollamaConfigured: false,
        reason: "ai_container_unreachable",
      });
    });
  });
}
