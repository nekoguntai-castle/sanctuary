/**
 * Wallets - Devices Router
 *
 * Device and address management for wallets
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../errors/errorHandler';
import { ErrorCodes } from '../../errors/ApiError';
import * as walletService from '../../services/wallet';
import { requireAuthenticatedUser } from '../../middleware/auth';

const router = Router();

const WalletAddDeviceBodySchema = z.object({
  deviceId: z.string().trim().min(1),
  deviceAccountId: z.string().trim().min(1),
  signerIndex: z.number().int().min(0),
}).strict();

/**
 * POST /api/v1/wallets/:id/addresses
 * Generate a new receiving address (edit access - signer or owner)
 */
router.post('/:id/addresses', requireWalletAccess('edit'), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const walletId = req.walletId!;

  const address = await walletService.generateAddress(walletId, userId);

  res.status(201).json({ address });
}));

/**
 * POST /api/v1/wallets/:id/devices
 * Add a device to wallet (edit access - signer or owner)
 */
router.post(
  '/:id/devices',
  requireWalletAccess('edit'),
  validate(
    { body: WalletAddDeviceBodySchema },
    { message: 'deviceId and deviceAccountId are required', code: ErrorCodes.INVALID_INPUT }
  ),
  asyncHandler(async (req, res) => {
    const userId = requireAuthenticatedUser(req).userId;
    const walletId = req.walletId!;
    const { deviceId, deviceAccountId, signerIndex } = req.body;

    await walletService.addDeviceToWallet(
      walletId,
      { deviceId, deviceAccountId, signerIndex },
      userId,
    );

    res.status(201).json({ message: 'Device added to wallet' });
  })
);

/**
 * POST /api/v1/wallets/:id/repair
 * Repair wallet descriptor - regenerate from attached devices
 */
router.post('/:id/repair', requireWalletAccess('owner'), (_req, res) => {
  res.status(410).json({
    error: 'Gone',
    code: 'CONFLICT',
    message: 'Direct wallet repair is retired. Create and approve an immutable remediation preview.',
  });
});

export default router;
