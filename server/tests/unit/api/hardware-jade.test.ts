import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../../src/errors/errorHandler';
import { ApiError, ErrorCodes } from '../../../src/errors/ApiError';
import { doubleCsrfProtection } from '../../../src/middleware/csrf';

const mocks = vi.hoisted(() => ({
  authenticated: true,
  relayJadePinRequest: vi.fn(),
}));

vi.mock('../../../src/middleware/auth', () => ({
  authenticate: (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!mocks.authenticated) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No authentication token provided',
      });
    }
    next();
  },
}));

vi.mock('../../../src/middleware/rateLimit', () => ({
  rateLimitByUser: () => (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => next(),
}));

vi.mock('../../../src/services/jadePinRelay', () => ({
  relayJadePinRequest: mocks.relayJadePinRequest,
}));

import hardwareRouter from '../../../src/api/hardware';

describe('POST /api/v1/hardware/jade/pin', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(cookieParser());
    app.use(doubleCsrfProtection);
    app.use('/api/v1/hardware', hardwareRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticated = true;
    mocks.relayJadePinRequest.mockResolvedValue({ pin: 'oracle-reply' });
  });

  it('requires application authentication before invoking the relay', async () => {
    mocks.authenticated = false;

    const response = await request(app)
      .post('/api/v1/hardware/jade/pin')
      .set('Authorization', 'Bearer test-token')
      .send({ operation: 'get_pin', data: {} });

    expect(response.status).toBe(401);
    expect(mocks.relayJadePinRequest).not.toHaveBeenCalled();
  });

  it('requires CSRF for cookie-authenticated mutation requests', async () => {
    const response = await request(app)
      .post('/api/v1/hardware/jade/pin')
      .set('Cookie', ['sanctuary_access=cookie-token'])
      .send({ operation: 'get_pin', data: {} });

    expect(response.status).toBe(403);
    expect(mocks.relayJadePinRequest).not.toHaveBeenCalled();
  });

  it.each(['get_pin', 'set_pin'] as const)('relays the strict %s operation and returns only JSON', async operation => {
    const data = { blinded: ['opaque', 1, true, null] };

    const response = await request(app)
      .post('/api/v1/hardware/jade/pin')
      .set('Authorization', 'Bearer test-token')
      .send({ operation, data });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ pin: 'oracle-reply' });
    expect(mocks.relayJadePinRequest).toHaveBeenCalledWith({ operation, data });
  });

  it('surfaces upstream relay failures as a body-safe service-unavailable response', async () => {
    mocks.relayJadePinRequest.mockRejectedValueOnce(new ApiError(
      'Jade PIN service unavailable',
      503,
      ErrorCodes.SERVICE_UNAVAILABLE,
      { category: 'network', correlationId: 'safe-correlation-id' },
      true,
    ));

    const response = await request(app)
      .post('/api/v1/hardware/jade/pin')
      .set('Authorization', 'Bearer test-token')
      .send({ operation: 'get_pin', data: { secretMaterial: 'must-not-echo' } });

    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('must-not-echo');
  });

  it.each([
    {},
    { operation: 'get_pin' },
    { data: {} },
    { operation: 'delete_pin', data: {} },
    { operation: 'get_pin', data: undefined },
    { operation: 'get_pin', data: {}, url: 'https://attacker.invalid/private' },
  ])('rejects a malformed or URL-bearing request before the relay: %j', async body => {
    const response = await request(app)
      .post('/api/v1/hardware/jade/pin')
      .set('Authorization', 'Bearer test-token')
      .send(body);

    expect(response.status).toBe(400);
    expect(mocks.relayJadePinRequest).not.toHaveBeenCalled();
  });

  it('rejects an oversized JSON envelope without exposing parser details', async () => {
    const response = await request(app)
      .post('/api/v1/hardware/jade/pin')
      .set('Authorization', 'Bearer test-token')
      .send({ operation: 'get_pin', data: 'x'.repeat(20 * 1024 + 1) });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Invalid Jade PIN relay request');
    expect(mocks.relayJadePinRequest).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON without exposing parser details', async () => {
    const response = await request(app)
      .post('/api/v1/hardware/jade/pin')
      .set('Authorization', 'Bearer test-token')
      .set('Content-Type', 'application/json')
      .send('{"operation":');

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Invalid Jade PIN relay request');
    expect(mocks.relayJadePinRequest).not.toHaveBeenCalled();
  });
});
