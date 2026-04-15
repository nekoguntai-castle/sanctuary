/**
 * Admin Settings Router
 *
 * Endpoints for system settings management (admin only)
 */

import { Router } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { asyncHandler } from '../../errors/errorHandler';
import { createLogger } from '../../utils/logger';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import { getAdminSettings, updateAdminSettings } from '../../services/adminSettingsService';
import { SystemSettingsUpdateSchema } from '../schemas/admin';
import { parseAdminRequestBody } from './requestValidation';

const router = Router();
const log = createLogger('ADMIN_SETTINGS:ROUTE');

/**
 * GET /api/v1/admin/settings
 * Get all system settings (admin only)
 */
router.get('/', authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  res.json(await getAdminSettings());
}));

/**
 * PUT /api/v1/admin/settings
 * Update system settings (admin only)
 */
router.put('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const updates = parseAdminRequestBody(
    SystemSettingsUpdateSchema,
    req.body,
    'At least one setting is required'
  );
  const settings = await updateAdminSettings(updates);

  log.info('Settings updated', { keys: Object.keys(updates) });

  // Audit log
  await auditService.logFromRequest(req, AuditAction.SYSTEM_SETTING_UPDATE, AuditCategory.SYSTEM, {
    details: { settings: Object.keys(updates) },
  });

  res.json(settings);
}));

export default router;
