import { describe } from 'vitest';

import { registerTransactionHttpBroadcastTests } from './transactionsHttpRoutes/transactionsHttpRoutes.broadcast.contracts';
import { registerTransactionHttpCreationTests } from './transactionsHttpRoutes/transactionsHttpRoutes.creation.contracts';
import { registerTransactionHttpReadTests } from './transactionsHttpRoutes/transactionsHttpRoutes.reads.contracts';
import { setupTransactionHttpRouteHooks } from './transactionsHttpRoutes/transactionsHttpRoutesTestHarness';

describe('Transaction HTTP Routes', () => {
  setupTransactionHttpRouteHooks();
  registerTransactionHttpReadTests();
  registerTransactionHttpCreationTests();
  registerTransactionHttpBroadcastTests();
});
