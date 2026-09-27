import { expect, it } from 'vitest';

import { app, mockDeleteByIdForUser, request } from './pushTestHarness';

export function registerPushDeviceDeleteContracts() {
  it('should delete a specific device', async () => {
    mockDeleteByIdForUser.mockResolvedValue(1);

    const res = await request(app)
      .delete('/api/v1/push/devices/device-1')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Device removed');
    expect(mockDeleteByIdForUser).toHaveBeenCalledWith('device-1', 'test-user-123');
  });

  it('should return 404 when device not found', async () => {
    mockDeleteByIdForUser.mockResolvedValue(0);

    const res = await request(app)
      .delete('/api/v1/push/devices/non-existent')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.message).toBe('Device not found');
  });

  it('should return 404 when device owned by different user', async () => {
    mockDeleteByIdForUser.mockResolvedValue(0);

    const res = await request(app)
      .delete('/api/v1/push/devices/device-1')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Device not found');
    expect(mockDeleteByIdForUser).toHaveBeenCalled();
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).delete('/api/v1/push/devices/device-1');

    expect(res.status).toBe(401);
  });

  it('should return 500 on service error', async () => {
    mockDeleteByIdForUser.mockRejectedValue(new Error('Database error'));

    const res = await request(app)
      .delete('/api/v1/push/devices/device-1')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('An unexpected error occurred');
  });
}
