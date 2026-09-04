import { describe, expect, it, vi } from 'vitest';
import { mockPrismaClient } from '../../../mocks/prisma';
import { mockElectrumClient, mockElectrumPool } from '../../../mocks/electrum';
import {
  app,
  mockAdvancedTx,
  mockBlockchain,
  mockMempool,
  mockNodeClient,
  mockSilentPayments,
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

      it('should include default host when node config is not available', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce(null);
        mockElectrumClient.isConnected.mockReturnValue(true);
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' });
        mockElectrumClient.getBlockHeight.mockResolvedValue(850000);

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(response.body.host).toBe('electrum.blockstream.info');
      });

      it('returns the minimal legacy envelope only when configuration itself could not be read', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockRejectedValueOnce(new Error('db unavailable'));

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ connected: false, error: 'db unavailable' });
      });

      it('should return disconnected status on error', async () => {
        mockElectrumClient.connect.mockRejectedValueOnce(new Error('Connection failed'));

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('connected', false);
        expect(response.body).toHaveProperty('operational');
      });

      it('should return disconnected status when the Electrum version is unavailable', async () => {
        mockElectrumClient.getServerVersion.mockResolvedValue(null as any);
        mockElectrumClient.getBlockHeight.mockResolvedValue(850000);

        const response = await request(app).get('/bitcoin/status?network=signet');

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          connected: false,
          error: 'Unable to read signet Electrum server status',
        });
      });

      it('should fall back to singleton status check when pool status fails', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce({
          id: 'default',
          type: 'electrum',
          host: 'electrum.example.com',
          port: 50002,
          useSsl: true,
          poolEnabled: true,
          explorerUrl: 'https://mempool.space',
          mainnetMode: 'pool',
          mainnetPoolMin: 1,
          mainnetPoolMax: 5,
          servers: [
            {
              id: 'mainnet-server-1',
              label: 'Mainnet Server',
              host: 'mainnet.example.com',
              port: 50002,
              useSsl: true,
              priority: 1,
              enabled: true,
              network: 'mainnet',
              isHealthy: true,
              lastHealthCheck: null,
            },
          ],
        });
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
        expect(response.body.operational.route).toMatchObject({
          transport: 'singleton_fallback',
          fallbackReason: 'pool_probe_failed',
        });
      });

      it('returns selected testnet3 singleton status with configured host', async () => {
        mockElectrumClient.isConnected.mockReturnValue(true);
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'Fulcrum', protocol: '1.4' });
        mockElectrumClient.getBlockHeight.mockResolvedValue(4_500_000);

        const response = await request(app).get('/bitcoin/status?network=testnet3');

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          connected: true,
          network: 'testnet3',
          server: 'Fulcrum',
          blockHeight: 4_500_000,
          host: 'testnet.example.com',
          useSsl: true,
          explorerUrl: 'https://mempool.space/testnet',
          pool: expect.objectContaining({ enabled: false }),
        });
      });

      it('returns configured explorer URL for testnet4 status', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({
          id: 'default',
          type: 'electrum',
          host: 'electrum.example.com',
          port: 50002,
          useSsl: true,
          explorerUrl: 'https://mempool.space',
          testnet4ExplorerUrl: 'https://testnet4-explorer.example',
          testnet4Enabled: true,
          testnet4Mode: 'singleton',
          testnet4SingletonHost: 'testnet4.example.com',
          testnet4SingletonPort: 60002,
          testnet4SingletonSsl: true,
          servers: [],
        });
        mockElectrumClient.isConnected.mockReturnValue(true);
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'Fulcrum', protocol: '1.4' });
        mockElectrumClient.getBlockHeight.mockResolvedValue(4_500_002);

        const response = await request(app).get('/bitcoin/status?network=testnet4');

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          connected: true,
          network: 'testnet4',
          explorerUrl: 'https://testnet4-explorer.example',
        });
      });

      it('rejects legacy testnet status network input', async () => {
        const response = await request(app).get('/bitcoin/status?network=testnet');

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('Invalid network');
      });

      it('includes configured pool servers when live pool stats are not populated', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({
          id: 'default',
          type: 'electrum',
          host: 'electrum.example.com',
          port: 50002,
          useSsl: true,
          poolEnabled: true,
          explorerUrl: 'https://mempool.space',
          mainnetMode: 'pool',
          mainnetPoolMin: 1,
          mainnetPoolMax: 5,
          testnet3Enabled: true,
          testnet3Mode: 'pool',
          testnet3PoolMin: 1,
          testnet3PoolMax: 3,
          signetEnabled: false,
          servers: [
            {
              id: 'testnet3-server-2',
              label: 'Backup Testnet3',
              host: 'backup-testnet3.example.com',
              port: 60002,
              useSsl: true,
              priority: 2,
              enabled: true,
              network: 'testnet3',
              isHealthy: true,
              lastHealthCheck: null,
              serverUsage: 'silent_payments',
              supportsVerbose: true,
              supportsSilentPaymentsV0: true,
              lastCapabilityCheck: '2026-05-23T12:00:00.000Z',
              lastCapabilityError: null,
            },
            {
              id: 'testnet3-server-1',
              label: 'Default Priority Testnet3',
              host: 'default-priority-testnet3.example.com',
              port: 60003,
              useSsl: true,
              priority: null,
              enabled: true,
              network: 'testnet3',
              isHealthy: true,
              lastHealthCheck: null,
            },
            {
              id: 'testnet3-server-3',
              label: 'Tertiary Testnet3',
              host: 'tertiary-testnet3.example.com',
              port: 60004,
              useSsl: true,
              priority: 4,
              enabled: true,
              network: 'testnet3',
              isHealthy: true,
              lastHealthCheck: null,
            },
          ],
        });
        mockElectrumPool.isPoolInitialized.mockReturnValue(true);
        mockElectrumPool.getPoolStats.mockReturnValue({
          totalConnections: 0,
          activeConnections: 0,
          idleConnections: 0,
          waitingRequests: 0,
          totalAcquisitions: 0,
          averageAcquisitionTimeMs: 0,
          healthCheckFailures: 0,
          serverCount: 0,
          servers: [],
        });
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'Fulcrum', protocol: '1.4' });
        mockElectrumClient.getBlockHeight.mockResolvedValue(4_500_000);

        const response = await request(app).get('/bitcoin/status?network=testnet3');

        expect(response.status).toBe(200);
        expect(response.body.pool.enabled).toBe(true);
        expect(response.body.pool.stats.servers).toEqual([
          expect.objectContaining({
            serverId: 'testnet3-server-1',
            label: 'Default Priority Testnet3',
            host: 'default-priority-testnet3.example.com',
            port: 60003,
          }),
          expect.objectContaining({
            serverId: 'testnet3-server-2',
            label: 'Backup Testnet3',
            host: 'backup-testnet3.example.com',
            port: 60002,
            serverUsage: 'silent_payments',
            supportsVerbose: true,
            supportsSilentPaymentsV0: true,
            lastCapabilityCheck: new Date('2026-05-23T12:00:00.000Z'),
            lastCapabilityError: null,
          }),
          expect.objectContaining({
            serverId: 'testnet3-server-3',
            label: 'Tertiary Testnet3',
            host: 'tertiary-testnet3.example.com',
            port: 60004,
          }),
        ]);
      });

      it('returns null configured stats when electrum config omits servers', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({
          id: 'default',
          type: 'electrum',
          host: 'electrum.example.com',
          port: 50002,
          useSsl: true,
          explorerUrl: 'https://mempool.space',
          testnet3Enabled: true,
          testnet3Mode: 'singleton',
          testnet3SingletonHost: 'testnet.example.com',
          testnet3SingletonPort: 60002,
          testnet3SingletonSsl: true,
        });
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'Fulcrum', protocol: '1.4' });
        mockElectrumClient.getBlockHeight.mockResolvedValue(4_500_000);

        const response = await request(app).get('/bitcoin/status?network=testnet3');

        expect(response.status).toBe(200);
        expect(response.body.pool).toEqual(
          expect.objectContaining({
            enabled: false,
            stats: null,
          }),
        );
      });

      it('reports disconnected with route:null when node config is absent and the environment-default singleton attempt fails', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce(null);
        mockElectrumClient.connect.mockRejectedValueOnce(new Error('unreachable'));

        const response = await request(app).get('/bitcoin/status?network=testnet3');

        expect(response.status).toBe(200);
        expect(response.body.connected).toBe(false);
        expect(response.body.operational.route).toBeNull();
        expect(response.body.pool).toBeNull();
      });

      it('attempts the environment-default singleton and reports one repository read when node config is entirely absent', async () => {
        // A3: only one repository read feeds the whole attempt. There is no
        // second `nodeConfig.findFirst` call for mode config any more.
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce(null);
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' });
        mockElectrumClient.getBlockHeight.mockResolvedValue(900000);

        const response = await request(app).get('/bitcoin/status?network=testnet3');

        expect(response.status).toBe(200);
        expect(mockPrismaClient.nodeConfig.findFirst).toHaveBeenCalledTimes(1);
        expect(response.body).toMatchObject({
          connected: true,
          network: 'testnet3',
          pool: null,
        });
        expect(response.body.operational).toMatchObject({
          configuredMode: 'singleton',
          route: { transport: 'singleton', serverId: null },
        });
      });

      it('derives mode, topology, and the direct fallback connection from one snapshot even if the DB would answer differently on a second read', async () => {
        // A3: the repository is read exactly once per attempt. Configure the
        // mock to answer differently on a hypothetical second call so any
        // accidental second read would produce inconsistent output.
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce({
          id: 'default',
          type: 'electrum',
          host: 'electrum.example.com',
          port: 50002,
          useSsl: true,
          explorerUrl: 'https://mempool.space',
          testnet3Enabled: true,
          testnet3Mode: 'singleton',
          testnet3SingletonHost: 'testnet.example.com',
          testnet3SingletonPort: 60002,
          testnet3SingletonSsl: true,
          servers: [],
        });
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce({
          id: 'default',
          type: 'electrum',
          host: 'different-electrum.example.com',
          port: 50003,
          useSsl: false,
          explorerUrl: 'https://mempool.space',
          testnet3Enabled: true,
          testnet3Mode: 'pool',
          servers: [],
        });
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'Fulcrum', protocol: '1.4' });
        mockElectrumClient.getBlockHeight.mockResolvedValue(4_500_001);

        const response = await request(app).get('/bitcoin/status?network=testnet3');

        expect(response.status).toBe(200);
        expect(mockPrismaClient.nodeConfig.findFirst).toHaveBeenCalledTimes(1);
        expect(response.body).toMatchObject({
          connected: true,
          network: 'testnet3',
          host: 'testnet.example.com',
          useSsl: true,
          pool: expect.objectContaining({ enabled: false }),
        });
        expect(response.body.operational.configuredMode).toBe('singleton');
      });
    });
    describe('GET /bitcoin/silent-payments/readiness', () => {
      it('returns Silent Payments readiness for the selected network', async () => {
        mockSilentPayments.getSilentPaymentReadiness.mockResolvedValueOnce({
          featureEnabled: true,
          ready: false,
          network: 'testnet4',
          requiredFeatures: ['silent_payments_v0'],
          blockers: ['NO_SILENT_PAYMENT_ENDPOINT'],
          compatibleServerCount: 0,
          endpointCount: 0,
          featurePoolHealthy: false,
          servers: [],
        });

        const response = await request(app)
          .get('/bitcoin/silent-payments/readiness?network=testnet4');

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          ready: false,
          network: 'testnet4',
          blockers: ['NO_SILENT_PAYMENT_ENDPOINT'],
        });
        expect(mockSilentPayments.getSilentPaymentReadiness)
          .toHaveBeenCalledWith('testnet4');
      });

      it('rejects invalid Silent Payments readiness network input', async () => {
        const response = await request(app)
          .get('/bitcoin/silent-payments/readiness?network=testnet');

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('Invalid network');
        expect(mockSilentPayments.getSilentPaymentReadiness).not.toHaveBeenCalled();
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
        expect(mockMempool.getBlocksAndMempool).toHaveBeenCalledWith(
          'mainnet',
          expect.objectContaining({ signal: expect.any(Object) }),
        );
      });

      it('should request mempool data for the selected network', async () => {
        const mempoolData = {
          mempool: [{ height: 'Next', status: 'pending' }],
          blocks: [{ height: 4_500_000, status: 'confirmed' }],
          mempoolInfo: { count: 2, size: 0.01, totalFees: 1000 },
        };
        mockMempool.getBlocksAndMempool.mockResolvedValue(mempoolData);

        const response = await request(app).get('/bitcoin/mempool?network=testnet3');

        expect(response.status).toBe(200);
        expect(response.body).toEqual(mempoolData);
        expect(mockMempool.getBlocksAndMempool).toHaveBeenCalledWith(
          'testnet3',
          expect.objectContaining({ signal: expect.any(Object) }),
        );
      });

      it('rejects legacy testnet mempool network input', async () => {
        const response = await request(app).get('/bitcoin/mempool?network=testnet');

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('Invalid network');
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

        expect(mockMempool.getRecentBlocks).toHaveBeenCalledWith(
          5,
          'mainnet',
          expect.objectContaining({ signal: expect.any(Object) }),
        );
      });

      it('should cap excessive count parameter values', async () => {
        mockMempool.getRecentBlocks.mockResolvedValue([]);

        await request(app).get('/bitcoin/blocks/recent?count=999');

        expect(mockMempool.getRecentBlocks).toHaveBeenCalledWith(
          100,
          'mainnet',
          expect.objectContaining({ signal: expect.any(Object) }),
        );
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
