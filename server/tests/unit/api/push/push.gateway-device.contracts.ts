import { expect, it } from 'vitest';

import { app, generateGatewaySignature, mockDeleteById, mockFindById, request } from './pushTestHarness';

export function registerPushGatewayDeviceContracts() {
  it('should delete a device with valid gateway signature', async () => {
    mockFindById.mockResolvedValue({
      id: 'device-1',
      platform: 'android',
      userId: 'user-456',
    });
    mockDeleteById.mockResolvedValue(undefined);

    const path = '/api/v1/push/device/device-1';
    const { signature, timestamp } = generateGatewaySignature('DELETE', path, null, 'test-gateway-secret');

    const res = await request(app)
      .delete('/api/v1/push/device/device-1')
      .set('X-Gateway-Signature', signature)
      .set('X-Gateway-Timestamp', timestamp);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Device removed');
  });

  it('should return success when device not found (idempotent)', async () => {
    mockFindById.mockResolvedValue(null);

    const path = '/api/v1/push/device/non-existent';
    const { signature, timestamp } = generateGatewaySignature('DELETE', path, null, 'test-gateway-secret');

    const res = await request(app)
      .delete('/api/v1/push/device/non-existent')
      .set('X-Gateway-Signature', signature)
      .set('X-Gateway-Timestamp', timestamp);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Device not found or already removed');
  });

  it('should return 403 without gateway signature', async () => {
    const res = await request(app).delete('/api/v1/push/device/device-1');

    expect(res.status).toBe(403);
  });

  it('should return 500 on service error', async () => {
    mockFindById.mockRejectedValue(new Error('Database error'));

    const path = '/api/v1/push/device/device-1';
    const { signature, timestamp } = generateGatewaySignature('DELETE', path, null, 'test-gateway-secret');

    const res = await request(app)
      .delete('/api/v1/push/device/device-1')
      .set('X-Gateway-Signature', signature)
      .set('X-Gateway-Timestamp', timestamp);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('An unexpected error occurred');
  });
}
