/**
 * Admin Users Router
 *
 * Endpoints for user management (admin only)
 */

import { Router } from 'express';
import { db as prisma } from '../../repositories/db';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError, NotFoundError, ConflictError } from '../../errors/ApiError';
import { createLogger } from '../../utils/logger';
import { hashPassword, validatePasswordStrength } from '../../utils/password';
import { isValidEmail } from '../../utils/validators';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import { revokeAllUserTokens } from '../../services/tokenRevocation';

const router = Router();
const log = createLogger('ADMIN_USER:ROUTE');

/**
 * GET /api/v1/admin/users
 * Get all users (admin only)
 */
router.get('/', authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      emailVerified: true,
      isAdmin: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json(users);
}));

/**
 * POST /api/v1/admin/users
 * Create a new user (admin only)
 */
router.post('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { username, password, email, isAdmin } = req.body;

  // Validation - email is now required for all users
  if (!username || !password || !email) {
    throw new InvalidInputError('Username, password, and email are required');
  }

  if (username.length < 3) {
    throw new InvalidInputError('Username must be at least 3 characters');
  }

  // Validate email format
  if (!isValidEmail(email)) {
    throw new InvalidInputError('Invalid email address format');
  }

  // Validate password strength using the same rules as user registration
  const passwordValidation = validatePasswordStrength(password);
  if (!passwordValidation.valid) {
    throw new InvalidInputError('Password does not meet security requirements');
  }

  // Check if username already exists
  const existingUser = await prisma.user.findUnique({
    where: { username },
  });

  if (existingUser) {
    throw new ConflictError('Username already exists');
  }

  // Check if email already exists
  const existingEmail = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (existingEmail) {
    throw new ConflictError('Email already exists');
  }

  // Hash password
  const hashedPassword = await hashPassword(password);

  // Create user - admin-created users are trusted (auto-verified)
  const user = await prisma.user.create({
    data: {
      username,
      password: hashedPassword,
      email: email.toLowerCase(),
      emailVerified: true, // Admin-created users are trusted
      emailVerifiedAt: new Date(),
      isAdmin: isAdmin === true,
    },
    select: {
      id: true,
      username: true,
      email: true,
      emailVerified: true,
      isAdmin: true,
      createdAt: true,
    },
  });

  log.info('User created:', { username, isAdmin: isAdmin === true });

  // Audit log
  await auditService.logFromRequest(req, AuditAction.USER_CREATE, AuditCategory.USER, {
    details: { targetUser: username, isAdmin: isAdmin === true },
  });

  res.status(201).json(user);
}));

/**
 * PUT /api/v1/admin/users/:userId
 * Update a user (admin only)
 */
router.put('/:userId', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { username, password, email, isAdmin } = req.body;

  // Check if user exists
  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!existingUser) {
    throw new NotFoundError('User not found');
  }

  // Build update data
  const updateData: Record<string, unknown> = {};

  if (username && username !== existingUser.username) {
    // Check if new username is taken
    const usernameTaken = await prisma.user.findUnique({
      where: { username },
    });
    if (usernameTaken) {
      throw new ConflictError('Username already exists');
    }
    updateData.username = username;
  }

  if (email !== undefined) {
    const normalizedEmail = email ? email.toLowerCase() : null;
    if (normalizedEmail && normalizedEmail !== existingUser.email) {
      // Check if new email is taken
      const emailTaken = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });
      if (emailTaken) {
        throw new ConflictError('Email already exists');
      }
      // Admin updating email - keep it verified (trusted)
      updateData.email = normalizedEmail;
      updateData.emailVerified = true;
      updateData.emailVerifiedAt = new Date();
    } else if (!normalizedEmail && existingUser.email) {
      // Removing email
      updateData.email = null;
      updateData.emailVerified = false;
      updateData.emailVerifiedAt = null;
    }
  }

  if (password) {
    // Validate password strength using the same rules as user registration
    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.valid) {
      throw new InvalidInputError('Password does not meet security requirements');
    }
    updateData.password = await hashPassword(password);
  }

  if (isAdmin !== undefined) {
    updateData.isAdmin = isAdmin === true;
  }

  // Update user
  const user = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: {
      id: true,
      username: true,
      email: true,
      emailVerified: true,
      isAdmin: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // If password was changed by admin, invalidate all user sessions
  if ('password' in updateData) {
    await revokeAllUserTokens(userId, 'admin_password_reset');
    log.info('User sessions invalidated after admin password reset', { userId });
  }

  log.info('User updated:', { userId, changes: Object.keys(updateData) });

  // Audit log - check for admin role changes
  if ('isAdmin' in updateData) {
    await auditService.logFromRequest(
      req,
      updateData.isAdmin ? AuditAction.USER_ADMIN_GRANT : AuditAction.USER_ADMIN_REVOKE,
      AuditCategory.USER,
      { details: { targetUser: user.username, userId } }
    );
  } else {
    await auditService.logFromRequest(req, AuditAction.USER_UPDATE, AuditCategory.USER, {
      details: { targetUser: user.username, userId, changes: Object.keys(updateData) },
    });
  }

  res.json(user);
}));

/**
 * DELETE /api/v1/admin/users/:userId
 * Delete a user (admin only)
 */
router.delete('/:userId', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const currentUser = req.user;

  // Prevent self-deletion
  if (userId === currentUser?.userId) {
    throw new InvalidInputError('Cannot delete your own account');
  }

  // Check if user exists
  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!existingUser) {
    throw new NotFoundError('User not found');
  }

  // Delete user
  await prisma.user.delete({
    where: { id: userId },
  });

  log.info('User deleted:', { userId, username: existingUser.username });

  // Audit log
  await auditService.logFromRequest(req, AuditAction.USER_DELETE, AuditCategory.USER, {
    details: { targetUser: existingUser.username, userId },
  });

  res.json({ message: 'User deleted successfully' });
}));

export default router;
