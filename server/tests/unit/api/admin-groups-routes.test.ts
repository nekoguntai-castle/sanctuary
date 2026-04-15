import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { errorHandler } from '../../../src/errors/errorHandler';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

const {
  mockAuditLogFromRequest,
  mockInvalidateUserAccessCache,
} = vi.hoisted(() => ({
  mockAuditLogFromRequest: vi.fn(),
  mockInvalidateUserAccessCache: vi.fn(),
}));

vi.mock('../../../src/models/prisma', async () => {
  const { mockPrismaClient: prisma } = await import('../../mocks/prisma');
  return {
    __esModule: true,
    default: prisma,
  };
});

vi.mock('../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user ?? { userId: 'test-user-id', username: 'testuser', isAdmin: false },
  authenticate: (req: any, _res: any, next: () => void) => {
    req.user = { userId: 'admin-1', username: 'admin', isAdmin: true };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock('../../../src/services/auditService', () => ({
  auditService: {
    logFromRequest: mockAuditLogFromRequest,
  },
  AuditAction: {
    GROUP_CREATE: 'group_create',
    GROUP_DELETE: 'group_delete',
    GROUP_MEMBER_ADD: 'group_member_add',
    GROUP_MEMBER_REMOVE: 'group_member_remove',
  },
  AuditCategory: {
    ADMIN: 'admin',
  },
}));

vi.mock('../../../src/services/accessControl', () => ({
  invalidateUserAccessCache: mockInvalidateUserAccessCache,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import groupsRouter from '../../../src/api/admin/groups';

describe('Admin Groups Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/admin/groups', groupsRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();

    mockAuditLogFromRequest.mockResolvedValue(undefined);
    mockInvalidateUserAccessCache.mockResolvedValue(undefined);
  });

  it('lists groups with transformed member structure', async () => {
    mockPrismaClient.group.findMany.mockResolvedValue([
      {
        id: 'group-1',
        name: 'Team A',
        description: 'Desc',
        purpose: 'ops',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-02T00:00:00.000Z'),
        members: [
          {
            userId: 'user-1',
            role: 'member',
            user: { id: 'user-1', username: 'alice' },
          },
        ],
      },
    ] as any);

    const response = await request(app).get('/api/v1/admin/groups');

    expect(response.status).toBe(200);
    expect(mockPrismaClient.group.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
      })
    );
    expect(response.body).toEqual([
      {
        id: 'group-1',
        name: 'Team A',
        description: 'Desc',
        purpose: 'ops',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
        members: [
          {
            userId: 'user-1',
            username: 'alice',
            role: 'member',
          },
        ],
      },
    ]);
  });

  it('returns 500 when group listing fails', async () => {
    mockPrismaClient.group.findMany.mockRejectedValue(new Error('query failed'));

    const response = await request(app).get('/api/v1/admin/groups');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('validates group creation requires name', async () => {
    const response = await request(app)
      .post('/api/v1/admin/groups')
      .send({ description: 'no name' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Group name is required');
  });

  it('creates a group without members', async () => {
    mockPrismaClient.group.create.mockResolvedValue({ id: 'group-1', name: 'Team A' } as any);
    mockPrismaClient.group.findUnique.mockResolvedValue({
      id: 'group-1',
      name: 'Team A',
      description: null,
      purpose: null,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      members: [],
    } as any);

    const response = await request(app)
      .post('/api/v1/admin/groups')
      .send({ name: 'Team A' });

    expect(response.status).toBe(201);
    expect(mockPrismaClient.group.create).toHaveBeenCalledWith({
      data: {
        name: 'Team A',
        description: null,
        purpose: null,
      },
    });
    expect(mockPrismaClient.groupMember.createMany).not.toHaveBeenCalled();
    expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
      expect.any(Object),
      'group_create',
      'admin',
      expect.objectContaining({
        details: expect.objectContaining({ groupName: 'Team A', memberCount: 0 }),
      })
    );
  });

  it('creates a group with valid members only', async () => {
    mockPrismaClient.group.create.mockResolvedValue({ id: 'group-2', name: 'Team B' } as any);
    mockPrismaClient.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u3' }] as any);
    mockPrismaClient.group.findUnique.mockResolvedValue({
      id: 'group-2',
      name: 'Team B',
      description: 'desc',
      purpose: 'purpose',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      members: [
        { userId: 'u1', role: 'member', user: { id: 'u1', username: 'alice' } },
        { userId: 'u3', role: 'member', user: { id: 'u3', username: 'charlie' } },
      ],
    } as any);

    const response = await request(app)
      .post('/api/v1/admin/groups')
      .send({ name: 'Team B', description: 'desc', purpose: 'purpose', memberIds: ['u1', 'u2', 'u3'] });

    expect(response.status).toBe(201);
    expect(mockPrismaClient.groupMember.createMany).toHaveBeenCalledWith({
      data: [
        { groupId: 'group-2', userId: 'u1', role: 'member' },
        { groupId: 'group-2', userId: 'u3', role: 'member' },
      ],
      skipDuplicates: true,
    });
    expect(response.body.members).toHaveLength(2);
  });

  it('returns 500 when group creation fails', async () => {
    mockPrismaClient.group.create.mockRejectedValue(new Error('insert failed'));

    const response = await request(app)
      .post('/api/v1/admin/groups')
      .send({ name: 'broken' });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('returns 404 when updating a missing group', async () => {
    mockPrismaClient.group.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .put('/api/v1/admin/groups/missing')
      .send({ name: 'new' });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Group not found');
  });

  it('updates group fields without member update when memberIds omitted', async () => {
    mockPrismaClient.group.findUnique
      .mockResolvedValueOnce({
        id: 'group-1',
        name: 'Old',
        description: 'old desc',
        purpose: 'old purpose',
        members: [{ userId: 'u1' }],
      } as any)
      .mockResolvedValueOnce({
        id: 'group-1',
        name: 'Renamed',
        description: 'old desc',
        purpose: 'old purpose',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-03T00:00:00.000Z'),
        members: [{ userId: 'u1', role: 'member', user: { id: 'u1', username: 'alice' } }],
      } as any);

    const response = await request(app)
      .put('/api/v1/admin/groups/group-1')
      .send({ name: 'Renamed' });

    expect(response.status).toBe(200);
    expect(mockPrismaClient.group.update).toHaveBeenCalledWith({
      where: { id: 'group-1' },
      data: {
        name: 'Renamed',
        description: 'old desc',
        purpose: 'old purpose',
      },
    });
    expect(mockPrismaClient.groupMember.deleteMany).not.toHaveBeenCalled();
    expect(mockPrismaClient.groupMember.createMany).not.toHaveBeenCalled();
  });

  it('updates group members with add/remove behavior and user validation', async () => {
    mockPrismaClient.group.findUnique
      .mockResolvedValueOnce({
        id: 'group-1',
        name: 'Group',
        description: null,
        purpose: null,
        members: [{ userId: 'u1' }, { userId: 'u2' }],
      } as any)
      // setMembers internal fetch
      .mockResolvedValueOnce({
        id: 'group-1',
        members: [{ userId: 'u1' }, { userId: 'u2' }],
      } as any)
      .mockResolvedValueOnce({
        id: 'group-1',
        name: 'Group',
        description: null,
        purpose: null,
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-03T00:00:00.000Z'),
        members: [
          { userId: 'u2', role: 'member', user: { id: 'u2', username: 'bob' } },
          { userId: 'u3', role: 'member', user: { id: 'u3', username: 'charlie' } },
        ],
      } as any);

    mockPrismaClient.user.findMany.mockResolvedValue([{ id: 'u3' }] as any);

    const response = await request(app)
      .put('/api/v1/admin/groups/group-1')
      .send({ memberIds: ['u2', 'u3', 'u4'] });

    expect(response.status).toBe(200);
    expect(mockPrismaClient.groupMember.deleteMany).toHaveBeenCalledWith({
      where: { groupId: 'group-1', userId: { in: ['u1'] } },
    });
    expect(mockPrismaClient.groupMember.createMany).toHaveBeenCalledWith({
      data: [{ groupId: 'group-1', userId: 'u3', role: 'member' }],
      skipDuplicates: true,
    });
  });

  it('updates explicit description/purpose and skips member mutations when memberIds unchanged', async () => {
    mockPrismaClient.group.findUnique
      .mockResolvedValueOnce({
        id: 'group-1',
        name: 'Existing Name',
        description: 'old description',
        purpose: 'old purpose',
        members: [{ userId: 'u1' }],
      } as any)
      // setMembers internal fetch
      .mockResolvedValueOnce({
        id: 'group-1',
        members: [{ userId: 'u1' }],
      } as any)
      .mockResolvedValueOnce({
        id: 'group-1',
        name: 'Existing Name',
        description: 'new description',
        purpose: null,
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-04T00:00:00.000Z'),
        members: [{ userId: 'u1', role: 'member', user: { id: 'u1', username: 'alice' } }],
      } as any);

    const response = await request(app)
      .put('/api/v1/admin/groups/group-1')
      .send({
        description: 'new description',
        purpose: null,
        memberIds: ['u1'],
      });

    expect(response.status).toBe(200);
    expect(mockPrismaClient.group.update).toHaveBeenCalledWith({
      where: { id: 'group-1' },
      data: {
        name: 'Existing Name',
        description: 'new description',
        purpose: null,
      },
    });
    expect(mockPrismaClient.groupMember.deleteMany).not.toHaveBeenCalled();
    expect(mockPrismaClient.groupMember.createMany).not.toHaveBeenCalled();
  });

  it('updates with empty memberIds removes all members', async () => {
    mockPrismaClient.group.findUnique
      .mockResolvedValueOnce({
        id: 'group-1',
        name: 'Group',
        description: null,
        purpose: null,
        members: [{ userId: 'u1' }, { userId: 'u2' }],
      } as any)
      // setMembers internal fetch
      .mockResolvedValueOnce({
        id: 'group-1',
        members: [{ userId: 'u1' }, { userId: 'u2' }],
      } as any)
      .mockResolvedValueOnce({
        id: 'group-1',
        name: 'Group',
        description: null,
        purpose: null,
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-03T00:00:00.000Z'),
        members: [],
      } as any);

    const response = await request(app)
      .put('/api/v1/admin/groups/group-1')
      .send({ memberIds: [] });

    expect(response.status).toBe(200);
    expect(mockPrismaClient.groupMember.deleteMany).toHaveBeenCalledWith({
      where: { groupId: 'group-1', userId: { in: ['u1', 'u2'] } },
    });
    expect(mockPrismaClient.groupMember.createMany).not.toHaveBeenCalled();
    expect(response.body.members).toHaveLength(0);
  });

  it('updates with identical memberIds makes no member mutations (idempotent)', async () => {
    mockPrismaClient.group.findUnique
      .mockResolvedValueOnce({
        id: 'group-1',
        name: 'Group',
        description: null,
        purpose: null,
        members: [{ userId: 'u1' }, { userId: 'u2' }],
      } as any)
      // setMembers internal fetch
      .mockResolvedValueOnce({
        id: 'group-1',
        members: [{ userId: 'u1' }, { userId: 'u2' }],
      } as any)
      .mockResolvedValueOnce({
        id: 'group-1',
        name: 'Group',
        description: null,
        purpose: null,
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-03T00:00:00.000Z'),
        members: [
          { userId: 'u1', role: 'member', user: { id: 'u1', username: 'alice' } },
          { userId: 'u2', role: 'member', user: { id: 'u2', username: 'bob' } },
        ],
      } as any);

    const response = await request(app)
      .put('/api/v1/admin/groups/group-1')
      .send({ memberIds: ['u1', 'u2'] });

    expect(response.status).toBe(200);
    expect(mockPrismaClient.groupMember.deleteMany).not.toHaveBeenCalled();
    expect(mockPrismaClient.groupMember.createMany).not.toHaveBeenCalled();
    expect(response.body.members).toHaveLength(2);
  });

  it('updates with mix of valid and invalid userIds adds only valid ones', async () => {
    mockPrismaClient.group.findUnique
      .mockResolvedValueOnce({
        id: 'group-1',
        name: 'Group',
        description: null,
        purpose: null,
        members: [],
      } as any)
      // setMembers internal fetch
      .mockResolvedValueOnce({
        id: 'group-1',
        members: [],
      } as any)
      .mockResolvedValueOnce({
        id: 'group-1',
        name: 'Group',
        description: null,
        purpose: null,
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-03T00:00:00.000Z'),
        members: [
          { userId: 'u1', role: 'member', user: { id: 'u1', username: 'alice' } },
        ],
      } as any);

    // Only u1 exists, u99 does not
    mockPrismaClient.user.findMany.mockResolvedValue([{ id: 'u1' }] as any);

    const response = await request(app)
      .put('/api/v1/admin/groups/group-1')
      .send({ memberIds: ['u1', 'u99'] });

    expect(response.status).toBe(200);
    expect(mockPrismaClient.groupMember.createMany).toHaveBeenCalledWith({
      data: [{ groupId: 'group-1', userId: 'u1', role: 'member' }],
      skipDuplicates: true,
    });
    expect(response.body.members).toHaveLength(1);
  });

  it('returns 500 when group update fails', async () => {
    mockPrismaClient.group.findUnique.mockRejectedValue(new Error('read failed'));

    const response = await request(app)
      .put('/api/v1/admin/groups/group-1')
      .send({ name: 'x' });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('returns 404 when deleting a missing group', async () => {
    mockPrismaClient.group.findUnique.mockResolvedValue(null);

    const response = await request(app).delete('/api/v1/admin/groups/missing');

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Group not found');
  });

  it('deletes a group and writes audit log', async () => {
    mockPrismaClient.group.findUnique.mockResolvedValue({ id: 'group-1', name: 'Team A', members: [{ userId: 'u1' }] } as any);

    const response = await request(app).delete('/api/v1/admin/groups/group-1');

    expect(response.status).toBe(200);
    expect(mockPrismaClient.group.delete).toHaveBeenCalledWith({ where: { id: 'group-1' } });
    expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
      expect.any(Object),
      'group_delete',
      'admin',
      expect.objectContaining({ details: { groupName: 'Team A', groupId: 'group-1' } })
    );
    expect(response.body).toEqual({ message: 'Group deleted successfully' });
    expect(mockInvalidateUserAccessCache).toHaveBeenCalledWith('u1');
  });

  it('returns 500 when group deletion fails', async () => {
    mockPrismaClient.group.findUnique.mockResolvedValue({ id: 'group-1', name: 'x', members: [] } as any);
    mockPrismaClient.group.delete.mockRejectedValue(new Error('delete failed'));

    const response = await request(app).delete('/api/v1/admin/groups/group-1');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('validates add-member requires userId', async () => {
    const response = await request(app)
      .post('/api/v1/admin/groups/group-1/members')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('User ID is required');
  });

  it('validates add-member role values', async () => {
    const response = await request(app)
      .post('/api/v1/admin/groups/group-1/members')
      .send({ userId: 'u1', role: 'owner' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Group member role must be member or admin');
    expect(mockPrismaClient.group.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when adding member to missing group', async () => {
    mockPrismaClient.group.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/v1/admin/groups/group-1/members')
      .send({ userId: 'u1' });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Group not found');
  });

  it('returns 404 when adding missing user to a group', async () => {
    mockPrismaClient.group.findUnique.mockResolvedValue({ id: 'group-1' } as any);
    mockPrismaClient.user.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/v1/admin/groups/group-1/members')
      .send({ userId: 'u1' });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('User not found');
  });

  it('returns 409 when adding duplicate group membership', async () => {
    mockPrismaClient.group.findUnique.mockResolvedValue({ id: 'group-1' } as any);
    mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'u1', username: 'alice' } as any);
    mockPrismaClient.groupMember.findUnique.mockResolvedValue({ userId: 'u1', groupId: 'group-1' } as any);

    const response = await request(app)
      .post('/api/v1/admin/groups/group-1/members')
      .send({ userId: 'u1' });

    expect(response.status).toBe(409);
    expect(response.body.message).toBe('User is already a member of this group');
  });

  it('adds group member with default and explicit roles', async () => {
    mockPrismaClient.group.findUnique.mockResolvedValue({ id: 'group-1' } as any);
    mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'u1', username: 'alice' } as any);
    mockPrismaClient.groupMember.findUnique.mockResolvedValue(null);
    mockPrismaClient.groupMember.create
      .mockResolvedValueOnce({ groupId: 'group-1', userId: 'u1', role: 'member' } as any)
      .mockResolvedValueOnce({ groupId: 'group-1', userId: 'u1', role: 'admin' } as any);

    const defaultRole = await request(app)
      .post('/api/v1/admin/groups/group-1/members')
      .send({ userId: 'u1' });

    expect(defaultRole.status).toBe(201);
    expect(defaultRole.body).toEqual({ userId: 'u1', username: 'alice', role: 'member' });

    const explicitRole = await request(app)
      .post('/api/v1/admin/groups/group-1/members')
      .send({ userId: 'u1', role: 'admin' });

    expect(explicitRole.status).toBe(201);
    expect(explicitRole.body).toEqual({ userId: 'u1', username: 'alice', role: 'admin' });
    expect(mockInvalidateUserAccessCache).toHaveBeenCalledWith('u1');
    expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
      expect.any(Object),
      'group_member_add',
      'admin',
      expect.objectContaining({
        details: expect.objectContaining({ groupId: 'group-1', targetUser: 'alice' }),
      })
    );
  });

  it('returns 500 when add-member flow fails', async () => {
    mockPrismaClient.group.findUnique.mockRejectedValue(new Error('lookup failed'));

    const response = await request(app)
      .post('/api/v1/admin/groups/group-1/members')
      .send({ userId: 'u1' });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('returns 404 when removing a non-member', async () => {
    mockPrismaClient.groupMember.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .delete('/api/v1/admin/groups/group-1/members/u1');

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Member not found in this group');
  });

  it('removes a member and invalidates cache', async () => {
    mockPrismaClient.groupMember.findUnique.mockResolvedValue({ groupId: 'group-1', userId: 'u1' } as any);

    const response = await request(app)
      .delete('/api/v1/admin/groups/group-1/members/u1');

    expect(response.status).toBe(200);
    expect(mockPrismaClient.groupMember.delete).toHaveBeenCalledWith({
      where: { userId_groupId: { userId: 'u1', groupId: 'group-1' } },
    });
    expect(mockInvalidateUserAccessCache).toHaveBeenCalledWith('u1');
    expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
      expect.any(Object),
      'group_member_remove',
      'admin',
      expect.objectContaining({ details: { groupId: 'group-1', userId: 'u1' } })
    );
    expect(response.body).toEqual({ message: 'Member removed from group successfully' });
  });

  it('returns 500 when remove-member flow fails', async () => {
    mockPrismaClient.groupMember.findUnique.mockRejectedValue(new Error('lookup failed'));

    const response = await request(app)
      .delete('/api/v1/admin/groups/group-1/members/u1');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });
});
