import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { DEFAULT_NODE_MEMPOOL_ESTIMATOR } from '@sanctuary/shared/constants/nodeConfig';

import { buildNodeConfigData, type NodeConfigInput } from '../../../../src/api/admin/nodeConfigData';
import { eventBus } from '../../../../src/events/eventBus';
import { mockPrismaClient } from '../../../mocks/prisma';
import {
  buildNodeConfig,
  getAdminNodeConfigApp,
  mockAuditLogFromRequest,
  mockEncrypt,
  mockLogError,
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
        explorerUrl: 'https://mempool.space',
        feeEstimatorUrl: '',
        testnet3ExplorerUrl: 'https://mempool.space/testnet',
        testnet3FeeEstimatorUrl: '',
        testnet4ExplorerUrl: 'https://mempool.space/testnet4',
        testnet4FeeEstimatorUrl: '',
        signetExplorerUrl: 'https://mempool.space/signet',
        signetFeeEstimatorUrl: '',
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
      expect(response.body.feeEstimatorUrl).toBe('');
      expect(response.body.testnet3ExplorerUrl).toBe('https://mempool.space/testnet');
      expect(response.body.testnet3FeeEstimatorUrl).toBe('');
      expect(response.body.testnet4FeeEstimatorUrl).toBe('');
      expect(response.body.signetFeeEstimatorUrl).toBe('');
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
      expect(response.body.feeEstimatorUrl).toBe('');
      expect(response.body.mempoolEstimator).toBe(DEFAULT_NODE_MEMPOOL_ESTIMATOR);
      expect(response.body.poolLoadBalancing).toBe('round_robin');
    });

    it('keeps an Electrum fee source when a NULL-fee config response is saved back unchanged', async () => {
      const nullFeeConfig = buildNodeConfig({
        id: 'default-existing',
        feeEstimatorUrl: null,
        testnet3FeeEstimatorUrl: null,
        testnet4FeeEstimatorUrl: null,
        signetFeeEstimatorUrl: null,
      });
      mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(nullFeeConfig);
      const read = await request(getAdminNodeConfigApp()).get('/api/v1/admin/node-config');
      expect(read.status).toBe(200);

      mockPrismaClient.nodeConfig.update.mockResolvedValue(nullFeeConfig);
      const { servers: _servers, hasPassword: _hasPassword, ...echoed } = read.body;
      await request(getAdminNodeConfigApp()).put('/api/v1/admin/node-config').send(echoed);

      expect(mockPrismaClient.nodeConfig.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          feeEstimatorUrl: '',
          testnet3FeeEstimatorUrl: '',
          testnet4FeeEstimatorUrl: '',
          signetFeeEstimatorUrl: '',
        }),
      }));
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

    it('keeps the stored proxy password when the update sends the masked sentinel', async () => {
      mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({
        id: 'default-existing',
        proxyPassword: 'enc:existing-secret',
      });
      mockPrismaClient.nodeConfig.update.mockResolvedValue(
        buildNodeConfig({
          id: 'default-existing',
          host: 'masked-update.example.com',
          proxyEnabled: true,
          proxyPassword: 'enc:existing-secret',
        })
      );

      const response = await request(getAdminNodeConfigApp())
        .put('/api/v1/admin/node-config')
        .send({
          type: 'electrum',
          host: 'masked-update.example.com',
          port: 50002,
          proxyEnabled: true,
          proxyHost: '127.0.0.1',
          proxyPort: 9050,
          proxyPassword: '********',
        });

      expect(response.status).toBe(200);
      expect(mockEncrypt).not.toHaveBeenCalledWith('********');
      expect(mockPrismaClient.nodeConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            proxyPassword: 'enc:existing-secret',
          }),
        })
      );
    });

    it('keeps the stored proxy password when the update omits proxyPassword', async () => {
      mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({
        id: 'default-existing',
        proxyPassword: 'enc:existing-secret',
      });
      mockPrismaClient.nodeConfig.update.mockResolvedValue(
        buildNodeConfig({
          id: 'default-existing',
          host: 'omitted-update.example.com',
          proxyEnabled: true,
          proxyPassword: 'enc:existing-secret',
        })
      );

      const response = await request(getAdminNodeConfigApp())
        .put('/api/v1/admin/node-config')
        .send({
          type: 'electrum',
          host: 'omitted-update.example.com',
          port: 50002,
          proxyEnabled: true,
          proxyHost: '127.0.0.1',
          proxyPort: 9050,
        });

      expect(response.status).toBe(200);
      expect(mockEncrypt).not.toHaveBeenCalled();
      expect(mockPrismaClient.nodeConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            proxyPassword: 'enc:existing-secret',
          }),
        })
      );
    });

    it('clears an existing stored proxy password when the update sends explicit null', async () => {
      mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({
        id: 'default-existing',
        proxyPassword: 'enc:existing-secret',
      });
      mockPrismaClient.nodeConfig.update.mockResolvedValue(
        buildNodeConfig({
          id: 'default-existing',
          host: 'cleared-update.example.com',
          proxyEnabled: true,
          proxyPassword: null,
        })
      );

      const response = await request(getAdminNodeConfigApp())
        .put('/api/v1/admin/node-config')
        .send({
          type: 'electrum',
          host: 'cleared-update.example.com',
          port: 50002,
          proxyEnabled: true,
          proxyHost: '127.0.0.1',
          proxyPort: 9050,
          proxyPassword: null,
        });

      expect(response.status).toBe(200);
      expect(mockEncrypt).not.toHaveBeenCalled();
      expect(mockPrismaClient.nodeConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            proxyPassword: null,
          }),
        })
      );
    });

    it('replaces the stored proxy password when the update sends a new value', async () => {
      mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({
        id: 'default-existing',
        proxyPassword: 'enc:existing-secret',
      });
      mockPrismaClient.nodeConfig.update.mockResolvedValue(
        buildNodeConfig({
          id: 'default-existing',
          host: 'replaced-update.example.com',
          proxyEnabled: true,
          proxyPassword: 'enc:brand-new-secret',
        })
      );

      const response = await request(getAdminNodeConfigApp())
        .put('/api/v1/admin/node-config')
        .send({
          type: 'electrum',
          host: 'replaced-update.example.com',
          port: 50002,
          proxyEnabled: true,
          proxyHost: '127.0.0.1',
          proxyPort: 9050,
          proxyPassword: 'brand-new-secret',
        });

      expect(response.status).toBe(200);
      expect(mockEncrypt).toHaveBeenCalledWith('brand-new-secret');
      expect(mockPrismaClient.nodeConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            proxyPassword: 'enc:brand-new-secret',
          }),
        })
      );
    });

    const baseNodeConfigBody: NodeConfigInput = {
      type: 'electrum',
      host: 'updated.example.com',
      port: 50002,
      proxyEnabled: true,
      proxyHost: 'tor',
      proxyPort: 9050,
      proxyPassword: 'secret',
    };

    function saveNodeConfig(body: Partial<NodeConfigInput> = { type: 'electrum', host: 'updated.example.com', port: 50002 }) {
      return request(getAdminNodeConfigApp())
        .put('/api/v1/admin/node-config')
        .send(body);
    }

    function storeNodeConfig(body: NodeConfigInput) {
      mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({ id: 'default-existing', ...buildNodeConfigData(body) });
      mockPrismaClient.nodeConfig.update.mockResolvedValue(buildNodeConfig({ id: 'default-existing' }));
    }

    it.each([
      ['an unchanged save', {}, []],
      ['a mainnet singleton host', { mainnetSingletonHost: 'mainnet.example.com' }, ['mainnet']],
      ['the unprefixed mainnet explorer URL', { explorerUrl: 'https://explorer.example.com' }, ['mainnet']],
      ['testnet3 settings, mirrored into the legacy testnet columns', { testnet3SingletonHost: 'tn3.example.com' }, ['testnet3']],
      ['testnet4 and signet settings', { testnet4Enabled: true, signetMode: 'pool' }, ['testnet4', 'signet']],
      ['a global proxy field alongside a network field', { mainnetSingletonHost: 'mainnet.example.com', proxyHost: 'other-tor' }, [null]],
      ['the masked proxy password', { proxyPassword: '********' }, []],
    ])('publishes node-config changes scoped to what changed: %s', async (_label, changes, networks) => {
      const emitAsync = vi.spyOn(eventBus, 'emitAsync').mockResolvedValue(undefined);
      try {
        storeNodeConfig(baseNodeConfigBody);

        const response = await saveNodeConfig({ ...baseNodeConfigBody, ...changes });

        expect(response.status).toBe(200);
        expect(emitAsync.mock.calls).toEqual(networks.map((network) => [
          'system:electrumConfig.changed',
          { scope: 'node-config', network },
        ]));
      } finally {
        emitAsync.mockRestore();
      }
    });

    it('publishes an all-network node-config change when the first config is created', async () => {
      const emitAsync = vi.spyOn(eventBus, 'emitAsync').mockResolvedValue(undefined);
      try {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(null);
        mockPrismaClient.nodeConfig.create.mockResolvedValue(buildNodeConfig());

        const response = await saveNodeConfig();

        expect(response.status).toBe(200);
        expect(emitAsync.mock.calls).toEqual([
          ['system:electrumConfig.changed', { scope: 'node-config', network: null }],
        ]);
      } finally {
        emitAsync.mockRestore();
      }
    });

    it('responds without waiting for a stalled node-config change publish', async () => {
      const emitAsync = vi.spyOn(eventBus, 'emitAsync').mockReturnValue(new Promise<void>(() => {}));
      try {
        storeNodeConfig(baseNodeConfigBody);

        const response = await saveNodeConfig({ ...baseNodeConfigBody, mainnetSingletonHost: 'mainnet.example.com' });

        expect(response.status).toBe(200);
        expect(emitAsync).toHaveBeenCalledTimes(1);
      } finally {
        emitAsync.mockRestore();
      }
    }, 2000);

    it('publishes a node-config change to other processes after resetting the API node client', async () => {
      const emitAsync = vi.spyOn(eventBus, 'emitAsync').mockResolvedValue(undefined);
      try {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({ id: 'default-existing' });
        mockPrismaClient.nodeConfig.update.mockResolvedValue(buildNodeConfig({ id: 'default-existing' }));

        const response = await saveNodeConfig();

        expect(response.status).toBe(200);
        expect(emitAsync).toHaveBeenCalledWith('system:electrumConfig.changed', { scope: 'node-config', network: null });
        expect(mockResetNodeClient.mock.invocationCallOrder[0]).toBeLessThan(emitAsync.mock.invocationCallOrder[0]);
      } finally {
        emitAsync.mockRestore();
      }
    });

    it('does not publish a node-config change when the save fails', async () => {
      const emitAsync = vi.spyOn(eventBus, 'emitAsync').mockResolvedValue(undefined);
      try {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({ id: 'default-existing' });
        mockPrismaClient.nodeConfig.update.mockRejectedValue(new Error('write failed'));

        const response = await saveNodeConfig();

        expect(response.status).toBe(500);
        expect(emitAsync).not.toHaveBeenCalled();
      } finally {
        emitAsync.mockRestore();
      }
    });

    it('still returns success when publishing the node-config change fails', async () => {
      const emitAsync = vi.spyOn(eventBus, 'emitAsync').mockRejectedValueOnce(new Error('redis down'));
      try {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({ id: 'default-existing' });
        mockPrismaClient.nodeConfig.update.mockResolvedValue(buildNodeConfig({ id: 'default-existing' }));

        const response = await saveNodeConfig();

        expect(response.status).toBe(200);
        await vi.waitFor(() => expect(mockLogError).toHaveBeenCalledWith(
          'Failed to publish Electrum config change',
          expect.objectContaining({ error: 'redis down' }),
        ));
      } finally {
        emitAsync.mockRestore();
      }
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
