/**
 * Devices - Sharing Router
 *
 * Device access control and user/group sharing
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireDeviceAccess } from '../../middleware/deviceAccess';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../errors/errorHandler';
import { ErrorCodes, InvalidInputError } from '../../errors/ApiError';
import {
  getDeviceShareInfo,
  shareDeviceWithUser,
  removeUserFromDevice,
  shareDeviceWithGroup,
} from '../../services/deviceAccess';
import { requireAuthenticatedUser } from '../../middleware/auth';

const router = Router();

const DeviceShareUserBodySchema = z.object({
  targetUserId: z.string().trim().min(1),
});

const DeviceShareGroupBodySchema = z.object({
  groupId: z.string().trim().min(1).nullable().optional(),
});

/**
 * GET /api/v1/devices/:id/share
 * Get sharing info for a device (requires view access)
 */
router.get('/:id/share', requireDeviceAccess('view'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  const shareInfo = await getDeviceShareInfo(id);

  res.json(shareInfo);
}));

/**
 * POST /api/v1/devices/:id/share/user
 * Share device with a user (owner only)
 */
router.post(
  '/:id/share/user',
  requireDeviceAccess('owner'),
  validate(
    { body: DeviceShareUserBodySchema },
    { message: 'targetUserId is required', code: ErrorCodes.INVALID_INPUT }
  ),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const ownerId = requireAuthenticatedUser(req).userId;
    const { targetUserId } = req.body;

    const result = await shareDeviceWithUser(id, targetUserId, ownerId);

    if (!result.success) {
      throw new InvalidInputError(result.message);
    }

    res.json(result);
  })
);

/**
 * DELETE /api/v1/devices/:id/share/user/:targetUserId
 * Remove a user's access to device (owner only)
 */
router.delete('/:id/share/user/:targetUserId', requireDeviceAccess('owner'), asyncHandler(async (req, res) => {
  const { id, targetUserId } = req.params;
  const ownerId = requireAuthenticatedUser(req).userId;

  const result = await removeUserFromDevice(id, targetUserId, ownerId);

  if (!result.success) {
    throw new InvalidInputError(result.message);
  }

  res.json(result);
}));

/**
 * POST /api/v1/devices/:id/share/group
 * Share device with a group or remove group access (owner only)
 */
router.post(
  '/:id/share/group',
  requireDeviceAccess('owner'),
  validate(
    { body: DeviceShareGroupBodySchema },
    { message: 'groupId must be a string or null', code: ErrorCodes.INVALID_INPUT }
  ),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const ownerId = requireAuthenticatedUser(req).userId;
    const { groupId } = req.body; // null to remove group access

    const result = await shareDeviceWithGroup(id, groupId, ownerId);

    if (!result.success) {
      throw new InvalidInputError(result.message);
    }

    res.json(result);
  })
);

export default router;
