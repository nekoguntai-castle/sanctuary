/**
 * Admin Monitoring Router
 *
 * Endpoints for monitoring services configuration (Grafana, Prometheus, Jaeger) (admin only)
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../errors/errorHandler';
import { createLogger } from '../../utils/logger';
import {
  getGrafanaConfig,
  getMonitoringServices,
  updateGrafanaConfig,
  updateMonitoringServiceUrl,
} from '../../services/adminMonitoringService';

const router = Router();
const log = createLogger('ADMIN_MONITORING:ROUTE');

const MonitoringServiceUpdateBodySchema = z.object({
  customUrl: z.unknown().optional(),
}).passthrough().catch({});

const GrafanaUpdateBodySchema = z.object({
  anonymousAccess: z.unknown().optional(),
}).passthrough().catch({});

/**
 * GET /api/v1/admin/monitoring/services
 * Get list of monitoring services with their URLs and optional health status
 */
router.get('/services', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const checkHealth = req.query.checkHealth === 'true';
  res.json(await getMonitoringServices(checkHealth));
}));

/**
 * PUT /api/v1/admin/monitoring/services/:serviceId
 * Update custom URL for a monitoring service
 */
router.put('/services/:serviceId', authenticate, requireAdmin, validate(
  { body: MonitoringServiceUpdateBodySchema }
), asyncHandler(async (req, res) => {
  const { serviceId } = req.params;
  const { customUrl } = req.body;
  const result = await updateMonitoringServiceUrl(serviceId, customUrl);

  if (result.action === 'updated') {
    log.info('Monitoring service URL updated', {
      serviceId,
      customUrl: result.customUrl,
      admin: req.user?.username,
    });
  } else {
    log.info('Monitoring service URL cleared', {
      serviceId,
      admin: req.user?.username,
    });
  }

  res.json({ success: true });
}));

/**
 * GET /api/v1/admin/monitoring/grafana
 * Get Grafana configuration including credentials hint and anonymous access setting
 */
router.get('/grafana', authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  res.json(await getGrafanaConfig());
}));

/**
 * PUT /api/v1/admin/monitoring/grafana
 * Update Grafana settings (anonymous access)
 */
router.put('/grafana', authenticate, requireAdmin, validate(
  { body: GrafanaUpdateBodySchema }
), asyncHandler(async (req, res) => {
  const { anonymousAccess } = req.body;
  const result = await updateGrafanaConfig(anonymousAccess);

  if (result.changed) {
    log.info('Grafana anonymous access updated', {
      anonymousAccess,
      admin: req.user?.username,
    });
  }

  res.json({
    success: result.success,
    message: result.message,
  });
}));

export default router;
