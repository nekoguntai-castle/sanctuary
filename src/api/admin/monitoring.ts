/**
 * Admin Monitoring API
 *
 * Monitoring services, Grafana config, WebSocket stats, and Tor container management (admin only)
 */

import apiClient from '../client';
import type { MonitoringServiceId } from '@sanctuary/shared/constants/adminMonitoring';
import type {
  MonitoringServicesResponse,
  GrafanaConfig,
  WebSocketStats,
  TorContainerStatus,
  ContainerActionResponse,
} from './types';

// ========================================
// MONITORING SERVICES
// ========================================

/**
 * Get monitoring services configuration (admin only)
 */
export async function getMonitoringServices(checkHealth = false): Promise<MonitoringServicesResponse> {
  return apiClient.get<MonitoringServicesResponse>(
    '/admin/monitoring/services',
    checkHealth ? { checkHealth: true } : undefined
  );
}

/**
 * Update custom URL for a monitoring service (admin only)
 */
export async function updateMonitoringServiceUrl(
  serviceId: MonitoringServiceId,
  customUrl: string | null
): Promise<{ success: boolean }> {
  return apiClient.put<{ success: boolean }>(`/admin/monitoring/services/${serviceId}`, {
    customUrl,
  });
}

// ========================================
// GRAFANA CONFIGURATION
// ========================================

/**
 * Get Grafana configuration (admin only)
 */
export async function getGrafanaConfig(): Promise<GrafanaConfig> {
  return apiClient.get<GrafanaConfig>('/admin/monitoring/grafana');
}

/**
 * Update Grafana configuration (admin only)
 */
export async function updateGrafanaConfig(config: {
  anonymousAccess?: boolean;
}): Promise<{ success: boolean; message: string }> {
  return apiClient.put<{ success: boolean; message: string }>('/admin/monitoring/grafana', config);
}

// ========================================
// WEBSOCKET STATISTICS
// ========================================

/**
 * Get WebSocket server statistics (admin only)
 */
export async function getWebSocketStats(): Promise<WebSocketStats> {
  return apiClient.get<WebSocketStats>('/admin/websocket/stats');
}

// ========================================
// TOR CONTAINER MANAGEMENT
// ========================================

/**
 * Get the status of the bundled Tor container
 */
export async function getTorContainerStatus(): Promise<TorContainerStatus> {
  return apiClient.get<TorContainerStatus>('/admin/tor-container/status');
}

/**
 * Start the bundled Tor container
 */
export async function startTorContainer(): Promise<ContainerActionResponse> {
  return apiClient.post<ContainerActionResponse>('/admin/tor-container/start', {});
}

/**
 * Stop the bundled Tor container
 */
export async function stopTorContainer(): Promise<ContainerActionResponse> {
  return apiClient.post<ContainerActionResponse>('/admin/tor-container/stop', {});
}
