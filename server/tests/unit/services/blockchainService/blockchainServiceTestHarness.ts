import { vi } from 'vitest';

export const mockPrisma = {
  wallet: {
    findUnique: vi.fn<any>(),
    findMany: vi.fn<any>(),
  },
  address: {
    findUnique: vi.fn<any>(),
    findMany: vi.fn<any>(),
    updateMany: vi.fn<any>(),
    createMany: vi.fn<any>(),
    update: vi.fn<any>(),
  },
  transaction: {
    findUnique: vi.fn<any>(),
    findFirst: vi.fn<any>(),
    findMany: vi.fn<any>(),
    create: vi.fn<any>(),
    createMany: vi.fn<any>(),
    update: vi.fn<any>(),
    updateMany: vi.fn<any>(),
    delete: vi.fn<any>(),
  },
  transactionInput: {
    createMany: vi.fn<any>(),
  },
  transactionOutput: {
    createMany: vi.fn<any>(),
    updateMany: vi.fn<any>(),
  },
  uTXO: {
    findUnique: vi.fn<any>(),
    findMany: vi.fn<any>(),
    create: vi.fn<any>(),
    createMany: vi.fn<any>(),
    update: vi.fn<any>(),
    updateMany: vi.fn<any>(),
    delete: vi.fn<any>(),
  },
  draftUtxoLock: {
    findMany: vi.fn<any>(),
  },
  draftTransaction: {
    deleteMany: vi.fn<any>(),
  },
  addressLabel: {
    findMany: vi.fn<any>(),
  },
  transactionLabel: {
    createMany: vi.fn<any>(),
  },
  $transaction: vi.fn<any>((operations: any[]) => Promise.all(operations)),
};

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

export const mockNodeClient = {
  getAddressHistory: vi.fn<any>(),
  getAddressHistoryBatch: vi.fn<any>(),
  getTransaction: vi.fn<any>(),
  getTransactionsBatch: vi.fn<any>(),
  getAddressUTXOs: vi.fn<any>(),
  getAddressUTXOsBatch: vi.fn<any>(),
  getAddressBalance: vi.fn<any>(),
  broadcastTransaction: vi.fn<any>(),
  estimateFee: vi.fn<any>(),
  subscribeAddress: vi.fn<any>(),
  isConnected: vi.fn<any>(() => true),
  connect: vi.fn<any>(),
};

vi.mock('../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn(() => Promise.resolve(mockNodeClient)),
}));

export const mockElectrumPool = {
  isProxyEnabled: vi.fn<any>(() => false),
};

vi.mock('../../../../src/services/bitcoin/electrumPool', () => ({
  getElectrumPool: vi.fn(() => mockElectrumPool),
}));

vi.mock('../../../../src/services/bitcoin/utils/blockHeight', () => ({
  getCachedBlockHeight: vi.fn(() => 800000),
  setCachedBlockHeight: vi.fn(),
  getBlockHeight: vi.fn(() => Promise.resolve(800000)),
  getBlockTimestamp: vi.fn(() => Promise.resolve(new Date('2024-01-01T00:00:00Z'))),
}));

export const mockDeriveAddress = vi.fn<any>();
vi.mock('../../../../src/services/bitcoin/addressDerivation', () => ({
  deriveAddressFromDescriptor: mockDeriveAddress,
}));

vi.mock('../../../../src/websocket/notifications', () => ({
  walletLog: vi.fn(),
  getNotificationService: vi.fn(() => ({
    broadcastTransactionNotification: vi.fn(),
  })),
}));

vi.mock('../../../../src/services/notifications/notificationService', () => ({
  notifyNewTransactions: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../../src/config', () => ({
  getConfig: () => ({
    sync: { transactionBatchSize: 100 },
  }),
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('../../../../src/constants', () => ({
  ADDRESS_GAP_LIMIT: 20,
}));
