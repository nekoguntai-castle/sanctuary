/**
 * Wallet API Routes
 *
 * Wallet management, sharing, and export endpoints
 *
 * Route domains extracted to ./wallets/ subdirectory:
 * - crud.ts           - Wallet lifecycle (list, create, get, update, delete)
 * - analytics.ts      - Stats and balance history
 * - devices.ts        - Device and address management
 * - export.ts         - BIP 329, Sparrow, and other export formats
 * - sharing.ts        - User and group access control
 * - import.ts         - Wallet import from descriptors/JSON
 * - xpubValidation.ts - XPUB validation utility
 * - telegram.ts       - Per-wallet notification settings
 * - autopilot.ts      - Treasury Autopilot settings and status
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';

// Domain routers
import xpubValidationRouter from './wallets/xpubValidation';
import importRouter from './wallets/import';
import crudRouter from './wallets/crud';
import analyticsRouter from './wallets/analytics';
import devicesRouter from './wallets/devices';
import exportRouter from './wallets/export';
import sharingRouter from './wallets/sharing';
import telegramRouter from './wallets/telegram';
import autopilotRouter from './wallets/autopilot';

const router = Router();

// All wallet routes require authentication
router.use(authenticate);

// Global utility endpoints (must be before /:id routes to avoid matching)
router.use('/', xpubValidationRouter);
router.use('/', importRouter);

// Wallet-specific routes
router.use('/', crudRouter);
router.use('/', analyticsRouter);
router.use('/', devicesRouter);
router.use('/', exportRouter);
router.use('/', sharingRouter);
router.use('/', telegramRouter);
router.use('/', autopilotRouter);

export default router;
