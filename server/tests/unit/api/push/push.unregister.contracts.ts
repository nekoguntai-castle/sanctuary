import { expect, it } from 'vitest';

import { app, mockDeleteByTokenForUser, request, validAndroidToken } from './pushTestHarness';

export function registerPushUnregisterContracts() {
  it('should unregister a device successfully', async () => {
    mockDeleteByTokenForUser.mockResolvedValue(1);

    const res = await request(app)
      .delete('/api/v1/push/unregister')
      .set('Authorization', 'Bearer test-token')
      .send({ token: validAndroidToken });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Device token removed');
    expect(mockDeleteByTokenForUser).toHaveBeenCalledWith(validAndroidToken, 'test-user-123');
  });

  it('should return success when token not found (idempotent)', async () => {
    mockDeleteByTokenForUser.mockResolvedValue(0);

    const res = await request(app)
      .delete('/api/v1/push/unregister')
      .set('Authorization', 'Bearer test-token')
      .send({ token: 'non-existent-token' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Device token removed');
    expect(mockDeleteByTokenForUser).toHaveBeenCalled();
  });

  it('should return success when device owned by different user', async () => {
    mockDeleteByTokenForUser.mockResolvedValue(0);

    const res = await request(app)
      .delete('/api/v1/push/unregister')
      .set('Authorization', 'Bearer test-token')
      .send({ token: validAndroidToken });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockDeleteByTokenForUser).toHaveBeenCalled();
  });

  it('keeps repeated unregister idempotent', async () => {
    mockDeleteByTokenForUser.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await request(app).delete('/api/v1/push/unregister')
        .set('Authorization', 'Bearer test-token').send({ token: validAndroidToken });
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    }
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
    mockDeleteByTokenForUser.mockRejectedValue(new Error('Database error'));

    const res = await request(app)
      .delete('/api/v1/push/unregister')
      .set('Authorization', 'Bearer test-token')
      .send({ token: validAndroidToken });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('An unexpected error occurred');
  });
}
