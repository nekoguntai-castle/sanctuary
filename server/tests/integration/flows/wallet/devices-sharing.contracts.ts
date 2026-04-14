import { describe, expect, it } from 'vitest';
import {
  app,
  authHeader,
  createAndLoginUser,
  createTestUser,
  prisma,
  request,
  uniqueFingerprint,
  uniqueUsername,
} from './walletIntegrationTestHarness';

export function registerWalletDevicesSharingTests(): void {
  describe('Wallet Devices', () => {
    it('should add a device to wallet (owner or signer)', async () => {
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

      const device = await prisma.device.create({
        data: {
          userId,
          type: 'coldcard',
          label: 'My ColdCard',
          fingerprint: uniqueFingerprint(),
          xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
          derivationPath: "m/84'/1'/0'",
        },
      });

      const response = await request(app)
        .post(`/api/v1/wallets/${wallet.id}/devices`)
        .set(authHeader(token))
        .send({ deviceId: device.id })
        .expect(201);

      expect(response.body.message).toBeDefined();

      // Verify device is linked to wallet
      const walletDevice = await prisma.walletDevice.findFirst({
        where: {
          walletId: wallet.id,
          deviceId: device.id,
        },
      });
      expect(walletDevice).not.toBeNull();
    });

    it('should add device with signer index for multi-sig', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Multi-Sig Wallet',
          type: 'multi_sig',
          scriptType: 'native_segwit',
          quorum: 2,
          totalSigners: 3,
          users: {
            create: {
              userId,
              role: 'owner',
            },
          },
        },
      });

      const device = await prisma.device.create({
        data: {
          userId,
          type: 'coldcard',
          label: 'ColdCard 1',
          fingerprint: uniqueFingerprint(),
          xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
          derivationPath: "m/48'/1'/0'/2'",
        },
      });

      await request(app)
        .post(`/api/v1/wallets/${wallet.id}/devices`)
        .set(authHeader(token))
        .send({ deviceId: device.id, signerIndex: 0 })
        .expect(201);

      // Verify signer index is set
      const walletDevice = await prisma.walletDevice.findFirst({
        where: {
          walletId: wallet.id,
          deviceId: device.id,
        },
      });
      expect(walletDevice?.signerIndex).toBe(0);
    });

    it('should allow signer to add device', async () => {
      const owner = await createTestUser(prisma, {
        username: uniqueUsername('owner'),
        password: 'OwnerPass123!',
      });

      const { userId: signerId, token: signerToken } = await createAndLoginUser(app, prisma, {
        username: uniqueUsername('signer'),
        password: 'SignerPass123!',
      });

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          users: {
            create: [
              { userId: owner.id, role: 'owner' },
              { userId: signerId, role: 'signer' },
            ],
          },
        },
      });

      const device = await prisma.device.create({
        data: {
          userId: signerId,
          type: 'ledger',
          label: 'Signer Ledger',
          fingerprint: uniqueFingerprint(),
          xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
        },
      });

      await request(app)
        .post(`/api/v1/wallets/${wallet.id}/devices`)
        .set(authHeader(signerToken))
        .send({ deviceId: device.id })
        .expect(201);
    });

    it('should deny viewer from adding device', async () => {
      const owner = await createTestUser(prisma, {
        username: uniqueUsername('owner'),
        password: 'OwnerPass123!',
      });

      const { userId: viewerId, token: viewerToken } = await createAndLoginUser(app, prisma, {
        username: uniqueUsername('viewer'),
        password: 'ViewerPass123!',
      });

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          users: {
            create: [
              { userId: owner.id, role: 'owner' },
              { userId: viewerId, role: 'viewer' },
            ],
          },
        },
      });

      const device = await prisma.device.create({
        data: {
          userId: viewerId,
          type: 'ledger',
          label: 'Viewer Ledger',
          fingerprint: uniqueFingerprint(),
          xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
        },
      });

      await request(app)
        .post(`/api/v1/wallets/${wallet.id}/devices`)
        .set(authHeader(viewerToken))
        .send({ deviceId: device.id })
        .expect(403);
    });

    it('should reject adding device without deviceId', async () => {
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

      await request(app)
        .post(`/api/v1/wallets/${wallet.id}/devices`)
        .set(authHeader(token))
        .send({})
        .expect(400);
    });
  });

  describe('Wallet Sharing', () => {
    describe('Share with User', () => {
      it('should share wallet with another user as viewer', async () => {
        const { userId: ownerId, token: ownerToken } = await createAndLoginUser(app, prisma, {
          username: uniqueUsername('owner'),
          password: 'OwnerPass123!',
        });

        const targetUser = await createTestUser(prisma, {
          username: uniqueUsername('targetuser'),
          password: 'TargetPass123!',
        });

        const wallet = await prisma.wallet.create({
          data: {
            name: 'Shared Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            users: {
              create: {
                userId: ownerId,
                role: 'owner',
              },
            },
          },
        });

        const response = await request(app)
          .post(`/api/v1/wallets/${wallet.id}/share/user`)
          .set(authHeader(ownerToken))
          .send({
            targetUserId: targetUser.id,
            role: 'viewer',
          })
          .expect(201);

        expect(response.body.success).toBe(true);

        // Verify user has access
        const walletUser = await prisma.walletUser.findFirst({
          where: {
            walletId: wallet.id,
            userId: targetUser.id,
          },
        });
        expect(walletUser).not.toBeNull();
        expect(walletUser?.role).toBe('viewer');
      });

      it('should share wallet with another user as signer', async () => {
        const { userId: ownerId, token: ownerToken } = await createAndLoginUser(app, prisma, {
          username: uniqueUsername('owner'),
          password: 'OwnerPass123!',
        });

        const targetUser = await createTestUser(prisma, {
          username: uniqueUsername('targetuser'),
          password: 'TargetPass123!',
        });

        const wallet = await prisma.wallet.create({
          data: {
            name: 'Shared Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            users: {
              create: {
                userId: ownerId,
                role: 'owner',
              },
            },
          },
        });

        await request(app)
          .post(`/api/v1/wallets/${wallet.id}/share/user`)
          .set(authHeader(ownerToken))
          .send({
            targetUserId: targetUser.id,
            role: 'signer',
          })
          .expect(201);

        // Verify user has signer access
        const walletUser = await prisma.walletUser.findFirst({
          where: {
            walletId: wallet.id,
            userId: targetUser.id,
          },
        });
        expect(walletUser?.role).toBe('signer');
      });

      it('should update existing user access when sharing again', async () => {
        const { userId: ownerId, token: ownerToken } = await createAndLoginUser(app, prisma, {
          username: uniqueUsername('owner'),
          password: 'OwnerPass123!',
        });

        const targetUser = await createTestUser(prisma, {
          username: uniqueUsername('targetuser'),
          password: 'TargetPass123!',
        });

        const wallet = await prisma.wallet.create({
          data: {
            name: 'Shared Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            users: {
              create: [
                { userId: ownerId, role: 'owner' },
                { userId: targetUser.id, role: 'viewer' },
              ],
            },
          },
        });

        // Upgrade viewer to signer
        await request(app)
          .post(`/api/v1/wallets/${wallet.id}/share/user`)
          .set(authHeader(ownerToken))
          .send({
            targetUserId: targetUser.id,
            role: 'signer',
          })
          .expect(200);

        // Verify role was updated
        const walletUser = await prisma.walletUser.findFirst({
          where: {
            walletId: wallet.id,
            userId: targetUser.id,
          },
        });
        expect(walletUser?.role).toBe('signer');
      });

      it('should deny non-owner from sharing wallet', async () => {
        const owner = await createTestUser(prisma, {
          username: uniqueUsername('owner'),
          password: 'OwnerPass123!',
        });

        const { userId: viewerId, token: viewerToken } = await createAndLoginUser(app, prisma, {
          username: uniqueUsername('viewer'),
          password: 'ViewerPass123!',
        });

        const targetUser = await createTestUser(prisma, {
          username: uniqueUsername('targetuser'),
          password: 'TargetPass123!',
        });

        const wallet = await prisma.wallet.create({
          data: {
            name: 'Shared Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            users: {
              create: [
                { userId: owner.id, role: 'owner' },
                { userId: viewerId, role: 'viewer' },
              ],
            },
          },
        });

        await request(app)
          .post(`/api/v1/wallets/${wallet.id}/share/user`)
          .set(authHeader(viewerToken))
          .send({
            targetUserId: targetUser.id,
            role: 'viewer',
          })
          .expect(403);
      });

      it('should return 404 when sharing with non-existent user', async () => {
        const { userId, token } = await createAndLoginUser(app, prisma);

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

        await request(app)
          .post(`/api/v1/wallets/${wallet.id}/share/user`)
          .set(authHeader(token))
          .send({
            targetUserId: '00000000-0000-0000-0000-000000000000',
            role: 'viewer',
          })
          .expect(404);
      });

      it('should reject sharing with invalid role', async () => {
        const { userId, token } = await createAndLoginUser(app, prisma);

        const targetUser = await createTestUser(prisma, {
          username: uniqueUsername('targetuser'),
          password: 'TargetPass123!',
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

        await request(app)
          .post(`/api/v1/wallets/${wallet.id}/share/user`)
          .set(authHeader(token))
          .send({
            targetUserId: targetUser.id,
            role: 'invalid_role',
          })
          .expect(400);
      });
    });

    describe('Remove User Access', () => {
      it('should remove user access from wallet', async () => {
        const { userId: ownerId, token: ownerToken } = await createAndLoginUser(app, prisma, {
          username: uniqueUsername('owner'),
          password: 'OwnerPass123!',
        });

        const targetUser = await createTestUser(prisma, {
          username: uniqueUsername('targetuser'),
          password: 'TargetPass123!',
        });

        const wallet = await prisma.wallet.create({
          data: {
            name: 'Shared Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            users: {
              create: [
                { userId: ownerId, role: 'owner' },
                { userId: targetUser.id, role: 'viewer' },
              ],
            },
          },
        });

        await request(app)
          .delete(`/api/v1/wallets/${wallet.id}/share/user/${targetUser.id}`)
          .set(authHeader(ownerToken))
          .expect(200);

        // Verify user no longer has access
        const walletUser = await prisma.walletUser.findFirst({
          where: {
            walletId: wallet.id,
            userId: targetUser.id,
          },
        });
        expect(walletUser).toBeNull();
      });

      it('should prevent removing the owner', async () => {
        const { userId: ownerId, token: ownerToken } = await createAndLoginUser(app, prisma, {
          username: uniqueUsername('owner'),
          password: 'OwnerPass123!',
        });

        const wallet = await prisma.wallet.create({
          data: {
            name: 'Test Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            users: {
              create: {
                userId: ownerId,
                role: 'owner',
              },
            },
          },
        });

        await request(app)
          .delete(`/api/v1/wallets/${wallet.id}/share/user/${ownerId}`)
          .set(authHeader(ownerToken))
          .expect(400);

        // Verify owner still has access
        const walletUser = await prisma.walletUser.findFirst({
          where: {
            walletId: wallet.id,
            userId: ownerId,
          },
        });
        expect(walletUser).not.toBeNull();
      });

      it('should return 404 when removing non-existent user', async () => {
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

        await request(app)
          .delete(`/api/v1/wallets/${wallet.id}/share/user/00000000-0000-0000-0000-000000000000`)
          .set(authHeader(token))
          .expect(404);
      });
    });

    describe('Get Sharing Info', () => {
      it('should get wallet sharing information', async () => {
        const { userId: ownerId, token: ownerToken } = await createAndLoginUser(app, prisma, {
          username: uniqueUsername('owner'),
          password: 'OwnerPass123!',
        });

        const viewer = await createTestUser(prisma, {
          username: uniqueUsername('viewer'),
          password: 'ViewerPass123!',
        });

        const signer = await createTestUser(prisma, {
          username: uniqueUsername('signer'),
          password: 'SignerPass123!',
        });

        const wallet = await prisma.wallet.create({
          data: {
            name: 'Shared Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            users: {
              create: [
                { userId: ownerId, role: 'owner' },
                { userId: viewer.id, role: 'viewer' },
                { userId: signer.id, role: 'signer' },
              ],
            },
          },
        });

        const response = await request(app)
          .get(`/api/v1/wallets/${wallet.id}/share`)
          .set(authHeader(ownerToken))
          .expect(200);

        expect(response.body.users).toBeDefined();
        expect(Array.isArray(response.body.users)).toBe(true);
        expect(response.body.users.length).toBe(3);

        // Verify all roles are present
        const roles = response.body.users.map((u: any) => u.role);
        expect(roles).toContain('owner');
        expect(roles).toContain('viewer');
        expect(roles).toContain('signer');
      });
    });
  });

}
