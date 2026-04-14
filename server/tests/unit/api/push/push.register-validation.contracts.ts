import { expect, it } from 'vitest';

import { app, mockUpsert, request, validAndroidToken } from './pushTestHarness';

export function registerPushRegisterValidationContracts() {
  it('should return 400 when token is missing', async () => {
    const res = await request(app)
      .post('/api/v1/push/register')
      .set('Authorization', 'Bearer test-token')
      .send({
        platform: 'android',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_INPUT');
    expect(res.body.message).toBe('Device token is required');
  });

  it('should return 400 when platform is missing', async () => {
    const res = await request(app)
      .post('/api/v1/push/register')
      .set('Authorization', 'Bearer test-token')
      .send({
        token: validAndroidToken,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_INPUT');
    expect(res.body.message).toBe('Platform must be "ios" or "android"');
  });

  it('should return 400 for invalid platform', async () => {
    const res = await request(app)
      .post('/api/v1/push/register')
      .set('Authorization', 'Bearer test-token')
      .send({
        token: validAndroidToken,
        platform: 'windows',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Platform must be "ios" or "android"');
  });

  it('should return 400 for FCM token that is too short', async () => {
    const res = await request(app)
      .post('/api/v1/push/register')
      .set('Authorization', 'Bearer test-token')
      .send({
        token: 'short-token',
        platform: 'android',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('FCM token appears too short');
  });

  it('should return 400 for FCM token that is too long', async () => {
    const res = await request(app)
      .post('/api/v1/push/register')
      .set('Authorization', 'Bearer test-token')
      .send({
        token: 'a'.repeat(501),
        platform: 'android',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('FCM token appears too long');
  });

  it('should return 400 for FCM token with invalid characters', async () => {
    const res = await request(app)
      .post('/api/v1/push/register')
      .set('Authorization', 'Bearer test-token')
      .send({
        token: 'a'.repeat(100) + '!@#$%',
        platform: 'android',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('FCM token contains invalid characters');
  });

  it('should return 400 for APNs token that is too short', async () => {
    const res = await request(app)
      .post('/api/v1/push/register')
      .set('Authorization', 'Bearer test-token')
      .send({
        token: 'a'.repeat(50),
        platform: 'ios',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('APNs token appears too short');
  });

  it('should return 400 for APNs token that is too long', async () => {
    const res = await request(app)
      .post('/api/v1/push/register')
      .set('Authorization', 'Bearer test-token')
      .send({
        token: 'a'.repeat(501),
        platform: 'ios',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('APNs token appears too long');
  });

  it('should return 400 for APNs token with invalid characters', async () => {
    const res = await request(app)
      .post('/api/v1/push/register')
      .set('Authorization', 'Bearer test-token')
      .send({
        token: 'g'.repeat(64) + '!@#', // 'g' is not valid hex
        platform: 'ios',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('APNs token contains invalid characters');
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).post('/api/v1/push/register').send({
      token: validAndroidToken,
      platform: 'android',
    });

    expect(res.status).toBe(401);
  });

  it('should return 500 on service error', async () => {
    mockUpsert.mockRejectedValue(new Error('Database error'));

    const res = await request(app)
      .post('/api/v1/push/register')
      .set('Authorization', 'Bearer test-token')
      .send({
        token: validAndroidToken,
        platform: 'android',
      });

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    expect(res.body.message).toBe('An unexpected error occurred');
  });
}
