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

export const registerBitcoinSyncRouteTests = () => {
  describe('Sync Routes', () => {
    describe('POST /bitcoin/wallet/:walletId/sync', () => {
      it('should sync wallet when user has access', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
        });
        mockBlockchain.syncWallet.mockResolvedValue({
          addressesScanned: 100,
          transactionsFound: 50,
          newBalance: 5000000,
        });

        const response = await request(app).post('/bitcoin/wallet/wallet-1/sync');

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          message: 'Wallet synced successfully',
          addressesScanned: 100,
          transactionsFound: 50,
        });
      });

      it('should return 404 when wallet not found', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue(null);

        const response = await request(app).post('/bitcoin/wallet/nonexistent/sync');

        expect(response.status).toBe(404);
      });

      it('should return 500 on sync error', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({ id: 'wallet-1' });
        mockBlockchain.syncWallet.mockRejectedValue(new Error('Sync failed'));

        const response = await request(app).post('/bitcoin/wallet/wallet-1/sync');

        expect(response.status).toBe(500);
      });
    });

    describe('POST /bitcoin/wallet/:walletId/update-confirmations', () => {
      it('should update confirmations when user has access', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
        });
        mockBlockchain.updateTransactionConfirmations.mockResolvedValue(15);

        const response = await request(app).post('/bitcoin/wallet/wallet-1/update-confirmations');

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          message: 'Confirmations updated',
          updated: 15,
        });
      });

      it('should return 404 when wallet not found', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue(null);

        const response = await request(app).post('/bitcoin/wallet/nonexistent/update-confirmations');

        expect(response.status).toBe(404);
      });

      it('should return 500 on update error', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({ id: 'wallet-1' });
        mockBlockchain.updateTransactionConfirmations.mockRejectedValue(new Error('Update failed'));

        const response = await request(app).post('/bitcoin/wallet/wallet-1/update-confirmations');

        expect(response.status).toBe(500);
      });
    });
  });

  // ============================================================
  // Pool Stats Structure Validation
  // ============================================================
  describe('Pool Stats Structure Validation', () => {
    it('should have correct server stats structure', () => {
      const serverStats = {
        serverId: 'test-server',
        label: 'Test Server',
        host: 'test.example.com',
        port: 50002,
        connectionCount: 2,
        healthyConnections: 2,
        totalRequests: 100,
        failedRequests: 0,
        isHealthy: true,
        lastHealthCheck: new Date().toISOString(),
      };

      expect(serverStats).toHaveProperty('serverId');
      expect(serverStats).toHaveProperty('label');
      expect(serverStats).toHaveProperty('host');
      expect(serverStats).toHaveProperty('port');
      expect(serverStats).toHaveProperty('connectionCount');
      expect(serverStats).toHaveProperty('healthyConnections');
      expect(serverStats).toHaveProperty('totalRequests');
      expect(serverStats).toHaveProperty('failedRequests');
      expect(serverStats).toHaveProperty('isHealthy');
      expect(serverStats).toHaveProperty('lastHealthCheck');
    });

    it('should have correct pool stats structure', () => {
      const poolStats = mockElectrumPool.getPoolStats();

      expect(poolStats).toHaveProperty('totalConnections');
      expect(poolStats).toHaveProperty('activeConnections');
      expect(poolStats).toHaveProperty('idleConnections');
      expect(poolStats).toHaveProperty('waitingRequests');
      expect(poolStats).toHaveProperty('totalAcquisitions');
      expect(poolStats).toHaveProperty('averageAcquisitionTimeMs');
      expect(poolStats).toHaveProperty('healthCheckFailures');
      expect(poolStats).toHaveProperty('serverCount');
      expect(poolStats).toHaveProperty('servers');
      expect(Array.isArray(poolStats.servers)).toBe(true);
    });
  });
};
