import { vi } from 'vitest';
import type { AIConversation, AIInsight, AIMessage } from '../../../src/api/intelligence';

vi.mock('../../../src/api/intelligence', () => ({
  INSIGHT_TYPE_LABELS: {
    utxo_health: 'UTXO Health',
    fee_timing: 'Fee Timing',
    anomaly: 'Anomaly Detection',
    tax: 'Tax Implications',
    consolidation: 'Consolidation',
  },
  getInsights: vi.fn().mockResolvedValue({ insights: [] }),
  updateInsightStatus: vi.fn().mockResolvedValue({ insight: {} }),
  getConversations: vi.fn().mockResolvedValue({ conversations: [] }),
  createConversation: vi.fn().mockResolvedValue({
    conversation: { id: 'c1', userId: 'u1', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
  }),
  getConversationMessages: vi.fn().mockResolvedValue({ messages: [] }),
  sendChatMessage: vi.fn().mockResolvedValue({
    userMessage: { id: 'msg-1', conversationId: 'c1', role: 'user', content: 'test', createdAt: '2024-01-01' },
    assistantMessage: { id: 'msg-2', conversationId: 'c1', role: 'assistant', content: 'response', createdAt: '2024-01-01' },
  }),
  deleteConversation: vi.fn().mockResolvedValue({ success: true }),
  getIntelligenceSettings: vi.fn().mockResolvedValue({
    settings: {
      enabled: false,
      notifyTelegram: true,
      notifyPush: true,
      severityFilter: 'info',
      typeFilter: ['utxo_health'],
    },
  }),
  updateIntelligenceSettings: vi.fn().mockResolvedValue({
    settings: {
      enabled: true,
      notifyTelegram: true,
      notifyPush: true,
      severityFilter: 'info',
      typeFilter: ['utxo_health'],
    },
  }),
  getInsightCount: vi.fn().mockResolvedValue({ count: 0 }),
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// jsdom does not implement scrollIntoView.
Element.prototype.scrollIntoView = vi.fn();

export const mockInsight: AIInsight = {
  id: 'insight-1',
  walletId: 'wallet-1',
  type: 'utxo_health',
  severity: 'warning',
  title: 'Fragmented UTXOs Detected',
  summary: 'Your wallet has 47 small UTXOs that could be consolidated.',
  analysis: 'Detailed analysis of UTXO fragmentation and recommended consolidation strategy.',
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export const mockCriticalInsight: AIInsight = {
  id: 'insight-2',
  walletId: 'wallet-1',
  type: 'anomaly',
  severity: 'critical',
  title: 'Unusual Transaction Pattern',
  summary: 'An unusual transaction pattern was detected.',
  analysis: 'A large volume of transactions in a short window.',
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export const mockInfoInsight: AIInsight = {
  id: 'insight-3',
  walletId: 'wallet-1',
  type: 'fee_timing',
  severity: 'info',
  title: 'Low Fee Window',
  summary: 'Fees are currently low.',
  analysis: 'Network fees are at historic lows.',
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export const mockConversation: AIConversation = {
  id: 'conv-1',
  userId: 'user-1',
  walletId: 'wallet-1',
  title: 'UTXO Strategy Discussion',
  createdAt: '2024-06-01T10:00:00Z',
  updatedAt: '2024-06-01T12:00:00Z',
};

export const mockUserMessage: AIMessage = {
  id: 'msg-user-1',
  conversationId: 'conv-1',
  role: 'user',
  content: 'What is my UTXO health?',
  createdAt: '2024-06-01T10:00:00Z',
};

export const mockAssistantMessage: AIMessage = {
  id: 'msg-assistant-1',
  conversationId: 'conv-1',
  role: 'assistant',
  content: 'Your UTXO health is good with 12 UTXOs.',
  createdAt: '2024-06-01T10:01:00Z',
};

export type { AIConversation, AIInsight, AIMessage };
