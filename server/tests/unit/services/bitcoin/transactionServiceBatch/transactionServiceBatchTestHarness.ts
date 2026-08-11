import { beforeEach, vi } from 'vitest';
/**
 * Transaction Service Batch Test Harness
 *
 * Shared mocks and default setup for batch transaction contract tests.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../../../mocks/prisma';

const hoistedMocks = vi.hoisted(() => ({
  mockParseDescriptor: vi.fn(),
  mockNotifyNewTransactions: vi.fn(),
  mockEmitTransactionSent: vi.fn(),
  mockEmitTransactionReceived: vi.fn(),
  mockGetTransaction: vi.fn(),
}));

export const mockParseDescriptor = hoistedMocks.mockParseDescriptor;
export const mockNotifyNewTransactions = hoistedMocks.mockNotifyNewTransactions;
export const mockEmitTransactionSent = hoistedMocks.mockEmitTransactionSent;
export const mockEmitTransactionReceived = hoistedMocks.mockEmitTransactionReceived;
export const mockGetTransaction = hoistedMocks.mockGetTransaction;

vi.mock('../../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
  withTransaction: (fn: (tx: any) => Promise<any>) => mockPrismaClient.$transaction(fn),
}));

vi.mock('../../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue({
    getTransaction: hoistedMocks.mockGetTransaction,
    broadcastTransaction: vi.fn().mockResolvedValue('mock-txid'),
    getBlockHeight: vi.fn().mockResolvedValue(800000),
  }),
}));

vi.mock('../../../../../src/services/bitcoin/electrum', () => ({
  getElectrumClient: vi.fn().mockReturnValue({
    connect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    getTransaction: vi.fn().mockResolvedValue(null),
  }),
}));

vi.mock('../../../../../src/services/bitcoin/blockchain', () => ({
  broadcastTransaction: vi.fn().mockResolvedValue({ txid: 'mock-txid', broadcasted: true }),
  recalculateWalletBalances: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../../src/services/eventService', () => ({
  eventService: {
    emitTransactionSent: hoistedMocks.mockEmitTransactionSent,
    emitTransactionReceived: hoistedMocks.mockEmitTransactionReceived,
  },
}));

vi.mock('../../../../../src/services/notifications/notificationService', () => ({
  notifyNewTransactions: hoistedMocks.mockNotifyNewTransactions,
}));

vi.mock('../../../../../src/services/bitcoin/addressDerivation', () => ({
  parseDescriptor: hoistedMocks.mockParseDescriptor,
  convertToStandardXpub: vi.fn().mockImplementation((xpub: string) => xpub),
}));

vi.mock('../../../../../src/services/wallet/canonicalAddressValidation', () => ({
  assertCanonicalAddressesForWallet: vi.fn().mockResolvedValue(undefined),
  assertCanonicalAddressesMatchWallet: vi.fn(),
}));

export function registerBatchTransactionTestSetup() {
  beforeEach(() => {
    resetPrismaMocks();
    mockNotifyNewTransactions.mockReset();
    mockNotifyNewTransactions.mockResolvedValue(undefined);
    mockEmitTransactionSent.mockReset();
    mockEmitTransactionReceived.mockReset();
    mockGetTransaction.mockReset();
    mockGetTransaction.mockResolvedValue('0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000');
    // Set up default system settings
    mockPrismaClient.systemSetting.findUnique.mockImplementation((query: any) => {
      if (query.where.key === 'confirmationThreshold') {
        return Promise.resolve({ key: 'confirmationThreshold', value: '1' });
      }
      if (query.where.key === 'dustThreshold') {
        return Promise.resolve({ key: 'dustThreshold', value: '546' });
      }
      return Promise.resolve(null);
    });
    mockParseDescriptor.mockImplementation((descriptor: string) => {
      const keys = [...descriptor.matchAll(/\[([0-9a-f]{8})\/([^\]]+)]([^/,)]+)\/(0|1)\/\*/g)]
        .map(match => ({
          fingerprint: match[1],
          accountPath: match[2],
          xpub: match[3],
          derivationPath: `${match[4]}/*`,
        }));
      if (keys.length > 1) {
        return {
          type: descriptor.startsWith('sh(') ? 'sh-wsh-sortedmulti' : 'wsh-sortedmulti',
          quorum: 2,
          keys,
        };
      }
      if (keys.length !== 1) throw new Error('invalid batch test descriptor');
      return {
        type: descriptor.startsWith('pkh(') ? 'pkh' : 'wpkh',
        ...keys[0],
        path: keys[0].derivationPath,
      };
    });
  });
}
