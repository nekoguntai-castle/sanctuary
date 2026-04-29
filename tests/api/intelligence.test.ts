/**
 * Intelligence API Tests
 *
 * Tests for Treasury Intelligence API client functions:
 * status, insights, conversations, chat messages, and settings.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The global setup file stubs getIntelligenceStatus to silence /intelligence/status
// retry storms in component tests; this file tests the real implementation.
vi.unmock('../../src/api/intelligence');

// Mock the API client
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();

vi.mock('../../src/api/client', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

import {
  getIntelligenceStatus,
  getInsights,
  getInsightCount,
  updateInsightStatus,
  getConversations,
  createConversation,
  getConversationMessages,
  sendChatMessage,
  deleteConversation,
  getIntelligenceSettings,
  updateIntelligenceSettings,
} from '../../src/api/intelligence';

describe('Intelligence API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================
  // STATUS
  // ========================================

  describe('getIntelligenceStatus', () => {
    it('should GET intelligence status', async () => {
      const mockResponse = {
        available: true,
        ollamaConfigured: true,
        endpointType: 'container',
      };
      mockGet.mockResolvedValue(mockResponse);

      const result = await getIntelligenceStatus();

      expect(mockGet).toHaveBeenCalledWith('/intelligence/status');
      expect(result.available).toBe(true);
      expect(result.endpointType).toBe('container');
    });
  });

  // ========================================
  // INSIGHTS
  // ========================================

  describe('getInsights', () => {
    it('should GET insights with walletId', async () => {
      const mockResponse = { insights: [] };
      mockGet.mockResolvedValue(mockResponse);

      const result = await getInsights('wallet-1');

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/intelligence/insights?')
      );
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('walletId=wallet-1')
      );
      expect(result.insights).toEqual([]);
    });

    it('should include status filter in query params', async () => {
      mockGet.mockResolvedValue({ insights: [] });

      await getInsights('wallet-1', { status: 'active' });

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('status=active')
      );
    });

    it('should include type filter in query params', async () => {
      mockGet.mockResolvedValue({ insights: [] });

      await getInsights('wallet-1', { type: 'utxo_health' });

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('type=utxo_health')
      );
    });

    it('should include severity filter in query params', async () => {
      mockGet.mockResolvedValue({ insights: [] });

      await getInsights('wallet-1', { severity: 'critical' });

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('severity=critical')
      );
    });

    it('should include limit in query params', async () => {
      mockGet.mockResolvedValue({ insights: [] });

      await getInsights('wallet-1', { limit: 10 });

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('limit=10')
      );
    });

    it('should include offset in query params', async () => {
      mockGet.mockResolvedValue({ insights: [] });

      await getInsights('wallet-1', { offset: 20 });

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('offset=20')
      );
    });

    it('should include all filters in query params', async () => {
      mockGet.mockResolvedValue({ insights: [] });

      await getInsights('wallet-1', {
        status: 'active',
        type: 'anomaly',
        severity: 'warning',
        limit: 5,
        offset: 10,
      });

      const calledUrl = mockGet.mock.calls[0][0] as string;
      expect(calledUrl).toContain('walletId=wallet-1');
      expect(calledUrl).toContain('status=active');
      expect(calledUrl).toContain('type=anomaly');
      expect(calledUrl).toContain('severity=warning');
      expect(calledUrl).toContain('limit=5');
      expect(calledUrl).toContain('offset=10');
    });

    it('should not include undefined filters', async () => {
      mockGet.mockResolvedValue({ insights: [] });

      await getInsights('wallet-1', {});

      const calledUrl = mockGet.mock.calls[0][0] as string;
      expect(calledUrl).toContain('walletId=wallet-1');
      expect(calledUrl).not.toContain('status=');
      expect(calledUrl).not.toContain('type=');
      expect(calledUrl).not.toContain('severity=');
      expect(calledUrl).not.toContain('limit=');
      expect(calledUrl).not.toContain('offset=');
    });

    it('should work without filters argument', async () => {
      mockGet.mockResolvedValue({ insights: [] });

      await getInsights('wallet-1');

      const calledUrl = mockGet.mock.calls[0][0] as string;
      expect(calledUrl).toContain('walletId=wallet-1');
    });
  });

  describe('getInsightCount', () => {
    it('should GET insight count for wallet', async () => {
      mockGet.mockResolvedValue({ count: 5 });

      const result = await getInsightCount('wallet-1');

      expect(mockGet).toHaveBeenCalledWith(
        '/intelligence/insights/count?walletId=wallet-1'
      );
      expect(result.count).toBe(5);
    });
  });

  describe('updateInsightStatus', () => {
    it('should PATCH insight with dismissed status', async () => {
      const mockResponse = {
        insight: { id: 'insight-1', status: 'dismissed' },
      };
      mockPatch.mockResolvedValue(mockResponse);

      const result = await updateInsightStatus('insight-1', 'dismissed');

      expect(mockPatch).toHaveBeenCalledWith('/intelligence/insights/insight-1', {
        status: 'dismissed',
      });
      expect(result.insight.status).toBe('dismissed');
    });

    it('should PATCH insight with acted_on status', async () => {
      mockPatch.mockResolvedValue({
        insight: { id: 'insight-1', status: 'acted_on' },
      });

      await updateInsightStatus('insight-1', 'acted_on');

      expect(mockPatch).toHaveBeenCalledWith('/intelligence/insights/insight-1', {
        status: 'acted_on',
      });
    });
  });

  // ========================================
  // CONVERSATIONS
  // ========================================

  describe('getConversations', () => {
    it('should GET conversations with default limit and offset', async () => {
      mockGet.mockResolvedValue({ conversations: [] });

      const result = await getConversations();

      expect(mockGet).toHaveBeenCalledWith(
        '/intelligence/conversations?limit=20&offset=0'
      );
      expect(result.conversations).toEqual([]);
    });

    it('should GET conversations with custom limit and offset', async () => {
      mockGet.mockResolvedValue({ conversations: [] });

      await getConversations(10, 5);

      expect(mockGet).toHaveBeenCalledWith(
        '/intelligence/conversations?limit=10&offset=5'
      );
    });
  });

  describe('createConversation', () => {
    it('should POST new conversation with walletId', async () => {
      const mockResponse = {
        conversation: { id: 'conv-1', userId: 'user-1', walletId: 'wallet-1' },
      };
      mockPost.mockResolvedValue(mockResponse);

      const result = await createConversation('wallet-1');

      expect(mockPost).toHaveBeenCalledWith('/intelligence/conversations', {
        walletId: 'wallet-1',
      });
      expect(result.conversation.id).toBe('conv-1');
    });

    it('should POST new conversation without walletId', async () => {
      mockPost.mockResolvedValue({ conversation: { id: 'conv-2' } });

      await createConversation();

      expect(mockPost).toHaveBeenCalledWith('/intelligence/conversations', {
        walletId: undefined,
      });
    });
  });

  describe('getConversationMessages', () => {
    it('should GET messages for a conversation', async () => {
      const mockResponse = {
        messages: [
          { id: 'msg-1', role: 'user', content: 'Hello' },
          { id: 'msg-2', role: 'assistant', content: 'Hi there!' },
        ],
      };
      mockGet.mockResolvedValue(mockResponse);

      const result = await getConversationMessages('conv-1');

      expect(mockGet).toHaveBeenCalledWith('/intelligence/conversations/conv-1/messages');
      expect(result.messages).toHaveLength(2);
    });
  });

  describe('sendChatMessage', () => {
    it('should POST message to conversation', async () => {
      const mockResponse = {
        userMessage: { id: 'msg-1', role: 'user', content: 'test' },
        assistantMessage: { id: 'msg-2', role: 'assistant', content: 'response' },
      };
      mockPost.mockResolvedValue(mockResponse);

      const result = await sendChatMessage('conv-1', 'test');

      expect(mockPost).toHaveBeenCalledWith(
        '/intelligence/conversations/conv-1/messages',
        { content: 'test', walletContext: undefined }
      );
      expect(result.userMessage.content).toBe('test');
      expect(result.assistantMessage.content).toBe('response');
    });

    it('should POST message with wallet context', async () => {
      mockPost.mockResolvedValue({
        userMessage: { id: 'msg-1' },
        assistantMessage: { id: 'msg-2' },
      });

      await sendChatMessage('conv-1', 'analyze', { walletId: 'w1', balance: 50000 });

      expect(mockPost).toHaveBeenCalledWith(
        '/intelligence/conversations/conv-1/messages',
        {
          content: 'analyze',
          walletContext: { walletId: 'w1', balance: 50000 },
        }
      );
    });
  });

  describe('deleteConversation', () => {
    it('should DELETE conversation by id', async () => {
      mockDelete.mockResolvedValue({ success: true });

      const result = await deleteConversation('conv-1');

      expect(mockDelete).toHaveBeenCalledWith('/intelligence/conversations/conv-1');
      expect(result.success).toBe(true);
    });
  });

  // ========================================
  // SETTINGS
  // ========================================

  describe('getIntelligenceSettings', () => {
    it('should GET intelligence settings for wallet', async () => {
      const mockResponse = {
        settings: {
          enabled: true,
          notifyTelegram: true,
          notifyPush: false,
          severityFilter: 'warning',
          typeFilter: ['utxo_health', 'anomaly'],
        },
      };
      mockGet.mockResolvedValue(mockResponse);

      const result = await getIntelligenceSettings('wallet-1');

      expect(mockGet).toHaveBeenCalledWith('/intelligence/settings/wallet-1');
      expect(result.settings.enabled).toBe(true);
      expect(result.settings.severityFilter).toBe('warning');
      expect(result.settings.typeFilter).toEqual(['utxo_health', 'anomaly']);
    });
  });

  describe('updateIntelligenceSettings', () => {
    it('should PATCH intelligence settings with partial update', async () => {
      const mockResponse = {
        settings: {
          enabled: true,
          notifyTelegram: true,
          notifyPush: true,
          severityFilter: 'info',
          typeFilter: ['utxo_health'],
        },
      };
      mockPatch.mockResolvedValue(mockResponse);

      const result = await updateIntelligenceSettings('wallet-1', { enabled: true });

      expect(mockPatch).toHaveBeenCalledWith('/intelligence/settings/wallet-1', {
        enabled: true,
      });
      expect(result.settings.enabled).toBe(true);
    });

    it('should PATCH multiple settings at once', async () => {
      mockPatch.mockResolvedValue({ settings: {} });

      await updateIntelligenceSettings('wallet-1', {
        notifyTelegram: false,
        severityFilter: 'critical',
        typeFilter: ['anomaly'],
      });

      expect(mockPatch).toHaveBeenCalledWith('/intelligence/settings/wallet-1', {
        notifyTelegram: false,
        severityFilter: 'critical',
        typeFilter: ['anomaly'],
      });
    });
  });
});
