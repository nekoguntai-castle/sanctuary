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
import { InvalidInputError } from '../../errors/ApiError';
import { createLogger } from '../../utils/logger';
import { getConfig } from '../../config';
import { systemSettingRepository, SystemSettingKeys } from '../../repositories/systemSettingRepository';

const router = Router();
const log = createLogger('ADMIN_MONITORING:ROUTE');

const MonitoringServiceUpdateBodySchema = z.object({
  customUrl: z.unknown().optional(),
}).passthrough().catch({});

const GrafanaUpdateBodySchema = z.object({
  anonymousAccess: z.unknown().optional(),
}).passthrough().catch({});

/**
 * Monitoring service configuration for frontend
 */
interface MonitoringService {
  id: string;
  name: string;
  description: string;
  url: string;
  defaultPort: number;
  icon: string;
  isCustomUrl: boolean;
  status?: 'unknown' | 'healthy' | 'unhealthy';
}

/**
 * GET /api/v1/admin/monitoring/services
 * Get list of monitoring services with their URLs and optional health status
 */
router.get('/services', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const config = getConfig();
  const checkHealth = req.query.checkHealth === 'true';

  // Get custom URL overrides from system settings
  const customGrafanaUrl = await systemSettingRepository.getValue(SystemSettingKeys.MONITORING_GRAFANA_URL);
  const customPrometheusUrl = await systemSettingRepository.getValue(SystemSettingKeys.MONITORING_PROMETHEUS_URL);
  const customJaegerUrl = await systemSettingRepository.getValue(SystemSettingKeys.MONITORING_JAEGER_URL);

  // Build service list with placeholder for host
  const services: MonitoringService[] = [
    {
      id: 'grafana',
      name: 'Grafana',
      description: 'Dashboards, metrics visualization, and alerting',
      url: customGrafanaUrl || `{host}:${config.monitoring.grafanaPort}`,
      defaultPort: config.monitoring.grafanaPort,
      icon: 'BarChart3',
      isCustomUrl: !!customGrafanaUrl,
    },
    {
      id: 'prometheus',
      name: 'Prometheus',
      description: 'Metrics collection and querying',
      url: customPrometheusUrl || `{host}:${config.monitoring.prometheusPort}`,
      defaultPort: config.monitoring.prometheusPort,
      icon: 'Activity',
      isCustomUrl: !!customPrometheusUrl,
    },
    {
      id: 'jaeger',
      name: 'Jaeger',
      description: 'Distributed tracing and request visualization',
      url: customJaegerUrl || `{host}:${config.monitoring.jaegerPort}`,
      defaultPort: config.monitoring.jaegerPort,
      icon: 'Network',
      isCustomUrl: !!customJaegerUrl,
    },
  ];

  // Optional health checks (expensive - do on-demand)
  if (checkHealth) {
    const healthChecks = services.map(async (service) => {
      try {
        // For health checks, always use localhost since we're checking from the server
        let checkUrl: string;
        if (service.id === 'grafana') {
          checkUrl = `http://grafana:3000/api/health`;
        } else if (service.id === 'prometheus') {
          checkUrl = `http://prometheus:9090/-/healthy`;
        } else {
          checkUrl = `http://jaeger:16686/`;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(checkUrl, { signal: controller.signal });
        clearTimeout(timeout);

        service.status = response.ok ? 'healthy' : 'unhealthy';
      } catch {
        service.status = 'unhealthy';
      }
    });

    await Promise.all(healthChecks);
  }

  res.json({
    enabled: config.monitoring.tracingEnabled,
    services,
  });
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

  const keyMap: Record<string, string> = {
    grafana: SystemSettingKeys.MONITORING_GRAFANA_URL,
    prometheus: SystemSettingKeys.MONITORING_PROMETHEUS_URL,
    jaeger: SystemSettingKeys.MONITORING_JAEGER_URL,
  };

  const settingKey = keyMap[serviceId];
  if (!settingKey) {
    throw new InvalidInputError('Invalid service ID. Valid IDs: grafana, prometheus, jaeger');
  }

  if (customUrl && typeof customUrl === 'string' && customUrl.trim()) {
    await systemSettingRepository.set(settingKey, customUrl.trim());
    log.info('Monitoring service URL updated', {
      serviceId,
      customUrl: customUrl.trim(),
      admin: req.user?.username,
    });
  } else {
    await systemSettingRepository.delete(settingKey);
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
  const anonymousAccess = await systemSettingRepository.getBoolean(
    SystemSettingKeys.GRAFANA_ANONYMOUS_ACCESS,
    false
  );

  // Get password info (admin-only endpoint, so full password is ok)
  const encryptionKey = process.env.ENCRYPTION_KEY || '';
  const grafanaPassword = process.env.GRAFANA_PASSWORD;
  const passwordSource = grafanaPassword ? 'GRAFANA_PASSWORD' : 'ENCRYPTION_KEY';
  const password = grafanaPassword || encryptionKey || '';

  res.json({
    username: 'admin',
    passwordSource,
    password,
    anonymousAccess,
    // Note: changing anonymous access requires container restart
    anonymousAccessNote: 'Changing anonymous access requires restarting the Grafana container',
  });
}));

/**
 * PUT /api/v1/admin/monitoring/grafana
 * Update Grafana settings (anonymous access)
 */
router.put('/grafana', authenticate, requireAdmin, validate(
  { body: GrafanaUpdateBodySchema }
), asyncHandler(async (req, res) => {
  const { anonymousAccess } = req.body;

  if (typeof anonymousAccess === 'boolean') {
    await systemSettingRepository.setBoolean(
      SystemSettingKeys.GRAFANA_ANONYMOUS_ACCESS,
      anonymousAccess
    );
    log.info('Grafana anonymous access updated', {
      anonymousAccess,
      admin: req.user?.username,
    });
  }

  res.json({
    success: true,
    message: anonymousAccess
      ? 'Anonymous access enabled. Restart Grafana container to apply.'
      : 'Anonymous access disabled. Restart Grafana container to apply.',
  });
}));

export default router;
