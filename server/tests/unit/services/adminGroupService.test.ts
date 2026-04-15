import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findAllWithMembers: vi.fn(),
  findByIdWithMembers: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  deleteById: vi.fn(),
  addMembers: vi.fn(),
  setMembers: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  findMembership: vi.fn(),
  findUserById: vi.fn(),
  invalidateUserAccessCache: vi.fn(),
}));

vi.mock('../../../src/repositories/groupRepository', () => ({
  findAllWithMembers: mocks.findAllWithMembers,
  findByIdWithMembers: mocks.findByIdWithMembers,
  findById: mocks.findById,
  create: mocks.create,
  update: mocks.update,
  deleteById: mocks.deleteById,
  addMembers: mocks.addMembers,
  setMembers: mocks.setMembers,
  addMember: mocks.addMember,
  removeMember: mocks.removeMember,
  findMembership: mocks.findMembership,
}));

vi.mock('../../../src/repositories/userRepository', () => ({
  findById: mocks.findUserById,
}));

vi.mock('../../../src/services/accessControl', () => ({
  invalidateUserAccessCache: mocks.invalidateUserAccessCache,
}));

const loadService = async () => {
  vi.resetModules();
  return import('../../../src/services/adminGroupService');
};

describe('adminGroupService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invalidateUserAccessCache.mockResolvedValue(undefined);
  });

  it('lists groups using the API member shape', async () => {
    mocks.findAllWithMembers.mockResolvedValue([
      {
        id: 'group-1',
        name: 'Team A',
        description: null,
        purpose: 'ops',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-02T00:00:00.000Z'),
        members: [
          { userId: 'user-1', role: 'admin', user: { id: 'user-1', username: 'alice' } },
        ],
      },
    ]);
    const { listAdminGroups } = await loadService();

    await expect(listAdminGroups()).resolves.toEqual([
      {
        id: 'group-1',
        name: 'Team A',
        description: null,
        purpose: 'ops',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-02T00:00:00.000Z'),
        members: [{ userId: 'user-1', username: 'alice', role: 'admin' }],
      },
    ]);
  });

  it('creates a group with validated members and returns the full formatted group', async () => {
    mocks.create.mockResolvedValue({ id: 'group-2', name: 'Team B' });
    mocks.addMembers.mockResolvedValue(undefined);
    mocks.findByIdWithMembers.mockResolvedValue({
      id: 'group-2',
      name: 'Team B',
      description: 'desc',
      purpose: null,
      createdAt: new Date('2025-01-03T00:00:00.000Z'),
      updatedAt: new Date('2025-01-03T00:00:00.000Z'),
      members: [
        { userId: 'user-2', role: 'member', user: { id: 'user-2', username: 'bob' } },
      ],
    });
    const { createAdminGroup } = await loadService();

    const response = await createAdminGroup({
      name: 'Team B',
      description: 'desc',
      memberIds: ['user-2'],
    });

    expect(mocks.create).toHaveBeenCalledWith({
      name: 'Team B',
      description: 'desc',
      purpose: null,
    });
    expect(mocks.addMembers).toHaveBeenCalledWith('group-2', ['user-2']);
    expect(response.members).toEqual([{ userId: 'user-2', username: 'bob', role: 'member' }]);
  });

  it('deletes groups and invalidates former member access caches', async () => {
    mocks.deleteById.mockResolvedValue({
      id: 'group-3',
      name: 'Team C',
      members: [{ userId: 'user-1' }, { userId: 'user-2' }],
    });
    const { deleteAdminGroup } = await loadService();

    await expect(deleteAdminGroup('group-3')).resolves.toEqual({
      id: 'group-3',
      name: 'Team C',
    });
    expect(mocks.invalidateUserAccessCache).toHaveBeenCalledWith('user-1');
    expect(mocks.invalidateUserAccessCache).toHaveBeenCalledWith('user-2');
  });

  it('rejects duplicate group membership before mutating access caches', async () => {
    mocks.findById.mockResolvedValue({ id: 'group-4' });
    mocks.findUserById.mockResolvedValue({ id: 'user-4', username: 'dana' });
    mocks.findMembership.mockResolvedValue({ groupId: 'group-4', userId: 'user-4' });
    const { addAdminGroupMember } = await loadService();

    await expect(addAdminGroupMember('group-4', 'user-4', 'member')).rejects.toMatchObject({
      statusCode: 409,
      message: 'User is already a member of this group',
    });
    expect(mocks.addMember).not.toHaveBeenCalled();
    expect(mocks.invalidateUserAccessCache).not.toHaveBeenCalled();
  });
});
