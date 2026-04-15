/**
 * Admin Groups Router
 *
 * Endpoints for group management (admin only)
 */

import { Router } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { asyncHandler } from '../../errors/errorHandler';
import { createLogger } from '../../utils/logger';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import {
  addAdminGroupMember,
  createAdminGroup,
  deleteAdminGroup,
  listAdminGroups,
  removeAdminGroupMember,
  updateAdminGroup,
} from '../../services/adminGroupService';
import { AddGroupMemberSchema, CreateGroupSchema, UpdateGroupSchema } from '../schemas/admin';
import { parseAdminRequestBody } from './requestValidation';

const router = Router();
const log = createLogger('ADMIN_GROUP:ROUTE');

/**
 * GET /api/v1/admin/groups
 * Get all groups (admin only)
 */
router.get('/', authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  res.json(await listAdminGroups());
}));

/**
 * POST /api/v1/admin/groups
 * Create a new group (admin only)
 */
router.post('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { name, description, purpose, memberIds } = parseAdminRequestBody(
    CreateGroupSchema,
    req.body,
    'Group name is required'
  );

  const group = await createAdminGroup({
    name,
    description: description || null,
    purpose: purpose || null,
    memberIds,
  });

  log.info('Group created:', { name, id: group.id });

  await auditService.logFromRequest(req, AuditAction.GROUP_CREATE, AuditCategory.ADMIN, {
    details: { groupName: name, groupId: group.id, memberCount: memberIds?.length || 0 },
  });

  res.status(201).json(group);
}));

/**
 * PUT /api/v1/admin/groups/:groupId
 * Update a group (admin only)
 */
router.put('/:groupId', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { groupId } = req.params;

  const { name, description, purpose, memberIds } = parseAdminRequestBody(UpdateGroupSchema, req.body);
  const group = await updateAdminGroup(groupId, { name, description, purpose, memberIds });

  log.info('Group updated:', { groupId, name: group.name });

  res.json(group);
}));

/**
 * DELETE /api/v1/admin/groups/:groupId
 * Delete a group (admin only)
 */
router.delete('/:groupId', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { groupId } = req.params;

  const deletedGroup = await deleteAdminGroup(groupId);

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
  const { userId, role: memberRole } = parseAdminRequestBody(
    AddGroupMemberSchema,
    req.body,
    (issues) => issues.some((issue) => issue.path[0] === 'role')
      ? 'Group member role must be member or admin'
      : 'User ID is required'
  );

  const membership = await addAdminGroupMember(groupId, userId, memberRole);

  log.info('Member added to group:', { groupId, userId, role: membership.role });

  await auditService.logFromRequest(req, AuditAction.GROUP_MEMBER_ADD, AuditCategory.ADMIN, {
    details: { groupId, targetUser: membership.username, role: membership.role },
  });

  res.status(201).json(membership);
}));

/**
 * DELETE /api/v1/admin/groups/:groupId/members/:userId
 * Remove a member from a group (admin only)
 */
router.delete('/:groupId/members/:userId', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { groupId, userId } = req.params;

  await removeAdminGroupMember(groupId, userId);

  log.info('Member removed from group:', { groupId, userId });

  await auditService.logFromRequest(req, AuditAction.GROUP_MEMBER_REMOVE, AuditCategory.ADMIN, {
    details: { groupId, userId },
  });

  res.json({ message: 'Member removed from group successfully' });
}));

export default router;
