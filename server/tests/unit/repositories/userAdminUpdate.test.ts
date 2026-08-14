import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { Prisma } from '../../../src/generated/prisma/client';

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  user: {
    update: vi.fn(),
  },
}));

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

import { userRepository } from '../../../src/repositories/userRepository';

const adminSelect = { id: true, username: true, isAdmin: true } as const;

function serializableConflict() {
  return new Prisma.PrismaClientKnownRequestError('write conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

function installAdminTransaction(options: {
  targetIsAdmin: boolean;
  adminCount: number;
}) {
  const tx = {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'target',
        username: 'target-user',
        isAdmin: options.targetIsAdmin,
      }),
      count: vi.fn().mockResolvedValue(options.adminCount),
      update: vi.fn().mockResolvedValue({
        id: 'target',
        username: 'target-user',
        isAdmin: false,
      }),
    },
  };
  mockPrisma.$transaction.mockImplementation(
    async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  );
  return tx;
}

function installAdminSetBarrier() {
  const adminIds = new Set(['admin-a', 'admin-b']);
  let version = 0;
  let initialTransactions = 0;
  let releaseInitialTransactions!: () => void;
  const initialBarrier = new Promise<void>((resolve) => {
    releaseInitialTransactions = resolve;
  });

  mockPrisma.$transaction.mockImplementation(async (
    callback: (client: any) => Promise<unknown>,
  ) => {
    const startVersion = version;
    let pendingRemoval: string | null = null;
    const tx = {
      user: {
        findUnique: vi.fn().mockImplementation(async ({ where }) => (
          adminIds.has(where.id)
            ? { id: where.id, username: where.id, isAdmin: true }
            : null
        )),
        count: vi.fn().mockImplementation(async () => adminIds.size),
        update: vi.fn().mockImplementation(async ({ where }) => {
          pendingRemoval = where.id;
          return { id: where.id, username: where.id, isAdmin: false };
        }),
        delete: vi.fn().mockImplementation(async ({ where }) => {
          pendingRemoval = where.id;
          return { id: where.id };
        }),
      },
    };

    const result = await callback(tx);
    if (startVersion === 0) {
      initialTransactions += 1;
      if (initialTransactions === 2) releaseInitialTransactions();
      await initialBarrier;
    }
    if (startVersion !== version) throw serializableConflict();
    if (pendingRemoval) adminIds.delete(pendingRemoval);
    version += 1;
    return result;
  });

  return adminIds;
}

function expectOneAdminFloorWinner(
  results: PromiseSettledResult<unknown>[],
  adminIds: Set<string>,
): void {
  expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
  expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
    status: 'rejected',
    reason: { statusCode: 409, code: 'CONFLICT' },
  });
  expect(adminIds.size).toBe(1);
  expect(mockPrisma.$transaction).toHaveBeenCalledTimes(3);
}

describe('Admin user repository updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects demoting the final administrator without writing', async () => {
    const tx = installAdminTransaction({ targetIsAdmin: true, adminCount: 1 });

    await expect(userRepository.updateFromAdmin(
      'target',
      { isAdmin: false },
      adminSelect,
    )).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });

    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'target' },
      select: { isAdmin: true },
    });
    expect(tx.user.count).toHaveBeenCalledWith({ where: { isAdmin: true } });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('rejects an admin role update when the target user no longer exists', async () => {
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        count: vi.fn(),
        update: vi.fn(),
      },
    };
    mockPrisma.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(userRepository.updateFromAdmin(
      'missing-user',
      { isAdmin: true },
      adminSelect,
    )).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });

    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'missing-user' },
      select: { isAdmin: true },
    });
    expect(tx.user.count).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('returns transitions from the successful transaction reread', async () => {
    const tx = installAdminTransaction({ targetIsAdmin: true, adminCount: 2 });

    await expect(userRepository.updateFromAdmin('target', {
      isAdmin: false,
      password: 'new-hash',
    }, adminSelect)).resolves.toEqual({
      user: expect.objectContaining({ id: 'target', isAdmin: false }),
      transitions: { adminRoleChanged: true, passwordChanged: true },
    });
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'target' },
      data: { isAdmin: false, password: 'new-hash' },
    }));
  });

  it('retries a demotion then protects the remaining administrator', async () => {
    const firstTx = installAdminTransaction({ targetIsAdmin: true, adminCount: 2 });
    const retryTx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ isAdmin: true }),
        count: vi.fn().mockResolvedValue(1),
        update: vi.fn(),
      },
    };
    mockPrisma.$transaction
      .mockImplementationOnce(async (callback: (client: typeof firstTx) => Promise<unknown>) => {
        await callback(firstTx);
        throw serializableConflict();
      })
      .mockImplementationOnce(
        async (callback: (client: typeof retryTx) => Promise<unknown>) => callback(retryTx),
      );

    await expect(userRepository.updateFromAdmin(
      'target',
      { isAdmin: false },
      adminSelect,
    )).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
    expect(firstTx.user.update).toHaveBeenCalledOnce();
    expect(retryTx.user.update).not.toHaveBeenCalled();
  });

  it('allows only one of two barrier-synchronized demotions to commit', async () => {
    const adminIds = installAdminSetBarrier();
    const results = await Promise.allSettled([
      userRepository.updateFromAdmin('admin-a', { isAdmin: false }, adminSelect),
      userRepository.updateFromAdmin('admin-b', { isAdmin: false }, adminSelect),
    ]);
    expectOneAdminFloorWinner(results, adminIds);
  });

  it('allows only one barrier-synchronized demotion or deletion to commit', async () => {
    const adminIds = installAdminSetBarrier();
    const results = await Promise.allSettled([
      userRepository.updateFromAdmin('admin-a', { isAdmin: false }, adminSelect),
      userRepository.deleteFromAdmin('admin-b'),
    ]);
    expectOneAdminFloorWinner(results, adminIds);
  });

  it('deletes a non-admin through the serializable floor protocol', async () => {
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'regular-user',
          username: 'regular-user',
          isAdmin: false,
        }),
        count: vi.fn().mockResolvedValue(1),
        delete: vi.fn().mockResolvedValue({ id: 'regular-user' }),
      },
    };
    mockPrisma.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(userRepository.deleteFromAdmin('regular-user')).resolves.toEqual({
      id: 'regular-user',
      username: 'regular-user',
      isAdmin: false,
    });
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: 'regular-user' } });
    expect(mockPrisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
  });

  it('bounds repeated serialization conflicts', async () => {
    mockPrisma.$transaction.mockRejectedValue(serializableConflict());

    await expect(userRepository.updateFromAdmin(
      'target',
      { isAdmin: false },
      adminSelect,
    )).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('keeps unrelated updates on the direct path', async () => {
    (mockPrisma.user.update as Mock).mockResolvedValue({
      id: 'target',
      username: 'renamed',
      isAdmin: false,
    });

    await expect(userRepository.updateFromAdmin(
      'target',
      { username: 'renamed' },
      adminSelect,
    )).resolves.toEqual({
      user: expect.objectContaining({ username: 'renamed' }),
      transitions: { adminRoleChanged: false, passwordChanged: false },
    });
    expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'target' },
      data: { username: 'renamed' },
    }));
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
