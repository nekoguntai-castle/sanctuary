/**
 * Transactions - Creation Router
 *
 * Aggregates transaction drafting and broadcasting sub-routers.
 * Endpoints for creating, signing, and broadcasting transactions.
 */

import { Router } from 'express';
import draftingRouter from './drafting';
import broadcastingRouter from './broadcasting';

const router = Router();

// Mount sub-routers (both define their own full paths)
router.use(draftingRouter);
router.use(broadcastingRouter);

export default router;
