/**
 * Wallets - Sharing Router
 *
 * Wallet access control and user/group sharing
 */

import { Router } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError, NotFoundError, ForbiddenError } from '../../errors/ApiError';
import { userRepository, walletSharingRepository } from '../../repositories';
import { getDevicesToShareForWallet } from '../../services/deviceAccess';
import {
  WALLET_SHARE_ROLE_VALUES,
  type WalletShareRole,
} from '../../services/wallet/types';

const router = Router();

function isWalletShareRole(role: unknown): role is WalletShareRole {
  return typeof role === 'string' && WALLET_SHARE_ROLE_VALUES.includes(role as WalletShareRole);
}

/**
 * POST /api/v1/wallets/:id/share/group
 * Share wallet with a group (owner only)
 */
router.post('/:id/share/group', requireWalletAccess('owner'), asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const walletId = req.walletId!;
  const { groupId, role = 'viewer' } = req.body;

  // Validate role
  if (role && !isWalletShareRole(role)) {
    throw new InvalidInputError('Invalid role. Must be viewer, signer, or approver');
  }

  // If groupId provided, verify user is member of that group
  if (groupId) {
    const isMember = await walletSharingRepository.isGroupMember(groupId, userId);

    if (!isMember) {
      throw new ForbiddenError('You must be a member of the group to share with it');
    }
  }

  // Update wallet's group and role
  const wallet = await walletSharingRepository.updateWalletGroupWithResult(walletId, groupId || null, role);

  res.json({
    success: true,
    groupId: wallet.groupId,
    groupName: wallet.group?.name || null,
    groupRole: wallet.groupRole,
  });
}));

/**
 * POST /api/v1/wallets/:id/share/user
 * Share wallet with a specific user (owner only)
 */
router.post('/:id/share/user', requireWalletAccess('owner'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const { targetUserId, role = 'viewer' } = req.body;

  if (!targetUserId) {
    throw new InvalidInputError('targetUserId is required');
  }

  if (!isWalletShareRole(role)) {
    throw new InvalidInputError('role must be viewer, signer, or approver');
  }

  // Verify target user exists
  const targetUser = await userRepository.findById(targetUserId);

  if (!targetUser) {
    throw new NotFoundError('User not found');
  }

  // Check if user already has access
  const existingAccess = await walletSharingRepository.findWalletUser(walletId, targetUserId);

  if (existingAccess) {
    // Update role if different
    if (existingAccess.role !== role && existingAccess.role !== 'owner') {
      await walletSharingRepository.updateUserRole(existingAccess.id, role);
    }
    return res.json({
      success: true,
      message: 'User access updated',
    });
  }

  // Add user to wallet
  await walletSharingRepository.addUserToWallet(walletId, targetUserId, role);

  // Get devices associated with this wallet that the target user doesn't have access to
  const devicesToShare = await getDevicesToShareForWallet(walletId, targetUserId);

  res.status(201).json({
    success: true,
    message: 'User added to wallet',
    devicesToShare: devicesToShare.length > 0 ? devicesToShare : undefined,
  });
}));

/**
 * DELETE /api/v1/wallets/:id/share/user/:targetUserId
 * Remove a user's access to wallet (owner only)
 */
router.delete('/:id/share/user/:targetUserId', requireWalletAccess('owner'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const { targetUserId } = req.params;

  // Can't remove the owner
  const targetWalletUser = await walletSharingRepository.findWalletUser(walletId, targetUserId);

  if (!targetWalletUser) {
    throw new NotFoundError('User does not have access to this wallet');
  }

  if (targetWalletUser.role === 'owner') {
    throw new InvalidInputError('Cannot remove the owner from the wallet');
  }

  await walletSharingRepository.removeUserFromWallet(targetWalletUser.id);

  res.json({
    success: true,
    message: 'User removed from wallet',
  });
}));

/**
 * GET /api/v1/wallets/:id/share
 * Get wallet sharing info (group and users)
 */
router.get('/:id/share', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;

  const wallet = await walletSharingRepository.getWalletSharingInfo(walletId);

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  res.json({
    group: wallet.group ? {
      id: wallet.group.id,
      name: wallet.group.name,
      role: wallet.groupRole,
    } : null,
    users: wallet.users.map((wu: { user: { id: string; username: string }; role: string }) => ({
      id: wu.user.id,
      username: wu.user.username,
      role: wu.role,
    })),
  });
}));

export default router;
