import { beforeAll, beforeEach, vi } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../../../mocks/prisma';
import {
  mockElectrumClient,
  resetElectrumMocks,
} from '../../../../mocks/electrum';

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
  });
}

export function getBlockchainService(): BlockchainServiceModule {
  return blockchainService;
}
