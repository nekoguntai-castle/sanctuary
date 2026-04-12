/**
 * Auth - Profile Router
 *
 * Endpoints for user profile and preferences management
 */

import { Router } from 'express';
import { userRepository, systemSettingRepository, groupRepo as groupRepository } from '../../repositories';
import { asyncHandler } from '../../errors/errorHandler';
import { NotFoundError } from '../../errors/ApiError';
import { validate } from '../../middleware/validate';
import { UserSearchQuerySchema } from '../schemas/auth';

const router = Router();

/**
 * GET /api/v1/auth/me
 * Get current authenticated user
 */
router.get('/me', asyncHandler(async (req, res) => {
  const user = await userRepository.findByIdWithProfile(req.user!.userId);

  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Check if user is still using the initial password
  // We check by looking for the initial password marker in system settings
  const initialPasswordSetting = await systemSettingRepository.get(`initialPassword_${user.id}`);
  const usingDefaultPassword = initialPasswordSetting?.value === user.password;

  // Don't send the password hash to the client
  const { password: _, ...userWithoutPassword } = user;

  res.json({
    ...userWithoutPassword,
    usingDefaultPassword,
  });
}));

/**
 * PATCH /api/v1/auth/me/preferences
 * Update user preferences
 */
router.patch('/me/preferences', asyncHandler(async (req, res) => {
  const newPreferences = req.body;

  // Default preferences for new users or those with null preferences
  const defaultPreferences = {
    darkMode: true,
    theme: 'sanctuary',
    background: 'zen',
    unit: 'sats',
    fiatCurrency: 'USD',
    showFiat: true,
    priceProvider: 'auto',
    notificationSounds: {
      enabled: true,
      volume: 50,
      confirmation: { enabled: true, sound: 'chime' },
      receive: { enabled: true, sound: 'coin' },
      send: { enabled: true, sound: 'success' },
    },
  };

  // First get current preferences to merge with
  const currentUser = await userRepository.findById(req.user!.userId);

  // Merge: defaults -> existing preferences -> new preferences
  const mergedPreferences = {
    ...defaultPreferences,
    ...(currentUser?.preferences as object || {}),
    ...newPreferences,
  };

  const user = await userRepository.updatePreferences(req.user!.userId, mergedPreferences);

  res.json(user);
}));

/**
 * GET /api/v1/auth/me/groups
 * Get groups the current user is a member of
 */
router.get('/me/groups', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;

  const groups = await groupRepository.findByUserId(userId);

  res.json(groups.map(g => ({
    id: g.id,
    name: g.name,
    description: g.description,
    memberCount: g.members.length,
    memberIds: g.members.map(m => m.userId),
  })));
}));

/**
 * GET /api/v1/auth/users/search
 * Search users by username (for sharing)
 */
router.get('/users/search', validate({ query: UserSearchQuerySchema }), asyncHandler(async (req, res) => {
  const { q } = req.query as { q: string };
  const users = await userRepository.searchByUsername(q, 10);

  res.json(users);
}));

export default router;
