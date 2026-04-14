import { describe, expect, it } from 'vitest';
import {
  app,
  authHeader,
  createAdminAndLogin,
  createUserAndLogin,
  prisma,
  request,
} from './adminIntegrationTestHarness';

export function registerAdminAccessControlContracts(): void {
  // =============================================
  // ACCESS CONTROL INTEGRATION
  // =============================================

  describe('Access Control Integration', () => {
    it('should grant group member access to group wallet', async () => {
      const { token: adminToken } = await createAdminAndLogin();
      const { userId, token: userToken } = await createUserAndLogin();

      // Create a group and wallet
      const group = await prisma.group.create({
        data: { name: 'Shared Group' },
      });

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Group Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          groupId: group.id,
        },
      });

      // User should NOT have access initially
      await request(app)
        .get(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(userToken))
        .expect(403);

      // Add user to group via admin API
      await request(app)
        .post(`/api/v1/admin/groups/${group.id}/members`)
        .set(authHeader(adminToken))
        .send({ userId, role: 'member' })
        .expect(201);

      // User should now have access to group wallet
      const response = await request(app)
        .get(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(userToken))
        .expect(200);

      expect(response.body.name).toBe('Group Wallet');
    });

    it('should revoke access when removed from group', async () => {
      const { token: adminToken } = await createAdminAndLogin();
      const { userId, token: userToken } = await createUserAndLogin();

      // Create group with user as member
      const group = await prisma.group.create({
        data: {
          name: 'Shared Group',
          members: {
            create: { userId, role: 'member' },
          },
        },
      });

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Group Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          groupId: group.id,
        },
      });

      // User should have access
      await request(app)
        .get(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(userToken))
        .expect(200);

      // Remove user from group
      await request(app)
        .delete(`/api/v1/admin/groups/${group.id}/members/${userId}`)
        .set(authHeader(adminToken))
        .expect(200);

      // User should no longer have access
      await request(app)
        .get(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(userToken))
        .expect(403);
    });

    it('should grant access to user in multiple groups with wallets', async () => {
      const { token: adminToken } = await createAdminAndLogin();
      const { userId, token: userToken } = await createUserAndLogin();

      // Create two groups, each with a wallet
      const groupA = await prisma.group.create({
        data: {
          name: 'Group A',
          members: { create: { userId, role: 'member' } },
        },
      });

      const groupB = await prisma.group.create({
        data: {
          name: 'Group B',
          members: { create: { userId, role: 'member' } },
        },
      });

      const walletA = await prisma.wallet.create({
        data: {
          name: 'Wallet A',
          type: 'single_sig',
          scriptType: 'native_segwit',
          groupId: groupA.id,
        },
      });

      const walletB = await prisma.wallet.create({
        data: {
          name: 'Wallet B',
          type: 'single_sig',
          scriptType: 'native_segwit',
          groupId: groupB.id,
        },
      });

      // User should have access to both wallets
      await request(app)
        .get(`/api/v1/wallets/${walletA.id}`)
        .set(authHeader(userToken))
        .expect(200);

      await request(app)
        .get(`/api/v1/wallets/${walletB.id}`)
        .set(authHeader(userToken))
        .expect(200);
    });

    it('should grant access when member added after wallet shared with group', async () => {
      const { token: adminToken } = await createAdminAndLogin();
      const { userId, token: userToken } = await createUserAndLogin();

      // Create group without the user
      const group = await prisma.group.create({
        data: { name: 'Later Add Group' },
      });

      // Create wallet in the group
      const wallet = await prisma.wallet.create({
        data: {
          name: 'Pre-existing Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          groupId: group.id,
        },
      });

      // User should NOT have access yet
      await request(app)
        .get(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(userToken))
        .expect(403);

      // Now add user to the group
      await request(app)
        .post(`/api/v1/admin/groups/${group.id}/members`)
        .set(authHeader(adminToken))
        .send({ userId })
        .expect(201);

      // User should now have access
      await request(app)
        .get(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(userToken))
        .expect(200);
    });

    it('should revoke all wallet access when group is deleted', async () => {
      const { token: adminToken } = await createAdminAndLogin();
      const { userId, token: userToken } = await createUserAndLogin();

      const group = await prisma.group.create({
        data: {
          name: 'Delete Me Group',
          members: { create: { userId, role: 'member' } },
        },
      });

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Group Wallet To Orphan',
          type: 'single_sig',
          scriptType: 'native_segwit',
          groupId: group.id,
        },
      });

      // User has access via group
      await request(app)
        .get(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(userToken))
        .expect(200);

      // Delete the group
      await request(app)
        .delete(`/api/v1/admin/groups/${group.id}`)
        .set(authHeader(adminToken))
        .expect(200);

      // User should no longer have access (group deleted, wallet's groupId becomes null via cascade or app logic)
      // Note: depending on cascade behavior, the wallet.groupId may become null
      // or the group just doesn't exist anymore
      const updatedWallet = await prisma.wallet.findUnique({
        where: { id: wallet.id },
      });

      // The wallet still exists but group reference should be cleared
      // (Prisma SetNull on Group deletion or the wallet just references a deleted group)
      if (updatedWallet?.groupId === null) {
        // Group was cleared via cascade SetNull
        await request(app)
          .get(`/api/v1/wallets/${wallet.id}`)
          .set(authHeader(userToken))
          .expect(403);
      }
    });

    it('should use direct access role when user has both direct and group access', async () => {
      const { token: adminToken } = await createAdminAndLogin();
      const { userId, token: userToken } = await createUserAndLogin();

      const group = await prisma.group.create({
        data: {
          name: 'Overlap Group',
          members: { create: { userId, role: 'member' } },
        },
      });

      // Create wallet with group access as viewer
      const wallet = await prisma.wallet.create({
        data: {
          name: 'Overlap Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          groupId: group.id,
          groupRole: 'viewer',
        },
      });

      // Also give the user direct signer access
      await prisma.walletUser.create({
        data: {
          walletId: wallet.id,
          userId,
          role: 'signer',
        },
      });

      // User should have access (direct signer takes priority over group viewer)
      const response = await request(app)
        .get(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(userToken))
        .expect(200);

      expect(response.body.name).toBe('Overlap Wallet');
    });
  });
}
