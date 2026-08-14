import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findAllWithMembers: vi.fn(),
  findByIdWithMembers: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  createWithMembers: vi.fn(),
  update: vi.fn(),
  updateWithMembers: vi.fn(),
  deleteById: vi.fn(),
  addMembers: vi.fn(),
  setMembers: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  findMembership: vi.fn(),
  findUserById: vi.fn(),
  clearAccessCacheStrict: vi.fn(),
  invalidateUserAccessCache: vi.fn(),
  invalidateWebSocketWalletAccess: vi.fn(),
}));

vi.mock('../../../src/repositories/groupRepository', () => ({
  findAllWithMembers: mocks.findAllWithMembers,
  findByIdWithMembers: mocks.findByIdWithMembers,
  findById: mocks.findById,
  create: mocks.create,
  createWithMembers: mocks.createWithMembers,
  update: mocks.update,
  updateWithMembers: mocks.updateWithMembers,
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
  clearAccessCacheStrict: mocks.clearAccessCacheStrict,
  invalidateUserAccessCacheStrict: mocks.invalidateUserAccessCache,
}));

vi.mock('../../../src/services/websocketAuthorizationInvalidation', () => ({
  invalidateWebSocketWalletAccess: mocks.invalidateWebSocketWalletAccess,
}));

const loadService = async () => {
  vi.resetModules();
  return import('../../../src/services/adminGroupService');
};

