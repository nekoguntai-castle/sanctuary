import { beforeAll, beforeEach, vi } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../../../mocks/prisma';
import {
  mockElectrumClient,
  resetElectrumMocks,
} from '../../../../mocks/electrum';

const { mockAssertWalletHardwareCapabilityById } = vi.hoisted(() => ({
  mockAssertWalletHardwareCapabilityById: vi.fn(),
}));
export { mockAssertWalletHardwareCapabilityById };

vi.mock('../../../../../src/services/hardwareWalletCapabilities', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../../src/services/hardwareWalletCapabilities')>(),
  assertWalletHardwareCapabilityById: mockAssertWalletHardwareCapabilityById,
}));

vi.mock('../../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

vi.mock('../../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue(mockElectrumClient),
}));

vi.mock('../../../../../src/services/bitcoin/utils', () => ({
  validateAddress: vi.fn().mockReturnValue({ valid: true }),
  parseTransaction: vi.fn(),
  getNetwork: vi.fn().mockReturnValue(require('bitcoinjs-lib').networks.testnet),
}));

vi.mock('../../../../../src/websocket/notifications', () => ({
  walletLog: vi.fn(),
  getNotificationService: vi.fn().mockReturnValue({
    broadcastTransactionNotification: vi.fn(),
  }),
}));

vi.mock('../../../../../src/services/notifications/notificationService', () => ({
  notifyNewTransactions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../../src/services/bitcoin/addressDerivation', () => ({
  deriveCanonicalAddress: vi.fn().mockImplementation((_descriptors, coordinate) => ({
    address: `tb1q_test_${coordinate.branch}_${coordinate.index}`,
    derivationPath: `m/84'/0'/0'/${coordinate.branch}/${coordinate.index}`,
    scriptPubKey: `0014${'00'.repeat(20)}`,
    branch: coordinate.branch,
    index: coordinate.index,
    signerOrigins: [],
  })),
  deriveAddressFromDescriptor: vi.fn().mockImplementation((descriptor, index, options) => {
    const change = options?.change ? 1 : 0;
    return {
      address: `tb1q_test_${change}_${index}`,
      derivationPath: `m/84'/0'/0'/${change}/${index}`,
      publicKey: Buffer.from('02' + '00'.repeat(32), 'hex'),
    };
  }),
}));

type BlockchainServiceModule = typeof import('../../../../../src/services/bitcoin/blockchain');

let blockchainService: BlockchainServiceModule;

export function setupBlockchainServiceTestHooks(): void {
  beforeAll(async () => {
    blockchainService = await import('../../../../../src/services/bitcoin/blockchain');
  });

  beforeEach(() => {
    resetPrismaMocks();
    resetElectrumMocks();
    mockAssertWalletHardwareCapabilityById.mockResolvedValue(undefined);
  });
}

export function getBlockchainService(): BlockchainServiceModule {
  return blockchainService;
}

interface LockedBranchSummary {
  maxIndex: number | null;
  unusedTail: number;
}

/**
 * Model the two SQL reads performed by canonical batch allocation: the wallet
 * row lock followed by the compact receive/change allocation summary.
 */
export function mockLockedCanonicalBranchSummary(options: {
  walletId: string;
  receive: LockedBranchSummary;
  change: LockedBranchSummary;
}): void {
  mockPrismaClient.$queryRaw.mockReset();
  mockPrismaClient.$queryRaw
    .mockResolvedValueOnce([{ id: options.walletId }])
    .mockResolvedValueOnce([
      {
        branch: 0,
        maxIndex: options.receive.maxIndex,
        unusedTail: BigInt(options.receive.unusedTail),
      },
      {
        branch: 1,
        maxIndex: options.change.maxIndex,
        unusedTail: BigInt(options.change.unusedTail),
      },
    ]);
}
