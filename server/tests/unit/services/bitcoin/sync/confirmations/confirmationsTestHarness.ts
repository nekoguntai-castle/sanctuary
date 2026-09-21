import { beforeEach, vi } from 'vitest';

import {
  mockPrismaClient,
  mockWalletMutationTargetLock,
  resetPrismaMocks,
} from '../../../../../mocks/prisma';

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

type TransactionFieldPatch = {
  id: string;
  data: Record<string, unknown>;
};

function reviveTransactionPatchData(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).map(([field, value]) => [
    field,
    (field === 'amount' || field === 'fee') && typeof value === 'string'
      ? BigInt(value)
      : value,
  ]));
}

/** Decode the JSON payloads sent through the heterogeneous raw batch writer. */
export function getTransactionFieldPatches(): TransactionFieldPatch[] {
  return mockPrismaClient.$executeRaw.mock.calls.flatMap(([query]) => {
    const sql = query?.strings?.join('') ?? '';
    if (!sql.includes('UPDATE "transactions" AS transaction')) return [];
    const serialized = query.values?.[0];
    if (typeof serialized !== 'string') return [];
    return (JSON.parse(serialized) as TransactionFieldPatch[]).map(patch => ({
      id: patch.id,
      data: reviveTransactionPatchData(patch.data),
    }));
  });
}

export function getTransactionFieldPatch(id: string): TransactionFieldPatch | undefined {
  return getTransactionFieldPatches().find(patch => patch.id === id);
}

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
    mockWalletMutationTargetLock();
    vi.clearAllMocks();

    mockGetConfig.mockReturnValue({
      sync: { transactionBatchSize: 2 },
    });
    mockGetBlockHeight.mockResolvedValue(1000);
    mockGetBlockTimestamp.mockResolvedValue(new Date('2024-01-01T00:00:00.000Z'));
  });
}
