import { createHmac } from 'crypto';
import { expect, it } from 'vitest';

import { app, generateGatewaySignature, mockFindByUserId, request } from './pushTestHarness';

export function registerPushGatewayByUserContracts() {
  it('should return devices for a user with valid gateway signature', async () => {
    mockFindByUserId.mockResolvedValue([
      {
        id: 'device-1',
        platform: 'android',
        token: 'fcm-token-123',
        userId: 'user-456',
      },
    ]);

    const path = '/api/v1/push/by-user/user-456';
    const { signature, timestamp } = generateGatewaySignature('GET', path, null, 'test-gateway-secret');

    const res = await request(app)
      .get('/api/v1/push/by-user/user-456')
      .set('X-Gateway-Signature', signature)
      .set('X-Gateway-Timestamp', timestamp);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: 'device-1',
        platform: 'android',
        pushToken: 'fcm-token-123',
        userId: 'user-456',
      },
    ]);
  });

  it('should return 403 without gateway signature headers', async () => {
    const res = await request(app).get('/api/v1/push/by-user/user-456');

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Missing gateway authentication headers');
  });

  it('should return 403 with expired timestamp', async () => {
    const expiredTimestamp = (Date.now() - 10 * 60 * 1000).toString(); // 10 minutes ago
    const path = '/api/v1/push/by-user/user-456';
    const message = `GET${path}${expiredTimestamp}`;
    const signature = createHmac('sha256', 'test-gateway-secret').update(message).digest('hex');

    const res = await request(app)
      .get('/api/v1/push/by-user/user-456')
      .set('X-Gateway-Signature', signature)
      .set('X-Gateway-Timestamp', expiredTimestamp);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Request timestamp expired or invalid');
  });

  it('should return 403 with invalid signature', async () => {
    const timestamp = Date.now().toString();
    const invalidSignature = 'invalid-signature-hash';

    const res = await request(app)
      .get('/api/v1/push/by-user/user-456')
      .set('X-Gateway-Signature', invalidSignature)
      .set('X-Gateway-Timestamp', timestamp);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Invalid gateway signature');
  });

  it('should return 500 on service error', async () => {
    mockFindByUserId.mockRejectedValue(new Error('Database error'));

    const path = '/api/v1/push/by-user/user-456';
    const { signature, timestamp } = generateGatewaySignature('GET', path, null, 'test-gateway-secret');

    const res = await request(app)
      .get('/api/v1/push/by-user/user-456')
      .set('X-Gateway-Signature', signature)
      .set('X-Gateway-Timestamp', timestamp);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('An unexpected error occurred');
  });
}
