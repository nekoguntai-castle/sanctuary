/**
 * Wallets - Autopilot Router
 *
 * Per-wallet Treasury Autopilot settings and status.
 * All endpoints gated behind the treasuryAutopilot feature flag.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { requireFeature } from '../../middleware/featureGate';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../errors/errorHandler';
import { ErrorCodes } from '../../errors/ApiError';
import { DEFAULT_AUTOPILOT_SETTINGS } from '../../services/autopilot/types';
import { getWalletAutopilotSettings, updateWalletAutopilotSettings } from '../../services/autopilot/settings';
import { getUtxoHealthProfile } from '../../services/autopilot/utxoHealth';
import { getLatestFeeSnapshot } from '../../services/autopilot/feeMonitor';

const router = Router();

const AutopilotSettingsBodySchema = z.object({
  enabled: z.boolean().optional(),
  maxFeeRate: z.number().nonnegative().optional(),
  minUtxoCount: z.number().int().nonnegative().optional(),
  dustThreshold: z.number().int().nonnegative().optional(),
  cooldownHours: z.number().nonnegative().optional(),
  notifyTelegram: z.boolean().optional(),
  notifyPush: z.boolean().optional(),
  minDustCount: z.number().int().nonnegative().optional(),
  maxUtxoSize: z.number().int().nonnegative().optional(),
});

/**
 * GET /api/v1/wallets/:id/autopilot
 * Get autopilot settings for a specific wallet
 */
router.get(
  '/:id/autopilot',
  requireFeature('treasuryAutopilot'),
  requireWalletAccess('view'),
  asyncHandler(async (req, res) => {
    const walletId = req.walletId!;
    const userId = req.user!.userId;

    const settings = await getWalletAutopilotSettings(userId, walletId);

    res.json({
      settings: settings || DEFAULT_AUTOPILOT_SETTINGS,
    });
  })
);

/**
 * PATCH /api/v1/wallets/:id/autopilot
 * Update autopilot settings for a specific wallet
 */
router.patch(
  '/:id/autopilot',
  requireFeature('treasuryAutopilot'),
  requireWalletAccess('view'),
  validate(
    { body: AutopilotSettingsBodySchema },
    { message: 'Invalid autopilot settings', code: ErrorCodes.INVALID_INPUT }
  ),
  asyncHandler(async (req, res) => {
    const walletId = req.walletId!;
    const userId = req.user!.userId;
    const {
      enabled,
      maxFeeRate,
      minUtxoCount,
      dustThreshold,
      cooldownHours,
      notifyTelegram,
      notifyPush,
      minDustCount,
      maxUtxoSize,
    } = req.body;

    await updateWalletAutopilotSettings(userId, walletId, {
      enabled: enabled ?? DEFAULT_AUTOPILOT_SETTINGS.enabled,
      maxFeeRate: maxFeeRate ?? DEFAULT_AUTOPILOT_SETTINGS.maxFeeRate,
      minUtxoCount: minUtxoCount ?? DEFAULT_AUTOPILOT_SETTINGS.minUtxoCount,
      dustThreshold: dustThreshold ?? DEFAULT_AUTOPILOT_SETTINGS.dustThreshold,
      cooldownHours: cooldownHours ?? DEFAULT_AUTOPILOT_SETTINGS.cooldownHours,
      notifyTelegram: notifyTelegram ?? DEFAULT_AUTOPILOT_SETTINGS.notifyTelegram,
      notifyPush: notifyPush ?? DEFAULT_AUTOPILOT_SETTINGS.notifyPush,
      minDustCount: minDustCount ?? DEFAULT_AUTOPILOT_SETTINGS.minDustCount,
      maxUtxoSize: maxUtxoSize ?? DEFAULT_AUTOPILOT_SETTINGS.maxUtxoSize,
    });

    res.json({
      success: true,
      message: 'Autopilot settings updated',
    });
  })
);

/**
 * GET /api/v1/wallets/:id/autopilot/status
 * Get current UTXO health + fee analysis for a wallet
 */
router.get(
  '/:id/autopilot/status',
  requireFeature('treasuryAutopilot'),
  requireWalletAccess('view'),
  asyncHandler(async (req, res) => {
    const walletId = req.walletId!;
    const userId = req.user!.userId;

    const settings = await getWalletAutopilotSettings(userId, walletId);
    const dustThreshold = settings?.dustThreshold ?? DEFAULT_AUTOPILOT_SETTINGS.dustThreshold;
    const maxUtxoSize = settings?.maxUtxoSize ?? DEFAULT_AUTOPILOT_SETTINGS.maxUtxoSize;

    const [health, feeSnapshot] = await Promise.all([
      getUtxoHealthProfile(walletId, dustThreshold, maxUtxoSize),
      getLatestFeeSnapshot(),
    ]);

    // Serialize BigInt values to strings for JSON
    res.json({
      utxoHealth: {
        totalUtxos: health.totalUtxos,
        dustCount: health.dustCount,
        dustValue: health.dustValue.toString(),
        totalValue: health.totalValue.toString(),
        avgUtxoSize: health.avgUtxoSize.toString(),
        smallestUtxo: health.smallestUtxo.toString(),
        largestUtxo: health.largestUtxo.toString(),
        consolidationCandidates: health.consolidationCandidates,
      },
      feeSnapshot,
      settings: settings || DEFAULT_AUTOPILOT_SETTINGS,
    });
  })
);

export default router;
