import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    walletUser: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
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
      findMany: vi.fn(),
    },
  },
}));

import prisma from '../../../src/models/prisma';
import {
  addUserToWallet,
  findWalletIdsByUserRole,
  findWalletUserByCompositeKey,
  findWalletUsersWithUsername,
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

  it('addUserToWallet and updateUserRole persist the requested grants', async () => {
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
  });

  it('removeUserFromWallet deletes the grant directly', async () => {
    (prisma.walletUser.delete as Mock).mockResolvedValue(undefined);

    await removeUserFromWallet('wu-1');

    expect(prisma.walletUser.findUnique).not.toHaveBeenCalled();
    expect(prisma.walletUser.delete).toHaveBeenCalledWith({
      where: { id: 'wu-1' },
    });
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

  it('queries wallet-user list helpers with the expected selectors', async () => {
    (prisma.walletUser.findMany as Mock)
      .mockResolvedValueOnce([{ walletId: 'wallet-1', role: 'owner' }, { walletId: 'wallet-2', role: 'signer' }])
      .mockResolvedValueOnce([{ id: 'wu-name' }]);
    (prisma.wallet.findMany as Mock).mockResolvedValueOnce([]);
    (prisma.walletUser.findUnique as Mock).mockResolvedValueOnce({ role: 'signer' });

    await expect(findWalletIdsByUserRole('user-1', ['owner', 'signer'])).resolves.toEqual(['wallet-1', 'wallet-2']);
    expect(prisma.walletUser.findMany).toHaveBeenNthCalledWith(1, {
      where: { userId: 'user-1' },
      select: { walletId: true, role: true },
    });
    expect(prisma.wallet.findMany).toHaveBeenCalledWith({
      where: {
        groupRole: { in: ['owner', 'signer'] },
        group: { members: { some: { userId: 'user-1' } } },
      },
      select: { id: true },
    });

    await expect(findWalletUsersWithUsername('wallet-1')).resolves.toEqual([{ id: 'wu-name' }]);
    expect(prisma.walletUser.findMany).toHaveBeenNthCalledWith(2, {
      where: { walletId: 'wallet-1' },
      include: {
        user: {
          select: { id: true, username: true },
        },
      },
    });

    await expect(findWalletUserByCompositeKey('wallet-1', 'user-1')).resolves.toEqual({ role: 'signer' });
    expect(prisma.walletUser.findUnique).toHaveBeenCalledWith({
      where: {
        walletId_userId: { walletId: 'wallet-1', userId: 'user-1' },
      },
      select: { role: true },
    });
  });

  describe('findWalletIdsByUserRole group-role parity', () => {
    it('includes a wallet where only a group role grants access', async () => {
      (prisma.walletUser.findMany as Mock).mockResolvedValueOnce([]);
      (prisma.wallet.findMany as Mock).mockResolvedValueOnce([{ id: 'wallet-g' }]);

      await expect(findWalletIdsByUserRole('user-1', ['owner', 'approver'])).resolves.toEqual(['wallet-g']);
    });

    it('deduplicates a wallet id present in both the direct and group sources', async () => {
      (prisma.walletUser.findMany as Mock).mockResolvedValueOnce([{ walletId: 'wallet-a', role: 'owner' }]);
      (prisma.wallet.findMany as Mock).mockResolvedValueOnce([{ id: 'wallet-a' }]);

      await expect(findWalletIdsByUserRole('user-1', ['owner', 'approver'])).resolves.toEqual(['wallet-a']);
      expect(prisma.walletUser.findMany).toHaveBeenCalledTimes(1);
    });

    it('excludes a group-approver wallet when the user also has a non-approve direct role there (vote-path parity)', async () => {
      (prisma.walletUser.findMany as Mock).mockResolvedValueOnce([{ walletId: 'wallet-b', role: 'viewer' }]);
      (prisma.wallet.findMany as Mock).mockResolvedValueOnce([{ id: 'wallet-b' }]);

      await expect(findWalletIdsByUserRole('user-1', ['owner', 'approver'])).resolves.toEqual([]);
      expect(prisma.walletUser.findMany).toHaveBeenCalledTimes(1);
    });

    it('includes a wallet via a direct in-role grant with no group grant', async () => {
      (prisma.walletUser.findMany as Mock).mockResolvedValueOnce([{ walletId: 'wallet-c', role: 'approver' }]);
      (prisma.wallet.findMany as Mock).mockResolvedValueOnce([]);

      await expect(findWalletIdsByUserRole('user-1', ['owner', 'approver'])).resolves.toEqual(['wallet-c']);
    });
  });

  it('exports all operations via namespace and default object', () => {
    expect(walletSharingRepository.findWalletUser).toBe(findWalletUser);
    expect(walletSharingRepository.addUserToWallet).toBe(addUserToWallet);
    expect(walletSharingRepository.updateWalletGroup).toBe(updateWalletGroup);
    expect(walletSharingRepository.getWalletSharingInfo).toBe(getWalletSharingInfo);
  });
});
