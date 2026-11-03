/**
 * Bitcoin API Routes
 *
 * API endpoints for Bitcoin network operations
 *
 * Route domains extracted to ./bitcoin/ subdirectory:
 * - network.ts      - Network status, mempool, blocks
 * - fees.ts         - Fee estimation endpoints
 * - address.ts      - Address validation, lookup, sync
 * - transactions.ts - Transaction operations (broadcast, RBF, CPFP, batch)
 * - sync.ts         - Wallet sync operations
 */

import { Router } from 'express';

// Domain routers
import networkRouter from './bitcoin/network';
import feesRouter from './bitcoin/fees';
import addressRouter from './bitcoin/address';
import transactionsRouter from './bitcoin/transactions';
import syncRouter from './bitcoin/sync';

const router = Router();

// Network-wide reads (status, fees, mempool, recent blocks) are public. Routes
// that query the node with caller-chosen input (txid, address, block height)
// or touch wallets require authentication; syncRouter applies it router-wide.
router.use('/', networkRouter);
router.use('/', feesRouter);
router.use('/', addressRouter);
router.use('/', transactionsRouter);
router.use('/', syncRouter);

export default router;
