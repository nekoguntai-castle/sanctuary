/**
 * Repository Factory
 *
 * Factory pattern for creating repositories with injectable Prisma client.
 * Enables unit testing repositories without a real database connection.
 *
 * Usage (Production):
 *   import { repositories } from './repositories';
 *   const wallet = await repositories.wallet.findById(id);
 *
 * Usage (Testing):
 *   const mockPrisma = createMockPrismaClient();
 *   const testRepos = createRepositories(mockPrisma);
 *   const wallet = await testRepos.wallet.findById(id);
 */

import type { PrismaClient, Wallet } from '@prisma/client';
import prisma from '../models/prisma';
import { buildWalletAccessWhere } from './accessControl';
import { createLabelRepository } from './labelRepositoryFactory';
import type {
  PrismaClientLike,
  WalletRepositoryInterface,
  TransactionRepositoryInterface,
  AddressRepositoryInterface,
  UtxoRepositoryInterface,
  UserRepositoryInterface,
  RepositoryFactory,
} from './factoryInterfaces';

// Re-export all types from factoryInterfaces for backwards compatibility
export type {
  PrismaClientLike,
  WalletRepositoryInterface,
  TransactionRepositoryInterface,
  AddressRepositoryInterface,
  UtxoRepositoryInterface,
  UserRepositoryInterface,
  LabelRepositoryInterface,
  LabelWithCounts,
  LabelWithAssociations,
  RepositoryFactory,
} from './factoryInterfaces';


/**
 * Create wallet repository with injectable client
 */
function createWalletRepository(client: PrismaClientLike): WalletRepositoryInterface {
  return {
    async findById(walletId: string) {
      return client.wallet.findUnique({ where: { id: walletId } });
    },

    async findByIdWithAccess(walletId: string, userId: string) {
      return client.wallet.findFirst({
        where: { id: walletId, ...buildWalletAccessWhere(userId) },
      });
    },

    async findByUserId(userId: string) {
      return client.wallet.findMany({
        where: buildWalletAccessWhere(userId),
      });
    },

    async hasAccess(walletId: string, userId: string) {
      const wallet = await client.wallet.findFirst({
        where: { id: walletId, ...buildWalletAccessWhere(userId) },
        select: { id: true },
      });
      return wallet !== null;
    },

    async getName(walletId: string) {
      const wallet = await client.wallet.findUnique({
        where: { id: walletId },
        select: { name: true },
      });
      return wallet?.name ?? null;
    },

    async update(walletId: string, data: Partial<Wallet>) {
      return client.wallet.update({
        where: { id: walletId },
        data,
      });
    },
  };
}

/**
 * Create transaction repository with injectable client
 */
function createTransactionRepository(client: PrismaClientLike): TransactionRepositoryInterface {
  return {
    async findByWalletId(walletId: string, options?: { skip?: number; take?: number }) {
      return client.transaction.findMany({
        where: { walletId },
        skip: options?.skip,
        take: options?.take,
        orderBy: { blockTime: 'desc' },
      });
    },

    async findByTxid(txid: string, walletId: string) {
      return client.transaction.findFirst({
        where: { txid, walletId },
      });
    },

    async countByWalletId(walletId: string) {
      return client.transaction.count({ where: { walletId } });
    },

    async deleteByWalletId(walletId: string) {
      const result = await client.transaction.deleteMany({ where: { walletId } });
      return result.count;
    },
  };
}

/**
 * Create address repository with injectable client
 */
function createAddressRepository(client: PrismaClientLike): AddressRepositoryInterface {
  return {
    async findByWalletId(walletId: string, options?: { used?: boolean }) {
      return client.address.findMany({
        where: {
          walletId,
          ...(options?.used !== undefined ? { used: options.used } : {}),
        },
        orderBy: { index: 'asc' },
      });
    },

    async findNextUnused(walletId: string) {
      return client.address.findFirst({
        where: { walletId, used: false },
        orderBy: { index: 'asc' },
      });
    },

    async markAsUsed(addressId: string) {
      return client.address.update({
        where: { id: addressId },
        data: { used: true },
      });
    },

    async resetUsedFlags(walletId: string) {
      const result = await client.address.updateMany({
        where: { walletId },
        data: { used: false },
      });
      return result.count;
    },
  };
}

/**
 * Create UTXO repository with injectable client
 */
