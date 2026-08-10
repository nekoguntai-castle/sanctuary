/**
 * Devices - Accounts Router
 *
 * Device account management (multi-xpub support)
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  DEVICE_ACCOUNT_PURPOSE_VALUES,
  WALLET_SCRIPT_TYPE_VALUES,
} from '@sanctuary/shared/constants/walletIdentity';
import { requireDeviceAccess } from '../../middleware/deviceAccess';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../errors/errorHandler';
import { ConflictError, ErrorCodes, InvalidInputError, NotFoundError } from '../../errors/ApiError';
import { deviceRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import { assertHardwareWalletCapability } from '../../services/hardwareWalletCapabilities';

const router = Router();
const log = createLogger('DEVICE:ROUTE:ACCOUNTS');

const DeviceAccountBodySchema = z.object({
  purpose: z.enum(DEVICE_ACCOUNT_PURPOSE_VALUES),
  scriptType: z.enum(WALLET_SCRIPT_TYPE_VALUES),
  derivationPath: z.string().trim().min(1),
  xpub: z.string().trim().min(1),
});

const deviceAccountValidationMessage =
  `purpose, scriptType, derivationPath, and xpub are required; purpose must be one of: ${DEVICE_ACCOUNT_PURPOSE_VALUES.join(', ')}; scriptType must be one of: ${WALLET_SCRIPT_TYPE_VALUES.join(', ')}`;

/**
 * GET /api/v1/devices/:id/accounts
 * Get all accounts for a device (requires view access)
 */
router.get('/:id/accounts', requireDeviceAccess('view'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  const accounts = await deviceRepository.findAccountsByDeviceId(id);

  res.json(accounts);
}));

/**
 * POST /api/v1/devices/:id/accounts
 * Add a new account to an existing device (owner only)
 *
 * This allows adding a multisig xpub to a device that was originally
 * registered with only a single-sig xpub.
 */
router.post(
  '/:id/accounts',
  requireDeviceAccess('owner'),
  validate(
    { body: DeviceAccountBodySchema },
    { message: deviceAccountValidationMessage, code: ErrorCodes.INVALID_INPUT }
  ),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { purpose, scriptType, derivationPath, xpub } = req.body;

    const device = await deviceRepository.findByIdWithModelAndAccounts(id);
    if (!device) {
      throw new NotFoundError('Device not found');
    }
    assertHardwareWalletCapability(device, 'account_add');

    // Same purpose/script accounts are allowed when the coin-type path differs
    // (for example mainnet m/84'/0'/0' and testnet/signet m/84'/1'/0').
    const existingAccount = await deviceRepository.findDuplicateAccount(id, derivationPath, purpose, scriptType);

    if (existingAccount) {
      throw new ConflictError('An account with this derivation path already exists');
    }

    const account = await deviceRepository.createAccount({
      deviceId: id,
      purpose,
      scriptType,
      derivationPath,
      xpub,
    });

    log.info('Device account added', {
      deviceId: id,
      accountId: account.id,
      purpose,
      scriptType,
      derivationPath,
    });

    res.status(201).json(account);
  })
);

/**
 * DELETE /api/v1/devices/:id/accounts/:accountId
 * Remove an account from a device (owner only)
 *
 * Note: Cannot delete the last account of a device
 */
router.delete('/:id/accounts/:accountId', requireDeviceAccess('owner'), asyncHandler(async (req, res) => {
  const { id, accountId } = req.params;

  // Check if account exists and belongs to this device
  const account = await deviceRepository.findAccountByIdAndDevice(accountId, id);

  if (!account) {
    throw new NotFoundError('Account not found');
  }

  const device = await deviceRepository.findByIdWithModelAndAccounts(id);
  if (!device) {
    throw new NotFoundError('Device not found');
  }
  assertHardwareWalletCapability(device, 'account_add');

  if (await deviceRepository.isAccountLinked(accountId)) {
    throw new ConflictError('Cannot delete an account that is bound to a wallet');
  }

  // Check if this is the last account
  const accountCount = await deviceRepository.countAccountsByDeviceId(id);

  if (accountCount <= 1) {
    throw new InvalidInputError('Cannot delete the last account of a device');
  }

  await deviceRepository.deleteAccount(accountId);

  log.info('Device account deleted', {
    deviceId: id,
    accountId,
    purpose: account.purpose,
    scriptType: account.scriptType,
  });

  res.status(204).send();
}));

export default router;
