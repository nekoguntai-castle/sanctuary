import { vi } from 'vitest';
import request from 'supertest';
import { Express } from 'express';
import { PrismaClient } from '../../../src/generated/prisma/client';
import {
  setupTestDatabase,
  cleanupTestData,
  teardownTestDatabase,
  canRunIntegrationTests,
} from '../setup/testDatabase';
import { createTestApp, resetTestApp } from '../setup/testServer';
import {
  createAndLoginUser,
  createTestUser,
  getTestUser,
  createTestWallet,
  authHeader,
  loginTestUser,
} from '../setup/helpers';

vi.setConfig({ testTimeout: 30000 });

const describeWithDb = canRunIntegrationTests() ? describe : describe.skip;

describeWithDb('Labels API Integration', () => {
  let app: Express;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDatabase();
    app = createTestApp();
  });

  afterAll(async () => {
    resetTestApp();
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  function uniqueTxid(prefix: string): string {
    const random = Math.random().toString(36).slice(2, 18);
    return `${prefix}${random}`.padEnd(64, '0').slice(0, 64);
  }

  async function createTransaction(walletId: string) {
    return prisma.transaction.create({
      data: {
        txid: uniqueTxid('labeltx'),
        walletId,
        type: 'received',
        amount: BigInt(100_000),
        fee: BigInt(0),
        confirmations: 1,
      },
    });
  }

  async function ensureWalletAddress(walletId: string) {
    const existingAddress = await prisma.address.findFirst({
      where: { walletId },
    });
    if (existingAddress) return existingAddress;

    return prisma.address.create({
      data: {
        walletId,
        address: `tb1qlabel${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
        derivationPath: "m/84'/1'/0'/0/0",
        index: 0,
      },
    });
  }

  describe('wallet labels CRUD', () => {
    it('creates, lists, gets, updates, and deletes a label', async () => {
      const { token } = await createAndLoginUser(app, prisma);
      const { id: walletId } = await createTestWallet(app, token);

      const createResponse = await request(app)
        .post(`/api/v1/labels/wallets/${walletId}/labels`)
        .set(authHeader(token))
        .send({
          name: 'Exchange',
          color: '#ff9900',
          description: 'KYC exchange withdrawals',
        })
        .expect(201);

      expect(createResponse.body.name).toBe('Exchange');
      expect(createResponse.body.color).toBe('#ff9900');
      const labelId = createResponse.body.id as string;

      const listResponse = await request(app)
        .get(`/api/v1/labels/wallets/${walletId}/labels`)
        .set(authHeader(token))
        .expect(200);

      expect(Array.isArray(listResponse.body)).toBe(true);
      expect(listResponse.body).toHaveLength(1);
      expect(listResponse.body[0].id).toBe(labelId);

      const getResponse = await request(app)
        .get(`/api/v1/labels/wallets/${walletId}/labels/${labelId}`)
        .set(authHeader(token))
        .expect(200);

      expect(getResponse.body.id).toBe(labelId);
      expect(Array.isArray(getResponse.body.transactions)).toBe(true);
      expect(Array.isArray(getResponse.body.addresses)).toBe(true);

      const updateResponse = await request(app)
        .put(`/api/v1/labels/wallets/${walletId}/labels/${labelId}`)
        .set(authHeader(token))
        .send({
          name: 'Exchange Updated',
          color: '#00aa00',
          description: 'Updated',
        })
        .expect(200);

      expect(updateResponse.body.name).toBe('Exchange Updated');
      expect(updateResponse.body.color).toBe('#00aa00');

      await request(app)
        .delete(`/api/v1/labels/wallets/${walletId}/labels/${labelId}`)
        .set(authHeader(token))
        .expect(204);

      const postDeleteList = await request(app)
        .get(`/api/v1/labels/wallets/${walletId}/labels`)
        .set(authHeader(token))
        .expect(200);

      expect(postDeleteList.body).toEqual([]);
    });

    it('returns 403 when user has no access to wallet labels', async () => {
      const owner = getTestUser();
      const outsider = getTestUser();

      await createTestUser(prisma, owner);
      await createTestUser(prisma, outsider);

      const ownerToken = await loginTestUser(app, owner);
      const outsiderToken = await loginTestUser(app, outsider);
      const { id: walletId } = await createTestWallet(app, ownerToken);

      await request(app)
        .get(`/api/v1/labels/wallets/${walletId}/labels`)
        .set(authHeader(outsiderToken))
        .expect(403);
    });

    it('allows viewer reads but forbids viewer writes', async () => {
      const owner = getTestUser();
      const viewer = getTestUser();

      await createTestUser(prisma, owner);
      const { id: viewerId } = await createTestUser(prisma, viewer);

      const ownerToken = await loginTestUser(app, owner);
      const viewerToken = await loginTestUser(app, viewer);
      const { id: walletId } = await createTestWallet(app, ownerToken);

      await prisma.walletUser.create({
        data: {
          walletId,
          userId: viewerId,
          role: 'viewer',
        },
      });

      const ownerLabel = await request(app)
        .post(`/api/v1/labels/wallets/${walletId}/labels`)
        .set(authHeader(ownerToken))
        .send({ name: 'Readable Label' })
        .expect(201);

      await request(app)
        .get(`/api/v1/labels/wallets/${walletId}/labels`)
        .set(authHeader(viewerToken))
        .expect(200);

      await request(app)
        .post(`/api/v1/labels/wallets/${walletId}/labels`)
        .set(authHeader(viewerToken))
        .send({ name: 'Should Fail' })
        .expect(403);

      await request(app)
        .put(`/api/v1/labels/wallets/${walletId}/labels/${ownerLabel.body.id}`)
        .set(authHeader(viewerToken))
        .send({ name: 'Should Also Fail' })
        .expect(403);

      await request(app)
        .delete(`/api/v1/labels/wallets/${walletId}/labels/${ownerLabel.body.id}`)
        .set(authHeader(viewerToken))
        .expect(403);

    });
  });

  describe('transaction and address label assignment', () => {
    it('adds/replaces/removes labels on a transaction and address', async () => {
      const { token } = await createAndLoginUser(app, prisma);
      const { id: walletId } = await createTestWallet(app, token);

      const [labelA, labelB] = await Promise.all([
        request(app)
          .post(`/api/v1/labels/wallets/${walletId}/labels`)
          .set(authHeader(token))
          .send({ name: 'Salary' })
          .expect(201),
        request(app)
          .post(`/api/v1/labels/wallets/${walletId}/labels`)
          .set(authHeader(token))
          .send({ name: 'Savings' })
          .expect(201),
      ]);

      const transaction = await createTransaction(walletId);
      const address = await ensureWalletAddress(walletId);

      const addTxLabels = await request(app)
        .post(`/api/v1/labels/transactions/${transaction.id}/labels`)
        .set(authHeader(token))
        .send({ labelIds: [labelA.body.id, labelB.body.id] })
        .expect(200);

      expect(addTxLabels.body).toHaveLength(2);

      const getTxLabels = await request(app)
        .get(`/api/v1/labels/transactions/${transaction.id}/labels`)
        .set(authHeader(token))
        .expect(200);

      expect(getTxLabels.body).toHaveLength(2);

      const replaceTxLabels = await request(app)
        .put(`/api/v1/labels/transactions/${transaction.id}/labels`)
        .set(authHeader(token))
        .send({ labelIds: [labelB.body.id] })
        .expect(200);

      expect(replaceTxLabels.body).toHaveLength(1);
      expect(replaceTxLabels.body[0].id).toBe(labelB.body.id);

      await request(app)
        .delete(`/api/v1/labels/transactions/${transaction.id}/labels/${labelB.body.id}`)
        .set(authHeader(token))
        .expect(204);

      const getTxAfterDelete = await request(app)
        .get(`/api/v1/labels/transactions/${transaction.id}/labels`)
        .set(authHeader(token))
        .expect(200);

      expect(getTxAfterDelete.body).toEqual([]);

      const addAddressLabels = await request(app)
        .post(`/api/v1/labels/addresses/${address.id}/labels`)
        .set(authHeader(token))
        .send({ labelIds: [labelA.body.id] })
        .expect(200);

      expect(addAddressLabels.body).toHaveLength(1);

      await request(app)
        .put(`/api/v1/labels/addresses/${address.id}/labels`)
        .set(authHeader(token))
        .send({ labelIds: [labelB.body.id] })
        .expect(200);

      await request(app)
        .delete(`/api/v1/labels/addresses/${address.id}/labels/${labelB.body.id}`)
        .set(authHeader(token))
        .expect(204);

      const getAddressAfterDelete = await request(app)
        .get(`/api/v1/labels/addresses/${address.id}/labels`)
        .set(authHeader(token))
        .expect(200);

      expect(getAddressAfterDelete.body).toEqual([]);
    });
  });
});
