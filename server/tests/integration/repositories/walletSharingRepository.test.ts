/**
 * Wallet Sharing Repository Integration Tests
 *
 * Tests the wallet sharing repository against a real PostgreSQL database.
 */

import {
  describeIfDatabase,
  setupRepositoryTests,
  withTestTransaction,
  createTestUser,
  createTestWallet,
  createTestGroup,
  addUserToGroup,
} from './setup';

describeIfDatabase('WalletSharingRepository Integration Tests', () => {
  setupRepositoryTests();

  describe('findWalletUser', () => {
    it('should find wallet user access record', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const walletUser = await tx.walletUser.findFirst({
          where: { walletId: wallet.id, userId: user.id },
        });

        expect(walletUser).not.toBeNull();
        expect(walletUser?.role).toBe('owner');
      });
    });

    it('should return null for non-member', async () => {
      await withTestTransaction(async (tx) => {
        const owner = await createTestUser(tx, { username: 'owner' });
        const other = await createTestUser(tx, { username: 'other' });
        const wallet = await createTestWallet(tx, owner.id);

        const walletUser = await tx.walletUser.findFirst({
          where: { walletId: wallet.id, userId: other.id },
        });

        expect(walletUser).toBeNull();
      });
    });
  });

  describe('addUserToWallet', () => {
    it('should add user with viewer role', async () => {
      await withTestTransaction(async (tx) => {
        const owner = await createTestUser(tx, { username: 'owner' });
        const viewer = await createTestUser(tx, { username: 'viewer' });
        const wallet = await createTestWallet(tx, owner.id);

        await tx.walletUser.create({
          data: { walletId: wallet.id, userId: viewer.id, role: 'viewer' },
        });

        const walletUser = await tx.walletUser.findFirst({
          where: { walletId: wallet.id, userId: viewer.id },
        });

        expect(walletUser?.role).toBe('viewer');
      });
    });

    it('should add user with signer role', async () => {
      await withTestTransaction(async (tx) => {
        const owner = await createTestUser(tx, { username: 'owner' });
        const signer = await createTestUser(tx, { username: 'signer' });
        const wallet = await createTestWallet(tx, owner.id, {
          type: 'multi_sig',
          quorum: 2,
          totalSigners: 3,
        });

        await tx.walletUser.create({
          data: { walletId: wallet.id, userId: signer.id, role: 'signer' },
        });

        const walletUser = await tx.walletUser.findFirst({
          where: { walletId: wallet.id, userId: signer.id },
        });

        expect(walletUser?.role).toBe('signer');
      });
    });

    it('should enforce unique wallet-user combination', async () => {
      await withTestTransaction(async (tx) => {
        const owner = await createTestUser(tx, { username: 'owner' });
        const viewer = await createTestUser(tx, { username: 'viewer' });
        const wallet = await createTestWallet(tx, owner.id);

        await tx.walletUser.create({
          data: { walletId: wallet.id, userId: viewer.id, role: 'viewer' },
        });

        await expect(
          tx.walletUser.create({
            data: { walletId: wallet.id, userId: viewer.id, role: 'signer' },
          })
        ).rejects.toThrow();
      });
    });
  });

  describe('updateUserRole', () => {
    it('should update user role', async () => {
      await withTestTransaction(async (tx) => {
        const owner = await createTestUser(tx, { username: 'owner' });
        const user = await createTestUser(tx, { username: 'user' });
        const wallet = await createTestWallet(tx, owner.id);

        const walletUser = await tx.walletUser.create({
          data: { walletId: wallet.id, userId: user.id, role: 'viewer' },
        });

        await tx.walletUser.update({
          where: { id: walletUser.id },
          data: { role: 'signer' },
        });

        const updated = await tx.walletUser.findUnique({
          where: { id: walletUser.id },
        });

        expect(updated?.role).toBe('signer');
      });
    });
  });

  describe('removeUserFromWallet', () => {
    it('should remove user from wallet', async () => {
      await withTestTransaction(async (tx) => {
        const owner = await createTestUser(tx, { username: 'owner' });
        const viewer = await createTestUser(tx, { username: 'viewer' });
        const wallet = await createTestWallet(tx, owner.id);

        const walletUser = await tx.walletUser.create({
          data: { walletId: wallet.id, userId: viewer.id, role: 'viewer' },
        });

        await tx.walletUser.delete({
          where: { id: walletUser.id },
        });

        const remaining = await tx.walletUser.findFirst({
          where: { walletId: wallet.id, userId: viewer.id },
        });

        expect(remaining).toBeNull();
      });
    });
  });

  describe('isGroupMember', () => {
    it('should return true for group member', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const group = await createTestGroup(tx, { name: 'Test Group' });

        await addUserToGroup(tx, user.id, group.id);

        const member = await tx.groupMember.findFirst({
          where: { groupId: group.id, userId: user.id },
        });

        expect(member !== null).toBe(true);
      });
    });

    it('should return false for non-member', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const group = await createTestGroup(tx);

        const member = await tx.groupMember.findFirst({
          where: { groupId: group.id, userId: user.id },
        });

        expect(member === null).toBe(true);
      });
    });
  });

  describe('getGroupMember', () => {
    it('should get group member with role', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const group = await createTestGroup(tx);

        await addUserToGroup(tx, user.id, group.id, 'admin');

        const member = await tx.groupMember.findFirst({
          where: { groupId: group.id, userId: user.id },
        });

        expect(member?.role).toBe('admin');
      });
    });
  });

  describe('updateWalletGroup', () => {
    it('should assign wallet to group', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const group = await createTestGroup(tx);

        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            groupId: group.id,
            groupRole: 'viewer',
          },
        });

        const updated = await tx.wallet.findUnique({
          where: { id: wallet.id },
        });

        expect(updated?.groupId).toBe(group.id);
        expect(updated?.groupRole).toBe('viewer');
      });
    });

    it('should remove wallet from group', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const group = await createTestGroup(tx);

        // Create wallet with group
        const wallet = await tx.wallet.create({
          data: {
            name: 'Group Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            network: 'testnet3',
            groupId: group.id,
            groupRole: 'viewer',
          },
        });

        await tx.walletUser.create({
          data: { walletId: wallet.id, userId: user.id, role: 'owner' },
        });

        // Remove from group
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            groupId: null,
            groupRole: 'viewer',
          },
        });

        const updated = await tx.wallet.findUnique({
          where: { id: wallet.id },
        });

        expect(updated?.groupId).toBeNull();
      });
    });

    it('should update group role', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const group = await createTestGroup(tx);

        const wallet = await tx.wallet.create({
          data: {
            name: 'Group Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            network: 'testnet3',
            groupId: group.id,
            groupRole: 'viewer',
          },
        });

        await tx.walletUser.create({
          data: { walletId: wallet.id, userId: user.id, role: 'owner' },
        });

        await tx.wallet.update({
          where: { id: wallet.id },
          data: { groupRole: 'signer' },
        });

        const updated = await tx.wallet.findUnique({
          where: { id: wallet.id },
        });

        expect(updated?.groupRole).toBe('signer');
      });
    });
  });

  describe('getWalletSharingInfo', () => {
    it('should get wallet with all sharing info', async () => {
      await withTestTransaction(async (tx) => {
        const owner = await createTestUser(tx, { username: 'owner' });
        const viewer = await createTestUser(tx, { username: 'viewer' });
        const signer = await createTestUser(tx, { username: 'signer' });
        const group = await createTestGroup(tx, { name: 'Sharing Group' });

        const wallet = await tx.wallet.create({
          data: {
            name: 'Shared Wallet',
            type: 'multi_sig',
            scriptType: 'native_segwit',
            network: 'testnet3',
            quorum: 2,
            totalSigners: 3,
            groupId: group.id,
            groupRole: 'viewer',
          },
        });

        await tx.walletUser.createMany({
          data: [
            { walletId: wallet.id, userId: owner.id, role: 'owner' },
            { walletId: wallet.id, userId: viewer.id, role: 'viewer' },
            { walletId: wallet.id, userId: signer.id, role: 'signer' },
          ],
        });

        const sharingInfo = await tx.wallet.findUnique({
          where: { id: wallet.id },
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

        expect(sharingInfo?.group?.name).toBe('Sharing Group');
        expect(sharingInfo?.users).toHaveLength(3);
        expect(sharingInfo?.users.map((u) => u.role).sort()).toEqual(['owner', 'signer', 'viewer']);
      });
    });
  });

  describe('group-based wallet access', () => {
    it('should provide wallet access to group members', async () => {
      await withTestTransaction(async (tx) => {
        const owner = await createTestUser(tx, { username: 'owner' });
        const member1 = await createTestUser(tx, { username: 'member1' });
        const member2 = await createTestUser(tx, { username: 'member2' });
        const nonMember = await createTestUser(tx, { username: 'nonMember' });

        const group = await createTestGroup(tx);
        await addUserToGroup(tx, owner.id, group.id, 'admin');
        await addUserToGroup(tx, member1.id, group.id, 'member');
        await addUserToGroup(tx, member2.id, group.id, 'member');

        const wallet = await tx.wallet.create({
          data: {
            name: 'Group Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            network: 'testnet3',
            groupId: group.id,
            groupRole: 'viewer',
          },
        });

        await tx.walletUser.create({
          data: { walletId: wallet.id, userId: owner.id, role: 'owner' },
        });

        // Group members should have access
        const member1Access = await tx.wallet.findFirst({
          where: {
            id: wallet.id,
            group: { members: { some: { userId: member1.id } } },
          },
        });
        expect(member1Access).not.toBeNull();

        const member2Access = await tx.wallet.findFirst({
          where: {
            id: wallet.id,
            group: { members: { some: { userId: member2.id } } },
          },
        });
        expect(member2Access).not.toBeNull();

        // Non-member should not have access
        const nonMemberAccess = await tx.wallet.findFirst({
          where: {
            id: wallet.id,
            OR: [
              { users: { some: { userId: nonMember.id } } },
              { group: { members: { some: { userId: nonMember.id } } } },
            ],
          },
        });
        expect(nonMemberAccess).toBeNull();
      });
    });
  });

  describe('access control queries', () => {
    it('should find all accessible wallets for user', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const otherOwner = await createTestUser(tx, { username: 'other' });
        const group = await createTestGroup(tx);

        await addUserToGroup(tx, user.id, group.id);

        // Direct ownership
        await createTestWallet(tx, user.id, { name: 'Owned Wallet' });

        // Shared wallet
        const sharedWallet = await createTestWallet(tx, otherOwner.id, { name: 'Shared Wallet' });
        await tx.walletUser.create({
          data: { walletId: sharedWallet.id, userId: user.id, role: 'viewer' },
        });

        // Group wallet
        const groupWallet = await tx.wallet.create({
          data: {
            name: 'Group Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            network: 'testnet3',
            groupId: group.id,
          },
        });
        await tx.walletUser.create({
          data: { walletId: groupWallet.id, userId: otherOwner.id, role: 'owner' },
        });

        // Query all accessible wallets
        const accessibleWallets = await tx.wallet.findMany({
          where: {
            OR: [
              { users: { some: { userId: user.id } } },
              { group: { members: { some: { userId: user.id } } } },
            ],
          },
        });

        expect(accessibleWallets).toHaveLength(3);
        expect(accessibleWallets.map((w) => w.name).sort()).toEqual([
          'Group Wallet',
          'Owned Wallet',
          'Shared Wallet',
        ]);
      });
    });
  });
});
