import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { DEFAULT_NODE_MEMPOOL_ESTIMATOR } from '@sanctuary/shared/constants/nodeConfig';

import { mockPrismaClient } from '../../../mocks/prisma';
import {
  buildNodeConfig,
  getAdminNodeConfigApp,
  mockAuditLogFromRequest,
  mockEncrypt,
  mockResetNodeClient,
} from './adminNodeConfigTestHarness';

export function registerAdminNodeConfigReadUpdateTests(): void {
  describe('read and update', () => {
    it('returns defaults when node config does not exist', async () => {
      mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(null);

      const response = await request(getAdminNodeConfigApp()).get('/api/v1/admin/node-config');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        type: 'electrum',
        host: 'electrum.blockstream.info',
        port: '50002',
        hasPassword: false,
        poolEnabled: true,
        testnet3ExplorerUrl: 'https://mempool.space/testnet',
        testnet3FeeEstimatorUrl: 'https://mempool.space/testnet',
        testnet4ExplorerUrl: 'https://mempool.space/testnet4',
        testnet4FeeEstimatorUrl: 'https://mempool.space/testnet4',
        signetExplorerUrl: 'https://mempool.space/signet',
        signetFeeEstimatorUrl: 'https://mempool.space/signet',
        mempoolEstimator: DEFAULT_NODE_MEMPOOL_ESTIMATOR,
      });
      expect(response.body.servers).toEqual([]);
    });

    it('returns persisted config and masks proxy password', async () => {
      mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(
        buildNodeConfig({
          host: 'saved.example.com',
          port: 60002,
          mempoolEstimator: 'simple',
          proxyEnabled: true,
          proxyPassword: 'encrypted-secret',
        })
      );

      const response = await request(getAdminNodeConfigApp()).get('/api/v1/admin/node-config');

      expect(response.status).toBe(200);
      expect(response.body.host).toBe('saved.example.com');
      expect(response.body.port).toBe('60002');
      expect(response.body.mempoolEstimator).toBe('simple');
      expect(response.body.proxyPassword).toBe('********');
    });

    it('applies response fallbacks for nullable persisted fields', async () => {
      mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(
        buildNodeConfig({
          allowSelfSignedCert: null as any,
          feeEstimatorUrl: null,
          testnet3ExplorerUrl: null,
          testnet3FeeEstimatorUrl: '',
          testnet4ExplorerUrl: null,
          testnet4FeeEstimatorUrl: null,
          signetExplorerUrl: null,
          signetFeeEstimatorUrl: null,
          mempoolEstimator: null as any,
          poolLoadBalancing: null as any,
          proxyEnabled: undefined as any,
          proxyPassword: null,
        })
      );

      const response = await request(getAdminNodeConfigApp()).get('/api/v1/admin/node-config');

      expect(response.status).toBe(200);
      expect(response.body.allowSelfSignedCert).toBe(false);
      expect(response.body.feeEstimatorUrl).toBe('https://mempool.space');
      expect(response.body.testnet3ExplorerUrl).toBe('https://mempool.space/testnet');
      expect(response.body.testnet3FeeEstimatorUrl).toBe('');
      expect(response.body.testnet4FeeEstimatorUrl).toBe('https://mempool.space/testnet4');
      expect(response.body.signetExplorerUrl).toBe('https://mempool.space/signet');
      expect(response.body.mempoolEstimator).toBe(DEFAULT_NODE_MEMPOOL_ESTIMATOR);
      expect(response.body.poolLoadBalancing).toBe('round_robin');
      expect(response.body.proxyEnabled).toBe(false);
      expect(response.body).not.toHaveProperty('proxyPassword');
    });

    it('returns 500 when loading node config fails', async () => {
      mockPrismaClient.nodeConfig.findFirst.mockRejectedValue(new Error('read failed'));

      const response = await request(getAdminNodeConfigApp()).get('/api/v1/admin/node-config');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });

    it('validates required fields on update', async () => {
      const response = await request(getAdminNodeConfigApp())
        .put('/api/v1/admin/node-config')
        .send({ type: 'electrum', host: 'example.com' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('required');
    });

    it('rejects unsupported node type on update', async () => {
      const response = await request(getAdminNodeConfigApp())
        .put('/api/v1/admin/node-config')
        .send({ type: 'rpc', host: 'example.com', port: 50002 });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Only Electrum');
    });

    it('rejects invalid optional node config field types before updating', async () => {
      const response = await request(getAdminNodeConfigApp())
        .put('/api/v1/admin/node-config')
        .send({
          type: 'electrum',
          host: 'example.com',
          port: 50002,
          useSsl: 'true',
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid node configuration');
      expect(mockPrismaClient.nodeConfig.findFirst).not.toHaveBeenCalled();
      expect(mockPrismaClient.nodeConfig.update).not.toHaveBeenCalled();
    });

    it('rejects unsupported mempool estimator values before updating', async () => {
      const response = await request(getAdminNodeConfigApp())
        .put('/api/v1/admin/node-config')
        .send({
          type: 'electrum',
          host: 'example.com',
          port: 50002,
          mempoolEstimator: 'not-valid',
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid node configuration');
      expect(mockPrismaClient.nodeConfig.findFirst).not.toHaveBeenCalled();
      expect(mockPrismaClient.nodeConfig.update).not.toHaveBeenCalled();
    });

    it('updates existing default config and resets node client', async () => {
      mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({ id: 'default-existing' });
      mockPrismaClient.nodeConfig.update.mockResolvedValue(
        buildNodeConfig({
          id: 'default-existing',
          host: 'updated.example.com',
          port: 51001,
          proxyPassword: 'enc:proxy-secret',
        })
      );

      const response = await request(getAdminNodeConfigApp())
        .put('/api/v1/admin/node-config')
        .send({
          type: 'electrum',
          host: 'updated.example.com',
          port: '51001',
          useSsl: true,
          poolLoadBalancing: 'also-invalid',
          proxyEnabled: true,
          proxyHost: '127.0.0.1',
          proxyPort: 9050,
          proxyUsername: 'tor',
          proxyPassword: 'proxy-secret',
        });

      expect(response.status).toBe(200);
      expect(response.body.host).toBe('updated.example.com');
      expect(response.body.port).toBe('51001');
      expect(response.body.message).toContain('updated successfully');

      expect(mockEncrypt).toHaveBeenCalledWith('proxy-secret');
      expect(mockPrismaClient.nodeConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mempoolEstimator: DEFAULT_NODE_MEMPOOL_ESTIMATOR,
            poolLoadBalancing: 'round_robin',
            proxyPassword: 'enc:proxy-secret',
          }),
        })
      );
      expect(mockAuditLogFromRequest).toHaveBeenCalled();
      expect(mockResetNodeClient).toHaveBeenCalled();
    });

    it('preserves explicit simple estimator selections on update', async () => {
      mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({ id: 'default-existing' });
      mockPrismaClient.nodeConfig.update.mockResolvedValue(
        buildNodeConfig({
          id: 'default-existing',
          mempoolEstimator: 'simple',
        })
      );

      const response = await request(getAdminNodeConfigApp())
        .put('/api/v1/admin/node-config')
        .send({
          type: 'electrum',
          host: 'updated.example.com',
          port: 50002,
          mempoolEstimator: 'simple',
        });

      expect(response.status).toBe(200);
      expect(response.body.mempoolEstimator).toBe('simple');
      expect(mockPrismaClient.nodeConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mempoolEstimator: 'simple',
          }),
        })
      );
    });

    it('accepts explicit optional update values and parses numeric fields', async () => {
      mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({ id: 'default-existing' });
      mockPrismaClient.nodeConfig.update.mockResolvedValue(
        buildNodeConfig({
          id: 'default-existing',
          host: 'full-update.example.com',
          port: 52002,
          useSsl: false,
          allowSelfSignedCert: true,
          explorerUrl: 'https://explorer.example.com',
          feeEstimatorUrl: 'https://fees.example.com',
          testnet3ExplorerUrl: 'https://explorer.testnet3.example.com',
          testnet3FeeEstimatorUrl: '',
          testnet4ExplorerUrl: 'https://explorer.testnet4.example.com',
          testnet4FeeEstimatorUrl: 'https://fees.testnet4.example.com',
          signetExplorerUrl: 'https://explorer.signet.example.com',
          signetFeeEstimatorUrl: 'https://fees.signet.example.com',
          mempoolEstimator: DEFAULT_NODE_MEMPOOL_ESTIMATOR,
          poolEnabled: false,
          poolMinConnections: 2,
          poolMaxConnections: 8,
          poolLoadBalancing: 'least_connections',
          proxyEnabled: true,
          proxyHost: '127.0.0.1',
          proxyPort: 9050,
          proxyUsername: 'proxy-user',
          proxyPassword: 'enc:proxy-pass',
          mainnetMode: 'singleton',
          mainnetSingletonHost: 'mainnet.example.com',
          mainnetSingletonPort: 51002,
          mainnetSingletonSsl: false,
          mainnetPoolMin: 2,
          mainnetPoolMax: 9,
          mainnetPoolLoadBalancing: 'failover_only',
          testnetEnabled: true,
          testnetMode: 'pool',
          testnetSingletonHost: 'testnet.example.com',
          testnetSingletonPort: 61002,
          testnetSingletonSsl: false,
          testnetPoolMin: 2,
          testnetPoolMax: 6,
          testnetPoolLoadBalancing: 'least_connections',
          signetEnabled: true,
          signetMode: 'pool',
          signetSingletonHost: 'signet.example.com',
          signetSingletonPort: 52003,
          signetSingletonSsl: false,
          signetPoolMin: 2,
          signetPoolMax: 6,
          signetPoolLoadBalancing: 'failover_only',
        })
      );

      const response = await request(getAdminNodeConfigApp())
        .put('/api/v1/admin/node-config')
        .send({
          type: 'electrum',
          host: 'full-update.example.com',
          port: '52002',
          useSsl: false,
          allowSelfSignedCert: true,
          explorerUrl: 'https://explorer.example.com',
          feeEstimatorUrl: 'https://fees.example.com',
          testnet3ExplorerUrl: 'https://explorer.testnet3.example.com',
          testnet3FeeEstimatorUrl: '',
          testnet4ExplorerUrl: 'https://explorer.testnet4.example.com',
          testnet4FeeEstimatorUrl: 'https://fees.testnet4.example.com',
          signetExplorerUrl: 'https://explorer.signet.example.com',
          signetFeeEstimatorUrl: 'https://fees.signet.example.com',
          mempoolEstimator: DEFAULT_NODE_MEMPOOL_ESTIMATOR,
          poolEnabled: false,
          poolMinConnections: 2,
          poolMaxConnections: 8,
          poolLoadBalancing: 'least_connections',
          proxyEnabled: true,
          proxyHost: '127.0.0.1',
          proxyPort: '9050',
          proxyUsername: 'proxy-user',
          proxyPassword: 'proxy-pass',
          mainnetMode: 'singleton',
          mainnetSingletonHost: 'mainnet.example.com',
          mainnetSingletonPort: '51002',
          mainnetSingletonSsl: false,
          mainnetPoolMin: '2',
          mainnetPoolMax: '9',
          mainnetPoolLoadBalancing: 'failover_only',
          testnetEnabled: true,
          testnetMode: 'pool',
          testnetSingletonHost: 'testnet.example.com',
          testnetSingletonPort: '61002',
          testnetSingletonSsl: false,
          testnetPoolMin: '2',
          testnetPoolMax: '6',
          testnetPoolLoadBalancing: 'least_connections',
          signetEnabled: true,
          signetMode: 'pool',
          signetSingletonHost: 'signet.example.com',
          signetSingletonPort: '52003',
          signetSingletonSsl: false,
          signetPoolMin: '2',
          signetPoolMax: '6',
          signetPoolLoadBalancing: 'failover_only',
        });

      expect(response.status).toBe(200);
      expect(response.body.host).toBe('full-update.example.com');
      expect(response.body.port).toBe('52002');
      expect(mockPrismaClient.nodeConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mempoolEstimator: DEFAULT_NODE_MEMPOOL_ESTIMATOR,
            poolLoadBalancing: 'least_connections',
            testnet3ExplorerUrl: 'https://explorer.testnet3.example.com',
            testnet3FeeEstimatorUrl: '',
            testnet4ExplorerUrl: 'https://explorer.testnet4.example.com',
            testnet4FeeEstimatorUrl: 'https://fees.testnet4.example.com',
            signetExplorerUrl: 'https://explorer.signet.example.com',
            signetFeeEstimatorUrl: 'https://fees.signet.example.com',
            proxyPort: 9050,
            mainnetSingletonPort: 51002,
            mainnetPoolMin: 2,
            mainnetPoolMax: 9,
            testnetSingletonPort: 61002,
            testnetPoolMin: 2,
            testnetPoolMax: 6,
            signetSingletonPort: 52003,
            signetPoolMin: 2,
            signetPoolMax: 6,
            proxyPassword: 'enc:proxy-pass',
          }),
        })
      );
    });

    it('accepts nullable network update fields and applies default connection values', async () => {
      mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({ id: 'default-existing' });
      mockPrismaClient.nodeConfig.update.mockResolvedValue(
        buildNodeConfig({
          id: 'default-existing',
          testnetEnabled: true,
        })
      );

      const response = await request(getAdminNodeConfigApp())
        .put('/api/v1/admin/node-config')
        .send({
          type: 'electrum',
          host: 'electrum.blockstream.info',
          port: 50002,
          useSsl: true,
          proxyEnabled: false,
          proxyHost: null,
          proxyPort: null,
          proxyUsername: null,
          proxyPassword: null,
          mainnetMode: 'singleton',
          mainnetSingletonHost: null,
          mainnetSingletonPort: null,
          mainnetSingletonSsl: null,
          mainnetPoolMin: null,
          mainnetPoolMax: null,
          testnetEnabled: true,
          testnetMode: 'singleton',
          testnetSingletonHost: null,
          testnetSingletonPort: null,
          testnetSingletonSsl: null,
          testnetPoolMin: null,
          testnetPoolMax: null,
          signetEnabled: false,
          signetMode: 'singleton',
          signetSingletonHost: null,
          signetSingletonPort: null,
          signetSingletonSsl: null,
          signetPoolMin: null,
          signetPoolMax: null,
        });

      expect(response.status).toBe(200);
      expect(mockEncrypt).not.toHaveBeenCalled();
      expect(mockPrismaClient.nodeConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            proxyHost: null,
            proxyPort: null,
            proxyUsername: null,
            proxyPassword: null,
            mainnetSingletonHost: 'electrum.blockstream.info',
            mainnetSingletonPort: 50002,
            mainnetSingletonSsl: true,
            mainnetPoolMin: 1,
            mainnetPoolMax: 5,
            testnetEnabled: true,
            testnetSingletonHost: 'electrum.blockstream.info',
            testnetSingletonPort: 60002,
            testnetSingletonSsl: true,
            testnetPoolMin: 1,
            testnetPoolMax: 3,
            signetEnabled: false,
            signetSingletonHost: 'electrum.mutinynet.com',
            signetSingletonPort: 50002,
            signetSingletonSsl: true,
            signetPoolMin: 1,
            signetPoolMax: 3,
          }),
        })
      );
    });

    it('applies fallback values in update response when persisted values are nullish', async () => {
      mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({ id: 'default-existing' });
      mockPrismaClient.nodeConfig.update.mockResolvedValue(
        buildNodeConfig({
          id: 'default-existing',
          allowSelfSignedCert: null as any,
          feeEstimatorUrl: null,
          mempoolEstimator: null as any,
          poolLoadBalancing: null as any,
        })
      );

      const response = await request(getAdminNodeConfigApp())
        .put('/api/v1/admin/node-config')
        .send({
          type: 'electrum',
          host: 'updated.example.com',
          port: 50002,
        });

      expect(response.status).toBe(200);
      expect(response.body.allowSelfSignedCert).toBe(false);
      expect(response.body.feeEstimatorUrl).toBe('https://mempool.space');
      expect(response.body.mempoolEstimator).toBe(DEFAULT_NODE_MEMPOOL_ESTIMATOR);
      expect(response.body.poolLoadBalancing).toBe('round_robin');
    });

    it('creates a default config when none exists', async () => {
      mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(null);
      mockPrismaClient.nodeConfig.create.mockResolvedValue(
        buildNodeConfig({
          id: 'default',
          host: 'new.example.com',
          port: 50001,
        })
      );

      const response = await request(getAdminNodeConfigApp())
        .put('/api/v1/admin/node-config')
        .send({
          type: 'electrum',
          host: 'new.example.com',
          port: 50001,
        });

      expect(response.status).toBe(200);
      expect(mockPrismaClient.nodeConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            id: 'default',
            isDefault: true,
            host: 'new.example.com',
            port: 50001,
            mempoolEstimator: DEFAULT_NODE_MEMPOOL_ESTIMATOR,
          }),
        })
      );
    });

    it('creates config with explicit optional values and parsed numeric fields', async () => {
      mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(null);
      mockPrismaClient.nodeConfig.create.mockResolvedValue(
        buildNodeConfig({
          id: 'default',
          host: 'created-full.example.com',
          port: 53002,
          useSsl: false,
          allowSelfSignedCert: true,
          explorerUrl: 'https://explorer.create.example.com',
          feeEstimatorUrl: 'https://fees.create.example.com',
          testnet3ExplorerUrl: 'https://explorer.create-testnet3.example.com',
          testnet3FeeEstimatorUrl: '',
          testnet4ExplorerUrl: 'https://explorer.create-testnet4.example.com',
          testnet4FeeEstimatorUrl: 'https://fees.create-testnet4.example.com',
          signetExplorerUrl: 'https://explorer.create-signet.example.com',
          signetFeeEstimatorUrl: 'https://fees.create-signet.example.com',
          mempoolEstimator: DEFAULT_NODE_MEMPOOL_ESTIMATOR,
          poolEnabled: false,
          poolMinConnections: 3,
          poolMaxConnections: 10,
          poolLoadBalancing: 'failover_only',
          proxyEnabled: true,
          proxyHost: '127.0.0.1',
          proxyPort: 9150,
          proxyUsername: 'create-user',
          proxyPassword: 'enc:create-pass',
          mainnetMode: 'singleton',
          mainnetSingletonHost: 'created-mainnet.example.com',
          mainnetSingletonPort: 54002,
          mainnetSingletonSsl: false,
          mainnetPoolMin: 3,
          mainnetPoolMax: 10,
          mainnetPoolLoadBalancing: 'least_connections',
          testnetEnabled: true,
          testnetMode: 'pool',
          testnetSingletonHost: 'created-testnet.example.com',
          testnetSingletonPort: 64002,
          testnetSingletonSsl: false,
          testnetPoolMin: 3,
          testnetPoolMax: 7,
          testnetPoolLoadBalancing: 'failover_only',
          signetEnabled: true,
          signetMode: 'pool',
          signetSingletonHost: 'created-signet.example.com',
          signetSingletonPort: 55002,
          signetSingletonSsl: false,
          signetPoolMin: 3,
          signetPoolMax: 7,
          signetPoolLoadBalancing: 'least_connections',
        })
      );

      const response = await request(getAdminNodeConfigApp())
        .put('/api/v1/admin/node-config')
        .send({
          type: 'electrum',
          host: 'created-full.example.com',
          port: '53002',
          useSsl: false,
          allowSelfSignedCert: true,
          explorerUrl: 'https://explorer.create.example.com',
          feeEstimatorUrl: 'https://fees.create.example.com',
          testnet3ExplorerUrl: 'https://explorer.create-testnet3.example.com',
          testnet3FeeEstimatorUrl: '',
          testnet4ExplorerUrl: 'https://explorer.create-testnet4.example.com',
          testnet4FeeEstimatorUrl: 'https://fees.create-testnet4.example.com',
          signetExplorerUrl: 'https://explorer.create-signet.example.com',
          signetFeeEstimatorUrl: 'https://fees.create-signet.example.com',
          mempoolEstimator: DEFAULT_NODE_MEMPOOL_ESTIMATOR,
          poolEnabled: false,
          poolMinConnections: 3,
          poolMaxConnections: 10,
          poolLoadBalancing: 'failover_only',
          proxyEnabled: true,
          proxyHost: '127.0.0.1',
          proxyPort: '9150',
          proxyUsername: 'create-user',
          proxyPassword: 'create-pass',
          mainnetMode: 'singleton',
          mainnetSingletonHost: 'created-mainnet.example.com',
          mainnetSingletonPort: '54002',
          mainnetSingletonSsl: false,
          mainnetPoolMin: '3',
          mainnetPoolMax: '10',
          mainnetPoolLoadBalancing: 'least_connections',
          testnetEnabled: true,
          testnetMode: 'pool',
          testnetSingletonHost: 'created-testnet.example.com',
          testnetSingletonPort: '64002',
          testnetSingletonSsl: false,
          testnetPoolMin: '3',
          testnetPoolMax: '7',
          testnetPoolLoadBalancing: 'failover_only',
          signetEnabled: true,
          signetMode: 'pool',
          signetSingletonHost: 'created-signet.example.com',
          signetSingletonPort: '55002',
          signetSingletonSsl: false,
          signetPoolMin: '3',
          signetPoolMax: '7',
          signetPoolLoadBalancing: 'least_connections',
        });

      expect(response.status).toBe(200);
      expect(mockPrismaClient.nodeConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mempoolEstimator: DEFAULT_NODE_MEMPOOL_ESTIMATOR,
            poolLoadBalancing: 'failover_only',
            testnet3ExplorerUrl: 'https://explorer.create-testnet3.example.com',
            testnet3FeeEstimatorUrl: '',
            testnet4ExplorerUrl: 'https://explorer.create-testnet4.example.com',
            testnet4FeeEstimatorUrl: 'https://fees.create-testnet4.example.com',
            signetExplorerUrl: 'https://explorer.create-signet.example.com',
            signetFeeEstimatorUrl: 'https://fees.create-signet.example.com',
            proxyPort: 9150,
            mainnetSingletonPort: 54002,
            mainnetPoolMin: 3,
            mainnetPoolMax: 10,
            testnetSingletonPort: 64002,
            testnetPoolMin: 3,
            testnetPoolMax: 7,
            signetSingletonPort: 55002,
            signetPoolMin: 3,
            signetPoolMax: 7,
            proxyPassword: 'enc:create-pass',
          }),
        })
      );
    });

    it('returns 500 when updating node config fails', async () => {
      mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({ id: 'default-existing' });
      mockPrismaClient.nodeConfig.update.mockRejectedValue(new Error('write failed'));

      const response = await request(getAdminNodeConfigApp())
        .put('/api/v1/admin/node-config')
        .send({
          type: 'electrum',
          host: 'updated.example.com',
          port: 50002,
        });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });
}
