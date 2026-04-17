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
  AgentManagementOptions,
  CreateAgentApiKeyRequest,
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
