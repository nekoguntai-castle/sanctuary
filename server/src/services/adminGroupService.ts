import { NotFoundError, ConflictError } from '../errors/ApiError';
import { clearAccessCacheStrict, invalidateUserAccessCacheStrict } from './accessControl';
import * as groupRepo from '../repositories/groupRepository';
import { findById as findUserById } from '../repositories/userRepository';
import { invalidateWebSocketWalletAccess } from './websocketAuthorizationInvalidation';

type GroupWithMembers = NonNullable<Awaited<ReturnType<typeof groupRepo.findByIdWithMembers>>>;
type SetMembersResult = groupRepo.SetMembersResult;

export type AdminGroupInput = {
  name?: string;
  description?: string | null;
  purpose?: string | null;
  memberIds?: string[];
};

export type CreateAdminGroupInput = AdminGroupInput & {
  name: string;
};

export type AdminGroupMemberRole = 'member' | 'admin';

export type AdminGroupResponse = {
  id: string;
  name: string;
  description: string | null;
  purpose: string | null;
  createdAt: Date;
  updatedAt: Date;
  members: Array<{
    userId: string;
    username: string;
    role: string;
  }>;
};

export type DeletedAdminGroup = {
  id: string;
  name: string;
};

export type AdminGroupMemberResponse = {
  userId: string;
  username: string;
  role: string;
};

export async function listAdminGroups(): Promise<AdminGroupResponse[]> {
  const groups = await groupRepo.findAllWithMembers();
  return groups.map(formatGroup);
}

export async function createAdminGroup(input: CreateAdminGroupInput): Promise<AdminGroupResponse> {
  const result = await groupRepo.createWithMembers({
    name: input.name,
    description: input.description || null,
    purpose: input.purpose || null,
    memberIds: input.memberIds ?? [],
  });
  await invalidateChangedGroupMemberAccessCaches(result.membershipChanges);
  return formatGroup(result.group);
}

export async function updateAdminGroup(
  groupId: string,
  input: AdminGroupInput,
): Promise<AdminGroupResponse> {
  const result = await groupRepo.updateWithMembers(groupId, {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
  }, input.memberIds);
  if (!result) {
    throw new NotFoundError('Group not found');
  }
  if (input.memberIds !== undefined) {
    await invalidateWebSocketWalletAccess(result.affectedWalletIds);
    // The transaction may already have committed when cache invalidation fails.
    // Clear the complete cache even for an idempotent retry so a retry can repair
    // stale decisions for users removed by the first committed attempt.
    await clearAccessCacheStrict();
  }
  return formatGroup(result.group);
}

export async function deleteAdminGroup(groupId: string): Promise<DeletedAdminGroup> {
  const deletedGroup = await groupRepo.deleteById(groupId);
  if (!deletedGroup) {
    throw new NotFoundError('Group not found');
  }

  await invalidateWebSocketWalletAccess(
    deletedGroup.wallets.map(({ id }) => id),
  );

  await Promise.all(
    deletedGroup.members.map((member) => invalidateUserAccessCacheStrict(member.userId)),
  );

  return {
    id: deletedGroup.id,
    name: deletedGroup.name,
  };
}

export async function addAdminGroupMember(
  groupId: string,
  userId: string,
  role: AdminGroupMemberRole,
): Promise<AdminGroupMemberResponse> {
  const group = await groupRepo.findById(groupId);
  if (!group) {
    throw new NotFoundError('Group not found');
  }

  const user = await findUserById(userId);
  if (!user) {
    throw new NotFoundError('User not found');
  }

  const existingMembership = await groupRepo.findMembership(userId, groupId);
  if (existingMembership) {
    throw new ConflictError('User is already a member of this group');
  }

  const membership = await groupRepo.addMember(groupId, userId, role);
  await invalidateUserAccessCacheStrict(userId);

  return {
    userId,
    username: user.username,
    role: membership.role,
  };
}

export async function removeAdminGroupMember(groupId: string, userId: string): Promise<void> {
  const result = await groupRepo.removeMember(groupId, userId);
  if (!result) {
    throw new NotFoundError('Member not found in this group');
  }

  await invalidateWebSocketWalletAccess(result.affectedWalletIds);
  await invalidateUserAccessCacheStrict(userId);
}

function formatGroup(group: GroupWithMembers): AdminGroupResponse {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    purpose: group.purpose,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    members: group.members.map(member => ({
      userId: member.userId,
      username: member.user.username,
      role: member.role,
    })),
  };
}

async function invalidateChangedGroupMemberAccessCaches(
  membershipChanges: SetMembersResult,
): Promise<void> {
  const affectedUserIds = new Set([
    ...membershipChanges.removedUserIds,
    ...membershipChanges.addedUserIds,
  ]);

  await Promise.all(
    [...affectedUserIds].map((userId) => invalidateUserAccessCacheStrict(userId)),
  );
}
