/**
 * Transaction API Routes
 *
 * API endpoints for transaction and UTXO management
 *
 * Permissions:
 * - READ (GET): Any user with wallet access (owner, approver, signer, viewer)
 * - WRITE (POST): Only owner or signer roles can create/broadcast transactions
 *
 * Route domains extracted to ./transactions/ subdirectory:
 * - /wallets/:walletId/transactions/* -> ./transactions/walletTransactions.ts
 * - /transactions/recent, pending, balance-history -> ./transactions/crossWallet.ts
 * - /transactions/:txid/* -> ./transactions/transactionDetail.ts
 * - /wallets/:walletId/transactions/create, batch, broadcast, estimate -> ./transactions/creation.ts
 * - /wallets/:walletId/psbt/* -> ./transactions/creation.ts
 * - /wallets/:walletId/addresses/* -> ./transactions/addresses.ts
 * - /wallets/:walletId/utxos/* -> ./transactions/utxos.ts
 * - /utxos/:utxoId/freeze -> ./transactions/utxos.ts
 * - /wallets/:walletId/privacy/* -> ./transactions/privacy.ts
 * - /utxos/:utxoId/privacy -> ./transactions/privacy.ts
 * - /wallets/:walletId/utxos/select, compare-strategies, recommended-strategy -> ./transactions/coinSelection.ts
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';

// Domain routers
import walletTransactionsRouter from './transactions/walletTransactions';
import crossWalletRouter from './transactions/crossWallet';
import transactionDetailRouter from './transactions/transactionDetail';
import creationRouter from './transactions/creation';
import addressesRouter from './transactions/addresses';
import utxosRouter from './transactions/utxos';
import privacyRouter from './transactions/privacy';
import coinSelectionRouter from './transactions/coinSelection';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Mount domain routers
// Order matters: static routes before parameterized routes

// Cross-wallet aggregated endpoints (must be before /transactions/:txid)
router.use('/', crossWalletRouter);

// Wallet-specific transaction endpoints
router.use('/', walletTransactionsRouter);

// Transaction creation endpoints (create, batch, broadcast, estimate, psbt)
router.use('/', creationRouter);

// Address management
router.use('/', addressesRouter);

// UTXO management (includes freeze endpoint)
router.use('/', utxosRouter);

// Privacy analysis
router.use('/', privacyRouter);

// UTXO selection strategies
router.use('/', coinSelectionRouter);

// Transaction detail endpoints (parameterized - must be last)
router.use('/', transactionDetailRouter);

export default router;
