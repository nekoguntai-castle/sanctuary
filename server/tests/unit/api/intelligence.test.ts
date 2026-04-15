/**
 * Treasury Intelligence API Route Tests
 *
 * Tests for /api/v1/intelligence/* endpoints:
 * - GET /status
 * - GET /insights, GET /insights/count, PATCH /insights/:id
 * - GET /conversations, POST /conversations
 * - GET /conversations/:id/messages, POST /conversations/:id/messages
 * - DELETE /conversations/:id
 * - GET /settings/:walletId, PATCH /settings/:walletId
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockRequest,
  createMockResponse,
} from '../../helpers/testUtils';

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock middleware
vi.mock('../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user ?? { userId: 'test-user-id', username: 'testuser', isAdmin: false },
  authenticate: (_req: any, _res: any, next: any) => {
    _req.user = { userId: 'test-user-123', username: 'testuser', isAdmin: false };
    next();
  },
}));
vi.mock('../../../src/middleware/featureGate', () => ({
  requireAllFeatures: () => (_req: any, _res: any, next: any) => next(),
  requireFeature: () => (_req: any, _res: any, next: any) => next(),
}));

// Mock asyncHandler to pass-through
vi.mock('../../../src/errors/errorHandler', () => ({
  asyncHandler: (fn: any) => fn,
}));

// Mock NotFoundError
vi.mock('../../../src/errors/ApiError', () => ({
  NotFoundError: class NotFoundError extends Error {
    statusCode = 404;
    constructor(msg: string) {
      super(msg);
      this.name = 'NotFoundError';
    }
  },
}));

// Mock intelligence services (hoisted to avoid initialization order issues)
const {
  mockAnalysisService,
  mockInsightService,
  mockConversationService,
  mockIntelligenceSettings,
} = vi.hoisted(() => ({
  mockAnalysisService: {
    getIntelligenceStatus: vi.fn(),
  },
  mockInsightService: {
    getInsightsByWallet: vi.fn(),
    countActiveInsights: vi.fn(),
    getInsightById: vi.fn(),
    dismissInsight: vi.fn(),
    markActedOn: vi.fn(),
  },
  mockConversationService: {
    getConversations: vi.fn(),
    createConversation: vi.fn(),
    getConversation: vi.fn(),
    getMessages: vi.fn(),
    sendMessage: vi.fn(),
    deleteConversation: vi.fn(),
  },
  mockIntelligenceSettings: {
    getWalletIntelligenceSettings: vi.fn(),
    updateWalletIntelligenceSettings: vi.fn(),
  },
}));

vi.mock('../../../src/services/intelligence', () => ({
  analysisService: mockAnalysisService,
  insightService: mockInsightService,
  conversationService: mockConversationService,
  intelligenceSettings: mockIntelligenceSettings,
}));

// Mock walletRepository
const mockFindByIdWithAccess = vi.fn();
vi.mock('../../../src/repositories/walletRepository', () => ({
  findByIdWithAccess: (...args: unknown[]) => mockFindByIdWithAccess(...args),
}));

// We need to import the router to get the route handlers.
// Since asyncHandler is pass-through, we can extract the handlers from Express router.
// But it's simpler to test via the route handlers directly through Express.
// The routes use router.get/post/patch/delete with asyncHandler wrapper,
// so with asyncHandler mocked as pass-through, the handlers are just async functions.
// We'll import the module and use Express + direct request/response mocking.

import express from 'express';
import intelligenceRoutes from '../../../src/api/intelligence';

// Build the Express app
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/intelligence', intelligenceRoutes);
  return app;
}

/**
 * Minimal request-based test helper.
 * Since asyncHandler is mocked to pass-through (no error catching),
 * we directly call route handlers via mock request/response objects.
 * We build the app but use the mock request/response pattern from testUtils.
 */

