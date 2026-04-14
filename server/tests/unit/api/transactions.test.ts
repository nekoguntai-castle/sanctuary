/**
 * Transaction API Routes Tests
 *
 * Tests for transaction endpoints including:
 * - GET /wallets/:walletId/transactions
 * - GET /wallets/:walletId/transactions/pending
 * - GET /wallets/:walletId/transactions/export
 * - GET /wallets/:walletId/utxos
 * - POST /wallets/:walletId/transactions/create
 */

import { describe } from 'vitest';
import { setupTransactionsApiTestHooks } from './transactions/transactionsTestHarness';
import { registerAddressAndRecentTests } from './transactions/transactions.addresses-recent.contracts';
import { registerBalanceExportTests } from './transactions/transactions.balance-export.contracts';
import { registerTransactionMutationTests } from './transactions/transactions.mutations.contracts';
import { registerWalletLedgerTests } from './transactions/transactions.wallet-ledger.contracts';

describe('Transactions API', () => {
  setupTransactionsApiTestHooks();
  registerWalletLedgerTests();
  registerBalanceExportTests();
  registerTransactionMutationTests();
  registerAddressAndRecentTests();
});
