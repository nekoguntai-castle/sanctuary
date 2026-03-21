/**
 * Admin Users Router
 *
 * Endpoints for user management (admin only)
 */

import { Router, Request, Response } from 'express';
import { db as prisma } from '../../repositories/db';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { createLogger } from '../../utils/logger';
import { hashPassword, validatePasswordStrength } from '../../utils/password';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import { revokeAllUserTokens } from '../../services/tokenRevocation';
import { getErrorMessage } from '../../utils/errors';

const router = Router();
const log = createLogger('ADMIN:USERS');

/**
 * GET /api/v1/admin/users
 * Get all users (admin only)
 */
router.get('/', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  try {
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
  } catch (error) {
    log.error('Get users error', { error: getErrorMessage(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get users',
    });
  }
});

/**
 * POST /api/v1/admin/users
 * Create a new user (admin only)
 */
router.post('/', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { username, password, email, isAdmin } = req.body;

    // Validation - email is now required for all users
    if (!username || !password || !email) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Username, password, and email are required',
      });
    }

    if (username.length < 3) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Username must be at least 3 characters',
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid email address format',
      });
    }

    // Validate password strength using the same rules as user registration
    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Password does not meet security requirements',
        details: passwordValidation.errors,
      });
    }

    // Check if username already exists
    const existingUser = await prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Username already exists',
      });
    }

    // Check if email already exists
    const existingEmail = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingEmail) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Email already exists',
      });
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
  } catch (error) {
    log.error('Create user error', { error: getErrorMessage(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create user',
    });
  }
});

/**
 * PUT /api/v1/admin/users/:userId
 * Update a user (admin only)
 */
router.put('/:userId', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { username, password, email, isAdmin } = req.body;

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    // Build update data
    const updateData: Record<string, unknown> = {};

    if (username && username !== existingUser.username) {
      // Check if new username is taken
      const usernameTaken = await prisma.user.findUnique({
        where: { username },
      });
      if (usernameTaken) {
        return res.status(409).json({
          error: 'Conflict',
          message: 'Username already exists',
        });
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
          return res.status(409).json({
            error: 'Conflict',
            message: 'Email already exists',
          });
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
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Password does not meet security requirements',
          details: passwordValidation.errors,
        });
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
  } catch (error) {
    log.error('Update user error', { error: getErrorMessage(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update user',
    });
  }
});

/**
 * DELETE /api/v1/admin/users/:userId
 * Delete a user (admin only)
 */
router.delete('/:userId', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const currentUser = req.user;

    // Prevent self-deletion
    if (userId === currentUser?.userId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Cannot delete your own account',
      });
    }

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
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
  } catch (error) {
    log.error('Delete user error', { error: getErrorMessage(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete user',
    });
  }
});

export default router;
