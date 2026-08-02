/**
 * Admin Support Package Router
 *
 * Fail-closed endpoint for the temporarily unavailable support package.
 */

import { Router } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth';

const router = Router();

const SUPPORT_PACKAGE_UNAVAILABLE_RESPONSE = {
  error: 'support_package_unavailable',
  message: 'Support package downloads are temporarily unavailable while privacy-safe diagnostics are being implemented.',
} as const;

/**
 * POST /api/v1/admin/support-package
 * Return the fixed containment response until the privacy-safe profile is ready.
 */
router.post('/support-package', authenticate, requireAdmin, (_req, res) =>
  res.status(503).json(SUPPORT_PACKAGE_UNAVAILABLE_RESPONSE)
);

export default router;
