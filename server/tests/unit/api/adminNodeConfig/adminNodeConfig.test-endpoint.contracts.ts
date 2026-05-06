import { describe, expect, it } from 'vitest';
import request from 'supertest';

import {
  getAdminNodeConfigApp,
  mockTestNodeConfig,
} from './adminNodeConfigTestHarness';

export function registerAdminNodeConfigTestEndpointTests(): void {
  describe('node connection test endpoint', () => {
    it('tests node connection successfully', async () => {
      mockTestNodeConfig.mockResolvedValue({
        success: true,
        message: 'OK',
        info: { blockHeight: 900000 },
      });

      const response = await request(getAdminNodeConfigApp())
        .post('/api/v1/admin/node-config/test')
        .send({
          type: 'electrum',
          host: 'electrum.example.com',
          port: '50002',
          useSsl: true,
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        blockHeight: 900000,
        message: 'OK',
      });
      expect(mockTestNodeConfig).toHaveBeenCalledWith({
        host: 'electrum.example.com',
        port: 50002,
        protocol: 'ssl',
      });
    });

    it('returns connection failure from node test endpoint', async () => {
      mockTestNodeConfig.mockResolvedValue({
        success: false,
        message: 'Connection refused',
      });

      const response = await request(getAdminNodeConfigApp())
        .post('/api/v1/admin/node-config/test')
        .send({
          type: 'electrum',
          host: 'electrum.example.com',
          port: 50002,
        });

      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({
        success: false,
        error: 'Connection Failed',
      });
    });

    it('passes network identity through to node test endpoint', async () => {
      mockTestNodeConfig.mockResolvedValue({
        success: false,
        message: 'Testnet4 chain identity mismatch',
      });

      const response = await request(getAdminNodeConfigApp())
        .post('/api/v1/admin/node-config/test')
        .send({
          type: 'electrum',
          host: 'electrum.blockstream.info',
          port: 60002,
          useSsl: true,
          network: 'testnet4',
        });

      expect(response.status).toBe(500);
      expect(mockTestNodeConfig).toHaveBeenCalledWith({
        host: 'electrum.blockstream.info',
        port: 60002,
        protocol: 'ssl',
        network: 'testnet4',
      });
    });

    it('rejects invalid node test networks before testing connection', async () => {
      const response = await request(getAdminNodeConfigApp())
        .post('/api/v1/admin/node-config/test')
        .send({
          type: 'electrum',
          host: 'electrum.example.com',
          port: 50002,
          network: 'testnet',
        });

      expect(response.status).toBe(400);
      expect(mockTestNodeConfig).not.toHaveBeenCalled();
    });

    it('validates required node test fields', async () => {
      const response = await request(getAdminNodeConfigApp())
        .post('/api/v1/admin/node-config/test')
        .send({ type: 'electrum', host: 'electrum.example.com' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('required');
    });

    it('rejects invalid node test field types before testing connection', async () => {
      const response = await request(getAdminNodeConfigApp())
        .post('/api/v1/admin/node-config/test')
        .send({
          type: 'electrum',
          host: 'electrum.example.com',
          port: { value: 50002 },
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid node configuration');
      expect(mockTestNodeConfig).not.toHaveBeenCalled();
    });

    it('rejects unsupported node type on test endpoint', async () => {
      const response = await request(getAdminNodeConfigApp())
        .post('/api/v1/admin/node-config/test')
        .send({ type: 'rpc', host: 'example.com', port: 8332 });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_INPUT');
      expect(response.body.message).toContain('Only Electrum');
    });

    it('handles unexpected node test errors', async () => {
      mockTestNodeConfig.mockRejectedValue(new Error('test failed'));

      const response = await request(getAdminNodeConfigApp())
        .post('/api/v1/admin/node-config/test')
        .send({
          type: 'electrum',
          host: 'electrum.example.com',
          port: 50002,
        });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });
}
