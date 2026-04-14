import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import { mockPrismaClient } from '../../../mocks/prisma';
import { app } from './devicesTestHarness';

export function registerDeviceSharingTests(): void {
  // ========================================
  // Device Sharing Routes
  // ========================================

  describe('GET /devices/:id/share - Sharing Info', () => {
    it('should return device sharing info', async () => {
      const { getDeviceShareInfo } = await import('../../../../src/services/deviceAccess');
      const mockGetDeviceShareInfo = vi.mocked(getDeviceShareInfo);

      mockGetDeviceShareInfo.mockResolvedValue({
        deviceId: 'device-1',
        owner: { id: 'test-user-id', username: 'testuser' },
        sharedUsers: [
          { id: 'user-2', username: 'otheruser', role: 'viewer' },
        ],
        group: null,
      });

      const response = await request(app)
        .get('/api/v1/devices/device-1/share');

      expect(response.status).toBe(200);
      expect(response.body.deviceId).toBe('device-1');
      expect(response.body.owner.username).toBe('testuser');
      expect(response.body.sharedUsers).toHaveLength(1);
      expect(mockGetDeviceShareInfo).toHaveBeenCalledWith('device-1');
    });

    it('should include group info when device is shared with group', async () => {
      const { getDeviceShareInfo } = await import('../../../../src/services/deviceAccess');
      const mockGetDeviceShareInfo = vi.mocked(getDeviceShareInfo);

      mockGetDeviceShareInfo.mockResolvedValue({
        deviceId: 'device-1',
        owner: { id: 'test-user-id', username: 'testuser' },
        sharedUsers: [],
        group: { id: 'group-1', name: 'Family Group' },
      });

      const response = await request(app)
        .get('/api/v1/devices/device-1/share');

      expect(response.status).toBe(200);
      expect(response.body.group).toBeDefined();
      expect(response.body.group.name).toBe('Family Group');
    });

    it('should handle service errors gracefully', async () => {
      const { getDeviceShareInfo } = await import('../../../../src/services/deviceAccess');
      const mockGetDeviceShareInfo = vi.mocked(getDeviceShareInfo);

      mockGetDeviceShareInfo.mockRejectedValue(new Error('Service error'));

      const response = await request(app)
        .get('/api/v1/devices/device-1/share');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /devices/:id/share/user - Share with User', () => {
    it('should share device with another user', async () => {
      const { shareDeviceWithUser } = await import('../../../../src/services/deviceAccess');
      const mockShareDeviceWithUser = vi.mocked(shareDeviceWithUser);

      mockShareDeviceWithUser.mockResolvedValue({
        success: true,
        message: 'Device shared successfully',
      });

      const response = await request(app)
        .post('/api/v1/devices/device-1/share/user')
        .send({ targetUserId: 'user-2' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockShareDeviceWithUser).toHaveBeenCalledWith('device-1', 'user-2', 'test-user-id');
    });

    it('should reject when targetUserId is missing', async () => {
      const response = await request(app)
        .post('/api/v1/devices/device-1/share/user')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_INPUT');
      expect(response.body.message).toContain('targetUserId');
    });

    it('should return 400 when service returns failure', async () => {
      const { shareDeviceWithUser } = await import('../../../../src/services/deviceAccess');
      const mockShareDeviceWithUser = vi.mocked(shareDeviceWithUser);

      mockShareDeviceWithUser.mockResolvedValue({
        success: false,
        message: 'User not found',
      });

      const response = await request(app)
        .post('/api/v1/devices/device-1/share/user')
        .send({ targetUserId: 'non-existent-user' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('User not found');
    });

    it('should handle service errors gracefully', async () => {
      const { shareDeviceWithUser } = await import('../../../../src/services/deviceAccess');
      const mockShareDeviceWithUser = vi.mocked(shareDeviceWithUser);

      mockShareDeviceWithUser.mockRejectedValue(new Error('Service error'));

      const response = await request(app)
        .post('/api/v1/devices/device-1/share/user')
        .send({ targetUserId: 'user-2' });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('DELETE /devices/:id/share/user/:targetUserId - Remove User Access', () => {
    it('should remove user access to device', async () => {
      const { removeUserFromDevice } = await import('../../../../src/services/deviceAccess');
      const mockRemoveUserFromDevice = vi.mocked(removeUserFromDevice);

      mockRemoveUserFromDevice.mockResolvedValue({
        success: true,
        message: 'User access removed',
      });

      const response = await request(app)
        .delete('/api/v1/devices/device-1/share/user/user-2');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockRemoveUserFromDevice).toHaveBeenCalledWith('device-1', 'user-2', 'test-user-id');
    });

    it('should return 400 when service returns failure', async () => {
      const { removeUserFromDevice } = await import('../../../../src/services/deviceAccess');
      const mockRemoveUserFromDevice = vi.mocked(removeUserFromDevice);

      mockRemoveUserFromDevice.mockResolvedValue({
        success: false,
        message: 'Cannot remove owner',
      });

      const response = await request(app)
        .delete('/api/v1/devices/device-1/share/user/owner-user');

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Cannot remove owner');
    });

    it('should handle service errors gracefully', async () => {
      const { removeUserFromDevice } = await import('../../../../src/services/deviceAccess');
      const mockRemoveUserFromDevice = vi.mocked(removeUserFromDevice);

      mockRemoveUserFromDevice.mockRejectedValue(new Error('Service error'));

      const response = await request(app)
        .delete('/api/v1/devices/device-1/share/user/user-2');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /devices/:id/share/group - Share with Group', () => {
    it('should share device with a group', async () => {
      const { shareDeviceWithGroup } = await import('../../../../src/services/deviceAccess');
      const mockShareDeviceWithGroup = vi.mocked(shareDeviceWithGroup);

      mockShareDeviceWithGroup.mockResolvedValue({
        success: true,
        message: 'Device shared with group',
      });

      const response = await request(app)
        .post('/api/v1/devices/device-1/share/group')
        .send({ groupId: 'group-1' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockShareDeviceWithGroup).toHaveBeenCalledWith('device-1', 'group-1', 'test-user-id');
    });

    it('should remove group access when groupId is null', async () => {
      const { shareDeviceWithGroup } = await import('../../../../src/services/deviceAccess');
      const mockShareDeviceWithGroup = vi.mocked(shareDeviceWithGroup);

      mockShareDeviceWithGroup.mockResolvedValue({
        success: true,
        message: 'Group access removed',
      });

      const response = await request(app)
        .post('/api/v1/devices/device-1/share/group')
        .send({ groupId: null });

      expect(response.status).toBe(200);
      expect(mockShareDeviceWithGroup).toHaveBeenCalledWith('device-1', null, 'test-user-id');
    });

    it('should return 400 when service returns failure', async () => {
      const { shareDeviceWithGroup } = await import('../../../../src/services/deviceAccess');
      const mockShareDeviceWithGroup = vi.mocked(shareDeviceWithGroup);

      mockShareDeviceWithGroup.mockResolvedValue({
        success: false,
        message: 'Group not found',
      });

      const response = await request(app)
        .post('/api/v1/devices/device-1/share/group')
        .send({ groupId: 'non-existent-group' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Group not found');
    });

    it('should handle service errors gracefully', async () => {
      const { shareDeviceWithGroup } = await import('../../../../src/services/deviceAccess');
      const mockShareDeviceWithGroup = vi.mocked(shareDeviceWithGroup);

      mockShareDeviceWithGroup.mockRejectedValue(new Error('Service error'));

      const response = await request(app)
        .post('/api/v1/devices/device-1/share/group')
        .send({ groupId: 'group-1' });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });
}
