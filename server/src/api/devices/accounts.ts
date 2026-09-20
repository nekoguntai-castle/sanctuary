/**
 * Devices - Accounts Router
 *
 * Device account management (multi-xpub support)
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  ExactDeviceEvidenceStringSchema,
  MasterFingerprintSchema,
} from '@sanctuary/shared/schemas/deviceIdentity';
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
import { addDeviceAccountWithEvidence } from '../../services/deviceAccountRegistration';

const router = Router();
const log = createLogger('DEVICE:ROUTE:ACCOUNTS');

const DeviceAccountBodySchema = z.object({
  purpose: z.enum(DEVICE_ACCOUNT_PURPOSE_VALUES),
  scriptType: z.enum(WALLET_SCRIPT_TYPE_VALUES),
  derivationPath: ExactDeviceEvidenceStringSchema,
  xpub: ExactDeviceEvidenceStringSchema,
  masterFingerprint: MasterFingerprintSchema,
});

const deviceAccountValidationMessage =
  `purpose, scriptType, derivationPath, xpub, and masterFingerprint are required; purpose must be one of: ${DEVICE_ACCOUNT_PURPOSE_VALUES.join(', ')}; scriptType must be one of: ${WALLET_SCRIPT_TYPE_VALUES.join(', ')}`;

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
    const { purpose, scriptType, derivationPath, xpub, masterFingerprint } = req.body;
    const account = await addDeviceAccountWithEvidence(id, {
      purpose,
      scriptType,
      derivationPath,
      xpub,
      masterFingerprint,
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
  // Preserve the existing preflight error order; the locked check below is authoritative.
  assertHardwareWalletCapability(device, 'account_add');

  const result = await deviceRepository.deleteAccountPreservingOne(
    id,
    accountId,
    (lockedDevice) => assertHardwareWalletCapability(lockedDevice, 'account_add'),
  );
  if (result.kind === 'device-not-found') throw new NotFoundError('Device not found');
  if (result.kind === 'account-not-found') throw new NotFoundError('Account not found');
  if (result.kind === 'account-linked') {
    throw new ConflictError('Cannot delete an account that is bound to a wallet');
  }
  if (result.kind === 'last-account') {
    throw new InvalidInputError('Cannot delete the last account of a device');
  }

  log.info('Device account deleted', {
    deviceId: id,
    accountId,
    purpose: result.account.purpose,
    scriptType: result.account.scriptType,
  });

  res.status(204).send();
}));

export default router;
