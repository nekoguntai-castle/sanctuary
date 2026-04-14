import { expect, it } from 'vitest';

import { app, mockFindByUserId, request } from './pushTestHarness';

export function registerPushDevicesListContracts() {
  it('should return list of user devices', async () => {
    const now = new Date();
    mockFindByUserId.mockResolvedValue([
      {
        id: 'device-1',
        platform: 'android',
        deviceName: 'Pixel 7',
        lastUsedAt: now,
        createdAt: now,
      },
      {
        id: 'device-2',
        platform: 'ios',
        deviceName: 'iPhone 15',
        lastUsedAt: now,
        createdAt: now,
      },
    ]);

    const res = await request(app)
      .get('/api/v1/push/devices')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(200);
    expect(res.body.devices).toHaveLength(2);
    expect(res.body.devices[0]).toEqual({
      id: 'device-1',
      platform: 'android',
      deviceName: 'Pixel 7',
      lastUsedAt: now.toISOString(),
      createdAt: now.toISOString(),
    });
  });

  it('should return empty array when no devices', async () => {
    mockFindByUserId.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/push/devices')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(200);
    expect(res.body.devices).toEqual([]);
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).get('/api/v1/push/devices');

    expect(res.status).toBe(401);
  });

  it('should return 500 on service error', async () => {
    mockFindByUserId.mockRejectedValue(new Error('Database error'));

    const res = await request(app)
      .get('/api/v1/push/devices')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('An unexpected error occurred');
  });
}
