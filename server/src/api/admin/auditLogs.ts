/**
 * Admin Audit Logs Router
 *
 * Endpoints for viewing audit logs and statistics (admin only)
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { asyncHandler } from '../../errors/errorHandler';
import { auditService, AuditCategory } from '../../services/auditService';

/** Pagination with clamping for audit logs (max 500) */
const AuditPaginationSchema = z.object({
  limit: z.coerce.number().int().catch(50).transform(v => Math.max(1, Math.min(v, 500))),
  offset: z.coerce.number().int().catch(0).transform(v => Math.max(0, v)),
});

/** Days parameter with clamping */
const DaysSchema = z.coerce.number().int().catch(30).transform(v => Math.max(1, v));

const router = Router();

/**
 * GET /api/v1/admin/audit-logs
 * Get audit logs with optional filters (admin only)
 *
 * Query parameters:
 *   - userId: Filter by user ID
 *   - username: Filter by username (partial match)
 *   - action: Filter by action (partial match)
 *   - category: Filter by category (auth, user, wallet, device, admin, backup, mcp, system)
 *   - success: Filter by success status (true/false)
 *   - startDate: Filter by start date (ISO string)
 *   - endDate: Filter by end date (ISO string)
 *   - limit: Number of records (default 50, max 500)
 *   - offset: Skip records for pagination
 */
router.get('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const {
    userId,
    username,
    action,
    category,
    success,
    startDate,
    endDate,
    limit,
    offset,
  } = req.query;

  const pagination = AuditPaginationSchema.safeParse({ limit, offset }).data
    ?? { limit: 50, offset: 0 };

  const result = await auditService.query({
    userId: userId as string,
    username: username as string,
    action: action as string,
    category: category as AuditCategory,
    success: success !== undefined ? success === 'true' : undefined,
    startDate: startDate ? new Date(startDate as string) : undefined,
    endDate: endDate ? new Date(endDate as string) : undefined,
    limit: pagination.limit,
    offset: pagination.offset,
  });

  res.json(result);
}));

/**
 * GET /api/v1/admin/audit-logs/stats
 * Get audit log statistics (admin only)
 *
 * Query parameters:
 *   - days: Number of days to include (default 30)
 */
router.get('/stats', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const days = DaysSchema.safeParse(req.query.days).data ?? 30;
  const stats = await auditService.getStats(days);
  res.json(stats);
}));

export default router;
