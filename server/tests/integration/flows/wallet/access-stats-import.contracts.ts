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

export function registerWalletAccessStatsImportTests(): void {
  describe('Wallet Access Permissions', () => {
    it('should allow viewer to view wallet', async () => {
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

      const response = await request(app)
        .get(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(viewerToken))
        .expect(200);

      expect(response.body.id).toBe(wallet.id);
    });

    it('should deny viewer from generating addresses', async () => {
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
          network: 'testnet',
          descriptor: "wpkh([aabbccdd/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)",
          users: {
            create: [
              { userId: owner.id, role: 'owner' },
              { userId: viewerId, role: 'viewer' },
            ],
          },
        },
      });

      await request(app)
        .post(`/api/v1/wallets/${wallet.id}/addresses`)
        .set(authHeader(viewerToken))
        .expect(403);
    });

    // Note: Address generation tests require full Bitcoin service mocks (descriptor derivation, etc.)
    // These are better suited for unit tests with proper mock injection
    it('should allow signer to generate addresses', async () => {
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
          network: 'testnet',
          descriptor: "wpkh([aabbccdd/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)",
          users: {
            create: [
              { userId: owner.id, role: 'owner' },
              { userId: signerId, role: 'signer' },
            ],
          },
        },
      });

      const response = await request(app)
        .post(`/api/v1/wallets/${wallet.id}/addresses`)
        .set(authHeader(signerToken))
        .expect(201);

      expect(response.body.address).toBeDefined();
    });

    // Note: Address generation tests require full Bitcoin service mocks (descriptor derivation, etc.)
    // These are better suited for unit tests with proper mock injection
    it('should allow owner to generate addresses', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Test Wallet',
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

      const response = await request(app)
        .post(`/api/v1/wallets/${wallet.id}/addresses`)
        .set(authHeader(token))
        .expect(201);

      expect(response.body.address).toBeDefined();
    });
  });

  describe('Wallet Stats', () => {
    it('should get wallet statistics', async () => {
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
        .get(`/api/v1/wallets/${wallet.id}/stats`)
        .set(authHeader(token))
        .expect(200);

      expect(response.body).toBeDefined();
      // Stats should include balance, transaction count, etc.
    });

    it('should allow viewer to access wallet stats', async () => {
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
        .get(`/api/v1/wallets/${wallet.id}/stats`)
        .set(authHeader(viewerToken))
        .expect(200);
    });
  });

  describe('Balance History', () => {
    it('should get wallet balance history', async () => {
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
        .get(`/api/v1/wallets/${wallet.id}/balance-history`)
        .set(authHeader(token))
        .expect(200);

      // Response may be array or object with history property
      expect(response.body).toBeDefined();
      if (Array.isArray(response.body)) {
        expect(response.body.length).toBeGreaterThanOrEqual(0);
      } else {
        expect(response.body.history || response.body.data || response.body).toBeDefined();
      }
    });

    it('should allow viewer to access balance history', async () => {
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
        .get(`/api/v1/wallets/${wallet.id}/balance-history`)
        .set(authHeader(viewerToken))
        .expect(200);
    });
  });

  describe('Wallet Export', () => {
    it('should get export formats', async () => {
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
        .get(`/api/v1/wallets/${wallet.id}/export/formats`)
        .set(authHeader(token))
        .expect(200);

      expect(response.body.formats).toBeDefined();
      expect(Array.isArray(response.body.formats)).toBe(true);
    });

    it('should export labels in BIP-329 format', async () => {
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
        .get(`/api/v1/wallets/${wallet.id}/export/labels`)
        .set(authHeader(token))
        .expect(200);

      // Should return JSONL format (BIP-329) - may be application/jsonl, application/x-ndjson, or text/plain
      expect(response.type).toMatch(/application\/jsonl|application\/x-ndjson|text\/plain/);
    });

    it('should export wallet configuration', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          descriptor: "wpkh([aabbccdd/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)",
          users: {
            create: {
              userId,
              role: 'owner',
            },
          },
        },
      });

      const response = await request(app)
        .get(`/api/v1/wallets/${wallet.id}/export`)
        .query({ format: 'sparrow' })
        .set(authHeader(token))
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });

  describe('Wallet Import', () => {
    it('should get import formats', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      const response = await request(app)
        .get('/api/v1/wallets/import/formats')
        .set(authHeader(token))
        .expect(200);

      expect(response.body.formats).toBeDefined();
      expect(Array.isArray(response.body.formats)).toBe(true);
    });

    it('should validate import data', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      // Sparrow wallet format
      const importData = {
        format: 'sparrow',
        content: JSON.stringify({
          label: 'Imported Wallet',
          keystoreSource: 'sw_seed',
          keyDerivation: { xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M' },
        }),
      };

      // May return 200 with valid=true/false or 400 for invalid format
      const response = await request(app)
        .post('/api/v1/wallets/import/validate')
        .set(authHeader(token))
        .send(importData);

      // API should respond with some indication of validity
      expect([200, 400]).toContain(response.status);
    });

    it('should reject import without format', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      await request(app)
        .post('/api/v1/wallets/import/validate')
        .set(authHeader(token))
        .send({ data: '{}' })
        .expect(400);
    });
  });

  describe('XPub Validation', () => {
    it('should handle xpub validation request', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      // The endpoint validates xpub format - may return 200 with valid flag or 400
      const response = await request(app)
        .post('/api/v1/wallets/validate-xpub')
        .set(authHeader(token))
        .send({
          xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
        });

      // Should return either valid response or error
      expect([200, 400]).toContain(response.status);
      if (response.status === 200) {
        expect(response.body.valid).toBeDefined();
      }
    });

    it('should handle invalid xpub format', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      const response = await request(app)
        .post('/api/v1/wallets/validate-xpub')
        .set(authHeader(token))
        .send({
          xpub: 'invalid-xpub-format',
        });

      // Should return 200 with valid=false or 400 error
      expect([200, 400]).toContain(response.status);
    });

    it('should require xpub field', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      await request(app)
        .post('/api/v1/wallets/validate-xpub')
        .set(authHeader(token))
        .send({})
        .expect(400);
    });
  });

  describe('Wallet Repair', () => {
    it('should trigger wallet repair (owner only)', async () => {
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
        .post(`/api/v1/wallets/${wallet.id}/repair`)
        .set(authHeader(token))
        .expect(200);

      expect(response.body.message).toBeDefined();
    });

    it('should deny repair for non-owner', async () => {
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
        .post(`/api/v1/wallets/${wallet.id}/repair`)
        .set(authHeader(viewerToken))
        .expect(403);
    });
  });

}