// Because the routes use `asyncHandler` (mocked as pass-through) and middleware
// (mocked to add user), we can extract the handlers by layer analysis.
// However, the simplest approach: import the router and call the actual layer
// handlers through our mock req/res, since all middleware is already mocked.

describe('Intelligence API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /status', () => {
    it('returns intelligence status', async () => {
      const statusData = { available: true, model: 'llama3', endpoint: 'http://ollama:11434' };
      mockAnalysisService.getIntelligenceStatus.mockResolvedValueOnce(statusData);

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();

      // Find the status handler from the router
      const handler = getRouteHandler(intelligenceRoutes, 'get', '/status');
      await handler(req as any, res as any, vi.fn());

      expect(getResponse().body).toEqual(statusData);
      expect(mockAnalysisService.getIntelligenceStatus).toHaveBeenCalledOnce();
    });
  });

  describe('GET /insights', () => {
    it('returns 400 when walletId is missing', async () => {
      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        query: {},
      });
      const { res, getResponse } = createMockResponse();

      const handler = getRouteHandler(intelligenceRoutes, 'get', '/insights');
      await handler(req as any, res as any, vi.fn());

      expect(getResponse().statusCode).toBe(400);
      expect(getResponse().body).toEqual({ error: 'walletId query parameter required' });
    });

    it('throws NotFoundError when wallet not accessible', async () => {
      mockFindByIdWithAccess.mockResolvedValueOnce(null);

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        query: { walletId: 'wallet-999' },
      });
      const { res } = createMockResponse();

      const handler = getRouteHandler(intelligenceRoutes, 'get', '/insights');
      await expect(handler(req as any, res as any, vi.fn())).rejects.toThrow('Wallet not found');
    });

    it('returns insights when wallet is accessible', async () => {
      mockFindByIdWithAccess.mockResolvedValueOnce({ id: 'wallet-1' } as any);
      const insightData = [{ id: 'insight-1', type: 'utxo_health', severity: 'warning' }];
      mockInsightService.getInsightsByWallet.mockResolvedValueOnce(insightData);

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        query: { walletId: 'wallet-1', status: 'active', limit: '10', offset: '0' },
      });
      const { res, getResponse } = createMockResponse();

      const handler = getRouteHandler(intelligenceRoutes, 'get', '/insights');
      await handler(req as any, res as any, vi.fn());

      expect(getResponse().body).toEqual({ insights: insightData });
      expect(mockInsightService.getInsightsByWallet).toHaveBeenCalledWith(
        'wallet-1',
        { status: 'active' },
        10,
        0,
      );
    });
  });

  describe('GET /insights/count', () => {
    it('returns 400 when walletId is missing', async () => {
      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        query: {},
      });
      const { res, getResponse } = createMockResponse();

      const handler = getRouteHandler(intelligenceRoutes, 'get', '/insights/count');
      await handler(req as any, res as any, vi.fn());

      expect(getResponse().statusCode).toBe(400);
    });

    it('returns count of active insights', async () => {
      mockFindByIdWithAccess.mockResolvedValueOnce({ id: 'wallet-1' } as any);
      mockInsightService.countActiveInsights.mockResolvedValueOnce(7);

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        query: { walletId: 'wallet-1' },
      });
      const { res, getResponse } = createMockResponse();

      const handler = getRouteHandler(intelligenceRoutes, 'get', '/insights/count');
      await handler(req as any, res as any, vi.fn());

      expect(getResponse().body).toEqual({ count: 7 });
    });
  });

  describe('PATCH /insights/:id', () => {
    it('returns 400 for invalid status', async () => {
      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'insight-1' },
        body: { status: 'invalid' },
      });
      const { res, getResponse } = createMockResponse();

      const handler = getRouteHandler(intelligenceRoutes, 'patch', '/insights/:id');
      await handler(req as any, res as any, vi.fn());

      expect(getResponse().statusCode).toBe(400);
      expect(getResponse().body.error).toContain('dismissed');
    });

    it('returns 400 when status is missing', async () => {
      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'insight-1' },
        body: {},
      });
      const { res, getResponse } = createMockResponse();

      const handler = getRouteHandler(intelligenceRoutes, 'patch', '/insights/:id');
      await handler(req as any, res as any, vi.fn());

      expect(getResponse().statusCode).toBe(400);
    });

    it('throws NotFoundError when insight does not exist', async () => {
      mockInsightService.getInsightById.mockResolvedValueOnce(null);

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'insight-999' },
        body: { status: 'dismissed' },
      });
      const { res } = createMockResponse();

      const handler = getRouteHandler(intelligenceRoutes, 'patch', '/insights/:id');
      await expect(handler(req as any, res as any, vi.fn())).rejects.toThrow('Insight not found');
    });

    it('dismisses an insight', async () => {
      const existing = { id: 'insight-1', status: 'active', walletId: 'wallet-1' };
      mockInsightService.getInsightById.mockResolvedValueOnce(existing);
      mockFindByIdWithAccess.mockResolvedValueOnce({ id: 'wallet-1' } as any);
      const updated = { ...existing, status: 'dismissed' };
      mockInsightService.dismissInsight.mockResolvedValueOnce(updated);

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'insight-1' },
        body: { status: 'dismissed' },
      });
      const { res, getResponse } = createMockResponse();

      const handler = getRouteHandler(intelligenceRoutes, 'patch', '/insights/:id');
      await handler(req as any, res as any, vi.fn());

      expect(getResponse().body).toEqual({ insight: updated });
      expect(mockInsightService.dismissInsight).toHaveBeenCalledWith('insight-1');
    });

    it('marks an insight as acted_on', async () => {
      const existing = { id: 'insight-1', status: 'active', walletId: 'wallet-1' };
      mockInsightService.getInsightById.mockResolvedValueOnce(existing);
      mockFindByIdWithAccess.mockResolvedValueOnce({ id: 'wallet-1' } as any);
      const updated = { ...existing, status: 'acted_on' };
      mockInsightService.markActedOn.mockResolvedValueOnce(updated);

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'insight-1' },
        body: { status: 'acted_on' },
      });
      const { res, getResponse } = createMockResponse();

      const handler = getRouteHandler(intelligenceRoutes, 'patch', '/insights/:id');
      await handler(req as any, res as any, vi.fn());

      expect(getResponse().body).toEqual({ insight: updated });
      expect(mockInsightService.markActedOn).toHaveBeenCalledWith('insight-1');
    });
  });

  describe('GET /conversations', () => {
    it('returns conversations for the authenticated user', async () => {
      const convos = [{ id: 'conv-1', title: 'Test convo' }];
      mockConversationService.getConversations.mockResolvedValueOnce(convos);

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        query: { limit: '5', offset: '10' },
      });
      const { res, getResponse } = createMockResponse();

      const handler = getRouteHandler(intelligenceRoutes, 'get', '/conversations');
      await handler(req as any, res as any, vi.fn());

      expect(getResponse().body).toEqual({ conversations: convos });
      expect(mockConversationService.getConversations).toHaveBeenCalledWith('test-user-123', 5, 10);
    });

    it('uses default limit and offset', async () => {
      mockConversationService.getConversations.mockResolvedValueOnce([]);

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        query: {},
      });
      const { res } = createMockResponse();

      const handler = getRouteHandler(intelligenceRoutes, 'get', '/conversations');
      await handler(req as any, res as any, vi.fn());

      expect(mockConversationService.getConversations).toHaveBeenCalledWith('test-user-123', 20, 0);
    });
  });

  describe('POST /conversations', () => {
    it('creates a new conversation', async () => {
      const newConvo = { id: 'conv-new', userId: 'test-user-123', walletId: 'wallet-1' };
      mockConversationService.createConversation.mockResolvedValueOnce(newConvo);

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        body: { walletId: 'wallet-1' },
      });
      const { res, getResponse } = createMockResponse();

      const handler = getRouteHandler(intelligenceRoutes, 'post', '/conversations');
      await handler(req as any, res as any, vi.fn());

      expect(getResponse().statusCode).toBe(201);
      expect(getResponse().body).toEqual({ conversation: newConvo });
      expect(mockConversationService.createConversation).toHaveBeenCalledWith('test-user-123', 'wallet-1');
    });

    it('returns 400 when walletId has an invalid type', async () => {
      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        body: { walletId: 42 },
      });
      const { res, getResponse } = createMockResponse();

      const handler = getRouteHandler(intelligenceRoutes, 'post', '/conversations');
      await handler(req as any, res as any, vi.fn());

      expect(getResponse().statusCode).toBe(400);
      expect(getResponse().body.error).toContain('walletId');
      expect(mockConversationService.createConversation).not.toHaveBeenCalled();
    });
  });

  describe('GET /conversations/:id/messages', () => {
    it('throws NotFoundError when conversation does not exist', async () => {
      mockConversationService.getConversation.mockResolvedValueOnce(null);

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'conv-999' },
      });
      const { res } = createMockResponse();

      const handler = getRouteHandler(intelligenceRoutes, 'get', '/conversations/:id/messages');
      await expect(handler(req as any, res as any, vi.fn())).rejects.toThrow('Conversation not found');
    });

    it('returns messages for a valid conversation', async () => {
      mockConversationService.getConversation.mockResolvedValueOnce({ id: 'conv-1' });
      const messages = [{ id: 'msg-1', role: 'user', content: 'hello' }];
      mockConversationService.getMessages.mockResolvedValueOnce(messages);

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'conv-1' },
      });
      const { res, getResponse } = createMockResponse();

      const handler = getRouteHandler(intelligenceRoutes, 'get', '/conversations/:id/messages');
      await handler(req as any, res as any, vi.fn());

      expect(getResponse().body).toEqual({ messages });
    });
  });

  describe('POST /conversations/:id/messages', () => {
    it('returns 400 when content is missing', async () => {
      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'conv-1' },
        body: {},
      });
      const { res, getResponse } = createMockResponse();

      const handler = getRouteHandler(intelligenceRoutes, 'post', '/conversations/:id/messages');
      await handler(req as any, res as any, vi.fn());

      expect(getResponse().statusCode).toBe(400);
      expect(getResponse().body.error).toContain('content required');
    });

    it('sends a message and returns the result', async () => {
      const result = {
        userMessage: { id: 'msg-1', role: 'user', content: 'What is my UTXO health?' },
        assistantMessage: { id: 'msg-2', role: 'assistant', content: 'Your UTXO set is healthy.' },
      };
      mockConversationService.sendMessage.mockResolvedValueOnce(result);

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'conv-1' },
        body: { content: 'What is my UTXO health?', walletContext: { walletId: 'w1' } },
      });
      const { res, getResponse } = createMockResponse();

      const handler = getRouteHandler(intelligenceRoutes, 'post', '/conversations/:id/messages');
      await handler(req as any, res as any, vi.fn());

      expect(getResponse().body).toEqual(result);
      expect(mockConversationService.sendMessage).toHaveBeenCalledWith(
        'conv-1',
        'test-user-123',
        'What is my UTXO health?',
        { walletId: 'w1' },
      );
    });

    it('returns 400 when wallet context has an invalid type', async () => {
      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'conv-1' },
        body: { content: 'What is my UTXO health?', walletContext: 'wallet-1' },
      });
      const { res, getResponse } = createMockResponse();

      const handler = getRouteHandler(intelligenceRoutes, 'post', '/conversations/:id/messages');
      await handler(req as any, res as any, vi.fn());

      expect(getResponse().statusCode).toBe(400);
      expect(getResponse().body.error).toContain('Invalid message request');
      expect(mockConversationService.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /conversations/:id', () => {
    it('throws NotFoundError when conversation not found or not owned', async () => {
      mockConversationService.deleteConversation.mockResolvedValueOnce(false);

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'conv-999' },
      });
      const { res } = createMockResponse();

      const handler = getRouteHandler(intelligenceRoutes, 'delete', '/conversations/:id');
      await expect(handler(req as any, res as any, vi.fn())).rejects.toThrow('Conversation not found');
    });

    it('deletes a conversation successfully', async () => {
      mockConversationService.deleteConversation.mockResolvedValueOnce(true);

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'conv-1' },
      });
      const { res, getResponse } = createMockResponse();

      const handler = getRouteHandler(intelligenceRoutes, 'delete', '/conversations/:id');
      await handler(req as any, res as any, vi.fn());

      expect(getResponse().body).toEqual({ success: true });
      expect(mockConversationService.deleteConversation).toHaveBeenCalledWith('conv-1', 'test-user-123');
    });
  });

  describe('GET /settings/:walletId', () => {
    it('returns per-wallet intelligence settings', async () => {
      const settings = { enabled: true, severityFilter: 'warning', typeFilter: ['utxo_health'] };
      mockIntelligenceSettings.getWalletIntelligenceSettings.mockResolvedValueOnce(settings);

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { walletId: 'wallet-1' },
      });
      const { res, getResponse } = createMockResponse();

      const handler = getRouteHandler(intelligenceRoutes, 'get', '/settings/:walletId');
      await handler(req as any, res as any, vi.fn());

      expect(getResponse().body).toEqual({ settings });
      expect(mockIntelligenceSettings.getWalletIntelligenceSettings).toHaveBeenCalledWith(
        'test-user-123',
        'wallet-1',
      );
    });
  });

  describe('PATCH /settings/:walletId', () => {
    it('updates per-wallet intelligence settings', async () => {
      const updated = { enabled: false, severityFilter: 'critical', typeFilter: ['anomaly'] };
      mockIntelligenceSettings.updateWalletIntelligenceSettings.mockResolvedValueOnce(updated);

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { walletId: 'wallet-1' },
        body: { enabled: false, severityFilter: 'critical' },
      });
      const { res, getResponse } = createMockResponse();

      const handler = getRouteHandler(intelligenceRoutes, 'patch', '/settings/:walletId');
      await handler(req as any, res as any, vi.fn());

      expect(getResponse().body).toEqual({ settings: updated });
      expect(mockIntelligenceSettings.updateWalletIntelligenceSettings).toHaveBeenCalledWith(
        'test-user-123',
        'wallet-1',
        { enabled: false, severityFilter: 'critical' },
      );
    });

    it('returns 400 for invalid settings field types', async () => {
      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { walletId: 'wallet-1' },
        body: { enabled: 'false' },
      });
      const { res, getResponse } = createMockResponse();

      const handler = getRouteHandler(intelligenceRoutes, 'patch', '/settings/:walletId');
      await handler(req as any, res as any, vi.fn());

      expect(getResponse().statusCode).toBe(400);
      expect(getResponse().body.error).toContain('Invalid intelligence settings');
      expect(mockIntelligenceSettings.updateWalletIntelligenceSettings).not.toHaveBeenCalled();
    });
  });
});

// ========================================
// Helper to extract route handlers from Express Router
// ========================================

/**
 * Extract a route handler from an Express router by method and path.
 * The routes use asyncHandler (mocked as pass-through), so the last
 * handler in the layer stack is the actual async function.
 */
function getRouteHandler(router: any, method: string, path: string): (...args: any[]) => Promise<any> {
  const stack = router.stack || [];

  for (const layer of stack) {
    if (layer.route) {
      const routePath = layer.route.path;
      const routeStack = layer.route.stack;

      if (routePath === path) {
        for (const routeLayer of routeStack) {
          if (routeLayer.method === method) {
            return routeLayer.handle;
          }
        }
      }
    }
  }

  throw new Error(`Route handler not found: ${method.toUpperCase()} ${path}`);
}
