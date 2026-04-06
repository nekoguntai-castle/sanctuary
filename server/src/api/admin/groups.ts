/**
 * Admin Groups Router
 *
 * Endpoints for group management (admin only)
 */

import { Router } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError, NotFoundError, ConflictError } from '../../errors/ApiError';
import { createLogger } from '../../utils/logger';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import { invalidateUserAccessCache } from '../../services/accessControl';
import * as groupRepo from '../../repositories/groupRepository';
import { findById as findUserById } from '../../repositories/userRepository';

const router = Router();
const log = createLogger('ADMIN_GROUP:ROUTE');

/** Format a group with members for API response */
function formatGroup(group: NonNullable<Awaited<ReturnType<typeof groupRepo.findByIdWithMembers>>>) {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    purpose: group.purpose,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    members: group.members.map(m => ({
      userId: m.userId,
      username: m.user.username,
      role: m.role,
    })),
  };
}

/**
 * GET /api/v1/admin/groups
 * Get all groups (admin only)
 */
router.get('/', authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  const groups = await groupRepo.findAllWithMembers();
  res.json(groups.map(formatGroup));
}));

/**
 * POST /api/v1/admin/groups
 * Create a new group (admin only)
 */
router.post('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { name, description, purpose, memberIds } = req.body;

  if (!name) {
    throw new InvalidInputError('Group name is required');
  }

  const group = await groupRepo.create({
    name,
    description: description || null,
    purpose: purpose || null,
  });

  if (memberIds && Array.isArray(memberIds) && memberIds.length > 0) {
    await groupRepo.addMembers(group.id, memberIds);
  }

  const completeGroup = await groupRepo.findByIdWithMembers(group.id);

  log.info('Group created:', { name, id: group.id });

  await auditService.logFromRequest(req, AuditAction.GROUP_CREATE, AuditCategory.ADMIN, {
    details: { groupName: name, groupId: group.id, memberCount: memberIds?.length || 0 },
  });

  res.status(201).json(formatGroup(completeGroup!));
}));

/**
 * PUT /api/v1/admin/groups/:groupId
 * Update a group (admin only)
 */
router.put('/:groupId', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { groupId } = req.params;
  const { name, description, purpose, memberIds } = req.body;

  const existingGroup = await groupRepo.findById(groupId);
  if (!existingGroup) {
    throw new NotFoundError('Group not found');
  }

  await groupRepo.update(groupId, {
    name: name || existingGroup.name,
    description: description !== undefined ? description : existingGroup.description,
    purpose: purpose !== undefined ? purpose : existingGroup.purpose,
  });

  if (memberIds !== undefined && Array.isArray(memberIds)) {
    await groupRepo.setMembers(groupId, memberIds);
  }

  const group = await groupRepo.findByIdWithMembers(groupId);

  log.info('Group updated:', { groupId, name: group!.name });

  res.json(formatGroup(group!));
}));

/**
 * DELETE /api/v1/admin/groups/:groupId
 * Delete a group (admin only)
 */
router.delete('/:groupId', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { groupId } = req.params;

  const deletedGroup = await groupRepo.deleteById(groupId);
  if (!deletedGroup) {
    throw new NotFoundError('Group not found');
  }

  // Invalidate access cache for all former group members
  await Promise.all(
    deletedGroup.members.map((m) => invalidateUserAccessCache(m.userId))
  );

  log.info('Group deleted:', { groupId, name: deletedGroup.name });

  await auditService.logFromRequest(req, AuditAction.GROUP_DELETE, AuditCategory.ADMIN, {
    details: { groupName: deletedGroup.name, groupId },
  });

  res.json({ message: 'Group deleted successfully' });
}));

/**
 * POST /api/v1/admin/groups/:groupId/members
 * Add a member to a group (admin only)
 */
router.post('/:groupId/members', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { groupId } = req.params;
  const { userId, role } = req.body;

  if (!userId) {
    throw new InvalidInputError('User ID is required');
  }

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

  const membership = await groupRepo.addMember(groupId, userId, role || 'member');

  // Invalidate user's access cache (they now have access to group wallets)
  await invalidateUserAccessCache(userId);

  log.info('Member added to group:', { groupId, userId, role: membership.role });

  await auditService.logFromRequest(req, AuditAction.GROUP_MEMBER_ADD, AuditCategory.ADMIN, {
    details: { groupId, targetUser: user.username, role: membership.role },
  });

  res.status(201).json({
    userId,
    username: user.username,
    role: membership.role,
  });
}));

/**
 * DELETE /api/v1/admin/groups/:groupId/members/:userId
 * Remove a member from a group (admin only)
 */
router.delete('/:groupId/members/:userId', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { groupId, userId } = req.params;

  const membership = await groupRepo.findMembership(userId, groupId);
  if (!membership) {
    throw new NotFoundError('Member not found in this group');
  }

  await groupRepo.removeMember(groupId, userId);

  // Invalidate user's access cache (they lost access to group wallets)
  await invalidateUserAccessCache(userId);

  log.info('Member removed from group:', { groupId, userId });

  await auditService.logFromRequest(req, AuditAction.GROUP_MEMBER_REMOVE, AuditCategory.ADMIN, {
    details: { groupId, userId },
  });

  res.json({ message: 'Member removed from group successfully' });
}));

export default router;
