/**
 * Transfers API Routes Tests
 */

import { describe } from 'vitest';

import { registerTransferActionTests } from './transfers/transfers.actions.contracts';
import { registerTransferCollectionTests } from './transfers/transfers.collection.contracts';
import { setupTransfersApiTestHarness } from './transfers/transfersTestHarness';

describe('Transfers API Routes', () => {
  setupTransfersApiTestHarness();
  registerTransferCollectionTests();
  registerTransferActionTests();
});
