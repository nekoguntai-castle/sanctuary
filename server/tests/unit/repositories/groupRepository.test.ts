/**
 * Group Repository Tests
 *
 * Tests for group data access operations including member management.
 */

import { vi, Mock } from 'vitest';

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    group: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    groupMember: {
      createMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  },
}));

import prisma from '../../../src/models/prisma';
import groupRepository from '../../../src/repositories/groupRepository';

describe('Group Repository', () => {
  const mockGroup = {
    id: 'group-1',
    name: 'Test Group',
    description: 'A test group',
    purpose: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockGroupWithMembers = {
    ...mockGroup,
    members: [
      {
        userId: 'user-1',
        groupId: 'group-1',
        role: 'member',
        user: { id: 'user-1', username: 'alice' },
      },
    ],
  };

  const mockMember = {
    userId: 'user-1',
    groupId: 'group-1',
    role: 'member',
    createdAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findAllWithMembers', () => {
    it('should find all groups with members ordered by createdAt desc', async () => {
      (prisma.group.findMany as Mock).mockResolvedValue([mockGroupWithMembers]);

      const result = await groupRepository.findAllWithMembers();

      expect(result).toEqual([mockGroupWithMembers]);
      expect(prisma.group.findMany).toHaveBeenCalledWith({
        include: {
          members: {
            include: {
              user: { select: { id: true, username: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findByIdWithMembers', () => {
    it('should find group with members by id', async () => {
      (prisma.group.findUnique as Mock).mockResolvedValue(mockGroupWithMembers);

      const result = await groupRepository.findByIdWithMembers('group-1');

      expect(result).toEqual(mockGroupWithMembers);
      expect(prisma.group.findUnique).toHaveBeenCalledWith({
        where: { id: 'group-1' },
        include: {
          members: {
            include: {
              user: { select: { id: true, username: true } },
            },
          },
        },
      });
    });

    it('should return null when group not found', async () => {
      (prisma.group.findUnique as Mock).mockResolvedValue(null);

      const result = await groupRepository.findByIdWithMembers('missing');

      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('should find group by id without members', async () => {
      (prisma.group.findUnique as Mock).mockResolvedValue(mockGroup);

      const result = await groupRepository.findById('group-1');

      expect(result).toEqual(mockGroup);
      expect(prisma.group.findUnique).toHaveBeenCalledWith({
        where: { id: 'group-1' },
      });
    });
  });

  describe('create', () => {
    it('should create a group', async () => {
      (prisma.group.create as Mock).mockResolvedValue(mockGroup);

      const result = await groupRepository.create({
        name: 'Test Group',
        description: 'A test group',
      });

      expect(result).toEqual(mockGroup);
      expect(prisma.group.create).toHaveBeenCalledWith({
        data: { name: 'Test Group', description: 'A test group' },
      });
    });

    it('should create group with optional purpose', async () => {
      (prisma.group.create as Mock).mockResolvedValue(mockGroup);

      await groupRepository.create({
        name: 'Test Group',
        purpose: 'Testing',
      });

      expect(prisma.group.create).toHaveBeenCalledWith({
        data: { name: 'Test Group', purpose: 'Testing' },
      });
    });
  });

  describe('update', () => {
    it('should update group by id', async () => {
      const updated = { ...mockGroup, name: 'Updated' };
      (prisma.group.update as Mock).mockResolvedValue(updated);

      const result = await groupRepository.update('group-1', { name: 'Updated' });

      expect(result).toEqual(updated);
      expect(prisma.group.update).toHaveBeenCalledWith({
        where: { id: 'group-1' },
        data: { name: 'Updated' },
      });
    });
  });

  describe('deleteById', () => {
    it('should delete group and return it with member userIds', async () => {
      const groupWithMemberIds = {
        ...mockGroup,
        members: [{ userId: 'user-1' }, { userId: 'user-2' }],
      };
      (prisma.group.findUnique as Mock).mockResolvedValue(groupWithMemberIds);
      (prisma.group.delete as Mock).mockResolvedValue(mockGroup);

      const result = await groupRepository.deleteById('group-1');

      expect(result).toEqual(groupWithMemberIds);
      expect(prisma.group.delete).toHaveBeenCalledWith({
        where: { id: 'group-1' },
      });
    });

    it('should return null when group does not exist', async () => {
      (prisma.group.findUnique as Mock).mockResolvedValue(null);

      const result = await groupRepository.deleteById('missing');

      expect(result).toBeNull();
      expect(prisma.group.delete).not.toHaveBeenCalled();
    });
  });

  describe('addMembers', () => {
    it('should add validated members to group', async () => {
      (prisma.user.findMany as Mock).mockResolvedValue([
        { id: 'user-1' },
        { id: 'user-2' },
      ]);
      (prisma.groupMember.createMany as Mock).mockResolvedValue({ count: 2 });

      await groupRepository.addMembers('group-1', ['user-1', 'user-2', 'user-3']);

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['user-1', 'user-2', 'user-3'] } },
        select: { id: true },
      });
      expect(prisma.groupMember.createMany).toHaveBeenCalledWith({
        data: [
          { groupId: 'group-1', userId: 'user-1', role: 'member' },
          { groupId: 'group-1', userId: 'user-2', role: 'member' },
        ],
        skipDuplicates: true,
      });
    });

    it('should use custom role when provided', async () => {
      (prisma.user.findMany as Mock).mockResolvedValue([{ id: 'user-1' }]);
      (prisma.groupMember.createMany as Mock).mockResolvedValue({ count: 1 });

      await groupRepository.addMembers('group-1', ['user-1'], 'admin');

      expect(prisma.groupMember.createMany).toHaveBeenCalledWith({
        data: [{ groupId: 'group-1', userId: 'user-1', role: 'admin' }],
        skipDuplicates: true,
      });
    });
  });

  describe('setMembers', () => {
    it('should replace members by computing diff', async () => {
      (prisma.group.findUnique as Mock).mockResolvedValue({
        ...mockGroup,
        members: [
          { userId: 'user-1' },
          { userId: 'user-2' },
        ],
      });
      (prisma.user.findMany as Mock).mockResolvedValue([{ id: 'user-3' }]);
      (prisma.groupMember.deleteMany as Mock).mockResolvedValue({ count: 1 });
      (prisma.groupMember.createMany as Mock).mockResolvedValue({ count: 1 });

      await groupRepository.setMembers('group-1', ['user-1', 'user-3']);

      // Should remove user-2
      expect(prisma.groupMember.deleteMany).toHaveBeenCalledWith({
        where: { groupId: 'group-1', userId: { in: ['user-2'] } },
      });
      // Should add user-3
      expect(prisma.groupMember.createMany).toHaveBeenCalledWith({
        data: [{ groupId: 'group-1', userId: 'user-3', role: 'member' }],
        skipDuplicates: true,
      });
    });

    it('should return null when group does not exist', async () => {
      (prisma.group.findUnique as Mock).mockResolvedValue(null);

      const result = await groupRepository.setMembers('missing', ['user-1']);

      expect(result).toBeNull();
      expect(prisma.groupMember.deleteMany).not.toHaveBeenCalled();
    });

    it('should skip delete when no members to remove', async () => {
      (prisma.group.findUnique as Mock).mockResolvedValue({
        ...mockGroup,
        members: [{ userId: 'user-1' }],
      });
      (prisma.user.findMany as Mock).mockResolvedValue([{ id: 'user-2' }]);
      (prisma.groupMember.createMany as Mock).mockResolvedValue({ count: 1 });

      await groupRepository.setMembers('group-1', ['user-1', 'user-2']);

      expect(prisma.groupMember.deleteMany).not.toHaveBeenCalled();
      expect(prisma.groupMember.createMany).toHaveBeenCalled();
    });

    it('should skip add when no new members', async () => {
      (prisma.group.findUnique as Mock).mockResolvedValue({
        ...mockGroup,
        members: [{ userId: 'user-1' }, { userId: 'user-2' }],
      });
      (prisma.groupMember.deleteMany as Mock).mockResolvedValue({ count: 1 });

      await groupRepository.setMembers('group-1', ['user-1']);

      expect(prisma.groupMember.deleteMany).toHaveBeenCalledWith({
        where: { groupId: 'group-1', userId: { in: ['user-2'] } },
      });
      expect(prisma.groupMember.createMany).not.toHaveBeenCalled();
    });
  });

  describe('addMember', () => {
    it('should add a single member', async () => {
      (prisma.groupMember.create as Mock).mockResolvedValue(mockMember);

      const result = await groupRepository.addMember('group-1', 'user-1');

      expect(result).toEqual(mockMember);
      expect(prisma.groupMember.create).toHaveBeenCalledWith({
        data: { groupId: 'group-1', userId: 'user-1', role: 'member' },
      });
    });

    it('should use custom role', async () => {
      (prisma.groupMember.create as Mock).mockResolvedValue(mockMember);

      await groupRepository.addMember('group-1', 'user-1', 'admin');

      expect(prisma.groupMember.create).toHaveBeenCalledWith({
        data: { groupId: 'group-1', userId: 'user-1', role: 'admin' },
      });
    });
  });

  describe('removeMember', () => {
    it('should remove a member by composite key', async () => {
      (prisma.groupMember.delete as Mock).mockResolvedValue(mockMember);

      const result = await groupRepository.removeMember('group-1', 'user-1');

      expect(result).toEqual(mockMember);
      expect(prisma.groupMember.delete).toHaveBeenCalledWith({
        where: { userId_groupId: { userId: 'user-1', groupId: 'group-1' } },
      });
    });
  });

  describe('findMembership', () => {
    it('should find a membership by composite key', async () => {
      (prisma.groupMember.findUnique as Mock).mockResolvedValue(mockMember);

      const result = await groupRepository.findMembership('user-1', 'group-1');

      expect(result).toEqual(mockMember);
      expect(prisma.groupMember.findUnique).toHaveBeenCalledWith({
        where: { userId_groupId: { userId: 'user-1', groupId: 'group-1' } },
      });
    });

    it('should return null when membership not found', async () => {
      (prisma.groupMember.findUnique as Mock).mockResolvedValue(null);

      const result = await groupRepository.findMembership('user-1', 'group-2');

      expect(result).toBeNull();
    });
  });

  describe('findExistingUserIds', () => {
    it('should return subset of user ids that exist', async () => {
      (prisma.user.findMany as Mock).mockResolvedValue([
        { id: 'user-1' },
        { id: 'user-3' },
      ]);

      const result = await groupRepository.findExistingUserIds([
        'user-1',
        'user-2',
        'user-3',
      ]);

      expect(result).toEqual(['user-1', 'user-3']);
    });

    it('should return empty array when no users exist', async () => {
      (prisma.user.findMany as Mock).mockResolvedValue([]);

      const result = await groupRepository.findExistingUserIds(['missing-1', 'missing-2']);

      expect(result).toEqual([]);
    });
  });
});
