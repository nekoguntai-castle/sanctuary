/**
 * Admin Routes Integration Tests
 *
 * HTTP-level tests for admin sub-routes using supertest.
 * Covers: users, groups, settings, backup, audit logs, etc.
 */

import { vi, Mock } from 'vitest';
import express from 'express';
import request from 'supertest';

const {
  mockEncrypt,
  mockIsEncrypted,
  mockClearTransporterCache,
} = vi.hoisted(() => ({
  mockEncrypt: vi.fn((value: string) => `enc:${value}`),
  mockIsEncrypted: vi.fn((value: string) => typeof value === 'string' && value.startsWith('enc:')),
  mockClearTransporterCache: vi.fn(),
}));

// Mock logger first
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock Prisma
const mockPrisma = {
  user: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  group: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  groupMember: {
    create: vi.fn(),
    createMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  systemSetting: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  auditLog: {
    findMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
    create: vi.fn(),
  },
  wallet: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
  },
  device: {
    count: vi.fn(),
  },
  $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockPrisma)),
};

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

// Mock audit service
const mockAuditService = {
  log: vi.fn().mockResolvedValue(undefined),
  logFromRequest: vi.fn().mockResolvedValue(undefined),
  query: vi.fn().mockResolvedValue({ logs: [], total: 0 }),
  getStats: vi.fn().mockResolvedValue({ total: 0, byAction: {}, byCategory: {} }),
};

vi.mock('../../../src/services/auditService', () => ({
  auditService: mockAuditService,
  AuditAction: {
    USER_CREATE: 'user.create',
    USER_UPDATE: 'user.update',
    USER_DELETE: 'user.delete',
    USER_ADMIN_GRANT: 'user.admin_grant',
    USER_ADMIN_REVOKE: 'user.admin_revoke',
    GROUP_CREATE: 'admin.group_create',
    GROUP_DELETE: 'admin.group_delete',
    SYSTEM_SETTING_UPDATE: 'admin.system_setting_update',
  },
  AuditCategory: {
    USER: 'user',
    ADMIN: 'admin',
    SYSTEM: 'system',
  },
  getClientInfo: vi.fn().mockReturnValue({ ipAddress: '127.0.0.1', userAgent: 'test' }),
}));

// Mock authentication middleware
vi.mock('../../../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-user-id', username: 'admin', isAdmin: true };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

// Mock config
vi.mock('../../../src/config', () => ({
  __esModule: true,
  default: {
    jwtSecret: 'test-secret',
    nodeEnv: 'test',
    dataDir: '/tmp/test',
    encryptionKey: 'test-encryption-key',
    corsAllowedOrigins: [],
  },
}));

// Mock access control
vi.mock('../../../src/services/accessControl', () => ({
  invalidateUserAccessCache: vi.fn(),
}));

// Mock token revocation (called on admin password reset)
vi.mock('../../../src/services/tokenRevocation', () => ({
  revokeAllUserTokens: vi.fn().mockResolvedValue(0),
}));

// Mock backup service
vi.mock('../../../src/services/backupService', () => ({
  backupService: {
    createBackup: vi.fn().mockResolvedValue(Buffer.from('mock-backup')),
    validateBackup: vi.fn().mockResolvedValue({ valid: true }),
    restoreFromBackup: vi.fn().mockResolvedValue({ success: true }),
  },
}));

// Mock version check
vi.mock('../../../src/services/versionService', () => ({
  versionService: {
    getCurrentVersion: vi.fn().mockReturnValue('1.0.0'),
    getLatestVersion: vi.fn().mockResolvedValue('1.0.0'),
    checkForUpdates: vi.fn().mockResolvedValue({ hasUpdate: false }),
  },
}));

vi.mock('../../../src/utils/encryption', () => ({
  encrypt: mockEncrypt,
  isEncrypted: mockIsEncrypted,
}));

vi.mock('../../../src/services/email', () => ({
  clearTransporterCache: mockClearTransporterCache,
}));

const createTestApp = async () => {
  const app = express();
  app.use(express.json());
  const adminModule = await import('../../../src/api/admin');
  app.use('/api/v1/admin', adminModule.default);
  return app;
};

