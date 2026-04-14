/**
 * Blockchain Service Unit Tests
 *
 * Tests for blockchain synchronization logic including:
 * - Transaction detection (received, sent, consolidation)
 * - UTXO management (creation, spending, reconciliation)
 * - RBF handling (replacement detection and linking)
 * - Address discovery (gap limit management)
 * - Balance calculation and correction
 */

import { registerBlockchainAddressDiscoveryContracts } from './blockchainService/address-discovery.contracts';
import { registerBlockchainBalanceCalculationContracts } from './blockchainService/balance-calculation.contracts';
import { registerBlockchainBroadcastingValidationReorgContracts } from './blockchainService/broadcasting-validation-reorg.contracts';
import './blockchainService/blockchainServiceTestHarness';
import { registerBlockchainTransactionDetectionContracts } from './blockchainService/transaction-detection.contracts';
import { registerBlockchainUtxoManagementContracts } from './blockchainService/utxo-management.contracts';

registerBlockchainTransactionDetectionContracts();
registerBlockchainUtxoManagementContracts();
registerBlockchainAddressDiscoveryContracts();
registerBlockchainBalanceCalculationContracts();
registerBlockchainBroadcastingValidationReorgContracts();
