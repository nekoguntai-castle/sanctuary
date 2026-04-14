import { describe } from 'vitest';
/**
 * Blockchain Service Tests
 *
 * Tests for transaction detection, UTXO updates, and blockchain sync.
 */

import { registerBlockchainBalanceTests } from './blockchain/balances.contracts';
import { setupBlockchainServiceTestHooks } from './blockchain/blockchainTestHarness';
import { registerBlockchainGapLimitTests } from './blockchain/gapLimit.contracts';
import { registerBlockchainRbfTests } from './blockchain/rbf.contracts';
import { registerBlockchainSyncAddressTests } from './blockchain/syncAddress.contracts';
import { registerBlockchainSyncWalletCoreTests } from './blockchain/syncWallet-core.contracts';
import { registerBlockchainTransactionsReconciliationTests } from './blockchain/transactions-reconciliation.contracts';

describe('Blockchain Service', () => {
  setupBlockchainServiceTestHooks();
  registerBlockchainSyncAddressTests();
  registerBlockchainSyncWalletCoreTests();
  registerBlockchainTransactionsReconciliationTests();
  registerBlockchainBalanceTests();
  registerBlockchainGapLimitTests();
  registerBlockchainRbfTests();
});
