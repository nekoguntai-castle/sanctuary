import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const { mockInvalidateWalletAccessCache, mockInvalidateUserAccessCache } = vi.hoisted(() => ({
  mockInvalidateWalletAccessCache: vi.fn(),
  mockInvalidateUserAccessCache: vi.fn(),
}));

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    walletUser: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    groupMember: {
      findFirst: vi.fn(),
    },
    wallet: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../../src/infrastructure/accessCache', () => ({
  invalidateWalletAccessCache: mockInvalidateWalletAccessCache,
  invalidateUserAccessCache: mockInvalidateUserAccessCache,
}));

import prisma from '../../../src/models/prisma';
import {
  addUserToWallet,
  findWalletUser,
  getGroupMember,
  getWalletSharingInfo,
  isGroupMember,
  removeUserFromWallet,
  updateUserRole,
  updateWalletGroup,
  updateWalletGroupWithResult,
  walletSharingRepository,
} from '../../../src/repositories/walletSharingRepository';

describe('walletSharingRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('findWalletUser and group lookup helpers query expected models', async () => {
    (prisma.walletUser.findFirst as Mock).mockResolvedValueOnce({ id: 'wu-1' });
    (prisma.groupMember.findFirst as Mock)
      .mockResolvedValueOnce({ id: 'gm-1' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'gm-2', role: 'admin' });

    await expect(findWalletUser('wallet-1', 'user-1')).resolves.toEqual({ id: 'wu-1' });
    await expect(isGroupMember('group-1', 'user-1')).resolves.toBe(true);
    await expect(isGroupMember('group-1', 'user-2')).resolves.toBe(false);
    await expect(getGroupMember('group-1', 'user-3')).resolves.toEqual({ id: 'gm-2', role: 'admin' });

    expect(prisma.walletUser.findFirst).toHaveBeenCalledWith({
      where: { walletId: 'wallet-1', userId: 'user-1' },
    });
    expect(prisma.groupMember.findFirst).toHaveBeenCalledWith({
      where: { groupId: 'group-1', userId: 'user-1' },
    });
  });

  it('addUserToWallet and updateUserRole invalidate wallet access cache', async () => {
    (prisma.walletUser.create as Mock).mockResolvedValue({ id: 'wu-1', walletId: 'wallet-1' });
    (prisma.walletUser.update as Mock).mockResolvedValue({ id: 'wu-1', walletId: 'wallet-2', role: 'signer' });

    await expect(addUserToWallet('wallet-1', 'user-1', 'viewer')).resolves.toEqual({
      id: 'wu-1',
      walletId: 'wallet-1',
    });
    await expect(updateUserRole('wu-1', 'signer')).resolves.toEqual({
      id: 'wu-1',
      walletId: 'wallet-2',
      role: 'signer',
    });

    expect(prisma.walletUser.create).toHaveBeenCalledWith({
      data: { walletId: 'wallet-1', userId: 'user-1', role: 'viewer' },
    });
    expect(prisma.walletUser.update).toHaveBeenCalledWith({
      where: { id: 'wu-1' },
      data: { role: 'signer' },
    });
    expect(mockInvalidateWalletAccessCache).toHaveBeenNthCalledWith(1, 'wallet-1');
    expect(mockInvalidateWalletAccessCache).toHaveBeenNthCalledWith(2, 'wallet-2');
  });

  it('removeUserFromWallet invalidates cache when user record exists', async () => {
    (prisma.walletUser.findUnique as Mock).mockResolvedValue({
      walletId: 'wallet-1',
      userId: 'user-1',
    });
    (prisma.walletUser.delete as Mock).mockResolvedValue(undefined);

    await removeUserFromWallet('wu-1');

    expect(prisma.walletUser.findUnique).toHaveBeenCalledWith({
      where: { id: 'wu-1' },
      select: { walletId: true, userId: true },
    });
    expect(prisma.walletUser.delete).toHaveBeenCalledWith({
      where: { id: 'wu-1' },
    });
    expect(mockInvalidateWalletAccessCache).toHaveBeenCalledWith('wallet-1');
  });

  it('removeUserFromWallet skips cache invalidation when relation does not exist', async () => {
    (prisma.walletUser.findUnique as Mock).mockResolvedValue(null);
    (prisma.walletUser.delete as Mock).mockResolvedValue(undefined);

    await removeUserFromWallet('wu-missing');

    expect(mockInvalidateWalletAccessCache).not.toHaveBeenCalled();
  });

  it('updateWalletGroup sets role semantics correctly for assign/remove', async () => {
    (prisma.wallet.update as Mock).mockResolvedValue(undefined);

    await updateWalletGroup('wallet-1', 'group-1', 'signer');
    await updateWalletGroup('wallet-1', null);

    expect(prisma.wallet.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'wallet-1' },
      data: {
        groupId: 'group-1',
        groupRole: 'signer',
      },
    });
    expect(prisma.wallet.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'wallet-1' },
      data: {
        groupId: null,
        groupRole: 'viewer',
      },
    });
    expect(mockInvalidateWalletAccessCache).toHaveBeenCalledTimes(2);
  });

  it('updateWalletGroupWithResult includes group and returns wallet', async () => {
    const wallet = { id: 'wallet-1', group: { id: 'group-1' } };
    (prisma.wallet.update as Mock).mockResolvedValue(wallet);

    await expect(updateWalletGroupWithResult('wallet-1', 'group-1')).resolves.toBe(wallet);
    expect(prisma.wallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet-1' },
      data: {
        groupId: 'group-1',
        groupRole: 'viewer',
      },
      include: {
        group: true,
      },
    });
    expect(mockInvalidateWalletAccessCache).toHaveBeenCalledWith('wallet-1');
  });

  it('updateWalletGroupWithResult clears groupId and resets role when group is removed', async () => {
    const wallet = { id: 'wallet-2', group: null };
    (prisma.wallet.update as Mock).mockResolvedValue(wallet);

    await expect(updateWalletGroupWithResult('wallet-2', null, 'signer')).resolves.toBe(wallet);
    expect(prisma.wallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet-2' },
      data: {
        groupId: null,
        groupRole: 'viewer',
      },
      include: {
        group: true,
      },
    });
    expect(mockInvalidateWalletAccessCache).toHaveBeenCalledWith('wallet-2');
  });

  it('getWalletSharingInfo requests group and users with selected user fields', async () => {
    (prisma.wallet.findUnique as Mock).mockResolvedValue({ id: 'wallet-1' });

    await expect(getWalletSharingInfo('wallet-1')).resolves.toEqual({ id: 'wallet-1' });
    expect(prisma.wallet.findUnique).toHaveBeenCalledWith({
      where: { id: 'wallet-1' },
      include: {
        group: true,
        users: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        },
      },
    });
  });

  it('exports all operations via namespace and default object', () => {
    expect(walletSharingRepository.findWalletUser).toBe(findWalletUser);
    expect(walletSharingRepository.addUserToWallet).toBe(addUserToWallet);
    expect(walletSharingRepository.updateWalletGroup).toBe(updateWalletGroup);
    expect(walletSharingRepository.getWalletSharingInfo).toBe(getWalletSharingInfo);
    expect(mockInvalidateUserAccessCache).toBeDefined();
  });
});
