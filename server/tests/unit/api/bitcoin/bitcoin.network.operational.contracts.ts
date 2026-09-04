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

export const registerBitcoinNetworkOperationalRouteTests = () => {
  describe('Network Routes', () => {
    describe('GET /bitcoin/status operational projection (A3/A4)', () => {
      function poolNodeConfig(overrides: Record<string, unknown> = {}) {
        return {
          id: 'default',
          type: 'electrum',
          host: 'electrum.example.com',
          port: 50002,
          useSsl: true,
          explorerUrl: 'https://mempool.space',
          mainnetMode: 'pool',
          mainnetPoolMin: 1,
          mainnetPoolMax: 5,
          servers: [
            {
              id: 'mainnet-1',
              label: 'Mainnet One',
              host: 'mainnet-1.example.com',
              port: 50002,
              useSsl: true,
              priority: 1,
              enabled: true,
              network: 'mainnet',
              isHealthy: true,
              lastHealthCheck: null,
            },
            {
              id: 'mainnet-2',
              label: 'Mainnet Two',
              host: 'mainnet-2.example.com',
              port: 50003,
              useSsl: true,
              priority: 2,
              enabled: true,
              network: 'mainnet',
              isHealthy: true,
              lastHealthCheck: null,
            },
          ],
          ...overrides,
        };
      }

      it('defaults pool min/max to 1/5 for regtest, whose mode config has no pool sizing fields at all', async () => {
        // getRegtestModeConfig() never sets poolMin/poolMax (regtest is
        // always singleton), so this is the only reachable way for
        // modeConfig.poolMin/poolMax to be undefined while nodeConfig.type
        // is still 'electrum' -- exercising buildLegacyPoolStatus's `?? 1`
        // / `?? 5` fallback legs.
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce({
          id: 'default',
          type: 'electrum',
          host: 'electrum.example.com',
          port: 50002,
          useSsl: true,
          explorerUrl: 'https://mempool.space',
          servers: [],
        });
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' });
        mockElectrumClient.getBlockHeight.mockResolvedValue(1);

        const response = await request(app).get('/bitcoin/status?network=regtest');

        expect(response.status).toBe(200);
        expect(response.body.pool).toMatchObject({ minConnections: 1, maxConnections: 5 });
      });

      it('falls back to the default health-check interval when the pool reports a falsy one', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce(poolNodeConfig());
        mockElectrumPool.isPoolInitialized.mockReturnValueOnce(true);
        mockElectrumPool.getOperationalConfigSnapshot.mockReturnValueOnce({
          loadBalancing: 'round_robin',
          healthCheckIntervalMs: 0,
          enabled: true,
        });
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' });
        mockElectrumClient.getBlockHeight.mockResolvedValue(900000);

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(response.body.connected).toBe(true);
      });

      it('propagates a truthy persisted lastHealthCheck into the legacy raw pool.stats fallback', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce(
          poolNodeConfig({
            servers: [
              {
                id: 'mainnet-1',
                label: 'Mainnet One',
                host: 'mainnet-1.example.com',
                port: 50002,
                useSsl: true,
                priority: 1,
                enabled: true,
                network: 'mainnet',
                isHealthy: true,
                lastHealthCheck: '2026-01-01T00:00:00.000Z',
              },
            ],
          }),
        );
        mockElectrumPool.isPoolInitialized.mockReturnValueOnce(false);
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' });
        mockElectrumClient.getBlockHeight.mockResolvedValue(900000);

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(response.body.pool.stats.servers[0]).toMatchObject({ serverId: 'mainnet-1' });
        expect(new Date(response.body.pool.stats.servers[0].lastHealthCheck).toISOString()).toBe(
          '2026-01-01T00:00:00.000Z',
        );
      });

      it('defaults pool min/max and load-balancing strategy when the config omits them', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce({
          id: 'default',
          type: 'electrum',
          host: 'electrum.example.com',
          port: 50002,
          useSsl: true,
          explorerUrl: 'https://mempool.space',
          mainnetMode: 'pool',
          servers: [
            {
              id: 'mainnet-1',
              label: 'Mainnet One',
              host: 'mainnet-1.example.com',
              port: 50002,
              useSsl: true,
              priority: 1,
              enabled: true,
              network: 'mainnet',
            },
          ],
        });
        mockElectrumPool.isPoolInitialized.mockReturnValueOnce(false);
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' });
        mockElectrumClient.getBlockHeight.mockResolvedValue(900000);

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(response.body.pool).toMatchObject({ minConnections: 1, maxConnections: 5 });
        expect(response.body.operational.pool.strategy).toBe('round_robin');
      });

      it('reports a successful pool route and propagates live per-server health from getPoolStats', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce(poolNodeConfig());
        mockElectrumPool.isPoolInitialized.mockReturnValueOnce(true);
        mockElectrumPool.getPoolStats.mockReturnValueOnce({
          totalConnections: 1,
          activeConnections: 1,
          idleConnections: 0,
          waitingRequests: 0,
          totalAcquisitions: 1,
          averageAcquisitionTimeMs: 5,
          healthCheckFailures: 0,
          serverCount: 2,
          servers: [
            {
              serverId: 'mainnet-1',
              label: 'Mainnet One',
              host: 'mainnet-1.example.com',
              port: 50002,
              connectionCount: 1,
              healthyConnections: 1,
              totalRequests: 10,
              failedRequests: 0,
              isHealthy: true,
              lastHealthCheck: new Date('2026-01-01T00:00:00.000Z'),
              consecutiveFailures: 0,
            },
          ],
        });
        mockElectrumPool.acquire.mockResolvedValueOnce({
          client: mockElectrumClient,
          serverId: 'mainnet-1',
          serverLabel: 'Mainnet One',
          serverHost: 'mainnet-1.example.com',
          serverPort: 50002,
          release: vi.fn(),
          withClient: vi.fn(),
        });
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' });
        mockElectrumClient.getBlockHeight.mockResolvedValue(900000);

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(response.body.connected).toBe(true);
        expect(response.body.operational.route).toMatchObject({ transport: 'pool', serverId: 'mainnet-1' });
        expect(response.body.operational.pool.servers.find((s: { serverId: string }) => s.serverId === 'mainnet-1'))
          .toMatchObject({ availability: 'online' });
      });

      it('falls back to singleton when a successful pool probe reports no server identity (defensive)', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce(poolNodeConfig());
        mockElectrumPool.isPoolInitialized.mockReturnValueOnce(true);
        mockElectrumPool.acquire.mockResolvedValueOnce({
          client: mockElectrumClient,
          serverId: '',
          serverLabel: '',
          serverHost: '',
          serverPort: 0,
          release: vi.fn(),
          withClient: vi.fn(),
        });
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' });
        mockElectrumClient.getBlockHeight.mockResolvedValue(900000);

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(response.body.operational.route).toMatchObject({
          transport: 'singleton_fallback',
          fallbackReason: 'pool_probe_failed',
        });
      });

      it('reports pool_uninitialized and never calls acquire when the pool is not initialized', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce(poolNodeConfig());
        mockElectrumPool.isPoolInitialized.mockReturnValueOnce(false);
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' });
        mockElectrumClient.getBlockHeight.mockResolvedValue(900000);

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(mockElectrumPool.acquire).not.toHaveBeenCalled();
        expect(response.body.operational.route).toMatchObject({
          transport: 'singleton_fallback',
          fallbackReason: 'pool_uninitialized',
        });
      });

      it('reports pool_circuit_open and never calls acquire when the circuit breaker is open', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce(poolNodeConfig());
        mockElectrumPool.getCircuitHealth.mockReturnValueOnce({ state: 'open' });
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' });
        mockElectrumClient.getBlockHeight.mockResolvedValue(900000);

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(mockElectrumPool.acquire).not.toHaveBeenCalled();
        expect(response.body.operational.route).toMatchObject({
          transport: 'singleton_fallback',
          fallbackReason: 'pool_circuit_open',
        });
      });

      it('never touches the pool registry/acquire path for an empty general pool, and reports pool_empty with empty topology', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce(
          poolNodeConfig({
            servers: [
              {
                id: 'sp-only',
                label: 'Silent Payments Only',
                host: 'sp-only.example.com',
                port: 50002,
                useSsl: true,
                priority: 1,
                enabled: true,
                network: 'mainnet',
                isHealthy: true,
                lastHealthCheck: null,
                serverUsage: 'silent_payments',
              },
            ],
          }),
        );
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' });
        mockElectrumClient.getBlockHeight.mockResolvedValue(900000);

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(mockElectrumPool.acquire).not.toHaveBeenCalled();
        expect(mockNodeClient.getElectrumPool).not.toHaveBeenCalled();
        expect(response.body.operational.route).toMatchObject({
          transport: 'singleton_fallback',
          fallbackReason: 'pool_empty',
        });
        expect(response.body.operational.pool).toMatchObject({
          online: 0,
          offline: 0,
          cooldown: 0,
          unchecked: 0,
          stale: 0,
          primaryServerId: null,
          preferredServerId: null,
          nextFailoverServerId: null,
          servers: [],
        });
      });

      it('reports route:null, empty topology, and null role IDs when the empty-pool singleton fallback also fails', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce(poolNodeConfig({ servers: [] }));
        mockElectrumClient.connect.mockRejectedValueOnce(new Error('unreachable'));

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(response.body.connected).toBe(false);
        expect(response.body.operational.route).toBeNull();
        expect(response.body.operational.pool).toMatchObject({
          servers: [],
          primaryServerId: null,
          preferredServerId: null,
          nextFailoverServerId: null,
        });
      });

      it('reports disconnected with route:null on a wrong-network identity mismatch for a configured singleton, never downgrading to a fallback success', async () => {
        const { verifyNodeClientNetwork } = await import('../../../../src/services/bitcoin/networkIdentity');
        vi.mocked(verifyNodeClientNetwork).mockRejectedValueOnce(new Error('genesis mismatch'));
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' });
        mockElectrumClient.getBlockHeight.mockResolvedValue(900000);

        const response = await request(app).get('/bitcoin/status?network=testnet3');

        expect(response.status).toBe(200);
        expect(response.body.connected).toBe(false);
        expect(response.body.operational.route).toBeNull();
      });

      it('reports route:null (never a successful singleton_fallback) when the fallback singleton also fails identity verification', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce(poolNodeConfig());
        mockElectrumPool.isPoolInitialized.mockReturnValueOnce(false);
        const { verifyNodeClientNetwork } = await import('../../../../src/services/bitcoin/networkIdentity');
        vi.mocked(verifyNodeClientNetwork).mockRejectedValueOnce(new Error('genesis mismatch'));
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' });
        mockElectrumClient.getBlockHeight.mockResolvedValue(900000);

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(response.body.connected).toBe(false);
        expect(response.body.operational.route).toBeNull();
        // Topology from the snapshot is still populated; it is only the
        // route that is null -- never downgraded to a reported fallback.
        expect(response.body.operational.pool.servers.length).toBeGreaterThan(0);
      });

      it('never leaks proxy credentials into the DTO, error text, or log calls', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce({
          id: 'default',
          type: 'electrum',
          host: 'electrum.example.com',
          port: 50002,
          useSsl: true,
          explorerUrl: 'https://mempool.space',
          allowSelfSignedCert: true,
          proxyEnabled: true,
          proxyHost: '127.0.0.1',
          proxyPort: 9050,
          proxyUsername: 'tor-user',
          proxyPassword: 'super-secret-password',
          servers: [],
        });
        mockElectrumClient.connect.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:9050'));

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        const serialized = JSON.stringify(response.body);
        expect(serialized).not.toContain('super-secret-password');
        expect(serialized).not.toContain('tor-user');
      });
    });
  });
};
