import { vi, type Mock } from 'vitest';

const analysisServiceMocks = vi.hoisted(() => {
  const redis = {
    exists: vi.fn(),
    set: vi.fn(),
  };

  return {
    mockGetRedisClient: vi.fn(() => redis),
    mockIsRedisConnected: vi.fn(() => true),
    mockGetAIConfig: vi.fn(),
    mockSyncConfigToLlmEgressProxy: vi.fn(),
    mockGetLlmEgressProxyUrl: vi.fn(() => 'http://llm-egress-proxy:3100'),
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

vi.mock('../../../../../src/infrastructure', () => ({
  getRedisClient: analysisServiceMocks.mockGetRedisClient,
  isRedisConnected: analysisServiceMocks.mockIsRedisConnected,
}));

vi.mock('../../../../../src/services/ai/config', () => ({
  getAIConfig: analysisServiceMocks.mockGetAIConfig,
  syncConfigToLlmEgressProxy: analysisServiceMocks.mockSyncConfigToLlmEgressProxy,
  getLlmEgressProxyUrl: analysisServiceMocks.mockGetLlmEgressProxyUrl,
  ensureLlmProxyConfigured: async (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const config = await analysisServiceMocks.mockGetAIConfig();
    signal?.throwIfAborted();
    if (!config.enabled || !config.endpoint || !config.model) {
      return { ready: false, reason: 'provider_not_configured' };
    }
    const synced = await analysisServiceMocks.mockSyncConfigToLlmEgressProxy(config);
    signal?.throwIfAborted();
    return synced === true
      ? { ready: true, config }
      : {
          ready: false,
          reason: 'provider_config_sync_failed',
          syncResult: { success: false },
        };
  },
}));

vi.mock('../../../../../src/repositories/intelligenceRepository', () => ({
  intelligenceRepository: {
    createInsight: analysisServiceMocks.mockCreateInsight,
    getTransactionVelocity: analysisServiceMocks.mockGetTransactionVelocity,
    getUtxoAgeDistribution: analysisServiceMocks.mockGetUtxoAgeDistribution,
  },
}));

vi.mock('../../../../../src/services/intelligence/settings', () => ({
  getEnabledIntelligenceWallets: analysisServiceMocks.mockGetEnabledIntelligenceWallets,
}));

vi.mock('../../../../../src/services/notifications/channels', () => ({
  notificationChannelRegistry: analysisServiceMocks.mockNotificationChannelRegistry,
}));

vi.mock('../../../../../src/services/autopilot/utxoHealth', () => ({
  getUtxoHealthProfile: analysisServiceMocks.mockGetUtxoHealthProfile,
}));

vi.mock('../../../../../src/services/autopilot/feeMonitor', () => ({
  getRecentFees: analysisServiceMocks.mockGetRecentFees,
  getLatestFeeSnapshot: analysisServiceMocks.mockGetLatestFeeSnapshot,
}));

vi.mock('../../../../../src/utils/logger', () => ({
  createLogger: () => analysisServiceMocks.mockLogger,
}));

vi.mock('../../../../../src/utils/errors', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

export const mockGetRedisClient = analysisServiceMocks.mockGetRedisClient;
export const mockIsRedisConnected = analysisServiceMocks.mockIsRedisConnected;
export const mockGetAIConfig = analysisServiceMocks.mockGetAIConfig;
export const mockSyncConfigToLlmEgressProxy = analysisServiceMocks.mockSyncConfigToLlmEgressProxy;
export const mockGetLlmEgressProxyUrl = analysisServiceMocks.mockGetLlmEgressProxyUrl;
export const mockGetEnabledIntelligenceWallets = analysisServiceMocks.mockGetEnabledIntelligenceWallets;
export const mockNotificationChannelRegistry = analysisServiceMocks.mockNotificationChannelRegistry;
export const mockCreateInsight = analysisServiceMocks.mockCreateInsight;
export const mockGetTransactionVelocity = analysisServiceMocks.mockGetTransactionVelocity;
export const mockGetUtxoAgeDistribution = analysisServiceMocks.mockGetUtxoAgeDistribution;
export const mockGetUtxoHealthProfile = analysisServiceMocks.mockGetUtxoHealthProfile;
export const mockGetRecentFees = analysisServiceMocks.mockGetRecentFees;
export const mockGetLatestFeeSnapshot = analysisServiceMocks.mockGetLatestFeeSnapshot;
export const mockLogger = analysisServiceMocks.mockLogger;
export const redis = analysisServiceMocks.redis;

export const mockFetch = vi.fn();
global.fetch = mockFetch;

export const validConfig = {
  enabled: true,
  endpoint: 'http://host.docker.internal:11434',
  model: 'llama3',
};

export function setupAnalysisServiceMocks(): void {
  vi.clearAllMocks();
  analysisServiceMocks.mockSyncConfigToLlmEgressProxy.mockResolvedValue(true);
  redis.exists.mockResolvedValue(0);
  redis.set.mockResolvedValue('OK');
  (mockIsRedisConnected as Mock).mockReturnValue(true);
  (mockGetRedisClient as Mock).mockReturnValue(redis);
}
