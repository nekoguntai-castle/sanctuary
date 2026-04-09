/**
 * Wallets - Telegram Router
 *
 * Per-wallet Telegram notification settings
 */

import { Router } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { asyncHandler } from '../../errors/errorHandler';
import { getWalletTelegramSettings, updateWalletTelegramSettings } from '../../services/telegram/telegramService';

const router = Router();

/**
 * GET /api/v1/wallets/:id/telegram
 * Get Telegram notification settings for a specific wallet
 */
router.get('/:id/telegram', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const userId = req.user!.userId;

  const settings = await getWalletTelegramSettings(userId, walletId);

  res.json({
    settings: settings || {
      enabled: false,
      notifyReceived: true,
      notifySent: true,
      notifyConsolidation: true,
      notifyDraft: true,
    },
  });
}));

/**
 * PATCH /api/v1/wallets/:id/telegram
 * Update Telegram notification settings for a specific wallet
 */
router.patch('/:id/telegram', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const userId = req.user!.userId;
  const { enabled, notifyReceived, notifySent, notifyConsolidation, notifyDraft } = req.body;

  await updateWalletTelegramSettings(userId, walletId, {
    enabled: enabled ?? false,
    notifyReceived: notifyReceived ?? true,
    notifySent: notifySent ?? true,
    notifyConsolidation: notifyConsolidation ?? true,
    notifyDraft: notifyDraft ?? true,
  });

  res.json({
    success: true,
    message: 'Telegram settings updated',
  });
}));

export default router;
