import { beforeAll, beforeEach, vi } from 'vitest';
import type { IncrementalSyncRequestResult } from '../../../../src/repositories/types';

type WalletRepository = typeof import('../../../../src/repositories/walletRepository').walletRepository;

const walletRepositoryMocks = vi.hoisted(() => {
  const requestIncrementalSyncWithClient = vi.fn(async (): Promise<IncrementalSyncRequestResult> => ({
    status: 'merged' as const,
    state: {},
  } as IncrementalSyncRequestResult));
  const prisma = {
    wallet: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    walletDevice: {
      create: vi.fn(),
      createMany: vi.fn(),
    },
    address: {
      createMany: vi.fn(),
      createManyAndReturn: vi.fn(),
    },
    addressSubscriptionCheckpoint: {
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn({
    wallet: {
      create: prisma.wallet.create,
      findUnique: prisma.wallet.findUnique,
      updateMany: prisma.wallet.updateMany,
    },
    walletDevice: {
      create: prisma.walletDevice.create,
      createMany: prisma.walletDevice.createMany,
    },
    address: {
      createMany: prisma.address.createMany,
      createManyAndReturn: prisma.address.createManyAndReturn,
    },
    addressSubscriptionCheckpoint: {
      createMany: prisma.addressSubscriptionCheckpoint.createMany,
    },
  }));

  return { prisma, requestIncrementalSyncWithClient };
});

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: walletRepositoryMocks.prisma,
}));

vi.mock('../../../../src/repositories/syncIntentRepository', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../src/repositories/syncIntentRepository')>(),
  requestIncrementalSyncWithClient: walletRepositoryMocks.requestIncrementalSyncWithClient,
}));

export const prisma = walletRepositoryMocks.prisma;
export const requestIncrementalSyncWithClient =
  walletRepositoryMocks.requestIncrementalSyncWithClient;

export let walletRepository: WalletRepository;

export const mockWallet = {
  id: 'wallet-123',
  name: 'Test Wallet',
  network: 'mainnet',
  scriptType: 'native_segwit',
  syncInProgress: false,
  lastSyncedAt: new Date(),
  lastSyncStatus: 'success',
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const mockUserId = 'user-456';

export const setupWalletRepositoryTestHarness = () => {
  beforeAll(async () => {
    ({ walletRepository } = await import('../../../../src/repositories/walletRepository'));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });
};
