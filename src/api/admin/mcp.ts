import apiClient from '../client';

export interface AdminMcpServerStatus {
  enabled: boolean;
  host: string;
  port: number;
  allowedHosts: string[];
  rateLimitPerMinute: number;
  defaultPageSize: number;
  maxPageSize: number;
  maxDateRangeDays: number;
  serverName: string;
  serverVersion: string;
}

export interface AdminMcpApiKeyUser {
  id: string;
  username: string;
  isAdmin: boolean;
}

export interface AdminMcpApiKeyScope {
  walletIds?: string[];
  allowAuditLogs?: boolean;
}

export interface AdminMcpApiKey {
  id: string;
  userId: string;
  user?: AdminMcpApiKeyUser;
  createdByUserId?: string | null;
  name: string;
  keyPrefix: string;
  scope: AdminMcpApiKeyScope;
  lastUsedAt?: string | null;
  lastUsedIp?: string | null;
  lastUsedAgent?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  revokedAt?: string | null;
}

export interface CreateMcpApiKeyRequest {
  userId: string;
  name: string;
  walletIds?: string[];
  allowAuditLogs?: boolean;
  expiresAt?: string;
}

export type CreatedMcpApiKey = AdminMcpApiKey & {
  apiKey: string;
};

export async function getMcpServerStatus(): Promise<AdminMcpServerStatus> {
  return apiClient.get<AdminMcpServerStatus>('/admin/mcp-keys/status');
}

export async function listMcpApiKeys(): Promise<AdminMcpApiKey[]> {
  return apiClient.get<AdminMcpApiKey[]>('/admin/mcp-keys');
}

export async function createMcpApiKey(input: CreateMcpApiKeyRequest): Promise<CreatedMcpApiKey> {
  return apiClient.post<CreatedMcpApiKey>('/admin/mcp-keys', input);
}

export async function revokeMcpApiKey(keyId: string): Promise<AdminMcpApiKey> {
  return apiClient.delete<AdminMcpApiKey>(`/admin/mcp-keys/${encodeURIComponent(keyId)}`);
}
