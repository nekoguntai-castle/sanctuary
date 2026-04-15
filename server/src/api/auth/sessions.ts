/**
 * Auth - Sessions Router
 *
 * Endpoints for managing active user sessions
 */

import { Router } from 'express';
import { hashToken } from '../../utils/jwt';
import { auditService, AuditAction, AuditCategory, getClientInfo } from '../../services/auditService';
import * as refreshTokenService from '../../services/refreshTokenService';
import { asyncHandler } from '../../errors/errorHandler';
import { NotFoundError } from '../../errors/ApiError';
import { requireAuthenticatedUser } from '../../middleware/auth';

const router = Router();

/**
 * GET /api/v1/auth/sessions
 * List all active sessions for the current user
 */
router.get('/sessions', asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;

  // Get current token hash to mark the current session
  // Client can send refresh token via X-Refresh-Token header to identify current session
  let currentTokenHash: string | undefined;
  const refreshTokenHeader = req.headers['x-refresh-token'];
  if (typeof refreshTokenHeader === 'string' && refreshTokenHeader) {
    currentTokenHash = hashToken(refreshTokenHeader);
  }

  const sessions = await refreshTokenService.getUserSessions(userId, currentTokenHash);

  res.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      deviceName: s.deviceName || 'Unknown Device',
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      isCurrent: s.isCurrent,
    })),
    count: sessions.length,
  });
}));

/**
 * DELETE /api/v1/auth/sessions/:id
 * Revoke a specific session
 */
router.delete('/sessions/:id', asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const sessionId = req.params.id;

  const revoked = await refreshTokenService.revokeSession(sessionId, userId);

  if (!revoked) {
    throw new NotFoundError('Session not found');
  }

  // Audit the action
  const { ipAddress, userAgent } = getClientInfo(req);
  await auditService.log({
    userId,
    username: req.user?.username || 'unknown',
    action: AuditAction.LOGOUT,
    category: AuditCategory.AUTH,
    ipAddress,
    userAgent,
    success: true,
    details: { action: 'revoke_session', sessionId },
  });

  res.json({
    success: true,
    message: 'Session revoked successfully',
  });
}));

export default router;