describe('Admin Routes', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await createTestApp();
  }, 30000);

  beforeEach(() => {
    vi.resetAllMocks();
    // Reset to default resolved values after clearing
    mockAuditService.log.mockResolvedValue(undefined);
    mockAuditService.logFromRequest.mockResolvedValue(undefined);
    mockAuditService.query.mockResolvedValue({ logs: [], total: 0 });
    mockAuditService.getStats.mockResolvedValue({ total: 0, byAction: {}, byCategory: {} });
    mockEncrypt.mockImplementation((value: string) => `enc:${value}`);
    mockIsEncrypted.mockImplementation((value: string) => typeof value === 'string' && value.startsWith('enc:'));
  });

  // ========================================
  // USER MANAGEMENT
  // ========================================

  describe('GET /api/v1/admin/users', () => {
    it('should return list of users', async () => {
      const mockUsers = [
        { id: 'user-1', username: 'admin', email: 'admin@test.com', isAdmin: true, createdAt: new Date(), updatedAt: new Date() },
        { id: 'user-2', username: 'user1', email: 'user1@test.com', isAdmin: false, createdAt: new Date(), updatedAt: new Date() },
      ];
      mockPrisma.user.findMany.mockResolvedValue(mockUsers);

      const response = await request(app).get('/api/v1/admin/users');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].username).toBe('admin');
    });

    it('should include email and verification status in user list', async () => {
      const mockUsers = [
        {
          id: 'user-1',
          username: 'verified',
          email: 'verified@test.com',
          emailVerified: true,
          emailVerifiedAt: new Date(),
          isAdmin: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'user-2',
          username: 'unverified',
          email: 'unverified@test.com',
          emailVerified: false,
          emailVerifiedAt: null,
          isAdmin: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockPrisma.user.findMany.mockResolvedValue(mockUsers);

      const response = await request(app).get('/api/v1/admin/users');

      expect(response.status).toBe(200);
      expect(response.body[0].email).toBe('verified@test.com');
      expect(response.body[0].emailVerified).toBe(true);
      expect(response.body[1].email).toBe('unverified@test.com');
      expect(response.body[1].emailVerified).toBe(false);
    });

    it('should handle database error', async () => {
      mockPrisma.user.findMany.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/v1/admin/users');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  describe('POST /api/v1/admin/users', () => {
    it('should create a new user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-user',
        username: 'newuser',
        email: 'new@test.com',
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await request(app)
        .post('/api/v1/admin/users')
        .send({
          username: 'newuser',
          password: 'StrongPass123!',
          email: 'new@test.com',
        });

      expect(response.status).toBe(201);
      expect(response.body.username).toBe('newuser');
    });

    it('should reject missing username', async () => {
      const response = await request(app)
        .post('/api/v1/admin/users')
        .send({ password: 'StrongPass123!' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('required');
    });

    it('should reject weak password', async () => {
      const response = await request(app)
        .post('/api/v1/admin/users')
        .send({ username: 'newuser', password: '123', email: 'new@test.com' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('security requirements');
    });

    it('should reject duplicate username', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      const response = await request(app)
        .post('/api/v1/admin/users')
        .send({ username: 'existinguser', password: 'StrongPass123!', email: 'existing@test.com' });

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('already exists');
    });

    it('should reject short username', async () => {
      const response = await request(app)
        .post('/api/v1/admin/users')
        .send({ username: 'ab', password: 'StrongPass123!', email: 'short@test.com' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('at least 3');
    });

    it('should reject missing email', async () => {
      const response = await request(app)
        .post('/api/v1/admin/users')
        .send({ username: 'newuser', password: 'StrongPass123!' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('required');
    });

    it('should reject invalid email format', async () => {
      const response = await request(app)
        .post('/api/v1/admin/users')
        .send({ username: 'newuser', password: 'StrongPass123!', email: 'invalid-email' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('email');
    });

    it('should reject duplicate email', async () => {
      // First call: check username not taken (null)
      // Second call: check email already exists
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)  // username check
        .mockResolvedValueOnce({ id: 'existing-user', email: 'existing@test.com' });  // email check

      const response = await request(app)
        .post('/api/v1/admin/users')
        .send({ username: 'newuser', password: 'StrongPass123!', email: 'existing@test.com' });

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('already');
    });

    it('should auto-verify email for admin-created users', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-user',
        username: 'newuser',
        email: 'new@test.com',
        emailVerified: true,
        emailVerifiedAt: new Date(),
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await request(app)
        .post('/api/v1/admin/users')
        .send({
          username: 'newuser',
          password: 'StrongPass123!',
          email: 'new@test.com',
        });

      expect(response.status).toBe(201);
      expect(response.body.emailVerified).toBe(true);
      // Verify the create call included emailVerified: true
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            emailVerified: true,
            emailVerifiedAt: expect.any(Date),
          }),
        })
      );
    });

    it('should include email in created user response', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-user',
        username: 'newuser',
        email: 'new@test.com',
        emailVerified: true,
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await request(app)
        .post('/api/v1/admin/users')
        .send({
          username: 'newuser',
          password: 'StrongPass123!',
          email: 'new@test.com',
        });

      expect(response.status).toBe(201);
      expect(response.body.email).toBe('new@test.com');
    });

    it('should handle create errors', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mockPrisma.user.create.mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .post('/api/v1/admin/users')
        .send({
          username: 'newuser',
          password: 'StrongPass123!',
          email: 'new@test.com',
        });

      expect(response.status).toBe(500);
      expect(response.body.message).toContain('Failed to create user');
    });
  });

  describe('PUT /api/v1/admin/users/:userId', () => {
    it('should update a user', async () => {
      // 1st call: checks user exists, 2nd call: checks if new username is taken,
      // 3rd call: checks if new email is taken
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'user-1',
          username: 'oldname',
          email: 'old@test.com',
          isAdmin: false,
        })
        .mockResolvedValueOnce(null)  // new username not taken
        .mockResolvedValueOnce(null); // new email not taken
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        username: 'newname',
        email: 'new@test.com',
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await request(app)
        .put('/api/v1/admin/users/user-1')
        .send({ username: 'newname', email: 'new@test.com' });

      expect(response.status).toBe(200);
      expect(response.body.username).toBe('newname');
    });

    it('should handle non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .put('/api/v1/admin/users/nonexistent')
        .send({ username: 'newname' });

      expect(response.status).toBe(404);
    });

    it('should reject duplicate username on update', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'user-1', username: 'oldname', email: null })  // existing user
        .mockResolvedValueOnce({ id: 'user-2', username: 'takenname' });  // username check

      const response = await request(app)
        .put('/api/v1/admin/users/user-1')
        .send({ username: 'takenname' });

      expect(response.status).toBe(409);
    });

    it('should reject duplicate email on update', async () => {
      // When only sending email (no username), the username check is skipped
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'user-1', username: 'oldname', email: 'old@test.com' })  // existing user
        .mockResolvedValueOnce({ id: 'user-2', email: 'taken@test.com' });  // email check (username check skipped)

      const response = await request(app)
        .put('/api/v1/admin/users/user-1')
        .send({ email: 'taken@test.com' });

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('already');
    });

    it('should update email successfully', async () => {
      // When only sending email (no username), the username check is skipped
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'user-1',
          username: 'testuser',
          email: 'old@test.com',
          emailVerified: true,
          isAdmin: false,
        })
        .mockResolvedValueOnce(null);  // email check (username check skipped)
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        username: 'testuser',
        email: 'new@test.com',
        emailVerified: true,  // Admin-updated emails stay verified
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await request(app)
        .put('/api/v1/admin/users/user-1')
        .send({ email: 'new@test.com' });

      expect(response.status).toBe(200);
      expect(response.body.email).toBe('new@test.com');
    });

    it('should remove email and mark it unverified when email is cleared', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        username: 'testuser',
        email: 'old@test.com',
        emailVerified: true,
        isAdmin: false,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        username: 'testuser',
        email: null,
        emailVerified: false,
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await request(app)
        .put('/api/v1/admin/users/user-1')
        .send({ email: '' });

      expect(response.status).toBe(200);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: null,
            emailVerified: false,
            emailVerifiedAt: null,
          }),
        })
      );
    });

    it('should not set email fields when clearing email for user without email', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        username: 'testuser',
        email: null,
        emailVerified: false,
        isAdmin: false,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        username: 'testuser',
        email: null,
        emailVerified: false,
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await request(app)
        .put('/api/v1/admin/users/user-1')
        .send({ email: '' });

      expect(response.status).toBe(200);
      const updatePayload = mockPrisma.user.update.mock.calls.at(-1)?.[0];
      expect(updatePayload.data.email).toBeUndefined();
      expect(updatePayload.data.emailVerified).toBeUndefined();
      expect(updatePayload.data.emailVerifiedAt).toBeUndefined();
    });

    it('should reject weak password on update', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        username: 'testuser',
        email: 'test@test.com',
      });

      const response = await request(app)
        .put('/api/v1/admin/users/user-1')
        .send({ password: 'weak' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('security requirements');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('should hash and update strong password', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        username: 'testuser',
        email: 'test@test.com',
        isAdmin: false,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        username: 'testuser',
        email: 'test@test.com',
        emailVerified: true,
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await request(app)
        .put('/api/v1/admin/users/user-1')
        .send({ password: 'Str0ngPassw0rd!' });

      expect(response.status).toBe(200);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            password: expect.any(String),
          }),
        })
      );

      const updatePayload = mockPrisma.user.update.mock.calls.at(-1)?.[0];
      expect(updatePayload.data.password).not.toBe('Str0ngPassw0rd!');
    });

    it('should log admin grant action when isAdmin is set to true', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        username: 'testuser',
        email: 'test@test.com',
        isAdmin: false,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        username: 'testuser',
        email: 'test@test.com',
        emailVerified: true,
        isAdmin: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await request(app)
        .put('/api/v1/admin/users/user-1')
        .send({ isAdmin: true });

      expect(response.status).toBe(200);
      expect(mockAuditService.logFromRequest).toHaveBeenCalledWith(
        expect.any(Object),
        'user.admin_grant',
        'user',
        expect.objectContaining({
          details: expect.objectContaining({ userId: 'user-1' }),
        })
      );
    });

    it('should log admin revoke action when isAdmin is set to false', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        username: 'testuser',
        email: 'test@test.com',
        isAdmin: true,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        username: 'testuser',
        email: 'test@test.com',
        emailVerified: true,
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await request(app)
        .put('/api/v1/admin/users/user-1')
        .send({ isAdmin: false });

      expect(response.status).toBe(200);
      expect(mockAuditService.logFromRequest).toHaveBeenCalledWith(
        expect.any(Object),
        'user.admin_revoke',
        'user',
        expect.objectContaining({
          details: expect.objectContaining({ userId: 'user-1' }),
        })
      );
    });

    it('should handle update errors', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        username: 'testuser',
        email: 'test@test.com',
      });
      mockPrisma.user.update.mockRejectedValue(new Error('update failed'));

      const response = await request(app)
        .put('/api/v1/admin/users/user-1')
        .send({ isAdmin: false });

      expect(response.status).toBe(500);
      expect(response.body.message).toContain('Failed to update user');
    });

    // Note: Email format is NOT validated on update in the admin endpoint
    // The endpoint only checks for duplicate emails, not format validation
  });

  // ========================================
  // GROUP MANAGEMENT
  // ========================================

  describe('GET /api/v1/admin/groups', () => {
    it('should return list of groups', async () => {
      const mockGroups = [
        {
          id: 'group-1',
          name: 'Admins',
          description: 'Admin group',
          purpose: 'admin',
          createdAt: new Date(),
          updatedAt: new Date(),
          members: [
            { userId: 'user-1', role: 'admin', user: { id: 'user-1', username: 'admin' } },
          ],
        },
      ];
      mockPrisma.group.findMany.mockResolvedValue(mockGroups);

      const response = await request(app).get('/api/v1/admin/groups');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].name).toBe('Admins');
      expect(response.body[0].members).toHaveLength(1);
    });

    it('should handle database error', async () => {
      mockPrisma.group.findMany.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/v1/admin/groups');

      expect(response.status).toBe(500);
    });
  });

  describe('POST /api/v1/admin/groups', () => {
    it('should create a new group', async () => {
      mockPrisma.group.create.mockResolvedValue({
        id: 'new-group',
        name: 'New Group',
        description: 'Test group',
        purpose: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'new-group',
        name: 'New Group',
        members: [],
      });

      const response = await request(app)
        .post('/api/v1/admin/groups')
        .send({ name: 'New Group', description: 'Test group' });

      expect(response.status).toBe(201);
      expect(response.body.name).toBe('New Group');
    });

    it('should reject missing name', async () => {
      const response = await request(app)
        .post('/api/v1/admin/groups')
        .send({ description: 'No name' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('required');
    });

    it('should create group with members', async () => {
      mockPrisma.group.create.mockResolvedValue({
        id: 'new-group',
        name: 'Team',
        description: null,
        purpose: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }]);
      mockPrisma.groupMember.createMany.mockResolvedValue({ count: 2 });
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'new-group',
        name: 'Team',
        members: [
          { userId: 'user-1', user: { id: 'user-1', username: 'user1' }, role: 'member' },
          { userId: 'user-2', user: { id: 'user-2', username: 'user2' }, role: 'member' },
        ],
      });

      const response = await request(app)
        .post('/api/v1/admin/groups')
        .send({ name: 'Team', memberIds: ['user-1', 'user-2'] });

      expect(response.status).toBe(201);
    });
  });

  // ========================================
  // SYSTEM SETTINGS
  // ========================================

  describe('GET /api/v1/admin/settings', () => {
    it('should return system settings with defaults', async () => {
      mockPrisma.systemSetting.findMany.mockResolvedValue([
        { key: 'registrationEnabled', value: 'true' },
      ]);

      const response = await request(app).get('/api/v1/admin/settings');

      expect(response.status).toBe(200);
      // Should have defaults merged with stored settings
      expect(response.body.registrationEnabled).toBe(true);
      expect(response.body.confirmationThreshold).toBeDefined();
    });

    it('should handle database error', async () => {
      mockPrisma.systemSetting.findMany.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/v1/admin/settings');

      expect(response.status).toBe(500);
    });

    it('should mark SMTP as not configured when host or fromAddress is missing', async () => {
      mockPrisma.systemSetting.findMany.mockResolvedValue([
        { key: 'smtp.host', value: '"smtp.example.com"' },
        { key: 'smtp.password', value: '"enc:secret"' },
      ]);

      const response = await request(app).get('/api/v1/admin/settings');

      expect(response.status).toBe(200);
      expect(response.body['smtp.configured']).toBe(false);
      expect(response.body['smtp.password']).toBeUndefined();
    });
  });

  describe('PUT /api/v1/admin/settings', () => {
    it('should update settings', async () => {
      mockPrisma.systemSetting.findMany.mockResolvedValue([]);
      mockPrisma.systemSetting.upsert.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });

      const response = await request(app)
        .put('/api/v1/admin/settings')
        .send({ registrationEnabled: true });

      expect(response.status).toBe(200);
    });

    it('should validate confirmation thresholds', async () => {
      mockPrisma.systemSetting.findMany.mockResolvedValue([
        { key: 'confirmationThreshold', value: '6' },
        { key: 'deepConfirmationThreshold', value: '100' },
      ]);

      const response = await request(app)
        .put('/api/v1/admin/settings')
        .send({ deepConfirmationThreshold: 2, confirmationThreshold: 6 });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('greater than or equal');
    });

    it('should handle database error', async () => {
      mockPrisma.systemSetting.findMany.mockResolvedValue([]);
      mockPrisma.systemSetting.upsert.mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .put('/api/v1/admin/settings')
        .send({ registrationEnabled: false });

      expect(response.status).toBe(500);
    });

    it('should encrypt plaintext SMTP password and clear transporter cache', async () => {
      mockPrisma.systemSetting.upsert.mockResolvedValue({ key: 'smtp.password', value: '"enc:new-secret"' });
      mockPrisma.systemSetting.findMany.mockResolvedValue([
        { key: 'smtp.host', value: '"smtp.example.com"' },
        { key: 'smtp.fromAddress', value: '"noreply@example.com"' },
        { key: 'smtp.password', value: '"enc:new-secret"' },
      ]);

      const response = await request(app)
        .put('/api/v1/admin/settings')
        .send({
          'smtp.host': 'smtp.example.com',
          'smtp.fromAddress': 'noreply@example.com',
          'smtp.password': 'new-secret',
        });

      expect(response.status).toBe(200);
      expect(mockIsEncrypted).toHaveBeenCalledWith('new-secret');
      expect(mockEncrypt).toHaveBeenCalledWith('new-secret');
      expect(mockPrisma.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'smtp.password' },
          update: { value: JSON.stringify('enc:new-secret') },
          create: { key: 'smtp.password', value: JSON.stringify('enc:new-secret') },
        })
      );
      expect(mockClearTransporterCache).toHaveBeenCalledTimes(1);
      expect(response.body['smtp.configured']).toBe(true);
      expect(response.body['smtp.password']).toBeUndefined();
    });

    it('should use current confirmation threshold when only deep threshold is updated', async () => {
      mockPrisma.systemSetting.findMany
        .mockResolvedValueOnce([
          { key: 'confirmationThreshold', value: '3' },
          { key: 'deepConfirmationThreshold', value: '6' },
        ])
        .mockResolvedValueOnce([
          { key: 'confirmationThreshold', value: '3' },
          { key: 'deepConfirmationThreshold', value: '7' },
        ]);
      mockPrisma.systemSetting.upsert.mockResolvedValue({ key: 'deepConfirmationThreshold', value: '7' });

      const response = await request(app)
        .put('/api/v1/admin/settings')
        .send({ deepConfirmationThreshold: 7 });

      expect(response.status).toBe(200);
      expect(mockPrisma.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'deepConfirmationThreshold' },
        })
      );
    });

    it('should use current deep confirmation threshold when only confirmation threshold is updated', async () => {
      mockPrisma.systemSetting.findMany
        .mockResolvedValueOnce([
          { key: 'confirmationThreshold', value: '2' },
          { key: 'deepConfirmationThreshold', value: '6' },
        ])
        .mockResolvedValueOnce([
          { key: 'confirmationThreshold', value: '4' },
          { key: 'deepConfirmationThreshold', value: '6' },
        ]);
      mockPrisma.systemSetting.upsert.mockResolvedValue({ key: 'confirmationThreshold', value: '4' });

      const response = await request(app)
        .put('/api/v1/admin/settings')
        .send({ confirmationThreshold: 4 });

      expect(response.status).toBe(200);
      expect(mockPrisma.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'confirmationThreshold' },
        })
      );
    });

    it('should keep already encrypted SMTP password without re-encrypting', async () => {
      mockPrisma.systemSetting.upsert.mockResolvedValue({ key: 'smtp.password', value: '"enc:already-secret"' });
      mockPrisma.systemSetting.findMany.mockResolvedValue([
        { key: 'smtp.host', value: '"smtp.example.com"' },
        { key: 'smtp.fromAddress', value: '"noreply@example.com"' },
        { key: 'smtp.password', value: '"enc:already-secret"' },
      ]);

      const response = await request(app)
        .put('/api/v1/admin/settings')
        .send({ 'smtp.password': 'enc:already-secret' });

      expect(response.status).toBe(200);
      expect(mockIsEncrypted).toHaveBeenCalledWith('enc:already-secret');
      expect(mockEncrypt).not.toHaveBeenCalled();
      expect(mockPrisma.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'smtp.password' },
          update: { value: JSON.stringify('enc:already-secret') },
          create: { key: 'smtp.password', value: JSON.stringify('enc:already-secret') },
        })
      );
    });
  });

  // ========================================
  // AUDIT LOGS
  // ========================================

  describe('GET /api/v1/admin/audit-logs', () => {
    it('should return audit logs from auditService', async () => {
      mockAuditService.query.mockResolvedValue({
        logs: [
          {
            id: 'log-1',
            action: 'login',
            category: 'auth',
            userId: 'user-1',
            username: 'admin',
            success: true,
            createdAt: new Date(),
          },
        ],
        total: 1,
      });

      const response = await request(app).get('/api/v1/admin/audit-logs');

      expect(response.status).toBe(200);
      expect(response.body.logs).toHaveLength(1);
      expect(response.body.total).toBe(1);
    });

    it('should support pagination via query params', async () => {
      mockAuditService.query.mockResolvedValue({ logs: [], total: 0 });

      const response = await request(app)
        .get('/api/v1/admin/audit-logs')
        .query({ offset: 10, limit: 20 });

      expect(response.status).toBe(200);
      expect(mockAuditService.query).toHaveBeenCalledWith(
        expect.objectContaining({
          offset: 10,
          limit: 20,
        })
      );
    });

    it('should filter by category', async () => {
      mockAuditService.query.mockResolvedValue({ logs: [], total: 0 });

      const response = await request(app)
        .get('/api/v1/admin/audit-logs')
        .query({ category: 'auth' });

      expect(response.status).toBe(200);
      expect(mockAuditService.query).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'auth' })
      );
    });

    it('should filter by success flag when provided', async () => {
      mockAuditService.query.mockResolvedValue({ logs: [], total: 0 });

      const response = await request(app)
        .get('/api/v1/admin/audit-logs')
        .query({ success: 'false' });

      expect(response.status).toBe(200);
      expect(mockAuditService.query).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      );
    });

    it('should filter by date range', async () => {
      mockAuditService.query.mockResolvedValue({ logs: [], total: 0 });

      const response = await request(app)
        .get('/api/v1/admin/audit-logs')
        .query({ startDate: '2024-01-01', endDate: '2024-12-31' });

      expect(response.status).toBe(200);
      expect(mockAuditService.query).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate: expect.any(Date),
          endDate: expect.any(Date),
        })
      );
    });

    it('should handle service error', async () => {
      mockAuditService.query.mockRejectedValue(new Error('Service error'));

      const response = await request(app).get('/api/v1/admin/audit-logs');

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/v1/admin/audit-logs/stats', () => {
    it('should return audit log statistics', async () => {
      mockAuditService.getStats.mockResolvedValue({
        total: 1000,
        byAction: { login: 500, logout: 300 },
        byCategory: { auth: 800, user: 200 },
      });

      const response = await request(app).get('/api/v1/admin/audit-logs/stats');

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1000);
      expect(response.body.byAction).toBeDefined();
    });

    it('should support days query parameter', async () => {
      mockAuditService.getStats.mockResolvedValue({ total: 0, byAction: {}, byCategory: {} });

      const response = await request(app)
        .get('/api/v1/admin/audit-logs/stats')
        .query({ days: 7 });

      expect(response.status).toBe(200);
      expect(mockAuditService.getStats).toHaveBeenCalledWith(7);
    });

    it('should handle service error', async () => {
      mockAuditService.getStats.mockRejectedValue(new Error('Service error'));

      const response = await request(app).get('/api/v1/admin/audit-logs/stats');

      expect(response.status).toBe(500);
    });
  });

  // ========================================
  // VERSION
  // ========================================

  describe('GET /api/v1/admin/version', () => {
    it('should return version info', async () => {
      const response = await request(app).get('/api/v1/admin/version');

      expect(response.status).toBe(200);
      expect(response.body.currentVersion).toBeDefined();
    });
  });

  // ========================================
  // DELETE OPERATIONS
  // ========================================

  describe('DELETE /api/v1/admin/users/:id', () => {
    it('should delete a user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-to-delete',
        username: 'deleteuser',
        isAdmin: false,
      });
      mockPrisma.user.delete.mockResolvedValue({ id: 'user-to-delete' });

      const response = await request(app).delete('/api/v1/admin/users/user-to-delete');

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('deleted');
    });

    it('should prevent self-deletion', async () => {
      // The authenticate middleware sets userId to 'admin-user-id'
      const response = await request(app).delete('/api/v1/admin/users/admin-user-id');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('own account');
    });

    it('should handle non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const response = await request(app).delete('/api/v1/admin/users/nonexistent');

      expect(response.status).toBe(404);
    });

    it('should handle delete errors', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-to-delete',
        username: 'deleteuser',
        isAdmin: false,
      });
      mockPrisma.user.delete.mockRejectedValue(new Error('delete failed'));

      const response = await request(app).delete('/api/v1/admin/users/user-to-delete');

      expect(response.status).toBe(500);
      expect(response.body.message).toContain('Failed to delete user');
    });
  });

  describe('DELETE /api/v1/admin/groups/:id', () => {
    it('should delete a group', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'group-to-delete',
        name: 'Test Group',
      });
      mockPrisma.group.delete.mockResolvedValue({ id: 'group-to-delete' });

      const response = await request(app).delete('/api/v1/admin/groups/group-to-delete');

      expect(response.status).toBe(200);
    });

    it('should handle non-existent group', async () => {
      mockPrisma.group.findUnique.mockResolvedValue(null);

      const response = await request(app).delete('/api/v1/admin/groups/nonexistent');

      expect(response.status).toBe(404);
    });
  });
});
