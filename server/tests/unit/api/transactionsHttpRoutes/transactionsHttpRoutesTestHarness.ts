import { afterAll, beforeAll, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import { resetPrismaMocks } from '../../../mocks/prisma';

const {
  mockGetCachedBlockHeight,
  mockRecalculateWalletBalances,
  mockWalletCacheGet,
  mockWalletCacheSet,
  mockValidateAddress,
  mockAuditLogFromRequest,
  mockCreateTransaction,
  mockCreateBatchTransaction,
  mockBroadcastAndSave,
  mockEstimateTransaction,
  mockGetPSBTInfo,
  mockFetch,
  mockEvaluatePolicies,
  mockRecordUsage,
  mockWalletFindById,
} = vi.hoisted(() => ({
  mockGetCachedBlockHeight: vi.fn(),
  mockRecalculateWalletBalances: vi.fn(),
  mockWalletCacheGet: vi.fn(),
  mockWalletCacheSet: vi.fn(),
  mockValidateAddress: vi.fn(),
  mockAuditLogFromRequest: vi.fn(),
  mockCreateTransaction: vi.fn(),
  mockCreateBatchTransaction: vi.fn(),
  mockBroadcastAndSave: vi.fn(),
  mockEstimateTransaction: vi.fn(),
  mockGetPSBTInfo: vi.fn(),
  mockFetch: vi.fn(),
  mockEvaluatePolicies: vi.fn(),
  mockRecordUsage: vi.fn(),
  mockWalletFindById: vi.fn(),
}));

vi.mock('../../../../src/models/prisma', async () => {
  const { mockPrismaClient: prisma } = await import('../../../mocks/prisma');
  return {
    __esModule: true,
    default: prisma,
  };
});

vi.mock('../../../../src/repositories/walletRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/repositories/walletRepository')>();
  return {
    ...actual,
    walletRepository: {
      ...actual.walletRepository,
      findById: mockWalletFindById,
    },
  };
});

vi.mock('../../../../src/middleware/walletAccess', () => ({
  requireWalletAccess: () => (req: any, _res: any, next: () => void) => {
    req.walletId = req.params.walletId || req.params.id;
    req.user = req.user || { userId: 'test-user-id' };
    next();
  },
}));

vi.mock('../../../../src/services/bitcoin/blockchain', () => ({
  getCachedBlockHeight: mockGetCachedBlockHeight,
  recalculateWalletBalances: mockRecalculateWalletBalances,
}));

vi.mock('../../../../src/services/cache', () => ({
  walletCache: {
    get: mockWalletCacheGet,
    set: mockWalletCacheSet,
  },
}));

vi.mock('../../../../src/services/bitcoin/utils', () => ({
  validateAddress: mockValidateAddress,
}));

vi.mock('../../../../src/services/auditService', () => ({
  auditService: {
    logFromRequest: mockAuditLogFromRequest,
  },
  AuditCategory: {
    WALLET: 'WALLET',
  },
  AuditAction: {
    TRANSACTION_BROADCAST: 'TRANSACTION_BROADCAST',
    TRANSACTION_BROADCAST_FAILED: 'TRANSACTION_BROADCAST_FAILED',
  },
}));

vi.mock('../../../../src/services/bitcoin/transactionService', () => ({
  createTransaction: mockCreateTransaction,
  createBatchTransaction: mockCreateBatchTransaction,
  broadcastAndSave: mockBroadcastAndSave,
  estimateTransaction: mockEstimateTransaction,
  getPSBTInfo: mockGetPSBTInfo,
}));

vi.mock('../../../../src/services/vaultPolicy', () => ({
  policyEvaluationEngine: {
    evaluatePolicies: mockEvaluatePolicies,
    recordUsage: mockRecordUsage,
  },
}));

import { errorHandler } from '../../../../src/errors/errorHandler';
import walletTransactionsRouter from '../../../../src/api/transactions/walletTransactions';
import creationRouter from '../../../../src/api/transactions/creation';


export let app: Express;
export const walletId = 'wallet-123';

export function setupTransactionHttpRouteHooks(): void {
  beforeAll(() => {
    vi.stubGlobal('fetch', mockFetch);
    app = express();
    app.use(express.json());
    app.use('/api/v1', walletTransactionsRouter);
    app.use('/api/v1', creationRouter);
    app.use(errorHandler);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();

    mockGetCachedBlockHeight.mockReturnValue(850000);
    mockRecalculateWalletBalances.mockResolvedValue(undefined);
    mockWalletCacheGet.mockResolvedValue(null);
    mockWalletCacheSet.mockResolvedValue(undefined);
    mockEvaluatePolicies.mockResolvedValue({ allowed: true, triggered: [] });
    mockRecordUsage.mockResolvedValue(undefined);
    mockValidateAddress.mockReturnValue({ valid: true });
    mockAuditLogFromRequest.mockResolvedValue(undefined);
    mockCreateTransaction.mockResolvedValue({
      psbtBase64: 'cHNi',
      fee: 150,
      totalInput: 10150,
      totalOutput: 10000,
      changeAmount: 0,
      changeAddress: null,
      utxos: [],
      inputPaths: {},
      effectiveAmount: 10000,
      decoyOutputs: [],
    });
    mockCreateBatchTransaction.mockResolvedValue({
      psbtBase64: 'cHNi',
      fee: 250,
      totalInput: 20250,
      totalOutput: 20000,
      changeAmount: 0,
      changeAddress: null,
      utxos: [],
      inputPaths: {},
      outputs: [{ address: 'tb1qrecipient', amount: 20000 }],
    });
    mockBroadcastAndSave.mockResolvedValue({
      txid: 'a'.repeat(64),
      broadcasted: true,
    });
    mockEstimateTransaction.mockResolvedValue({
      fee: 120,
      totalInput: 20120,
      totalOutput: 20000,
    });
    mockGetPSBTInfo.mockReturnValue({
      fee: 400,
      outputs: [{ address: 'tb1qrecipient', value: 20000 }],
      inputs: [{ txid: 'b'.repeat(64), vout: 0 }],
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ weight: 560, fee: 500 }),
    });
  });
}

export {
  mockGetCachedBlockHeight,
  mockRecalculateWalletBalances,
  mockWalletCacheGet,
  mockWalletCacheSet,
  mockValidateAddress,
  mockAuditLogFromRequest,
  mockCreateTransaction,
  mockCreateBatchTransaction,
  mockBroadcastAndSave,
  mockEstimateTransaction,
  mockGetPSBTInfo,
  mockFetch,
  mockEvaluatePolicies,
  mockRecordUsage,
  mockWalletFindById,
};
