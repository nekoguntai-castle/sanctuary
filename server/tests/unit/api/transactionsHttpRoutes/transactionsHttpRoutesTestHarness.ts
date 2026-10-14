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
  mockGetPSBTInfoWithNetwork,
  mockFetch,
  mockEvaluatePolicies,
  mockRecordUsage,
  mockReserveEnforcedUsage,
  mockReleasePolicyUsage,
  mockWalletFindById,
  mockWalletFindByIdWithDevices,
  mockWalletFindNetwork,
  mockDraftFindByIdInWallet,
  mockFindAddressStrings,
  mockFindUtxosByOutpointsForWallet,
  mockCreateSigningIntent,
  mockValidateSignedArtifact,
  mockFindLinkedDraft,
  mockAssertWalletHardwareCapabilityById,
  mockLoadSigningIntent,
  mockFindHeldPolicyReservations,
  mockBuildIntentPolicyInput,
  DefiniteBroadcastRejectionError,
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
  mockGetPSBTInfoWithNetwork: vi.fn(),
  mockFetch: vi.fn(),
  mockEvaluatePolicies: vi.fn(),
  mockRecordUsage: vi.fn(),
  mockReserveEnforcedUsage: vi.fn(),
  mockReleasePolicyUsage: vi.fn(),
  mockWalletFindById: vi.fn(),
  mockWalletFindByIdWithDevices: vi.fn(),
  mockWalletFindNetwork: vi.fn(),
  mockDraftFindByIdInWallet: vi.fn(),
  mockFindAddressStrings: vi.fn(),
  mockFindUtxosByOutpointsForWallet: vi.fn(),
  mockCreateSigningIntent: vi.fn(),
  mockValidateSignedArtifact: vi.fn(),
  mockFindLinkedDraft: vi.fn(),
  mockAssertWalletHardwareCapabilityById: vi.fn(),
  mockLoadSigningIntent: vi.fn(),
  mockFindHeldPolicyReservations: vi.fn(),
  mockBuildIntentPolicyInput: vi.fn(),
  DefiniteBroadcastRejectionError: class DefiniteBroadcastRejectionError extends Error {},
}));

vi.mock('../../../../src/services/hardwareWalletCapabilities', () => ({
  assertWalletHardwareCapabilityById: mockAssertWalletHardwareCapabilityById,
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
      findByIdWithDevices: mockWalletFindByIdWithDevices,
      findNetwork: mockWalletFindNetwork,
    },
  };
});

vi.mock('../../../../src/repositories/draftRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/repositories/draftRepository')>();
  return {
    ...actual,
    draftRepository: {
      ...actual.draftRepository,
      findByIdInWallet: mockDraftFindByIdInWallet,
    },
  };
});

vi.mock('../../../../src/repositories/addressRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/repositories/addressRepository')>();
  return {
    ...actual,
    addressRepository: {
      ...actual.addressRepository,
      findAddressStrings: mockFindAddressStrings,
    },
  };
});

vi.mock('../../../../src/repositories/utxoRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/repositories/utxoRepository')>();
  return {
    ...actual,
    findByOutpointsForWallet: mockFindUtxosByOutpointsForWallet,
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

vi.mock('../../../../src/services/bitcoin/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/services/bitcoin/utils')>();
  return {
    ...actual,
    validateAddress: mockValidateAddress,
  };
});

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
  getPSBTInfoWithNetwork: mockGetPSBTInfoWithNetwork,
}));

vi.mock('../../../../src/services/bitcoin/transactions/broadcasting', async () => {
  // Named picks, not a spread: the actual module re-exports from the mocked
  // blockchain barrel, whose missing members throw when read.
  const actual = await vi.importActual<
    typeof import('../../../../src/services/bitcoin/transactions/broadcasting')
  >('../../../../src/services/bitcoin/transactions/broadcasting');
  return {
    broadcastAndSave: mockBroadcastAndSave,
    DefiniteBroadcastRejectionError,
    PreNetworkBroadcastRejectionError: actual.PreNetworkBroadcastRejectionError,
    readBroadcastFailureTag: actual.readBroadcastFailureTag,
  };
});

vi.mock('../../../../src/services/bitcoin/signingIntent', async () => {
  const { deriveIntentSpend } = await vi.importActual<
    typeof import('../../../../src/services/bitcoin/signingIntent/intentSpend')
  >('../../../../src/services/bitcoin/signingIntent/intentSpend');
  return {
    createSigningIntent: mockCreateSigningIntent,
    validateSignedArtifact: mockValidateSignedArtifact,
    findDraftBySigningIntent: mockFindLinkedDraft,
    loadSigningIntent: mockLoadSigningIntent,
    findHeldPolicyReservations: mockFindHeldPolicyReservations,
    deriveIntentSpend,
  };
});

vi.mock('../../../../src/services/vaultPolicy/intentPolicyInput', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../src/services/vaultPolicy/intentPolicyInput')>(),
  buildIntentPolicyInput: mockBuildIntentPolicyInput,
}));

