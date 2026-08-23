import { vi } from 'vitest';
import type { deriveCanonicalAddress } from '../../../../src/services/bitcoin/addressDerivation';

const { mockAssertWalletHardwareCapabilityById } = vi.hoisted(() => ({
  mockAssertWalletHardwareCapabilityById: vi.fn(),
}));
export { mockAssertWalletHardwareCapabilityById };

vi.mock('../../../../src/services/hardwareWalletCapabilities', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../src/services/hardwareWalletCapabilities')>(),
  assertWalletHardwareCapabilityById: mockAssertWalletHardwareCapabilityById,
}));

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
    createManyAndReturn: vi.fn<(args: { data: object[] }) => Promise<object[]>>()
      .mockImplementation(({ data }) => (
      Promise.resolve(data.map((row, index) => ({ ...row, id: `address-${index}` })))
      )),
    update: vi.fn<any>(),
  },
  addressSubscriptionCheckpoint: {
    createMany: vi.fn<any>().mockResolvedValue({ count: 0 }),
  },
  transaction: {
    findUnique: vi.fn<any>(),
    findFirst: vi.fn<any>(),
    findMany: vi.fn<any>(),
    create: vi.fn<any>(),
    createMany: vi.fn<any>().mockResolvedValue({ count: 1 }),
    createManyAndReturn: vi.fn<(args: { data: object[] }) => Promise<object[]>>().mockImplementation(({ data }) => (
      Promise.resolve(data.map((row: object, index: number) => ({
        ...row,
        id: `transaction-${index}`,
      })))
    )),
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
  transactionOwnershipRepair: {
    findMany: vi.fn<any>().mockResolvedValue([]),
    delete: vi.fn<any>(),
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
  $transaction: vi.fn<any>((operation: any) => (
    typeof operation === 'function'
      ? operation(mockPrisma)
      : Promise.all(operation)
  )),
  $queryRaw: vi.fn<any>().mockResolvedValue([]),
  $executeRaw: vi.fn<any>().mockResolvedValue(0),
};

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

export const mockNodeClient = {
  getAddressHistory: vi.fn<any>(),
  getAddressHistoryBatch: vi.fn<any>(),
  getTransaction: vi.fn<any>(),
  getTransactionsBatch: vi.fn<any>(async (txids: string[]) => new Map(
    (await Promise.all(txids.map(async txid => [txid, await (mockNodeClient.getTransaction as any)(txid)] as const)))
      .filter(([, details]) => details !== undefined && details !== null),
  )),
  getAddressUTXOs: vi.fn<any>(),
  getAddressUTXOsBatch: vi.fn<any>(),
  getAddressBalance: vi.fn<(address: string) => Promise<{ confirmed: number; unconfirmed: number }>>(),
  broadcastTransaction: vi.fn<any>(),
  estimateFee: vi.fn<(blocks: number) => Promise<number>>(),
  subscribeAddress: vi.fn<any>(),
  isConnected: vi.fn<any>(() => true),
  connect: vi.fn<any>(),
};

vi.mock('../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn(() => Promise.resolve(mockNodeClient)),
}));

vi.mock('../../../../src/services/wallet/canonicalAddressValidation', () => ({
  assertCanonicalAddressesMatchWallet: vi.fn((_wallet, addresses) => {
    for (const address of addresses) {
      address.scriptPubKey ??= `0014${'00'.repeat(20)}`;
    }
  }),
}));

// The sync context now derives each address's ownership script itself, so the
// fixtures below no longer get one as a side effect of the guard mock above.
// Their placeholder addresses ('bc1qwallet') decode on no network, and
// production correctly refuses to invent an anchor — so keep serving the same
// synthetic script these fixtures have always been written against.
vi.mock('../../../../src/services/bitcoin/utils', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../src/services/bitcoin/utils')>();
  return {
    ...actual,
    addressToOutputScript: vi.fn((address: string, network?: Parameters<typeof actual.addressToOutputScript>[1]) => {
      try {
        return actual.addressToOutputScript(address, network);
      } catch {
        return Buffer.from(`0014${'00'.repeat(20)}`, 'hex');
      }
    }),
  };
});

vi.mock('../../../../src/services/bitcoin/sync/evidenceAuthentication', () => ({
  authenticateHistoryResults: vi.fn(),
  fetchAuthenticatedTransactions: vi.fn(async (ctx, txids) => {
    const accepted = new Set<string>();
    let results = new Map<string, any>();
    try {
      results = await ctx.client.getTransactionsBatch(txids, false) ?? results;
    } catch { /* legacy fallback contracts */ }
    for (const txid of txids) {
      const details = results.get(txid)
        ?? await ctx.client.getTransaction(txid, false).catch(() => undefined);
      if (!details) continue;
      ctx.txDetailsCache.set(txid, details);
      accepted.add(txid);
    }
    return accepted;
  }),
}));

vi.mock('../../../../src/services/bitcoin/blockchain/receiveEvidenceAuthentication', () => ({
  authenticateTransactionDetails: vi.fn((_expectedTxid, candidate) => candidate),
}));

vi.mock('../../../../src/services/bitcoin/sync/phases/receiveEvidenceGate', () => ({
  receiveEvidenceGatePhase: vi.fn(async ctx => ctx),
}));

vi.mock('../../../../src/services/bitcoin/rawTransactionEvidence', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../src/services/bitcoin/rawTransactionEvidence')>();
  return {
    ...actual,
    authenticateRawTransactionOutput: vi.fn((input: any) => ({
      valueSats: input.expectedValueSats,
      scriptPubKeyHex: input.expectedScriptPubKeyHex,
    })),
  };
});

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

export const mockDeriveAddress = vi.fn<typeof deriveCanonicalAddress>();
vi.mock('../../../../src/services/bitcoin/addressDerivation', () => ({
  deriveCanonicalAddress: mockDeriveAddress,
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
