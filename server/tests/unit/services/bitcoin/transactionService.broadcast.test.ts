/**
 * Transaction Service Broadcast Tests
 *
 * Registrar for broadcastAndSave and broadcast edge-case contracts.
 */

import { beforeEach, describe } from 'vitest';
import { registerBroadcastAndSaveTests } from './transactionServiceBroadcast/transactionServiceBroadcast.broadcastAndSave.contracts';
import { registerBroadcastEdgeCaseTests } from './transactionServiceBroadcast/transactionServiceBroadcast.errors.contracts';
import { setupTransactionServiceBroadcastMocks } from './transactionServiceBroadcast/transactionServiceBroadcastTestHarness';

describe('Transaction Service — Broadcast', () => {
  beforeEach(setupTransactionServiceBroadcastMocks);

  registerBroadcastAndSaveTests();
  registerBroadcastEdgeCaseTests();
});
