import prisma from '../models/prisma';
import type { Group, GroupMember } from '../generated/prisma/client';

const membersInclude = {
  members: {
    include: {
      user: {
        select: { id: true, username: true },
      },
    },
  },
} as const;

export async function findAllWithMembers() {
  return prisma.group.findMany({
    include: membersInclude,
    orderBy: { createdAt: 'desc' },
  });
}

export async function findByIdWithMembers(groupId: string) {
  return prisma.group.findUnique({
    where: { id: groupId },
    include: membersInclude,
  });
}

export async function findById(groupId: string) {
  return prisma.group.findUnique({
    where: { id: groupId },
  });
}

export async function create(data: {
  name: string;
  description?: string | null;
  purpose?: string | null;
}) {
  return prisma.group.create({ data });
}

export async function update(
  groupId: string,
  data: { name?: string; description?: string | null; purpose?: string | null },
) {
  return prisma.group.update({
    where: { id: groupId },
    data,
  });
}

/**
 * Delete a group and return it with member userIds for cache invalidation.
 */
export async function deleteById(groupId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { members: { select: { userId: true } } },
  });
  if (!group) return null;

  await prisma.group.delete({ where: { id: groupId } });
  return group;
}

/**
 * Add members to a group, validating that the users exist. Skips duplicates.
 */
export async function addMembers(groupId: string, userIds: string[], role = 'member') {
  const existingUserIds = await findExistingUserIds(userIds);

  await prisma.groupMember.createMany({
    data: existingUserIds.map((userId) => ({ groupId, userId, role })),
    skipDuplicates: true,
  });
}

/**
 * Replace all members of a group by computing the diff and adding/removing as needed.
 * Validates that new members exist before adding.
 */
export async function setMembers(groupId: string, memberIds: string[]) {
  const existing = await prisma.group.findUnique({
    where: { id: groupId },
    include: { members: true },
  });
  if (!existing) return null;

  const currentMemberIds = existing.members.map(m => m.userId);
  const toAdd = memberIds.filter((id: string) => !currentMemberIds.includes(id));
  const toRemove = currentMemberIds.filter(id => !memberIds.includes(id));

  if (toRemove.length > 0) {
    await prisma.groupMember.deleteMany({
      where: { groupId, userId: { in: toRemove } },
    });
  }

  if (toAdd.length > 0) {
    const validIds = await findExistingUserIds(toAdd);
    await prisma.groupMember.createMany({
      data: validIds.map((userId) => ({ groupId, userId, role: 'member' })),
      skipDuplicates: true,
    });
  }
}

export async function addMember(
  groupId: string,
  userId: string,
  role = 'member',
): Promise<GroupMember> {
  return prisma.groupMember.create({
    data: { groupId, userId, role },
  });
}

export async function removeMember(groupId: string, userId: string) {
  return prisma.groupMember.delete({
    where: { userId_groupId: { userId, groupId } },
  });
}

export async function findMembership(userId: string, groupId: string): Promise<GroupMember | null> {
  return prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
  });
}

/**
 * Validate which user IDs exist in the database. Returns the subset that exist.
 */
export async function findExistingUserIds(userIds: string[]) {
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/**
 * Find groups that a user is a member of
 */
export async function findByUserId(userId: string) {
  return prisma.group.findMany({
    where: {
      members: {
        some: { userId },
      },
    },
    select: {
      id: true,
      name: true,
      description: true,
      members: {
        select: {
          userId: true,
          role: true,
        },
      },
    },
  });
}

const groupRepository = {
  findAllWithMembers,
  findByIdWithMembers,
  findById,
  create,
  update,
  deleteById,
  addMembers,
  setMembers,
  addMember,
  removeMember,
  findMembership,
  findExistingUserIds,
  findByUserId,
};

export default groupRepository;
