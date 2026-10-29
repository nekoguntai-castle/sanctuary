import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import { mockPrismaClient } from '../../../mocks/prisma';
import {
  buildNodeConfig,
  getAdminNodeConfigApp,
  httpsGetMock,
  mockDecrypt,
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

    describe('masked stored password', () => {
      const storedProxy = (overrides: Record<string, unknown> = {}) =>
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(buildNodeConfig({
          proxyEnabled: true,
          proxyHost: '127.0.0.1',
          proxyPort: 9050,
          proxyUsername: 'tor-user',
          proxyPassword: 'enc:tor-pass',
          ...overrides,
        }) as any);

      const verify = (body: Record<string, unknown>) =>
        request(getAdminNodeConfigApp()).post('/api/v1/admin/proxy/test').send(body);

      it('substitutes the stored password for the mask on the stored proxy', async () => {
        storedProxy();

        const response = await verify({
          host: '127.0.0.1', port: 9050, username: 'tor-user', password: '********',
        });

        expect(response.status).toBe(200);
        expect(mockDecrypt).toHaveBeenCalledWith('enc:tor-pass');
        expect(mockSocksCreateConnection).toHaveBeenCalledWith(
          expect.objectContaining({ proxy: expect.objectContaining({ password: 'tor-pass' }) })
        );
        expect(mockSocksProxyAgentConstruct).toHaveBeenCalledWith(
          'socks5://tor-user:tor-pass@127.0.0.1:9050'
        );
      });

      it('matches the host case-insensitively and the port as a string', async () => {
        storedProxy({ proxyHost: 'Tor.Example.com' });

        const response = await verify({
          host: 'tor.example.COM', port: '9050', username: 'tor-user', password: '********',
        });

        expect(response.status).toBe(200);
        expect(mockSocksCreateConnection).toHaveBeenCalledWith(
          expect.objectContaining({ proxy: expect.objectContaining({ password: 'tor-pass' }) })
        );
      });

      it('treats a missing username as empty when the stored one is empty', async () => {
        storedProxy({ proxyUsername: null });

        const response = await verify({ host: '127.0.0.1', port: 9050, password: '********' });

        expect(response.status).toBe(200);
        expect(mockDecrypt).toHaveBeenCalledWith('enc:tor-pass');
      });

      // GET /admin/node-config returns proxyUsername: null for a proxy saved
      // without one (bundled Tor), and Node Config sends it back as-is.
      it('accepts the null username a reloaded Node Config sends for the stored proxy', async () => {
        storedProxy({ proxyUsername: null });

        const response = await verify({
          host: '127.0.0.1', port: 9050, username: null, password: '********',
        });

        expect(response.status).toBe(200);
        expect(mockDecrypt).toHaveBeenCalledWith('enc:tor-pass');
      });

      it('accepts a null username and password for a proxy without credentials', async () => {
        const response = await verify({ host: '127.0.0.1', port: 9050, username: null, password: null });

        expect(response.status).toBe(200);
        expect(mockSocksCreateConnection).toHaveBeenCalledWith(
          expect.objectContaining({ proxy: expect.not.objectContaining({ userId: expect.anything() }) })
        );
      });

      it.each([
        ['a different host', { host: 'evil.example.com', port: 9050, username: 'tor-user' }],
        ['a different port', { host: '127.0.0.1', port: 9999, username: 'tor-user' }],
        ['a different username', { host: '127.0.0.1', port: 9050, username: 'other' }],
      ])('rejects the mask sent with %s without replaying the stored secret', async (_label, target) => {
        storedProxy();

        const response = await verify({ ...target, password: '********' });

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('Re-enter the proxy password');
        expect(mockDecrypt).not.toHaveBeenCalled();
        expect(mockSocksCreateConnection).not.toHaveBeenCalled();
      });

      it('rejects the mask when no password is stored', async () => {
        storedProxy({ proxyPassword: null });

        const response = await verify({
          host: '127.0.0.1', port: 9050, username: 'tor-user', password: '********',
        });

        expect(response.status).toBe(400);
        expect(mockSocksCreateConnection).not.toHaveBeenCalled();
      });

      it('rejects the mask when there is no stored config', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(null);

        const response = await verify({
          host: '127.0.0.1', port: 9050, username: 'tor-user', password: '********',
        });

        expect(response.status).toBe(400);
      });

      it('rejects with a re-enter prompt when the stored password cannot be decrypted', async () => {
        storedProxy();
        mockDecrypt.mockImplementationOnce(() => { throw new Error('bad ciphertext'); });

        const response = await verify({
          host: '127.0.0.1', port: 9050, username: 'tor-user', password: '********',
        });

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('Re-enter the proxy password');
        expect(mockLogWarn).toHaveBeenCalledWith(
          'Stored proxy password cannot be decrypted',
          { error: 'bad ciphertext' }
        );
        expect(mockSocksCreateConnection).not.toHaveBeenCalled();
      });
    });

    it('URL-encodes credentials containing reserved characters', async () => {
      const response = await request(getAdminNodeConfigApp())
        .post('/api/v1/admin/proxy/test')
        .send({ host: '127.0.0.1', port: 9050, username: 'us@er', password: 'p@ss:w/rd' });

      expect(response.status).toBe(200);
      expect(mockSocksProxyAgentConstruct).toHaveBeenCalledWith(
        'socks5://us%40er:p%40ss%3Aw%2Frd@127.0.0.1:9050'
      );
      expect(mockSocksCreateConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          proxy: expect.objectContaining({ userId: 'us@er', password: 'p@ss:w/rd' }),
        })
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
