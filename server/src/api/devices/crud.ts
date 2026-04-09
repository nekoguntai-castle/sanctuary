/**
 * Devices - CRUD Router
 *
 * Core device lifecycle operations (list, create, get, update, delete)
 */

import { Router } from 'express';
import { requireDeviceAccess } from '../../middleware/deviceAccess';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError, NotFoundError, ConflictError } from '../../errors/ApiError';
import { deviceRepository } from '../../repositories';
import { getUserAccessibleDevices } from '../../services/deviceAccess';
import { createLogger } from '../../utils/logger';
import {
  compareAccounts,
  normalizeIncomingAccounts,
} from './accountConflicts';

const router = Router();
const log = createLogger('DEVICE:ROUTE:CRUD');

// Re-export for backward compatibility
export type { DeviceAccountInput } from './accountConflicts';

/**
 * GET /api/v1/devices
 * Get all devices accessible by authenticated user (owned + shared)
 */
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;

  // Get all devices user has access to (owned + shared via user + shared via group)
  const devices = await getUserAccessibleDevices(userId);

  res.json(devices);
}));

/**
 * POST /api/v1/devices
 * Register a new hardware device
 *
 * Supports multiple modes:
 * 1. Legacy mode: single derivationPath + xpub (backward compatible)
 * 2. Multi-account mode: accounts[] array with multiple xpubs for different wallet types
 * 3. Merge mode: merge=true to add accounts to existing device (same fingerprint)
 *
 * When a device with the same fingerprint exists:
 * - Without merge flag: Returns 409 with existing device info and account comparison
 * - With merge=true: Adds new accounts to the existing device
 */
router.post('/', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { type, label, fingerprint: rawFingerprint, derivationPath, xpub, modelSlug, accounts, merge } = req.body;

  // Validation - require fingerprint and label always
  if (!type || !label || !rawFingerprint) {
    throw new InvalidInputError('type, label, and fingerprint are required');
  }

  // Normalize fingerprint to lowercase for consistent storage and comparison
  // This prevents duplicate devices due to case differences (e.g., 'ABC12345' vs 'abc12345')
  const fingerprint = rawFingerprint.toLowerCase();

  // Must have either xpub (legacy) or accounts (multi-account)
  if (!xpub && (!accounts || accounts.length === 0)) {
    throw new InvalidInputError('Either xpub or accounts array is required');
  }

  // Normalize incoming accounts
  const normalized = normalizeIncomingAccounts(accounts, xpub, derivationPath);
  if ('error' in normalized) {
    throw new InvalidInputError(normalized.error);
  }
  const incomingAccounts = normalized.accounts;

  // Check if device already exists
  const existingDevice = await deviceRepository.findByFingerprintWithAccounts(fingerprint);

  if (existingDevice) {
    // Compare accounts
    const comparison = compareAccounts(existingDevice.accounts, incomingAccounts);

    // If merge mode is requested
    if (merge === true) {
      // Check for conflicts - cannot merge if there are conflicting xpubs
      if (comparison.conflictingAccounts.length > 0) {
        return res.status(409).json({
          error: 'Conflict',
          message: 'Cannot merge: some accounts have conflicting xpubs for the same derivation path',
          existingDevice: {
            id: existingDevice.id,
            label: existingDevice.label,
            fingerprint: existingDevice.fingerprint,
          },
          conflictingAccounts: comparison.conflictingAccounts,
        });
      }

      // Check if there are any new accounts to add
      if (comparison.newAccounts.length === 0) {
        return res.status(200).json({
          message: 'Device already has all these accounts',
          device: existingDevice,
          added: 0,
        });
      }

      // Add new accounts
      const addedAccounts = await deviceRepository.mergeAccounts(existingDevice.id, comparison.newAccounts);

      log.info('Merged accounts into existing device', {
        deviceId: existingDevice.id,
        fingerprint,
        addedCount: addedAccounts.length,
        paths: comparison.newAccounts.map(a => a.derivationPath),
      });

      // Return updated device
      const updatedDevice = await deviceRepository.findByIdWithModelAndAccounts(existingDevice.id);

      return res.status(200).json({
        message: `Added ${addedAccounts.length} new account(s) to existing device`,
        device: updatedDevice,
        added: addedAccounts.length,
      });
    }

    // Not merge mode - return conflict with comparison info
    return res.status(409).json({
      error: 'Conflict',
      message: 'Device with this fingerprint already exists',
      existingDevice: {
        id: existingDevice.id,
        label: existingDevice.label,
        fingerprint: existingDevice.fingerprint,
        type: existingDevice.type,
        model: existingDevice.model,
        accounts: existingDevice.accounts,
      },
      comparison: {
        newAccounts: comparison.newAccounts,
        matchingAccounts: comparison.matchingAccounts,
        conflictingAccounts: comparison.conflictingAccounts,
      },
    });
  }

  // Find the model ID if a slug was provided
  let modelId: string | undefined;
  if (modelSlug) {
    const model = await deviceRepository.findHardwareModel(modelSlug);
    if (model) {
      modelId = model.id;
    }
  }

  // Determine primary xpub (for legacy field) - prefer single_sig native_segwit
  const primaryAccount = incomingAccounts.find(
    a => a.purpose === 'single_sig' && a.scriptType === 'native_segwit'
  ) || incomingAccounts[0];
  const primaryXpub = primaryAccount?.xpub;
  const primaryPath = primaryAccount?.derivationPath;

  // Create device, owner record, and accounts in a transaction
  const device = await deviceRepository.createWithOwnerAndAccounts(
    {
      userId,
      type,
      label,
      fingerprint,
      derivationPath: primaryPath,
      xpub: primaryXpub,
      modelId,
    },
    incomingAccounts,
  );

  log.info('Device registered', {
    deviceId: device.id,
    fingerprint,
    accountCount: incomingAccounts.length,
    purposes: incomingAccounts.map(a => a.purpose),
  });

  // Fetch the complete device with accounts for response
  const deviceWithAccounts = await deviceRepository.findByIdWithModelAndAccounts(device.id);

  res.status(201).json(deviceWithAccounts);
}));

