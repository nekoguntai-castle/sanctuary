import { describe, expect, it, vi } from 'vitest';
import { mockPrismaClient } from '../../../mocks/prisma';
import { mockElectrumClient, mockElectrumPool } from '../../../mocks/electrum';
import {
  app,
  mockAdvancedTx,
  mockBlockchain,
  mockMempool,
  mockNodeClient,
  mockUtils,
  request,
} from './bitcoinTestHarness';

export const registerBitcoinAddressRouteTests = () => {
  describe('Address Routes', () => {
    describe('POST /bitcoin/address/validate', () => {
      it('should validate a valid Bitcoin address', async () => {
        mockBlockchain.checkAddress.mockResolvedValue({
          valid: true,
          balance: 100000,
          transactionCount: 5,
        });

        const response = await request(app)
          .post('/bitcoin/address/validate')
          .send({ address: 'bc1qtest123' });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('valid', true);
      });

      it('should validate with custom network', async () => {
        mockBlockchain.checkAddress.mockResolvedValue({ valid: true });

        await request(app)
          .post('/bitcoin/address/validate')
          .send({ address: 'tb1qtest123', network: 'testnet' });

        expect(mockBlockchain.checkAddress).toHaveBeenCalledWith('tb1qtest123', 'testnet');
      });

      it('should return 400 when address is missing', async () => {
        const response = await request(app)
          .post('/bitcoin/address/validate')
          .send({});

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('message', 'address is required');
      });

      it('should return 500 on validation error', async () => {
        mockBlockchain.checkAddress.mockRejectedValue(new Error('Validation error'));

        const response = await request(app)
          .post('/bitcoin/address/validate')
          .send({ address: 'invalid' });

        expect(response.status).toBe(500);
      });
    });

    describe('GET /bitcoin/address/:address', () => {
      it('should return address info for valid address', async () => {
        mockBlockchain.checkAddress.mockResolvedValue({
          valid: true,
          balance: 500000,
          transactionCount: 10,
        });
        mockUtils.getAddressType.mockReturnValue('p2wpkh');

        const response = await request(app).get('/bitcoin/address/bc1qtest123');

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          address: 'bc1qtest123',
          balance: 500000,
          transactionCount: 10,
          type: 'p2wpkh',
        });
      });

      it('should support network query parameter', async () => {
        mockBlockchain.checkAddress.mockResolvedValue({ valid: true, balance: 0, transactionCount: 0 });
        mockUtils.getAddressType.mockReturnValue('p2wpkh');

        await request(app).get('/bitcoin/address/tb1qtest?network=testnet');

        expect(mockBlockchain.checkAddress).toHaveBeenCalledWith('tb1qtest', 'testnet');
      });

      it('should support regtest network query parameter', async () => {
        mockBlockchain.checkAddress.mockResolvedValue({ valid: true, balance: 0, transactionCount: 0 });
        mockUtils.getAddressType.mockReturnValue('p2wpkh');

        await request(app).get('/bitcoin/address/bcrt1qtest?network=regtest');

        expect(mockBlockchain.checkAddress).toHaveBeenCalledWith('bcrt1qtest', 'regtest');
      });

      it('should return 400 for invalid address', async () => {
        mockBlockchain.checkAddress.mockResolvedValue({
          valid: false,
          error: 'Invalid address format',
        });

        const response = await request(app).get('/bitcoin/address/invalid123');

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('message', 'Invalid address format');
      });

      it('should use default invalid address message when validation error detail is absent', async () => {
        mockBlockchain.checkAddress.mockResolvedValue({
          valid: false,
        });

        const response = await request(app).get('/bitcoin/address/invalid123');

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('message', 'Invalid address');
      });

      it('should return 500 when address lookup throws', async () => {
        mockBlockchain.checkAddress.mockRejectedValue(new Error('node unavailable'));

        const response = await request(app).get('/bitcoin/address/bc1qtest123');

        expect(response.status).toBe(500);
        expect(response.body).toMatchObject({
          code: 'INTERNAL_ERROR',
        });
      });
    });

    describe('POST /bitcoin/address/:addressId/sync', () => {
      it('should sync address when user has access', async () => {
        mockPrismaClient.address.findFirst.mockResolvedValue({
          id: 'addr-1',
          address: 'bc1qtest',
          walletId: 'wallet-1',
        });
        mockBlockchain.syncAddress.mockResolvedValue({
          transactionsFound: 5,
          newBalance: 100000,
        });

        const response = await request(app).post('/bitcoin/address/addr-1/sync');

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          message: 'Address synced successfully',
          transactionsFound: 5,
        });
      });

      it('should return 404 when address not found', async () => {
        mockPrismaClient.address.findFirst.mockResolvedValue(null);

        const response = await request(app).post('/bitcoin/address/nonexistent/sync');

        expect(response.status).toBe(404);
      });

      it('should return 500 on sync error', async () => {
        mockPrismaClient.address.findFirst.mockResolvedValue({ id: 'addr-1' });
        mockBlockchain.syncAddress.mockRejectedValue(new Error('Sync failed'));

        const response = await request(app).post('/bitcoin/address/addr-1/sync');

        expect(response.status).toBe(500);
      });
    });

    describe('POST /bitcoin/address-lookup', () => {
      it('should lookup addresses for user', async () => {
        mockPrismaClient.address.findMany.mockResolvedValue([
          { address: 'bc1qtest1', wallet: { id: 'wallet-1', name: 'My Wallet' } },
        ]);

        const response = await request(app)
          .post('/bitcoin/address-lookup')
          .send({ addresses: ['bc1qtest1', 'bc1qtest2'] });

        expect(response.status).toBe(200);
        expect(response.body.lookup).toHaveProperty('bc1qtest1');
        expect(response.body.lookup.bc1qtest1).toMatchObject({
          walletId: 'wallet-1',
          walletName: 'My Wallet',
        });
      });

      it('should return 400 when addresses is not an array', async () => {
        const response = await request(app)
          .post('/bitcoin/address-lookup')
          .send({ addresses: 'bc1qtest' });

        expect(response.status).toBe(400);
      });

      it('should return 400 when addresses is empty', async () => {
        const response = await request(app)
          .post('/bitcoin/address-lookup')
          .send({ addresses: [] });

        expect(response.status).toBe(400);
      });

      it('should return 400 when more than 100 addresses', async () => {
        const addresses = Array(101).fill('bc1qtest');

        const response = await request(app)
          .post('/bitcoin/address-lookup')
          .send({ addresses });

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('message', 'Maximum 100 addresses per request');
      });

      it('should return 500 when address lookup query fails', async () => {
        mockPrismaClient.address.findMany.mockRejectedValue(new Error('lookup failed'));

        const response = await request(app)
          .post('/bitcoin/address-lookup')
          .send({ addresses: ['bc1qtest1'] });

        expect(response.status).toBe(500);
        expect(response.body).toMatchObject({
          code: 'INTERNAL_ERROR',
        });
      });
    });
  });
};
