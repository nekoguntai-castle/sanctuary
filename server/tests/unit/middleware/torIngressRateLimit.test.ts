import express, { type Request } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';

let getClientIp: (req: Request) => string;

beforeAll(async () => {
  ({ getClientIp } = await vi.importActual<typeof import('../../../src/middleware/rateLimit')>(
    '../../../src/middleware/rateLimit'
  ));
});

function createIpProbe() {
  const app = express();
  app.set('trust proxy', 1);
  app.use((req, _res, next) => {
    Object.defineProperty(req.socket, 'remoteAddress', {
      configurable: true,
      value: '172.20.0.9',
    });
    next();
  });
  app.get('/ip', (req, res) => res.json({ ip: getClientIp(req) }));
  return app;
}

describe('Tor ingress rate-limit identity', () => {
  it('would trust a direct client-controlled forwarded address', async () => {
    const response = await request(createIpProbe())
      .get('/ip')
      .set('X-Forwarded-For', '198.51.100.24');

    expect(response.body).toEqual({ ip: '198.51.100.24' });
  });

  it('uses the ingress peer after forwarded identity is overwritten', async () => {
    const response = await request(createIpProbe())
      .get('/ip')
      .set('X-Forwarded-For', '172.20.0.9');

    expect(response.body).toEqual({ ip: '172.20.0.9' });
    expect(response.body.ip).not.toBe('198.51.100.24');
  });
});
