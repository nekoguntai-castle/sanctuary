import { getConfig } from '../config';
import {
  isMonitoringServiceId,
  type MonitoringServiceId,
} from '@sanctuary/shared/constants/adminMonitoring';
import { InvalidInputError } from '../errors/ApiError';
import { systemSettingRepository, SystemSettingKeys } from '../repositories/systemSettingRepository';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

const log = createLogger('ADMIN:MONITORING');

export interface MonitoringService {
  id: MonitoringServiceId;
  name: string;
  description: string;
  url: string;
  defaultPort: number;
  icon: string;
  isCustomUrl: boolean;
  status?: 'unknown' | 'healthy' | 'unhealthy';
}

export type MonitoringServicesResponse = {
  enabled: boolean;
  services: MonitoringService[];
};

export type MonitoringServiceCustomUrl = string | null | undefined;

export type MonitoringServiceUrlUpdate = {
  success: true;
  action: 'updated' | 'cleared';
  customUrl?: string;
};

export type GrafanaConfigResponse = {
  username: 'admin';
  passwordSource: 'GRAFANA_PASSWORD' | null;
  password: string | null;
  passwordConfigured: boolean;
  anonymousAccess: boolean | null;
  anonymousAccessNote: string;
};

const monitoringSettingKeyByServiceId: Record<MonitoringServiceId, string> = {
  grafana: SystemSettingKeys.MONITORING_GRAFANA_URL,
  prometheus: SystemSettingKeys.MONITORING_PROMETHEUS_URL,
  jaeger: SystemSettingKeys.MONITORING_JAEGER_URL,
};

export async function getMonitoringServices(checkHealth: boolean): Promise<MonitoringServicesResponse> {
  const config = getConfig();
  const customGrafanaUrl = await systemSettingRepository.getString(SystemSettingKeys.MONITORING_GRAFANA_URL);
  const customPrometheusUrl = await systemSettingRepository.getString(SystemSettingKeys.MONITORING_PROMETHEUS_URL);
  const customJaegerUrl = await systemSettingRepository.getString(SystemSettingKeys.MONITORING_JAEGER_URL);

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

  if (checkHealth) {
    await Promise.all(services.map(addMonitoringHealthStatus));
  }

  return {
    enabled: config.monitoring.tracingEnabled,
    services,
  };
}

export async function updateMonitoringServiceUrl(
  serviceId: string,
  customUrl: MonitoringServiceCustomUrl,
): Promise<MonitoringServiceUrlUpdate> {
  const settingKey = isMonitoringServiceId(serviceId)
    ? monitoringSettingKeyByServiceId[serviceId]
    : undefined;
  if (!settingKey) {
    throw new InvalidInputError('Invalid service ID. Valid IDs: grafana, prometheus, jaeger');
  }

  if (typeof customUrl === 'string' && customUrl.trim()) {
    const trimmedUrl = customUrl.trim();
    await systemSettingRepository.set(settingKey, trimmedUrl);
    return { success: true, action: 'updated', customUrl: trimmedUrl };
  }

  await systemSettingRepository.delete(settingKey);
  return { success: true, action: 'cleared' };
}

const GRAFANA_INTERNAL_BASE_URL = 'http://grafana:3000';
const GRAFANA_ANONYMOUS_PROBE_URL = `${GRAFANA_INTERNAL_BASE_URL}/api/search?limit=1`;
const MONITORING_FETCH_TIMEOUT_MS = 3000;

function grafanaAnonymousAccessNote(anonymousAccess: boolean | null): string {
  if (anonymousAccess === null) {
    return 'Could not reach the bundled Grafana container to read its anonymous-access state.';
  }
  return anonymousAccess
    ? 'Grafana allows dashboards to be viewed without logging in. Set GRAFANA_ANONYMOUS_ENABLED=false in the Sanctuary runtime environment and recreate the Grafana container to turn this off.'
    : 'Grafana requires a login. Logged-out access is controlled by GRAFANA_ANONYMOUS_ENABLED in the Sanctuary runtime environment.';
}

/**
 * Grafana's anonymous access is a startup setting (GRAFANA_ANONYMOUS_ENABLED), so report the running
 * container's effective state: an unauthenticated search is 200 when anonymous viewing is on and 401
 * when it is off. Anything else is unknown (null), so the UI never claims "off" without proof.
 */
async function probeGrafanaAnonymousAccess(): Promise<boolean | null> {
  try {
    const response = await fetchWithTimeout(GRAFANA_ANONYMOUS_PROBE_URL);
    if (response.status === 200) return true;
    if (response.status === 401) return false;
    return null;
  } catch (error) {
    log.debug('Grafana anonymous-access probe failed', { error: getErrorMessage(error) });
    return null;
  }
}

export async function getGrafanaConfig(): Promise<GrafanaConfigResponse> {
  const anonymousAccess = await probeGrafanaAnonymousAccess();
  const grafanaPassword = process.env.GRAFANA_PASSWORD || null;

  return {
    username: 'admin',
    passwordSource: grafanaPassword ? 'GRAFANA_PASSWORD' : null,
    password: grafanaPassword,
    passwordConfigured: grafanaPassword !== null,
    anonymousAccess,
    anonymousAccessNote: grafanaAnonymousAccessNote(anonymousAccess),
  };
}

async function addMonitoringHealthStatus(service: MonitoringService): Promise<void> {
  try {
    const response = await fetchWithTimeout(getMonitoringHealthUrl(service.id));
    service.status = response.ok ? 'healthy' : 'unhealthy';
  } catch {
    service.status = 'unhealthy';
  }
}

/**
 * Fetch a status-only check. Callers read the status alone, so the body is
 * discarded to release the connection instead of leaving it to be collected.
 */
async function fetchWithTimeout(checkUrl: string): Promise<Response> {
  const response = await fetch(checkUrl, { signal: AbortSignal.timeout(MONITORING_FETCH_TIMEOUT_MS) });
  try {
    await response.body?.cancel();
  } catch (error) {
    log.debug('Discarding a monitoring response body failed', { error: getErrorMessage(error) });
  }
  return response;
}

function getMonitoringHealthUrl(serviceId: string): string {
  if (serviceId === 'grafana') {
    return `${GRAFANA_INTERNAL_BASE_URL}/api/health`;
  }

  if (serviceId === 'prometheus') {
    return 'http://prometheus:9090/-/healthy';
  }

  return 'http://jaeger:16686/';
}
