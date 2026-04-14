import { expect, it } from 'vitest';

import { app, mockDeleteByToken, mockFindByToken, request, validAndroidToken } from './pushTestHarness';

export function registerPushUnregisterContracts() {
  it('should unregister a device successfully', async () => {
    mockFindByToken.mockResolvedValue({
      id: 'device-1',
      token: validAndroidToken,
      platform: 'android',
      userId: 'test-user-123',
    });
    mockDeleteByToken.mockResolvedValue(undefined);

    const res = await request(app)
      .delete('/api/v1/push/unregister')
      .set('Authorization', 'Bearer test-token')
      .send({ token: validAndroidToken });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Device token removed');
    expect(mockDeleteByToken).toHaveBeenCalledWith(validAndroidToken);
  });

  it('should return success when token not found (idempotent)', async () => {
    mockFindByToken.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/v1/push/unregister')
      .set('Authorization', 'Bearer test-token')
      .send({ token: 'non-existent-token' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Device token removed');
    expect(mockDeleteByToken).not.toHaveBeenCalled();
  });

  it('should return success when device owned by different user', async () => {
    mockFindByToken.mockResolvedValue({
      id: 'device-1',
      token: validAndroidToken,
      platform: 'android',
      userId: 'other-user',
    });

    const res = await request(app)
      .delete('/api/v1/push/unregister')
      .set('Authorization', 'Bearer test-token')
      .send({ token: validAndroidToken });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockDeleteByToken).not.toHaveBeenCalled();
  });

  it('should return 400 when token is missing', async () => {
    const res = await request(app)
      .delete('/api/v1/push/unregister')
      .set('Authorization', 'Bearer test-token')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Device token is required');
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).delete('/api/v1/push/unregister').send({ token: validAndroidToken });

    expect(res.status).toBe(401);
  });

  it('should return 500 on service error', async () => {
    mockFindByToken.mockRejectedValue(new Error('Database error'));

    const res = await request(app)
      .delete('/api/v1/push/unregister')
      .set('Authorization', 'Bearer test-token')
      .send({ token: validAndroidToken });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('An unexpected error occurred');
  });
}
