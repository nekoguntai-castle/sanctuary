/**
 * Transaction Service Tests
 *
 * Tests for UTXO selection, fee calculation, and transaction creation.
 * These are CRITICAL tests for a Bitcoin wallet.
 */

import { describe } from 'vitest';
import { registerTransactionServiceCreateSingleSigTests } from './transactionServiceCreate/create-single-sig.contracts';
import { registerTransactionServiceEdgeConsolidationTests } from './transactionServiceCreate/edge-consolidation.contracts';
import { registerTransactionServiceMultisigTests } from './transactionServiceCreate/multisig.contracts';
import { registerTransactionServicePsbtHelpersLegacyTests } from './transactionServiceCreate/psbt-helpers-legacy.contracts';
import { setupTransactionServiceCreateTestHooks } from './transactionServiceCreate/transactionServiceCreateTestHarness';

describe('Transaction Service — Creation', () => {
  setupTransactionServiceCreateTestHooks();
  registerTransactionServiceCreateSingleSigTests();
  registerTransactionServiceMultisigTests();
  registerTransactionServicePsbtHelpersLegacyTests();
  registerTransactionServiceEdgeConsolidationTests();
});
