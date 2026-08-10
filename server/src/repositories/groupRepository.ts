import prisma, { type PrismaTxClient } from '../models/prisma';
import type { Group, GroupMember } from '../generated/prisma/client';
import { ConflictError } from '../errors/ApiError';
import { isSerializableTransactionConflict } from '../utils/prismaSerializableConflict';

export interface SetMembersResult {
  addedUserIds: string[];
  removedUserIds: string[];
}

export interface AtomicGroupResult {
  group: NonNullable<Awaited<ReturnType<typeof findByIdWithMembers>>>;
  membershipChanges: SetMembersResult;
}

const MAX_GROUP_TRANSACTION_ATTEMPTS = 3;

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

export async function createWithMembers(data: {
  name: string;
  description?: string | null;
  purpose?: string | null;
  memberIds: string[];
}): Promise<AtomicGroupResult> {
  return withGroupTransactionRetry(async () => {
    return prisma.$transaction(async (tx) => {
      const normalizedMemberIds = [...new Set(data.memberIds)];
      const users = await tx.user.findMany({
        where: { id: { in: normalizedMemberIds } },
        select: { id: true },
      });
      const validUserIds = users.map(({ id }) => id);
      const group = await tx.group.create({
        data: {
          name: data.name,
          description: data.description ?? null,
          purpose: data.purpose ?? null,
          members: {
            create: validUserIds.map((userId) => ({ userId, role: 'member' })),
          },
        },
        include: membersInclude,
      });
      return {
        group,
        membershipChanges: { addedUserIds: validUserIds, removedUserIds: [] },
      };
    }, { isolationLevel: 'Serializable' });
  });
}

export async function updateWithMembers(
  groupId: string,
  data: { name?: string; description?: string | null; purpose?: string | null },
  memberIds?: string[],
): Promise<AtomicGroupResult | null> {
  return withGroupTransactionRetry(async () => {
    return prisma.$transaction(async (tx) => {
      const locked = await tx.group.updateMany({
        where: { id: groupId },
        data: { updatedAt: new Date() },
      });
      if (locked.count === 0) return null;

      const current = await tx.group.findUnique({
        where: { id: groupId },
        include: { members: true },
      });
      /* v8 ignore next -- the transaction-owned update above proves existence. */
      if (!current) return null;

      const changes = memberIds === undefined
        ? { addedUserIds: [], removedUserIds: [] }
        : await replaceMembersInTransaction(tx, groupId, current.members, memberIds);
      const group = await tx.group.update({
        where: { id: groupId },
        data,
        include: membersInclude,
      });
      return { group, membershipChanges: changes };
    }, { isolationLevel: 'Serializable' });
  });
}

async function replaceMembersInTransaction(
  tx: PrismaTxClient,
  groupId: string,
  currentMembers: GroupMember[],
  requestedIds: string[],
): Promise<SetMembersResult> {
  const normalizedIds = [...new Set(requestedIds)];
  const users = await tx.user.findMany({
    where: { id: { in: normalizedIds } },
    select: { id: true },
  });
  const validIds = users.map(({ id }) => id);
  const currentIds = new Set(currentMembers.map(({ userId }) => userId));
  const requested = new Set(validIds);
  const addedUserIds = validIds.filter((id) => !currentIds.has(id));
  const removedUserIds = [...currentIds].filter((id) => !requested.has(id));

  if (removedUserIds.length > 0) {
    await tx.groupMember.deleteMany({
      where: { groupId, userId: { in: removedUserIds } },
    });
  }
  if (addedUserIds.length > 0) {
    await tx.groupMember.createMany({
      data: addedUserIds.map((userId) => ({ groupId, userId, role: 'member' })),
      skipDuplicates: false,
    });
  }
  return { addedUserIds, removedUserIds };
}

async function withGroupTransactionRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_GROUP_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializableTransactionConflict(error)) throw error;
      if (attempt === MAX_GROUP_TRANSACTION_ATTEMPTS) {
        throw new ConflictError('Group changed concurrently; please retry');
      }
    }
  }
  /* v8 ignore next -- every loop path returns or throws. */
  throw new ConflictError('Group changed concurrently; please retry');
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
export async function setMembers(
  groupId: string,
  memberIds: string[],
): Promise<SetMembersResult | null> {
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
    if (validIds.length > 0) {
      await prisma.groupMember.createMany({
        data: validIds.map((userId) => ({ groupId, userId, role: 'member' })),
        skipDuplicates: true,
      });
    }
    return { addedUserIds: validIds, removedUserIds: toRemove };
  }

  return { addedUserIds: [], removedUserIds: toRemove };
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
  createWithMembers,
  update,
  updateWithMembers,
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
