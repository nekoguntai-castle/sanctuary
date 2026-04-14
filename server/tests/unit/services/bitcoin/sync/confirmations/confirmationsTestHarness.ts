import { beforeEach, vi } from 'vitest';

import { mockPrismaClient, resetPrismaMocks } from '../../../../../mocks/prisma';

const confirmationMocks = vi.hoisted(() => ({
  mockWalletLog: vi.fn(),
  mockGetConfig: vi.fn(),
  mockGetNodeClient: vi.fn(),
  mockGetBlockHeight: vi.fn(),
  mockGetBlockTimestamp: vi.fn(),
  mockRecalculateWalletBalances: vi.fn(),
}));

export const mockWalletLog = confirmationMocks.mockWalletLog;
export const mockGetConfig = confirmationMocks.mockGetConfig;
export const mockGetNodeClient = confirmationMocks.mockGetNodeClient;
export const mockGetBlockHeight = confirmationMocks.mockGetBlockHeight;
export const mockGetBlockTimestamp = confirmationMocks.mockGetBlockTimestamp;
export const mockRecalculateWalletBalances = confirmationMocks.mockRecalculateWalletBalances;

vi.mock('../../../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

vi.mock('../../../../../../src/config', () => ({
  getConfig: mockGetConfig,
}));

vi.mock('../../../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: mockGetNodeClient,
}));

vi.mock('../../../../../../src/services/bitcoin/utils/blockHeight', () => ({
  getBlockHeight: mockGetBlockHeight,
  getBlockTimestamp: mockGetBlockTimestamp,
}));

vi.mock('../../../../../../src/websocket/notifications', () => ({
  walletLog: mockWalletLog,
}));

vi.mock('../../../../../../src/services/bitcoin/utils/balanceCalculation', () => ({
  recalculateWalletBalances: mockRecalculateWalletBalances,
}));

export function registerConfirmationsTestHarness() {
  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();

    mockGetConfig.mockReturnValue({
      sync: { transactionBatchSize: 2 },
    });
    mockGetBlockHeight.mockResolvedValue(1000);
    mockGetBlockTimestamp.mockResolvedValue(new Date('2024-01-01T00:00:00.000Z'));
  });
}
