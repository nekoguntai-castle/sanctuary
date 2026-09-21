/**
 * Device Sharing Routes Unit Tests
 *
 * Tests for device sharing API endpoints:
 * - GET /:id/share (get sharing info)
 * - POST /:id/share/user (share with user)
 * - DELETE /:id/share/user/:targetUserId (remove user)
 * - POST /:id/share/group (share with group)
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { errorHandler } from '../../../src/errors/errorHandler';
import { ForbiddenError } from '../../../src/errors/ApiError';

const {
  mockGetDeviceShareInfo,
  mockShareDeviceWithUser,
  mockRemoveUserFromDevice,
  mockShareDeviceWithGroup,
} = vi.hoisted(() => ({
  mockGetDeviceShareInfo: vi.fn(),
  mockShareDeviceWithUser: vi.fn(),
  mockRemoveUserFromDevice: vi.fn(),
  mockShareDeviceWithGroup: vi.fn(),
}));

vi.mock('../../../src/middleware/deviceAccess', () => ({
  requireDeviceAccess: () => (req: any, _res: any, next: () => void) => {
    req.user = { userId: 'owner-1', username: 'owner' };
    req.deviceId = req.params.id;
    next();
  },
}));

vi.mock('../../../src/services/deviceAccess', () => ({
  getDeviceShareInfo: mockGetDeviceShareInfo,
  shareDeviceWithUser: mockShareDeviceWithUser,
  removeUserFromDevice: mockRemoveUserFromDevice,
  shareDeviceWithGroup: mockShareDeviceWithGroup,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import sharingRouter from '../../../src/api/devices/sharing';

describe('Device Sharing Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/devices', sharingRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =============================================
  // GET /:id/share
  // =============================================

  describe('GET /:id/share', () => {
    it('returns sharing info with group and users', async () => {
      mockGetDeviceShareInfo.mockResolvedValue({
        group: { id: 'group-1', name: 'Team A' },
        users: [
          { id: 'owner-1', username: 'owner', role: 'owner' },
          { id: 'user-1', username: 'alice', role: 'viewer' },
        ],
      });

      const response = await request(app).get('/api/v1/devices/device-1/share');

      expect(response.status).toBe(200);
      expect(mockGetDeviceShareInfo).toHaveBeenCalledWith('device-1');
      expect(response.body.group).toEqual({ id: 'group-1', name: 'Team A' });
      expect(response.body.users).toHaveLength(2);
    });

    it('returns empty sharing info when no shares exist', async () => {
      mockGetDeviceShareInfo.mockResolvedValue({
        group: null,
        users: [{ id: 'owner-1', username: 'owner', role: 'owner' }],
      });

      const response = await request(app).get('/api/v1/devices/device-1/share');

      expect(response.status).toBe(200);
      expect(response.body.group).toBeNull();
      expect(response.body.users).toHaveLength(1);
    });

    it('returns 500 when service throws', async () => {
      mockGetDeviceShareInfo.mockRejectedValue(new Error('db error'));

      const response = await request(app).get('/api/v1/devices/device-1/share');

      expect(response.status).toBe(500);
    });
  });

  // =============================================
  // POST /:id/share/user
  // =============================================

  describe('POST /:id/share/user', () => {
    it('requires targetUserId', async () => {
      const response = await request(app)
        .post('/api/v1/devices/device-1/share/user')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('targetUserId is required');
    });

    it('shares device with user successfully', async () => {
      mockShareDeviceWithUser.mockResolvedValue({
        success: true,
        message: 'Device shared successfully',
      });

      const response = await request(app)
        .post('/api/v1/devices/device-1/share/user')
        .send({ targetUserId: 'user-1' });

      expect(response.status).toBe(200);
      expect(mockShareDeviceWithUser).toHaveBeenCalledWith('device-1', 'user-1', 'owner-1');
      expect(response.body.success).toBe(true);
    });

    it('returns 400 when user not found', async () => {
      mockShareDeviceWithUser.mockResolvedValue({
        success: false,
        message: 'User not found',
      });

      const response = await request(app)
        .post('/api/v1/devices/device-1/share/user')
        .send({ targetUserId: 'nonexistent' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('User not found');
    });

    it('returns 400 when device already shared', async () => {
      mockShareDeviceWithUser.mockResolvedValue({
        success: false,
        message: 'Device already shared with this user',
      });

      const response = await request(app)
        .post('/api/v1/devices/device-1/share/user')
        .send({ targetUserId: 'user-1' });

      // Note: the route treats success:false with "already shared" differently
      // Looking at the source - it returns success:true for already shared
      // But if the service says success:false, it throws InvalidInputError
      expect(response.status).toBe(400);
    });

    it('returns 500 when service throws', async () => {
      mockShareDeviceWithUser.mockRejectedValue(new Error('db error'));

      const response = await request(app)
        .post('/api/v1/devices/device-1/share/user')
        .send({ targetUserId: 'user-1' });

      expect(response.status).toBe(500);
    });
  });

  // =============================================
  // DELETE /:id/share/user/:targetUserId
  // =============================================

  describe('DELETE /:id/share/user/:targetUserId', () => {
    it('removes user from device successfully', async () => {
      mockRemoveUserFromDevice.mockResolvedValue({
        success: true,
        message: 'User access removed',
      });

      const response = await request(app)
        .delete('/api/v1/devices/device-1/share/user/user-1');

      expect(response.status).toBe(200);
      expect(mockRemoveUserFromDevice).toHaveBeenCalledWith('device-1', 'user-1', 'owner-1');
      expect(response.body.success).toBe(true);
    });

    it('returns 400 when user has no access', async () => {
      mockRemoveUserFromDevice.mockResolvedValue({
        success: false,
        message: 'User does not have access to this device',
      });

      const response = await request(app)
        .delete('/api/v1/devices/device-1/share/user/user-1');

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('User does not have access to this device');
    });

    it('returns 400 when trying to remove device owner', async () => {
      mockRemoveUserFromDevice.mockResolvedValue({
        success: false,
        message: 'Cannot remove device owner',
      });

      const response = await request(app)
        .delete('/api/v1/devices/device-1/share/user/owner-1');

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Cannot remove device owner');
    });

    it('returns 500 when service throws', async () => {
      mockRemoveUserFromDevice.mockRejectedValue(new Error('db error'));

      const response = await request(app)
        .delete('/api/v1/devices/device-1/share/user/user-1');

      expect(response.status).toBe(500);
    });
  });

  // =============================================
  // POST /:id/share/group
  // =============================================

  describe('POST /:id/share/group', () => {
    it('shares device with group successfully', async () => {
      mockShareDeviceWithGroup.mockResolvedValue({
        success: true,
        message: 'Device shared with group',
        groupName: 'Team A',
      });

      const response = await request(app)
        .post('/api/v1/devices/device-1/share/group')
        .send({ groupId: 'group-1' });

      expect(response.status).toBe(200);
      expect(mockShareDeviceWithGroup).toHaveBeenCalledWith('device-1', 'group-1', 'owner-1');
      expect(response.body.success).toBe(true);
      expect(response.body.groupName).toBe('Team A');
    });

    it('unshares device from group with null groupId', async () => {
      mockShareDeviceWithGroup.mockResolvedValue({
        success: true,
        message: 'Group access removed',
        groupName: null,
      });

      const response = await request(app)
        .post('/api/v1/devices/device-1/share/group')
        .send({ groupId: null });

      expect(response.status).toBe(200);
      expect(mockShareDeviceWithGroup).toHaveBeenCalledWith('device-1', null, 'owner-1');
      expect(response.body.message).toBe('Group access removed');
    });

    it('returns 400 when group not found', async () => {
      mockShareDeviceWithGroup.mockResolvedValue({
        success: false,
        message: 'Group not found',
        groupName: null,
      });

      const response = await request(app)
        .post('/api/v1/devices/device-1/share/group')
        .send({ groupId: 'nonexistent' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Group not found');
    });

    it('returns 403 when the owner does not belong to the target group', async () => {
      mockShareDeviceWithGroup.mockRejectedValue(
        new ForbiddenError('You must be a member of the group to share with it')
      );

      const response = await request(app)
        .post('/api/v1/devices/device-1/share/group')
        .send({ groupId: 'group-1' });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN');
      expect(response.body.message).toBe('You must be a member of the group to share with it');
    });

    it('returns 400 when not device owner', async () => {
      mockShareDeviceWithGroup.mockResolvedValue({
        success: false,
        message: 'Only device owner can share',
        groupName: null,
      });

      const response = await request(app)
        .post('/api/v1/devices/device-1/share/group')
        .send({ groupId: 'group-1' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Only device owner can share');
    });

    it('returns 500 when service throws', async () => {
      mockShareDeviceWithGroup.mockRejectedValue(new Error('db error'));

      const response = await request(app)
        .post('/api/v1/devices/device-1/share/group')
        .send({ groupId: 'group-1' });

      expect(response.status).toBe(500);
    });
  });
});
