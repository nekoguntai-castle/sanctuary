import { describe, expect, it, type Mock } from 'vitest';
import {
  mockFetch,
  mockGetAIConfig,
  mockSyncConfigToContainer,
  validConfig,
} from './analysisServiceTestHarness';
import { getIntelligenceStatus } from '../../../../../src/services/intelligence/analysisService';

export function registerIntelligenceStatusContracts(): void {
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

    it('should return default reason when Ollama check is not compatible and reason is falsy', async () => {
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
}
