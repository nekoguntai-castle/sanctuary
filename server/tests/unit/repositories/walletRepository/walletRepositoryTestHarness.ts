import { beforeAll, beforeEach, vi } from 'vitest';

type WalletRepository = typeof import('../../../../src/repositories/walletRepository').walletRepository;

const walletRepositoryMocks = vi.hoisted(() => {
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
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn({
    wallet: {
      create: prisma.wallet.create,
      findUnique: prisma.wallet.findUnique,
    },
    walletDevice: {
      createMany: prisma.walletDevice.createMany,
    },
  }));

  return { prisma };
});

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: walletRepositoryMocks.prisma,
}));

export const prisma = walletRepositoryMocks.prisma;

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
