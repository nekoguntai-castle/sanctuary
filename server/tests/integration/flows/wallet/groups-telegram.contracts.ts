import { describe, expect, it } from 'vitest';
import {
  app,
  authHeader,
  createAndLoginUser,
  createTestUser,
  loginTestUser,
  prisma,
  request,
  uniqueUsername,
} from './walletIntegrationTestHarness';

export function registerWalletGroupsTelegramTests(): void {
  describe('Create Wallet with Group', () => {
    it('should create wallet with groupId and assign default viewer role', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      // Create a group
      const group = await prisma.group.create({
        data: { name: 'Creation Group' },
      });

      const walletData = {
        name: 'Group Wallet at Creation',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet',
        descriptor: "wpkh([aabbccdd/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)",
        groupId: group.id,
      };

      const response = await request(app)
        .post('/api/v1/wallets')
        .set(authHeader(token))
        .send(walletData)
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.name).toBe(walletData.name);

      // Verify wallet is assigned to group with default viewer role
      const wallet = await prisma.wallet.findUnique({
        where: { id: response.body.id },
      });
      expect(wallet?.groupId).toBe(group.id);
      expect(wallet?.groupRole).toBe('viewer');

      // Creator should be owner
      const walletUser = await prisma.walletUser.findFirst({
        where: { walletId: response.body.id, userId },
      });
      expect(walletUser?.role).toBe('owner');
    });

    it('should give group members access to wallet created with groupId', async () => {
      const { userId: ownerId, token: ownerToken } = await createAndLoginUser(app, prisma, {
        username: uniqueUsername('groupcreateowner'),
        password: 'OwnerPass123!',
      });

      const member = await createTestUser(prisma, {
        username: uniqueUsername('groupcreatemember'),
        password: 'MemberPass123!',
      });
      const memberToken = await loginTestUser(app, {
        username: member.username,
        password: 'MemberPass123!',
      });

      // Create group with member
      const group = await prisma.group.create({
        data: {
          name: 'Access Test Group',
          members: {
            createMany: {
              data: [
                { userId: ownerId, role: 'admin' },
                { userId: member.id, role: 'member' },
              ],
            },
          },
        },
      });

      // Create wallet via API with groupId
      const walletResponse = await request(app)
        .post('/api/v1/wallets')
        .set(authHeader(ownerToken))
        .send({
          name: 'Group Member Access Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'testnet',
          descriptor: "wpkh([aabbccdd/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)",
          groupId: group.id,
        })
        .expect(201);

      // Group member should have access to the wallet
      await request(app)
        .get(`/api/v1/wallets/${walletResponse.body.id}`)
        .set(authHeader(memberToken))
        .expect(200);
    });

    it('should create wallet without groupId (no group assignment)', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      const response = await request(app)
        .post('/api/v1/wallets')
        .set(authHeader(token))
        .send({
          name: 'No Group Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'testnet',
          descriptor: "wpkh([aabbccdd/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)",
        })
        .expect(201);

      const wallet = await prisma.wallet.findUnique({
        where: { id: response.body.id },
      });
      expect(wallet?.groupId).toBeNull();
    });
  });

  describe('Group Sharing', () => {
    it('should share wallet with a group', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      // Create a group
      const group = await prisma.group.create({
        data: {
          name: 'Test Group',
          members: {
            create: {
              userId,
              role: 'admin',
            },
          },
        },
      });

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Shared Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          users: {
            create: {
              userId,
              role: 'owner',
            },
          },
        },
      });

      const response = await request(app)
        .post(`/api/v1/wallets/${wallet.id}/share/group`)
        .set(authHeader(token))
        .send({
          groupId: group.id,
          role: 'viewer',
        })
        .expect(200); // API returns 200 not 201

      expect(response.body.success).toBe(true);

      // Verify wallet is linked to group
      const updatedWallet = await prisma.wallet.findUnique({
        where: { id: wallet.id },
        select: { groupId: true },
      });
      expect(updatedWallet?.groupId).toBe(group.id);
    });

    it('should unshare wallet from group', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      const group = await prisma.group.create({
        data: {
          name: 'Unshare Group',
          members: { create: { userId, role: 'admin' } },
        },
      });

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Wallet to Unshare',
          type: 'single_sig',
          scriptType: 'native_segwit',
          groupId: group.id,
          groupRole: 'viewer',
          users: { create: { userId, role: 'owner' } },
        },
      });

      // Unshare by sending null groupId
      const response = await request(app)
        .post(`/api/v1/wallets/${wallet.id}/share/group`)
        .set(authHeader(token))
        .send({ groupId: null })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.groupId).toBeNull();

      // Verify wallet is no longer linked to group
      const updatedWallet = await prisma.wallet.findUnique({
        where: { id: wallet.id },
        select: { groupId: true },
      });
      expect(updatedWallet?.groupId).toBeNull();
    });

    it('should share wallet with group and grant member access', async () => {
      const { userId: ownerId, token: ownerToken } = await createAndLoginUser(app, prisma, {
        username: uniqueUsername('shareowner'),
        password: 'OwnerPass123!',
      });

      const member = await createTestUser(prisma, {
        username: uniqueUsername('sharemember'),
        password: 'MemberPass123!',
      });
      const memberToken = await loginTestUser(app, {
        username: member.username,
        password: 'MemberPass123!',
      });

      // Create group with both users
      const group = await prisma.group.create({
        data: {
          name: 'Share Flow Group',
          members: {
            createMany: {
              data: [
                { userId: ownerId, role: 'admin' },
                { userId: member.id, role: 'member' },
              ],
            },
          },
        },
      });

      // Create wallet owned by the owner
      const wallet = await prisma.wallet.create({
        data: {
          name: 'Flow Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          users: { create: { userId: ownerId, role: 'owner' } },
        },
      });

      // Member should NOT have access yet
      await request(app)
        .get(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(memberToken))
        .expect(403);

      // Share wallet with group
      await request(app)
        .post(`/api/v1/wallets/${wallet.id}/share/group`)
        .set(authHeader(ownerToken))
        .send({ groupId: group.id, role: 'viewer' })
        .expect(200);

      // Member should now have access
      const walletResponse = await request(app)
        .get(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(memberToken))
        .expect(200);

      expect(walletResponse.body.name).toBe('Flow Test Wallet');
    });

    it('should revoke group member access when wallet unshared from group', async () => {
      const { userId: ownerId, token: ownerToken } = await createAndLoginUser(app, prisma, {
        username: uniqueUsername('revokeowner'),
        password: 'OwnerPass123!',
      });

      const member = await createTestUser(prisma, {
        username: uniqueUsername('revokemember'),
        password: 'MemberPass123!',
      });
      const memberToken = await loginTestUser(app, {
        username: member.username,
        password: 'MemberPass123!',
      });

      const group = await prisma.group.create({
        data: {
          name: 'Revoke Flow Group',
          members: {
            createMany: {
              data: [
                { userId: ownerId, role: 'admin' },
                { userId: member.id, role: 'member' },
              ],
            },
          },
        },
      });

      // Wallet shared with group
      const wallet = await prisma.wallet.create({
        data: {
          name: 'Revoke Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          groupId: group.id,
          groupRole: 'viewer',
          users: { create: { userId: ownerId, role: 'owner' } },
        },
      });

      // Member has access
      await request(app)
        .get(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(memberToken))
        .expect(200);

      // Unshare from group
      await request(app)
        .post(`/api/v1/wallets/${wallet.id}/share/group`)
        .set(authHeader(ownerToken))
        .send({ groupId: null })
        .expect(200);

      // Member should lose access
      await request(app)
        .get(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(memberToken))
        .expect(403);
    });

    it('should reject invalid role when sharing with group', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      const group = await prisma.group.create({
        data: {
          name: 'Invalid Role Group',
          members: { create: { userId, role: 'admin' } },
        },
      });

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Invalid Role Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          users: { create: { userId, role: 'owner' } },
        },
      });

      await request(app)
        .post(`/api/v1/wallets/${wallet.id}/share/group`)
        .set(authHeader(token))
        .send({ groupId: group.id, role: 'owner' })
        .expect(400);
    });

    it('should deny sharing with non-existent group (403 for security)', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          users: {
            create: {
              userId,
              role: 'owner',
            },
          },
        },
      });

      // API returns 403 instead of 404 to not reveal group existence
      await request(app)
        .post(`/api/v1/wallets/${wallet.id}/share/group`)
        .set(authHeader(token))
        .send({
          groupId: '00000000-0000-0000-0000-000000000000',
          role: 'viewer',
        })
        .expect(403);
    });
  });

  describe('Telegram Integration', () => {
    it('should get telegram settings for wallet', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          users: {
            create: {
              userId,
              role: 'owner',
            },
          },
        },
      });

      const response = await request(app)
        .get(`/api/v1/wallets/${wallet.id}/telegram`)
        .set(authHeader(token))
        .expect(200);

      expect(response.body).toBeDefined();
    });

    it('should update telegram settings for wallet', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          users: {
            create: {
              userId,
              role: 'owner',
            },
          },
        },
      });

      const response = await request(app)
        .patch(`/api/v1/wallets/${wallet.id}/telegram`)
        .set(authHeader(token))
        .send({
          enabled: true,
          notifications: {
            received: true,
            sent: true,
          },
        })
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });}
