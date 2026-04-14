import { vi } from 'vitest';
import { mockPrismaClient } from '../../../../../mocks/prisma';
import { mockElectrumClient } from '../../../../../mocks/electrum';

vi.mock('../../../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

vi.mock('../../../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue(mockElectrumClient),
}));

vi.mock('../../../../../../src/websocket/notifications', () => ({
  walletLog: vi.fn(),
  getNotificationService: vi.fn().mockReturnValue({
    broadcastTransactionNotification: vi.fn(),
  }),
}));

vi.mock('../../../../../../src/services/notifications/notificationService', () => ({
  notifyNewTransactions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../../../src/config', () => ({
  getConfig: () => ({
    sync: { transactionBatchSize: 100 },
  }),
}));

vi.mock('../../../../../../src/services/bitcoin/utils/balanceCalculation', () => ({
  recalculateWalletBalances: vi.fn().mockResolvedValue(undefined),
  correctMisclassifiedConsolidations: vi.fn().mockResolvedValue(0),
}));

vi.mock('../../../../../../src/services/bitcoin/addressDerivation', () => ({
  deriveAddressFromDescriptor: vi.fn().mockImplementation((descriptor, index, options) => {
    const change = options?.change ? 1 : 0;
    return {
      address: `tb1q_test_${change}_${index}`,
      derivationPath: `m/84'/0'/0'/${change}/${index}`,
      publicKey: Buffer.from('02' + '00'.repeat(32), 'hex'),
    };
  }),
}));

vi.mock('../../../../../../src/services/bitcoin/utils/blockHeight', () => ({
  getBlockTimestamp: vi.fn().mockResolvedValue(new Date('2024-01-15T12:00:00Z')),
}));
