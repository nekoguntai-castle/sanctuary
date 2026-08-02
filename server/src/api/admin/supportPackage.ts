/**
 * Admin Support Package Router
 *
 * Failure-atomic endpoint for the privacy-safe aggregate support profile.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../errors/errorHandler';
import { generateSerializedSupportPackage } from '../../services/supportPackage';
import { acquireSupportPackageGenerationLease } from '../../services/supportPackage/generationLease';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import { createLogger } from '../../utils/logger';

const router = Router();
const log = createLogger('ADMIN_SUPPORT:ROUTE');

const requestSchema = z.object({
  confirmShareableAggregate: z.literal(true),
}).strict();

const SUPPORT_PACKAGE_FAILED_RESPONSE = {
  error: 'support_package_unavailable',
  message: 'The privacy-safe support package could not be generated.',
} as const;

/**
 * POST /api/v1/admin/support-package
 * Generate and send the already-validated canonical bytes.
 */
router.post(
  '/support-package',
  authenticate,
  requireAdmin,
  validate({ body: requestSchema }),
  asyncHandler(async (req, res) => {
    const lease = await acquireSupportPackageGenerationLease();
    if (lease.status === 'busy') {
      return res.status(429).json({ error: 'support_package_generation_in_progress' });
    }
    if (lease.status === 'unavailable') {
      return res.status(503).json(SUPPORT_PACKAGE_FAILED_RESPONSE);
    }
    const release = lease.release;

    try {
      const bytes = await generateSerializedSupportPackage();
      await auditService.logFromRequest(
        req,
        AuditAction.SUPPORT_PACKAGE_GENERATE,
        AuditCategory.ADMIN,
        { details: { profile: 'shareable_aggregate', version: '2.0.0' } },
      ).catch(() => log.warn('Support package audit write failed', { code: 'audit_unavailable' }));

      const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `attachment; filename="sanctuary-support-${timestamp}.json"`);
      res.setHeader('Content-Length', bytes.byteLength);
      return res.send(bytes);
    } catch {
      return res.status(503).json(SUPPORT_PACKAGE_FAILED_RESPONSE);
    } finally {
      await release().catch(() => log.warn(
        'Support package generation lease release failed',
        { code: 'lease_release_failed' },
      ));
    }
  }),
);

export default router;
