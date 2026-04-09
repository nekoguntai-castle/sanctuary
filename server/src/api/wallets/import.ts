/**
 * Wallets - Import Router
 *
 * Wallet import from descriptors or JSON files
 */

import { Router } from 'express';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError } from '../../errors/ApiError';
import * as walletImport from '../../services/walletImport';
import { importFormatRegistry } from '../../services/import';

const router = Router();

/**
 * GET /api/v1/wallets/import/formats
 * Get available import formats
 */
router.get('/import/formats', asyncHandler(async (_req, res) => {
  const handlers = importFormatRegistry.getAll();

  const formats = handlers.map((handler) => ({
    id: handler.id,
    name: handler.name,
    description: handler.description,
    extensions: handler.fileExtensions || [],
    priority: handler.priority,
  }));

  res.json({ formats });
}));

/**
 * POST /api/v1/wallets/import/validate
 * Validate import data and preview what will happen
 */
router.post('/import/validate', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { descriptor, json } = req.body;

  if (!descriptor && !json) {
    throw new InvalidInputError('Either descriptor or json is required');
  }

  const result = await walletImport.validateImport(userId, {
    descriptor,
    json,
  });

  res.json(result);
}));

/**
 * POST /api/v1/wallets/import
 * Import a wallet from descriptor or JSON
 */
router.post('/import', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { data, name, network, deviceLabels } = req.body;

  if (!data) {
    throw new InvalidInputError('data (descriptor or JSON) is required');
  }

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new InvalidInputError('name is required');
  }

  const result = await walletImport.importWallet(userId, {
    data,
    name: name.trim(),
    network,
    deviceLabels,
  });

  res.status(201).json(result);
}));

export default router;
