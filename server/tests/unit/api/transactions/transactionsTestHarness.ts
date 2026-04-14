import { beforeEach, vi, type Mock } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import {
  createMockRequest,
  createMockResponse,
  randomTxid,
  randomAddress,
} from '../../../helpers/testUtils';

// Mock Prisma with async factory to handle hoisting
vi.mock('../../../../src/models/prisma', async () => {
  const { mockPrismaClient: prisma } = await import('../../../mocks/prisma');
  return {
    __esModule: true,
    default: prisma,
  };
});

// Mock blockchain service
vi.mock('../../../../src/services/bitcoin/blockchain', () => ({
  getBlockHeight: vi.fn().mockResolvedValue(850000),
  getCachedBlockHeight: vi.fn().mockReturnValue(850000),
  broadcastTransaction: vi.fn().mockResolvedValue('mock-txid'),
}));

// Mock wallet service
vi.mock('../../../../src/services/wallet', () => ({
  checkWalletAccess: vi.fn().mockResolvedValue(true),
  checkWalletEditAccess: vi.fn().mockResolvedValue(true),
}));

// Mock address derivation
vi.mock('../../../../src/services/bitcoin/addressDerivation', () => ({
  generateNextAddress: vi.fn().mockResolvedValue({
    address: 'tb1qtest123',
    derivationPath: "m/84'/1'/0'/0/0",
  }),
}));

// Mock audit service
vi.mock('../../../../src/services/auditService', () => ({
  auditService: {
    log: vi.fn().mockResolvedValue(undefined),
    logFromRequest: vi.fn().mockResolvedValue(undefined),
  },
  AuditAction: {
    TRANSACTION_BROADCAST: 'TRANSACTION_BROADCAST',
    TRANSACTION_CREATE: 'TRANSACTION_CREATE',
  },
  AuditCategory: {
    TRANSACTION: 'TRANSACTION',
  },
}));

// Mock fetch for mempool.space API
global.fetch = vi.fn();

// Import mocked modules for use in tests
import * as blockchain from '../../../../src/services/bitcoin/blockchain';
import * as addressDerivation from '../../../../src/services/bitcoin/addressDerivation';

export {
  addressDerivation,
  blockchain,
  createMockRequest,
  createMockResponse,
  mockPrismaClient,
  randomAddress,
  randomTxid,
};

export function setupTransactionsApiTestHooks(): void {
  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
    (global.fetch as Mock).mockReset();
  });
}
