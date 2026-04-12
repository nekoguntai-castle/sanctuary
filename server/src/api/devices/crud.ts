/**
 * Devices - CRUD Router
 *
 * Core device lifecycle operations (list, create, get, update, delete)
 */

import { Router } from 'express';
import type { ZodIssue, ZodType } from 'zod';
import { requireDeviceAccess } from '../../middleware/deviceAccess';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError, NotFoundError, ConflictError } from '../../errors/ApiError';
import { deviceRepository } from '../../repositories';
import { getUserAccessibleDevices } from '../../services/deviceAccess';
import { registerDevice } from '../../services/deviceRegistration';
import { createLogger } from '../../utils/logger';
import {
  MobileCreateDeviceRequestSchema,
  MobileUpdateDeviceRequestSchema,
} from '../../../../shared/schemas/mobileApiRequests';

const router = Router();
const log = createLogger('DEVICE:ROUTE:CRUD');

// Re-export for backward compatibility
export type { DeviceAccountInput } from './accountConflicts';

function formatDeviceIssue(issue: ZodIssue): string {
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

function parseDeviceRequestBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (result.success) {
    return result.data;
  }

  throw new InvalidInputError(result.error.issues.map(formatDeviceIssue).join(', '));
}

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
  const request = parseDeviceRequestBody(MobileCreateDeviceRequestSchema, req.body);
  const result = await registerDevice(userId, request);

  if (result.kind === 'created') {
    return res.status(201).json(result.device);
  }

  if (result.kind === 'merged') {
    return res.status(200).json({
      message: result.message,
      device: result.device,
      added: result.added,
    });
  }

  if (result.kind === 'merge-conflict') {
    return res.status(409).json({
      error: 'Conflict',
      message: 'Cannot merge: some accounts have conflicting xpubs for the same derivation path',
      existingDevice: result.existingDevice,
      conflictingAccounts: result.conflictingAccounts,
    });
  }

  return res.status(409).json({
    error: 'Conflict',
    message: 'Device with this fingerprint already exists',
    existingDevice: result.existingDevice,
    comparison: {
      newAccounts: result.comparison.newAccounts,
      matchingAccounts: result.comparison.matchingAccounts,
      conflictingAccounts: result.comparison.conflictingAccounts,
    },
  });
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
  const { label, derivationPath, type, modelSlug } = parseDeviceRequestBody(
    MobileUpdateDeviceRequestSchema,
    req.body
  );

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
