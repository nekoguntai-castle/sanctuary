import { getConfig } from '../config';
import { InvalidInputError } from '../errors/ApiError';
import { systemSettingRepository, SystemSettingKeys } from '../repositories/systemSettingRepository';

export interface MonitoringService {
  id: string;
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

export type MonitoringServiceUrlUpdate = {
  success: true;
  action: 'updated' | 'cleared';
  customUrl?: string;
};

export type GrafanaConfigResponse = {
  username: 'admin';
  passwordSource: 'GRAFANA_PASSWORD' | 'ENCRYPTION_KEY';
  password: string;
  anonymousAccess: boolean;
  anonymousAccessNote: string;
};

export type GrafanaUpdateResponse = {
  success: true;
  message: string;
  changed: boolean;
};

const monitoringSettingKeyByServiceId: Record<string, string> = {
  grafana: SystemSettingKeys.MONITORING_GRAFANA_URL,
  prometheus: SystemSettingKeys.MONITORING_PROMETHEUS_URL,
  jaeger: SystemSettingKeys.MONITORING_JAEGER_URL,
};

export async function getMonitoringServices(checkHealth: boolean): Promise<MonitoringServicesResponse> {
  const config = getConfig();
  const customGrafanaUrl = await systemSettingRepository.getValue(SystemSettingKeys.MONITORING_GRAFANA_URL);
  const customPrometheusUrl = await systemSettingRepository.getValue(SystemSettingKeys.MONITORING_PROMETHEUS_URL);
  const customJaegerUrl = await systemSettingRepository.getValue(SystemSettingKeys.MONITORING_JAEGER_URL);

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
  customUrl: unknown,
): Promise<MonitoringServiceUrlUpdate> {
  const settingKey = monitoringSettingKeyByServiceId[serviceId];
  if (!settingKey) {
    throw new InvalidInputError('Invalid service ID. Valid IDs: grafana, prometheus, jaeger');
  }

  if (customUrl && typeof customUrl === 'string' && customUrl.trim()) {
    const trimmedUrl = customUrl.trim();
    await systemSettingRepository.set(settingKey, trimmedUrl);
    return { success: true, action: 'updated', customUrl: trimmedUrl };
  }

  await systemSettingRepository.delete(settingKey);
  return { success: true, action: 'cleared' };
}

export async function getGrafanaConfig(): Promise<GrafanaConfigResponse> {
  const anonymousAccess = await systemSettingRepository.getBoolean(
    SystemSettingKeys.GRAFANA_ANONYMOUS_ACCESS,
    false,
  );

  const encryptionKey = process.env.ENCRYPTION_KEY || '';
  const grafanaPassword = process.env.GRAFANA_PASSWORD;
  const passwordSource = grafanaPassword ? 'GRAFANA_PASSWORD' : 'ENCRYPTION_KEY';
  const password = grafanaPassword || encryptionKey || '';

  return {
    username: 'admin',
    passwordSource,
    password,
    anonymousAccess,
    anonymousAccessNote: 'Changing anonymous access requires restarting the Grafana container',
  };
}

export async function updateGrafanaConfig(anonymousAccess: unknown): Promise<GrafanaUpdateResponse> {
  if (typeof anonymousAccess === 'boolean') {
    await systemSettingRepository.setBoolean(
      SystemSettingKeys.GRAFANA_ANONYMOUS_ACCESS,
      anonymousAccess,
    );
  }

  return {
    success: true,
    changed: typeof anonymousAccess === 'boolean',
    message: anonymousAccess
      ? 'Anonymous access enabled. Restart Grafana container to apply.'
      : 'Anonymous access disabled. Restart Grafana container to apply.',
  };
}

async function addMonitoringHealthStatus(service: MonitoringService): Promise<void> {
  try {
    const response = await fetchMonitoringHealth(service.id);
    service.status = response.ok ? 'healthy' : 'unhealthy';
  } catch {
    service.status = 'unhealthy';
  }
}

async function fetchMonitoringHealth(serviceId: string): Promise<Response> {
  const checkUrl = getMonitoringHealthUrl(serviceId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    return await fetch(checkUrl, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function getMonitoringHealthUrl(serviceId: string): string {
  if (serviceId === 'grafana') {
    return 'http://grafana:3000/api/health';
  }

  if (serviceId === 'prometheus') {
    return 'http://prometheus:9090/-/healthy';
  }

  return 'http://jaeger:16686/';
}
