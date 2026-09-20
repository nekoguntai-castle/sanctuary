/** Exercise mobile permissions against committed direct and group relationships. */

import { mobilePermissionService } from '../../../src/services/mobilePermissions';
import {
  addUserToGroup,
  createTestGroup,
  createTestUser,
  createTestWallet,
  describeIfDatabase,
  getTestPrisma,
  setupRepositoryTests,
} from './setup';

describeIfDatabase('mobile permission effective wallet access', () => {
  setupRepositoryTests();

  it('uses direct-first roles across action checks, saved reads, and owner lists', async () => {
    const db = await getTestPrisma();
    const userIds: string[] = [];
    let groupId: string | undefined;
    let walletId: string | undefined;
    try {
      const owner = await createTestUser(db, { username: 'mobile-access-owner', email: 'mobile-access-owner@example.com' });
      const groupOnly = await createTestUser(db, { username: 'mobile-access-group', email: 'mobile-access-group@example.com' });
      const mixed = await createTestUser(db, { username: 'mobile-access-mixed', email: 'mobile-access-mixed@example.com' });
      const outsider = await createTestUser(db, { username: 'mobile-access-outsider', email: 'mobile-access-outsider@example.com' });
      userIds.push(owner.id, groupOnly.id, mixed.id, outsider.id);

      const group = await createTestGroup(db);
      groupId = group.id;
      await addUserToGroup(db, groupOnly.id, group.id);
      await addUserToGroup(db, mixed.id, group.id);
      const wallet = await createTestWallet(db, owner.id, { groupId: group.id });
      walletId = wallet.id;
      await db.walletUser.create({ data: { walletId, userId: mixed.id, role: 'viewer' } });

      await db.wallet.update({ where: { id: walletId }, data: { groupRole: 'viewer' } });
      expect(await mobilePermissionService.canPerformAction(walletId, groupOnly.id, 'viewBalance')).toBe(true);
      expect(await mobilePermissionService.canPerformAction(walletId, groupOnly.id, 'broadcast')).toBe(false);
      expect(await mobilePermissionService.canPerformAction(walletId, outsider.id, 'viewBalance')).toBe(false);

      await db.wallet.update({ where: { id: walletId }, data: { groupRole: 'signer' } });
      expect(await mobilePermissionService.checkForGateway(walletId, groupOnly.id, 'broadcast'))
        .toMatchObject({ allowed: true });
      expect(await mobilePermissionService.canPerformAction(walletId, mixed.id, 'broadcast')).toBe(false);

      await db.mobilePermission.create({ data: {
        walletId, userId: groupOnly.id, canBroadcast: false,
        ownerMaxPermissions: { createTransaction: false },
      } });
      const effective = await mobilePermissionService.getEffectivePermissions(walletId, groupOnly.id);
      expect(effective).toMatchObject({ role: 'signer', hasCustomRestrictions: true, hasOwnerRestrictions: true });
      expect(effective.permissions.broadcast).toBe(false);
      expect(effective.permissions.createTransaction).toBe(false);

      const saved = await mobilePermissionService.getUserMobilePermissions(groupOnly.id);
      expect(saved).toHaveLength(1);
      expect(saved[0].role).toBe('signer');
      expect(saved[0].effectivePermissions.broadcast).toBe(false);

      const listed = await mobilePermissionService.getWalletPermissions(walletId, owner.id);
      expect(listed).toHaveLength(3);
      expect(listed.find(entry => entry.userId === mixed.id)?.role).toBe('viewer');
      expect(listed.find(entry => entry.userId === groupOnly.id)?.hasOwnerRestrictions).toBe(true);

      await db.wallet.update({ where: { id: walletId }, data: { groupRole: 'owner' } });
      expect(await mobilePermissionService.canPerformAction(walletId, groupOnly.id, 'manageDevices')).toBe(true);
      await db.groupMember.delete({ where: { userId_groupId: { userId: groupOnly.id, groupId } } });
      expect(await mobilePermissionService.canPerformAction(walletId, groupOnly.id, 'viewBalance')).toBe(false);
      expect(await mobilePermissionService.getUserMobilePermissions(groupOnly.id)).toEqual([]);
      expect((await mobilePermissionService.getWalletPermissions(walletId, owner.id))
        .some(entry => entry.userId === groupOnly.id)).toBe(false);
    } finally {
      if (walletId) await db.wallet.deleteMany({ where: { id: walletId } });
      if (groupId) await db.group.deleteMany({ where: { id: groupId } });
      if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });
});
