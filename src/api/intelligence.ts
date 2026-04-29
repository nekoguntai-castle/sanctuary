/**
 * Intelligence API
 *
 * API calls for Treasury Intelligence features (insights, chat, settings)
 */

import apiClient from './client';

// ========================================
// CONSTANTS
// ========================================

export const INSIGHT_TYPE_LABELS: Record<string, string> = {
  utxo_health: 'UTXO Health',
  fee_timing: 'Fee Timing',
  anomaly: 'Anomaly Detection',
  tax: 'Tax Implications',
  consolidation: 'Consolidation',
};

// ========================================
// TYPE DEFINITIONS
// ========================================

export interface IntelligenceStatus {
  available: boolean;
  ollamaConfigured: boolean;
  endpointType?: 'container' | 'host' | 'remote';
  reason?: string;
}

export interface AIInsight {
  id: string;
  walletId: string;
  type: 'utxo_health' | 'fee_timing' | 'anomaly' | 'tax' | 'consolidation';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  summary: string;
  analysis: string;
  data?: Record<string, unknown>;
  status: 'active' | 'dismissed' | 'acted_on' | 'expired';
  expiresAt?: string;
  notifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AIConversation {
  id: string;
  userId: string;
  walletId?: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AIMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface WalletIntelligenceSettings {
  enabled: boolean;
  notifyTelegram: boolean;
  notifyPush: boolean;
  severityFilter: 'info' | 'warning' | 'critical';
  typeFilter: string[];
}

// ========================================
// STATUS
// ========================================

export async function getIntelligenceStatus(): Promise<IntelligenceStatus> {
  return apiClient.get<IntelligenceStatus>('/intelligence/status');
}

// ========================================
// INSIGHTS
// ========================================

export async function getInsights(
  walletId: string,
  filters?: { status?: string; type?: string; severity?: string; limit?: number; offset?: number }
): Promise<{ insights: AIInsight[] }> {
  const params = new URLSearchParams({ walletId });
  if (filters?.status) params.set('status', filters.status);
  if (filters?.type) params.set('type', filters.type);
  if (filters?.severity) params.set('severity', filters.severity);
  if (filters?.limit) params.set('limit', String(filters.limit));
  if (filters?.offset) params.set('offset', String(filters.offset));

  return apiClient.get<{ insights: AIInsight[] }>(`/intelligence/insights?${params.toString()}`);
}

export async function getInsightCount(walletId: string): Promise<{ count: number }> {
  return apiClient.get<{ count: number }>(`/intelligence/insights/count?walletId=${walletId}`);
}

export async function updateInsightStatus(
  id: string,
  status: 'dismissed' | 'acted_on'
): Promise<{ insight: AIInsight }> {
  return apiClient.patch<{ insight: AIInsight }>(`/intelligence/insights/${id}`, { status });
}

// ========================================
// CONVERSATIONS
// ========================================

export async function getConversations(
  limit = 20,
  offset = 0
): Promise<{ conversations: AIConversation[] }> {
  return apiClient.get<{ conversations: AIConversation[] }>(
    `/intelligence/conversations?limit=${limit}&offset=${offset}`
  );
}

export async function createConversation(
  walletId?: string
): Promise<{ conversation: AIConversation }> {
  return apiClient.post<{ conversation: AIConversation }>(
    '/intelligence/conversations',
    { walletId }
  );
}

export async function getConversationMessages(
  conversationId: string
): Promise<{ messages: AIMessage[] }> {
  return apiClient.get<{ messages: AIMessage[] }>(
    `/intelligence/conversations/${conversationId}/messages`
  );
}

export async function sendChatMessage(
  conversationId: string,
  content: string,
  walletContext?: Record<string, unknown>
): Promise<{ userMessage: AIMessage; assistantMessage: AIMessage }> {
  return apiClient.post<{ userMessage: AIMessage; assistantMessage: AIMessage }>(
    `/intelligence/conversations/${conversationId}/messages`,
    { content, walletContext }
  );
}

export async function deleteConversation(id: string): Promise<{ success: boolean }> {
  return apiClient.delete<{ success: boolean }>(`/intelligence/conversations/${id}`);
}

// ========================================
// SETTINGS
// ========================================

export async function getIntelligenceSettings(
  walletId: string
): Promise<{ settings: WalletIntelligenceSettings }> {
  return apiClient.get<{ settings: WalletIntelligenceSettings }>(
    `/intelligence/settings/${walletId}`
  );
}

export async function updateIntelligenceSettings(
  walletId: string,
  settings: Partial<WalletIntelligenceSettings>
): Promise<{ settings: WalletIntelligenceSettings }> {
  return apiClient.patch<{ settings: WalletIntelligenceSettings }>(
    `/intelligence/settings/${walletId}`,
    settings
  );
}
