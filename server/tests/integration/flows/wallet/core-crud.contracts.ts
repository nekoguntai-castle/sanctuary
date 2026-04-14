import { describe, expect, it } from 'vitest';
import {
  app,
  authHeader,
  createAndLoginUser,
  createTestUser,
  prisma,
  request,
  uniqueUsername,
} from './walletIntegrationTestHarness';

export function registerWalletCoreCrudTests(): void {
  describe('Create Wallet', () => {
    it('should create a single-sig native segwit wallet', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      const walletData = {
        name: 'My Single Sig Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet',
        descriptor: "wpkh([aabbccdd/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)",
      };

      const response = await request(app)
        .post('/api/v1/wallets')
        .set(authHeader(token))
        .send(walletData)
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.name).toBe(walletData.name);
      expect(response.body.type).toBe(walletData.type);
      expect(response.body.scriptType).toBe(walletData.scriptType);
      expect(response.body.network).toBe(walletData.network);
      expect(response.body.descriptor).toBe(walletData.descriptor);
    });

    it('should create a multi-sig wallet', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      const walletData = {
        name: 'My Multi-Sig Wallet',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'testnet',
        quorum: 2,
        totalSigners: 3,
        descriptor: "wsh(sortedmulti(2,[aabbccdd/48'/1'/0'/2']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*,[11223344/48'/1'/0'/2']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*,[55667788/48'/1'/0'/2']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*))",
      };

      const response = await request(app)
        .post('/api/v1/wallets')
        .set(authHeader(token))
        .send(walletData)
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.name).toBe(walletData.name);
      expect(response.body.type).toBe(walletData.type);
      expect(response.body.quorum).toBe(walletData.quorum);
      expect(response.body.totalSigners).toBe(walletData.totalSigners);
    });

    it('should create a taproot wallet', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      const walletData = {
        name: 'My Taproot Wallet',
        type: 'single_sig',
        scriptType: 'taproot',
        network: 'testnet',
        descriptor: "tr([aabbccdd/86'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)",
      };

      const response = await request(app)
        .post('/api/v1/wallets')
        .set(authHeader(token))
        .send(walletData)
        .expect(201);

      expect(response.body.scriptType).toBe('taproot');
    });

    it('should reject wallet creation with missing required fields', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      await request(app)
        .post('/api/v1/wallets')
        .set(authHeader(token))
        .send({
          name: 'Incomplete Wallet',
          // Missing type and scriptType
        })
        .expect(400);
    });

    it('should reject wallet creation with invalid type', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      await request(app)
        .post('/api/v1/wallets')
        .set(authHeader(token))
        .send({
          name: 'Invalid Wallet',
          type: 'invalid_type',
          scriptType: 'native_segwit',
        })
        .expect(400);
    });

    it('should reject wallet creation with invalid scriptType', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      await request(app)
        .post('/api/v1/wallets')
        .set(authHeader(token))
        .send({
          name: 'Invalid Wallet',
          type: 'single_sig',
          scriptType: 'invalid_script',
        })
        .expect(400);
    });
  });

  describe('Get Wallets', () => {
    it('should get all wallets for a user', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      // Create multiple wallets
      const wallet1 = await prisma.wallet.create({
        data: {
          name: 'Wallet 1',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'testnet',
          descriptor: "wpkh([aabbccdd/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)",
          users: {
            create: {
              userId,
              role: 'owner',
            },
          },
        },
      });

      const wallet2 = await prisma.wallet.create({
        data: {
          name: 'Wallet 2',
          type: 'multi_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
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

      const response = await request(app)
        .get('/api/v1/wallets')
        .set(authHeader(token))
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(2);
      expect(response.body.find((w: any) => w.id === wallet1.id)).toBeDefined();
      expect(response.body.find((w: any) => w.id === wallet2.id)).toBeDefined();
    });

    it('should return empty array when user has no wallets', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      const response = await request(app)
        .get('/api/v1/wallets')
        .set(authHeader(token))
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(0);
    });
  });

  describe('Get Wallet by ID', () => {
    it('should get a specific wallet by ID', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'testnet',
          users: {
            create: {
              userId,
              role: 'owner',
            },
          },
        },
      });

      const response = await request(app)
        .get(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(token))
        .expect(200);

      expect(response.body.id).toBe(wallet.id);
      expect(response.body.name).toBe(wallet.name);
      expect(response.body.type).toBe(wallet.type);
    });

    it('should return 403 for non-existent wallet (security: don\'t reveal existence)', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      // API returns 403 instead of 404 to avoid revealing whether wallet exists
      await request(app)
        .get('/api/v1/wallets/00000000-0000-0000-0000-000000000000')
        .set(authHeader(token))
        .expect(403);
    });

    it('should deny access to wallet user does not have access to', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      // Create another user and their wallet
      const otherUser = await createTestUser(prisma, {
        username: uniqueUsername('otheruser'),
        password: 'OtherPassword123!',
      });

      const otherWallet = await prisma.wallet.create({
        data: {
          name: 'Other User Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          users: {
            create: {
              userId: otherUser.id,
              role: 'owner',
            },
          },
        },
      });

      await request(app)
        .get(`/api/v1/wallets/${otherWallet.id}`)
        .set(authHeader(token))
        .expect(403);
    });
  });

  describe('Update Wallet', () => {
    it('should update wallet name (owner only)', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Original Name',
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
        .patch(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(token))
        .send({ name: 'Updated Name' })
        .expect(200);

      expect(response.body.name).toBe('Updated Name');

      // Verify in database
      const updated = await prisma.wallet.findUnique({
        where: { id: wallet.id },
      });
      expect(updated?.name).toBe('Updated Name');
    });

    it('should update wallet descriptor (owner only)', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          descriptor: "wpkh([old]tpubOld/0/*)",
          users: {
            create: {
              userId,
              role: 'owner',
            },
          },
        },
      });

      const newDescriptor = "wpkh([aabbccdd/84'/1'/0']tpubNew/0/*)";
      const response = await request(app)
        .patch(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(token))
        .send({ descriptor: newDescriptor })
        .expect(200);

      expect(response.body.descriptor).toBe(newDescriptor);
    });

    it('should deny update for non-owner (viewer)', async () => {
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

      await request(app)
        .patch(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(viewerToken))
        .send({ name: 'Hacked Name' })
        .expect(403);
    });

    it('should deny update for non-owner (signer)', async () => {
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

      await request(app)
        .patch(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(signerToken))
        .send({ name: 'Hacked Name' })
        .expect(403);
    });
  });

  describe('Delete Wallet', () => {
    it('should delete wallet (owner only)', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Wallet to Delete',
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
        .delete(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(token))
        .expect(204);

      // Verify wallet is deleted
      const deleted = await prisma.wallet.findUnique({
        where: { id: wallet.id },
      });
      expect(deleted).toBeNull();
    });

    it('should deny delete for non-owner (viewer)', async () => {
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
          name: 'Protected Wallet',
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
        .delete(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(viewerToken))
        .expect(403);

      // Verify wallet still exists
      const stillExists = await prisma.wallet.findUnique({
        where: { id: wallet.id },
      });
      expect(stillExists).not.toBeNull();
    });

    it('should deny delete for non-owner (signer)', async () => {
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
          name: 'Protected Wallet',
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

      await request(app)
        .delete(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(signerToken))
        .expect(403);

      // Verify wallet still exists
      const stillExists = await prisma.wallet.findUnique({
        where: { id: wallet.id },
      });
      expect(stillExists).not.toBeNull();
    });
  });

}
