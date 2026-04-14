import { describe, expect, it, vi } from 'vitest';
import { app } from './authRegistrationTestHarness';
import request from 'supertest';
import { mockPrismaClient } from '../../../mocks/prisma';

export function registerAuthProfileSessionsTests(): void {
  describe('GET /auth/me - Get Current User', () => {
    it('should return current user without password', async () => {
      const mockUser = {
        id: 'test-user-id',
        username: 'testuser',
        email: 'test@example.com',
        isAdmin: false,
        preferences: { darkMode: true },
        createdAt: new Date(),
        twoFactorEnabled: false,
        password: 'hashed-password-value',
      };

      mockPrismaClient.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/v1/auth/me');

      expect(response.status).toBe(200);
      expect(response.body.username).toBe('testuser');
      expect(response.body.password).toBeUndefined();
      expect(response.body.usingDefaultPassword).toBe(false);
    });

    it('should detect when user is using default password', async () => {
      const mockUser = {
        id: 'test-user-id',
        username: 'testuser',
        email: 'test@example.com',
        isAdmin: false,
        preferences: null,
        createdAt: new Date(),
        twoFactorEnabled: false,
        password: 'initial-password-hash',
      };

      mockPrismaClient.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'initialPassword_test-user-id',
        value: 'initial-password-hash', // Same as user's current password
      });

      const response = await request(app)
        .get('/api/v1/auth/me');

      expect(response.status).toBe(200);
      expect(response.body.usingDefaultPassword).toBe(true);
    });

    it('should return 404 when user not found', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/v1/auth/me');

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should handle database errors gracefully', async () => {
      mockPrismaClient.user.findUnique.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/v1/auth/me');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('PATCH /auth/me/preferences - Update Preferences', () => {
    it('should update user preferences', async () => {
      const currentUser = {
        preferences: { darkMode: true, theme: 'sanctuary' },
      };

      const updatedUser = {
        id: 'test-user-id',
        username: 'testuser',
        email: 'test@example.com',
        isAdmin: false,
        preferences: { darkMode: false, theme: 'sanctuary', unit: 'btc' },
        twoFactorEnabled: false,
        createdAt: new Date(),
      };

      mockPrismaClient.user.findUnique.mockResolvedValue(currentUser);
      mockPrismaClient.user.update.mockResolvedValue(updatedUser);

      const response = await request(app)
        .patch('/api/v1/auth/me/preferences')
        .send({ darkMode: false, unit: 'btc' });

      expect(response.status).toBe(200);
      expect(mockPrismaClient.user.update).toHaveBeenCalledWith({
        where: { id: 'test-user-id' },
        data: {
          preferences: expect.objectContaining({
            darkMode: false,
            unit: 'btc',
          }),
        },
        select: expect.any(Object),
      });
    });

    it('should merge with default preferences for new users', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({ preferences: null });
      mockPrismaClient.user.update.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        email: null,
        isAdmin: false,
        preferences: { darkMode: true, theme: 'sanctuary', unit: 'sats' },
        twoFactorEnabled: false,
        createdAt: new Date(),
      });

      const response = await request(app)
        .patch('/api/v1/auth/me/preferences')
        .send({ unit: 'sats' });

      expect(response.status).toBe(200);
      // Should include defaults merged with new values
      expect(mockPrismaClient.user.update).toHaveBeenCalledWith({
        where: { id: 'test-user-id' },
        data: {
          preferences: expect.objectContaining({
            darkMode: true, // default
            theme: 'sanctuary', // default
            unit: 'sats', // provided
          }),
        },
        select: expect.any(Object),
      });
    });

    it('should reject non-object preference updates', async () => {
      const response = await request(app)
        .patch('/api/v1/auth/me/preferences')
        .send(['darkMode']);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(mockPrismaClient.user.update).not.toHaveBeenCalled();
    });

    it('should reject invalid known preference field types', async () => {
      const response = await request(app)
        .patch('/api/v1/auth/me/preferences')
        .send({ darkMode: 'yes' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(mockPrismaClient.user.update).not.toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({ preferences: {} });
      mockPrismaClient.user.update.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .patch('/api/v1/auth/me/preferences')
        .send({ darkMode: true });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /auth/me/groups - Get User Groups', () => {
    it('should return user groups', async () => {
      const mockGroups = [
        {
          id: 'group-1',
          name: 'Family',
          description: 'Family group',
          members: [
            { userId: 'test-user-id', role: 'owner' },
            { userId: 'user-2', role: 'member' },
          ],
        },
      ];

      mockPrismaClient.group.findMany.mockResolvedValue(mockGroups);

      const response = await request(app)
        .get('/api/v1/auth/me/groups');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].name).toBe('Family');
      expect(response.body[0].memberCount).toBe(2);
    });

    it('should return empty array when user has no groups', async () => {
      mockPrismaClient.group.findMany.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/v1/auth/me/groups');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should handle database errors gracefully', async () => {
      mockPrismaClient.group.findMany.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/v1/auth/me/groups');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /auth/users/search - Search Users', () => {
    it('should search users by username', async () => {
      const mockUsers = [
        { id: 'user-1', username: 'testuser1' },
        { id: 'user-2', username: 'testuser2' },
      ];

      mockPrismaClient.user.findMany.mockResolvedValue(mockUsers);

      const response = await request(app)
        .get('/api/v1/auth/users/search?q=test');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(mockPrismaClient.user.findMany).toHaveBeenCalledWith({
        where: {
          username: {
            contains: 'test',
            mode: 'insensitive',
          },
        },
        select: { id: true, username: true },
        take: 10,
      });
    });

    it('should reject query shorter than 2 characters', async () => {
      const response = await request(app)
        .get('/api/v1/auth/users/search?q=a');

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Validation failed');
      expect(response.body.details.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'q',
            message: expect.stringContaining('at least 2 characters'),
          }),
        ])
      );
    });

    it('should reject missing query parameter', async () => {
      const response = await request(app)
        .get('/api/v1/auth/users/search');

      expect(response.status).toBe(400);
    });

    it('should handle database errors gracefully', async () => {
      mockPrismaClient.user.findMany.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/v1/auth/users/search?q=test');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  // ========================================
  // Sessions Routes
  // ========================================

  describe('GET /auth/sessions - List Sessions', () => {
    it('should return user sessions', async () => {
      const { getUserSessions } = await import('../../../../src/services/refreshTokenService');
      const mockGetUserSessions = vi.mocked(getUserSessions);

      const mockSessions = [
        {
          id: 'session-1',
          deviceName: 'Chrome on Mac',
          userAgent: 'Mozilla/5.0...',
          ipAddress: '192.168.1.1',
          createdAt: new Date('2024-01-01'),
          lastUsedAt: new Date('2024-01-10'),
          isCurrent: true,
        },
        {
          id: 'session-2',
          deviceName: 'Firefox on Windows',
          userAgent: 'Mozilla/5.0...',
          ipAddress: '192.168.1.2',
          createdAt: new Date('2024-01-02'),
          lastUsedAt: new Date('2024-01-08'),
          isCurrent: false,
        },
      ];

      mockGetUserSessions.mockResolvedValue(mockSessions);

      const response = await request(app)
        .get('/api/v1/auth/sessions');

      expect(response.status).toBe(200);
      expect(response.body.sessions).toHaveLength(2);
      expect(response.body.count).toBe(2);
      expect(response.body.sessions[0].deviceName).toBe('Chrome on Mac');
      expect(response.body.sessions[0].isCurrent).toBe(true);
    });

    it('should mark current session when refresh token header provided', async () => {
      const { getUserSessions } = await import('../../../../src/services/refreshTokenService');
      const mockGetUserSessions = vi.mocked(getUserSessions);

      mockGetUserSessions.mockResolvedValue([]);

      await request(app)
        .get('/api/v1/auth/sessions')
        .set('X-Refresh-Token', 'some-refresh-token');

      expect(mockGetUserSessions).toHaveBeenCalledWith('test-user-id', 'hashed-token');
    });

    it('should show Unknown Device when deviceName is missing', async () => {
      const { getUserSessions } = await import('../../../../src/services/refreshTokenService');
      const mockGetUserSessions = vi.mocked(getUserSessions);

      const mockSessions = [
        {
          id: 'session-1',
          deviceName: null, // No device name
          userAgent: 'Mozilla/5.0...',
          ipAddress: '192.168.1.1',
          createdAt: new Date('2024-01-01'),
          lastUsedAt: new Date('2024-01-10'),
          isCurrent: false,
        },
      ];

      mockGetUserSessions.mockResolvedValue(mockSessions);

      const response = await request(app)
        .get('/api/v1/auth/sessions');

      expect(response.status).toBe(200);
      expect(response.body.sessions[0].deviceName).toBe('Unknown Device');
    });

    it('should handle service errors gracefully', async () => {
      const { getUserSessions } = await import('../../../../src/services/refreshTokenService');
      const mockGetUserSessions = vi.mocked(getUserSessions);

      mockGetUserSessions.mockRejectedValue(new Error('Service error'));

      const response = await request(app)
        .get('/api/v1/auth/sessions');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('DELETE /auth/sessions/:id - Revoke Session', () => {
    it('should revoke a session', async () => {
      const { revokeSession } = await import('../../../../src/services/refreshTokenService');
      const mockRevokeSession = vi.mocked(revokeSession);

      mockRevokeSession.mockResolvedValue(true);

      const response = await request(app)
        .delete('/api/v1/auth/sessions/session-1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockRevokeSession).toHaveBeenCalledWith('session-1', 'test-user-id');
    });

    it('should return 404 when session not found', async () => {
      const { revokeSession } = await import('../../../../src/services/refreshTokenService');
      const mockRevokeSession = vi.mocked(revokeSession);

      mockRevokeSession.mockResolvedValue(false);

      const response = await request(app)
        .delete('/api/v1/auth/sessions/non-existent');

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should audit revoke session with unknown username fallback', async () => {
      const { revokeSession } = await import('../../../../src/services/refreshTokenService');
      const mockRevokeSession = vi.mocked(revokeSession);
      const { auditService } = await import('../../../../src/services/auditService');

      mockRevokeSession.mockResolvedValue(true);

      const response = await request(app)
        .delete('/api/v1/auth/sessions/session-unknown-user')
        .set('X-Test-No-Username', '1');

      expect(response.status).toBe(200);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'unknown',
          details: expect.objectContaining({ sessionId: 'session-unknown-user' }),
        })
      );
    });

    it('should handle service errors gracefully', async () => {
      const { revokeSession } = await import('../../../../src/services/refreshTokenService');
      const mockRevokeSession = vi.mocked(revokeSession);

      mockRevokeSession.mockRejectedValue(new Error('Service error'));

      const response = await request(app)
        .delete('/api/v1/auth/sessions/session-1');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  // ========================================
  // Login Routes
  // ========================================

}
