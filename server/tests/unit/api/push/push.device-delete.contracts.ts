import { expect, it } from 'vitest';

import { app, mockDeleteById, mockFindById, request } from './pushTestHarness';

export function registerPushDeviceDeleteContracts() {
  it('should delete a specific device', async () => {
    mockFindById.mockResolvedValue({
      id: 'device-1',
      platform: 'android',
      userId: 'test-user-123',
    });
    mockDeleteById.mockResolvedValue(undefined);

    const res = await request(app)
      .delete('/api/v1/push/devices/device-1')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Device removed');
    expect(mockDeleteById).toHaveBeenCalledWith('device-1');
  });

  it('should return 404 when device not found', async () => {
    mockFindById.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/v1/push/devices/non-existent')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.message).toBe('Device not found');
  });

  it('should return 404 when device owned by different user', async () => {
    mockFindById.mockResolvedValue({
      id: 'device-1',
      platform: 'android',
      userId: 'other-user',
    });

    const res = await request(app)
      .delete('/api/v1/push/devices/device-1')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Device not found');
    expect(mockDeleteById).not.toHaveBeenCalled();
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).delete('/api/v1/push/devices/device-1');

    expect(res.status).toBe(401);
  });

  it('should return 500 on service error', async () => {
    mockFindById.mockRejectedValue(new Error('Database error'));

    const res = await request(app)
      .delete('/api/v1/push/devices/device-1')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('An unexpected error occurred');
  });
}