/**
 * GET /api/v1/devices/:id
 * Get a specific device by ID (requires view access)
 */
router.get('/:id', requireDeviceAccess('view'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const deviceRole = req.deviceRole;

  const device = await deviceRepository.findByIdFull(id);

  if (!device) {
    throw new NotFoundError('Device not found');
  }

  // Add access info to response
  const isOwner = deviceRole === 'owner';
  res.json({
    ...device,
    isOwner,
    userRole: deviceRole,
    sharedBy: isOwner ? undefined : device.user.username,
  });
}));

/**
 * PATCH /api/v1/devices/:id
 * Update a device (label, derivationPath, type, or model) - owner only
 */
router.patch('/:id', requireDeviceAccess('owner'), asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { id } = req.params;
  const { label, derivationPath, type, modelSlug } = req.body;

  // Build update data
  const updateData: Record<string, unknown> = {};
  if (label !== undefined) updateData.label = label;
  if (derivationPath !== undefined) updateData.derivationPath = derivationPath;
  if (type !== undefined) updateData.type = type;

  // If modelSlug provided, look up the model ID
  if (modelSlug) {
    const model = await deviceRepository.findHardwareModel(modelSlug);
    if (model) {
      updateData.modelId = model.id;
      // Also update the type to match the model's type
      updateData.type = model.slug;
    } else {
      throw new InvalidInputError('Invalid device model slug');
    }
  }

  const updatedDevice = await deviceRepository.updateWithModel(id, updateData);

  log.info('Device updated', { deviceId: id, userId, updates: Object.keys(updateData) });

  res.json(updatedDevice);
}));

/**
 * DELETE /api/v1/devices/:id
 * Remove a device (owner only, and only if not in use by any wallet)
 */
router.delete('/:id', requireDeviceAccess('owner'), asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const device = await deviceRepository.findByIdWithWallets(id);

  if (!device) {
    throw new NotFoundError('Device not found');
  }

  // Check if device is in use by any wallet
  if (device.wallets && device.wallets.length > 0) {
    const walletNames = device.wallets.map(w => w.wallet.name).join(', ');
    throw new ConflictError(`Cannot delete device. It is in use by wallet(s): ${walletNames}`);
  }

  await deviceRepository.delete(id);

  log.info('Device deleted', { deviceId: id, userId });

  res.status(204).send();
}));

export default router;
