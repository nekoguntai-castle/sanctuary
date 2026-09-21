/**
 * Device Sharing Repository Integration Tests
 *
 * Tests device sharing operations against a real PostgreSQL database.
 * Covers group-based device access, user sharing, and access queries.
 */

import { deviceRepository } from '../../../src/repositories';
import { shareDeviceWithGroup } from '../../../src/services/deviceAccess';
import {
  describeIfDatabase,
  setupRepositoryTests,
  withTestTransaction,
  createTestUser,
  createTestDevice,
  createTestGroup,
  addUserToGroup,
  createTestWallet,
  getTestPrisma,
} from './setup';

describeIfDatabase('Device Sharing Repository Integration Tests', () => {
  setupRepositoryTests();

  // =============================================
  // DEVICE-USER SHARING
  // =============================================

  describe('Device-User Sharing', () => {
    it('should share device with user as viewer', async () => {
      await withTestTransaction(async (tx) => {
        const owner = await createTestUser(tx, { username: 'owner' });
        const viewer = await createTestUser(tx, { username: 'viewer' });
        const device = await createTestDevice(tx, owner.id);

        // Create owner DeviceUser
        await tx.deviceUser.create({
          data: { deviceId: device.id, userId: owner.id, role: 'owner' },
        });

        // Share with viewer
        await tx.deviceUser.create({
          data: { deviceId: device.id, userId: viewer.id, role: 'viewer' },
        });

        const deviceUser = await tx.deviceUser.findFirst({
          where: { deviceId: device.id, userId: viewer.id },
        });

        expect(deviceUser).not.toBeNull();
        expect(deviceUser?.role).toBe('viewer');
      });
    });

    it('should enforce unique device-user combination', async () => {
      await withTestTransaction(async (tx) => {
        const owner = await createTestUser(tx, { username: 'owner' });
        const viewer = await createTestUser(tx, { username: 'viewer' });
        const device = await createTestDevice(tx, owner.id);

        await tx.deviceUser.create({
          data: { deviceId: device.id, userId: viewer.id, role: 'viewer' },
        });

        await expect(
          tx.deviceUser.create({
            data: { deviceId: device.id, userId: viewer.id, role: 'owner' },
          })
        ).rejects.toThrow();
      });
    });

    it('should remove user from device', async () => {
      await withTestTransaction(async (tx) => {
        const owner = await createTestUser(tx, { username: 'owner' });
        const viewer = await createTestUser(tx, { username: 'viewer' });
        const device = await createTestDevice(tx, owner.id);

        const deviceUser = await tx.deviceUser.create({
          data: { deviceId: device.id, userId: viewer.id, role: 'viewer' },
        });

        await tx.deviceUser.delete({ where: { id: deviceUser.id } });

        const remaining = await tx.deviceUser.findFirst({
          where: { deviceId: device.id, userId: viewer.id },
        });
        expect(remaining).toBeNull();
      });
    });
  });

  // =============================================
  // DEVICE-GROUP SHARING
  // =============================================

  describe('Device-Group Sharing', () => {
    it('should assign device to group', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const device = await createTestDevice(tx, user.id);
        const group = await createTestGroup(tx);

        await tx.device.update({
          where: { id: device.id },
          data: { groupId: group.id, groupRole: 'viewer' },
        });

        const updated = await tx.device.findUnique({
          where: { id: device.id },
        });

        expect(updated?.groupId).toBe(group.id);
        expect(updated?.groupRole).toBe('viewer');
      });
    });

    it('should unshare device from group', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const group = await createTestGroup(tx);
        const device = await createTestDevice(tx, user.id);

        // Assign to group
        await tx.device.update({
          where: { id: device.id },
          data: { groupId: group.id, groupRole: 'viewer' },
        });

        // Remove from group
        await tx.device.update({
          where: { id: device.id },
          data: { groupId: null, groupRole: 'viewer' },
        });

        const updated = await tx.device.findUnique({
          where: { id: device.id },
        });

        expect(updated?.groupId).toBeNull();
      });
    });

    it('should provide device access to group members', async () => {
      await withTestTransaction(async (tx) => {
        const owner = await createTestUser(tx, { username: 'owner' });
        const member = await createTestUser(tx, { username: 'member' });
        const nonMember = await createTestUser(tx, { username: 'nonMember' });
        const group = await createTestGroup(tx);

        await addUserToGroup(tx, member.id, group.id);

        const device = await createTestDevice(tx, owner.id);
        await tx.device.update({
          where: { id: device.id },
          data: { groupId: group.id, groupRole: 'viewer' },
        });

        // Group member should have access
        const memberAccess = await tx.device.findFirst({
          where: {
            id: device.id,
            group: { members: { some: { userId: member.id } } },
          },
        });
        expect(memberAccess).not.toBeNull();

        // Non-member should not have access
        const nonMemberAccess = await tx.device.findFirst({
          where: {
            id: device.id,
            OR: [
              { users: { some: { userId: nonMember.id } } },
              { group: { members: { some: { userId: nonMember.id } } } },
            ],
          },
        });
        expect(nonMemberAccess).toBeNull();
      });
    });

    it('should revoke device access when user removed from group', async () => {
      await withTestTransaction(async (tx) => {
        const owner = await createTestUser(tx, { username: 'owner' });
        const member = await createTestUser(tx, { username: 'member' });
        const group = await createTestGroup(tx);

        const membership = await addUserToGroup(tx, member.id, group.id);

        const device = await createTestDevice(tx, owner.id);
        await tx.device.update({
          where: { id: device.id },
          data: { groupId: group.id, groupRole: 'viewer' },
        });

        // Member has access
        const beforeRemoval = await tx.device.findFirst({
          where: {
            id: device.id,
            group: { members: { some: { userId: member.id } } },
          },
        });
        expect(beforeRemoval).not.toBeNull();

        // Remove from group
        await tx.groupMember.delete({
          where: { id: membership.id },
        });

        // Member should lose access
        const afterRemoval = await tx.device.findFirst({
          where: {
            id: device.id,
            group: { members: { some: { userId: member.id } } },
          },
        });
        expect(afterRemoval).toBeNull();
      });
    });
  });

  // =============================================
  // DEVICE SHARING INFO
  // =============================================

  describe('Device Sharing Info', () => {
    it('should get device with all sharing info', async () => {
      await withTestTransaction(async (tx) => {
        const owner = await createTestUser(tx, { username: 'owner' });
        const viewer = await createTestUser(tx, { username: 'viewer' });
        const group = await createTestGroup(tx, { name: 'Sharing Group' });

        const device = await createTestDevice(tx, owner.id);
        await tx.device.update({
          where: { id: device.id },
          data: { groupId: group.id, groupRole: 'viewer' },
        });

        await tx.deviceUser.create({
          data: { deviceId: device.id, userId: owner.id, role: 'owner' },
        });
        await tx.deviceUser.create({
          data: { deviceId: device.id, userId: viewer.id, role: 'viewer' },
        });

        const sharingInfo = await tx.device.findUnique({
          where: { id: device.id },
          include: {
            group: { select: { id: true, name: true } },
            users: {
              include: {
                user: { select: { id: true, username: true } },
              },
            },
          },
        });

        expect(sharingInfo?.group?.name).toBe('Sharing Group');
        expect(sharingInfo?.users).toHaveLength(2);
        expect(sharingInfo?.users.map((u) => u.role).sort()).toEqual(['owner', 'viewer']);
      });
    });
  });

  // =============================================
  // DEVICE ACCESS QUERIES
  // =============================================

  describe('Device Access Queries', () => {
    it('lists account xpubs only for members after authorized group sharing', async () => {
      const db = await getTestPrisma();
      const userIds: string[] = [];
      let groupId: string | undefined;
      let deviceId: string | undefined;
      try {
        const owner = await createTestUser(db);
        userIds.push(owner.id);
        const member = await createTestUser(db);
        userIds.push(member.id);
        const outsider = await createTestUser(db);
        userIds.push(outsider.id);
        const group = await createTestGroup(db);
        groupId = group.id;
        await addUserToGroup(db, owner.id, groupId);
        await addUserToGroup(db, member.id, groupId);

        const device = await createTestDevice(db, owner.id);
        deviceId = device.id;
        await db.deviceUser.create({
          data: { deviceId, userId: owner.id, role: 'owner' },
        });
        const accountXpub = 'integration-account-xpub';
        await db.deviceAccount.create({
          data: {
            deviceId,
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/1'/0'",
            xpub: accountXpub,
          },
        });

        expect(await shareDeviceWithGroup(deviceId, groupId, owner.id))
          .toMatchObject({ success: true, groupName: group.name });
        const memberDevices = await deviceRepository.findAccessibleByUser(member.id);
        expect(memberDevices.find(item => item.id === deviceId)?.accounts)
          .toEqual([expect.objectContaining({ xpub: accountXpub })]);
        const outsiderDevices = await deviceRepository.findAccessibleByUser(outsider.id);
        expect(outsiderDevices.some(item => item.id === deviceId)).toBe(false);
      } finally {
        if (deviceId) await db.device.deleteMany({ where: { id: deviceId } });
        if (groupId) await db.group.deleteMany({ where: { id: groupId } });
        if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
      }
    });

    it('should find all accessible devices for user (owned, shared, group-based)', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const otherOwner = await createTestUser(tx, { username: 'other' });
        const group = await createTestGroup(tx);

        await addUserToGroup(tx, user.id, group.id);

        // Owned device
        const ownedDevice = await createTestDevice(tx, user.id, { label: 'Owned' });
        await tx.deviceUser.create({
          data: { deviceId: ownedDevice.id, userId: user.id, role: 'owner' },
        });

        // Shared device
        const sharedDevice = await createTestDevice(tx, otherOwner.id, { label: 'Shared' });
        await tx.deviceUser.create({
          data: { deviceId: sharedDevice.id, userId: otherOwner.id, role: 'owner' },
        });
        await tx.deviceUser.create({
          data: { deviceId: sharedDevice.id, userId: user.id, role: 'viewer' },
        });

        // Group device
        const groupDevice = await createTestDevice(tx, otherOwner.id, { label: 'Group' });
        await tx.device.update({
          where: { id: groupDevice.id },
          data: { groupId: group.id, groupRole: 'viewer' },
        });

        // Query all accessible devices
        const accessibleDevices = await tx.device.findMany({
          where: {
            OR: [
              { users: { some: { userId: user.id } } },
              { group: { members: { some: { userId: user.id } } } },
            ],
          },
        });

        expect(accessibleDevices).toHaveLength(3);
        expect(accessibleDevices.map((d) => d.label).sort()).toEqual([
          'Group',
          'Owned',
          'Shared',
        ]);
      });
    });

    it('should not include devices the user has no access to', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const otherOwner = await createTestUser(tx, { username: 'other' });

        // Device owned by someone else, not shared
        await createTestDevice(tx, otherOwner.id, { label: 'Private' });

        const accessibleDevices = await tx.device.findMany({
          where: {
            OR: [
              { users: { some: { userId: user.id } } },
              { group: { members: { some: { userId: user.id } } } },
            ],
          },
        });

        expect(accessibleDevices).toHaveLength(0);
      });
    });
  });

  // =============================================
  // CROSS-CUTTING: WALLET-DEVICE-GROUP
  // =============================================

  describe('Cross-cutting: Wallet-Device-Group Access', () => {
    it('should allow group member access to both wallet and device in same group', async () => {
      await withTestTransaction(async (tx) => {
        const owner = await createTestUser(tx, { username: 'owner' });
        const member = await createTestUser(tx, { username: 'member' });
        const group = await createTestGroup(tx);

        await addUserToGroup(tx, member.id, group.id);

        // Create wallet in group
        const wallet = await createTestWallet(tx, owner.id, { groupId: group.id });

        // Create device in same group
        const device = await createTestDevice(tx, owner.id);
        await tx.device.update({
          where: { id: device.id },
          data: { groupId: group.id, groupRole: 'viewer' },
        });

        // Member should have access to both
        const walletAccess = await tx.wallet.findFirst({
          where: {
            id: wallet.id,
            group: { members: { some: { userId: member.id } } },
          },
        });
        expect(walletAccess).not.toBeNull();

        const deviceAccess = await tx.device.findFirst({
          where: {
            id: device.id,
            group: { members: { some: { userId: member.id } } },
          },
        });
        expect(deviceAccess).not.toBeNull();
      });
    });

    it('should handle group deletion clearing device groupId', async () => {
      await withTestTransaction(async (tx) => {
        const owner = await createTestUser(tx, { username: 'owner' });
        const group = await createTestGroup(tx);

        const device = await createTestDevice(tx, owner.id);
        await tx.device.update({
          where: { id: device.id },
          data: { groupId: group.id, groupRole: 'viewer' },
        });

        // Clear group assignment before deleting group (mimics app behavior)
        await tx.device.updateMany({
          where: { groupId: group.id },
          data: { groupId: null, groupRole: 'viewer' },
        });

        await tx.group.delete({ where: { id: group.id } });

        const updated = await tx.device.findUnique({
          where: { id: device.id },
        });

        expect(updated?.groupId).toBeNull();
      });
    });
  });
});
