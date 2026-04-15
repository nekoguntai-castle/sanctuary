import { describe, expect, it } from 'vitest';
import request from 'supertest';

import {
  aiInternalRequest,
  createAiInternalApp,
  mockNotificationService,
} from './aiInternalTestHarness';

export function registerAiInternalNetworkContracts(): void {
  describe('IP Restriction Middleware', () => {
    describe('Allowed Private IP Ranges', () => {
      describe('10.x.x.x (Class A Private)', () => {
        it.each([
          '10.0.0.1',
          '10.0.0.255',
          '10.1.2.3',
          '10.255.255.255',
          '10.100.50.25',
        ])('should allow IP %s', async (ip) => {
          mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

          const res = await aiInternalRequest()
            .post('/internal/ai/pull-progress')
            .set('X-Forwarded-For', ip)
            .send({ model: 'llama2', status: 'downloading' });

          expect(res.status).not.toBe(403);
        });
      });

      describe('172.16-31.x.x (Class B Private)', () => {
        it.each([
          '172.16.0.1',
          '172.20.5.10',
          '172.31.255.255',
          '172.24.128.64',
        ])('should allow IP %s', async (ip) => {
          mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

          const res = await aiInternalRequest()
            .post('/internal/ai/pull-progress')
            .set('X-Forwarded-For', ip)
            .send({ model: 'llama2', status: 'downloading' });

          expect(res.status).not.toBe(403);
        });
      });

      describe('192.168.x.x (Class C Private)', () => {
        it.each([
          '192.168.0.1',
          '192.168.1.1',
          '192.168.100.200',
          '192.168.255.255',
        ])('should allow IP %s', async (ip) => {
          mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

          const res = await aiInternalRequest()
            .post('/internal/ai/pull-progress')
            .set('X-Forwarded-For', ip)
            .send({ model: 'llama2', status: 'downloading' });

          expect(res.status).not.toBe(403);
        });
      });

      describe('Localhost', () => {
        it.each([
          '127.0.0.1',
          '::1',
          'localhost',
        ])('should allow %s', async (ip) => {
          mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

          const res = await aiInternalRequest()
            .post('/internal/ai/pull-progress')
            .set('X-Forwarded-For', ip)
            .send({ model: 'llama2', status: 'downloading' });

          expect(res.status).not.toBe(403);
        });
      });

      describe('IPv6-mapped IPv4', () => {
        it.each([
          '::ffff:10.0.0.1',
          '::ffff:192.168.1.1',
          '::ffff:172.16.0.1',
          '::ffff:127.0.0.1',
        ])('should allow %s', async (ip) => {
          mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

          const res = await aiInternalRequest()
            .post('/internal/ai/pull-progress')
            .set('X-Forwarded-For', ip)
            .send({ model: 'llama2', status: 'downloading' });

          expect(res.status).not.toBe(403);
        });
      });
    });

    describe('Blocked Public IP Ranges', () => {
      it.each([
        '8.8.8.8',
        '1.1.1.1',
        '203.0.113.1',
        '104.16.0.1',
        '52.94.236.248',
        '172.15.255.255',
        '172.32.0.1',
        '192.167.1.1',
        '192.169.1.1',
        '11.0.0.1',
        '9.255.255.255',
      ])('should block public IP %s', async (ip) => {
        const res = await aiInternalRequest()
          .post('/internal/ai/pull-progress')
          .set('X-Forwarded-For', ip)
          .send({ model: 'llama2', status: 'downloading' });

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Access denied: internal endpoint');
      });
    });

    describe('Invalid IP Handling', () => {
      it.each([
        'invalid',
        '256.0.0.1',
        '10.0.0.256',
        '-1.0.0.1',
        '10.0.0',
        '10.0.0.1.1',
        'not-an-ip',
      ])('should block invalid IP format: %s', async (ip) => {
        const res = await aiInternalRequest()
          .post('/internal/ai/pull-progress')
          .set('X-Forwarded-For', ip)
          .send({ model: 'llama2', status: 'downloading' });

        expect(res.status).toBe(403);
      });
    });

    describe('X-Forwarded-For Header Handling', () => {
      it('should use first IP from X-Forwarded-For header', async () => {
        mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

        const res = await aiInternalRequest()
          .post('/internal/ai/pull-progress')
          .set('X-Forwarded-For', '192.168.1.1, 8.8.8.8')
          .send({ model: 'llama2', status: 'downloading' });

        expect(res.status).not.toBe(403);
      });

      it('should block when first IP in X-Forwarded-For is public', async () => {
        const res = await aiInternalRequest()
          .post('/internal/ai/pull-progress')
          .set('X-Forwarded-For', '8.8.8.8, 192.168.1.1')
          .send({ model: 'llama2', status: 'downloading' });

        expect(res.status).toBe(403);
      });

      it('should trim whitespace from X-Forwarded-For', async () => {
        mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

        const res = await aiInternalRequest()
          .post('/internal/ai/pull-progress')
          .set('X-Forwarded-For', '  192.168.1.1  , 8.8.8.8')
          .send({ model: 'llama2', status: 'downloading' });

        expect(res.status).not.toBe(403);
      });

      it('should use socket remoteAddress when X-Forwarded-For is missing', async () => {
        mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

        const res = await aiInternalRequest()
          .post('/internal/ai/pull-progress')
          .send({ model: 'llama2', status: 'downloading' });

        expect(res.status).not.toBe(403);
      });

      it('should use first IP when X-Forwarded-For is an array', async () => {
        mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

        const appWithArrayHeader = createAiInternalApp((testApp) => {
          testApp.use((req, _res, next) => {
            (req.headers as Record<string, unknown>)['x-forwarded-for'] = ['192.168.1.1', '8.8.8.8'];
            next();
          });
        });

        const res = await request(appWithArrayHeader)
          .post('/internal/ai/pull-progress')
          .send({ model: 'llama2', status: 'downloading' });

        expect(res.status).not.toBe(403);
      });

      it('should reject when socket remoteAddress is empty and no forwarded header exists', async () => {
        const appWithEmptyRemoteAddress = createAiInternalApp((testApp) => {
          testApp.use((req, _res, next) => {
            (req.headers as Record<string, unknown>)['x-forwarded-for'] = undefined;
            Object.defineProperty(req, 'socket', {
              value: { remoteAddress: '' },
              configurable: true,
            });
            next();
          });
        });

        const res = await request(appWithEmptyRemoteAddress)
          .post('/internal/ai/pull-progress')
          .send({ model: 'llama2', status: 'downloading' });

        expect(res.status).toBe(403);
      });
    });
  });
}