vi.mock('../../../../src/services/vaultPolicy', () => ({
  policyEvaluationEngine: {
    evaluatePolicies: mockEvaluatePolicies,
    recordUsage: mockRecordUsage,
    reserveEnforcedUsage: mockReserveEnforcedUsage,
    releasePolicyUsage: mockReleasePolicyUsage,
  },
}));

import { errorHandler } from '../../../../src/errors/errorHandler';
import walletTransactionsRouter from '../../../../src/api/transactions/walletTransactions';
import creationRouter from '../../../../src/api/transactions/creation';


export let app: Express;
export const walletId = 'wallet-123';

/** A v2 envelope as loadSigningIntent returns it for a freshly minted intent. */
export const mintedIntentEnvelope = () => ({
  intentId: 'intent-http',
  intentDigest: 'a'.repeat(64),
  unsignedPsbtBase64: 'cHNi',
  unsignedPsbtSha256: 'f'.repeat(64),
  source: 'standard',
  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  snapshot: {
    version: 2,
    walletId,
    network: 'testnet4',
    feePolicy: {
      version: 1,
      expectedFeeSats: 150,
      requestedFeeRateSatsPerVbyte: 1,
      roundingMode: 'ceil',
      roundingToleranceSats: 0,
    },
    transaction: {
      version: 2,
      locktime: 0,
      inputs: [{
        txid: 'b'.repeat(64),
        vout: 0,
        sequence: 0xfffffffd,
        prevout: { amountSats: '10150', scriptPubKeyHex: `0014${'1'.repeat(40)}`, role: 'wallet' },
      }],
      outputs: [{ amountSats: '10000', scriptPubKeyHex: `0014${'2'.repeat(40)}` }],
    },
  },
});

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
    mockReserveEnforcedUsage.mockResolvedValue({ ok: true, reservations: [] });
    mockReleasePolicyUsage.mockResolvedValue(undefined);
    mockWalletFindNetwork.mockResolvedValue('testnet4');
    mockAssertWalletHardwareCapabilityById.mockResolvedValue(undefined);
    mockWalletFindByIdWithDevices.mockImplementation(async (walletId: string) => ({
      id: walletId,
      devices: [{ device: { type: 'coldcard', model: null } }],
    }));
    mockDraftFindByIdInWallet.mockResolvedValue(null);
    mockFindLinkedDraft.mockResolvedValue(null);
    mockFindAddressStrings.mockResolvedValue(['tb1qchange']);
    mockFindUtxosByOutpointsForWallet.mockResolvedValue([]);
    mockCreateSigningIntent.mockResolvedValue({
      intentId: 'intent-http',
      intentDigest: 'a'.repeat(64),
    });
    mockLoadSigningIntent.mockResolvedValue(mintedIntentEnvelope());
    mockFindHeldPolicyReservations.mockResolvedValue(null);
    mockBuildIntentPolicyInput.mockImplementation(async (_walletId: string, userId: string) => ({
      walletId, userId, recipient: 'tb1qrecipient', amount: BigInt(10000),
      outputs: [{ address: 'tb1qrecipient', amount: 10000 }],
    }));
    mockValidateSignedArtifact.mockResolvedValue({
      rawTx: 'deadbeef',
      txid: 'd'.repeat(64),
      walletId,
      network: 'testnet4',
      intent: {
        intentId: 'intent-http',
        intentDigest: 'a'.repeat(64),
      },
      snapshot: {
        version: 1,
        walletId,
        network: 'testnet4',
        transaction: {
          version: 2,
          locktime: 0,
          inputs: [{
            txid: 'b'.repeat(64),
            vout: 0,
            sequence: 0xfffffffd,
            prevout: {
              amountSats: '20400',
              scriptPubKeyHex: `0014${'1'.repeat(40)}`,
              role: 'wallet',
            },
          }],
          outputs: [{
            amountSats: '20000',
            scriptPubKeyHex: `0014${'2'.repeat(40)}`,
          }],
        },
      },
    });
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
      persistenceStatus: 'complete',
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
    mockGetPSBTInfoWithNetwork.mockImplementation(mockGetPSBTInfo);
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
  mockGetPSBTInfoWithNetwork,
  mockFetch,
  mockEvaluatePolicies,
  mockRecordUsage,
  mockReserveEnforcedUsage,
  mockReleasePolicyUsage,
  mockWalletFindById,
  mockWalletFindByIdWithDevices,
  mockWalletFindNetwork,
  mockDraftFindByIdInWallet,
  mockFindAddressStrings,
  mockFindUtxosByOutpointsForWallet,
  mockCreateSigningIntent,
  mockValidateSignedArtifact,
  mockAssertWalletHardwareCapabilityById,
  mockLoadSigningIntent,
  mockFindHeldPolicyReservations,
  mockBuildIntentPolicyInput,
  DefiniteBroadcastRejectionError,
};
