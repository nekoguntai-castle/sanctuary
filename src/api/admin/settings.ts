/**
 * Admin Settings & Node Configuration API
 *
 * System settings, node config, Electrum servers, and proxy testing (admin only)
 */

import apiClient from '../client';
import { NodeConfig, ElectrumServer } from '../../../types';
import type { SystemSettings } from './types';

// ========================================
// SYSTEM SETTINGS
// ========================================

/**
 * Get all system settings (admin only)
 */
export async function getSystemSettings(): Promise<SystemSettings> {
  return apiClient.get<SystemSettings>('/admin/settings');
}

/**
 * Update system settings (admin only)
 */
export async function updateSystemSettings(settings: Partial<SystemSettings>): Promise<SystemSettings> {
  return apiClient.put<SystemSettings>('/admin/settings', settings);
}

// ========================================
// NODE CONFIGURATION
// ========================================

/**
 * Get global node configuration (admin only)
 */
export async function getNodeConfig(): Promise<NodeConfig> {
  return apiClient.get<NodeConfig>('/admin/node-config');
}

/**
 * Update global node configuration (admin only)
 */
export async function updateNodeConfig(config: NodeConfig): Promise<NodeConfig> {
  return apiClient.put<NodeConfig>('/admin/node-config', config);
}

/**
 * Test node connection with provided configuration (admin only)
 */
export async function testNodeConfig(config: NodeConfig): Promise<{
  success: boolean;
  serverInfo?: string;
  protocol?: string;
  blockHeight?: number;
  message: string;
  error?: string;
}> {
  return apiClient.post('/admin/node-config/test', config);
}

// ========================================
// ELECTRUM SERVER MANAGEMENT
// ========================================

/**
 * Get all Electrum servers, optionally filtered by network
 */
export async function getElectrumServers(network?: string): Promise<ElectrumServer[]> {
  const params = network ? `?network=${network}` : '';
  return apiClient.get<ElectrumServer[]>(`/admin/electrum-servers${params}`);
}

/**
 * Add a new Electrum server
 */
export async function addElectrumServer(server: Omit<ElectrumServer, 'id' | 'nodeConfigId' | 'createdAt' | 'updatedAt'>): Promise<ElectrumServer> {
  return apiClient.post<ElectrumServer>('/admin/electrum-servers', server);
}

/**
 * Update an Electrum server
 */
export async function updateElectrumServer(id: string, data: Partial<ElectrumServer>): Promise<ElectrumServer> {
  return apiClient.put<ElectrumServer>(`/admin/electrum-servers/${id}`, data);
}

/**
 * Delete an Electrum server
 */
export async function deleteElectrumServer(id: string): Promise<{ success: boolean; message: string }> {
  return apiClient.delete<{ success: boolean; message: string }>(`/admin/electrum-servers/${id}`);
}

/**
 * Test an Electrum server connection
 */
export async function testElectrumServer(id: string): Promise<{
  success: boolean;
  message: string;
  blockHeight?: number;
  serverVersion?: string;
}> {
  return apiClient.post(`/admin/electrum-servers/${id}/test`);
}

/**
 * Reorder Electrum server priorities
 */
export async function reorderElectrumServers(serverIds: string[]): Promise<ElectrumServer[]> {
  return apiClient.put<ElectrumServer[]>('/admin/electrum-servers/reorder', { serverIds });
}

/**
 * Test Electrum connection with arbitrary host/port/ssl
 */
export async function testElectrumConnection(config: {
  host: string;
  port: number;
  useSsl: boolean;
}): Promise<{
  success: boolean;
  message: string;
  blockHeight?: number;
}> {
  return apiClient.post('/admin/electrum-servers/test-connection', config);
}

/**
 * Test SOCKS5 proxy connection
 */
export async function testProxy(config: {
  host: string;
  port: number;
  username?: string;
  password?: string;
  targetHost?: string;
  targetPort?: number;
}): Promise<{
  success: boolean;
  message: string;
}> {
  return apiClient.post('/admin/proxy/test', config);
}
