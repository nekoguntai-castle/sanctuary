/**
 * Admin Support Package Router
 *
 * Endpoint for generating and downloading a diagnostic support package.
 */

import { Router } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { asyncHandler } from '../../errors/errorHandler';
import { createLogger } from '../../utils/logger';
import { generateSupportPackage } from '../../services/supportPackage';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';

const router = Router();
const log = createLogger('ADMIN_SUPPORT:ROUTE');

// Concurrency guard — only one generation at a time
let generating = false;

/**
 * POST /api/v1/admin/support-package
 * Generate and download a diagnostic support package (admin only)
 *
 * Response: JSON file download
 */
router.post('/support-package', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  if (generating) {
    return res.status(429).json({ error: 'Support package generation already in progress' });
  }

  generating = true;
  try {
    log.info('Generating support package', { user: req.user?.username });

    const pkg = await generateSupportPackage();

    // Audit log
    await auditService.logFromRequest(req, AuditAction.SUPPORT_PACKAGE_GENERATE, AuditCategory.ADMIN, {
      details: {
        collectors: pkg.meta.succeeded.length + pkg.meta.failed.length,
        succeeded: pkg.meta.succeeded.length,
        failed: pkg.meta.failed.length,
        durationMs: pkg.meta.totalDurationMs,
      },
    });

    // Generate filename with timestamp
    const timestamp = new Date().toISOString()
      .slice(0, 19)
      .replace(/[T:]/g, '-');
    const filename = `sanctuary-support-${timestamp}.json`;

    // Set headers for file download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    res.json(pkg);
  } finally {
    generating = false;
  }
}));

export default router;
