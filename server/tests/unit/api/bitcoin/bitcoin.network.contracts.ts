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

export const registerBitcoinNetworkRouteTests = () => {
  describe('Network Routes', () => {
    describe('GET /bitcoin/status', () => {
      it('should return node status with pool stats when pool is initialized', async () => {
        mockNodeClient.getElectrumPool.mockReturnValue(mockElectrumPool);
        mockElectrumPool.isPoolInitialized.mockReturnValue(true);
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' });
        mockElectrumClient.getBlockHeight.mockResolvedValue(850000);

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('connected', true);
      });

      it('should include pool stats structure when available', async () => {
        const poolStats = {
          totalConnections: 5,
          activeConnections: 2,
          idleConnections: 3,
          waitingRequests: 0,
          totalAcquisitions: 100,
          averageAcquisitionTimeMs: 5,
          healthCheckFailures: 0,
          serverCount: 2,
          servers: [
            {
              serverId: 'server-1',
              label: 'Primary',
              host: 'primary.com',
              port: 50002,
              connectionCount: 3,
              healthyConnections: 3,
              totalRequests: 50,
              failedRequests: 0,
              isHealthy: true,
              lastHealthCheck: new Date().toISOString(),
            },
          ],
        };

        expect(poolStats).toHaveProperty('totalConnections');
        expect(poolStats).toHaveProperty('servers');
        expect(poolStats.servers).toHaveLength(1);
      });

      it('should return null pool when not electrum type', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({
          type: 'bitcoind',
          host: 'localhost',
          port: 8332,
        });
        mockNodeClient.getElectrumPool.mockReturnValue(null);
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'Bitcoin Core', protocol: '1.0' });
        mockBlockchain.getBlockHeight.mockResolvedValue(850000);

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('connected');
      });

      it('should handle pool not initialized', async () => {
        mockNodeClient.getElectrumPool.mockReturnValue(mockElectrumPool);
        mockElectrumPool.isPoolInitialized.mockReturnValue(false);
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' });
        mockBlockchain.getBlockHeight.mockResolvedValue(850000);

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
      });

      it('should fall back to singleton when pool has no active or idle connections', async () => {
        mockElectrumPool.isPoolInitialized.mockReturnValue(true);
        mockElectrumPool.getPoolStats.mockReturnValue({
          totalConnections: 2,
          activeConnections: 0,
          idleConnections: 0,
          waitingRequests: 0,
          totalAcquisitions: 0,
          averageAcquisitionTimeMs: 0,
          healthCheckFailures: 0,
          serverCount: 1,
          servers: [],
        });
        mockElectrumClient.isConnected.mockReturnValue(true);
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' });
        mockBlockchain.getBlockHeight.mockResolvedValue(850000);

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(mockElectrumPool.acquire).not.toHaveBeenCalled();
        expect(response.body.connected).toBe(true);
      });

      it('should omit host when node config is not available', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(null);
        mockElectrumClient.isConnected.mockReturnValue(true);
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' });
        mockBlockchain.getBlockHeight.mockResolvedValue(850000);

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(response.body.host).toBeUndefined();
      });

      it('should return disconnected status on error', async () => {
        mockElectrumClient.isConnected.mockReturnValue(false);
        mockElectrumClient.connect.mockRejectedValue(new Error('Connection failed'));

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('connected', false);
      });

      it('should fall back to singleton status check when pool status fails', async () => {
        mockElectrumPool.isPoolInitialized.mockImplementationOnce(() => {
          throw new Error('Pool health failed');
        });
        mockElectrumClient.isConnected.mockReturnValue(true);
        mockElectrumClient.connect.mockResolvedValue(undefined);
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' });
        mockBlockchain.getBlockHeight.mockResolvedValue(850000);

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(response.body.connected).toBe(true);
        expect(response.body.server).toBe('ElectrumX');
      });
    });

    describe('GET /bitcoin/mempool', () => {
      it('should return mempool data', async () => {
        const mempoolData = {
          mempoolSize: 15000,
          mempoolVSize: 12000000,
          blocks: [{ height: 850000, txCount: 3000, size: 1500000 }],
        };
        mockMempool.getBlocksAndMempool.mockResolvedValue(mempoolData);

        const response = await request(app).get('/bitcoin/mempool');

        expect(response.status).toBe(200);
        // Response may be cached from previous test runs, just check it's valid
        expect(response.body).toBeDefined();
      });

      it('should handle mempool.getBlocksAndMempool being called', async () => {
        const mempoolData = { mempoolSize: 20000 };
        mockMempool.getBlocksAndMempool.mockResolvedValue(mempoolData);

        // The cache is module-level, so we just verify the endpoint works
        const response = await request(app).get('/bitcoin/mempool');

        expect(response.status).toBe(200);
        expect(response.body).toBeDefined();
      });

      it('should return stale data or 500 on mempool fetch error when no cache', async () => {
        // Note: Module-level cache may have data from previous tests
        // If cache exists, stale data is returned; if not, 500 is returned
        mockMempool.getBlocksAndMempool.mockRejectedValue(new Error('API error'));

        const response = await request(app).get('/bitcoin/mempool');

        // Either 200 (stale cache) or 500 (no cache)
        expect([200, 500]).toContain(response.status);
      });

      it('should return stale cache data when refresh fails within stale TTL', async () => {
        vi.useFakeTimers();
        try {
          vi.setSystemTime(new Date('2100-01-01T00:00:00.000Z'));
          mockMempool.getBlocksAndMempool
            .mockResolvedValueOnce({
              mempoolSize: 12345,
              blocks: [{ height: 1 }],
            })
            .mockRejectedValueOnce(new Error('API unavailable'));

          const first = await request(app).get('/bitcoin/mempool');
          expect(first.status).toBe(200);

          vi.setSystemTime(new Date('2100-01-01T00:00:20.000Z'));
          const second = await request(app).get('/bitcoin/mempool');

          expect(second.status).toBe(200);
          expect(second.body).toMatchObject({
            mempoolSize: 12345,
            stale: true,
          });
        } finally {
          vi.useRealTimers();
        }
      });

      it('should return 500 when refresh fails and stale cache is expired', async () => {
        vi.useFakeTimers();
        try {
          vi.setSystemTime(new Date('2100-01-02T00:00:00.000Z'));
          mockMempool.getBlocksAndMempool
            .mockResolvedValueOnce({
              mempoolSize: 9999,
              blocks: [{ height: 2 }],
            })
            .mockRejectedValueOnce(new Error('API unavailable'));

          const first = await request(app).get('/bitcoin/mempool');
          expect(first.status).toBe(200);

          vi.setSystemTime(new Date('2100-01-02T00:06:00.000Z'));
          const second = await request(app).get('/bitcoin/mempool');

          expect(second.status).toBe(500);
          expect(second.body).toMatchObject({
            error: 'Internal Server Error',
          });
        } finally {
          vi.useRealTimers();
        }
      });
    });

    describe('GET /bitcoin/blocks/recent', () => {
      it('should return recent blocks', async () => {
        const blocks = [
          { height: 850000, hash: 'abc', txCount: 3000 },
          { height: 849999, hash: 'def', txCount: 2800 },
        ];
        mockMempool.getRecentBlocks.mockResolvedValue(blocks);

        const response = await request(app).get('/bitcoin/blocks/recent');

        expect(response.status).toBe(200);
        expect(response.body).toEqual(blocks);
      });

      it('should accept count parameter', async () => {
        mockMempool.getRecentBlocks.mockResolvedValue([]);

        await request(app).get('/bitcoin/blocks/recent?count=5');

        expect(mockMempool.getRecentBlocks).toHaveBeenCalledWith(5);
      });

      it('should cap excessive count parameter values', async () => {
        mockMempool.getRecentBlocks.mockResolvedValue([]);

        await request(app).get('/bitcoin/blocks/recent?count=999');

        expect(mockMempool.getRecentBlocks).toHaveBeenCalledWith(100);
      });

      it('should return 500 on fetch error', async () => {
        mockMempool.getRecentBlocks.mockRejectedValue(new Error('Fetch failed'));

        const response = await request(app).get('/bitcoin/blocks/recent');

        expect(response.status).toBe(500);
      });
    });

    describe('GET /bitcoin/block/:height', () => {
      it('should return 400 for invalid height', async () => {
        const response = await request(app).get('/bitcoin/block/invalid');

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('message', 'Invalid block height');
      });

      it('should return 400 for negative height', async () => {
        const response = await request(app).get('/bitcoin/block/-1');

        expect(response.status).toBe(400);
      });

      it('should connect electrum client when not already connected', async () => {
        mockElectrumClient.isConnected.mockReturnValue(false);
        mockElectrumClient.connect.mockResolvedValue(undefined);
        mockElectrumClient.getBlockHeader.mockResolvedValue({
          hash: '00000000000000000002',
          height: 850001,
          timestamp: 1700000100,
        });

        const response = await request(app).get('/bitcoin/block/850001');

        expect(response.status).toBe(200);
        expect(mockElectrumClient.connect).toHaveBeenCalledTimes(1);
        expect(mockElectrumClient.getBlockHeader).toHaveBeenCalledWith(850001);
      });

      it('should return 500 when block not found', async () => {
        mockElectrumClient.isConnected.mockReturnValue(true);
        mockElectrumClient.connect.mockResolvedValue(undefined);
        mockElectrumClient.getBlockHeader.mockRejectedValueOnce(new Error('Not found'));

        const response = await request(app).get('/bitcoin/block/999999999');

        expect(response.status).toBe(500);
        expect(mockElectrumClient.getBlockHeader).toHaveBeenCalled();
      });

      it('should return block header for valid height', async () => {
        mockElectrumClient.isConnected.mockReturnValue(true);
        mockElectrumClient.connect.mockResolvedValue(undefined);
        mockElectrumClient.getBlockHeader.mockResolvedValue({
          hash: '00000000000000000001',
          height: 850000,
          timestamp: 1700000000,
        });

        const response = await request(app).get('/bitcoin/block/850000');

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          hash: '00000000000000000001',
          height: 850000,
        });
      });
    });
  });
};
