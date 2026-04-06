/**
 * Treasury Intelligence API Routes
 *
 * Status, insights, conversations, and per-wallet settings.
 * All routes require both aiAssistant and treasuryIntelligence feature flags.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireAllFeatures } from '../middleware/featureGate';
import { asyncHandler } from '../errors/errorHandler';
import { NotFoundError } from '../errors/ApiError';
import {
  analysisService,
  insightService,
  conversationService,
  intelligenceSettings,
} from '../services/intelligence';
import { findByIdWithAccess } from '../repositories/walletRepository';

const router = Router();

// All routes require both feature flags
router.use(authenticate);
router.use(requireAllFeatures(['aiAssistant', 'treasuryIntelligence']));

// ========================================
// Status
// ========================================

/**
 * GET /api/v1/intelligence/status
 * Check if Treasury Intelligence is available (Ollama configured and reachable)
 */
router.get('/status', asyncHandler(async (_req, res) => {
  const status = await analysisService.getIntelligenceStatus();
  res.json(status);
}));

// ========================================
// Insights
// ========================================

/**
 * GET /api/v1/intelligence/insights
 * List insights for a wallet
 */
router.get('/insights', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { walletId, status, type, severity, limit, offset } = req.query;

  if (!walletId || typeof walletId !== 'string') {
    return res.status(400).json({ error: 'walletId query parameter required' });
  }

  // Verify wallet access
  const wallet = await findByIdWithAccess(walletId, userId);
  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  const filters: Omit<import('../repositories/intelligenceRepository').InsightFilter, 'walletId'> = {};
  if (typeof status === 'string') filters.status = status as import('../services/intelligence/types').InsightStatus;
  if (typeof type === 'string') filters.type = type as import('../services/intelligence/types').InsightType;
  if (typeof severity === 'string') filters.severity = severity as import('../services/intelligence/types').InsightSeverity;

  const insights = await insightService.getInsightsByWallet(
    walletId,
    filters,
    typeof limit === 'string' ? parseInt(limit, 10) : 50,
    typeof offset === 'string' ? parseInt(offset, 10) : 0
  );

  res.json({ insights });
}));

/**
 * GET /api/v1/intelligence/insights/count
 * Get active insight count for a wallet
 */
router.get('/insights/count', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { walletId } = req.query;

  if (!walletId || typeof walletId !== 'string') {
    return res.status(400).json({ error: 'walletId query parameter required' });
  }

  const wallet = await findByIdWithAccess(walletId, userId);
  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  const count = await insightService.countActiveInsights(walletId);
  res.json({ count });
}));

/**
 * PATCH /api/v1/intelligence/insights/:id
 * Update insight status (dismiss, mark acted_on)
 */
router.patch('/insights/:id', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { id } = req.params;
  const { status } = req.body;

  if (!status || !['dismissed', 'acted_on'].includes(status)) {
    return res.status(400).json({ error: 'status must be "dismissed" or "acted_on"' });
  }

  const existing = await insightService.getInsightById(id);
  if (!existing) {
    throw new NotFoundError('Insight not found');
  }

  // Verify user has access to the wallet this insight belongs to
  const wallet = await findByIdWithAccess(existing.walletId, userId);
  if (!wallet) {
    throw new NotFoundError('Insight not found');
  }

  const updated = status === 'dismissed'
    ? await insightService.dismissInsight(id)
    : await insightService.markActedOn(id);

  res.json({ insight: updated });
}));

// ========================================
// Conversations
// ========================================

/**
 * GET /api/v1/intelligence/conversations
 * List user's conversations
 */
router.get('/conversations', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 20;
  const offset = typeof req.query.offset === 'string' ? parseInt(req.query.offset, 10) : 0;

  const conversations = await conversationService.getConversations(userId, limit, offset);
  res.json({ conversations });
}));

/**
 * POST /api/v1/intelligence/conversations
 * Create a new conversation
 */
router.post('/conversations', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { walletId } = req.body;

  const conversation = await conversationService.createConversation(userId, walletId);
  res.status(201).json({ conversation });
}));

/**
 * GET /api/v1/intelligence/conversations/:id/messages
 * Get messages for a conversation
 */
router.get('/conversations/:id/messages', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const conversation = await conversationService.getConversation(id, userId);
  if (!conversation) {
    throw new NotFoundError('Conversation not found');
  }

  const messages = await conversationService.getMessages(id);
  res.json({ messages });
}));

/**
 * POST /api/v1/intelligence/conversations/:id/messages
 * Send a message and get AI response
 */
router.post('/conversations/:id/messages', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { id } = req.params;
  const { content, walletContext } = req.body;

  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'content required' });
  }

  const result = await conversationService.sendMessage(id, userId, content, walletContext);
  res.json(result);
}));

/**
 * DELETE /api/v1/intelligence/conversations/:id
 * Delete a conversation
 */
router.delete('/conversations/:id', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const deleted = await conversationService.deleteConversation(id, userId);
  if (!deleted) {
    throw new NotFoundError('Conversation not found');
  }

  res.json({ success: true });
}));

// ========================================
// Settings
// ========================================

/**
 * GET /api/v1/intelligence/settings/:walletId
 * Get per-wallet intelligence settings
 */
router.get('/settings/:walletId', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { walletId } = req.params;

  const settings = await intelligenceSettings.getWalletIntelligenceSettings(userId, walletId);
  res.json({ settings });
}));

/**
 * PATCH /api/v1/intelligence/settings/:walletId
 * Update per-wallet intelligence settings
 */
router.patch('/settings/:walletId', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { walletId } = req.params;
  const updates = req.body;

  const settings = await intelligenceSettings.updateWalletIntelligenceSettings(userId, walletId, updates);
  res.json({ settings });
}));

export default router;
