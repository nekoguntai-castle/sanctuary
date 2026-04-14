import { expect, it } from 'vitest';

import { app, generateGatewaySignature, mockAuditLogCreate, request } from './pushTestHarness';

export function registerPushGatewayAuditErrorsContracts() {
  it('should return 400 when event is missing', async () => {
    const body = {
      category: 'auth',
    };

    const path = '/api/v1/push/gateway-audit';
    const { signature, timestamp } = generateGatewaySignature('POST', path, body, 'test-gateway-secret');

    const res = await request(app)
      .post('/api/v1/push/gateway-audit')
      .set('X-Gateway-Signature', signature)
      .set('X-Gateway-Timestamp', timestamp)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Event type is required');
  });

  it('should return 403 without gateway signature', async () => {
    const res = await request(app).post('/api/v1/push/gateway-audit').send({
      event: 'AUTH_SUCCESS',
    });

    expect(res.status).toBe(403);
  });

  it('should return 500 on service error', async () => {
    mockAuditLogCreate.mockRejectedValueOnce(new Error('Database error'));

    const body = {
      event: 'AUTH_SUCCESS',
    };

    const path = '/api/v1/push/gateway-audit';
    const { signature, timestamp } = generateGatewaySignature('POST', path, body, 'test-gateway-secret');

    const res = await request(app)
      .post('/api/v1/push/gateway-audit')
      .set('X-Gateway-Signature', signature)
      .set('X-Gateway-Timestamp', timestamp)
      .send(body);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('An unexpected error occurred');
  });
}
