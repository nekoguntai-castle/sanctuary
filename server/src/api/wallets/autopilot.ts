/**
 * Wallets - Autopilot Router
 *
 * Per-wallet Treasury Autopilot settings and status.
 * All endpoints gated behind the treasuryAutopilot feature flag.
 */

import { Router, Request, Response } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { requireFeature } from '../../middleware/featureGate';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { DEFAULT_AUTOPILOT_SETTINGS } from '../../services/autopilot/types';

const router = Router();
const log = createLogger('WALLETS:AUTOPILOT');

/**
 * GET /api/v1/wallets/:id/autopilot
 * Get autopilot settings for a specific wallet
 */
router.get(
  '/:id/autopilot',
  requireFeature('treasuryAutopilot'),
  requireWalletAccess('view'),
  async (req: Request, res: Response) => {
    try {
      const walletId = req.walletId!;
      const userId = req.user!.userId;

      const { getWalletAutopilotSettings } = await import('../../services/autopilot/settings');
      const settings = await getWalletAutopilotSettings(userId, walletId);

      res.json({
        settings: settings || DEFAULT_AUTOPILOT_SETTINGS,
      });
    } catch (error) {
      log.error('Get autopilot settings error', { error: getErrorMessage(error) });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to get autopilot settings',
      });
    }
  }
);

/**
 * PATCH /api/v1/wallets/:id/autopilot
 * Update autopilot settings for a specific wallet
 */
router.patch(
  '/:id/autopilot',
  requireFeature('treasuryAutopilot'),
  requireWalletAccess('view'),
  async (req: Request, res: Response) => {
    try {
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
      } = req.body;

      const { updateWalletAutopilotSettings } = await import('../../services/autopilot/settings');
      await updateWalletAutopilotSettings(userId, walletId, {
        enabled: enabled ?? DEFAULT_AUTOPILOT_SETTINGS.enabled,
        maxFeeRate: maxFeeRate ?? DEFAULT_AUTOPILOT_SETTINGS.maxFeeRate,
        minUtxoCount: minUtxoCount ?? DEFAULT_AUTOPILOT_SETTINGS.minUtxoCount,
        dustThreshold: dustThreshold ?? DEFAULT_AUTOPILOT_SETTINGS.dustThreshold,
        cooldownHours: cooldownHours ?? DEFAULT_AUTOPILOT_SETTINGS.cooldownHours,
        notifyTelegram: notifyTelegram ?? DEFAULT_AUTOPILOT_SETTINGS.notifyTelegram,
        notifyPush: notifyPush ?? DEFAULT_AUTOPILOT_SETTINGS.notifyPush,
      });

      res.json({
        success: true,
        message: 'Autopilot settings updated',
      });
    } catch (error) {
      log.error('Update autopilot settings error', { error: getErrorMessage(error) });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to update autopilot settings',
      });
    }
  }
);

/**
 * GET /api/v1/wallets/:id/autopilot/status
 * Get current UTXO health + fee analysis for a wallet
 */
router.get(
  '/:id/autopilot/status',
  requireFeature('treasuryAutopilot'),
  requireWalletAccess('view'),
  async (req: Request, res: Response) => {
    try {
      const walletId = req.walletId!;
      const userId = req.user!.userId;

      const { getWalletAutopilotSettings } = await import('../../services/autopilot/settings');
      const { getUtxoHealthProfile } = await import('../../services/autopilot/utxoHealth');
      const { getLatestFeeSnapshot } = await import('../../services/autopilot/feeMonitor');

      const settings = await getWalletAutopilotSettings(userId, walletId);
      const dustThreshold = settings?.dustThreshold ?? DEFAULT_AUTOPILOT_SETTINGS.dustThreshold;

      const [health, feeSnapshot] = await Promise.all([
        getUtxoHealthProfile(walletId, dustThreshold),
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
        },
        feeSnapshot,
        settings: settings || DEFAULT_AUTOPILOT_SETTINGS,
      });
    } catch (error) {
      log.error('Get autopilot status error', { error: getErrorMessage(error) });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to get autopilot status',
      });
    }
  }
);

export default router;
