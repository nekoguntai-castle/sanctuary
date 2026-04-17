/**
 * Admin Wallet Agents API
 *
 * Admin-only calls for linked agent funding wallets, operational wallets,
 * and scoped `agt_` API keys.
 */

import apiClient from '../client';
import type {
  AgentApiKeyMetadata,
  AgentAlertMetadata,
  AgentAlertStatus,
  AgentFundingOverrideMetadata,
  AgentFundingOverrideStatus,
  AgentWalletDashboardRow,
  AgentManagementOptions,
  CreateAgentApiKeyRequest,
  CreateAgentFundingOverrideRequest,
  CreatedAgentApiKey,
  CreateWalletAgentRequest,
  UpdateWalletAgentRequest,
  WalletAgentMetadata,
} from './types';

export async function getWalletAgents(params?: { walletId?: string }): Promise<WalletAgentMetadata[]> {
  return params?.walletId
    ? apiClient.get<WalletAgentMetadata[]>('/admin/agents', { walletId: params.walletId })
    : apiClient.get<WalletAgentMetadata[]>('/admin/agents');
}

export async function getWalletAgentOptions(): Promise<AgentManagementOptions> {
  return apiClient.get<AgentManagementOptions>('/admin/agents/options');
}

export async function getAgentWalletDashboard(): Promise<AgentWalletDashboardRow[]> {
  return apiClient.get<AgentWalletDashboardRow[]>('/admin/agents/dashboard');
}

export async function createWalletAgent(data: CreateWalletAgentRequest): Promise<WalletAgentMetadata> {
  return apiClient.post<WalletAgentMetadata>('/admin/agents', data);
}

export async function updateWalletAgent(
  agentId: string,
  data: UpdateWalletAgentRequest
): Promise<WalletAgentMetadata> {
  return apiClient.patch<WalletAgentMetadata>(`/admin/agents/${agentId}`, data);
}

export async function revokeWalletAgent(agentId: string): Promise<WalletAgentMetadata> {
  return apiClient.delete<WalletAgentMetadata>(`/admin/agents/${agentId}`);
}

export async function getAgentApiKeys(agentId: string): Promise<AgentApiKeyMetadata[]> {
  return apiClient.get<AgentApiKeyMetadata[]>(`/admin/agents/${agentId}/keys`);
}

export async function getAgentAlerts(
  agentId: string,
  params?: { status?: AgentAlertStatus; type?: string; limit?: number }
): Promise<AgentAlertMetadata[]> {
  return apiClient.get<AgentAlertMetadata[]>(`/admin/agents/${agentId}/alerts`, params);
}

export async function getAgentFundingOverrides(
  agentId: string,
  params?: { status?: AgentFundingOverrideStatus }
): Promise<AgentFundingOverrideMetadata[]> {
  return apiClient.get<AgentFundingOverrideMetadata[]>(`/admin/agents/${agentId}/overrides`, params);
}

export async function createAgentFundingOverride(
  agentId: string,
  data: CreateAgentFundingOverrideRequest
): Promise<AgentFundingOverrideMetadata> {
  return apiClient.post<AgentFundingOverrideMetadata>(`/admin/agents/${agentId}/overrides`, data);
}

export async function revokeAgentFundingOverride(
  agentId: string,
  overrideId: string
): Promise<AgentFundingOverrideMetadata> {
  return apiClient.delete<AgentFundingOverrideMetadata>(`/admin/agents/${agentId}/overrides/${overrideId}`);
}

export async function createAgentApiKey(
  agentId: string,
  data: CreateAgentApiKeyRequest
): Promise<CreatedAgentApiKey> {
  return apiClient.post<CreatedAgentApiKey>(`/admin/agents/${agentId}/keys`, data);
}

export async function revokeAgentApiKey(
  agentId: string,
  keyId: string
): Promise<AgentApiKeyMetadata> {
  return apiClient.delete<AgentApiKeyMetadata>(`/admin/agents/${agentId}/keys/${keyId}`);
}
