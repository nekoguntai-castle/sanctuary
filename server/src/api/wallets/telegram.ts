/**
 * Wallets - Telegram Router
 *
 * Per-wallet Telegram notification settings
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../errors/errorHandler';
import { ErrorCodes } from '../../errors/ApiError';
import { getWalletTelegramSettings, updateWalletTelegramSettings } from '../../services/telegram/telegramService';
import type { WalletTelegramSettings } from '../../services/telegram/telegramService';
import { requireAuthenticatedUser } from '../../middleware/auth';

const router = Router();

const TelegramSettingsBodySchema = z.object({
  enabled: z.boolean().optional(),
  notifyReceived: z.boolean().optional(),
  notifySent: z.boolean().optional(),
  notifyConsolidation: z.boolean().optional(),
  notifyDraft: z.boolean().optional(),
});

const DEFAULT_WALLET_TELEGRAM_SETTINGS: WalletTelegramSettings = {
  enabled: false,
  notifyReceived: true,
  notifySent: true,
  notifyConsolidation: true,
  notifyDraft: true,
};

type TelegramSettingsPatch = Partial<WalletTelegramSettings>;

function compactNullishTelegramSettings(body: TelegramSettingsPatch): TelegramSettingsPatch {
  return Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined && value !== null)
  ) as TelegramSettingsPatch;
}

function buildTelegramSettingsUpdate(
  stored: WalletTelegramSettings | null | undefined,
  body: TelegramSettingsPatch
): WalletTelegramSettings {
  return {
    ...DEFAULT_WALLET_TELEGRAM_SETTINGS,
    ...(stored ?? {}),
    ...compactNullishTelegramSettings(body),
  };
}

/**
 * GET /api/v1/wallets/:id/telegram
 * Get Telegram notification settings for a specific wallet
 */
router.get('/:id/telegram', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const userId = requireAuthenticatedUser(req).userId;

  const settings = await getWalletTelegramSettings(userId, walletId);

  res.json({
    settings: settings || DEFAULT_WALLET_TELEGRAM_SETTINGS,
  });
}));

/**
 * PATCH /api/v1/wallets/:id/telegram
 * Update Telegram notification settings for a specific wallet
 */
router.patch('/:id/telegram', requireWalletAccess('view'), validate(
  { body: TelegramSettingsBodySchema },
  { message: 'Invalid Telegram settings', code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const userId = requireAuthenticatedUser(req).userId;

  const stored = await getWalletTelegramSettings(userId, walletId);

  await updateWalletTelegramSettings(
    userId,
    walletId,
    buildTelegramSettingsUpdate(stored, req.body)
  );

  res.json({
    success: true,
    message: 'Telegram settings updated',
  });
}));

export default router;
