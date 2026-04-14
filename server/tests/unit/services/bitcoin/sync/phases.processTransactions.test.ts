import { beforeEach, describe, vi } from 'vitest';
/**
 * Sync Phase Tests — processTransactionsPhase
 *
 * Unit tests for the processTransactionsPhase sync pipeline phase.
 */

import { resetPrismaMocks } from '../../../../mocks/prisma';
import { mockPrismaClient } from '../../../../mocks/prisma';
import { resetElectrumMocks } from '../../../../mocks/electrum';
import { registerProcessTransactionBatchIoTests } from './phasesProcessTransactions/batch-io.contracts';
import { registerProcessTransactionClassificationTests } from './phasesProcessTransactions/classification.contracts';
import { registerProcessTransactionLabelsDedupeEdgeTests } from './phasesProcessTransactions/labels-dedupe-edge.contracts';
import { registerProcessTransactionNotificationsRbfTests } from './phasesProcessTransactions/notifications-rbf.contracts';
import { registerProcessTransactionStoreIoEdgeTests } from './phasesProcessTransactions/store-io-edge.contracts';
import { registerProcessTransactionStoreIoPrimaryTests } from './phasesProcessTransactions/store-io-primary.contracts';

describe('Sync Phases', () => {
  beforeEach(() => {
    resetPrismaMocks();
    resetElectrumMocks();
  });

  describe('processTransactionsPhase', () => {
    const walletId = 'test-wallet';

    beforeEach(() => {
      vi.clearAllMocks();
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);
      mockPrismaClient.transaction.createMany.mockResolvedValue({ count: 0 });
      mockPrismaClient.transactionInput.createMany.mockResolvedValue({ count: 0 });
      mockPrismaClient.transactionOutput.createMany.mockResolvedValue({ count: 0 });
      mockPrismaClient.addressLabel.findMany.mockResolvedValue([]);
    });

    registerProcessTransactionClassificationTests(walletId);
    registerProcessTransactionBatchIoTests(walletId);
    registerProcessTransactionNotificationsRbfTests(walletId);
    registerProcessTransactionStoreIoPrimaryTests(walletId);
    registerProcessTransactionStoreIoEdgeTests(walletId);
    registerProcessTransactionLabelsDedupeEdgeTests(walletId);
  });
});
