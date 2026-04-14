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
}));

export const mockParseDescriptor = hoistedMocks.mockParseDescriptor;
export const mockNotifyNewTransactions = hoistedMocks.mockNotifyNewTransactions;
export const mockEmitTransactionSent = hoistedMocks.mockEmitTransactionSent;
export const mockEmitTransactionReceived = hoistedMocks.mockEmitTransactionReceived;

vi.mock('../../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
  withTransaction: (fn: (tx: any) => Promise<any>) => mockPrismaClient.$transaction(fn),
}));

vi.mock('../../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue({
    getTransaction: vi.fn().mockResolvedValue('0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000'),
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

export function registerBatchTransactionTestSetup() {
  beforeEach(() => {
    resetPrismaMocks();
    mockNotifyNewTransactions.mockReset();
    mockNotifyNewTransactions.mockResolvedValue(undefined);
    mockEmitTransactionSent.mockReset();
    mockEmitTransactionReceived.mockReset();
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
    // Set up mockParseDescriptor implementation - supports both single-sig and multisig
    // Using only 2 keys for 2-of-2 multisig (both keys are valid testnet tpubs)
    mockParseDescriptor.mockImplementation((descriptor: string) => {
      // Check if it's a multisig descriptor
      if (descriptor.startsWith('wsh(sortedmulti(') || descriptor.startsWith('wsh(multi(')) {
        return {
          type: 'wsh-sortedmulti',
          quorum: 2,
          keys: [
            {
              fingerprint: 'aabbccdd',
              accountPath: "48'/1'/0'/2'",
              xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
              derivationPath: '0/*',
            },
            {
              fingerprint: 'eeff0011',
              accountPath: "48'/1'/0'/2'",
              xpub: 'tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba',
              derivationPath: '0/*',
            },
          ],
        };
      }
      if (descriptor.startsWith('sh(wsh(sortedmulti(') || descriptor.startsWith('sh(wsh(multi(')) {
        return {
          type: 'sh-wsh-sortedmulti',
          quorum: 2,
          keys: [
            {
              fingerprint: 'aabbccdd',
              accountPath: "48'/1'/0'/1'",
              xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
              derivationPath: '0/*',
            },
            {
              fingerprint: 'eeff0011',
              accountPath: "48'/1'/0'/1'",
              xpub: 'tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba',
              derivationPath: '0/*',
            },
          ],
        };
      }
      // Single-sig descriptor
      return {
        type: 'wpkh',
        xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
        fingerprint: 'aabbccdd',
        accountPath: "84'/1'/0'",
      };
    });
  });
}
