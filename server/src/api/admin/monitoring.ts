/**
 * Admin Monitoring Router
 *
 * Endpoints for monitoring services configuration (Grafana, Prometheus, Jaeger) (admin only)
 */

import { Router } from 'express';
import { z } from 'zod';
import { MONITORING_SERVICE_IDS } from '@sanctuary/shared/constants/adminMonitoring';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../errors/errorHandler';
import { ErrorCodes } from '../../errors/ApiError';
import { createLogger } from '../../utils/logger';
import {
  getGrafanaConfig,
  getMonitoringServices,
  updateGrafanaConfig,
  updateMonitoringServiceUrl,
} from '../../services/adminMonitoringService';

const router = Router();
const log = createLogger('ADMIN_MONITORING:ROUTE');

const MonitoringServicesQuerySchema = z.object({
  checkHealth: z.enum(['true', 'false']).optional().default('false').transform(value => value === 'true'),
}).strict();

const MonitoringServiceParamsSchema = z.object({
  serviceId: z.enum(MONITORING_SERVICE_IDS),
});

const MonitoringServiceUpdateBodySchema = z.object({
  customUrl: z.string().nullable().optional(),
}).strict();

const GrafanaUpdateBodySchema = z.object({
  anonymousAccess: z.boolean().optional(),
}).strict();

type MonitoringServicesQuery = z.infer<typeof MonitoringServicesQuerySchema>;
type MonitoringServiceParams = z.infer<typeof MonitoringServiceParamsSchema>;
type MonitoringServiceUpdateBody = z.infer<typeof MonitoringServiceUpdateBodySchema>;
type GrafanaUpdateBody = z.infer<typeof GrafanaUpdateBodySchema>;

const monitoringServiceUpdateValidationMessage = (issues: Array<{ path: string; message: string }>) => {
  if (issues.some(issue => issue.path === 'serviceId')) {
    return 'Invalid service ID. Valid IDs: grafana, prometheus, jaeger';
  }
  if (issues.some(issue => issue.path === 'customUrl')) {
    return 'customUrl must be a string or null';
  }
  return 'Invalid monitoring service update request';
};

/**
 * GET /api/v1/admin/monitoring/services
 * Get list of monitoring services with their URLs and optional health status
 */
router.get('/services', authenticate, requireAdmin, validate(
  { query: MonitoringServicesQuerySchema },
  { message: 'Invalid monitoring services query', code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const { checkHealth } = req.query as unknown as MonitoringServicesQuery;
  res.json(await getMonitoringServices(checkHealth));
}));

/**
 * PUT /api/v1/admin/monitoring/services/:serviceId
 * Update custom URL for a monitoring service
 */
router.put('/services/:serviceId', authenticate, requireAdmin, validate(
  { body: MonitoringServiceUpdateBodySchema, params: MonitoringServiceParamsSchema },
  { message: monitoringServiceUpdateValidationMessage, code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const { serviceId } = req.params as MonitoringServiceParams;
  const { customUrl } = req.body as MonitoringServiceUpdateBody;
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
  { body: GrafanaUpdateBodySchema },
  { message: 'Invalid Grafana settings update request', code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const { anonymousAccess } = req.body as GrafanaUpdateBody;
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
