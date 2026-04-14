import { describe } from 'vitest';

import { registerBatchTransactionTestSetup } from './transactionServiceBatch/transactionServiceBatchTestHarness';
import { registerCreateBatchTransactionContracts } from './transactionServiceBatch/transactionServiceBatch.create.contracts';
import { registerCreateBatchTransactionMultisigContracts } from './transactionServiceBatch/transactionServiceBatch.multisig.contracts';
import { registerBatchTransactionEdgeCaseContracts } from './transactionServiceBatch/transactionServiceBatch.edge-cases.contracts';

describe('Transaction Service — Batch', () => {
  registerBatchTransactionTestSetup();
  registerCreateBatchTransactionContracts();
  registerCreateBatchTransactionMultisigContracts();
  registerBatchTransactionEdgeCaseContracts();
});
