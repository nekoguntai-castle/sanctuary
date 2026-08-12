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
 * - webhooks.ts       - Per-wallet webhook notification endpoints
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
import webhooksRouter from './wallets/webhooks';
import autopilotRouter from './wallets/autopilot';
import policiesRouter from './wallets/policies';
import approvalsRouter from './wallets/approvals';
import remediationRouter from './wallets/remediation';

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
router.use('/', webhooksRouter);
router.use('/', autopilotRouter);
router.use('/', policiesRouter);
router.use('/', approvalsRouter);
router.use('/', remediationRouter);

export default router;
