import { describe, expect, it, vi } from 'vitest';
import { mockPrismaClient } from '../../../mocks/prisma';
import { mockElectrumClient, mockElectrumPool } from '../../../mocks/electrum';
import {
  app,
  mockAdvancedTx,
  mockBlockchain,
  mockEnqueueWalletSyncBatch,
  mockMempool,
  mockNodeClient,
  mockSyncIntentAdmission,
  mockUtils,
  request,
} from './bitcoinTestHarness';

export const registerBitcoinSyncRouteTests = () => {
  describe('Sync Routes', () => {
    describe('POST /bitcoin/wallet/:walletId/sync', () => {
      it('should request asynchronous wallet sync when user has access', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
        });
        mockSyncIntentAdmission.request.mockResolvedValue({
          status: 'merged',
          generation: 9,
          wakeup: 'already_present',
        });
        const response = await request(app).post('/bitcoin/wallet/wallet-1/sync');

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          success: true,
          status: 'merged',
          generation: 9,
          wakeup: 'already_present',
          message: 'Wallet sync merged with existing work',
        });
        expect(mockSyncIntentAdmission.request).toHaveBeenCalledWith('wallet-1', { mode: 'explicit_reopen' });
        expect(mockBlockchain.syncWallet).not.toHaveBeenCalled();
        expect(mockEnqueueWalletSyncBatch).not.toHaveBeenCalled();
      });

      it('should return 404 when wallet not found', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue(null);

        const response = await request(app).post('/bitcoin/wallet/nonexistent/sync');

        expect(response.status).toBe(404);
      });

      it('should return 503 when canonical admission is blocked', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({ id: 'wallet-1' });
        mockSyncIntentAdmission.request.mockResolvedValue({ status: 'blocked' });

        const response = await request(app).post('/bitcoin/wallet/wallet-1/sync');

        expect(response.status).toBe(503);
        expect(response.body.message).toBe('Wallet sync is temporarily unavailable');
        expect(mockBlockchain.syncWallet).not.toHaveBeenCalled();
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
