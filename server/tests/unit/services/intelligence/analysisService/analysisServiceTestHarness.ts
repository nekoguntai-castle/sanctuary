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
    mockSyncConfigToContainer: vi.fn(),
    mockGetContainerUrl: vi.fn(() => 'http://ai:3100'),
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
  syncConfigToContainer: analysisServiceMocks.mockSyncConfigToContainer,
  getContainerUrl: analysisServiceMocks.mockGetContainerUrl,
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
export const mockSyncConfigToContainer = analysisServiceMocks.mockSyncConfigToContainer;
export const mockGetContainerUrl = analysisServiceMocks.mockGetContainerUrl;
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
  endpoint: 'http://ollama:11434',
  model: 'llama3',
};

export function setupAnalysisServiceMocks(): void {
  vi.clearAllMocks();
  redis.exists.mockResolvedValue(0);
  redis.set.mockResolvedValue('OK');
  (mockIsRedisConnected as Mock).mockReturnValue(true);
  (mockGetRedisClient as Mock).mockReturnValue(redis);
}
