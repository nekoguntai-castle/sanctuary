/**
 * Wallets - Import Router
 *
 * Wallet import from descriptors or JSON files
 */

import { Router } from 'express';
import { z } from 'zod';
import { BITCOIN_NETWORKS } from '@sanctuary/shared/constants/bitcoin';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../errors/errorHandler';
import { ErrorCodes } from '../../errors/ApiError';
import * as walletImport from '../../services/walletImport';
import { importFormatRegistry } from '../../services/import';
import { requireAuthenticatedUser } from '../../middleware/auth';

const router = Router();

const WalletImportValidateBodySchema = z
  .object({
    descriptor: z.string().min(1).optional(),
    changeDescriptor: z.string().min(1).optional(),
    json: z.string().min(1).optional(),
    network: z.enum(BITCOIN_NETWORKS).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!data.descriptor && !data.json) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either descriptor or json is required',
        path: ['descriptor'],
      });
    }
    if (data.changeDescriptor && !data.descriptor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'changeDescriptor requires descriptor',
        path: ['changeDescriptor'],
      });
    }
  });

const WalletImportBodySchema = z
  .object({
    data: z.string().min(1).optional(),
    name: z.string().trim().min(1, 'name is required').optional(),
    network: z.enum(BITCOIN_NETWORKS).optional(),
    deviceLabels: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!data.data) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'data (descriptor or JSON) is required',
        path: ['data'],
      });
    }
    if (data.name === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'name is required',
        path: ['name'],
      });
    }
  });

const walletImportValidationMessage = (issues: Array<{ message: string }>) =>
  /* v8 ignore start -- ZodError from safeParse has at least one issue */
  issues[0]?.message ?? 'Invalid wallet import request';
  /* v8 ignore stop */

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
router.post('/import/validate', validate(
  { body: WalletImportValidateBodySchema },
  { message: walletImportValidationMessage, code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { descriptor, changeDescriptor, json, network } = req.body;

  const result = await walletImport.validateImport(userId, {
    descriptor,
    changeDescriptor,
    json,
    network,
  });

  res.json(result);
}));

/**
 * POST /api/v1/wallets/import
 * Import a wallet from descriptor or JSON
 */
router.post('/import', validate(
  { body: WalletImportBodySchema },
  { message: walletImportValidationMessage, code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { data, name, network, deviceLabels } = req.body;

  const result = await walletImport.importWallet(userId, {
    data,
    name,
    network,
    deviceLabels,
  });

  res.status(201).json(result);
}));

export default router;
