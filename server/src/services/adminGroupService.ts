import { NotFoundError, ConflictError } from '../errors/ApiError';
import { invalidateUserAccessCache } from './accessControl';
import * as groupRepo from '../repositories/groupRepository';
import { findById as findUserById } from '../repositories/userRepository';

type GroupWithMembers = NonNullable<Awaited<ReturnType<typeof groupRepo.findByIdWithMembers>>>;

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
  const group = await groupRepo.create({
    name: input.name,
    description: input.description || null,
    purpose: input.purpose || null,
  });

  if (input.memberIds?.length) {
    await groupRepo.addMembers(group.id, input.memberIds);
  }

  return getExistingGroupWithMembers(group.id);
}

export async function updateAdminGroup(
  groupId: string,
  input: AdminGroupInput,
): Promise<AdminGroupResponse> {
  const existingGroup = await groupRepo.findById(groupId);
  if (!existingGroup) {
    throw new NotFoundError('Group not found');
  }

  await groupRepo.update(groupId, {
    name: input.name || existingGroup.name,
    description: input.description !== undefined ? input.description : existingGroup.description,
    purpose: input.purpose !== undefined ? input.purpose : existingGroup.purpose,
  });

  if (input.memberIds !== undefined) {
    await groupRepo.setMembers(groupId, input.memberIds);
  }

  return getExistingGroupWithMembers(groupId);
}

export async function deleteAdminGroup(groupId: string): Promise<DeletedAdminGroup> {
  const deletedGroup = await groupRepo.deleteById(groupId);
  if (!deletedGroup) {
    throw new NotFoundError('Group not found');
  }

  await Promise.all(
    deletedGroup.members.map((member) => invalidateUserAccessCache(member.userId)),
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
  await invalidateUserAccessCache(userId);

  return {
    userId,
    username: user.username,
    role: membership.role,
  };
}

export async function removeAdminGroupMember(groupId: string, userId: string): Promise<void> {
  const membership = await groupRepo.findMembership(userId, groupId);
  if (!membership) {
    throw new NotFoundError('Member not found in this group');
  }

  await groupRepo.removeMember(groupId, userId);
  await invalidateUserAccessCache(userId);
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

async function getExistingGroupWithMembers(groupId: string): Promise<AdminGroupResponse> {
  const group = await groupRepo.findByIdWithMembers(groupId);
  /* v8 ignore next -- not-found behavior is covered at admin route boundary */
  if (!group) {
    throw new NotFoundError('Group not found');
  }

  return formatGroup(group);
}
