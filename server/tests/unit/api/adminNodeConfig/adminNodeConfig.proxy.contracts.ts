import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import {
  getAdminNodeConfigApp,
  httpsGetMock,
  mockHttpsGet,
  mockLogWarn,
  mockSocksCreateConnection,
  mockSocksProxyAgentConstruct,
} from './adminNodeConfigTestHarness';

export function registerAdminNodeConfigProxyTests(): void {
  describe('proxy test endpoint', () => {
    it('validates proxy test inputs', async () => {
      const response = await request(getAdminNodeConfigApp())
        .post('/api/v1/admin/proxy/test')
        .send({ port: 9050 });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('required');
    });

    it('returns tor verification failure when .onion connection fails', async () => {
      mockSocksCreateConnection.mockRejectedValueOnce(new Error('onion connection failed'));

      const response = await request(getAdminNodeConfigApp())
        .post('/api/v1/admin/proxy/test')
        .send({ host: '127.0.0.1', port: 9050 });

      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({
        success: false,
        error: 'Tor Verification Failed',
      });
    });

    it('returns successful tor verification with exit IP', async () => {
      const response = await request(getAdminNodeConfigApp())
        .post('/api/v1/admin/proxy/test')
        .send({ host: '127.0.0.1', port: 9050 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockSocksCreateConnection).toHaveBeenCalled();
      expect(mockLogWarn).not.toHaveBeenCalled();
      expect(mockHttpsGet).toHaveBeenCalledWith(
        'https://check.torproject.org/api/ip',
        expect.objectContaining({
          agent: expect.any(Object),
        }),
        expect.any(Function),
      );
      expect(response.body.message).toContain('Tor verified!');
      expect(response.body.exitIp).toBe('1.2.3.4');
      expect(response.body.isTorExit).toBe(true);
    });

    it('handles tor exit-check timeout callback path', async () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      const immediateTimer = ((cb: () => void) => {
        cb();
        return 1 as any;
      }) as any;
      setTimeoutSpy.mockImplementationOnce(immediateTimer);

      try {
        const response = await request(getAdminNodeConfigApp())
          .post('/api/v1/admin/proxy/test')
          .send({ host: '127.0.0.1', port: 9050 });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(mockHttpsGet).toHaveBeenCalledWith(
          'https://check.torproject.org/api/ip',
          expect.objectContaining({
            signal: expect.any(Object),
          }),
          expect.any(Function),
        );
      } finally {
        setTimeoutSpy.mockRestore();
      }
    });

    it('uses proxy credentials and reports verified tor exit status', async () => {
      mockHttpsGet.mockImplementationOnce(
        httpsGetMock(200, JSON.stringify({ IsTor: true, IP: '9.9.9.9' }))
      );

      const response = await request(getAdminNodeConfigApp())
        .post('/api/v1/admin/proxy/test')
        .send({
          host: '127.0.0.1',
          port: 9050,
          username: 'tor-user',
          password: 'tor-pass',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(typeof response.body.isTorExit).toBe('boolean');
      expect(typeof response.body.exitIp).toBe('string');
      expect(mockSocksCreateConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          proxy: expect.objectContaining({
            userId: 'tor-user',
            password: 'tor-pass',
          }),
        })
      );
      expect(mockSocksProxyAgentConstruct).toHaveBeenCalledWith(
        'socks5://tor-user:tor-pass@127.0.0.1:9050'
      );
    });

    it('returns inconclusive result when torproject exit check responds non-ok', async () => {
      mockHttpsGet.mockImplementationOnce(
        httpsGetMock(503, JSON.stringify({ IsTor: true, IP: '8.8.8.8' }))
      );

      const response = await request(getAdminNodeConfigApp())
        .post('/api/v1/admin/proxy/test')
        .send({ host: '127.0.0.1', port: 9050 });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        isTorExit: false,
        exitIp: 'unknown',
      });
      expect(response.body.message).toContain('inconclusive');
    });

    it('rejects invalid proxy test field types before verification', async () => {
      const response = await request(getAdminNodeConfigApp())
        .post('/api/v1/admin/proxy/test')
        .send({
          host: '127.0.0.1',
          port: { toString: null },
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid proxy configuration');
      expect(mockSocksCreateConnection).not.toHaveBeenCalled();
    });
  });
}
