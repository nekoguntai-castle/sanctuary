import { expect, it } from 'vitest';

import { app, mockUpsert, request, validAndroidToken, validIosToken } from './pushTestHarness';

export function registerPushRegisterSuccessContracts() {
  it('should register a new Android device successfully', async () => {
    const now = new Date();
    mockUpsert.mockResolvedValue({
      id: 'device-1',
      token: validAndroidToken,
      platform: 'android',
      userId: 'test-user-123',
      deviceName: 'Pixel 7',
      createdAt: now,
      lastUsedAt: now,
    });

    const res = await request(app)
      .post('/api/v1/push/register')
      .set('Authorization', 'Bearer test-token')
      .send({
        token: validAndroidToken,
        platform: 'android',
        deviceName: 'Pixel 7',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deviceId).toBe('device-1');
    expect(res.body.message).toBe('Device registered for push notifications');
    expect(mockUpsert).toHaveBeenCalledWith({
      token: validAndroidToken,
      userId: 'test-user-123',
      platform: 'android',
      deviceName: 'Pixel 7',
    });
  });

  it('should register a new iOS device successfully', async () => {
    const now = new Date();
    mockUpsert.mockResolvedValue({
      id: 'device-2',
      token: validIosToken,
      platform: 'ios',
      userId: 'test-user-123',
      deviceName: 'iPhone 15',
      createdAt: now,
      lastUsedAt: now,
    });

    const res = await request(app)
      .post('/api/v1/push/register')
      .set('Authorization', 'Bearer test-token')
      .send({
        token: validIosToken,
        platform: 'ios',
        deviceName: 'iPhone 15',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deviceId).toBe('device-2');
  });

  it('should accept APNs provider-style token format', async () => {
    const now = new Date();
    const providerToken = `${'a'.repeat(30)}.${'b'.repeat(33)}`; // 64 chars with dot

    mockUpsert.mockResolvedValue({
      id: 'device-3',
      token: providerToken,
      platform: 'ios',
      userId: 'test-user-123',
      deviceName: 'iPhone 15',
      createdAt: now,
      lastUsedAt: now,
    });

    const res = await request(app)
      .post('/api/v1/push/register')
      .set('Authorization', 'Bearer test-token')
      .send({
        token: providerToken,
        platform: 'ios',
        deviceName: 'iPhone 15',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockUpsert).toHaveBeenCalledWith({
      token: providerToken,
      userId: 'test-user-123',
      platform: 'ios',
      deviceName: 'iPhone 15',
    });
  });

  it('should update an existing device token', async () => {
    const createdAt = new Date('2024-01-01');
    const lastUsedAt = new Date(); // Different from createdAt = existing device
    mockUpsert.mockResolvedValue({
      id: 'device-1',
      token: validAndroidToken,
      platform: 'android',
      userId: 'test-user-123',
      deviceName: 'Pixel 7',
      createdAt,
      lastUsedAt,
    });

    const res = await request(app)
      .post('/api/v1/push/register')
      .set('Authorization', 'Bearer test-token')
      .send({
        token: validAndroidToken,
        platform: 'android',
      });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Device token updated');
  });
}
