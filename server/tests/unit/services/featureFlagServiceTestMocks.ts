import { vi } from 'vitest';

// Hoist all mocks
const { mockPrisma, mockCache, mockConfig, mockEventBus, mockRedis, mockLogger, runtimeState } = vi.hoisted(() => {
  const runtimeState = { generation: '0' };
  const mockPrisma = {
    featureFlag: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
    },
    featureFlagAudit: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    systemSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn((arg: any) => {
      // Support both batched transactions (array) and interactive transactions (callback)
      if (typeof arg === 'function') {
        return arg(mockPrisma);
      }
      return Promise.all(arg);
    }),
  };

  const mockCache = {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  };

  const mockEventBus = {
    on: vi.fn(),
    emit: vi.fn(),
    emitAsync: vi.fn(),
  };

  const mockRedis = {
    set: vi.fn(),
    keys: vi.fn(),
    mget: vi.fn(),
  };

  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const mockConfig = {
    features: {
      hardwareWalletSigning: true,
      qrCodeSigning: true,
      multisigWallets: true,
      batchSync: false,
      payjoinSupport: false,
      batchTransactions: true,
      rbfTransactions: true,
      priceAlerts: false,
      aiAssistant: false,
      sanctuaryConsole: false,
      telegramNotifications: false,
      websocketV2Events: true,
      treasuryAutopilot: false,
      treasuryIntelligence: false,
      experimental: {
        taprootAddresses: false,
        silentPayments: false,
      },
    },
  };

  return {
    mockPrisma,
    mockCache,
    mockConfig,
    mockEventBus,
    mockRedis,
    mockLogger,
    runtimeState,
  };
});

// Mock dependencies
vi.mock('../../../src/models/prisma', () => ({
  default: mockPrisma,
}));

vi.mock('../../../src/infrastructure', () => ({
  getDistributedCache: () => mockCache,
  getDistributedEventBus: () => mockEventBus,
  getRedisClient: () => mockRedis,
}));

vi.mock('../../../src/config', () => ({
  getConfig: () => mockConfig,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

export { mockPrisma, mockCache, mockConfig, mockEventBus, mockRedis, mockLogger, runtimeState };