describe('adminGroupService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clearAccessCacheStrict.mockResolvedValue(undefined);
    mocks.invalidateUserAccessCache.mockResolvedValue(undefined);
    mocks.invalidateWebSocketWalletAccess.mockResolvedValue(undefined);
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
    const group = {
      id: 'group-2',
      name: 'Team B',
      description: 'desc',
      purpose: null,
      createdAt: new Date('2025-01-03T00:00:00.000Z'),
      updatedAt: new Date('2025-01-03T00:00:00.000Z'),
      members: [
        { userId: 'user-2', role: 'member', user: { id: 'user-2', username: 'bob' } },
      ],
    };
    mocks.createWithMembers.mockResolvedValue({
      group,
      membershipChanges: { addedUserIds: ['user-2'], removedUserIds: [] },
      affectedWalletIds: [],
    });
    const { createAdminGroup } = await loadService();

    const response = await createAdminGroup({
      name: 'Team B',
      description: 'desc',
      memberIds: ['user-2'],
    });

    expect(mocks.createWithMembers).toHaveBeenCalledWith({
      name: 'Team B',
      description: 'desc',
      purpose: null,
      memberIds: ['user-2'],
    });
    expect(mocks.invalidateUserAccessCache).toHaveBeenCalledWith('user-2');
    expect(response.members).toEqual([{ userId: 'user-2', username: 'bob', role: 'member' }]);
  });

  it('updates group members and clears committed access decisions after the transaction', async () => {
    const group = {
      id: 'group-2',
      name: 'Team B',
      description: null,
      purpose: null,
      createdAt: new Date('2025-01-03T00:00:00.000Z'),
      updatedAt: new Date('2025-01-04T00:00:00.000Z'),
      members: [
        { userId: 'user-2', role: 'member', user: { id: 'user-2', username: 'bob' } },
        { userId: 'user-3', role: 'member', user: { id: 'user-3', username: 'cara' } },
      ],
    };
    mocks.updateWithMembers.mockResolvedValue({
      group,
      membershipChanges: { addedUserIds: ['user-3'], removedUserIds: ['user-1'] },
      affectedWalletIds: ['wallet-1'],
    });
    const { updateAdminGroup } = await loadService();

    const response = await updateAdminGroup('group-2', {
      memberIds: ['user-2', 'user-3'],
    });

    expect(mocks.updateWithMembers).toHaveBeenCalledWith(
      'group-2',
      {},
      ['user-2', 'user-3'],
    );
    expect(mocks.clearAccessCacheStrict).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateWebSocketWalletAccess).toHaveBeenCalledWith(['wallet-1']);
    expect(mocks.updateWithMembers.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clearAccessCacheStrict.mock.invocationCallOrder[0],
    );
    expect(response.members).toEqual([
      { userId: 'user-2', username: 'bob', role: 'member' },
      { userId: 'user-3', username: 'cara', role: 'member' },
    ]);
  });

  it('clears caches for idempotent bulk member updates', async () => {
    const group = {
      id: 'group-2',
      name: 'Team B',
      description: null,
      purpose: null,
      createdAt: new Date('2025-01-03T00:00:00.000Z'),
      updatedAt: new Date('2025-01-04T00:00:00.000Z'),
      members: [
        { userId: 'user-2', role: 'member', user: { id: 'user-2', username: 'bob' } },
      ],
    };
    mocks.updateWithMembers.mockResolvedValue({
      group,
      membershipChanges: { addedUserIds: [], removedUserIds: [] },
      affectedWalletIds: ['wallet-1'],
    });
    const { updateAdminGroup } = await loadService();

    await updateAdminGroup('group-2', { memberIds: ['user-2'] });

    expect(mocks.updateWithMembers).toHaveBeenCalledWith('group-2', {}, ['user-2']);
    expect(mocks.clearAccessCacheStrict).toHaveBeenCalledTimes(1);
  });

  it('repairs a failed post-commit invalidation on an identical retry', async () => {
    const staleAccessDecisions = new Set(['user-1:wallet-1']);
    const group = {
      id: 'group-2',
      name: 'Team B',
      description: null,
      purpose: null,
      createdAt: new Date('2025-01-03T00:00:00.000Z'),
      updatedAt: new Date('2025-01-04T00:00:00.000Z'),
      members: [
        { userId: 'user-2', role: 'member', user: { id: 'user-2', username: 'bob' } },
      ],
    };
    mocks.updateWithMembers
      .mockResolvedValueOnce({
        group,
        membershipChanges: { addedUserIds: [], removedUserIds: ['user-1'] },
        affectedWalletIds: ['wallet-1'],
      })
      .mockResolvedValueOnce({
        group,
        membershipChanges: { addedUserIds: [], removedUserIds: [] },
        affectedWalletIds: ['wallet-1'],
      });
    mocks.clearAccessCacheStrict
      .mockRejectedValueOnce(new Error('cache down'))
      .mockImplementationOnce(async () => {
        staleAccessDecisions.clear();
      });
    const { updateAdminGroup } = await loadService();
    const input = { memberIds: ['user-2'] };

    await expect(updateAdminGroup('group-2', input)).rejects.toThrow('cache down');
    expect(staleAccessDecisions).toContain('user-1:wallet-1');
    await expect(updateAdminGroup('group-2', input)).resolves.toMatchObject({
      id: 'group-2',
      members: [{ userId: 'user-2' }],
    });

    expect(staleAccessDecisions).toEqual(new Set());
    expect(mocks.updateWithMembers).toHaveBeenCalledTimes(2);
    expect(mocks.clearAccessCacheStrict).toHaveBeenCalledTimes(2);
  });

  it('does not invalidate caches when bulk member replacement fails', async () => {
    mocks.updateWithMembers.mockRejectedValue(new Error('membership write failed'));
    const { updateAdminGroup } = await loadService();

    await expect(updateAdminGroup('group-2', { memberIds: ['user-3'] })).rejects.toThrow(
      'membership write failed',
    );
    expect(mocks.invalidateUserAccessCache).not.toHaveBeenCalled();
    expect(mocks.clearAccessCacheStrict).not.toHaveBeenCalled();
    expect(mocks.updateWithMembers).toHaveBeenCalledTimes(1);
  });

  it('deletes groups and invalidates former member access caches', async () => {
    mocks.deleteById.mockResolvedValue({
      id: 'group-3',
      name: 'Team C',
      members: [{ userId: 'user-1' }, { userId: 'user-2' }],
      wallets: [{ id: 'wallet-1' }],
    });
    const { deleteAdminGroup } = await loadService();

    await expect(deleteAdminGroup('group-3')).resolves.toEqual({
      id: 'group-3',
      name: 'Team C',
    });
    expect(mocks.invalidateUserAccessCache).toHaveBeenCalledWith('user-1');
    expect(mocks.invalidateUserAccessCache).toHaveBeenCalledWith('user-2');
    expect(mocks.invalidateWebSocketWalletAccess).toHaveBeenCalledWith(['wallet-1']);
  });

  it('removes a member and invalidates wallets returned by the committed transaction', async () => {
    mocks.removeMember.mockResolvedValue({
      membership: { groupId: 'group-4', userId: 'user-4' },
      affectedWalletIds: ['wallet-1', 'wallet-2'],
    });
    const { removeAdminGroupMember } = await loadService();

    await expect(removeAdminGroupMember('group-4', 'user-4')).resolves.toBeUndefined();

    expect(mocks.invalidateWebSocketWalletAccess).toHaveBeenCalledWith([
      'wallet-1',
      'wallet-2',
    ]);
    expect(mocks.invalidateUserAccessCache).toHaveBeenCalledWith('user-4');
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