function createUtxoRepository(client: PrismaClientLike): UtxoRepositoryInterface {
  return {
    async findByWalletId(walletId: string, options?: { spent?: boolean }) {
      return client.uTXO.findMany({
        where: {
          walletId,
          ...(options?.spent !== undefined ? { spent: options.spent } : {}),
        },
        orderBy: { amount: 'desc' },
      });
    },

    async findUnspent(walletId: string) {
      return client.uTXO.findMany({
        where: { walletId, spent: false },
        orderBy: { amount: 'desc' },
      });
    },

    async getUnspentBalance(walletId: string) {
      const result = await client.uTXO.aggregate({
        where: { walletId, spent: false },
        _sum: { amount: true },
      });
      return result._sum.amount || BigInt(0);
    },

    async deleteByWalletId(walletId: string) {
      const result = await client.uTXO.deleteMany({ where: { walletId } });
      return result.count;
    },
  };
}

/**
 * Create user repository with injectable client
 */
function createUserRepository(client: PrismaClientLike): UserRepositoryInterface {
  return {
    async findById(id: string) {
      return client.user.findUnique({ where: { id } });
    },

    async findByEmail(email: string) {
      return client.user.findUnique({ where: { email } });
    },

    async exists(id: string) {
      const count = await client.user.count({ where: { id } });
      return count > 0;
    },
  };
}

/**
 * Create all repositories with injectable client
 */
export function createRepositories(client: PrismaClientLike = prisma): RepositoryFactory {
  return {
    wallet: createWalletRepository(client),
    transaction: createTransactionRepository(client),
    address: createAddressRepository(client),
    utxo: createUtxoRepository(client),
    user: createUserRepository(client),
    label: createLabelRepository(client),
  };
}

// Default repositories using the real Prisma client
export const repositories = createRepositories();

/**
 * Create a mock Prisma client for testing
 * Returns a partial mock that can be customized per test
 *
 * @param mockFn - A mock function creator (e.g., vi.fn from Vitest)
 *                 Defaults to a simple function that returns promises
 */
export function createMockPrismaClient(
  mockFn?: <T>(impl?: () => T) => (() => T) & { mockResolvedValue?: (val: T) => void; mockImplementation?: (fn: (...args: unknown[]) => T) => void }
): PrismaClientLike {
  // Default simple mock function if none provided
  const createFn = mockFn || (<T>(impl?: () => T) => {
    const fn = (..._args: unknown[]) => impl ? Promise.resolve(impl()) : Promise.resolve(null);
    return fn as unknown as (() => T) & { mockResolvedValue?: (val: T) => void };
  });

  const createMockModel = () => ({
    findUnique: createFn(() => null as unknown),
    findFirst: createFn(() => null as unknown),
    findMany: createFn(() => [] as unknown),
    create: createFn(() => ({} as unknown)),
    update: createFn(() => ({} as unknown)),
    delete: createFn(() => ({} as unknown)),
    deleteMany: createFn(() => ({ count: 0 } as unknown)),
    updateMany: createFn(() => ({ count: 0 } as unknown)),
    count: createFn(() => 0 as unknown),
    aggregate: createFn(() => ({ _sum: { amount: BigInt(0) } } as unknown)),
  });

  const transactionFn = createFn();
  const mockTransaction = (fn: (client: unknown) => unknown) => fn({
    wallet: createMockModel(),
    transaction: createMockModel(),
    address: createMockModel(),
    uTXO: createMockModel(),
    user: createMockModel(),
    label: createMockModel(),
    transactionLabel: createMockModel(),
    addressLabel: createMockModel(),
  });

  return {
    wallet: createMockModel() as unknown as PrismaClient['wallet'],
    transaction: createMockModel() as unknown as PrismaClient['transaction'],
    address: createMockModel() as unknown as PrismaClient['address'],
    uTXO: createMockModel() as unknown as PrismaClient['uTXO'],
    user: createMockModel() as unknown as PrismaClient['user'],
    walletUser: createMockModel() as unknown as PrismaClient['walletUser'],
    groupMember: createMockModel() as unknown as PrismaClient['groupMember'],
    label: createMockModel() as unknown as PrismaClient['label'],
    transactionLabel: createMockModel() as unknown as PrismaClient['transactionLabel'],
    addressLabel: createMockModel() as unknown as PrismaClient['addressLabel'],
    $transaction: transactionFn || mockTransaction,
  } as PrismaClientLike;
}
